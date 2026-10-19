// Preserve the metric-conditioning checks without the legacy idle-generation test.
import assert from 'node:assert/strict';
import { cameraFixture } from './camera_fixture.mjs';
const f=await cameraFixture();
try{
 const result=await f.page.evaluate(()=>{
   const T=GR.THREE,root=GR.proceduralRoots[0],saved=GR.proceduralRoots.flatMap(g=>g.children.map(o=>[o,o.visible]));
   saved.forEach(([o])=>o.visible=false);
   const cube=new T.InstancedMesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial(),1);
   cube.setMatrixAt(0,new T.Matrix4().makeTranslation(2,2,1));root.add(cube);
   const overlay=new T.Mesh(new T.PlaneGeometry(2,2),new T.MeshBasicMaterial({color:0x00ff00}));overlay.position.set(2,2,2);GR.scene.add(overlay);
   try{
     GR.camera.position.set(2,2,4);GR.controls.target.set(2,2,1);GR.controls.update();
     const target=GR.renderer.getRenderTarget(),c=GR.real.capture(),bytes=Uint8Array.from(atob(c.depth.data),s=>s.charCodeAt(0)),depth=new Float32Array(bytes.buffer);
     const snapshot=c.layout.room.h;GR.state.room.h+=.1;const detached=c.layout.room.h===snapshot;GR.state.room.h-=.1;
     return {center:depth[Math.floor(c.depth.height/2)*c.depth.width+Math.floor(c.depth.width/2)],outside:depth[0],matrix:c.camera.matrixWorld,actual:GR.camera.matrixWorld.toArray(),aspect:c.camera.aspect,actualAspect:GR.camera.aspect,targetRestored:GR.renderer.getRenderTarget()===target,overlayRestored:overlay.visible,detached};
   }finally{
     root.remove(cube);cube.geometry.dispose();cube.material.dispose();GR.scene.remove(overlay);overlay.geometry.dispose();overlay.material.dispose();saved.forEach(([o,v])=>o.visible=v);
   }
 });
 assert.ok(Math.abs(result.center-2.5)<.002,'Instanced cube is 2.5m from camera');assert.equal(result.outside,0);
 assert.deepEqual(result.matrix,result.actual);assert.equal(result.aspect,result.actualAspect);
 assert.equal(result.targetRestored,true);assert.equal(result.overlayRestored,true);assert.equal(result.detached,true);
 assert.equal(f.jobs.length,0);assert.deepEqual(f.errors,[]);
 console.log('PASS exact camera, metric instanced depth, overlay exclusion/restoration and immutable layout snapshot');
}finally{await f.close();}
