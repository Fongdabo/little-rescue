// Gift box (1.16): GET /api/gifts lists the signed-in player's unclaimed gifts, POST /api/gifts {id} claims one.
// Uses the cloud-save device token. Gifts are sent from the admin page (functions/api/admin/[[path]].js).
import {json, fail, readBody, authenticate} from '../_lib/http.js';
import {sameOrigin, openGifts, claimGift} from '../_lib/live.js';

export async function onRequest({request, env}) {
  if (!sameOrigin(request)) return fail(403, 'cross-origin');
  const db = env.SAVES_DB, now = Date.now();
  if (!db) return fail(503, 'cloud-not-configured');
  try {
    const auth = await authenticate(request, db, now);
    if (!auth) return fail(401, 'signed-out');
    if (request.method === 'GET') return json({playerId: auth.playerId, gifts: await openGifts(db, auth.playerId, now)});
    if (request.method !== 'POST') return fail(405, 'method');
    const body = await readBody(request, 1024);
    if (!Number.isSafeInteger(body.id) || body.id < 1) return fail(400, 'bad-gift');
    const result = await claimGift(db, auth.playerId, body.id, now);
    return result.status === 200 ? json({gift: result.gift, paid: result.paid, wallet: result.wallet}) : fail(result.status, result.error);
  } catch (error) {
    if (error.status) return fail(error.status, error.message);
    console.log('gifts failed', String(error)); return fail(500, 'server-error');
  }
}
