// Testnet main token + hero NFTs for players (1.18), TESTNET ONLY (Base Sepolia, no money value).
// Logic and settings: functions/_lib/chain.js. Off (404 'off') unless CHAIN_TESTNET=1 and CHAIN_MINTER_KEY are set,
// so the game shows nothing about it until the owner turns it on.
//   GET  /api/chain/status   public info; with the device token also the player's wallet link, heroes and claims
//   POST /api/chain/link     {address, signature?, at?}  signature = personal_sign of the status message (proves the wallet)
//   POST /api/chain/unlink
//   POST /api/chain/claim    {kind:'token'} once per Thai day after clearing a stage, or {kind:'hero', unit} once per hero
import {json, fail, readBody, authenticate} from '../../_lib/http.js';
import {sameOrigin} from '../../_lib/live.js';
import {chainEnv, setupChain, status, link, unlink, claim} from '../../_lib/chain.js';

async function route(request, env, path) {
  const cfg = chainEnv(env), db = env.SAVES_DB, now = Date.now(), method = request.method;
  if (!cfg.on) return fail(404, 'off');
  await setupChain(db);
  const auth = await authenticate(request, db, now).catch(() => null); // no players table yet = nobody signed in

  if (path === 'status' && method === 'GET') return json(await status(db, cfg, auth?.playerId, now));
  if (!auth) return fail(401, 'signed-out');
  if (path === 'link' && method === 'POST') {
    const result = await link(db, auth.playerId, await readBody(request, 2048), now);
    return result.error ? fail(400, result.error) : json(result);
  }
  if (path === 'unlink' && method === 'POST') { await unlink(db, auth.playerId); return json({ok: true}); }
  if (path === 'claim' && method === 'POST') {
    const result = await claim(db, cfg, auth.playerId, await readBody(request, 1024), now);
    return json(result.error ? {error: result.error, claim: result.claim || null} : {claim: result.claim}, result.status);
  }
  return fail(404, 'not-found');
}

export async function onRequest({request, env, params}) {
  if (!sameOrigin(request)) return fail(403, 'cross-origin');
  const path = [].concat(params.path || []).join('/');
  try { return await route(request, env, path); }
  catch (error) { console.log('chain failed', String(error), error.rpc || ''); return fail(error.status || 500, error.status ? error.message : 'server-error'); }
}
