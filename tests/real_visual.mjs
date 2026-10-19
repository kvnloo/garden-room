// Repeatable owner-layout visual qualification. No image turns without --generate.
// REAL_OUT is a private artifact directory; never writes owner state.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
const root=new URL('../',import.meta.url).pathname;
const out=process.env.REAL_OUT||'$PRIVATE_DATA';
const fixture=process.env.REAL_FIXTURE||path.dirname(out)+'/state.before.json';
const mode=process.argv.includes('--generate')?'generate':process.argv.includes('--capture-only')?'capture':'views';
const stage=process.env.REAL_STAGE||'before';
const offline=process.argv.includes('--cached');
const galleryOnly=process.argv.includes('--gallery-only');
assert.ok(!galleryOnly||(offline&&stage==='after'),'--gallery-only requires --cached and REAL_STAGE=after');
assert.ok(!offline||mode==='views','--cached never submits or captures new generation inputs');
const budget=Number(process.env.REAL_BUDGET||6);
fs.mkdirSync(out,{recursive:true});
const state=JSON.parse(fs.readFileSync(fixture));
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const key=fs.readFileSync(root+'data/.token','utf8').trim();
const poses=[
 {name:'overview',view:'overview',position:[5.2,4.6,6.2],target:[1.83,.65,1.83]},
 {name:'window',view:'eye',position:[2.8,1.55,3.05],target:[1.9,1.0,.1]},
 {name:'fridge-china',view:'eye',position:[.75,1.55,2.8],target:[3.55,1.0,1.5]},
 {name:'top',view:'top',position:[1.83,6.4,1.831],target:[1.83,0,1.83]},
 {name:'between-high',view:'overview',position:[3.3,2.65,3.5],target:[1.9,.85,.8]},
 {name:'between-eye',view:'eye',position:[1.5,1.55,3.1],target:[2.0,.9,.2]},
];
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--enable-gpu']});
const context=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:1,isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));
for(const name of ['state','layouts','replay/batch','zen/progress'])await page.route('**/api/'+name,r=>r.fulfill({json:name==='layouts'?[]:name==='zen/progress'?{v:1,revision:0}:r.request().method()==='GET'?{}:{ok:true}}));
// Preserve baseline frontend byte-for-byte even if the canonical checkout changes.
if(stage==='before')for(const file of ['app.js','modules/real.js','modules/almanac.js']){
 const saved=path.dirname(out)+'/baseline-code/public/'+file;
 if(fs.existsSync(saved))await page.route('**/'+file,r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(saved)}));
}
await page.addInitScript(s=>{localStorage.clear();localStorage.setItem('gr_state',JSON.stringify(s));},state);
const recordsFile=out+'/records.json';
let records=fs.existsSync(recordsFile)?JSON.parse(fs.readFileSync(recordsFile)):[];
const save=()=>fs.writeFileSync(recordsFile,JSON.stringify(records,null,2));
if(offline){
 await page.route('**/real-visual-cache/**',r=>{
  const relative=new URL(r.request().url()).pathname.split('/real-visual-cache/')[1];
  const file=path.resolve(out,relative);
  if(!file.startsWith(path.resolve(out)+'/'))return r.abort();
  return r.fulfill({contentType:file.endsWith('.splat')?'application/octet-stream':file.endsWith('.jpg')?'image/jpeg':'image/png',body:fs.readFileSync(file)});
 });
 // Use only frozen per-pose receipts, never a concurrently changing live manifest.
 await page.route('**/api/real/photos',r=>r.fulfill({json:{photos:records.map(r=>r.view)}}));
}
try{
 await page.goto('http://127.0.0.1:8790/#k='+key);await page.waitForFunction(()=>window.GR?.real);await page.waitForTimeout(1600);
 const hardware=await page.evaluate(()=>{const g=GR.renderer.getContext(),e=g.getExtension('WEBGL_debug_renderer_info');return {renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown',three:GR.THREE.REVISION,dpr:devicePixelRatio};});
 assert.ok(!/swiftshader|llvmpipe/i.test(hardware.renderer));
 fs.writeFileSync(out+'/fixture.json',JSON.stringify({stateHash:hash(fs.readFileSync(fixture)),state,poses,hardware,stage},null,2));
 // Blocking this route excludes accidental idle jobs, independently of UI policy.
 await page.route('**/api/real/view',r=>r.fulfill({json:{error:'Visual harness blocks implicit generation'}}));
 if(mode!=='views')for(let i=0;i<poses.length;i++){
  const p=poses[i],dir=out+'/'+p.name;fs.mkdirSync(dir,{recursive:true});
  await page.evaluate(p=>{GR.setRealLook(false);GR.setView(p.view);GR.controls.enableDamping=false;GR.camera.position.fromArray(p.position);GR.controls.target.fromArray(p.target);GR.controls.update();},p);
  await page.waitForTimeout(200);
  const capture=await page.evaluate(()=>GR.real.capture());
  // Capture bytes are immutable on rerun, avoiding silent HQ/depth/camera mixing.
  if(fs.existsSync(dir+'/capture.json')){
   const old=JSON.parse(fs.readFileSync(dir+'/capture.json'));
   assert.deepEqual(capture.camera,old.camera,'Camera changed; use a new artifact directory');
   assert.deepEqual(capture.layout,old.layout,'Layout changed; never reuse an unrelated HQ');
  }else{
   fs.writeFileSync(dir+'/capture.json',JSON.stringify(capture));
   for(const [field,file] of [['view','procedural.jpg'],['ids','ids.png']])fs.writeFileSync(dir+'/'+file,Buffer.from(capture[field].split(',')[1],'base64'));
   fs.writeFileSync(dir+'/depth.f32',Buffer.from(capture.depth.data,'base64'));
  }
  if(mode==='capture')continue;
  let record=records.find(r=>r.name===p.name);
  if(!record){
   assert.ok(records.length<budget,'HQ turn budget exhausted');
   // APIRequestContext bypasses page interception; only this explicit path spends.
   let response;
   for(let attempt=0;attempt<180;attempt++){
    response=await context.request.post('http://127.0.0.1:8790/api/real/view',{headers:{'X-Garden-Key':key},data:{...capture,explicit:true}});
    if(response.status()!==429)break;
    await page.waitForTimeout(3000);
   }
   const result=await response.json();assert.ok(result.id,JSON.stringify(result));
   record={name:p.name,...result,camera:capture.camera};records.push(record);save();
   console.log('EXPLICIT_SHOT',p.name,result.id,result.cached?'cached':'new');
  }
 }
 if(mode==='capture'){console.log('Captured six fixed poses; zero image turns.');process.exitCode=0;}
 else{
  assert.equal(records.length,6,'Six capture poses required; run --generate explicitly first');
  for(let attempt=0;!offline&&attempt<240;attempt++){
   let complete=true;
   for(const rec of records){
    const url=`http://127.0.0.1:8790/api/real/${rec.revision}/views`;
    const response=await context.request.get(url,{headers:{'X-Garden-Key':key}}),result=await response.json();
    rec.view=result.views.find(v=>v.id===rec.id);rec.scene=result.scene;
    if(!['ready','alignment-rejected','needs-review','failed'].includes(rec.view?.status.state))complete=false;
   }
   save();if(complete||mode==='views')break;
   if(attempt%6===0)console.log('STAGES',records.map(r=>r.name+':'+r.view?.status.state).join(' '));
   await page.waitForTimeout(3000);
  }
  for(const rec of galleryOnly?[]:records){
   const dir=out+'/'+rec.name,src=root+`data/renders/real/${rec.revision}/${rec.id}`;
   if(!offline)for(const name of ['real.png','preview.png','provenance.json','alignment.json','consistency.json','preview-consistency.json','status.json','capture.json','layout.json','aligned.ply'])if(fs.existsSync(src+'/'+name))fs.copyFileSync(src+'/'+name,dir+'/'+(name==='capture.json'?'server-capture.json':name));
   if(!rec.view?.status.hq){console.warn('NO_HQ',rec.name,rec.view?.status);continue;}
   const photoScene=rec.view.status.splat?.fine||rec.view.status.splat?.coarse;
   const pinned={revision:rec.revision,views:[rec.view],scene:stage==='before'?rec.scene:(photoScene||rec.scene)};
   await page.route('**/api/real/*/views',r=>r.fulfill({json:pinned}));
   await page.evaluate(view=>{GR.setRealLook(false);GR.setView(view);},poses.find(p=>p.name===rec.name).view);
   if(stage==='after')await page.evaluate(photo=>GR.real.walkAround(photo),{...rec.view,revision:rec.revision});
   else await page.evaluate(()=>{GR.setRealLook(true);});
   await page.waitForTimeout(300);
   await page.evaluate(()=>GR.real.identify());await page.evaluate(()=>GR.real.poll());
   if(!pinned.scene?.url){rec.playbackError='No accepted splat';save();continue;}
   const splatSource=root+'data'+pinned.scene.url.replace(/^\/renders/,'/renders');
   const localSplat=offline?rec.sceneLocal:out+'/'+path.basename(pinned.scene.url);
   if(!offline&&fs.existsSync(splatSource)&&!fs.existsSync(localSplat))fs.copyFileSync(splatSource,localSplat);
   rec.sceneLocal=localSplat;
   await page.waitForFunction(()=>GR.real.stats.count>0,null,{timeout:120000});
   if(stage==='after'&&photoScene?.url)await page.waitForFunction(url=>GR.real.sceneUrl===url,photoScene.url,{timeout:120000});
   if(stage==='after'){
    await page.waitForFunction(()=>+document.querySelector('.real-image').style.opacity>.999&&document.querySelector('.real-image').complete);
    const visible=await page.addStyleTag({content:'body *{visibility:hidden!important} #app,#app canvas,#app .real-image{visibility:visible!important}'});
    await page.locator('#app').screenshot({path:dir+'/photo-pinned.png'});await visible.evaluate(e=>e.remove());
    rec.playbackStats=await page.evaluate(()=>({...GR.real.stats,frames:GR.real.stats.frames.slice(-100)}));
   }
   const rawStyle=await page.addStyleTag({content:'body *{visibility:hidden!important} #app,#app canvas{visibility:visible!important}'});
   await page.evaluate(()=>{GR.scene.children.forEach(o=>{if(!GR.proceduralRoots.includes(o)&&!o.isLight&&!o.isMesh&&!/splat/i.test(o.name))o.visible=false;});});
   const shots=[];
   for(const degrees of [0,5,15,30]){
    const info=await page.evaluate(({camera,degrees})=>{
     const {THREE:T}=GR;GR.controls.enableDamping=false;
     GR.camera.position.fromArray(camera.position);GR.camera.quaternion.fromArray(camera.quaternion);GR.camera.fov=camera.fov;GR.camera.updateProjectionMatrix();
     if(degrees){const a=T.MathUtils.degToRad(degrees),delta=new T.Vector3(.3,0,0).applyQuaternion(GR.camera.quaternion);GR.camera.position.add(delta);GR.camera.quaternion.multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),a));}
     const forward=new T.Vector3(0,0,-1).applyQuaternion(GR.camera.quaternion);GR.controls.target.copy(GR.camera.position).add(forward);GR.controls.update();GR.camera.updateMatrixWorld();
     return {position:GR.camera.position.toArray(),quaternion:GR.camera.quaternion.toArray(),matrixWorld:GR.camera.matrixWorld.toArray(),fov:GR.camera.fov,aspect:GR.camera.aspect};
    },{camera:rec.camera,degrees});
    const cap=await page.evaluate(()=>GR.real.capture());
    fs.writeFileSync(dir+`/offset-${degrees}-depth.f32`,Buffer.from(cap.depth.data,'base64'));
    fs.writeFileSync(dir+`/offset-${degrees}-ids.png`,Buffer.from(cap.ids.split(',')[1],'base64'));
    // Raw diagnostic splat: deliberately bypass validity fallback, never a photo.
    await page.evaluate(()=>{GR._visualCoverageOriginal??=GR.setRealCoverage;GR.setRealCoverage=()=>GR._visualCoverageOriginal(true);GR.setRealCoverage(true);});
    await page.waitForTimeout(2200);
    const assertion=await page.evaluate(()=>({proceduralVisible:GR.proceduralRoots.some(r=>r.visible),count:GR.real.stats.count,stats:GR.real.stats,overlayVisible:getComputedStyle(document.querySelector('.real-image')).visibility!=='hidden'&&+getComputedStyle(document.querySelector('.real-image')).opacity>0}));
    assert.equal(assertion.proceduralVisible,false);assert.equal(assertion.overlayVisible,false);
    await page.locator('#app canvas').first().screenshot({path:dir+`/splat-${degrees}.png`});
    shots.push({degrees,translationM:degrees?.3:0,camera:info,...assertion});
   }
   rec.shots=shots;save();await rawStyle.evaluate(e=>e.remove());console.log('SPLAT_CAPTURED',rec.name,shots.length);
  }
  if(stage==='after'&&offline){
   await page.evaluate(async()=>{GR.setRealLook(false);await GR.real.refreshPhotos();await GR.almanac.openPhotos();});
   await page.waitForSelector('.alm-photo-card');
   assert.equal(await page.locator('.alm-photo-card').count(),6);
   await page.waitForFunction(()=>[...document.querySelectorAll('.alm-photo-card img')].slice(0,2).every(i=>i.complete&&i.naturalWidth));
   await page.screenshot({path:out+'/gallery.png'});
   await page.locator('.alm-photo-card').first().click();await page.waitForSelector('[data-photo-go]');
   await page.waitForFunction(()=>document.querySelector('.alm-photo-full img')?.complete);
   await page.screenshot({path:out+'/photo-viewer.png'});
   await page.locator('[data-photo-plant]').first().click();
   await page.locator('.alm-plant-photos:not([hidden])').scrollIntoViewIfNeeded();
   await page.screenshot({path:out+'/plant-photo-card.png'});
   await page.evaluate(()=>GR.almanac.close());
  }
  fs.writeFileSync(out+'/errors.json',JSON.stringify(errors,null,2));assert.deepEqual(errors,[]);
 }
}finally{await browser.close();}
