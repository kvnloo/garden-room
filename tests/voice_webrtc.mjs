// Optional live WebRTC qualification with a silent synthetic microphone.
// Does not record or send the host microphone. Uses real OAuth mint + GA SDP endpoint.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const base=process.argv[2]||'http://127.0.0.1:8790';
const key=fs.readFileSync(new URL('../data/.token',import.meta.url),'utf8').trim();
const file=path.join(process.env.TMPDIR,`garden-voice-silence-${process.pid}.wav`);
const pcm=Buffer.alloc(48000*2*10),wav=Buffer.alloc(44+pcm.length);
wav.write('RIFF');wav.writeUInt32LE(36+pcm.length,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(pcm.length,40);pcm.copy(wav,44);fs.writeFileSync(file,wav);
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${file}`]});
const ctx=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,permissions:['microphone']});
const page=await ctx.newPage(); const eventLog=[],network=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if(r.url().includes('/realtime/'))network.push({path:new URL(r.url()).pathname,status:r.status()});});
await page.route('**/api/state',r=>r.fulfill({json:r.request().method()==='GET'?{}:{ok:true}}));
let zenProgress={v:1,revision:0};
await page.route('**/api/zen/progress',r=>{if(r.request().method()==='GET')return r.fulfill({json:zenProgress});zenProgress={...r.request().postDataJSON(),revision:zenProgress.revision+1};return r.fulfill({json:{ok:true,revision:zenProgress.revision}});});
await page.route('**/api/voice/drive?*',r=>r.fulfill({json:{actions:[],after:0}}));
await page.route('**/api/voice/event',r=>{eventLog.push(r.request().postDataJSON());return r.fulfill({json:{ok:true}});});
await page.addInitScript(()=>{
 localStorage.removeItem('gr_state');
 const Peer=window.RTCPeerConnection;
 window.__voiceEvents=[];
 window.RTCPeerConnection=class extends Peer { constructor(...args){super(...args); window.__voicePeer=this;} createDataChannel(...args){ const dc=super.createDataChannel(...args);window.__voiceChannel=dc;dc.addEventListener('message',({data})=>{const e=JSON.parse(data);window.__voiceEvents.push({type:e.type,name:e.name,error:e.error?.code,status:e.response?.status,detail:e.response?.status_details?.error?.code,text:e.text,session:e.session?{model:e.session.model,tools:e.session.tools?.map(t=>t.name),instructionsLength:e.session.instructions?.length}:undefined});});return dc;} };
 // This is the Android mic-contention branch, not a mock of the command engine.
 window.SpeechRecognition=class { start(){this.onerror?.({error:'audio-capture'});} abort(){} };
});
try {
 await page.goto(`${base}/#k=${key}`);await page.waitForFunction(()=>window.GR?.voice);
 await page.evaluate(()=>{GR.voice.setMode('talk');GR.voice.open();});
 await page.click('[data-v=toggle]');
 await page.waitForFunction(()=>window.__voicePeer?.connectionState==='connected'&&window.__voiceChannel?.readyState==='open',null,{timeout:45000});
 await page.waitForFunction(()=>document.querySelector('[data-v=status]').textContent.includes('transcript commands'),null,{timeout:10000});
 console.log('PASS live WebRTC GA calls SDP, connected peer + open data channel; mic-contention fallback',JSON.stringify(network));
 await page.evaluate(()=>{
  const emit=e=>window.__voiceChannel.onmessage({data:JSON.stringify(e)});
  emit({type:'input_audio_buffer.speech_started',item_id:'synthetic-test-turn'});
  emit({type:'conversation.item.input_audio_transcription.delta',item_id:'synthetic-test-turn',delta:'open the fridge'});
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'synthetic-test-turn',transcript:'open the fridge'});
 });
 await page.waitForFunction(()=>GR.state.fridgeOpen===true,null,{timeout:15000});
 console.log('PASS Realtime transcription fallback → real Jev → fridge open');
 await page.evaluate(()=>{
  window.__voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Please use your get_app_state tool now to check whether the fridge is open, then answer briefly.'}]}}));
  window.__voiceChannel.send(JSON.stringify({type:'response.create'}));
 });
 await page.waitForFunction(()=>window.__voiceEvents.some(e=>e.type==='response.function_call_arguments.done'&&e.name==='get_app_state'),null,{timeout:20000});
 await page.waitForFunction(()=>window.__voiceEvents.some(e=>['response.output_text.done','response.output_audio_transcript.done','response.audio_transcript.done'].includes(e.type)),null,{timeout:20000});
 assert.ok(eventLog.some(e=>e.source==='gpt_assistant'));
 console.log('PASS real GPT get_app_state tool turn and assistant transcript');
 const toolTurns = await page.evaluate(()=>window.__voiceEvents.filter(e=>e.type==='response.function_call_arguments.done').length); assert.ok(toolTurns>=1);
 await page.waitForFunction(()=>window.__voiceEvents.filter(e=>e.type==='response.created').length===window.__voiceEvents.filter(e=>e.type==='response.done').length,null,{timeout:20000});
 await page.evaluate(()=>{
  window.__voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Tell Hermes this praise exactly: Voice integration test passed. Use tell_hermes with kind praise.'}]}}));
  window.__voiceChannel.send(JSON.stringify({type:'response.create'}));
 });
 await page.waitForFunction(()=>window.__voiceEvents.some(e=>e.type==='response.function_call_arguments.done'&&e.name==='tell_hermes'),null,{timeout:20000});
 await page.waitForTimeout(400);
 assert.ok(eventLog.some(e=>e.type==='tell_hermes'&&e.kind==='praise'));
 console.log('PASS real GPT tell_hermes tool posts feedback');
 const out=new URL('../work/shots/voice-talk.png',import.meta.url).pathname;await page.screenshot({path:out});
 await page.evaluate(()=>GR.voice.stop());
 assert.ok(await page.evaluate(()=>!GR.voice.on&&window.__voicePeer.connectionState==='closed'));
 assert.ok(eventLog.some(e=>e.source==='gpt_user'&&!e.partial)); assert.deepEqual(errors,[]);
 console.log('PASS Talk microphone/peer cleanup and transcript logging; no page errors');
} catch(error) { console.log('Realtime diagnostic events',await page.evaluate(()=>window.__voiceEvents)); throw error; }
finally {await browser.close();fs.unlinkSync(file);}
