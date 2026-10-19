// Deterministic, non-generating Real capture/lifecycle regression.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const key=fs.readFileSync(new URL('../data/.token',import.meta.url),'utf8').trim();
const state=JSON.parse(fs.readFileSync(new URL('../data/state.json',import.meta.url)));
const before=fs.readFileSync(new URL('../data/state.json',import.meta.url));
const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--enable-gpu']});
try {
  const p=await b.newPage({viewport:{width:412,height:915},deviceScaleFactor:1});
  let captures=0;
  await p.route('**/api/state',r=>r.fulfill({json:r.request().method()==='GET'?{}:{ok:true}}));
  await p.route('**/api/layouts',r=>r.fulfill({json:[]}));
  await p.route('**/api/replay/batch',r=>r.fulfill({json:{ok:true}}));
  await p.route('**/api/zen/progress',r=>r.fulfill({json:{v:1,revision:0}}));
  await p.route('**/api/real/layout',r=>r.fulfill({json:{revision:'a'.repeat(24)}}));
  await p.route('**/api/real/*/views',r=>r.fulfill({json:{views:[],scene:null}}));
  await p.route('**/api/real/view',r=>{captures++;return r.fulfill({json:{id:'b'.repeat(24),revision:'a'.repeat(24)}});});
  await p.addInitScript(s=>{localStorage.clear();localStorage.setItem('gr_state',JSON.stringify(s));},state);
  await p.goto('http://127.0.0.1:8790/#k='+key);await p.waitForFunction(()=>window.GR?.real);await p.waitForTimeout(400);
  const depth=await p.evaluate(()=>{
    const {THREE}=GR,roots=GR.proceduralRoots;
    const visible=roots.flatMap(g=>g.children.map(o=>[o,o.visible]));visible.forEach(([o])=>o.visible=false);
    const cube=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshBasicMaterial({color:0xff0000}),1);cube.setMatrixAt(0,new THREE.Matrix4().makeTranslation(2,2,1));roots[0].add(cube);
    GR.controls.enableDamping=false;GR.camera.position.set(2,2,4);GR.controls.target.set(2,2,1);GR.controls.update();
    const overlay=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({color:0x00ff00}));overlay.position.set(2,2,2);GR.scene.add(overlay);
    const c=GR.real.capture(),bytes=Uint8Array.from(atob(c.depth.data),s=>s.charCodeAt(0)),d=new Float32Array(bytes.buffer),w=c.depth.width,h=c.depth.height;
    const result={capture:c,center:d[Math.floor(h/2)*w+Math.floor(w/2)],outside:d[0],captureMs:c.captureMs,camera:c.camera,original:GR.camera.matrixWorld.toArray(),originalAspect:GR.camera.aspect,size:[w,h]};
    GR.scene.remove(overlay);overlay.geometry.dispose();overlay.material.dispose();roots[0].remove(cube);cube.geometry.dispose();cube.material.dispose();visible.forEach(([o,v])=>o.visible=v);return result;
  });
  const evidence=process.env.REAL_TEST_OUT||'$PRIVATE_DATA';fs.mkdirSync(evidence,{recursive:true});fs.writeFileSync(evidence+'/real-capture-test.json',JSON.stringify(depth.capture));
  assert.ok(Math.abs(depth.center-2.5)<.002,'Instanced cube front face must be exactly 2.5 metres');
  assert.equal(depth.outside,0);assert.deepEqual(depth.camera.matrixWorld,depth.original);assert.equal(depth.camera.aspect,depth.originalAspect);
  const countBefore=await p.evaluate(()=>GR.state.items.filter(it=>it.kind==='plant'&&GR.meshOf(it.id)?.userData.billboard).length);
  await p.evaluate(()=>GR.setRealLook(true));await p.waitForTimeout(100);
  assert.equal(await p.evaluate(()=>GR.state.items.filter(it=>it.kind==='plant'&&GR.meshOf(it.id)?.userData.billboard).length),countBefore,'Real never swaps plants to cutouts');
  await p.evaluate(()=>{GR.controls.enableDamping=false;GR.camera.position.x+=.1;GR.controls.update();});await p.waitForTimeout(300);assert.equal(captures,0,'No generation while unsettled');
  await p.waitForTimeout(2500);assert.equal(captures,0,'Idle and movement never submit generation');
  await p.click('#bReal');await p.waitForTimeout(250);assert.equal(captures,1,'Exactly one explicit shutter request');
  await p.evaluate(()=>GR.setRealLook(false));await p.waitForTimeout(300);assert.equal(await p.locator('#real-status').isVisible(),false);
  const invalid=await p.request.post('http://127.0.0.1:8790/api/real/view',{headers:{'X-Garden-Key':key},data:{layout:{},camera:{},depth:{}}});assert.equal(invalid.status(),400);
  console.log(JSON.stringify({metricDepthM:depth.center,emptyDepthM:depth.outside,exactCamera:true,captureMs:depth.captureMs,explicitShutterNoIdle:'PASS',noCutoutSwap:'PASS',malformedCapture:'PASS'},null,2));
} finally {await b.close();assert.deepEqual(fs.readFileSync(new URL('../data/state.json',import.meta.url)),before);}
