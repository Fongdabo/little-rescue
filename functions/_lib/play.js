// Game actions checked by the server (1.13): stage wins, hero levels, stars, summons, daily rewards.
// The game still plays offline and applies each action locally at once; a signed-in player's device queues the
// action and sends it here when online. The server re-checks it against its own wallet and the numbers in
// economy.js, and its answer is what the device keeps. Summons are the exception: the server rolls them.
// Not a route: this file exports no onRequest handler.

import {apply, getWallet, ensureWallet} from './wallet.js';
import {UNIT_IDS, BASE_HEROES, UNLOCK, STAGE_REWARDS, LEVELS, levelCost, STARS, SUMMON, MISSIONS, LOGIN, PLAY, MAX_SHARDS, rollSummon} from './economy.js';
import {eventBonus} from './live.js';

const DAY = 86400000;
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const dayMs = day => Date.parse(day + 'T00:00:00Z');
const dayBefore = day => new Date(dayMs(day) - DAY).toISOString().slice(0, 10);
// Days are the player's local calendar day. Any time zone is within one day of UTC.
const nearToday = (day, now) => isDay(day) && Math.abs(dayMs(day) - dayMs(new Date(now).toISOString().slice(0, 10))) <= DAY;
const int = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const OP_ID = /^[A-Za-z0-9_-]{8,64}$/;

function random() { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
function randomId() { const a = crypto.getRandomValues(new Uint8Array(16)); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }

// Per-day counters for daily missions, keyed by the player's day; only the last 8 days are kept.
function dayEntry(w, day) {
  const entry = w.days[day] || (w.days[day] = {wins: 0, summons: 0, levelups: 0, claimed: []});
  const keep = Object.keys(w.days).sort().slice(-8);
  for (const key of Object.keys(w.days)) if (!keep.includes(key)) delete w.days[key];
  return w.days[day] || entry;
}
const count = (db, playerId, kinds, since) => db.prepare(
  `SELECT COUNT(*) AS n FROM ledger WHERE player_id = ? AND at >= ? AND kind IN (${kinds.map(() => '?').join(', ')})`)
  .bind(playerId, since, ...kinds).first().then(row => row?.n || 0);

// First contact: a player who already played before 1.13 brings their local progress into the wallet once.
// Coins are capped (PLAY.seedCoinCap); everything else is clamped to legal values. The ledger row keeps what was sent.
export async function seed(db, playerId, body, now = Date.now()) {
  // A device sends 5 levels (before 1.14.1) or one per UNIT_IDS; missing sticker heroes start at Lv 1.
  const levels = UNIT_IDS.map((id, i) => Array.isArray(body.levels) && body.levels.length >= BASE_HEROES &&
    int(body.levels[i], 1, LEVELS.max) ? body.levels[i] : 1);
  const owned = Array.isArray(body.owned) ? body.owned.filter(id => UNLOCK[id]) : [];
  const units = {};
  for (const id of UNIT_IDS) {
    const u = body.units?.[id];
    units[id] = {star: int(u?.star, 1, STARS.max) ? u.star : 1, shards: int(u?.shards, 0, MAX_SHARDS) ? u.shards : 0};
    if (owned.includes(id)) units[id].owned = true;
  }
  const coins = int(body.coins, 0, 1e9) ? body.coins : 0;
  return apply(db, playerId, {ref: 'seed:' + playerId, kind: 'seed', now}, w => {
    if (w.seeded) return 'already-seeded';
    const kept = Math.min(coins, PLAY.seedCoinCap);
    w.coins += kept; w.levels = levels; w.units = units; w.seeded = true;
    w.cleared = int(body.cleared, 0, STAGE_REWARDS.length) ? body.cleared : 0;
    w.sinceLegend = int(body.sinceLegend, 0, SUMMON.pity - 1) ? body.sinceLegend : 0;
    w.pulls = int(body.pulls, 0, 1e9) ? body.pulls : 0;
    w.freeDay = isDay(body.freeDay) ? body.freeDay : '';
    if (body.login && int(body.login.streak, 0, 9999) && isDay(body.login.lastDay)) w.login = {streak: body.login.streak, lastDay: body.login.lastDay};
    return {detail: {sentCoins: coins, keptCoins: kept}};
  });
}

// A run ticket: the server's own clock for how long a battle took.
export async function startRun(db, playerId, stage, now = Date.now()) {
  await ensureWallet(db);
  const w = await getWallet(db, playerId);
  if (!w?.seeded) return {error: 'no-wallet'};
  if (!int(stage, 0, STAGE_REWARDS.length - 1) || stage > w.cleared) return {error: 'stage-locked'};
  const recent = await db.prepare('SELECT COUNT(*) AS n FROM runs WHERE player_id = ? AND started_at >= ?').bind(playerId, now - 3600000).first();
  if ((recent?.n || 0) >= PLAY.runsPerHour) return {error: 'rate-limited'};
  const id = randomId();
  await db.batch([
    db.prepare('INSERT INTO runs (id, player_id, stage, started_at) VALUES (?, ?, ?, ?)').bind(id, playerId, stage, now),
    db.prepare('DELETE FROM runs WHERE player_id = ? AND started_at < ?').bind(playerId, now - 2 * DAY)
  ]);
  return {run: id, startedAt: now};
}

// One queued action. op = {id, kind, day, ...}; returns {id, ok, error?, result?}.
export async function applyOp(db, playerId, op, now = Date.now()) {
  if (!op || typeof op !== 'object' || !OP_ID.test(op.id || '')) return {id: op?.id ?? null, ok: false, error: 'bad-op'};
  const ref = `op:${playerId}:${op.id}`, day = op.day;
  let run = null, recentWins = 0, todayWins = 0, offlineWins = 0;
  if (op.kind === 'win') {
    if (typeof op.run === 'string' && /^[0-9a-f]{32}$/.test(op.run))
      run = await db.prepare('SELECT stage, started_at, claimed_at FROM runs WHERE id = ? AND player_id = ?').bind(op.run, playerId).first();
    [recentWins, todayWins, offlineWins] = await Promise.all([count(db, playerId, ['win', 'win-offline'], now - 3600000),
      count(db, playerId, ['win', 'win-offline'], now - DAY), count(db, playerId, ['win-offline'], now - DAY)]);
  }
  const kind = op.kind === 'win' && !run ? 'win-offline' : String(op.kind || '').slice(0, 20);
  // 1.16 events from the admin page: the coin bonus running when the reward was claimed (live.js), as the game adds it.
  const bonus = op.kind === 'win' ? await eventBonus(db, run ? now : Math.min(now, Number(op.at) || now)) : 0;

  const outcome = await apply(db, playerId, {ref, kind, now}, w => {
    if (!w.seeded) return 'no-wallet';
    switch (op.kind) {
      case 'win': {
        const stage = op.stage, battle = op.battle;
        if (!int(stage, 0, STAGE_REWARDS.length - 1) || stage > w.cleared) return 'stage-locked';
        if (!Number.isFinite(battle) || battle < PLAY.minBattleSeconds || battle > 7200) return 'too-fast';
        if (recentWins >= PLAY.winsPerHour || todayWins >= PLAY.winsPerDay) return 'rate-limited';
        const statements = [];
        if (run) {
          if (run.claimed_at || run.stage !== stage) return 'bad-run';
          const real = (now - run.started_at) / 1000;
          if (real < PLAY.minRealSeconds || real < battle / 2 - 5) return 'too-fast';
          statements.push(db.prepare('UPDATE runs SET claimed_at = ? WHERE id = ?').bind(now, op.run));
        } else {
          if (!Number.isFinite(op.at) || op.at > now + 300000 || op.at < now - PLAY.offlineMaxAgeMs) return 'too-old';
          if (offlineWins >= PLAY.offlineWinsPerDay) return 'rate-limited';
        }
        const reward = STAGE_REWARDS[stage] + Math.round(STAGE_REWARDS[stage] * bonus / 100);
        w.coins += reward; w.cleared = Math.max(w.cleared, stage + 1);
        if (nearToday(day, now)) { const d = dayEntry(w, day); d.wins += 1; d.summons += int(op.summons, 0, 300) ? op.summons : 0; }
        return {detail: {stage, battle, run: op.run || null, bonus}, result: {coins: reward}, statements};
      }
      case 'loss': {
        // Only feeds the "call friends 20 times" mission.
        if (!nearToday(day, now)) return 'too-old';
        dayEntry(w, day).summons += int(op.summons, 0, 300) ? op.summons : 0;
        return {};
      }
      case 'level': {
        const unit = op.unit;
        if (!int(unit, 0, UNIT_IDS.length - 1)) return 'bad-unit';
        if (unit >= BASE_HEROES && !w.units[UNIT_IDS[unit]].owned) return 'locked';
        const level = w.levels[unit];
        if (op.level !== level) return 'stale';
        if (level >= LEVELS.max) return 'max';
        const cost = levelCost(level);
        if (w.coins < cost) return 'insufficient';
        w.coins -= cost; w.levels[unit] = level + 1;
        if (nearToday(day, now)) dayEntry(w, day).levelups += 1;
        return {detail: {unit, level: level + 1}, result: {level: level + 1}};
      }
      case 'unlock': {
        const id = op.unit, price = UNLOCK[id];
        if (!price) return 'bad-unit';
        if (w.units[id].owned) return 'owned';
        if (w.coins < price) return 'insufficient';
        w.coins -= price; w.units[id].owned = true;
        return {detail: {unit: id, price}, result: {owned: true}};
      }
      case 'star': {
        const h = w.units[op.unit];
        if (!UNIT_IDS.includes(op.unit) || !h) return 'bad-unit';
        if (op.star !== h.star) return 'stale';
        if (h.star >= STARS.max) return 'max';
        const shards = STARS.shards[h.star + 1], coins = STARS.coins[h.star + 1];
        if (h.shards < shards || w.coins < coins) return 'insufficient';
        h.shards -= shards; h.star += 1; w.coins -= coins;
        return {detail: {unit: op.unit, star: h.star}, result: {star: h.star}};
      }
      case 'summon': {
        // Server-side roll. Paid in coins, or gems from the shop at the same price.
        const pull = op.pull, n = pull === '10' ? 10 : 1, currency = op.currency === 'gems' ? 'gems' : 'coins';
        if (!['free', '1', '10'].includes(pull)) return 'bad-pull';
        if (!nearToday(day, now)) return 'bad-day';
        const price = pull === 'free' ? 0 : pull === '10' ? SUMMON.tenCost : SUMMON.cost;
        if (pull === 'free' && w.freeDay === day) return 'used';
        if (w[currency] < price) return 'insufficient';
        const roll = rollSummon(random, n, w.sinceLegend);
        // A first summon of a sticker hero also unlocks it.
        for (const r of roll.results) { const h = w.units[UNIT_IDS[r.unit]]; h.shards = Math.min(MAX_SHARDS, h.shards + r.shards); if (r.unit >= BASE_HEROES) h.owned = true; }
        w[currency] -= price; w.sinceLegend = roll.sinceLegend; w.pulls += n;
        if (pull === 'free') w.freeDay = day;
        return {detail: {pull, currency, price}, result: {results: roll.results}};
      }
      case 'daily': {
        if (!nearToday(day, now)) return 'bad-day';
        if (op.mission === 'login') {
          if (w.login.lastDay && day <= w.login.lastDay) return 'claimed';
          const streak = w.login.lastDay === dayBefore(day) ? w.login.streak + 1 : 1, coins = LOGIN[(streak - 1) % LOGIN.length];
          w.login = {streak, lastDay: day}; w.coins += coins;
          return {detail: {mission: 'login', streak}, result: {coins}};
        }
        const m = MISSIONS.find(x => x.id === op.mission), d = dayEntry(w, day);
        if (!m) return 'bad-mission';
        if (d.claimed.includes(m.id)) return 'claimed';
        if (d[m.id] < m.goal) return 'not-done';
        d.claimed.push(m.id); w.coins += m.coins;
        return {detail: {mission: m.id}, result: {coins: m.coins}};
      }
      default: return 'bad-op';
    }
  });
  if (outcome.duplicate) return {id: op.id, ok: true, duplicate: true, result: outcome.result};
  return outcome.applied ? {id: op.id, ok: true, result: outcome.result} : {id: op.id, ok: false, error: outcome.error};
}
