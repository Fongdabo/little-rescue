/* 1.8: daily missions and a 7-day login reward. Progress lives in its own key, little-rescue-daily-v1, so the
   schema 2 save is never widened. Coins and cookies are paid through app.js savedAction, which holds the save lock,
   and the claim mark is written inside that lock, so two open tabs cannot claim the same reward twice. */
(()=>{
 'use strict';
 const KEY='little-rescue-daily-v1';
 const MISSIONS=[
  {id:'wins',goal:3,coins:30,label:'ชนะด่านใดก็ได้ 3 ครั้ง'},
  {id:'summons',goal:20,coins:20,label:'เรียกเพื่อนเข้าสนาม 20 ครั้ง'},
  {id:'levelups',goal:1,coins:20,label:'อัปเลเวลเพื่อน 1 ครั้ง'}];
 const LOGIN=[{coins:10},{coins:15},{coins:20},{coins:25},{coins:30},{coins:40},{coins:60,cookies:5}];
 const pad=n=>String(n).padStart(2,'0');
 const dayOf=date=>`${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
 const today=()=>dayOf(new Date());
 const dayBefore=day=>{const [y,m,d]=day.split('-').map(Number);return dayOf(new Date(y,m-1,d-1))};
 const isDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v);
 const count=v=>Number.isSafeInteger(v)&&v>=0?v:0;
 let storage=null;try{storage=window.localStorage}catch{}

 function read(){
  const day=today();let raw=null;
  try{raw=JSON.parse(storage?.getItem(KEY)||'null')}catch{}
  const login=raw&&raw.v===1&&raw.login?{streak:Math.min(count(raw.login.streak),9999),lastDay:isDay(raw.login.lastDay)?raw.login.lastDay:''}:{streak:0,lastDay:''};
  // A new day clears mission progress and claims; the login streak carries over.
  if(!raw||raw.v!==1||raw.day!==day)return {v:1,day,progress:{wins:0,summons:0,levelups:0},claimed:[],login};
  const progress={};for(const m of MISSIONS)progress[m.id]=count(raw.progress?.[m.id]);
  const claimed=Array.isArray(raw.claimed)?MISSIONS.map(m=>m.id).filter(id=>raw.claimed.includes(id)):[];
  return {v:1,day,progress,claimed,login};
 }
 function write(state){try{storage?.setItem(KEY,JSON.stringify(state));return Boolean(storage)}catch{return false}}
 // Day 1..7 the player would claim today, or 0 when today's login reward is already taken.
 function loginDay(state){
  if(state.login.lastDay===state.day)return 0;
  const kept=state.login.lastDay===dayBefore(state.day)?state.login.streak:0;
  return kept%LOGIN.length+1;
 }
 const missionReady=(state,m)=>state.progress[m.id]>=m.goal&&!state.claimed.includes(m.id);
 const claimable=state=>(loginDay(state)?1:0)+MISSIONS.filter(m=>missionReady(state,m)).length;
 function bump(id,amount=1){
  if(!MISSIONS.some(m=>m.id===id)||!(amount>0))return;
  const state=read();state.progress[id]=Math.min(9999,state.progress[id]+Math.floor(amount));write(state);refresh();
 }

 let app=null,button=null,modalButton=null,dialog=null;
 const claimOpen=()=>Boolean(app?.canClaim());
 function render(){
  if(!dialog)return;
  const state=read(),next=loginDay(state),open=claimOpen();
  const streakShown=next?next-1:((state.login.streak-1)%LOGIN.length)+1;
  dialog.querySelector('.daily-login').innerHTML=LOGIN.map((r,i)=>{
   const done=i<streakShown,now=next===i+1;
   return `<li class="${done?'done':''} ${now?'now':''}"><small>วัน ${i+1}</small><b>◉ ${r.coins}</b>${r.cookies?`<span>★ ${r.cookies}</span>`:''}${done?'<i aria-label="รับแล้ว">✓</i>':''}</li>`}).join('');
  const loginBtn=dialog.querySelector('[data-claim="login"]');
  loginBtn.disabled=!next||!open;loginBtn.textContent=next?`รับรางวัลเข้าเกมวันที่ ${next}`:'รับรางวัลวันนี้แล้ว · พรุ่งนี้มาใหม่นะ';
  dialog.querySelector('.daily-list').innerHTML=MISSIONS.map(m=>{
   const have=Math.min(m.goal,state.progress[m.id]),taken=state.claimed.includes(m.id),ready=missionReady(state,m);
   return `<li><div><b>${m.label}</b><div class="daily-track"><i style="width:${have/m.goal*100}%"></i></div><small>${have} / ${m.goal}</small></div>
    <button type="button" class="${ready?'primary':'secondary'}" data-claim="${m.id}" ${ready&&open?'':'disabled'}>${taken?'รับแล้ว ✓':`◉ ${m.coins}`}</button></li>`}).join('');
  dialog.querySelector('.daily-note').textContent=open?'ภารกิจรีเซ็ตทุกเที่ยงคืน (เวลาในเครื่อง) · ขาดวันเข้าเกม รางวัลจะเริ่มวันที่ 1 ใหม่':'รับรางวัลได้ก่อนเริ่มด่าน หรือหลังจบรอบ (รับรางวัลด่านก่อน)';
 }
 function refresh(){
  if(!button)return;
  const n=claimable(read());
  for(const el of [button,modalButton]){if(!el)continue;el.querySelector('.daily-badge').textContent=n?String(n):'';el.classList.toggle('has-reward',n>0);
   el.title=n?`ภารกิจรายวัน มีรางวัลรอรับ ${n} อย่าง`:'ภารกิจรายวัน'}
  if(dialog?.open)render();
 }
 async function claim(id){
  if(!app||!claimOpen())return;
  let reward=null;
  const ok=await app.savedAction(()=>{
   const state=read();
   if(id==='login'){const day=loginDay(state);if(!day)return false;reward=LOGIN[day-1];
    state.login={streak:state.login.lastDay===dayBefore(state.day)?state.login.streak+1:1,lastDay:state.day}}
   else{const m=MISSIONS.find(x=>x.id===id);if(!m||!missionReady(state,m))return false;reward={coins:m.coins};state.claimed.push(id)}
   // Mark first: if the save write fails afterwards the reward is lost, never paid twice.
   if(!write(state))return false;
   window.SideviewWallet?.record({kind:'daily',mission:id,day:state.day});
   app.pay(reward.coins,reward.cookies||0);return true;
  });
  if(ok&&reward)app.toast(`รับ ${reward.coins} เหรียญ${reward.cookies?` และคุกกี้ดาว ${reward.cookies} ชิ้น`:''} แล้ว!`);
  refresh();render();
 }
 function open(){render();if(dialog?.showModal)dialog.showModal()}
 function mount(bridge){
  app=bridge;
  button=document.createElement('button');button.type='button';button.className='daily-chip';
  button.innerHTML='<span aria-hidden="true">📋</span><span class="daily-text">ภารกิจ</span><span class="daily-badge" aria-hidden="true"></span>';
  button.title='ภารกิจรายวันและรางวัลเข้าเกม 7 วัน';button.setAttribute('aria-label','ภารกิจรายวัน');
  dialog=document.createElement('dialog');dialog.className='daily-dialog';dialog.setAttribute('aria-labelledby','dailyTitle');
  dialog.innerHTML=`<h2 id="dailyTitle">ภารกิจรายวัน</h2>
   <p class="daily-sub">เข้าเกมทุกวัน รับรางวัลต่อเนื่อง 7 วัน</p><ol class="daily-login"></ol>
   <button type="button" class="primary" data-claim="login"></button>
   <h3>ภารกิจวันนี้</h3><ul class="daily-list"></ul><p class="daily-note"></p>
   <form method="dialog"><button class="secondary" value="close">ปิด</button></form>`;
  dialog.addEventListener('click',event=>{const id=event.target.closest('[data-claim]')?.dataset.claim;if(id)claim(id)});
  // The start screen covers the header, so its lobby tab bar (lobby.js) carries the same badge.
  modalButton=document.querySelector('.lobby-tabs [data-tab="missions"]');
  button.addEventListener('click',open);
  window.addEventListener('storage',event=>{if(event.key===KEY)refresh()});
  // The day can roll over while the game stays open.
  setInterval(refresh,30000);
  const head=document.querySelector('.masthead');if(head){const install=head.querySelector('.install-chip');install?head.insertBefore(button,install):head.append(button)}
  document.body.append(dialog);refresh();
 }
 window.SideviewDaily={KEY,MISSIONS,LOGIN,read,loginDay,claimable,bump,mount,refresh,render,claim,open};
})();
