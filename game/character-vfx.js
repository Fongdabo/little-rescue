/* Little Rescue 1.6.2 — presentation only. Events create bounded cues;
 * actual in-flight projectiles supply their screen positions. No combat writes.
 * new SideviewVFX().update(battle, dt); draw(ctx, {actors,projectiles,compress,foot,reduced}).
 */
(function(root,factory){
 'use strict';const API=factory();
 if(typeof module==='object'&&module.exports)module.exports=API;
 if(root)root.SideviewVFX=API;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const VERSION='1.6.2',TAU=Math.PI*2;
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 const number=(n,fallback=0)=>Number.isFinite(n)?n:fallback;
 const classOf=u=>u?.classId||({guard:'guard',scout:'agile',ranger:'ranged',healer:'helper',burst:'mage'}[u?.kind])||null;
 const LIFE={'guard-block':.32,'guard-attack':.24,'guard-hit':.25,'agile-trail':.26,'agile-hit':.22,'ranged-release':.18,'ranged-impact':.30,'helper-heal':.62,'mage-cast':.36,'mage-hit':.36,hit:.22};
 function scalarUnit(u){
  if(!u||!u.id)return null;
  return{id:String(u.id),classId:classOf(u),kind:u.kind||null,x:number(u.x),facing:u.facing===-1?-1:1,type:u.type||null};
 }
 function star(ctx,x,y,r,color,alpha=1){
  ctx.globalAlpha*=alpha;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y-r);ctx.quadraticCurveTo(x+r*.2,y-r*.2,x+r,y);ctx.quadraticCurveTo(x+r*.2,y+r*.2,x,y+r);ctx.quadraticCurveTo(x-r*.2,y+r*.2,x-r,y);ctx.quadraticCurveTo(x-r*.2,y-r*.2,x,y-r);ctx.fill();
 }
 function heart(ctx,x,y,r,color){
  ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y+r*.6);ctx.bezierCurveTo(x-r*1.4,y-r*.15,x-r*.65,y-r*1.2,x,y-r*.45);ctx.bezierCurveTo(x+r*.65,y-r*1.2,x+r*1.4,y-r*.15,x,y+r*.6);ctx.fill();
 }
 class CharacterVFX {
  constructor(options={}){this.maxCues=clamp(Math.floor(number(options.maxCues,32)),1,32);this.maxSources=48;this.maxShots=48;this.reset(null)}
  reset(runId){
   this.runId=runId;this.time=0;this.seq=0;this.serial=0;this.state=null;this.cues=[];
   this.sources=new Map();this.shots=new Map();this.actorFrames=new Map();this.flying=new Set();this.renderedShots=[];
   this.metrics={events:{},queued:{},expired:0,evicted:0,ignoredStale:0,maxCues:0};
  }
  _remember(unit){
   const next=scalarUnit(unit);if(!next)return null;
   const previous=this.sources.get(next.id);if(!next.classId&&previous)next.classId=previous.classId;
   this.sources.delete(next.id);this.sources.set(next.id,{...next,at:this.time});
   while(this.sources.size>this.maxSources)this.sources.delete(this.sources.keys().next().value);
   return next;
  }
  _queue(kind,event,source,target,battleTime){
   const lifetime=LIFE[kind],elapsed=Math.max(0,number(battleTime)-number(event.time,battleTime));
   if(elapsed>=lifetime){this.metrics.ignoredStale++;return}
   const cue={id:++this.serial,kind,seq:event.seq,at:this.time-elapsed,lifetime,sourceId:event.sourceId||source?.id||null,targetId:event.targetId||target?.id||null,source:scalarUnit(source),target:scalarUnit(target),sourceClass:source?.classId||null,amount:number(event.amount),projectileId:event.projectileId||null,lastPosition:null};
   this.cues.push(cue);if(this.cues.length>this.maxCues){this.cues.shift();this.metrics.evicted++}
   this.metrics.queued[kind]=(this.metrics.queued[kind]||0)+1;this.metrics.maxCues=Math.max(this.metrics.maxCues,this.cues.length);
  }
  update(battle,dt){
   if(!battle)return false;
   if(this.runId!==battle.runId||battle.state==='ready'&&this.state!=='ready')this.reset(battle.runId);
   if(battle.state==='paused'){this.state='paused';return false}
   this.state=battle.state;
   if(battle.state==='ready')return true;
   this.time+=clamp(number(dt),0,.1);
   const before=this.cues.length;this.cues=this.cues.filter(c=>this.time-c.at<c.lifetime);this.metrics.expired+=before-this.cues.length;
   for(const unit of [...(battle.allies||[]),...(battle.enemies||[])])this._remember(unit);
   this.flying=new Set((battle.projectiles||[]).map(p=>p.id));
   for(const event of battle.events||[]){
    if(!Number.isFinite(event.seq)||event.seq<=this.seq)continue;
    this.seq=event.seq;this.metrics.events[event.type]=(this.metrics.events[event.type]||0)+1;
    this._remember(event.unit);this._remember(event.target);this._remember(event.source);
    const source=this.sources.get(event.sourceId)||(['attack','heal','projectile-launch'].includes(event.type)?this.sources.get(event.unit?.id):null);
    const target=this.sources.get(event.targetId)||scalarUnit(event.target)||(['hit','block','base-hit','projectile-impact'].includes(event.type)?scalarUnit(event.unit):null);
    const shot=this.shots.get(event.projectileId),sourceClass=source?.classId||shot?.classId;
    const queue=(kind)=>this._queue(kind,event,source||shot?.source,target,battle.time);
    if(event.type==='projectile-launch'){
     this.shots.delete(event.projectileId);this.shots.set(event.projectileId,{sourceId:event.sourceId,classId:sourceClass||'ranged',source:scalarUnit(source),at:this.time});
     if(sourceClass!=='mage')queue('ranged-release');
    }else if(event.type==='projectile-impact'&&event.amount>0){
     queue(sourceClass==='mage'?'mage-hit':'ranged-impact');
    }else if(event.type==='heal'&&event.amount>0&&sourceClass==='helper')queue('helper-heal');
    else if(event.type==='block'&&event.amount>0&&target?.classId==='guard')queue('guard-block');
    else if(event.type==='attack'){
     if(sourceClass==='guard')queue('guard-attack');
     else if(sourceClass==='agile')queue('agile-trail');
     else if(sourceClass==='mage')queue('mage-cast');
    }else if((event.type==='hit'||event.type==='base-hit')&&event.amount>0&&event.cause!=='projectile'&&sourceClass!=='helper'){
     queue(sourceClass==='mage'?'mage-hit':sourceClass==='agile'?'agile-hit':sourceClass==='guard'?'guard-hit':'hit');
    }
   }
   // Flight metadata outlives the shooter. A vanished/cancelled projectile does
   // not produce an impact: only the actual impact event above can do that.
   for(const p of battle.projectiles||[]){
    const source=this.sources.get(p.sourceId),prior=this.shots.get(p.id);
    this.shots.set(p.id,{sourceId:p.sourceId,classId:prior?.classId||source?.classId||'ranged',source:prior?.source||scalarUnit(source),at:this.time});
   }
   for(const [id,shot]of this.shots)if(!this.flying.has(id)&&this.time-shot.at>4)this.shots.delete(id);
   while(this.shots.size>this.maxShots)this.shots.delete(this.shots.keys().next().value);
   for(const [id,source]of this.sources)if(this.time-source.at>4&&!Array.from(this.shots.values()).some(s=>s.sourceId===id))this.sources.delete(id);
   for(const [id,actor]of this.actorFrames)if(this.time-actor.at>.8)this.actorFrames.delete(id);
   return true;
  }
  _actor(id){return this.actorFrames.get(id)||null}
  _point(id,fallback,mode,compress,foot){
   const actor=this._actor(id);
   if(actor){
    if(mode==='source'&&actor.muzzle)return{x:actor.muzzle.x,y:actor.muzzle.y};
    const b=actor.spriteBounds;
    if(b)return{x:b.x+b.width*.5,y:b.y+b.height*.60};
    if(actor.foot)return{x:actor.foot.x,y:actor.foot.y-45*compress};
   }
   return{x:number(fallback?.x),y:foot-48*compress};
  }
  draw(ctx,options={}){
   if(!ctx)return false;
   const compress=clamp(number(options.compress,1),.15,3),foot=number(options.foot,414),reduced=Boolean(options.reduced);
   for(const a of options.actors||[]){
    if(!a.id||a.alpha===0||a.hidden)continue;
    this.actorFrames.delete(a.id);this.actorFrames.set(a.id,{id:a.id,classId:a.classId,facing:a.facing===-1?-1:1,spriteBounds:a.spriteBounds?{...a.spriteBounds}:null,foot:a.foot?{...a.foot}:null,muzzle:a.muzzle?{...a.muzzle}:null,at:this.time});
   }
   while(this.actorFrames.size>this.maxSources)this.actorFrames.delete(this.actorFrames.keys().next().value);
   this.renderedShots=[];
   for(const p of (options.projectiles||[]).slice(0,this.maxShots)){
    if(!this.flying.has(p.id)||!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
    const shot=this.shots.get(p.id),mage=shot?.classId==='mage',direction=p.direction===-1?-1:1,color=mage?(p.friendly?'#82c7ff':'#c19aed'):'#d0a95c';
    ctx.save();ctx.translate(p.x,p.y);ctx.scale(1,compress);ctx.globalAlpha=.55;ctx.fillStyle=color;
    for(let i=1;i<=3;i++){ctx.beginPath();ctx.ellipse(-direction*i*7,0,Math.max(1,4-i),Math.max(1,3-i*.5),0,0,TAU);ctx.fill()}
    ctx.globalAlpha=1;ctx.fillStyle=mage?'#e0d9ff':'#f5d78e';ctx.strokeStyle=mage?'#7965af':'#9a723a';ctx.lineWidth=1.5;ctx.beginPath();ctx.ellipse(0,0,mage?5:6,mage?5:4,0,0,TAU);ctx.fill();ctx.stroke();
    if(mage)star(ctx,-1,-1,2.8,'#fff5dc');else{ctx.strokeStyle='#fff0ba';ctx.beginPath();ctx.moveTo(-2,-2);ctx.lineTo(2,1);ctx.stroke()}
    ctx.restore();this.renderedShots.push({id:p.id,classId:shot?.classId||'ranged',x:p.x,y:p.y,direction,flightProgress:number(p.flightProgress)});
   }
   for(const cue of this.cues){
    const age=clamp((this.time-cue.at)/cue.lifetime,0,1),alpha=(1-age)**.7,sourceCue=['guard-attack','agile-trail','ranged-release','mage-cast'].includes(cue.kind);
    const from=this._point(cue.sourceId,cue.source,'source',compress,foot),to=this._point(cue.targetId,cue.target,cue.kind==='guard-block'?'source':'target',compress,foot),at=sourceCue?from:to;
    const facing=cue.source?.facing===-1?-1:1,hero=facing===1,phase=reduced?.35:age;
    cue.lastPosition={x:at.x,y:at.y};ctx.save();ctx.globalAlpha=alpha;
    if(cue.kind==='agile-trail'){
     const span=clamp(Math.abs(to.x-from.x),18,58),rise=(to.y-from.y)/compress*.25;
     ctx.translate(from.x,from.y);ctx.scale(1,compress);ctx.lineCap='round';ctx.strokeStyle=hero?'#a6e7dc':'#d6afcd';ctx.lineWidth=7;ctx.globalAlpha=alpha*.30;ctx.beginPath();ctx.moveTo(-facing*9,8);ctx.quadraticCurveTo(facing*span*.40,-18,facing*span,-3+rise);ctx.stroke();ctx.globalAlpha=alpha;ctx.lineWidth=2.1;ctx.strokeStyle=hero?'#4aaca5':'#a86b9b';ctx.stroke();
     for(let i=0;i<3;i++){ctx.save();star(ctx,facing*(span*.2+i*9+phase*8),5-i*5,2.7,'#fff0c3');ctx.restore()}
    }else if(cue.kind==='helper-heal'){
     ctx.strokeStyle=hero?'#a0d9a7':'#e3c477';ctx.lineWidth=1.7;ctx.globalAlpha=alpha*.38;ctx.setLineDash([3,7]);ctx.beginPath();ctx.moveTo(from.x,from.y);ctx.quadraticCurveTo((from.x+to.x)/2,Math.max(from.y,to.y)-13*compress,to.x,to.y);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=alpha;
     ctx.translate(to.x,to.y);ctx.scale(1,compress);heart(ctx,-8,3-phase*16,5.5,hero?'#95ce9d':'#d9bc68');heart(ctx,7,8-phase*13,4,'#edb4bd');ctx.strokeStyle='#cce8b1';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,10,8+phase*4,.15,Math.PI-.15);ctx.stroke();
    }else{
     ctx.translate(at.x,at.y);ctx.scale(1,compress);
     if(cue.kind==='guard-block'){
      const targetFacing=this._actor(cue.targetId)?.facing||cue.target?.facing||-facing;
      ctx.scale(targetFacing,1);ctx.strokeStyle='#f8df9a';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,10+phase*5,-1.1,1.1);ctx.stroke();ctx.strokeStyle='#a8c281';ctx.lineWidth=1.6;ctx.beginPath();ctx.ellipse(2,-2,4,7,.4,0,TAU);ctx.stroke();star(ctx,10+phase*7,-8,3,'#fff2c8');
     }else if(cue.kind==='guard-attack'){
      ctx.strokeStyle='#dbc28a';ctx.lineWidth=2;ctx.beginPath();ctx.arc(-facing*3,0,8+phase*4,facing===1?-1.2:1.9,facing===1?1.2:4.35);ctx.stroke();star(ctx,facing*10,-5,3,'#e8efbc');
     }else if(cue.kind==='mage-cast'){
      const color=hero?'#8ac8ed':'#bb95e6';ctx.strokeStyle=color;ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(0,0,5+phase*5,-.5+phase*2,3.7+phase*2);ctx.stroke();for(let i=0;i<3;i++){const a=i*TAU/3+(reduced?0:phase*2);ctx.save();star(ctx,Math.cos(a)*9,Math.sin(a)*9,2.8,'#f4d987');ctx.restore()}
     }else if(cue.kind==='ranged-release'){
      ctx.strokeStyle='#f3d48c';ctx.lineWidth=2;for(let i=0;i<3;i++){ctx.beginPath();ctx.moveTo(facing*3,(i-1)*3);ctx.lineTo(facing*(8+phase*8),(i-1)*6);ctx.stroke()}
     }else{
      const mage=cue.kind==='mage-hit',seed=cue.kind==='ranged-impact',color=mage?(hero?'#9ccbf3':'#c2a1ed'):seed?'#ebcf8d':cue.kind==='agile-hit'?'#9bd6ce':'#d7d9a2',count=mage?5:seed?5:4;
      for(let i=0;i<count;i++){const a=i*TAU/count+cue.seq*.43,r=3+phase*(mage?13:10),x=Math.cos(a)*r,y=Math.sin(a)*r;ctx.save();if(mage)star(ctx,x,y,3.5*(1-phase*.5),color);else{ctx.fillStyle=color;ctx.beginPath();ctx.ellipse(x,y,seed?3:2,seed?1.8:3,a,0,TAU);ctx.fill()}ctx.restore()}
      ctx.fillStyle='#fff2c7';ctx.globalAlpha=alpha*.65;ctx.beginPath();ctx.arc(0,0,2.5,0,TAU);ctx.fill();
     }
    }
    ctx.restore();
   }
   return true;
  }
  snapshot(){
   return JSON.parse(JSON.stringify({version:VERSION,runId:this.runId,time:this.time,state:this.state,lastSeq:this.seq,active:this.cues.length,maxCues:this.maxCues,retainedSources:this.sources.size,retainedShots:this.shots.size,actorFrames:this.actorFrames.size,metrics:this.metrics,projectiles:this.renderedShots,cues:this.cues.map(c=>({id:c.id,kind:c.kind,eventSeq:c.seq,sourceId:c.sourceId,targetId:c.targetId,projectileId:c.projectileId,sourceClass:c.sourceClass,amount:c.amount,age:this.time-c.at,lifetime:c.lifetime,position:c.lastPosition}))}));
  }
 }
 CharacterVFX.version=VERSION;return CharacterVFX;
});
