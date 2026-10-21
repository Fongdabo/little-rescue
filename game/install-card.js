/* 1.7.1: "ติดตั้งเกม" button in the header, the same way PENUM PM offers its app on phones and computers.
   Chrome/Edge (Android and computer) get the browser's own install prompt; iPhone/iPad and other browsers get
   step-by-step instructions. Hidden when the game already runs as an installed app. Touches no save data. */
(()=>{
 'use strict';
 const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const isIOS=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const isAndroid=/Android/i.test(navigator.userAgent);
 let deferred=null;

 const button=document.createElement('button');
 button.type='button';button.className='install-chip';button.hidden=true;
 button.innerHTML='<span aria-hidden="true">📲</span><span class="install-text">ติดตั้งเกม</span>';button.setAttribute('aria-label','ติดตั้งเกม');
 button.title='ติดตั้งเป็นแอป เปิดเต็มจอ เล่นได้แม้ไม่มีเน็ต';

 const dialog=document.createElement('dialog');
 dialog.className='install-dialog';dialog.setAttribute('aria-labelledby','installTitle');
 const steps=isIOS
  ?['เปิดเกมนี้ด้วย <b>Safari</b>','กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น) ด้านล่างจอ','เลื่อนลงแล้วกด <b>เพิ่มไปยังหน้าจอโฮม</b>','กด <b>เพิ่ม</b> มุมขวาบน']
  :isAndroid
  ?['เปิดเกมนี้ด้วย <b>Chrome</b>','กดปุ่ม <b>⋮</b> มุมขวาบน','กด <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก</b>','กด <b>ติดตั้ง</b>']
  :['เปิดเกมนี้ด้วย <b>Chrome</b> หรือ <b>Edge</b>','กดไอคอน <b>ติดตั้ง</b> (จอมีลูกศร) ท้ายช่องที่อยู่เว็บ หรือเมนู <b>⋮</b> › <b>ติดตั้ง Little Rescue</b>','กด <b>ติดตั้ง</b> เกมจะเปิดเป็นหน้าต่างของตัวเอง และมีไอคอนบนเดสก์ท็อป'];
 dialog.innerHTML=`<h2 id="installTitle">ติดตั้ง Little Rescue</h2>
  <p>ติดตั้งแล้วจะมีไอคอนเกม เปิดเต็มจอเหมือนแอป เล่นได้แม้ไม่มีเน็ต และเซฟเดิมยังอยู่ครบ</p>
  <ol>${steps.map(s=>`<li>${s}</li>`).join('')}</ol>
  <p class="install-note">เล่นบนคอม: กด 1–5 เรียกเพื่อน · P หรือ Esc หยุดพัก</p>
  <form method="dialog"><button class="primary" value="close">เข้าใจแล้ว</button></form>`;

 const refresh=()=>{button.hidden=standalone()};
 button.addEventListener('click',async()=>{
  if(deferred){const prompt=deferred;deferred=null;
   try{await prompt.prompt();await prompt.userChoice}catch(error){if(dialog.showModal)dialog.showModal()}
   refresh();return}
  if(dialog.showModal)dialog.showModal();
 });
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event;refresh()});
 window.addEventListener('appinstalled',()=>{deferred=null;button.hidden=true;if(dialog.open)dialog.close()});
 matchMedia('(display-mode: standalone)').addEventListener?.('change',refresh);

 const mount=()=>{const head=document.querySelector('.masthead');if(!head)return;head.append(button);document.body.append(dialog);refresh()};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
