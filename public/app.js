import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPot } from './models/pots.js';

// ───────── key / api ─────────
const hashKey = new URLSearchParams(location.hash.slice(1)).get('k');
if (hashKey) { localStorage.setItem('gr_key', hashKey); history.replaceState(null, '', location.pathname); }
const KEY = localStorage.getItem('gr_key') || '';
async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json', 'X-Garden-Key': KEY, ...(opts.headers || {}) } });
  if (r.status === 401) throw new Error('Missing key: open the link with #k=…');
  return r.json();
}
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(t, ms = 2400) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), ms); }

// ───────── icons (1.5px line, currentColor) ─────────
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  sparkle: I('<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>'),
  leaf: I('<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14z"/><path d="M5 19c4-4 7-7 10-10"/>'),
  layers: I('<path d="M12 4l9 5-9 5-9-5z"/><path d="M3 14l9 5 9-5"/>'),
  scan: I('<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><circle cx="12" cy="12" r="3.2"/>'),
  camera: I('<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  chat: I('<path d="M5 5h14v10H10l-5 4z"/>'),
  cube: I('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>'),
  top: I('<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M10 10v10"/>'),
  eye: I('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  sun: I('<circle cx="12" cy="12" r="3.6"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>'),
  fridge: I('<rect x="6" y="2.5" width="12" height="19" rx="1.5"/><path d="M6 9.5h12M9 5.5v2M9 12v4"/>'),
  rotate: I('<path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 5v6h-6"/>'),
  lock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  unlock: I('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 017.5-2"/>'),
  copy: I('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>'),
  trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  globe: I('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18"/>'),
  pano: I('<path d="M3 7c6-2 12-2 18 0v10c-6-2-12-2-18 0z"/>'),
  upload: I('<path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4"/>'),
  send: I('<path d="M4 12l16-8-6 16-2-7z"/>'),
  table: I('<path d="M3 9h18M5 9v10M19 9v10M7 9V6h10v3"/>'),
  lamp: I('<path d="M9 3h6l3 7H6z"/><path d="M12 10v10M8 21h8"/>'),
  panel: I('<rect x="4" y="5" width="16" height="7" rx="1.5"/><path d="M12 12v8"/>'),
};

// ───────── units ─────────
const IN = 0.0254, FT = 0.3048, CM = 0.01;
const toIn = (m) => Math.round(m / IN * 10) / 10;
const fmtFt = (m) => { const i = Math.round(m / IN); return `${Math.floor(i / 12)}′${i % 12}″`; };

// ───────── room: x east, z south. Clockwise migration preserves photo handedness; kitchen is SE. ─────────
const RW = 12 * FT, RD = 12 * FT, CUT = 1.1;
const DEFAULT_ROOM = {
  v: 3, h: 2.6,
  poly: [[RW, 0], [RW, RD - CUT], [RW - CUT, RD], [0, RD], [0, 0]],
  edgeNames: ['East wall (fridge, china)', 'Angled SE wall (kitchen only)', 'South wall (mirror)', 'West wall (main entrance)', 'North wall (window)'],
  window: { facing: 'north', edge: 4, t0: 1.05, t1: 2.65, sill: 0.78, top: 2.15 },
  openings: [
    { name: 'Kitchen archway', edge: 1, t0: 0.45, t1: 1.3, top: 2.15, clear: 0.45 },
    { name: 'Entrance arch', edge: 3, t0: 1.0, t1: 2.6, top: 2.3, clear: 0.9 },
  ],
};
const NEED = { high: 0.7, med: 0.4, low: 0.2 };
const LIGHT_SPEC = {
  led:   { name: 'LED panel', power: 0.9, radius: 0.55, w: 0.3, d: 0.3, h: 0.9, overhead: true, color: 0xff8af0 },
  stake: { name: 'Stake light', power: 0.5, radius: 0.3, w: 0.08, d: 0.08, h: 0.5, overhead: true, color: 0xff9af4 },
  lamp5: { name: '5-arm floor lamp', power: 0.8, radius: 0.9, w: 0.5, d: 0.5, h: 1.6, overhead: false, color: 0xffd8a0 },
  ring:  { name: 'Ring light', power: 0.5, radius: 0.6, w: 0.35, d: 0.35, h: 1.5, overhead: false, color: 0xfff1d6 },
};
const SURFACE = { table: true, glass: true, stand: true };

const EDGE_CACHE = new WeakMap();
function edge(room, i) { const cached = EDGE_CACHE.get(room)?.[i]; if(cached) return cached; const a = room.poly[i], b = room.poly[(i + 1) % room.poly.length]; const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz); const u = [dx / L, dz / L]; let n = [-u[1], u[0]]; const c = centroid(room); const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if ((c[0] - mid[0]) * n[0] + (c[1] - mid[1]) * n[1] < 0) n = [-n[0], -n[1]]; const result = { a, b, L, u, n }; if(!EDGE_CACHE.has(room)) EDGE_CACHE.set(room,[]); EDGE_CACHE.get(room)[i]=result; return result; }
function centroid(room) { const p = room.poly; return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]; }
function onEdge(room, i, t, inset = 0) { const e = edge(room, i); return [e.a[0] + e.u[0] * t + e.n[0] * inset, e.a[1] + e.u[1] * t + e.n[1] * inset]; }
function inside(room, x, z) { const p = room.poly; let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i][1] > z) !== (p[j][1] > z) && x < (p[j][0] - p[i][0]) * (z - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c; } return c; }
function distToEdge(room, i, x, z) { const e = edge(room, i); const t = Math.max(0, Math.min(e.L, (x - e.a[0]) * e.u[0] + (z - e.a[1]) * e.u[1])); return Math.hypot(x - (e.a[0] + e.u[0] * t), z - (e.a[1] + e.u[1] * t)); }
function wallDist(room, x, z) { let d = Infinity; for (let i = 0; i < room.poly.length; i++) d = Math.min(d, distToEdge(room, i, x, z)); return d; }
function outside(room, F) { // how far footprint corners poke outside (signed distance to each inward half-plane)
  let s = 0; for (const [x, z] of [[F.x0, F.z0], [F.x1, F.z0], [F.x1, F.z1], [F.x0, F.z1]]) for (let i = 0; i < room.poly.length; i++) { const e = edge(room, i); const d = (x - e.a[0]) * e.n[0] + (z - e.a[1]) * e.n[1]; if (d < 0) s -= d; } return s; }
function bounds(room) { const xs = room.poly.map((p) => p[0]), zs = room.poly.map((p) => p[1]); return { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) }; }

// ───────── items ─────────
function dims(kind) { const s = LIGHT_SPEC[kind]; return { w: s.w, d: s.d, h: s.h }; }
function defaultItems(plants) {
  const items = [
    { id: 'fridge', kind: 'fridge', name: 'Fridge', x: 0.2 + 0.455, z: 0.455, rot: 0, w: 3 * FT, d: 3 * FT, h: 1.75, locked: true, hinge: 'left' },
    { id: 'china', kind: 'china', name: 'China cabinet', x: 1.13 + 0.686, z: 0.31, rot: 0, w: 4.5 * FT, d: 2 * FT, h: 1.9, locked: true },
    { id: 'table', kind: 'table', name: 'Dining table (plant shelf)', x: 0.39, z: 2.78, rot: 0, w: 2.5 * FT, d: 5 * FT, h: 0.76, locked: true, wall: true },
    { id: 'glass1', kind: 'glass', name: 'Glass table 1', x: 1.2, z: 2.3, rot: 0, w: 0.5, d: 0.9, h: 0.5, locked: false, guess: true },
    { id: 'glass2', kind: 'glass', name: 'Glass table 2', x: 1.2, z: 3.2, rot: 0, w: 0.5, d: 0.9, h: 0.5, locked: false, guess: true },
  ];
  for (let i = 0; i < 8; i++) items.push({ id: `led${i + 1}`, kind: 'led', name: `LED panel ${i + 1}`, x: 0.5 + (i % 4) * 0.3, z: 1.3 + Math.floor(i / 4) * 1.2, rot: 0, ...dims('led') });
  for (let i = 0; i < 3; i++) items.push({ id: `stake${i + 1}`, kind: 'stake', name: `Stake light ${i + 1}`, x: 1.6, z: 3.2 - i * 0.2, rot: 0, ...dims('stake'), attach: '' });
  items.push({ id: 'lamp5', kind: 'lamp5', name: '5-arm floor lamp', x: 3.2, z: 1.9, rot: 0, ...dims('lamp5') });
  items.push({ id: 'ring1', kind: 'ring', name: 'Ring light 1', x: 1.8, z: 3.35, rot: 0, ...dims('ring') });
  items.push({ id: 'ring2', kind: 'ring', name: 'Ring light 2', x: 3.35, z: 2.8, rot: 0, ...dims('ring') });
  plants.forEach((p, i) => items.push(plantItem(p, 0.25 + (i % 6) * 0.55, 1.4 + Math.floor(i / 6) * 0.5)));
  return items.map((it) => ({ ...it, x: RW - it.z, z: it.x, rot: (it.rot + 1) % 4 }));
}
function plantItem(p, x, z) {
  const box = p.potD >= 70;
  return { id: p.id, kind: 'plant', name: p.name, src: p.src, photo: p.photo, family: p.family, pot: p.pot,
    potD: p.potD * CM, potH: p.potH * CM, height: p.height * CM, light: p.light,
    w: box ? 0.8 : p.potD * CM, d: box ? 0.35 : p.potD * CM, h: (p.potH + p.height) * CM, box, x, z, rot: 0 };
}

let state = { room: DEFAULT_ROOM, items: [], fridgeOpen: false };
let PLANT_TEX = {}, PLANT_META = {};

// ───────── geometry helpers ─────────
function footprint(it) { const sw = it.rot % 2 ? it.d : it.w, sd = it.rot % 2 ? it.w : it.d; return { x0: it.x - sw / 2, x1: it.x + sw / 2, z0: it.z - sd / 2, z1: it.z + sd / 2 }; }
const isRound = (it) => it.kind === 'plant' && !it.box;
function rectOverlap(A, B) { const ox = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), oz = Math.min(A.z1, B.z1) - Math.max(A.z0, B.z0); return ox > 0 && oz > 0 ? Math.min(ox, oz) : 0; }
function overlapAmt(a, b) { if (isRound(a) && isRound(b)) return Math.max(0, a.w / 2 + b.w / 2 - Math.hypot(a.x - b.x, a.z - b.z)); return rectOverlap(footprint(a), footprint(b)); }
// Signed pot-edge distance: circle/circle, circle/box, or box/box.
function potGap(a, b) {
  if (isRound(a) && isRound(b)) return Math.hypot(a.x - b.x, a.z - b.z) - (a.w + b.w) / 2;
  if (isRound(a) || isRound(b)) { const c = isRound(a) ? a : b, r = footprint(isRound(a) ? b : a); return Math.hypot(Math.max(r.x0 - c.x, 0, c.x - r.x1), Math.max(r.z0 - c.z, 0, c.z - r.z1)) - c.w / 2; }
  const A = footprint(a), B = footprint(b), dx = Math.max(A.x0 - B.x1, B.x0 - A.x1), dz = Math.max(A.z0 - B.z1, B.z0 - A.z1);
  return dx > 0 || dz > 0 ? Math.hypot(Math.max(0, dx), Math.max(0, dz)) : Math.max(dx, dz);
}
const breathingRoom = (a, b) => 0.05 + Math.min(0.05, Math.max(a.w, a.d, b.w, b.d) * 0.1);
function polyRectOverlap(poly, F) { // SAT for convex polygon vs AABB; returns penetration depth
  const rect = [[F.x0, F.z0], [F.x1, F.z0], [F.x1, F.z1], [F.x0, F.z1]]; let best = Infinity;
  const axes = [[1, 0], [0, 1]]; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); axes.push([-(b[1] - a[1]) / L, (b[0] - a[0]) / L]); }
  for (const ax of axes) { const pr = (pts) => { let lo = Infinity, hi = -Infinity; for (const p of pts) { const v = p[0] * ax[0] + p[1] * ax[1]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; }; const [a0, a1] = pr(poly), [b0, b1] = pr(rect); const o = Math.min(a1, b1) - Math.max(a0, b0); if (o <= 0) return 0; best = Math.min(best, o); }
  return best;
}
function canSit(p, s) { return !p.box && p.potD <= (s.kind === 'stand' ? Math.min(s.w,s.d)-0.04 : s.kind === 'glass' ? 0.4 : 0.46); }
function supportOf(it, items) { // surface the item stands on (plants only)
  if (it.kind !== 'plant') return null; let best = null;
  for (const s of items) { if (!SURFACE[s.kind] || s === it || !canSit(it, s)) continue; const F = footprint(s), P = footprint(it); if (P.x0 < F.x0 || P.x1 > F.x1 || P.z0 < F.z0 || P.z1 > F.z1) continue; if (it.x > F.x0 && it.x < F.x1 && it.z > F.z0 && it.z < F.z1 && (!best || s.h > best.h)) best = s; }
  return best;
}
const baseY = (it, items) => { const s = supportOf(it, items); return s ? s.h : 0; };

const ZONE_CACHE = new WeakMap();
function clearanceZones(items, room) {
  const zones = [];
  const f = items.find((i) => i.kind === 'fridge');
  const signature = f ? [f.x,f.z,f.rot,f.w,f.d].join(',') : ''; const cached = ZONE_CACHE.get(room); if(cached?.signature === signature) return cached.zones;
  if (f) { const F = footprint(f), dp = Math.max(f.w, 0.75) + 0.1, dir = ['S', 'W', 'N', 'E'][f.rot % 4];
    const r = dir === 'S' ? { x0: F.x0, x1: F.x1, z0: F.z1, z1: F.z1 + dp } : dir === 'N' ? { x0: F.x0, x1: F.x1, z0: F.z0 - dp, z1: F.z0 } : dir === 'E' ? { x0: F.x1, x1: F.x1 + dp, z0: F.z0, z1: F.z1 } : { x0: F.x0 - dp, x1: F.x0, z0: F.z0, z1: F.z1 };
    zones.push({ name: 'Fridge door swing', fridge: true, poly: [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]] }); }
  for (const o of room.openings) { const a0 = onEdge(room, o.edge, o.t0), a1 = onEdge(room, o.edge, o.t1), b1 = onEdge(room, o.edge, o.t1, o.clear), b0 = onEdge(room, o.edge, o.t0, o.clear); zones.push({ name: o.name, poly: [a0, a1, b1, b0] }); }
  const entry = room.openings.find((o) => /entrance/i.test(o.name)), kitchen = room.openings.find((o) => /kitchen/i.test(o.name));
  if (entry && kitchen) {
    const a = onEdge(room, entry.edge, (entry.t0 + entry.t1) / 2, entry.clear), b = onEdge(room, kitchen.edge, (kitchen.t0 + kitchen.t1) / 2, kitchen.clear), c = centroid(room);
    for (const [p, q] of [[a, c], [c, b]]) { const L = Math.hypot(q[0] - p[0], q[1] - p[1]), nx = -(q[1] - p[1]) / L * 0.36, nz = (q[0] - p[0]) / L * 0.36;
      zones.push({ name: '72 cm walkway', poly: [[p[0]+nx,p[1]+nz],[q[0]+nx,q[1]+nz],[q[0]-nx,q[1]-nz],[p[0]-nx,p[1]-nz]] }); }
  }
  ZONE_CACHE.set(room,{signature,zones}); return zones;
}

// ───────── light model (window = Lambert-weighted area samples, grow lights = gaussian pools) ─────────
const WIN = [];
function buildWin(room) { WIN.length = 0; const w = room.window, e = edge(room, w.edge); for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { const t = w.t0 + (i + 0.5) / 6 * (w.t1 - w.t0); const p = onEdge(room, w.edge, t); WIN.push({ x: p[0], z: p[1], y: w.sill + (j + 0.5) / 3 * (w.top - w.sill), n: e.n }); } }
function winRaw(x, y, z) { let s = 0; for (const p of WIN) { const dx = x - p.x, dy = y - p.y, dz = z - p.z, d2 = dx * dx + dy * dy + dz * dz + 0.02, d = Math.sqrt(d2); const c = (dx * p.n[0] + dz * p.n[1]) / d; if (c > 0) s += c / d2; } return s; }
let WIN_NORM = 1;
function normWin(room) { buildWin(room); const w = room.window; const p = onEdge(room, w.edge, (w.t0 + w.t1) / 2, 0.3); WIN_NORM = winRaw(p[0], 1.4, p[1]) || 1; }
function lightAt(x, z, items, y = 0.6) {
  // North-facing glass contributes diffuse skylight only; grow-light pools are unchanged.
  let L = winRaw(x, y, z) / WIN_NORM * (state.room.window.facing === 'north' ? 0.65 : 1);
  for (const it of items) { const s = LIGHT_SPEC[it.kind]; if (!s) continue; let lx = it.x, lz = it.z; if (it.kind === 'stake' && it.attach) { const p = items.find((q) => q.id === it.attach); if (p) { lx = p.x; lz = p.z; } } const d = Math.hypot(x - lx, z - lz); L += s.power * Math.exp(-((d / s.radius) ** 2)); }
  return L;
}
function distToWindow(x, z, room) { const w = room.window, e = edge(room, w.edge); const t = Math.max(w.t0, Math.min(w.t1, (x - e.a[0]) * e.u[0] + (z - e.a[1]) * e.u[1])); const p = onEdge(room, w.edge, t); return Math.hypot(x - p[0], z - p[1]); }

// ───────── scoring ─────────
function evaluate(items, room, opts = { winWeight: 0.3 }) {
  const warns = []; let pen = 0;
  const plants = items.filter((i) => i.kind === 'plant');
  let sat = 0, prox = 0, overlaps = 0, spacingViolations = 0;
  for (const p of plants) { const s = supportOf(p, items); p._on = s ? s.id : ''; const y = (s ? s.h : 0) + p.potH + p.height * 0.6; const L = lightAt(p.x, p.z, items, Math.min(1.6, y)); p._light = L; p._sat = Math.min(1, L / NEED[p.light]); sat += p._sat; prox += Math.exp(-distToWindow(p.x, p.z, room) / 1.2) * NEED[p.light] / NEED.high; }
  sat /= Math.max(1, plants.length); prox /= Math.max(1, plants.length);
  const solid = items.filter((i) => !(LIGHT_SPEC[i.kind] && LIGHT_SPEC[i.kind].overhead));
  for (const it of solid) { const o = outside(room, footprint(it)); if (o > 0.01) { pen += 120 * o + 6; warns.push(`${it.name} is outside the room`); } }
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i], b = solid[j];
    if (a.kind === 'plant' && b.kind === 'plant') {
      // Do not allow a change of support ID to hide clumped pots/canopies.
      const gap = potGap(a, b), minGap = breathingRoom(a, b);
      if (gap < -0.005) overlaps++;
      if (gap < minGap - 0.001) { spacingViolations++; pen += 500 * (minGap - gap) + 15; warns.push(`${a.name} needs breathing room from ${b.name}`); }
      continue;
    }
    if ((a.kind === 'plant' && a._on === b.id) || (b.kind === 'plant' && b._on === a.id)) continue; // standing on it
    if ((a.kind === 'plant' && baseY(a, items) >= b.h) || (b.kind === 'plant' && baseY(b, items) >= a.h)) continue; // only skip genuinely lower objects
    const o = overlapAmt(a, b); if (o > 0.005) { overlaps++; pen += 500 * o + 25; warns.push(`${a.name} overlaps ${b.name}`); }
  }
  for (const p of plants) if (p._on) { const s = items.find((i) => i.id === p._on), S = footprint(s), P = footprint(p);
    const hang = Math.max(0, S.x0 - P.x0) + Math.max(0, P.x1 - S.x1) + Math.max(0, S.z0 - P.z0) + Math.max(0, P.z1 - S.z1);
    if (hang > 0.03) { pen += 60 * hang + 3; warns.push(`${p.name} hangs off ${s.name}`); }
    if (!canSit(p, s)) { pen += 25; warns.push(`${p.name} is too big for ${s.name}`); } }
  for (const z of clearanceZones(items, room)) for (const it of solid) {
    if (z.fridge && it.kind === 'fridge') continue; if (it.kind === 'plant' && it._on && !z.fridge) continue;
    const o = polyRectOverlap(z.poly, footprint(it)); if (o > 0.01) { pen += 300 * o + 60; /* hard: never trade door clearance for light */ warns.push(`${it.name} blocks ${z.name.toLowerCase()}`); }
  }
  for (const t of items) if (t.wall) { const F = footprint(t); const d = Math.min(...[[F.x0, t.z], [F.x1, t.z], [t.x, F.z0], [t.x, F.z1]].map(([x, z]) => wallDist(room, x, z))); if (d > 0.06) { pen += 20 * d + 1; warns.push(`(soft) ${t.name} is off the wall`); } }
  return { score: 100 * ((1 - opts.winWeight) * sat + opts.winWeight * prox) - pen, lightSat: sat, winProx: prox, pen, overlaps, spacingViolations, warns };
}

// ───────── optimizer: simulated annealing + conflict repair ─────────
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function optimize(items, room, { seed = 1, moveFurniture = false, winWeight = 0.3, iters = 6000 } = {}) {
  const rnd = mulberry(seed), B = bounds(room), opts = { winWeight };
  let cur = items.map((i) => ({ ...i }));
  // Repack the worst clumps before annealing; reject collisions rather than buying light with them.
  if (evaluate(cur, room, opts).spacingViolations) {
    const plants = cur.filter((p) => p.kind === 'plant' && !p.locked).sort((a,b) => b.w*b.d - a.w*a.d);
    cur = cur.filter((p) => !plants.some((q) => q.id === p.id));
    // Clear door swings/routes with the movable tables and lamp bases before filling shelves.
    for (const it of cur.filter((i)=>!i.locked && ['glass','lamp5','ring'].includes(i.kind))) {
      let best={x:it.x,z:it.z,rot:it.rot}, score=evaluate(cur,room,opts).score;
      for(let rot=0;rot<2;rot++) for(let x=B.x0+0.3;x<B.x1;x+=0.2) for(let z=B.z0+0.3;z<B.z1;z+=0.2) { Object.assign(it,{x,z,rot}); const e=evaluate(cur,room,opts); if(e.score>score) {score=e.score;best={x,z,rot};} }
      Object.assign(it,best);
    }
    for (const p of plants) {
      let best = null, score = -Infinity;
      const candidates = [];
      for (const s of cur.filter((s) => SURFACE[s.kind] && canSit(p,s))) { const F = footprint(s); for (let x=F.x0+p.w/2+0.015;x<=F.x1-p.w/2-0.015;x+=0.09) for(let z=F.z0+p.d/2+0.015;z<=F.z1-p.d/2-0.015;z+=0.09) candidates.push([x,z]); }
      for (let x=B.x0+p.w/2+0.025;x<B.x1-p.w/2;x+=0.14) for(let z=B.z0+p.d/2+0.025;z<B.z1-p.d/2;z+=0.14) candidates.push([x,z]);
      cur.push(p);
      for (const [x,z] of candidates) { p.x=x;p.z=z; const e=evaluate(cur,room,opts); const usage = supportOf(p,cur); const bonus = usage ? 1.5 / (1 + cur.filter((q)=>q!==p && q.kind==='plant' && q._on===usage.id).length) : 0;
        if (e.score+bonus>score) { score=e.score+bonus;best=[x,z]; } }
      if (best) [p.x,p.z]=best;
    }
  }
  const movable = cur.filter((i) => (moveFurniture || !i.locked) && i.kind !== 'stake' && !(i.kind === 'fridge'));
  const surfaces = (collection = cur) => collection.filter((s) => SURFACE[s.kind]);
  const clamp = (it) => { const F = footprint(it), hw = (F.x1 - F.x0) / 2, hd = (F.z1 - F.z0) / 2; it.x = Math.min(B.x1 - hw, Math.max(B.x0 + hw, it.x)); it.z = Math.min(B.z1 - hd, Math.max(B.z0 + hd, it.z)); };
  const jump = (it, collection = cur) => { const ss = surfaces(collection).filter((s) => it.kind === 'plant' && canSit(it, s)); if (ss.length && rnd() < 0.4) { const s = ss[Math.floor(rnd() * ss.length)], F = footprint(s); it.x = F.x0 + it.w / 2 + rnd() * Math.max(0, F.x1 - F.x0 - it.w); it.z = F.z0 + it.d / 2 + rnd() * Math.max(0, F.z1 - F.z0 - it.d); } else { it.x = B.x0 + rnd() * (B.x1 - B.x0); it.z = B.z0 + rnd() * (B.z1 - B.z0); } };
  const snap = () => cur.map((i) => ({ ...i }));
  let cs = evaluate(cur, room, opts).score, best = snap(), bs = cs;
  for (let k = 0; k < iters; k++) {
    const T = 15 * Math.pow(0.002, k / iters), it = movable[Math.floor(rnd() * movable.length)], old = { x: it.x, z: it.z, rot: it.rot };
    if (rnd() < 0.2) jump(it); else { const s = 0.04 + 0.8 * (1 - k / iters); it.x += (rnd() - 0.5) * s; it.z += (rnd() - 0.5) * s; }
    if (!isRound(it) && rnd() < 0.15) it.rot = (it.rot + 1) % 4;
    clamp(it);
    const ns = evaluate(cur, room, opts).score;
    if (ns >= cs || rnd() < Math.exp((ns - cs) / T)) { cs = ns; if (ns > bs) { bs = ns; best = snap(); } } else Object.assign(it, old);
  }
  const res = best, mov = res.filter((i) => movable.some((m) => m.id === i.id));
  for (let pass = 0; pass < 2; pass++) {
    const ev = evaluate(res, room, opts); if (ev.pen < 0.01) break;
    const ps = mov.filter((i)=>i.kind==='plant');
    for (let i=0;i<ps.length;i++) for(let j=i+1;j<ps.length;j++) { const a=ps[i],b=ps[j],old=[a.x,a.z,b.x,b.z],before=evaluate(res,room,opts).score; [a.x,a.z,b.x,b.z]=[b.x,b.z,a.x,a.z]; if(evaluate(res,room,opts).score<=before) [a.x,a.z,b.x,b.z]=old; }
    for (const it of mov) {
      if (!ev.warns.some((w) => w.includes(it.name))) continue;
      let best = {x:it.x,z:it.z,rot:it.rot}, bsc = evaluate(res,room,opts).score;
      const candidates=[];
      for (const s of surfaces(res).filter((s)=>it.kind==='plant' && canSit(it,s))) { const F=footprint(s); for(let x=F.x0+it.w/2+0.005;x<=F.x1-it.w/2-0.005;x+=0.055) for(let z=F.z0+it.d/2+0.005;z<=F.z1-it.d/2-0.005;z+=0.055) candidates.push([x,z]); }
      for(let x=B.x0+it.w/2+0.01;x<B.x1-it.w/2;x+=0.075) for(let z=B.z0+it.d/2+0.01;z<B.z1-it.d/2;z+=0.075) candidates.push([x,z]);
      for(const [x,z] of candidates) { it.x=x;it.z=z;const e=evaluate(res,room,opts); if(e.score>bsc) {bsc=e.score;best={x,z,rot:it.rot};} }
      Object.assign(it,best);
    }
  }
  evaluate(res, room, opts);
  const needy = res.filter((i) => i.kind === 'plant').sort((a, b) => a._sat - b._sat || NEED[b.light] - NEED[a.light]);
  res.filter((i) => i.kind === 'stake').forEach((s, n) => { const p = needy[n], old = { ...s }, before = evaluate(res, room, opts).score; if (p) { s.attach = p.id; s.x = p.x; s.z = p.z; if (evaluate(res, room, opts).score < before) Object.assign(s, old); } });
  return { items: res, ...evaluate(res, room, opts) };
}

// Run the very same pure scoring/packing functions off the render thread; no second optimizer implementation.
function optimizeAsync(items, room, opts) {
  if (!window.Worker) return Promise.resolve(optimize(items, room, opts));
  const functions = [edge, centroid, onEdge, inside, distToEdge, wallDist, outside, bounds, footprint, rectOverlap, overlapAmt, potGap, polyRectOverlap, canSit, supportOf, clearanceZones, buildWin, winRaw, normWin, lightAt, distToWindow, evaluate, mulberry, optimize];
  const source = `const LIGHT_SPEC=${JSON.stringify(LIGHT_SPEC)}, NEED=${JSON.stringify(NEED)}, SURFACE=${JSON.stringify(SURFACE)};const EDGE_CACHE=new WeakMap(),ZONE_CACHE=new WeakMap(),WIN=[];let WIN_NORM=1,state;const isRound=${isRound.toString()},baseY=${baseY.toString()},breathingRoom=${breathingRoom.toString()};${functions.map((f)=>f.toString()).join('\n')}\nonmessage=({data})=>{try{state={room:data.room};normWin(data.room);postMessage({result:optimize(data.items,data.room,data.opts)});}catch(e){postMessage({error:String(e)});}};`;
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})), worker=new Worker(url); URL.revokeObjectURL(url);
  return new Promise((resolve,reject)=>{worker.onmessage=({data})=>{worker.terminate();data.error ? reject(new Error(data.error)) : resolve(data.result);};worker.onerror=(e)=>{worker.terminate();reject(new Error(e.message));};worker.postMessage({items,room,opts});});
}

// ───────── three.js scene ─────────
const canvas = $('#c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x0c0c0a); scene.fog = new THREE.Fog(0x0c0c0a, 9, 20);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 50);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.maxPolarAngle = Math.PI * 0.495; controls.minDistance = 0.4; controls.maxDistance = 12;
scene.add(new THREE.HemisphereLight(0xfff6e8, 0x6b5a44, 1.25));
const sun = new THREE.DirectionalLight(0xd8e7ff, 0.65); sun.castShadow = false; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 0.5, far: 14 }); sun.shadow.bias = -0.0008; scene.add(sun, sun.target);
const chand = new THREE.PointLight(0xffd9a0, 1.2, 6, 1.6); scene.add(chand);
const roomGroup = new THREE.Group(), itemGroup = new THREE.Group(), zoneGroup = new THREE.Group(); scene.add(roomGroup, itemGroup, zoneGroup);
let walls = [], heatTex, heatCanvas, heatMesh, floorMesh;
let realLook = false;
const meshes = new Map(), texLoader = new THREE.TextureLoader();
const STD = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });

const realCarpet = texLoader.load('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAQDAwMDAgQDAwMEBAQFBgoGBgUFBgwICQcKDgwPDg4MDQ0PERYTDxAVEQ0NExoTFRcYGRkZDxIbHRsYHRYYGRj/2wBDAQQEBAYFBgsGBgsYEA0QGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBj/wAARCAAnAF8DASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDyeMyR2+6aIrg4bj5j7gUqyweYxFwXGSNhPEnsPpVcW7vK6KVkx3cHkfX1qT7K0cQki83CYQovp2xXj8p6NyVLdbi2lMLRzEn5jnjI7e39ahUJNAZSWBU8xt8oB7/L1zT1iSIF1t3xISHCE4Ld8j1oi2unmOE387VYcBe3H0pWC43yo9omeNm8wDqc5P4VL87SEeXhyMIM4AxUAZXsw3ll4G+6ydSfXHpQsriDcWB/hJTvj1PbH60WC44Qybirxx7iS3ByTTB5hk3bFKkdM4AH1qaKdZCsn2lS3ckjI9c0LcCQsgUjcSBtIPA9vWmFyFoNzAGJdiuDuPUcUkiCWHDKpyOB0z9Kkz+7Dq0pUAn50UZ/OqsTzyI7Rv5bDoAQSv1HapsFyNdgYBc7AAMDBokgTBJhViOME7SPwpXgeRcSSybc7twRQPzpJZGEW9WkKtgYHLZ+lPULm46LtE1tKHGeSgpsofynLl1bOGYIScemP61HbRLeyC9MshkQldwXaD6grT13Mssagkgj7Otw4KcdcjqD9a3I5ilF5MVwYykgh3Z3M+A3HGfQirEU6eSYX52/d3nHzddwHU/yqcvOtyXcRwoygsXXfn2GOgqK5ljmkWa2EKvG/OWKsAf50rDuUjc2Mqs6SEkHLEHCtnuQ3GfpTv8AQyVeBBGOAGY7hjsRjgVFdPktD5jvs4yAMx/XPIFJHDcKY0IYMPm3gFu2c++evtSC4syoLt4mG5u0+wDcPTHf61NHbxYBaNtw5QAfIPy70ySLzZDJOu3b8quQSFI7cUGKYQNunORgh4/lBP49qBkss0Rj2PE4AAG1nAI+tU2O3fGYwqL8pGDuY+nvViZgHQs584jJQjO71JNQxzSXJECzSIhXKgr1HUHP070rCuRwF8InlqG2/dPUehIqvMs25mltxPJuACnKInHr61deKCWIpCWWPALuHB3H2NNjtpyGW1udxGBhmBGB7+tMLmsdPa3a6vZ7eCK4SJmDgkjjjBA4zSSy2ywbd378dMqSoJ9KKKogj/f26edIxOVKiUYXnP3cDnHvVO6Wee82geRNsO1mAfeM8gentmiigorxxwTfurdJUaPepDSn95z3phijhY2axyFmIBQyZ4J27s/hRRUgXIWjgvDDHIy7V+8wzn2/+vRBcQztNuiC+SxV93IPNFFBRFy92qIrs5yQqNtAA78/yqN+ZkW3gQrIcbpD9/8AwIoooJHeaft5tboMYwxCupAOfcVaNiv2tnSRklUDOOjA9/rRRQB//9k='); realCarpet.wrapS = realCarpet.wrapT = THREE.RepeatWrapping; realCarpet.repeat.set(7,7); realCarpet.colorSpace = THREE.SRGBColorSpace;
function carpetTex() { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.fillStyle = '#cbbd9f'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,250,235' : '90,75,55'},${Math.random() * 0.12})`; g.fillRect(Math.random() * 128, Math.random() * 128, 1.5, 1.5); } const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 5); t.colorSpace = THREE.SRGBColorSpace; return t; }

function buildRoom() {
  roomGroup.clear(); walls = []; const R = state.room; EDGE_CACHE.delete(R); ZONE_CACHE.delete(R); normWin(R);
  const shape = new THREE.Shape(R.poly.map(([x, z]) => new THREE.Vector2(x, -z)));
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), STD({ map: carpetTex(), roughness: 1 })); floorMesh = floor; floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; roomGroup.add(floor);
  heatCanvas = document.createElement('canvas'); heatCanvas.width = heatCanvas.height = 48; heatTex = new THREE.CanvasTexture(heatCanvas); heatTex.colorSpace = THREE.SRGBColorSpace;
  const B = bounds(R), hg = new THREE.ShapeGeometry(shape); const uv = hg.attributes.uv, pos = hg.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) - B.x0) / (B.x1 - B.x0), 1 - (-pos.getY(i) - B.z0) / (B.z1 - B.z0));
  heatMesh = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ map: heatTex, transparent: true, opacity: 0.6, depthWrite: false })); heatMesh.rotation.x = -Math.PI / 2; heatMesh.position.y = 0.004; heatMesh.visible = showLight; roomGroup.add(heatMesh);
  const wallMat = STD({ color: 0xe4d4b4, roughness: 0.95 }), wainMat = STD({ color: 0xf3efe6, roughness: 0.7 }), T = 0.1;
  R.poly.forEach((_, i) => {
    const e = edge(R, i), g = new THREE.Group(); g.position.set(e.a[0] - e.n[0] * T / 2, 0, e.a[1] - e.n[1] * T / 2); g.rotation.y = -Math.atan2(e.u[1], e.u[0]);
    const holes = []; if (R.window.edge === i) holes.push({ t0: R.window.t0, t1: R.window.t1, y0: R.window.sill, y1: R.window.top, win: true });
    for (const o of R.openings) if (o.edge === i) holes.push({ t0: o.t0, t1: o.t1, y0: 0, y1: o.top, door: true });
    holes.sort((a, b) => a.t0 - b.t0);
    const piece = (t0, t1, y0, y1) => { if (t1 - t0 < 0.005 || y1 - y0 < 0.005) return; for (const [ya, yb, m] of [[y0, Math.min(y1, 0.9), wainMat], [Math.max(y0, 0.9), y1, wallMat]]) { if (yb - ya < 0.005) continue; const b = new THREE.Mesh(new THREE.BoxGeometry(t1 - t0, yb - ya, T), m); b.position.set((t0 + t1) / 2, (ya + yb) / 2, 0); b.receiveShadow = true; g.add(b); } };
    let t = -T / 2; for (const hl of holes) { piece(t, hl.t0, 0, R.h); piece(hl.t0, hl.t1, 0, hl.y0); piece(hl.t0, hl.t1, hl.y1, R.h); t = hl.t1; } piece(t, e.L + T / 2, 0, R.h);
    let rt=0; for(const hole of [...holes.filter((h)=>h.y0<0.92),{t0:e.L,t1:e.L}]) { if(hole.t0>rt) {const rail=new THREE.Mesh(new THREE.BoxGeometry(hole.t0-rt,0.03,T+0.02),wainMat);rail.position.set((rt+hole.t0)/2,0.9,0);g.add(rail);}rt=hole.t1;}
    for (const hl of holes) {
      if (hl.win) { const glass = new THREE.Mesh(new THREE.PlaneGeometry(hl.t1 - hl.t0, hl.y1 - hl.y0), new THREE.MeshBasicMaterial({ color: 0xcfe8ff })); glass.position.set((hl.t0 + hl.t1) / 2, (hl.y0 + hl.y1) / 2, -T / 2 + 0.01); glass.rotation.y = Math.PI * 0; g.add(glass);
        const frame = STD({ color: 0xf4f1ea, roughness: 0.5 }); for (const k of [0.5]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.03, hl.y1 - hl.y0, 0.04), frame); m.position.set(hl.t0 + (hl.t1 - hl.t0) * k, (hl.y0 + hl.y1) / 2, 0); g.add(m); } const mm = new THREE.Mesh(new THREE.BoxGeometry(hl.t1 - hl.t0, 0.03, 0.04), frame); mm.position.set((hl.t0 + hl.t1) / 2, (hl.y0 + hl.y1) / 2, 0); g.add(mm);
        const cur = STD({ color: 0x4a2422, roughness: 1 }); for (const side of [hl.t0 - 0.12, hl.t1 + 0.12]) { const c = new THREE.Mesh(new THREE.BoxGeometry(0.22, R.h - 0.35, 0.05), cur); c.position.set(side, (R.h - 0.35) / 2 + 0.15, T / 2 + 0.06); g.add(c); } }
      if (hl.door) { const dark = new THREE.Mesh(new THREE.PlaneGeometry(hl.t1 - hl.t0, hl.y1), new THREE.MeshBasicMaterial({ color: 0x2a221a })); dark.position.set((hl.t0 + hl.t1) / 2, hl.y1 / 2, -T / 2 - 0.3); g.add(dark);
        const radius=(hl.t1-hl.t0)/2, cx=(hl.t0+hl.t1)/2, spring=hl.y1-radius;
        const sp=new THREE.Shape();sp.moveTo(hl.t0,hl.y1);sp.lineTo(hl.t1,hl.y1);sp.lineTo(hl.t1,spring);
        for(let k=0;k<=32;k++) {const a=k/32*Math.PI;sp.lineTo(cx+radius*Math.cos(a),spring+radius*Math.sin(a));}sp.closePath();
        const arch=new THREE.Mesh(new THREE.ExtrudeGeometry(sp,{depth:T,bevelEnabled:false}),wallMat);arch.position.z=-T/2;g.add(arch);
      }
    }
    g.userData = { e }; roomGroup.add(g); walls.push(g);
  });
  const c = centroid(R); chand.position.set(c[0], R.h - 0.5, c[1]);
  const w = R.window, wc = onEdge(R, w.edge, (w.t0 + w.t1) / 2), we = edge(R, w.edge);
  sun.position.set(wc[0] - we.n[0] * 3, 3.2, wc[1] - we.n[1] * 3 + 0.6); sun.target.position.set(wc[0] + we.n[0] * 1.5, 0, wc[1] + we.n[1] * 1.5);
}

function boxMesh(w, h, d, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.y = h / 2; m.castShadow = m.receiveShadow = true; return m; }

// plant models: img2threejs-style procedural factories per family, photo billboard as fallback
const FAMILY = new Map();
async function loadFamily(f) { if (!f) return null; if (!FAMILY.has(f)) FAMILY.set(f, import(`./models/plants/${f}.js?v=${Date.now() >> 16}`).catch(() => null)); return FAMILY.get(f); }
function seedOf(id) { let h = 7; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 9973 + 1; }

function buildItemMesh(it) {
  const g = new THREE.Group(); g.userData.id = it.id;
  const add = (m) => { m.traverse((o) => { o.userData.id = it.id; if (o.isMesh) o.castShadow = true; }); g.add(m); return m; };
  if (it.kind === 'fridge') {
    const white = STD({ color: 0xf6f6f2, roughness: 0.35, metalness: 0.05 });
    add(boxMesh(it.w, it.h, it.d * 0.92, white)).position.z = -it.d * 0.04;
    const pivot = new THREE.Group(), hx = it.hinge === 'left' ? -it.w / 2 : it.w / 2; pivot.position.set(hx, 0, it.d / 2 - 0.03);
    const door = boxMesh(it.w, it.h * 0.98, 0.06, white); door.position.x = -hx; door.position.z = 0.03; pivot.add(door);
    const handle = boxMesh(0.025, 0.45, 0.04, STD({ color: 0xb8b8b2, metalness: 0.6, roughness: 0.3 })); handle.position.set(-hx * 1.82, it.h * 0.58, 0.08); pivot.add(handle);
    add(pivot); g.userData.door = pivot;
  } else if (it.kind === 'china') {
    const wood = STD({ color: 0x3a2014, roughness: 0.45 });
    add(boxMesh(it.w, it.h * 0.45, it.d, wood));
    const top = add(boxMesh(it.w * 0.96, it.h * 0.55, it.d * 0.78, wood)); top.position.y = it.h * 0.45 + it.h * 0.275; top.position.z = -it.d * 0.08;
    const crown = add(boxMesh(it.w * 0.9, 0.08, it.d * 0.8, wood)); crown.position.y = it.h + 0.04; crown.position.z = -it.d * 0.08;
    const glass = add(new THREE.Mesh(new THREE.PlaneGeometry(it.w * 0.8, it.h * 0.42), new THREE.MeshPhysicalMaterial({ color: 0xaab8b8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.4 }))); glass.position.set(0, it.h * 0.72, it.d * 0.31 + 0.003);
    for (const y of [0.6, 0.8]) { const shelf = add(boxMesh(it.w * 0.84, 0.015, it.d * 0.6, STD({ color: 0xe8e2d6 }))); shelf.position.set(0, it.h * y, -it.d * 0.08); }
  } else if (it.kind === 'table' || it.kind === 'glass' || it.kind === 'stand') {
    const glass = it.kind === 'glass';
    const top = add(new THREE.Mesh(new THREE.BoxGeometry(it.w, glass ? 0.012 : 0.045, it.d), glass ? new THREE.MeshPhysicalMaterial({ color: 0xcde8e2, roughness: 0.04, transparent: true, opacity: 0.35, metalness: 0.1 }) : STD({ color: 0x241913, roughness: 0.18, metalness: 0.15 })));
    top.position.y = it.h - (glass ? 0.006 : 0.022); top.castShadow = !glass;
    const legM = glass ? STD({ color: 0x151515, metalness: 0.7, roughness: 0.4 }) : STD({ color: 0x1e1410, roughness: 0.5 });
    const lw = glass ? 0.022 : 0.06; for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = add(boxMesh(lw, it.h, lw, legM)); l.position.set(sx * (it.w / 2 - lw), it.h / 2, sz * (it.d / 2 - lw)); }
    if (glass) { for (const [bw, bd, bx, bz] of [[it.w, 0.02, 0, it.d / 2 - 0.01], [it.w, 0.02, 0, -it.d / 2 + 0.01], [0.02, it.d, it.w / 2 - 0.01, 0], [0.02, it.d, -it.w / 2 + 0.01, 0]]) for (const y of [it.h - 0.02, 0.16]) { const bar = add(new THREE.Mesh(new THREE.BoxGeometry(bw, 0.02, bd), legM)); bar.position.set(bx, y, bz); } const low = add(new THREE.Mesh(new THREE.BoxGeometry(it.w * 0.96, 0.01, it.d * 0.96), top.material)); low.position.y = 0.17; }
  } else if (LIGHT_SPEC[it.kind]) {
    const s = LIGHT_SPEC[it.kind], metal = STD({ color: 0x2a2a2a, metalness: 0.6, roughness: 0.4 }), glow = new THREE.MeshStandardMaterial({ color: s.color, emissive: s.color, emissiveIntensity: 1.6 });
    if (it.kind === 'led') { const p = add(boxMesh(it.w, 0.025, it.d, glow)); p.position.y = it.h; add(boxMesh(0.015, it.h, 0.015, metal)); }
    else if (it.kind === 'stake') { add(boxMesh(0.015, it.h, 0.015, metal)); const hd = add(boxMesh(0.12, 0.025, 0.04, glow)); hd.position.y = it.h; }
    else if (it.kind === 'lamp5') { add(boxMesh(0.03, it.h, 0.03, metal)); for (let a = 0; a < 5; a++) { const arm = add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 6), metal)); const ang = a * 1.2566; arm.position.set(Math.cos(ang) * 0.13, it.h - 0.12 - (a % 2) * 0.2, Math.sin(ang) * 0.13); arm.rotation.set(Math.sin(ang) * 0.9, 0, -Math.cos(ang) * 0.9); const b = add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.12, 12), glow)); b.position.set(Math.cos(ang) * 0.26, it.h - 0.06 - (a % 2) * 0.2, Math.sin(ang) * 0.26); } const base = add(new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.15, 0.025, 24), metal)); base.position.y = 0.012; }
    else { add(boxMesh(0.02, it.h, 0.02, metal)); const r = add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 10, 36), glow)); r.position.y = it.h; }
    const pool = add(new THREE.Mesh(new THREE.CircleGeometry(s.radius, 40), new THREE.MeshBasicMaterial({ color: s.color, transparent: true, opacity: 0.07, depthWrite: false }))); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.006; pool.raycast = () => {}; pool.castShadow = false;
  } else if (it.kind === 'plant') {
    const pot = createPot({ style: it.pot || 'dark_plastic', diameter: it.potD, height: it.potH, width: it.box ? it.w : undefined, depth: it.box ? it.d : undefined, seed: seedOf(it.id) });
    add(pot.group); g.userData.soilY = pot.soilY;
    const ring = new THREE.Mesh(it.box ? new THREE.RingGeometry(0.01, 0.02, 4) : new THREE.RingGeometry(it.w / 2 + 0.01, it.w / 2 + 0.03, 40), new THREE.MeshBasicMaterial({ color: 0x8fd18a, transparent: true, opacity: 0.9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.008; ring.raycast = () => {}; g.add(ring); g.userData.ring = ring;
    const holder = new THREE.Group(); holder.position.y = pot.soilY; g.add(holder); g.userData.holder = holder;
    const photoMode = false;
    loadFamily(PLANT_META[it.id]?.approved === false ? null : it.family).then((mod) => {
      if (!photoMode && mod && mod.createPlant) { try { const m = mod.createPlant({ height: it.height, spread: Math.max(it.w, it.potD * 1.6), potDiameter: it.potD, width: it.box ? it.w : undefined, depth: it.box ? it.d : undefined, seed: seedOf(it.id) }); add(m); holder.add(m); return; } catch (e) { console.warn('model', it.family, e); } }
      const tex = PLANT_TEX[it.src]; if (!tex) return; const a = tex.image.width / tex.image.height, H = photoMode ? it.h : it.height + it.potH * 0.2;
      const spr = new THREE.Mesh(new THREE.PlaneGeometry(H * a, H), new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }));
      spr.position.y = H / 2 - (photoMode ? 0 : it.potH * 0.15); spr.userData.id = it.id; holder.add(spr); g.userData.billboard = spr;
    });
  }
  return g;
}

function syncMeshes(rebuild = false) {
  if (rebuild) { itemGroup.clear(); meshes.clear(); }
  for (const it of state.items) {
    let g = meshes.get(it.id); if (!g) { g = buildItemMesh(it); meshes.set(it.id, g); itemGroup.add(g); }
    let x = it.x, z = it.z, y = baseY(it, state.items);
    if (it.kind === 'stake' && it.attach) { const p = state.items.find((q) => q.id === it.attach); if (p) { x = p.x + p.potD * 0.22; z = p.z; y = baseY(p, state.items) + p.potH * 0.85; } }
    g.position.set(x, y, z); g.rotation.y = -it.rot * Math.PI / 2;
    if (g.userData.door) g.userData.door.rotation.y = state.fridgeOpen ? (it.hinge === 'left' ? -1.9 : 1.9) : 0;
    if (g.userData.ring) { const s = it._sat ?? 1; g.userData.ring.material.color.setHSL(0.02 + 0.3 * s, 0.65, 0.58); g.userData.ring.visible = mode === 'edit' || showLight; }
  }
  for (const [id, g] of meshes) if (!state.items.find((i) => i.id === id)) { itemGroup.remove(g); meshes.delete(id); }
  drawZones(); drawSelection();
}
let selRing;
function drawSelection() {
  if (selRing) { scene.remove(selRing); selRing = null; }
  const it = state.items.find((i) => i.id === selected); if (!it) return;
  const F = footprint(it), y = baseY(it, state.items) + 0.012, pad = 0.03;
  const pts = [[F.x0 - pad, F.z0 - pad], [F.x1 + pad, F.z0 - pad], [F.x1 + pad, F.z1 + pad], [F.x0 - pad, F.z1 + pad], [F.x0 - pad, F.z0 - pad]].map(([x, z]) => new THREE.Vector3(x, y, z));
  selRing = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xe8c987 })); scene.add(selRing);
}
function drawZones() {
  zoneGroup.clear(); if (mode !== 'edit') return;
  for (const z of clearanceZones(state.items, state.room)) { const sh = new THREE.Shape(z.poly.map(([x, zz]) => new THREE.Vector2(x, -zz))); const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshBasicMaterial({ color: z.fridge ? 0xff6a50 : 0xe0a862, transparent: true, opacity: z.fridge ? 0.24 : 0.14, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.005; zoneGroup.add(m); }
}
function drawHeat() {
  if (!showLight) return; const ctx = heatCanvas.getContext('2d'), N = heatCanvas.width, img = ctx.createImageData(N, N), B = bounds(state.room);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = B.x0 + (i + 0.5) / N * (B.x1 - B.x0), z = B.z0 + (j + 0.5) / N * (B.z1 - B.z0); const L = Math.min(1.2, lightAt(x, z, state.items, 0.6)) / 1.2; const c = new THREE.Color().setHSL(0.62 - 0.5 * L, 0.75, 0.25 + 0.35 * L), k = 4 * (j * N + i); img.data[k] = c.r * 255; img.data[k + 1] = c.g * 255; img.data[k + 2] = c.b * 255; img.data[k + 3] = 210; }
  ctx.putImageData(img, 0, 0); heatTex.needsUpdate = true;
}

// ───────── modes & views ─────────
let mode = 'explore', view = 'overview', showLight = false, selected = null;
const VIEWS = { overview: ICON.cube, top: ICON.top, eye: ICON.eye };
function setView(v = view) {
  view = v; const R = state.room, c = centroid(R), B = bounds(R);
  if (v === 'top') { const fit = R.h + Math.max((B.x1-B.x0)/camera.aspect, B.z1-B.z0) / (2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))) * 1.12; camera.position.set(c[0], Math.max(7.4,fit), c[1] + 0.01); controls.target.set(c[0], 0, c[1]); }
  else if (v === 'eye') { const w = R.window, p = onEdge(R, w.edge, (w.t0 + w.t1) / 2); camera.position.set(B.x1 - 0.5, 1.55, B.z1 - 0.5); controls.target.set(p[0] + 0.6, 0.9, p[1]); }
  else { camera.position.set(B.x1 + 2.4, 3.9, B.z1 + 2.8); controls.target.set(c[0], 0.5, c[1]); }
  $('#planCompass').classList.toggle('hidden', v !== 'top');
  $('#bView').innerHTML = VIEWS[v]; controls.update();
}
function setMode(m) {
  mode = m; document.body.dataset.mode = m; document.querySelectorAll('#mode .z-seg__item').forEach((b) => b.classList.toggle('is-active', b.dataset.mode === m));
  $('#modeHint').textContent = m === 'edit' ? 'EDIT · drag to move · tap to edit' : 'EXPLORE · everything is locked · drag to look';
  closeSheet(); selected = null; drawDock(); setView(m === 'edit' ? 'top' : 'overview'); syncMeshes();
}
document.querySelectorAll('#mode .z-seg__item').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
$('#bReal').classList.remove('real-filter');
$('#bReal').innerHTML = ICON.camera;
$('#bReal').setAttribute('aria-label', 'Camera shutter');
$('#bReal').removeAttribute('aria-pressed');
$('#bReal').onclick = () => { if (window.GR?.real) void GR.real.requestView(); else toast('Camera is still loading'); };
$('#bView').onclick = () => { const order = ['overview', 'top', 'eye']; setView(order[(order.indexOf(view) + 1) % 3]); };
$('#bLight').innerHTML = ICON.sun; $('#bFridge').innerHTML = ICON.fridge;
$('#bLight').onclick = () => { showLight = !showLight; $('#bLight').setAttribute('aria-pressed', showLight); heatMesh.visible = showLight; drawHeat(); syncMeshes(); };
$('#bFridge').onclick = () => { state.fridgeOpen = !state.fridgeOpen; $('#bFridge').setAttribute('aria-pressed', state.fridgeOpen); syncMeshes(); };
function resize() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.fov = w < h ? 62 : 48; camera.updateProjectionMatrix(); }
addEventListener('resize', resize);

const tmpV = new THREE.Vector3();
function cutaway() { for (const g of walls) { const e = g.userData.e, mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2]; g.visible = (camera.position.x - mid[0]) * e.n[0] + (camera.position.z - mid[1]) * e.n[1] > -0.05 || view === 'eye'; } }
function orientBillboards() { for (const g of meshes.values()) { const b = g.userData.billboard; if (!b) continue; g.getWorldPosition(tmpV); b.rotation.y = Math.atan2(camera.position.x - tmpV.x, camera.position.z - tmpV.z) - g.rotation.y; } }
function nearHide() { // never let a plant fill the lens (eye view / close orbit)
  for (const g of meshes.values()) { g.getWorldPosition(tmpV); const it = state.items.find((i) => i.id === g.userData.id); const r = it ? Math.max(it.w, it.d) / 2 + 0.35 : 0.4;
    g.visible = Math.hypot(camera.position.x - tmpV.x, camera.position.z - tmpV.z) > r || camera.position.y > (it ? it.h + baseY(it, state.items) + 0.3 : 2); } }
const clock = new THREE.Clock();
function frame() { requestAnimationFrame(frame); const dt = clock.getDelta(), t = clock.elapsedTime; controls.update(); cutaway(); nearHide(); orientBillboards(); for (const f of FRAME_HOOKS) { try { f(dt, t); } catch (e) { console.warn(e); } } renderer.render(scene, camera); }
function snapshot() { controls.update(); cutaway(); nearHide(); orientBillboards(); renderer.render(scene, camera); return canvas.toDataURL('image/jpeg', 0.85); }

// ───────── picking / dragging (edit mode only) ─────────
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let drag = null;
function setNdc(e) { const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera); }
function pick(e) {
  setNdc(e);
  if (view === 'top') { // footprint pick at each item's own standing height (plants on tables sit higher)
    const hit = (it) => { const p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -(baseY(it, state.items) + (SURFACE[it.kind] ? it.h : 0))), new THREE.Vector3()); if (!p) return false; const F = footprint(it); return p.x > F.x0 - 0.06 && p.x < F.x1 + 0.06 && p.z > F.z0 - 0.06 && p.z < F.z1 + 0.06; };
    const under = state.items.filter((it) => !(it.kind === 'stake' && it.attach)).filter(hit).sort((a, b) => a.w * a.d - b.w * b.d); if (under.length) return under[0].id; }
  for (const h of ray.intersectObjects(itemGroup.children, true)) { if (!h.object.visible) continue; const m = h.object.material; if (m && m.map && m.alphaTest && h.uv && !alphaHit(m.map.image, h.uv)) continue; if (h.object.userData.id) return h.object.userData.id; }
  return null;
}
const alphaCache = new Map();
function alphaHit(img, uv) { let c = alphaCache.get(img); if (!c) { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 64, 64); c = x.getImageData(0, 0, 64, 64).data; alphaCache.set(img, c); } const i = Math.min(63, Math.floor(uv.x * 64)), j = Math.min(63, Math.floor((1 - uv.y) * 64)); return c[4 * (j * 64 + i) + 3] > 100; }
function planePoint(e, y) { setNdc(e); return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), new THREE.Vector3()); }

canvas.addEventListener('pointerdown', (e) => {
  if (!e.isPrimary) return;
  const id = pick(e); if (!id) { drag = { none: true, x: e.clientX, y: e.clientY }; return; }
  const it = state.items.find((i) => i.id === id), y = baseY(it, state.items), p = planePoint(e, y);
  drag = { id, y, dx: p ? it.x - p.x : 0, dz: p ? it.z - p.z : 0, x: e.clientX, y0: e.clientY, moved: false, canMove: mode === 'edit' && !it.locked };
  if (drag.canMove) { controls.enabled = false; e.stopImmediatePropagation(); canvas.setPointerCapture(e.pointerId); }
}, { capture: true });
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.none || !drag.canMove) return;
  if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y0) > 6) drag.moved = true; if (!drag.moved) return;
  const p = planePoint(e, drag.y); if (!p) return; const it = state.items.find((i) => i.id === drag.id);
  it.x = Math.round((p.x + drag.dx) / 0.025) * 0.025; it.z = Math.round((p.z + drag.dz) / 0.025) * 0.025; if (it.kind === 'stake') it.attach = '';
  syncMeshes(); rescoreSoon();
});
addEventListener('pointerup', (e) => {
  if (!drag) return; const d = drag; drag = null; controls.enabled = true;
  const tap = Math.hypot(e.clientX - d.x, e.clientY - (d.y0 ?? d.y)) < 8;
  if (d.none) { if (tap && openPanel === 'item') closeSheet(); return; }
  if (tap) { selected = d.id; drawSelection(); openItem(d.id); if (mode === 'edit' && !d.canMove) toast('Locked — unlock it in the sheet to move'); }
  else { rescore(); save(); }
});

// ───────── score / save ─────────
let lastEval = null, winWeight = 0.3;
function rescore() {
  lastEval = evaluate(state.items, state.room, { winWeight });
  const el = $('#score'); el.textContent = Math.round(lastEval.score); el.classList.toggle('bad', lastEval.warns.some((w) => !w.startsWith('(soft)')));
  $('#lightPct').textContent = `LIGHT ${Math.round(lastEval.lightSat * 100)}%`;
  const hard = lastEval.warns.filter((w) => !w.startsWith('(soft)')), soft = lastEval.warns.filter((w) => w.startsWith('(soft)'));
  const wEl = $('#warn'); const first = hard.find((w) => w.includes('fridge door')) || hard[0];
  if (hard.length || soft.length) { wEl.classList.remove('hidden'); wEl.classList.toggle('soft', !hard.length); wEl.querySelector('span').textContent = first ? first + (hard.length > 1 ? `  +${hard.length - 1}` : '') : soft[0].slice(7); } else { wEl.classList.add('hidden'); wEl.querySelector('span').textContent = ''; }
  syncMeshes(); drawHeat();
}
let rsT; function rescoreSoon() { clearTimeout(rsT); rsT = setTimeout(rescore, 60); }
let svT; function save() { clearTimeout(svT); svT = setTimeout(() => { const s = JSON.stringify(stripState()); localStorage.setItem('gr_state', s); api('/api/state', { method: 'PUT', body: s }).catch(() => {}); }, 400); }
const strip = ({ _light, _sat, _on, ...r }) => r;
function stripState() { return { room: state.room, items: state.items.map(strip) }; }

// ───────── sheet & dock ─────────
let openPanel = null;
function openSheet(name, html) { openPanel = name; $('#sheetBody').innerHTML = html; const s = $('#sheet'); s.classList.remove('hidden'); s.scrollTop = 0; document.querySelectorAll('#dock button').forEach((b) => b.classList.toggle('on', b.dataset.panel === (HUB_KEYS.has(name) ? 'live' : name === 'layouts' ? 'suggest' : name))); }
function closeSheet() { openPanel = null; $('#sheet').classList.add('hidden'); document.querySelectorAll('#dock button').forEach((b) => b.classList.remove('on')); stopPolls(); }
const HUB_KEYS = new Set(['ar', 'voice', 'chat', 'scan', 'scan_live']);
const HUB_ITEMS = new Map();
const DOCK = { explore: [['suggest', 'Suggest', ICON.sparkle], ['live', 'Live', ICON.chat]],
  edit: [['items', 'Items', ICON.leaf], ['suggest', 'Suggest', ICON.sparkle], ['live', 'Live', ICON.chat]] };
const EXTRA_DOCK = [];
function hubOpen(key) { stopPolls(); const item = HUB_ITEMS.get(key); (item?.open || PANELS[key])?.(); }
function addHubItem(d) { HUB_ITEMS.set(d.key, { ...d }); if (d.open) PANELS[d.key] = d.open; if (openPanel === 'live') PANELS.live(); }
function drawDock() {
  const list = [...DOCK[mode], ...EXTRA_DOCK.filter((d) => d.modes.includes(mode)).sort((a,b)=>({zen:0,almanac:1}[a.key] ?? 2)-({zen:0,almanac:1}[b.key] ?? 2)).map((d) => [d.key, d.label, d.icon])];
  $('#dock').innerHTML = list.map(([k, l, ic]) => `<button data-panel="${k}" aria-label="${l}">${ic}<span>${l}</span></button>`).join('');
  document.querySelectorAll('#dock button').forEach((b) => b.onclick = () => { if (openPanel === b.dataset.panel) return closeSheet(); stopPolls(); PANELS[b.dataset.panel]?.(); });
}
function hubToolbar() {
  const scan = HUB_ITEMS.has('scan_live') || PANELS.scan_live ? 'scan_live' : 'scan';
  return `<div class="hub-tools"><button class="btn" id="hubTalk" aria-pressed="${!!window.GR?.voice?.on}">${ICON.lamp}${window.GR?.voice?.on ? 'Stop talking' : 'Talk'}</button><button class="btn" data-panel="voice">Voice options</button><button class="btn" data-panel="ar">${ICON.cube}AR measure</button><button class="btn" data-panel="${scan}">${ICON.scan}Room scan</button>${[...HUB_ITEMS.values()].filter((d)=>!HUB_KEYS.has(d.key)).map((d)=>`<button class="btn" data-panel="${esc(d.key)}">${d.icon || ''}${esc(d.label)}</button>`).join('')}</div>`;
}
function wireHub() {
  $('#sheetBody').querySelectorAll('.hub-tools [data-panel]').forEach((b) => b.onclick = () => hubOpen(b.dataset.panel));
  $('#hubTalk').onclick = async () => { const v = window.GR?.voice; if (!v) return toast('Voice is still loading'); if (v.on) v.stop(); else { v.setMode('talk'); await v.start(); } const b=$('#hubTalk'); if(b) { b.setAttribute('aria-pressed',v.on); b.innerHTML=ICON.lamp+(v.on?'Stop talking':'Talk'); } };
}

function numRow(label, key, val) { return `<div class="row"><label class="micro">${label}</label><input type="number" inputmode="decimal" step="0.5" data-k="${key}" value="${val}"><span class="unit">in</span></div>`; }
function iconFor(it) { return { fridge: ICON.fridge, china: ICON.layers, table: ICON.table, glass: ICON.table, stand: ICON.table, led: ICON.panel, stake: ICON.sun, lamp5: ICON.lamp, ring: ICON.sun }[it.kind] || ICON.leaf; }

function openItem(id) {
  const it = state.items.find((i) => i.id === id); if (!it) return;
  const on = it._on ? state.items.find((s) => s.id === it._on) : null, L = lightAt(it.x, it.z, state.items, 0.6);
  let h = `<h3>${esc(it.name)}</h3><p class="sub">${it.kind === 'plant' ? `${on ? 'On ' + esc(on.name) : 'On the floor'} · ${fmtFt(distToWindow(it.x, it.z, state.room))} from window` : (it.guess ? 'Size estimated — tap Edit to correct' : (it.locked ? 'Locked in place' : 'Movable'))}</p>`;
  if (it.kind === 'plant') h += `<div class="facts"><div class="fact bracket"><span class="micro">Light</span><b class="${(it._sat ?? 0) >= 0.99 ? 'good' : 'warn'}">${Math.round((it._sat ?? 0) * 100)}%</b></div><div class="fact"><span class="micro">Needs</span><b>${it.light}</b></div><div class="fact"><span class="micro">Height</span><b>${toIn(it.height + it.potH)}″</b></div></div>`;
  else h += `<div class="facts"><div class="fact"><span class="micro">Width</span><b>${toIn(it.w)}″</b></div><div class="fact"><span class="micro">Depth</span><b>${toIn(it.d)}″</b></div><div class="fact"><span class="micro">Light here</span><b>${L.toFixed(2)}</b></div></div>`;
  const extra = ITEM_ACTIONS.filter((x) => !x.when || x.when(it)).map((x, i) => `<button class="btn" data-xa="${i}">${x.icon || ''}${esc(x.label)}</button>`).join('');
  const wireExtra = () => $('#sheetBody').querySelectorAll('[data-xa]').forEach((b) => b.onclick = () => ITEM_ACTIONS.filter((x) => !x.when || x.when(it))[+b.dataset.xa].run(it));
  if (mode === 'explore') { h += `<div class="row"><button class="btn gold" id="iEdit">Edit this</button>${extra}</div>`; openSheet('item', h); wireExtra(); $('#iEdit').onclick = () => { setMode('edit'); selected = id; drawSelection(); openItem(id); }; return; }
  if (it.kind === 'plant') {
    h += (it.box ? numRow('Box length', 'w', toIn(it.w)) + numRow('Box depth', 'd', toIn(it.d)) : numRow('Pot dia.', 'potD', toIn(it.potD))) + numRow('Pot height', 'potH', toIn(it.potH)) + numRow('Plant height', 'height', toIn(it.height));
    h += `<div class="row"><label class="micro">Light need</label><select data-k="light">${['high', 'med', 'low'].map((l) => `<option ${l === it.light ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`;
  } else {
    h += numRow('Width', 'w', toIn(it.w)) + numRow('Depth', 'd', toIn(it.d)) + numRow('Height', 'h', toIn(it.h));
    if (it.kind === 'fridge') h += `<div class="row"><label class="micro">Hinge</label><select data-k="hinge"><option ${it.hinge === 'left' ? 'selected' : ''}>left</option><option ${it.hinge === 'right' ? 'selected' : ''}>right</option></select><span class="unit">as you face it</span></div>`;
    if (it.kind === 'stake') h += `<div class="row"><label class="micro">In plant</label><select data-k="attach"><option value="">(free)</option>${state.items.filter((p) => p.kind === 'plant').map((p) => `<option value="${p.id}" ${p.id === it.attach ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`;
  }
  h += `<div class="row">${extra}</div><div class="row"><button class="btn" id="iRot">${ICON.rotate}Rotate</button><button class="btn ${it.locked ? 'on' : ''}" id="iLock">${it.locked ? ICON.lock + 'Locked' : ICON.unlock + 'Movable'}</button>${it.kind === 'plant' ? `<button class="btn" id="iDup">${ICON.copy}</button><button class="btn danger" id="iDel">${ICON.trash}</button>` : ''}</div>`;
  if(it.kind === 'stand') h += `<button class="btn danger" id="iDel">${ICON.trash}Remove stand</button>`;
  openSheet('item', h); wireExtra();
  $('#sheetBody').querySelectorAll('[data-k]').forEach((el) => el.onchange = () => {
    const k = el.dataset.k; let v = el.value; if (el.type === 'number') { v = parseFloat(v) * IN; if (!(v > 0)) return; }
    if (it.kind === 'plant' && k === 'potD') { it.potD = v; it.w = it.d = v; } else if (it.kind === 'plant' && (k === 'potH' || k === 'height')) { it[k] = v; it.h = it.potH + it.height; } else { it[k] = v; if (k === 'w' || k === 'd' || k === 'h') it.guess = false; }
    const g = meshes.get(it.id); if (g) { itemGroup.remove(g); meshes.delete(it.id); } rescore(); save();
  });
  $('#iRot').onclick = () => { it.rot = (it.rot + 1) % 4; rescore(); save(); };
  $('#iLock').onclick = () => { it.locked = !it.locked; save(); openItem(id); };
  if ($('#iDup')) $('#iDup').onclick = () => { const n = { ...strip(it), id: it.id + '_' + Date.now().toString(36), name: it.name + ' (copy)', x: it.x + 0.3 }; state.items.push(n); rescore(); save(); selected = n.id; openItem(n.id); };
  if ($('#iDel')) $('#iDel').onclick = () => { if (!confirm(`Delete ${it.name}?`)) return; state.items = state.items.filter((i) => i !== it); selected = null; rescore(); save(); closeSheet(); };
}

function miniMap(items, size = 132) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size * 2; const x = cv.getContext('2d'), R = state.room, B = bounds(R), s = size * 2 / Math.max(B.x1 - B.x0, B.z1 - B.z0) * 0.96, o = size * 0.04;
  const P = ([px, pz]) => [o + (px - B.x0) * s, o + (pz - B.z0) * s];
  x.fillStyle = '#15140f'; x.fillRect(0, 0, cv.width, cv.height); x.beginPath(); R.poly.forEach((p, i) => { const [a, b] = P(p); i ? x.lineTo(a, b) : x.moveTo(a, b); }); x.closePath(); x.fillStyle = '#2b281f'; x.fill(); x.strokeStyle = 'rgba(232,201,135,.6)'; x.lineWidth = 2; x.stroke();
  const w = R.window, a = P(onEdge(R, w.edge, w.t0)), b = P(onEdge(R, w.edge, w.t1)); x.strokeStyle = '#9fd3ff'; x.lineWidth = 6; x.beginPath(); x.moveTo(...a); x.lineTo(...b); x.stroke();
  for (const it of [...items].sort((p, q) => (p.kind === 'plant') - (q.kind === 'plant'))) { const F = footprint(it); x.fillStyle = { fridge: '#f2f0ea', china: '#6b3f28', table: '#4a3324', glass: '#9fd8d0', plant: '#7cc46f' }[it.kind] || '#e7a6ff';
    if (isRound(it)) { x.beginPath(); x.arc(...P([it.x, it.z]), Math.max(3, it.w / 2 * s), 0, 7); x.fill(); } else { const [p0, q0] = P([F.x0, F.z0]); x.fillRect(p0, q0, Math.max(3, (F.x1 - F.x0) * s), Math.max(3, (F.z1 - F.z0) * s)); } }
  return cv.toDataURL();
}

let suggestions = (() => { try { return JSON.parse(localStorage.getItem('gr_suggestions') || '[]'); } catch { return []; } })(), polls = [], suggestBusy = false;
function persistSuggestions() { try { localStorage.setItem('gr_suggestions', JSON.stringify(suggestions.map((x) => ({ score: x.score, lightSat: x.lightSat, warns: x.warns, items: x.items.map(strip) })))); } catch {} }
function applyPlan(items, msg) { state.items = items.map((i) => strip({ ...i })); syncMeshes(true); rescore(); save(); drawSelection?.(); toast(msg); }
function drawSuggestions(status) {
  const output = document.getElementById('sOut'); if (!output || openPanel !== 'suggest') return;
  const busy = status ?? (suggestBusy ? 'Packing spaced pots…' : '');
  output.innerHTML = suggestions.map((s, i) => { const n = s.warns.filter((w) => !w.startsWith('(soft)')).length; return `<div class="card"><img src="${miniMap(s.items)}"><b>${Math.round(s.score)}</b><span class="micro">LIGHT ${Math.round(s.lightSat * 100)}% · ${n ? n + ' ISSUES' : 'CLEAR'}</span><button class="btn" data-i="${i}" ${n ? 'disabled' : ''}>Use</button></div>`; }).join('') + (busy ? `<span class="micro">${busy}</span>` : (suggestions.length ? '' : '<span class="micro">TAP SUGGEST 3</span>'));
  output.querySelectorAll('button[data-i]').forEach((b) => b.onclick = () => { const pr = suggestions[+b.dataset.i]; if (pr.warns.some((w) => !w.startsWith('(soft)'))) return toast('Not safe to apply yet'); applyPlan(pr.items, 'Applied — switch to Edit to tweak'); });
  const go = document.getElementById('sGo'); if (go) go.disabled = suggestBusy;
}
function stopPolls() { polls.forEach(clearInterval); polls = []; }
const PANELS = {
  suggest() {
    openSheet('suggest', `<h3>Find <em>arrangements</em></h3><p class="sub">Room to grow: spaced pots, a clear walking route and light matched to each plant.</p><div class="sheet-tabs"><button class="btn on" disabled>Suggest</button><button class="btn" data-panel="layouts">Saved layouts</button></div>
      <div class="row"><label class="micro">Window pull</label><input id="sW" type="range" min="0" max="0.7" step="0.05" value="${winWeight}"></div>
      <div class="row"><label class="micro">Furniture</label><select id="sF"><option value="0">locked furniture stays</option><option value="1">all may move (fridge stays)</option></select></div>
      <div class="row"><button class="btn gold" id="sGo">${ICON.sparkle}Suggest 3</button></div><div class="cards" id="sOut"></div>`);
    $('[data-panel=layouts]').onclick = () => PANELS.layouts();
    $('#sW').oninput = (e) => { winWeight = parseFloat(e.target.value); rescore(); };
    drawSuggestions();
    $('#sGo').onclick = async () => {
      if (suggestBusy) return;
      const mf = $('#sF').value === '1', source = state.items.map(strip), fresh = [];
      suggestBusy = true; drawSuggestions('Packing spaced pots…');
      try {
        for (const seed of [1, 77, 7920].map((x) => x + Math.floor(Math.random() * 1e5))) {
          await new Promise((r) => setTimeout(r, 50));
          fresh.push(await optimizeAsync(source, state.room, { seed, moveFurniture: mf, winWeight }));
          fresh.sort((a, b) => b.score - a.score);
          suggestions = fresh.slice(); persistSuggestions(); drawSuggestions(fresh.length < 3 ? 'Packing spaced pots…' : '');
        }
      } finally { suggestBusy = false; drawSuggestions(); }
    };
  },
  items() {
    const tiles = state.items.map((it) => `<div class="tile ${it.id === selected ? 'sel' : ''}" data-id="${it.id}">${it.locked ? `<span class="lock">${ICON.lock}</span>` : ''}${it.src ? `<img src="${it.src}">` : `<div class="ico">${iconFor(it)}</div>`}${esc(it.name)}</div>`).join('');
    openSheet('items', `<h3>Items <em>${state.items.length}</em></h3><p class="sub">Tap to edit sizes in inches. Locked items don't move when you drag or suggest.</p><div class="grid">${tiles}</div><div class="row"><button class="btn" id="iStand">Add my plant stand</button><button class="btn" id="iReset">Reset to photo inventory</button></div>`);
    $('#iStand').onclick = () => { const id='stand_'+Date.now().toString(36), B=bounds(state.room); state.items.push({id,kind:'stand',name:'Plant stand (measure me)',w:0.36,d:0.36,h:0.65,x:B.x0+0.5,z:B.z0+0.5,rot:0,guess:true});syncMeshes();rescore();save();selected=id;openItem(id);toast('Estimated stand — enter your actual dimensions'); };
    $('#sheetBody').querySelectorAll('.tile').forEach((t) => t.onclick = () => { selected = t.dataset.id; drawSelection(); openItem(selected); });
    $('#iReset').onclick = async () => { if (!confirm('Reset all items to the starting layout?')) return; state.items = defaultItems(await loadPlants()); syncMeshes(true); rescore(); save(); };
  },
  async layouts() {
    let list = []; try { list = await api('/api/layouts'); } catch (e) { list = JSON.parse(localStorage.getItem('gr_layouts') || '[]'); }
    const persist = () => { localStorage.setItem('gr_layouts', JSON.stringify(list)); return api('/api/layouts', { method: 'PUT', body: JSON.stringify(list) }).catch(() => {}); };
    const render = () => { openSheet('layouts', `<h3>Saved <em>layouts</em></h3><div class="sheet-tabs"><button class="btn" id="backSuggest">Suggest</button><button class="btn on" disabled>Saved layouts</button></div><div class="row"><input id="lName" type="text" placeholder="Name this layout" style="flex:1"><button class="btn gold" id="lSave">Save</button></div>
      <div class="cards">${list.map((l, i) => `<div class="card"><img src="${miniMap(l.items)}"><b>${Math.round(l.score ?? 0)}</b><span class="micro">${esc(l.name)}</span><div class="row"><button class="btn" data-load="${i}">Load</button><button class="btn danger" data-del="${i}">${ICON.trash}</button></div></div>`).join('') || '<span class="micro">NONE YET</span>'}</div>`);
      $('#backSuggest').onclick = () => PANELS.suggest();
      $('#lSave').onclick = async () => { list.unshift({ name: $('#lName').value || new Date().toLocaleString(), score: lastEval?.score, room: state.room, items: stripState().items, ts: Date.now() }); await persist(); render(); toast('Saved'); };
      $('#sheetBody').querySelectorAll('[data-load]').forEach((b) => b.onclick = () => { const plan = migratePlan(list[+b.dataset.load]); if(plan.room) {state.room=plan.room;buildRoom();} applyPlan(plan.items, 'Loaded'); });
      $('#sheetBody').querySelectorAll('[data-del]').forEach((b) => b.onclick = async () => { list.splice(+b.dataset.del, 1); await persist(); render(); }); };
    render();
  },
  real() {
    if (window.GR?.real) { window.GR.almanac?.openPhotos(); return; }
    toast('Camera is still loading');
  },
  async scan() {
    let scans = []; try { scans = await api('/api/scans'); } catch (e) { toast(e.message); }
    const ready = scans.filter((s) => s.layout && s.layout.items);
    openSheet('scan', `<h3>Scan <em>the room</em></h3><p class="sub">Walk the room slowly and capture every wall — corners, window, doors, furniture and each plant. 15–40 photos or one slow video. Hermes rebuilds the layout and you can import it here.</p>
      <div class="row"><label class="btn gold">${ICON.camera}Take photo<input id="scCam" type="file" accept="image/*" capture="environment" hidden></label><label class="btn">${ICON.upload}Photos / video<input id="scPick" type="file" accept="image/*,video/*" multiple hidden></label></div>
      <div class="thumbs" id="scThumbs"></div><p class="micro" id="scState">${pending.length} READY TO SEND</p>
      <textarea id="scNote" placeholder="Notes for Hermes (e.g. fridge hinge is on the right)"></textarea>
      <div class="row"><button class="btn gold" id="scSend" ${pending.length ? '' : 'disabled'}>${ICON.send}Send scan to Hermes</button></div>
      ${ready.length ? `<h3 style="margin-top:14px">Layouts <em>from scans</em></h3><div class="cards">${ready.map((s, i) => `<div class="card"><img src="${miniMap(s.layout.items)}"><span class="micro">${esc(s.id)}</span><button class="btn gold" data-imp="${i}">Import</button></div>`).join('')}</div>` : ''}
      ${scans.filter((s) => !s.layout).map((s) => `<p class="micro">${esc(s.id)} · ${esc(s.status.state)} · ${s.media.length} FILES</p>`).join('')}`);
    drawThumbs();
    const addFiles = (fl) => { for (const f of fl) pending.push(f); drawThumbs(); $('#scState').textContent = `${pending.length} READY TO SEND`; $('#scSend').disabled = !pending.length; };
    $('#scCam').onchange = (e) => addFiles(e.target.files); $('#scPick').onchange = (e) => addFiles(e.target.files);
    $('#scSend').onclick = async () => {
      $('#scSend').disabled = true; const { id } = await api('/api/scan', { method: 'POST', body: '{}' });
      for (let i = 0; i < pending.length; i++) { $('#scState').textContent = `UPLOADING ${i + 1}/${pending.length}`; const f = pending[i]; const isImg = f.type.startsWith('image/'); const blob = isImg ? await shrink(f) : f; const ext = isImg ? 'jpg' : (f.name.split('.').pop() || 'mp4').toLowerCase();
        const r = await fetch(`/api/scan/${id}/${String(i + 1).padStart(3, '0')}.${ext}`, { method: 'PUT', headers: { 'X-Garden-Key': KEY }, body: blob }); if (!r.ok) { toast('Upload failed: ' + r.status); $('#scSend').disabled = false; return; } }
      const r = await api(`/api/scan/${id}/done`, { method: 'POST', body: JSON.stringify({ note: $('#scNote').value }) });
      pending = []; toast(r.chat ? 'Sent — Hermes is rebuilding the layout' : 'Uploaded; chat offline', 4000); PANELS.scan();
    };
    $('#sheetBody').querySelectorAll('[data-imp]').forEach((b) => b.onclick = () => { const L = migratePlan(ready[+b.dataset.imp].layout); if (!confirm('Replace the current layout with this scan? (Save it in Layouts first if you want to keep it.)')) return; if (L.room && L.room.poly) state.room = L.room; state.items = L.items.map((i) => ({ ...i })); buildRoom(); syncMeshes(true); setView(); rescore(); save(); toast('Imported scan layout'); });
    polls.push(setInterval(() => { if (openPanel === 'scan') api('/api/scans').then((n) => { if (n.filter((s) => s.layout).length !== ready.length) PANELS.scan(); }).catch(() => {}); }, 8000));
  },
  live() { PANELS.chat(true); },
  chat(inHub = false) {
    openSheet(inHub ? 'live' : 'chat', `${inHub ? '<h3>Live <em>room</em></h3><p class="sub">Talk, measure, scan and ask Hermes.</p>' + hubToolbar() : '<button class="btn" id="backLive">← Live</button>'}<h3>Hermes</h3><p class="micro" id="cState"></p><div class="chat" id="cLog"></div><textarea id="cIn" placeholder="Message this Hermes chat…"></textarea><div class="row"><button class="btn gold" id="cSend">${ICON.send}Send</button><label class="micro"><input type="checkbox" id="cLay"> attach layout</label></div>`);
    if (inHub) wireHub(); else $('#backLive').onclick = () => PANELS.live();
    lastMsgId = 0; pollChat(); polls.push(setInterval(pollChat, 4000));
    $('#cSend').onclick = async () => { let text = $('#cIn').value.trim(); if (!text) return; if ($('#cLay').checked) text += ' | layout: ' + state.items.map((i) => `${i.name}@(${toIn(i.x)}in,${toIn(i.z)}in${i._on ? ' on ' + i._on : ''})`).join('; ').slice(0, 2500);
      $('#cSend').disabled = true; try { const r = await api('/api/chat', { method: 'POST', body: JSON.stringify({ text }) }); if (!r.ok) toast(r.detail, 4000); else { $('#cIn').value = ''; toast('Sent'); } } finally { $('#cSend').disabled = false; } };
  },
};
let pending = [], lastMsgId = 0;
const ITEM_ACTIONS = []; // [{label, icon, when(it), run(it)}] added by modules
const FRAME_HOOKS = []; // fn(dt, t) called every frame
function drawThumbs() { const el = $('#scThumbs'); if (!el) return; el.innerHTML = ''; pending.slice(-12).forEach((f) => { if (f.type.startsWith('image/')) { const im = document.createElement('img'); im.src = URL.createObjectURL(f); el.appendChild(im); } else { const d = document.createElement('div'); d.className = 'vid'; d.textContent = 'VIDEO'; el.appendChild(d); } }); }
async function shrink(file, max = 2048) { try { const bmp = await createImageBitmap(file); const s = Math.min(1, max / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); return await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.88)); } catch { return file; } }
async function pollChat() {
  try { const r = await api('/api/chat?after=' + lastMsgId); const log = $('#cLog'); if (!log) return;
    $('#cState').textContent = r.portal ? `CONNECTED · ${r.session}` : 'PORTAL OFFLINE — run bin/portal on the desktop';
    for (const m of r.messages) { lastMsgId = Math.max(lastMsgId, m.id); const d = document.createElement('div'); d.className = 'msg ' + m.role; d.textContent = m.text; log.appendChild(d); }
    if (r.messages.length) log.scrollTop = log.scrollHeight;
  } catch (e) { const s = $('#cState'); if (s) s.textContent = e.message; }
}

// Real keeps selection/raycast geometry intact; generated content owns coverage.
let realScene = null, realCoverage = false;
function updateRealVisibility() {
  if (realScene) realScene.visible = realLook && realCoverage;
  roomGroup.visible = itemGroup.visible = !(realLook && realCoverage);
}
function setRealLook(on) {
  realLook = !!on;
  updateRealVisibility();
  window.GR?.real?.setEnabled(realLook);
  toast(realLook ? 'Camera · tap the shutter to take a photo' : 'Procedural room');
}
// ───────── boot ─────────
async function loadPlants() {
  const [plants, models] = await Promise.all([fetch('plants.json').then((r) => r.json()), fetch('plant_models.json').then((r) => r.json()).catch(() => ({}))]);
  return plants.map((p) => ({ ...p, ...(models[p.id] || {}) }));
}
function migratePlan(saved) {
  if (!saved?.room || saved.room.v !== 2) return saved;
  const D = Math.max(...saved.room.poly.map((p) => p[1]));
  return { ...saved, room: { ...saved.room, v: 3, poly: saved.room.poly.map(([x,z]) => [D-z,x]), edgeNames: [...DEFAULT_ROOM.edgeNames], window: { ...saved.room.window, facing: 'north' } },
    items: saved.items.map((it) => ({ ...it, x: D-it.z, z: it.x, rot: ((it.rot || 0)+1)%4 })) };
}
async function boot() {
  resize(); drawDock();
  const plants = await loadPlants(); PLANT_META = Object.fromEntries(plants.map((p) => [p.id, p]));
  await Promise.all(plants.map((p) => new Promise((res) => texLoader.load(p.src, (t) => { t.colorSpace = THREE.SRGBColorSpace; PLANT_TEX[p.src] = t; res(); }, undefined, res))));
  let saved = null; try { saved = await api('/api/state'); } catch (e) { toast(e.message, 5000); }
  if (!saved || !saved.items) { try { saved = JSON.parse(localStorage.getItem('gr_state')); } catch (e) {} }
  saved = migratePlan(saved);
  if (saved && saved.items && saved.items.length && saved.room && saved.room.v === DEFAULT_ROOM.v) state = { room: saved.room, items: saved.items.map((i) => (i.kind === 'plant' ? { ...i, family: i.family || PLANT_META[i.id]?.family, pot: i.pot || PLANT_META[i.id]?.pot } : i)), fridgeOpen: false };
  else { state.items = defaultItems(plants); normWin(state.room); state.items = (await optimizeAsync(state.items, state.room, { seed: 7, winWeight })).items.map(strip); save(); }
  buildRoom(); setMode('explore'); syncMeshes(true); rescore(); frame();
  const GR = window.GR = {
    THREE, scene, camera, renderer, controls, canvas, ICON, api, toast, esc, KEY, IN, CM, FT,
    get state() { return state; }, get mode() { return mode; }, get view() { return view; }, get selected() { return selected; }, get lastEval() { return lastEval; },
    meshOf: (id) => meshes.get(id), itemById: (id) => state.items.find((i) => i.id === id), plantMeta: (id) => PLANT_META[id],
    footprint, baseY: (it) => baseY(it, state.items), lightAt: (x, z, y) => lightAt(x, z, state.items, y), centroid: () => centroid(state.room), bounds: () => bounds(state.room),
    // Layout APIs for voice/Hermes. suggest() fills the same list the Suggest panel shows.
    async suggest(count = 3, opts = {}) {
      if (suggestBusy) throw new Error('Already generating suggestions');
      suggestBusy = true; drawSuggestions();
      try {
        const source = state.items.map(strip), fresh = [];
        for (let i = 0; i < Math.max(1, Math.min(5, count)); i++) { fresh.push(await optimizeAsync(source, state.room, { seed: Math.floor(Math.random() * 1e6), moveFurniture: !!opts.moveFurniture, winWeight })); fresh.sort((a, b) => b.score - a.score); suggestions = fresh.slice(); persistSuggestions(); drawSuggestions(); }
      } finally { suggestBusy = false; drawSuggestions(); }
      return GR.suggestions();
    },
    suggestions: () => suggestions.map((x, i) => ({ index: i, score: Math.round(x.score), light: Math.round(x.lightSat * 100), issues: x.warns.filter((w) => !w.startsWith('(soft)')) })),
    applySuggestion(i) { const pr = suggestions[i]; if (!pr) throw new Error('No suggestion ' + i); if (pr.warns.some((w) => !w.startsWith('(soft)'))) throw new Error('That suggestion has unresolved issues'); applyPlan(pr.items, 'Applied suggestion ' + (i + 1)); return { score: Math.round(lastEval.score) }; },
    async listLayouts() { let list = []; try { list = await api('/api/layouts'); } catch { list = JSON.parse(localStorage.getItem('gr_layouts') || '[]'); } return list; },
    async loadLayout(name) { const list = await GR.listLayouts(); const l = list.find((x) => x.name === name) || list.find((x) => String(x.name).toLowerCase().includes(String(name).toLowerCase())); if (!l) throw new Error('No saved layout named ' + name); const plan = migratePlan(l); if (plan.room) { state.room = plan.room; buildRoom(); } applyPlan(plan.items, 'Loaded ' + l.name); return { name: l.name, score: Math.round(lastEval.score) }; },
    async saveLayout(name, proposal = null) {
      const list = await GR.listLayouts(), items = proposal?.items || stripState().items, room = proposal?.room || state.room;
      const entry = { name: name || new Date().toLocaleString(), score: proposal ? evaluate(items.map((i)=>({...i})), room, {winWeight}).score : lastEval?.score, room, items: items.map(strip), ts: Date.now() };
      list.unshift(entry); if (proposal?.scanId) entry.scanId = proposal.scanId;
      if (!proposal) localStorage.setItem('gr_layouts', JSON.stringify(list));
      try {
        const response = await api('/api/layouts', { method: 'PUT', body: JSON.stringify(list) });
        if (response.error) throw new Error(response.error);
        if (proposal) {
          const saved = await api('/api/layouts');
          if (!Array.isArray(saved) || !saved.some((l)=>l.ts===entry.ts && l.name===entry.name && JSON.stringify(l.items)===JSON.stringify(entry.items))) throw new Error('Saved layout could not be verified');
          localStorage.setItem('gr_layouts', JSON.stringify(saved));
        }
      } catch (e) { if (proposal) throw e; }
      return { saved: entry.name };
    },
    applyPlan(items, message = 'Applied layout') { applyPlan(items, message); return { score: Math.round(lastEval.score) }; },
    miniMap,
    checkPlan(items) { const before = new Set(evaluate(state.items.map((i)=>({...i})), state.room, {winWeight}).warns); return evaluate(items.map((i)=>({...i})), state.room, {winWeight}).warns.filter((w)=>!w.startsWith('(soft)') && !before.has(w)); },
    setMode, setView, select(id) { selected = id; drawSelection(); if (id) openItem(id); }, openItem, openSheet, closeSheet, openPanel: (k) => { stopPolls(); PANELS[k] && PANELS[k](); },
    moveItem(id, x, z) { const it = GR.itemById(id); if (!it) return false; it.x = x; it.z = z; rescore(); save(); return true; },
    setProps(id, props) { const it = GR.itemById(id); if (!it) return false; Object.assign(it, props); if (it.kind === 'plant') { if ('potD' in props && !it.box) it.w = it.d = it.potD; it.h = it.potH + it.height; } const g = meshes.get(id); if (g) { itemGroup.remove(g); meshes.delete(id); } rescore(); save(); return true; },
    setLocked(id, v) { return GR.setProps(id, { locked: !!v }); },
    rotate(id) { const it = GR.itemById(id); if (!it) return false; it.rot = (it.rot + 1) % 4; rescore(); save(); return true; },
    setFridge(open) { state.fridgeOpen = !!open; $('#bFridge').setAttribute('aria-pressed', state.fridgeOpen); syncMeshes(); },
    setLight(on) { showLight = !!on; $('#bLight').setAttribute('aria-pressed', showLight); heatMesh.visible = showLight; drawHeat(); syncMeshes(); },
    suggestApply(opts = {}) { const r = optimize(state.items, state.room, { seed: Math.floor(Math.random() * 1e6), winWeight, ...opts }); if(!r.overlaps && !r.spacingViolations && !r.warns.some((w)=>!w.startsWith('(soft)'))) { state.items = r.items.map(strip); rescore(); save(); } return r; },
    saveState: save, rescore, rebuildItem(id) { const g = meshes.get(id); if (g) { itemGroup.remove(g); meshes.delete(id); } syncMeshes(); },
    addHubItem,
    addDock(d) { if (HUB_KEYS.has(d.key)) return addHubItem(d); const old = EXTRA_DOCK.findIndex((x) => x.key === d.key); if(old >= 0) EXTRA_DOCK.splice(old, 1); EXTRA_DOCK.push({ modes: ['explore', 'edit'], ...d }); PANELS[d.key] = d.open; drawDock(); },
    setRealLook, get realLook() { return realLook; },
    setRealScene(object) { if(realScene) scene.remove(realScene); realScene=object; if(object) scene.add(object); realCoverage=false; updateRealVisibility(); },
    setRealCoverage(covered) { realCoverage=!!covered; updateRealVisibility(); },
    proceduralRoots: [roomGroup, itemGroup],
    withProceduralRender(fn) {
      const extras=scene.children.filter(o=>o!==roomGroup&&o!==itemGroup&&!o.isLight&&o!==sun.target);
      const objects=[...new Set([roomGroup,itemGroup,...extras,heatMesh].filter(Boolean))], saved=objects.map(o=>o.visible);
      try { extras.forEach(o=>o.visible=false);roomGroup.visible=itemGroup.visible=true;if(heatMesh)heatMesh.visible=false;cutaway();nearHide();orientBillboards();return fn(); }
      finally { objects.forEach((o,i)=>o.visible=saved[i]); }
    },
    addPanel(key, fn) { PANELS[key] = fn; }, addItemAction(a) { ITEM_ACTIONS.push(a); }, onFrame(fn) { FRAME_HOOKS.push(fn); },
    project(x, z, y = 0.15) { const v = new THREE.Vector3(x, y, z).project(camera); const r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; },
  };
  for (const m of ['real', 'zen', 'history', 'ar', 'voice', 'almanac', 'replay', 'scan_live']) import(`./modules/${m}.js`).then((mod) => mod.init && mod.init(GR)).catch((e) => { if (!String(e).includes('Failed to fetch')) console.warn('module', m, e); });
  window.__garden = { get state() { return state; }, evaluate, optimize, optimizeAsync, migratePlan, miniMap, potGap, breathingRoom, clearanceZones, rescore, setMode, setView, get mode() { return mode; },
    project(x, z, y = 0.15) { const v = new THREE.Vector3(x, y, z).project(camera); const r = canvas.getBoundingClientRect(); return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height }; } };
}
boot().catch((e) => { console.error(e); toast('Boot failed: ' + e.message, 8000); });
