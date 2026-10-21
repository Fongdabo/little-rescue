/* 1.14: real-money shop tab (gem packs), backed by functions/api/shop/[[path]].js on the same origin.
   Gems are kept on the server only (the player's cloud account wallet), never in the local save, so buying
   needs a cloud account (☁️). Paying happens on Stripe's hosted page (card or PromptPay QR); Stripe tells the
   server, which credits the gems; the game only shows the result. The tab stays a "เร็วๆ นี้" placeholder when the
   server has no shop configured, and the shop only opens from the lobby, so leaving for checkout never cuts a battle.
   The last opened order is remembered in little-rescue-shop-v1 so the result shows even if the return link is lost. */
(()=>{
 'use strict';
 const KEY='little-rescue-shop-v1',CLOUD='little-rescue-cloud-v1';
 const STATUS={paid:'สำเร็จ',refunded:'คืนเงินแล้ว',partially_refunded:'คืนเงินบางส่วน',disputed:'ถูกโต้แย้งการชำระ',expired:'หมดเวลา',failed:'ชำระไม่สำเร็จ',created:'รอชำระ'};
 const ERRORS={'monthly-limit':'ซื้อครบวงเงินของเดือนนี้แล้ว','too-many-open-orders':'มีรายการรอชำระหลายรายการ รอสักครู่แล้วลองใหม่',
  'signed-out':'เครื่องนี้ออกจากบัญชีแล้ว เข้าบัญชีใหม่ที่ปุ่ม ☁️','payment-provider':'ระบบชำระเงินไม่ตอบ ลองใหม่อีกครั้ง'};
 const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
 const baht=n=>'฿'+Number(n).toLocaleString('th-TH');
 const when=t=>t?new Date(t).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'';
 let storage=null;try{storage=window.localStorage}catch{}
 let app=null,panel=null,config=null,wallet=null,busy=false,note='',watching=null;

 const token=()=>{try{const s=JSON.parse(storage?.getItem(CLOUD)||'null');return s?.v===1&&typeof s.token==='string'?s.token:''}catch{return ''}};
 const readPending=()=>{try{const s=JSON.parse(storage?.getItem(KEY)||'null');return s?.v===1&&typeof s.order==='string'?s:null}catch{return null}};
 const writePending=order=>{try{if(order)storage.setItem(KEY,JSON.stringify({v:1,order,at:Date.now()}));else storage.removeItem(KEY)}catch{}};
 async function api(path,{method='GET',body}={}){
  const headers={},t=token();if(body)headers['Content-Type']='application/json';if(t)headers.Authorization='Bearer '+t;
  const response=await fetch('api/shop/'+path,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});
  let data={};try{data=await response.json()}catch{}
  return {status:response.status,data};
 }

 async function loadWallet(){
  if(!token()){wallet=null;return}
  try{const {status,data}=await api('wallet');wallet=status===200?data:null;if(status===401)note=ERRORS['signed-out']}catch{wallet=null}
 }
 // After returning from checkout: Stripe's message to the server can take a few seconds, so ask again for a while.
 async function watch(order){
  if(watching===order)return;watching=order;note='กำลังตรวจการชำระเงิน…';render();
  for(let i=0;i<40&&watching===order;i++){
   try{const {status,data}=await api('order/'+encodeURIComponent(order));
    if(status===404||status===401){writePending(null);note=status===401?ERRORS['signed-out']:'';break}
    const s=data.order?.status;
    if(s==='paid'){writePending(null);note=`ได้รับ 💎 ${data.order.gems} แล้ว ขอบคุณที่สนับสนุนเกม!`;app.toast(`💎 +${data.order.gems}`);break}
    if(s&&s!=='created'){writePending(null);note=`รายการนี้${STATUS[s]||s}`;break}
   }catch{/* offline: keep trying */}
   await new Promise(done=>setTimeout(done,i<10?2000:5000));
   if(i===39)note='ยังไม่ได้รับการยืนยันการชำระ ถ้าชำระแล้ว เพชรจะเข้าเองภายหลัง ดูได้ที่ประวัติการซื้อ';
  }
  if(watching===order)watching=null;
  await loadWallet();render();
 }

 async function buy(packId){
  if(busy||!app.canAct())return;
  if(!token()){window.SideviewCloud?.open?.();return}
  busy=true;note='กำลังเปิดหน้าชำระเงิน…';render();
  try{
   const {status,data}=await api('checkout',{method:'POST',body:{pack:packId}});
   if(status!==201||!data.url)throw new Error(data.error||'');
   writePending(data.order);
   // Leave only from the lobby: the save is already on disk and no battle or reward is open.
   if(!app.canAct()){note='';return}
   location.assign(data.url);return;
  }catch(error){note=ERRORS[error.message]||'เปิดหน้าชำระเงินไม่ได้ตอนนี้ โปรดลองใหม่'}
  finally{busy=false}
  render();
 }

 function render(fetchFresh){
  if(!panel)return;
  if(fetchFresh===true){loadWallet().then(()=>render());}
  const signedIn=Boolean(token()),can=app.canAct()&&!busy,limit=config?.monthlyLimit||0;
  let html=`<div class="shop-head"><p class="roster-label">ร้านค้าเพชร</p><span class="shop-gems" aria-label="เพชรที่มี">💎 ${signedIn&&wallet?wallet.gems.toLocaleString('th-TH'):'–'}</span></div>`;
  if(config?.mode==='test')html+='<p class="shop-test">โหมดทดสอบ · ไม่มีการตัดเงินจริง · บัตรทดสอบ 4242 4242 4242 4242 วันหมดอายุอนาคตใดก็ได้</p>';
  if(!signedIn)html+=`<p class="shop-note">ซื้อเพชรต้องมีบัญชีคลาวด์ก่อน เพื่อให้เพชรไม่หายเมื่อเปลี่ยนเครื่อง</p>
   <button type="button" class="primary shop-account" data-shop="account">☁️ สร้างหรือเข้าบัญชี</button>`;
  html+=`<div class="shop-packs">${(config?.packs||[]).map(p=>`<button type="button" class="shop-pack" data-pack="${esc(p.id)}" ${can&&signedIn?'':'disabled'}>
   <b>${esc(p.name)}</b><span>💎 ${p.gems}${p.bonus?`<em>+${p.bonus}</em>`:''}</span><i>${baht(p.price)}</i></button>`).join('')}</div>`;
  if(wallet?.owed)html+=`<p class="shop-note">มีเพชร ${wallet.owed} ที่ต้องหักคืนจากการคืนเงินครั้งก่อน จะหักจากการซื้อครั้งถัดไป</p>`;
  html+=`<p class="shop-status" role="status" aria-live="polite">${esc(note)}</p>
   <details class="shop-rules"><summary>เพชรใช้ทำอะไร · กติกา</summary>
    <p>เพชรใช้สุ่มเพื่อนได้ในอัตราเดียวกับสุ่มด้วยเหรียญ (สุ่ม 1 ครั้ง 💎 30 · 10 ครั้ง 💎 270) ดูอัตราการสุ่มได้ที่แท็บ ✨ สุ่ม
     ทุกอย่างในเกมได้จากการเล่นด้วย ไม่มีตัวละครหรือพลังที่ซื้อได้ด้วยเงินอย่างเดียว</p>
    <p>ชำระผ่าน Stripe ด้วยบัตรหรือพร้อมเพย์ เกมไม่เห็นและไม่เก็บข้อมูลบัตร · ซื้อได้ไม่เกิน ${baht(limit)} ต่อเดือน · ผู้ที่อายุต่ำกว่า 20 ปีโปรดขออนุญาตผู้ปกครองก่อนซื้อ</p>
    <p>เพชรเก็บอยู่กับบัญชีคลาวด์ ไม่ใช่เงินจริง แลกคืนหรือโอนให้ผู้อื่นไม่ได้ · ถ้าได้รับการคืนเงิน เพชรของรายการนั้นจะถูกหักคืน</p>
   </details>`;
  if(signedIn&&wallet?.orders?.length)html+=`<p class="roster-label">ประวัติการซื้อ</p><ul class="shop-history">${wallet.orders.map(o=>`<li class="status-${esc(o.status)}">
   <span>${esc(when(o.paidAt||o.createdAt))}</span><b>💎 ${o.gems}</b><i>${baht(o.price)}</i><small>${esc(STATUS[o.status]||o.status)}${o.refundedGems?` · หักคืน 💎 ${o.refundedGems}`:''}</small></li>`).join('')}</ul>`;
  panel.innerHTML=html;
 }

 async function start(){
  try{const {status,data}=await api('config');config=status===200&&data.open?data:null}catch{config=null}
  if(!config)return;
  window.SideviewLobby?.enable('shop');
  const params=new URLSearchParams(location.search),back=params.get('shop'),order=params.get('order')||readPending()?.order;
  if(back){params.delete('shop');params.delete('order');history.replaceState(history.state,'',location.pathname+(params.size?'?'+params:'')+location.hash)}
  await loadWallet();render();
  if(back==='cancel'){writePending(null);note='ยกเลิกการชำระเงินแล้ว ไม่มีการตัดเงิน';render()}
  else if(order&&token()){if(back)window.SideviewLobby?.setTab('shop');watch(order)}
 }
 function mount(bridge){
  app=bridge;
  panel=document.createElement('div');panel.className='shop-panel';
  panel.addEventListener('click',event=>{
   const pack=event.target.closest('[data-pack]')?.dataset.pack;if(pack)buy(pack);
   if(event.target.closest('[data-shop="account"]'))window.SideviewCloud?.open?.();
  });
  document.getElementById('preflightControls').append(panel);
  // Signing in or out in the cloud dialog (this tab or another) changes what the shop can show.
  window.addEventListener('storage',event=>{if(event.key===CLOUD){loadWallet().then(()=>render())}});
  document.addEventListener('close',event=>{if(event.target.classList?.contains('cloud-dialog')&&config)render(true)},true);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&config&&window.SideviewLobby?.tab==='shop')render(true)});
  start();
 }
 window.SideviewShop={KEY,mount,render,get enabled(){return Boolean(config)},get wallet(){return wallet}};
})();
