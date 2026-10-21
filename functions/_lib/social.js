// Little Rescue friends and guilds (1.13): what /api/friends/* and /api/guilds/* share.
// Both use the cloud account (same D1 binding SAVES_DB, same device token); no binding = 503, like the cloud save.
//
// Friendship points (F) live in the server wallet (wallet.js) and are earned only through award() below, which keeps
// every friend source together under one daily cap. The game shows the balance and never sends one.
// The helper hero (unit, level, star) and progress on a profile come from the player's own device; friends see them
// and borrow that hero for one battle, nothing pays out from them.

import {json, fail, readBody, authenticate, ensureSchema} from './http.js';
import {credit, getWallet, ensureWallet} from './wallet.js';

export const RULES = {
  maxFriends: 50, maxPending: 30, dailyCap: 300, // F per Thai calendar day, from every friend/guild source together
  sendSelf: 5, sendGift: 10, helperOwner: 10, helperBorrower: 10, guildCheckin: 10,
  guildMax: 30, nameMax: 16, noticeMax: 80, units: 64, levelMax: 10, starMax: 5
};
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS profiles (player_id TEXT PRIMARY KEY, name TEXT NOT NULL, helper TEXT, cleared INTEGER NOT NULL DEFAULT 0, ' +
    'created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)',
  // Two rows per pair, one from each side: state 'out' (I asked), 'in' (they asked) or 'friend'.
  'CREATE TABLE IF NOT EXISTS friend_links (player_id TEXT NOT NULL, friend_id TEXT NOT NULL, state TEXT NOT NULL, ' +
    'created_at INTEGER NOT NULL, PRIMARY KEY (player_id, friend_id))',
  'CREATE TABLE IF NOT EXISTS friend_gifts (from_id TEXT NOT NULL, to_id TEXT NOT NULL, day INTEGER NOT NULL, ' +
    'claimed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (from_id, to_id, day))',
  'CREATE INDEX IF NOT EXISTS friend_gifts_to ON friend_gifts (to_id, claimed)',
  'CREATE TABLE IF NOT EXISTS helper_uses (player_id TEXT NOT NULL, friend_id TEXT NOT NULL, day INTEGER NOT NULL, ' +
    'PRIMARY KEY (player_id, friend_id, day))',
  "CREATE TABLE IF NOT EXISTS guilds (id TEXT PRIMARY KEY, name TEXT NOT NULL, leader_id TEXT NOT NULL, notice TEXT NOT NULL DEFAULT '', " +
    'created_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS guild_members (player_id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, joined_at INTEGER NOT NULL, ' +
    'checkin_day INTEGER NOT NULL DEFAULT 0)',
  'CREATE INDEX IF NOT EXISTS guild_members_guild ON guild_members (guild_id)'
];

// Days roll over at midnight in Thailand (UTC+7), like the daily missions.
const THAI = 7 * 3600000, DAY = 86400000;
export const thaiDay = now => Math.floor((now + THAI) / DAY);
const dayStart = day => day * DAY - THAI;
const CODE = /^[2-9A-HJ-NP-Z]{8}$/; // the cloud account alphabet: no 0/O/1/I
function code(prefix, value) {
  const raw = typeof value === 'string' ? value.toUpperCase().replace(/[^0-9A-Z]/g, '') : '';
  const body = raw.length === 8 + prefix.length && raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  return CODE.test(body) ? `${prefix}-${body.slice(0, 4)}-${body.slice(4)}` : '';
}
export const playerCode = value => code('LR', value);
export const guildCode = value => code('G', value);
export function newGuildCode() {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(8)), b => alphabet[b & 31]).join(''); // 32 symbols: no modulo bias
  return `G-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

// Names and notices: printable text only, no markup or direction-override characters, at most max code points.
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const text = value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩<>]/g, '')
    .replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, max).join('').trim();
}
export function cleanHelper(value) {
  if (!value || typeof value !== 'object') return null;
  const {unit, level, star} = value;
  if (!Number.isInteger(unit) || unit < 0 || unit >= RULES.units) return null;
  if (!Number.isInteger(level) || level < 1 || level > RULES.levelMax) return null;
  if (!Number.isInteger(star) || star < 1 || star > RULES.starMax) return null;
  return {unit, level, star};
}
export const parseHelper = text => { try { return cleanHelper(JSON.parse(text || 'null')); } catch (_) { return null; } };

// F earned today from friends and guilds, read back from the wallet ledger.
export const earnedToday = async (db, playerId, day) => (await db.prepare(
  "SELECT COALESCE(SUM(fp), 0) AS n FROM ledger WHERE player_id = ? AND kind = 'friend' AND at >= ?").bind(playerId, dayStart(day)).first('n')) || 0;

// The one place friendship points are earned. ref makes a repeat of the same event a no-op in the wallet.
// Returns how many F were added after the daily cap.
export async function award(db, playerId, amount, ref, detail, day) {
  const room = Math.max(0, RULES.dailyCap - await earnedToday(db, playerId, day));
  const fp = Math.min(amount, room);
  if (fp <= 0) return 0;
  const result = await credit(db, playerId, {fp}, {kind: 'friend', ref, detail});
  return result && result.applied ? fp : 0;
}

export async function ensureProfile(db, playerId, now) {
  await db.prepare('INSERT INTO profiles (player_id, name, created_at, last_seen) VALUES (?1, ?2, ?3, ?3) ON CONFLICT (player_id) DO NOTHING')
    .bind(playerId, 'ผู้เล่น ' + playerId.slice(-4), now).run();
}

export async function me(db, playerId, now) {
  const day = thaiDay(now);
  await db.prepare('UPDATE profiles SET last_seen = ? WHERE player_id = ?').bind(now, playerId).run();
  const [profile, wallet, today] = await Promise.all([
    db.prepare('SELECT name, helper, cleared FROM profiles WHERE player_id = ?').bind(playerId).first(),
    getWallet(db, playerId), earnedToday(db, playerId, day)]);
  return {id: playerId, name: profile.name, helper: parseHelper(profile.helper), cleared: profile.cleared,
    fp: Number(wallet?.fp) || 0, fpToday: today, day};
}

// Shared request handling: same-origin check, schema, sign-in, profile row, JSON body.
export function handler(route) {
  return async function onRequest(context) {
    const {request, env, params} = context;
    const path = [].concat(params.path || []).join('/');
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return fail(403, 'cross-origin');
    try {
      const db = env.SAVES_DB, now = Date.now();
      if (!db) return fail(503, 'cloud-not-configured');
      const auth = await authenticate(request, db, now);
      if (!auth) return fail(401, 'signed-out');
      await Promise.all([ensureSchema(db, 'social', SCHEMA), ensureWallet(db)]);
      await ensureProfile(db, auth.playerId, now);
      const body = request.method === 'POST' || request.method === 'PUT' ? await readBody(request) : {};
      return await route({db, now, day: thaiDay(now), me: auth.playerId, body, method: request.method, path});
    } catch (error) { return fail(error.status || 500, error.status ? error.message : 'server-error'); }
  };
}
export {json, fail};
