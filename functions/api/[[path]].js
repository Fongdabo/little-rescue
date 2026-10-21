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

const MAX_BUNDLE = 32 * 1024;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, recovery_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS devices (token_hash TEXT PRIMARY KEY, player_id TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS devices_player ON devices (player_id)',
  'CREATE TABLE IF NOT EXISTS saves (player_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, saved_at INTEGER NOT NULL, data TEXT NOT NULL)'
];
let schemaReady = null;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
});
const fail = (status, error) => json({error}, status);

function randomCode(groups) {
  const bytes = crypto.getRandomValues(new Uint8Array(groups * 4));
  const chars = Array.from(bytes, b => CODE_ALPHABET[b & 31]).join(''); // 32 symbols: no modulo bias
  return chars.match(/.{4}/g).join('-');
}
function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
const normalizeCode = value => typeof value === 'string' ? value.toUpperCase().replace(/[^0-9A-Z]/g, '') : '';

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BUNDLE + 1024) throw Object.assign(new Error('too-large'), {status: 413});
  try { const value = JSON.parse(text || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) return value; }
  catch (_) { /* fall through */ }
  throw Object.assign(new Error('bad-json'), {status: 400});
}

async function issueDevice(db, playerId, now) {
  const token = randomToken();
  await db.prepare('INSERT INTO devices (token_hash, player_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), playerId, now, now).run();
  return token;
}

async function authenticate(request, db, now) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return null;
  const hash = await sha256(token);
  const row = await db.prepare('SELECT player_id, last_seen FROM devices WHERE token_hash = ?').bind(hash).first();
  if (!row) return null;
  // last_seen is only for cleaning up dead devices later; one write per hour is enough.
  if (now - row.last_seen > 3600000) await db.prepare('UPDATE devices SET last_seen = ? WHERE token_hash = ?').bind(now, hash).run();
  return {playerId: row.player_id, tokenHash: hash};
}

function validBundle(bundle) {
  return bundle && typeof bundle === 'object' && !Array.isArray(bundle) &&
    bundle.format === 'little-rescue-cloud' && bundle.formatVersion === 1 &&
    bundle.transfer && typeof bundle.transfer === 'object' && bundle.meta && typeof bundle.meta === 'object';
}

async function route(request, env, path) {
  const db = env.SAVES_DB, now = Date.now(), method = request.method;
  if (path === 'health' && method === 'GET') return json({ok: true, cloud: Boolean(db)});
  if (!db) return fail(503, 'cloud-not-configured');
  schemaReady = schemaReady || db.batch(SCHEMA.map(sql => db.prepare(sql))).catch(error => { schemaReady = null; throw error; });
  await schemaReady;

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
