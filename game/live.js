/* 1.16: live operations from the admin page (admin.html): gift box, time-limited events, maintenance notice.
   - api/live (public) gives the events and the notice; they show as strips on the start/result card, and an event
     with a coin bonus adds that percentage to stage win coins (app.js asks bonusCoins when the reward is claimed).
   - api/gifts needs the cloud account (cloud-save.js, key little-rescue-cloud-v1). The server credits the coins to
     the server wallet with a once-only ledger ref (functions/_lib/live.js), and the game picks them up with the
     next wallet sync (wallet.js). Cookies are not a wallet currency: a claimed gift's cookies are written to
     little-rescue-gifts-v1 as pending, then paid and marked inside app.js savedAction (the save lock), so a crash or
     a second tab never loses or doubles them. The schema 2 save is never widened.
   Offline, signed out, or without the server, everything here stays quiet and the game plays as before. */
(()=>{
 'use strict';
 const KEY='little-rescue-gifts-v1',CLOUD='little-rescue-cloud-v1',MAX_COINS=10000,MAX_COOKIES=100;
 let storage=null;try{storage=window.localStorage}catch{}
 let app=null,live={events:[],maintenance:{on:false,message:''}},skew=0,gifts=[],signedIn=false,loaded=false,busy=false;
 let banner=null,dialog=null,tabButton=null;
 const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
 const when=t=>new Date(t).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'});
 const count=(v,max)=>Number.isSafeInteger(v)&&v>=0&&v<=max?v:null;

 const token=()=>{try{const s=JSON.parse(storage?.getItem(CLOUD)||'null');return s&&s.v===1&&typeof s.token==='string'?s.token:''}catch{return ''}};
 function readLedger(){
  try{const s=JSON.parse(storage?.getItem(KEY)||'null');
   if(s&&s.v===1)return {v:1,
    pending:(Array.isArray(s.pending)?s.pending:[]).filter(p=>p&&Number.isSafeInteger(p.id)&&count(p.coins,MAX_COINS)!==null&&count(p.cookies,MAX_COOKIES)!==null)
     .map(p=>({id:p.id,coins:p.coins,cookies:p.cookies,title:typeof p.title==='string'?p.title.slice(0,60):''})),
    paid:(Array.isArray(s.paid)?s.paid:[]).filter(Number.isSafeInteger).slice(-300)}}catch{}
  return {v:1,pending:[],paid:[]};
 }
 function writeLedger(l){try{storage?.setItem(KEY,JSON.stringify(l));return Boolean(storage)}catch{return false}}

 // ---- events and maintenance ----
 const now=()=>Date.now()+skew;
 const activeEvents=()=>live.events.filter(e=>e.startsAt<=now()&&e.endsAt>now());
 const coinBonus=()=>Math.max(0,...activeEvents().map(e=>e.coinBonus|0));
 const bonusCoins=base=>Math.round((base|0)*coinBonus()/100);
 async function refreshLive(){
  try{const r=await fetch('api/live',{cache:'no-store'});if(!r.ok)return;const d=await r.json();
   if(!Array.isArray(d.events)||!d.maintenance)return;
   live={events:d.events.filter(e=>e&&Number.isFinite(e.startsAt)&&Number.isFinite(e.endsAt)),maintenance:{on:d.maintenance.on===true,message:String(d.maintenance.message||'')}};
   if(Number.isFinite(d.now))skew=d.now-Date.now();
  }catch{/* offline or no server */}
  paintBanner();
 }
 function paintBanner(){
  if(!banner)return;
  const strips=[];
  if(live.maintenance.on)strips.push(`<p class="live-strip maintenance"><span aria-hidden="true">🛠️</span><b>ปิดปรับปรุงระบบออนไลน์</b><small>${esc(live.maintenance.message||'เล่นได้ตามปกติ เซฟในเครื่องไม่หาย ระบบของขวัญจะกลับมาเร็วๆ นี้')}</small></p>`);
  for(const e of activeEvents())strips.push(`<p class="live-strip"><span aria-hidden="true">${esc(e.icon||'🎉')}</span><b>${esc(e.title)}${e.coinBonus?` · เหรียญจากด่าน +${e.coinBonus|0}%`:''}</b><small>${esc(e.message)}${e.message?' · ':''}ถึง ${esc(when(e.endsAt-skew))}</small></p>`);
  banner.innerHTML=strips.join('');banner.hidden=!strips.length;
 }

 // ---- gift box ----
 async function refreshGifts(){
  const t=token();signedIn=Boolean(t);
  if(!t){gifts=[];loaded=true;paint();return}
  try{const r=await fetch('api/gifts',{headers:{Authorization:'Bearer '+t},cache:'no-store'});
   if(r.status===401)signedIn=false;
   if(r.ok){const d=await r.json();gifts=Array.isArray(d.gifts)?d.gifts.filter(g=>g&&Number.isSafeInteger(g.id)):[];loaded=true}
  }catch{/* offline */}
  paint();
 }
 const waiting=()=>gifts.length+readLedger().pending.length;
 function paint(){
  if(tabButton){const n=waiting(),badge=tabButton.querySelector('.daily-badge');if(badge)badge.textContent=n?String(n):'';tabButton.classList.toggle('has-reward',n>0)}
  if(dialog?.open)render();
 }
 // Pay every claimed-but-unpaid gift in one save write. Marking and paying happen inside the save lock.
 async function payPending(){
  if(!app||!readLedger().pending.length||!app.canClaim())return;
  let paid={coins:0,cookies:0,n:0};
  const ok=await app.savedAction(()=>{
   const l=readLedger(),fresh=l.pending.filter(p=>!l.paid.includes(p.id));
   if(!l.pending.length)return false;
   paid={coins:fresh.reduce((a,p)=>a+p.coins,0),cookies:fresh.reduce((a,p)=>a+p.cookies,0),n:fresh.length};
   l.paid=[...l.paid,...l.pending.map(p=>p.id)].slice(-300);l.pending=[];
   if(!writeLedger(l))return false;
   if(paid.n)app.pay(paid.coins,paid.cookies);return paid.n>0;
  });
  if(ok&&(paid.coins||paid.cookies))app.toast(`🎁 ได้รับ${paid.coins?` ${paid.coins} เหรียญ`:''}${paid.cookies?` คุกกี้ดาว ${paid.cookies} ชิ้น`:''} จากของขวัญแล้ว!`);
  paint();
 }
 async function claim(id){
  const t=token();if(!app||busy||!t||!app.canClaim())return false;
  busy=true;render();let done=false;
  try{
   const r=await fetch('api/gifts',{method:'POST',headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({id}),cache:'no-store'});
   let d={};try{d=await r.json()}catch{}
   if(r.ok&&d.gift){
    // paid 'wallet': the server already added the coins; only cookies are paid here. 'local' (older server): both.
    const wallet=d.paid==='wallet',coins=wallet?0:count(d.gift.coins,MAX_COINS)??0,cookies=count(d.gift.cookies,MAX_COOKIES)??0;
    const l=readLedger();
    if((coins||cookies)&&!l.paid.includes(id)&&!l.pending.some(p=>p.id===id)){l.pending.push({id,coins,cookies,title:String(d.gift.title||'').slice(0,60)});writeLedger(l)}
    if(wallet&&d.gift.coins){app.toast(`🎁 รับ ${d.gift.coins} เหรียญแล้ว กำลังอัปเดตยอดจากเซิร์ฟเวอร์`);window.SideviewWallet?.flush({fresh:true})}
    gifts=gifts.filter(g=>g.id!==id);done=true;
   }else if(r.status===409||r.status===404){gifts=gifts.filter(g=>g.id!==id);app.toast(r.status===409?'ของขวัญนี้รับไปแล้ว':'ของขวัญนี้หมดเขตแล้ว')}
   else if(d.error==='maintenance')app.toast('🛠️ ปิดปรับปรุงอยู่ รับของขวัญได้อีกครั้งเร็วๆ นี้');
   else if(r.status===401){signedIn=false;app.toast('เครื่องนี้ออกจากบัญชีแล้ว เข้าบัญชีใหม่ที่ปุ่ม ☁️')}
   else app.toast('รับของขวัญไม่ได้ตอนนี้ ลองใหม่อีกครั้ง');
  }catch{app.toast('ออฟไลน์อยู่ ต่อเน็ตแล้วรับของขวัญได้')}
  finally{busy=false}
  await payPending();render();return done;
 }
 async function claimAll(){for(const g of [...gifts]){if(!app.canClaim())break;await claim(g.id)}}
 function render(){
  if(!dialog)return;
  const open=Boolean(app?.canClaim()),pending=readLedger().pending,cloud=window.SideviewCloud?.enabled;
  let html='<h2>🎁 กล่องของขวัญ</h2>';
  if(live.maintenance.on)html+=`<p class="gift-note warn">🛠️ ${esc(live.maintenance.message||'ปิดปรับปรุงระบบออนไลน์ชั่วคราว')}</p>`;
  if(!cloud&&!signedIn)html+='<p>ระบบออนไลน์ยังไม่เปิดในเว็บนี้ ของขวัญจะมาที่นี่เมื่อเปิดแล้ว</p>';
  else if(!signedIn)html+='<p>ของขวัญส่งถึงบัญชีผู้เล่น สร้างบัญชี (ไม่ต้องใช้อีเมล) เพื่อรับของขวัญและสำรองเซฟ</p><button type="button" class="primary" data-act="account">☁️ สร้างหรือเข้าบัญชี</button>';
  else{
   if(pending.length)html+=`<p class="gift-note">มีของขวัญที่รับแล้วรอเข้าเซฟ ${pending.length} ชิ้น${open?'':' · จะเข้าหลังจบรอบ'}</p>`;
   html+=gifts.length?`<ul class="gift-list">${gifts.map(g=>`<li><span class="gift-icon" aria-hidden="true">🎁</span><div><b>${esc(g.title)}</b>${g.message?`<small>${esc(g.message)}</small>`:''}
     <span class="gift-reward">${g.coins?`◉ ${g.coins}`:''}${g.cookies?` ★ ${g.cookies}`:''}</span><small>หมดเขต ${esc(when(g.expiresAt-skew))}</small></div>
     <button type="button" class="primary" data-gift="${g.id}" ${open&&!busy&&!live.maintenance.on?'':'disabled'}>รับ</button></li>`).join('')}</ul>
     ${gifts.length>1?`<button type="button" class="secondary" data-act="all" ${open&&!busy&&!live.maintenance.on?'':'disabled'}>รับทั้งหมด</button>`:''}`
    :`<p class="gift-empty">${loaded?'ยังไม่มีของขวัญ แวะมาดูใหม่นะ':'กำลังโหลด…'}</p>`;
   html+=`<p class="gift-note">${open?'ของขวัญมีวันหมดเขต รับได้บัญชีละครั้ง':'รับของขวัญได้ก่อนเริ่มด่าน หรือหลังจบรอบ (รับรางวัลด่านก่อน)'}</p>`;
  }
  html+='<form method="dialog"><button class="secondary" value="close">ปิด</button></form>';
  dialog.innerHTML=html;
 }
 function openGifts(){render();if(dialog?.showModal&&!dialog.open)dialog.showModal();refreshGifts().then(payPending)}

 function mount(bridge){
  app=bridge;
  banner=document.createElement('div');banner.className='live-banner';banner.hidden=true;
  const kicker=document.getElementById('modalKicker');kicker?kicker.after(banner):document.getElementById('modal')?.prepend(banner);
  dialog=document.createElement('dialog');dialog.className='gift-dialog cloud-dialog';
  dialog.addEventListener('click',event=>{
   const id=Number(event.target.closest('[data-gift]')?.dataset.gift);if(id)claim(id);
   const act=event.target.closest('[data-act]')?.dataset.act;
   if(act==='all')claimAll();
   if(act==='account'){dialog.close();document.querySelector('.cloud-chip')?.click()}
  });
  document.body.append(dialog);
  tabButton=document.querySelector('.lobby-tabs [data-tab="gifts"]');
  window.addEventListener('storage',event=>{if(event.key===CLOUD)refreshGifts();if(event.key===KEY)paint()});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){refreshLive();refreshGifts()}});
  window.addEventListener('online',()=>{refreshLive();refreshGifts()});
  setInterval(refreshLive,5*60e3);setInterval(()=>{paintBanner();refreshGifts().then(payPending)},2*60e3);
  // A gift claimed just before the page closed is paid at the next safe moment.
  setInterval(payPending,5000);
  refreshLive();refreshGifts();
 }
 window.SideviewLive={KEY,mount,openGifts,refreshGifts,refreshLive,payPending,coinBonus,bonusCoins,get events(){return activeEvents()},get maintenance(){return live.maintenance},get gifts(){return gifts}};
})();
