/* 2.0 sticker hero collection. The original five heroes (UNITS 0-4) are always owned and keep their levels
   in little-rescue-meta-v1; the schema 2 save roster only ever holds those five. Everything about the
   heroes added after them lives here, in its own key, so older builds and save files never see it:
   little-rescue-heroes-v1 = {v:1, owned:{<unitId>:{level}}, team:[unitIds], base:[schema 2 roster when team was written]}.
   `base` lets a reader tell whether an older build or a save import changed the roster since; then that roster wins.
   Stars and shards belong to summon.js (little-rescue-summon-v1). */
(()=>{
 'use strict';
 const {UNITS,LEVELS,CONFIG}=window.Sideview,KEY='little-rescue-heroes-v1',BASE=CONFIG.baseHeroes;
 let storage=null;try{storage=window.localStorage}catch{}
 const listeners=new Set();
 const isBase=id=>{const i=UNITS.findIndex(u=>u.id===id);return i>=0&&i<BASE};
 const known=id=>UNITS.some(u=>u.id===id);
 const ids=v=>Array.isArray(v)&&v.every(n=>typeof n==='string'&&known(n))&&new Set(v).size===v.length;
 function read(){
  try{const m=JSON.parse(storage?.getItem(KEY)||'null');
   if(m&&m.v===1&&m.owned&&typeof m.owned==='object'){
    const owned={};
    for(const [id,o] of Object.entries(m.owned))if(known(id)&&!isBase(id))owned[id]={level:Number.isInteger(o?.level)?Math.max(1,Math.min(LEVELS.max,o.level)):1};
    const team=ids(m.team)&&m.team.length>=1&&m.team.length<=CONFIG.maxTeam&&m.team.every(id=>isBase(id)||owned[id])?m.team.slice():null;
    const base=Array.isArray(m.base)&&m.base.every(n=>Number.isInteger(n)&&n>=0&&n<BASE)?m.base.slice():null;
    return {v:1,owned,team,base};
   }}catch{}
  return {v:1,owned:{},team:null,base:null};
 }
 function write(state){try{storage?.setItem(KEY,JSON.stringify(state));return true}catch{return false}}
 function emit(){for(const fn of listeners)try{fn()}catch{}}
 const owned=id=>isBase(id)||Boolean(read().owned[id]);
 // Returns true only when this call unlocked the hero.
 function grant(id){
  if(!known(id)||owned(id))return false;
  const state=read();state.owned[id]={level:1};if(!write(state))return false;emit();return true;
 }
 function level(id){return read().owned[id]?.level||1}
 function setLevel(id,lv){const state=read();if(!state.owned[id])return false;state.owned[id].level=Math.max(1,Math.min(LEVELS.max,lv));return write(state)}
 // Team as UNITS indices, or null when the schema 2 roster should be used as is.
 function team(saveRoster){
  const state=read();if(!state.team||!state.base)return null;
  const same=a=>[...a].sort((x,y)=>x-y).join(',');
  if(same(state.base)!==same(saveRoster))return null;
  return state.team.map(id=>UNITS.findIndex(u=>u.id===id));
 }
 // Called inside the save lock with the roster about to be written to the schema 2 save.
 function setTeam(indices,saveRoster){
  const state=read();state.team=indices.map(i=>UNITS[i].id);state.base=saveRoster.slice();return write(state);
 }
 function list(){return UNITS.filter(u=>owned(u.id)).map(u=>u.id)}
 // 1.14.1 server wallet (signed-in players): its owned flags and levels replace the local ones. Called inside the save lock.
 function adopt(view){
  if(!Array.isArray(view?.levels)||!view.units)return false;
  const state=read(),next={};
  UNITS.forEach((u,i)=>{if(i>=BASE&&view.units[u.id]?.owned)next[u.id]={level:Number.isInteger(view.levels[i])?Math.max(1,Math.min(LEVELS.max,view.levels[i])):1}});
  state.owned=next;if(state.team&&!state.team.every(id=>isBase(id)||next[id]))state.team=null;
  if(!write(state))return false;emit();return true;
 }
 addEventListener('storage',event=>{if(event.key===KEY)emit()});
 window.SideviewHeroes={KEY,owned,grant,level,setLevel,team,setTeam,list,adopt,onChange:fn=>listeners.add(fn)};
})();
