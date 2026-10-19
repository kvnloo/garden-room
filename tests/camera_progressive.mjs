// Both assets ready on first lookup must still consume/render coarse before fine.
import assert from 'node:assert/strict';
import {cameraFixture,photo} from './camera_fixture.mjs';
const f=await cameraFixture();
try{
 const camera=await f.camera();
 const shot=photo(camera,{status:{state:'ready',hq:true,splat:{coarse:{url:'/renders/mock/progressive-coarse.splat',count:1},fine:{url:'/renders/mock/progressive-fine.splat',count:2}}}});
 f.setPhotos([shot]);f.setViews({views:[shot],scene:null});
 const ready=[];
 await f.page.exposeFunction('recordScene',url=>ready.push(url));
 await f.page.evaluate(()=>{let previous;GR.onFrame(()=>{const next=GR.real.sceneUrl;if(next&&next!==previous){previous=next;void window.recordScene(next);}});});
 await f.page.evaluate(p=>GR.real.goToView(p),shot);
 await f.page.waitForFunction(()=>GR.real.stats.count===2);
 const consumed=f.images.filter(url=>url.endsWith('.splat'));
 assert.deepEqual(consumed,['/renders/mock/progressive-coarse.splat','/renders/mock/progressive-fine.splat']);
 assert.deepEqual(ready,['/renders/mock/progressive-coarse.splat','/renders/mock/progressive-fine.splat']);
 assert.equal(f.jobs.length,0);assert.deepEqual(f.errors,[]);
 console.log('PASS already-ready coarse/fine assets download and render in order without generation');
}finally{await f.close();}
