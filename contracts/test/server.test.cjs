// The game server's testnet code (functions/_lib/evm.js, chain.js) against the local hardhat chain.
const {expect} = require('chai');
const hre = require('hardhat');
const {ethers} = hre;
const {D1} = require('./d1-shim.cjs');

const lib = path => import(require('node:path').resolve(__dirname, '../../functions/_lib', path));
// fetch() for the RPC client, answered by the in-process hardhat chain.
const fetchImpl = async (_url, {body}) => {
  const {id, method, params} = JSON.parse(body);
  let reply;
  try { reply = {jsonrpc: '2.0', id, result: await hre.network.provider.request({method, params})}; }
  catch (error) { reply = {jsonrpc: '2.0', id, error: {message: error.message, data: error.data}}; }
  return {json: async () => reply};
};

describe('evm.js', () => {
  let evm;
  before(async () => { evm = await lib('evm.js'); });

  it('signs EIP-1559 transactions exactly like ethers', async () => {
    const wallet = ethers.Wallet.createRandom();
    const tx = {chainId: 84532, nonce: 7, maxPriorityFeePerGas: 1000000n, maxFeePerGas: 3000000n, gas: 210000n,
      to: '0x' + '11'.repeat(20), value: 0n, data: '0xabcdef'};
    const ours = await evm.signTransaction(tx, wallet.privateKey);
    const theirs = await wallet.signTransaction({...tx, type: 2, gasLimit: tx.gas});
    expect(ours.raw).to.equal(theirs);
    expect(ours.hash).to.equal(ethers.keccak256(theirs));
    const create = await evm.signTransaction({...tx, to: '', data: '0x6000'}, wallet.privateKey);
    expect(ethers.Transaction.from(create.raw).to).to.equal(null);
  });

  it('encodes the two mint calls like the ABI', async () => {
    const ref = ethers.id('x'), to = ethers.Wallet.createRandom().address;
    const token = new ethers.Interface(['function mint(address,uint256,bytes32)']);
    const heroes = new ethers.Interface(['function mint(address,string,bytes32)']);
    expect(evm.encodeCall('mint(address,uint256,bytes32)', ['address', 'uint256', 'bytes32'], [to, 10n ** 20n, ref]))
      .to.equal(token.encodeFunctionData('mint', [to, 10n ** 20n, ref]));
    for (const hero of ['sugar-01', 'sticker-kangaroo', 'a'.repeat(32)]) {
      expect(evm.encodeCall('mint(address,string,bytes32)', ['address', 'string', 'bytes32'], [to, hero, ref]))
        .to.equal(heroes.encodeFunctionData('mint', [to, hero, ref]));
    }
  });

  it('recovers personal_sign signers and checksums addresses', async () => {
    const wallet = ethers.Wallet.createRandom(), message = 'Little Rescue testnet\nบัญชี: LR-AAAA-BBBB';
    expect(evm.recoverPersonal(message, await wallet.signMessage(message))).to.equal(wallet.address);
    expect(evm.recoverPersonal(message + '!', await wallet.signMessage(message))).to.not.equal(wallet.address);
    expect(evm.recoverPersonal(message, '0x1234')).to.equal('');
    expect(evm.checksum(wallet.address.toLowerCase())).to.equal(wallet.address);
    expect(evm.addressOfKey(wallet.privateKey)).to.equal(wallet.address);
  });
});

describe('chain.js on a local chain', function () {
  this.timeout(60000);
  let chain, walletLib, db, cfg, minter, player;
  const P = 'LR-TEST-0001';

  before(async () => {
    chain = await lib('chain.js'); walletLib = await lib('wallet.js');
    const [signer, other] = await ethers.getSigners();
    minter = signer; player = other;
    db = new D1();
    cfg = chain.chainEnv({CHAIN_TESTNET: '1', SAVES_DB: db, CHAIN_MINTER_KEY: hardhatKey(), CHAIN_ALLOW_LOCAL: '1', CHAIN_RPC_URL: 'http://local'});
    expect(cfg.on).to.equal(true);
    await chain.setupChain(db);
  });

  it('is off without the switch or the key', async () => {
    expect(chain.chainEnv({SAVES_DB: db, CHAIN_MINTER_KEY: hardhatKey()}).reason).to.equal('off');
    expect(chain.chainEnv({CHAIN_TESTNET: '1', SAVES_DB: db}).reason).to.equal('no-minter-key');
  });

  it('refuses a chain that is not the testnet', async () => {
    const strict = {...cfg, allowLocal: false};
    let error; try { await chain.send(strict, {to: '', data: '0x00'}, fetchImpl); } catch (e) { error = e; }
    expect(error?.message).to.equal('wrong-chain');
  });

  it('deploys both contracts at the addresses it predicts', async () => {
    const nonce = await ethers.provider.getTransactionCount(minter.address);
    const result = await chain.deploy(db, cfg, 'https://game.test/nft/', Date.now(), fetchImpl);
    expect(result.token).to.equal(ethers.getCreateAddress({from: minter.address, nonce}));
    expect(result.heroes).to.equal(ethers.getCreateAddress({from: minter.address, nonce: nonce + 1}));
    const token = await ethers.getContractAt('RescueTestToken', result.token);
    expect(await token.symbol()).to.equal('tLRT');
    expect(await token.cap()).to.equal(10n ** 27n);
    expect((await chain.overview(db, cfg, fetchImpl)).live).to.deep.equal({token: true, heroes: true});
  });

  it('links a wallet, signed or pasted', async () => {
    const pasted = await chain.link(db, P, {address: player.address.toLowerCase()});
    expect(pasted).to.deep.equal({address: player.address, verified: false});
    const at = Date.now(), signature = await player.signMessage(chain.linkMessage(P, at));
    expect(await chain.link(db, P, {address: player.address, signature, at})).to.deep.equal({address: player.address, verified: true});
    expect((await chain.link(db, P, {address: minter.address, signature, at})).error).to.equal('bad-signature');
    expect((await chain.link(db, P, {address: player.address, signature, at: at - 3600e3})).error).to.equal('stale-signature');
    expect((await chain.link(db, P, {address: 'nope'})).error).to.equal('bad-address');
  });

  it('pays the daily test tokens once, only after a stage is cleared', async () => {
    await walletLib.apply(db, P, {ref: 'setup-1', kind: 'test'}, () => ({}));
    expect((await chain.claim(db, cfg, P, {kind: 'token'}, Date.now(), fetchImpl)).error).to.equal('play-first');
    await walletLib.apply(db, P, {ref: 'setup-2', kind: 'test'}, w => { w.cleared = 1; return {}; });
    const first = await chain.claim(db, cfg, P, {kind: 'token'}, Date.now(), fetchImpl);
    expect(first.status).to.equal(201);
    expect(first.claim.status).to.equal('sent');
    const {token} = await chain.contracts(db, cfg);
    expect(await (await ethers.getContractAt('RescueTestToken', token)).balanceOf(player.address)).to.equal(100n * 10n ** 18n);
    const again = await chain.claim(db, cfg, P, {kind: 'token'}, Date.now() + 1000, fetchImpl);
    expect(again.error).to.equal('already-claimed');
    const s = await chain.status(db, cfg, P, Date.now() + 2000, fetchImpl);
    expect(s.today.claim.status).to.equal('done');
    expect(s.today.canClaim).to.equal(false);
  });

  it('mints a hero NFT only at the required stars, once', async () => {
    expect((await chain.claim(db, cfg, P, {kind: 'hero', unit: 'sugar-01'}, Date.now(), fetchImpl)).error).to.equal('need-stars');
    expect((await chain.claim(db, cfg, P, {kind: 'hero', unit: 'sticker-bison'}, Date.now(), fetchImpl)).error).to.equal('hero-locked');
    expect((await chain.claim(db, cfg, P, {kind: 'hero', unit: 'nobody'}, Date.now(), fetchImpl)).error).to.equal('bad-hero');
    await walletLib.apply(db, P, {ref: 'setup-3', kind: 'test'}, w => { w.units['sugar-01'].star = 3; return {}; });
    const minted = await chain.claim(db, cfg, P, {kind: 'hero', unit: 'sugar-01'}, Date.now(), fetchImpl);
    expect(minted.status).to.equal(201);
    const heroes = await ethers.getContractAt('RescueTestHeroes', (await chain.contracts(db, cfg)).heroes);
    expect(await heroes.ownerOf(1)).to.equal(player.address);
    expect(await heroes.tokenURI(1)).to.equal('https://game.test/nft/sugar-01.json');
    expect((await chain.claim(db, cfg, P, {kind: 'hero', unit: 'sugar-01'}, Date.now() + 1, fetchImpl)).error).to.equal('already-claimed');
    const s = await chain.status(db, cfg, P, Date.now(), fetchImpl);
    expect(s.heroes.find(h => h.unit === 'sugar-01')).to.include({eligible: true});
  });

  it('never mints twice when an answer was lost', async () => {
    // Pretend the server crashed after sending: the row says failed, but the chain already has the NFT.
    await db.prepare("UPDATE chain_claims SET status = 'failed', updated_at = 0 WHERE kind = 'hero'").run();
    const retry = await chain.claim(db, cfg, P, {kind: 'hero', unit: 'sugar-01'}, Date.now() + 5, fetchImpl);
    expect(retry.status).to.equal(201);
    expect(retry.claim.status).to.equal('done');
    const heroes = await ethers.getContractAt('RescueTestHeroes', (await chain.contracts(db, cfg)).heroes);
    expect(await heroes.totalMinted()).to.equal(1n);
  });

  it('needs a linked wallet', async () => {
    expect((await chain.claim(db, cfg, 'LR-TEST-0002', {kind: 'token'}, Date.now(), fetchImpl)).error).to.equal('no-wallet');
  });
});

// hardhat's first default account, derived from its public test mnemonic (local chain only)
function hardhatKey() { return ethers.HDNodeWallet.fromPhrase('test test test test test test test test test test test junk', undefined, "m/44'/60'/0'/0/0").privateKey; }
