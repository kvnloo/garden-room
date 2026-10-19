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
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--autoplay-policy=user-gesture-required','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-audio-capture=${file}`]});
const ctx=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true,permissions:['microphone']});
const page=await ctx.newPage(); const eventLog=[],network=[],errors=[];
page.on('pageerror',e=>errors.push(String(e)));
page.on('response',r=>{if((r.url().includes('/realtime/')||r.url().endsWith('/api/voice/realtime')))network.push({path:new URL(r.url()).pathname,status:r.status()});});
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
 assert.equal(await page.evaluate(()=>GR.voice.mode),'talk');
 await page.evaluate(()=>GR.voice.open());
 await page.click('[data-v=toggle]');
 await page.waitForFunction(()=>window.__voicePeer?.connectionState==='connected'&&window.__voiceChannel?.readyState==='open',null,{timeout:45000});
 await page.waitForFunction(()=>GR.voice.getState().transcriptCommands,null,{timeout:10000});
 await page.waitForFunction(()=>{const a=document.querySelector('.voice-audio');return a?.srcObject?.getAudioTracks().some(t=>t.readyState==='live')&&!a.paused;},null,{timeout:15000});
 const playback=await page.evaluate(()=>{const a=document.querySelector('.voice-audio');return {paused:a.paused,muted:a.muted,volume:a.volume,tracks:a.srcObject.getAudioTracks().map(t=>({kind:t.kind,state:t.readyState})),voice:GR.voice.getState()};});
 assert.equal(playback.paused,false);assert.equal(playback.muted,false);
 console.log('PASS live WebRTC remote track + audio playing',JSON.stringify({network,playback}));
 await page.waitForFunction(()=>window.__voiceEvents.some(e=>e.type==='response.done'),null,{timeout:25000});
 await page.waitForFunction(()=>GR.voice.getState().status!=='Speaking');
 const rtp=await page.evaluate(async()=>[...(await window.__voicePeer.getStats()).values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='audio').map(s=>({bytesReceived:s.bytesReceived,totalAudioEnergy:s.totalAudioEnergy,totalSamplesReceived:s.totalSamplesReceived})));
 assert.ok(rtp.some(s=>s.bytesReceived>0&&s.totalAudioEnergy>0),JSON.stringify(rtp));
 console.log('PASS real assistant audio RTP received (nonzero energy)',JSON.stringify(rtp));
 await page.evaluate(()=>{const overlay=document.createElement('div');overlay.id='voice-test-overlay';document.body.append(overlay);GR.voice.mountInto(overlay);});
 assert.equal(await page.locator('#voice-test-overlay #voiceMic').count(),1);
 assert.equal(await page.evaluate(()=>document.querySelectorAll('#voiceMic').length),1);
 assert.ok(await page.evaluate(()=>GR.voice.getState().audioPlaying&&window.__voicePeer.connectionState==='connected'&&window.__voicePeer.getSenders().some(s=>s.track?.kind==='audio'&&s.track.readyState==='live'&&s.track.enabled)));
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));delete document.hidden;});
 assert.ok(await page.evaluate(()=>GR.voice.on&&window.__voicePeer.connectionState==='connected'));
 await page.evaluate(()=>GR.voice.mountInto(null));
 assert.ok(await page.evaluate(()=>GR.voice.getState().audioPlaying&&window.__voicePeer.connectionState==='connected'));
 console.log('PASS same voice orb + live microphone/peer/audio survive overlay mount/unmount');
 await page.evaluate(()=>{
  const audio=document.querySelector('.voice-audio'),play=audio.play.bind(audio);audio.pause();
  audio.play=()=>{audio.play=play;return Promise.reject(new DOMException('Qualification autoplay rejection','NotAllowedError'));};
  window.__voicePeer.ontrack({streams:[audio.srcObject],track:audio.srcObject.getAudioTracks()[0]});
 });
 await page.waitForFunction(()=>GR.voice.getState().audioBlocked);
 assert.equal(await page.locator('#voiceMic').getAttribute('aria-label'),'Resume voice audio');
 await page.click('#voiceMic');
 await page.waitForFunction(()=>GR.voice.on&&!GR.voice.getState().audioBlocked&&GR.voice.getState().audioPlaying);
 console.log('PASS autoplay rejection exposes same-orb Resume; user tap resumes without stopping voice');
 await page.evaluate(()=>{
  const emit=e=>window.__voiceChannel.onmessage({data:JSON.stringify(e)});
  emit({type:'input_audio_buffer.speech_started',item_id:'synthetic-test-turn'});
  emit({type:'conversation.item.input_audio_transcription.delta',item_id:'synthetic-test-turn',delta:'open the fridge'});
  emit({type:'conversation.item.input_audio_transcription.completed',item_id:'synthetic-test-turn',transcript:'open the fridge'});
 });
 await page.waitForFunction(()=>GR.state.fridgeOpen===true,null,{timeout:15000});
 console.log('PASS Realtime transcription fallback → real Jev → fridge open');
 const responsesBefore=await page.evaluate(()=>window.__voiceEvents.filter(e=>e.type==='response.done').length);
 await page.evaluate(()=>{
  window.__voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Please use your get_app_state tool now to check whether the fridge is open, then answer briefly.'}]}}));
  window.__voiceChannel.send(JSON.stringify({type:'response.create'}));
 });
 await page.waitForFunction(()=>window.__voiceEvents.some(e=>e.type==='response.function_call_arguments.done'&&e.name==='get_app_state'),null,{timeout:20000});
 await page.waitForFunction(()=>window.__voiceEvents.some(e=>['response.output_text.done','response.output_audio_transcript.done','response.audio_transcript.done'].includes(e.type)),null,{timeout:20000});
 assert.ok(eventLog.some(e=>e.source==='gpt_assistant'));
 console.log('PASS real GPT get_app_state tool turn and assistant transcript');
 const toolTurns = await page.evaluate(()=>window.__voiceEvents.filter(e=>e.type==='response.function_call_arguments.done').length); assert.ok(toolTurns>=1);
 await page.waitForFunction(n=>window.__voiceEvents.filter(e=>e.type==='response.done').length>=n+2&&window.__voiceEvents.filter(e=>e.type==='response.created').length===window.__voiceEvents.filter(e=>e.type==='response.done').length,responsesBefore,{timeout:25000});
 await page.waitForFunction(()=>GR.voice.getState().status!=='Speaking');
 await page.evaluate(()=>{
  window.__voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Tell Hermes this praise exactly: Voice integration test passed. Use tell_hermes with kind praise.'}]}}));
  window.__voiceChannel.send(JSON.stringify({type:'response.create'}));
 });
 await page.waitForFunction(()=>window.__voiceEvents.some(e=>e.type==='response.function_call_arguments.done'&&e.name==='tell_hermes'),null,{timeout:20000});
 await page.waitForTimeout(400);
 assert.ok(eventLog.some(e=>e.type==='tell_hermes'&&e.kind==='praise'));
 console.log('PASS real GPT tell_hermes tool posts feedback');
 await page.waitForFunction(()=>{const events=window.__voiceEvents;const tool=events.findLastIndex(e=>e.type==='response.function_call_arguments.done'&&e.name==='tell_hermes');return tool>=0&&events.slice(tool+1).some(e=>e.type==='response.output_audio_transcript.done')&&events.filter(e=>e.type==='response.created').length===events.filter(e=>e.type==='response.done').length;},null,{timeout:25000});
 await page.waitForFunction(()=>GR.voice.getState().status!=='Speaking');
 // Natural requests (no tool names): GPT must act on the app itself, not tell him to do it.
 const layoutBefore = await page.evaluate(()=>JSON.stringify(GR.state.items.filter(i=>i.kind==='plant').map(i=>[i.id,i.x,i.z])));
 await page.evaluate(()=>{
  window.__voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'The plants look messy. Can you rearrange them for me? Just pick the best layout and do it.'}]}}));
  window.__voiceChannel.send(JSON.stringify({type:'response.create'}));
 });
 await page.waitForFunction(b=>JSON.stringify(GR.state.items.filter(i=>i.kind==='plant').map(i=>[i.id,i.x,i.z]))!==b,layoutBefore,{timeout:90000});
 const used = await page.evaluate(()=>window.__voiceEvents.filter(e=>e.type==='response.function_call_arguments.done').map(e=>e.name));
 assert.ok(used.some(n=>['suggest_layouts','apply_layout','app_action'].includes(n)), 'GPT used app tools: '+used.join(','));
 console.log('PASS natural "rearrange them" -> GPT tools '+[...new Set(used)].join(',')+' -> plants moved');
 await page.evaluate(()=>{ if(!window.__lastEvt){ window.__lastEvt=Date.now(); const o=window.__voiceChannel.onmessage; window.__voiceChannel.addEventListener('message',()=>{window.__lastEvt=Date.now();}); } });
 await page.waitForFunction(()=>{const ev=window.__voiceEvents;return ev.filter(e=>e.type==='response.created').length===ev.filter(e=>e.type==='response.done').length && Date.now()-window.__lastEvt>3000 && GR.voice.getState().status!=='Speaking';},null,{timeout:60000,polling:250});
 const eggBefore = await page.evaluate(()=>{const p=GR.itemById('p02');return [p.x,p.z];});
 await page.evaluate(()=>{
  window.__voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Move the eggplant to the middle of the room.'}]}}));
  window.__voiceChannel.send(JSON.stringify({type:'response.create'}));
 });
 try { await page.waitForFunction(b=>{const p=GR.itemById('p02');return p.x!==b[0]||p.z!==b[1];},eggBefore,{timeout:60000}); } catch (e) { console.log('DBG', await page.evaluate(()=>JSON.stringify(window.__voiceEvents.filter(e=>/function_call|transcript.done|error/.test(e.type)).slice(-12).map(e=>({t:e.type,n:e.name,a:e.arguments,tr:e.transcript,err:e.error}))))); console.log('DBG recent', await page.evaluate(()=>JSON.stringify((GR.voice.recent||[]).slice(0,4)))); throw e; }
 console.log('PASS natural "move the eggplant" -> eggplant moved');
 const said = await page.evaluate(()=>window.__voiceEvents.filter(e=>['response.output_audio_transcript.done','response.audio_transcript.done'].includes(e.type)).map(e=>e.transcript||'').join(' | '));
 assert.ok(!/yourself|physically|you('ll| will) need to (move|adjust)/i.test(said), 'GPT told owner to do it himself: '+said);
 console.log('GPT said:', said.slice(-400));
 await page.waitForFunction(()=>{const ev=window.__voiceEvents;return ev.filter(e=>e.type==='response.created').length===ev.filter(e=>e.type==='response.done').length;},null,{timeout:40000});
 await page.evaluate(async()=>{
  await GR.ar.open();
  window.__voiceChannel.send(JSON.stringify({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:'Please call ar_action with action measure now to choose the measurement tool. I will start the camera myself.'}]}}));
  window.__voiceChannel.send(JSON.stringify({type:'response.create'}));
 });
 await page.waitForFunction(()=>window.__voiceEvents.some(e=>e.type==='response.function_call_arguments.done'&&e.name==='ar_action'),null,{timeout:20000});
 await page.waitForFunction(()=>document.querySelector('#gr-ar [data-tool=measure]')?.getAttribute('aria-selected')==='true');
 assert.ok(await page.evaluate(()=>GR.voice.on&&GR.voice.getState().audioPlaying));
 console.log('PASS real GPT ar_action → actual GR.ar.setTool(measure), voice still connected in AR overlay');
 const overlayGeometry=await page.evaluate(()=>{const mic=document.querySelector('#voiceMic').getBoundingClientRect(),caption=document.querySelector('#voiceCaption').getBoundingClientRect(),tools=document.querySelector('#gr-ar .ar-bottom').getBoundingClientRect();return {micBottom:mic.bottom,captionBottom:caption.bottom,toolsTop:tools.top};});
 assert.ok(overlayGeometry.micBottom<overlayGeometry.toolsTop&&overlayGeometry.captionBottom<overlayGeometry.toolsTop,JSON.stringify(overlayGeometry));
 await page.screenshot({path:new URL('../work/shots/voice-ar-overlay.png',import.meta.url).pathname});
 await page.click('#ar-close');

 const out=new URL('../work/shots/voice-talk.png',import.meta.url).pathname;await page.screenshot({path:out});
 await page.evaluate(()=>GR.voice.stop());
 assert.ok(await page.evaluate(()=>!GR.voice.on&&window.__voicePeer.connectionState==='closed'));
 assert.ok(eventLog.some(e=>e.source==='gpt_user'&&!e.partial)); assert.deepEqual(errors,[]);
 console.log('PASS Talk microphone/peer cleanup and transcript logging; no page errors');
} catch(error) { console.log('Realtime diagnostic events',await page.evaluate(()=>({events:window.__voiceEvents.slice(-30),count:window.__voiceEvents.length,voice:GR.voice.getState()}))); throw error; }
finally {await browser.close();fs.unlinkSync(file);}
