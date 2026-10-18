import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const summary=JSON.parse(fs.readFileSync('work/scan_live_evidence/summary.json','utf8')),key=fs.readFileSync('data/.token','utf8').trim();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:412,height:915}}),errors=[];
page.on('pageerror',e=>errors.push(String(e)));
await page.addInitScript(k=>localStorage.setItem('gr_key',k),key);
try{
 await page.goto('http://127.0.0.1:8790'+summary.viewer);
 await page.waitForFunction(()=>window.scanViewer?.count>0,{timeout:30000});
 const result=await page.evaluate(()=>window.scanViewer);assert.equal(result.count,summary.splatGaussians);assert.equal(result.metric,false);
 await page.evaluate(()=>new Promise(resolve=>{let n=0;function frame(){if(++n>20)resolve();else requestAnimationFrame(frame);}frame();}));
 await page.screenshot({path:'work/shots/scan-live-real-splat.png'});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({actualSparkDecodedGaussians:result.count,metric:false,viewer:summary.viewer,jsErrors:errors,screenshot:'work/shots/scan-live-real-splat.png'}));
}finally{await browser.close();}
