/* 1.17 weekly event stage (engine.js WEEKLY): one event stage a week, changing every Monday 00:00 Thai time.
   The first WEEKLY.paidPerDay wins of a day pay the stage reward, later wins pay nothing; WEEKLY.chestWins wins in a
   week open a chest of WEEKLY.chestCoins once. Counters live in their own key, little-rescue-weekly-v1
   ({v, week, wins, chest, day, dayWins}); app.js writes them inside savedAction, next to the coins they pay.
   For a cloud account the server wallet keeps its own counters (functions/_lib/play.js ops 'event', 'event-chest'). */
(()=>{
 'use strict';
 const KEY='little-rescue-weekly-v1',{WEEKLY,weekOf,weeklyEvent,weekEnds}=window.Sideview;
 let storage=null;try{storage=window.localStorage}catch{}
 const pad=n=>String(n).padStart(2,'0');
 // The player's own calendar day, as daily-missions.js and wallet.js count it.
 const today=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`};
 const count=(n,max)=>Number.isInteger(n)&&n>=0&&n<=max;

 function read(now=Date.now()){
  const week=weekOf(now),day=today();let s=null;
  try{s=JSON.parse(storage?.getItem(KEY)||'null')}catch{}
  if(!s||s.v!==1||s.week!==week||!count(s.wins,1e6)||typeof s.chest!=='boolean')s={v:1,week,wins:0,chest:false,day,dayWins:0};
  if(s.day!==day||!count(s.dayWins,1e6))s={...s,day,dayWins:0};
  return s;
 }
 function write(s){try{storage?.setItem(KEY,JSON.stringify(s));return Boolean(storage)}catch{return false}}

 // Everything the lobby shows about this week.
 function current(now=Date.now()){
  const s=read(now),event=weeklyEvent(now);
  return {event,week:s.week,endsAt:weekEnds(now),wins:s.wins,chest:s.chest,dayWins:s.dayWins,
   paidLeft:Math.max(0,WEEKLY.paidPerDay-s.dayWins),chestReady:!s.chest&&s.wins>=WEEKLY.chestWins};
 }
 // What the next event win pays now.
 const payFor=(event,now=Date.now())=>read(now).dayWins<WEEKLY.paidPerDay?event.rewardCoins:0;
 // Inside savedAction only. A win from last week's event (a battle that ran past Monday 00:00) still counts today.
 function addWin(now=Date.now()){const s=read(now);s.wins+=1;s.dayWins+=1;return write(s)}
 function claimChest(now=Date.now()){const s=read(now);if(s.chest||s.wins<WEEKLY.chestWins)return false;s.chest=true;return write(s)}
 function timeLeft(now=Date.now()){
  const ms=Math.max(0,weekEnds(now)-now),d=Math.floor(ms/86400000),h=Math.floor(ms%86400000/3600000),m=Math.floor(ms%3600000/60000);
  return d?`${d} วัน ${h} ชม.`:h?`${h} ชม. ${m} นาที`:`${m} นาที`;
 }
 window.SideviewWeekly={KEY,WEEKLY,read,current,payFor,addWin,claimChest,timeLeft};
})();
