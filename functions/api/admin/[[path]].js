// Little Rescue admin API (1.16), used by game/admin.html. Same origin as the game, nothing about hosting changes.
// Needs the cloud-save D1 binding SAVES_DB and a secret ADMIN_KEY (at least 24 characters) set in Cloudflare.
// Without ADMIN_KEY every route answers 503, so the admin page is closed until the owner turns it on.
//
// Every request must send "Authorization: Bearer <ADMIN_KEY>". After 10 wrong keys from one IP in 15 minutes
// that IP gets 429 until the window passes. Every change, and every look at a player's save, goes into admin_log.
import {json, fail, readBody, sha256} from '../../_lib/http.js';
import {getWallet, publicView} from '../../_lib/wallet.js';
import {UNIT_IDS, BASE_HEROES} from '../../_lib/economy.js';
import {sameOrigin, setupLive, maintenance, LIMITS} from '../../_lib/live.js';

const PLAYER_ID = /^LR-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/;
const DAY = 864e5;

// Compare hashes so the time taken says nothing about the key, not even its length.
async function sameSecret(given, expected) {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
const clientIp = request => request.headers.get('CF-Connecting-IP') || 'local';

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const whole = (value, lo, hi) => Number.isSafeInteger(value) && value >= lo && value <= hi ? value : null;

// The save bundle is whatever the game uploaded; read it defensively for the summary.
function saveSummary(data) {
  let bundle = null;
  try { bundle = JSON.parse(data); } catch { return null; }
  const save = bundle?.transfer?.save || {}, meta = bundle?.meta || {}, units = bundle?.summon?.units || {};
  return {
    coins: save.progress?.coins ?? null, cookies: save.energy?.value ?? null, rescued: save.progress?.rescued ?? null,
    cleared: meta.cleared ?? null, stage: meta.stage ?? null, levels: Array.isArray(meta.levels) ? meta.levels : [],
    stars: Object.fromEntries(Object.entries(units).map(([id, u]) => [id, u?.star ?? 0])),
    loginStreak: bundle?.daily?.login?.streak ?? null, exportedAt: bundle?.transfer?.exportedAt ?? null
  };
}

async function log(db, request, action, target, detail) {
  await db.prepare('INSERT INTO admin_log (at, action, target, detail, ip) VALUES (?, ?, ?, ?, ?)')
    .bind(Date.now(), action, target || null, detail ? JSON.stringify(detail) : null, clientIp(request)).run();
}

async function findPlayer(db, query) {
  const q = query.trim().toUpperCase();
  if (PLAYER_ID.test(q)) return db.prepare('SELECT id, created_at FROM players WHERE id = ?').bind(q).first();
  const code = q.replace(/[^0-9A-Z]/g, '');
  if (code.length === 16) return db.prepare('SELECT id, created_at FROM players WHERE recovery_hash = ?').bind(await sha256(code)).first();
  return null;
}

async function playerDetail(db, id, now) {
  const [player, devices, save, claims, gifts] = await db.batch([
    db.prepare('SELECT id, created_at FROM players WHERE id = ?').bind(id),
    db.prepare('SELECT COUNT(*) AS devices, MAX(last_seen) AS last_seen FROM devices WHERE player_id = ?').bind(id),
    db.prepare('SELECT rev, saved_at, data FROM saves WHERE player_id = ?').bind(id),
    db.prepare(`SELECT c.gift_id, c.claimed_at, g.title, g.coins, g.cookies FROM gift_claims c LEFT JOIN gifts g ON g.id = c.gift_id
      WHERE c.player_id = ? ORDER BY c.claimed_at DESC LIMIT 30`).bind(id),
    db.prepare(`SELECT g.id, g.title, g.coins, g.cookies, g.expires_at, g.player_id IS NULL AS everyone FROM gifts g
      WHERE (g.player_id = ?1 OR g.player_id IS NULL) AND g.revoked_at IS NULL AND g.expires_at > ?2
      AND NOT EXISTS (SELECT 1 FROM gift_claims c WHERE c.gift_id = g.id AND c.player_id = ?1) ORDER BY g.id DESC LIMIT 30`).bind(id, now)
  ]);
  const p = player.results[0];
  if (!p) return null;
  const s = save.results[0], wallet = await getWallet(db, id);
  const ledger = wallet ? (await db.prepare('SELECT op_id, kind, coins, gems, fp, balance, at FROM ledger WHERE player_id = ? ORDER BY seq DESC LIMIT 30').bind(id).all()).results : [];
  return {
    // The server wallet (1.13+) holds the real coins; the save bundle below is the device's own copy.
    wallet: wallet ? publicView(wallet) : null, ledger,
    // One row per hero (5 starters + sticker heroes unlocked with coins or summons, 1.14.1).
    heroes: wallet ? UNIT_IDS.map((unit, i) => ({unit, level: wallet.levels[i] ?? 1, star: wallet.units[unit]?.star ?? 1,
      owned: i < BASE_HEROES || wallet.units[unit]?.owned === true})) : [],
    id: p.id, createdAt: p.created_at, devices: devices.results[0].devices, lastSeen: devices.results[0].last_seen,
    save: s ? {rev: s.rev, savedAt: s.saved_at, size: s.data.length, summary: saveSummary(s.data), bundle: JSON.parse(s.data)} : null,
    claimed: claims.results, waiting: gifts.results
  };
}

async function route(request, env, path) {
  const db = env.SAVES_DB, now = Date.now(), method = request.method, ip = clientIp(request);
  if (!env.ADMIN_KEY || env.ADMIN_KEY.length < 24) return fail(503, 'no-admin-key');
  if (!db) return fail(503, 'no-db');
  await setupLive(db);

  const fails = await db.prepare('SELECT COUNT(*) AS n FROM admin_fails WHERE ip = ? AND at > ?').bind(ip, now - 15 * 60e3).first();
  if (fails.n >= 10) return fail(429, 'too-many-tries');
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ') || !(await sameSecret(header.slice(7), env.ADMIN_KEY))) {
    await db.batch([
      db.prepare('INSERT INTO admin_fails (ip, at) VALUES (?, ?)').bind(ip, now),
      db.prepare('DELETE FROM admin_fails WHERE at < ?').bind(now - DAY)
    ]);
    return fail(401, 'wrong-key');
  }
  // Players and saves tables belong to the cloud-save API and may not exist until the first account is made.
  const hasPlayers = Boolean(await db.prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'players'").first());

  if (path === 'overview' && method === 'GET') {
    const counts = hasPlayers ? (await db.batch([
      db.prepare('SELECT COUNT(*) AS n FROM players'),
      db.prepare('SELECT COUNT(*) AS n FROM players WHERE created_at > ?').bind(now - 7 * DAY),
      db.prepare('SELECT COUNT(DISTINCT player_id) AS n FROM devices WHERE last_seen > ?').bind(now - 7 * DAY),
      db.prepare('SELECT COUNT(*) AS n FROM saves')
    ])).map(r => r.results[0].n) : [0, 0, 0, 0];
    const [gifts, events] = await db.batch([
      db.prepare('SELECT COUNT(*) AS n FROM gifts WHERE revoked_at IS NULL AND expires_at > ?').bind(now),
      db.prepare('SELECT COUNT(*) AS n FROM live_events WHERE ends_at > ?').bind(now)
    ]);
    return json({now, players: counts[0], newPlayers7d: counts[1], active7d: counts[2], saves: counts[3],
      openGifts: gifts.results[0].n, events: events.results[0].n, maintenance: await maintenance(db), stats: Boolean(env.STATS_KEY)});
  }

  if (path === 'players' && method === 'GET') {
    if (!hasPlayers) return json({players: []});
    const q = new URL(request.url).searchParams.get('q') || '';
    if (q) {
      const found = await findPlayer(db, q);
      // A recovery code is a password: never log it, only who it pointed to.
      await log(db, request, 'search', found ? found.id : null, {by: PLAYER_ID.test(q.trim().toUpperCase()) ? 'id' : 'code', found: Boolean(found)});
      return json({players: found ? [found] : []});
    }
    const rows = await db.prepare(`SELECT p.id, p.created_at, s.saved_at, s.rev FROM players p LEFT JOIN saves s ON s.player_id = p.id
      ORDER BY COALESCE(s.saved_at, p.created_at) DESC LIMIT 50`).all();
    return json({players: rows.results});
  }

  const playerMatch = path.match(/^players\/(LR-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4})$/);
  if (playerMatch && method === 'GET') {
    if (!hasPlayers) return fail(404, 'no-player');
    const detail = await playerDetail(db, playerMatch[1], now);
    if (!detail) return fail(404, 'no-player');
    await log(db, request, 'view-player', detail.id, null);
    return json(detail);
  }

  if (path === 'gifts' && method === 'GET') {
    const rows = await db.prepare(`SELECT g.*, (SELECT COUNT(*) FROM gift_claims c WHERE c.gift_id = g.id) AS claims
      FROM gifts g ORDER BY g.id DESC LIMIT 100`).all();
    return json({gifts: rows.results});
  }
  if (path === 'gifts' && method === 'POST') {
    const body = await readBody(request, 8192);
    const to = text(body.to, 20).toUpperCase(), title = text(body.title, LIMITS.title), message = text(body.message, LIMITS.message);
    const coins = whole(body.coins, 0, LIMITS.coins), cookies = whole(body.cookies, 0, LIMITS.cookies), days = whole(body.days, 1, LIMITS.giftDays);
    if (!title || coins === null || cookies === null || days === null || coins + cookies === 0) return fail(400, 'bad-gift');
    if (to !== 'ALL' && !PLAYER_ID.test(to)) return fail(400, 'bad-target');
    if (to !== 'ALL' && !(hasPlayers && await db.prepare('SELECT 1 AS x FROM players WHERE id = ?').bind(to).first())) return fail(404, 'no-player');
    const row = await db.prepare(`INSERT INTO gifts (player_id, title, message, coins, cookies, starts_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(to === 'ALL' ? null : to, title, message, coins, cookies, now, now + days * DAY, now).first();
    await log(db, request, 'gift', to === 'ALL' ? 'ALL' : to, {gift: row.id, title, coins, cookies, days});
    return json({id: row.id}, 201);
  }
  const revokeMatch = path.match(/^gifts\/(\d{1,9})\/revoke$/);
  if (revokeMatch && method === 'POST') {
    const id = Number(revokeMatch[1]);
    const row = await db.prepare('UPDATE gifts SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL RETURNING id').bind(now, id).first();
    if (!row) return fail(404, 'no-gift');
    await log(db, request, 'gift-revoke', String(id), null);
    return json({ok: true});
  }

  if (path === 'events' && method === 'GET') {
    const rows = await db.prepare('SELECT * FROM live_events ORDER BY ends_at DESC LIMIT 50').all();
    return json({now, events: rows.results});
  }
  if (path === 'events' && method === 'POST') {
    const body = await readBody(request, 8192);
    const title = text(body.title, LIMITS.title), message = text(body.message, LIMITS.message), icon = text(body.icon, 8) || '🎉';
    const bonus = LIMITS.bonus.includes(body.coinBonus) ? body.coinBonus : null;
    const startsAt = whole(body.startsAt, now - DAY, now + 365 * DAY), endsAt = whole(body.endsAt, now, now + 400 * DAY);
    if (!title || bonus === null || startsAt === null || endsAt === null || endsAt <= startsAt || endsAt - startsAt > LIMITS.eventDays * DAY) return fail(400, 'bad-event');
    const row = await db.prepare(`INSERT INTO live_events (title, message, icon, coin_bonus, starts_at, ends_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(title, message, icon, bonus, startsAt, endsAt, now).first();
    await log(db, request, 'event', String(row.id), {title, coinBonus: bonus, startsAt, endsAt});
    return json({id: row.id}, 201);
  }
  const endMatch = path.match(/^events\/(\d{1,9})\/end$/);
  if (endMatch && method === 'POST') {
    const id = Number(endMatch[1]);
    const row = await db.prepare('UPDATE live_events SET ends_at = ?1, starts_at = MIN(starts_at, ?1) WHERE id = ?2 AND ends_at > ?1 RETURNING id').bind(now, id).first();
    if (!row) return fail(404, 'no-event');
    await log(db, request, 'event-end', String(id), null);
    return json({ok: true});
  }

  if (path === 'maintenance' && method === 'PUT') {
    const body = await readBody(request, 8192);
    if (typeof body.on !== 'boolean') return fail(400, 'bad-maintenance');
    const value = {on: body.on, message: text(body.message, LIMITS.message)};
    await db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES ('maintenance', ?1, ?2)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(JSON.stringify(value), now).run();
    await log(db, request, 'maintenance', null, value);
    return json(await maintenance(db));
  }

  if (path === 'log' && method === 'GET') {
    const rows = await db.prepare('SELECT * FROM admin_log ORDER BY id DESC LIMIT 100').all();
    return json({log: rows.results});
  }
  return fail(404, 'not-found');
}

export async function onRequest({request, env, params}) {
  if (!sameOrigin(request)) return fail(403, 'cross-origin');
  const path = [].concat(params.path || []).join('/');
  try { return await route(request, env, path); }
  catch (error) { console.log('admin failed', String(error)); return fail(error.status || 500, error.status ? error.message : 'server-error'); }
}
