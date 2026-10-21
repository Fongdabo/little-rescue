// Just enough Ethereum for the testnet NFT and token (1.18): keccak, addresses, ABI encoding for the two contracts,
// EIP-1559 transaction signing, personal_sign recovery and a JSON-RPC client. Not a route: no onRequest handler.
// Crypto comes from the vendored @noble libraries (vendor/noble/README.md); nothing here talks to a real-money chain:
// chain.js checks eth_chainId before every send.

import {keccak_256} from './vendor/noble/sha3.js';
import * as secp from './vendor/noble/secp256k1.js';

const enc = new TextEncoder();
export const toHex = bytes => '0x' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export function fromHex(hex) {
  const h = String(hex).replace(/^0x/, '');
  if (h.length % 2 || /[^0-9a-fA-F]/.test(h)) throw new Error('bad-hex');
  return Uint8Array.from(h.match(/../g) || [], b => parseInt(b, 16));
}
export const keccak = data => keccak_256(typeof data === 'string' ? enc.encode(data) : data);
const concat = (...parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { out.set(p, i); i += p.length; } return out; };
const bigBytes = n => { if (n === 0n) return new Uint8Array(0); let h = n.toString(16); if (h.length % 2) h = '0' + h; return fromHex(h); };

// ---- addresses ----
export const isAddress = a => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
export function checksum(address) {
  const lower = address.toLowerCase().replace(/^0x/, ''), hash = toHex(keccak(lower)).slice(2);
  return '0x' + Array.from(lower, (c, i) => parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c).join('');
}
const addressOfPublicKey = pub => checksum(toHex(keccak(pub.slice(1)).slice(-20)));
export function addressOfKey(privateKeyHex) {
  return addressOfPublicKey(secp.getPublicKey(fromHex(privateKeyHex), false));
}
export const validKey = k => typeof k === 'string' && /^(0x)?[0-9a-fA-F]{64}$/.test(k.trim());

// personal_sign / eth_sign of a text message -> the signer's checksummed address, or '' when it does not parse.
export function recoverPersonal(message, signatureHex) {
  try {
    const sig = fromHex(signatureHex);
    if (sig.length !== 65) return '';
    let v = sig[64]; if (v >= 27) v -= 27;
    if (v !== 0 && v !== 1) return '';
    const body = enc.encode(message), hash = keccak(concat(enc.encode(`\x19Ethereum Signed Message:\n${body.length}`), body));
    const point = secp.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(hash);
    return addressOfPublicKey(point.toRawBytes(false));
  } catch (_) { return ''; }
}

// ---- ABI (only the static and string types the two contracts use) ----
const word = n => { const b = bigBytes(BigInt(n)); if (b.length > 32) throw new Error('too-big'); const w = new Uint8Array(32); w.set(b, 32 - b.length); return w; };
const padRight = b => { const out = new Uint8Array(Math.ceil(b.length / 32) * 32); out.set(b); return out; };
export const selector = signature => keccak(signature).slice(0, 4);
// types: 'address' | 'uint256' | 'bytes32' | 'string'
export function encodeArgs(types, values) {
  const heads = [], tails = [];
  let tailOffset = 32 * types.length;
  types.forEach((type, i) => {
    const v = values[i];
    if (type === 'string') {
      const body = enc.encode(v), tail = concat(word(body.length), padRight(body));
      heads.push(word(tailOffset)); tails.push(tail); tailOffset += tail.length;
    } else if (type === 'address') heads.push(word(BigInt(v)));
    else if (type === 'bytes32') { const b = fromHex(v); if (b.length !== 32) throw new Error('bad-bytes32'); heads.push(b); }
    else heads.push(word(BigInt(v)));
  });
  return concat(...heads, ...tails);
}
export const encodeCall = (signature, types, values) => toHex(concat(selector(signature), encodeArgs(types, values)));

// ---- RLP + EIP-1559 transactions ----
export function rlp(item) {
  if (Array.isArray(item)) { const body = concat(...item.map(rlp)); return concat(rlpLength(body.length, 0xc0), body); }
  const b = typeof item === 'bigint' || typeof item === 'number' ? bigBytes(BigInt(item)) : item;
  if (b.length === 1 && b[0] < 0x80) return b;
  return concat(rlpLength(b.length, 0x80), b);
}
function rlpLength(length, offset) {
  if (length < 56) return Uint8Array.of(offset + length);
  const l = bigBytes(BigInt(length)); return concat(Uint8Array.of(offset + 55 + l.length), l);
}
// tx: {chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gas, to ('' = contract creation), value, data}
export async function signTransaction(tx, privateKeyHex) {
  const fields = [BigInt(tx.chainId), BigInt(tx.nonce), BigInt(tx.maxPriorityFeePerGas), BigInt(tx.maxFeePerGas), BigInt(tx.gas),
    tx.to ? fromHex(tx.to) : new Uint8Array(0), BigInt(tx.value || 0), fromHex(tx.data || '0x'), []];
  const hash = keccak(concat(Uint8Array.of(2), rlp(fields)));
  const sig = await secp.signAsync(hash, fromHex(privateKeyHex));
  const raw = concat(Uint8Array.of(2), rlp([...fields, BigInt(sig.recovery), sig.r, sig.s]));
  return {raw: toHex(raw), hash: toHex(keccak(raw))};
}

// ---- JSON-RPC ----
export function rpcClient(url, fetchImpl = fetch) {
  let id = 0;
  return async (method, params = []) => {
    const response = await fetchImpl(url, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: ++id, method, params})}).catch(() => null);
    const data = response ? await response.json().catch(() => null) : null;
    if (!data) throw Object.assign(new Error('rpc-unreachable'), {status: 502});
    // Custom errors come back as revert data (selector first); keep it next to the message.
    if (data.error) throw Object.assign(new Error('rpc-error'), {status: 502,
      rpc: `${data.error.message || ''} ${typeof data.error.data === 'string' ? data.error.data : data.error.data?.data || ''}`.slice(0, 400)});
    return data.result;
  };
}
