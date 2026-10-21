/* 1.18: testnet main token (tLRT) and hero NFTs (tLRH), backed by functions/api/chain/[[path]].js.
   TESTNET ONLY (Base Sepolia): nothing here has money value, nothing is bought, and coins/gems are never spent or
   turned into tokens. The server decides everything from its own wallet (stages cleared, hero stars), so this file
   only shows the state and sends requests; it writes no save key and no localStorage at all.
   Hidden unless the server has the testnet switched on (GET api/chain/status answers 200); then a strip appears at
   the top of the hero book (สะสม) tab and opens one dialog. Needs the cloud account (☁️) for anything personal. */
(()=>{
 'use strict';
 const CLOUD='little-rescue-cloud-v1';
 const ERRORS={'no-wallet':'เชื่อมกระเป๋าก่อน','play-first':'ผ่านด่านอย่างน้อย 1 ด่านก่อน แล้วค่อยรับเหรียญทดลอง','need-stars':'ฮีโร่ตัวนี้ยังมีดาวไม่พอ',
  'hero-locked':'ยังไม่มีฮีโร่ตัวนี้','already-claimed':'รับไปแล้ว','not-deployed':'ทีมงานยังเตรียมสัญญาบน testnet ไม่เสร็จ','daily-cap':'วันนี้แจกเหรียญทดลองครบเพดานแล้ว พรุ่งนี้มาใหม่นะ',
  'chain-busy':'เครือข่ายทดลองไม่ตอบ ลองใหม่อีกครั้ง','rpc-unreachable':'เครือข่ายทดลองไม่ตอบ ลองใหม่อีกครั้ง','wrong-chain':'เซิร์ฟเวอร์ต่อผิดเครือข่าย แจ้งทีมงาน',
  'bad-address':'ที่อยู่กระเป๋าไม่ถูกต้อง (0x ตามด้วย 40 ตัว)','bad-signature':'ลายเซ็นไม่ตรงกับกระเป๋านี้','stale-signature':'หมดเวลา ลองเชื่อมใหม่','signed-out':'เครื่องนี้ออกจากบัญชีแล้ว เข้าบัญชีใหม่ที่ปุ่ม ☁️'};
 const STATUS={pending:'กำลังส่ง…',sent:'ส่งแล้ว รอยืนยัน',done:'สำเร็จ',failed:'ไม่สำเร็จ ลองใหม่ได้'};
 const esc=t=>String(t??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
 const short=a=>a?a.slice(0,6)+'…'+a.slice(-4):'';
 let storage=null;try{storage=window.localStorage}catch{}
 let app=null,dialog=null,state=null,enabled=false,busy=false,note='';

 const token=()=>{try{const s=JSON.parse(storage?.getItem(CLOUD)||'null');return s?.v===1&&typeof s.token==='string'?s.token:''}catch{return ''}};
 async function api(path,{method='GET',body}={}){
  const headers={},t=token();if(body)headers['Content-Type']='application/json';if(t)headers.Authorization='Bearer '+t;
  const response=await fetch('api/chain/'+path,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store'});
  let data={};try{data=await response.json()}catch{}
  return {status:response.status,data};
 }
 async function load(){
  try{const {status,data}=await api('status');
   const was=enabled;enabled=status===200&&data.enabled===true&&data.testnet===true;state=enabled?data:null;
   if(was!==enabled)window.SideviewLobby?.renderBook();
  }catch{/* offline: keep what we had */}
  if(dialog?.open)render();
 }

 // ---- browser wallet (MetaMask and the like), optional ----
 const eth=()=>window.ethereum&&typeof window.ethereum.request==='function'?window.ethereum:null;
 const chainHex=()=>'0x'+state.network.chainId.toString(16);
 async function addNetwork(){
  await eth().request({method:'wallet_addEthereumChain',params:[{chainId:chainHex(),chainName:state.network.name+' (testnet)',
   nativeCurrency:{name:'Sepolia ETH',symbol:'ETH',decimals:18},rpcUrls:[state.network.rpc],blockExplorerUrls:[state.network.explorer]}]});
 }
 async function watchToken(){
  await eth().request({method:'wallet_watchAsset',params:{type:'ERC20',options:{address:state.contracts.token,symbol:'tLRT',decimals:18}}});
 }
 async function connectBrowser(){
  const provider=eth();if(!provider)return;
  const [address]=await provider.request({method:'eth_requestAccounts'});
  await load();if(!state?.message)throw new Error('signed-out');
  const hex='0x'+Array.from(new TextEncoder().encode(state.message),b=>b.toString(16).padStart(2,'0')).join('');
  const signature=await provider.request({method:'personal_sign',params:[hex,address]});
  return api('link',{method:'POST',body:{address,signature,at:state.messageAt}});
 }

 async function act(fn,done){
  if(busy)return;busy=true;note='';render();
  try{const r=await fn();
   if(r&&r.status>=400)note=ERRORS[r.data.error]||`ทำไม่ได้ตอนนี้ (${r.data.error||r.status})`;
   else if(r&&r.status===202)note='กำลังส่งอยู่ รอสักครู่แล้วเปิดดูใหม่';
   else if(done)note=done;
  }catch(error){note=error?.code===4001?'ยกเลิกในกระเป๋าแล้ว':ERRORS[error?.message]||'ทำไม่ได้ตอนนี้ ลองใหม่อีกครั้ง'}
  finally{busy=false}
  await load();render();
 }
 const claimLine=c=>c?`<span class="chain-status ${esc(c.status)}">${esc(STATUS[c.status]||c.status)}</span>${c.explorer?` <a href="${esc(c.explorer)}" target="_blank" rel="noopener">ดูบนเครือข่าย ↗</a>`:''}`:'';

 function render(){
  if(!dialog)return;
  let html='<button type="button" class="dialog-x" aria-label="ปิด" title="ปิด (Escape)" data-chain="close">✕</button>'+
   '<h2>🧪 เหรียญและ NFT ทดลอง</h2><p class="chain-badge">TESTNET · ไม่มีมูลค่าจริง</p>'+
   '<p class="chain-note">อยู่บนเครือข่ายทดลอง Base Sepolia เหรียญ tLRT และ NFT ฮีโร่ที่ได้ <b>ซื้อขายเป็นเงินไม่ได้</b> และอาจถูกล้างเมื่อเปิดระบบจริง เหรียญทองและเพชรในเกมไม่ถูกใช้ และไม่เปลี่ยนเป็นเหรียญนี้ NFT เป็นของสะสม ไม่ได้ทำให้ฮีโร่เก่งขึ้น</p>';
  if(!state){html+='<p>กำลังโหลด…</p>'}
  else if(!state.playerId){html+='<p>ต้องมีบัญชีผู้เล่นก่อน (ไม่ต้องใช้อีเมล)</p><button type="button" class="primary" data-chain="account">☁️ สร้างหรือเข้าบัญชี</button>'}
  else if(!state.ready){html+='<p>ทีมงานกำลังเตรียมสัญญาบน testnet แวะมาใหม่เร็วๆ นี้</p>'}
  else{
   const linked=state.linked,stars=state.rules.heroStar;
   html+='<h3>1. กระเป๋า</h3>';
   if(linked)html+=`<p class="chain-row">เชื่อมแล้ว <code title="${esc(linked.address)}">${esc(short(linked.address))}</code> ${linked.verified?'✅ ยืนยันแล้ว':'(ใส่ที่อยู่เอง ยังไม่ได้ยืนยันด้วยลายเซ็น)'}
    <button type="button" class="secondary" data-chain="unlink" ${busy?'disabled':''}>เปลี่ยนกระเป๋า</button></p>`;
   else html+=`${eth()?`<button type="button" class="primary" data-chain="connect" ${busy?'disabled':''}>เชื่อมกระเป๋าในเบราว์เซอร์</button>`:''}
    <form class="chain-paste" data-chain-form="paste"><label>หรือวางที่อยู่กระเป๋า<input name="address" autocomplete="off" spellcheck="false" placeholder="0x…" maxlength="42" required></label>
    <button type="submit" class="secondary" ${busy?'disabled':''}>บันทึก</button></form>
    <p class="chain-hint">ยังไม่มีกระเป๋า? ติดตั้ง MetaMask หรือ Coinbase Wallet แล้วสร้างกระเป๋าใหม่ ใช้กับเกมทดลองนี้เท่านั้น อย่าใช้กระเป๋าที่มีเงินจริง</p>`;
   html+=`<h3>2. เหรียญทดลองประจำวัน</h3><p class="chain-row">วันละ ${esc(state.rules.dailyTokens)} tLRT หลังผ่านด่าน
    ${state.today.claim&&state.today.claim.status!=='failed'?claimLine(state.today.claim)
     :`<button type="button" class="primary" data-chain="token" ${!linked||!state.today.canClaim||busy?'disabled':''}>รับ ${esc(state.rules.dailyTokens)} tLRT</button>`}</p>
    ${state.cleared<1?'<p class="chain-hint">ผ่านด่านอย่างน้อย 1 ด่านก่อน</p>':''}`;
   html+=`<h3>3. NFT ฮีโร่</h3><p class="chain-hint">ฮีโร่ที่มี ★${stars} ขึ้นไป ทำเป็น NFT ได้ตัวละ 1 ชิ้นต่อบัญชี</p><ul class="chain-heroes">`+
    state.heroes.filter(h=>h.owned).map(h=>{const u=app.UNITS.find(x=>x.id===h.unit);
     return `<li><img src="${esc(app.assetURL(u?.asset||''))}" alt=""><b>${esc(u?.name||h.unit)}</b><small>${'★'.repeat(h.star)}</small>
      ${h.claim&&h.claim.status!=='failed'?claimLine(h.claim):h.eligible?`<button type="button" class="primary" data-chain="hero" data-unit="${esc(h.unit)}" ${!linked||busy?'disabled':''}>ทำเป็น NFT</button>`
       :`<span class="chain-status">ต้องมี ★${stars}</span>`}</li>`}).join('')+'</ul>';
   if(eth())html+=`<div class="chain-extra"><button type="button" class="secondary" data-chain="network">เพิ่ม Base Sepolia ในกระเป๋า</button><button type="button" class="secondary" data-chain="watch">แสดง tLRT ในกระเป๋า</button></div>`;
   html+=`<p class="chain-hint">สัญญา: <a href="${esc(state.network.explorer)}/address/${esc(state.contracts.token)}" target="_blank" rel="noopener">เหรียญ tLRT ↗</a> · <a href="${esc(state.network.explorer)}/address/${esc(state.contracts.heroes)}" target="_blank" rel="noopener">NFT ฮีโร่ ↗</a></p>`;
  }
  html+=`<p class="chain-msg" role="status" aria-live="polite">${esc(note)}</p><form method="dialog"><button class="secondary" value="close">ปิด</button></form>`;
  dialog.innerHTML=html;
 }

 function open(){note='';render();if(dialog?.showModal&&!dialog.open)dialog.showModal();load()}
 // The strip at the top of the hero book; empty while the testnet is off.
 const bookStrip=()=>enabled?'<div class="chain-strip"><span aria-hidden="true">🧪</span><div><b>เหรียญและ NFT ทดลอง</b><small>TESTNET · ไม่มีมูลค่าจริง</small></div><button type="button" data-chain="open">เปิด</button></div>':'';

 function mount(bridge){
  app=bridge;
  dialog=document.createElement('dialog');dialog.className='chain-dialog cloud-dialog';
  dialog.addEventListener('click',event=>{
   const el=event.target.closest('[data-chain]');if(!el)return;const what=el.dataset.chain;
   if(what==='close')dialog.close();
   if(what==='account'){dialog.close();window.SideviewCloud?.open?.()}
   if(what==='connect')act(connectBrowser,'เชื่อมกระเป๋าแล้ว');
   if(what==='unlink')act(()=>api('unlink',{method:'POST'}),'ยกเลิกการเชื่อมแล้ว');
   if(what==='token')act(()=>api('claim',{method:'POST',body:{kind:'token'}}),'ส่งเหรียญทดลองแล้ว อาจใช้เวลาไม่กี่วินาที');
   if(what==='hero')act(()=>api('claim',{method:'POST',body:{kind:'hero',unit:el.dataset.unit}}),'ส่ง NFT แล้ว อาจใช้เวลาไม่กี่วินาที');
   if(what==='network')act(addNetwork);
   if(what==='watch')act(watchToken);
  });
  dialog.addEventListener('submit',event=>{
   if(event.target.dataset.chainForm!=='paste')return;event.preventDefault();
   const address=new FormData(event.target).get('address')?.toString().trim();
   act(()=>api('link',{method:'POST',body:{address}}),'บันทึกที่อยู่แล้ว');
  });
  document.body.append(dialog);
  document.addEventListener('click',event=>{if(event.target.closest('.chain-strip [data-chain="open"]'))open()});
  window.addEventListener('storage',event=>{if(event.key===CLOUD)load()});
  window.addEventListener('online',load);
  load();
 }
 window.SideviewChain={mount,open,load,bookStrip,get enabled(){return enabled},get state(){return state}};
})();
