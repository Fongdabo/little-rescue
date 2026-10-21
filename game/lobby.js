/* 1.9: the start screen becomes a lobby with a bottom tab bar, laid out like LINE Rangers' home menu.
   ผจญภัย (stage, mode, items) · ทีม (roster) · อัปเกรด (levels) · สะสม (hero book) · ภารกิจ (daily dialog);
   ร้านค้า / เพื่อน / กล่องของขวัญ are placeholders until there is a server. The tabs only show and hide the
   existing start-screen controls, so every save path stays the one app.js already uses. */
(()=>{
 'use strict';
 const TABS=[
  {id:'adventure',icon:'🗺️',label:'ผจญภัย'},{id:'team',icon:'🐾',label:'ทีม'},{id:'upgrade',icon:'⬆️',label:'อัปเกรด'},
  {id:'book',icon:'📖',label:'สะสม'},{id:'summon',icon:'✨',label:'สุ่ม'},{id:'missions',icon:'📋',label:'ภารกิจ'},
  {id:'shop',icon:'🏪',label:'ร้านค้า',soon:true},{id:'friends',icon:'🤝',label:'เพื่อน',soon:true},{id:'gifts',icon:'🎁',label:'ของขวัญ',soon:true}];
 const typeName={stone:'หินอุ่น',star:'แสงดาว',wind:'สายลม'};
 let app=null,tab='adventure',bar=null,items=null,book=null;

 function setTab(id){
  const def=TABS.find(t=>t.id===id);if(!def)return;
  if(def.soon){app.toast(`${def.icon} ${def.label} · เร็วๆ นี้`);return}
  if(id==='missions'){window.SideviewDaily.open();return}
  tab=id;document.getElementById('preflightControls').dataset.tab=id;
  bar.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===id)));
  if(id==='book')renderBook();
  if(id==='summon')window.SideviewSummon?.render();
  refresh();
 }
 function renderItems(){
  const {battle,ITEMS}=app,locked=battle.state!=='ready'||!app.canEdit();
  items.querySelector('.item-cards').innerHTML=ITEMS.map(item=>{const on=battle.equippedItems.includes(item.id);
   return `<button type="button" class="item-card" data-pick="${item.id}" aria-pressed="${on}" ${locked?'disabled':''}>
    <span class="item-icon" aria-hidden="true">${item.icon}</span><b>${item.name}</b><small>${item.text}</small><i>${on?'ฟรี ✓':'ไม่เอา'}</i></button>`}).join('');
 }
 function renderBook(){
  if(!book||tab!=='book')return;
  const {battle,UNITS,levelMultiplier,starMultiplier,assetURL}=app;
  book.innerHTML=UNITS.map((u,i)=>{const lv=battle.levels[i],star=battle.stars[i],p=levelMultiplier(lv)*starMultiplier(star);
   return `<div class="book-card type-${u.type}"><img src="${assetURL(u.asset)}" alt=""><b>${u.name}</b>
    <small>${u.role} · ${typeName[u.type]||''}</small><span class="book-lv">Lv ${lv}</span><span class="book-stars" aria-label="${star} ดาว">${'★'.repeat(star)}</span>
    <dl><dt>HP</dt><dd>${Math.round(u.hp*p)}</dd><dt>พลัง</dt><dd>${Math.round(u.damage*p)}</dd><dt>ค่าเรียก</dt><dd>❧ ${u.cost}</dd></dl></div>`}).join('')+
   `<div class="book-card boss"><span class="book-boss" aria-hidden="true">👑</span><b>ราชาเห็ดยักษ์</b><small>บอสด่าน 05</small><span class="book-lv">บอส</span>
    <dl><dt>ออกมา</dt><dd>ฐานเหลือ 60%</dd><dt>แพ้ทาง</dt><dd>ปืนใหญ่ + ฝนลูกสน</dd></dl></div>`;
 }
 function refresh(){
  if(!bar)return;
  const ready=app.battle.state==='ready';bar.hidden=!ready;items.hidden=!ready||tab!=='adventure';
  if(ready)renderItems();
 }
 function mount(bridge){
  app=bridge;
  const controls=document.getElementById('preflightControls'),modal=document.getElementById('modal');
  controls.dataset.tab=tab;
  items=document.createElement('div');items.className='item-panel';
  items.innerHTML='<p class="roster-label">ไอเทมติดตัว · ฟรี ใช้ได้อย่างละครั้งต่อด่าน</p><div class="item-cards" role="group" aria-label="เลือกไอเทม"></div>';
  items.addEventListener('click',event=>{const id=event.target.closest('[data-pick]')?.dataset.pick;if(!id)return;
   const on=app.battle.equippedItems;app.saveItems(on.includes(id)?on.filter(x=>x!==id):[...on,id]);renderItems()});
  // after the start controls and before the start button, so the desktop two-column grid keeps its children
  controls.after(items);
  book=document.createElement('div');book.className='hero-book';controls.append(book);
  bar=document.createElement('nav');bar.className='lobby-tabs';bar.setAttribute('aria-label','เมนูหลัก');
  bar.innerHTML=TABS.map(t=>`<button type="button" data-tab="${t.id}" aria-pressed="${t.id===tab}" class="${t.soon?'soon':''}">
   <span aria-hidden="true">${t.icon}</span><small>${t.label}</small>${t.id==='missions'?'<i class="daily-badge" aria-hidden="true"></i>':''}${t.soon?'<em>เร็วๆ นี้</em>':''}</button>`).join('');
  bar.addEventListener('click',event=>{const id=event.target.closest('[data-tab]')?.dataset.tab;if(id)setTab(id)});
  modal.append(bar);
  refresh();
 }
 window.SideviewLobby={TABS,mount,refresh,setTab,renderBook,get tab(){return tab}};
})();
