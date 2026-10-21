// Testnet main token + hero NFTs (1.18). TESTNET ONLY: Base Sepolia, chain id 84532. Nothing here has money value,
// nothing is bought or sold, and coins/gems never turn into tokens (token plan: gold stays inside each game).
// Not a route: functions/api/chain/[[path]].js (players) and functions/api/admin/[[path]].js (deploy) call it.
//
// Turned on only when the owner sets, in Cloudflare Pages settings:
//   CHAIN_TESTNET=1          variable, the switch
//   CHAIN_MINTER_KEY         secret, the private key of a NEW wallet used only for this testnet (holds test ETH for gas)
// Optional: CHAIN_RPC_URL (default https://sepolia.base.org), CHAIN_TOKEN_ADDRESS / CHAIN_HEROES_ADDRESS (otherwise
// the addresses the admin page's deploy button saved), CHAIN_DAILY_TOKENS (default 100), CHAIN_HERO_STAR (default 3).
// The server refuses to send anything unless the RPC answers chain id 84532, so a wrong RPC URL can never reach a
// real-money chain; the contracts themselves also refuse to deploy anywhere else.
//
// Every claim is one row in chain_claims, keyed by (player, kind, item), and its on-chain ref is keccak(claim id).
// The contracts accept each ref once, so a retried or doubled request can never mint twice.

import {ensureSchema} from './http.js';
import {getWallet} from './wallet.js';
import {UNIT_IDS, BASE_HEROES} from './economy.js';
import {isAddress, checksum, addressOfKey, validKey, recoverPersonal, encodeCall, encodeArgs, signTransaction, rpcClient, keccak, toHex, fromHex, rlp, selector} from './evm.js';
import {TOKEN, HEROES} from './chain-contracts.js';

export const NETWORK = {name: 'Base Sepolia', chainId: 84532, explorer: 'https://sepolia.basescan.org', rpc: 'https://sepolia.base.org',
  faucet: 'https://docs.base.org/base-chain/tools/network-faucets'};
const LOCAL_CHAIN = 31337; // the hardhat test chain, allowed only when CHAIN_ALLOW_LOCAL=1 (tests)
export const DECIMALS = 18n;
export const SUPPLY = {cap: 1000000000n, daily: 1000000n}; // whole tokens: total cap and whole-system daily mint cap
const STALE_PENDING = 2 * 60e3;
const LINK_WINDOW = 10 * 60e3;
const THAI = 7 * 3600000;
const thaiDate = now => new Date(now + THAI).toISOString().slice(0, 10);

export const CHAIN_SCHEMA = [
  'CREATE TABLE IF NOT EXISTS chain_links (player_id TEXT PRIMARY KEY, address TEXT NOT NULL, verified INTEGER NOT NULL, linked_at INTEGER NOT NULL)',
  `CREATE TABLE IF NOT EXISTS chain_claims (id TEXT PRIMARY KEY, player_id TEXT NOT NULL, kind TEXT NOT NULL, item TEXT NOT NULL,
    address TEXT NOT NULL, amount TEXT NOT NULL, status TEXT NOT NULL, tx_hash TEXT, error TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, UNIQUE (player_id, kind, item))`,
  'CREATE INDEX IF NOT EXISTS chain_claims_status ON chain_claims (status, updated_at)',
  'CREATE TABLE IF NOT EXISTS chain_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)'
];
export const setupChain = db => ensureSchema(db, 'chain', CHAIN_SCHEMA);

const positive = (value, fallback, max) => { const n = Number(value); return Number.isSafeInteger(n) && n > 0 && n <= max ? n : fallback; };
export function chainEnv(env) {
  const key = (env.CHAIN_MINTER_KEY || '').trim();
  return {
    on: env.CHAIN_TESTNET === '1' && Boolean(env.SAVES_DB) && validKey(key),
    reason: env.CHAIN_TESTNET !== '1' ? 'off' : !env.SAVES_DB ? 'cloud-not-configured' : !validKey(key) ? 'no-minter-key' : '',
    key, rpc: env.CHAIN_RPC_URL || NETWORK.rpc, allowLocal: env.CHAIN_ALLOW_LOCAL === '1',
    dailyTokens: positive(env.CHAIN_DAILY_TOKENS, 100, 10000), heroStar: positive(env.CHAIN_HERO_STAR, 3, 5),
    tokenOverride: isAddress(env.CHAIN_TOKEN_ADDRESS) ? checksum(env.CHAIN_TOKEN_ADDRESS) : '',
    heroesOverride: isAddress(env.CHAIN_HEROES_ADDRESS) ? checksum(env.CHAIN_HEROES_ADDRESS) : ''
  };
}

export async function contracts(db, cfg) {
  const rows = (await db.prepare("SELECT key, value FROM chain_config WHERE key IN ('token', 'heroes')").all()).results;
  const saved = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {token: cfg.tokenOverride || saved.token || '', heroes: cfg.heroesOverride || saved.heroes || ''};
}

// ---- sending ----
async function chainRpc(cfg, fetchImpl) {
  const rpc = rpcClient(cfg.rpc, fetchImpl);
  const id = Number(BigInt(await rpc('eth_chainId')));
  if (id !== NETWORK.chainId && !(cfg.allowLocal && id === LOCAL_CHAIN)) throw Object.assign(new Error('wrong-chain'), {status: 503, chainId: id});
  return {rpc, chainId: id};
}
const REF_USED = toHex(selector('RefUsed(bytes32)')), DAILY_CAP = toHex(selector('DailyCapExceeded(uint256,uint256)'));
const isRefUsed = text => (text || '').toLowerCase().includes(REF_USED);

// Signs and broadcasts one transaction from the minter wallet. to '' = contract creation.
// Retries with a fresh nonce when another request used the same one at the same moment.
export async function send(cfg, {to, data}, fetchImpl = fetch) {
  const {rpc, chainId} = await chainRpc(cfg, fetchImpl);
  const from = addressOfKey(cfg.key);
  const call = to ? {from, to, data} : {from, data};
  const estimate = BigInt(await rpc('eth_estimateGas', [call]));
  const gas = estimate + estimate / 5n + 10000n;
  for (let attempt = 0; ; attempt++) {
    const [nonce, block, tip] = await Promise.all([rpc('eth_getTransactionCount', [from, 'pending']),
      rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_maxPriorityFeePerGas').catch(() => '0x3b9aca00')]);
    const base = BigInt(block?.baseFeePerGas || '0x0'), priority = BigInt(tip);
    const tx = {chainId, nonce: BigInt(nonce), maxPriorityFeePerGas: priority, maxFeePerGas: base * 2n + priority, gas, to, value: 0n, data};
    const signed = await signTransaction(tx, cfg.key);
    try {
      await rpc('eth_sendRawTransaction', [signed.raw]);
      return {hash: signed.hash, nonce: tx.nonce, from};
    } catch (error) {
      if (attempt < 3 && /nonce|underpriced|already known/i.test(error.rpc || '')) continue;
      throw error;
    }
  }
}

// Contract address created by `from` at `nonce` (both contracts are deployed from the minter wallet).
export const createdAddress = (from, nonce) => checksum(toHex(keccak(rlp([fromHex(from), BigInt(nonce)])).slice(-20)));

// Admin: deploy the token and the hero NFT from the minter wallet, then remember their addresses.
export async function deploy(db, cfg, baseURI, now = Date.now(), fetchImpl = fetch) {
  const admin = addressOfKey(cfg.key), unit = 10n ** DECIMALS;
  const tokenData = TOKEN.bytecode + toHex(encodeArgs(['address', 'uint256', 'uint256'], [admin, SUPPLY.cap * unit, SUPPLY.daily * unit])).slice(2);
  const heroesData = HEROES.bytecode + toHex(encodeArgs(['address', 'string'], [admin, baseURI])).slice(2);
  const token = await send(cfg, {to: '', data: tokenData}, fetchImpl);
  const heroes = await send(cfg, {to: '', data: heroesData}, fetchImpl);
  const addresses = {token: createdAddress(admin, token.nonce), heroes: createdAddress(admin, heroes.nonce)};
  await db.batch([
    ...Object.entries(addresses).map(([key, value]) => db.prepare(`INSERT INTO chain_config (key, value, updated_at) VALUES (?1, ?2, ?3)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).bind(key, value, now)),
    db.prepare(`INSERT INTO chain_config (key, value, updated_at) VALUES ('deploy', ?1, ?2)
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .bind(JSON.stringify({tokenTx: token.hash, heroesTx: heroes.hash, baseURI, sources: TOKEN.sources}), now)
  ]);
  return {...addresses, tokenTx: token.hash, heroesTx: heroes.hash, minter: admin};
}

// Admin overview: minter address, its test ETH, contract addresses and whether code is there yet.
export async function overview(db, cfg, fetchImpl = fetch) {
  const minter = addressOfKey(cfg.key), addresses = await contracts(db, cfg);
  const deployRow = await db.prepare("SELECT value FROM chain_config WHERE key = 'deploy'").first();
  const counts = (await db.prepare('SELECT kind, status, COUNT(*) AS n FROM chain_claims GROUP BY kind, status').all()).results;
  let balance = null, live = {token: false, heroes: false}, chainError = '';
  try {
    const {rpc} = await chainRpc(cfg, fetchImpl);
    balance = (BigInt(await rpc('eth_getBalance', [minter, 'latest']))).toString();
    for (const k of ['token', 'heroes']) if (addresses[k]) live[k] = (await rpc('eth_getCode', [addresses[k], 'latest'])) !== '0x';
  } catch (error) { chainError = error.message; }
  return {network: NETWORK, minter, balanceWei: balance, ...addresses, live, chainError,
    deploy: deployRow ? JSON.parse(deployRow.value) : null, claims: counts};
}

// ---- players ----
export const linkMessage = (playerId, at) => `Little Rescue testnet (ทดลอง ไม่มีมูลค่าจริง)\nบัญชี: ${playerId}\nเวลา: ${new Date(at).toISOString()}`;

export async function link(db, playerId, body, now = Date.now()) {
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  if (!isAddress(address)) return {error: 'bad-address'};
  let verified = 0;
  if (body.signature !== undefined) {
    const at = Number(body.at);
    if (!Number.isSafeInteger(at) || Math.abs(now - at) > LINK_WINDOW) return {error: 'stale-signature'};
    if (recoverPersonal(linkMessage(playerId, at), String(body.signature)).toLowerCase() !== address.toLowerCase()) return {error: 'bad-signature'};
    verified = 1;
  }
  const value = checksum(address);
  await db.prepare(`INSERT INTO chain_links (player_id, address, verified, linked_at) VALUES (?1, ?2, ?3, ?4)
    ON CONFLICT (player_id) DO UPDATE SET address = excluded.address, verified = excluded.verified, linked_at = excluded.linked_at`)
    .bind(playerId, value, verified, now).run();
  return {address: value, verified: verified === 1};
}
export const unlink = (db, playerId) => db.prepare('DELETE FROM chain_links WHERE player_id = ?').bind(playerId).run();

const publicClaim = c => ({kind: c.kind, item: c.item, amount: c.amount, status: c.status, txHash: c.tx_hash || null,
  address: c.address, at: c.created_at, explorer: c.tx_hash ? `${NETWORK.explorer}/tx/${c.tx_hash}` : null});

// A sent transaction becomes 'done' once mined, or 'failed' if it reverted (it can then be claimed again).
async function confirm(db, cfg, claims, now, fetchImpl) {
  const sent = claims.filter(c => c.status === 'sent' && c.tx_hash).slice(0, 5);
  if (!sent.length) return;
  try {
    const {rpc} = await chainRpc(cfg, fetchImpl);
    for (const c of sent) {
      const receipt = await rpc('eth_getTransactionReceipt', [c.tx_hash]);
      if (!receipt) continue;
      c.status = receipt.status === '0x1' ? 'done' : 'failed';
      await db.prepare('UPDATE chain_claims SET status = ?, error = ?, updated_at = ? WHERE id = ?')
        .bind(c.status, c.status === 'failed' ? 'reverted' : null, now, c.id).run();
    }
  } catch (_) { /* the chain is slow or down: try again on the next look */ }
}

export async function status(db, cfg, playerId, now = Date.now(), fetchImpl = fetch) {
  const addresses = await contracts(db, cfg);
  const base = {enabled: true, testnet: true, network: NETWORK, token: addresses.token, heroes: addresses.heroes,
    ready: Boolean(addresses.token && addresses.heroes), rules: {dailyTokens: cfg.dailyTokens, heroStar: cfg.heroStar, symbol: 'tLRT'}};
  if (!playerId) return base;
  const linkRow = await db.prepare('SELECT address, verified FROM chain_links WHERE player_id = ?').bind(playerId).first();
  const claims = (await db.prepare('SELECT * FROM chain_claims WHERE player_id = ? ORDER BY created_at DESC LIMIT 60').bind(playerId).all()).results;
  await confirm(db, cfg, claims, now, fetchImpl);
  const wallet = await getWallet(db, playerId);
  const heroes = UNIT_IDS.map((unit, i) => {
    const owned = Boolean(wallet) && (i < BASE_HEROES || wallet.units[unit]?.owned === true), star = wallet?.units[unit]?.star ?? 1;
    const claim = claims.find(c => c.kind === 'hero' && c.item === unit);
    return {unit, owned, star, eligible: owned && star >= cfg.heroStar, claim: claim ? publicClaim(claim) : null};
  });
  const today = thaiDate(now), tokenClaim = claims.find(c => c.kind === 'token' && c.item === today);
  return {...base, playerId, linked: linkRow ? {address: linkRow.address, verified: linkRow.verified === 1} : null,
    message: linkMessage(playerId, now), messageAt: now, cleared: wallet?.cleared ?? 0,
    today: {day: today, canClaim: Boolean(wallet && wallet.cleared >= 1) && (!tokenClaim || tokenClaim.status === 'failed'), claim: tokenClaim ? publicClaim(tokenClaim) : null},
    heroes, history: claims.slice(0, 20).map(publicClaim)};
}

// kind 'token' (today's test tokens) or 'hero' (one NFT per hero per account). Returns {claim} or {error, status}.
export async function claim(db, cfg, playerId, body, now = Date.now(), fetchImpl = fetch) {
  const addresses = await contracts(db, cfg);
  if (!addresses.token || !addresses.heroes) return {status: 503, error: 'not-deployed'};
  const linkRow = await db.prepare('SELECT address FROM chain_links WHERE player_id = ?').bind(playerId).first();
  if (!linkRow) return {status: 409, error: 'no-wallet'};
  const wallet = await getWallet(db, playerId);
  if (!wallet) return {status: 409, error: 'no-server-wallet'};

  let kind, item, amount, to, data;
  if (body.kind === 'token') {
    if (wallet.cleared < 1) return {status: 403, error: 'play-first'};
    kind = 'token'; item = thaiDate(now); amount = String(BigInt(cfg.dailyTokens) * 10n ** DECIMALS); to = addresses.token;
  } else if (body.kind === 'hero') {
    const i = UNIT_IDS.indexOf(body.unit);
    if (i < 0) return {status: 400, error: 'bad-hero'};
    if (!(i < BASE_HEROES || wallet.units[body.unit]?.owned === true)) return {status: 403, error: 'hero-locked'};
    if ((wallet.units[body.unit]?.star ?? 1) < cfg.heroStar) return {status: 403, error: 'need-stars'};
    kind = 'hero'; item = body.unit; amount = '1'; to = addresses.heroes;
  } else return {status: 400, error: 'bad-kind'};

  const id = `${kind}:${playerId}:${item}`, ref = toHex(keccak('little-rescue:' + id));
  await db.prepare(`INSERT OR IGNORE INTO chain_claims (id, player_id, kind, item, address, amount, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).bind(id, playerId, kind, item, linkRow.address, amount, now, now).run();
  let row = await db.prepare('SELECT * FROM chain_claims WHERE id = ?').bind(id).first();
  if (row.status === 'sent' || row.status === 'done') return {status: 409, error: 'already-claimed', claim: publicClaim(row)};
  // Someone else's request is sending this claim right now.
  if (row.status === 'pending' && row.created_at !== now && now - row.updated_at < STALE_PENDING) return {status: 202, claim: publicClaim(row)};
  // Take the claim (compare-and-swap on updated_at) so two requests never send it together.
  const took = await db.prepare("UPDATE chain_claims SET status = 'pending', address = ?, error = NULL, updated_at = ? WHERE id = ? AND updated_at = ? RETURNING id")
    .bind(linkRow.address, now + 1, id, row.updated_at).first();
  if (!took) return {status: 202, claim: publicClaim(row)};

  data = kind === 'token'
    ? encodeCall('mint(address,uint256,bytes32)', ['address', 'uint256', 'bytes32'], [linkRow.address, amount, ref])
    : encodeCall('mint(address,string,bytes32)', ['address', 'string', 'bytes32'], [linkRow.address, item, ref]);
  try {
    const sent = await send(cfg, {to, data}, fetchImpl);
    await db.prepare("UPDATE chain_claims SET status = 'sent', tx_hash = ?, updated_at = ? WHERE id = ?").bind(sent.hash, now + 1, id).run();
  } catch (error) {
    // The contract already used this ref: an earlier attempt did mint, only its answer was lost.
    const used = isRefUsed(error.rpc);
    await db.prepare('UPDATE chain_claims SET status = ?, error = ?, updated_at = ? WHERE id = ?')
      .bind(used ? 'done' : 'failed', used ? null : String(error.rpc || error.message).slice(0, 300), now + 1, id).run();
    if (!used) return {status: error.status || 502, error: (error.rpc || '').toLowerCase().includes(DAILY_CAP) ? 'daily-cap' : 'chain-busy'};
  }
  row = await db.prepare('SELECT * FROM chain_claims WHERE id = ?').bind(id).first();
  return {status: 201, claim: publicClaim(row)};
}
