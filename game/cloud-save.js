/* 1.11: guest account + cloud save, backed by functions/api/[[path]].js on the same origin.
   The local save stays the one the game plays from (and works offline). The cloud is a copy:
   - after any change the bundle {save file, stage/level meta, daily missions} is uploaded with compare-and-swap,
   - a newer cloud copy from another device is never applied by itself; the player picks which one to keep,
   - restoring goes through SideviewBridge.importCloud, which only runs before a battle or after the reward.
   Sign-in state lives in its own key, little-rescue-cloud-v1, never in the save. If the server has no database
   (or the page is opened without the API, e.g. from a file), the cloud button stays hidden. */
(()=>{
 'use strict';
 const KEY='little-rescue-cloud-v1',LOCK='little-rescue-cloud-sync',DAILY='little-rescue-daily-v1',SUMMON='little-rescue-summon-v1';
 const $=id=>document.getElementById(id);
 let storage=null;try{storage=window.localStorage}catch{}
 let enabled=false,busy=false,conflict=null,status='',button=null,dialog=null,showCode=false;

 const readState=()=>{try{const s=JSON.parse(storage?.getItem(KEY)||'null');
  if(s&&s.v===1&&typeof s.token==='string'&&typeof s.playerId==='string')return {v:1,playerId:s.playerId,token:s.token,
   recoveryCode:typeof s.recoveryCode==='string'?s.recoveryCode:'',rev:Number.isSafeInteger(s.rev)?s.rev:0,
   synced:typeof s.synced==='string'?s.synced:'',choose:s.choose===true}}catch{}return null};
 const writeState=s=>{try{if(s)storage.setItem(KEY,JSON.stringify(s));else storage.removeItem(KEY)}catch{}};
 const withLock=fn=>navigator.locks?navigator.locks.request(LOCK,fn):fn();

 async function api(path,{method='GET',body,token,keepalive=false}={}){
  const headers={};if(body)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;
  const response=await fetch('api/'+path,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store',keepalive});
  let data={};try{data=await response.json()}catch{}
  return {status:response.status,data};
 }

 // ---- bundle ----
 async function localBundle(){
  const snapshot=await window.SideviewBridge.exportSave();
  const transfer=JSON.parse(window.SideviewTransfer.create(snapshot));
  let daily=null;try{const d=JSON.parse(storage?.getItem(DAILY)||'null');if(d&&d.v===1)daily=d}catch{}
  // 1.12 summon stars and shards ride along; a bundle from an older build simply has none.
  let summon=null;try{const s=JSON.parse(storage?.getItem(SUMMON)||'null');if(s&&s.v===1)summon=s}catch{}
  return {format:'little-rescue-cloud',formatVersion:1,transfer,meta:window.SideviewBridge.meta(),daily,summon};
 }
 // What counts as "changed": the save data, not the export time.
 const fingerprint=b=>JSON.stringify([b.transfer.save,b.meta,b.daily,b.summon||null]);
 function summary(b){
  if(!b?.transfer?.save)return 'ไม่มีข้อมูล';
  const s=b.transfer.save,m=b.meta||{},levels=Array.isArray(m.levels)?m.levels.reduce((a,n)=>a+n,0):0;
  return `ผ่าน ${m.cleared||0} ด่าน · เหรียญ ${s.progress.coins} · คุกกี้ดาว ${s.energy.value} · เลเวลรวม ${levels}`;
 }
 const when=t=>t?new Date(t).toLocaleString('th-TH',{dateStyle:'medium',timeStyle:'short'}):'';
 const safeNow=()=>window.SideviewBridge?.safe()&&window.SideviewPWA?.canAct();

 // ---- sync ----
 async function sync({keepalive=false}={}){
  if(!enabled||busy||!navigator.onLine||!window.SideviewBridge?.snapshot().ready)return;
  busy=true;
  try{await withLock(async()=>{
   const state=readState();if(!state||state.choose||conflict)return;
   const bundle=await localBundle(),print=fingerprint(bundle);
   if(print===state.synced)return;
   const {status:code,data}=await api('save',{method:'PUT',token:state.token,body:{baseRev:state.rev,bundle},keepalive});
   if(code===200){writeState({...state,rev:data.rev,synced:print});setStatus(`สำรองขึ้นคลาวด์แล้ว ${when(data.savedAt)}`)}
   else if(code===409){conflict={rev:data.rev,savedAt:data.savedAt,bundle:data.bundle,local:bundle};setStatus('มีเซฟบนคลาวด์ที่ใหม่กว่าจากเครื่องอื่น เลือกว่าจะเก็บอันไหน');render(false)}
   else if(code===401){writeState(null);setStatus('เครื่องนี้ออกจากบัญชีแล้ว เซฟในเครื่องยังอยู่ครบ')}
   else setStatus('สำรองขึ้นคลาวด์ไม่สำเร็จ จะลองใหม่อัตโนมัติ');
  })}catch{setStatus('ออฟไลน์อยู่ เซฟในเครื่องยังบันทึกปกติ จะสำรองเมื่อออนไลน์')}
  finally{busy=false;paint()}
 }

 // After signing in on a device that already has its own progress, ask once before anything is overwritten.
 async function compareAfterLogin(state,open=true){
  const [{status:code,data},bundle]=await Promise.all([api('save',{token:state.token}),localBundle()]);
  if(code!==200)throw new Error('load');
  if(!data.bundle){writeState({...state,rev:data.rev,choose:false});return}
  if(fingerprint(data.bundle)===fingerprint(bundle)){writeState({...state,rev:data.rev,synced:fingerprint(bundle),choose:false});return}
  conflict={rev:data.rev,savedAt:data.savedAt,bundle:data.bundle,local:bundle};render(open);
 }

 // Another device may have uploaded since this one last synced. If nothing here changed since then, take the
 // newer copy (only before a battle or after the reward); if both changed, ask.
 async function pull(){
  if(!enabled||busy||conflict||!navigator.onLine||!window.SideviewBridge?.snapshot().ready)return;
  const state=readState();if(!state||state.choose)return;
  busy=true;let take=false;
  try{
   const {status:code,data}=await api('save',{token:state.token});
   if(code===401){writeState(null);return}
   if(code!==200||!data.bundle||data.rev===state.rev)return;
   const bundle=await localBundle();
   conflict={rev:data.rev,savedAt:data.savedAt,bundle:data.bundle,local:bundle};
   take=fingerprint(bundle)===state.synced&&safeNow();
   if(!take){setStatus('มีเซฟบนคลาวด์ที่ใหม่กว่าจากเครื่องอื่น เลือกว่าจะเก็บอันไหน');render(false)}
  }catch{/* offline: try again later */}finally{busy=false;paint()}
  if(take)await keepCloud();
 }
 async function keepCloud(){
  const pending=conflict;if(!pending)return;
  if(!safeNow()){setStatus('จบรอบและรับรางวัลก่อน แล้วกดใช้เซฟจากคลาวด์อีกครั้ง');return}
  const t=pending.bundle.transfer,anchor=t?.save?.energy?.anchor,stamp=Math.max(Date.now(),t?.exportedAt||0,Number.isSafeInteger(anchor)?anchor:0);
  // Clocks differ between devices; accept a cloud copy up to a day "ahead" of this one.
  if(stamp-Date.now()>86400000){setStatus('เวลาในเครื่องนี้ไม่ตรง ตั้งเวลาให้ถูกแล้วลองใหม่');return}
  let ok=false;
  try{ok=await window.SideviewBridge.importCloud(t,pending.bundle.meta,pending.bundle.daily?.v===1?pending.bundle.daily:null,stamp,pending.bundle.summon?.v===1?pending.bundle.summon:null)}catch{ok=false}
  if(!ok){setStatus('ใช้เซฟจากคลาวด์ไม่สำเร็จ เซฟในเครื่องไม่ถูกแก้');return}
  const state=readState(),now=await localBundle();
  if(state)writeState({...state,rev:pending.rev,synced:fingerprint(now),choose:false});
  conflict=null;setStatus('โหลดเซฟจากคลาวด์มาเครื่องนี้แล้ว');render(false);
 }
 async function keepLocal(){
  const pending=conflict;if(!pending)return;
  const state=readState();if(!state)return;
  // Upload against the cloud's current revision: this is the player's explicit choice to replace it.
  writeState({...state,rev:pending.rev,synced:'',choose:false});conflict=null;render(false);await sync();
 }

 async function create(){
  if(busy)return;busy=true;setStatus('กำลังสร้างบัญชี…');
  try{const {status:code,data}=await api('account',{method:'POST'});
   if(code!==201)throw new Error();
   writeState({v:1,playerId:data.playerId,token:data.token,recoveryCode:data.recoveryCode,rev:0,synced:'',choose:false});
   showCode=true;setStatus('สร้างบัญชีแล้ว จดรหัสกู้บัญชีด้านล่างเก็บไว้');
  }catch{setStatus('สร้างบัญชีไม่ได้ตอนนี้ โปรดลองใหม่เมื่อออนไลน์')}
  finally{busy=false;render()}
  sync();
 }
 async function login(code){
  if(busy)return;busy=true;setStatus('กำลังเข้าสู่ระบบ…');
  try{const {status:code2,data}=await api('login',{method:'POST',body:{recoveryCode:code}});
   if(code2===404||code2===400){setStatus('ไม่พบรหัสนี้ ตรวจตัวอักษรอีกครั้ง (16 ตัว)');return}
   if(code2!==200)throw new Error();
   const state={v:1,playerId:data.playerId,token:data.token,recoveryCode:code.toUpperCase().trim(),rev:0,synced:'',choose:true};
   writeState(state);setStatus('เข้าสู่ระบบแล้ว');await compareAfterLogin(state);
  }catch{setStatus('เข้าสู่ระบบไม่ได้ตอนนี้ โปรดลองใหม่เมื่อออนไลน์')}
  finally{busy=false;render()}
  sync();
 }
 async function newCode(){
  const state=readState();if(!state||busy)return;
  if(!confirm('สร้างรหัสกู้บัญชีใหม่? รหัสเดิมจะใช้ไม่ได้อีก (เครื่องที่เข้าอยู่แล้วยังใช้ได้)'))return;
  busy=true;
  try{const {status:code,data}=await api('recovery',{method:'POST',token:state.token});if(code!==200)throw new Error();
   writeState({...readState(),recoveryCode:data.recoveryCode});showCode=true;setStatus('ได้รหัสใหม่แล้ว จดเก็บไว้')}
  catch{setStatus('เปลี่ยนรหัสไม่ได้ตอนนี้')}finally{busy=false;render()}
 }
 async function logout(){
  const state=readState();if(!state)return;
  if(!confirm('ออกจากบัญชีบนเครื่องนี้? เซฟในเครื่องยังอยู่ แต่จะไม่สำรองขึ้นคลาวด์จนกว่าจะเข้าใหม่ด้วยรหัสกู้บัญชี'))return;
  try{await api('logout',{method:'POST',token:state.token})}catch{}
  writeState(null);conflict=null;showCode=false;setStatus('ออกจากบัญชีแล้ว');render();
 }

 // ---- UI ----
 function setStatus(text){status=text;const el=dialog?.querySelector('.cloud-status');if(el)el.textContent=text}
 function paint(){
  if(!button)return;const state=readState();
  button.hidden=!enabled;
  button.dataset.state=conflict||state?.choose?'warn':state?'on':'off';
  button.querySelector('small').textContent=conflict||state?.choose?'เลือกเซฟ':state?(navigator.onLine?'สำรองแล้ว':'ออฟไลน์'):'ยังไม่สำรอง';
 }
 function render(open){
  if(!dialog)return;const state=readState(),esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]);
  let html='<button type="button" class="dialog-x" aria-label="ปิด" title="ปิด (Escape)" data-act="close">✕</button><h2>☁️ บัญชีและเซฟบนคลาวด์</h2>';
  if(conflict){
   html+=`<p>เซฟในเครื่องนี้กับบนคลาวด์ไม่ตรงกัน เลือกอันที่จะเก็บ อีกอันจะถูกแทนที่</p>
    <div class="cloud-choice"><button type="button" data-act="cloud"><b>ใช้เซฟจากคลาวด์</b><small>${esc(summary(conflict.bundle))}</small><small>บันทึก ${esc(when(conflict.savedAt))}</small></button>
    <button type="button" data-act="local"><b>ใช้เซฟเครื่องนี้</b><small>${esc(summary(conflict.local))}</small><small>แทนที่เซฟบนคลาวด์</small></button></div>
    <p class="cloud-note">ใช้เซฟจากคลาวด์ได้ก่อนเริ่มด่าน หรือหลังรับรางวัลแล้วเท่านั้น</p>`;
  }else if(state){
   html+=`<p>รหัสผู้เล่น <b>${esc(state.playerId)}</b> · เซฟสำรองขึ้นคลาวด์ให้อัตโนมัติเมื่อออนไลน์</p>
    <div class="cloud-code"><span>รหัสกู้บัญชี</span><code>${showCode?esc(state.recoveryCode||'— กดสร้างรหัสใหม่ —'):'••••-••••-••••-••••'}</code>
    <button type="button" data-act="toggle">${showCode?'ซ่อน':'แสดง'}</button>${showCode&&state.recoveryCode?'<button type="button" data-act="copy">คัดลอก</button>':''}</div>
    <p class="cloud-note">ใช้รหัสนี้เข้าเล่นบนมือถือ/คอมเครื่องอื่น หรือหลังล้างข้อมูลเบราว์เซอร์ อย่าให้ใคร เพราะใครมีรหัสก็เข้าบัญชีนี้ได้</p>
    <div class="cloud-actions"><button type="button" data-act="sync">สำรองตอนนี้</button><button type="button" data-act="newcode">เปลี่ยนรหัสกู้บัญชี</button><button type="button" data-act="logout">ออกจากบัญชีบนเครื่องนี้</button></div>`;
  }else{
   html+=`<p>ตอนนี้เซฟอยู่ในเครื่องนี้เท่านั้น ถ้าเปลี่ยนมือถือหรือล้างข้อมูลเบราว์เซอร์ ของจะหาย สร้างบัญชีเพื่อสำรองขึ้นคลาวด์ ไม่ต้องใช้อีเมล</p>
    <div class="cloud-actions"><button type="button" class="primary" data-act="create">สร้างบัญชีและสำรองเซฟ</button></div>
    <form class="cloud-login"><label>มีบัญชีอยู่แล้ว? ใส่รหัสกู้บัญชี<input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX" maxlength="24"></label><button type="submit">เข้าสู่ระบบ</button></form>
    <p class="cloud-note">เข้าระบบบนเครื่องที่มีเซฟอยู่แล้ว เกมจะถามก่อนว่าจะเก็บเซฟไหน ไม่ลบให้เอง</p>`;
  }
  html+=`<p class="cloud-status" role="status" aria-live="polite">${esc(status)}</p><div class="cloud-actions"><button type="button" data-act="close">ปิด</button></div>`;
  dialog.innerHTML=html;paint();
  if(open&&!dialog.open)dialog.showModal();
 }
 function onClick(event){
  const act=event.target.closest('[data-act]')?.dataset.act;if(!act)return;
  const state=readState();
  if(act==='close')dialog.close();
  if(act==='create')create();
  if(act==='cloud')keepCloud();
  if(act==='local'&&confirm('แทนที่เซฟบนคลาวด์ด้วยเซฟเครื่องนี้?'))keepLocal();
  if(act==='sync'){setStatus('กำลังสำรอง…');sync()}
  if(act==='newcode')newCode();
  if(act==='logout')logout();
  if(act==='toggle'){showCode=!showCode;render()}
  if(act==='copy'&&state?.recoveryCode)navigator.clipboard?.writeText(state.recoveryCode).then(()=>setStatus('คัดลอกรหัสแล้ว'),()=>setStatus('คัดลอกไม่ได้ โปรดจดเอง'));
 }

 async function start(){
  try{const {status:code,data}=await api('health');enabled=code===200&&data.cloud===true}catch{enabled=false}
  if(!enabled){paint();return}
  // A sign-in that was interrupted before the player chose a save asks again.
  while(!window.SideviewBridge?.snapshot().ready)await new Promise(done=>setTimeout(done,300));
  const state=readState();if(state?.choose)await compareAfterLogin(state,false).catch(()=>{});
  await pull();sync();
 }
 function mount(){
  button=document.createElement('button');button.type='button';button.className='cloud-chip';button.hidden=true;
  button.title='บัญชีและเซฟบนคลาวด์';button.innerHTML='<span aria-hidden="true">☁️</span><small></small>';
  button.addEventListener('click',()=>render(true));
  // Inside the start/result card: the only screens where a cloud copy may replace the save.
  document.getElementById('modal')?.prepend(button);
  dialog=document.createElement('dialog');dialog.className='cloud-dialog';dialog.addEventListener('click',onClick);
  dialog.addEventListener('submit',event=>{event.preventDefault();const code=new FormData(event.target).get('code');if(code)login(String(code))});
  document.body.append(dialog);
  window.addEventListener('online',()=>{paint();sync()});window.addEventListener('offline',paint);
  window.addEventListener('storage',event=>{if(event.key===KEY){if(!readState())conflict=null;paint()}});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')sync({keepalive:true});else pull()});
  setInterval(sync,15000);
  start();
 }
 window.SideviewCloud={KEY,sync,pull,mount,get enabled(){return enabled},get conflict(){return conflict},_fingerprint:fingerprint};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount);else mount();
})();
