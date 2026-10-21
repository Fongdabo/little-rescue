/* 1.13: friends and guilds, laid out like LINE Rangers' friend screen, backed by /api/friends and /api/guilds
   (functions/) with the cloud account from cloud-save.js. Nothing here is part of the save:
   - the server keeps friends, guilds and friendship points (F, in the server wallet);
   - which hero this player lends to friends is a per-device choice in little-rescue-social-v1;
   - a borrowed helper is chosen before a battle (adventure tab), joins that one battle as a round button
     (key 6, once per battle at its normal cost), and is dropped when the battle ends.
   Guests without an account see a prompt to create one; without the server the tab says it needs a connection. */
(()=>{
 'use strict';
 const KEY='little-rescue-social-v1',CLOUD='little-rescue-cloud-v1';
 let storage=null;try{storage=window.localStorage}catch{}
 const esc=t=>String(t??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
 const token=()=>{try{const s=JSON.parse(storage?.getItem(CLOUD)||'null');return s&&s.v===1&&typeof s.token==='string'?s.token:''}catch{return ''}};
 const readLocal=()=>{try{const s=JSON.parse(storage?.getItem(KEY)||'null');if(s&&s.v===1)return {v:1,helper:Number.isInteger(s.helper)?s.helper:null}}catch{}return {v:1,helper:null}};
 const writeLocal=s=>{try{storage?.setItem(KEY,JSON.stringify(s))}catch{}};
 const ERRORS={'bad-code':'รหัสไม่ถูกต้อง (เช่น LR-ABCD-EFGH)','self':'นี่คือรหัสของคุณเอง','unknown-player':'ไม่พบผู้เล่นรหัสนี้',
  'already-friends':'เป็นเพื่อนกันอยู่แล้ว','already-asked':'ส่งคำขอไปแล้ว รอเพื่อนตอบรับ','friends-full':'รายชื่อเพื่อนเต็มแล้ว',
  'their-friends-full':'รายชื่อเพื่อนของอีกฝ่ายเต็มแล้ว','too-many-requests':'คำขอที่รอตอบมากเกินไป','their-inbox-full':'อีกฝ่ายมีคำขอรออยู่มากเกินไป',
  'no-request':'ไม่พบคำขอนี้แล้ว','already-sent':'ส่งให้เพื่อนคนนี้แล้ววันนี้','nothing-to-send':'ส่งให้ทุกคนครบแล้ววันนี้','no-gifts':'ยังไม่มีของขวัญ',
  'not-friends':'ยังไม่ได้เป็นเพื่อนกัน','no-helper':'เพื่อนยังไม่ได้ตั้งตัวช่วย','already-borrowed':'ยืมตัวช่วยของเพื่อนคนนี้แล้ววันนี้',
  'bad-name':'ชื่อใช้ไม่ได้','in-guild':'อยู่ในกิลด์แล้ว ออกก่อนจึงสร้างหรือเข้ากิลด์ใหม่ได้','unknown-guild':'ไม่พบกิลด์รหัสนี้','guild-full':'กิลด์เต็มแล้ว',
  'no-guild':'ยังไม่ได้อยู่ในกิลด์','not-leader':'เฉพาะหัวหน้ากิลด์','already-checked-in':'เช็กชื่อแล้ววันนี้','signed-out':'เครื่องนี้ออกจากบัญชีแล้ว'};
 const errorText=e=>ERRORS[e]||'เชื่อมต่อไม่ได้ตอนนี้ ลองใหม่อีกครั้ง';

 let app=null,panel=null,picker=null,orb=null,view='friends',friends=null,guild=null,guildList=null,busy=false,loadedAt=0,message='';
 let chosen=null,reportedRun=0,pushed='',endedRun=0;

 async function api(path,{method='GET',body}={}){
  const t=token();if(!t)return {status:401,data:{error:'signed-out'}};
  try{const r=await fetch('api/'+path,{method,cache:'no-store',headers:{Authorization:'Bearer '+t,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
   let data={};try{data=await r.json()}catch{}return {status:r.status,data}}
  catch{return {status:0,data:{error:'offline'}}}
 }
 const signedIn=()=>Boolean(token())&&window.SideviewCloud?.enabled;

 // ---- profile: the hero lent to friends, and progress shown to them ----
 function lentHero(){
  const {battle,UNITS}=app,pick=readLocal().helper,owned=i=>!app.owned||app.owned(i);
  if(Number.isInteger(pick)&&UNITS[pick]&&owned(pick))return pick;
  // default: the strongest owned hero by level and stars
  return UNITS.map((u,i)=>i).filter(owned).sort((a,b)=>battle.levels[b]*battle.stars[b]-battle.levels[a]*battle.stars[a])[0]||0;
 }
 function profile(){const i=lentHero();return {helper:{unit:i,level:app.battle.levels[i],star:app.battle.stars[i]},cleared:app.cleared()}}
 async function pushProfile(force){
  const p=profile(),print=JSON.stringify(p);
  if(!force&&print===pushed)return;
  const me=friends?.me;
  if(!force&&me&&JSON.stringify({helper:me.helper,cleared:me.cleared})===print){pushed=print;return}
  const r=await api('friends/profile',{method:'PUT',body:p});
  if(r.status===200){pushed=print;friends=r.data.state}
 }

 // ---- loading ----
 async function load(){
  if(!signedIn()||busy)return;busy=true;
  try{
   const [f,g]=await Promise.all([api('friends'),api('guilds')]);
   if(f.status===200)friends=f.data.state;if(g.status===200)guild=g.data.state.guild;
   if(f.status===401||g.status===401){friends=null;guild=null}
   else if(f.status!==200)message=errorText(f.data.error);
   loadedAt=Date.now();
   await pushProfile(false);
   if(view==='guild'&&!guild)await loadGuildList();
  }finally{busy=false;render();renderPicker()}
 }
 async function loadGuildList(){const r=await api('guilds/list');guildList=r.status===200?r.data.guilds:[]}
 // Every action answers with fresh state; show its result and redraw.
 async function act(path,body,done){
  if(busy)return;busy=true;message='';render();
  const r=await api(path,{method:'POST',body:body||{}});busy=false;
  if(r.status===200){
   if(path.startsWith('guilds/')){guild=r.data.state.guild;if(!guild)await loadGuildList()}else friends=r.data.state;
   if(friends&&r.data.state?.me)friends.me=r.data.state.me;
   message=done?done(r.data):'';
  }else message=errorText(r.data.error);
  render();renderPicker();return r;
 }
 const gainedText=n=>n>0?` ได้ 💗 ${n} F`:' (แต้มมิตรภาพวันนี้ครบแล้ว)';

 // ---- friends tab ----
 const ago=t=>{if(!t)return '';const m=Math.floor((Date.now()-t)/60000);return m<5?'ออนไลน์อยู่':m<60?`${m} นาทีที่แล้ว`:m<1440?`${Math.floor(m/60)} ชม.ที่แล้ว`:`${Math.floor(m/1440)} วันที่แล้ว`};
 function heroBadge(h){
  const u=h&&app.UNITS[h.unit];if(!u)return '<span class="fr-avatar empty" aria-hidden="true">?</span>';
  return `<img class="fr-avatar" src="${app.assetURL(u.asset)}" alt="">`;
 }
 const heroLine=h=>{const u=h&&app.UNITS[h.unit];return u?`${esc(u.name)} Lv ${h.level} ${'★'.repeat(h.star)}`:'ยังไม่ตั้งตัวช่วย'};
 function guestHTML(){
  if(!window.SideviewCloud?.enabled)return `<div class="fr-guest"><b>🤝 เพื่อนและกิลด์</b><p>ต้องเชื่อมต่ออินเทอร์เน็ตและเซิร์ฟเวอร์ของเกม ลองใหม่เมื่อออนไลน์</p></div>`;
  return `<div class="fr-guest"><b>🤝 เล่นกับเพื่อน</b><p>สร้างบัญชีฟรี (ไม่ต้องใช้อีเมล) เพื่อเพิ่มเพื่อน ส่งความช่วยเหลือรับแต้มมิตรภาพ ยืมตัวช่วยลงด่าน และเข้ากิลด์ เซฟของคุณจะสำรองขึ้นคลาวด์ด้วย</p>
   <button type="button" class="primary" data-fr="account">สร้างบัญชี / เข้าสู่ระบบ ☁️</button></div>`;
 }
 function friendsHTML(){
  const f=friends,me=f.me,R=f.rules;
  const gifts=f.gifts.length,canSend=f.friends.some(x=>!x.sentToday);
  const lent=lentHero();
  return `<p class="roster-label">ตัวช่วยที่ให้เพื่อนยืม (เพื่อนยืมได้วันละครั้ง คุณได้ ${R.helperOwner} F)</p>
   <div class="fr-lend" role="group" aria-label="เลือกตัวช่วยให้เพื่อนยืม">${app.UNITS.map((u,i)=>app.owned&&!app.owned(i)?'':`<button type="button" data-lend="${i}" aria-pressed="${i===lent}">
    <img src="${app.assetURL(u.asset)}" alt=""><small>${esc(u.name)}</small><i>Lv ${app.battle.levels[i]} ${'★'.repeat(app.battle.stars[i])}</i></button>`).join('')}</div>
   <div class="fr-actions"><button type="button" class="primary" data-fr="send-all" ${canSend?'':'disabled'}>💌 ส่งความช่วยเหลือให้ทุกคน</button>
    <button type="button" class="${gifts?'primary':'secondary'}" data-fr="collect" ${gifts?'':'disabled'}>🎁 รับของขวัญ${gifts?` (${gifts})`:''}</button></div>
   ${f.friends.length?`<ul class="fr-list">${f.friends.map(x=>`<li>${heroBadge(x.helper)}<div><b>${esc(x.name)}</b>
     <small>ตัวช่วย: ${heroLine(x.helper)}</small><small>ผ่าน ${x.cleared} ด่าน · ${ago(x.lastSeen)}</small></div>
     <button type="button" class="${x.sentToday?'secondary':'primary'}" data-send="${esc(x.id)}" ${x.sentToday?'disabled':''}>${x.sentToday?'ส่งแล้ว':'💌 ส่ง'}</button>
     <button type="button" class="fr-x" data-remove="${esc(x.id)}" data-name="${esc(x.name)}" aria-label="ลบ ${esc(x.name)} ออกจากเพื่อน">×</button></li>`).join('')}</ul>`
    :`<p class="fr-empty">ยังไม่มีเพื่อน ไปที่ "เพิ่มเพื่อน" แล้วแลกรหัสกัน</p>`}
   <p class="fr-note">ส่งความช่วยเหลือ: คุณได้ ${R.sendSelf} F เพื่อนได้ ${R.sendGift} F · ยืมตัวช่วย: ได้ ${R.helperBorrower} F ทั้งสองฝ่าย · รับได้สูงสุด ${R.dailyCap} F ต่อวัน (เริ่มนับใหม่เที่ยงคืน)</p>`;
 }
 function requestsHTML(){
  const f=friends;
  const row=(x,buttons)=>`<li>${heroBadge(x.helper)}<div><b>${esc(x.name)}</b><small>${esc(x.id)} · ${ago(x.lastSeen)}</small></div>${buttons}</li>`;
  return `<p class="roster-label">ขอเป็นเพื่อนกับคุณ</p>${f.incoming.length?`<ul class="fr-list">${f.incoming.map(x=>row(x,
    `<button type="button" class="primary" data-accept="${esc(x.id)}">ตอบรับ</button><button type="button" class="secondary" data-decline="${esc(x.id)}">ปฏิเสธ</button>`)).join('')}</ul>`:'<p class="fr-empty">ไม่มีคำขอใหม่</p>'}
   <p class="roster-label">คำขอที่คุณส่ง (รอตอบรับ)</p>${f.outgoing.length?`<ul class="fr-list">${f.outgoing.map(x=>row(x,
    `<button type="button" class="secondary" data-decline="${esc(x.id)}">ยกเลิก</button>`)).join('')}</ul>`:'<p class="fr-empty">ไม่มีคำขอที่รออยู่</p>'}`;
 }
 function addHTML(){
  const me=friends.me;
  return `<div class="fr-code"><span>รหัสเพื่อนของคุณ</span><code>${esc(me.id)}</code><button type="button" data-fr="copy-me">คัดลอก</button>${navigator.share?'<button type="button" data-fr="share-me">แชร์</button>':''}</div>
   <form class="fr-form" data-form="add"><label>รหัสเพื่อน<input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="LR-XXXX-XXXX" maxlength="16" required></label><button type="submit" class="primary">ส่งคำขอ</button></form>
   <p class="fr-note">ให้เพื่อนเปิดแท็บนี้ในเกมของเขา แล้วส่งรหัสให้กัน คนหนึ่งส่งคำขอ อีกคนกดตอบรับในแท็บ "คำขอ" รหัสเพื่อนไม่ใช่รหัสกู้บัญชี ให้คนอื่นดูได้ปลอดภัย</p>
   <form class="fr-form" data-form="name"><label>ชื่อที่เพื่อนเห็น<input name="name" maxlength="16" value="${esc(me.name)}" required></label><button type="submit" class="secondary">บันทึกชื่อ</button></form>`;
 }
 function guildHTML(){
  if(!guild){
   return `<p class="fr-note">กิลด์คือกลุ่มผู้เล่นสูงสุด ${friends.rules.guildMax} คน เช็กชื่อด้วยกันทุกวันรับ ${friends.rules.guildCheckin} F</p>
    <form class="fr-form" data-form="guild-join"><label>เข้ากิลด์ด้วยรหัส<input name="code" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="G-XXXX-XXXX" maxlength="16" required></label><button type="submit" class="primary">เข้าร่วม</button></form>
    <form class="fr-form" data-form="guild-create"><label>หรือสร้างกิลด์ใหม่<input name="name" maxlength="16" placeholder="ชื่อกิลด์" required></label><button type="submit" class="secondary">สร้างกิลด์</button></form>
    <p class="roster-label">กิลด์ที่ยังรับสมาชิก</p>${guildList===null?'<p class="fr-empty">กำลังโหลด…</p>':guildList.length?`<ul class="fr-list">${guildList.map(g=>`<li><span class="fr-avatar guild" aria-hidden="true">🏕️</span><div><b>${esc(g.name)}</b>
     <small>${g.members} / ${friends.rules.guildMax} คน${g.notice?` · ${esc(g.notice)}`:''}</small></div><button type="button" class="primary" data-join="${esc(g.id)}">เข้าร่วม</button></li>`).join('')}</ul>`:'<p class="fr-empty">ยังไม่มีกิลด์ สร้างกิลด์แรกได้เลย</p>'}`;
  }
  const me=friends.me.id,lead=guild.leader===me,checked=guild.members.filter(m=>m.checkedIn).length;
  return `<div class="fr-guild-head"><span class="fr-avatar guild" aria-hidden="true">🏕️</span><div><b>${esc(guild.name)}</b><small>${guild.members.length} / ${guild.max} คน · เช็กชื่อวันนี้ ${checked} คน</small></div></div>
   <div class="fr-code"><span>รหัสกิลด์</span><code>${esc(guild.id)}</code><button type="button" data-fr="copy-guild">คัดลอก</button></div>
   ${lead?`<form class="fr-form" data-form="notice"><label>ประกาศกิลด์<input name="notice" maxlength="80" value="${esc(guild.notice)}" placeholder="เช่น เช็กชื่อทุกวันนะ"></label><button type="submit" class="secondary">บันทึก</button></form>`
    :guild.notice?`<p class="fr-notice">📣 ${esc(guild.notice)}</p>`:''}
   <div class="fr-actions"><button type="button" class="primary" data-fr="checkin" ${guild.checkedIn?'disabled':''}>${guild.checkedIn?'✅ เช็กชื่อแล้ววันนี้':`✅ เช็กชื่อวันนี้ · +${friends.rules.guildCheckin} F`}</button></div>
   <ul class="fr-list">${guild.members.map(m=>`<li><span class="fr-avatar guild" aria-hidden="true">${m.id===guild.leader?'👑':m.checkedIn?'✅':'🐾'}</span><div><b>${esc(m.name)}${m.id===me?' (คุณ)':''}</b>
    <small>${m.id===guild.leader?'หัวหน้ากิลด์ · ':''}ผ่าน ${m.cleared} ด่าน · ${ago(m.lastSeen)}</small></div>
    ${lead&&m.id!==me?`<button type="button" class="fr-x" data-kick="${esc(m.id)}" data-name="${esc(m.name)}" aria-label="เชิญ ${esc(m.name)} ออกจากกิลด์">×</button>`:''}</li>`).join('')}</ul>
   <div class="fr-actions"><button type="button" class="secondary" data-fr="leave">ออกจากกิลด์</button></div>`;
 }
 function render(){
  if(!panel||window.SideviewLobby?.tab!=='friends')return;
  if(!signedIn()){panel.innerHTML=guestHTML();return}
  if(!friends){panel.innerHTML=`<p class="fr-empty">${busy?'กำลังโหลดรายชื่อเพื่อน…':esc(message||'กำลังโหลด…')}</p>`;return}
  const me=friends.me,R=friends.rules;
  const tabs=[['friends',`เพื่อน ${friends.friends.length}`],['requests',`คำขอ${friends.incoming.length?` 🔴${friends.incoming.length}`:''}`],['add','เพิ่มเพื่อน'],['guild','กิลด์']];
  const body={friends:friendsHTML,requests:requestsHTML,add:addHTML,guild:guildHTML}[view]();
  panel.innerHTML=`<div class="fr-me"><div><b>${esc(me.name)}</b><small>${esc(me.id)}</small></div>
    <span class="fr-points" title="แต้มมิตรภาพ เก็บบนเซิร์ฟเวอร์">💗 <b>${me.fp.toLocaleString('th-TH')}</b> F<small>วันนี้ ${me.fpToday} / ${R.dailyCap}</small></span></div>
   <div class="fr-tabs" role="tablist">${tabs.map(([id,label])=>`<button type="button" role="tab" data-view="${id}" aria-selected="${id===view}">${label}</button>`).join('')}</div>
   <p class="fr-message" role="status" aria-live="polite">${esc(message)}</p>${body}`;
 }

 function copy(text){navigator.clipboard?.writeText(text).then(()=>app.toast('คัดลอกแล้ว'),()=>app.toast(text))}
 function onClick(event){
  const t=event.target.closest('button');if(!t||busy)return;
  const d=t.dataset;
  if(d.view){view=d.view;message='';render();if(view==='guild'&&!guild&&guildList===null)loadGuildList().then(render);if(Date.now()-loadedAt>30000)load();return}
  if(d.lend!==undefined){writeLocal({...readLocal(),helper:Number(d.lend)});pushProfile(true).then(()=>{render();app.toast('ตั้งตัวช่วยให้เพื่อนยืมแล้ว')});render();return}
  if(d.send)return act('friends/send',{id:d.send},r=>`ส่งความช่วยเหลือแล้ว${gainedText(r.gained)}`);
  if(d.remove){if(confirm(`ลบ ${d.name} ออกจากรายชื่อเพื่อน?`))act('friends/remove',{id:d.remove});return}
  if(d.accept)return act('friends/accept',{id:d.accept},()=>'เป็นเพื่อนกันแล้ว! 🤝');
  if(d.decline)return act('friends/remove',{id:d.decline});
  if(d.join)return act('guilds/join',{code:d.join},()=>'เข้าร่วมกิลด์แล้ว');
  if(d.kick){if(confirm(`เชิญ ${d.name} ออกจากกิลด์?`))act('guilds/kick',{id:d.kick});return}
  switch(d.fr){
   case 'account':document.querySelector('.cloud-chip')?.click();break;
   case 'send-all':act('friends/send',{all:true},r=>`ส่งให้เพื่อน ${r.sent} คนแล้ว${gainedText(r.gained)}`);break;
   case 'collect':act('friends/collect',{},r=>`รับของขวัญ ${r.collected} ชิ้น${gainedText(r.gained)}`);break;
   case 'copy-me':copy(friends.me.id);break;
   case 'share-me':navigator.share({title:'Little Rescue',text:`มาเป็นเพื่อนกันใน Little Rescue! รหัสเพื่อนของฉัน: ${friends.me.id}`,url:location.origin+'/'}).catch(()=>{});break;
   case 'copy-guild':copy(guild.id);break;
   case 'checkin':act('guilds/checkin',{},r=>`เช็กชื่อแล้ว${gainedText(r.gained)}`);break;
   case 'leave':if(confirm(guild.leader===friends.me.id?'ออกจากกิลด์? หัวหน้าจะส่งต่อให้สมาชิกที่อยู่นานที่สุด':'ออกจากกิลด์?'))act('guilds/leave',{},()=>'ออกจากกิลด์แล้ว');break;
  }
 }
 function onSubmit(event){
  event.preventDefault();if(busy)return;
  const form=event.target,data=new FormData(form),kind=form.dataset.form;
  if(kind==='add')act('friends/add',{code:String(data.get('code')||'')},r=>r.result==='friends'?'เป็นเพื่อนกันแล้ว! 🤝':'ส่งคำขอแล้ว รอเพื่อนตอบรับ');
  if(kind==='name')api('friends/profile',{method:'PUT',body:{name:String(data.get('name')||'')}}).then(r=>{if(r.status===200){friends=r.data.state;message='บันทึกชื่อแล้ว'}else message=errorText(r.data.error);render()});
  if(kind==='guild-join')act('guilds/join',{code:String(data.get('code')||'')},()=>'เข้าร่วมกิลด์แล้ว');
  if(kind==='guild-create')act('guilds/create',{name:String(data.get('name')||'')},()=>'สร้างกิลด์แล้ว ส่งรหัสกิลด์ให้เพื่อนได้เลย');
  if(kind==='notice')act('guilds/notice',{notice:String(data.get('notice')||'')},()=>'บันทึกประกาศแล้ว');
 }

 // ---- helper pick before a battle (adventure tab) ----
 function choose(friendId){
  const {battle}=app;
  if(battle.state!=='ready'&&battle.state!=='won'&&battle.state!=='lost')return;
  const f=friends?.friends.find(x=>x.id===friendId);
  if(!f||!f.helper||f.borrowedToday||chosen?.friendId===friendId){chosen=null;battle.setHelper(null)}
  else if(battle.setHelper({...f.helper,name:f.name}))chosen={...f.helper,name:f.name,friendId};
  renderPicker();
 }
 function renderPicker(show){
  if(!picker)return;
  if(typeof show==='boolean')picker.hidden=!show;
  if(picker.hidden)return;
  if(!signedIn()){picker.innerHTML='';picker.hidden=true;return}
  const list=(friends?.friends||[]).filter(f=>f.helper&&app.UNITS[f.helper.unit]&&(!f.borrowedToday||chosen?.friendId===f.id));
  if(chosen&&!list.some(f=>f.id===chosen.friendId)){chosen=null;app.battle.setHelper(null)}
  picker.innerHTML=`<p class="roster-label">ตัวช่วยจากเพื่อน · ลงสนามได้ 1 ครั้งต่อด่าน (ปุ่ม 🤝 หรือกด 6)</p>`+(list.length
   ?`<div class="helper-cards" role="group" aria-label="เลือกตัวช่วยจากเพื่อน">${list.map(f=>{const u=app.UNITS[f.helper.unit],on=chosen?.friendId===f.id;
     return `<button type="button" class="helper-card" data-helper="${esc(f.id)}" aria-pressed="${on}"><img src="${app.assetURL(u.asset)}" alt="">
      <b>${esc(u.name)}</b><small>${'★'.repeat(f.helper.star)} Lv ${f.helper.level}</small><i>${esc(f.name)}</i></button>`}).join('')}</div>`
   :`<p class="fr-empty">${friends?.friends.length?'ตัวช่วยของเพื่อนถูกยืมครบแล้ววันนี้':'เพิ่มเพื่อนในแท็บ 🤝 เพื่อน แล้วยืมตัวช่วยของเพื่อนลงด่านได้วันละครั้งต่อคน'}</p>`);
 }

 // ---- in battle: the helper's round button, and borrowing on the server when the battle starts ----
 function summonHelper(){
  const {battle,UNITS}=app;if(battle.state!=='running'||!battle.helper)return;
  if(battle.summonHelper())app.toast(`🤝 ${battle.helper.name} ส่ง ${UNITS[battle.helper.unit].name} มาช่วย!`);
  else app.toast(battle.helperUsed?'ตัวช่วยลงสนามไปแล้วในด่านนี้':battle.allies.length>=app.CONFIG.maxAllies?'ทีมในสนามเต็มแล้ว':'ละอองใบไม้ยังไม่พอ');
 }
 let orbKey='';
 function tick(){
  if(!app)return;
  const {battle}=app,inBattle=battle.state==='running'||battle.state==='paused';
  // Borrow on the server once per run that actually started with a helper.
  if(battle.state==='running'&&battle.helper&&chosen&&reportedRun!==battle.runId){
   reportedRun=battle.runId;const name=chosen.name,id=chosen.friendId;
   api('friends/helper',{method:'POST',body:{id}}).then(r=>{
    if(r.status===200){friends=r.data.state;if(r.data.gained>0)setTimeout(()=>app.toast(`ยืมตัวช่วยจาก ${name} · ได้ 💗 ${r.data.gained} F`),2500)}
   });
  }
  // The helper stays for one battle only.
  if((battle.state==='won'||battle.state==='lost')&&battle.helper&&endedRun!==battle.runId){endedRun=battle.runId;battle.setHelper(null);chosen=null;renderPicker()}
  if(!orb)return;
  const key=[inBattle,battle.helper?.unit,battle.helperUsed,battle.helperReady].join();
  if(key===orbKey)return;orbKey=key;
  orb.hidden=!inBattle||!battle.helper;
  if(orb.hidden)return;
  const u=app.UNITS[battle.helper.unit];
  orb.querySelector('img').src=app.assetURL(u.asset);
  orb.querySelector('small').textContent=battle.helperUsed?'ลงแล้ว':`❧ ${u.cost}`;
  orb.disabled=!battle.helperReady;orb.classList.toggle('used',battle.helperUsed);
  orb.title=`ตัวช่วยจาก ${battle.helper.name}: ${u.name} Lv ${battle.helper.level} ${'★'.repeat(battle.helper.star)} · ใช้ละอองใบไม้ ${u.cost} (6)`;
 }

 function mount(bridge){
  app=bridge;
  panel=document.createElement('div');panel.className='friends-panel';
  panel.addEventListener('click',onClick);panel.addEventListener('submit',onSubmit);
  document.getElementById('preflightControls').append(panel);
  picker=document.createElement('div');picker.className='helper-panel';picker.hidden=true;
  picker.addEventListener('click',event=>{const id=event.target.closest('[data-helper]')?.dataset.helper;if(id)choose(id)});
  document.querySelector('.item-panel')?.after(picker);
  orb=document.createElement('button');orb.type='button';orb.className='skill-orb helper-orb';orb.hidden=true;orb.setAttribute('aria-label','เรียกตัวช่วยจากเพื่อน');
  orb.innerHTML='<img src="" alt=""><small></small>';orb.addEventListener('click',summonHelper);
  document.getElementById('skillRow').append(orb);
  document.addEventListener('keydown',event=>{if(event.key==='6'&&!event.repeat&&!event.ctrlKey&&!event.altKey&&!event.metaKey&&!/INPUT|TEXTAREA|SELECT/.test(event.target.tagName)){event.preventDefault();summonHelper()}});
  window.addEventListener('storage',event=>{if(event.key===CLOUD){friends=null;guild=null;chosen=null;app.battle.setHelper(null);load()}});
  // Sign-in happens in the cloud dialog; pick it up when that closes.
  document.addEventListener('close',event=>{if(event.target.classList?.contains('cloud-dialog')){if(signedIn()&&!friends)load();else render()}},true);
  setInterval(()=>{if(signedIn()&&document.visibilityState==='visible'&&(window.SideviewLobby?.tab==='friends'||!picker.hidden)&&app.battle.state!=='running')load()},60000);
  // The cloud module finds out whether the server is there; check back until it has.
  let tries=0;const wait=setInterval(()=>{if(window.SideviewCloud?.enabled||++tries>20){clearInterval(wait);load()}},500);
 }
 // Called by the lobby: the friends tab opened, or the start screen changed.
 function open(){message='';render();if(Date.now()-loadedAt>15000)load();else pushProfile(false).then(render)}
 function refresh(showPicker){renderPicker(showPicker);if(showPicker&&signedIn()&&Date.now()-loadedAt>60000)load()}
 window.SideviewFriends={KEY,mount,open,refresh,tick,render,get chosen(){return chosen}};
})();
