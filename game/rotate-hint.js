/* 1.7.2: phones play landscape, like LINE Rangers. 1.12.5: landscape only. A phone held upright always sees
   "หมุนมือถือ" (the 1.7.2 "เล่นแนวตั้งต่อ" choice is gone). If that happens mid-battle the battle pauses first, so
   nothing is lost. The installed app locks itself (manifest orientation + screen.orientation.lock); in a browser tab
   Android can rotate for the player (fullscreen + lock); iOS cannot lock, so the hint stays until the phone turns.
   Never reloads, never touches save data. */
(()=>{
 'use strict';
 const phonePortrait=matchMedia('(max-width: 650px) and (orientation: portrait) and (pointer: coarse)');
 const isIOS=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const standalone=matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches||navigator.standalone===true;
 const canLock=!isIOS&&Boolean(screen.orientation&&screen.orientation.lock);
 const canFullscreen=canLock&&Boolean(document.documentElement.requestFullscreen);

 const box=document.createElement('div');
 box.className='rotate-hint';box.hidden=true;box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-labelledby','rotateTitle');
 box.innerHTML=`<div class="rotate-card"><div class="rotate-phone" aria-hidden="true"><span>📱</span></div>
  <h2 id="rotateTitle">หมุนมือถือเป็นแนวนอน</h2>
  <p>เกมนี้เล่นแนวนอนเท่านั้น สนามอยู่ซ้าย การ์ดเรียกเพื่อนอยู่ขวา<br>ถ้ากำลังสู้อยู่ เกมหยุดพักให้แล้ว หมุนกลับมาเล่นต่อได้เลย</p>
  ${canFullscreen&&!standalone?'<button class="primary" type="button" data-rotate="lock">หมุนให้เลย</button>':''}
  ${isIOS?'<small>ถ้าหมุนแล้วจอไม่หมุนตาม: ปัดเปิดศูนย์ควบคุม แล้วปิดล็อกการหมุนจอ</small>':''}</div>`;

 const state=()=>{try{return window.SideviewApp?.snapshot().state}catch(error){return ''}};
 const pauseIfFighting=()=>{if(['running','advancing'].includes(state()))document.getElementById('pauseBtn')?.click()};
 const refresh=()=>{const show=phonePortrait.matches;if(show)pauseIfFighting();box.hidden=!show};
 const lock=async()=>{try{await screen.orientation.lock('landscape')}catch(error){}};
 box.addEventListener('click',async event=>{
  if(event.target.closest('[data-rotate]')?.dataset.rotate!=='lock')return;
  try{await document.documentElement.requestFullscreen({navigationUI:'hide'})}catch(error){}
  await lock();refresh();
 });
 phonePortrait.addEventListener?.('change',refresh);
 // a rotation can be missed while the page is hidden
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});
 // The installed app may lock without fullscreen; a browser tab rejects this quietly.
 if(canLock&&standalone)lock();

 const mount=()=>{document.body.append(box);refresh()};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
