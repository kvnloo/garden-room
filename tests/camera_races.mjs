import assert from 'node:assert/strict';
import { cameraFixture,photo } from './camera_fixture.mjs';
const f=await cameraFixture();
try{
 const {page:p}=f;
 // Two explicit taps can wait concurrently; the older receipt cannot take focus.
 const receipts=[];f.setSubmit((data,n)=>new Promise(r=>{receipts[n-1]=r;}));
 await p.evaluate(()=>{document.querySelector('#bReal').click();GR.camera.position.x+=.05;GR.controls.target.x+=.05;GR.controls.update();document.querySelector('#bReal').click();});
 while(receipts.length<2)await new Promise(r=>setTimeout(r,10));
 assert.equal(f.jobs.length,2);assert.notDeepEqual(f.jobs[0].camera.position,f.jobs[1].camera.position);
 receipts[1]({id:'2'.repeat(24),revision:f.revision});await p.waitForFunction(()=>GR.real.selected.id==='2'.repeat(24));
 receipts[0]({id:'1'.repeat(24),revision:f.revision});await p.waitForTimeout(100);
 assert.equal(await p.evaluate(()=>GR.real.selected.id),'2'.repeat(24));
 const camera=await f.camera(),slow=photo(camera,{id:'3'.repeat(24),base:'/renders/mock/slow/',status:{state:'ready',hq:true,splat:{coarse:{url:'/renders/mock/slow.splat',count:1}}}}),fast=photo(camera,{id:'4'.repeat(24),base:'/renders/mock/fast/',status:{state:'ready',hq:true,splat:{coarse:{url:'/renders/mock/fast.splat',count:1}}}});
 let imageRoute,splatRoute;
 await p.route('**/renders/mock/slow/real.png',r=>{imageRoute=r;});
 await p.route('**/renders/mock/slow.splat',r=>{splatRoute=r;});
 f.setPhotos([slow,fast]);f.setViews({views:[slow,fast],scene:null});await p.evaluate(()=>GR.real.refreshPhotos());
 await p.evaluate(()=>GR.real.goToView(GR.real.photos.find(p=>p.id==='3'.repeat(24))));
 while(!imageRoute||!splatRoute)await new Promise(r=>setTimeout(r,10));
 await p.evaluate(()=>GR.real.goToView(GR.real.photos.find(p=>p.id==='4'.repeat(24))));
 await p.waitForFunction(()=>GR.real.sceneUrl==='/renders/mock/fast.splat'&&document.querySelector('.real-image').src.endsWith('/fast/real.png'));
 await imageRoute.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'});
 await splatRoute.fulfill({contentType:'application/octet-stream',body:Buffer.alloc(32)});await p.waitForTimeout(200);
 assert.equal(await p.evaluate(()=>GR.real.sceneUrl),'/renders/mock/fast.splat');
 assert.ok((await p.locator('.real-image').getAttribute('src')).endsWith('/fast/real.png'));
 // Keep the coarse shot on screen until its fine replacement has decoded.
 let fineRoute;await p.route('**/renders/mock/fine-delayed.splat',r=>{fineRoute=r;});
 const fine={...fast,status:{...fast.status,splat:{...fast.status.splat,fine:{url:'/renders/mock/fine-delayed.splat',count:2}}}};
 f.setPhotos([fine]);await p.evaluate(()=>GR.real.refreshPhotos());while(!fineRoute)await new Promise(r=>setTimeout(r,10));
 assert.equal(await p.evaluate(()=>GR.real.sceneUrl),'/renders/mock/fast.splat');assert.equal(await p.evaluate(()=>GR.real.coverage),true);
 const bytes=Buffer.alloc(32);bytes.writeFloatLE(2,0);bytes.writeFloatLE(1,4);bytes.writeFloatLE(2,8);for(let i=12;i<24;i+=4)bytes.writeFloatLE(.02,i);bytes.fill(180,24,27);bytes[27]=255;bytes[28]=255;bytes[29]=bytes[30]=bytes[31]=128;
 await fineRoute.fulfill({contentType:'application/octet-stream',body:bytes});await p.waitForFunction(()=>GR.real.stats.count===2);
 assert.equal(await p.evaluate(()=>GR.real.sceneUrl),'/renders/mock/fine-delayed.splat');
 assert.deepEqual(f.errors,[]);console.log('PASS concurrent shutter receipts, stale image/splat downloads and uninterrupted coarse-to-fine upgrade');
}finally{await f.close();}
