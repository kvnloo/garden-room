// Actual app/Three meshes + recorded real inference. Metric spatial contract is
// explicitly injected, NOT passed off as a physical phone or measured-room scan.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright-core';
const root=new URL('../',import.meta.url).pathname, fixture=JSON.parse(fs.readFileSync(root+'tests/fixtures/scan-real.json'));
const key=fs.readFileSync(root+'data/.token','utf8').trim(),owner=fs.readFileSync(root+'data/state.json','utf8');
const out=root+'work/scan-layout-evidence/';fs.mkdirSync(out,{recursive:true});
const metricId='aabbcc112233445566778899',realId=fixture.scan.id;
let contract=fs.existsSync(root+'tests/fixtures/scan-metric-contract.json')?JSON.parse(fs.readFileSync(root+'tests/fixtures/scan-metric-contract.json')):null;
const records=new Map([[realId,fixture.scan]]);if(contract)records.set(metricId,contract.scan);
function proposal(scan,plan,decisions={}) {
 const r=spawnSync('python',['-c',"import json,sys;from tools.scan_live_layout import build_proposal;x=json.load(sys.stdin);print(json.dumps(build_proposal(x['plan'],x['scan'].get('observedDetections',x['scan']['detections']),x['scan'].get('metric',False),x['scan'].get('alignment'),x['scan']['id'],x['decisions'],x['scan'].get('createdAt'))))"],{cwd:root,input:JSON.stringify({scan,plan,decisions}),encoding:'utf8'});
 if(r.status!==0)throw Error(r.stderr); return JSON.parse(r.stdout);
}
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:412,height:915},isMobile:true,hasTouch:true}),errors=[],results={};page.on('pageerror',e=>errors.push(String(e)));
let layouts=[], discardSave=false;
await page.route('**/api/state',r=>r.fulfill({json:r.request().method()==='GET'?{}:{ok:true}}));
await page.route('**/api/layouts',r=>{if(r.request().method()==='PUT'){if(!discardSave)layouts=r.request().postDataJSON();return r.fulfill({json:{ok:true}});}return r.fulfill({json:layouts});});
await page.route('**/api/replay/batch',r=>r.fulfill({json:{ok:true}}));await page.route('**/api/zen/progress',r=>r.fulfill({json:{v:1,revision:0}}));
await page.route('**/api/scan_live/**',r=>{const path=new URL(r.request().url()).pathname,action=path.split('/').at(-1),id=path.split('/').at(-2);
 if(action==='history')return r.fulfill({json:[...records].map(([id,s])=>({id,state:'stopped',createdAt:s.createdAt,frames:3,detections:s.detections.length,metric:s.metric}))});
 if(action==='proposal'){const b=r.request().postDataJSON();return r.fulfill({json:proposal(records.get(id),b.plan,b.decisions)});}
 if(action==='status')return r.fulfill({json:records.get(id)});return r.fulfill({json:{ok:true}});
});
await page.addInitScript(s=>{if(sessionStorage.getItem('scan-seeded'))return;sessionStorage.setItem('scan-seeded','1');localStorage.clear();localStorage.setItem('gr_state',JSON.stringify(s));},fixture.plan);
const position=async id=>page.evaluate(id=>({item:structuredClone(GR.itemById(id)),mesh:GR.meshOf(id)?.position.toArray()}),id);
try {
 await page.goto('http://127.0.0.1:8790/#k='+key);await page.waitForFunction(()=>window.GR?.scanLive&&window.GR?.ar);
 if(!contract || process.argv.includes('--record-contract')) {
  const source=fixture.scan.detections.filter(d=>d.label==='potted plant').sort((a,b)=>b.confidence-a.confidence)[0];
  const target=await page.evaluate(candidates=>{for(const c of candidates){const it=GR.itemById(c.id);if(!it||it.locked||c.appearanceSimilarity<.8)continue;for(const [dx,dz] of [[.16,0],[-.16,0],[0,.16],[0,-.16],[.08,0],[-.08,0],[0,.08],[0,-.08]]){const items=structuredClone(GR.state.items),p=items.find(i=>i.id===it.id);p.x+=dx;p.z+=dz;if(!GR.checkPlan(items).length&&p.x>.25&&p.z>.25&&p.x<3.4&&p.z<3.4)return{id:it.id,x:p.x,z:p.z};}}},source.identity.candidates);
  assert.ok(target,'a real appearance candidate has a safe test location');
  const angle=.35,tx=.4,tz=.6,dx=target.x-tx,dz=target.z-tz;
  const d=structuredClone(source);d.metric=true;d.position={x:Math.cos(angle)*dx+Math.sin(angle)*dz,y:.6,z:-Math.sin(angle)*dx+Math.cos(angle)*dz};d.views=4;delete d.planPosition;
  const scan={id:metricId,createdAt:fixture.scan.createdAt,state:'stopped',metric:true,alignment:{angle,tx,tz,floor:0},detections:[d],observedDetections:[d]};
  contract={provenance:'Real OWLv2/PlantCV/appearance record, with explicitly INJECTED metric XR position and alignment for deterministic scene-import contract. Not physical sensor evidence.',target,scan};records.set(metricId,scan);
  const p=proposal(scan,fixture.plan);assert.equal(p.selected,1,JSON.stringify(p.changes[0]));assert.equal(p.changes[0].id,target.id);
  if(process.argv.includes('--record-contract'))fs.writeFileSync(root+'tests/fixtures/scan-metric-contract.json',JSON.stringify(contract,null,2));
 }
 const target=contract.target,before=await position(target.id);
 // Owner journey: Live scan -> history -> review a finished real scan.
 await page.evaluate(()=>GR.scanLive.open());await page.click('#scan-live-history');await page.waitForSelector('[data-review="'+realId+'"]');await page.click('[data-review="'+realId+'"]');await page.waitForSelector('#scan-review-save');
 assert.equal(await page.locator('#scan-review-save').isDisabled(),true);assert.match(await page.locator('[data-message]').textContent(),/no aligned metric/i);results.realScanDoesNotInventMetres='PASS';
 // Actual recorded detection becomes importable after explicit identity and map coordinates.
 const realChange=fixture.scan.proposal.changes.find(c=>c.object&&c.candidates?.some(it=>it.id===target.id));assert.ok(realChange);
 const row=page.locator('[data-object="'+realChange.object+'"]');await row.locator('summary').click();await row.locator('select').selectOption(target.id);await page.waitForTimeout(100);
 await row.locator('summary').click();await row.locator('[data-x]').fill(String(target.x));await row.locator('[data-z]').fill(String(target.z));await row.locator('[data-coords]').click();await page.waitForTimeout(100);
 assert.equal(await page.locator('#scan-review-save').isDisabled(),false);results.realFixtureCanBeManuallyLocated='PASS';
 await page.screenshot({path:out+'scan-real-review-412.png'});
 // Independent injected metric scenario: automatic alignment transform and match.
 await page.evaluate(id=>GR.scanLive.review(id),metricId);await page.waitForSelector('#scan-review-apply:not(:disabled)');
 const p=await page.evaluate(()=>GR.scanLive.layout.proposal());assert.equal(p.selected,1);assert.equal(p.changes[0].id,target.id);assert.equal(p.items.length,fixture.plan.items.length);
 await page.locator('[data-include]').first().uncheck();assert.equal(await page.locator('#scan-review-save').isDisabled(),true);await page.locator('[data-include]').first().check();results.perItemExclusion='PASS';
 discardSave=true;const cachedLayouts=await page.evaluate(()=>localStorage.getItem('gr_layouts'));
 await assert.rejects(page.evaluate(()=>GR.scanLive.layout.save()),/Saved layout could not be verified/);
 assert.equal(await page.evaluate(()=>localStorage.getItem('gr_layouts')),cachedLayouts);assert.equal(layouts.length,0);assert.deepEqual((await position(target.id)).mesh,before.mesh);discardSave=false;results.saveRequiresReadback='PASS';
 await page.click('#scan-review-save');await page.waitForFunction(()=>document.querySelector('[data-message]').textContent.startsWith('Saved Scan '));
 assert.equal(layouts.length,1);assert.ok(layouts[0].name.startsWith('Scan '));assert.ok(Math.abs(layouts[0].items.find(i=>i.id===target.id).x-target.x)<1e-8);assert.deepEqual((await position(target.id)).mesh,before.mesh);results.savedProposalWithoutChangingRoom='PASS';
 for(const width of [360,412,768]) {await page.setViewportSize({width,height:915});await page.screenshot({path:out+`scan-layout-review-ready-${width}.png`});assert.equal(await page.locator('#scan-layout-review').evaluate(el=>el.scrollWidth<=el.clientWidth),true);}
 await page.setViewportSize({width:412,height:915});
 await page.click('#scan-review-apply');await page.waitForTimeout(300);const after=await position(target.id);
 assert.ok(Math.abs(after.mesh[0]-target.x)<1e-8);assert.ok(Math.abs(after.mesh[2]-target.z)<1e-8);assert.notDeepEqual(after.mesh,before.mesh);results.actualThreeMeshesMoved='PASS';
 for(const it of fixture.plan.items)if(it.id!==target.id){const now=await position(it.id);assert.equal(now.item.x,it.x);assert.equal(now.item.z,it.z);}results.unseenItemsPreserved='PASS';
 await page.click('#scan-review-undo');await page.waitForTimeout(100);assert.deepEqual((await position(target.id)).mesh,before.mesh);results.undoRebuildsMeshes='PASS';
 await page.click('#scan-review-apply');await page.locator('[data-close]').click();await page.click('#ar-close');await page.waitForSelector('#gr-ar',{state:'hidden'});await page.evaluate(()=>{GR.closeSheet();GR.setView('top');});await page.waitForTimeout(700);await page.screenshot({path:out+'scan-layout-imported-top.png'});
 await page.waitForTimeout(500);await page.reload();await page.waitForFunction(()=>window.GR?.scanLive);const reloaded=await position(target.id);assert.ok(Math.abs(reloaded.mesh[0]-target.x)<1e-8);results.appliedLayoutSurvivesReload='PASS';
 await page.evaluate(()=>GR.scanLive.history());await page.click('[data-review="'+metricId+'"]');await page.waitForSelector('#scan-review-save');results.finishedScanHistoryReopens='PASS';
 for(const width of [360,412,768]) {await page.setViewportSize({width,height:915});await page.screenshot({path:out+`scan-layout-review-${width}.png`});assert.equal(await page.locator('#scan-layout-review').evaluate(el=>el.scrollWidth<=el.clientWidth),true);}
 // Stale review cannot overwrite concurrent edits.
 await page.evaluate(id=>{GR.moveItem(id,GR.itemById(id).x+.01,GR.itemById(id).z);},target.id);
 await assert.rejects(page.evaluate(()=>GR.scanLive.layout.apply()),/Room changed since review/);results.staleReviewGuard='PASS';
 await page.evaluate(async id=>{const api=GR.api;GR.api=async(path,opts)=>{if(path.endsWith('/proposal')){GR.moveItem(id,GR.itemById(id).x+.01,GR.itemById(id).z);}return api(path,opts);};try{await GR.scanLive.layout.refresh();}finally{GR.api=api;}},target.id);
 await assert.rejects(page.evaluate(()=>GR.scanLive.layout.apply()),/Room changed since review/);results.editDuringReviewRequestGuard='PASS';
 assert.deepEqual(errors,[]);assert.equal(fs.readFileSync(root+'data/state.json','utf8'),owner);results.ownerStateUnchanged='PASS';
 fs.writeFileSync(out+'browser-summary.json',JSON.stringify({target,results,errors},null,2));console.log(JSON.stringify({target,results,errors},null,2));
} finally {await browser.close();}
