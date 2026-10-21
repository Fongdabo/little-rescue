/* Original five-class SVG icons. 32-unit grid, warm brown rounded 2-unit outlines.
 * Browser: SideviewRoleIcons; Node: require('./role-icons.js').
 * get(classId or legacy kind) -> frozen {classId,kind,label,labelEn,svg,dataURL} or null.
 * preload() -> Promise<images[]>; call before synchronous canvas draw().
 * draw(ctx,id,x,y,size) -> true if drawn, false if unknown/loading/unavailable.
 * No emoji, fonts, external assets, combat state or side-specific mirroring.
 */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.SideviewRoleIcons=factory();}(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const definitions=[
  {
    "classId": "guard",
    "kind": "guard",
    "label": "รับ",
    "labelEn": "Guard",
    "accent": "#edb17c",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\" role=\"img\" aria-label=\"Guard\"><title>Guard</title><g stroke=\"#68482f\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path fill=\"#edb17c\" d=\"M16 3 26 7v9c0 6-4 10-10 13C10 26 6 22 6 16V7Z\"/><path fill=\"#fff6df\" d=\"M16 3v26C10 26 6 22 6 16V7Z\"/><path d=\"m11 15 4 4 7-8\" fill=\"none\"/><path stroke=\"#fffdf2\" fill=\"none\" d=\"m10 9 3-1\"/></g></svg>"
  },
  {
    "classId": "agile",
    "kind": "scout",
    "label": "ว่องไว",
    "labelEn": "Agile",
    "accent": "#8bc9bc",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\" role=\"img\" aria-label=\"Agile\"><title>Agile</title><g stroke=\"#68482f\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path fill=\"#8bc9bc\" d=\"M14 5h8v12l5 5c1 1 1 4-1 5H10c-3 0-4-2-3-5l7-7Z\"/><path fill=\"#fff6df\" d=\"M14 15C9 7 4 8 3 9c1 5 4 9 11 10l3-3Z\"/><path d=\"m7 12 7 4M11 23h7\" fill=\"none\"/><path stroke=\"#fffdf2\" fill=\"none\" d=\"M18 8v4\"/></g></svg>"
  },
  {
    "classId": "ranged",
    "kind": "ranger",
    "label": "ยิงไกล",
    "labelEn": "Ranged",
    "accent": "#eac16a",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\" role=\"img\" aria-label=\"Ranged\"><title>Ranged</title><g stroke=\"#68482f\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path fill=\"#eac16a\" d=\"M10 4c17 5 17 19 0 24l5-12Z\"/><path d=\"m10 4 5 12-5 12M3 16h26m-5-5 5 5-5 5\" fill=\"none\"/><path stroke=\"#fffdf2\" fill=\"none\" d=\"m17 8 3 3\"/></g></svg>"
  },
  {
    "classId": "helper",
    "kind": "healer",
    "label": "ช่วยเหลือ",
    "labelEn": "Helper",
    "accent": "#edb0bf",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\" role=\"img\" aria-label=\"Helper\"><title>Helper</title><g stroke=\"#68482f\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path fill=\"#9ac89e\" d=\"M16 21v8c6 0 10-3 10-7-4-1-7 0-10 4\"/><path fill=\"#edb0bf\" d=\"M16 5c5-6 11 0 8 5 7 1 7 9 1 11 0 7-8 9-11 3-6 4-12-2-8-7C0 12 5 5 11 8c0-2 2-4 5-3Z\"/><path fill=\"#fff6df\" d=\"M16 13c-5-5-9 2 0 8 9-6 5-13 0-8Z\"/><path stroke=\"#fffdf2\" fill=\"none\" d=\"m7 12 1-1\"/></g></svg>"
  },
  {
    "classId": "mage",
    "kind": "burst",
    "label": "เวท",
    "labelEn": "Mage",
    "accent": "#b6b0dc",
    "svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"32\" height=\"32\" viewBox=\"0 0 32 32\" role=\"img\" aria-label=\"Mage\"><title>Mage</title><g stroke=\"#68482f\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"m6 28 15-16\" fill=\"none\" stroke-width=\"4\"/><path fill=\"#b6b0dc\" d=\"m22 3 3 6 6 1-5 5 1 7-6-4-6 3 1-7-5-5 7-1Z\"/><path stroke=\"#fffdf2\" fill=\"none\" d=\"m21 7 1 3\"/><path d=\"M5 7v5M2.5 9.5h5\" fill=\"none\"/></g></svg>"
  }
];
 const entries=definitions.map(d=>Object.freeze({...d,dataURL:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(d.svg)}));
 const byId=Object.create(null),cache=Object.create(null);
 for(const entry of entries){byId[entry.classId]=entry;byId[entry.kind]=entry;}
 function get(id){return typeof id==='string'?byId[id]||null:null;}
 function load(id){const entry=get(id);if(!entry)return Promise.reject(new Error('Unknown class: '+id));if(cache[entry.classId])return cache[entry.classId].promise;if(typeof Image==='undefined')return Promise.reject(new Error('Image decoding requires a browser'));
  const image=new Image(),record={image,ready:false,promise:null};record.promise=new Promise((resolve,reject)=>{image.onload=()=>{record.ready=true;resolve(image)};image.onerror=()=>reject(new Error('Role icon could not decode: '+entry.classId));});cache[entry.classId]=record;image.src=entry.dataURL;return record.promise;
 }
 function preload(){return Promise.all(entries.map(entry=>load(entry.classId)));}
 function draw(ctx,id,x,y,size){const entry=get(id);if(!entry||!ctx||!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(size)||size<=0)return false;const record=cache[entry.classId];if(!record||!record.ready)return false;ctx.drawImage(record.image,x,y,size,size);return true;}
 return Object.freeze({version:'1.6.2',all:Object.freeze(entries),get,load,preload,draw});
}));
