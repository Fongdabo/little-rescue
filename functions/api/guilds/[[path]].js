// /api/guilds/* (1.13): create or join a guild with its code (G-XXXX-XXXX), member list, leader, notice and a
// daily check-in worth a few friendship points. Shared rules and the F daily cap are in functions/_lib/social.js.

import {RULES, handler, json, fail, playerCode, guildCode, newGuildCode, cleanText, award, me as myProfile} from '../../_lib/social.js';

async function guildOf(db, playerId, day) {
  const g = await db.prepare('SELECT g.id, g.name, g.leader_id, g.notice FROM guild_members m JOIN guilds g ON g.id = m.guild_id WHERE m.player_id = ?')
    .bind(playerId).first();
  if (!g) return null;
  const {results} = await db.prepare(
    'SELECT p.player_id, p.name, p.cleared, p.last_seen, m.checkin_day FROM guild_members m JOIN profiles p ON p.player_id = m.player_id ' +
    'WHERE m.guild_id = ?1 ORDER BY (p.player_id = ?2) DESC, m.joined_at').bind(g.id, g.leader_id).all();
  const members = results.map(r => ({id: r.player_id, name: r.name, cleared: r.cleared, lastSeen: r.last_seen, checkedIn: r.checkin_day === day}));
  return {id: g.id, name: g.name, notice: g.notice, leader: g.leader_id, max: RULES.guildMax, members,
    checkedIn: members.find(m => m.id === playerId)?.checkedIn || false};
}

export const onRequest = handler(async ({db, now, day, me, body, method, path}) => {
  const done = async extra => json({...extra, state: {rules: RULES, me: await myProfile(db, me, now), guild: await guildOf(db, me, day)}});
  const membership = await db.prepare('SELECT guild_id FROM guild_members WHERE player_id = ?').bind(me).first('guild_id');

  if (path === '' && method === 'GET') return done({});
  // Guilds with room, busiest first, so a new player can find one without a code.
  if (path === 'list' && method === 'GET') {
    const {results} = await db.prepare(
      'SELECT g.id, g.name, g.notice, COUNT(m.player_id) AS members FROM guilds g JOIN guild_members m ON m.guild_id = g.id ' +
      'GROUP BY g.id HAVING members < ? ORDER BY members DESC, g.created_at DESC LIMIT 12').bind(RULES.guildMax).all();
    return json({guilds: results});
  }
  if (path === 'create' && method === 'POST') {
    if (membership) return fail(409, 'in-guild');
    const name = cleanText(body.name, RULES.nameMax);
    if (!name) return fail(400, 'bad-name');
    const id = newGuildCode();
    await db.batch([
      db.prepare('INSERT INTO guilds (id, name, leader_id, created_at) VALUES (?, ?, ?, ?)').bind(id, name, me, now),
      db.prepare('INSERT INTO guild_members (player_id, guild_id, joined_at) VALUES (?, ?, ?)').bind(me, id, now)]);
    return done({guild: id});
  }
  if (path === 'join' && method === 'POST') {
    if (membership) return fail(409, 'in-guild');
    const id = guildCode(body.code);
    if (!id || !await db.prepare('SELECT 1 AS x FROM guilds WHERE id = ?').bind(id).first('x')) return fail(404, 'unknown-guild');
    // Insert only while there is room, in one statement, so two joins at once cannot pass the limit.
    const row = await db.prepare('INSERT INTO guild_members (player_id, guild_id, joined_at) SELECT ?1, ?2, ?3 ' +
      'WHERE (SELECT COUNT(*) FROM guild_members WHERE guild_id = ?2) < ?4 ON CONFLICT DO NOTHING RETURNING guild_id')
      .bind(me, id, now, RULES.guildMax).first();
    if (!row) return fail(409, 'guild-full');
    return done({guild: id});
  }

  if (!membership) return fail(409, 'no-guild');
  const leader = await db.prepare('SELECT leader_id FROM guilds WHERE id = ?').bind(membership).first('leader_id');
  if (path === 'leave' && method === 'POST') {
    await db.prepare('DELETE FROM guild_members WHERE player_id = ?').bind(me).run();
    if (leader === me) {
      // The longest-standing member takes over; an empty guild is removed.
      const next = await db.prepare('SELECT player_id FROM guild_members WHERE guild_id = ? ORDER BY joined_at LIMIT 1').bind(membership).first('player_id');
      if (next) await db.prepare('UPDATE guilds SET leader_id = ? WHERE id = ?').bind(next, membership).run();
      else await db.prepare('DELETE FROM guilds WHERE id = ?').bind(membership).run();
    }
    return done({ok: true});
  }
  if (path === 'kick' && method === 'POST') {
    if (leader !== me) return fail(403, 'not-leader');
    const other = playerCode(body.id);
    if (!other || other === me) return fail(400, 'bad-code');
    await db.prepare('DELETE FROM guild_members WHERE player_id = ? AND guild_id = ?').bind(other, membership).run();
    return done({ok: true});
  }
  if (path === 'notice' && method === 'POST') {
    if (leader !== me) return fail(403, 'not-leader');
    await db.prepare('UPDATE guilds SET notice = ? WHERE id = ?').bind(cleanText(body.notice, RULES.noticeMax), membership).run();
    return done({ok: true});
  }
  if (path === 'checkin' && method === 'POST') {
    const row = await db.prepare('UPDATE guild_members SET checkin_day = ?2 WHERE player_id = ?1 AND checkin_day <> ?2 RETURNING guild_id').bind(me, day).first();
    if (!row) return fail(409, 'already-checked-in');
    return done({gained: await award(db, me, RULES.guildCheckin, `gcheckin:${me}:${day}`, 'เช็กชื่อกิลด์', day)});
  }
  return fail(404, 'not-found');
});
