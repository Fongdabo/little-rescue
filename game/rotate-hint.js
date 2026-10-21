/* 1.7.2: phones play landscape first, like LINE Rangers. A phone held upright sees "หมุนมือถือ" before a battle;
   Android can rotate for the player (fullscreen + orientation lock). "เล่นแนวตั้งต่อ" keeps the 1.6.6 portrait layout and
   is remembered per device. Never shown mid-battle, never touches save data. */
(()=>{
 'use strict';
 const KEY='little-rescue-ui-portrait-ok';
 const phonePortrait=matchMedia('(max-width: 650px) and (orientation: portrait) and (pointer: coarse)');
 const isIOS=/iPhone|iPad|iPod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
 const canLock=!isIOS&&Boolean(screen.orientation&&screen.orientation.lock)&&Boolean(document.documentElement.requestFullscreen);
 let portraitOK=false;
 try{portraitOK=localStorage.getItem(KEY)==='1'}catch(error){}

 const box=document.createElement('div');
 box.className='rotate-hint';box.hidden=true;box.setAttribute('role','dialog');box.setAttribute('aria-labelledby','rotateTitle');
 box.innerHTML=`<div class="rotate-card"><div class="rotate-phone" aria-hidden="true"><span>📱</span></div>
  <h2 id="rotateTitle">หมุนมือถือเป็นแนวนอน</h2>
  <p>เล่นเต็มจอแบบ LINE Rangers สนามอยู่ซ้าย การ์ดเรียกเพื่อนอยู่ขวา</p>
  ${canLock?'<button class="primary" type="button" data-rotate="lock">หมุนให้เลย</button>':''}
  <button class="secondary" type="button" data-rotate="stay">เล่นแนวตั้งต่อ</button>
  ${isIOS?'<small>ถ้าหมุนแล้วจอไม่หมุนตาม: ปัดเปิดศูนย์ควบคุม แล้วปิดล็อกการหมุนจอ</small>':''}</div>`;

 const busy=()=>{try{return ['running','advancing'].includes(window.SideviewApp?.snapshot().state)}catch(error){return false}};
 const refresh=()=>{box.hidden=portraitOK||!phonePortrait.matches||busy()};
 box.addEventListener('click',async event=>{
  const action=event.target.closest('[data-rotate]')?.dataset.rotate;
  if(action==='stay'){portraitOK=true;try{localStorage.setItem(KEY,'1')}catch(error){}refresh()}
  if(action==='lock'){try{await document.documentElement.requestFullscreen({navigationUI:'hide'});await screen.orientation.lock('landscape')}catch(error){}refresh()}
 });
 phonePortrait.addEventListener?.('change',refresh);
 // the battle state changes without an event this script can hear; a cheap check keeps the hint off mid-battle
 setInterval(()=>{if(phonePortrait.matches&&!portraitOK)refresh()},1000);

 const mount=()=>{document.body.append(box);refresh()};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
