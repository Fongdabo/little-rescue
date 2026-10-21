// The server's copy of every number that moves coins, shards or stars (1.13 server wallet).
// The game's own copies live in game/engine.js (STAGES, LEVELS, STARS, SUMMON, UNITS) and game/daily-missions.js
// (MISSIONS, LOGIN). tools/check.mjs fails the build if the two ever differ, so change both together.

export const UNIT_IDS = ['sugar-01', 'sugar-02', 'sugar-05', 'sugar-07', 'sugar-08',
  'sticker-bison', 'sticker-kangaroo', 'sticker-peacock', 'sticker-wombat', 'sticker-lemur'];
// 1.14.1 sticker heroes (UNIT_IDS 5+) start locked: bought with coins (op 'unlock') or won by a first summon.
// Ownership is units[id].owned in the wallet. Prices = engine.js UNITS[].unlockCoins.
export const BASE_HEROES = 5;
export const UNLOCK = {'sticker-bison': 200, 'sticker-kangaroo': 200, 'sticker-peacock': 250, 'sticker-wombat': 250, 'sticker-lemur': 300};
export const STAGE_REWARDS = [30, 45, 60, 75, 90];
export const LEVELS = {max: 10, costBase: 20};
export const levelCost = level => LEVELS.costBase * level;
export const STARS = {max: 5, shards: [0, 0, 5, 10, 20, 40], coins: [0, 0, 50, 100, 200, 400]};
export const SUMMON = {cost: 30, tenCost: 270, pity: 50,
  tiers: [{id: 'common', shards: 1, weight: 70}, {id: 'rare', shards: 3, weight: 25}, {id: 'legend', shards: 10, weight: 5}]};
export const MISSIONS = [{id: 'wins', goal: 3, coins: 30}, {id: 'summons', goal: 20, coins: 20}, {id: 'levelups', goal: 1, coins: 20}];
export const LOGIN = [10, 15, 20, 25, 30, 40, 60];
export const MAX_COINS = 1000000000, MAX_SHARDS = 99999;

// Plausibility limits. The fastest possible win (every hero Lv 10 and 5 stars, every item, cannon on cooldown)
// takes about 30 s of battle time on stage 1 (node simulation of engine.js), 15 s of real time at x2 speed.
export const PLAY = {
  minBattleSeconds: 20,      // a win reported faster than this is refused
  minRealSeconds: 12,        // server clock between /api/run and the claim
  winsPerHour: 60, winsPerDay: 400,
  offlineWinsPerDay: 30,     // wins claimed without a server run ticket (played offline)
  offlineMaxAgeMs: 7 * 86400000,
  runsPerHour: 120,
  seedCoinCap: 50000         // coins a pre-1.13 local save may bring into a new server wallet, once
};

// Same algorithm as engine.js rollSummon: rand() returns [0, 1).
export function rollSummon(rand, count, sinceLegend) {
  const results = [];
  let since = Math.max(0, Math.floor(sinceLegend) || 0);
  for (let i = 0; i < count; i++) {
    let roll = rand() * 100, tier = SUMMON.tiers[0];
    for (const t of SUMMON.tiers) { if (roll < t.weight) { tier = t; break; } roll -= t.weight; }
    if (since + 1 >= SUMMON.pity) tier = SUMMON.tiers[2];
    results.push({tier: tier.id, unit: Math.min(UNIT_IDS.length - 1, Math.floor(rand() * UNIT_IDS.length)), shards: tier.shards});
    since = tier.id === 'legend' ? 0 : since + 1;
  }
  if (count >= 10 && results.every(r => r.tier === 'common')) {
    const last = results[results.length - 1];
    last.tier = 'rare'; last.shards = SUMMON.tiers[1].shards;
  }
  return {results, sinceLegend: since};
}
