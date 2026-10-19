// A private static origin: no backend, owner token, saved layout or image jobs.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
export async function cameraFixture({reducedMotion='no-preference'}={}) {
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path.startsWith('/api/')){res.writeHead(500);res.end('Unmocked API request');return;}
    const mapping=[['/vendor/three/','node_modules/three/'],['/vendor/spark/','node_modules/@sparkjsdev/spark/'],['/vendor/fonts/','node_modules/@fontsource/']].find(([prefix])=>path.startsWith(prefix));
    const relative=mapping?mapping[1]+path.slice(mapping[0].length):'public/'+(path==='/'?'index.html':path.slice(1));
    const file=resolve(root,relative);
    if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
    try{const bytes=await readFile(file);res.writeHead(200,{'Content-Type':({'.js':'application/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});res.end(bytes);}
    catch{res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',args:['--use-angle=vulkan','--enable-features=Vulkan','--ignore-gpu-blocklist','--enable-gpu']});
  const page=await browser.newPage({viewport:{width:412,height:915},deviceScaleFactor:2,reducedMotion});
  const errors=[],jobs=[],mutations=[],deletions=[],images=[];let photos=[],viewData={views:[],scene:null};
  const revision='a'.repeat(24);
  let submit=null,photosReply=null,viewsReply=null,layoutReply=null;
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/api/**',async r=>{
    const path=new URL(r.request().url()).pathname,method=r.request().method();let json={};
    if(method!=='GET')mutations.push(path);
    if(path==='/api/real/view'){
      const data=r.request().postDataJSON();jobs.push(data);
      json=submit?await submit(data,jobs.length):{id:String(jobs.length).padStart(24,'b'),revision};
    }else if(path==='/api/real/layout')json=layoutReply?await layoutReply():{revision};
    else if(path==='/api/real/photos')json=photosReply?await photosReply():{photos};
    else if(path.endsWith('/views'))json=viewsReply?await viewsReply(path):viewData;
    else if(path.endsWith('/delete')){deletions.push(path);const [,rev,id]=path.match(/photo\/([^/]+)\/([^/]+)\/delete/);photos=photos.filter(p=>p.id!==id||p.revision!==rev);json={ok:true};}
    else if(path==='/api/layouts')json=[];
    else if(path==='/api/zen/progress')json={v:1,revision:0};
    else if(path==='/api/almanac/species')json={families:{},sources:{},note:'Mock reference',reviewed:'2026-10-18'};
    else if(path.startsWith('/api/history/'))json={photos:[]};
    else if(method!=='GET')json={ok:true};
    await r.fulfill({json});
  });
  await page.route('**/renders/mock/**',r=>{
    images.push(new URL(r.request().url()).pathname);
    if(r.request().url().endsWith('.splat')){
      const bytes=Buffer.alloc(32);bytes.writeFloatLE(2,0);bytes.writeFloatLE(1,4);bytes.writeFloatLE(2,8);for(let k=12;k<24;k+=4)bytes.writeFloatLE(.02,k);bytes.fill(180,24,27);bytes[27]=255;bytes[28]=255;bytes[29]=bytes[30]=bytes[31]=128;
      return r.fulfill({contentType:'application/octet-stream',body:bytes});
    }
    return r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="412" height="915"><rect width="412" height="915" fill="#485b32"/></svg>'});
  });
  await page.addInitScript(()=>{
    window.cameraFeedback={sound:0,animations:[]};
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(frames,options){
      if(this.classList.contains('real-flash')||this.classList.contains('real-flight'))window.cameraFeedback.animations.push({className:this.className,frames,options});
      return animate.call(this,frames,options);
    };
    const Audio=window.AudioContext;
    if(Audio)window.AudioContext=class extends Audio {createOscillator(){window.cameraFeedback.sound++;return super.createOscillator();}};
    localStorage.clear();localStorage.setItem('gr_state',JSON.stringify({room:{v:3,h:2.6,poly:[[3.66,0],[3.66,2.56],[2.56,3.66],[0,3.66],[0,0]],edgeNames:['East','SE','South','West','North'],window:{facing:'north',edge:4,t0:1.05,t1:2.65,sill:.78,top:2.15},openings:[]},items:[{id:'p01',kind:'plant',name:'Test plant',family:'plectranthus',src:'plants/p01.webp',potD:.25,potH:.18,height:.45,w:.25,d:.25,h:.63,x:1,z:1,rot:0,light:'med'}]}));
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>window.GR?.real&&GR.almanac);
  await page.evaluate(()=>{GR.controls.enableDamping=false;GR.controls.update();});
  return {page,errors,jobs,mutations,deletions,images,revision,
    setPhotos(value){photos=value;},setViews(value){viewData=value;},setSubmit(fn){submit=fn;},setPhotosReply(fn){photosReply=fn;},setViewsReply(fn){viewsReply=fn;},setLayoutReply(fn){layoutReply=fn;},
    async camera(){return page.evaluate(()=>{GR.camera.updateMatrixWorld();return {position:GR.camera.position.toArray(),quaternion:GR.camera.quaternion.toArray(),matrixWorld:GR.camera.matrixWorld.toArray(),target:GR.controls.target.toArray(),fov:GR.camera.fov,aspect:GR.camera.aspect,near:GR.camera.near,far:GR.camera.far};});},
    async close(){await browser.close();await new Promise(r=>server.close(r));}
  };
}
export function photo(camera,overrides={}) {
  return {id:'c'.repeat(24),revision:'a'.repeat(24),base:'/renders/mock/first/',camera,plants:[{id:'p01',name:'Test plant'}],created:1700000000,status:{state:'ready',hq:true,splat:{coarse:{url:'/renders/mock/coarse.splat',count:1}}},...overrides};
}
