// Voice unit + live-provider phone tests. Never reads/writes the owner's layout.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { buildActionTable, decisionTable, parseMeasurement, parseParameters } from '../public/modules/voice.js';
const base = process.argv[2] || 'http://127.0.0.1:8790';
const key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
const out = new URL('../work/shots/', import.meta.url).pathname; fs.mkdirSync(out, { recursive: true });
const fake = { selected: 'p02', state: { room: { poly: [[0,0],[4,0],[4,4],[0,4]], window: { edge: 3, t0: 1, t1: 3 } }, items: [{ id: 'p02', kind: 'plant', name: 'Eggplant', w: .3, d: .3, rot: 0 }, { id: 'fridge', name: 'Fridge', kind: 'fridge', locked: true }] } };
const table = buildActionTable(fake);
for (const action of ['fridge_open','fridge_close','light_on','light_off','mode_edit','mode_explore','view_top','view_overview','view_eye','select:p02','move:p02','set_size:p02','rotate:p02','lock:p02','unlock:fridge','history:p02','open:zen','open:ar','ar_ruler','suggest','undo','reobserve','abstain']) assert.ok(table[action], action);
assert.ok(!table['move:fridge']); assert.ok(!table['unlock:p02']);
const large = { ...fake, state: { ...fake.state, items: Array.from({length:200},(_,n)=>({id:`p${n}`,name:`Plant number ${n}`,kind:'plant'})) } };
assert.ok(Object.keys(buildActionTable(large)).length>255);
assert.ok(Object.keys(decisionTable(large,'set p123 pot to 18 inches')).length<100);
assert.ok(decisionTable(large,'set p123 pot to 18 inches')['set_size:p123']);
assert.equal(parseMeasurement('18 inches'), .4572); assert.equal(parseMeasurement(30, 'cm'), .3); assert.equal(parseMeasurement('2 ft'), .6096);
assert.throws(() => parseMeasurement('18')); assert.throws(() => parseMeasurement(-2,'in')); assert.throws(() => parseMeasurement(Infinity,'m'));
assert.deepEqual(parseParameters({ property:'potD',value:18,unit:'in' }, 'set_size:p02', fake), { potD:.4572 });
assert.throws(() => parseParameters({ property:'w',value:18,unit:'in' }, 'set_size:p02', fake));
assert.throws(() => parseParameters({x:99,z:1},'move:p02',fake));
assert.deepEqual(parseParameters({place:'window'}, 'move:p02', fake), {x:.3,z:2});
assert.deepEqual(parseParameters({turns:-1}, 'rotate:p02', fake), {turns:3});
console.log('PASS action table + units + bounds + locked-item unit tests');

async function api(path, body) {
 const response = await fetch(base+'/api/voice/'+path,{method:body ? 'POST':'GET',headers:{'X-Garden-Key':key,'Content-Type':'application/json'},body:body ? JSON.stringify(body):undefined});
 const result=await response.json(); assert.equal(response.status,200,result.error); return result;
}
const start=performance.now(); const decision=await api('jev',{state:{utterance:'open the fridge'},model:'jev-latest',questions:{next_action:{type:'choice',instructions:'Choose the explicitly requested action.',criteria:{fridge_open:'Open fridge',fridge_close:'Close fridge',reobserve:'Ambiguous',abstain:'Conversation only'}}}});
assert.equal(decision.selected_id,'fridge_open'); assert.ok(decision.confidence>=.65);
console.log('PASS real Jev',JSON.stringify({...decision,wall_ms:Math.round(performance.now()-start)}));
const secret=await api('realtime',{}); assert.ok(secret.value.length>20); assert.ok(secret.expires_at>Date.now()/1000);
console.log('PASS Realtime client secret',JSON.stringify({length:secret.value.length,expires_at:secret.expires_at}));
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const ctx=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:2.6,isMobile:true,hasTouch:true});
const page=await ctx.newPage(); const errors=[], events=[];
page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/api/state',r=>r.fulfill({json:r.request().method()==='GET'?{}:{ok:true}}));
let zenProgress={v:1,revision:0};
await page.route('**/api/zen/progress',r=>{if(r.request().method()==='GET')return r.fulfill({json:zenProgress});zenProgress={...r.request().postDataJSON(),revision:zenProgress.revision+1};return r.fulfill({json:{ok:true,revision:zenProgress.revision}});});
await page.route('**/api/voice/drive?*',r=>r.fulfill({json:{actions:[],after:0}}));
await page.route('**/api/layouts',r=>r.fulfill({json:r.request().method()==='GET'?[]:{ok:true}}));
await page.route('**/api/voice/event',r=>{events.push(r.request().postDataJSON()); return r.fulfill({json:{ok:true}});});
await page.addInitScript(()=>{
 localStorage.removeItem('gr_state'); localStorage.removeItem('gr_voice_drive');
 window.SpeechRecognition=class { start(){this.onstart?.();} abort(){this.onend?.();} };
});
try {
 await page.goto(`${base}/#k=${key}`);
 await page.waitForFunction(()=>window.GR?.voice && document.querySelector('#score').textContent!=='–',null,{timeout:60000});
 let result=await page.evaluate(()=>GR.voice.inject('open the fridge'));
 assert.equal(result?.selected_id,'fridge_open',JSON.stringify(result)); assert.ok(await page.evaluate(()=>GR.state.fridgeOpen));
 console.log('PASS live transcript → real Jev → fridge open');
 result=await page.evaluate(()=>GR.voice.inject('make the eggplant pot 18 inches'));
 assert.equal(result?.selected_id,'set_size:p02',JSON.stringify(result));
 assert.ok(await page.evaluate(()=>Math.abs(GR.itemById('p02').potD/.0254-18)<.001));
 console.log('PASS live transcript → real Jev → direct Cerebras → eggplant pot 18 inches');
 await page.evaluate(()=>GR.voice.inject('undo'));
 assert.ok(await page.evaluate(()=>Math.abs(GR.itemById('p02').potD/.0254-18)>.01));
 console.log('PASS voice undo restores previous state');
 // A low-confidence choice must never mutate state, even if the chosen id is valid.
 await page.route('**/api/voice/jev',r=>r.fulfill({json:{selected_id:'fridge_close',confidence:.4,latency_ms:1}}));
 await page.evaluate(()=>GR.voice.inject('close fridge'));
 assert.ok(await page.evaluate(()=>GR.state.fridgeOpen)); console.log('PASS low confidence rejected');
 await page.unroute('**/api/voice/jev');
 await page.evaluate(()=>GR.voice.open()); await page.waitForTimeout(600);
 for (const [name,width,height] of [['phone',412,915],['small',360,800],['wide',1280,900]]) {
  await page.setViewportSize({width,height}); await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))); await page.waitForTimeout(300);
  const geometry=await page.evaluate(()=>{ const root=document.querySelector('#voicePanel'); const rect=root.getBoundingClientRect(); const mic=document.querySelector('#voiceMic').getBoundingClientRect(); return {rect:{left:rect.left,right:rect.right},width:innerWidth,mic:{left:mic.left,right:mic.right,width:mic.width,height:mic.height},buttons:[...root.querySelectorAll('button')].map(b=>({w:b.offsetWidth,h:b.offsetHeight}))}; });
  assert.ok(geometry.rect.left>=0 && geometry.rect.right<=width); assert.ok(geometry.mic.left>=0&&geometry.mic.right<=width&&geometry.mic.width>=44&&geometry.mic.height>=44); assert.ok(geometry.buttons.every(b=>b.w>=44&&b.h>=44));
  await page.screenshot({path:out+`voice-${name}.png`});
 }
 assert.ok(events.some(e=>e.type==='utterance')); assert.ok(events.some(e=>e.type==='action'&&e.action==='set_size:p02'&&e.success));
 await page.route('**/api/history/plant/p02',r=>r.fulfill({json:{photos:[]}}));
 await page.evaluate(()=>GR.voice.execute('history:p02')); assert.ok(await page.locator('#plant-history').count());
 await page.evaluate(()=>GR.voice.execute('ar_ruler')); assert.ok(await page.locator('#gr-ar [data-tool=ruler][aria-selected=true]').count());
 await page.click('#ar-close');
 console.log('PASS current history item-action and AR ruler integrations');
 await page.route('**/api/voice/rules',r=>r.fulfill({json:{aliases:{'icebox please':'fridge_close'},vocabulary:['eggplant']}}));
 await page.unroute('**/api/voice/drive?*');
 await page.route('**/api/voice/drive?*',r=>{const after=Number(new URL(r.request().url()).searchParams.get('after'));return r.fulfill({json:{actions:after<77?[{id:77,action:'view_eye',params:{},say:'Eye level'}]:[],after:77}});});
 const loaded=page.waitForResponse(r=>r.url().endsWith('/api/voice/rules'));
 await page.evaluate(()=>{GR.voice.setMode('commands');return GR.voice.start();}); await loaded;
 await page.waitForFunction(()=>GR.view==='eye'&&localStorage.getItem('gr_voice_drive')==='77');
 let jevCalls=0; page.on('request',r=>{if(r.url().endsWith('/api/voice/jev'))jevCalls++;});
 result=await page.evaluate(()=>GR.voice.inject('icebox please'));
 assert.equal(result.selected_id,'fridge_close'); assert.ok(!await page.evaluate(()=>GR.state.fridgeOpen)); assert.equal(jevCalls,1);
 await page.evaluate(()=>GR.voice.stop());
 console.log('PASS Hermes drive cursor and aliases; all final transcripts still classified');
 assert.deepEqual(errors,[]); console.log('PASS event capture, phone/small/wide layout, 44px controls, no page errors');
} finally { await browser.close(); }
