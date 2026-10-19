import { photoImage } from './real.js';
// Living collection: inventory truth + attributed care, never inferred observations.
const LIGHT = { high: 'High light', med: 'Medium light', low: 'Low light' };
const cm = (m) => `${Math.round((m || 0) * 100)} cm`;
const idle = (fn) => window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 350 }) : setTimeout(fn, 30);

export function init(GR) {
  if (GR.almanac) return;
  const e = GR.esc, T = GR.THREE;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/modules/almanac.css'; document.head.append(css);
  let reference = null, referencePromise = null, root = null, observer = null, tick = 0, generation = 0;
  let grid = false, detailId = null, restoreId = null, opener = null;
  let tab = 'plants', photoId = null, photoLoading = false, photoError = '', photoSession = 0;
  const photoKey = p => `${p.revision}/${p.id}`;
  const photoDate = p => new Date(typeof p.created === 'number' ? p.created * (p.created < 1e12 ? 1000 : 1) : p.created);
  const photoTime = p => Number.isNaN(+photoDate(p)) ? 'Time unavailable' : photoDate(p).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const filters = { search: '', family: '', light: '', health: '' };
  const visible = new Set(), models = new Map(), pending = new Set(), history = new Map();
  const metrics = { rendererCount: 0, renders: 0, frames: 0, maxVisible: 0, modelErrors: [], renderMs: [], visited: new Set() };
  let renderer = null, rendererUnavailable = false, scene = null, camera = null, lastFrame = 0;
  const plants = () => GR.state.items.filter((it) => it.kind === 'plant').slice().sort((a, b) => a.id.localeCompare(b.id));
  const family = (it) => it.family || GR.plantMeta(it.id)?.family || 'unknown';
  const care = (it) => reference?.families[family(it)] || { label: 'Unidentified plant', species: 'Species not identified', botanicalFamily: 'Unconfirmed', sources: [], identity: 'Confirm identification before species-specific care.', light: LIGHT[it.light], water: 'Check soil before watering.', temperature: 'Unknown', humidity: 'Unknown', soil: 'Confirm identity', feeding: 'Confirm identity', toxicity: 'Unknown — keep away from pets.', issues: 'Not assessed' };
  function zen(it) {
    try { return { health: GR.zen?.health?.(it.id), mood: GR.zen?.mood?.(it.id) }; } catch { return {}; }
  }
  function healthKey(it) { const h = zen(it).health; return !Number.isFinite(h) ? 'unknown' : h >= 80 ? 'thriving' : h >= 55 ? 'steady' : 'attention'; }
  function filtered() {
    const q = filters.search.toLowerCase().trim();
    return plants().filter((it) => (!q || `${it.id} ${it.name} ${family(it)} ${care(it).species} ${care(it).botanicalFamily}`.toLowerCase().includes(q)) && (!filters.family || family(it) === filters.family) && (!filters.light || it.light === filters.light) && (!filters.health || healthKey(it) === filters.health));
  }
  function getReference() {
    if (!referencePromise) referencePromise = GR.api('/api/almanac/species').then((data) => {
      if (!data.families || !data.sources) throw new Error('Care reference unavailable'); reference = data; return data;
    }).catch((err) => { referencePromise = null; throw err; });
    return referencePromise;
  }
  function release(model) {
    const geometry = new Set(), materials = new Set();
    model.traverse((obj) => { if (obj.geometry) geometry.add(obj.geometry); for (const m of (Array.isArray(obj.material) ? obj.material : [obj.material])) if (m) materials.add(m); });
    geometry.forEach((g) => g.dispose()); materials.forEach((m) => m.dispose()); model.removeFromParent();
  }
  function clearModels() { for (const model of models.values()) release(model); models.clear(); }
  function createRenderer() {
    if (renderer) return true;
    if (rendererUnavailable) return false;
    try {
      // This canvas is deliberately NOT attached. Visible cards get 2D copies.
      renderer = new T.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' });
      renderer.setPixelRatio(1); renderer.setSize(240, 240, false); renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = T.SRGBColorSpace; renderer.toneMapping = T.ACESFilmicToneMapping;
      scene = new T.Scene(); camera = new T.PerspectiveCamera(34, 1, .01, 30);
      scene.add(new T.HemisphereLight(0xf8f3da, 0x465b3c, 2.8));
      const key = new T.DirectionalLight(0xffedc3, 3.2); key.position.set(2, 4, 3); scene.add(key);
      metrics.rendererCount = 1; return true;
    } catch (err) { renderer = null; rendererUnavailable = true; metrics.modelErrors.push(String(err)); return false; }
  }
  function queueModel(it) {
    if (models.has(it.id) || pending.has(it.id)) return;
    pending.add(it.id); const epoch = generation;
    const name = family(it);
    if (!/^[a-z_]+$/.test(name) || !reference?.families[name]) { pending.delete(it.id); return; }
    import(`/models/plants/${name}.js`).then((mod) => idle(() => {
      pending.delete(it.id);
      if (!root?.open || epoch !== generation || models.has(it.id)) return;
      try {
        const model = new T.Group(), foliage = mod.createPlant({ height: it.height, spread: Math.max(it.w, it.potD * 1.6), potDiameter: it.potD, width: it.box ? it.w : undefined, depth: it.box ? it.d : undefined, seed: Number(it.id.replace(/\D/g, '')) || 1 });
        foliage.position.y = it.potH; model.add(foliage);
        const pot = it.box ? new T.BoxGeometry(it.w, it.potH, it.d) : new T.CylinderGeometry(it.potD / 2, it.potD * .37, it.potH, 20);
        const vessel = new T.Mesh(pot, new T.MeshStandardMaterial({ color: 0x847360, roughness: .85 })); vessel.position.y = it.potH / 2; model.add(vessel);
        const box = new T.Box3().setFromObject(model), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
        const normalized = new T.Group(); normalized.add(model); model.position.sub(center); normalized.scale.setScalar(1.6 / Math.max(size.x, size.y, size.z, .01));
        models.set(it.id, normalized);
        // Small LRU: never retain all 25 models just because they were visited.
        while (models.size > 8) {
          const victim = [...models.keys()].find((id) => ![...visible].some((c) => c.dataset.model === id));
          if (!victim) break; release(models.get(victim)); models.delete(victim);
        }
      } catch (err) { metrics.modelErrors.push(`${it.id}: ${err}`); markModel(it.id, '3D unavailable'); }
    })).catch((err) => { pending.delete(it.id); metrics.modelErrors.push(`${it.id}: ${err}`); markModel(it.id, '3D unavailable'); });
  }
  function markModel(id, text) { root?.querySelectorAll(`[data-model="${id}"]`).forEach((c) => { c.parentElement.querySelector('[data-model-label]').textContent = text; }); }
  function frame(now) {
    if (!root?.open) return;
    tick = requestAnimationFrame(frame);
    if (document.hidden || now - lastFrame < 40 || !visible.size) return;
    lastFrame = now; metrics.frames++;
    if (!createRenderer()) { for (const c of visible) markModel(c.dataset.model, '3D unavailable · real photo retained'); return; }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const canvas of visible) {
      if (!canvas.isConnected) { visible.delete(canvas); continue; }
      const it = plants().find((p) => p.id === canvas.dataset.model); if (!it) continue;
      const model = models.get(it.id); if (!model) { queueModel(it); continue; }
      if (reduced && canvas.dataset.rendered) continue;
      const start = performance.now(); scene.add(model); model.rotation.y = reduced ? .35 : now * .0003;
      camera.position.set(0, .18, 3.15); camera.lookAt(0, 0, 0); renderer.render(scene, camera);
      const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, 240, 240); ctx.drawImage(renderer.domElement, 0, 0);
      model.removeFromParent(); canvas.dataset.rendered = 'true'; metrics.renders++;
      metrics.renderMs.push(performance.now() - start); if (metrics.renderMs.length > 240) metrics.renderMs.shift();
      markModel(it.id, `Live 3D · illustrative${GR.plantMeta(it.id)?.approved === false ? ' · unapproved' : ''}`);
    }
  }
  function observe() {
    observer?.disconnect(); visible.clear();
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const c = entry.target;
        if (entry.isIntersecting) {
          visible.add(c); metrics.visited.add(c.dataset.model); const it = plants().find((p) => p.id === c.dataset.model); if (it) { queueModel(it); void loadHistory(it); }
        } else visible.delete(c);
      }
      metrics.maxVisible = Math.max(metrics.maxVisible, visible.size);
    }, { root: root.querySelector('[data-scroll]'), threshold: .05 });
    root.querySelectorAll('canvas[data-model]').forEach((c) => observer.observe(c));
  }
  function historySupported() { return !!(GR.history?.open || document.querySelector('link[data-history]')); }
  async function loadHistory(it) {
    if (!historySupported()) return;
    if (history.has(it.id)) { paintHistory(it.id); return; }
    history.set(it.id, { loading: true });
    try {
      const data = await GR.api(`/api/history/plant/${encodeURIComponent(it.id)}`);
      if (!Array.isArray(data.photos)) throw new Error('Photo history unavailable');
      history.set(it.id, { photo: [...data.photos].sort((a, b) => +new Date(b.ts) - +new Date(a.ts))[0] || null });
    } catch { history.set(it.id, { error: true }); }
    paintHistory(it.id);
  }
  function paintHistory(id) {
    const entry = history.get(id);
    root?.querySelectorAll(`[data-history="${id}"]`).forEach((el) => {
      if (!entry || entry.loading) { el.innerHTML = '<span class="sub">Loading newest memory…</span>'; return; }
      const p = entry.photo, it = plants().find((p) => p.id === id);
      el.innerHTML = p ? `<img src="${e(p.thumb512)}" loading="lazy" decoding="async" alt="Newest history photograph of ${e(it?.name || id)}"><span><small>Newest memory${p.assignment?.unsure ? ' · identity unsure' : ''}</small>${e(new Date(p.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }))}${p.dateSource === 'mtime' ? ' · file date' : ''}</span>` : `<span class="sub">${entry.error ? 'Memories unavailable — retry in History' : 'No history photographs yet'}</span>`;
    });
  }
  function facts(it, detailed) {
    const c = care(it), z = zen(it), support = GR.state.items.find((p) => p.id === it._on), score = Number.isFinite(it._sat) ? `${Math.round(it._sat * 100)}% light satisfaction` : 'Light not assessed';
    const water = c.waterDays ? `${c.waterDays[0]}–${c.waterDays[1]} days · soil first` : 'Soil check first';
    const f = (label, val, cls = '') => `<div class="alm-fact ${cls}"><dt>${label}</dt><dd>${e(val)}</dd></div>`;
    return `<div class="alm-place"><span>${e(support ? `On ${support.name}` : 'On the floor')} · x ${it.x.toFixed(2)} m / z ${it.z.toFixed(2)} m</span><strong>${e(score)}</strong><span>${Number.isFinite(z.health) ? `Zen health ${Math.round(z.health)}/100 · ${e(z.mood || 'mood unknown')} · virtual estimate` : 'Zen health not available'}</span></div><dl class="alm-facts">${f('Light', c.light)}${f('Water · starting interval', water)}${f('Temperature · reference', c.temperature)}${f('Humidity · reference', c.humidity)}${f('Soil', c.soil, 'alm-wide')}${f('Feeding', c.feeding, 'alm-wide')}${f('Pets', c.toxicity, 'alm-wide')}${f('Watch for', c.issues, 'alm-wide')}</dl>${detailed ? `<p class="alm-water">${e(c.water)}</p><p class="alm-identity">${e(c.identity)}</p><details class="alm-sources"><summary>Sources & care limits</summary><p>${e(reference.note)}</p>${c.sources.map((id) => { const s = reference.sources[id]; return s ? `<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title)} ↗</a><p>${e(s.supports)}</p>` : ''; }).join('')}<p>Reference reviewed ${e(reference.reviewed)}. Climate bands and day intervals are editorial starting points, not measured ideals.</p></details>` : ''}`;
  }
  function card(it, index, total, detailed = false) {
    const c = care(it), hist = historySupported(), meta = GR.plantMeta(it.id);
    return `<article class="alm-card" data-plant="${e(it.id)}" aria-label="${e(it.name)}" tabindex="0"><div class="alm-card-head"><span class="micro">${e(it.id)} · ${index + 1} / ${total}</span><span class="alm-light">${e(LIGHT[it.light] || it.light)}</span></div><button class="alm-title" data-detail="${e(it.id)}" ${detailed ? 'disabled' : ''}><h2>${e(it.name)}</h2><span>${e(c.species)} · ${e(c.botanicalFamily)}</span></button><div class="alm-media"><figure><img class="alm-cutout" src="/${e((it.src || meta?.src || '').replace(/^\//, ''))}" alt="Real cutout photograph of ${e(it.name)}" loading="lazy" decoding="async"><figcaption>Real photograph</figcaption></figure><figure class="alm-turntable"><canvas width="240" height="240" data-model="${e(it.id)}" role="img" aria-label="Rotating procedural model of ${e(it.name)}"></canvas><figcaption data-model-label>3D loading${meta?.approved === false ? ' · unapproved model' : ''}</figcaption></figure></div><div class="alm-measure"><span>Pot ${cm(it.potD)} × ${cm(it.potH)}${it.box ? ` · box ${cm(it.w)} × ${cm(it.d)}` : ''}</span><span>Plant ${cm(it.height)} tall</span></div>${facts(it, detailed)}${plantPhotos(it.id)}${hist ? `<div class="alm-memory" data-history="${e(it.id)}"><span class="sub">Newest memory loads on view</span></div>` : ''}<div class="alm-actions"><button class="btn gold" data-room="${e(it.id)}">Show in room</button><button class="btn" data-edit="${e(it.id)}">Edit</button>${hist ? `<button class="btn" data-history-open="${e(it.id)}">History</button>` : ''}${!detailed ? `<button class="btn alm-more" data-detail="${e(it.id)}" aria-label="Details for ${e(it.name)}">Details ↗</button>` : ''}</div></article>`;
  }
  function photoMedia(photo, full = false) {
    const hq = photoImage(photo), url = hq || photo.beauty || (photo.base ? `${photo.base}view.jpg` : '');
    const failed = ['failed', 'needs-review', 'alignment-rejected', 'capture-failed'].includes(photo.status?.state);
    const label = hq ? 'Generated interpretation' : failed ? 'Photo needs review' : 'Developing · procedural capture';
    return `<figure class="alm-photo-media ${hq ? '' : 'is-developing'}">${url ? `<img src="${e(url)}" alt="${e(label)}" ${full ? '' : 'loading="lazy"'} decoding="async">` : '<div class="alm-photo-blank"></div>'}<figcaption>${e(label)}</figcaption></figure>`;
  }
  function plantPhotos(id) {
    const list = (GR.real?.photos || []).filter(p => p.plants?.some(it => it.id === id));
    return `<section data-camera-plant="${e(id)}" ${list.length ? '' : 'hidden'} class="alm-plant-photos" aria-label="Camera photos of this plant"><span class="micro">In ${list.length} camera ${list.length === 1 ? 'photo' : 'photos'}</span><div>${list.slice(0, 4).map(p => `<button data-camera-photo="${e(photoKey(p))}" aria-label="Open camera photo from ${e(photoTime(p))}">${photoMedia(p)}<span>${e(photoTime(p))}</span></button>`).join('')}</div></section>`;
  }
  function renderPhotos() {
    if (!root?.open) return;
    observer?.disconnect(); visible.clear();
    const list = GR.real?.photos || [], photo = list.find(p => photoKey(p) === photoId);
    if (photoId && !photo) photoId = null;
    root.dataset.view = photo ? 'photo' : 'photos';
    root.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    root.querySelector('[data-count]').textContent = `${list.length} camera ${list.length === 1 ? 'photo' : 'photos'} · newest first`;
    root.querySelector('[data-filters]').hidden = true;root.querySelector('[data-toggle]').hidden = true;
    root.querySelector('[data-back]').hidden = !photo;root.querySelector('[data-back]').textContent = '← Photos';
    root.querySelector('[data-detail-nav]').hidden = true;
    root.querySelector('[data-subtitle]').textContent = photo ? photoTime(photo) : 'Your captured views · all garden layouts';
    const scroll = root.querySelector('[data-scroll]');scroll.setAttribute('aria-label', photo ? 'Camera photo' : 'Camera photos');
    if (photo) {
      const position = photo.camera?.position?.map(n => Number(n).toFixed(2)).join(', ') || 'Unavailable';
      const rotation = photo.camera?.quaternion?.map(n => Number(n).toFixed(3)).join(', ') || 'Unavailable';
      scroll.innerHTML = `<article class="alm-photo-full" data-open-photo="${e(photoKey(photo))}"><div class="alm-photo-actions"><button class="btn gold" data-photo-go>Go to this view</button><button class="btn" data-photo-walk>Walk around</button><button class="btn" data-photo-delete ${photo.revision === 'pending' && photo.status?.state !== 'capture-failed' ? 'disabled' : ''}>Delete</button></div>${photoMedia(photo, true)}<div class="alm-photo-caption"><time>${e(photoTime(photo))}</time><p class="sub">${e(photo.status?.error || 'Generated room interpretation. Plant identities below come from the captured plan.')}</p><dl class="alm-photo-pose"><dt>Camera position · m</dt><dd>${e(position)}</dd><dt>Orientation · quaternion</dt><dd>${e(rotation)}</dd><dt>Vertical field of view</dt><dd>${e(photo.camera?.fov)}°</dd><dt>Layout revision</dt><dd>${e(photo.revision)}</dd></dl><p class="alm-photo-error" role="status">${e(photoError)}</p><h2>Plants in this capture</h2><div class="alm-photo-plants">${(photo.plants || []).map(it => `<article class="alm-photo-plant"><span class="micro">${e(it.id)}</span><h3>${e(it.name || it.id)}</h3>${it.family ? `<p>${e(it.family.replaceAll('_', ' '))}</p>` : ''}${plants().some(p => p.id === it.id) ? `<button class="btn" data-photo-plant="${e(it.id)}">Plant card</button>` : '<p>From an earlier layout</p>'}</article>`).join('') || '<p class="sub">No plants recorded in this capture.</p>'}</div></div></article>`;
    } else {
      scroll.innerHTML = `<div class="alm-photo-grid">${list.map(p => `<button class="alm-photo-card" data-camera-photo="${e(photoKey(p))}">${photoMedia(p)}<time>${e(photoTime(p))}</time><span>${e((p.plants || []).map(it => it.name || it.id).join(' · ') || 'Room view')}</span></button>`).join('')}</div>${!list.length ? `<div class="alm-empty"><h2>${photoLoading ? 'Opening photos…' : 'Your first view awaits'}</h2><p>${e(photoError || 'Tap the Camera shutter in the room. Each photo saves the view and the plants in it.')}</p></div>` : ''}${photoError ? `<p class="alm-photo-error" role="status">${e(photoError)}</p>` : ''}<button class="btn" data-photo-refresh ${photoLoading ? 'disabled' : ''}>${photoLoading ? 'Refreshing…' : 'Refresh photos'}</button>`;
    }
  }
  async function loadPhotos() {
    const session = root, mine = ++photoSession;photoLoading = true;photoError = '';renderPhotos();
    try {if (!GR.real) throw new Error('Camera is still loading');await GR.real.refreshPhotos();}
    catch (err) {if (root === session && mine === photoSession) photoError = err.message;}
    finally {if (root === session && mine === photoSession) {photoLoading = false;if (tab === 'photos') renderPhotos();}}
  }
  function openPhotos() {return open(null, 'photos');}
  function openPhoto(photo) {
    return open(null, 'photos', photo);
  }
  window.addEventListener('real-photos-changed', () => {
    if (!root?.open) return;
    if (tab === 'photos') renderPhotos();
    else root.querySelectorAll('[data-camera-plant]').forEach(el => {el.outerHTML = plantPhotos(el.dataset.cameraPlant);});
  });
  function renderCards() {
    if (!root?.open || !reference || tab !== 'plants') return;
    const list = filtered(), scroll = root.querySelector('[data-scroll]');
    observer?.disconnect(); visible.clear();
    root.dataset.view = detailId ? 'detail' : grid ? 'grid' : 'cards';
    root.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    scroll.setAttribute('aria-label', 'Plant collection');root.querySelector('[data-back]').textContent = '← Collection';
    root.querySelector('[data-count]').textContent = `${list.length} of ${plants().length} plants`;
    root.querySelector('[data-filters]').hidden = !!detailId;
    root.querySelector('[data-toggle]').hidden = !!detailId;
    root.querySelector('[data-back]').hidden = !detailId;
    root.querySelector('[data-subtitle]').textContent = detailId ? 'Swipe left or right to compare plants' : 'A living record of your garden';
    if (detailId && !list.some((it) => it.id === detailId)) detailId = list[0]?.id || null;
    const selected = detailId ? list.filter((it) => it.id === detailId) : list;
    scroll.innerHTML = selected.map((it) => card(it, list.indexOf(it), list.length, !!detailId)).join('') || '<div class="alm-empty"><h2>No plants match</h2><p>Try a different name, light need or care filter.</p><button class="btn gold" data-reset>Clear filters</button></div>';
    scroll.scrollTop = 0;
    root.querySelector('[data-detail-nav]').hidden = !detailId;
    if (detailId) {
      const n = list.findIndex((it) => it.id === detailId);
      root.querySelector('[data-prev]').disabled = n <= 0; root.querySelector('[data-next]').disabled = n >= list.length - 1;
      root.querySelector('[data-detail-count]').textContent = `${n + 1} / ${list.length}`;
    }
    if (!detailId && restoreId) { scroll.querySelector(`[data-plant="${restoreId}"]`)?.scrollIntoView({ block: 'start' }); restoreId = null; }
    for (const id of history.keys()) paintHistory(id);
    observe();
  }
  function detail(id) {
    if (!root?.open) return;
    restoreId = id; detailId = id; renderCards();
    root.querySelector('[data-scroll]').focus();
  }
  function back() { const id = restoreId; detailId = null; renderCards(); root.querySelector(`[data-detail="${id}"]`)?.focus({ preventScroll: true }); }
  function step(delta) {
    const list = filtered(), n = list.findIndex((it) => it.id === detailId), next = list[n + delta];
    if (next) detail(next.id);
  }
  function close() {
    if (!root) return;
    generation++; photoSession++; cancelAnimationFrame(tick); observer?.disconnect(); visible.clear(); clearModels();
    root.close(); root.remove(); root = null; opener?.focus?.({ preventScroll: true });
  }
  function showInRoom(id, edit = false) {
    const it = plants().find((p) => p.id === id); if (!it) return;
    close(); if (edit) GR.setMode('edit'); GR.select(id);
    if (edit) { GR.openItem(id); return; }
    GR.closeSheet();
    // Frame through the public camera/controls seam without changing layout.
    const target = new T.Vector3(it.x, (GR.baseY?.(it) || 0) + (it.potH + it.height) * .5, it.z);
    const direction = GR.camera.position.clone().sub(GR.controls.target).normalize(); if (!direction.lengthSq()) direction.set(1, 1, 1).normalize();
    const distance = Math.max(1.5, (it.potH + it.height) * 2.5);
    GR.controls.target.copy(target); GR.camera.position.copy(target).addScaledVector(direction, distance); GR.controls.update();
    GR.toast(it.name);
  }
  function openHistory(id) {
    const it = plants().find((p) => p.id === id); if (!it) return;
    close();
    if (GR.history?.open) { GR.history.open(id); return; }
    // The current history module registers an item action but no GR.history.
    GR.select(id);
    const button = [...document.querySelectorAll('#sheetBody [data-xa]')].find((b) => b.textContent.trim() === 'History');
    if (button) button.click(); else GR.toast('History is still loading');
  }
  async function open(id = null, section = 'plants', photo = null) {
    if (id && !filtered().some((it) => it.id === id)) Object.keys(filters).forEach((k) => filters[k] = '');
    if (root?.open) {
      const session = root;tab = section;photoId = photo ? photoKey(photo) : null;
      if (tab === 'photos') await loadPhotos();
      else {
        try {await getReference();if (root === session && tab === 'plants') {if (id) detail(id);else renderCards();}}
        catch (err) {if (root === session) GR.toast(err.message);}
      }
      if (root === session) {root.querySelector('[data-scroll]').scrollTop = 0;root.querySelector('[data-photo-go]')?.focus({preventScroll:true});}
      return;
    }
    tab = section;photoId = photo ? photoKey(photo) : null;photoError = '';
    opener = document.activeElement; detailId = null; restoreId = null; history.clear(); grid = false; generation++;
    root = document.createElement('dialog'); root.id = 'plant-almanac'; root.className = 'alm-shell'; root.setAttribute('aria-labelledby', 'alm-heading');
    root.innerHTML = `<header class="alm-header"><div><span class="micro">My garden · living collection</span><h1 id="alm-heading">Plant <em>almanac</em></h1><p data-subtitle>A living record of your garden</p></div><button class="btn" data-close aria-label="Close almanac">Done</button></header><section class="alm-controls"><nav class="alm-tabs" role="tablist" aria-label="Almanac sections"><button class="btn" role="tab" data-tab="plants" aria-selected="true">Plants</button><button class="btn" role="tab" data-tab="photos" aria-selected="false">Photos</button></nav><div class="alm-toolbar"><button class="btn" data-back hidden>← Collection</button><span class="micro" data-count>Opening collection…</span><button class="btn" data-toggle aria-pressed="false">Grid view</button></div><div data-filters><label class="alm-search"><span class="sr-only">Search plants</span><input type="search" data-search aria-label="Search plants" placeholder="Search plants, species, family…" value="${e(filters.search)}"></label><div class="alm-filters"><label><span class="sr-only">Family</span><select data-filter="family" aria-label="Family"><option value="">All families</option>${[...new Set(plants().map(family))].sort().map((f) => `<option value="${e(f)}">${e(f.replaceAll('_', ' '))}</option>`).join('')}</select></label><label><span class="sr-only">Light need</span><select data-filter="light" aria-label="Light need"><option value="">All light</option>${Object.entries(LIGHT).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label><label><span class="sr-only">Zen health</span><select data-filter="health" aria-label="Zen health"><option value="">All health</option><option value="thriving">Thriving · 80+</option><option value="steady">Steady · 55–79</option><option value="attention">Needs care · &lt;55</option><option value="unknown">Unassessed</option></select></label></div></div></section><main class="alm-scroll" data-scroll tabindex="-1" aria-label="Plant collection"><p class="sub">Opening care reference…</p></main><nav class="alm-detail-nav" data-detail-nav hidden aria-label="Compare plants"><button class="btn" data-prev aria-label="Previous plant">← Previous</button><span class="micro" data-detail-count></span><button class="btn" data-next aria-label="Next plant">Next →</button></nav>`;
    document.body.append(root); root.showModal(); GR.closeSheet();
    const session = root;
    for (const select of root.querySelectorAll('[data-filter]')) select.value = filters[select.dataset.filter];
    root.addEventListener('cancel', (ev) => { ev.preventDefault(); close(); });
    root.addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-close')) close();
      else if (b.dataset.tab) {tab = b.dataset.tab;photoId = null;root.querySelector('[data-scroll]').scrollTop = 0;if (tab === 'photos') void loadPhotos();else {renderCards();void retry();}}
      else if (b.dataset.cameraPhoto) {const photo = GR.real?.photos.find(p => photoKey(p) === b.dataset.cameraPhoto);if (photo) void openPhoto(photo);}
      else if (b.hasAttribute('data-photo-refresh')) void loadPhotos();
      else if (b.hasAttribute('data-photo-go') || b.hasAttribute('data-photo-walk')) {const photo = GR.real?.photos.find(p => photoKey(p) === photoId);if (photo) {close();if (b.hasAttribute('data-photo-walk')) GR.real.walkAround(photo);else GR.real.goToView(photo);}}
      else if (b.hasAttribute('data-photo-delete')) {
        const photo = GR.real?.photos.find(p => photoKey(p) === photoId);if (!photo) return;
        b.disabled = true;const current = root;
        GR.real.deletePhoto(photo).then(() => {if (root === current && tab === 'photos') {photoId = null;photoError = '';renderPhotos();}}).catch(err => {if (root === current && tab === 'photos') {photoError = err.message;renderPhotos();}});
      }
      else if (b.dataset.photoPlant) {tab = 'plants';detailId = b.dataset.photoPlant;void retry();}

      else if (b.dataset.room) showInRoom(b.dataset.room);
      else if (b.dataset.edit) showInRoom(b.dataset.edit, true);
      else if (b.dataset.historyOpen) openHistory(b.dataset.historyOpen);
      else if (b.dataset.detail) detail(b.dataset.detail);
      else if (b.hasAttribute('data-back')) {if (tab === 'photos') {photoId = null;renderPhotos();root.querySelector('[data-scroll]').scrollTop = 0;}else back();}
      else if (b.hasAttribute('data-prev')) step(-1);
      else if (b.hasAttribute('data-next')) step(1);
      else if (b.hasAttribute('data-toggle')) { grid = !grid; b.textContent = grid ? 'Card view' : 'Grid view'; b.setAttribute('aria-pressed', String(grid)); renderCards(); }
      else if (b.hasAttribute('data-retry')) { void retry(); }
      else if (b.hasAttribute('data-reset')) { Object.keys(filters).forEach((k) => filters[k] = ''); root.querySelector('[data-search]').value = ''; root.querySelectorAll('[data-filter]').forEach((s) => s.value = ''); renderCards(); }
    });
    root.querySelector('[data-search]').oninput = (ev) => { filters.search = ev.target.value; renderCards(); };
    root.querySelectorAll('[data-filter]').forEach((s) => s.onchange = () => { filters[s.dataset.filter] = s.value; renderCards(); });
    root.addEventListener('keydown', (ev) => { if (tab === 'plants' && detailId && !ev.target.matches('input,select,summary')) { if (ev.key === 'ArrowRight') step(1); if (ev.key === 'ArrowLeft') step(-1); } });
    let touch = null;
    root.querySelector('[data-scroll]').addEventListener('touchstart', (ev) => { if (ev.touches.length === 1) touch = { x: ev.touches[0].clientX, y: ev.touches[0].clientY }; }, { passive: true });
    root.querySelector('[data-scroll]').addEventListener('touchend', (ev) => {
      if (!touch || !detailId || tab !== 'plants') return;
      const dx = ev.changedTouches[0].clientX - touch.x, dy = ev.changedTouches[0].clientY - touch.y; touch = null;
      if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
    }, { passive: true });
    async function retry() {
      try { await getReference(); if (root !== session) return; renderCards(); if (id && tab === 'plants') detail(id); }
      catch (err) { if (root === session && tab === 'plants') root.querySelector('[data-scroll]').innerHTML = `<div class="alm-empty"><h2>Care reference unavailable</h2><p>${e(err.message)}</p><button class="btn gold" data-retry>Retry</button></div>`; }
    }
    if (tab === 'photos') await loadPhotos();else {void GR.real?.refreshPhotos().catch(() => {});await retry();}
    if (root === session) {tick = requestAnimationFrame(frame);if (photo) root.querySelector('[data-photo-go]')?.focus({preventScroll:true});}
  }
  GR.addDock({ key: 'almanac', label: 'Almanac', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 7h7M9 10.5h5"/></svg>', open });
  GR.addItemAction({ label: 'Almanac', icon: GR.ICON.leaf, when: (it) => it.kind === 'plant', run: (it) => open(it.id) });
  GR.almanac = { open, openPhotos, openPhoto, close, detail, get isOpen() { return !!root?.open; }, get metrics() { return { ...metrics, visited: [...metrics.visited], visible: visible.size, cachedModels: models.size, pendingModels: pending.size }; } };
}
