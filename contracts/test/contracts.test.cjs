const {expect} = require('chai');
const {ethers} = require('hardhat');

const ref = text => ethers.id(text);
const day = 86400;
const units = n => ethers.parseUnits(String(n), 18);

describe('RescueTestToken', () => {
  async function deploy() {
    const [admin, player, other] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory('RescueTestToken')).deploy(admin.address, units(1000), units(100));
    return {token, admin, player, other};
  }

  it('is named as a test token', async () => {
    const {token} = await deploy();
    expect(await token.symbol()).to.equal('tLRT');
    expect(await token.cap()).to.equal(units(1000));
  });

  it('mints once per ref', async () => {
    const {token, player} = await deploy();
    await expect(token.mint(player.address, units(10), ref('a'))).to.emit(token, 'Claimed');
    expect(await token.balanceOf(player.address)).to.equal(units(10));
    await expect(token.mint(player.address, units(10), ref('a'))).to.be.revertedWithCustomError(token, 'RefUsed');
  });

  it('only the minter can mint', async () => {
    const {token, player} = await deploy();
    await expect(token.connect(player).mint(player.address, 1n, ref('b'))).to.be.revertedWithCustomError(token, 'AccessControlUnauthorizedAccount');
  });

  it('keeps the daily cap and resets it the next UTC day', async () => {
    const {token, player} = await deploy();
    await token.mint(player.address, units(60), ref('d1'));
    await expect(token.mint(player.address, units(50), ref('d2'))).to.be.revertedWithCustomError(token, 'DailyCapExceeded');
    expect(await token.remainingToday()).to.equal(units(40));
    await ethers.provider.send('evm_increaseTime', [day]);
    await ethers.provider.send('evm_mine', []);
    expect(await token.remainingToday()).to.equal(units(100));
    await token.mint(player.address, units(50), ref('d2'));
  });

  it('never goes over the total cap', async () => {
    const {token, player} = await deploy();
    for (let i = 0; i < 10; i++) {
      await token.mint(player.address, units(100), ref('c' + i));
      await ethers.provider.send('evm_increaseTime', [day]);
    }
    await ethers.provider.send('evm_mine', []);
    await expect(token.mint(player.address, 1n, ref('over'))).to.be.revertedWithCustomError(token, 'ERC20ExceededCap');
  });

  it('lets holders burn their own tokens', async () => {
    const {token, player} = await deploy();
    await token.mint(player.address, units(10), ref('burn'));
    await token.connect(player).burn(units(4));
    expect(await token.totalSupply()).to.equal(units(6));
  });
});

describe('RescueTestHeroes', () => {
  async function deploy() {
    const [admin, player, other] = await ethers.getSigners();
    const heroes = await (await ethers.getContractFactory('RescueTestHeroes')).deploy(admin.address, 'https://example.test/nft/');
    return {heroes, admin, player, other};
  }

  it('mints a hero with its metadata link', async () => {
    const {heroes, player} = await deploy();
    await expect(heroes.mint(player.address, 'sugar-01', ref('h1'))).to.emit(heroes, 'HeroMinted').withArgs(player.address, 1n, 'sugar-01', ref('h1'));
    expect(await heroes.ownerOf(1)).to.equal(player.address);
    expect(await heroes.heroOf(1)).to.equal('sugar-01');
    expect(await heroes.tokenURI(1)).to.equal('https://example.test/nft/sugar-01.json');
  });

  it('mints once per ref and refuses an empty hero', async () => {
    const {heroes, player} = await deploy();
    await heroes.mint(player.address, 'sugar-02', ref('h2'));
    await expect(heroes.mint(player.address, 'sugar-02', ref('h2'))).to.be.revertedWithCustomError(heroes, 'RefUsed');
    await expect(heroes.mint(player.address, '', ref('h3'))).to.be.revertedWithCustomError(heroes, 'BadHero');
  });

  it('only the minter mints and only the admin changes the link', async () => {
    const {heroes, player} = await deploy();
    await expect(heroes.connect(player).mint(player.address, 'sugar-01', ref('x'))).to.be.revertedWithCustomError(heroes, 'AccessControlUnauthorizedAccount');
    await expect(heroes.connect(player).setBaseURI('https://evil.test/')).to.be.revertedWithCustomError(heroes, 'AccessControlUnauthorizedAccount');
  });

  it('owners can trade their NFT', async () => {
    const {heroes, player, other} = await deploy();
    await heroes.mint(player.address, 'sugar-05', ref('t'));
    await heroes.connect(player).transferFrom(player.address, other.address, 1);
    expect(await heroes.ownerOf(1)).to.equal(other.address);
  });
});
