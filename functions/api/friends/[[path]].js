// /api/friends/* (1.13): friend list, requests, daily help (friendship points) and borrowing a friend's helper hero.
// Works like LINE Rangers: add a friend by their player id (LR-XXXX-XXXX), they accept, then once a day each side can
// send help and borrow the other's helper for one battle. Shared rules and the F daily cap are in functions/_lib/social.js.

import {RULES, handler, json, fail, playerCode, cleanText, cleanHelper, parseHelper, award, ensureProfile, me as myProfile} from '../../_lib/social.js';

const link = (db, a, b) => db.prepare('SELECT state FROM friend_links WHERE player_id = ? AND friend_id = ?').bind(a, b).first('state');
const countState = (db, playerId, state) =>
  db.prepare('SELECT COUNT(*) AS n FROM friend_links WHERE player_id = ? AND state = ?').bind(playerId, state).first('n');
const both = (db, sql, a, b, ...rest) => db.batch([db.prepare(sql).bind(a, b, ...rest), db.prepare(sql).bind(b, a, ...rest)]);

async function state(db, me, now) {
  const profile = await myProfile(db, me, now), day = profile.day;
  const [links, gifts] = await Promise.all([
    db.prepare(
      'SELECT l.friend_id, l.state, p.name, p.helper, p.cleared, p.last_seen, ' +
      '(SELECT 1 FROM friend_gifts g WHERE g.from_id = l.player_id AND g.to_id = l.friend_id AND g.day = ?2) AS sent, ' +
      '(SELECT 1 FROM helper_uses h WHERE h.player_id = l.player_id AND h.friend_id = l.friend_id AND h.day = ?2) AS borrowed ' +
      'FROM friend_links l JOIN profiles p ON p.player_id = l.friend_id WHERE l.player_id = ?1 ORDER BY p.last_seen DESC').bind(me, day).all(),
    db.prepare('SELECT g.from_id, p.name FROM friend_gifts g LEFT JOIN profiles p ON p.player_id = g.from_id WHERE g.to_id = ? AND g.claimed = 0')
      .bind(me).all()]);
  const people = links.results.map(r => ({id: r.friend_id, name: r.name, cleared: r.cleared, lastSeen: r.last_seen, state: r.state,
    helper: r.state === 'friend' ? parseHelper(r.helper) : null, sentToday: Boolean(r.sent), borrowedToday: Boolean(r.borrowed)}));
  return {rules: RULES, now, me: profile,
    friends: people.filter(p => p.state === 'friend'), incoming: people.filter(p => p.state === 'in'),
    outgoing: people.filter(p => p.state === 'out'), gifts: gifts.results.map(g => ({from: g.from_id, name: g.name || g.from_id}))};
}

async function befriend(db, me, other) {
  if (await countState(db, me, 'friend') >= RULES.maxFriends) return fail(409, 'friends-full');
  if (await countState(db, other, 'friend') >= RULES.maxFriends) return fail(409, 'their-friends-full');
  await both(db, "UPDATE friend_links SET state = 'friend' WHERE player_id = ? AND friend_id = ?", me, other);
  return null;
}

export const onRequest = handler(async ({db, now, day, me, body, method, path}) => {
  const done = async extra => json({...extra, state: await state(db, me, now)});

  if (path === '' && method === 'GET') return done({});

  // Name, helper hero and stages cleared, as shown to friends and guild mates.
  if (path === 'profile' && method === 'PUT') {
    const name = body.name === undefined ? null : cleanText(body.name, RULES.nameMax);
    const helper = body.helper == null ? null : cleanHelper(body.helper);
    const cleared = Number.isInteger(body.cleared) && body.cleared >= 0 && body.cleared <= 999 ? body.cleared : null;
    if (name === '') return fail(400, 'bad-name');
    if (body.helper != null && !helper) return fail(400, 'bad-helper');
    await db.prepare('UPDATE profiles SET name = COALESCE(?2, name), helper = CASE WHEN ?3 THEN ?4 ELSE helper END, ' +
      'cleared = COALESCE(?5, cleared) WHERE player_id = ?1')
      .bind(me, name, body.helper !== undefined ? 1 : 0, helper ? JSON.stringify(helper) : null, cleared).run();
    return done({ok: true});
  }

  if (path === 'add' && method === 'POST') {
    const other = playerCode(body.code);
    if (!other) return fail(400, 'bad-code');
    if (other === me) return fail(400, 'self');
    if (!await db.prepare('SELECT 1 AS x FROM players WHERE id = ?').bind(other).first('x')) return fail(404, 'unknown-player');
    const mine = await link(db, me, other);
    if (mine === 'friend') return fail(409, 'already-friends');
    if (mine === 'out') return fail(409, 'already-asked');
    await ensureProfile(db, other, now);
    if (mine === 'in') return await befriend(db, me, other) || done({result: 'friends'}); // they asked first: adding back accepts
    if (await countState(db, me, 'friend') >= RULES.maxFriends) return fail(409, 'friends-full');
    if (await countState(db, me, 'out') >= RULES.maxPending) return fail(409, 'too-many-requests');
    if (await countState(db, other, 'in') >= RULES.maxPending) return fail(409, 'their-inbox-full');
    await db.batch([
      db.prepare("INSERT INTO friend_links (player_id, friend_id, state, created_at) VALUES (?, ?, 'out', ?)").bind(me, other, now),
      db.prepare("INSERT INTO friend_links (player_id, friend_id, state, created_at) VALUES (?, ?, 'in', ?)").bind(other, me, now)]);
    return done({result: 'asked'});
  }
  if (path === 'accept' && method === 'POST') {
    const other = playerCode(body.id);
    if (!other || await link(db, me, other) !== 'in') return fail(404, 'no-request');
    return await befriend(db, me, other) || done({result: 'friends'});
  }
  // Decline a request, cancel my own request, or unfriend: all of them remove both rows.
  if (path === 'remove' && method === 'POST') {
    const other = playerCode(body.id);
    if (!other) return fail(400, 'bad-code');
    await both(db, 'DELETE FROM friend_links WHERE player_id = ? AND friend_id = ?', me, other);
    return done({ok: true});
  }

  // Send help: once a day per friend. The friend gets a gift to collect; the sender earns a little F right away.
  if (path === 'send' && method === 'POST') {
    const targets = body.all === true
      ? (await db.prepare("SELECT friend_id FROM friend_links WHERE player_id = ? AND state = 'friend'").bind(me).all()).results.map(r => r.friend_id)
      : [playerCode(body.id)];
    let sent = 0, gained = 0;
    for (const other of targets) {
      if (!other || await link(db, me, other) !== 'friend') continue;
      const row = await db.prepare('INSERT INTO friend_gifts (from_id, to_id, day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING day')
        .bind(me, other, day).first();
      if (!row) continue;
      sent += 1;
      gained += await award(db, me, RULES.sendSelf, `fsend:${me}:${other}:${day}`, 'ส่งความช่วยเหลือให้เพื่อน', day);
    }
    if (!sent) return fail(409, body.all === true ? 'nothing-to-send' : 'already-sent');
    return done({sent, gained});
  }
  if (path === 'collect' && method === 'POST') {
    const {results} = await db.prepare('UPDATE friend_gifts SET claimed = 1 WHERE to_id = ? AND claimed = 0 RETURNING from_id, day').bind(me).all();
    if (!results.length) return fail(409, 'no-gifts');
    let gained = 0;
    for (const g of results) gained += await award(db, me, RULES.sendGift, `fgift:${g.from_id}:${me}:${g.day}`, 'รับความช่วยเหลือจากเพื่อน', day);
    return done({collected: results.length, gained});
  }

  // Borrow a friend's helper hero for the next battle: once a day per friend. Both sides earn F.
  if (path === 'helper' && method === 'POST') {
    const other = playerCode(body.id);
    if (!other || await link(db, me, other) !== 'friend') return fail(404, 'not-friends');
    const profile = await db.prepare('SELECT name, helper FROM profiles WHERE player_id = ?').bind(other).first();
    const helper = parseHelper(profile?.helper);
    if (!helper) return fail(409, 'no-helper');
    const row = await db.prepare('INSERT INTO helper_uses (player_id, friend_id, day) VALUES (?, ?, ?) ON CONFLICT DO NOTHING RETURNING day')
      .bind(me, other, day).first();
    if (!row) return fail(409, 'already-borrowed');
    const ref = `helper:${me}:${other}:${day}`;
    await award(db, other, RULES.helperOwner, ref + ':owner', 'เพื่อนยืมตัวช่วยของคุณ', day);
    const gained = await award(db, me, RULES.helperBorrower, ref, 'ยืมตัวช่วยจากเพื่อน', day);
    return done({helper: {...helper, friendId: other, name: profile.name}, gained});
  }
  return fail(404, 'not-found');
});
