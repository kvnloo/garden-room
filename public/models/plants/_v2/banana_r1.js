import * as THREE from 'three';

// banana — dwarf banana (Musa, ~1.4 m): a short pseudostem of overlapping leaf
// sheaths that transition into channelled petioles, crowned by 6-8 broad
// irregular paddle blades. Youngest leaf is a rolled upright spear; mature
// blades arch and droop with transverse tears that hang as strips. Bright
// yellow-green with a pale midrib and yellow-brown edge wear on older leaves.
//
// Anatomy note: the banana "stem" is a pseudostem of tightly packed leaf
// sheaths (herbaceous), NOT woody branching — so makeBranching (EZ-Tree) is
// deliberately not used here. Architecture is instead built as layered sheath
// segments + per-leaf petiole/blade coupons. This is the recorded exception.

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Leaf blade ribbon. Unit length; local +Y up, +Z outward. Spine is a curve in
// the YZ plane (a0 nearly vertical -> a1 drooping). The blade spans X (width)
// and offsets along the "ridge" direction (ry,rz) perpendicular to the spine.
// Cross-section is an asymmetric shallow fold (one half lifts, the other
// hangs), a pale midrib ridge, a cup, and a twist that rotates the blade out
// of a single plane. Margins are wavy and notched; optional transverse tears
// cut the blade from a margin toward the midrib and let the distal band hang.
// ---------------------------------------------------------------------------
function buildLeafGeometry({
  a0 = 0.2, a1 = 1.4,
  wmax = 0.2, asym = 0.12,
  petioleT = 0.14, petioleW = 0.022, channel = 0.014,
  rib = 0.012, cup = 0.03, foldUp = 0.0, foldDown = 0.0,
  twist = 0.3, waviness = 0.02, notch = 0.0, wear = 0.0,
  tears = [], segments = 20, widthPts = 9,
} = {}) {
  const stations = segments + 1;
  const center = new Float32Array(stations * 3);
  const tangent = new Float32Array(stations * 3);
  const step = 1 / segments;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = a0 + (a1 - a0) * t;
    const am = i === 0 ? a0 : (a0 + (a1 - a0) * (t - step * 0.5));
    tangent[i * 3 + 1] = Math.cos(a);
    tangent[i * 3 + 2] = Math.sin(a);
    if (i === 0) { center[i * 3 + 1] = 0; center[i * 3 + 2] = 0; }
    else {
      center[i * 3 + 1] = center[(i - 1) * 3 + 1] + Math.cos(am) * step;
      center[i * 3 + 2] = center[(i - 1) * 3 + 2] + Math.sin(am) * step;
    }
  }

  const vertCount = stations * widthPts;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);

  const bladeCol = new THREE.Color().setHSL(0.205, 0.52, 0.50);
  const midribCol = new THREE.Color().setHSL(0.13, 0.24, 0.86);
  const edgeCol = new THREE.Color().setHSL(0.195, 0.46, 0.45);
  const wornCol = new THREE.Color().setHSL(0.095, 0.42, 0.46);
  const petioleCol = new THREE.Color().setHSL(0.185, 0.44, 0.46);
  const tmp = new THREE.Color();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const cy = center[i * 3 + 1];
    const cz = center[i * 3 + 2];
    const ty = tangent[i * 3 + 1];
    const tz = tangent[i * 3 + 2];
    const ry = tz;
    const rz = -ty;

    const blade = smoothstep(petioleT, petioleT + 0.07, t);
    const xp = Math.min(1, Math.max(0, (t - petioleT) / (1 - petioleT)));
    // Broad paddle widest ~2/3 toward the tip, rounded (not pointed) end.
    let paddle = 0;
    if (xp > 0) {
      paddle = xp <= 0.65
        ? Math.pow(Math.sin(Math.PI * 0.5 * xp / 0.65), 0.8)
        : Math.pow((1 - xp) / 0.35, 0.6);
      paddle = Math.max(0.04, paddle);
    }
    const twistA = twist * blade * smoothstep(0.15, 1, xp);
    const cosT = Math.cos(twistA);
    const sinT = Math.sin(twistA);

    for (let j = 0; j < widthPts; j++) {
      const u = -1 + (2 * j) / (widthPts - 1);
      const au = Math.abs(u);
      const side = u >= 0 ? 1 : -1;

      let hw = (petioleW + (wmax - petioleW) * blade * paddle) * (1 + asym * side * blade);
      const wave = waviness * blade * (Math.sin(t * 8.5 + 0.4) + 0.5 * Math.sin(t * 16.7 + 2.3)) * au;
      let notchTerm = 0;
      if (notch > 0) {
        const n1 = Math.exp(-Math.pow((t - 0.78) / 0.05, 2)) * Math.exp(-Math.pow((au - 1) / 0.22, 2));
        const n2 = Math.exp(-Math.pow((t - 0.52) / 0.045, 2)) * Math.exp(-Math.pow((au - 1) / 0.16, 2)) * 0.65;
        notchTerm = notch * (n1 + n2);
      }
      hw = Math.max(0.0025, hw - notchTerm + wave);
      const xx = hw * u;

      let zoff = rib * (1 - au) * blade - cup * au * au * blade;
      if (u >= 0) zoff += foldUp * u * blade;
      else zoff += foldDown * u * blade;
      // Petiole region: U-channel cross-section (edges curl up, centre grooved).
      zoff += -channel * (1 - au * au) * (1 - blade);

      const xf = xx * cosT - zoff * sinT;
      const nf = xx * sinT + zoff * cosT;

      const vIdx = (i * widthPts + j) * 3;
      positions[vIdx] = xf;
      positions[vIdx + 1] = cy + ry * nf;
      positions[vIdx + 2] = cz + rz * nf;

      const pale = blade * Math.exp(-au * 3.2);
      tmp.copy(bladeCol).lerp(midribCol, Math.min(1, pale * 0.85));
      if (blade < 0.5) tmp.copy(petioleCol);
      tmp.lerp(edgeCol, blade * smoothstep(0.45, 0.97, au) * 0.55);
      tmp.lerp(wornCol, blade * smoothstep(0.7, 0.99, au) * wear);
      colors[vIdx] = tmp.r;
      colors[vIdx + 1] = tmp.g;
      colors[vIdx + 2] = tmp.b;
    }
  }

  // Transverse tears: hang the distal band on the torn side.
  for (let ti = 0; ti < tears.length; ti++) {
    const tear = tears[ti];
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      if (t <= tear.t) continue;
      const prog = (t - tear.t) / (1 - tear.t);
      for (let j = 0; j < widthPts; j++) {
        const u = -1 + (2 * j) / (widthPts - 1);
        if (u * tear.side < tear.innerU) continue;
        const across = (Math.abs(u) - tear.innerU) / (1 - tear.innerU);
        const d = tear.droop * prog * across;
        const vIdx = (i * widthPts + j) * 3;
        positions[vIdx + 1] -= d;
        positions[vIdx] += tear.side * d * 0.35;
      }
    }
  }

  const indices = [];
  for (let i = 0; i < segments; i++) {
    const t0 = i / segments;
    const t1 = (i + 1) / segments;
    for (let j = 0; j < widthPts - 1; j++) {
      const u0 = -1 + (2 * j) / (widthPts - 1);
      const u1 = -1 + (2 * (j + 1)) / (widthPts - 1);
      let cut = false;
      for (let ti = 0; ti < tears.length && !cut; ti++) {
        const tear = tears[ti];
        if (tear.t > t0 && tear.t <= t1) {
          if (tear.side > 0 && u0 >= tear.innerU) cut = true;
          else if (tear.side < 0 && u1 <= -tear.innerU) cut = true;
        }
      }
      if (cut) continue;
      const a = i * widthPts + j;
      const b = a + 1;
      const c = (i + 1) * widthPts + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Rolled upright spear (youngest leaf): a curved tapered cigar with a faint
// spiral seam, closed at the pointed tip. Not a flat spike.
// ---------------------------------------------------------------------------
function buildSpearGeometry({ baseR = 0.02, a0 = 0.05, a1 = 0.10, radial = 8, seg = 8, spiral = 1.7 } = {}) {
  const stations = seg + 1;
  const center = new Float32Array(stations * 3);
  const tangent = new Float32Array(stations * 3);
  const step = 1 / seg;
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = a0 + (a1 - a0) * t;
    const am = i === 0 ? a0 : (a0 + (a1 - a0) * (t - step * 0.5));
    tangent[i * 3 + 1] = Math.cos(a);
    tangent[i * 3 + 2] = Math.sin(a);
    if (i === 0) { center[i * 3 + 1] = 0; center[i * 3 + 2] = 0; }
    else {
      center[i * 3 + 1] = center[(i - 1) * 3 + 1] + Math.cos(am) * step;
      center[i * 3 + 2] = center[(i - 1) * 3 + 2] + Math.sin(am) * step;
    }
  }

  const vertCount = stations * radial + 1;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const baseCol = new THREE.Color().setHSL(0.20, 0.52, 0.60);
  const tipCol = new THREE.Color().setHSL(0.18, 0.50, 0.55);
  const c = new THREE.Color();

  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const a = a0 + (a1 - a0) * t;
    const BY = Math.sin(a);
    const BZ = -Math.cos(a);
    const r = baseR * Math.pow(1 - t, 0.9) * (i === seg ? 0 : 1);
    for (let j = 0; j < radial; j++) {
      const phi = (j / radial) * Math.PI * 2;
      const rr = r * (1 + 0.14 * Math.sin(phi + t * spiral));
      const vIdx = (i * radial + j) * 3;
      positions[vIdx] = rr * Math.cos(phi);
      positions[vIdx + 1] = center[i * 3 + 1] + BY * rr * Math.sin(phi);
      positions[vIdx + 2] = center[i * 3 + 2] + BZ * rr * Math.sin(phi);
      c.copy(baseCol).lerp(tipCol, t * 0.4);
      colors[vIdx] = c.r;
      colors[vIdx + 1] = c.g;
      colors[vIdx + 2] = c.b;
    }
  }
  const tipIdx = stations * radial;
  positions[tipIdx * 3] = center[seg * 3];
  positions[tipIdx * 3 + 1] = center[seg * 3 + 1];
  positions[tipIdx * 3 + 2] = center[seg * 3 + 2];
  colors[tipIdx * 3] = tipCol.r;
  colors[tipIdx * 3 + 1] = tipCol.g;
  colors[tipIdx * 3 + 2] = tipCol.b;

  const indices = [];
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < radial; j++) {
      const j2 = (j + 1) % radial;
      const a = i * radial + j;
      const b = i * radial + j2;
      const c = (i + 1) * radial + j;
      const d = (i + 1) * radial + j2;
      indices.push(a, c, b, b, c, d);
    }
  }
  const lastRing = seg * radial;
  for (let j = 0; j < radial; j++) {
    const j2 = (j + 1) % radial;
    indices.push(lastRing + j, tipIdx, lastRing + j2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Pseudostem sheath: a flared truncated cone with an irregular top rim and a
// shallow inward funnel (sheath mouth). Vertex colors carry longitudinal
// streaks; instance colors add the tan base -> green top aging gradient.
// ---------------------------------------------------------------------------
function buildSheathGeometry() {
  const radial = 12;
  const jag = new Float32Array(radial);
  for (let k = 0; k < radial; k++) jag[k] = 1 + 0.06 * Math.sin(k * 2.7) + 0.04 * Math.sin(k * 5.3 + 1.9);

  const vertCount = radial * 3;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const colBase = new THREE.Color().setHSL(0.22, 0.34, 0.42);
  const colDry = new THREE.Color().setHSL(0.09, 0.32, 0.40);
  const tmp = new THREE.Color();

  for (let k = 0; k < radial; k++) {
    const ang = (k / radial) * Math.PI * 2;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const i0 = k * 3;
    // bottom ring
    positions[i0] = c; positions[i0 + 1] = 0; positions[i0 + 2] = s;
    // top outer ring (irregular rim)
    positions[i0 + 3] = 0.8 * c * jag[k]; positions[i0 + 4] = jag[k]; positions[i0 + 5] = 0.8 * s * jag[k];
    // top inner funnel ring
    positions[i0 + 6] = 0.34 * c; positions[i0 + 7] = 0.84; positions[i0 + 8] = 0.34 * s;

    const streak = 0.5 + 0.5 * Math.sin(k * 1.9 + 0.5);
    tmp.copy(colBase).lerp(colDry, 0.25 * streak);
    colors[i0] = tmp.r; colors[i0 + 1] = tmp.g; colors[i0 + 2] = tmp.b;
    tmp.copy(colBase).lerp(colDry, 0.15 + 0.15 * streak);
    colors[i0 + 3] = tmp.r; colors[i0 + 4] = tmp.g; colors[i0 + 5] = tmp.b;
    colors[i0 + 6] = colors[i0 + 3]; colors[i0 + 7] = colors[i0 + 4]; colors[i0 + 8] = colors[i0 + 5];
  }

  const indices = [];
  for (let k = 0; k < radial; k++) {
    const k2 = (k + 1) % radial;
    const b0 = k * 3;
    const b1 = k2 * 3;
    indices.push(b0, b0 + 1, b1, b1, b0 + 1, b1 + 1);
    indices.push(b0 + 1, b0 + 2, b1 + 1, b1 + 1, b0 + 2, b1 + 2);
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Leaf placement. Returned as a list of {geom, az, attachFrac, baseR, len,
// tiltX, tiltZ, h, s, l}. Mature canopy is an uneven fan: rolled spear and
// half-unfurled leaf clustered at the top centre, young paddles above, broad
// arching blades to the sides, and one long torn blade drooping low.
// ---------------------------------------------------------------------------
function leafSpecs(stage, height, stemH, stemBaseR, rand) {
  const specs = [];
  const jit = () => (rand() - 0.5);

  if (stage < 0.25) {
    // Juvenile: short pseudostem, two developing paddles + one emerging roll.
    specs.push({ geom: 'spear', az: 0, attachFrac: 0.95, baseR: 0.006, len: height * 0.50, tiltX: 0.03 + jit() * 0.05, tiltZ: jit() * 0.05, h: 0.20, s: 0.50, l: 0.60 });
    specs.push({ geom: 'inner', az: 0.95, attachFrac: 0.60, baseR: stemBaseR * 0.5, len: height * 0.42, tiltX: 0.06 + jit() * 0.06, tiltZ: jit() * 0.06, h: 0.205, s: 0.50, l: 0.56 });
    specs.push({ geom: 'inner', az: -0.85, attachFrac: 0.66, baseR: stemBaseR * 0.5, len: height * 0.46, tiltX: 0.06 + jit() * 0.06, tiltZ: jit() * 0.06, h: 0.205, s: 0.50, l: 0.54 });
  } else if (stage < 0.45) {
    // Intermediate: spear + unfurling + two paddles + one outer blade.
    specs.push({ geom: 'spear', az: 0, attachFrac: 0.96, baseR: 0.006, len: height * 0.50, tiltX: 0.02 + jit() * 0.04, tiltZ: jit() * 0.04, h: 0.20, s: 0.51, l: 0.60 });
    specs.push({ geom: 'unfurl', az: 0.30, attachFrac: 0.90, baseR: stemBaseR * 0.45, len: height * 0.56, tiltX: 0.05 + jit() * 0.05, tiltZ: jit() * 0.05, h: 0.205, s: 0.50, l: 0.56 });
    specs.push({ geom: 'inner', az: 0.88, attachFrac: 0.82, baseR: stemBaseR * 0.5, len: height * 0.64, tiltX: 0.08 + jit() * 0.06, tiltZ: jit() * 0.06, h: 0.205, s: 0.50, l: 0.54 });
    specs.push({ geom: 'inner', az: -0.72, attachFrac: 0.84, baseR: stemBaseR * 0.5, len: height * 0.60, tiltX: 0.08 + jit() * 0.06, tiltZ: jit() * 0.06, h: 0.205, s: 0.50, l: 0.52 });
    specs.push({ geom: 'outer', az: 1.6, attachFrac: 0.62, baseR: stemBaseR * 0.5, len: height * 0.72, tiltX: 0.10 + jit() * 0.05, tiltZ: jit() * 0.05, h: 0.21, s: 0.49, l: 0.48 });
  } else {
    // Adult: 7 leaves.
    specs.push({ geom: 'spear', az: 0, attachFrac: 0.98, baseR: 0.006, len: height * 0.50, tiltX: 0.02 + jit() * 0.04, tiltZ: jit() * 0.04, h: 0.20, s: 0.51, l: 0.60 });
    specs.push({ geom: 'unfurl', az: 0.28, attachFrac: 0.92, baseR: stemBaseR * 0.45, len: height * 0.56, tiltX: 0.06 + jit() * 0.05, tiltZ: jit() * 0.05, h: 0.205, s: 0.50, l: 0.56 });
    specs.push({ geom: 'inner', az: 0.85, attachFrac: 0.84, baseR: stemBaseR * 0.5, len: height * 0.66, tiltX: 0.08 + jit() * 0.06, tiltZ: jit() * 0.06, h: 0.205, s: 0.50, l: 0.53 });
    specs.push({ geom: 'inner', az: -0.70, attachFrac: 0.86, baseR: stemBaseR * 0.5, len: height * 0.62, tiltX: 0.08 + jit() * 0.06, tiltZ: jit() * 0.06, h: 0.205, s: 0.50, l: 0.51 });
    specs.push({ geom: 'outer', az: 1.6, attachFrac: 0.62, baseR: stemBaseR * 0.5, len: height * 0.72, tiltX: 0.10 + jit() * 0.05, tiltZ: jit() * 0.05, h: 0.21, s: 0.49, l: 0.48 });
    specs.push({ geom: 'outer', az: -1.35, attachFrac: 0.58, baseR: stemBaseR * 0.5, len: height * 0.68, tiltX: 0.10 + jit() * 0.05, tiltZ: jit() * 0.05, h: 0.21, s: 0.49, l: 0.46 });
    specs.push({ geom: 'droopy', az: 2.5, attachFrac: 0.42, baseR: stemBaseR * 0.5, len: height * 0.80, tiltX: 0.12 + jit() * 0.04, tiltZ: jit() * 0.04, h: 0.215, s: 0.47, l: 0.42 });
  }
  return specs;
}

export function createPlant({
  height = 0.8,
  spread = 0.5,
  potDiameter = 0.3,
  seed = 1,
  width,
  depth,
} = {}) {
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  const adultHeight = 1.4;
  const stage = height / adultHeight;

  const stemH = height * 0.40;
  const stemBaseR = height * 0.032;

  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.55,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.78,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const dummy = new THREE.Object3D();
  const tmp = new THREE.Color();

  // ---- pseudostem (overlapping sheaths, tan base -> green top) ----
  const sheathGeom = buildSheathGeometry();
  const nSheaths = stage < 0.3 ? 3 : 5;
  const sheaths = new THREE.InstancedMesh(sheathGeom, stemMat, nSheaths);
  sheaths.name = 'pseudostem';
  const tanCol = new THREE.Color().setHSL(0.09, 0.30, 0.42);
  const greenCol = new THREE.Color().setHSL(0.22, 0.30, 0.40);
  for (let k = 0; k < nSheaths; k++) {
    const r = stemBaseR * (1 - 0.13 * k);
    const h = stemH * 0.40;
    const y = k * stemH * 0.155;
    dummy.position.set(0, y, 0);
    dummy.rotation.set(0, (k * 2.399) % (Math.PI * 2), 0);
    dummy.scale.set(r, h, r);
    dummy.updateMatrix();
    sheaths.setMatrixAt(k, dummy.matrix);
    tmp.copy(tanCol).lerp(greenCol, k / Math.max(1, nSheaths - 1));
    sheaths.setColorAt(k, tmp);
  }
  sheaths.instanceMatrix.needsUpdate = true;
  if (sheaths.instanceColor) sheaths.instanceColor.needsUpdate = true;
  group.add(sheaths);

  // ---- leaf coupons (built once; instanced per placement) ----
  const geoms = {
    spear: buildSpearGeometry({ baseR: 0.028, a0: 0.05, a1: 0.10, radial: 8, seg: 8, spiral: 1.7 }),
    unfurl: buildLeafGeometry({ a0: 0.14, a1: 0.70, wmax: 0.17, asym: 0.18, petioleT: 0.14, petioleW: 0.022, channel: 0.014, rib: 0.012, cup: 0.026, foldUp: 0.10, foldDown: 0.015, twist: 0.5, waviness: 0.02, notch: 0, wear: 0, segments: 20, widthPts: 9 }),
    inner: buildLeafGeometry({ a0: 0.18, a1: 1.00, wmax: 0.18, asym: 0.14, petioleT: 0.14, petioleW: 0.022, channel: 0.014, rib: 0.011, cup: 0.030, foldUp: 0.02, foldDown: 0.03, twist: 0.35, waviness: 0.022, notch: 0, wear: 0, segments: 20, widthPts: 9 }),
    outer: buildLeafGeometry({ a0: 0.24, a1: 1.45, wmax: 0.20, asym: 0.16, petioleT: 0.13, petioleW: 0.022, channel: 0.014, rib: 0.012, cup: 0.034, foldUp: 0.03, foldDown: 0.05, twist: 0.5, waviness: 0.026, notch: 0.018, wear: 0.25, tears: [{ t: 0.55, side: 1, innerU: 0.35, droop: 0.10 }], segments: 20, widthPts: 9 }),
    droopy: buildLeafGeometry({ a0: 0.34, a1: 1.95, wmax: 0.19, asym: 0.18, petioleT: 0.13, petioleW: 0.022, channel: 0.014, rib: 0.012, cup: 0.036, foldUp: 0.04, foldDown: 0.07, twist: 0.65, waviness: 0.030, notch: 0.030, wear: 0.8, tears: [{ t: 0.55, side: 1, innerU: 0.30, droop: 0.13 }, { t: 0.75, side: -1, innerU: 0.30, droop: 0.12 }], segments: 20, widthPts: 9 }),
  };

  const specs = leafSpecs(stage, height, stemH, stemBaseR, rand);
  const byGeom = new Map();
  for (const sp of specs) {
    if (!byGeom.has(sp.geom)) byGeom.set(sp.geom, []);
    byGeom.get(sp.geom).push(sp);
  }

  let leafCount = 0;
  for (const [name, list] of byGeom) {
    const mesh = new THREE.InstancedMesh(geoms[name], leafMat, list.length);
    mesh.name = 'leaves-' + name;
    for (let i = 0; i < list.length; i++) {
      const sp = list[i];
      const attachY = stemH * sp.attachFrac;
      dummy.position.set(Math.cos(sp.az) * sp.baseR, attachY, Math.sin(sp.az) * sp.baseR);
      dummy.rotation.set(sp.tiltX, sp.az, sp.tiltZ);
      dummy.scale.setScalar(sp.len);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      tmp.setHSL(sp.h, sp.s, sp.l + (rand() - 0.5) * 0.04);
      mesh.setColorAt(i, tmp);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    leafCount += list.length;
  }

  group.userData = {
    family: 'banana',
    adultHeight,
    stage,
    leafCount,
    sheaths: nSheaths,
  };
  return group;
}
