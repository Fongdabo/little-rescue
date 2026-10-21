/* PWA controls. State stays in the schema 2 SaveStore, not Cache Storage. */
'use strict';
const PAGE_BUILD_ID='pwa-1.12.4';
(()=>{
 const $=id=>document.getElementById(id),scope=new URL('./',location.href).href;
 const lockName='little-rescue-pwa-lifecycle:'+scope;
 let registration=null,waitingBuildId=null,buildId=PAGE_BUILD_ID,updateState='idle',blockedClients=[],offlineReady=false;
 let frozen=null,held=false,releaseLease=null,leaseDone=null,installPrompt=null,preview=null,refreshing=false;
 const enabled=location.protocol==='https:'||(location.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname));
 const workerAPI=enabled&&'serviceWorker'in navigator;
 const canAct=()=>frozen===null&&(!navigator.locks||held);
 const safe=()=>Boolean(window.SideviewBridge?.safe());
 function acquire(){
   if(!navigator.locks){held=true;return Promise.resolve()}
   return new Promise((resolve,reject)=>{
     leaseDone=navigator.locks.request(lockName,{mode:'shared'},async()=>{
       held=true;resolve();await new Promise(done=>{releaseLease=done});held=false;
     });leaseDone.catch(reject);
   });
 }
 const gateReady=acquire().then(async()=>{
   // A new tab may have fetched an old page while an update held the lease.
   // Compare AFTER acquiring it, before this page can enter any battle.
   if(workerAPI&&typeof navigator.serviceWorker.getRegistration==='function'){
     const existing=await navigator.serviceWorker.getRegistration(scope);
     if(existing?.active){
       const current=await message(existing.active,{type:'GET_STATUS'});
       if(current.buildId!==PAGE_BUILD_ID){
         const marker='little-rescue-pwa-startup:'+scope+':'+current.buildId;
         if(sessionStorage.getItem(marker))throw new Error('ไฟล์รุ่นใหม่ไม่ตรงกัน โปรดปิดเกมทุกหน้าต่างแล้วเปิดใหม่เมื่อออนไลน์');
         sessionStorage.setItem(marker,'1');location.reload();return new Promise(()=>{});
       }
     }
   }
 });
 // 1.9: one big "อัปเดตเลย" button appears by itself when a new version is ready. It runs the same gated apply
 // as the button in the tools panel, so it still never reloads mid-battle or before a reward is claimed.
 const banner=document.createElement('button');banner.type='button';banner.className='update-banner';banner.hidden=true;
 banner.innerHTML='<span aria-hidden="true">✨</span><b>มีรุ่นใหม่</b><small></small>';
 banner.addEventListener('click',()=>$('applyUpdateBtn').click());
 const mountBanner=()=>document.body.append(banner);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountBanner,{once:true});else mountBanner();
 const inBattle=()=>['running','advancing','paused'].includes(window.SideviewBridge?.snapshot().state);
 let wasInBattle=false;
 function sync(){
   const canTransfer=safe()&&canAct();
   const battling=inBattle();
   // checking mid-battle only queues; look again the moment a battle ends
   if(wasInBattle&&!battling)setTimeout(autoCheck,1500);
   wasInBattle=battling;
   banner.hidden=!waitingBuildId||battling;
   banner.disabled=!canTransfer||updateState==='applying';
   banner.querySelector('small').textContent=updateState==='applying'?'กำลังอัปเดต…':updateState==='blocked'?'ปิดหน้าต่างเกมอื่นก่อน แล้วแตะอีกครั้ง':canTransfer?'แตะเพื่ออัปเดตเลย · เซฟอยู่ครบ':'จบด่านและรับรางวัลก่อน แล้วแตะอัปเดต';
   $('exportSaveBtn').disabled=!window.SideviewBridge?.snapshot().ready||!canAct();
   $('importSaveInput').disabled=!canTransfer||!window.SideviewBridge?.snapshot().saveWritable;
   $('applyUpdateBtn').hidden=!waitingBuildId;
   $('applyUpdateBtn').disabled=!waitingBuildId||!canTransfer||updateState==='applying';
   $('checkUpdateBtn').disabled=!workerAPI||updateState==='checking'||updateState==='applying';
   const state=window.SideviewBridge?.snapshot().state;
   const compact=matchMedia('(pointer:coarse) and (max-width:1000px), (max-width:650px), (pointer:coarse) and (max-height:500px)').matches;
   $('pwaTools').hidden=compact&&['running','advancing'].includes(state);
 }
 const status=text=>{$('pwaStatus').textContent=text};
 const transfer=text=>{$('transferStatus').textContent=text};
 function message(worker,data,timeout=5000){return new Promise((resolve,reject)=>{
   if(!worker)return reject(new Error('ไม่มี worker'));
   const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(new Error('รอการตอบกลับเกินเวลา'))},timeout);
   channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();resolve(event.data)};
   worker.postMessage(data,[channel.port2]);
 })}
 async function waiting(){
   if(!registration?.waiting)return;
   const data=await message(registration.waiting,{type:'GET_STATUS'});
   waitingBuildId=data.buildId;updateState='available';
   status('มีรุ่นใหม่พร้อมแล้ว จบรอบและรับรางวัลก่อนกด “เปิดรุ่นใหม่” หากเปิดหลายหน้าต่างต้องจบทุกหน้าต่าง');sync();
 }
 function watch(worker){if(!worker)return;worker.addEventListener('statechange',()=>{
   if(worker.state==='installed'){
     if(navigator.serviceWorker.controller)waiting().catch(()=>{});
     else{offlineReady=true;status('เก็บไฟล์ออฟไลน์ครบแล้ว เปิดจาก URL นี้ได้หลังตัดอินเทอร์เน็ต');sync()}
   }
   if(worker.state==='redundant'&&!registration?.waiting){updateState='error';status('เตรียมอัปเดตไม่สำเร็จ ยังเล่นรุ่นเดิมได้ ลองตรวจอีกครั้งเมื่อออนไลน์');sync()}
 })}
 async function thaw(nonce){
   if(frozen!==nonce)return;
   await acquire();if(frozen===nonce)frozen=null;sync();window.SideviewBridge?.refresh();
 }
 if(workerAPI){
   navigator.serviceWorker.addEventListener('message',event=>{
     if(event.source?.scriptURL!==new URL('sw.js',scope).href)return;
     const data=event.data||{};
     if(data.type==='PREPARE_UPDATE'){
       const port=event.ports[0];
       if(typeof data.nonce!=='string'||data.nonce.length===0||data.nonce.length>100||frozen!==null||!safe()||!held){port?.postMessage({nonce:data.nonce,safe:false});return}
       frozen=data.nonce;sync();window.SideviewBridge?.refresh();releaseLease?.();
       Promise.resolve(leaseDone).then(()=>port?.postMessage({nonce:data.nonce,safe:true}));
     }
     if(data.type==='ABORT_UPDATE')thaw(data.nonce).catch(()=>{status('โปรดปิดหน้าต่างเกมแล้วเปิดใหม่ก่อนเล่นต่อ')});
     if(data.type==='ACTIVATION_DONE'){
       buildId=data.buildId;offlineReady=true;
       if(frozen!==null&&frozen===data.nonce&&safe()&&!refreshing){refreshing=true;location.reload()}
       else if(data.error)status('เปิดแคชรุ่นใหม่ไม่ครบ โปรดเชื่อมต่ออินเทอร์เน็ตแล้วเปิดเกมใหม่');
       sync();
     }
   });
   navigator.serviceWorker.addEventListener('controllerchange',()=>{
     // No reload here: activation acknowledgement must finish first.
     message(navigator.serviceWorker.controller,{type:'GET_STATUS'}).then(data=>{buildId=data.buildId;offlineReady=true;sync()}).catch(()=>{});
   });
   window.addEventListener('load',async()=>{
     try{
       registration=await navigator.serviceWorker.register('sw.js',{scope:'./',updateViaCache:'none'});
       registration.addEventListener('updatefound',()=>watch(registration.installing));watch(registration.installing);
       if(registration.active){offlineReady=true;const data=await message(registration.active,{type:'GET_STATUS'});buildId=data.buildId;status('พร้อมเล่นออฟไลน์จาก URL นี้ ตรวจอัปเดตได้เมื่อออนไลน์')}
       if(registration.waiting)await waiting();
       setTimeout(autoCheck,60*1000);setInterval(autoCheck,30*60*1000);
       document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoCheck()});
     }catch{updateState='error';status('เตรียมออฟไลน์ไม่สำเร็จ ยังเล่นหน้าเดิมได้ ลองเปิดผ่าน HTTPS หรือ localhost อีกครั้ง')}
     sync();
   });
 }else status('โหมดไฟล์/เบราว์เซอร์นี้ยังติดตั้ง PWA ไม่ได้ ใช้ HTTPS หรือ localhost; เกมยังเล่นได้ตามปกติ');
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installPrompt=event;$('installBtn').hidden=false});
 window.addEventListener('appinstalled',()=>{$('installBtn').hidden=true;status('เพิ่มไอคอนแล้ว เปิดเกมจากไอคอนได้เมื่อไฟล์ออฟไลน์พร้อม')});
 $('installBtn').addEventListener('click',async()=>{if(!installPrompt)return;const prompt=installPrompt;installPrompt=null;await prompt.prompt();await prompt.userChoice;$('installBtn').hidden=true});
 // Quiet background check, so nobody has to find the "ตรวจอัปเดต" button; it only downloads, never reloads.
 async function autoCheck(){
   // never while a first install or another update is still running: a second update job queues behind it
   if(!registration?.active||registration.installing||!navigator.onLine||['checking','applying','available'].includes(updateState))return;
   if(inBattle())return;
   try{await registration.update();if(registration.waiting)await waiting()}catch{}
 }
 $('checkUpdateBtn').addEventListener('click',async()=>{
   if(!registration||updateState==='checking'||updateState==='applying')return;
   updateState='checking';status('กำลังตรวจรุ่นใหม่…');sync();
   try{await registration.update();if(registration.waiting)await waiting();else{updateState='idle';status('ตรวจแล้ว หากมีรุ่นใหม่จะเตรียมไว้ก่อนเปิดใช้ โดยไม่โหลดเกมใหม่ระหว่างเล่น')}}
   catch{updateState='error';status('ตรวจอัปเดตไม่ได้ขณะนี้ เล่นออฟไลน์รุ่นเดิมต่อได้')}
   sync();
 });
 $('applyUpdateBtn').addEventListener('click',async()=>{
   if(!registration?.waiting||!safe()||!canAct()||updateState==='applying')return;
   if(!navigator.locks){status('เบราว์เซอร์นี้เปิดรุ่นใหม่ร่วมหลายหน้าต่างไม่ได้ โปรดจบรอบ ปิดเกมทุกหน้าต่าง แล้วเปิดใหม่');return}
   updateState='applying';blockedClients=[];status('กำลังตรวจว่าทุกหน้าต่างจบรอบแล้ว…');sync();
   try{
     const answer=await message(registration.waiting,{type:'APPLY_UPDATE',nonce:crypto.randomUUID()},12000);
     if(!answer.ok){updateState='blocked';blockedClients=answer.blockedClients||[];status('ยังเปิดรุ่นใหม่ไม่ได้ มีหน้าต่างกำลังเล่น/ไม่ตอบกลับ หรือหน้าต่างเปลี่ยน จบและรับรางวัลทุกหน้าต่างแล้วลองอีกครั้ง')}
   }catch{updateState='error';status('ยังยืนยันการเปิดรุ่นใหม่ไม่ได้ โปรดจบรอบและปิดเกมทุกหน้าต่างก่อนเปิดใหม่')}
   sync();
 });
 function download(text,name){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 $('exportSaveBtn').addEventListener('click',async()=>{
   if(!canAct())return;
   try{const snapshot=await window.SideviewBridge.exportSave();download(window.SideviewTransfer.create(snapshot),'Little-Rescue-Save-'+Date.now()+'.json');transfer('ส่งออกไฟล์เซฟแล้ว เก็บไว้ในที่ส่วนตัว ไฟล์นี้ไม่มีรอบต่อสู้ที่ยังไม่จบ')}
   catch{transfer('ส่งออกไม่สำเร็จ โปรดรอให้เกมและเซฟพร้อมก่อน')}
 });
 $('importSaveInput').addEventListener('change',async event=>{
   preview=null;const file=event.target.files?.[0];event.target.value='';if(!file)return;
   try{
     if(!safe()||!canAct())throw new Error('โปรดจบรอบและรับรางวัลก่อนนำเข้า');
     if(file.size>window.SideviewTransfer.MAX_BYTES)throw new Error('ไฟล์เซฟใหญ่เกิน 64 KiB');
     const parsed=window.SideviewTransfer.parse(await file.text()),snapshot=await window.SideviewBridge.exportSave();
     preview={save:parsed.save,revision:snapshot.revision};
     $('importPreview').textContent=`เซฟปัจจุบัน: คุกกี้ดาว ${snapshot.energy.value} · เหรียญ ${snapshot.progress.coins}\nเซฟนำเข้า: คุกกี้ดาว ${parsed.save.energy.value} · เหรียญ ${parsed.save.progress.coins}\nช่วยเพื่อนแล้ว: ${parsed.save.progress.rescued?'ใช่':'ยัง'} · ทีม ${parsed.save.roster.map(i=>i+1).join(', ')}\nไม่นำเข้ารอบต่อสู้หรือ revision ของไฟล์`;
     $('importDialog').showModal();
   }catch(error){transfer(error.message||'ไฟล์เซฟไม่ถูกต้อง')}
 });
 $('cancelImportBtn').addEventListener('click',()=>{preview=null;$('importDialog').close();transfer('ยกเลิก ไม่มีการแก้เซฟ')});
 $('importDialog').addEventListener('cancel',()=>{preview=null});
 $('confirmImportBtn').addEventListener('click',async()=>{
   const pending=preview;if(!pending)return;preview=null;$('importDialog').close();
   try{
     if(!safe()||!canAct())throw new Error('โปรดจบรอบและรับรางวัลก่อนนำเข้า');
     const ok=await window.SideviewBridge.importSave(pending.save,pending.revision);
     transfer(ok?'นำเข้าและบันทึกเซฟแล้ว':'นำเข้าไม่สำเร็จ ข้อมูลจากไฟล์นี้ไม่ได้แทนที่เซฟปัจจุบัน โปรดเลือกไฟล์และตรวจใหม่');
   }catch{transfer('นำเข้าไม่สำเร็จ ข้อมูลจากไฟล์นี้ไม่ได้แทนที่เซฟปัจจุบัน โปรดตรวจสถานะเซฟและลองใหม่')}
   sync();
 });
 window.SideviewPWA={gateReady,canAct,refresh:sync,snapshot:()=>({buildId,waitingBuildId,updateState,blockedClients:[...blockedClients],offlineReady,frozen:frozen!==null})};
 setInterval(sync,250);sync();
})();
