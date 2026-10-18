// Real AR + scan modules, real GL copier/scene; injected XR and server contracts.
// NOT physical passthrough or a measured-room accuracy claim.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true}),errors=[],frames=[];
page.on('pageerror',e=>errors.push(String(e)));
const id='abcdef1234567890abcdef12';
await page.route('**/scan-xr-fixture',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en" data-zeros-theme="living-night" data-zeros-lens="garden"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/zeros/tokens.css"><link rel="stylesheet" href="/zeros/product-bridge.css"><link rel="stylesheet" href="/style.css"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js"}}</script>'}));
await page.route('**/api/scan_live/**',r=>{
 const action=r.request().url().split('/').at(-1);
 if(action==='start')return r.fulfill({json:{id}});
 if(action==='stop')return r.fulfill({json:{ok:true,state:'stopped'}});
 if(action==='frame'){
  const body=r.request().postDataJSON();frames.push(body);
  return r.fulfill({json:{seq:body.seq,metric:true,alignment:{angle:.7,tx:1,tz:2,floor:0,error:.05,source:'injected-landmarks'},detections:[{id:'table',label:'dining table',confidence:.8,position:{x:0,y:.5,z:-2},size:{w:1.2,h:.7,d:null},planPosition:{x:2.2,y:.5,z:.5},views:4,metric:true}],corrections:[{id:'table',object:'table',name:'Dining table',x:2.2,z:.5,distanceM:.3,props:{}}],geometry:{posed:true},timings:{total:200},splat:{state:'waiting'}}});
 }
 return r.fulfill({json:{}});
});
try{
 await page.goto('http://127.0.0.1:8790/scan-xr-fixture');
 await page.evaluate(async()=>{
  const T=await import('three'), ar=await import('/modules/ar.js'),scan=await import('/modules/scan_live.js');
  const ref=new EventTarget(), camera=new T.PerspectiveCamera(70,innerWidth/innerHeight,.01,40);camera.position.set(0,1.5,0);camera.lookAt(0,.5,-2);camera.updateMatrixWorld(); const hooks=[];
  window.fake={time:0,tracked:true,reference:ref,options:null,scene:null,moved:null,say:[],mounts:[],hooks};
  class Session extends EventTarget{visibilityState='visible';enabledFeatures=['hit-test','dom-overlay','camera-access'];domOverlayState={type:'screen'};requestReferenceSpace=async()=>ref;requestHitTestSource=async(opts)=>{fake.hitOptions=opts;return{cancel(){fake.cancelled=true;}};};async end(){this.dispatchEvent(new Event('end'));}}
  Object.defineProperty(navigator,'xr',{configurable:true,value:{isSessionSupported:async()=>true,requestSession:async(_mode,options)=>{fake.options=options;return fake.session=new Session();}}});
  class Renderer{
   constructor(options){this.real=new T.WebGLRenderer(options);this.xr={setReferenceSpaceType(){},setSession:async()=>{},getReferenceSpace:()=>ref,getCamera:()=>camera};fake.renderer=this;}
   setPixelRatio(v){this.real.setPixelRatio(v);}setSize(...v){this.real.setSize(...v);}setClearColor(...v){this.real.setClearColor(...v);}setAnimationLoop(fn){fake.loop=fn;}render(scene){fake.scene=scene;this.real.render(scene,camera);}getContext(){return this.real.getContext();}getRenderTarget(){return this.real.getRenderTarget();}setRenderTarget(t){this.real.setRenderTarget(t);}resetState(){this.real.resetState();}
  }
  window.XRWebGLBinding=class{constructor(session,g){this.g=g;this.texture=g.createTexture();g.bindTexture(g.TEXTURE_2D,this.texture);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);const pixels=new Uint8Array(64*48*4);for(let i=0;i<pixels.length;i+=4){pixels[i]=60;pixels[i+1]=90;pixels[i+2]=70;pixels[i+3]=255;}g.texImage2D(g.TEXTURE_2D,0,g.RGBA,64,48,0,g.RGBA,g.UNSIGNED_BYTE,pixels);}getCameraImage(){if(!fake.frameActive)throw new Error('camera read outside active XRFrame');return this.texture;}};
  const items=[{id:'table',name:'Dining table',kind:'table',x:1.9,z:.5,w:1.2,d:.8,h:.75}],state={room:{poly:[[0,0],[0,3],[3,3],[3,0]]},items};
  const GR=window.GR={THREE:{...T,WebGLRenderer:Renderer},KEY:'fixture',scene:new T.Scene(),state,ICON:{scan:''},itemById:id=>items.find(i=>i.id===id),footprint:it=>({x0:it.x-it.w/2,x1:it.x+it.w/2,z0:it.z-it.d/2,z1:it.z+it.d/2}),closeSheet(){},toast(){},addDock(){},addItemAction(){},onFrame:fn=>hooks.push(fn),api:async(path,opts)=>path.startsWith('/api/ar')?null:(await fetch(path,{...opts,headers:{'Content-Type':'application/json'}})).json(),moveItem:(id,x,z)=>{Object.assign(items.find(i=>i.id===id),{x,z});fake.moved={id,x,z};return true;},setProps:(id,props)=>{Object.assign(items.find(i=>i.id===id),props);return true;},voice:{mountInto:el=>{fake.mounts.push(el?.id||null);if(el){const b=document.createElement('button');b.textContent='Voice fixture';el.append(b);}},say:text=>fake.say.push(text)}};
  ar.init(GR);scan.init(GR);await GR.scanLive.open();
  fake.tick=tracked=>{fake.tracked=tracked;const transform={position:{x:0,y:1.5,z:0},matrix:camera.matrixWorld.toArray()},view={camera:{width:64,height:48},transform,projectionMatrix:camera.projectionMatrix.toArray()},frame={session:fake.session,getViewerPose:()=>tracked?{transform,views:[view]}:null,getHitTestResults:()=>[]};fake.frameActive=true;try{fake.loop?.(fake.time+=400,frame);hooks.forEach(fn=>fn());}finally{fake.frameActive=false;}};
 });
 await page.tap('#scan-live-start');await page.waitForFunction(()=>GR.scanLive.status().id);
 await page.evaluate(()=>fake.tick(true));await page.waitForFunction(()=>GR.scanLive.detections().length===1);
 assert.equal(frames[0].camera.mode,'webxr');assert.deepEqual(frames[0].camera.pose.slice(12,15),[0,1.5,0]);assert.deepEqual(frames[0].plan.room.poly,[[0,0],[0,3],[3,3],[3,0]]);
 const state=await page.evaluate(()=>({ar:GR.ar.status(),moved:fake.moved,features:fake.options.optionalFeatures,required:fake.options.requiredFeatures,hitEntities:fake.hitOptions.entityTypes,mounts:fake.mounts}));
 assert.equal(state.ar.alignmentMode,'automatic');assert.equal(state.ar.calibration.angle,.7);assert.equal(state.moved,null);assert.ok(state.features.includes('camera-access'));assert.deepEqual(state.required,['hit-test','dom-overlay']);assert.deepEqual(state.hitEntities,['plane']);assert.ok(state.mounts.includes('ar-voice'));
 await page.evaluate(()=>fake.tick(true));
 assert.ok(await page.evaluate(()=>fake.scene.children.some(g=>g.children.some(o=>o.isSprite))));
 await page.screenshot({path:'work/shots/scan-live-xr-injected.png'});
 await page.getByRole('button',{name:'Apply',exact:true}).click();assert.equal((await page.evaluate(()=>fake.moved)).id,'table');
 await page.evaluate(()=>fake.tick(false));assert.equal(await page.evaluate(()=>fake.scene.children.find(g=>g.children.some(o=>o.isSprite)).visible),false);
 await page.evaluate(()=>fake.reference.dispatchEvent(new Event('reset')));await page.waitForFunction(()=>!GR.scanLive.status().active);assert.equal(await page.evaluate(()=>GR.ar.status().aligned),false);
 await page.evaluate(()=>GR.ar.stop());assert.equal(await page.evaluate(()=>fake.cancelled),true);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({posedRawFrame:'PASS',dynamicRotatedPlan:'PASS',automaticAlignment:'PASS',labelled3DBrackets:'PASS',explicitApply:'PASS',voiceMountedInsideOverlay:'PASS',trackingLossHidesBoxes:'PASS',originResetStartsNewScan:'PASS',jsErrors:errors},null,2));
}finally{await browser.close();}
