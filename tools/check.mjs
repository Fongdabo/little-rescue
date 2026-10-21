// Release checks for Little Rescue. Run: node tools/check.mjs
// CI runs this on every pull request and before every deploy.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const GAME = new URL('../game/', import.meta.url).pathname;
const read = f => readFileSync(join(GAME, f), 'utf8');
const errors = [];
const fail = msg => errors.push(msg);

// 1. every script parses
for (const f of readdirSync(GAME).filter(f => f.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', join(GAME, f)], { stdio: 'pipe' }); }
  catch (e) { fail(`${f} does not parse: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`); }
}

// 1b. Cloudflare Pages Functions (cloud save, statistics, shop; subfolders too) parse too
// every .js under functions/, including _lib/ (1.15)
const FUNCTIONS = new URL('../functions/', import.meta.url).pathname;
for (const f of existsSync(FUNCTIONS) ? readdirSync(FUNCTIONS, {recursive: true}).filter(f => f.endsWith('.js')) : []) {
  try { execFileSync(process.execPath, ['--check', join(FUNCTIONS, f)], { stdio: 'pipe' }); }
  catch (e) { fail(`functions/${f} does not parse: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`); }
}

// 1c. the server wallet (functions/_lib) uses the same numbers as the game
const LIB = new URL('../functions/_lib/', import.meta.url).pathname;
for (const f of existsSync(LIB) ? readdirSync(LIB).filter(f => f.endsWith('.js')) : []) {
  try { execFileSync(process.execPath, ['--check', join(LIB, f)], { stdio: 'pipe' }); }
  catch (e) { fail(`functions/_lib/${f} does not parse: ${String(e.stderr).split('\n').slice(0, 4).join(' ')}`); }
}
if (existsSync(join(LIB, 'economy.js'))) {
  const eco = await import(join(LIB, 'economy.js'));
  const game = createRequire(import.meta.url)(join(GAME, 'engine.js'));
  const window = {};
  new Function('window', 'localStorage', read('daily-missions.js'))(window, null);
  const same = (name, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`server economy ${name} differs from the game: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); };
  same('UNIT_IDS', eco.UNIT_IDS, game.UNITS.map(u => u.id));
  same('STAGE_REWARDS', eco.STAGE_REWARDS, game.STAGES.map(s => s.rewardCoins));
  same('WEEKLY', [eco.WEEKLY.unlock, eco.WEEKLY.paidPerDay, eco.WEEKLY.chestWins, eco.WEEKLY.chestCoins, eco.WEEKLY.events],
    [game.WEEKLY.unlock, game.WEEKLY.paidPerDay, game.WEEKLY.chestWins, game.WEEKLY.chestCoins, game.WEEKLY.events.map(e => ({id: e.id, coins: e.rewardCoins}))]);
  for (const ms of [0, Date.parse('2026-10-18T16:59:59Z'), Date.parse('2026-10-18T17:00:00Z'), Date.now()])
    same(`weekOf(${ms})`, [eco.weekOf(ms), eco.weeklyEvent(ms).id], [game.weekOf(ms), game.weeklyEvent(ms).id]);
  same('LEVELS', [eco.LEVELS.max, eco.LEVELS.costBase, eco.levelCost(7)], [game.LEVELS.max, game.LEVELS.costBase, game.levelCost(7)]);
  same('STARS', [eco.STARS.max, eco.STARS.shards, eco.STARS.coins], [game.STARS.max, game.STARS.shards, game.STARS.coins]);
  same('SUMMON', [eco.SUMMON.cost, eco.SUMMON.tenCost, eco.SUMMON.pity, eco.SUMMON.tiers.map(t => [t.id, t.shards, t.weight])],
    [game.SUMMON.cost, game.SUMMON.tenCost, game.SUMMON.pity, game.SUMMON.tiers.map(t => [t.id, t.shards, t.weight])]);
  same('MISSIONS', eco.MISSIONS, window.SideviewDaily.MISSIONS.map(m => ({id: m.id, goal: m.goal, coins: m.coins})));
  same('LOGIN', eco.LOGIN, window.SideviewDaily.LOGIN.map(r => r.coins));
  // the same random numbers must give the same summon
  for (const [count, since] of [[1, 0], [10, 3], [10, 45], [1, 49]]) {
    let a = 12345, b = 12345;
    const lcg = seed => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    same(`rollSummon(${count},${since})`, eco.rollSummon(lcg(a), count, since), game.rollSummon(lcg(b), count, since));
  }
}

// 2. one build id everywhere: service worker, page, every recovery page
const build = (read('sw.js').match(/const BUILD_ID='([^']+)'/) || [])[1];
const page = (read('pwa.js').match(/const PAGE_BUILD_ID='([^']+)'/) || [])[1];
if (!build) fail('sw.js has no BUILD_ID');
if (page !== build) fail(`pwa.js PAGE_BUILD_ID ${page} != sw.js BUILD_ID ${build}`);
const version = (build || '').replace(/^pwa-/, '');
const recovers = readdirSync(GAME).filter(d => /^recover-v\d+$/.test(d));
for (const d of recovers) {
  const target = (read(`${d}/index.html`).match(/const TARGET='([^']+)'/) || [])[1];
  if (target !== build) fail(`${d}/index.html TARGET ${target} != ${build}`);
}
const own = `recover-v${version.replace(/\./g, '')}`;
if (!recovers.includes(own)) fail(`missing ${own}/ for ${version} (copy the newest recover-vXXX and update it)`);
for (const [f, re] of [['app.js', /'(\d+\.\d+\.\d+)'/g], ['index.html', /(?:RELEASE|PWA ทดลอง) (\d+\.\d+\.\d+)/g]]) {
  for (const m of read(f).matchAll(re)) if (m[1] !== version) fail(`${f} still says ${m[1]} (build is ${version})`);
}

// 3. the service worker precaches only files that exist, and every local file the page loads
const pre = read('sw.js').match(/PRECACHE_START \*\/\[([\s\S]*?)\]\/\* PRECACHE_END/);
const list = pre ? JSON.parse(`[${pre[1]}]`) : [];
if (!pre) fail('sw.js PRECACHE list not found');
for (const p of list) if (p && !existsSync(join(GAME, p))) fail(`sw.js precaches missing file ${p}`);
for (const m of read('index.html').matchAll(/(?:href|src)="([^"#:]+)"/g)) {
  const p = m[1];
  if (!existsSync(join(GAME, p))) fail(`index.html loads missing file ${p}`);
  else if (statSync(join(GAME, p)).isFile() && !list.includes(p)) fail(`index.html loads ${p} but sw.js does not precache it`);
}

// 4. saves players already have must keep loading
const KEYS = ['little-rescue-sideview-save-v2', 'little-rescue-sideview-save-v1', 'little-rescue-meta-v1', 'little-rescue-daily-v1', 'little-rescue-cloud-v1', 'little-rescue-summon-v1', 'little-rescue-wallet-v1', 'little-rescue-gifts-v1', 'little-rescue-world-v1', 'little-rescue-weekly-v1'];
const all = readdirSync(GAME).filter(f => f.endsWith('.js')).map(read).join('\n');
for (const k of KEYS) if (!all.includes(k)) fail(`save key ${k} disappeared from the scripts`);
const manifest = JSON.parse(read('manifest.webmanifest'));
if (manifest.id !== './' || manifest.start_url !== './') fail('manifest id/start_url changed: installed games would lose their identity');

if (errors.length) { console.error(`✗ ${errors.length} problem(s):\n- ${errors.join('\n- ')}`); process.exit(1); }
console.log(`✓ Little Rescue ${version}: ${list.length} precached files, ${recovers.length} recovery pages, save keys intact`);
