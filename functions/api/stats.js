// Cloudflare Pages Function for anonymous play statistics (game/stats.js sends, game/stats.html reads).
// Needs a D1 binding named DB and, for reading, a secret STATS_KEY. Without DB it accepts and drops events,
// so the game never sees an error. The table is created on first use; no IP or personal data is stored.
const PROD_HOST = 'little-rescue.pages.dev';
const KINDS = new Set(['session', 'start', 'end', 'away', 'active']);
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, day TEXT NOT NULL, at INTEGER NOT NULL, test INTEGER NOT NULL,
    pid TEXT NOT NULL, sid TEXT NOT NULL, build TEXT, age INTEGER, kind TEXT NOT NULL, stage INTEGER, result TEXT,
    why TEXT, secs INTEGER, hp INTEGER, cleared INTEGER, app INTEGER)`,
  'CREATE INDEX IF NOT EXISTS events_day ON events (test, day, kind)',
  'CREATE INDEX IF NOT EXISTS events_pid ON events (pid, day)',
];
let ready = null;
const setup = db => (ready ??= db.batch(SCHEMA.map(sql => db.prepare(sql))).catch(error => { ready = null; throw error; }));

const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
const pick = (v, allowed) => (allowed.includes(v) ? v : null);
// Players are in Thailand: count days in UTC+7.
const thaiDay = (ms = Date.now()) => new Date(ms + 7 * 3600e3).toISOString().slice(0, 10);
// Preview links (pr-3.little-rescue.pages.dev) and local tests are kept apart from real players.
// Add a custom domain to PROD_HOSTS (comma separated) if the game ever gets one.
const isTest = (host, env) => !(env.PROD_HOSTS || PROD_HOST).split(',').map(h => h.trim()).includes(host);

export async function onRequestPost({ request, env }) {
  const done = new Response(null, { status: 204 });
  const origin = request.headers.get('origin');
  const url = new URL(request.url);
  if (origin && new URL(origin).host !== url.host) return new Response(null, { status: 403 });
  if (!env.DB) return done;
  let body;
  try {
    const text = await request.text();
    if (text.length > 16000) return done;
    body = JSON.parse(text);
  } catch { return done; }
  if (body?.v !== 1 || !/^[0-9a-f]{16}$/.test(body.pid) || !/^[0-9a-f]{12}$/.test(body.sid) || !Array.isArray(body.events)) return done;
  const build = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(body.build) ? body.build : null;
  const age = int(body.age, 0, 3650);
  const now = Date.now(), day = thaiDay(now), test = isTest(url.hostname, env) ? 1 : 0;
  const rows = body.events.slice(0, 60).filter(e => e && KINDS.has(e.kind));
  if (!rows.length) return done;
  try {
    await setup(env.DB);
    const insert = env.DB.prepare(`INSERT INTO events (day, at, test, pid, sid, build, age, kind, stage, result, why, secs, hp, cleared, app)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    await env.DB.batch(rows.map(e => insert.bind(day, now, test, body.pid, body.sid, build, age, e.kind,
      int(e.stage, 0, 50), pick(e.result, ['won', 'lost']), pick(e.why, ['base', 'time', 'quit']), int(e.secs, 0, 86400),
      int(e.hp, 0, 100), int(e.cleared, 0, 50), int(e.app, 0, 1))));
  } catch (error) { console.log('stats insert failed', String(error)); }
  return done;
}

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  if (!env.STATS_KEY) return json({ error: 'no-key' }, 503);
  const given = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!sameSecret(given, env.STATS_KEY)) return json({ error: 'wrong-key' }, 401);
  if (!env.DB) return json({ error: 'no-db' }, 503);
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number.parseInt(url.searchParams.get('days'), 10) || 30));
  const test = url.searchParams.get('test') === '1' ? 1 : 0;
  const since = thaiDay(Date.now() - (days - 1) * 864e5), today = thaiDay();
  const stopDay = thaiDay(Date.now() - 3 * 864e5);
  await setup(env.DB);
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args);
  const [daily, sessions, stages, furthest, retention, builds, totals] = (await env.DB.batch([
    // players, new players and app installs per day
    q(`SELECT day, COUNT(DISTINCT pid) AS players, COUNT(DISTINCT CASE WHEN age = 0 THEN pid END) AS new_players,
         COUNT(DISTINCT CASE WHEN app = 1 THEN pid END) AS app_players
       FROM events WHERE test = ? AND day >= ? GROUP BY day ORDER BY day`, test, since),
    // sessions per day (any event) and time played (longest "active" report of each session that sent one)
    q(`SELECT day, COUNT(*) AS sessions, COUNT(s) AS timed, CAST(AVG(s) AS INTEGER) AS avg_secs, SUM(s) AS total_secs FROM
         (SELECT MIN(day) AS day, sid, MAX(CASE WHEN kind = 'active' THEN secs END) AS s FROM events WHERE test = ? AND day >= ? GROUP BY sid)
       GROUP BY day ORDER BY day`, test, since),
    // per stage: who tried, who won, how long, how close the losses were, how many left mid-battle
    q(`SELECT stage, COUNT(DISTINCT CASE WHEN kind = 'start' THEN pid END) AS players,
         SUM(kind = 'start') AS plays, SUM(kind = 'end' AND result = 'won') AS wins, SUM(kind = 'end' AND result = 'lost') AS losses,
         SUM(kind = 'end' AND why = 'base') AS lost_base, SUM(kind = 'end' AND why = 'time') AS lost_time,
         SUM(kind = 'end' AND why = 'quit') AS lost_quit,
         COUNT(DISTINCT CASE WHEN kind = 'end' AND result = 'won' THEN pid END) AS winners,
         SUM(kind = 'away') AS left_mid,
         CAST(AVG(CASE WHEN kind = 'end' AND result = 'won' THEN secs END) AS INTEGER) AS win_secs,
         CAST(AVG(CASE WHEN kind = 'end' AND result = 'lost' THEN hp END) AS INTEGER) AS loss_enemy_hp
       FROM events WHERE test = ? AND day >= ? AND stage IS NOT NULL GROUP BY stage ORDER BY stage`, test, since),
    // where players stopped: stages cleared at the last visit, split into still playing / not seen for 3+ days
    q(`SELECT cleared, COUNT(*) AS players, SUM(last_day < ?) AS stopped FROM
         (SELECT pid, MAX(day) AS last_day, MAX(cleared) AS cleared FROM events WHERE test = ? AND day >= ? GROUP BY pid)
       GROUP BY cleared ORDER BY cleared`, stopDay, test, since),
    // retention: new players in the window who came back the next day / a week later
    q(`SELECT COUNT(*) AS new_players, SUM(d1) AS d1, SUM(d7) AS d7, SUM(back) AS returned,
         SUM(first <= ?) AS d1_eligible, SUM(first <= ?) AS d7_eligible FROM
         (SELECT pid, MIN(day) AS first, MAX(age = 1) AS d1, MAX(age = 7) AS d7, MAX(age >= 1) AS back
          FROM events WHERE test = ? AND day >= ? GROUP BY pid HAVING MIN(age) = 0)`,
      thaiDay(Date.now() - 864e5), thaiDay(Date.now() - 7 * 864e5), test, since),
    q(`SELECT build, COUNT(DISTINCT pid) AS players FROM events WHERE test = ? AND day >= ? GROUP BY build ORDER BY players DESC`, test, since),
    q(`SELECT COUNT(DISTINCT pid) AS players, COUNT(DISTINCT sid) AS sessions, COUNT(*) AS events FROM events WHERE test = ? AND day >= ?`, test, since),
  ])).map(r => r.results);
  return json({ days, since, today, test, daily, sessions, stages, furthest, retention: retention[0], builds, totals: totals[0] });
}
