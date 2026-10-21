/* 1.11.1: anonymous play statistics, so the owner can see how far players get and where they stop.
   Sends only game facts (build, stage, win/lose, seconds played) with a random id made on this device.
   No name, no save data, no IP is stored. Lives in its own key, little-rescue-stats-v1; never touches the save.
   Everything here is best effort: offline, blocked, or a missing endpoint just drops the events silently. */
(()=>{
 'use strict';
 const KEY='little-rescue-stats-v1',ENDPOINT='api/stats',BUILD='1.11.1';
 const pad=n=>String(n).padStart(2,'0');
 const dayOf=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
 function randomHex(n){
  const bytes=new Uint8Array(n);try{crypto.getRandomValues(bytes)}catch{for(let i=0;i<n;i++)bytes[i]=Math.random()*256}
  return [...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
 }
 let storage=null;try{storage=window.localStorage}catch{}
 function load(){
  try{const s=JSON.parse(storage?.getItem(KEY)||'null');
   if(s&&s.v===1&&/^[0-9a-f]{16}$/.test(s.id)&&/^\d{4}-\d{2}-\d{2}$/.test(s.first))return {v:1,id:s.id,first:s.first,off:s.off===true}}catch{}
  return {v:1,id:randomHex(8),first:dayOf(new Date()),off:false};
 }
 const state=load();
 function persist(){try{storage?.setItem(KEY,JSON.stringify(state))}catch{}}
 persist();
 const session=randomHex(6);
 // Days since this device was first seen (0 = first day), for D1/D7 retention.
 const age=()=>{const [y,m,d]=state.first.split('-').map(Number);return Math.max(0,Math.round((new Date().setHours(0,0,0,0)-new Date(y,m-1,d).getTime())/864e5))};
 const queue=[];let active=0,visibleSince=document.hidden?0:performance.now();
 function add(kind,data={}){
  if(state.off||queue.length>=60)return;
  queue.push({kind,t:Date.now(),...data});
 }
 function flush(){
  if(state.off||!queue.length||navigator.onLine===false||!/^https?:$/.test(location.protocol))return;
  const body=JSON.stringify({v:1,pid:state.id,sid:session,build:BUILD,age:age(),events:queue.splice(0,queue.length)});
  try{
   const url=new URL(ENDPOINT,document.baseURI).href;
   if(navigator.sendBeacon?.(url,new Blob([body],{type:'text/plain'})))return;
   fetch(url,{method:'POST',body,keepalive:true,headers:{'content-type':'text/plain'}}).catch(()=>{});
  }catch{}
 }
 function seconds(){return Math.round((active+(visibleSince?performance.now()-visibleSince:0))/1000)}
 // Battle tracking. app.js calls observe(battle) from sync(), so this must stay cheap.
 let runId=0,ended=0,stage=-1,started=0;
 function observe(battle,cleared){
  if(state.off)return;
  if(battle.runId!==runId&&battle.state==='running'){runId=battle.runId;stage=battle.stageIndex;started=Date.now();add('start',{stage,cleared})}
  if(runId&&ended!==runId&&(battle.state==='won'||battle.state==='advancing'||battle.state==='lost')){
   ended=runId;const won=battle.state!=='lost';
   add('end',{stage,result:won?'won':'lost',secs:Math.round(battle.time||0),
    why:won?'':battle.homeHP<=0?'base':'time',
    hp:Math.round(Math.max(0,won?battle.homeHP/window.Sideview.CONFIG.homeHP:battle.enemyHP/battle.enemyMaxHP)*100)});
   flush();
  }
 }
 function hidden(battle){
  if(visibleSince){active+=performance.now()-visibleSince;visibleSince=0}
  if(battle&&runId&&ended!==runId&&['running','paused'].includes(battle.state))add('away',{stage,secs:Math.round(battle.time||0)});
  add('active',{secs:seconds()});
  flush();
 }
 let lastBattle=null;
 document.addEventListener('visibilitychange',()=>{if(document.hidden)hidden(lastBattle);else visibleSince=performance.now()});
 addEventListener('pagehide',()=>{if(!document.hidden)hidden(lastBattle)});
 addEventListener('online',flush);
 setInterval(flush,60000);
 const toggle=document.getElementById('statsToggle');
 if(toggle){toggle.checked=!state.off;toggle.addEventListener('change',()=>{window.SideviewStats.enabled=toggle.checked})}
 window.SideviewStats={
  begin(cleared,standalone){add('session',{cleared,app:standalone?1:0});flush()},
  observe(battle,cleared){lastBattle=battle;try{observe(battle,cleared)}catch{}},
  event(kind,data){if(/^[a-z_]{1,16}$/.test(kind))add(kind,data)},
  get enabled(){return !state.off},
  set enabled(on){state.off=!on;if(!on)queue.length=0;persist()}
 };
})();
