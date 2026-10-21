/* 1.10: summon (gacha) and star grades, paid with in-game coins only. Pulls give hero shards; shards plus coins
   raise a hero's star grade (engine.js STARS, +15% HP and power per star). State lives in its own key,
   little-rescue-summon-v1, keyed by unit id so heroes added later fit in; the schema 2 save is never widened.
   Coins move through app.js savedAction, which holds the save lock, and this key is written inside that lock
   before the coins change, so two open tabs cannot spend the same pull twice. Every rate is shown in the game. */
(()=>{
 'use strict';
 const KEY='little-rescue-summon-v1';
 const {UNITS,STARS,SUMMON,rollSummon,starMultiplier}=window.Sideview;
 const pad=n=>String(n).padStart(2,'0');
 const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
 const count=(v,max)=>Number.isSafeInteger(v)&&v>=0?Math.min(v,max):0;
 let storage=null;try{storage=window.localStorage}catch{}

 function read(){
  let raw=null;try{raw=JSON.parse(storage?.getItem(KEY)||'null')}catch{}
  const ok=raw&&raw.v===1&&raw.units&&typeof raw.units==='object';
  const units={};
  for(const u of UNITS){const r=ok?raw.units[u.id]:null;units[u.id]={star:Math.max(1,count(r?.star,STARS.max)),shards:count(r?.shards,99999)}}
  return {v:1,units,sinceLegend:ok?count(raw.sinceLegend,SUMMON.pity-1):0,pulls:ok?count(raw.pulls,1e9):0,
   freeDay:ok&&typeof raw.freeDay==='string'?raw.freeDay:''};
 }
 // Unknown unit ids (a hero from a newer build) are carried over untouched.
 function write(state){
  try{let old=null;try{old=JSON.parse(storage?.getItem(KEY)||'null')}catch{}
   const units={...(old?.v===1&&old.units&&typeof old.units==='object'?old.units:{}),...state.units};
   storage?.setItem(KEY,JSON.stringify({...state,units}));return Boolean(storage)}catch{return false}
 }
 const stars=()=>{const s=read();return UNITS.map(u=>s.units[u.id].star)};
 const star=id=>read().units[id]?.star||1;
 const nextCost=star=>star>=STARS.max?null:{shards:STARS.shards[star+1],coins:STARS.coins[star+1]};
 const starText=n=>'★'.repeat(n)+'☆'.repeat(STARS.max-n);
 const tierName=id=>SUMMON.tiers.find(t=>t.id===id)?.name||'';
 // Uniform [0,1) from the platform's secure generator.
 function random(){const a=new Uint32Array(1);crypto.getRandomValues(a);return a[0]/4294967296}

 let app=null,panel=null,last=[];
 const open=()=>Boolean(app?.canAct());
 function render(){
  if(!panel)return;
  const s=read(),coins=app.coins(),free=s.freeDay!==today(),can=open();
  const left=SUMMON.pity-s.sinceLegend;
  panel.querySelector('.summon-buttons').innerHTML=`
   <button type="button" class="primary" data-pull="free" ${free&&can?'':'disabled'}>${free?'สุ่มฟรีวันนี้ 1 ครั้ง':'ใช้สุ่มฟรีวันนี้แล้ว'}</button>
   <button type="button" class="primary" data-pull="1" ${can&&coins>=SUMMON.cost?'':'disabled'}>สุ่ม 1 ครั้ง · ◉ ${SUMMON.cost}</button>
   <button type="button" class="primary" data-pull="10" ${can&&coins>=SUMMON.tenCost?'':'disabled'}>สุ่ม 10 ครั้ง · ◉ ${SUMMON.tenCost}</button>`;
  panel.querySelector('.summon-pity').textContent=`สุ่ม 10 ครั้งได้หายากขึ้นไปอย่างน้อย 1 · อีก ${left} ครั้งการันตีตำนาน · สุ่มไปแล้ว ${s.pulls} ครั้ง · เหรียญ ◉ ${coins.toLocaleString('th-TH')}`;
  panel.querySelector('.summon-results').innerHTML=last.map((r,i)=>{const u=UNITS[r.unit];
   return `<li class="tier-${r.tier}" style="--i:${i}"><img src="${app.assetURL(u.asset)}" alt=""><b>${u.name}</b><small>${tierName(r.tier)} · ชิ้นส่วน +${r.shards}</small></li>`}).join('');
  panel.querySelector('.summon-results').hidden=!last.length;
  panel.querySelector('.star-list').innerHTML=UNITS.map((u,i)=>{const h=s.units[u.id],next=nextCost(h.star),ready=next&&h.shards>=next.shards&&coins>=next.coins;
   return `<li><img src="${app.assetURL(u.asset)}" alt=""><div><b>${u.name}</b><span class="stars" aria-label="${h.star} ดาว">${starText(h.star)}</span>
    <small>${next?`ชิ้นส่วน ${h.shards} / ${next.shards}`:`ดาวสูงสุด · ชิ้นส่วน ${h.shards}`} · พลัง ×${starMultiplier(h.star).toFixed(2)}</small></div>
    <button type="button" class="${ready?'primary':'secondary'}" data-star="${i}" ${ready&&can?'':'disabled'}>${next?`เพิ่มดาว · ◉ ${next.coins}`:'สูงสุด'}</button></li>`}).join('');
 }
 function ratesHTML(){
  const n=UNITS.length;
  return `<summary>อัตราการสุ่ม (ดูได้ทุกเมื่อ)</summary>
   <table><thead><tr><th>ระดับ</th><th>โอกาสต่อครั้ง</th><th>ชิ้นส่วนที่ได้</th><th>ต่อเพื่อน 1 ตัว</th></tr></thead><tbody>
   ${SUMMON.tiers.map(t=>`<tr class="tier-${t.id}"><td>${t.name}</td><td>${t.weight}%</td><td>+${t.shards}</td><td>${+(t.weight/n).toFixed(2)}%</td></tr>`).join('')}
   </tbody></table>
   <p>เพื่อนทั้ง ${n} ตัวมีโอกาสเท่ากันในทุกระดับ สุ่ม 10 ครั้งได้ระดับหายากขึ้นไปอย่างน้อย 1 ใบ ถ้าสุ่มครบ ${SUMMON.pity} ครั้งยังไม่ได้ตำนาน ครั้งที่ ${SUMMON.pity} ได้ตำนานแน่นอน
   ใช้เหรียญในเกมเท่านั้น ไม่มีเงินจริง สุ่มด้วยตัวสุ่มของเบราว์เซอร์ (crypto)</p>
   <p>เพิ่มดาว: ${STARS.shards.slice(2).map((s,i)=>`${i+1}→${i+2} ดาว ใช้ชิ้นส่วน ${s} + ◉ ${STARS.coins[i+2]}`).join(' · ')} · ดาวละ +${Math.round(STARS.step*100)}% HP และพลัง</p>`;
 }
 async function pull(kind){
  if(!open())return;
  const n=kind==='10'?10:1,price=kind==='free'?0:kind==='10'?SUMMON.tenCost:SUMMON.cost;let got=null;
  const ok=await app.savedAction(()=>{
   const s=read();
   if(kind==='free'&&s.freeDay===today())return false;
   if(app.coins()<price){app.toast('เหรียญยังไม่พอ ชนะด่านหรือทำภารกิจเพื่อรับเหรียญ');return false}
   const roll=rollSummon(random,n,s.sinceLegend);
   for(const r of roll.results)s.units[UNITS[r.unit].id].shards=Math.min(99999,s.units[UNITS[r.unit].id].shards+r.shards);
   s.sinceLegend=roll.sinceLegend;s.pulls+=n;if(kind==='free')s.freeDay=today();
   // Write first: if the save write fails afterwards the player keeps the shards, never pays twice.
   if(!write(s))return false;
   if(price)app.spend(price);got=roll.results;return true;
  });
  if(ok&&got){last=got;for(const r of got)window.SideviewHeroes?.grant?.(UNITS[r.unit].id);const best=got.some(r=>r.tier==='legend')?'legend':got.some(r=>r.tier==='rare')?'rare':'common';
   app.toast(best==='legend'?'✨ ได้ระดับตำนาน!':best==='rare'?'ได้ระดับหายาก!':'ได้ชิ้นส่วนเพื่อนแล้ว');app.changed()}
  render();
 }
 async function starUp(index){
  if(!open())return;
  const u=UNITS[index];if(!u)return;let reached=0;
  const ok=await app.savedAction(()=>{
   const s=read(),h=s.units[u.id],next=nextCost(h.star);
   if(!next||h.shards<next.shards)return false;
   if(app.coins()<next.coins){app.toast('เหรียญยังไม่พอ');return false}
   h.shards-=next.shards;h.star+=1;reached=h.star;
   if(!write(s))return false;
   app.spend(next.coins);return true;
  });
  if(ok){app.toast(`${u.name} ${reached} ดาวแล้ว!`);app.changed()}
  render();
 }
 function mount(bridge){
  app=bridge;
  panel=document.createElement('div');panel.className='summon-panel';
  panel.innerHTML=`<p class="roster-label">สุ่มเพื่อน · ได้ชิ้นส่วนไปเพิ่มดาว</p><div class="summon-buttons"></div><p class="summon-pity"></p>
   <ul class="summon-results" aria-live="polite" hidden></ul><details class="summon-rates">${ratesHTML()}</details>
   <p class="roster-label">ระดับดาว</p><ul class="star-list"></ul>`;
  panel.addEventListener('click',event=>{const p=event.target.closest('[data-pull]')?.dataset.pull;if(p)pull(p);
   const i=event.target.closest('[data-star]')?.dataset.star;if(i!==undefined)starUp(Number(i))});
  document.getElementById('preflightControls').append(panel);
  window.addEventListener('storage',event=>{if(event.key===KEY){app.changed();render()}});
  setInterval(()=>{if(panel.offsetParent)render()},30000);
  render();
 }
 window.SideviewSummon={KEY,read,stars,star,nextCost,mount,render,pull,starUp};
})();
