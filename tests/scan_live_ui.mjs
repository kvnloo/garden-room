// Actual phone UI/voice control placement; no microphone, camera or model call.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const key=fs.readFileSync('data/.token','utf8').trim(),browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 for(const width of [360,412,768]){
  const page=await browser.newPage({viewport:{width,height:width===360?800:915},hasTouch:true});
  await page.route('**/api/state',r=>r.fulfill({json:r.request().method()==='GET'?{}:{ok:true}}));
  await page.route('**/api/ar/calib',r=>r.fulfill({json:null}));
  await page.addInitScript(()=>Object.defineProperty(navigator,'xr',{value:{isSessionSupported:async()=>false},configurable:true}));
  await page.goto(`http://127.0.0.1:8790/#k=${key}`);await page.waitForFunction(()=>window.GR?.ar&&window.GR?.scanLive&&window.GR?.voice);
  await page.tap('[data-panel=live]');await page.tap('[data-panel=scan_live]');await page.waitForSelector('#ar-voice .voice-control');
  const measurements=await page.evaluate(()=>{const orb=document.querySelector('#ar-voice .voice-control').getBoundingClientRect(),bottom=document.querySelector('.ar-bottom').getBoundingClientRect();return{orb:{top:orb.top,bottom:orb.bottom,left:orb.left,right:orb.right},bottomTop:bottom.top,overflow:document.querySelector('.ar-bottom').scrollWidth>document.querySelector('.ar-bottom').clientWidth};});
  assert.equal(measurements.overflow,false);assert.ok(measurements.orb.bottom<measurements.bottomTop);assert.ok(measurements.orb.right<=width);
  await page.screenshot({path:`work/shots/scan-live-ui-${width}.png`});await page.close();
 }
 console.log('PASS: actual voice orb mounted in AR root, no horizontal overflow or orb/control overlap at 360/412/768 px');
}finally{await browser.close();}
