// GET /api/live: events and the maintenance notice for the lobby (1.13). Public, no sign-in, no personal data.
// Without the cloud database it answers an empty state, so the game simply shows nothing.
import {json, sameOrigin, liveStatus} from '../_lib/live.js';

export async function onRequestGet({request, env}) {
  if (!sameOrigin(request)) return json({error: 'cross-origin'}, 403);
  const now = Date.now();
  if (!env.SAVES_DB) return json({now, maintenance: {on: false, message: ''}, events: []});
  try { return json(await liveStatus(env.SAVES_DB, now)); }
  catch (error) { console.log('live failed', String(error)); return json({error: 'server-error'}, 500); }
}
