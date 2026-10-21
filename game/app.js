/* Local prototype UI. Rendering uses copied, replaceable assets. No network APIs. */
'use strict';
(() => {
const {CONFIG,UNITS,ENEMIES,CLASSES,STAGES,CHAPTERS,LEVELS,ITEMS,levelCost,levelMultiplier,starMultiplier,EnergyBank,Battle}=window.Sideview;
const $=id=>document.getElementById(id);
const storageKey='little-rescue-sideview-save-v2';
let storage=null;try{storage=window.localStorage}catch{}
const saves=new window.SideviewSave.SaveStore({storage,locks:navigator.locks||null,key:storageKey,legacyKey:'little-rescue-sideview-save-v1',eventTarget:window});
// Start migration before loading assets; every persistent control waits for it.
const initialization=saves.initialize();
const initial=saves.read(),bank=new EnergyBank(initial.energy),battle=new Battle(bank,{...initial.progress});
const heroes=window.SideviewHeroes,BASE=CONFIG.baseHeroes;
// 2.0: the team may include sticker heroes (index 5+), kept in heroes-v1; the schema 2 roster keeps only the original five.
const rosterFor=saveRoster=>{const t=heroes.team(saveRoster);return t&&t.every(i=>i>=0&&heroes.owned(UNITS[i].id))?t:saveRoster};
const saveRosterOf=(team,previous)=>{const base=team.filter(i=>i<BASE);return base.length?base:previous};
battle.setRoster(rosterFor(initial.roster));
// 1.7 stage/level progress lives in its own key. The schema 2 save above is
// never widened, so an older open tab or an exported 1.6.x file stays valid.
const metaKey='little-rescue-meta-v1';
const metaDefaults=()=>({v:1,cleared:saves.read().progress.rescued?1:0,levels:UNITS.slice(0,BASE).map(()=>1),stage:0});
function cleanMeta(m){
 if(m&&m.v===1&&Number.isInteger(m.cleared)&&Array.isArray(m.levels)&&m.levels.length===BASE&&m.levels.every(l=>Number.isInteger(l)&&l>=1&&l<=LEVELS.max)){
  const cleared=Math.max(0,Math.min(STAGES.length,m.cleared));
  return {v:1,cleared,levels:m.levels.slice(),stage:Number.isInteger(m.stage)?Math.max(0,Math.min(cleared,STAGES.length-1,m.stage)):0};
 }
 return null;
}
// 1.17: builds before 1.17 clamp cleared/stage to their 5 stages and may write that back into meta, so the
// world-map progress is also kept in its own key and the larger of the two wins.
const worldKey='little-rescue-world-v1';
function readWorld(){
 try{const w=JSON.parse(storage?.getItem(worldKey)||'null');if(w&&w.v===1&&Number.isInteger(w.cleared)&&Number.isInteger(w.stage))return w}catch{}
 return null;
}
function writeWorld(m){storage?.setItem(worldKey,JSON.stringify({v:1,cleared:m.cleared,stage:m.stage}))}
function readMeta(){
 let m=null;try{m=cleanMeta(JSON.parse(storage?.getItem(metaKey)||'null'))}catch{}
 m=m||metaDefaults();const w=readWorld();
 if(w&&w.cleared>m.cleared)m=cleanMeta({...m,cleared:w.cleared,stage:w.stage})||m;
 return m;
}
function writeMeta(){try{storage?.setItem(metaKey,JSON.stringify(meta));writeWorld(meta);return true}catch{return false}}
let meta=readMeta(),levelKey='';
const allLevels=()=>UNITS.map((u,i)=>i<BASE?meta.levels[i]:heroes.level(u.id));
battle.setLevels(allLevels());battle.setStage(meta.stage);battle.setStars(window.SideviewSummon.stars());
const pwaAssetMap={"background.png":"background.webp","heroes-v2/hero-guard-fongsabo.png":"heroes-v2/hero-guard-fongsabo.webp","heroes-v2/hero-agile-sailom.png":"heroes-v2/hero-agile-sailom.webp","heroes-v2/hero-ranged-maletdao.png":"heroes-v2/hero-ranged-maletdao.webp","heroes-v2/hero-helper-puipan.png":"heroes-v2/hero-helper-puipan.webp","heroes-v2/hero-mage-lukoak.png":"heroes-v2/hero-mage-lukoak.webp","enemies-v2/enemy-guard.png":"enemies-v2/enemy-guard.webp","enemies-v2/enemy-agile.png":"enemies-v2/enemy-agile.webp","enemies-v2/enemy-ranged.png":"enemies-v2/enemy-ranged.webp","enemies-v2/enemy-helper.png":"enemies-v2/enemy-helper.webp","enemies-v2/enemy-mage.png":"enemies-v2/enemy-mage.webp"};
const assetURL=file=>window.EMBEDDED_ASSETS?.[file]||'assets/'+(pwaAssetMap[file]||file);
const canvas=$('game'),ctx=canvas.getContext('2d');
const images={},cards=[];
let bossCallToldRun=-1,timeLabelText='',rageToldRun=[],fluxRateText='',seenEvent=0,seenRun=-1,blastFlash=0,itemFlash={t:0,id:'',xs:[]};
let ready=false,last=performance.now(),toastUntil=0,renderedState='',lastRun=0,lastClaim=false,actionPending=false,appliedRevision=initial.revision;
const motionPreference=matchMedia('(prefers-reduced-motion: reduce)');
let reduced=motionPreference.matches;
motionPreference.addEventListener?.('change',event=>{reduced=event.matches});
const animator=new window.SideviewAnimator(),rigs=new Map(),frameCosts=[];
const artCatalog=window.SideviewArt||{};
const roleIcons=window.SideviewRoleIcons,vfx=new window.SideviewVFX();
let renderedActors=[],renderedProjectiles=[],renderedBases=[],shotOrigins=new Map(),renderedRun=-1;
// Preview geometry is independent of combat positions and editable in one place.
const VEHICLE_VISUAL={width:500,nativeWidth:640,nativeHeight:420,groundY:375,centerOffset:120,doorX:192,doorSillY:313,muzzleX:320,muzzleY:75};
const typeInfo=id=>({stone:{name:'หินอุ่น',color:'#a57542',glyph:'●'},star:{name:'แสงดาว',color:'#8178bc',glyph:'✦'},wind:{name:'สายลม',color:'#4c9c91',glyph:'≈'}}[id]||{name:'',color:'#807b66',glyph:''});
const roleName=unit=>unit.className||unit.role||'เพื่อนร่วมทีม';
function storageNote(){$('storageNote').textContent=saves.writable?'บันทึกคุกกี้ดาว เหรียญ เพื่อน และทีมร่วมกันในแท็บที่เปิดไฟล์/เว็บเดียวกัน อ่านข้อมูลล่าสุดก่อนใช้พลังหรือรับรางวัล โหลดใหม่ยุติรอบเดิมโดยไม่คืนค่าเข้า ไม่ซิงก์ข้ามเครื่อง/เบราว์เซอร์':'โหมดเฉพาะหน้าที่เปิด: ที่เก็บข้อมูลหรือการล็อกเซฟร่วมกันไม่พร้อม จึงไม่เขียนทับเซฟเดิม ความคืบหน้าใหม่จะหายเมื่อปิดหน้านี้'}
function applySaved(snapshot,force=false){
 if(!force&&snapshot.revision<appliedRevision)return;
 appliedRevision=snapshot.revision;bank.value=snapshot.energy.value;bank.anchor=snapshot.energy.anchor;bank.refresh();
 battle.progress.coins=snapshot.progress.coins;battle.progress.rescued=snapshot.progress.rescued;
 if(battle.state==='ready')battle.setRoster(rosterFor(snapshot.roster));
}
async function savedAction(action,options={}){
 if(!ready||actionPending||!window.SideviewPWA.canAct())return false;
 const previousState=battle.state,previousClaim=battle.claimed;
 actionPending=true;sync();let accepted=false;
 try{
   const receipt=await saves.mutate(draft=>{
     applySaved(draft,true);accepted=action()!==false;
     if(!accepted)return false;
     const roster=options.roster?saveRosterOf(battle.selectedRoster,draft.roster):draft.roster;
     if(options.roster)heroes.setTeam(battle.selectedRoster,roster);
     return {...draft,energy:bank.snapshot(),progress:{...battle.progress},roster};
   });
   applySaved(receipt.snapshot);return accepted;
 }catch{toast('บันทึกไม่สำเร็จ โปรดตรวจสถานะเซฟด้านล่าง');return false}
 finally{actionPending=false;storageNote();energy();sync();if(accepted&&(battle.state!==previousState||battle.claimed!==previousClaim)){if(battle.state==='running')$('pauseBtn').focus();else if(battle.state==='won'&&battle.claimed)$('replayBtn').focus()}}
}
function toast(message){$('toast').textContent=message;$('toast').classList.add('show');toastUntil=performance.now()+2300}
function energy(){bank.refresh();$('energyText').textContent=`${bank.value} / ${CONFIG.energyMax}`;const seconds=Math.max(0,Math.ceil((bank.anchor+CONFIG.refillMs-Date.now())/1000));$('energyTimer').textContent=bank.value>=CONFIG.energyMax?'เสบียงเต็มแล้ว':`ฟื้นอีก 1 ชิ้นใน ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}
function mode(){const auto=battle.mode==='auto';['autoBtn','readyAutoBtn'].forEach(id=>$(id).setAttribute('aria-pressed',String(auto)));['manualBtn','readyManualBtn'].forEach(id=>$(id).setAttribute('aria-pressed',String(!auto)));$('modeHint').textContent=auto?'Auto · ทีมเรียกเพื่อนให้ ด้วยต้นทุนและคูลดาวน์เดียวกัน':'Manual · แตะเรียกเพื่อนเอง ทีมเดินและโจมตีอัตโนมัติ'}
function setMode(value){battle.setMode(value);mode()}
function summon(index){if(!battle.summon(index)&&battle.state==='running')toast(battle.flux<UNITS[index].cost?'ละอองใบไม้ยังไม่พอ รอฟื้นสักครู่':'เพื่อนกำลังเตรียมตัว หรือทีมในสนามเต็มแล้ว');sync()}
// 1.8 field skills: production upgrade (paid in flux) and the camper van blast. Both reset every battle.
function upgradeFlux(){if(battle.state!=='running')return;const cost=battle.fluxUpgradeCost;if(battle.upgradeFlux())toast(`ผลิตละอองเร็วขึ้น · ขั้น ${battle.fluxLevel}`);else toast(cost===null?'อัปการผลิตครบทุกขั้นแล้ว':`ต้องใช้ละอองใบไม้ ${cost}`);sync()}
function fireBlast(){if(battle.state!=='running')return;if(!battle.fireBlast())toast('ปืนใหญ่กำลังชาร์จ');sync()}
$('fluxUpBtn').addEventListener('click',upgradeFlux);$('blastBtn').addEventListener('click',fireBlast);
// 1.9 battle items: one round button each, usable once per battle; which ones go along is a per-device UI choice.
const itemKey='little-rescue-ui-items';
try{const ids=JSON.parse(localStorage.getItem(itemKey)||'null');if(Array.isArray(ids))battle.setItems(ids)}catch{}
const itemKeys={meteor:'Q',freeze:'W',gust:'E',shield:'R'};
for(const item of ITEMS){const b=document.createElement('button');b.type='button';b.className='skill-orb item';b.dataset.item=item.id;b.title=`${item.name}: ${item.text} (${itemKeys[item.id]})`;b.setAttribute('aria-label',item.name);
 b.innerHTML=`<span aria-hidden="true">${item.icon}</span><small>${item.name}</small>`;b.addEventListener('click',()=>useItem(item.id));$('skillRow').append(b)}
function useItem(id){if(battle.state!=='running')return;const item=ITEMS.find(x=>x.id===id);if(battle.useItem(id))toast(`${item.icon} ${item.name}!`);else if(!battle.equippedItems.includes(id))toast('ไม่ได้เลือกไอเทมนี้ก่อนเริ่มด่าน');else toast('ใช้ไอเทมนี้ไปแล้วในด่านนี้');sync()}
function saveItems(ids){if(!battle.setItems(ids))return false;try{localStorage.setItem(itemKey,JSON.stringify(battle.equippedItems))}catch{}sync();return true}
let speed=1;
$('speedBtn').addEventListener('click',()=>{speed=speed===1?2:1;sync()});
$('fieldAutoBtn').addEventListener('click',()=>{setMode(battle.mode==='auto'?'manual':'auto');sync()});
// The skill row and speed buttons sit just under the base HP cards, whatever size those are on this screen.
function placeHud(){const home=document.querySelector('.base-hud.home'),enemy=document.querySelector('.base-hud.enemy');if(!home||!enemy)return;
 $('skillRow').style.top=`${home.offsetTop+home.offsetHeight+6}px`;$('speedCol').style.top=`${enemy.offsetTop+enemy.offsetHeight+6}px`}
addEventListener('resize',placeHud);
UNITS.forEach((u,index)=>{
 const btn=document.createElement('button');btn.className='unit-card';btn.disabled=true;btn.dataset.unit=String(index);btn.setAttribute('aria-label',`เรียก ${u.name} ใช้ละอองใบไม้ ${u.cost}`);
 btn.innerHTML=`<span class="unit-key">${index+1}</span><span class="cooldown"></span><img src="${assetURL(u.asset)}" alt=""><span class="unit-name">${u.name}</span><span class="unit-role">${u.role||'เพื่อนร่วมทีม'}</span><span class="unit-cost">❧ ${u.cost}</span><span class="availability">พร้อมเมื่อเริ่มด่าน</span>`;
 const type=typeInfo(u.type);btn.title=`${roleName(u)} · ${type.name} · HP ${u.hp} · ระยะ ${u.range} (ค่าทดลอง)`;
 const badge=document.createElement('span');badge.className='unit-type type-'+u.type;badge.textContent=type.glyph+' '+type.name;btn.querySelector('.unit-name').append(badge);
 btn.querySelector('.unit-role').textContent=roleName(u);
 const classIcon=document.createElement('img');classIcon.className='unit-class-icon';classIcon.src=roleIcons.get(u.classId).dataURL;classIcon.alt=roleName(u);btn.append(classIcon);
 btn.addEventListener('click',()=>summon(index));$('unitGrid').append(btn);cards.push(btn);
 const choice=document.createElement('button');choice.className='roster-choice';choice.dataset.roster=String(index);choice.setAttribute('aria-pressed',String(battle.selectedRoster.includes(index)));choice.innerHTML=`<img src="${assetURL(u.asset)}" alt=""><span>${u.name}</span>`;choice.addEventListener('click',()=>savedAction(()=>{const roster=battle.selectedRoster.includes(index)?battle.selectedRoster.filter(i=>i!==index):[...battle.selectedRoster,index].sort((a,b)=>a-b);if(!roster.length){toast('เลือกเพื่อนร่วมทีมอย่างน้อย 1 ตัว');return false}if(roster.length>CONFIG.maxTeam){toast(`ทีมเต็ม ${CONFIG.maxTeam} ตัวแล้ว เอาตัวอื่นออกก่อน`);return false}return battle.setRoster(roster)},{roster:true}));$('rosterPicker').append(choice);
});
document.querySelectorAll('.roster-choice').forEach((button,index)=>{const unit=UNITS[index],type=typeInfo(unit.type),label=document.createElement('small');label.className='choice-role';label.textContent=roleName(unit)+' '+type.glyph;const icon=document.createElement('img');icon.className='choice-class-icon';icon.src=roleIcons.get(unit.classId).dataURL;icon.alt='';label.prepend(icon);button.append(label);button.title=`${roleName(unit)} · สาย${type.name}`;button.setAttribute('aria-label',`${unit.name} · ${roleName(unit)} · สาย${type.name}`)});
const typeRule=document.createElement('p');typeRule.className='type-rule';typeRule.innerHTML=`<b>หินอุ่น › แสงดาว › สายลม › หินอุ่น</b><br>ได้เปรียบ ×${CONFIG.typeAdvantageMultiplier.toFixed(2)} · เสียเปรียบ ×${CONFIG.typeDisadvantageMultiplier.toFixed(2)} · ไม่บังคับครบสาย`;$('rosterPicker').after(typeRule);
const roleHelp=document.createElement('p');roleHelp.className='role-help';roleHelp.textContent='ทั้งสองฝ่ายใช้ห้าสาย: รับ · ว่องไว · ยิงไกล · ช่วยเหลือ · เวท โดยฮีลเป็นทักษะในสายช่วยเหลือ ภาพหันเข้าหาคู่ต่อสู้ ธาตุหินอุ่น/แสงดาว/สายลมเป็นอีกระบบแยกจากสาย เลือกลงทีม 1–5 ตัว ตัวเลขทุกค่าเป็นตัวอย่างที่แก้ได้';;document.querySelector('.help-copy').prepend(roleHelp);
$('manualBtn').addEventListener('click',()=>setMode('manual'));
$('autoBtn').addEventListener('click',()=>setMode('auto'));
$('readyManualBtn').addEventListener('click',()=>setMode('manual'));
$('readyAutoBtn').addEventListener('click',()=>setMode('auto'));
$('refillBtn').addEventListener('click',()=>savedAction(()=>{bank.add(CONFIG.energyMax);toast('เติมคุกกี้ดาวฟรีแล้ว · สำหรับทดลอง');return true}));
// 1.12.4: the start screen and the pause menu get a ✕. Closing the start screen shows the page behind it
// (header, backup panel, help); a button on the field brings it back. Nothing is spent or saved by either.
let lobbyClosed=false;
function setLobby(closed){
 if(battle.state!=='ready')return;lobbyClosed=closed;$('overlay').hidden=closed;$('lobbyOpenBtn').hidden=!closed;
 (closed?$('lobbyOpenBtn'):$('actionBtn')).focus();
}
$('modalCloseBtn').addEventListener('click',()=>{if(battle.state==='ready')setLobby(true);else if(battle.state==='paused')togglePause()});
$('lobbyOpenBtn').addEventListener('click',()=>setLobby(false));
function togglePause(){if(battle.pause()){sync();if(battle.state==='paused')$('actionBtn').focus()}}
$('pauseBtn').addEventListener('click',togglePause);
$('actionBtn').addEventListener('click',()=>{
 if(!ready)return;
 if(battle.state==='paused'){battle.pause();sync();return}
 savedAction(()=>{
   if(battle.state==='ready'){const ok=battle.start();if(!ok)toast('คุกกี้ดาวไม่พอ เติมฟรีเพื่อทดลองได้');return ok}
   if(battle.state==='won'){const reward=battle.claimReward();if(!reward)return false;
    // 1.16 event coin bonus (live.js): added in the same save write as the reward; the server wallet adds the same
    // bonus to the win op (functions/_lib/play.js) so the next wallet sync agrees.
    const bonus=window.SideviewLive?.bonusCoins(reward.coins)||0;if(bonus){battle.progress.coins+=bonus;reward.bonus=bonus}
    toast(reward.friend?'รับรางวัลแล้ว เพื่อนเข้าร่วมคอลเลกชันแล้ว!':`รับ ${reward.coins}${bonus?` + โบนัสกิจกรรม ${bonus}`:''} เหรียญแล้ว`);
    window.SideviewWallet?.record({kind:'win',stage:reward.stageIndex,run:window.SideviewWallet.runFor(battle.runId),battle:Math.round(battle.time*10)/10,summons:battle.metrics.summons});return true}
   if(battle.state==='lost'){const ok=battle.replay();if(!ok)toast('คุกกี้ดาวไม่พอ เติมฟรีเพื่อทดลองได้');return ok}
   return false;
 }).then(started).then(markCleared);
});
// 1.13 server wallet (wallet.js): a signed-in player's battle gets a run ticket so the server can time it.
function started(ok){if(ok&&battle.state==='running')window.SideviewWallet?.startRun(battle.runId,battle.stageIndex);return ok}
$('replayBtn').addEventListener('click',()=>savedAction(()=>{const ok=battle.replay();if(!ok)toast('คุกกี้ดาวไม่พอ เติมฟรีเพื่อทดลองได้');return ok}).then(started));
// 1.12.2: the pause menu can leave the fight (a loss with no reward) or restart it; each asks once before acting.
let leaveAsk=null;
function askLeave(kind){
 leaveAsk=kind;const retry=kind==='retry';
 $('modalKicker').textContent='ยืนยันก่อน';$('modalTitle').textContent=retry?'เริ่มด่านนี้ใหม่?':'ออกจากด่านนี้?';
 $('modalCopy').innerHTML=(retry?`รอบนี้จะจบโดยไม่ได้รางวัล และใช้คุกกี้ดาว ${CONFIG.entryCost} ชิ้นเริ่มรอบใหม่`:'รอบนี้จะจบโดยไม่ได้รางวัล คุกกี้ดาวที่ใช้เข้าด่านไม่คืน')+'<br>เหรียญ เลเวล และเพื่อนที่สะสมไว้ยังอยู่ครบ';
 $('retryBtn').hidden=!retry;$('exitBtn').hidden=retry;$(retry?'retryBtn':'exitBtn').textContent=retry?'ใช่ เริ่มใหม่':'ใช่ ออกจากด่าน';
 $('actionBtn').textContent='ไม่ใช่ · เล่นต่อ →';$('modalNote').textContent='P / Escape เพื่อเล่นต่อ';$('actionBtn').focus();
}
function countRun(){if(countedRun!==battle.runId){countedRun=battle.runId;if(battle.metrics.summons)window.SideviewDaily.bump('summons',battle.metrics.summons);
 // A win carries its calls in the win op; any other end of a run reports them for the daily mission.
 if(battle.state!=='won'&&battle.metrics.summons)window.SideviewWallet?.record({kind:'loss',stage:battle.stageIndex,summons:battle.metrics.summons})}}
$('retryBtn').addEventListener('click',()=>{
 if(!battle.canAbandon)return;if(leaveAsk!=='retry'){askLeave('retry');return}
 if(bank.refresh()<CONFIG.entryCost){toast('คุกกี้ดาวไม่พอ เติมฟรีเพื่อทดลองได้');return}
 countRun();savedAction(()=>{if(!battle.abandon())return false;window.SideviewStats?.observe(battle,meta.cleared);return battle.replay()}).then(started);
});
$('exitBtn').addEventListener('click',()=>{
 if(!ready||actionPending||!window.SideviewPWA.canAct()||!battle.canAbandon)return;if(leaveAsk!=='exit'){askLeave('exit');return}
 countRun();if(battle.abandon()&&(window.SideviewStats?.observe(battle,meta.cleared),battle.prepareReplay())){applySaved(saves.read());renderedState='';sync();toast('ออกจากด่านแล้ว · ของที่สะสมไว้ยังอยู่ครบ');$('actionBtn').focus()}
});
$('prepareBtn').addEventListener('click',()=>{if(!ready||actionPending||!window.SideviewPWA.canAct())return;if(battle.prepareReplay()){applySaved(saves.read());renderedState='';sync();$('rosterPicker').querySelector('button').focus()}});
document.addEventListener('keydown',event=>{
 if(event.repeat||event.ctrlKey||event.altKey||event.metaKey||/INPUT|TEXTAREA|SELECT/.test(event.target.tagName))return;
 if(event.key==='Escape'&&battle.state==='ready'){if(!document.querySelector('dialog[open]')){event.preventDefault();setLobby(!lobbyClosed)}return}
 if(event.key==='p'||event.key==='P'||event.key==='Escape'){event.preventDefault();togglePause()}
 if(/^[1-5]$/.test(event.key)){event.preventDefault();const index=battle.selectedRoster[Number(event.key)-1];if(index!==undefined)summon(index)}
 if(event.key==='u'||event.key==='U'){event.preventDefault();upgradeFlux()}
 if(event.key==='b'||event.key==='B'){event.preventDefault();fireBlast()}
 for(const [id,key] of Object.entries(itemKeys))if(event.key.toUpperCase()===key){event.preventDefault();useItem(id)}
});
document.addEventListener('visibilitychange',()=>{last=performance.now();if(document.hidden&&['running','advancing'].includes(battle.state)){battle.pause();sync()}});
function stageHeading(){const st=battle.stage;document.querySelector('.level-number').textContent=String(st.number).padStart(2,'0');document.querySelector('.level-heading h2').textContent=st.name;document.title=`${st.name} • ภารกิจช่วยเพื่อน`;$('battlefield').dataset.grade=st.grade}
function chooseStage(index){if(index>meta.cleared||!battle.setStage(index))return;meta=readMeta();meta.stage=index;writeMeta();mapChapter=0;stageHeading();levelKey='';renderedState='';sync()}
// 1.17 world map: chapter tabs and one painted strip per chapter, stages along a winding road.
const MAP_SPOTS=[[10,64],[30,36],[50,62],[70,34],[90,58]];
const MAP_ART={
 1:'<defs><linearGradient id="ms1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cfeaf6"/><stop offset="1" stop-color="#eef7dc"/></linearGradient></defs><rect width="100" height="100" fill="url(#ms1)"/><circle cx="84" cy="16" r="7" fill="#fff1b8" opacity=".9"/><path d="M0 60 Q18 40 36 56 T70 50 T100 54 V100 H0Z" fill="#b5d896"/><path d="M0 78 Q22 62 46 76 T100 70 V100 H0Z" fill="#94c27b"/><path d="M38 100 Q44 80 58 78 T74 60 T96 48" fill="none" stroke="#9fd3ea" stroke-width="4" opacity=".8"/><g fill="#6f9f5c"><circle cx="20" cy="54" r="3.4"/><circle cx="24" cy="57" r="2.6"/><circle cx="62" cy="47" r="3"/><circle cx="80" cy="74" r="3.6"/></g><g fill="#f7c9d6"><circle cx="14" cy="86" r="1.2"/><circle cx="40" cy="90" r="1.2"/><circle cx="66" cy="88" r="1.2"/><circle cx="88" cy="90" r="1.2"/></g><path d="M86 44 l4 -12 l4 12z" fill="#a8735a"/><rect x="88.6" y="44" width="2.8" height="8" fill="#8a5a46"/>',
 2:'<defs><linearGradient id="ms2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9d9f0"/><stop offset="1" stop-color="#f3f7fc"/></linearGradient></defs><rect width="100" height="100" fill="url(#ms2)"/><path d="M0 58 L14 22 L26 50 L40 14 L56 48 L70 18 L86 46 L100 24 V100 H0Z" fill="#9fb3cf"/><path d="M10 32 L14 22 L18 32 L15 30Z M36 24 L40 14 L44 24 L41 22Z M66 28 L70 18 L74 28 L71 26Z M96 34 L100 24 L100 34Z" fill="#fff"/><path d="M0 72 Q24 56 50 70 T100 66 V100 H0Z" fill="#e6eef8"/><ellipse cx="54" cy="86" rx="20" ry="6" fill="#bfe0f2" opacity=".9"/><g fill="#6f9a8a"><path d="M6 80 l3 -9 l3 9z"/><path d="M26 74 l3 -10 l3 10z"/><path d="M78 78 l3 -9 l3 9z"/><path d="M94 72 l2.5 -8 l2.5 8z"/></g><path d="M86 34 l2 -8 l2 8z M92 34 l2 -10 l2 10z" fill="#b6a2e6"/><rect x="85" y="34" width="12" height="9" fill="#c9b6ff"/>'
};
let mapChapter=0;
function chapterOpen(n){const first=STAGES.findIndex(s=>s.chapter===n);return first>=0&&first<=meta.cleared}
function renderStages(){
 const box=$('stagePicker');box.innerHTML='';box.classList.add('world-map');
 const chapter=mapChapter||battle.stage.chapter,editable=ready&&!actionPending&&battle.state==='ready';
 const tabs=document.createElement('div');tabs.className='chapter-tabs';tabs.setAttribute('role','group');tabs.setAttribute('aria-label','เลือกบท');
 for(const ch of CHAPTERS){const list=STAGES.filter(s=>s.chapter===ch.number),done=list.filter(s=>STAGES.indexOf(s)<meta.cleared).length,open=chapterOpen(ch.number),t=document.createElement('button');
  t.type='button';t.className='chapter-tab';t.setAttribute('aria-pressed',String(ch.number===chapter));
  t.innerHTML=`<span aria-hidden="true">${open?ch.icon:'🔒'}</span><b>บทที่ ${ch.number} · ${ch.name}</b><small>${open?`ผ่าน ${done}/${list.length}`:`ผ่านด่าน ${String(STAGES.findIndex(s=>s.chapter===ch.number)).padStart(2,'0')} ก่อน`}</small>`;
  t.title=ch.text;t.addEventListener('click',()=>{if(!open){toast(`🔒 ${ch.name} · ผ่านบทก่อนหน้าให้ครบก่อน`);return}mapChapter=ch.number;levelKey='';sync()});tabs.append(t)}
 const strip=document.createElement('div');strip.className='map-strip chapter-'+chapter;
 const idx=STAGES.map((s,i)=>i).filter(i=>STAGES[i].chapter===chapter),pts=idx.map((_,k)=>MAP_SPOTS[k%MAP_SPOTS.length]);
 const road=pts.map((p,k)=>k?`Q${(pts[k-1][0]+p[0])/2} ${k%2?p[1]-14:p[1]+14} ${p[0]} ${p[1]}`:`M${p[0]} ${p[1]}`).join(' ');
 strip.innerHTML=`<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${MAP_ART[chapter]||MAP_ART[1]}<path d="${road}" fill="none" stroke="#8a6a46" stroke-width="5" stroke-linecap="round" opacity=".4"/><path d="${road}" fill="none" stroke="#fff8e4" stroke-width="2.6" stroke-dasharray="3 2.4" stroke-linecap="round"/></svg>`;
 idx.forEach((i,k)=>{const st=STAGES[i],locked=i>meta.cleared,b=document.createElement('button');b.type='button';
  b.className='stage-node map-node grade-'+st.grade+(st.boss?' boss':'')+(locked?' locked':'');b.dataset.stage=String(i);
  b.style.left=pts[k][0]+'%';b.style.top=pts[k][1]+'%';
  b.disabled=locked||!editable;b.setAttribute('aria-pressed',String(i===battle.stageIndex));
  b.innerHTML=`<b>${locked?'🔒':String(st.number).padStart(2,'0')}</b><span>${locked?'ยังล็อก':st.name}</span>${i<meta.cleared?'<i aria-label="ผ่านแล้ว">✓</i>':''}${st.boss?`<em aria-label="ด่านบอส">👑</em>`:''}${i===battle.stageIndex?'<u aria-hidden="true">🚐</u>':''}`;
  b.title=locked?'ชนะด่านก่อนหน้าเพื่อปลดล็อก':`${st.name} · ฐานศัตรู ${st.enemyHP} · ไม่จำกัดเวลา · รางวัล ${st.rewardCoins} เหรียญ${st.boss?` · บอส ${st.boss.name}`:''}`;
  b.setAttribute('aria-label',locked?`ด่าน ${st.number} ยังล็อก`:`ด่าน ${st.number} ${st.name}${st.boss?' ด่านบอส':''}${i<meta.cleared?' ผ่านแล้ว':''}`);
  b.addEventListener('click',()=>chooseStage(i));strip.append(b)});
 box.append(tabs,strip);
}
function renderLevels(){
 const box=$('levelPanel');box.innerHTML='';
 UNITS.forEach((u,i)=>{if(!heroes.owned(u.id))return;const lv=battle.levels[i],cost=levelCost(lv),max=lv>=LEVELS.max,b=document.createElement('button');b.className='level-up';b.dataset.level=String(i);
  b.disabled=max||!ready||actionPending||battle.state!=='ready'||battle.progress.coins<cost;
  b.innerHTML=`<img src="${assetURL(u.asset)}" alt=""><span class="lv-name">${u.name}</span><b>Lv ${lv}</b><small>${max?'เลเวลสูงสุด':`◉ ${cost}`}</small>`;
  b.setAttribute('aria-label',max?`${u.name} เลเวลสูงสุด`:`อัปเลเวล ${u.name} จาก ${lv} ใช้เหรียญ ${cost}`);
  b.addEventListener('click',()=>levelUp(i));box.append(b)});
}
async function levelUp(index){
 const lv=battle.levels[index],cost=levelCost(lv);if(lv>=LEVELS.max)return;
 const ok=await savedAction(()=>{if(battle.state!=='ready'||battle.progress.coins<cost){toast('เหรียญยังไม่พอ ชนะด่านเพื่อรับเหรียญ');return false}battle.progress.coins-=cost;window.SideviewWallet?.record({kind:'level',unit:index,level:lv});return true});
 if(!ok)return;meta=readMeta();let saved;
 if(index<BASE){meta.levels[index]=Math.min(LEVELS.max,meta.levels[index]+1);saved=writeMeta()}else saved=heroes.setLevel(UNITS[index].id,lv+1);
 if(!saved)toast('บันทึกเลเวลไม่สำเร็จ');battle.setLevels(allLevels());toast(`${UNITS[index].name} เลเวล ${battle.levels[index]} แล้ว!`);levelKey='';window.SideviewDaily.bump('levelups');sync();
}
// 2.0 sticker heroes join for coins from the hero book (summon.js may also grant them).
async function unlockHero(index){
 const u=UNITS[index];if(!u||heroes.owned(u.id))return false;
 const ok=await savedAction(()=>{if(battle.state!=='ready'||battle.progress.coins<u.unlockCoins){toast('เหรียญยังไม่พอ ชนะด่านเพื่อรับเหรียญ');return false}if(!heroes.grant(u.id))return false;battle.progress.coins-=u.unlockCoins;window.SideviewWallet?.record({kind:'unlock',unit:u.id});return true});
 if(ok){toast(`${u.name} มาเป็นเพื่อนแล้ว! เลือกลงทีมได้ที่แท็บทีม`);levelKey='';sync()}return ok;
}
heroes.onChange(()=>{if(battle.state==='ready'){battle.setLevels(allLevels());battle.setRoster(rosterFor(saves.read().roster))}levelKey='';window.SideviewLobby.refresh();sync()});
let countedWin=0;
function markCleared(){
 if(battle.state!=='won'||!battle.claimed)return;
 if(countedWin!==battle.runId){countedWin=battle.runId;window.SideviewDaily.bump('wins')}
 meta=readMeta();const next=battle.stageIndex+1;
 if(next>meta.cleared){meta.cleared=Math.min(STAGES.length,next);writeMeta();if(next<STAGES.length){const ch=STAGES[next].chapter!==battle.stage.chapter&&CHAPTERS.find(c=>c.number===STAGES[next].chapter);toast(ch?`${ch.icon} ปลดล็อกบทที่ ${ch.number} · ${ch.name} แล้ว! ไปต่อที่แผนที่โลก`:`ปลดล็อกด่าน ${String(next+1).padStart(2,'0')} · ${STAGES[next].name} แล้ว!`)}}
 levelKey='';
}
function refreshMeta(){
 const key=[ready,actionPending,battle.state,battle.progress.coins,battle.stars.join(','),battle.levels.join(','),battle.stageIndex,meta.cleared].join('|');
 if(key===levelKey)return;levelKey=key;renderStages();renderLevels();$('coinText').textContent=battle.progress.coins.toLocaleString('th-TH');if(battle.state==='ready')battle.setStars(window.SideviewSummon.stars());window.SideviewSummon.render();window.SideviewLobby.renderBook();
}
window.addEventListener('storage',event=>{if(event.key!==metaKey&&event.key!==worldKey)return;meta=readMeta();if(battle.state==='ready'){battle.setLevels(allLevels());if(battle.stageIndex>meta.cleared)battle.setStage(meta.stage);stageHeading()}levelKey='';sync()});
let countedRun=0;
function modal(){
 const state=battle.state,claimed=battle.claimed;
 if(renderedState===state&&lastRun===battle.runId&&lastClaim===claimed)return;
 if(['won','lost'].includes(state))countRun();
 window.SideviewDaily.refresh();window.SideviewLobby.refresh();
 renderedState=state;lastRun=battle.runId;lastClaim=claimed;
 if(state!=='ready')lobbyClosed=false;$('overlay').hidden=['running','advancing'].includes(state)||state==='ready'&&lobbyClosed;$('lobbyOpenBtn').hidden=!(state==='ready'&&lobbyClosed);$('modalCloseBtn').hidden=!['ready','paused'].includes(state);$('modal').classList.toggle('won',state==='won');$('rewardArea').hidden=state!=='won';$('replayBtn').hidden=!(state==='won'&&claimed);$('actionBtn').hidden=state==='won'&&claimed;
 $('preflightControls').hidden=state!=='ready';
 $('prepareBtn').hidden=!(state==='lost'||state==='won'&&claimed);
 leaveAsk=null;$('retryBtn').hidden=$('exitBtn').hidden=!(state==='paused'&&battle.canAbandon);$('retryBtn').textContent=`เริ่มด่านนี้ใหม่ · คุกกี้ดาว ${CONFIG.entryCost} ชิ้น`;$('exitBtn').textContent='ออกจากด่าน · กลับหน้าหลัก';
 if(state==='ready'){$('modalKicker').textContent=`ด่าน ${String(battle.stage.number).padStart(2,'0')} · ${battle.stage.name}`;$('modalTitle').textContent='พาเพื่อนกลับบ้าน';$('modalCopy').innerHTML='กางรถเป็นฐาน ส่งทีมไปช่วยเพื่อนที่ฐาน Mushroom<br>ชนะแล้วพับกลับเป็นรถ ไปรับเพื่อนกลับบ้าน';$('modalNote').textContent='เลือกทีมและโหมดได้ก่อนเริ่ม · ยังไม่เสียคุกกี้ดาว';$('actionBtn').textContent=`เริ่มภารกิจ · คุกกี้ดาว ${CONFIG.entryCost} ชิ้น →`;return}
 if(state==='running'||state==='advancing')$('pauseBtn').focus();
 if(state==='advancing')toast('ชนะแล้ว! รถฐานกำลังไปรับเพื่อน');
 if(state==='paused'){
   $('modalKicker').textContent='พักหายใจสักครู่';$('modalTitle').textContent='ทีมกำลังรอคุณ';$('modalCopy').innerHTML='การต่อสู้ เวลา และละอองใบไม้หยุดแล้ว<br>กลับมาเล่นต่อได้โดยไม่เสียคุกกี้ดาวเพิ่ม';$('actionBtn').textContent='เล่นต่อ →';$('modalNote').textContent='P / Escape เพื่อเล่นต่อ';
 }else if(state==='won'){
   $('modalKicker').textContent='ภารกิจสำเร็จ';$('modalTitle').textContent=claimed?'กลับบ้านด้วยกัน!':'ช่วยเพื่อนได้แล้ว!';$('modalCopy').textContent=claimed?'รางวัลรอบนี้รับเรียบร้อยแล้ว':'รางวัลสาธิต รับได้หนึ่งครั้งต่อรอบที่ชนะ';
   const first=!battle.progress.rescued;
   $('rewardArea').innerHTML=`<div class="reward-item"><span class="reward-icon">◉</span><b>เหรียญ ${battle.stage.rewardCoins}${(window.SideviewLive?.bonusCoins(battle.stage.rewardCoins)||0)?` +${window.SideviewLive.bonusCoins(battle.stage.rewardCoins)}`:''}</b><small>${(window.SideviewLive?.coinBonus()||0)?`โบนัสกิจกรรม +${window.SideviewLive.coinBonus()}%`:'ไอเทมจำลอง'}</small></div><div class="reward-item"><span class="reward-icon cookie-icon">★</span><b>คุกกี้ดาว ${CONFIG.rewardCookies}</b><small>พลังงานเข้าด่าน</small></div><div class="reward-item"><img src="${assetURL(UNITS[3].asset)}" alt="เพื่อน${UNITS[3].name}"><b>${claimed?'อยู่ในทีมแล้ว':first?`เพื่อนที่ช่วยได้ · ${UNITS[3].name}`:'เพื่อนอยู่ในทีมแล้ว'}</b><small>${claimed?'รับรางวัลแล้ว':first?'เพิ่มในคอลเลกชันครั้งแรก':'เล่นซ้ำไม่เพิ่มเพื่อนซ้ำ'}</small></div>`;
   $('actionBtn').textContent='รับรางวัลและพาเพื่อนเข้าทีม →';if(!first&&!claimed)$('actionBtn').textContent='รับรางวัลรอบนี้ →';
   $('modalNote').textContent=`เหรียญสะสม: ${battle.progress.coins} · ${saves.writable?'บันทึกความคืบหน้าในเบราว์เซอร์นี้':'ความคืบหน้าอยู่เฉพาะหน้าที่เปิด'}`;
 }else if(state==='lost'){
   $('modalKicker').textContent='ยังมีครั้งต่อไป';$('modalTitle').textContent='ตั้งทีมแล้วลองอีกครั้ง';$('modalCopy').innerHTML=(battle.reason==='exit'?'ออกจากด่านกลางทาง':battle.homeHP<=0?'รถฐานทีมเราถูกทำลาย':'หมดเวลาภารกิจ')+'<br>ลองเรียกเพื่อนให้เร็วขึ้น หรือเลือก Auto';$('actionBtn').textContent=`เล่นใหม่ · คุกกี้ดาว ${CONFIG.entryCost} ชิ้น →`;$('modalNote').textContent='รอบนี้ไม่ได้รับรางวัล · ค่าทั้งหมดเป็นตัวอย่าง';
 }
 if(state==='won'||state==='lost')(claimed?$('replayBtn'):$('actionBtn')).focus();
}
function sync(){
 window.SideviewStats?.observe(battle,meta.cleared);
 const pwaBlocked=!ready||actionPending||!window.SideviewPWA.canAct();$('actionBtn').disabled=pwaBlocked;$('replayBtn').disabled=pwaBlocked;$('prepareBtn').disabled=pwaBlocked;$('retryBtn').disabled=pwaBlocked;$('exitBtn').disabled=pwaBlocked;$('refillBtn').disabled=pwaBlocked;
 document.querySelectorAll('.roster-choice').forEach((el,i)=>{el.hidden=!heroes.owned(UNITS[i].id);el.disabled=!ready||actionPending||battle.state!=='ready';el.setAttribute('aria-pressed',String(battle.selectedRoster.includes(i)))});
 $('homeText').textContent=`${Math.ceil(battle.homeHP)} / ${CONFIG.homeHP}`;$('enemyText').textContent=`${Math.ceil(battle.enemyHP)} / ${battle.enemyMaxHP}`;
 $('homeFill').style.width=`${Math.max(0,battle.homeHP/CONFIG.homeHP*100)}%`;$('enemyFill').style.width=`${Math.max(0,battle.enemyHP/battle.enemyMaxHP*100)}%`;
 $('fluxText').textContent=`${Math.floor(battle.flux)} / ${battle.fluxCap}`;$('fluxFill').style.width=`${battle.flux/battle.fluxCap*100}%`;
 const rate=`ฟื้น +${+battle.fluxRate.toFixed(1)} ต่อวินาที`;if(fluxRateText!==rate){fluxRateText=rate;document.querySelector('.flux-panel small').textContent=rate}
 const live=battle.state==='running',upCost=battle.fluxUpgradeCost,charge=Math.min(1,battle.blastCharge/CONFIG.blastChargeTime);
 const inBattle=['running','paused'].includes(battle.state);
 if($('skillRow').hidden===inBattle){$('skillRow').hidden=!inBattle;$('speedCol').hidden=!inBattle;$('fluxUpBtn').hidden=!inBattle;if(inBattle)placeHud()}
 $('fluxUpBtn').disabled=!live||upCost===null||battle.flux<upCost;$('fluxUpBtn').querySelector('b').textContent=`Lv.${battle.fluxLevel}`;
 $('fluxUpBtn').querySelector('small').textContent=upCost===null?'สูงสุด':`⬆ ❧ ${upCost}`;
 $('blastBtn').disabled=!live||!battle.blastReady;$('blastBtn').classList.toggle('ready',battle.blastReady);
 $('blastBtn').style.setProperty('--charge',String(charge));$('blastBtn').querySelector('small').textContent=battle.blastReady?'ยิง!':`${Math.round(charge*100)}%`;
 document.querySelectorAll('.skill-orb.item').forEach(b=>{const id=b.dataset.item,on=battle.equippedItems.includes(id),used=battle.itemsUsed.includes(id);b.hidden=!on;b.disabled=!live||used;b.classList.toggle('used',used)});
 $('speedBtn').setAttribute('aria-pressed',String(speed===2));$('fieldAutoBtn').setAttribute('aria-pressed',String(battle.mode==='auto'));
 // 1.9: no time limit in normal stages, so the clock counts up; a stage with timeLimit still counts down.
 const limited=Number.isFinite(battle.remaining),t=Math.max(0,limited?Math.ceil(battle.remaining):Math.floor(battle.time)),rage=battle.rage;$('timeText').textContent=`${String(Math.floor(t/60)).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;
 const timeLabel=limited?'เวลาที่เหลือ':rage>1.05?`ศัตรูดุ ×${rage.toFixed(1)}`:'เวลาในด่าน';if(timeLabelText!==timeLabel){timeLabelText=timeLabel;document.querySelector('.timer small').textContent=timeLabel}
 if(rage>1&&!rageToldRun.includes(battle.runId)&&battle.state==='running'){rageToldRun.push(battle.runId);toast('😡 ศัตรูเริ่มดุขึ้นเรื่อยๆ รีบทำลายฐาน Mushroom!')}
 $('pauseBtn').disabled=!['running','paused','advancing'].includes(battle.state);$('pauseBtn').textContent=battle.state==='paused'?'▶':'Ⅱ';$('pauseBtn').setAttribute('aria-label',battle.state==='paused'?'เล่นต่อ':'หยุดพัก');
 $('teamCount').textContent=`${battle.progress.rescued?1:0} / 1`;
 $('killText').textContent=battle.state==='ready'?'หยุดพักได้ทุกเวลา':`ป้องกันศัตรูได้ ${battle.kills} ตัว`;
 const victoryText={celebrate:'ชนะแล้ว! ฉลองก่อนกลับบ้าน',boarding:'ทุกคนวิ่งขึ้นรถ กลับด้วยกัน',ready:'ขึ้นครบแล้ว เตรียมออกเดินทาง',depart:'กลับบ้านด้วยกัน!',won:'ภารกิจสำเร็จ'};
 $('missionPill').textContent=battle.state==='won'?'ภารกิจสำเร็จ · เพื่อนปลอดภัยแล้ว':battle.state==='advancing'?(victoryText[battle.victoryPhase]||'กำลังรับเพื่อนขึ้นรถ'):battle.state==='ready'?'รถเดินทาง พร้อมจอดส่งทีม':battle.baseDeployment<1?'กำลังกางโครงสร้างรถฐาน':'รถฐานจอดส่งทีมไปช่วยเพื่อน';
 // With only the original five in the team the dock keeps the 1.6.6 five cards; a sticker hero shows the team alone.
 const stickerTeam=battle.selectedRoster.some(i=>i>=BASE);
 cards.forEach((btn,i)=>{const cd=battle.cooldowns[i]||0,slot=battle.selectedRoster.indexOf(i),inTeam=slot>=0;btn.hidden=!inTeam&&(i>=BASE||stickerTeam);btn.style.order=inTeam?slot:BASE+i;btn.querySelector('.unit-key').textContent=inTeam?slot+1:'';btn.disabled=!inTeam||!ready||battle.state!=='running'||cd>0||battle.flux<UNITS[i].cost||battle.allies.length>=CONFIG.maxAllies;
   btn.querySelector('.availability').textContent=!inTeam?'ไม่อยู่ในทีม':battle.state==='ready'?'พร้อมเมื่อเริ่มด่าน':battle.state==='paused'?'พักการต่อสู้':cd>.05?`อีก ${cd.toFixed(1)} วินาที`:battle.flux<UNITS[i].cost?'รอละอองใบไม้':battle.state==='running'?'พร้อมเรียก':'จบภารกิจ';
   btn.querySelector('.cooldown').style.transform=`scaleY(${Math.min(1,cd/(UNITS[i].cooldown||4))})`;
 });refreshMeta();modal();window.SideviewPWA.refresh?.();window.SideviewFriends?.tick();
}
function round(x,y,w,h,r,fill){ctx.fillStyle=fill;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill()}
// Per-stage light over the painted background only; sprites stay untinted.
const gradeStars=Array.from({length:70},(_,i)=>({x:(i*397)%1200,y:12+((i*211)%230),r:.6+((i*7)%10)/10,p:i*1.7}));
const snowFlakes=Array.from({length:90},(_,i)=>({x:(i*331)%1200,y:(i*173)%520,r:1+((i*5)%9)/4,v:18+((i*13)%20),p:i*.9}));
function stageGrade(W,H){
 const grade=battle.stage.grade;if(grade==='day')return;
 const look={golden:{top:'#ffd27a',bottom:'#ffb347',a:.5,mode:'soft-light',glow:.12},sunset:{top:'#ff8f5a',bottom:'#ffcf8a',a:.5,mode:'soft-light',shade:'#7a3f2a',sa:.12},
  dusk:{top:'#5d4a9a',bottom:'#c58ab0',a:.42,mode:'multiply',glow:.35},night:{top:'#16224d',bottom:'#3b4a7a',a:.62,mode:'multiply',glow:.6,stars:true},
  // 1.17 chapter 2, หุบเขาหิมะ: frost whitens the meadow, snow falls, the last stage gets the northern lights.
  mist:{top:'#dfe7ef',bottom:'#c4d2dc',a:.38,mode:'soft-light',tint:'#e4ecf3',ta:.32,frost:.35},snow:{top:'#c9dcef',bottom:'#eef4fa',a:.4,mode:'soft-light',tint:'#dfeaf6',ta:.26,frost:.55,snow:true},
  ice:{top:'#8fbfe4',bottom:'#d8eefc',a:.45,mode:'soft-light',shade:'#a9cdea',sa:.3,tint:'#cfe6f8',ta:.22,frost:.45,snow:true},
  crystal:{top:'#34467e',bottom:'#7d6cbc',a:.48,mode:'multiply',glow:.3,frost:.12,sparkle:true},
  aurora:{top:'#13234c',bottom:'#3a5578',a:.62,mode:'multiply',glow:.45,stars:true,aurora:true,frost:.22,snow:true}}[grade];
 if(!look)return;
 ctx.save();ctx.globalCompositeOperation=look.mode;ctx.globalAlpha=look.a;
 const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,look.top);g.addColorStop(1,look.bottom);ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
 if(look.shade){ctx.globalCompositeOperation='multiply';ctx.globalAlpha=look.sa;ctx.fillStyle=look.shade;ctx.fillRect(0,0,W,H)}
 if(look.tint){ctx.globalCompositeOperation='source-over';ctx.globalAlpha=look.ta;ctx.fillStyle=look.tint;ctx.fillRect(0,0,W,H)}
 ctx.globalCompositeOperation='screen';
 if(look.stars){for(const s of gradeStars){ctx.globalAlpha=reduced?.7:.45+.4*Math.sin(animator.time*1.6+s.p);ctx.fillStyle='#fff7d6';ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,7);ctx.fill()}
  ctx.globalAlpha=.85;const moon=ctx.createRadialGradient(930,70,4,930,70,60);moon.addColorStop(0,'#fffbe8');moon.addColorStop(.25,'#fff1c2');moon.addColorStop(1,'rgba(255,241,194,0)');ctx.fillStyle=moon;ctx.beginPath();ctx.arc(930,70,60,0,7);ctx.fill()}
 if(look.aurora){for(let k=0;k<3;k++){ctx.globalAlpha=(reduced?.5:.4+.15*Math.sin(animator.time*.7+k*2));const band=ctx.createLinearGradient(0,30+k*30,0,150+k*30);band.addColorStop(0,'rgba(120,255,200,0)');band.addColorStop(.5,['#7dffc8','#8fd2ff','#c9a6ff'][k]);band.addColorStop(1,'rgba(150,120,255,0)');ctx.fillStyle=band;ctx.beginPath();ctx.moveTo(0,90+k*28);for(let x=0;x<=1200;x+=100)ctx.lineTo(x,70+k*28+28*Math.sin(x/170+k+(reduced?0:animator.time*.3)));ctx.lineTo(1200,190+k*28);ctx.lineTo(0,190+k*28);ctx.fill()}}
 if(look.sparkle){for(const s of gradeStars.slice(0,30)){ctx.globalAlpha=reduced?.6:.3+.5*Math.abs(Math.sin(animator.time*2+s.p));ctx.fillStyle='#d6c8ff';ctx.beginPath();ctx.arc(s.x,200+s.y,s.r*1.4,0,7);ctx.fill()}}
 if(look.glow){for(const [x,y,r] of [[1062,318,90],[300,330,120]]){ctx.globalAlpha=look.glow;const lamp=ctx.createRadialGradient(x,y,2,x,y,r);lamp.addColorStop(0,'rgba(255,214,130,.9)');lamp.addColorStop(1,'rgba(255,214,130,0)');ctx.fillStyle=lamp;ctx.beginPath();ctx.arc(x,y,r,0,7);ctx.fill()}}
 ctx.restore();
 if(look.frost){ctx.save();ctx.globalAlpha=look.frost;const f=ctx.createLinearGradient(0,300,0,H);f.addColorStop(0,'rgba(255,255,255,0)');f.addColorStop(.45,'#f4f9ff');f.addColorStop(1,'#ffffff');ctx.fillStyle=f;ctx.fillRect(0,300,W,H-300);ctx.restore()}
 if(look.snow){ctx.save();ctx.fillStyle='#ffffff';for(const f of snowFlakes){const t=reduced?0:animator.time,y=(f.y+t*f.v)%H,x=(f.x+18*Math.sin(t*.8+f.p)+1200)%1200;ctx.globalAlpha=.75;ctx.beginPath();ctx.arc(x,y,f.r,0,7);ctx.fill()}ctx.restore()}
}
function draw(){
 const W=1200,H=520,compress=(canvas.clientWidth/canvas.clientHeight)/(W/H);ctx.clearRect(0,0,W,H);
 const sceneScale=Math.max(1,compress),foot=414;
 if(images.background)ctx.drawImage(images.background,0,414-492*sceneScale,1200,675*sceneScale);else{ctx.fillStyle='#bad6b0';ctx.fillRect(0,0,W,H)}
 ctx.fillStyle='#3c624117';ctx.fillRect(0,410,W,110);stageGrade(W,H);
 renderedActors=[];renderedProjectiles=[];renderedBases=[];
 if(renderedRun!==battle.runId||battle.state==='ready'){shotOrigins.clear();renderedRun=battle.runId}
 const sprite=(im,x,y,w,h,flip=false,alpha=1)=>{if(!im)return;ctx.save();ctx.globalAlpha=alpha;ctx.translate(x,y);if(flip)ctx.scale(-1,1);ctx.drawImage(im,-w/2,-h*compress,w,h*compress);ctx.restore()};
 const character=(asset,x,y,w,h,pose={},alpha=1)=>{
  const rig=rigs.get(asset),facing=pose.facing===-1?-1:1,sourceFacing=artCatalog[asset]?.sourceFacing||1;
  const options={x,y,width:w,height:h*compress,phase:'idle',progress:animator.time*.55%1,time:animator.time,reduced,facing,...pose};
  if(!rig){sprite(images[asset],x,y,w,h,facing!==sourceFacing,alpha);return{options,rig:null}}
  ctx.save();ctx.globalAlpha=alpha;window.SideviewAnimation.draw(ctx,rig,options);ctx.restore();return{options,rig};
 };
 const vs=VEHICLE_VISUAL.width/VEHICLE_VISUAL.nativeWidth,vehicleBaseX=battle.vehicleX??80,vehicleCenter=vehicleBaseX+VEHICLE_VISUAL.centerOffset,vehicleBottom=foot+(VEHICLE_VISUAL.nativeHeight-VEHICLE_VISUAL.groundY)*vs*compress;
 const nativePoint=(center,x,y,flip=false)=>({x:center+(x-320)*vs*(flip?-1:1),y:foot+(y-VEHICLE_VISUAL.groundY)*vs*compress});
 const vehicleMuzzle=nativePoint(vehicleCenter,VEHICLE_VISUAL.muzzleX,VEHICLE_VISUAL.muzzleY),enemyMuzzle=nativePoint(1120-VEHICLE_VISUAL.centerOffset,VEHICLE_VISUAL.muzzleX,VEHICLE_VISUAL.muzzleY,true);
 const vehicleDoor=nativePoint(vehicleCenter,VEHICLE_VISUAL.doorX,VEHICLE_VISUAL.doorSillY);
 const cannonById=new Map((battle.baseCannons||[]).map(c=>[c.id,c]));
 const baseRecord=(id,team,muzzle,x)=>({id,team,faction:team?'hero':'enemy',classId:'base-cannon',facing:team?1:-1,muzzle,foot:{x,y:foot},alpha:1,hp:team?battle.homeHP:battle.enemyHP,cooldown:cannonById.get(id)?.cooldown??0});
 renderedBases.push({...baseRecord('ally-base-cannon',true,vehicleMuzzle,vehicleBaseX),vehicle:true,visualCenter:vehicleCenter,drawWidth:VEHICLE_VISUAL.width,ground:{x:vehicleCenter,y:foot},door:vehicleDoor,spriteBounds:{x:vehicleCenter-VEHICLE_VISUAL.width/2,y:vehicleBottom-VEHICLE_VISUAL.nativeHeight*vs*compress,width:VEHICLE_VISUAL.width,height:VEHICLE_VISUAL.nativeHeight*vs*compress}},baseRecord('enemy-base-cannon',false,enemyMuzzle,1120));
 const vehicle=()=>{const d=battle.baseDeployment||0;sprite(images['base-vehicle-large-v1.svg'],vehicleCenter,vehicleBottom,VEHICLE_VISUAL.width,VEHICLE_VISUAL.nativeHeight*vs,false,1-d);if(d>0)sprite(images['base-deployed-large-v1.svg'],vehicleCenter,vehicleBottom,VEHICLE_VISUAL.width,VEHICLE_VISUAL.nativeHeight*vs,false,d)};
 // The enemy tower remains static; only its matching support cannon is new.
 sprite(images['cannon-support-v1.svg'],1120-VEHICLE_VISUAL.centerOffset,vehicleBottom,VEHICLE_VISUAL.width,VEHICLE_VISUAL.nativeHeight*vs,true,1);
 const doorOpen=battle.victorySnapshot?.vehicleAction==='wait';
 const doorway=foreground=>{
  const topLeft=nativePoint(vehicleCenter,140.5,174),width=103*vs,height=139*vs;
  ctx.save();ctx.translate(topLeft.x,topLeft.y);ctx.scale(1,compress);
  ctx.beginPath();ctx.roundRect(0,0,width,height,13*vs);
  if(!foreground){ctx.fillStyle='#435b48';ctx.fill();ctx.fillStyle='#667357';ctx.fillRect(10*vs,13*vs,83*vs,9*vs)}
  else{ctx.strokeStyle='#957046';ctx.lineWidth=4*vs;ctx.stroke();ctx.strokeStyle='#edca88';ctx.lineWidth=3*vs;ctx.beginPath();ctx.moveTo(8*vs,height-2*vs);ctx.lineTo(width-8*vs,height-2*vs);ctx.stroke()}
  ctx.restore();
 };
 // Returning friends stay in front of the vehicle until they enter its door.
 vehicle();if(doorOpen)doorway(false);
 if(!['advancing','won'].includes(battle.state)&&!(battle.state==='paused'&&battle.victoryPhase)){
  const asset=UNITS[3].asset,ratio=rigs.get(asset)?.aspect||1,cageWidth=Math.min(60,50*ratio);character(asset,1090,315,cageWidth,cageWidth/ratio,{facing:-1},.96);
  ctx.strokeStyle='#8f775977';ctx.lineWidth=3;for(let x=1062;x<=1118;x+=14){ctx.beginPath();ctx.moveTo(x,249);ctx.lineTo(x,316);ctx.stroke()}round(1057,247,68,5,2,'#927757');round(1057,314,68,5,2,'#927757');
 }
 const all=[...battle.allies.map(a=>({...a,team:true})),...(battle.victoryActors||[]).filter(a=>a.isRescuedFriend).map(a=>({...a,team:true})),...battle.enemies.map(e=>({...e,team:false})),...animator.ghosts()],actorById=new Map();
 all.sort((a,b)=>a.x-b.x).forEach((u,i)=>{
  const serial=Number(String(u.id).split('-').at(-1))||i,spec=(u.team?UNITS:ENEMIES)[u.index||0],asset=u.asset||spec.asset,rig=rigs.get(asset);
  if(u.boarded)return;
  const scale=u.scale||1,baseHeight=(u.team?({guard:110,agile:116,ranged:108,helper:94,mage:112}[u.classId]||108):100)*scale;
  const boarding=Math.max(0,Math.min(1,u.boardingProgress||0)),rescue=u.isRescuedFriend?Math.max(0,Math.min(1,u.rescueProgress||0)):1,ratio=rig?.aspect||1,width=Math.min(155*scale,baseHeight*ratio)*(1-boarding*.25)*(u.isRescuedFriend?.62+.38*rescue:1),height=width/ratio;
  const pose=u.phase==='defeat'?{phase:'defeat',progress:u.progress,time:animator.time}:animator.pose(u);if(pose.hidden)return;
  const naturalFoot=u.isRescuedFriend?315+(foot-315)*rescue:foot+(serial%3)*9;
  // Each lane reaches the same real door sill rather than a fixed fake rise.
  const y=naturalFoot+(vehicleDoor.y-naturalFoot)*boarding-(pose.hop||0)*height*compress;
  ctx.fillStyle=u.team?'#426c3b38':'#78513a34';ctx.beginPath();ctx.ellipse(u.x,y+4,33,7,0,0,7);ctx.fill();
  // 1.17 chapter 2 bosses glow in their own colour; the sprite itself stays untinted.
  if(u.aura&&u.phase!=='defeat'){ctx.save();ctx.globalAlpha=reduced?.45:.35+.15*Math.sin(animator.time*3);const cy=y-height*compress*.45,r=width*.75,glow=ctx.createRadialGradient(u.x,cy,4,u.x,cy,r);glow.addColorStop(0,u.aura);glow.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=glow;ctx.beginPath();ctx.ellipse(u.x,cy,r,r*compress*1.1,0,0,7);ctx.fill();ctx.restore()}
  const facing=u.facing===-1?-1:1;
  const alpha=(pose.phase==='defeat'?Math.max(0,1-pose.progress*pose.progress):1)*(1-boarding),drawn=character(asset,u.x,y,width,height,{...pose,facing},alpha);
  const record={id:u.id,team:Boolean(u.team),faction:u.team?'hero':'enemy',classId:u.classId||spec.classId,className:u.className||spec.className,kind:u.kind,asset,facing,sourceFacing:artCatalog[asset]?.sourceFacing||1,profile:artCatalog[asset]?.profile||null,phase:pose.phase,victoryAction:u.victoryAction||null,boardingProgress:boarding,spriteBounds:{x:u.x-width/2,y:y-height*compress,width,height:height*compress},foot:{x:u.x,y},alpha,hpBar:null,glyph:null,muzzle:drawn.rig?window.SideviewAnimation.getAttachment(drawn.rig,drawn.options,'muzzle'):null};
  actorById.set(u.id,{...record,unit:u});renderedActors.push(record);
  if(u.phase==='defeat'||u.victoryAction)return;
  const max=u.maxHP||u.maxHp||100,hp=u.hp/max,bar={x:u.x-26,y:y-height*compress-13,width:52,height:5};round(bar.x,bar.y,bar.width,bar.height,3,'#fff5d8');round(bar.x,bar.y,52*Math.max(0,Math.min(1,hp)),5,3,u.team?'#6caa77':'#d58467');record.hpBar={...bar,fillDirection:'left-to-right',value:u.hp,max};
  if(u.boss){ctx.save();ctx.font='bold 15px Mali,Tahoma,sans-serif';ctx.textAlign='center';ctx.fillStyle='#fff5d8';ctx.strokeStyle='#5b2f2a';ctx.lineWidth=4;const label='👑 '+u.name;ctx.strokeText(label,u.x,bar.y-8);ctx.fillText(label,u.x,bar.y-8);ctx.restore()}
  const iconSize=12*W/Math.max(1,canvas.clientWidth),icon={classId:u.classId||spec.classId,x:u.x-26-iconSize*.85,y:bar.y-3*compress,size:iconSize,mirrored:false};ctx.save();ctx.translate(icon.x,icon.y);ctx.scale(1,compress);roleIcons.draw(ctx,icon.classId,0,0,iconSize);ctx.restore();record.classIcon=icon;
 });
 for(const base of renderedBases)actorById.set(base.id,base);
 const flying=new Set();
 (battle.projectiles||[]).forEach(p=>{
  flying.add(p.id);const shooter=actorById.get(p.sourceId),target=actorById.get(p.targetId),t=p.flightProgress||0;
  if(!shotOrigins.has(p.id)){const muzzle=shooter?.muzzle||{x:p.fromX,y:foot+(p.fromY-foot)*compress};shotOrigins.set(p.id,{x:muzzle.x,y:muzzle.y,engineFromX:p.fromX,attachmentAtLaunch:{...muzzle}})}
  const origin=shotOrigins.get(p.id),x=(p.x??p.fromX)+(origin.x-p.fromX)*(1-t),targetY=target?target.foot.y-target.spriteBounds.height*.43:foot+(p.targetY-foot)*compress,y=origin.y+(targetY-origin.y)*t,direction=Math.sign(p.targetX-p.fromX)||(p.friendly?1:-1),type=typeInfo(p.type);

  renderedProjectiles.push({id:p.id,sourceId:p.sourceId,targetId:p.targetId,friendly:p.friendly,direction,x,y,origin:{...origin},flightProgress:t,engineX:p.x,engineFromX:p.fromX,targetX:p.targetX});
 });
 for(const id of shotOrigins.keys())if(!flying.has(id))shotOrigins.delete(id);
 vfx.draw(ctx,{actors:[...renderedActors,...renderedBases],projectiles:renderedProjectiles,compress,foot,reduced});
 if(blastFlash>0){const a=Math.min(1,blastFlash/.45),grow=1-a,endY=foot-60*compress;ctx.save();ctx.globalCompositeOperation='screen';ctx.lineCap='round';
  for(const [width,alpha,color] of [[46,.28,'#ffb84d'],[22,.55,'#ffd977'],[7,.95,'#fffbe8']]){ctx.globalAlpha=alpha*a;ctx.strokeStyle=color;ctx.lineWidth=width*(0.7+0.3*a);ctx.beginPath();ctx.moveTo(vehicleMuzzle.x,vehicleMuzzle.y);ctx.lineTo(W-10,endY);ctx.stroke()}
  for(const e of battle.enemies){const y=foot-45*compress*(e.scale||1),r=(18+46*grow)*(e.scale||1);ctx.globalAlpha=.7*a;const burst=ctx.createRadialGradient(e.x,y,2,e.x,y,r);burst.addColorStop(0,'#fffbe8');burst.addColorStop(.5,'#ffcf6a');burst.addColorStop(1,'rgba(255,170,80,0)');ctx.fillStyle=burst;ctx.beginPath();ctx.arc(e.x,y,r,0,7);ctx.fill()}
  ctx.globalAlpha=.12*a;ctx.fillStyle='#fff3c4';ctx.fillRect(0,0,W,H);ctx.restore()}
 if(itemFlash.t>0){const a=Math.min(1,itemFlash.t/.5),grow=1-a;ctx.save();ctx.globalCompositeOperation='screen';
  if(itemFlash.id==='meteor')for(const x of itemFlash.xs){const e={x};const y=foot-50*compress;ctx.globalAlpha=a;ctx.fillStyle='#8a5a2b';ctx.beginPath();ctx.arc(e.x-60*a,y-160*a,14,0,7);ctx.fill();const r=20+60*grow;const g=ctx.createRadialGradient(e.x,y,2,e.x,y,r);g.addColorStop(0,'#fff1c0');g.addColorStop(.6,'#ff9d4d');g.addColorStop(1,'rgba(255,120,60,0)');ctx.globalAlpha=.8*grow;ctx.fillStyle=g;ctx.beginPath();ctx.arc(e.x,y,r,0,7);ctx.fill()}
  if(itemFlash.id==='gust'){ctx.strokeStyle='#e9fbff';ctx.lineWidth=5;for(let k=0;k<6;k++){ctx.globalAlpha=.7*a;const x=300+grow*600+k*60,y=foot-40*compress-k*22*compress;ctx.beginPath();ctx.arc(x,y,26+k*4,0,4.6);ctx.stroke()}}
  ctx.restore()}
 if(battle.freezeRemaining>0){ctx.save();for(const e of battle.enemies){const y=foot-48*compress*(e.scale||1),r=46*(e.scale||1);ctx.globalAlpha=.55;const g=ctx.createRadialGradient(e.x,y,4,e.x,y,r);g.addColorStop(0,'rgba(235,250,255,.5)');g.addColorStop(1,'rgba(110,195,255,.55)');ctx.fillStyle=g;ctx.beginPath();ctx.arc(e.x,y,r,0,7);ctx.fill();ctx.globalAlpha=.95;ctx.strokeStyle='#e8f8ff';ctx.lineWidth=3;ctx.stroke();ctx.font='bold 20px sans-serif';ctx.fillStyle='#ffffff';ctx.fillText('❄',e.x+r*.4,y-r*.6)}ctx.restore()}
 if(battle.shieldRemaining>0){ctx.save();ctx.strokeStyle='#6fd35a';ctx.lineWidth=4;for(const u of battle.allies){const y=foot-48*compress;ctx.globalAlpha=.6+.25*Math.sin(animator.time*6);ctx.beginPath();ctx.ellipse(u.x,y,40,52*compress,0,0,7);ctx.stroke();ctx.globalAlpha=.18;ctx.fillStyle='#bfeaa3';ctx.fill()}ctx.restore()}
 if(doorOpen)doorway(true);
 if(battle.state==='ready'){for(const [spec,x,facing]of [[UNITS[0],220,1],[ENEMIES[0],965,-1]]){const ratio=rigs.get(spec.asset)?.aspect||1;character(spec.asset,x,428,Math.min(155,115*ratio),Math.min(155,115*ratio)/ratio,{facing})}}

}
function fieldEvents(dt){
 if(seenRun!==battle.runId){seenRun=battle.runId;seenEvent=0;blastFlash=0;itemFlash.t=0}
 blastFlash=Math.max(0,blastFlash-dt);itemFlash.t=Math.max(0,itemFlash.t-dt);
 for(const e of battle.events){if(e.seq<=seenEvent)continue;seenEvent=e.seq;
  if(e.type==='boss-arrive')toast(`👑 ${e.name} ออกมาแล้ว! ใช้ปืนใหญ่รถแคมป์ช่วย`);
  if(e.type==='boss-call'&&bossCallToldRun!==battle.runId){bossCallToldRun=battle.runId;toast(`👑 ${e.name} เรียกลูกน้องมาช่วย! รีบล้มบอสก่อน`)}
  if(e.type==='base-blast')blastFlash=reduced?.25:.6;
  if(e.type==='item-use')itemFlash={t:reduced?.25:.6,id:e.item,xs:e.targetX||[]};
 }
}
function frame(now){const started=performance.now(),dt=Math.min(.1,Math.max(0,(now-last)/1000));last=now;if(ready)battle.update(dt*speed);fieldEvents(dt*speed);animator.update(battle,dt);vfx.update(battle,dt);sync();draw();const cost=performance.now()-started;frameCosts.push(cost);if(frameCosts.length>600)frameCosts.shift();if(now>toastUntil)$('toast').classList.remove('show');requestAnimationFrame(frame)}
const assetFiles=[...new Set(['background.png','background-clean-left-v1.png','base-vehicle-large-v1.svg','base-deployed-large-v1.svg','cannon-support-v1.svg',...UNITS.map(u=>u.asset),...ENEMIES.map(u=>u.asset)])];
function composeSceneBackground(){
 const original=images.background,patch=images['background-clean-left-v1.png'];
 const layer=document.createElement('canvas');layer.width=original.naturalWidth;layer.height=original.naturalHeight;
 const brush=layer.getContext('2d');brush.drawImage(original,0,0);
 // Native x<=350 contains the entire removed ally building. Feather only forest.
 // Original pixels from x430 onward remain byte-for-byte in this render layer.
 brush.drawImage(patch,0,0,350,patch.naturalHeight,0,0,350,layer.height);
 for(let x=350;x<430;x+=2){brush.globalAlpha=1-(x-350)/80;brush.drawImage(patch,x,0,2,patch.naturalHeight,x,0,2,layer.height)}
 brush.globalAlpha=1;images.background=layer;
}
function initializeRigs(){for(const spec of [...UNITS,...ENEMIES])rigs.set(spec.asset,window.SideviewAnimation.createRig(images[spec.asset],{id:spec.id,role:spec.kind,index:spec.index??UNITS.indexOf(spec),...artCatalog[spec.asset]}))}
Promise.all([initialization,window.SideviewPWA.gateReady,roleIcons.preload(),...assetFiles.map(file=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>{images[file==='background.png'?'background':file==='mushroom.png'?'mushroom':file]=img;resolve()};img.onerror=()=>reject(new Error(file));img.src=assetURL(file)}))]).then(([receipt])=>{composeSceneBackground();initializeRigs();applySaved(receipt.snapshot,true);ready=true;renderedState='';document.body.classList.add('loaded');storageNote();energy();sync()}).catch(error=>{$('modalCopy').textContent='เปิดข้อมูลเกมไม่สำเร็จ: '+error.message+' โปรดแตกไฟล์ทั้งโฟลเดอร์แล้วเปิด index.html อีกครั้ง';$('actionBtn').disabled=true});
storageNote();
// Read-only diagnostic snapshots for independent QA; no force-win/debug buttons.
$('balanceNote').textContent=`ตัวเลขทั้งหมดเป็นค่าตัวอย่างที่แก้ได้ใน engine.js: คุกกี้ดาวสูงสุด ${CONFIG.energyMax} / ค่าเข้า ${CONFIG.entryCost} / ฟื้น 1 ทุก ${CONFIG.refillMs/60000} นาที / ไม่จำกัดเวลา ศัตรูดุขึ้นหลัง ${CONFIG.rageAfter} วินาที / ละอองใบไม้เริ่ม ${CONFIG.fluxInitial} สูงสุด ${CONFIG.fluxMax} ฟื้น +${CONFIG.fluxRegen} ต่อวินาที / รางวัลเหรียญ ${CONFIG.rewardCoins} และคุกกี้ดาว ${CONFIG.rewardCookies} รับได้หนึ่งครั้งต่อรอบที่ชนะ การพัก สลับโหมด และกดเริ่มซ้ำไม่เสียเพิ่ม`;
document.querySelector('.energy-copy small').textContent=`ใช้เข้าด่านเท่านั้น · ครั้งละ ${CONFIG.entryCost} ชิ้น`;
window.SideviewLobby.mount({battle,UNITS,ITEMS,levelMultiplier,starMultiplier,assetURL,toast,saveItems,heroes,unlockHero,canEdit:()=>ready&&!actionPending});
// 1.15 friends and guilds: server-side only, nothing in the save; a borrowed helper lives on the battle for one run.
window.SideviewFriends.mount({battle,UNITS,CONFIG,assetURL,toast,cleared:()=>meta.cleared,owned:i=>heroes.owned(UNITS[i].id)});
// 1.12 summon and star grades (summon.js). Stars only change before a battle, so a running battle keeps its power.
window.SideviewSummon.mount({savedAction,toast,assetURL,coins:()=>battle.progress.coins,canAct:()=>ready&&!actionPending&&battle.state==='ready'&&window.SideviewPWA.canAct(),
 spend:coins=>{battle.progress.coins-=coins;levelKey=''},changed:()=>{if(battle.state==='ready')battle.setStars(window.SideviewSummon.stars());levelKey='';sync()}});
// 1.14 gem shop (shop.js). It only opens from the lobby, so going to checkout never leaves a battle or an unclaimed reward.
window.SideviewShop.mount({toast,canAct:()=>ready&&!actionPending&&battle.state==='ready'&&window.SideviewPWA.canAct()});
window.SideviewDaily.mount({savedAction,toast,canClaim:()=>ready&&!actionPending&&(battle.state==='ready'||battle.state==='lost'||(battle.state==='won'&&battle.claimed)),
 pay:(coins,cookies)=>{battle.progress.coins+=coins;if(cookies)bank.add(cookies);levelKey=''}});
// 1.13 gift box, events and maintenance notice from the admin page (live.js). Gifts pay like daily rewards.
window.SideviewLive.mount({savedAction,toast,canClaim:()=>ready&&!actionPending&&(battle.state==='ready'||battle.state==='lost'||(battle.state==='won'&&battle.claimed)),
 pay:(coins,cookies)=>{battle.progress.coins+=coins;if(cookies)bank.add(cookies);levelKey=''}});
$('replayBtn').textContent=`เล่นอีกครั้ง · คุกกี้ดาว ${CONFIG.entryCost} ชิ้น`;
window.SideviewApp={snapshot:()=>({state:battle.state,mode:battle.mode,energy:bank.value,flux:battle.flux,speed,equippedItems:[...battle.equippedItems],itemsUsed:[...battle.itemsUsed],freezeRemaining:battle.freezeRemaining,shieldRemaining:battle.shieldRemaining,fluxLevel:battle.fluxLevel,fluxCap:battle.fluxCap,blastCharge:battle.blastCharge,blastReady:battle.blastReady,bossSpawned:battle.bossSpawned,boss:(battle.enemies.find(e=>e.boss)||null)&&{...battle.enemies.find(e=>e.boss)},time:battle.time,homeHP:battle.homeHP,enemyHP:battle.enemyHP,vehicleX:battle.vehicleX,baseDeployment:battle.baseDeployment,baseCannons:(battle.baseCannons||[]).map(c=>({...c})),travelProgress:battle.travelProgress,victoryPhase:battle.victoryPhase||null,victoryActors:(battle.victoryActors||[]).map(u=>({...u})),selectedRoster:[...battle.selectedRoster],claimed:battle.claimed,runId:battle.runId,allies:battle.allies.length,enemies:battle.enemies.length,progress:{...battle.progress},metrics:{...battle.metrics},saveBusy:actionPending,saveWritable:saves.writable,saveInitialized:saves.initialized,saveRevision:appliedRevision,ready}),version:'1.17.0',animationSnapshot:()=>({reduced,...animator.snapshot(),rig:window.SideviewAnimation.stats,frameCosts:[...frameCosts]}),renderSnapshot:()=>JSON.parse(JSON.stringify({version:'1.17.0',state:battle.state,runId:battle.runId,catalog:[...UNITS.map(u=>({...u,team:true})),...ENEMIES.map(u=>({...u,team:false}))].map(u=>({team:u.team,classId:u.classId,className:u.className,kind:u.kind,name:u.name,asset:u.asset,sourceFacing:artCatalog[u.asset]?.sourceFacing||1,profile:artCatalog[u.asset]?.profile,aspect:rigs.get(u.asset)?.aspect,rigKey:rigs.get(u.asset)?.id})),actors:renderedActors,bases:renderedBases,vehicleVisual:VEHICLE_VISUAL,backgroundLeftPatchWorld:430/1672*1200,projectiles:renderedProjectiles,victory:battle.victorySnapshot||null,vfx:vfx.snapshot()})),vfxSnapshot:()=>vfx.snapshot(),combatSnapshot:()=>JSON.parse(JSON.stringify({units:[...battle.allies,...battle.enemies],baseCannons:battle.baseCannons,projectiles:battle.projectiles,events:battle.events}))};
saves.subscribe(snapshot=>{const coins=battle.progress.coins,rescued=battle.progress.rescued;applySaved(snapshot);if(battle.state==='won'&&(coins!==battle.progress.coins||rescued!==battle.progress.rescued))renderedState='';energy();sync()});
const importSafe=()=>ready&&!actionPending&&window.SideviewTransfer.canImport(battle.state,battle.claimed);
window.SideviewBridge={snapshot:window.SideviewApp.snapshot,safe:importSafe,refresh:sync,
 exportSave:async()=>{await initialization;return saves.read()},
 importSave:async(data,expectedRevision)=>{
   if(!importSafe()||!window.SideviewPWA.canAct()||!saves.writable||!Number.isSafeInteger(expectedRevision))return false;
   const clean=window.SideviewTransfer.parse(window.SideviewTransfer.create(data)).save;
   actionPending=true;sync();let accepted=false;
   try{
     const receipt=await saves.mutate(draft=>{if(draft.revision!==expectedRevision)return false;accepted=true;return {...draft,...clean,revision:draft.revision}},{requireDurable:true});
     if(!accepted||!receipt.committed)return false;applySaved(receipt.snapshot,true);battle.setRoster(rosterFor(receipt.snapshot.roster));renderedState='';return true;
   }finally{actionPending=false;storageNote();energy();sync()}
 },
 // 1.11 cloud save (cloud-save.js): the stage/level meta travels with the save; daily missions too.
 meta:()=>readMeta(),levels:()=>allLevels(),
 importCloud:async(transfer,cloudMeta,daily,now,summon,heroBundle)=>{
   if(!importSafe()||!window.SideviewPWA.canAct()||!saves.writable)return false;
   const clean=window.SideviewTransfer.parse(JSON.stringify(transfer),{now}).save,nextMeta=cleanMeta(cloudMeta);
   if(!nextMeta)return false;
   actionPending=true;sync();let accepted=false;
   try{
     // Meta and daily are written inside the save lock, the same way daily claims are.
     const receipt=await saves.mutate(draft=>{
       try{storage.setItem(metaKey,JSON.stringify(nextMeta));writeWorld(nextMeta);if(daily)storage.setItem('little-rescue-daily-v1',JSON.stringify(daily));if(summon)storage.setItem(window.SideviewSummon.KEY,JSON.stringify(summon));if(heroBundle)storage.setItem(heroes.KEY,JSON.stringify(heroBundle))}catch{return false}
       accepted=true;return {...draft,...clean,revision:draft.revision}},{requireDurable:true});
     if(!accepted||!receipt.committed)return false;
     applySaved(receipt.snapshot,true);battle.setRoster(rosterFor(receipt.snapshot.roster));
     meta=readMeta();battle.setLevels(allLevels());battle.setStage(meta.stage);battle.setStars(window.SideviewSummon.stars());window.SideviewSummon.render();stageHeading();
     levelKey='';renderedState='';window.SideviewDaily.refresh();return true;
   }finally{actionPending=false;storageNote();energy();sync()}
 },
 // 1.13 server wallet (wallet.js): take the server's coins, levels, cleared stages and stars. stillClean() is
 // checked inside the save lock, so an action queued meanwhile is never overwritten.
 applyWallet:async(view,stillClean)=>{
   if(!importSafe()||!window.SideviewPWA.canAct()||!saves.writable)return false;
   actionPending=true;sync();let accepted=false;
   try{
     const receipt=await saves.mutate(draft=>{
       if(!stillClean())return false;
       const now=readMeta(),next=cleanMeta({...now,cleared:view.cleared,levels:Array.isArray(view.levels)?view.levels.slice(0,BASE):view.levels});
       if(!next||!Number.isSafeInteger(view.coins)||view.coins<0)return false;
       try{storage.setItem(metaKey,JSON.stringify(next));writeWorld(next)}catch{return false}
       if(!window.SideviewSummon.adopt(view)||!heroes.adopt(view))return false;
       accepted=true;return {...draft,progress:{...draft.progress,coins:view.coins},revision:draft.revision}},{requireDurable:true});
     if(!accepted||!receipt.committed)return false;
     applySaved(receipt.snapshot,true);battle.setRoster(rosterFor(receipt.snapshot.roster));
     meta=readMeta();battle.setLevels(allLevels());battle.setStage(meta.stage);battle.setStars(window.SideviewSummon.stars());window.SideviewSummon.render();stageHeading();
     levelKey='';renderedState='';return true;
   }finally{actionPending=false;storageNote();energy();sync()}
 }
};
window.SideviewStats?.begin(meta.cleared,matchMedia('(display-mode: standalone)').matches);
stageHeading();mode();energy();sync();setInterval(energy,1000);requestAnimationFrame(frame);
})();
