import { DAY, ACTIONS, condition, dayKey, freshProgress, layoutKey, level, mergeProgress, normalize, performCare, quests, visit } from './zen-core.js';

const MOODS = { happy: 0, content: 1, thirsty: 2, sad: 3, sleepy: 4 };
const NEEDS = { water: 8, sun: 9, space: 10, feed: 11, trim: 12, check: 13 };
const LABEL = { water: 'Water', sun: 'Find light', space: 'Make room', feed: 'Feed', trim: 'Trim', check: 'Check in' };
const ACHIEVEMENTS = { firstCare: ['First little kindness', 'Care for a plant'], allHappy: ['A room full of smiles', 'Every plant happy (or resting happily)'], lightKeeper: ['Sun keeper', 'Every plant at 100% light'], arranger: ['A fresh perspective', 'Try another arrangement'], week: ['Seven gentle days', 'Visit seven days in a row'] };
const STORAGE = 'gr_zen_v1';
const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const SOUND = svg('<path d="M4 10h4l5-4v12l-5-4H4zM17 9a5 5 0 010 6M20 6a9 9 0 010 12"/>');
const COIN = svg('<circle cx="12" cy="12" r="8"/><path d="M13.7 8.5h-2.5a1.8 1.8 0 000 3.5h1.5a1.8 1.8 0 010 3.5h-2.5M12 7v10"/>');

// One shared atlas and a fixed instance pool: one draw call including transient FX.
function makeAtlas(T) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 512;
  const c = cv.getContext('2d');
  const circle = (x, y, r, fill) => { c.fillStyle = fill; c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
  const line = (x, y, x2, y2) => { c.beginPath(); c.moveTo(x, y); c.lineTo(x2, y2); c.stroke(); };
  for (const tile of [0, 1, 2, 3, 4, 8, 9, 10, 11, 12, 13, 16, 17, 18, 19, 20]) {
    c.save(); c.translate((tile % 8) * 128, (3 - Math.floor(tile / 8)) * 128);
    c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#493c26';
    if (tile < 5) {
      circle(64, 64, 43, tile === 3 ? '#d6ccb4' : tile === 2 ? '#e9d8b2' : '#f5e3b5');
      c.lineWidth = 2; c.strokeStyle = '#fff3d4'; c.beginPath(); c.arc(64, 64, 42, 0, Math.PI * 2); c.stroke();
      c.strokeStyle = '#493c26'; c.lineWidth = 5;
      if (tile === 0 || tile === 4) { c.beginPath(); c.arc(48, 61, 8, Math.PI + 0.2, Math.PI * 2 - 0.2); c.stroke(); c.beginPath(); c.arc(80, 61, 8, Math.PI + 0.2, Math.PI * 2 - 0.2); c.stroke(); }
      else { circle(49, 59, 3.5, '#493c26'); circle(79, 59, 3.5, '#493c26'); }
      circle(38, 73, 6, '#dfaa8a'); circle(90, 73, 6, '#dfaa8a');
      c.beginPath(); if (tile === 3) c.arc(64, 88, 11, Math.PI + 0.3, Math.PI * 2 - 0.3); else if (tile === 2 || tile === 4) c.arc(64, 79, tile === 4 ? 4 : 6, 0, Math.PI * 2); else c.arc(64, 70, tile === 0 ? 16 : 10, 0.15, Math.PI - 0.15); c.stroke();
      if (tile === 2) { c.fillStyle = '#80b9ce'; c.beginPath(); c.moveTo(90, 30); c.quadraticCurveTo(72, 52, 90, 53); c.quadraticCurveTo(108, 52, 90, 30); c.fill(); }
      if (tile === 4) { c.font = 'bold 22px sans-serif'; c.fillStyle = '#e3c58c'; c.fillText('z', 96, 30); }
    } else if (tile >= 8 && tile <= 13) {
      c.fillStyle = '#fcf5df'; c.beginPath(); c.roundRect(20, 15, 90, 82, 30); c.fill(); circle(25, 102, 8, '#fcf5df'); circle(13, 116, 4, '#fcf5df');
      if (tile === 8) { c.fillStyle = '#6faec1'; c.beginPath(); c.moveTo(65, 31); c.bezierCurveTo(30, 66, 47, 82, 65, 82); c.bezierCurveTo(85, 82, 99, 66, 65, 31); c.fill(); c.strokeStyle = '#c8e5eb'; line(55, 64, 57, 71); }
      if (tile === 9) { circle(65, 56, 14, '#c49b50'); c.strokeStyle = '#c49b50'; for (let a = 0; a < 8; a++) { const r = a * Math.PI / 4; line(65 + Math.cos(r) * 23, 56 + Math.sin(r) * 23, 65 + Math.cos(r) * 29, 56 + Math.sin(r) * 29); } }
      if (tile === 10) { c.strokeStyle = '#967b4a'; line(42, 54, 87, 54); line(42, 54, 51, 45); line(42, 54, 51, 63); line(87, 54, 78, 45); line(87, 54, 78, 63); }
      if (tile === 11) { c.fillStyle = '#82a279'; c.beginPath(); c.roundRect(46, 43, 38, 37, 7); c.fill(); c.fillStyle = '#bda370'; c.fillRect(53, 31, 24, 10); c.strokeStyle = '#eff2d5'; line(65, 53, 65, 68); line(59, 61, 71, 61); }
      if (tile === 12) { c.strokeStyle = '#8c855e'; c.beginPath(); c.arc(49, 72, 8, 0, 7); c.stroke(); c.beginPath(); c.arc(79, 72, 8, 0, 7); c.stroke(); line(53, 66, 83, 33); line(75, 66, 45, 33); }
      if (tile === 13) { c.strokeStyle = '#789776'; c.beginPath(); c.arc(64, 56, 25, 0, 7); c.stroke(); line(51, 56, 61, 66); line(61, 66, 79, 45); }
    } else if (tile === 16) { c.fillStyle = '#ffedbb'; c.beginPath(); c.moveTo(64, 9); c.lineTo(75, 49); c.lineTo(112, 64); c.lineTo(75, 75); c.lineTo(64, 117); c.lineTo(53, 75); c.lineTo(16, 64); c.lineTo(53, 49); c.closePath(); c.fill(); }
    else if (tile === 17) { circle(64, 64, 40, '#deb765'); circle(64, 64, 31, '#f5d992'); c.fillStyle = '#99713a'; c.font = 'bold 49px serif'; c.textAlign = 'center'; c.fillText('1', 64, 81); }
    else if (tile === 18) { c.fillStyle = '#9cd3e7'; c.beginPath(); c.moveTo(64, 13); c.bezierCurveTo(5, 77, 45, 112, 64, 112); c.bezierCurveTo(84, 112, 122, 77, 64, 13); c.fill(); }
    else if (tile === 19) { c.fillStyle = '#aac7ad'; c.beginPath(); c.roundRect(28, 43, 53, 48, 10); c.fill(); c.beginPath(); c.moveTo(76, 49); c.lineTo(113, 29); c.lineTo(119, 43); c.lineTo(77, 77); c.fill(); c.strokeStyle = '#aac7ad'; c.lineWidth = 9; c.beginPath(); c.arc(30, 50, 20, 1.4, 4.8); c.stroke(); c.fillStyle = '#d4dfc6'; c.fillRect(35, 38, 38, 8); }
    else if (tile === 20) { const g = c.createRadialGradient(64, 64, 0, 64, 64, 52); g.addColorStop(0, 'rgba(255,239,196,.9)'); g.addColorStop(1, 'rgba(255,239,196,0)'); c.fillStyle = g; c.fillRect(0, 0, 128, 128); }
    c.restore();
  }
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; return tex;
}

function effects(GR) {
  const T = GR.THREE, group = new T.Group(); group.name = 'Zen pooled billboards'; GR.scene.add(group);
  const capacity = 320, tiles = new Float32Array(capacity), alpha = new Float32Array(capacity);
  const geo = new T.PlaneGeometry(1, 1); geo.setAttribute('zenTile', new T.InstancedBufferAttribute(tiles, 1)); geo.setAttribute('zenAlpha', new T.InstancedBufferAttribute(alpha, 1));
  const material = new T.MeshBasicMaterial({ map: makeAtlas(T), transparent: true, depthWrite: false, toneMapped: false, side: T.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float zenTile; attribute float zenAlpha; varying float vZenAlpha;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\nvMapUv = (vMapUv + vec2(mod(zenTile, 8.0), floor(zenTile / 8.0))) / vec2(8.0, 4.0); vZenAlpha = zenAlpha;');
    shader.fragmentShader = 'varying float vZenAlpha;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.a *= vZenAlpha;');
  };
  const pool = new T.InstancedMesh(geo, material, capacity); pool.frustumCulled = false; pool.instanceMatrix.setUsage(T.DynamicDrawUsage); pool.count = capacity; group.add(pool);
  const dummy = new T.Object3D(), right = new T.Vector3(), up = new T.Vector3(), point = new T.Vector3();
  const particles = Array.from({ length: 160 }, () => ({ life: 0, total: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, tile: 16, gravity: 0 }));
  const motes = Array.from({ length: 18 }, (_, i) => ({ a: i * 2.39996, h: 0.5 + (i * 0.137 % 1.5), d: 0.18 + (i * 0.173 % 0.8) }));
  const can = { life: 0, x: 0, y: 0, z: 0 }; let cursor = 0, enabled = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  function put(i, x, y, z, size, tile, opacity = 1, rotation = 0) {
    dummy.position.set(x, y, z); dummy.quaternion.copy(GR.camera.quaternion); if (rotation) dummy.rotateZ(rotation); dummy.scale.setScalar(size); dummy.updateMatrix(); pool.setMatrixAt(i, dummy.matrix); tiles[i] = tile; alpha[i] = opacity;
  }
  function burst(it, kind = 'sparkle', count = 14) {
    if (!enabled || !it) return;
    const y = GR.baseY(it) + it.potH + Math.min(it.height, 0.7);
    for (let i = 0; i < count; i++) {
      const p = particles[cursor]; cursor = (cursor + 1) % particles.length;
      p.total = p.life = kind === 'water' ? 0.65 + Math.random() * 0.4 : 0.8 + Math.random() * 0.65;
      p.x = it.x + (Math.random() - 0.5) * 0.08; p.z = it.z + (Math.random() - 0.5) * 0.08; p.y = y;
      p.vx = (Math.random() - 0.5) * 0.5; p.vz = (Math.random() - 0.5) * 0.5; p.vy = kind === 'water' ? -0.15 : 0.35 + Math.random() * 0.35;
      p.gravity = kind === 'water' ? 1.4 : 0.4; p.size = kind === 'water' ? 0.025 : 0.035 + Math.random() * 0.035; p.tile = kind === 'water' ? 18 : kind === 'coin' && i < 3 ? 17 : 16;
    }
    if (kind === 'water') { can.life = 1.05; can.x = it.x; can.z = it.z; can.y = y + 0.12; }
  }
  function frame(entries, dt, t) {
    const camera = GR.camera; right.setFromMatrixColumn(camera.matrixWorld, 0); up.setFromMatrixColumn(camera.matrixWorld, 1);
    let slot = 0;
    for (let i = 0; i < entries.length && i < 64; i++) {
      const e = entries[i], it = e.it, g = e.g;
      const x = it.x, z = it.z, y = (g?.position.y ?? 0) + it.potH + it.height + 0.1;
      point.set(x, y, z); const distance = camera.position.distanceTo(point), scale = distance * 0.033;
      e.bx = x + right.x * scale * 0.77 + up.x * scale * 0.55; e.by = y + right.y * scale * 0.77 + up.y * scale * 0.55; e.bz = z + right.z * scale * 0.77 + up.z * scale * 0.55;
      point.set(x, y, z).project(camera); const visible = !!g?.visible && point.z > -1 && point.z < 1;
      const bob = enabled ? Math.sin(t * 1.7 + e.phase) * 0.008 : 0;
      put(slot++, x, y + bob, z, visible ? scale : 0, MOODS[e.status.mood], GR.mode === 'edit' ? 0.6 : 0.97);
      put(slot++, e.bx, e.by + bob, e.bz, visible && e.status.need ? scale * 1.08 : 0, NEEDS[e.status.need] || 8, GR.mode === 'edit' ? 0.55 : 0.98);
      e.shown = visible; e.radius = scale;
    }
    // Reserved slots keep instance identities stable when inventory changes.
    for (; slot < 128; slot++) put(slot, 0, 0, 0, 0, 0);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]; if (enabled && p.life > 0) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; p.vy -= p.gravity * dt; }
      put(128 + i, p.x, p.y, p.z, enabled && p.life > 0 ? p.size : 0, p.tile, Math.max(0, p.life / p.total));
    }
    const R = GR.state.room, w = R.window, a = R.poly[w.edge], b = R.poly[(w.edge + 1) % R.poly.length];
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz), nx = -dz / len, nz = dx / len;
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i], along = w.t0 + (w.t1 - w.t0) * ((i * 0.618034) % 1), d = m.d + Math.sin(t * 0.15 + m.a) * 0.07;
      put(288 + i, a[0] + dx / len * along + nx * d, m.h + Math.sin(t * 0.2 + m.a) * 0.08, a[1] + dz / len * along + nz * d, enabled ? 0.018 : 0, 20, 0.14 + Math.sin(t * 0.4 + m.a) * 0.07);
    }
    can.life = Math.max(0, can.life - dt);
    put(306, can.x + right.x * -0.14, can.y, can.z + right.z * -0.14, enabled && can.life ? 0.28 : 0, 19, Math.min(1, can.life * 4), -0.25 + Math.sin(can.life * 4) * 0.12);
    for (let i = 307; i < capacity; i++) put(i, 0, 0, 0, 0, 0);
    pool.instanceMatrix.needsUpdate = true; geo.attributes.zenTile.needsUpdate = true; geo.attributes.zenAlpha.needsUpdate = true;
  }
  return { burst, frame, get enabled() { return enabled; }, setEnabled(on) { enabled = !!on; }, pool };
}

export async function init(GR) {
  const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = new URL('./zen.css', import.meta.url).href; document.head.append(link);
  const esc = GR.esc;
  let local; try { local = JSON.parse(localStorage.getItem(STORAGE)); } catch { /* private browsing */ }
  let p = normalize(local), sync = 'local', saving = null, dirty = false, timer, ready = false;
  try { const remote = normalize(await GR.api('/api/zen/progress')); p = local && p.updated > remote.updated ? mergeProgress(p, remote) : remote; sync = 'saved'; } catch { sync = 'offline'; }
  let entries = [], lights = [], lastScan = -1, lastTick = -1, lastSelected = null, lastScore = GR.lastEval?.score, scoreStable = 0;
  const lightBases = new WeakMap();
  const fx = effects(GR), T = GR.THREE;
  let audio, audioGain;
  const metrics = { frames: 0, cpuMs: 0, avgMs: 0, pooledInstances: 320, addedDrawCalls: 1 };
  const hud = document.createElement('div'); hud.className = 'zen-hud lg'; hud.innerHTML = `<button id="zen-summary" aria-label="Open Zen garden">${GR.ICON.leaf}<span id="zen-level">Level 1</span><span class="zen-coin">${COIN}<b id="zen-coins">0</b></span></button><button id="zen-sound" aria-label="Mute garden sounds" aria-pressed="false">${SOUND}</button>`; document.querySelector('#app').append(hud);
  const soundButton = hud.querySelector('#zen-sound');
  function localSave() { try { localStorage.setItem(STORAGE, JSON.stringify(p)); } catch { sync = 'local only'; } }
  function updateHud() {
    hud.querySelector('#zen-level').textContent = `Level ${level(p.xp).n}`; hud.querySelector('#zen-coins').textContent = p.coins;
    soundButton.classList.toggle('is-muted', p.muted); soundButton.setAttribute('aria-label', p.muted ? 'Unmute garden sounds' : 'Mute garden sounds'); soundButton.setAttribute('aria-pressed', String(p.muted));
    const label = document.querySelector('#zen-save'); if (label) label.textContent = sync === 'saved' ? 'Saved to garden' : sync === 'saving' ? 'Saving…' : 'On this device · sync when online';
  }
  function changed() { p.updated = Date.now(); dirty = true; sync = 'saving'; localSave(); clearTimeout(timer); timer = setTimeout(flush, 450); updateHud(); }
  async function flush() {
    clearTimeout(timer); if (saving) return saving;
    if (!dirty) return true;
    saving = (async () => {
      let retries = 0;
      while (dirty && retries < 3) {
        dirty = false; const snapshot = JSON.parse(JSON.stringify(p));
        try {
          const r = await fetch('/api/zen/progress', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Garden-Key': GR.KEY }, body: JSON.stringify(snapshot) });
          const response = await r.json();
          if (r.status === 409 && response.progress) { p = mergeProgress(p, response.progress); dirty = true; retries++; continue; }
          if (!r.ok) throw new Error(response.error || 'Save failed');
          p.revision = response.revision;
          const verified = await GR.api('/api/zen/progress');
          if (verified.revision !== response.revision) { p = mergeProgress(p, verified); dirty = true; retries++; continue; }
          if (verified.updated !== snapshot.updated) throw new Error('Save not verified');
          sync = 'saved'; localSave();
        } catch { dirty = true; sync = 'offline'; break; }
      }
      return !dirty;
    })();
    const result = await saving; saving = null; updateHud(); return result;
  }
  addEventListener('online', flush);
  addEventListener('pagehide', () => { localSave(); if (dirty) fetch('/api/zen/progress', { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Garden-Key': GR.KEY }, body: JSON.stringify(p) }).catch(() => {}); });
  addEventListener('storage', (e) => { if (e.key !== STORAGE || !e.newValue) return; try { p = mergeProgress(p, JSON.parse(e.newValue)); dirty = true; clearTimeout(timer); timer = setTimeout(flush, 700); } catch { /* ignore invalid storage */ } });
  function chime(kind = 'care') {
    if (p.muted || navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    try {
      if (!audio) { audio = new (window.AudioContext || window.webkitAudioContext)(); audioGain = audio.createGain(); audioGain.gain.value = 0.035; audioGain.connect(audio.destination); }
      audio.resume().catch(() => {});
      const notes = kind === 'win' ? [523.25, 659.25, 783.99, 1046.5] : kind === 'water' ? [659.25, 880] : [783.99, 987.77];
      notes.forEach((hz, i) => { const at = audio.currentTime + i * 0.08, osc = audio.createOscillator(), g = audio.createGain(); osc.type = 'sine'; osc.frequency.setValueAtTime(hz, at); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(0.65, at + 0.012); g.gain.exponentialRampToValueAtTime(0.001, at + 0.27); osc.connect(g); g.connect(audioGain); osc.start(at); osc.stop(at + 0.3); osc.onended = () => { osc.disconnect(); g.disconnect(); }; });
    } catch { /* audio is optional */ }
  }
  soundButton.onclick = () => { p.muted = !p.muted; if (p.muted && audio) audio.suspend().catch(() => {}); changed(); refreshPanel(); if (!p.muted) chime(); };
  const night = () => { const h = new Date().getHours(); return h >= 22 || h < 6; };
  const status = (it) => condition(it, p, GR.lastEval?.warns, Date.now(), night());
  const plants = () => GR.state.items.filter((it) => it.kind === 'plant');
  function scan() {
    const old = new Map(entries.map((e) => [e.it.id, e]));
    entries = plants().map((it, i) => {
      const g = GR.meshOf(it.id), holder = g?.userData.holder, previous = old.get(it.id);
      if (previous && previous.g === g) { previous.it = it; return previous; }
      return { it, g, holder, phase: i * 2.39996, sx: holder?.scale.x || 1, sy: holder?.scale.y || 1, sz: holder?.scale.z || 1, rx: holder?.rotation.x || 0, rz: holder?.rotation.z || 0, bounce: 0, x: it.x, z: it.z, status: status(it), shown: false, bx: 0, by: 0, bz: 0 };
    });
    lights = []; const seen = new Set();
    for (const it of GR.state.items) if (['led', 'stake', 'ring', 'lamp5'].includes(it.kind)) GR.meshOf(it.id)?.traverse((o) => { const m = o.material; if (m && !Array.isArray(m) && m.emissiveIntensity && !seen.has(m)) { if (!lightBases.has(m)) lightBases.set(m, m.emissiveIntensity); seen.add(m); lights.push({ m, base: lightBases.get(m) }); } });
  }
  function award(key, title) {
    if (p.achievements.includes(key)) return false;
    p.achievements.push(key); p.xp += 25; p.coins += 10;
    GR.toast(`${title} · +10 gold`, 3000); chime('win'); return true;
  }
  function tick() {
    const ps = entries.map((e) => e.it), now = Date.now(), oldVisit = p.lastVisit, d = visit(p, ps, now); let modified = oldVisit !== p.lastVisit;
    let allHappy = ps.length > 0, allLight = ps.length > 0;
    for (const e of entries) {
      const previous = e.status.mood; e.status = status(e.it);
      if (e.status.mood === 'happy' && previous !== 'happy') fx.burst(e.it, 'sparkle', 9);
      allHappy &&= e.status.health >= 85 && !e.status.crowded && !e.status.thirsty;
      allLight &&= e.status.sat >= 0.99;
    }
    if (allLight && !d.light) { d.light = true; modified = true; }
    if (layoutKey(ps) !== d.start && !d.arranged) { d.arranged = true; modified = true; }
    if (allHappy) modified = award('allHappy', ACHIEVEMENTS.allHappy[0]) || modified;
    if (allLight) modified = award('lightKeeper', ACHIEVEMENTS.lightKeeper[0]) || modified;
    if (d.arranged) modified = award('arranger', ACHIEVEMENTS.arranger[0]) || modified;
    if (p.streak >= 7) modified = award('week', ACHIEVEMENTS.week[0]) || modified;
    // Reward new all-time 5-point tiers, not oscillating the same two layouts.
    const score = GR.lastEval?.score;
    if (Number.isFinite(score)) {
      if (score === lastScore) scoreStable++; else { lastScore = score; scoreStable = 0; }
      if (scoreStable >= 1) {
        if (p.arrangementTier === null) { p.arrangementTier = Math.floor(score / 5); p.bestScore = score; modified = true; }
        else if (score > (p.bestScore ?? -Infinity) + 0.5) {
          const tier = Math.floor(score / 5), tiers = Math.max(0, tier - p.arrangementTier);
          p.bestScore = score;
          if (tiers > 0) { p.arrangementTier = tier; const reward = Math.min(10, tiers) * 2; p.coins += reward; p.xp += reward * 2; GR.toast(`A happier arrangement · +${reward} gold`); chime('win'); for (let i = 0; i < Math.min(4, entries.length); i++) fx.burst(entries[i].it, 'coin', 14); }
          else if (entries.length) fx.burst(entries[0].it, 'sparkle', 10);
          modified = true;
        }
      }
    }
    if (modified) changed(); refreshPanel(); updateHud();
  }
  function care(id, action = 'check') {
    const it = GR.itemById(id); if (!ready || !it || it.kind !== 'plant') return { ok: false, reason: !ready ? 'Garden is loading' : 'Plant not found' };
    if (action === 'sun' || action === 'space') { GR.setMode('edit'); GR.select(id); if (action === 'sun') GR.setLight(true); GR.toast(action === 'sun' ? 'Move toward the window or a grow light' : 'Give this plant a little more space'); return { ok: true, action, coins: 0, xp: 0 }; }
    visit(p, plants()); const result = performCare(p, it, action);
    if (!result.ok) { GR.toast(result.reason); return result; }
    const e = entries.find((x) => x.it.id === id); if (e) { e.bounce = 0.8; e.status = status(it); }
    fx.burst(it, action === 'water' ? 'water' : 'sparkle', action === 'water' ? 22 : 14); fx.burst(it, 'coin', 5);
    chime(action); award('firstCare', ACHIEVEMENTS.firstCare[0]);
    GR.toast(`${it.name} · ${action === 'water' ? 'a little drink' : action === 'feed' ? 'fed with love' : action === 'trim' ? 'a fresh trim' : 'checked in'} · +${result.coins} gold`);
    changed(); tick(); return { ...result, ...status(it) };
  }
  function claim(id) {
    const ps = plants(), q = quests(p, ps).find((x) => x.id === id);
    if (!q || !q.done || q.claimed) return;
    p.days[dayKey()].claims.push(id); p.coins += 15; p.xp += 30; chime('win'); for (let i = 0; i < Math.min(3, entries.length); i++) fx.burst(entries[i].it, 'coin', 14);
    GR.toast('Daily ritual complete · +15 gold · +30 XP'); changed(); refreshPanel();
  }
  const timeLabel = (at) => !at ? 'Not logged yet' : new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  function panel() {
    const ps = plants(), l = level(p.xp);
    GR.openSheet('zen', `<section id="zen-panel"><div class="zen-heading"><div><span class="micro">YOUR DAILY LITTLE RITUAL</span><h3>A little <em>zen</em></h3></div><button class="btn zen-panel-sound" aria-label="${p.muted ? 'Unmute garden sounds' : 'Mute garden sounds'}">${SOUND}</button></div><p class="sub">Small kindnesses. A room full of life.</p>
      <div class="facts zen-stats"><div class="fact bracket"><span class="micro">Garden level</span><b id="zen-panel-level">${l.n}</b></div><div class="fact"><span class="micro">Gold coins</span><b id="zen-panel-coins">${p.coins}</b></div><div class="fact"><span class="micro">Day streak</span><b id="zen-streak">${p.streak}</b></div></div><div class="zen-xp-label micro"><span id="zen-xp-copy"></span><span id="zen-save"></span></div><div class="zen-meter"><i id="zen-xp"></i></div>
      <h4 class="zen-section">Today's rituals <span class="micro">+15 GOLD EACH</span></h4><div class="zen-quests">${quests(p, ps).map((q) => `<div class="zen-quest" data-quest="${q.id}"><div><b>${q.title}</b><span class="zen-quest-detail"></span><div class="zen-meter"><i></i></div></div><button class="btn" data-claim="${q.id}"></button></div>`).join('')}</div>
      <h4 class="zen-section">Little milestones</h4><div class="zen-achievements">${Object.entries(ACHIEVEMENTS).map(([id, [title, detail]]) => `<span data-achievement="${id}" title="${detail}" class="zen-achievement">${GR.ICON.sparkle}${title}</span>`).join('')}</div>
      <h4 class="zen-section">Your leafy friends <span class="micro">${ps.length} PLANTS</span></h4><p class="zen-note">A playful care diary, not a moisture sensor. Check soil before watering; family intervals are reminders, not prescriptions.</p>
      <div class="zen-roster">${ps.map((it) => `<article class="zen-plant" data-plant="${esc(it.id)}"><div class="zen-plant-row"><button class="zen-plant-name" data-select="${esc(it.id)}">${esc(it.name)}<span class="zen-mood"></span></button><button class="btn zen-next" data-plant-id="${esc(it.id)}"></button></div><div class="zen-health-row"><div class="zen-meter" role="progressbar" aria-label="${esc(it.name)} health" aria-valuemin="0" aria-valuemax="100"><i></i></div><span class="zen-health"></span></div><details><summary>Care diary & tools</summary><p class="zen-record"></p><div class="zen-tools">${Object.keys(ACTIONS).map((a) => `<button class="btn" data-care="${a}" data-id="${esc(it.id)}">${LABEL[a]}</button>`).join('')}</div></details></article>`).join('')}</div></section>`);
    const root = document.querySelector('#zen-panel');
    root.querySelector('.zen-panel-sound').onclick = () => soundButton.click();
    root.querySelectorAll('[data-claim]').forEach((b) => b.onclick = () => claim(b.dataset.claim));
    root.querySelectorAll('[data-select]').forEach((b) => b.onclick = () => { const e = entries.find((x) => x.it.id === b.dataset.select); if (e) e.bounce = 0.8; GR.select(b.dataset.select); });
    root.querySelectorAll('[data-care]').forEach((b) => b.onclick = () => care(b.dataset.id, b.dataset.care));
    root.querySelectorAll('.zen-next').forEach((b) => b.onclick = () => { const it = GR.itemById(b.dataset.plantId); care(it.id, status(it).need || 'check'); });
    refreshPanel();
  }
  function refreshPanel() {
    const root = document.querySelector('#zen-panel'); if (!root || document.querySelector('#sheet')?.classList.contains('hidden')) return;
    const l = level(p.xp); root.querySelector('#zen-panel-level').textContent = l.n; root.querySelector('#zen-panel-coins').textContent = p.coins; root.querySelector('#zen-streak').textContent = p.streak;
    root.querySelector('#zen-xp-copy').textContent = `${p.xp - l.floor} / ${l.next - l.floor} XP TO LEVEL ${l.n + 1}`; root.querySelector('#zen-xp').style.width = `${l.fraction * 100}%`;
    const sb = root.querySelector('.zen-panel-sound'); sb.classList.toggle('is-muted', p.muted); sb.setAttribute('aria-label', p.muted ? 'Unmute garden sounds' : 'Mute garden sounds'); sb.setAttribute('aria-pressed', String(p.muted));
    for (const q of quests(p, plants())) {
      const el = root.querySelector(`[data-quest="${q.id}"]`); if (!el) continue;
      el.querySelector('.zen-quest-detail').textContent = q.detail; el.querySelector('i').style.width = `${(q.done ? 1 : q.fraction) * 100}%`;
      const b = el.querySelector('button'); b.disabled = !q.done || q.claimed; b.textContent = q.claimed ? 'Claimed' : q.done ? 'Claim' : 'Growing'; b.classList.toggle('gold', q.done && !q.claimed);
    }
    root.querySelectorAll('[data-achievement]').forEach((el) => el.classList.toggle('earned', p.achievements.includes(el.dataset.achievement)));
    root.querySelectorAll('[data-plant]').forEach((el) => {
      const it = GR.itemById(el.dataset.plant); if (!it) { el.hidden = true; return; }
      const s = status(it), need = s.need || 'check', c = p.care[it.id] || {};
      el.querySelector('.zen-mood').textContent = `${s.mood} · ${Math.round(s.sat * 100)}% light${s.crowded ? ' · crowded' : ''}`;
      el.querySelector('.zen-health').textContent = `${s.health}%`; el.querySelector('.zen-meter i').style.width = `${s.health}%`; el.querySelector('[role=progressbar]').setAttribute('aria-valuenow', s.health);
      const next = el.querySelector('.zen-next'); next.textContent = LABEL[need]; next.setAttribute('aria-label', `${LABEL[need]} · ${it.name}`); next.disabled = !s.need;
      el.querySelector('.zen-record').textContent = `Water: ${timeLabel(c.watered)} · ~${s.waterDays} days between drinks. Fed: ${timeLabel(c.fed)}. Checked: ${timeLabel(c.checked)}.`;
      el.querySelectorAll('[data-care]').forEach((b) => { const a = ACTIONS[b.dataset.care], days = b.dataset.care === 'water' ? s.waterDays : a.days; b.disabled = !!c[a.field] && Date.now() - c[a.field] < days * DAY; });
    }); updateHud();
  }
  hud.querySelector('#zen-summary').onclick = panel;
  GR.addDock({ key: 'zen', label: 'Zen', icon: GR.ICON.leaf, open: panel });
  GR.addItemAction({ label: 'Care & mood', icon: GR.ICON.leaf, when: (it) => it.kind === 'plant', run: panel });
  scan(); visit(p, plants()); ready = true;
  GR.zen = { health(id) { const it = GR.itemById(id); return it?.kind === 'plant' ? status(it).health : null; }, mood(id) { const it = GR.itemById(id); return it?.kind === 'plant' ? status(it).mood : null; }, care, status(id) { const it = GR.itemById(id); return it?.kind === 'plant' ? status(it) : null; }, open: panel, flush, get progress() { return JSON.parse(JSON.stringify(p)); }, metrics, setAnimations(on) { fx.setEnabled(on); }, get animations() { return fx.enabled; }, get soundState() { return { muted: p.muted, state: audio?.state || 'not started', volume: 0.035 }; } };
  // Bubble hit testing uses a 44px touch target without placing 25 DOM nodes over the scene.
  const projected = new T.Vector3(); let pointer = null;
  GR.canvas.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || GR.mode !== 'explore') return;
    const rect = GR.canvas.getBoundingClientRect(); let best = null, distance = 22;
    for (const e of entries) if (e.shown && e.status.need) {
      projected.set(e.bx, e.by, e.bz).project(GR.camera);
      const x = rect.left + (projected.x + 1) * rect.width / 2, y = rect.top + (1 - projected.y) * rect.height / 2, d = Math.hypot(event.clientX - x, event.clientY - y);
      if (d < distance) { distance = d; best = e; }
    }
    if (!best) return;
    pointer = { id: best.it.id, action: best.status.need, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    GR.canvas.setPointerCapture(event.pointerId); event.stopImmediatePropagation();
  }, { capture: true });
  GR.canvas.addEventListener('pointerup', (event) => { if (!pointer || event.pointerId !== pointer.pointerId) return; const tap = pointer; pointer = null; event.stopImmediatePropagation(); if (Math.hypot(event.clientX - tap.x, event.clientY - tap.y) < 10) care(tap.id, tap.action); }, { capture: true });
  GR.canvas.addEventListener('pointercancel', () => { pointer = null; });
  GR.onFrame((dt, t) => {
    const start = performance.now(); dt = Math.min(dt, 0.05);
    if (t - lastScan > 0.5) { scan(); lastScan = t; }
    if (t - lastTick > 1) { tick(); lastTick = t; }
    if (GR.selected !== lastSelected) { lastSelected = GR.selected; const e = entries.find((x) => x.it.id === lastSelected); if (e) e.bounce = 0.75; }
    for (const e of entries) {
      if (e.x !== e.it.x || e.z !== e.it.z) { e.x = e.it.x; e.z = e.it.z; e.bounce = 0.65; }
      const h = e.holder; if (!h) continue;
      e.bounce = Math.max(0, e.bounce - dt); const b = fx.enabled ? Math.sin(e.bounce * 25) * e.bounce * 0.085 : 0;
      const amplitude = fx.enabled ? e.status.mood === 'happy' ? 0.016 : e.status.mood === 'sleepy' ? 0.003 : 0.007 : 0;
      h.rotation.z = e.rz + Math.sin(t * 1.45 + e.phase) * amplitude; h.rotation.x = e.rx + Math.cos(t * 1.05 + e.phase) * amplitude * 0.4;
      h.scale.set(e.sx * (1 - b * 0.45), e.sy * (1 + b), e.sz * (1 - b * 0.45));
    }
    for (let i = 0; i < lights.length; i++) lights[i].m.emissiveIntensity = lights[i].base * (fx.enabled ? 1 + Math.sin(t * 1.6 + i) * 0.045 : 1);
    fx.frame(entries, dt, t);
    metrics.frames++; metrics.cpuMs += performance.now() - start; metrics.avgMs = metrics.cpuMs / metrics.frames;
  });
  changed(); tick(); updateHud();
}
