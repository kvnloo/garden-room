import assert from 'node:assert/strict';
import { cameraFixture,photo } from './camera_fixture.mjs';
const f=await cameraFixture();
try{
 const {page:p,jobs}=f;
 await p.evaluate(()=>GR.setRealLook(true));await p.waitForTimeout(1700);
 await p.evaluate(()=>{GR.camera.position.x+=.1;GR.controls.update();});await p.waitForTimeout(1700);
 assert.equal(jobs.length,0,'Enabling, movement and idle never create jobs');
 assert.equal(f.mutations.some(path=>path==='/api/render'||path==='/api/real/view'),false);
 await p.click('#real-exit');assert.equal(await p.evaluate(()=>GR.real.enabled),false);
 const before=await f.camera();
 let release;f.setSubmit(()=>new Promise(r=>{release=r;}));
 await p.evaluate(()=>{document.querySelector('#bReal').click();GR.camera.position.x+=.14;GR.controls.update();});
 await p.waitForFunction(()=>GR.real.photos.length===1);while(!release)await new Promise(r=>setTimeout(r,20));
 assert.equal(jobs.length,1);assert.equal(jobs[0].explicit,true,'Backend requires an explicit shutter receipt');assert.deepEqual(jobs[0].camera,before,'Click captures before async work or subsequent movement');
 const feedback=await p.evaluate(()=>window.cameraFeedback);
 assert.equal(feedback.sound,1);assert.ok(feedback.animations.some(a=>a.className==='real-flash'));assert.ok(feedback.animations.some(a=>a.className==='real-flight'&&a.frames[1].transform.includes('scale(.055)')));
 await p.evaluate(c=>{GR.camera.position.fromArray(c.position);GR.controls.target.fromArray(c.target);GR.controls.update();},before);
 await p.waitForFunction(()=>document.querySelector('.real-image').classList.contains('developing')&&+getComputedStyle(document.querySelector('.real-image')).opacity>.8);
 assert.ok((await p.locator('#real-status').textContent()).includes('procedural'));
 assert.ok(jobs[0].view.startsWith('data:image/jpeg'));assert.ok(jobs[0].depth.data);assert.ok(jobs[0].ids.startsWith('data:image/png'));
 await p.click('#real-exit');release({id:'d'.repeat(24),revision:f.revision});await p.waitForTimeout(250);
 assert.equal(await p.evaluate(()=>GR.real.enabled),false,'Receipt cannot reopen a camera the user left');
 const first=photo(before),second=photo(before,{id:'e'.repeat(24),revision:'f'.repeat(24),created:1700000100,plants:[{id:'p01',name:'Newest plant'}]});
 f.setPhotos([first,second]);f.setViews({views:[first],scene:{url:'/renders/mock/fused.splat',count:3}});
 await p.evaluate(()=>GR.almanac.openPhotos());await p.waitForSelector('.alm-photo-card');
 assert.equal(await p.locator('.alm-photo-card').count(),3,'Pending capture remains until published');
 assert.equal(await p.locator('.alm-photo-card').nth(1).getAttribute('data-camera-photo'),`${second.revision}/${second.id}`,'All revisions newest first');
 await p.locator(`[data-camera-photo="${second.revision}/${second.id}"]`).click();
 assert.equal(await p.locator('.alm-photo-plant').count(),1);
 for(const width of [320,768,412]){
   await p.setViewportSize({width,height:915});
   assert.equal(await p.locator('#plant-almanac').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`Photo layout at ${width}px`);
 }
 await p.locator('[data-photo-plant="p01"]').click();await p.waitForSelector('[data-plant="p01"]');
 assert.equal(await p.locator('[data-camera-plant="p01"] [data-camera-photo]').count(),3,'Plant card links captured photos');
 await p.locator(`[data-camera-plant="p01"] [data-camera-photo="${second.revision}/${second.id}"]`).click();
 assert.equal(await p.locator('.alm-photo-plant').count(),1);assert.ok((await p.locator('.alm-photo-pose').textContent()).includes(second.revision));
 await p.locator('[data-photo-go]').click();await p.waitForFunction(()=>GR.real.stats.count===1);
 assert.deepEqual((await f.camera()).position,second.camera.position);assert.equal(await p.evaluate(()=>GR.real.selected.id),second.id);
 let layoutRelease;f.setLayoutReply(()=>new Promise(r=>{layoutRelease=r;}));
 await p.evaluate(()=>{window.oldIdentify=GR.real.identify();});while(!layoutRelease)await new Promise(r=>setTimeout(r,10));
 await p.evaluate(()=>GR.real.goToView(GR.real.photos.find(p=>p.revision==='f'.repeat(24))));
 layoutRelease({revision:f.revision});await p.evaluate(()=>window.oldIdentify);f.setLayoutReply(null);
 assert.equal(await p.evaluate(()=>GR.real.revision),second.revision,'Stale identify cannot select a different revision');
 await p.evaluate(()=>GR.almanac.openPhotos());await p.locator(`[data-camera-photo="${first.revision}/${first.id}"]`).click();await p.locator('[data-photo-walk]').click();
 await p.waitForFunction(()=>GR.real.selected.id==='c'.repeat(24));
 await p.evaluate(()=>GR.real.openPhoto(GR.real.selected));await p.locator('[data-photo-delete]').click();
 await p.waitForFunction(()=>!GR.real.photos.some(p=>p.id==='c'.repeat(24)));
 assert.equal(f.deletions.length,1);assert.equal(f.deletions[0],`/api/real/photo/${first.revision}/${first.id}/delete`);
 assert.equal(await p.evaluate(()=>GR.real.selected),null);
 // A response started before deletion cannot resurrect the deleted photo.
 let oldResolve;f.setPhotosReply(()=>new Promise(r=>{oldResolve=r;}));
 await p.evaluate(()=>{window.oldRefresh=GR.real.refreshPhotos();});while(!oldResolve)await new Promise(r=>setTimeout(r,10));
 f.setPhotosReply(null);await p.evaluate(()=>GR.real.refreshPhotos());oldResolve({photos:[first]});await p.evaluate(()=>window.oldRefresh);
 assert.equal(await p.evaluate(()=>GR.real.photos.some(p=>p.id==='c'.repeat(24))),false);
 await p.evaluate(()=>GR.almanac.close());
 f.setSubmit(null);await p.click('#bReal');await p.waitForTimeout(200);assert.equal(jobs.length,2,'One submission per shutter click');
 assert.equal(await p.locator('#bReal').getAttribute('aria-pressed'),null);
 assert.deepEqual(f.errors,[]);assert.equal(f.images.some(url=>url.endsWith('preview.png')),false);
 assert.equal(f.mutations.some(url=>url==='/api/state'),false,'No owner state writes');
 console.log('PASS camera shutter, exact pose, no idle/movement jobs, leave, gallery, actions, deletion and stale responses');
}finally{await f.close();}
const reduced=await cameraFixture({reducedMotion:'reduce'});
try{
 await reduced.page.click('#bReal');await reduced.page.waitForTimeout(100);
 assert.equal(reduced.jobs.length,1);
 const feedback=await reduced.page.evaluate(()=>window.cameraFeedback);
 assert.equal(feedback.sound,1);assert.equal(feedback.animations.filter(a=>a.className==='real-flight').length,0);
 assert.equal(feedback.animations.find(a=>a.className==='real-flash').options.duration,80);
 assert.equal(await reduced.page.locator('.real-flight').count(),0);
 assert.deepEqual(reduced.errors,[]);console.log('PASS reduced-motion shutter feedback');
}finally{await reduced.close();}
