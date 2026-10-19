// Real owner-layout evidence. Generates exactly three HQ calls (no retry storms).
// State GET is {}, fixture is localStorage; every owner-state/journal write is mocked.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
if(!process.argv.some(a=>['--generate','--views-only','--capture-only'].includes(a))) {console.log('SKIP paid/live generation: pass --generate, --views-only, or --capture-only explicitly');process.exit(0);}
const root=new URL('../',import.meta.url).pathname;
const out=process.env.REAL_OUT||'$PRIVATE_DATA';fs.mkdirSync(out,{recursive:true});
const state=JSON.parse(fs.readFileSync(fs.existsSync(out+'/state.before.json')?out+'/state.before.json':root+'data/state.json'));
const key=fs.readFileSync(root+'data/.token','utf8').trim();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--enable-gpu']});
const context=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:2.6,isMobile:true,hasTouch:true});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
await page.route('**/api/state',r=>r.fulfill({json:r.request().method()==='GET'?{}:{ok:true}}));
await page.route('**/api/layouts',r=>r.fulfill({json:[]}));
await page.route('**/api/replay/batch',r=>r.fulfill({json:{ok:true}}));
await page.route('**/api/zen/progress',r=>r.fulfill({json:{v:1,revision:0}}));
await page.addInitScript(s=>{localStorage.clear();localStorage.setItem('gr_state',JSON.stringify(s));},state);
const cameras=[{position:[3.0,1.55,3.05],target:[2.0,.9,.7]}, {position:[2.5,1.55,3.1],target:[2.0,.9,.7]}, {position:[2.0,1.55,3.05],target:[2.0,.9,.7]}];
try {
  await page.goto('http://127.0.0.1:8790/#k='+key);await page.waitForFunction(()=>window.GR?.real);
  await page.waitForTimeout(1800);
  const hardware=await page.evaluate(()=>{const gl=GR.renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown',version:gl.getParameter(gl.VERSION),three:GR.THREE.REVISION,devicePixelRatio,renderPixelRatio:GR.renderer.getPixelRatio()};});
  assert.ok(!/swiftshader|llvmpipe/i.test(hardware.renderer));
  fs.writeFileSync(out+'/hardware.json',JSON.stringify(hardware,null,2));
  const requests=[];
  if(!process.argv.includes('--views-only')) {
    await page.evaluate(()=>GR.real.identify());
    for(let i=0;i<3;i++) {
      await page.evaluate(c=>{GR.setView('eye');GR.controls.enableDamping=false;GR.camera.position.fromArray(c.position);GR.controls.target.fromArray(c.target);GR.controls.update();},cameras[i]);
      await page.waitForTimeout(300);
      const capture=await page.evaluate(()=>GR.real.capture());
      fs.writeFileSync(out+`/capture-${i+1}.json`,JSON.stringify(capture));
      fs.writeFileSync(out+`/beauty-${i+1}.jpg`,Buffer.from(capture.view.split(',')[1],'base64'));
      fs.writeFileSync(out+`/depth-${i+1}.f32`,Buffer.from(capture.depth.data,'base64'));
      fs.writeFileSync(out+`/ids-${i+1}.png`,Buffer.from(capture.ids.split(',')[1],'base64'));
      if(process.argv.includes('--capture-only'))continue;
      const req=await page.evaluate(async c=>GR.api('/api/real/view',{method:'POST',body:JSON.stringify(c)}),capture);
      assert.ok(req.id,JSON.stringify(req));requests.push(req);
      fs.writeFileSync(out+'/requests.json',JSON.stringify(requests,null,2));
      console.log('CAPTURE',i+1,JSON.stringify({id:req.id,revision:req.revision,cached:req.cached,captureMs:capture.captureMs}));
    }
    if(process.argv.includes('--capture-only')) {await browser.close();process.exit(0);}
    // Poll the exact revision until every real GPU/network job is terminal.
    const rev=requests[0].revision;
    for(let i=0;i<180;i++) {
      const r=await page.evaluate(rev=>GR.api(`/api/real/${rev}/views`),rev);
      fs.writeFileSync(out+'/results.json',JSON.stringify(r,null,2));
      console.log('STAGES',JSON.stringify(r.views.map(v=>({id:v.id,state:v.status.state,previewError:v.status.previewError,error:v.status.error}))));
      if(r.views.length>=3&&r.views.every(v=>['ready','alignment-rejected','needs-review','failed'].includes(v.status.state)))break;
      await page.waitForTimeout(5000);
    }
  }
  const results=JSON.parse(fs.readFileSync(out+'/results.json'));
  // Bind playback to the exact recorded immutable scene. Other live clients may
  // continue fusing this revision while the evidence run is in progress.
  await page.route(`**/api/real/${results.revision}/views`,r=>r.fulfill({json:results}));
  await page.evaluate(()=>GR.setRealLook(true));await page.evaluate(()=>GR.real.identify());
  // Automatic captures are disabled ONLY in this read-only novel-view evidence run.
  await page.route('**/api/real/view',r=>r.fulfill({json:{error:'Evidence: no additional image generation'}}));
  if(!results.scene)throw new Error('No accepted metric scene; inspect alignment rejection rather than inventing evidence');
  await page.waitForFunction(()=>GR.real.stats.count>0,null,{timeout:120000});
  const mids=[{position:[2.75,1.55,3.075],target:[2,.9,.7]},{position:[2.25,1.55,3.075],target:[2,.9,.7]},{position:[2.5,1.62,3.0],target:[2,.9,.7]}];
  const shots=[];
  for(let i=0;i<3;i++) {
    await page.evaluate(c=>{GR.camera.position.fromArray(c.position);GR.controls.target.fromArray(c.target);GR.controls.update();},mids[i]);
    await page.waitForTimeout(3000);
    const s=await page.evaluate(()=>({coverage:GR.real.coverage,stats:GR.real.stats,renderPixelRatio:GR.renderer.getPixelRatio(),imageOpacity:getComputedStyle(document.querySelector('.real-image')).opacity,proceduralVisible:GR.proceduralRoots.some(g=>g.visible),camera:GR.camera.position.toArray()}));
    assert.equal(s.imageOpacity,'0','Novel view must not be a photo overlay');
    assert.equal(s.proceduralVisible,false,'Novel view must actually be rendered splats');
    const path=out+`/novel-${i+1}.png`;await page.screenshot({path});shots.push({path,...s});
  }
  fs.writeFileSync(out+'/novel-views.json',JSON.stringify({shots,hardware,errors},null,2));
  console.log(JSON.stringify({hardware,scene:results.scene,shots:shots.map(s=>({path:s.path,coverage:s.coverage,count:s.stats.count,transferMs:s.stats.transferMs,decodeMs:s.stats.decodeMs})),errors},null,2));
} finally {await browser.close();}
