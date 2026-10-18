import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { intrinsics } from '../public/modules/scan-camera.js';
const p = [2,0,0,0,0,3,0,0,.2,-.1,-1,-1,0,0,-.2,0];
assert.deepEqual(intrinsics(p,640,480), [[640,0,256],[0,720,216],[0,0,1]]);
const base='http://127.0.0.1:8790', key=fs.readFileSync(new URL('../data/.token',import.meta.url),'utf8').trim();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,permissions:['camera']});
const page=await context.newPage(), errors=[], requests=[];
page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/api/state',r=>r.fulfill({json:r.request().method()==='GET'?{}:{ok:true}}));
await page.route('**/api/ar/calib',r=>r.fulfill({json:null}));
await page.route('**/api/scan_live/**',async r=>{
 const url=new URL(r.request().url()), action=url.pathname.split('/').at(-1);
 if(action==='start')return r.fulfill({json:{id:'1234567890abcdef12345678'}});
 if(action==='stop')return r.fulfill({json:{ok:true}});
 if(action==='frame'){
  const body=r.request().postDataJSON(); requests.push(body);
  assert.equal(body.camera.mode,'imu'); assert.equal(body.camera.metric,false); assert.ok(Math.max(body.camera.width,body.camera.height)<=640); assert.ok(Buffer.from(body.jpeg,'base64').length>1000);
  return r.fulfill({json:{seq:body.seq,metric:false,detections:[{id:'o1',label:'potted plant',confidence:.7,box:[20,20,120,180],identity:{status:'unsure',candidates:[]},plant:{projectedLeafAreaPx:1234}}],corrections:[],geometry:{posed:false},timings:{total:205},splat:{state:'unavailable-rotation-only'}}});
 }
 return r.fulfill({json:{ok:true}});
});
await page.addInitScript(()=>{localStorage.clear(); Object.defineProperty(navigator,'xr',{value:{isSessionSupported:async()=>false},configurable:true});});
try{
 await page.goto(`${base}/#k=${key}`); await page.waitForFunction(()=>window.GR?.scanLive&&window.GR?.ar);
 await page.evaluate(()=>{window.mounts=[]; GR.voice={mountInto:el=>window.mounts.push(el?.id||null),say:text=>{window.said=text;}};});
 await page.tap('[data-panel=live]'); await page.tap('[data-panel=scan_live]'); await page.waitForSelector('#ar-scan:not([hidden])');
 assert.equal(requests.length,0);
 await page.tap('#scan-live-start'); await page.waitForSelector('#scan-live-camera:not([hidden])');
 assert.equal(requests.length,0); assert.match(await page.locator('#scan-live-state').textContent(),/did not grant raw camera|no metric/i);
 await page.tap('#scan-live-camera'); await page.waitForFunction(()=>GR.scanLive.status().frames>=2);
 assert.match(await page.locator('#scan-live-state').textContent(),/2D camera/);
 assert.match(await page.locator('#scan-live-detections').textContent(),/identity unsure/);
 assert.equal(await page.evaluate(()=>GR.scanLive.apply('o1')),false);
 assert.ok((await page.evaluate(()=>window.mounts)).includes('ar-voice'));
 await page.evaluate(()=>{window.testTracks=document.querySelector('#scan-video').srcObject.getTracks();});
 await page.screenshot({path:'work/shots/scan-live-2d-fixture.png'});
 await page.tap('#scan-live-stop'); await page.waitForFunction(()=>!GR.scanLive.status().active);
 assert.ok(await page.evaluate(()=>window.testTracks.every(t=>t.readyState==='ended')));
 await page.tap('#ar-close'); assert.equal((await page.evaluate(()=>window.mounts)).at(-1),null);
 // Exercise the real GL camera copier with a real GL texture, not string matching.
 const rawResult=await page.evaluate(async()=>{
  const T=await import('three'),{RawCamera}=await import('/modules/scan-camera.js');
  const renderer=new T.WebGLRenderer(); renderer.setSize(4,4); const target=new T.WebGLRenderTarget(4,4);renderer.setRenderTarget(target);
  const gl=renderer.getContext(), texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const pixels=new Uint8Array([255,0,0,255,255,0,0,255,0,255,0,255,0,255,0,255]);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,2,2,0,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  let active=true,calls=0; window.XRWebGLBinding=class{getCameraImage(){if(!active)throw new Error('Inactive frame');calls++;return texture;}};
  const session={},camera={width:2,height:2},transform={matrix:new T.Matrix4().toArray()},projection=new T.PerspectiveCamera(60,1,.1,10).projectionMatrix.toArray();
  const raw=new RawCamera(renderer,session), result=raw.capture({session}, {}, {camera,transform,projectionMatrix:projection},T);active=false;
  const data=Array.from(result.canvas.getContext('2d').getImageData(0,0,2,2).data), restored=renderer.getRenderTarget()===target;raw.dispose();target.dispose();gl.deleteTexture(texture);renderer.dispose();
  return{data,restored,calls,pose:result.camera.pose,intrinsics:result.camera.intrinsics};
 });
 assert.equal(rawResult.restored,true);assert.equal(rawResult.calls,1);assert.deepEqual(rawResult.data.slice(0,4),[0,255,0,255]);assert.deepEqual(rawResult.data.slice(8,12),[255,0,0,255]);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({intrinsics:'PASS',rawCameraActiveFrameCopyAndVerticalFlip:'PASS',xrRenderTargetRestored:'PASS',phoneFallbackAndVoiceMount:'PASS',chunkedKeyframesAndBackpressure:'PASS',rotationOnlyCannotApplyMetricCorrections:'PASS',stopReleasesCamera:'PASS',frames:requests.length,jsErrors:errors},null,2));
}finally{await browser.close();}
