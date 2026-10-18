// Real Jev + browser-to-Cerebras conversation; deterministic synthesis delivery seam.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const base=process.argv[2]||'http://127.0.0.1:8790';
const key=fs.readFileSync(new URL('../data/.token',import.meta.url),'utf8').trim();
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
const page=await browser.newPage({viewport:{width:412,height:915},permissions:['microphone']});
const events=[],errors=[];let cerebrasCalls=0,rejectEvents=false;
page.on('pageerror',e=>errors.push(String(e)));
page.on('request',r=>{if(r.url().includes('api.cerebras.ai'))cerebrasCalls++;});
await page.route('**/api/state',r=>r.fulfill({json:r.request().method()==='GET'?{}:{ok:true}}));
await page.route('**/api/zen/progress',r=>r.fulfill({json:r.request().method()==='GET'?{v:1,revision:0}:{ok:true,revision:1}}));
await page.route('**/api/voice/drive?*',r=>r.fulfill({json:{actions:[],after:0}}));
await page.route('**/api/voice/event',r=>{if(rejectEvents)return r.abort();events.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}});});
await page.route('**/api/voice/realtime',r=>r.fulfill({status:502,json:{error:'Qualification: realtime unavailable'}}));
await page.addInitScript(()=>{
 window.__spoken=[];
 Object.defineProperty(window,'speechSynthesis',{value:{cancel(){},speak(utterance){window.__spoken.push(utterance.text);setTimeout(()=>utterance.onend?.(),10);}}});
 window.SpeechRecognition=class {start(){this.onstart?.();}abort(){this.onend?.();}};
});
try {
 await page.goto(`${base}/#k=${key}`);await page.waitForFunction(()=>window.GR?.voice);
 assert.equal(await page.evaluate(()=>GR.voice.mode),'talk');
 await page.click('#voiceMic');
 await page.waitForFunction(()=>GR.voice.on&&GR.voice.mode==='commands');
 assert.ok(await page.evaluate(()=>GR.voice.getState().error.includes('realtime unavailable')));
 await page.waitForFunction(()=>window.__spoken.length>0);
 console.log('PASS token/start failure automatically switches to spoken backup with visible reason');
 const count=await page.evaluate(()=>window.__spoken.length);
 const result=await page.evaluate(()=>GR.voice.inject("hey what's up can you hear me"));
 assert.equal(result.selected_id,'abstain');
 await page.waitForFunction(n=>window.__spoken.length>n,count);
 assert.ok(cerebrasCalls>=1);
 assert.ok(events.some(e=>e.type==='reply'&&e.source==='speechSynthesis'));
 console.log('PASS owner utterance → real Jev abstain → direct browser Cerebras → speechSynthesis.speak',JSON.stringify({cerebrasCalls,replyCount:await page.evaluate(()=>window.__spoken.length)}));
 await page.route('https://api.cerebras.ai/**',r=>r.fulfill({status:503,json:{error:'Qualification outage'}}));
 await page.evaluate(()=>GR.voice.inject('Hello, are you still there?'));
 assert.ok(await page.evaluate(()=>window.__spoken.at(-1).includes('conversation service is unavailable')));
 console.log('PASS conversation-provider outage still delivers a local spoken explanation');
 await page.evaluate(()=>{GR.voice.stop();GR.voice.open();});
 for(const [width,height,name] of [[360,800,'small'],[412,915,'phone'],[1280,900,'wide']]){
  await page.setViewportSize({width,height});await page.waitForTimeout(350);
  const geometry=await page.locator('#voicePanel').boundingBox();assert.ok(geometry.x>=0&&geometry.x+geometry.width<=width);
  await page.screenshot({path:new URL(`../work/shots/voice-fallback-${name}.png`,import.meta.url).pathname});
 }
 rejectEvents=true;
 await page.evaluate(()=>GR.voice.say('Qualification outbox retry'));
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('gr_voice_outbox')||'[]').length>0);
 await page.reload();await page.waitForFunction(()=>window.GR?.voice);
 assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('gr_voice_outbox')||'[]').length>0));
 rejectEvents=false;
 await page.evaluate(()=>window.dispatchEvent(new Event('online')));
 await page.waitForFunction(()=>!localStorage.getItem('gr_voice_outbox'),null,{timeout:10000});
 assert.ok(events.some(e=>e.text==='Qualification outbox retry'));
 console.log('PASS durable event outbox survives reload and retries after server recovery');
 assert.deepEqual(errors,[]);
} finally {await browser.close();}
