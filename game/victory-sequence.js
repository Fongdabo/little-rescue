/* Deterministic presentation-only rescue trip. No combat, saves or randomness.
 * Browser: SideviewVictory. Node: require('./victory-sequence.js').
 * plan(config) freezes an alive-unit snapshot; duration(configOrPlan) gives the
 * COMPLETE sequence duration. sample(elapsed, configOrPlan) is a pure function.
 * victoryTravelDuration is the departure segment AFTER every actor has boarded.
 * The renderer keeps boarded actors hidden; records remain alive and available.
 */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.SideviewVictory=factory();
}(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';

  const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));
  const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
  const positive=(value,fallback)=>Number.isFinite(value)&&value>0?value:fallback;
  const mix=(from,to,progress)=>from+(to-from)*progress;
  const progress=(time,start,end)=>end<=start?Number(time>=end):clamp((time-start)/(end-start),0,1);
  const isPlan=value=>Boolean(value&&value.victoryPlanVersion===1&&Object.isFrozen(value));

  function plan(config){
    if(isPlan(config))return config;
    config=config||{};
    const homeX=finite(config.homeX,80);
    // The van always departs to the right, with visible room beyond its pickup.
    const targetX=Math.max(homeX+180,finite(config.victoryVehicleTarget,1000));
    const doorOffset=finite(config.victoryDoorOffset,20);
    const foldDuration=positive(config.victoryFoldDuration,.55);
    const celebrateDuration=Math.max(.6,foldDuration,positive(config.victoryCelebrateDuration,.6));
    const runSpeed=clamp(positive(config.victoryRunSpeed,320),80,420);
    const vehicleSpeed=clamp(positive(config.victoryVehicleSpeed,700),100,1200);
    const boardDuration=clamp(positive(config.victoryBoardDuration,.32),.18,.65);
    const boardGap=clamp(finite(config.victoryBoardGap,.04),0,.08);
    const readyDuration=Math.max(.12,positive(config.victoryReadyDuration,.18));
    const survivors=Array.isArray(config.survivors)?config.survivors:[];
    const records=survivors.map((record,index)=>({
      ...record,id:record.id==null?'survivor-'+index:record.id,
      x:finite(record.x,homeX+doorOffset),isRescuedFriend:false
    }));
    const friend=config.rescuedFriend&&typeof config.rescuedFriend==='object'?config.rescuedFriend:{};
    records.push({...friend,id:friend.id==null?'rescued-friend':friend.id,
      x:finite(friend.x,finite(config.enemyX,1120)-30),isRescuedFriend:true});
    const ids=new Set();
    for(const record of records){
      if(ids.has(record.id))throw new Error('Victory actor ids must be unique: '+record.id);
      ids.add(record.id);
    }
    const positions=records.map(record=>record.x);
    // Min/max midpoint minimizes the longest run. Limit it so the van still
    // has a distinct departure segment after pickup, even with zero survivors.
    const middleX=(Math.min(...positions)+Math.max(...positions))/2;
    const pickupX=clamp(finite(config.victoryPickupX,middleX-doorOffset),homeX,targetX-180);
    const pickupDoorX=pickupX+doorOffset;
    const approachStart=celebrateDuration;
    const approachDuration=Math.abs(pickupX-homeX)/vehicleSpeed;
    const approachEnd=approachStart+approachDuration;
    const actors=records.map((record,index)=>{
      const runStart=celebrateDuration;
      const runEnd=runStart+Math.abs(record.x-pickupDoorX)/runSpeed;
      const boardStart=Math.max(approachEnd,runEnd)+index*boardGap;
      const boardEnd=boardStart+boardDuration;
      return Object.freeze({record:Object.freeze({...record}),startX:record.x,
        runStart,runEnd,boardStart,boardEnd,
        runFacing:Math.sign(pickupDoorX-record.x)||(record.facing===-1?-1:1)});
    });
    const allBoardedAt=Math.max(...actors.map(actor=>actor.boardEnd));
    const departStart=allBoardedAt+readyDuration;
    const departDuration=Math.max(.9,positive(config.victoryTravelDuration,2.4),Math.abs(targetX-pickupX)/vehicleSpeed);
    return Object.freeze({victoryPlanVersion:1,homeX,targetX,pickupX,pickupDoorX,
      doorOffset,foldDuration,celebrateDuration,runSpeed,vehicleSpeed,boardDuration,
      boardGap,readyDuration,approachStart,approachEnd,approachDuration,
      allBoardedAt,departStart,departDuration,duration:departStart+departDuration,
      survivorCount:survivors.length,actors:Object.freeze(actors)});
  }

  function duration(config){return plan(config).duration;}

  function sample(elapsed,config){
    const route=plan(config);
    const time=elapsed===Infinity?route.duration:clamp(finite(elapsed,0),0,route.duration);
    const departProgress=progress(time,route.departStart,route.duration);
    const approachProgress=progress(time,route.approachStart,route.approachEnd);
    const vehicleX=time<route.departStart?
      mix(route.homeX,route.pickupX,approachProgress):mix(route.pickupX,route.targetX,departProgress);
    const phase=time<route.celebrateDuration?'celebrate':
      time<route.allBoardedAt?'boarding':time<route.departStart?'ready':
      time<route.duration?'depart':'won';
    const rescueProgress=progress(time,0,route.celebrateDuration);
    const actors=route.actors.map(actor=>{
      const boarded=time>=actor.boardEnd;
      const boardingProgress=boarded?1:progress(time,actor.boardStart,actor.boardEnd);
      const walking=time>=actor.runStart&&time<actor.runEnd;
      const victoryAction=boarded?'ride':time<actor.runStart?'celebrate':
        walking?'run':time>=actor.boardStart?'board':'wait';
      return {...actor.record,
        x:boarded?vehicleX+route.doorOffset:mix(actor.startX,route.pickupDoorX,progress(time,actor.runStart,actor.runEnd)),
        boarded,victoryAction,boardingProgress,
        facing:time<actor.runStart?(actor.record.facing===-1?-1:1):boarded?1:actor.runFacing,
        isRescuedFriend:actor.record.isRescuedFriend,
        rescueProgress:actor.record.isRescuedFriend?rescueProgress:1};
    });
    const boardedCount=actors.reduce((count,actor)=>count+Number(actor.boarded),0);
    return {elapsed:time,duration:route.duration,vehicleX,
      baseDeployment:1-progress(time,0,route.foldDuration),
      travelProgress:time/route.duration,phase,completed:phase==='won',actors,
      allBoarded:boardedCount===actors.length,boardedCount,actorCount:actors.length,
      doorX:vehicleX+route.doorOffset,pickupDoorX:route.pickupDoorX,pickupX:route.pickupX,
      departProgress,rescueProgress,vehicleAction:time<route.approachStart?'fold':
        time<route.approachEnd?'approach':time<route.departStart?'wait':phase==='won'?'arrived':'depart'};
  }

  return Object.freeze({version:'1.6.2',plan,duration,sample});
}));
