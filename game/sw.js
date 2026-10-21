/* Buildless, scope-isolated PWA. No game save is stored in this cache. */
'use strict';
const BUILD_ID='pwa-1.16.0';
const SCOPE=self.registration.scope;
const PREFIX='little-rescue-pwa:'+SCOPE+':';
const CACHE_NAME=PREFIX+BUILD_ID;
const LIFECYCLE_LOCK='little-rescue-pwa-lifecycle:'+SCOPE;
const PRECACHE=/* PRECACHE_START */[
  "./",
  "README-PWA-TH.txt",
  "animation-state.js",
  "app.js",
  "cloud-save.js",
  "wallet.js",
  "cloud.css",
  "shop.css",
  "shop.js",
  "friends.css",
  "friends.js",
  "live.css",
  "live.js",
  "assets/background-clean-left-v1.png",
  "assets/background.webp",
  "assets/base-deployed-large-v1.svg",
  "assets/base-deployed.svg",
  "assets/base-vehicle-large-v1.svg",
  "assets/base-vehicle.svg",
  "assets/cannon-support-v1.svg",
  "assets/enemies-v2/enemy-agile.webp",
  "assets/enemies-v2/enemy-guard.webp",
  "assets/enemies-v2/enemy-helper.webp",
  "assets/enemies-v2/enemy-mage.webp",
  "assets/enemies-v2/enemy-ranged.webp",
  "assets/fonts/Mali-Bold.ttf",
  "assets/fonts/Mali-Regular.ttf",
  "assets/fonts/Mali-SemiBold.ttf",
  "assets/fonts/OFL.txt",
  "assets/heroes-v2/hero-agile-sailom.webp",
  "assets/heroes-v2/hero-guard-fongsabo.webp",
  "assets/heroes-v2/hero-helper-puipan.webp",
  "assets/heroes-v2/hero-mage-lukoak.webp",
  "assets/heroes-v3/hero-agile-kangaroo.webp",
  "assets/heroes-v3/hero-guard-bison.webp",
  "assets/heroes-v3/hero-helper-wombat.webp",
  "assets/heroes-v3/hero-mage-lemur.webp",
  "assets/heroes-v3/hero-ranged-peacock.webp",
  "assets/heroes-v2/hero-ranged-maletdao.webp",
  "character-animation.js",
  "character-art.js",
  "character-roles.css",
  "character-vfx.js",
  "daily-missions.js",
  "hero-collection.js",
  "engine.js",
  "fit-screen.css",
  "icons/apple-touch-icon.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon.svg",
  "icons/maskable-512.png",
  "index.html",
  "install-card.js",
  "lobby.css",
  "summon.css",
  "summon.js",
  "lobby.js",
  "manifest.webmanifest",
  "mobile-layout.css",
  "play-ui.css",
  "pwa.css",
  "pwa.js",
  "recover-v164/",
  "recover-v164/index.html",
  "recover-v166/",
  "recover-v166/index.html",
  "recover-v170/",
  "recover-v170/index.html",
  "recover-v171/",
  "recover-v171/index.html",
  "recover-v172/",
  "recover-v172/index.html",
  "recover-v180/",
  "recover-v180/index.html",
  "recover-v190/",
  "recover-v190/index.html",
  "recover-v1120/",
  "recover-v1120/index.html",
  "recover-v1121/",
  "recover-v1121/index.html",
  "recover-v1122/",
  "recover-v1122/index.html",
  "recover-v1123/",
  "recover-v1123/index.html",
  "recover-v1124/",
  "recover-v1124/index.html",
  "recover-v1125/",
  "recover-v1125/index.html",
  "recover-v1130/",
  "recover-v1130/index.html",
  "recover-v1140/",
  "recover-v1140/index.html",
  "recover-v1141/",
  "recover-v1141/index.html",
  "recover-v1150/",
  "recover-v1150/index.html",
  "recover-v1160/",
  "recover-v1160/index.html",
  "recover-v191/",
  "recover-v191/index.html",
  "recover-v1110/",
  "recover-v1110/index.html",
  "recover-v1111/",
  "recover-v1111/index.html",
  "role-icons.css",
  "role-icons.js",
  "rotate-hint.js",
  "save-store.js",
  "save-transfer.js",
  "skills.css",
  "stages.css",
  "stats.js",
  "styles.css",
  "vehicle-preview.css",
  "victory-sequence.js"
]/* PRECACHE_END */;
// Cloudflare redirects /index.html to /. Fetch has decoded the body already;
// a synthetic same-origin Response removes redirect metadata that is illegal
// for a manual-redirect navigation response returned through respondWith().
async function safeNavigation(response){
 if(!response||!response.redirected)return response;
 const finalURL=new URL(response.url);
 if(!response.ok||finalURL.origin!==self.location.origin||!finalURL.href.startsWith(SCOPE))throw new TypeError('Unsafe redirected navigation response');
 const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');
 return new Response(await response.arrayBuffer(),{status:response.status,statusText:response.statusText,headers});
}
let activation=null,updateJob=false;
const scoped=client=>client.url.startsWith(SCOPE);
const windows=async()=> (await self.clients.matchAll({type:'window',includeUncontrolled:true})).filter(scoped);
const send=(client,message)=>{try{client.postMessage(message)}catch{}};
const ask=(client,message)=>new Promise(resolve=>{
 const channel=new MessageChannel();let ended=false;
 const finish=value=>{if(ended)return;ended=true;clearTimeout(timer);channel.port1.close();resolve(value)};
 const timer=setTimeout(()=>finish(null),3000);
 channel.port1.onmessage=event=>finish(event.data);
 try{client.postMessage(message,[channel.port2])}catch{finish(null)}
});
self.addEventListener('install',event=>event.waitUntil((async()=>{
 // addAll rejects if ANY required file fails. The previous complete cache stays.
 try{
  const cache=await caches.open(CACHE_NAME);
  await cache.addAll(PRECACHE.map(p=>new Request(new URL(p,SCOPE),{cache:'reload'})));
  // Finish normalization before install succeeds; any failure discards only
  // this incomplete new cache and leaves the current build untouched.
  for(const name of PRECACHE){
   const key=new URL(name,SCOPE),response=await cache.match(key);
   if(response?.redirected)await cache.put(key,await safeNavigation(response));
  }
 }
 catch(error){await caches.delete(CACHE_NAME);throw error}
 // Waiting is deliberate. Only an explicit, coordinated safe action may skip it.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 let problem=null;
 try{
   for(const name of await caches.keys())if(name.startsWith(PREFIX)&&name!==CACHE_NAME)await caches.delete(name);
   await self.clients.claim();
 }catch(error){problem=String(error?.message||'activation-failed')}
 finally{
   try{for(const client of await windows())send(client,{type:'ACTIVATION_DONE',buildId:BUILD_ID,nonce:activation?.nonce||null,error:problem})}
   finally{activation?.resolve()}
 }
})()));
self.addEventListener('fetch',event=>{
 const req=event.request,url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin||!url.href.startsWith(SCOPE))return;
 const relative=url.pathname.slice(new URL(SCOPE).pathname.length);
 // Serve a complete build consistently; never cache save files or arbitrary URLs.
 if(req.mode==='navigate'&&(relative===''||relative==='index.html')){
   event.respondWith(caches.open(CACHE_NAME).then(async cache=>safeNavigation((await cache.match(new URL('./',SCOPE)))||(await cache.match(new URL('index.html',SCOPE)))||await fetch(req))));return;
 }
 if(PRECACHE.includes(relative))event.respondWith(caches.open(CACHE_NAME).then(async cache=>safeNavigation((await cache.match(new URL(relative,SCOPE)))||await fetch(req))));
});
async function applyUpdate(event){
 const port=event.ports[0],nonce=event.data.nonce;
 const reply=value=>{try{port?.postMessage(value)}catch{}};
 if(updateJob||typeof nonce!=='string'||nonce.length===0||nonce.length>100){reply({ok:false,reason:'busy',blockedClients:[]});return}
 if(!self.navigator?.locks){reply({ok:false,reason:'locks-unavailable',blockedClients:[]});return}
 updateJob=true;let contacted=[],committed=false;
 try{
   const clients=await windows();contacted=clients;
   const results=await Promise.all(clients.map(async client=>({client,answer:await ask(client,{type:'PREPARE_UPDATE',nonce,buildId:BUILD_ID})})));
   const blocked=results.filter(r=>r.answer?.nonce!==nonce||r.answer?.safe!==true).map(r=>r.client.id);
   if(blocked.length){reply({ok:false,reason:'active-or-unresponsive',blockedClients:blocked});return}
   await self.navigator.locks.request(LIFECYCLE_LOCK,{mode:'exclusive',ifAvailable:true},async lock=>{
     if(!lock){reply({ok:false,reason:'another-window',blockedClients:[]});return}
     const latest=await windows();
     const ids=clients.map(c=>c.id).sort().join(','),nowIds=latest.map(c=>c.id).sort().join(',');
     if(ids!==nowIds){reply({ok:false,reason:'windows-changed',blockedClients:latest.map(c=>c.id)});return}
     let done;const completed=new Promise(resolve=>{done=resolve});
     activation={nonce,resolve:done};committed=true;
     // Keep the exclusive lease THROUGH activation, not merely flag-setting.
     // No timeout releases this lease after skipWaiting has been requested.
     await self.skipWaiting();reply({ok:true,buildId:BUILD_ID});
     await completed;
   });
 }catch{reply({ok:false,reason:'update-failed',blockedClients:[]})}
 finally{
   // A delayed ACK can time out AFTER its client froze. Abort every contact;
   // each client matches the nonce before thawing, so late replies are harmless.
   if(!committed)for(const client of contacted)send(client,{type:'ABORT_UPDATE',nonce});
   updateJob=false;
 }
}
self.addEventListener('message',event=>{
 if(event.data?.type==='GET_STATUS')event.ports[0]?.postMessage({buildId:BUILD_ID,cacheName:CACHE_NAME});
 if(event.data?.type==='APPLY_UPDATE')event.waitUntil(applyUpdate(event));
});
