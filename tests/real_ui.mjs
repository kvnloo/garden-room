// Mocked playback against this worktree, with actual Spark decoding. No owner API.
import assert from 'node:assert/strict';
import { cameraFixture,photo } from './camera_fixture.mjs';
const f=await cameraFixture();
try{
 const {page:p}=f,camera=await f.camera(),first=photo(camera);
 const developing=photo(camera,{id:'8'.repeat(24),status:{state:'preview',preview:true},base:'/renders/mock/developing/'});
 f.setPhotos([developing]);f.setViews({views:[developing],scene:{url:'/renders/mock/fused.splat',count:3}});
 await p.evaluate(()=>GR.real.refreshPhotos());await p.evaluate(()=>GR.real.goToView(GR.real.photos[0]));
 await p.waitForFunction(()=>document.querySelector('.real-image').classList.contains('developing')&&+getComputedStyle(document.querySelector('.real-image')).opacity>.8);
 assert.ok((await p.locator('.real-image').getAttribute('src')).endsWith('/view.jpg'));
 assert.equal(f.images.some(url=>url.endsWith('preview.png')||url.endsWith('fused.splat')),false,'Developing uses procedural beauty without preview or fused scene');
 f.setPhotos([first]);f.setViews({views:[first],scene:{url:'/renders/mock/fused.splat',count:3}});
 await p.evaluate(()=>GR.real.refreshPhotos());await p.evaluate(()=>GR.real.goToView(GR.real.photos[0]));
 await p.waitForFunction(()=>GR.real.stats.count===1&&+getComputedStyle(document.querySelector('.real-image')).opacity>.99);
 assert.equal(await p.evaluate(()=>GR.renderer.getPixelRatio()),1.25);
 assert.equal(await p.evaluate(()=>GR.real.sceneUrl),'/renders/mock/coarse.splat');
 assert.equal(f.images.includes('/renders/mock/fused.splat'),false,'Selected single-shot avoids fusion ghosting');
 await p.evaluate(()=>{GR.camera.position.x+=.02;GR.controls.target.x+=.02;GR.controls.update();});
 await p.waitForFunction(()=>{const n=+getComputedStyle(document.querySelector('.real-image')).opacity;return n>.05&&n<.95;});
 assert.equal(await p.evaluate(()=>GR.proceduralRoots.some(g=>g.visible)),false);
 await p.evaluate(()=>{GR.camera.position.x+=.3;GR.controls.target.x+=.3;GR.controls.update();});
 await p.waitForFunction(()=>getComputedStyle(document.querySelector('.real-image')).opacity==='0'&&!GR.real.coverage);
 assert.equal(await p.evaluate(()=>GR.proceduralRoots.every(g=>g.visible)),true);
 assert.equal(await p.evaluate(()=>GR.scene.getObjectByName('Selected camera photo splat').visible),false,'Outside validity hides splat too');
 await p.waitForTimeout(1600);assert.equal(f.jobs.length,0);
 const fine={...first,status:{...first.status,splat:{...first.status.splat,fine:{url:'/renders/mock/fine.splat',count:2}}}};
 f.setPhotos([fine]);f.setViews({views:[fine],scene:{url:'/renders/mock/fused.splat',count:3}});
 await p.evaluate(()=>GR.real.refreshPhotos());await p.evaluate(()=>GR.real.goToView(GR.real.photos[0]));
 await p.waitForFunction(()=>GR.real.stats.count===2);assert.equal(await p.evaluate(()=>GR.real.sceneUrl),'/renders/mock/fine.splat');
 await p.evaluate(()=>{const d=GR.controls.target.distanceTo(GR.camera.position);GR.camera.quaternion.multiply(new GR.THREE.Quaternion().setFromAxisAngle(new GR.THREE.Vector3(0,1,0),.27));GR.controls.target.copy(GR.camera.position).addScaledVector(new GR.THREE.Vector3(0,0,-1).applyQuaternion(GR.camera.quaternion),d);GR.controls.update();});
 await p.waitForFunction(()=>!GR.real.coverage&&getComputedStyle(document.querySelector('.real-image')).opacity==='0'&&GR.proceduralRoots.every(g=>g.visible));
 assert.equal(await p.evaluate(()=>GR.proceduralRoots.every(g=>g.visible)),true,'15 degree angular limit');
 // Legacy manifests remain playable when the selected old photo has no own splat.
 const legacy={...first,id:'9'.repeat(24),status:{state:'ready',hq:true}};f.setPhotos([legacy]);f.setViews({views:[legacy],scene:{url:'/renders/mock/legacy.splat',count:3}});
 await p.evaluate(()=>GR.real.refreshPhotos());await p.evaluate(()=>GR.real.goToView(GR.real.photos[0]));await p.waitForFunction(()=>GR.real.stats.count===3);
 await p.evaluate(()=>GR.select('p01'));assert.equal(await p.evaluate(()=>GR.selected),'p01');assert.equal(await p.locator('#hud').isVisible(),true);
 // Late manifest from a prior selection cannot replace the current shot.
 let release;f.setViewsReply(()=>new Promise(r=>{release=r;}));await p.evaluate(()=>{window.oldPoll=GR.real.poll();});
 while(!release)await new Promise(r=>setTimeout(r,10));
 await p.evaluate(()=>{GR.state.items[0].x+=.1;});await p.waitForFunction(()=>GR.real.selected===null&&GR.real.stats.count===0);
 release({views:[first],scene:{url:'/renders/mock/stale.splat',count:8}});await p.evaluate(()=>window.oldPoll);f.setViewsReply(null);
 assert.equal(await p.evaluate(()=>GR.real.sceneUrl),null);
 await p.evaluate(()=>GR.setRealLook(false));assert.equal(await p.evaluate(()=>GR.renderer.getPixelRatio()),2);
 assert.deepEqual(f.errors,[]);assert.equal(f.jobs.length,0);
 console.log('PASS exact photo, smooth motion fade, 15deg/.3m validity, coarse/fine single-shot, legacy fallback, layout/stale guards, HUD and DPR');
}finally{await f.close();}
