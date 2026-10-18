import * as THREE from 'three';
import { makeBranching } from '/models/plants/_shared/branching.js';

// Eggplant (Solanum melongena) — v2 round 1. Leggy herbaceous main stem tied to a
// green stake, broad ovate drooping leaves with a shoulder and pointed apex,
// irregular alternate arrangement, a few yellowing blades, and a small cluster of
// glossy purple fruits hanging HIGH on the stem. Connected tapered stem + a few
// short lateral shoots come from the pinned EZ-Tree adapter; leaf coupons, calyx,
// fruit and stake are species-specific. Fruit present because the locked context
// crop shows it (coordinator reading), not invented.

const ADULT_H = 0.75; // family adult height (m) — the ~75 cm specimen

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

// ---------------------------------------------------------------------------
// Leaf coupon: broad ovate, rounded base, shoulder, pointed apex, shallow
// lobes, wavy margin, cupped (down-folded) edges, bowed pale midrib, soft tip
// droop. Built as a 3-column ribbon (left edge / midrib / right edge) so the
// silhouette is a real shape, not a card. Length along +Y (base 0 -> tip 1),
// full width 1.0 along +X, face toward +Z. Vertex colours encode the pale
// midrib + chlorotic mottling; per-instance colour supplies the leaf hue.
// ---------------------------------------------------------------------------
function buildLeafGeometry() {
  const SEG = 18;
  const rows = SEG + 1;
  const vertCount = rows * 3;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  // Half-width profile: rounded base -> broad shoulder -> pointed apex.
  const profile = [0.16, 0.36, 0.60, 0.82, 0.96, 1.0, 0.97, 0.86, 0.70, 0.52, 0.36, 0.22, 0.11, 0.03];
  const WMAX = 0.5;
  const RIB = 0.10;    // bowed midrib (convex upper face)
  const CURL = 0.05;   // cupped edges fold toward -Z
  const WAVE = 0.020;  // wavy margin amplitude (edge Z ripple)

  for (let r = 0; r <= SEG; r++) {
    const t = r / SEG;
    const f = t * (profile.length - 1);
    const i = Math.min(profile.length - 2, Math.floor(f));
    const u = f - i;
    let prof = profile[i] + (profile[i + 1] - profile[i]) * u;
    prof *= 1 + 0.09 * Math.sin(Math.PI * 2.4 * t + 0.7); // ~1.2 shallow lobes/side
    const w = WMAX * prof * (1 + 0.05 * Math.sin(t * Math.PI * 6.0 + 0.4)); // wavy outline
    const arch = Math.sin(Math.PI * t) * RIB;             // midrib bow (+Z)
    const tipDroop = t > 0.6 ? -Math.pow((t - 0.6) / 0.4, 2) * 0.12 : 0;
    const curl = Math.sin(Math.PI * t) * CURL;
    const waveZ = WAVE * Math.sin(t * Math.PI * 3.2 + 1.1);
    const twist = 0.015 * Math.sin(Math.PI * t);          // one edge up, other down

    const i3 = r * 3;
    positions[(i3 + 0) * 3 + 0] = -w; positions[(i3 + 0) * 3 + 1] = t; positions[(i3 + 0) * 3 + 2] = -curl + waveZ + twist + tipDroop;
    positions[(i3 + 1) * 3 + 0] = 0;  positions[(i3 + 1) * 3 + 1] = t; positions[(i3 + 1) * 3 + 2] = arch + tipDroop;
    positions[(i3 + 2) * 3 + 0] = w;  positions[(i3 + 2) * 3 + 1] = t; positions[(i3 + 2) * 3 + 2] = -curl + waveZ - twist + tipDroop;

    // Mottling: patchy low-frequency chlorosis along the blade.
    const mottle = 0.82 + 0.18 * Math.sin(t * 9.5 + 1.2) * Math.sin(t * 4.3 + 2.0);
    const er = 0.72 * mottle, eg = 0.80 * mottle, eb = 0.62 * mottle; // edge green
    colors[(i3 + 0) * 3] = er; colors[(i3 + 0) * 3 + 1] = eg; colors[(i3 + 0) * 3 + 2] = eb;
    colors[(i3 + 1) * 3] = 1.0;  colors[(i3 + 1) * 3 + 1] = 0.99; colors[(i3 + 1) * 3 + 2] = 0.92; // pale midrib
    colors[(i3 + 2) * 3] = er; colors[(i3 + 2) * 3 + 1] = eg; colors[(i3 + 2) * 3 + 2] = eb;

    uvs[(i3 + 0) * 2] = 0;   uvs[(i3 + 0) * 2 + 1] = t;
    uvs[(i3 + 1) * 2] = 0.5; uvs[(i3 + 1) * 2 + 1] = t;
    uvs[(i3 + 2) * 2] = 1;   uvs[(i3 + 2) * 2 + 1] = t;
  }

  const idx = [];
  for (let r = 0; r < SEG; r++) {
    const a = r * 3, b = (r + 1) * 3;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
    idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Fruit body: teardrop lathe (wide blossom end, narrow calyx end). Local origin
// is the calyx attachment; the body extends downward (-Y). Ascending profile,
// then translated so calyx sits at origin.
// ---------------------------------------------------------------------------
function buildFruitGeometry() {
  const P = [
    [0.012, 0.000],   // blossom (bottom)
    [0.021, 0.012],
    [0.0235, 0.034],  // widest
    [0.019, 0.058],
    [0.010, 0.082],
    [0.004, 0.098],   // calyx (top)
  ];
  const pts = P.map(([r, y]) => new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 8);
  g.translate(0, -0.098, 0);
  return g;
}

// ---------------------------------------------------------------------------
// Calyx: green star — central cone + five spreading sepals, merged into one
// indexed-free geometry so a single InstancedMesh can cover all fruits.
// ---------------------------------------------------------------------------
function mergeGeometries(list) {
  const pos = [], nrm = [];
  for (let g of list) {
    g = g.index ? g.toNonIndexed() : g;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) nrm.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  if (nrm.length) geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nrm), 3));
  return geo;
}

function buildCalyxGeometry() {
  const parts = [];
  const center = new THREE.ConeGeometry(0.011, 0.030, 6);
  center.translate(0, 0.008, 0);
  parts.push(center);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.35;
    const sepal = new THREE.ConeGeometry(0.005, 0.024, 4);
    sepal.rotateZ(-Math.PI / 2); // apex -> +X
    sepal.rotateX(-0.45);        // tip folds down over the fruit shoulder
    sepal.rotateY(a);
    sepal.translate(Math.cos(a) * 0.016, 0.006, Math.sin(a) * 0.016);
    parts.push(sepal);
  }
  return mergeGeometries(parts);
}

// Curved pedicel: short drooping stalk from stem node to fruit top.
function buildPedicelGeometry() {
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.012, -0.006, -0.004),
    new THREE.Vector3(0.017, -0.034, -0.010),
  );
  return new THREE.TubeGeometry(curve, 6, 0.0017, 5, false);
}

// Reconstruct the main axis (trunk + terminal continuation chain) as a flat list
// of section frames, walking from the trunk to whichever branch continues from
// its tip. Used for alternate leaf nodes along the herbaceous main stem.
function mainAxis(branches) {
  const axis = [];
  const used = new Set();
  let cur = 0;
  while (true) {
    used.add(cur);
    const b = branches[cur];
    for (let k = 0; k < b.sections.length; k++) axis.push(b.sections[k]);
    const tip = b.sections[b.sections.length - 1].origin;
    let next = -1, best = 1e9;
    for (let i = 0; i < branches.length; i++) {
      if (used.has(i)) continue;
      const d = branches[i].sections[0].origin.distanceToSquared(tip);
      if (d < best) { best = d; next = i; }
    }
    if (next < 0 || best > 1e-6) break;
    cur = next;
  }
  return { axis, used };
}

// Non-main-axis branches that nothing continues from — the lateral shoot tips.
function terminalTips(branches, used) {
  const tips = [];
  for (let i = 0; i < branches.length; i++) {
    if (used.has(i)) continue;
    const b = branches[i];
    const tip = b.sections[b.sections.length - 1].origin;
    let isTerm = true;
    for (let j = 0; j < branches.length; j++) {
      if (j === i) continue;
      if (branches[j].sections[0].origin.distanceToSquared(tip) < 1e-8) { isTerm = false; break; }
    }
    if (isTerm) tips.push(b);
  }
  return tips;
}

export function createPlant({
  height = 0.75,
  spread = 0.5,
  potDiameter = 0.3,
  seed = 1,
  width,
  depth,
} = {}) {
  const rand = mulberry32(seed);
  const group = new THREE.Group();

  const H = height;
  const age = Math.min(1, Math.max(0.06, H / ADULT_H)); // relative age from height
  const mature = age >= 0.5;

  // ---- materials ----
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x5f5a63, roughness: 0.85, metalness: 0.0 });
  const petioleMat = new THREE.MeshStandardMaterial({ color: 0x5f6a45, roughness: 0.85 });
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0x8aa04a, roughness: 0.7 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0xc8a860, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.6, metalness: 0.0, side: THREE.DoubleSide, vertexColors: true,
    emissive: 0x16230f, emissiveIntensity: 0.12,
  });
  const fruitMat = new THREE.MeshStandardMaterial({ color: 0x5a2e72, roughness: 0.25, metalness: 0.1 });
  const calyxMat = new THREE.MeshStandardMaterial({ color: 0x4a5a30, roughness: 0.8 });

  // ---- connected tapered stem + short lateral shoots (pinned EZ-Tree) ----
  const branchCfg = mature
    ? {
        seed, levels: 2,
        lengths: [H * 0.80, H * 0.14, H * 0.10],
        radii: [0.010, 0.45, 0.42],
        children: [2, 1, 0],
        angles: [0, 52, 44, 36],
        starts: [0, 0.34, 0.30, 0.30],
        gnarliness: [0.0015, 0.0025, 0.002, 0.001],
        leafCount: 1,
      }
    : {
        seed, levels: 1,
        lengths: [H * 0.55, H * 0.45],
        radii: [0.0045, 0.5, 0.4],
        children: [0, 0, 0],
        angles: [0, 40, 36, 34],
        starts: [0, 0.30, 0.30, 0.30],
        gnarliness: [0.0008, 0.001, 0.001, 0.001],
        leafCount: 1,
      };
  const { geometry: branchGeom, branches } = makeBranching(branchCfg);
  const branchMesh = new THREE.Mesh(branchGeom, stemMat);
  group.add(branchMesh);

  // ---- leaf geometry + instanced meshes ----
  const leafGeom = buildLeafGeometry();
  const MAX_LEAVES = 24;
  const leafMesh = new THREE.InstancedMesh(leafGeom, leafMat, MAX_LEAVES);
  const petioleGeom = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 5, 1, true);
  const petioleMesh = new THREE.InstancedMesh(petioleGeom, petioleMat, MAX_LEAVES);

  const { axis, used } = mainAxis(branches);
  const axisTopY = axis[axis.length - 1].origin.y || H;

  const outward = new THREE.Vector3();
  const dirV = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const right = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const scaleV = new THREE.Vector3();
  const mTemp = new THREE.Matrix4();
  const qTemp = new THREE.Quaternion();
  const petDir = new THREE.Vector3();
  const basePt = new THREE.Vector3();
  let li = 0;

  function leafColor(yFrac, isYoung) {
    if (isYoung) {
      const hue = 0.25 + (rand() - 0.5) * 0.04;
      const sat = 0.50 + (rand() - 0.5) * 0.08;
      const light = 0.46 + (rand() - 0.5) * 0.06;
      return new THREE.Color().setHSL(hue, sat, light);
    }
    let hue = 0.32 - 0.08 * yFrac + (rand() - 0.5) * 0.04;
    let sat = 0.50 + (rand() - 0.5) * 0.10;
    let light = 0.40 + 0.10 * yFrac + (rand() - 0.5) * 0.06;
    if (rand() < 0.14) { hue = 0.13; sat = 0.42; light = 0.47 + (rand() - 0.5) * 0.06; } // yellowing
    return new THREE.Color().setHSL(hue, sat, light);
  }

  function addLeaf(node, az, tilt, roll, len, yFrac, isYoung) {
    outward.set(Math.cos(az), 0, Math.sin(az));
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    dirV.set(outward.x * st, -ct, outward.z * st);   // blade length axis (droops)
    normal.set(outward.x * ct, st, outward.z * ct);  // face normal (outward-up)
    right.crossVectors(dirV, normal);

    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rx = right.x, ry = right.y, rz = right.z;
    const nx = normal.x, ny = normal.y, nz = normal.z;
    right.set(rx * cr + nx * sr, ry * cr + ny * sr, rz * cr + nz * sr);
    normal.set(nx * cr - rx * sr, ny * cr - ry * sr, nz * cr - rz * sr);

    // substantial petiole: outward and slightly up from the node
    const pTilt = 0.35;
    const pc = Math.cos(pTilt), ps = Math.sin(pTilt);
    petDir.set(outward.x * pc, ps, outward.z * pc);
    const plen = len * 0.22;
    basePt.set(node.x + petDir.x * plen, node.y + petDir.y * plen, node.z + petDir.z * plen);

    qTemp.setFromUnitVectors(UP, petDir);
    mTemp.compose(node, qTemp, scaleV.set(1, plen, 1));
    petioleMesh.setMatrixAt(li, mTemp);

    basis.makeBasis(right, dirV, normal);
    basis.setPosition(basePt.x, basePt.y, basePt.z);
    basis.scale(scaleV.set(len * 0.62, len, 1));
    leafMesh.setMatrixAt(li, basis);
    leafMesh.setColorAt(li, leafColor(yFrac, isYoung));
    li++;
  }

  // ---- alternate leaves along the main axis (leggy staked stem) ----
  let azAcc = rand() * Math.PI * 2;
  let placed = 0;
  const minY = mature ? 0.22 : 0.34;
  const maxY = mature ? 0.90 : 0.95;
  for (let s = 0; s < axis.length; s++) {
    const sec = axis[s];
    const yFrac = Math.min(1, sec.origin.y / axisTopY);
    if (yFrac < minY || yFrac > maxY) continue;
    if (!mature && placed >= 4) break;
    // irregular alternate spacing: first in-range section, then odd sections
    if (s % 2 === 0 && placed > 0) continue;
    azAcc += 2.4 + (rand() - 0.5) * 0.9; // ~137.5° alternate phyllotaxis + jitter
    const az = azAcc + (rand() - 0.5) * 0.5;
    const tilt = mature ? 0.55 + 0.75 * yFrac + (rand() - 0.5) * 0.2 : 1.0 + (rand() - 0.5) * 0.3;
    const len = mature ? H * (0.17 + 0.05 * rand()) : H * (0.40 + 0.06 * rand());
    addLeaf(sec.origin, az, Math.min(1.35, tilt), (rand() - 0.5) * 0.8, len, yFrac, !mature);
    placed++;
  }

  // ---- lateral shoot tips (mature only): one drooping leaf each ----
  if (mature) {
    for (const tb of terminalTips(branches, used)) {
      const tip = tb.sections[tb.sections.length - 1].origin;
      const yFrac = Math.min(1, tip.y / axisTopY);
      const az = Math.atan2(tip.z, tip.x) + (rand() - 0.5) * 0.5;
      const tilt = 0.7 + 0.4 * yFrac + (rand() - 0.5) * 0.2;
      const len = H * (0.17 + 0.05 * rand());
      addLeaf(tip, az, Math.min(1.35, tilt), (rand() - 0.5) * 0.9, len, yFrac, false);
    }

    // conspicuous right-projecting lateral foliage (reference asymmetry)
    for (let r = 0; r < 2; r++) {
      const yFrac = 0.30 + 0.12 * r + (rand() - 0.5) * 0.05;
      const sec = axis[Math.min(axis.length - 1, Math.floor(yFrac * (axis.length - 1)))];
      const az = 0.15 + (rand() - 0.5) * 0.5; // +X side (camera right)
      addLeaf(sec.origin, az, 1.15 + (rand() - 0.5) * 0.2, (rand() - 0.5) * 0.7, H * (0.21 + 0.03 * rand()), yFrac, false);
    }
  }

  // ---- young tip cluster (top) ----
  const topSec = axis[axis.length - 1];
  const nTip = mature ? 3 : 1;
  for (let t = 0; t < nTip; t++) {
    const yFrac = mature ? 0.90 + 0.07 * rand() : 0.92 + 0.05 * rand();
    const az = azAcc + t * 2.4 + 1.0 + (rand() - 0.5) * 0.8;
    const tilt = 1.15 + 0.5 * rand();
    const len = mature ? H * (0.11 + 0.03 * rand()) : H * (0.34 + 0.04 * rand());
    addLeaf(topSec.origin, az, Math.min(1.5, tilt), (rand() - 0.5) * 0.6, len, yFrac, !mature);
  }

  leafMesh.count = li;
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  petioleMesh.count = li;
  petioleMesh.instanceMatrix.needsUpdate = true;
  group.add(leafMesh, petioleMesh);

  // ---- green bamboo stake + twine ties (mature only) ----
  if (mature) {
    const sh = H * 0.88;
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0085, sh, 6), stakeMat);
    stake.position.set(0.034, sh / 2, 0.014);
    group.add(stake);

    const tieGeom = new THREE.TorusGeometry(0.028, 0.003, 5, 12);
    const ties = new THREE.InstancedMesh(tieGeom, tieMat, 2);
    const tm0 = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    tm0.setPosition(0.017, H * 0.40, 0.006);
    const tm1 = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    tm1.setPosition(0.017, H * 0.58, 0.006);
    ties.setMatrixAt(0, tm0);
    ties.setMatrixAt(1, tm1);
    group.add(ties);
  }

  // ---- fruit cluster high on the stem (mature only) ----
  if (mature) {
    const pedGeom = buildPedicelGeometry();
    const fruitGeom = buildFruitGeometry();
    const calyxGeom = buildCalyxGeometry();
    const pedEnd = new THREE.Vector3(0.017, -0.034, -0.010);

    const nFruit = 3;
    const pedMesh = new THREE.InstancedMesh(pedGeom, petioleMat, nFruit);
    const fruitMesh = new THREE.InstancedMesh(fruitGeom, fruitMat, nFruit);
    const calyxMesh = new THREE.InstancedMesh(calyxGeom, calyxMat, nFruit);

    const mA = new THREE.Matrix4();
    const mB = new THREE.Matrix4();
    const qY = new THREE.Quaternion();
    const off = new THREE.Vector3();
    const fpos = new THREE.Vector3();
    const sV = new THREE.Vector3();

    for (let f = 0; f < nFruit; f++) {
      // fruit node: main-axis section in the upper third (high on the stem)
      const yFrac = 0.60 + f * 0.07 + (rand() - 0.5) * 0.04;
      const si = Math.min(axis.length - 1, Math.max(0, Math.round(yFrac * (axis.length - 1))));
      const node = axis[si].origin;
      const az = (f / nFruit) * Math.PI * 2 + 1.1 + (rand() - 0.5) * 0.5;
      const scale = 0.82 + 0.22 * rand();

      qY.setFromAxisAngle(UP, az);
      mA.compose(node, qY, ONE);
      pedMesh.setMatrixAt(f, mA);

      off.copy(pedEnd).applyAxisAngle(UP, az);
      fpos.set(node.x + off.x, node.y + off.y, node.z + off.z);
      mB.compose(fpos, qY, ONE);
      calyxMesh.setMatrixAt(f, mB);
      sV.set(scale, scale, scale);
      mTemp.compose(fpos, qY, sV);
      fruitMesh.setMatrixAt(f, mTemp);
    }
    group.add(pedMesh, fruitMesh, calyxMesh);
  }

  group.userData = {
    family: 'eggplant',
    round: 1,
    age,
    mature,
    adultHeight: ADULT_H,
    leafCount: li,
    hypothesis: 'connected branch/node/leaf architecture via pinned EZ-Tree adapter; alternate herbaceous leaf nodes along main axis + short lateral shoots; broad ovate shoulder/apex leaf coupon; juvenile topology reduces branch/leaf counts rather than uniformly scaling.',
  };
  return group;
}
