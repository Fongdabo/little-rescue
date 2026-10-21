/* 1.13: server wallet for players with a cloud account (functions/_lib/play.js). Guests play exactly as before.
   For a signed-in player the server holds the real coins, hero levels, stars, shards and cleared stages:
   - every action that earns or spends still happens locally at once (and offline), and is queued here,
   - the queue is sent when online; the server re-checks each action (time per win, wins per hour, prices,
     what is unlocked) and answers with its wallet,
   - once nothing is left in the queue, the game adopts the server's numbers (only before a battle or after the
     reward, through SideviewBridge.applyWallet), so coins edited in the browser simply come back to the real value,
   - summons are rolled by the server, so they need a connection.
   Queue and last server answer live in their own key, little-rescue-wallet-v1; the save itself is untouched. */
(()=>{
 'use strict';
 const KEY='little-rescue-wallet-v1',CLOUD='little-rescue-cloud-v1',LOCK='little-rescue-wallet-sync',MAX_QUEUE=500;
 let storage=null;try{storage=window.localStorage}catch{}
 let enabled=null,health=null,lastGet=0,rejected=0,timer=0;
 const runs=new Map();
 const pad=n=>String(n).padStart(2,'0');
 const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
 const opId=()=>Array.from(crypto.getRandomValues(new Uint8Array(12)),b=>b.toString(16).padStart(2,'0')).join('');
 const withLock=fn=>navigator.locks?navigator.locks.request(LOCK,fn):fn();
 const bridge=()=>window.SideviewBridge?.snapshot().ready?window.SideviewBridge:null;

 function account(){try{const s=JSON.parse(storage?.getItem(CLOUD)||'null');return s&&s.v===1&&typeof s.token==='string'&&typeof s.playerId==='string'&&!s.choose?s:null}catch{return null}}
 function read(){
  const a=account();if(!a)return null;
  let raw=null;try{raw=JSON.parse(storage?.getItem(KEY)||'null')}catch{}
  if(!raw||raw.v!==1||raw.playerId!==a.playerId||!Array.isArray(raw.pending))raw={v:1,playerId:a.playerId,pending:[],server:null};
  return raw;
 }
 function write(s){try{storage?.setItem(KEY,JSON.stringify(s));return Boolean(storage)}catch{return false}}

 async function api(path,token,body){
  const response=await fetch('api/'+path,{method:body?'POST':'GET',cache:'no-store',
   headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
  let data={};try{data=await response.json()}catch{}
  return {status:response.status,data};
 }
 function checkHealth(){
  health=health||fetch('api/health',{cache:'no-store'}).then(r=>r.json()).then(d=>{enabled=d?.wallet===true},()=>{enabled=false;health=null});
  return health;
 }

 // Called inside app.js savedAction (the save lock) right where the local change is made.
 function record(op){
  const s=read();if(!s||enabled===false||s.pending.length>=MAX_QUEUE)return;
  s.pending.push({id:opId(),day:today(),at:Date.now(),...op});write(s);
  clearTimeout(timer);timer=setTimeout(flush,800);
 }

 // What this device has now, sent once to start a wallet for an account that played before 1.13.
 function localSnapshot(b){
  const m=b.meta(),s=window.SideviewSummon.read();let login=null;
  try{const d=JSON.parse(storage.getItem(window.SideviewDaily.KEY)||'null');if(d?.v===1&&d.login)login=d.login}catch{}
  return {coins:b.snapshot().progress.coins,levels:m.levels,cleared:m.cleared,units:s.units,sinceLegend:s.sinceLegend,pulls:s.pulls,freeDay:s.freeDay,login};
 }

 // Must hold LOCK. Starts the wallet if needed, then sends the queue in order. false = could not reach the server.
 async function sendQueue(token){
  let s=read();if(!s)return false;
  if(!s.server||Date.now()-lastGet>60000&&!s.pending.length){
   const got=await api('wallet',token);if(got.status!==200)return false;lastGet=Date.now();
   s=read();if(!s)return false;
   if(got.data.wallet)s.server=got.data.wallet;
   else{
    // Seed only once this device's save matches its cloud copy, so a device that is about to restore from the
    // cloud never starts the wallet with its empty local numbers.
    const b=bridge(),a=account();if(!b||!a?.synced||window.SideviewCloud?.conflict)return false;
    // Everything queued so far is already part of the local numbers being sent.
    const sent=new Set(s.pending.map(o=>o.id)),seeded=await api('wallet/seed',token,localSnapshot(b));
    if(seeded.status!==200)return false;
    s=read();if(!s)return false;s.pending=s.pending.filter(o=>!sent.has(o.id));s.server=seeded.data.wallet;
   }
   write(s);
  }
  while(s.pending.length){
   const sent=await api('wallet/ops',token,{ops:s.pending.slice(0,50)});
   if(sent.status!==200||!Array.isArray(sent.data.results))return false;
   const done=new Set(sent.data.results.map(r=>r.id));rejected+=sent.data.results.filter(r=>!r.ok).length;
   s=read();if(!s)return false;s.pending=s.pending.filter(o=>!done.has(o.id));if(sent.data.wallet)s.server=sent.data.wallet;write(s);
  }
  return true;
 }
 async function flush(){
  const a=account();if(!a||!navigator.onLine)return;
  await checkHealth();if(!enabled)return;
  try{await withLock(()=>sendQueue(a.token))}catch{/* offline: the queue waits */}
  await reconcile();window.SideviewCloud?.paint?.();
 }

 const sameUnits=(a,b)=>Object.keys(a).every(id=>a[id]?.star===b[id]?.star&&a[id]?.shards===b[id]?.shards);
 function differs(view,b){
  const m=b.meta(),s=window.SideviewSummon.read();
  return view.coins!==b.snapshot().progress.coins||view.cleared!==m.cleared||view.levels.join()!==m.levels.join()||
   !sameUnits(view.units,s.units)||view.sinceLegend!==s.sinceLegend||view.pulls!==s.pulls||view.freeDay!==s.freeDay;
 }
 // Adopt the server's numbers when nothing is waiting to be sent and no battle or unclaimed reward is open.
 async function reconcile(){
  const s=read(),b=bridge();
  if(!s?.server||s.pending.length||!b||!differs(s.server,b)||!b.safe()||!window.SideviewPWA?.canAct())return false;
  const rev=s.server.rev;
  return b.applyWallet(s.server,()=>{const now=read();return Boolean(now&&!now.pending.length&&now.server?.rev===rev)});
 }

 // A run ticket lets the server time the battle with its own clock. Without one (offline) a win is still
 // accepted, under a lower daily limit.
 async function startRun(runId,stage){
  const a=account(),s=read();if(!a||!enabled||!s?.server||!navigator.onLine)return;
  try{const r=await api('wallet/run',a.token,{stage});if(r.status===200&&r.data.run)runs.set(runId,r.data.run)}catch{}
  if(runs.size>20)runs.delete(runs.keys().next().value);
 }
 const runFor=runId=>runs.get(runId)||null;

 // Server-side summon. null = no account (summon.js rolls locally as before); {error} or {results, view}.
 async function summon(pull,currency='coins'){
  const a=account();if(!a)return null;
  if(!navigator.onLine)return {error:'offline'};
  await checkHealth();if(!enabled)return null;
  try{return await withLock(async()=>{
   if(!await sendQueue(a.token))return {error:'offline'};
   const op={id:opId(),kind:'summon',pull,currency,day:today(),at:Date.now()};
   const r=await api('wallet/ops',a.token,{ops:[op]});
   if(r.status!==200||!r.data.results)return {error:'offline'};
   const s=read();if(s&&r.data.wallet){s.server=r.data.wallet;write(s)}
   const res=r.data.results[0];
   return res.ok?{results:res.result.results,view:r.data.wallet}:{error:res.error,view:r.data.wallet};
  })}catch{return {error:'offline'}}
 }

 function statusHTML(){
  const s=read();if(!s||!enabled)return '';
  const queued=s.pending.length;
  return `<p class="cloud-note">🛡️ เหรียญ เลเวล ดาว และการสุ่มของบัญชีนี้ ตรวจและบันทึกโดยเซิร์ฟเวอร์${s.server?` · ยอดบนเซิร์ฟเวอร์ ◉ ${s.server.coins.toLocaleString('th-TH')}`:''}${queued?` · รอส่ง ${queued} รายการ`:''}${rejected?` · เซิร์ฟเวอร์ไม่รับ ${rejected} รายการ ยอดในเครื่องปรับตามเซิร์ฟเวอร์แล้ว`:''}</p>`;
 }

 function start(){
  if(!account())return;
  checkHealth().then(flush);
 }
 window.addEventListener('online',flush);
 window.addEventListener('storage',event=>{if(event.key===CLOUD)start()});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')flush()});
 setInterval(flush,20000);
 window.SideviewWallet={KEY,record,flush,reconcile,startRun,runFor,summon,statusHTML,start,
  active:()=>Boolean(account())&&enabled!==false,read};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(start,500));else setTimeout(start,500);
})();
