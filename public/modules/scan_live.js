import { RawCamera } from './scan-camera.js';

export function init(GR) {
  const T = GR.THREE;
  let active = false, id = null, seq = 0, busy = false, raw = null, mode = null, lastCapture = 0, lastResult = 0, result = null, error = null, generation = 0;
  let overlay = null, boxes = null, attached = false, interval = null, video = null, stream = null, orientation = null, controller = null;
  const spoken = new Set(), imageCanvas = document.createElement('canvas'), context = imageCanvas.getContext('2d');
  const plan = () => ({ room: { poly: GR.state.room.poly }, items: GR.state.items.map(({ id, name, kind, x, z, w, d, h, potD, potH, height, locked }) => ({ id, name, kind, x, z, w, d, h, potD, potH, height, locked })) });
  function say(text) { try { GR.voice?.say?.(text); } catch {} }
  function status() { return { active, id, mode, state: active ? mode === 'needs-camera' ? 'needs-camera-fallback' : 'scanning' : error ? 'error' : 'stopped', error, frames: seq, busy, lastResult, timings: result?.timings, geometry: result?.geometry, splat: result?.splat }; }
  function attach() {
    if (attached || !GR.ar || !document.querySelector('#ar-scan')) return;
    attached = true; overlay = document.querySelector('#ar-scan');
    overlay.innerHTML = `<p class="sub">Live recognition stays on your server. Scan slowly sideways, not just turn the phone. Objects need multiple views or depth before they appear on the plan.</p><div class="row"><button class="btn gold" id="scan-live-start">Begin live scan</button><button class="btn" id="scan-live-stop" disabled>Stop scan</button><button class="btn" id="scan-live-camera" hidden>Use 2D camera instead</button></div><p id="scan-live-state" class="sub" role="status" aria-live="polite">Camera and microphone are separate permissions.</p><div id="scan-live-detections"></div><div id="scan-live-corrections"></div><a id="scan-live-splat" class="btn" hidden target="_blank" rel="noopener">View live 3D splat</a>`;
    overlay.querySelector('#scan-live-start').onclick = () => start().catch(fail);
    overlay.querySelector('#scan-live-stop').onclick = () => stop();
    overlay.querySelector('#scan-live-camera').onclick = () => fallback().catch(fail);
    GR.ar.onXRFrame(onXRFrame);
    GR.ar.onLifecycle((event) => {
      if (event === 'end') { raw?.dispose(); raw = null; if (boxes) { disposeBoxes(); boxes.removeFromParent(); boxes = null; } if (active && mode !== 'switching') stop(); }
      if (event === 'reset' && active) { stop().then(() => { error = 'Tracking origin reset. Begin a new scan so old poses are never mixed with the new origin.'; render(); }); }
    });
    render();
  }
  GR.onFrame(attach); attach();
  function fail(e) { error = e?.message || String(e); render(); GR.toast(error, 5000); }
  function render() {
    if (!overlay) return;
    const root = document.querySelector('#gr-ar'); if (root) root.dataset.scanActive = String(active);
    overlay.querySelector('#scan-live-start').disabled = active;
    overlay.querySelector('#scan-live-stop').disabled = !active;
    overlay.querySelector('#scan-live-camera').hidden = mode !== 'needs-camera';
    const text = error || (active ? mode === 'needs-camera' ? 'AR works, but Chrome did not grant raw camera access. End AR with the button below to scan in 2D; no metric layout changes will be claimed.' : `${mode === 'imu' ? '2D camera · no metric depth' : 'AR camera · exact posed keyframes'} · ${seq} frames${result?.timings ? ` · ${Math.round(result.timings.total)} ms GPU pipeline` : ' · waiting for camera'}` : 'Scan stopped. Start shares keyframes with your private server only.');
    overlay.querySelector('#scan-live-state').textContent = text;
    const list = overlay.querySelector('#scan-live-detections'); list.replaceChildren();
    for (const d of (result?.detections || []).slice(0, 12)) {
      const row = document.createElement('p'); row.className = 'scan-object micro';
      row.textContent = `${d.label} · ${Math.round(d.confidence * 100)}%${d.position ? ' · 3D estimate' : ' · waiting for depth / parallax'}${d.identity ? ` · ${d.identity.status === 'unsure' ? 'plant identity unsure' : d.identity.candidates[0].name}` : ''}${d.plant ? ` · green area ${d.plant.projectedLeafAreaPx} px²${d.plant.widthM ? ` · foliage ~${Math.round(d.plant.widthM * 100)} × ${Math.round(d.plant.heightM * 100)} cm` : ''}${Number.isFinite(d.plant.excessGreen) ? ` · ExG ${d.plant.excessGreen.toFixed(2)} (colour proxy)` : ''}` : ''}`; list.append(row);
    }
    const corrections = overlay.querySelector('#scan-live-corrections'); corrections.replaceChildren();
    for (const c of result?.corrections || []) {
      const row = document.createElement('div'); row.className = 'row scan-correction'; const text = document.createElement('span'); text.textContent = `${c.name} · move ~${Math.round(c.distanceM * 100)} cm${c.props?.height ? ` · foliage ~${Math.round(c.props.height * 100)} cm` : ''}`;
      const button = document.createElement('button'); button.className = 'btn'; button.textContent = 'Apply'; button.onclick = () => apply(c.object); row.append(text, button); corrections.append(row);
    }
    const link = overlay.querySelector('#scan-live-splat'); link.hidden = !result?.splat?.url;
    if (id) link.href = `/scan-live-view.html?s=${encodeURIComponent(id)}`;
  }
  async function serverStart() {
    const r = await GR.api('/api/scan_live/start', { method: 'POST', body: JSON.stringify({ plan: plan() }) });
    if (r.error || !r.id) throw new Error(r.error || 'GPU scan could not start');
    return r;
  }
  async function open() { attach(); await GR.ar?.open(); GR.ar?.setTool('scan'); }
  async function start() {
    attach(); if (active) return status();
    if (!GR.ar) throw new Error('AR tools are still loading. Try again.');
    error = null; result = null; seq = 0; spoken.clear(); active = true; mode = 'starting'; const gen = ++generation; render();
    // requestSession happens BEFORE the first await, preserving the tap gesture.
    const opening = GR.ar.open(); GR.ar.setTool('scan');
    const starting = GR.ar.start();
    try {
      const created = await serverStart();
      if (gen !== generation || !active) { await GR.api(`/api/scan_live/${created.id}/stop`, { method: 'POST', body: '{}' }).catch(() => {}); return status(); }
      id = created.id; await starting; await opening; GR.ar.setTool('scan');
      if (gen !== generation) { if (id) GR.api(`/api/scan_live/${id}/stop`, { method: 'POST', body: '{}' }).catch(() => {}); return status(); }
      mode = GR.ar.status().active ? 'webxr' : 'needs-camera';
      if (!GR.ar.status().active) mode = 'needs-camera';
      say('Scan started. Move slowly sideways so I can locate the furniture.'); render(); return status();
    } catch (e) { if (gen === generation) { await stop(); fail(e); } throw e; }
  }
  async function stop() {
    const old = id; active = false; ++generation; busy = false; controller?.abort(); controller = null;
    raw?.dispose(); raw = null; clearInterval(interval); interval = null; stream?.getTracks().forEach((t) => t.stop()); stream = null;
    video?.remove(); video = null; document.querySelector('#scan-video-boxes')?.remove(); window.removeEventListener('deviceorientation', onOrientation);
    disposeBoxes(); if (boxes) boxes.visible = false; id = null;
    if (mode === 'imu') GR.ar?.setVideoMode?.(false);
    mode = null; render();
    if (old) { try { await GR.api(`/api/scan_live/${old}/stop`, { method: 'POST', body: '{}' }); } catch { /* worker has bounded expiry if network disconnected */ } }
    return status();
  }
  function disposeBoxes() { if (!boxes) return; boxes.traverse((o) => { o.geometry?.dispose(); if (o.material) { o.material.map?.dispose(); o.material.dispose(); } }); boxes.clear(); }
  function makeBoxes(scene) {
    if (!boxes) { boxes = new T.Group(); scene.add(boxes); }
    disposeBoxes();
    for (const d of result?.detections || []) {
      if (!d.position || !d.size || !d.metric) continue;
      const p = d.position, size = d.size, w = Math.min(4, Math.max(.05, size.w)), h = Math.min(4, Math.max(.05, size.h));
      // Depth is not observable from a 2D box: draw an explicitly thin uncertain
      // bracket rather than inventing a measured furniture footprint.
      const depth = size.d || .08, geometry = new T.EdgesGeometry(new T.BoxGeometry(w, h, depth));
      const mesh = new T.LineSegments(geometry, new T.LineBasicMaterial({ color: 0xa0e7ba, depthTest: false, transparent: true, opacity: .8 })); mesh.position.set(p.x, p.y, p.z); if (d.viewQuaternion) mesh.quaternion.fromArray(d.viewQuaternion); boxes.add(mesh);
      const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 80; const c = canvas.getContext('2d'); c.fillStyle = '#102018dd'; c.fillRect(0, 0, 512, 80); c.fillStyle = '#c5efcf'; c.font = '30px sans-serif'; c.textAlign = 'center'; c.fillText(`${d.label} · depth ${size.d ? '~' + size.d.toFixed(1) + ' m' : '?'}`, 256, 49);
      const texture = new T.CanvasTexture(canvas); const label = new T.Sprite(new T.SpriteMaterial({ map: texture, depthTest: false, transparent: true, sizeAttenuation: false })); label.position.set(p.x, p.y + h / 2 + .08, p.z); label.scale.set(.32, .05, 1); boxes.add(label);
    }
  }
  function onXRFrame({ time, frame, session, renderer, scene, space, sample }) {
    if (boxes) boxes.visible = active && sample.tracked && session.visibilityState === 'visible' && performance.now() - lastResult < 1800;
    if (!active || mode === 'imu' || mode === 'switching' || !id || busy || time - lastCapture < 350 || !sample.tracked || session.visibilityState !== 'visible') return;
    const view = sample.pose.views?.[0];
    if (!view?.camera || !window.XRWebGLBinding) { lastCapture = time + 650; const changed = mode !== 'needs-camera'; mode = 'needs-camera'; if (changed) render(); return; }
    mode = 'webxr'; lastCapture = time;
    try {
      raw ||= new RawCamera(renderer, session);
      const captured = raw.capture(frame, space, view, T); if (!captured) return;
      const gen = generation; busy = true;
      upload(captured.canvas, captured.camera, gen).then(() => { if (gen === generation) makeBoxes(scene); }).catch((e) => { if (e.name !== 'AbortError') fail(e); }).finally(() => { if (gen === generation) busy = false; });
    } catch (e) { mode = 'needs-camera'; raw?.dispose(); raw = null; error = `AR camera readback unavailable: ${e.message}. Use 2D camera instead.`; render(); }
  }
  async function upload(canvas, camera, gen) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', .72));
    if (!blob || gen !== generation || !active) return;
    const jpeg = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
    if (gen !== generation || !id) return;
    controller = new AbortController(); const started = performance.now();
    const response = await fetch(`/api/scan_live/${id}/frame`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Garden-Key': GR.KEY }, body: JSON.stringify({ seq: seq++, jpeg, camera, plan: plan(), alignment: GR.ar?.status().calibration || null }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(14000)]) });
    const next = await response.json(); if (gen !== generation) return;
    if (response.status === 429) { error = 'GPU busy · dropping keyframe, retrying'; render(); return; }
    if (!response.ok || next.error) throw new Error(next.error || 'Scan server unavailable');
    error = null; result = next; lastResult = performance.now(); result.roundTripMs = performance.now() - started;
    if (result.alignment && mode === 'webxr') GR.ar?.setAlignment(result.alignment);
    for (const d of result.detections || []) if (!spoken.has(d.label) && d.confidence >= (d.label === 'potted plant' ? .35 : .4)) { spoken.add(d.label); say(`Found ${d.label === 'potted plant' ? 'a potted plant' : 'the ' + d.label}.`); break; }
    render(); drawVideoBoxes();
  }
  function onOrientation(event) { orientation = { alpha: event.alpha || 0, beta: event.beta || 0, gamma: event.gamma || 0 }; }
  async function fallback() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera requires HTTPS and browser camera permission');
    // Never request a second hardware camera while ARCore owns it.
    const permission = window.DeviceOrientationEvent?.requestPermission ? DeviceOrientationEvent.requestPermission() : Promise.resolve('granted');
    mode = 'switching'; await GR.ar?.stop(); await permission;
    if (!active || !id) { active = true; const gen = ++generation; const created = await serverStart(); if (gen !== generation || !active) { await GR.api(`/api/scan_live/${created.id}/stop`, { method: 'POST', body: '{}' }).catch(() => {}); return; } id = created.id; }
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
    const root = document.querySelector('#gr-ar'); root.hidden = false; GR.ar.setVideoMode(true); GR.ar.setTool('scan');
    video = document.createElement('video'); video.id = 'scan-video'; video.muted = true; video.playsInline = true; video.srcObject = stream; root.prepend(video); await video.play();
    const canvas = document.createElement('canvas'); canvas.id = 'scan-video-boxes'; root.insertBefore(canvas, document.querySelector('#ar-labels'));
    window.addEventListener('deviceorientation', onOrientation); mode = 'imu'; error = null;
    interval = setInterval(() => {
      if (!active || busy || !video?.videoWidth || document.hidden) return;
      const f = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight)); const w = Math.round(video.videoWidth * f), h = Math.round(video.videoHeight * f); imageCanvas.width = w; imageCanvas.height = h; context.drawImage(video, 0, 0, w, h);
      const q = new T.Quaternion(); if (orientation) { const deg = T.MathUtils.degToRad; q.setFromEuler(new T.Euler(deg(orientation.beta), deg(orientation.alpha), -deg(orientation.gamma), 'YXZ')).multiply(new T.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)).multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), -deg(screen.orientation?.angle || 0))); }
      const pose = new T.Matrix4().makeRotationFromQuaternion(q).toArray(); const camera = { mode: 'imu', metric: false, width: w, height: h, pose, intrinsics: [[w, 0, w / 2], [0, w, h / 2], [0, 0, 1]], intrinsicsEstimated: true, orientation };
      busy = true; const gen = generation; upload(imageCanvas, camera, gen).catch((e) => { if (gen === generation && e.name !== 'AbortError') fail(e); }).finally(() => { if (gen === generation) busy = false; });
    }, 400); render();
  }
  function drawVideoBoxes() {
    const canvas = document.querySelector('#scan-video-boxes'); if (!canvas || !video) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight; const c = canvas.getContext('2d'), f = video.videoWidth / imageCanvas.width; c.strokeStyle = '#a0e7ba'; c.fillStyle = '#a0e7ba'; c.lineWidth = Math.max(2, canvas.width / 300); c.font = `${Math.max(16, canvas.width / 30)}px sans-serif`;
    for (const d of result?.detections || []) { const [x0,y0,x1,y1] = d.box.map((v) => v * f); c.strokeRect(x0,y0,x1-x0,y1-y0); c.fillText(d.label,x0,Math.max(20,y0-5)); }
  }
  function apply(objectId) {
    const c = result?.corrections?.find((c) => c.object === objectId), it = c && GR.itemById(c.id);
    if (!c || !it || it.locked || !active || !result.metric || performance.now() - lastResult > 3000) { GR.toast('Correction stale or item locked. Scan it again.'); return false; }
    if (!Number.isFinite(c.x) || !Number.isFinite(c.z)) return false;
    const moved = GR.moveItem(c.id, c.x, c.z); if (!moved) return false;
    if (c.props && Object.keys(c.props).length) GR.setProps(c.id, c.props);
    result.corrections = result.corrections.filter((v) => v.object !== objectId); say(`Updated ${c.name}.`); render(); return true;
  }
  GR.scanLive = { start, stop, status, detections: () => (result?.detections || []).map((d) => structuredClone(d)), apply, open };
  (GR.addHubItem || GR.addDock).call(GR, { key: 'scan_live', label: 'Live room scan', icon: GR.ICON.scan, open });
  window.addEventListener('pagehide', () => { stop(); });
}
