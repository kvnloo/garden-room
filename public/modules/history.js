// Private photo history; illustrative growth never changes the saved layout.
const DAY = 86400000;
const date = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const logistic = (x) => { const f = (v) => 1 / (1 + Math.exp(-8 * (v - .5))); return (f(x) - f(0)) / (f(1) - f(0)); };
export function init(GR) {
  if (document.querySelector('link[data-history]')) return;
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/modules/history.css'; css.dataset.history = ''; document.head.append(css);
  const e = GR.esc;
  let session = null, request = 0;
  function stop() {
    if (!session) return;
    const s = session; if (s.growth) { for (const child of [...s.growth.children]) s.holder.add(child); s.growth.removeFromParent(); delete s.holder.userData.historyGrowth; } s.overlay.remove(); s.dialog?.remove(); session = null;
  }
  async function api(url, opts) { const r = await GR.api(url, opts); if (r.error) throw new Error(r.error); return r; }
  function imageStyle(photo, crop) {
    const b = photo.assignment?.box;
    return crop && b ? `object-position:${50 * (b[0] + b[2])}% ${50 * (b[1] + b[3])}%` : '';
  }
  function floatingCrop(photo, real) {
    const b = photo.assignment?.box;
    if (!real || !b) return '';
    const [iw, ih] = photo.size || [512, 512], bw = Math.max(.03, b[2] - b[0]), bh = Math.max(.03, b[3] - b[1]);
    const scale = Math.max(190 / (iw * bw), 160 / (ih * bh));
    const w = iw * scale, h = ih * scale;
    return `width:${w}px;height:${h}px;left:${95 - (b[0] + b[2]) / 2 * w}px;top:${80 - (b[1] + b[3]) / 2 * h}px;right:auto;bottom:auto;object-fit:fill`;
  }
  async function assign(photo, on, button) {
    const s = session; if (!s) return;
    button.disabled = true;
    try {
      await api('/api/history/assign', { method: 'POST', body: JSON.stringify({ photo: photo.id, plant: s.id, on }) });
      const verified = await api(`/api/history/plant/${s.id}`);
      if (verified.photos.some((p) => p.id === photo.id) !== on) throw new Error('Correction was not saved');
      if (session !== s) return;
      s.photos = verified.photos; s.playing = false; s.currentPhoto = null;
      s.start = s.photos.length ? Math.min(...s.photos.map((p) => +new Date(p.ts)), s.end - 1000) : s.end - 90 * DAY;
      s.dialog?.close(); renderGrid(); s.filmKey = null; update(s.progress); syncPlay();
      GR.toast(on ? 'Added to this plant' : 'Removed from this plant');
    } catch (err) { GR.toast(err.message); } finally { button.disabled = false; }
  }
  function viewer(list, position, gallery = false) {
    const s = session; if (!s || !list.length) return;
    s.dialog?.remove();
    const d = document.createElement('dialog'); d.className = 'history-viewer lg'; s.dialog = d;
    d.innerHTML = `<div class="history-view-head"><button class="btn" data-close aria-label="Close photograph">Close</button><span data-date class="micro"></span></div><div class="history-view-image"><img alt="Plant history photograph"></div><p class="sub" data-counter></p><div class="row"><button class="btn" data-prev aria-label="Previous photograph">←</button><button class="btn gold" data-correct></button><button class="btn" data-confirm hidden>Confirm</button><button class="btn" data-next aria-label="Next photograph">→</button></div><p class="sub">Swipe to compare · corrections are saved privately</p>`;
    document.body.append(d); let n = position;
    function show(delta = 0) {
      n = (n + delta + list.length) % list.length; const p = list[n];
      const im = d.querySelector('img'); im.src = p.thumb1600; im.style = imageStyle(p, s.real);
      d.querySelector('[data-date]').textContent = date(p.ts);
      d.querySelector('[data-counter]').textContent = `${n + 1} / ${list.length}${p.assignment?.unsure ? ' · Unsure — please confirm' : ''}${p.dateSource === 'mtime' ? ' · Date from file modification time' : ''}`;
      const added = s.photos.some((x) => x.id === p.id), b = d.querySelector('[data-correct]');
      b.textContent = gallery && !added ? 'Add to this plant' : 'Not this plant';
      b.onclick = () => assign(p, gallery && !added, b);
      const confirm = d.querySelector('[data-confirm]'); confirm.hidden = !p.assignment?.unsure; confirm.style.display = confirm.hidden ? 'none' : ''; confirm.onclick = () => assign(p, true, confirm);
    }
    d.querySelector('[data-close]').onclick = () => d.close();
    d.querySelector('[data-prev]').onclick = () => show(-1); d.querySelector('[data-next]').onclick = () => show(1);
    d.onkeydown = (ev) => { if (ev.key === 'ArrowLeft') show(-1); if (ev.key === 'ArrowRight') show(1); };
    let x = null; const view = d.querySelector('.history-view-image');
    view.addEventListener('touchstart', (ev) => { x = ev.changedTouches[0].clientX; }, { passive: true });
    view.addEventListener('touchend', (ev) => { const dx = ev.changedTouches[0].clientX - x; if (Math.abs(dx) > 45) show(dx < 0 ? 1 : -1); }, { passive: true });
    show(); d.showModal();
  }
  function renderGrid() {
    const s = session; if (!s) return;
    const grid = s.root.querySelector('[data-grid]'), list = [...s.photos].reverse(); s.gridPage = 0;
    const nav = s.root.querySelector('[data-grid-nav]');
    const draw = () => {
      const page = list.slice(s.gridPage * 48, s.gridPage * 48 + 48);
      grid.innerHTML = page.map((p) => `<button class="history-tile" data-photo="${p.id}" aria-label="View photograph ${e(date(p.ts))}"><img loading="lazy" decoding="async" src="${e(p.thumb512)}" alt="${e(s.name)}"><span>${e(date(p.ts))}${p.assignment?.unsure ? '<b>Unsure</b>' : ''}</span></button>`).join('') || '<p class="sub">No photos yet. Add this plant’s first memory from the library.</p>';
      grid.querySelectorAll('[data-photo]').forEach((b) => b.onclick = () => viewer(list, list.findIndex((p) => p.id === b.dataset.photo)));
      nav.hidden = list.length <= 48; nav.querySelector('span').textContent = `${s.gridPage + 1} / ${Math.max(1, Math.ceil(list.length / 48))}`;
      nav.querySelector('[data-back]').disabled = !s.gridPage; nav.querySelector('[data-more]').disabled = (s.gridPage + 1) * 48 >= list.length;
    };
    nav.querySelector('[data-back]').onclick = () => { s.gridPage--; draw(); }; nav.querySelector('[data-more]').onclick = () => { s.gridPage++; draw(); };
    s.root.querySelector('[data-count]').textContent = `${list.length} photographs · ${list.filter((p) => p.assignment?.unsure).length} need confirmation`;
    draw();
  }
  function update(progress) {
    const s = session; if (!s) return;
    s.progress = Math.max(0, Math.min(1, progress)); const ts = s.start + (s.end - s.start) * s.progress;
    s.root.querySelector('[data-scrub]').value = s.progress; s.root.querySelector('[data-now]').textContent = date(ts);
    s.root.querySelector('[data-start]').textContent = date(s.start); s.root.querySelector('[data-end]').textContent = date(s.end);
    const p = s.progress * 23, lo = Math.floor(p), mix = p - lo, stage = s.stages[lo] + (s.stages[Math.min(lo + 1, 23)] - s.stages[lo]) * mix;
    if (s.growth) s.growth.scale.setScalar(s.real ? 1 : stage);
    s.root.querySelector('[data-growth]').textContent = s.real ? 'Real photographs only' : `Simulated height ${Math.round(stage * 100)}% · spread ${Math.round(stage * 100)}%`;
    const photos = s.photos; let nearest = -1, distance = Infinity;
    for (let i = 0; i < photos.length; i++) { const d = Math.abs(+new Date(photos[i].ts) - ts); if (d < distance) { distance = d; nearest = i; } }
    if (nearest >= 0) {
      const photo = photos[nearest];
      if (photo.id !== s.currentPhoto) {
        s.currentPhoto = photo.id;
        const old = s.overlay.querySelector('img.on'), next = [...s.overlay.querySelectorAll('img')].find((im) => im !== old);
        next.onload = () => { if (session !== s || s.currentPhoto !== photo.id) return; old?.classList.remove('on'); next.classList.add('on'); };
        next.src = photo.thumb512; next.style = floatingCrop(photo, s.real);
        s.overlay.querySelector('span').textContent = `${date(photo.ts)}${photo.assignment?.unsure ? ' · Unsure' : ''}`;
        s.overlay.onclick = () => viewer(photos, nearest);
      }
      const key = `${Math.floor(nearest / 5)}:${photos.length}`, film = s.root.querySelector('[data-film]');
      if (s.filmKey !== key) {
        s.filmKey = key; const from = Math.max(0, nearest - 3), part = photos.slice(from, from + 8);
        film.innerHTML = part.map((ph, i) => `<button data-frame="${from+i}" aria-label="Jump to ${e(date(ph.ts))}"><img loading="lazy" src="${e(ph.thumb512)}" alt=""><span>${e(date(ph.ts))}</span></button>`).join('');
        film.querySelectorAll('button').forEach((b) => b.onclick = () => { s.playing = false; syncPlay(); update((+new Date(photos[+b.dataset.frame].ts) - s.start) / (s.end - s.start)); });
      }
      film.querySelectorAll('button').forEach((b) => { b.classList.toggle('on', +b.dataset.frame === nearest); b.setAttribute('aria-current', String(+b.dataset.frame === nearest)); });
    } else s.root.querySelector('[data-film]').innerHTML = '';
    s.overlay.hidden = nearest < 0;
  }
  function syncPlay() { if (session) { const b = session.root.querySelector('[data-play]'); b.textContent = session.playing ? 'Pause' : 'Play · 4s'; b.setAttribute('aria-pressed', String(session.playing)); } }
  async function library(offset = 0) {
    const s = session; if (!s) return;
    try {
      const res = await api(`/api/history/photos?offset=${offset}&limit=24`); if (session !== s) return;
      const el = s.root.querySelector('[data-library]'); el.hidden = false;
      el.innerHTML = `<div class="row"><b>Photo library</b><button class="btn" data-hide>Close library</button></div><p class="sub">Tap a photo, then “Add to this plant”. ${res.total} indexed.</p><div class="history-grid">${res.photos.map((p, i) => `<button class="history-tile" data-library-photo="${i}"><img src="${e(p.thumb512)}" loading="lazy" alt="Library photograph"><span>${e(date(p.ts))}</span></button>`).join('')}</div><div class="row"><button class="btn" data-prev ${offset ? '' : 'disabled'}>Previous</button><button class="btn" data-next ${res.hasMore ? '' : 'disabled'}>Next</button></div>`;
      el.querySelector('[data-hide]').onclick = () => { el.hidden = true; el.innerHTML = ''; };
      el.querySelector('[data-prev]').onclick = () => library(Math.max(0, offset - 24)); el.querySelector('[data-next]').onclick = () => library(offset + 24);
      el.querySelectorAll('[data-library-photo]').forEach((b) => b.onclick = () => viewer(res.photos, +b.dataset.libraryPhoto, true));
    } catch (err) { GR.toast(err.message); }
  }
  async function open(it) {
    stop(); const seq = ++request; GR.openSheet('history', '<h3>Plant <em>history</em></h3><p class="sub">Opening memories…</p>');
    try {
      const data = await api(`/api/history/plant/${it.id}`);
      if (seq !== request || !document.querySelector('#sheetBody')?.textContent.includes('Opening memories')) return;
      const end = Date.now(), start = data.photos.length ? Math.min(...data.photos.map((p) => +new Date(p.ts)), end - 1000) : end - 90 * DAY;
      GR.openSheet('history', `<section id="plant-history"><div class="row"><h3>${e(it.name)} <em>history</em></h3><button class="btn" data-done>Done</button></div><p class="micro" data-count></p><section class="history-player lg"><div class="row"><button class="btn gold" data-play aria-pressed="false">Play · 4s</button><label class="history-toggle"><input type="checkbox" data-real> Real timelapse</label></div><div class="row history-speed"><label for="history-speed">Speed <b data-speed-label>1×</b></label><input id="history-speed" aria-label="Timelapse speed" type="range" min="0.25" max="4" step="0.25" value="1"></div><div class="history-now" data-now></div><input class="history-scrub" data-scrub aria-label="Timeline date" type="range" min="0" max="1" step="0.001" value="1"><div class="row micro history-range"><span data-start></span><span data-end></span></div><p class="micro" data-growth></p><p class="sub history-disclaimer">Illustrative growth, not measurements. Starts at 15% of today’s height, stable pot, same model. “Unsure” photos need confirmation.</p><div class="history-film" data-film aria-label="Photo timeline"></div></section><div class="row"><h4>Photographs</h4><button class="btn" data-add>Add photos</button></div><div class="history-grid" data-grid></div><div class="row" data-grid-nav hidden><button class="btn" data-back>Previous</button><span class="micro"></span><button class="btn" data-more>Next</button></div><section data-library hidden></section></section>`);
      const root = document.querySelector('#plant-history'), holder = GR.meshOf(it.id)?.userData.holder;
      const growth = holder ? new GR.THREE.Group() : null;
      if (growth) { growth.name = 'History growth preview'; for (const child of [...holder.children]) growth.add(child); holder.add(growth); holder.userData.historyGrowth = growth; }
      const overlay = document.createElement('button'); overlay.className = 'history-float lg'; overlay.setAttribute('aria-label', 'Open synchronized real photograph'); overlay.innerHTML = '<img alt="Synchronized real plant"><img alt="Synchronized real plant"><span></span>'; document.body.append(overlay);
      session = { id: it.id, name: it.name, photos: data.photos, root, overlay, holder, growth, start, end, progress: 1, speed: 1, playing: false, real: false, stages: Array.from({ length: 24 }, (_, i) => .15 + .85 * logistic(i / 23)) };
      const s = session;
      root.querySelector('[data-done]').onclick = () => { stop(); GR.closeSheet(); };
      root.querySelector('[data-play]').onclick = () => { if (s.progress >= 1 && !s.playing) update(0); s.playing = !s.playing; s.lastTick = performance.now(); syncPlay(); };
      root.querySelector('[data-scrub]').oninput = (ev) => { s.playing = false; syncPlay(); update(+ev.target.value); };
      root.querySelector('#history-speed').oninput = (ev) => { s.speed = +ev.target.value; root.querySelector('[data-speed-label]').textContent = `${s.speed}×`; };
      root.querySelector('[data-real]').onchange = (ev) => { s.real = ev.target.checked; s.overlay.classList.toggle('real', s.real); s.currentPhoto = null; update(s.progress); };
      root.querySelector('[data-add]').onclick = () => library();
      renderGrid(); update(1);
    } catch (err) { GR.openSheet('history', `<h3>History unavailable</h3><p class="sub">${e(err.message)}</p>`); }
  }
  GR.addItemAction({ label: 'History', icon: GR.ICON.camera, when: (it) => it.kind === 'plant', run: open });
  const cleanup = () => { if (session && (!session.root.isConnected || document.querySelector('#sheet').classList.contains('hidden'))) stop(); };
  new MutationObserver(cleanup).observe(document.querySelector('#sheet'), { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(cleanup).observe(document.querySelector('#sheetBody'), { childList: true });
  GR.onFrame(() => {
    const s = session; if (!s) return;
    if (!s.root.isConnected || document.querySelector('#sheet')?.classList.contains('hidden')) { stop(); return; }
    if (s.growth) for (const child of [...s.holder.children]) if (child !== s.growth) s.growth.add(child);
    if (s.playing) { const now = performance.now(); update(s.progress + (now - s.lastTick) / 1000 * s.speed / 4); s.lastTick = now; if (s.progress >= 1) { s.playing = false; syncPlay(); } }
    const it = GR.itemById(s.id); if (!it) { stop(); return; }
    const point = GR.project(it.x, it.z, (GR.baseY?.(it) || 0) + it.potH + it.height * .7);
    const width = s.real ? 190 : 132, maxY = Math.max(72, (document.querySelector('#sheet')?.getBoundingClientRect().top || innerHeight) - (s.real ? 170 : 125));
    s.overlay.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, point.x - width / 2))}px`;
    s.overlay.style.top = `${Math.max(70, Math.min(maxY, point.y - 130))}px`;
  });
}
