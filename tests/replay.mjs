// Real phone recording/replay + complaint capture. Never changes owner's saved state.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const base = process.argv[2] || 'http://127.0.0.1:8790';
const key = fs.readFileSync('data/.token', 'utf8').trim();
const out = 'work/replay'; fs.mkdirSync(out, { recursive: true });
const gpu = process.env.REPLAY_GPU === '1';
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: [...(gpu ? ['--use-gl=angle', '--use-angle=gl'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']), '--disable-dev-shm-usage'] });
const gpuInfo = await (await browser.newBrowserCDPSession()).send('SystemInfo.getInfo');
console.log('RENDERER', gpuInfo.gpu.auxAttributes?.glRenderer);
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
await ctx.addInitScript((k) => { localStorage.setItem('gr_key', k); localStorage.removeItem('gr_state'); localStorage.removeItem('gr_replay_paused'); }, key);
const page = await ctx.newPage();
let viewerBrowser;
page.on('pageerror', e => console.log('PAGE_ERROR', e.message));
page.on('response', async r => { if (r.url().includes('/api/replay/batch') && r.status() >= 400) console.log('REPLAY_HTTP_ERROR', r.status(), await r.text()); });
page.on('console', m => { if (m.type() === 'warning' && m.text().startsWith('module')) console.log('MODULE_WARNING', m.text()); });
let zen = { v: 1, revision: 0 };
await page.route('**/api/state', r => r.fulfill({ json: r.request().method() === 'GET' ? {} : { ok: true } }));
await page.route('**/api/layouts', r => r.fulfill({ json: r.request().method() === 'GET' ? [] : { ok: true } }));
await page.route('**/api/zen/progress', r => { if (r.request().method() !== 'GET') zen = { ...r.request().postDataJSON(), revision: zen.revision + 1 }; return r.fulfill({ json: zen }); });
await page.route('**/api/voice/drive?*', r => r.fulfill({ json: { actions: [], after: 0 } }));
try {
  await page.goto(base);
  const cdp = await ctx.newCDPSession(page);
  if (!gpu) { // Host software-renderer import scheduling workaround only.
    await cdp.send('Debugger.enable');
    await page.waitForFunction(() => window.GR, null, { timeout: 20000 });
    await page.evaluate(() => import('/modules/replay.js'));
  }
  await page.waitForFunction(() => window.GR?.replay, null, { timeout: 20000 });
  await page.waitForTimeout(1700);
  const sid = await page.evaluate(() => GR.replay.session);
  await page.tap('[data-mode=edit]');
  await page.tap('[data-panel=items]');
  await page.waitForTimeout(500);
  await page.tap('.tile[data-id=p02]');
  await page.waitForTimeout(600);
  // Deliberate diagnostics: no request payloads/headers should be recorded.
  await page.evaluate(() => { console.error('REPLAY_TEST intentional diagnostic'); setTimeout(() => { throw new Error('REPLAY_TEST thrown error'); }, 0); Promise.reject(new Error('REPLAY_TEST rejection')); void fetch('/api/replay-test-missing').catch(() => {}); });
  await page.waitForTimeout(1600);
  await page.screenshot({ path: out + '/live.png' });
  await page.evaluate(() => GR.replay.flush());
  const at = Date.now();
  const snap = execFileSync('python3', ['tools/replay_snapshot.py', '--session', sid, '--at', String(at), '--output', out + '/snapshot.png'], { encoding: 'utf8', timeout: 30000 });
  console.log('SNAPSHOT', snap.trim());
  const timeline = await (await ctx.request.get(base + '/api/replay/timeline?session=' + sid + '&since=' + (at - 30000), { headers: { 'X-Garden-Key': key } })).json();
  for (const kind of ['tap', 'state', 'console', 'error', 'rejection', 'fetch']) assert(timeline.timeline.some(r => r.kind === kind), 'timeline has ' + kind);
  // Key privacy, including explicit console echo.
  await page.evaluate(k => console.warn('redaction probe', k, '/?k=' + k), key);
  await page.evaluate(() => GR.replay.flush());
  const stored = fs.readdirSync('data/replay/sessions/' + sid).filter(n => n.endsWith('.json') || n.endsWith('.jsonl')).map(n => fs.readFileSync('data/replay/sessions/' + sid + '/' + n, 'utf8')).join('');
  assert(!stored.includes(key), 'app key never persisted');
  assert(stored.includes('[redacted]'), 'key redaction exercised');
  // Explicit complaint kind is supported by the existing voice contract.
  const complaintText = `[test] Replay verification complaint ${sid}. Reply with replay-ok and do nothing else.`;
  const complaint = await ctx.request.post(base + '/api/voice/event', { headers: { 'X-Garden-Key': key }, data: { type: 'complaint', kind: 'complaint', text: complaintText, context: { mode: 'explore', selected: 'p02' } } });
  assert.equal(complaint.status(), 200);
  let context;
  for (let i = 0; i < 35; i++) {
    await page.waitForTimeout(500);
    const files = fs.existsSync('data/voice/inbox_context') ? fs.readdirSync('data/voice/inbox_context') : [];
    for (const f of files) { const c = JSON.parse(fs.readFileSync('data/voice/inbox_context/' + f)); if (c.session === sid && c.at >= at) context = c; }
    if (context?.status === 'ready') break;
  }
  assert.equal(context?.status, 'ready', JSON.stringify(context) || 'No complaint context captured');
  assert(fs.existsSync(context.snapshot)); assert(fs.existsSync(context.timeline)); assert(fs.existsSync(context.errors));
  const complaintRows = JSON.parse(fs.readFileSync(context.timeline, 'utf8'));
  assert(complaintRows.some(r => r.kind === 'voice' && r.data.text === complaintText), 'voice event merged');
  assert(complaintRows.some(r => r.kind === 'complaint' && r.data.text === complaintText), 'complaint marker merged');
  assert(JSON.parse(fs.readFileSync(context.errors, 'utf8')).some(r => JSON.stringify(r).includes('REPLAY_TEST')), 'recent errors bundled');
  console.log('COMPLAINT', JSON.stringify(context));
  // Viewer must attach to the actual session, show current sheet and an actual canvas.
  // Separate process models the real desktop viewer without hiding the phone tab.
  viewerBrowser = await chromium.launch({ executablePath: '/usr/bin/chromium' });
  const viewerContext = await viewerBrowser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await viewerContext.addInitScript(k => localStorage.setItem('gr_key', k), key);
  const viewer = await viewerContext.newPage();
  await viewer.goto(base + '/watch.html?session=' + sid);
  await viewer.waitForFunction(() => window.replayReady && window.replayFrameTs, null, { timeout: 15000 });
  await viewer.waitForTimeout(1600);
  const replaySheet = await viewer.evaluate(() => window.replayPlayer.iframe.contentDocument.querySelector('#sheet')?.textContent);
  assert(replaySheet?.includes('Pot'), 'live viewer reconstructs item sheet');
  await viewer.screenshot({ path: out + '/viewer.png' });
  const latencySamples = [];
  for (let i = 0; i < 5; i++) { latencySamples.push(await viewer.evaluate(() => Date.now() - window.replayFrameTs)); await viewer.waitForTimeout(400); }
  const latency = [...latencySamples].sort((a,b) => a-b)[2];
  console.log('LIVE_FRAME_AGE_MS', JSON.stringify({ median: latency, samples: latencySamples }));
  console.log('LIVE_DIAGNOSTIC', JSON.stringify({ recorder: await page.evaluate(() => ({ hidden: document.hidden, lastFrame: GR.replay.metrics.lastFrame, queued: GR.replay.metrics.queued, sending: GR.replay.metrics.sending, batch: GR.replay.metrics.batch, inflight: GR.replay.metrics.inflightBatch, offline: GR.replay.metrics.offline, error: GR.replay.metrics.lastTransportError })), viewer: await viewer.evaluate(() => ({ frame: window.replayFrameTs, latest: window.replayLastTs, error: window.replayError, status: document.querySelector('#status').textContent })) }));
  assert.equal(await page.evaluate(() => GR.replay.metrics.offline), false, 'live transport stays online');
  if (gpu) assert(latency < 2500, 'live median latency below 2.5 s');
  // Pair OFF/ON/OFF/ON on same renderer after warmup, no viewer concurrently.
  await viewerBrowser.close(); viewerBrowser = null;
  await page.evaluate(() => GR.closeSheet());
  const measures = [];
  for (const recording of [false, true, false, true]) {
    await page.evaluate(on => GR.replay.setPaused(!on), recording); await page.waitForTimeout(700);
    const values = await page.evaluate(() => new Promise(resolve => { let prev = performance.now(), end = prev + 4000, ds = []; function f(t) { ds.push(t - prev); prev = t; if (t < end) requestAnimationFrame(f); else resolve(ds.slice(3)); } requestAnimationFrame(f); }));
    values.sort((a,b) => a-b); measures.push({ recording, frames: values.length, meanMs: values.reduce((a,b)=>a+b,0)/values.length, p50Ms: values[Math.floor(values.length*.5)], p95Ms: values[Math.floor(values.length*.95)] });
  }
  const metrics = await page.evaluate(() => GR.replay.metrics);
  await page.evaluate(() => GR.replay.setPaused(true)); await page.evaluate(() => GR.replay.flush());
  await page.evaluate(() => console.warn('REPLAY_PRIVATE_PAUSE_PROBE')); await page.waitForTimeout(1100);
  const afterPause = fs.readdirSync('data/replay/sessions/' + sid).filter(n => n.endsWith('.json') || n.endsWith('.jsonl')).map(n => fs.readFileSync('data/replay/sessions/' + sid + '/' + n, 'utf8')).join('');
  assert(!afterPause.includes('REPLAY_PRIVATE_PAUSE_PROBE'), 'pause stops diagnostics');
  assert.equal(JSON.parse(fs.readFileSync('data/replay/sessions/' + sid + '/meta.json')).recording, false);
  await page.evaluate(() => GR.replay.setPaused(false));
  fs.writeFileSync(out + '/evidence.json', JSON.stringify({ sid, at, context, latency, latencySamples, measures, metrics, renderer: gpuInfo.gpu.auxAttributes?.glRenderer }, null, 2));
  console.log('OVERHEAD', JSON.stringify(measures)); console.log('CAPTURE', JSON.stringify(metrics));
  assert.equal((await ctx.request.get(base + '/api/replay/sessions')).status(), 401, 'unauthenticated access rejected');
  console.log('PASS replay capture, historical PNG, live DOM/WebGL, voice complaint artifacts, redaction, auth');
} finally { await viewerBrowser?.close(); await browser.close(); }
