// Shared helpers for the Pages Functions on SAVES_DB (cloud save, wallet, shop, friends, admin).
// Not a route: this file exports no onRequest handler.

export const MAX_BODY = 33 * 1024;

export const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}
});
export const fail = (status, error) => json({error}, status);

export async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// A JSON object body, or an error with .status (400 / 413) that onRequest turns into a reply.
export async function readBody(request, max = MAX_BODY) {
  const text = await request.text();
  if (text.length > max) throw Object.assign(new Error('too-large'), {status: 413});
  try { const value = JSON.parse(text || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) return value; }
  catch (_) { /* fall through */ }
  throw Object.assign(new Error('bad-json'), {status: 400});
}

// "Authorization: Bearer <device token>" -> {playerId, tokenHash}, or null. Tables come from [[path]].js SCHEMA.
export async function authenticate(request, db, now = Date.now()) {
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

// Runs CREATE ... IF NOT EXISTS statements once per isolate; a failure is retried on the next request.
const ready = new Map();
export function ensureSchema(db, name, statements) {
  if (!ready.has(name)) ready.set(name, db.batch(statements.map(sql => db.prepare(sql))).catch(error => { ready.delete(name); throw error; }));
  return ready.get(name);
}
