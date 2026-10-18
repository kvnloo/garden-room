// Local rrweb capture. Never sends headers, request bodies, storage, or audio.
export async function init(GR) {
  if (GR.replay) return;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/modules/replay.css'; document.head.append(css);
  const indicator = document.createElement('button'); indicator.id = 'replayRec'; indicator.className = 'rr-ignore'; indicator.title = 'Pause private live recording'; indicator.setAttribute('aria-label', 'Pause live recording'); document.body.append(indicator);
  await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = '/vendor/rrweb/rrweb.min.js'; s.onload = resolve; s.onerror = reject; document.head.append(s); });
  let sessionStart = Date.now(), sid = `${sessionStart}-${crypto.randomUUID()}`;
  const originalFetch = window.fetch.bind(window), secrets = [GR.KEY].filter(Boolean);
  const clean = (x) => {
    let s = typeof x === 'string' ? x : JSON.stringify(x, (_, v) => typeof v === 'bigint' ? String(v) : v);
    for (const secret of secrets) s = s.split(secret).join('[redacted]');
    return s.replace(/([?&#](?:k|key|token|access_token|client_secret)=)[^&#\s"<>]*/gi, '$1[redacted]').replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]');
  };
  let paused = localStorage.getItem('gr_replay_paused') === '1', stop, queue = [], inflight = null, batch = 0, sending = false, dropped = 0, bytes = 0, captureMs = [], syncCaptureMs = [], lastFrame = 0, framePending = false, lastTransportError = null;
  const push = (e) => { if (paused) return; try { const safe = JSON.parse(clean(e)); queue.push(safe); if (queue.length > 500) { queue = queue.slice(-250); dropped++; setTimeout(() => { if (!paused) rrweb.record.takeFullSnapshot(); }, 0); } } catch {} };
  const custom = (tag, payload) => push({ type: 5, timestamp: Date.now(), data: { tag: `gr:${tag}`, payload } });
  function start() {
    stop = rrweb.record({ emit: push, checkoutEveryNms: 60000, recordCanvas: false, maskAllInputs: false, maskInputOptions: { password: true, text: true, email: true, textarea: true, tel: true, search: true, url: true }, maskTextSelector: '[data-private],.replay-private', blockSelector: '[data-private],.replay-private,video', inlineImages: false, collectFonts: false,
      sampling: { mousemove: false, mouseInteraction: true, scroll: 200, input: 'last' } });
    custom('lifecycle', { recording: true, viewport: { width: innerWidth, height: innerHeight }, path: location.pathname });
  }
  function paint() { indicator.textContent = paused ? '◌ PAUSED' : '● REC'; indicator.dataset.paused = String(paused); indicator.setAttribute('aria-pressed', String(!paused)); }
  function setPaused(value) {
    if (paused === value) return;
    if (value) { custom('lifecycle', { recording: false }); stop?.(); stop = null; void flush(); }
    paused = value; localStorage.setItem('gr_replay_paused', value ? '1' : '0'); paint(); if (!value) start();
  }
  indicator.onclick = () => setPaused(!paused); paint();
  async function flush(unloading = false) {
    if (sending || (!queue.length && !inflight)) return;
    sending = true;
    if (!inflight) { // Retry the exact batch (server deduplicates sequence numbers).
      let size = 0, n = 0;
      while (n < queue.length) { const z = JSON.stringify(queue[n]).length; if (n && size + z > 1500000) break; size += z; n++; }
      inflight = { session: sid, batch: ++batch, events: queue.splice(0, n) };
    }
    try {
      const body = JSON.stringify(inflight);
      const r = await originalFetch('/api/replay/batch', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Garden-Key': GR.KEY }, body, signal: AbortSignal.timeout(8000), keepalive: unloading && body.length < 60000 });
      if (!r.ok) throw new Error(`Replay transport HTTP ${r.status}`);
      await r.json(); lastTransportError = null;
      bytes += body.length; inflight = null; indicator.dataset.offline = 'false';
      if (!paused && !queue.length && Date.now() - sessionStart > 15 * 60 * 1000) { stop?.(); sessionStart = Date.now(); sid = `${sessionStart}-${crypto.randomUUID()}`; batch = 0; start(); }
    } catch (e) { lastTransportError = clean(String(e)); indicator.dataset.offline = 'true'; } finally { sending = false; }
  }
  const stringify = (v) => { try { return clean(v instanceof Error ? `${v.name}: ${v.message}\n${v.stack || ''}` : v).slice(0, 1800); } catch { return '[unserializable]'; } };
  for (const level of ['log', 'info', 'warn', 'error', 'debug']) { const original = console[level].bind(console); console[level] = (...args) => { original(...args); if (!paused) custom('console', { level, text: args.slice(0, 8).map(stringify).join(' ') }); }; }
  addEventListener('error', (e) => custom('error', { message: stringify(e.message || 'Resource failed'), file: e.filename ? new URL(e.filename, location.href).pathname : e.target?.tagName, line: e.lineno, stack: stringify(e.error || '') }), true);
  addEventListener('unhandledrejection', (e) => custom('rejection', { message: stringify(e.reason) }));
  window.fetch = async (...args) => {
    let path = ''; try { path = new URL(args[0] instanceof Request ? args[0].url : String(args[0]), location.href).pathname; } catch {}
    const t = performance.now();
    try { const r = await originalFetch(...args); if (!r.ok && !path.startsWith('/api/replay/')) custom('fetch', { path, status: r.status, ms: Math.round(performance.now() - t) }); return r; }
    catch (e) { if (!path.startsWith('/api/replay/')) custom('fetch', { path, error: stringify(e), ms: Math.round(performance.now() - t) }); throw e; }
  };
  addEventListener('pointerdown', (e) => { if (e.target.closest?.('#replayRec')) return; const el = e.target.closest?.('button,[data-panel],[data-id],input,canvas') || e.target; custom('tap', { target: el.id || el.getAttribute?.('data-panel') || el.getAttribute?.('data-id') || el.tagName, x: Math.round(e.clientX), y: Math.round(e.clientY) }); }, { passive: true, capture: true });
  let frames = 0, durations = [], lastTick = performance.now(), lastStats = lastTick, lastState = '';
  GR.onFrame((dt) => { if (paused) return; frames++; durations.push(dt * 1000); if (durations.length > 300) durations.shift(); });
  try { new PerformanceObserver((list) => { for (const e of list.getEntries()) custom('longtask', { ms: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: false }); } catch {}
  const sample = document.createElement('canvas'), sampleCtx = sample.getContext('2d', { alpha: false });
  function capture() {
    if (paused || document.hidden || framePending) return;
    const t = performance.now(), capturedAt = Date.now(); framePending = true;
    try {
      const scale = Math.min(1, 900 / Math.max(GR.canvas.width, GR.canvas.height));
      sample.width = Math.round(GR.canvas.width * scale); sample.height = Math.round(GR.canvas.height * scale);
      sampleCtx.drawImage(GR.canvas, 0, 0, sample.width, sample.height);
      syncCaptureMs.push(performance.now() - t); if (syncCaptureMs.length > 100) syncCaptureMs.shift();
      sample.toBlob((blob) => { if (!blob) { framePending = false; return; } const reader = new FileReader(); reader.onload = () => { if (!paused) push({ type: 5, timestamp: capturedAt, data: { tag: 'gr:frame', payload: { id: rrweb.record.mirror.getId(GR.canvas), image: reader.result } } }); captureMs.push(performance.now() - t); if (captureMs.length > 100) captureMs.shift(); lastFrame = Date.now(); framePending = false; }; reader.onerror = () => { framePending = false; }; reader.readAsDataURL(blob); }, 'image/jpeg', 0.68);
    } catch (e) { framePending = false; custom('error', { message: `Canvas capture: ${stringify(e)}` }); }
  }
  function state() {
    if (paused) return;
    const sheet = document.querySelector('#sheet');
    const s = { mode: GR.mode, view: GR.view, selected: GR.selected, sheet: sheet && !sheet.classList.contains('hidden') ? sheet.querySelector('h3')?.textContent?.slice(0, 150) || 'open' : null, voice: { on: !!GR.voice?.on, mode: GR.voice?.mode || 'off' }, ar: { open: [...document.querySelectorAll('[id^="ar-"]')].some((e) => !e.hidden && e.getBoundingClientRect().height > 0), xr: !!GR.renderer.xr?.isPresenting }, viewport: { width: innerWidth, height: innerHeight } };
    const text = JSON.stringify(s); if (text !== lastState) { custom('state', s); lastState = text; }
    const now = performance.now(); if (now - lastStats >= 5000) { const sorted = [...durations].sort((a, b) => a - b); custom('performance', { fps: +(frames * 1000 / (now - lastStats)).toFixed(1), frameP50: sorted[Math.floor(sorted.length * .5)] || 0, frameP95: sorted[Math.floor(sorted.length * .95)] || 0, captureMeanMs: captureMs.reduce((a, b) => a + b, 0) / (captureMs.length || 1), queued: queue.length, dropped, bytes }); frames = 0; lastStats = now; } lastTick = now;
  }
  setInterval(capture, 500); setInterval(state, 500); setInterval(flush, 1000);
  addEventListener('pagehide', () => { custom('lifecycle', { pagehide: true }); void flush(true); });
  addEventListener('visibilitychange', () => { custom('lifecycle', { hidden: document.hidden }); void flush(document.hidden); });
  GR.replay = { get session() { return sid; }, setPaused, async flush() { for (let i = 0; i < 200; i++) { await flush(); if (!sending && !queue.length && !inflight) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('Replay flush timed out'); }, get paused() { return paused; }, get metrics() { return { captureMs: [...captureMs], syncCaptureMs: [...syncCaptureMs], sending, batch, inflightBatch: inflight?.batch, lastTransportError, offline: indicator.dataset.offline === 'true', bytes, dropped, queued: queue.length, lastFrame }; } };
  if (!paused) { start(); capture(); state(); }
}
