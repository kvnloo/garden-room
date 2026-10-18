// Procedural pots for garden_room. createPot({style, diameter, height, width?, depth?, seed}) ->
// { group, soilY }. Origin = floor centre, +Y up, metres. Shared geometry is cheap; textures are tiny canvases.
import * as THREE from 'three';

const texCache = new Map();
function canvasTex(key, draw, w = 128, h = 64) {
  if (texCache.has(key)) return texCache.get(key);
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
  texCache.set(key, t); return t;
}
const wicker = (base) => canvasTex('wicker' + base, (g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 16) {
    const o = (y / 8) % 2 ? 8 : 0;
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x + o, y + 1, 12, 5);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(x + o + 12, y, 4, 8); g.fillRect(x + o, y + 6, 12, 2);
  }
});
const mosaic = (palette) => canvasTex('mosaic' + palette.join(), (g, w, h) => {
  g.fillStyle = '#efe9dc'; g.fillRect(0, 0, w, h);
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 6) {
    g.fillStyle = palette[Math.floor(rnd() * palette.length)]; g.fillRect(x + 0.6, y + 0.6, 4.8, 4.8);
  }
  g.strokeStyle = '#7b2a2a'; g.lineWidth = 3;
  for (let i = 0; i < 4; i++) { g.beginPath(); g.arc(16 + i * 32, h / 2, 11, 0, 7); g.stroke(); }
}, 128, 64);

const STYLES = {
  dark_plastic: { color: 0x26292b, rough: 0.7, flare: 1.22, rim: 0.035 },
  grey_plastic: { color: 0x7d7f7c, rough: 0.75, flare: 1.18, rim: 0.03 },
  white_scalloped: { color: 0xf1efe8, rough: 0.5, flare: 1.15, rim: 0.02, scallop: true },
  terracotta_brown: { color: 0x6b3a22, rough: 0.85, flare: 1.25, rim: 0.04 },
  wicker_grey: { map: () => wicker('#9c958a'), rough: 0.95, flare: 1.3, rim: 0.03 },
  wicker_taupe: { map: () => wicker('#9a8670'), rough: 0.95, flare: 1.3, rim: 0.03 },
  wicker_dark: { map: () => wicker('#3a3632'), rough: 0.95, flare: 1.25, rim: 0.03 },
  mosaic_ceramic: { map: () => mosaic(['#c8b88f', '#8e3b2e', '#d8cdb3', '#4f6b4a', '#b7a06a']), rough: 0.35, flare: 1.0, bulge: 0.18, rim: 0.03 },
  blue_ceramic: { map: () => mosaic(['#2f5f8f', '#e9e4d8', '#c99b52', '#3d7a7a', '#8a3434']), rough: 0.35, flare: 1.0, bulge: 0.2, rim: 0.03 },
  barrel_dark: { color: 0x2d2a27, rough: 0.8, flare: 1.08, bulge: 0.1, rim: 0.03, hoops: true },
  painted_ceramic: { map: () => mosaic(['#e8dcc2', '#a8432f', '#2f6d8a', '#d9b44a']), rough: 0.35, flare: 1.0, bulge: 0.15, rim: 0.02 },
};

function profile(r, h, st) { // lathe points from base to rim
  const pts = [], n = 10, rb = r / st.flare;
  pts.push(new THREE.Vector2(0, 0));
  for (let i = 0; i <= n; i++) { const t = i / n; const b = st.bulge ? Math.sin(t * Math.PI) * st.bulge * r : 0; pts.push(new THREE.Vector2(rb + (r - rb) * t + b, t * h)); }
  pts.push(new THREE.Vector2(r + st.rim * 0.6, h)); pts.push(new THREE.Vector2(r + st.rim * 0.6, h + st.rim * 0.5)); pts.push(new THREE.Vector2(r - 0.012, h + st.rim * 0.5));
  pts.push(new THREE.Vector2(r - 0.014, h * 0.6));
  return pts;
}

export function createPot({ style = 'dark_plastic', diameter = 0.3, height = 0.25, width, depth, seed = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'pot';
  if (style === 'raised_planter_box') return raisedPlanter({ width: width || 0.8, depth: depth || 0.35, height: height || 0.75 });
  if (style === 'seedling_tray') {
    const w = width || diameter, d = depth || diameter;
    const tray = new THREE.Mesh(new THREE.BoxGeometry(w, height, d), new THREE.MeshStandardMaterial({ color: 0x2d5fa8, roughness: 0.6 }));
    tray.position.y = height / 2; group.add(tray);
    const soil = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.01, d * 0.92), new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }));
    soil.position.y = height * 0.92; group.add(soil);
    return { group, soilY: height * 0.95 };
  }
  const st = STYLES[style] || STYLES.dark_plastic, r = diameter / 2;
  const mat = new THREE.MeshStandardMaterial({ color: st.map ? 0xffffff : st.color, map: st.map ? st.map() : null, roughness: st.rough, side: THREE.DoubleSide });
  if (mat.map) { mat.map = mat.map.clone(); mat.map.repeat.set(Math.max(1, Math.round(diameter * 10)), 1); mat.map.needsUpdate = true; }
  const body = new THREE.Mesh(new THREE.LatheGeometry(profile(r, height, st), 40), mat); group.add(body);
  if (st.scallop) for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; const s = new THREE.Mesh(new THREE.SphereGeometry(r * 0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat); s.position.set(Math.cos(a) * r, height, Math.sin(a) * r); s.scale.y = 0.6; group.add(s); }
  if (st.hoops) for (const y of [0.2, 0.8]) { const t = new THREE.Mesh(new THREE.TorusGeometry(r * (1 + (st.bulge || 0) * Math.sin(y * Math.PI)) * (1 / st.flare + (1 - 1 / st.flare) * y) + 0.004, 0.006, 6, 40), new THREE.MeshStandardMaterial({ color: 0x15130f, metalness: 0.5, roughness: 0.5 })); t.rotation.x = Math.PI / 2; t.position.y = y * height; group.add(t); }
  const soil = new THREE.Mesh(new THREE.CircleGeometry(r - 0.016, 28), new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }));
  soil.rotation.x = -Math.PI / 2; soil.position.y = height * 0.9; group.add(soil);
  return { group, soilY: height * 0.9 };
}

function raisedPlanter({ width, depth, height }) {
  const group = new THREE.Group(); const boxH = Math.min(0.32, height * 0.45), legH = height - boxH;
  const mat = new THREE.MeshStandardMaterial({ map: (() => { const t = wicker('#2b2b2e').clone(); t.repeat.set(Math.round(width * 6), 2); t.needsUpdate = true; return t; })(), roughness: 0.95 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(width, boxH, depth), mat); box.position.y = legH + boxH / 2; group.add(box);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.6 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.035, legH, 0.035), legMat); l.position.set(sx * (width / 2 - 0.04), legH / 2, sz * (depth / 2 - 0.04)); group.add(l); }
  const soil = new THREE.Mesh(new THREE.BoxGeometry(width * 0.94, 0.01, depth * 0.88), new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 1 }));
  soil.position.y = height - 0.02; group.add(soil);
  return { group, soilY: height - 0.015 };
}

export const POT_STYLES = [...Object.keys(STYLES), 'raised_planter_box', 'seedling_tray'];
