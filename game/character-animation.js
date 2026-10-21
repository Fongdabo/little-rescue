/* Little Rescue 1.6: continuous textured-mesh character rigs.
 * Existing image files are read only. Legacy stickers and approved side-view
 * sibling artwork share one continuous mesh; no body-part image cutouts.
 * Each rig pre-renders its poses once; draw() uses ONE cached drawImage.
 * x/y = original sprite FOOT centre. width/height describe its unpadded box.
 * progress is normalized state progress. Omit it for time-driven idle/walk.
 * Reduced motion selects one distinct static pose per state, without cycling.
 */
(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SideviewAnimation=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const VERSION='1.6.0',TAU=Math.PI*2,COLS=20,ROWS=18,CORE=152,PAD=22;
  const COUNTS={idle:6,walk:8,attack:7,hit:4,defeat:6};
  const stats={version:VERSION,rigs:0,cacheFrames:0,cacheBytes:0,meshTriangles:COLS*ROWS*2,
    cacheBuildMs:0,drawCalls:0,cacheHits:0,runtimeMeshDraws:0,sourceImagesEdited:0,rigMetrics:[]};
  const pool=new WeakMap();
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
  const finite=(n,fallback)=>Number.isFinite(n)?n:fallback;
  const clock=()=>typeof performance!=='undefined'?performance.now():Date.now();
  const point=(x,y,rx,ry)=>({x,y,rx,ry});
  // Normalized landmarks were selected by inspecting all six actual PNGs.
  const LANDMARKS={
    'sugar-01':{head:point(.535,.355,.27,.235),earL:point(.378,.13,.10,.15),earR:point(.79,.30,.12,.12),torso:point(.51,.735,.22,.23),armL:point(.285,.355,.12,.18),armR:point(.685,.742,.14,.17),footL:point(.39,.925,.115,.095),footR:point(.645,.914,.115,.095),tail:point(.235,.687,.16,.24),chest:point(.51,.66,.18,.18)},
    'sugar-02':{head:point(.53,.335,.27,.23),earL:point(.267,.21,.12,.15),earR:point(.68,.115,.11,.15),torso:point(.535,.76,.22,.23),armL:point(.485,.66,.16,.15),armR:point(.655,.635,.14,.17),footL:point(.45,.935,.115,.09),footR:point(.655,.925,.115,.09),tail:point(.28,.72,.17,.24),chest:point(.67,.52,.16,.23)},
    'sugar-05':{head:point(.55,.342,.27,.23),earL:point(.35,.13,.105,.14),earR:point(.785,.245,.12,.13),torso:point(.52,.742,.22,.23),armL:point(.255,.385,.13,.18),armR:point(.685,.705,.135,.17),footL:point(.44,.925,.115,.09),footR:point(.66,.917,.115,.09),tail:point(.25,.72,.17,.24),chest:point(.52,.64,.18,.19)},
    'sugar-07':{head:point(.54,.28,.26,.22),earL:point(.365,.11,.11,.14),earR:point(.79,.205,.12,.13),torso:point(.56,.775,.25,.19),armL:point(.23,.515,.12,.15),armR:point(.555,.62,.15,.15),footL:point(.42,.865,.12,.09),footR:point(.65,.805,.12,.10),tail:point(.41,.89,.29,.13),chest:point(.425,.585,.25,.245)},
    'sugar-08':{head:point(.53,.34,.27,.23),earL:point(.365,.125,.105,.15),earR:point(.78,.27,.12,.13),torso:point(.50,.715,.22,.23),armL:point(.255,.325,.12,.18),armR:point(.795,.43,.12,.18),footL:point(.475,.93,.12,.10),footR:point(.70,.78,.12,.10),tail:point(.26,.66,.17,.25),chest:point(.51,.63,.18,.18)},
    mushroom:{head:point(.535,.49,.255,.22),earL:point(.245,.325,.18,.16),earR:point(.765,.285,.18,.16),torso:point(.515,.755,.235,.21),armL:point(.335,.755,.12,.17),armR:point(.725,.595,.14,.21),footL:point(.435,.9,.13,.105),footR:point(.665,.895,.13,.105),tail:point(.49,.22,.32,.22),chest:point(.515,.745,.13,.17)}
  };
  // Profiles describe canonical RIGHT-facing, tightly cropped artwork. A source
  // facing left mirrors these landmarks and the local pose vectors together.
  // Ear/limb names stay anatomical so a single final draw mirror is sufficient.
  const none=()=>point(-4,-4,.01,.01);
  const PROFILES={
    'guard-glider':{anchors:{head:point(.665,.355,.255,.24),earL:point(.49,.145,.115,.17),earR:point(.80,.18,.10,.14),torso:point(.53,.745,.225,.23),armL:point(.575,.66,.16,.115),armR:point(.73,.685,.17,.14),footL:point(.345,.95,.13,.075),footR:point(.715,.95,.13,.075),tail:point(.16,.70,.18,.24),chest:point(.66,.575,.19,.13)},attachments:{muzzle:point(.97,.66),weaponTip:point(.99,.64),paw:point(.68,.685)}} ,
    'agile-fennec':{anchors:{head:point(.787,.487,.23,.19),earL:point(.534,.236,.22,.26),earR:point(.892,.24,.115,.18),torso:point(.566,.817,.23,.15),armL:point(.639,.708,.14,.12),armR:point(.865,.749,.14,.13),footL:point(.303,.96,.14,.075),footR:point(.782,.968,.14,.075),tail:point(.20,.65,.23,.28),chest:point(.75,.665,.19,.13)},attachments:{muzzle:point(.90,.74),weaponTip:point(.96,.77),paw:point(.865,.749)}} ,
    'ranged-owl':{anchors:{head:point(.435,.31,.29,.27),earL:point(.25,.09,.14,.15),earR:point(.65,.14,.11,.14),torso:point(.392,.724,.27,.22),armL:point(.472,.654,.21,.17),armR:point(.751,.699,.16,.14),footL:point(.216,.955,.15,.075),footR:point(.581,.955,.15,.075),tail:point(.132,.785,.18,.19),chest:point(.512,.542,.23,.13)},attachments:{muzzle:point(.985,.532),weaponTip:point(.985,.532),paw:point(.751,.699)}} ,
    'helper-bao':{anchors:{head:point(.367,.339,.31,.32),earL:none(),earR:none(),torso:point(.453,.832,.25,.17),armL:point(.499,.68,.16,.13),armR:point(.609,.68,.17,.14),footL:point(.18,.95,.14,.075),footR:point(.547,.95,.14,.075),tail:point(.129,.773,.16,.18),chest:point(.45,.80,.20,.16)},attachments:{muzzle:point(.826,.412),weaponTip:point(.826,.412),paw:point(.609,.68)}} ,
    'mage-redpanda':{anchors:{head:point(.538,.344,.24,.25),earL:point(.45,.205,.12,.16),earR:point(.627,.159,.10,.12),torso:point(.452,.752,.26,.22),armL:point(.548,.757,.17,.13),armR:point(.793,.554,.14,.17),footL:point(.321,.957,.14,.075),footR:point(.686,.957,.14,.075),tail:point(.135,.70,.20,.29),chest:point(.504,.581,.22,.16)},attachments:{muzzle:point(.891,.181),weaponTip:point(.918,.052),paw:point(.793,.554)}}
  };
  // Mushroom class equipment/hat landmarks were inspected separately in each
  // approved LEFT-facing PNG, then expressed in canonical RIGHT coordinates.
  PROFILES['enemy-guard']={anchors:{head:point(.515,.405,.255,.235),earL:point(.245,.245,.19,.16),earR:point(.75,.24,.19,.15),torso:point(.418,.779,.255,.19),armL:point(.33,.64,.17,.16),armR:point(.52,.689,.25,.21),footL:point(.123,.953,.16,.075),footR:point(.631,.951,.16,.075),tail:point(.113,.718,.16,.18),chest:point(.52,.60,.17,.18)},attachments:{muzzle:point(.97,.66),weaponTip:point(.97,.66),paw:point(.52,.689)}};
  PROFILES['enemy-agile']={anchors:{head:point(.651,.468,.25,.20),earL:point(.48,.19,.18,.24),earR:point(.74,.34,.22,.14),torso:point(.549,.761,.23,.19),armL:point(.406,.701,.14,.14),armR:point(.845,.649,.16,.15),footL:point(.202,.923,.16,.09),footR:point(.803,.938,.16,.09),tail:point(.191,.525,.22,.16),chest:point(.539,.619,.21,.15)},attachments:{muzzle:point(.95,.65),weaponTip:point(.95,.65),paw:point(.845,.649)}};
  PROFILES['enemy-ranged']={anchors:{head:point(.452,.458,.25,.20),earL:point(.28,.24,.25,.19),earR:point(.66,.30,.18,.13),torso:point(.387,.79,.27,.19),armL:point(.488,.66,.19,.15),armR:point(.676,.67,.22,.17),footL:point(.128,.955,.16,.075),footR:point(.635,.95,.16,.075),tail:point(.15,.76,.18,.20),chest:point(.41,.68,.21,.17)},attachments:{muzzle:point(.985,.54),weaponTip:point(.985,.54),paw:point(.676,.67)}};
  PROFILES['enemy-helper']={anchors:{head:point(.443,.416,.27,.225),earL:point(.18,.35,.19,.17),earR:point(.61,.22,.21,.17),torso:point(.423,.761,.255,.21),armL:point(.349,.740,.17,.15),armR:point(.70,.609,.16,.19),footL:point(.22,.95,.16,.08),footR:point(.615,.934,.16,.08),tail:point(.10,.74,.18,.21),chest:point(.50,.72,.21,.19)},attachments:{muzzle:point(.815,.315),weaponTip:point(.828,.044),paw:point(.70,.609)}};
  PROFILES['enemy-mage']={anchors:{head:point(.421,.495,.25,.19),earL:point(.10,.18,.15,.16),earR:point(.58,.29,.25,.19),torso:point(.367,.803,.26,.20),armL:point(.159,.778,.17,.16),armR:point(.662,.617,.16,.20),footL:point(.164,.956,.16,.075),footR:point(.573,.956,.16,.075),tail:point(.08,.842,.18,.20),chest:point(.459,.671,.21,.17)},attachments:{muzzle:point(.828,.286),weaponTip:point(.874,.13),paw:point(.662,.617)}};
  const mirrorPoint=(p,direction)=>({...p,x:direction===-1?1-p.x:p.x});
  function sourceBounds(options,sw,sh){
    const b=options.sourceBounds;
    if(!b)return{x:0,y:0,width:sw,height:sh};
    const x=clamp(Math.round(finite(b.x,0)),0,sw-1),y=clamp(Math.round(finite(b.y,0)),0,sh-1);
    return{x,y,width:clamp(Math.round(finite(b.width,sw-x)),1,sw-x),height:clamp(Math.round(finite(b.height,sh-y)),1,sh-y)};
  }
  function canvas(w,h){
    let result;
    if(typeof OffscreenCanvas!=='undefined')result=new OffscreenCanvas(w,h);
    else if(typeof document!=='undefined')result=document.createElement('canvas');
    else throw new Error('SideviewAnimation.createRig requires Canvas 2D in a browser.');
    result.width=w;result.height=h;return result;
  }
  function identity(id,role,index){
    const raw=String(id||'').toLowerCase();
    if(raw.includes('mushroom')||role==='mushroom'||role==='enemy')return'mushroom';
    const match=raw.match(/sugar[-_]?0?(1|2|5|7|8)(?:\D|$)/);
    if(match)return'sugar-'+String(match[1]).padStart(2,'0');
    return ['sugar-01','sugar-02','sugar-05','sugar-07','sugar-08'][index]||'sugar-01';
  }
  function influence(x,y,p){
    const d=((x-p.x)/p.rx)**2+((y-p.y)/p.ry)**2;
    return Math.exp(-d*1.8);
  }
  function pose(phase,p,blocking,rig){
    const s=Math.sin(TAU*p),c=Math.cos(TAU*p),pulse=Math.sin(Math.PI*p);
    const q={head:0,headX:0,headY:0,ears:0,torsoX:0,torsoY:0,breath:0,
      armLX:0,armLY:0,armRX:0,armRY:0,footLX:0,footLY:0,footRX:0,footRY:0,tail:0,chest:0,glow:0,lean:0};
    if(phase==='idle')Object.assign(q,{head:s*.024,headY:-s*.008,ears:s*.085,breath:s*.012,
      armLX:s*.006,armLY:s*.008,armRX:-s*.005,armRY:-s*.007,tail:s*.075,chest:s*.009});
    else if(phase==='walk')Object.assign(q,{head:s*.045,headY:-Math.abs(s)*.014,ears:c*.11,
      torsoX:s*.011,torsoY:-Math.abs(s)*.009,breath:Math.abs(s)*.008,
      armLX:-s*.03,armLY:c*.014,armRX:s*.032,armRY:-c*.015,
      footLX:s*.045,footLY:-Math.max(0,c)*.035,footRX:-s*.045,footRY:-Math.max(0,-c)*.035,
      tail:s*.16,chest:s*.014});
    else if(phase==='attack'){
      // Wind-up, a clear paw extension, then recovery: the face is not repainted.
      const strike=Math.sin(Math.PI*clamp((p-.08)/.84)),wind=Math.sin(Math.PI*p);
      Object.assign(q,{head:-strike*.10,headX:strike*.016,headY:-strike*.018,ears:-strike*.15,
        torsoX:strike*.028,breath:strike*.012,lean:strike*.028,
        armLX:-wind*.018,armLY:-wind*.035,armRX:strike*.105,armRY:-strike*.10,
        footLX:-strike*.013,footRX:strike*.014,tail:-strike*.13,chest:wind*.032,glow:strike});
    }else if(phase==='hit'){
      const flinch=Math.sin(Math.PI*(.16+.84*p));
      Object.assign(q,{head:flinch*.145,headX:-flinch*.025,headY:flinch*.019,ears:flinch*.20,
        torsoX:-flinch*.025,breath:-flinch*.025,armLX:-flinch*.025,armLY:flinch*.036,
        armRX:-flinch*.038,armRY:flinch*.04,footLX:-flinch*.012,footRX:flinch*.008,
        tail:flinch*.16,chest:-flinch*.025});
    }else if(phase==='defeat'){
      const fall=.24+.76*(1-(1-p)**2);
      Object.assign(q,{head:fall*.21,headX:fall*.019,headY:fall*.095,ears:fall*.28,
        torsoY:fall*.065,breath:-fall*.035,armLX:-fall*.046,armLY:fall*.065,
        armRX:-fall*.055,armRY:fall*.075,footLX:-fall*.018,footRX:fall*.018,
        tail:fall*.23,chest:-fall*.045});
    }
    if(blocking){q.armRX+=.045;q.armRY-=.085;q.headX-=.012;q.head+=.025;q.torsoX-=.009;}
    if(rig.profile){
      // Side-view equipment is already painted into the continuous source.
      // Modest limb travel keeps staff/launcher shapes intact through the mesh.
      for(const key of ['armLX','armLY','armRX','armRY'])q[key]*=.60;
      q.head*=.65;q.ears*=.75;
    }
    if(rig.sourceFacing===-1)for(const key of ['head','headX','ears','torsoX','armLX','armRX','footLX','footRX','tail','lean'])q[key]*=-1;
    return q;
  }
  function deform(x,y,rig,q){
    const a=rig.anchors;
    let dx=0,dy=0;
    const move=(name,mx,my)=>{const w=influence(x,y,a[name]);dx+=mx*w;dy+=my*w;};
    const turn=(name,angle,pivotX,pivotY)=>{
      const w=influence(x,y,a[name]),rx=x-pivotX,ry=y-pivotY;
      dx+=((Math.cos(angle)*rx-Math.sin(angle)*ry)-rx)*w;
      dy+=((Math.sin(angle)*rx+Math.cos(angle)*ry)-ry)*w;
    };
    move('head',q.headX,q.headY);turn('head',q.head,a.head.x,a.head.y+.12);
    turn('earL',q.ears,a.earL.x,a.earL.y+.1);turn('earR',-q.ears,a.earR.x,a.earR.y+.09);
    move('torso',q.torsoX,q.torsoY);const torso=influence(x,y,a.torso);
    dx+=(x-a.torso.x)*q.breath*torso;dy-=(y-a.torso.y)*q.breath*.35*torso;
    move('armL',q.armLX,q.armLY);move('armR',q.armRX,q.armRY);
    move('footL',q.footLX,q.footLY);move('footR',q.footRX,q.footRY);
    turn('tail',q.tail,a.tail.x+.08,a.tail.y+.15);
    // The healer's existing heart, flower and neck scarf follow arm/chest motion.
    move('chest',q.chest*.22*rig.sourceFacing,-q.chest*.55);
    dx+=q.lean*influence(x,y,a.torso)*(a.torso.y-y);
    return {x:(x+dx)*rig.coreWidth+PAD,y:(y+dy)*rig.coreHeight+PAD};
  }
  function triangle(ctx,texture,s0,s1,s2,d0,d1,d2){
    const det=s0.x*(s1.y-s2.y)+s1.x*(s2.y-s0.y)+s2.x*(s0.y-s1.y);
    if(Math.abs(det)<1e-8)return;
    const a=(d0.x*(s1.y-s2.y)+d1.x*(s2.y-s0.y)+d2.x*(s0.y-s1.y))/det;
    const b=(d0.y*(s1.y-s2.y)+d1.y*(s2.y-s0.y)+d2.y*(s0.y-s1.y))/det;
    const c=(d0.x*(s2.x-s1.x)+d1.x*(s0.x-s2.x)+d2.x*(s1.x-s0.x))/det;
    const d=(d0.y*(s2.x-s1.x)+d1.y*(s0.x-s2.x)+d2.y*(s1.x-s0.x))/det;
    const e=(d0.x*(s1.x*s2.y-s2.x*s1.y)+d1.x*(s2.x*s0.y-s0.x*s2.y)+d2.x*(s0.x*s1.y-s1.x*s0.y))/det;
    const f=(d0.y*(s1.x*s2.y-s2.x*s1.y)+d1.y*(s2.x*s0.y-s0.x*s2.y)+d2.y*(s0.x*s1.y-s1.x*s0.y))/det;
    // Slightly overlap raster clip edges. The source remains one continuous mesh;
    // no independently extracted limb can reveal a hole or a duplicate silhouette.
    const centre={x:(d0.x+d1.x+d2.x)/3,y:(d0.y+d1.y+d2.y)/3};
    const expand=p=>{const dx=p.x-centre.x,dy=p.y-centre.y,n=Math.hypot(dx,dy)||1;return{x:p.x+dx/n*.65,y:p.y+dy/n*.65}};
    const v0=expand(d0),v1=expand(d1),v2=expand(d2);
    ctx.save();ctx.beginPath();ctx.moveTo(v0.x,v0.y);ctx.lineTo(v1.x,v1.y);ctx.lineTo(v2.x,v2.y);ctx.closePath();ctx.clip();
    ctx.setTransform(a,b,c,d,e,f);ctx.drawImage(texture,0,0);ctx.restore();
  }
  function body(ctx,rig,q,neutral){
    if(neutral){ctx.drawImage(rig.texture,PAD,PAD);return 0;}
    const vertices=[],sources=[];let maxDisplacement=0;
    for(let row=0;row<=ROWS;row++)for(let col=0;col<=COLS;col++){
      const x=col/COLS,y=row/ROWS,p=deform(x,y,rig,q);
      vertices.push(p);sources.push({x:x*rig.coreWidth,y:y*rig.coreHeight});
      maxDisplacement=Math.max(maxDisplacement,Math.hypot(p.x-(x*rig.coreWidth+PAD),p.y-(y*rig.coreHeight+PAD)));
    }
    for(let row=0;row<ROWS;row++)for(let col=0;col<COLS;col++){
      const i=row*(COLS+1)+col,j=i+COLS+1;
      triangle(ctx,rig.texture,sources[i],sources[i+1],sources[j],vertices[i],vertices[i+1],vertices[j]);
      triangle(ctx,rig.texture,sources[j],sources[i+1],sources[j+1],vertices[j],vertices[i+1],vertices[j+1]);
    }
    return maxDisplacement;
  }
  function accessories(ctx,rig,q,blocking){
    if(rig.embeddedEquipment||rig.role!=='guard'&&rig.role!=='ranger')return;
    const hand=deform(rig.anchors.armR.x,rig.anchors.armR.y,rig,q);
    ctx.save();ctx.translate(hand.x,hand.y);ctx.rotate(q.armRY*.8-q.armRX*.6);
    if(rig.role==='guard'){
      ctx.translate(4,-2);ctx.scale(rig.coreWidth/152,rig.coreHeight/132);
      ctx.strokeStyle='#76563c';ctx.fillStyle='#cfb27a';ctx.lineWidth=2.2;ctx.lineJoin='round';
      ctx.beginPath();ctx.moveTo(-12,-19);ctx.quadraticCurveTo(0,-25,13,-19);ctx.lineTo(12,1);ctx.quadraticCurveTo(10,11,0,17);ctx.quadraticCurveTo(-11,10,-13,0);ctx.closePath();ctx.fill();ctx.stroke();
      ctx.strokeStyle='#f5e8b8';ctx.lineWidth=1.2;ctx.beginPath();ctx.moveTo(-8,-16);ctx.lineTo(-8,0);ctx.quadraticCurveTo(-6,8,0,12);ctx.stroke();
      ctx.fillStyle=blocking?'#bfe2b5':'#7caa76';ctx.strokeStyle='#557b50';ctx.lineWidth=1;
      ctx.beginPath();ctx.ellipse(0,-5,4.5,8,-.45,0,TAU);ctx.fill();ctx.stroke();
      if(blocking){ctx.strokeStyle='#d8ead0';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-3,22,-1.2,1.2);ctx.stroke();}
    }else{
      ctx.translate(3,-2);ctx.scale(rig.coreWidth/152,rig.coreHeight/132);
      ctx.strokeStyle='#795c42';ctx.lineWidth=1.6;ctx.fillStyle='#d6b983';
      ctx.beginPath();ctx.roundRect(-8,-5,19,10,4);ctx.fill();ctx.stroke();
      ctx.fillStyle='#91c8be';ctx.beginPath();ctx.ellipse(11,0,3.4,4,0,0,TAU);ctx.fill();ctx.stroke();
      ctx.strokeStyle='#647b52';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-1,-5);ctx.lineTo(-1,5);ctx.stroke();
      if(q.glow>.05){ctx.globalAlpha=.35+q.glow*.45;ctx.fillStyle='#f7e5a3';ctx.beginPath();ctx.ellipse(16,0,3+q.glow*4,3+q.glow*3,0,0,TAU);ctx.fill();}
    }
    ctx.restore();
  }
  function fingerprint(data){let hash=2166136261;for(let i=0;i<data.length;i++){hash^=data[i];hash=Math.imul(hash,16777619);}return(hash>>>0).toString(16).padStart(8,'0');}
  function pixelDifference(a,b){let changed=0;for(let i=0;i<a.length;i+=4)if(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2])+Math.abs(a[i+3]-b[i+3])>12)changed++;return changed;}
  function createRig(image,options={}){
    if(!image||typeof image!=='object')throw new TypeError('A loaded source image is required.');
    const sw=image.naturalWidth||image.width,sh=image.naturalHeight||image.height;
    if(!sw||!sh)throw new Error('The source image must finish loading before createRig.');
    const profile=Object.hasOwn(PROFILES,options.profile)?options.profile:null;
    const id=profile?String(options.id||profile):identity(options.id,options.role,options.index);
    const inferred=id==='mushroom'?'mushroom':({0:'guard',1:'scout',2:'ranger',3:'healer',4:'burst'}[options.index]||{'sugar-01':'guard','sugar-05':'ranger','sugar-07':'healer'}[id]||'scout');
    const role=String(options.role||inferred),sourceFacing=options.sourceFacing===-1?-1:1;
    const bounds=sourceBounds(options,sw,sh),embeddedEquipment=options.embeddedEquipment===undefined?Boolean(profile):Boolean(options.embeddedEquipment);
    const key=JSON.stringify({id,role,profile,sourceFacing,embeddedEquipment,bounds});
    let cached=pool.get(image);if(cached?.has(key))return cached.get(key);
    const start=clock(),scale=CORE/(profile?Math.max(bounds.width,bounds.height):bounds.width);
    const coreWidth=Math.max(1,Math.round(bounds.width*scale)),coreHeight=Math.max(1,Math.round(bounds.height*scale));
    const texture=canvas(coreWidth,coreHeight),tc=texture.getContext('2d',{willReadFrequently:true});
    tc.drawImage(image,bounds.x,bounds.y,bounds.width,bounds.height,0,0,coreWidth,coreHeight);
    const landmarks=profile?PROFILES[profile].anchors:LANDMARKS[id];
    const anchors=Object.fromEntries(Object.entries(landmarks).map(([name,p])=>[name,mirrorPoint(p,sourceFacing)]));
    const rawAttachments=profile?PROFILES[profile].attachments:{muzzle:point(landmarks.armR.x+.15,landmarks.armR.y),weaponTip:point(landmarks.armR.x+.15,landmarks.armR.y),paw:landmarks.armR};
    const attachmentAnchors=Object.fromEntries(Object.entries(rawAttachments).map(([name,p])=>[name,mirrorPoint(p,sourceFacing)]));
    const rig={id,role,profile,sourceFacing,embeddedEquipment,index:options.index,sourceWidth:sw,sourceHeight:sh,sourceBounds:bounds,aspect:bounds.width/bounds.height,
      coreWidth,coreHeight,width:coreWidth+PAD*2,height:coreHeight+PAD*2,padding:PAD,
      anchors,attachmentAnchors,texture,frames:{},attachments:{},metrics:null};
    const metrics={id,role,sourceWidth:sw,sourceHeight:sh,cacheWidth:rig.width,cacheHeight:rig.height,
      profile,sourceFacing,sourceBounds:bounds,embeddedEquipment,
      frameCount:0,cacheBytes:0,trianglesPerWarpedFrame:COLS*ROWS*2,buildMs:0,
      restVertexDisplacement:0,restBodyIsExactSourceBlit:true,sourceFileModified:false,pixelReadback:true,phases:{}};
    let restPixels=null;
    for(const blocking of(role==='guard'||profile==='enemy-guard'?[false,true]:[false]))for(const phase of Object.keys(COUNTS)){
      const name=phase+(blocking?':blocking':''),frames=[],attachments=[],signatures=new Set();let minPixels=Infinity,maxPixels=0,maxMove=0;
      for(let i=0;i<COUNTS[phase];i++){
        const p=(phase==='idle'||phase==='walk')?i/COUNTS[phase]:i/(COUNTS[phase]-1);
        const frame=canvas(rig.width,rig.height),ctx=frame.getContext('2d',{willReadFrequently:true});
        const q=pose(phase,p,blocking,rig);
        const neutral=phase==='idle'&&i===0&&!blocking;
        maxMove=Math.max(maxMove,body(ctx,rig,q,neutral));accessories(ctx,rig,q,blocking);
        try{
          const pixels=ctx.getImageData(0,0,rig.width,rig.height).data;
          if(!restPixels)restPixels=pixels;
          const changed=pixelDifference(restPixels,pixels);minPixels=Math.min(minPixels,changed);maxPixels=Math.max(maxPixels,changed);
          signatures.add(fingerprint(pixels));
        }catch{metrics.pixelReadback=false;}
        frames.push(frame);attachments.push(Object.fromEntries(Object.entries(attachmentAnchors).map(([name,a])=>[name,deform(a.x,a.y,rig,q)])));
        metrics.frameCount++;metrics.cacheBytes+=rig.width*rig.height*4;
      }
      rig.frames[name]=frames;rig.attachments[name]=attachments;metrics.phases[name]={frames:frames.length,uniqueRasterFrames:metrics.pixelReadback?signatures.size:null,
        changedPixelsVsRestMin:metrics.pixelReadback?minPixels:null,changedPixelsVsRestMax:metrics.pixelReadback?maxPixels:null,
        maxVertexDisplacementPx:Math.round(maxMove*1000)/1000};
    }
    metrics.buildMs=Math.round((clock()-start)*100)/100;rig.metrics=metrics;
    if(!cached){cached=new Map();pool.set(image,cached);}cached.set(key,rig);
    stats.rigs++;stats.cacheFrames+=metrics.frameCount;stats.cacheBytes+=metrics.cacheBytes;stats.cacheBuildMs+=metrics.buildMs;stats.rigMetrics.push(metrics);
    return rig;
  }
  function sample(rig,options){
    const phase=Object.hasOwn(COUNTS,options.phase)?options.phase:'idle';
    const blocking=Boolean(options.blocking)&&(rig.role==='guard'||rig.profile==='enemy-guard');
    const name=phase+(blocking?':blocking':''),frames=rig.frames[name];
    const loop=phase==='idle'||phase==='walk';
    const seed=finite(options.seed,0),time=finite(options.time,0);
    let p=Number.isFinite(options.progress)?clamp(options.progress):loop?((time*(phase==='walk'?1.65:.42)+seed*.173)%1+1)%1:.55;
    let index;
    if(options.reduced)index=phase==='idle'?0:phase==='walk'?2:phase==='defeat'?frames.length-1:Math.floor(frames.length/2);
    else index=loop?Math.min(frames.length-1,Math.floor((p===1?0:p)*frames.length)):Math.round(p*(frames.length-1));
    return{name,frames,index};
  }
  function placement(rig,options){
    const width=Math.max(1,finite(options.width,123)),height=Math.max(1,finite(options.height,width/rig.aspect));
    const sx=width/rig.coreWidth,sy=height/rig.coreHeight;
    const facing=options.facing===-1?-1:1,mirror=facing===rig.sourceFacing?1:-1;
    return{width,height,sx,sy,mirror,x:finite(options.x,0),y:finite(options.y,0)};
  }
  function draw(ctx,rig,options={}){
    if(!ctx||!rig?.frames)return false;
    const {frames,index}=sample(rig,options),{width,height,sx,sy,mirror,x,y}=placement(rig,options);
    ctx.save();ctx.translate(x,y);
    if(mirror===-1)ctx.scale(-1,1);
    ctx.drawImage(frames[index],-width/2-PAD*sx,-height-PAD*sy,rig.width*sx,rig.height*sy);ctx.restore();
    stats.drawCalls++;stats.cacheHits++;return true;
  }
  function getAttachment(rig,options={},name='muzzle'){
    if(!rig?.attachments)return null;
    const {name:state,index}=sample(rig,options),p=rig.attachments[state]?.[index]?.[name];
    if(!p)return null;
    const {width,height,sx,sy,mirror,x,y}=placement(rig,options);
    return{x:x+mirror*(-width/2+(p.x-PAD)*sx),y:y-height+(p.y-PAD)*sy};
  }
  return{version:VERSION,createRig,draw,getAttachment,profiles:Object.keys(PROFILES),stats,getStats:()=>JSON.parse(JSON.stringify(stats))};
});
