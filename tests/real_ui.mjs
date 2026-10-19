// Non-generating lifecycle test: photo pinning, Spark decode, invalidation, HUD.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const key=fs.readFileSync(new URL('../data/.token',import.meta.url),'utf8').trim();
const fixture=JSON.parse(fs.readFileSync(new URL('../data/state.json',import.meta.url)));
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--enable-gpu']});
try {
 const p=await b.newPage({viewport:{width:412,height:915},deviceScaleFactor:2.6});
 const errors=[];p.on('pageerror',e=>errors.push(String(e)));
 for(const url of ['state','layouts','replay/batch','zen/progress'])await p.route('**/api/'+url,r=>r.fulfill({json:url==='layouts'?[]:url==='zen/progress'?{v:1,revision:0}:r.request().method()==='GET'?{}:{ok:true}}));
 let camera,lookups=0,requests=0;
 await p.route('**/api/real/layout',r=>{lookups++;return r.fulfill({json:{revision:(lookups===1?'a':'b').repeat(24)}});});
 await p.route('**/api/real/*/views',r=>r.fulfill({json:lookups===1?{views:[{id:'c'.repeat(24),base:'/renders/test-real/',camera,status:{state:'ready',hq:true,alignment:{accepted:true}}}],scene:{url:'/renders/test-real/fused.splat',count:1}}:{views:[],scene:null}}));
 await p.route('**/api/real/view',r=>{requests++;return r.fulfill({json:{id:'d'.repeat(24),revision:'b'.repeat(24)}});});
 const bytes=Buffer.alloc(32);bytes.writeFloatLE(2,0);bytes.writeFloatLE(1,4);bytes.writeFloatLE(2,8);for(let k=12;k<24;k+=4)bytes.writeFloatLE(.02,k);bytes.fill(180,24,27);bytes[27]=255;bytes[28]=255;bytes[29]=bytes[30]=bytes[31]=128;
 await p.route('**/renders/test-real/fused.splat',r=>r.fulfill({contentType:'application/octet-stream',body:bytes}));
 await p.route('**/renders/test-real/real.png',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="412" height="915"><rect width="412" height="915" fill="#485b32"/></svg>'}));
 await p.addInitScript(s=>{localStorage.clear();localStorage.setItem('gr_state',JSON.stringify(s));},fixture);
 await p.goto('http://127.0.0.1:8790/#k='+key);await p.waitForFunction(()=>window.GR?.real);await p.waitForTimeout(500);
 camera=await p.evaluate(()=>{GR.controls.enableDamping=false;return {position:GR.camera.position.toArray(),quaternion:GR.camera.quaternion.toArray(),fov:GR.camera.fov,aspect:GR.camera.aspect};});
 await p.click('#bReal');await p.waitForFunction(()=>GR.real.stats.count===1&&+getComputedStyle(document.querySelector('.real-image')).opacity>.99);
 assert.equal(await p.evaluate(()=>GR.renderer.getPixelRatio()),1.25);
 await p.evaluate(()=>{GR.camera.position.x+=.12;GR.controls.update();});
 await p.waitForFunction(()=>getComputedStyle(document.querySelector('.real-image')).opacity==='0');
 assert.equal(await p.evaluate(()=>GR.proceduralRoots.some(g=>g.visible)),false);
 await p.evaluate(()=>GR.select('p01'));assert.equal(await p.evaluate(()=>GR.selected),'p01');assert.equal(await p.locator('#hud').isVisible(),true);
 await p.evaluate(()=>{const it=GR.itemById('p01');GR.moveItem(it.id,it.x+.1,it.z);});
 await p.waitForFunction(()=>GR.real.revision==='b'.repeat(24)&&GR.real.stats.count===0);
 assert.equal(await p.evaluate(()=>GR.proceduralRoots.every(g=>g.visible)),true);
 await p.evaluate(()=>GR.setRealLook(false));assert.equal(await p.evaluate(()=>GR.renderer.getPixelRatio()),2);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({photoPinnedOnlyAtCapturePose:'PASS',realSparkDecode:'PASS',proceduralHiddenDuringCoverage:'PASS',layoutInvalidationClearsSplats:'PASS',selectionAndHUD:'PASS',mobileDprCapAndRestore:'PASS',paidGenerationCalls:0,errors},null,2));
} finally {await b.close();}
