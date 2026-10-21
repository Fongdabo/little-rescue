Vendored, unmodified except for import paths, from npm (MIT licence, audited by Cure53 / Kudelski):

- `secp256k1.js` = `@noble/secp256k1@2.3.0` `index.js`
- `sha3.js`, `_u64.js`, `utils.js`, `crypto.js` = `@noble/hashes@1.8.0` `esm/` (utils.js imports `./crypto.js`
  instead of `@noble/hashes/crypto`)

Pages Functions here are deployed without `npm install`, so these files are copied in. Used only by
`functions/_lib/evm.js` (testnet NFT and token, 1.18).
