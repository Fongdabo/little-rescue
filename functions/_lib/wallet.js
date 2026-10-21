// Server wallet (1.13). For a player with a cloud account the server, not the browser, holds the real balances:
// coins, gems (shop), fp (friend points) and the progress coins buy (hero levels, stars, shards, stages cleared).
// Not a route: this file exports no onRequest handler. Other features call credit/debit; game actions go through
// play.js. Tables live in SAVES_DB and are created on first use.
//
// Every change is one row in `ledger`, keyed by a caller-chosen ref (op_id), so retrying a request never pays or
// charges twice. Writes are compare-and-swap on wallets.rev inside one db.batch: the ledger row carries
// seq = the new rev and (player_id, seq) is UNIQUE, so if another write got there first the whole batch rolls back
// and the change is recomputed from fresh data.

import {ensureSchema} from './http.js';
import {UNIT_IDS, LEVELS, STARS, MAX_COINS, MAX_SHARDS} from './economy.js';

export const WALLET_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS wallets (player_id TEXT PRIMARY KEY, rev INTEGER NOT NULL, coins INTEGER NOT NULL DEFAULT 0, ' +
    'gems INTEGER NOT NULL DEFAULT 0, fp INTEGER NOT NULL DEFAULT 0, cleared INTEGER NOT NULL DEFAULT 0, levels TEXT NOT NULL, ' +
    'units TEXT NOT NULL, since_legend INTEGER NOT NULL DEFAULT 0, pulls INTEGER NOT NULL DEFAULT 0, free_day TEXT NOT NULL DEFAULT \'\', ' +
    'login TEXT NOT NULL, days TEXT NOT NULL, seeded INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS ledger (op_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, ' +
    'coins INTEGER NOT NULL DEFAULT 0, gems INTEGER NOT NULL DEFAULT 0, fp INTEGER NOT NULL DEFAULT 0, balance INTEGER NOT NULL, ' +
    'detail TEXT, at INTEGER NOT NULL, UNIQUE (player_id, seq))',
  'CREATE INDEX IF NOT EXISTS ledger_player_at ON ledger (player_id, at)',
  'CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, stage INTEGER NOT NULL, started_at INTEGER NOT NULL, claimed_at INTEGER)',
  'CREATE INDEX IF NOT EXISTS runs_player ON runs (player_id, started_at)'
];
export const ensureWallet = db => ensureSchema(db, 'wallet', WALLET_SCHEMA);

const parse = (text, fallback) => { try { const v = JSON.parse(text); return v ?? fallback; } catch (_) { return fallback; } };
const emptyUnits = () => Object.fromEntries(UNIT_IDS.map(id => [id, {star: 1, shards: 0}]));

function fromRow(row, playerId) {
  if (!row) return {playerId, rev: 0, coins: 0, gems: 0, fp: 0, cleared: 0, levels: UNIT_IDS.map(() => 1), units: emptyUnits(),
    sinceLegend: 0, pulls: 0, freeDay: '', login: {streak: 0, lastDay: ''}, days: {}, seeded: false};
  const units = {...emptyUnits(), ...parse(row.units, {})};
  // Wallets from before the sticker heroes hold 5 levels; the new heroes start at Lv 1.
  const levels = parse(row.levels, []);
  while (levels.length < UNIT_IDS.length) levels.push(1);
  return {playerId, rev: row.rev, coins: row.coins, gems: row.gems, fp: row.fp, cleared: row.cleared,
    levels, units, sinceLegend: row.since_legend, pulls: row.pulls,
    freeDay: row.free_day, login: parse(row.login, {streak: 0, lastDay: ''}), days: parse(row.days, {}), seeded: row.seeded === 1};
}

// The wallet, or null when this player has never had one.
export async function getWallet(db, playerId) {
  await ensureWallet(db);
  const row = await db.prepare('SELECT * FROM wallets WHERE player_id = ?').bind(playerId).first();
  return row ? fromRow(row, playerId) : null;
}

// What the game client receives.
export const publicView = w => ({rev: w.rev, seeded: w.seeded, coins: w.coins, gems: w.gems, fp: w.fp, cleared: w.cleared,
  levels: w.levels, units: w.units, sinceLegend: w.sinceLegend, pulls: w.pulls, freeDay: w.freeDay, login: w.login});

function valid(w) {
  const count = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
  return count(w.coins, MAX_COINS) && count(w.gems, MAX_COINS) && count(w.fp, MAX_COINS) && count(w.cleared, 99) &&
    Array.isArray(w.levels) && w.levels.length === UNIT_IDS.length && w.levels.every(l => Number.isInteger(l) && l >= 1 && l <= LEVELS.max) &&
    UNIT_IDS.every(id => w.units[id] && Number.isInteger(w.units[id].star) && w.units[id].star >= 1 && w.units[id].star <= STARS.max &&
      count(w.units[id].shards, MAX_SHARDS));
}

// change(w) edits the wallet copy in place and returns an error string, or {detail, result, statements}.
// result is stored with the ledger row and returned again for a duplicate ref.
export async function apply(db, playerId, {ref, kind, now = Date.now()}, change) {
  await ensureWallet(db);
  if (typeof ref !== 'string' || !ref || ref.length > 200) return {applied: false, error: 'bad-ref'};
  for (let attempt = 0; attempt < 5; attempt++) {
    const done = await db.prepare('SELECT detail FROM ledger WHERE op_id = ?').bind(ref).first();
    if (done) return {applied: false, duplicate: true, result: parse(done.detail, {})?.result ?? null, wallet: await getWallet(db, playerId)};
    const row = await db.prepare('SELECT * FROM wallets WHERE player_id = ?').bind(playerId).first();
    const before = fromRow(row, playerId), w = structuredClone(before);
    const outcome = await change(w);
    if (typeof outcome === 'string') return {applied: false, error: outcome, wallet: before};
    if (!valid(w)) return {applied: false, error: 'out-of-range', wallet: before};
    const rev = before.rev + 1, cols = [w.coins, w.gems, w.fp, w.cleared, JSON.stringify(w.levels), JSON.stringify(w.units),
      w.sinceLegend, w.pulls, w.freeDay, JSON.stringify(w.login), JSON.stringify(w.days), w.seeded ? 1 : 0, now];
    const write = row
      ? db.prepare('UPDATE wallets SET rev = ?, coins = ?, gems = ?, fp = ?, cleared = ?, levels = ?, units = ?, since_legend = ?, pulls = ?, ' +
          'free_day = ?, login = ?, days = ?, seeded = ?, updated_at = ? WHERE player_id = ? AND rev = ?').bind(rev, ...cols, playerId, before.rev)
      : db.prepare('INSERT INTO wallets (rev, coins, gems, fp, cleared, levels, units, since_legend, pulls, free_day, login, days, seeded, ' +
          'updated_at, player_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(rev, ...cols, playerId, now);
    const detail = JSON.stringify({...(outcome?.detail || {}), result: outcome?.result ?? null});
    const log = db.prepare('INSERT INTO ledger (op_id, player_id, seq, kind, coins, gems, fp, balance, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(ref, playerId, rev, kind, w.coins - before.coins, w.gems - before.gems, w.fp - before.fp, w.coins, detail, now);
    try {
      await db.batch([write, log, ...(outcome?.statements || [])]);
      w.rev = rev;
      return {applied: true, duplicate: false, result: outcome?.result ?? null, wallet: w};
    } catch (_) { /* another write won the race, or the same ref landed meanwhile: look again */ }
  }
  return {applied: false, error: 'busy'};
}

const amounts = a => ({coins: Math.floor(a?.coins || 0), gems: Math.floor(a?.gems || 0), fp: Math.floor(a?.fp || 0)});

// Add currency (admin gift, shop purchase, friend points). Creates the wallet row if the player has none yet.
// {applied, duplicate, error?, wallet}; the same ref twice pays once.
export function credit(db, playerId, amount, {kind = 'credit', ref, detail = null, now} = {}) {
  const a = amounts(amount);
  if ([a.coins, a.gems, a.fp].some(n => n < 0)) return Promise.resolve({applied: false, error: 'negative'});
  return apply(db, playerId, {ref, kind, now}, w => { w.coins += a.coins; w.gems += a.gems; w.fp += a.fp; return {detail}; });
}

// Take currency away; refuses with error 'insufficient' rather than going below zero.
export function debit(db, playerId, amount, {kind = 'debit', ref, detail = null, now} = {}) {
  const a = amounts(amount);
  if ([a.coins, a.gems, a.fp].some(n => n < 0)) return Promise.resolve({applied: false, error: 'negative'});
  return apply(db, playerId, {ref, kind, now}, w => {
    if (w.coins < a.coins || w.gems < a.gems || w.fp < a.fp) return 'insufficient';
    w.coins -= a.coins; w.gems -= a.gems; w.fp -= a.fp; return {detail};
  });
}
