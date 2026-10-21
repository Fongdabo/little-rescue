// Little Rescue real-money shop (gem packs). Cloudflare Pages Function on the game's own origin.
// Payment provider: Stripe (Thailand account) Checkout, card + PromptPay, priced in THB.
//
// Built for TEST MODE: with a live key (sk_live_/rk_live_) the shop stays closed unless the owner also sets
// SHOP_LIVE=1, and webhook events from live mode are ignored the same way. Needs, in Cloudflare Pages settings:
//   SAVES_DB               D1 binding (same database as cloud save; real-money purchases need a cloud account)
//   STRIPE_SECRET_KEY      secret, sk_test_...
//   STRIPE_WEBHOOK_SECRET  secret, whsec_... from the webhook endpoint https://<site>/api/shop/webhook
// Optional: SHOP_METHODS (default "card,promptpay"), SHOP_MONTHLY_LIMIT_THB (default 3000).
//
// Gems live only on the server, in the shared wallet (functions/_lib/wallet.js, docs/server-wallet.md); they are spent
// on summons through /api/wallet/ops ({kind:'summon', currency:'gems'}), not here.
// Every wallet change carries an idempotency ref, so Stripe retrying a webhook never credits twice:
//   pay:<order>   refund:<order>:<amount refunded so far>   dispute:<order>
// Gems buy summon pulls at the same rates as coins (rates are shown in the game). Nothing is sold only for money.

import {json, fail, readBody, authenticate, ensureSchema} from '../../_lib/http.js';
import {ensureWallet, getWallet, credit, debit} from '../../_lib/wallet.js';

// Prices in satang (1/100 THB). Changing a pack only affects new orders; old orders keep their own gems/amount.
export const PACKS = [
  {id: 'gems60', gems: 60, bonus: 0, amount: 3500, name: 'ถุงเพชรเล็ก'},
  {id: 'gems190', gems: 180, bonus: 10, amount: 9900, name: 'ถุงเพชร'},
  {id: 'gems370', gems: 340, bonus: 30, amount: 17900, name: 'กล่องเพชร'},
  {id: 'gems760', gems: 680, bonus: 80, amount: 34900, name: 'หีบเพชร'}
];
const STRIPE = 'https://api.stripe.com/v1/';
const TOLERANCE = 300; // seconds a webhook signature stays valid
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS shop_orders (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, pack TEXT NOT NULL, gems INTEGER NOT NULL, ' +
    'amount INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL, session_id TEXT, payment_intent TEXT, livemode INTEGER NOT NULL DEFAULT 0, ' +
    'refunded_amount INTEGER NOT NULL DEFAULT 0, refunded_gems INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, paid_at INTEGER, updated_at INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS shop_orders_player ON shop_orders (player_id, created_at)',
  'CREATE INDEX IF NOT EXISTS shop_orders_intent ON shop_orders (payment_intent)',
  // Gems a refund could not take back because they were already spent; taken from the next purchase.
  'CREATE TABLE IF NOT EXISTS shop_owed (player_id TEXT PRIMARY KEY, gems INTEGER NOT NULL)'
];

const isLiveKey = key => /^(sk|rk)_live_/.test(key || '');
function shopState(env) {
  if (!env.SAVES_DB) return {open: false, reason: 'cloud-not-configured'};
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return {open: false, reason: 'shop-not-configured'};
  const live = isLiveKey(env.STRIPE_SECRET_KEY);
  if (live && env.SHOP_LIVE !== '1') return {open: false, reason: 'live-key-blocked'};
  return {open: true, mode: live ? 'live' : 'test'};
}
const totalGems = pack => pack.gems + pack.bonus;
const publicPack = p => ({id: p.id, name: p.name, gems: p.gems, bonus: p.bonus, price: p.amount / 100, currency: 'THB'});
const publicOrder = o => ({id: o.id, pack: o.pack, gems: o.gems, price: o.amount / 100, currency: o.currency.toUpperCase(),
  status: o.status, refundedGems: o.refunded_gems, createdAt: o.created_at, paidAt: o.paid_at});
const monthStart = now => { const d = new Date(now + 7 * 3600000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - 7 * 3600000; }; // Bangkok month

// ---- Stripe ----
function form(params, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(params)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value && typeof value === 'object') form(value, name, out); else if (value !== undefined) out.append(name, String(value));
  }
  return out;
}
async function stripe(env, path, params, idempotencyKey) {
  const headers = {Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded'};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const response = await fetch((env.STRIPE_API_BASE || STRIPE) + path, {method: 'POST', headers, body: form(params)})
    .catch(() => { throw Object.assign(new Error('payment-provider'), {status: 502}); });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error('payment-provider'), {status: 502, detail: data?.error?.message});
  return data;
}
const hex = buffer => Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, '0')).join('');
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
// Stripe-Signature: t=<unix>,v1=<hex hmac of "t.body">[,v1=...]
export async function verifySignature(secret, header, payload, nowSeconds) {
  const parts = String(header || '').split(','), t = Number(parts.find(p => p.startsWith('t='))?.slice(2));
  const sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowSeconds - t) > TOLERANCE) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const expected = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`)));
  return sigs.some(s => sameText(s, expected));
}

// ---- gems ----
async function grantOrder(db, order, now) {
  // Gems a past refund could not take back come out of this purchase first.
  const owed = (await db.prepare('SELECT gems FROM shop_owed WHERE player_id = ?').bind(order.player_id).first())?.gems || 0;
  const keep = Math.min(owed, order.gems), gems = order.gems - keep;
  const result = await credit(db, order.player_id, {gems}, {kind: 'shop-purchase', ref: 'pay:' + order.id, detail: {pack: order.pack, gems: order.gems, owedPaid: keep}});
  if (result.applied && keep) await db.prepare('UPDATE shop_owed SET gems = gems - ? WHERE player_id = ?').bind(keep, order.player_id).run();
  await db.prepare("UPDATE shop_orders SET status = 'paid', paid_at = ?, updated_at = ? WHERE id = ? AND status IN ('created', 'expired', 'failed')")
    .bind(now, now, order.id).run();
}
// Take back the share of gems matching the share of money returned (refunded is cumulative, in satang).
async function clawBack(db, order, refunded, status, ref, now) {
  const target = Math.min(order.gems, Math.floor(order.gems * Math.min(refunded, order.amount) / order.amount));
  const remove = target - order.refunded_gems;
  if (remove > 0) {
    let taken = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const have = Math.max(0, (await getWallet(db, order.player_id))?.gems || 0), take = Math.min(remove, have);
      if (!take) break;
      const result = await debit(db, order.player_id, {gems: take}, {kind: 'shop-refund', ref, detail: {order: order.id, refunded, wanted: remove}});
      if (result.applied || result.duplicate) { taken = take; break; }
      if (result.error !== 'insufficient') throw new Error('wallet');
    }
    if (remove > taken) await db.prepare('INSERT INTO shop_owed (player_id, gems) VALUES (?1, ?2) ON CONFLICT (player_id) DO UPDATE SET gems = gems + ?2')
      .bind(order.player_id, remove - taken).run();
  }
  await db.prepare('UPDATE shop_orders SET status = ?, refunded_amount = MAX(refunded_amount, ?), refunded_gems = MAX(refunded_gems, ?), updated_at = ? WHERE id = ?')
    .bind(status, refunded, target, now, order.id).run();
}

async function webhook(request, env, db, now) {
  const payload = await request.text();
  if (payload.length > 256 * 1024) return fail(413, 'too-large');
  if (!await verifySignature(env.STRIPE_WEBHOOK_SECRET, request.headers.get('Stripe-Signature'), payload, Math.floor(now / 1000))) return fail(400, 'bad-signature');
  const event = JSON.parse(payload), object = event?.data?.object || {};
  if (event.livemode && env.SHOP_LIVE !== '1') return json({received: true, ignored: 'live-mode'});
  const byId = id => db.prepare('SELECT * FROM shop_orders WHERE id = ?').bind(String(id || '')).first();
  const byIntent = id => id ? db.prepare('SELECT * FROM shop_orders WHERE payment_intent = ?').bind(String(id)).first() : null;

  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const order = await byId(object.metadata?.order_id || object.client_reference_id);
    if (!order) return json({received: true, ignored: 'unknown-order'});
    // Only the session we created, for the exact amount we asked, credits anything.
    if (object.id !== order.session_id || object.amount_total !== order.amount || String(object.currency).toLowerCase() !== order.currency)
      return json({received: true, ignored: 'mismatch'});
    if (object.payment_intent) await db.prepare('UPDATE shop_orders SET payment_intent = ?, livemode = ? WHERE id = ?')
      .bind(String(object.payment_intent), event.livemode ? 1 : 0, order.id).run();
    if (object.payment_status === 'paid' && !['refunded', 'partially_refunded', 'disputed'].includes(order.status)) await grantOrder(db, order, now);
    return json({received: true});
  }
  if (event.type === 'checkout.session.expired' || event.type === 'checkout.session.async_payment_failed') {
    const order = await byId(object.metadata?.order_id || object.client_reference_id);
    if (order) await db.prepare("UPDATE shop_orders SET status = ?, updated_at = ? WHERE id = ? AND status = 'created'")
      .bind(event.type.endsWith('expired') ? 'expired' : 'failed', now, order.id).run();
    return json({received: true});
  }
  if (event.type === 'charge.refunded') {
    const order = await byIntent(object.payment_intent);
    if (!order || order.status === 'created') return json({received: true, ignored: 'unknown-order'});
    const refunded = Number(object.amount_refunded) || 0;
    if (order.status !== 'disputed') await clawBack(db, order, refunded, refunded >= order.amount ? 'refunded' : 'partially_refunded', `refund:${order.id}:${refunded}`, now);
    return json({received: true});
  }
  if (event.type === 'charge.dispute.created') {
    const order = await byIntent(object.payment_intent);
    if (order && order.status !== 'created') await clawBack(db, order, order.amount, 'disputed', 'dispute:' + order.id, now);
    return json({received: true});
  }
  return json({received: true, ignored: event.type});
}

async function route(request, env, path, now) {
  const method = request.method, state = shopState(env), db = env.SAVES_DB;
  if (path === 'config' && method === 'GET')
    return json({...state, currency: 'THB', packs: state.open ? PACKS.map(publicPack) : [], monthlyLimit: Number(env.SHOP_MONTHLY_LIMIT_THB || 3000)});
  if (!state.open) return fail(503, state.reason);
  await Promise.all([ensureWallet(db), ensureSchema(db, 'shop', SCHEMA)]);

  if (path === 'webhook' && method === 'POST') return webhook(request, env, db, now);

  const auth = await authenticate(request, db, now);
  if (!auth) return fail(401, 'signed-out');

  if (path === 'wallet' && method === 'GET') {
    const [wallet, orders, owed] = await Promise.all([getWallet(db, auth.playerId),
      db.prepare("SELECT * FROM shop_orders WHERE player_id = ? AND status != 'created' ORDER BY created_at DESC LIMIT 30").bind(auth.playerId).all(),
      db.prepare('SELECT gems FROM shop_owed WHERE player_id = ?').bind(auth.playerId).first()]);
    return json({playerId: auth.playerId, gems: wallet?.gems || 0, owed: owed?.gems || 0, mode: state.mode, orders: (orders.results || []).map(publicOrder)});
  }
  const order = path.match(/^order\/([A-Za-z0-9_-]{8,64})$/);
  if (order && method === 'GET') {
    const row = await db.prepare('SELECT * FROM shop_orders WHERE id = ? AND player_id = ?').bind(order[1], auth.playerId).first();
    if (!row) return fail(404, 'unknown-order');
    return json({order: publicOrder(row), gems: (await getWallet(db, auth.playerId))?.gems || 0});
  }
  if (path === 'checkout' && method === 'POST') {
    const body = await readBody(request), pack = PACKS.find(p => p.id === body.pack);
    if (!pack) return fail(400, 'unknown-pack');
    // Spending cap per Bangkok calendar month, counting paid orders and ones still open.
    const spent = await db.prepare("SELECT COALESCE(SUM(amount), 0) AS total, SUM(CASE WHEN status = 'created' AND created_at > ?3 THEN 1 ELSE 0 END) AS open " +
      "FROM shop_orders WHERE player_id = ?1 AND created_at >= ?2 AND status IN ('created', 'paid')").bind(auth.playerId, monthStart(now), now - 3600000).first();
    if ((spent?.open || 0) >= 5) return fail(429, 'too-many-open-orders');
    if ((spent?.total || 0) + pack.amount > Number(env.SHOP_MONTHLY_LIMIT_THB || 3000) * 100) return fail(403, 'monthly-limit');
    const id = 'ord_' + crypto.randomUUID().replace(/-/g, ''), origin = new URL(request.url).origin;
    await db.prepare("INSERT INTO shop_orders (id, player_id, pack, gems, amount, currency, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'thb', 'created', ?, ?)")
      .bind(id, auth.playerId, pack.id, totalGems(pack), pack.amount, now, now).run();
    // An order Stripe never accepted is removed, so it does not count against the monthly cap.
    const session = await stripe(env, 'checkout/sessions', {
      mode: 'payment', locale: 'th', client_reference_id: id,
      payment_method_types: Object.fromEntries((env.SHOP_METHODS || 'card,promptpay').split(',').map((m, i) => [i, m.trim()])),
      line_items: {0: {quantity: 1, price_data: {currency: 'thb', unit_amount: pack.amount,
        product_data: {name: `Little Rescue · ${pack.name} 💎 ${totalGems(pack)}`, description: 'เพชรใช้สุ่มเพื่อนในเกม Little Rescue'}}}},
      metadata: {order_id: id, player_id: auth.playerId, pack: pack.id},
      payment_intent_data: {metadata: {order_id: id, player_id: auth.playerId}},
      success_url: `${origin}/?shop=done&order=${id}`, cancel_url: `${origin}/?shop=cancel&order=${id}`,
      expires_at: Math.floor(now / 1000) + 1800
    }, id).catch(async error => { await db.prepare("DELETE FROM shop_orders WHERE id = ? AND status = 'created'").bind(id).run(); throw error; });
    await db.prepare('UPDATE shop_orders SET session_id = ?, livemode = ? WHERE id = ?').bind(session.id, session.livemode ? 1 : 0, id).run();
    return json({order: id, url: session.url}, 201);
  }
  return fail(404, 'not-found');
}

export async function onRequest(context) {
  const {request, env, params} = context;
  const path = [].concat(params.path || []).join('/');
  // Same-origin only, except the webhook, which Stripe calls server to server (and proves with its signature).
  const origin = request.headers.get('Origin');
  if (path !== 'webhook' && origin && origin !== new URL(request.url).origin) return fail(403, 'cross-origin');
  try { return await route(request, env, path, Date.now()); }
  catch (error) { return fail(error.status || 500, error.status ? error.message : 'server-error'); }
}
