/* Presentation-only state: no combat, resources, saves or random outcomes. */
'use strict';
(() => {
 class Animator {
  constructor(){this.time=0;this.run=-1;this.seq=0;this.simulationTime=null;this.units=new Map();this.defeated=[];this.seen={idle:0,walk:0,attack:0,hit:0,defeat:0};this.events={};this.frames=0}
  update(battle,dt){
   if(this.run!==battle.runId||battle.state==='ready'&&this.state!=='ready'){
    this.units.clear();this.defeated=[];this.seq=0;this.simulationTime=null;this.run=battle.runId;
   }
   const frozen=battle.state==='paused';if(frozen){this.state=battle.state;return}this.time+=Math.max(0,Math.min(.1,dt));
   this.state=battle.state;
   const simulationAdvanced=this.simulationTime===null||!Number.isFinite(battle.time)||Math.abs(battle.time-this.simulationTime)>1e-9;
   this.simulationTime=battle.time;
   const current=[...battle.allies.map(u=>({...u,team:true})),...battle.enemies.map(u=>({...u,team:false}))];
   const ids=new Set(current.map(u=>u.id));
   for(const u of current){
    let view=this.units.get(u.id);
    if(!view){view={unit:u,attackUntil:0,hitUntil:0,moving:false};this.units.set(u.id,view)}
    // Keep walking through RAFs between fixed simulation ticks. A stationary
    // simulation tick (or leaving combat) ends walking; a new actor starts idle.
    if(u.boarded||['boarded','celebrate','wait','ride'].includes(u.victoryAction))view.moving=false;
    else if(u.victoryAction==='run'||u.victoryAction==='board')view.moving=true;
    else if(battle.state!=='running')view.moving=false;
    else if(['advance','retreat','hold'].includes(u.movement))view.moving=u.movement!=='hold';
    else if(Math.abs(u.x-view.unit.x)>.002)view.moving=true;
    else if(simulationAdvanced)view.moving=false;
    if(u.hp<view.unit.hp)view.hitUntil=this.time+.25;
    // The engine owns the .38 s foot lock. Its remaining time is authoritative
    // across zero-simulation-tick RAFs; fallback preserves old engine support.
    if(Number.isFinite(u.attackLock))view.attackUntil=this.time+Math.max(0,u.attackLock);
    else if(u.attackFlash>view.unit.attackFlash+.02)view.attackUntil=this.time+.38;
    view.unit=u;
   }
   for(const event of battle.events||[]){
    if(event.seq<=this.seq)continue;this.seq=event.seq;this.events[event.type]=(this.events[event.type]||0)+1;
    const unit=event.unit, id=event.unitId||unit?.id;
    const view=this.units.get(id);
    if(event.type==='attack'||event.type==='heal'){if(view&&!Number.isFinite(view.unit.attackLock))view.attackUntil=this.time+.38}
    if(event.type==='hit'||event.type==='block'){if(view)view.hitUntil=this.time+(event.type==='block'?.16:.25)}
    if(event.type==='defeat'&&unit&&!this.defeated.some(d=>d.unit.id===unit.id))this.defeated.push({unit:{...unit,team:unit.facing===1},at:this.time});
   }
   for(const [id,view]of this.units)if(!ids.has(id)){
    const leftSafely=view.unit.boarded||view.unit.victoryAction==='boarded'||view.unit.team&&view.unit.hp>0&&['advancing','won'].includes(battle.state);
    if(!leftSafely&&!this.defeated.some(d=>d.unit.id===id)&&battle.state!=='ready')this.defeated.push({unit:view.unit,at:this.time});
    this.units.delete(id);
   }
   this.defeated=this.defeated.filter(d=>this.time-d.at<.65).slice(-24);this.frames++;
  }
  pose(unit){
   const view=this.units.get(unit.id),action=unit.victoryAction,hidden=Boolean(unit.boarded||action==='boarded'),seed=Number(String(unit.id).split('-').at(-1))||0;let phase='idle',progress=0;
   if(!hidden&&(action==='run'||action==='board')){phase='walk';progress=this.time*1.7%1}
   else if(!hidden&&action==='celebrate')progress=(this.time*.85+seed*.17)%1;
   else if(!hidden&&(action==='wait'||action==='ride'))progress=this.time*.55%1;
   else if(view&&!hidden){
    if(view.hitUntil>this.time){phase='hit';progress=1-(view.hitUntil-this.time)/.25}
    else if(view.moving){phase='walk';progress=((this.time*1.7*(unit.movement==='retreat'?-1:1))%1+1)%1}
    else if(view.attackUntil>this.time){phase='attack';progress=.45+.55*(1-(view.attackUntil-this.time)/.38)}
    else progress=this.time*.55%1;
   }
   this.seen[phase]++;return {phase,progress:Math.max(0,Math.min(1,progress)),time:this.time,blocking:(unit.blockFlash||0)>0,seed,movement:unit.movement||null,victoryAction:action||null,hidden,hop:!hidden&&action==='celebrate'?(1-Math.cos((this.time*1.8+seed*.17)*Math.PI*2))*.0225:0};
  }
  ghosts(){return this.defeated.map(d=>{this.seen.defeat++;return {...d.unit,phase:'defeat',progress:Math.max(0,Math.min(1,(this.time-d.at)/.65))}})}
  snapshot(){return {time:this.time,runId:this.run,frames:this.frames,seen:{...this.seen},events:{...this.events},live:this.units.size,defeated:this.defeated.length}}
 }
 window.SideviewAnimator=Animator;
})();
