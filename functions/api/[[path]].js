// Little Rescue cloud accounts and cloud save (1.11). Cloudflare Pages Function on the same origin as the game,
// so nothing about where the game lives changes. Needs a D1 database bound as SAVES_DB (see README "เซฟบนคลาวด์").
// Without that binding every route answers 503 and the game keeps working with its local save only.
//
// Accounts are guest accounts: no email or password. A player gets
//   - a device token (one per device, kept in that device's localStorage, sent as "Authorization: Bearer ...")
//   - a recovery code XXXX-XXXX-XXXX-XXXX (shown in the game) to sign in on another device or after clearing data.
// Only SHA-256 hashes of tokens and codes are stored. The save itself is an opaque JSON bundle the game validates
// before restoring it; the server only checks its envelope and size. rev gives compare-and-swap uploads so two
// devices can never silently overwrite each other.
// 1.13 adds /api/wallet/* (server wallet and anti-cheat, docs/server-wallet.md); helpers live in functions/_lib.

import {json, fail, readBody, sha256, authenticate, ensureSchema} from '../_lib/http.js';
import {getWallet, publicView} from '../_lib/wallet.js';
import {seed, startRun, applyOp} from '../_lib/play.js';

const MAX_BUNDLE = 32 * 1024;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, recovery_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS devices (token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS devices_player ON devices (player_id)',
  'CREATE TABLE IF NOT EXISTS saves (player_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, saved_at INTEGER NOT NULL, data TEXT NOT NULL)'
];

function randomCode(groups) {
  const bytes = crypto.getRandomValues(new Uint8Array(groups * 4));
  const chars = Array.from(bytes, b => CODE_ALPHABET[b & 31]).join(''); // 32 symbols: no modulo bias
  return chars.match(/.{4}/g).join('-');
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const normalizeCode = value => typeof value === 'string' ? value.toUpperCase().replace(/[^0-9A-Z]/g, '') : '';

async function issueDevice(db, playerId, now) {
  const token = randomToken();
  await db.prepare('INSERT INTO devices (token_hash, player_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), playerId, now, now).run();
  return token;
}

function validBundle(bundle) {
  return bundle && typeof bundle === 'object' && !Array.isArray(bundle) &&
    bundle.format === 'little-rescue-cloud' && bundle.formatVersion === 1 &&
    bundle.transfer && typeof bundle.transfer === 'object' && bundle.meta && typeof bundle.meta === 'object';
}

async function route(request, env, path) {
  const db = env.SAVES_DB, now = Date.now(), method = request.method;
  // wallet: true tells 1.13+ games that this server checks coins (functions/_lib/play.js).
  if (path === 'health' && method === 'GET') return json({ok: true, cloud: Boolean(db), wallet: Boolean(db)});
  if (!db) return fail(503, 'cloud-not-configured');
  await ensureSchema(db, 'cloud', SCHEMA);

  if (path === 'account' && method === 'POST') {
    const playerId = 'LR-' + randomCode(2), recoveryCode = randomCode(4);
    await db.prepare('INSERT INTO players (id, recovery_hash, created_at) VALUES (?, ?, ?)')
      .bind(playerId, await sha256(normalizeCode(recoveryCode)), now).run();
    return json({playerId, recoveryCode, token: await issueDevice(db, playerId, now)}, 201);
  }
  if (path === 'login' && method === 'POST') {
    const code = normalizeCode((await readBody(request)).recoveryCode);
    if (code.length !== 16) return fail(400, 'bad-code');
    const player = await db.prepare('SELECT id FROM players WHERE recovery_hash = ?').bind(await sha256(code)).first();
    if (!player) return fail(404, 'unknown-code');
    return json({playerId: player.id, token: await issueDevice(db, player.id, now)});
  }

  const auth = await authenticate(request, db, now);
  if (!auth) return fail(401, 'signed-out');

  if (path === 'recovery' && method === 'POST') {
    // A new code replaces the old one. Devices that are already signed in stay signed in.
    const recoveryCode = randomCode(4);
    await db.prepare('UPDATE players SET recovery_hash = ? WHERE id = ?').bind(await sha256(normalizeCode(recoveryCode)), auth.playerId).run();
    return json({playerId: auth.playerId, recoveryCode});
  }
  if (path === 'logout' && method === 'POST') {
    await db.prepare('DELETE FROM devices WHERE token_hash = ?').bind(auth.tokenHash).run();
    return json({ok: true});
  }
  if (path === 'save' && method === 'GET') {
    const row = await db.prepare('SELECT rev, saved_at, data FROM saves WHERE player_id = ?').bind(auth.playerId).first();
    return json({playerId: auth.playerId, rev: row ? row.rev : 0, savedAt: row ? row.saved_at : null, bundle: row ? JSON.parse(row.data) : null});
  }
  if (path === 'save' && method === 'PUT') {
    const body = await readBody(request);
    if (!Number.isSafeInteger(body.baseRev) || body.baseRev < 0 || !validBundle(body.bundle)) return fail(400, 'bad-save');
    const data = JSON.stringify(body.bundle);
    if (data.length > MAX_BUNDLE) return fail(413, 'too-large');
    // Compare-and-swap: the write only lands if nobody uploaded since this device last synced.
    const row = await db.prepare(
      'INSERT INTO saves (player_id, rev, saved_at, data) VALUES (?1, ?2 + 1, ?3, ?4) ' +
      'ON CONFLICT (player_id) DO UPDATE SET rev = saves.rev + 1, saved_at = excluded.saved_at, data = excluded.data ' +
      'WHERE saves.rev = ?2 RETURNING rev, saved_at')
      .bind(auth.playerId, body.baseRev, now, data).first();
    if (row) return json({rev: row.rev, savedAt: row.saved_at});
    const current = await db.prepare('SELECT rev, saved_at, data FROM saves WHERE player_id = ?').bind(auth.playerId).first();
    return json({error: 'conflict', rev: current.rev, savedAt: current.saved_at, bundle: JSON.parse(current.data)}, 409);
  }

  // 1.13 server wallet. GET answers wallet: null until the device sends its local progress once (seed).
  if (path === 'wallet' && method === 'GET') {
    const wallet = await getWallet(db, auth.playerId);
    return json({playerId: auth.playerId, wallet: wallet?.seeded ? publicView(wallet) : null});
  }
  if (path === 'wallet/seed' && method === 'POST') {
    const outcome = await seed(db, auth.playerId, await readBody(request), now);
    if (!outcome.applied && outcome.error !== 'already-seeded' && !outcome.duplicate) return fail(outcome.error === 'busy' ? 503 : 400, outcome.error);
    return json({playerId: auth.playerId, wallet: publicView(await getWallet(db, auth.playerId))});
  }
  if (path === 'wallet/run' && method === 'POST') {
    const outcome = await startRun(db, auth.playerId, (await readBody(request)).stage, now);
    return outcome.error ? fail(outcome.error === 'rate-limited' ? 429 : 409, outcome.error) : json(outcome);
  }
  if (path === 'wallet/ops' && method === 'POST') {
    const ops = (await readBody(request)).ops;
    if (!Array.isArray(ops) || ops.length > 50) return fail(400, 'bad-ops');
    // In order: a later action may depend on an earlier one (a win pays for a level-up).
    const results = [];
    for (const op of ops) results.push(await applyOp(db, auth.playerId, op, now));
    const wallet = await getWallet(db, auth.playerId);
    return json({results, wallet: wallet?.seeded ? publicView(wallet) : null});
  }
  return fail(404, 'not-found');
}

export async function onRequest(context) {
  const {request, env, params} = context;
  const path = [].concat(params.path || []).join('/');
  // Same-origin only: the game never calls this API from another site.
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return fail(403, 'cross-origin');
  try { return await route(request, env, path); }
  catch (error) { return fail(error.status || 500, error.status ? error.message : 'server-error'); }
}
