import { IN, snap, distance, units, calibrate, toPlan, toXR, verticalPoint, measure, photoScale, photoDistance, properties, sampleFrame, sessionOptions } from './ar-core.js';

export function init(GR) {
  const T = GR.THREE, KEY = 'gr_ar_calib_v1';
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/modules/ar.css'; document.head.append(css);
  const root = document.createElement('section'); root.id = 'gr-ar'; root.hidden = true; root.setAttribute('aria-label', 'Room AR tools');
  root.innerHTML = `<canvas id="ar-view"></canvas><div id="ar-labels"></div>
    <header class="lg ar-head"><div><span class="micro" id="ar-mode">CAMERA TOOLS</span><h3>Room <em>in reality</em></h3></div><button class="btn" id="ar-close" aria-label="Close AR">Close</button></header>
    <div class="ar-top"><canvas id="ar-map" class="lg" width="360" height="270" aria-label="Room corners and live position"></canvas><div class="lg ar-readout"><span id="ar-tracking">Not tracking</span><b id="ar-live">Aim at a surface</b></div></div>
    <div id="ar-cross" hidden>＋</div>
    <div class="ar-bottom lg"><div class="row ar-tabs" role="tablist" aria-label="AR tool"><button class="btn" data-tool="orient" role="tab">Orient</button><button class="btn" data-tool="measure" role="tab">Measure</button><button class="btn" data-tool="ruler" role="tab">Ruler</button></div>
      <p id="ar-instruction" class="sub" role="status" aria-live="polite"></p>
      <div class="row ar-start"><button class="btn gold" id="ar-start">Start camera AR</button><button class="btn" id="ar-photo-mode">Photo ruler</button></div>
      <div id="ar-orient"><div class="row"><label for="ar-corner-a" class="micro">First corner</label><select id="ar-corner-a"></select></div><div class="row"><label for="ar-corner-b" class="micro">Second corner</label><select id="ar-corner-b"></select></div><div class="row"><button class="btn" id="ar-recalibrate">Retap corners</button><label><input id="ar-footprints" type="checkbox"> Floor footprints</label></div><div class="row"><label><input id="ar-correct" type="checkbox"> Drag items on mini plan to correct</label></div></div>
      <div id="ar-measure" hidden><label class="micro" for="ar-item">Assign to real object</label><select id="ar-item"></select><div id="ar-dimensions" class="row"></div><p class="sub" id="ar-values">No dimensions yet</p><button class="btn gold" id="ar-apply" disabled>Apply to item</button></div>
      <div id="ar-ruler" hidden><div id="ar-segments"></div><div class="row"><button class="btn" id="ar-undo">Undo</button><button class="btn" id="ar-clear">Clear</button></div></div>
      <div id="ar-photo" hidden><p class="sub">Photo estimate, not AR. Reference and object must lie in the same plane. Keep the camera square-on; take a new side photo for depth. Photos stay on this device.</p><div class="row"><label class="btn" for="ar-file">Take / choose photo</label><input id="ar-file" type="file" accept="image/*" capture="environment" hidden><select id="ar-reference" aria-label="Known reference"><option value="card">Card · 85.6 mm</option><option value="fridge">Fridge width</option><option value="custom">Custom inches</option></select><input id="ar-ref-inches" type="number" min="0.5" step="0.5" aria-label="Reference width in inches" hidden></div><button class="btn" id="ar-photo-reset">Retap reference</button><p id="ar-photo-status" class="sub">Choose a photo, then tap both ends of the reference.</p></div>
      <div class="row ar-placement"><button class="btn gold" id="ar-place" disabled>Place point</button><button class="btn" id="ar-end" hidden>End AR</button></div><p class="ar-accuracy micro">Estimate only · verify before buying or cutting</p>
    </div>`;
  document.body.append(root);
  const $ = (s) => root.querySelector(s), $$ = (s) => [...root.querySelectorAll(s)];
  const map = $('#ar-map'), mc = map.getContext('2d'), photoCanvas = document.createElement('canvas');
  photoCanvas.id = 'ar-photo-canvas'; photoCanvas.hidden = true; root.insertBefore(photoCanvas, $('.ar-top'));
  const pc = photoCanvas.getContext('2d');
  let tool = 'orient', medium = 'ready', supported = null, selected = '', dimension = 'w', values = {}, first = null;
  let session = null, xrRenderer = null, xrScene = null, xrCamera = null, space = null, source = null;
  let reticle = null, lineGroup = null, footprintGroup = null, liveLine = null, guide = null;
  let latest = null, target = null, queued = false, floorOverlay = false, corners = [], calibration = null, saved = null;
  let anchors = [null, null], anchorPoints = [null, null], anchorHandles = [null, null], anchorPending = [false, false];
  let ruler = [], posePlan = null, lastPosePlan = null, lastMap = 0, mapBounds = null, photo = null, refPoints = [], photoPoints = [], scale = null, drag = null;
  let measurementLabels = [], lastDepth = null, xrGeneration = 0, anchorEpoch = 0, retryMinimal = false;
  const footprint = (it) => { const f = GR.footprint(it); return [[f.x0, f.z0], [f.x1, f.z0], [f.x1, f.z1], [f.x0, f.z1]]; };
  const planSignature = () => JSON.stringify(GR.state.room.poly);
  const safeLocal = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  saved = safeLocal();
  GR.api('/api/ar/calib').then((v) => { if (!saved && v?.version === 1) saved = v; }).catch(() => {});
  const marker = new T.Group(); marker.visible = false;
  const dot = new T.Mesh(new T.SphereGeometry(0.065, 12, 8), new T.MeshBasicMaterial({ color: 0xf2ce83, depthTest: false })); dot.renderOrder = 100; marker.add(dot);
  const cone = new T.Mesh(new T.ConeGeometry(0.13, 0.35, 3).rotateX(-Math.PI / 2).translate(0, 0, -0.21), new T.MeshBasicMaterial({ color: 0xeac77d, transparent: true, opacity: 0.45, depthTest: false })); cone.renderOrder = 99; marker.add(cone); GR.scene.add(marker);
  const mainBadge = document.createElement('span'); mainBadge.className = 'ar-main-position lg micro'; mainBadge.textContent = 'AR · last tracked position'; mainBadge.hidden = true; document.body.append(mainBadge);
  GR.onFrame(() => { const p = session ? posePlan : lastPosePlan; marker.visible = !!p; mainBadge.hidden = !p || !root.hidden || !!session; if (p) { marker.position.set(p.x, 0.12, p.z); marker.rotation.y = -p.heading - Math.PI / 2; } });
  function notice(text) { $('#ar-instruction').textContent = text; }
  function dims() { const it = GR.itemById(selected); return it?.kind === 'plant' ? it.box ? [['w', 'Box width'], ['d', 'Box depth'], ['potH', 'Pot height'], ['height', 'Foliage height']] : [['potD', 'Pot diameter'], ['potH', 'Pot height'], ['height', 'Foliage height']] : [['w', 'Width'], ['d', 'Depth'], ['h', 'Height']]; }
  const isVertical = () => ['h', 'potH', 'height'].includes(dimension);
  function updateDimensions() {
    const it = GR.itemById(selected); $('#ar-item').value = selected;
    $('#ar-dimensions').innerHTML = '';
    for (const [key, label] of dims()) { const b = document.createElement('button'); b.className = `btn${dimension === key ? ' on' : ''}`; b.textContent = label; b.dataset.dimension = key; b.onclick = () => { dimension = key; first = null; photoPoints = []; updateDimensions(); updateInstruction(); redrawLines(); }; $('#ar-dimensions').append(b); }
    $('#ar-values').textContent = dims().map(([k, label]) => `${label}: ${values[k] ? units(values[k]) : '—'}`).join(' · ');
    $('#ar-apply').textContent = `Apply to ${it?.name || 'item'}`;
    try { properties(it || {}, values); $('#ar-apply').disabled = !it; } catch { $('#ar-apply').disabled = true; }
  }
  function populate() {
    const old = selected; $('#ar-item').innerHTML = '';
    GR.state.items.forEach((it) => { const o = new Option(it.name || it.id, it.id); $('#ar-item').append(o); });
    selected = GR.itemById(old) ? old : GR.selected || GR.state.items[0]?.id || '';
    const poly = GR.state.room.poly;
    for (const id of ['#ar-corner-a', '#ar-corner-b']) { const oldVal = $(id).value; $(id).innerHTML = ''; poly.forEach((p, i) => $(id).append(new Option(`Corner ${i + 1} · ${(p[0] / IN).toFixed(0)}″ E, ${(p[1] / IN).toFixed(0)}″ S`, i))); if (oldVal) $(id).value = oldVal; }
    if ($('#ar-corner-a').value === $('#ar-corner-b').value) $('#ar-corner-b').value = String(Math.min(2, poly.length - 1));
    dimension = dims()[0][0]; updateDimensions(); drawMap();
  }
  function updateInstruction() {
    if (medium === 'photo') { notice(tool === 'orient' ? 'Photo mode cannot locate you in the room. Start AR to orient.' : !photo ? 'Take a photo with a card or a known width beside the object.' : !scale ? 'Tap the two ends of the known reference on the photo.' : tool === 'measure' ? `Tap both ends of ${dims().find(([k]) => k === dimension)?.[1].toLowerCase()}.` : 'Tap a polyline on the photo. Distances assume a flat, coplanar surface.'); return; }
    if (!session) { notice(supported === false ? 'Immersive AR is unavailable here. Use the photo ruler, or Chrome with ARCore on your phone.' : retryMinimal ? 'Optional depth setup failed. Tap Start again to try without depth.' : 'Use Chrome on your ARCore phone. Camera access starts only when you tap Start.'); return; }
    if (tool === 'orient') notice(calibration ? 'Aligned. Gold dot is your live position. Check the overlay against the room; retap if it drifts.' : `Aim the centre reticle at floor corner ${+$(corners.length ? '#ar-corner-b' : '#ar-corner-a').value + 1}, then Place. Choose numbered corners on the plan.`);
    else if (tool === 'measure') notice(isVertical() ? first ? 'Aim up along the gold vertical guide to the top; stay side-on. Place to finish.' : `Aim at the ${dimension === 'height' ? 'pot rim (foliage base)' : 'base'}, Place, then raise the centre aim to the top.` : 'Aim at one edge, Place, then the other edge. Width and depth are horizontal.');
    else notice('Aim the centre reticle, then Place each point. Move slowly to scan textured surfaces.');
  }
  function setTool(next) {
    tool = next; first = null; photoPoints = []; queued = false;
    for (const name of ['orient', 'measure', 'ruler']) $(`#ar-${name}`).hidden = name !== tool;
    $$('[data-tool]').forEach((b) => { b.classList.toggle('on', b.dataset.tool === tool); b.setAttribute('aria-selected', String(b.dataset.tool === tool)); });
    updateDimensions(); updateInstruction(); redrawLines(); drawPhoto();
  }
  async function open(id) {
    if (id) { selected = id; values = {}; }
    root.hidden = false; GR.closeSheet(); populate(); setTool(id ? 'measure' : 'orient');
    if (supported === null) { try { supported = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); } catch { supported = false; } }
    $('#ar-start').disabled = !supported; updateInstruction();
    if (!supported) setPhoto();
  }
  function storeCalibration() {
    if (!calibration) return;
    const record = { version: 1, plan: planSignature(), transform: calibration, corners: [$('#ar-corner-a').value, $('#ar-corner-b').value].map(Number), points: corners, anchorHandles, savedAt: new Date().toISOString() };
    saved = record;
    try { localStorage.setItem(KEY, JSON.stringify(record)); } catch { GR.toast('Could not save calibration on this device'); }
    GR.api('/api/ar/calib', { method: 'POST', body: JSON.stringify(record) }).then((r) => { if (!r.ok) throw new Error('Save rejected'); return GR.api('/api/ar/calib'); }).then((r) => { if (r.savedAt !== record.savedAt) throw new Error('Save not confirmed'); }).catch(() => GR.toast('Calibration is local only; server save failed'));
  }
  function invalidate() { calibration = null; corners = []; posePlan = null; first = null; latest = null; target = null; queued = false; anchorPoints = [null, null]; anchorPending = [false, false]; marker.visible = false; $('#ar-place').disabled = true; if (footprintGroup) footprintGroup.visible = false; drawMap(); updateInstruction(); }
  function releaseAnchors(removePersistent = false) {
    ++anchorEpoch;
    anchors.forEach((a) => { try { a?.delete(); } catch {} }); anchors = [null, null];
    if (removePersistent) anchorHandles.forEach((h) => { if (h && session?.deletePersistentAnchor) session.deletePersistentAnchor(h).catch(() => {}); });
    anchorHandles = [null, null];
  }
  function recalibrate() { releaseAnchors(true); lastPosePlan = null; invalidate(); redrawLines(); }
  function makeRenderer() {
    if (xrRenderer) return;
    // A separate renderer avoids fighting the host's requestAnimationFrame/cutaway camera.
    xrRenderer = new T.WebGLRenderer({ canvas: $('#ar-view'), alpha: true, antialias: true });
    xrRenderer.setPixelRatio(Math.min(devicePixelRatio, 2)); xrRenderer.setSize(innerWidth, innerHeight); xrRenderer.setClearColor(0x000000, 0); xrRenderer.xr.enabled = true; xrRenderer.xr.setReferenceSpaceType('local');
    xrScene = new T.Scene(); xrCamera = new T.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 40);
    const mat = new T.MeshBasicMaterial({ color: 0xf4d48b, side: T.DoubleSide, depthTest: false });
    reticle = new T.Mesh(new T.RingGeometry(0.018, 0.027, 32).rotateX(-Math.PI / 2), mat); reticle.visible = false; xrScene.add(reticle);
    lineGroup = new T.Group(); footprintGroup = new T.Group(); xrScene.add(lineGroup, footprintGroup);
    liveLine = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color: 0xf4d48b, depthTest: false })); liveLine.visible = false; xrScene.add(liveLine);
    guide = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]), new T.LineBasicMaterial({ color: 0xf4d48b, transparent: true, opacity: 0.65, depthTest: false })); guide.visible = false; xrScene.add(guide);
  }
  function clearGroup(group) { if (!group) return; while (group.children.length) { const c = group.children[0]; group.remove(c); c.geometry?.dispose(); c.material?.dispose(); } }
  function line(points, group, color = 0xf4d48b) { const l = new T.Line(new T.BufferGeometry().setFromPoints(points.map((p) => new T.Vector3(p.x, p.y, p.z))), new T.LineBasicMaterial({ color, depthTest: false })); group.add(l); return l; }
  async function start() {
    if (session || !supported) return;
    $('#ar-start').disabled = true;
    let starting = null;
    try {
      // requestSession is issued directly in the click's user activation.
      starting = await navigator.xr.requestSession('immersive-ar', sessionOptions(root, !retryMinimal));
      session = starting; ++xrGeneration; medium = 'xr'; root.dataset.medium = medium; photoCanvas.hidden = true; $('#ar-photo').hidden = true;
      invalidate(); ruler = []; first = null; releaseAnchors();
      session.addEventListener('end', endCleanup, { once: true });
      session.addEventListener('select', () => { queued = true; });
      session.addEventListener('visibilitychange', () => { if (session?.visibilityState !== 'visible') { latest = null; target = null; queued = false; posePlan = null; } });
      makeRenderer();
      await xrRenderer.xr.setSession(session);
      space = xrRenderer.xr.getReferenceSpace();
      space.addEventListener('reset', () => { recalibrate(); notice('Tracking origin changed. Retap both room corners.'); });
      const viewer = await session.requestReferenceSpace('viewer');
      source = await session.requestHitTestSource({ space: viewer });
      if (!session.domOverlayState) throw new Error('This browser did not grant the required controls overlay.');
      $('#ar-mode').textContent = 'LIVE AR · WEBXR'; $('.ar-start').hidden = true; $('#ar-end').hidden = false; $('#ar-cross').hidden = false; $('#ar-place').hidden = false;
      xrRenderer.setAnimationLoop(onXRFrame); await restoreAnchors(); redrawLines(); updateInstruction();
    } catch (e) {
      if (starting) { try { await starting.end(); } catch {} }
      if (session) endCleanup();
      retryMinimal = true; notice(`AR did not start: ${e.message}. Tap Start to retry without depth, or use Photo ruler.`);
    } finally { $('#ar-start').disabled = !supported; }
  }
  async function restoreAnchors() {
    const gen = xrGeneration, s = session, record = saved;
    if (!record || record.plan !== planSignature() || !record.anchorHandles?.every(Boolean) || !s.restorePersistentAnchor) return;
    try {
      const restored = await Promise.all(record.anchorHandles.map((h) => s.restorePersistentAnchor(h)));
      if (gen !== xrGeneration || s !== session) { restored.forEach((a) => a.delete()); return; }
      anchors = restored; anchorHandles = [...record.anchorHandles]; corners = record.points.map((p) => ({ ...p }));
      $('#ar-corner-a').value = String(record.corners[0]); $('#ar-corner-b').value = String(record.corners[1]);
      // Do not trust the serialized transform: derive it again from this session's anchor poses.
      notice('Restoring room anchors. Waiting for tracking…');
    } catch { releaseAnchors(); invalidate(); }
  }
  function endCleanup() {
    ++xrGeneration; source?.cancel(); source = null; session = null; space = null; xrRenderer?.setAnimationLoop(null); releaseAnchors(); invalidate(); ruler = []; first = null;
    clearGroup(lineGroup); clearGroup(footprintGroup); $('#ar-labels').replaceChildren();
    if (reticle) reticle.visible = false; if (liveLine) liveLine.visible = false; if (guide) guide.visible = false;
    medium = 'ready'; root.dataset.medium = medium; $('#ar-mode').textContent = 'CAMERA TOOLS'; $('.ar-start').hidden = false; $('#ar-end').hidden = true; $('#ar-cross').hidden = true;
    $('#ar-tracking').textContent = 'Not tracking'; $('#ar-live').textContent = 'Aim at a surface'; updateInstruction();
  }
  function captureAnchor(index, sample) {
    if (!sample.result?.createAnchor) return;
    const gen = xrGeneration, epoch = anchorEpoch, s = session; anchorPending[index] = true;
    // Must call createAnchor while this XRFrame is still active, never from an async DOM event.
    sample.result.createAnchor().then(async (a) => {
      if (gen !== xrGeneration || epoch !== anchorEpoch || session !== s || !corners[index]) { a.delete(); return; }
      anchors[index] = a;
      try { if (a.requestPersistentHandle) { const handle = await a.requestPersistentHandle(); if (gen === xrGeneration && epoch === anchorEpoch && session === s) anchorHandles[index] = handle; } } catch {}
      if (gen === xrGeneration && epoch === anchorEpoch && session === s) storeCalibration();
    }).catch(() => {}).finally(() => { if (gen === xrGeneration) anchorPending[index] = false; });
  }
  function place(sample) {
    if (!target || !sample.tracked) return;
    const point = { ...target };
    if (tool === 'orient') {
      if (!sample.floorHit) { notice('Aim down at a horizontal floor, not a wall.'); return; }
      if (calibration) { notice('Use Retap corners to align again.'); return; }
      if ($('#ar-corner-a').value === $('#ar-corner-b').value) { notice('Choose two different plan corners.'); return; }
      if (!corners.length) { corners.push(point); captureAnchor(0, sample); }
      else {
        try { calibration = calibrate(corners[0], point, GR.state.room.poly[+$('#ar-corner-a').value], GR.state.room.poly[+$('#ar-corner-b').value]); }
        catch (e) { notice(e.message); return; }
        corners.push(point); captureAnchor(1, sample); storeCalibration(); drawFootprints();
      }
      updateInstruction(); drawMap();
    } else if (tool === 'ruler') { ruler.push(point); redrawLines(); }
    else if (!first) { first = point; updateInstruction(); redrawLines(); }
    else {
      const value = measure(first, point, isVertical());
      if (value < IN / 2) { notice('Points are too close. Aim at the opposite edge.'); return; }
      values[dimension] = value; first = null; updateDimensions(); updateInstruction(); redrawLines();
    }
    try { navigator.vibrate?.(25); } catch {}
  }
  function updateLine(l, a, b) { const pos = l.geometry.attributes.position; pos.setXYZ(0, a.x, a.y, a.z); pos.setXYZ(1, b.x, b.y, b.z); pos.needsUpdate = true; l.geometry.computeBoundingSphere(); }
  function onXRFrame(time, frame) {
    if (!frame || !space || !session) return;
    const sample = sampleFrame(frame, space, source); latest = sample; target = null; posePlan = null;
    if (sample.tracked && session.visibilityState === 'visible') {
      let allAnchors = anchors.every(Boolean), located = true;
      anchors.forEach((a, i) => { if (!a) return; const p = frame.getPose(a.anchorSpace, space); if (p) anchorPoints[i] = { x: p.transform.position.x, y: p.transform.position.y, z: p.transform.position.z }; else { anchorPoints[i] = null; located = false; } });
      if (allAnchors && located && anchorPoints.every(Boolean)) {
        const wasAligned = !!calibration;
        try { calibration = calibrate(anchorPoints[0], anchorPoints[1], GR.state.room.poly[+$('#ar-corner-a').value], GR.state.room.poly[+$('#ar-corner-b').value]); if (!wasAligned) updateInstruction(); }
        catch { calibration = null; }
      }
      // Never show localized overlays when an existing anchor temporarily loses tracking.
      if (calibration && located) {
        const p = toPlan(calibration, sample.origin); posePlan = { ...p, heading: Math.atan2(sample.ray.z, sample.ray.x) + calibration.angle }; lastPosePlan = posePlan;
        if (floorOverlay && time - lastMap > 150) drawFootprints();
      }
      let depthTarget = null; lastDepth = null;
      if (session.depthUsage === 'cpu-optimized' && frame.getDepthInformation && sample.pose.views[0]) {
        try {
          const view = sample.pose.views[0], d = frame.getDepthInformation(view);
          if (d) {
            const z = d.getDepthInMeters(0.5, 0.5);
            if (z > 0.05 && z < 10 && Number.isFinite(z)) {
              lastDepth = z;
              if (!sample.hit && tool !== 'orient' && view.projectionMatrix && view.transform?.matrix) {
                const v = new T.Vector3(0, 0, 0.5).applyMatrix4(new T.Matrix4().fromArray(view.projectionMatrix).invert());
                v.multiplyScalar(z / -v.z).applyMatrix4(new T.Matrix4().fromArray(view.transform.matrix));
                depthTarget = { x: v.x, y: v.y, z: v.z };
              }
            }
          }
        } catch {}
      }
      target = tool === 'measure' && isVertical() && first ? verticalPoint(first, sample.origin, sample.ray) : sample.hit || depthTarget;
      if (tool === 'orient' && (!sample.floorHit || calibration)) target = null;
      $('#ar-tracking').textContent = calibration ? posePlan ? 'Room aligned · tracking' : 'Room anchors lost · wait' : 'Tracking · room not aligned';
      if (time - lastMap > 150) $('#ar-mode').textContent = `LIVE AR · ${depthTarget ? 'DEPTH ESTIMATE' : lastDepth ? 'DEPTH AVAILABLE' : 'HIT TEST'}`;
    } else { $('#ar-tracking').textContent = 'Tracking lost · hold still and scan'; latest = null; }
    $('#ar-place').disabled = !target; $('#ar-cross').classList.toggle('valid', !!target);
    reticle.visible = !!target; if (target) { reticle.position.set(target.x, target.y + 0.004, target.z); if (sample.result && !(isVertical() && first && tool === 'measure')) { const p = sample.result.getPose(space); reticle.quaternion.setFromRotationMatrix(new T.Matrix4().fromArray(p.transform.matrix)); } else reticle.quaternion.identity(); }
    const previous = tool === 'ruler' ? ruler.at(-1) : first;
    liveLine.visible = !!previous && !!target; if (liveLine.visible) updateLine(liveLine, previous, target);
    guide.visible = !!first && tool === 'measure' && isVertical(); if (guide.visible) updateLine(guide, first, { ...first, y: first.y + 3 });
    if (time - lastMap > 150) {
      lastMap = time; drawMap(); $('#ar-live').textContent = previous && target ? units(tool === 'measure' ? isVertical() ? Math.abs(target.y - previous.y) : Math.hypot(target.x - previous.x, target.z - previous.z) : distance(previous, target)) : target ? 'Surface found · Place' : 'Scan / aim at a surface';
    }
    if (queued) { queued = false; place(sample); }
    footprintGroup.visible = floorOverlay && !!posePlan; projectLabels(); xrRenderer.render(xrScene, xrCamera);
  }
  function redrawLines() {
    if (lineGroup) {
      clearGroup(lineGroup); measurementLabels = []; $('#ar-labels').replaceChildren();
      const points = tool === 'ruler' ? ruler : first ? [first] : [];
      points.forEach((p, i) => { const ball = new T.Mesh(new T.SphereGeometry(0.012, 10, 8), new T.MeshBasicMaterial({ color: 0xf4d48b, depthTest: false })); ball.position.set(p.x, p.y, p.z); lineGroup.add(ball);
        if (i) { const a = points[i - 1]; line([a, p], lineGroup); const el = document.createElement('span'); el.className = 'ar-segment-label lg'; el.textContent = units(distance(a, p)); $('#ar-labels').append(el); measurementLabels.push({ el, p: new T.Vector3((a.x + p.x) / 2, (a.y + p.y) / 2 + 0.04, (a.z + p.z) / 2) }); }
      });
    }
    const points = ruler; let total = 0;
    const segments = points.slice(1).map((p, i) => { const d = distance(points[i], p); total += d; return `${i + 1}: ${units(d)}`; });
    $('#ar-segments').textContent = segments.length ? `${segments.join(' · ')} | Total ${units(total)}` : 'No segments yet';
  }
  function projectLabels() {
    const cam = xrRenderer.xr.getCamera(); cam.updateMatrixWorld();
    for (const { el, p } of measurementLabels) { const v = p.clone().project(cam); const visible = latest?.tracked && v.z > -1 && v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1; el.hidden = !visible; if (visible) { el.style.left = `${(v.x + 1) * innerWidth / 2}px`; el.style.top = `${(1 - v.y) * innerHeight / 2}px`; } }
  }
  function drawFootprints() {
    if (!footprintGroup || !calibration) return;
    clearGroup(footprintGroup);
    for (const it of GR.state.items) {
      const points = footprint(it).map(([x, z]) => toXR(calibration, { x, z, y: 0.014 }));
      if (points.length) line([...points, points[0]], footprintGroup, it.id === selected ? 0xffdf91 : 0xc6aa71);
    }
  }
  function drawMap() {
    const poly = GR.state.room.poly, xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
    const minX = Math.min(...xs), minZ = Math.min(...zs), maxX = Math.max(...xs), maxZ = Math.max(...zs);
    const factor = Math.min(300 / (maxX - minX), 210 / (maxZ - minZ));
    mapBounds = { factor, ox: (360 - (maxX - minX) * factor) / 2 - minX * factor, oz: (270 - (maxZ - minZ) * factor) / 2 - minZ * factor };
    const point = (x, z) => [mapBounds.ox + x * factor, mapBounds.oz + z * factor];
    mc.clearRect(0, 0, 360, 270); mc.lineWidth = 2; mc.strokeStyle = '#d9b673'; mc.fillStyle = '#d9b6730d'; mc.beginPath(); poly.forEach(([x, z], i) => { const p = point(x, z); i ? mc.lineTo(...p) : mc.moveTo(...p); }); mc.closePath(); mc.fill(); mc.stroke();
    for (const it of GR.state.items) { const fp = footprint(it); mc.strokeStyle = it.id === selected ? '#ffe2a0' : '#827d6c'; mc.lineWidth = it.id === selected ? 2 : 1; mc.beginPath(); fp.forEach(([x, z], i) => { const p = point(x, z); i ? mc.lineTo(...p) : mc.moveTo(...p); }); mc.closePath(); mc.stroke(); }
    poly.forEach(([x, z], i) => { const p = point(x, z); const active = i === +$('#ar-corner-a').value || i === +$('#ar-corner-b').value; mc.fillStyle = active ? '#f4d48b' : '#7e7c70'; mc.beginPath(); mc.arc(...p, 10, 0, Math.PI * 2); mc.fill(); mc.fillStyle = '#14140e'; mc.font = 'bold 13px sans-serif'; mc.textAlign = 'center'; mc.textBaseline = 'middle'; mc.fillText(String(i + 1), ...p); });
    const fridge = GR.state.items.find((it) => it.kind === 'fridge' || /fridge/i.test(it.name));
    mc.fillStyle = '#aaa391'; mc.font = '11px sans-serif'; mc.textAlign = 'left'; if (fridge) { const p = point(fridge.x, fridge.z); mc.fillText('fridge', p[0] + 4, p[1] + 4); }
    const w = GR.state.room.window;
    if (w && poly[w.edge]) {
      const a = poly[w.edge], b = poly[(w.edge + 1) % poly.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const at = (t) => point(a[0] + (b[0] - a[0]) * t / length, a[1] + (b[1] - a[1]) * t / length);
      mc.strokeStyle = '#b9d4c8'; mc.lineWidth = 4; mc.beginPath(); mc.moveTo(...at(w.t0)); mc.lineTo(...at(w.t1)); mc.stroke();
      const p = at((w.t0 + w.t1) / 2); mc.fillStyle = '#b9d4c8'; mc.fillText('window', p[0] + 5, p[1]);
    }
    if (posePlan && session) {
      const [x, z] = point(posePlan.x, posePlan.z), a = posePlan.heading;
      mc.fillStyle = '#efcd8040'; mc.beginPath(); mc.moveTo(x, z); mc.arc(x, z, 32, a - 0.45, a + 0.45); mc.closePath(); mc.fill(); mc.fillStyle = '#f4d48b'; mc.beginPath(); mc.arc(x, z, 6, 0, Math.PI * 2); mc.fill();
    }
  }
  function mapCoord(event) { const r = map.getBoundingClientRect(); return { x: ((event.clientX - r.left) * 360 / r.width - mapBounds.ox) / mapBounds.factor, z: ((event.clientY - r.top) * 270 / r.height - mapBounds.oz) / mapBounds.factor }; }
  map.addEventListener('pointerdown', (e) => {
    if (!$('#ar-correct').checked || !calibration || !posePlan) return;
    const p = mapCoord(e), nearest = GR.state.items.filter((it) => !it.locked).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
    if (!nearest || Math.hypot(nearest.x - p.x, nearest.z - p.z) > 0.5) return;
    selected = nearest.id; drag = { id: nearest.id, dx: nearest.x - p.x, dz: nearest.z - p.z, x: nearest.x, z: nearest.z }; map.setPointerCapture(e.pointerId); updateDimensions();
  });
  map.addEventListener('pointermove', (e) => { if (!drag) return; const p = mapCoord(e); drag.x = p.x + drag.dx; drag.z = p.z + drag.dz; drawMap(); const v = mapBounds; mc.fillStyle = '#f4d48b'; mc.beginPath(); mc.arc(v.ox + drag.x * v.factor, v.oz + drag.z * v.factor, 7, 0, Math.PI * 2); mc.fill(); });
  map.addEventListener('pointerup', () => { if (!drag) return; GR.moveItem(drag.id, drag.x, drag.z); drag = null; drawMap(); drawFootprints(); });
  map.addEventListener('pointercancel', () => { drag = null; drawMap(); });
  function setPhoto() {
    if (session) { notice('End AR before opening the photo ruler.'); return; }
    $('#ar-tracking').textContent = 'Photo estimate · no tracking'; $('#ar-live').textContent = 'Reference required';
    medium = 'photo'; root.dataset.medium = medium; $('#ar-mode').textContent = 'PHOTO RULER · 2D ESTIMATE'; $('#ar-photo').hidden = false; $('#ar-place').hidden = true; $('#ar-end').hidden = true; $('#ar-cross').hidden = true; photoCanvas.hidden = !photo;
    if (tool === 'orient') setTool('ruler'); first = null; ruler = []; redrawLines(); updateInstruction();
  }
  function referenceMetres() {
    const kind = $('#ar-reference').value;
    if (kind === 'card') return 0.0856;
    if (kind === 'custom') return +$('#ar-ref-inches').value * IN;
    const fridge = GR.state.items.find((it) => it.kind === 'fridge' || /fridge/i.test(it.name)); return fridge?.w || 0;
  }
  function resetPhotoScale() { refPoints = []; scale = null; photoPoints = []; ruler = []; $('#ar-photo-status').textContent = 'Tap both ends of the reference. A card’s long edge is 85.6 mm.'; redrawLines(); drawPhoto(); updateInstruction(); }
  function drawPhoto() {
    if (!photo) return;
    pc.clearRect(0, 0, photoCanvas.width, photoCanvas.height); pc.drawImage(photo, 0, 0, photoCanvas.width, photoCanvas.height);
    const marks = [...refPoints, ...photoPoints]; pc.strokeStyle = '#f7d58d'; pc.lineWidth = Math.max(2, photoCanvas.width / 300); pc.fillStyle = '#f7d58d';
    if (refPoints.length === 2) { pc.beginPath(); pc.moveTo(refPoints[0].x, refPoints[0].y); pc.lineTo(refPoints[1].x, refPoints[1].y); pc.stroke(); }
    marks.forEach((p) => { pc.beginPath(); pc.arc(p.x, p.y, photoCanvas.width / 120, 0, Math.PI * 2); pc.fill(); });
    if (tool === 'ruler' && scale && ruler.length) { pc.beginPath(); ruler.forEach((p, i) => { const x = p.x / scale, y = p.y / scale; i ? pc.lineTo(x, y) : pc.moveTo(x, y); pc.fillRect(x - 3, y - 3, 6, 6); }); pc.stroke(); }
  }
  $('#ar-file').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    const url = URL.createObjectURL(file), image = new Image();
    try { image.src = url; await image.decode(); photo = image; const f = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight)); photoCanvas.width = Math.round(image.naturalWidth * f); photoCanvas.height = Math.round(image.naturalHeight * f); photoCanvas.hidden = false; resetPhotoScale(); }
    catch { notice('Could not open this image. Try a JPEG or PNG.'); } finally { URL.revokeObjectURL(url); e.target.value = ''; }
  };
  photoCanvas.addEventListener('click', (e) => {
    if (!photo || medium !== 'photo') return;
    const r = photoCanvas.getBoundingClientRect(), fit = Math.min(r.width / photoCanvas.width, r.height / photoCanvas.height);
    const left = r.left + (r.width - photoCanvas.width * fit) / 2, top = r.top + (r.height - photoCanvas.height * fit) / 2;
    const p = { x: (e.clientX - left) / fit, y: (e.clientY - top) / fit };
    if (p.x < 0 || p.y < 0 || p.x > photoCanvas.width || p.y > photoCanvas.height) return;
    if (!scale) {
      refPoints.push(p);
      if (refPoints.length === 2) { try { scale = photoScale(refPoints[0], refPoints[1], referenceMetres()); $('#ar-photo-status').textContent = `Reference: ${units(referenceMetres())}. Now tap object endpoints.`; } catch (err) { refPoints = []; notice(err.message); drawPhoto(); return; } }
    } else if (tool === 'measure') {
      photoPoints.push(p);
      if (photoPoints.length === 2) { const m = photoDistance(photoPoints[0], photoPoints[1], scale); if (m >= IN / 2) { values[dimension] = m; updateDimensions(); $('#ar-photo-status').textContent = `${dims().find(([k]) => k === dimension)[1]}: ${units(m)}. Choose the next dimension.`; } else notice('Endpoints are too close. Try again.'); photoPoints = []; }
    } else if (tool === 'ruler') { ruler.push({ x: p.x * scale, y: p.y * scale, z: 0 }); redrawLines(); }
    drawPhoto(); updateInstruction(); try { navigator.vibrate?.(20); } catch {}
  });
  $('#ar-reference').onchange = () => { $('#ar-ref-inches').hidden = $('#ar-reference').value !== 'custom'; resetPhotoScale(); };
  $('#ar-ref-inches').onchange = resetPhotoScale; $('#ar-photo-reset').onclick = resetPhotoScale;
  $('#ar-item').onchange = () => { selected = $('#ar-item').value; values = {}; first = null; dimension = dims()[0][0]; photoPoints = []; updateDimensions(); updateInstruction(); drawMap(); redrawLines(); };
  $('#ar-apply').onclick = () => {
    const it = GR.itemById(selected); if (!it) return;
    try { const props = properties(it, values); if (!GR.setProps(selected, props)) throw new Error('Item no longer exists'); GR.toast(`Applied measured dimensions to ${it.name}`); drawFootprints(); } catch (e) { notice(e.message); }
  };
  $('#ar-start').onclick = start; $('#ar-photo-mode').onclick = setPhoto;
  $('#ar-place').onclick = () => { queued = true; };
  $('#ar-end').onclick = () => session?.end().catch(() => endCleanup());
  $('#ar-close').onclick = async () => { if (session) { try { await session.end(); } catch { endCleanup(); } } root.hidden = true; };
  $('#ar-recalibrate').onclick = recalibrate;
  for (const id of ['#ar-corner-a', '#ar-corner-b']) $(id).onchange = recalibrate;
  $('#ar-footprints').onchange = () => { floorOverlay = $('#ar-footprints').checked; drawFootprints(); };
  $('#ar-undo').onclick = () => { ruler.pop(); redrawLines(); drawPhoto(); };
  $('#ar-clear').onclick = () => { ruler = []; first = null; redrawLines(); drawPhoto(); };
  $$('[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  root.addEventListener('beforexrselect', (e) => e.preventDefault()); // UI never generates a second XR select.
  window.addEventListener('resize', () => { if (xrRenderer && !session) xrRenderer.setSize(innerWidth, innerHeight); });
  GR.addDock({ key: 'ar', label: 'AR', icon: GR.ICON.scan, open: () => open() });
  GR.addItemAction({ label: 'Measure in AR', icon: GR.ICON.scan, run: (it) => open(it.id) });
}
