// Live operations (1.16) shared by the player endpoints (functions/api/live.js, functions/api/gifts.js) and the
// admin API (functions/api/admin/[[path]].js): gift box, time-limited events, maintenance notice, admin log.
// Everything lives in the cloud-save database (SAVES_DB) next to the players table. Tables are created on first use.
// functions/_lib/ is bundled into the endpoints that import it; it has no request handlers, so it is never a route.

import {json, fail, ensureSchema} from './http.js';
import {apply, publicView} from './wallet.js';

export const LIVE_SCHEMA = [
  // player_id NULL = a gift for everyone (every account, including ones created while the gift is still open).
  `CREATE TABLE IF NOT EXISTS gifts (id INTEGER PRIMARY KEY, player_id TEXT, title TEXT NOT NULL, message TEXT NOT NULL,
    coins INTEGER NOT NULL, cookies INTEGER NOT NULL, starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL, revoked_at INTEGER)`,
  'CREATE INDEX IF NOT EXISTS gifts_player ON gifts (player_id, expires_at)',
  'CREATE TABLE IF NOT EXISTS gift_claims (gift_id INTEGER NOT NULL, player_id TEXT NOT NULL, claimed_at INTEGER NOT NULL, PRIMARY KEY (gift_id, player_id))',
  'CREATE INDEX IF NOT EXISTS gift_claims_player ON gift_claims (player_id)',
  // coin_bonus is a percentage added to stage win coins while the event runs (0 = banner only).
  `CREATE TABLE IF NOT EXISTS live_events (id INTEGER PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, icon TEXT NOT NULL,
    coin_bonus INTEGER NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL, created_at INTEGER NOT NULL)`,
  'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS admin_log (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, action TEXT NOT NULL, target TEXT, detail TEXT, ip TEXT)',
  'CREATE TABLE IF NOT EXISTS admin_fails (ip TEXT NOT NULL, at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS admin_fails_ip ON admin_fails (ip, at)'
];
export const setupLive = db => ensureSchema(db, 'live', LIVE_SCHEMA);
export {json, fail};

export const sameOrigin = request => {
  const origin = request.headers.get('Origin');
  return !origin || origin === new URL(request.url).origin;
};

export const LIMITS = {coins: 10000, cookies: 100, title: 60, message: 300, giftDays: 60, eventDays: 60, bonus: [0, 50, 100, 200]};

export async function maintenance(db) {
  const row = await db.prepare("SELECT value, updated_at FROM settings WHERE key = 'maintenance'").first();
  let value = {};
  try { value = row ? JSON.parse(row.value) : {}; } catch { value = {}; }
  return {on: value.on === true, message: typeof value.message === 'string' ? value.message : '', updatedAt: row ? row.updated_at : null};
}

const eventView = e => ({id: e.id, title: e.title, message: e.message, icon: e.icon, coinBonus: e.coin_bonus, startsAt: e.starts_at, endsAt: e.ends_at});
const giftView = g => ({id: g.id, title: g.title, message: g.message, coins: g.coins, cookies: g.cookies, expiresAt: g.expires_at, everyone: g.player_id === null});

// Public, no sign-in: what the lobby shows to everyone.
export async function liveStatus(db, now) {
  await setupLive(db);
  const [notice, events] = await Promise.all([
    maintenance(db),
    db.prepare('SELECT * FROM live_events WHERE starts_at <= ?1 AND ends_at > ?1 ORDER BY coin_bonus DESC, ends_at LIMIT 5').bind(now).all()
  ]);
  return {now, maintenance: {on: notice.on, message: notice.message}, events: events.results.map(eventView)};
}

const OPEN_GIFT = '(g.player_id = ?1 OR g.player_id IS NULL) AND g.revoked_at IS NULL AND g.starts_at <= ?2 AND g.expires_at > ?2 ' +
  'AND NOT EXISTS (SELECT 1 FROM gift_claims c WHERE c.gift_id = g.id AND c.player_id = ?1)';

export async function openGifts(db, playerId, now) {
  await setupLive(db);
  const rows = await db.prepare(`SELECT g.* FROM gifts g WHERE ${OPEN_GIFT} ORDER BY g.id DESC LIMIT 50`).bind(playerId, now).all();
  return rows.results.map(giftView);
}

// Coins go into the server wallet (wallet.js) in one atomic batch with the claim row; the ledger ref
// 'gift:<giftId>:<playerId>' makes a second claim impossible, even from two devices at once. Cookies (entry energy)
// are not a wallet currency, so the game adds those to the local save itself (paid: 'wallet', cookies: n).
export async function claimGift(db, playerId, giftId, now) {
  await setupLive(db);
  if ((await maintenance(db)).on) return {status: 503, error: 'maintenance'};
  const gift = await db.prepare(`SELECT g.* FROM gifts g WHERE g.id = ?3 AND ${OPEN_GIFT}`).bind(playerId, now, giftId).first();
  if (!gift) {
    const taken = await db.prepare('SELECT 1 AS x FROM gift_claims WHERE gift_id = ? AND player_id = ?').bind(giftId, playerId).first();
    return {status: taken ? 409 : 404, error: taken ? 'already-claimed' : 'no-gift'};
  }
  const out = await apply(db, playerId, {ref: `gift:${giftId}:${playerId}`, kind: 'gift', now}, w => {
    w.coins += gift.coins;
    return {detail: {gift: giftId, cookies: gift.cookies},
      statements: [db.prepare('INSERT OR IGNORE INTO gift_claims (gift_id, player_id, claimed_at) VALUES (?, ?, ?)').bind(giftId, playerId, now)]};
  });
  if (out.duplicate) return {status: 409, error: 'already-claimed'};
  if (!out.applied) return {status: out.error === 'busy' ? 503 : 500, error: out.error || 'server-error'};
  return {status: 200, gift: giftView(gift), paid: 'wallet', wallet: out.wallet.seeded ? publicView(out.wallet) : null};
}

// Highest coin bonus (%) of the events running at `at`; play.js adds it to a win so the wallet matches the game.
export async function eventBonus(db, at) {
  await setupLive(db);
  const row = await db.prepare('SELECT MAX(coin_bonus) AS bonus FROM live_events WHERE starts_at <= ?1 AND ends_at > ?1').bind(at).first();
  return row?.bonus || 0;
}
