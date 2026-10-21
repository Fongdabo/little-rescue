// Writes game/nft/<hero id>.json, the metadata the testnet hero NFTs point at (RescueTestHeroes.tokenURI).
// node tools/nft-metadata.mjs          write the files
// node tools/nft-metadata.mjs --check  fail if a file is missing or out of date (tools/check.mjs runs this)
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';

const GAME = new URL('../game/', import.meta.url).pathname, SITE = 'https://little-rescue.pages.dev/';
const {UNITS} = createRequire(import.meta.url)(GAME + 'engine.js');
// The game serves the .png names as .webp (app.js pwaAssetMap); point at the file that exists.
const served = asset => existsSync(GAME + 'assets/' + asset) ? asset : asset.replace(/\.png$/, '.webp');
const TYPES = {stone: 'หินอุ่น', star: 'แสงดาว', wind: 'สายลม'};
export function metadata(u) {
  return JSON.stringify({
    name: `${u.name} (ทดลอง testnet)`,
    description: `ฮีโร่จาก Little Rescue · NFT ทดลองบน Base Sepolia ไม่มีมูลค่าจริง เป็นเจ้าของได้แต่ไม่ได้เก่งกว่าฮีโร่ในเกม ` +
      `ลิขสิทธิ์ตัวละครยังเป็นของผู้สร้างเกม${u.story ? ' · ' + u.story : ''}`,
    image: SITE + 'assets/' + served(u.asset),
    external_url: SITE,
    attributes: [{trait_type: 'ธาตุ', value: TYPES[u.type] || u.type}, {trait_type: 'บทบาท', value: u.role}, {trait_type: 'เครือข่าย', value: 'testnet'}]
  }, null, 2) + '\n';
}
export function problems() {
  const out = [];
  for (const u of UNITS) {
    const file = `${GAME}nft/${u.id}.json`;
    if (!existsSync(GAME + 'assets/' + served(u.asset))) out.push(`nft/${u.id}.json: image assets/${served(u.asset)} is missing`);
    if (!existsSync(file) || readFileSync(file, 'utf8') !== metadata(u)) out.push(`nft/${u.id}.json is missing or out of date: run node tools/nft-metadata.mjs`);
  }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--check')) { const p = problems(); p.forEach(m => console.error(m)); process.exit(p.length ? 1 : 0); }
  mkdirSync(GAME + 'nft', {recursive: true});
  for (const u of UNITS) writeFileSync(`${GAME}nft/${u.id}.json`, metadata(u));
  console.log(`wrote ${UNITS.length} files in game/nft/`);
}
