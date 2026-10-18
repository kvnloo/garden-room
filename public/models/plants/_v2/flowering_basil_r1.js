import * as THREE from 'three';
import { makeBranching } from '/models/plants/_shared/branching.js';

// Flowering holy basil (Ocimum tenuiflorum) ~60 cm tall, ~70 cm wide.
// Round-1 hypothesis: a connected branching herb skeleton from the pinned
// EZ-Tree adapter — a short woody trunk, several curving main stems carrying
// opposite decussate leaf pairs, and a wide airy fountain of many slender
// upright flowering spikes (terminal + axillary) above a compact small-leaf core.
// Deterministic: mulberry32(seed) for jitter, the same seed for the branch skeleton.

const ADULT_HEIGHT = 0.6;   // family adult height (metres)
const JUVENILE_AGE = 0.45;  // below this age fraction, build a seedling

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- leaf coupon ---------------------------------------------------------
// 3-column (left edge / midrib / right edge) x 6-row blade: rounded base,
// pointed (or rounder, juvenile) tip, subtle scalloped margin, cupped edges,
// a creased midrib and a gentle tip droop. Local space: length +Y, width +X,
// upper face +Z.
function leafPeak(baseFrac, tipPow) {
  let peak = 0;
  for (let i = 0; i <= 200; i++) {
    const t = i / 200;
    const v = (baseFrac + (1 - baseFrac) * Math.pow(t, 0.55)) * Math.pow(1 - t, tipPow);
    if (v > peak) peak = v;
  }
  return peak || 1;
}

function buildLeafGeometry({ len, halfW, tipPow, baseFrac }) {
  const SEG = 5;
  const rows = SEG + 1;
  const vpr = 3;
  const peak = leafPeak(baseFrac, tipPow);
  const positions = new Float32Array(rows * vpr * 3);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    let w = halfW * (baseFrac + (1 - baseFrac) * Math.pow(t, 0.55)) * Math.pow(1 - t, tipPow) / peak;
    w *= 1 + 0.05 * Math.sin(t * Math.PI * 6); // subtle scalloped margin
    const y = t * len;
    const s = Math.sin(Math.PI * Math.min(1, t));
    const cup = 0.9 * halfW * s;       // edges curl up
    const crease = 0.8 * halfW * s;    // midrib dips down
    const drop = 0.18 * len * t * t;   // tip droops
    const i = r * vpr;
    positions[i * 3] = -w; positions[i * 3 + 1] = y; positions[i * 3 + 2] = -drop + cup;
    positions[i * 3 + 3] = 0;  positions[i * 3 + 4] = y; positions[i * 3 + 5] = -drop - crease;
    positions[i * 3 + 6] = w;  positions[i * 3 + 7] = y; positions[i * 3 + 8] = -drop + cup;
  }
  const indices = [];
  for (let r = 0; r < SEG; r++) {
    const a = r * vpr, b = (r + 1) * vpr;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
    indices.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// ---- flower spike --------------------------------------------------------
// One unit spike (length 1, base radius 1): a thin tapered axis with a knobbly
// series of tiny outward calyx bumps (whorls) along its upper half. Vertex
// colours run from gray-green stalk base to muted lavender / pale tips.
function buildSpikeGeometry() {
  const RAD = 5, HSEG = 4, W = 4, B = 4;
  const R0 = 1, R1 = 0.22, L = 1;
  const pos = [], idx = [], col = [];
  const cStalk = new THREE.Color(0x6a6f52);
  const cWhorl = new THREE.Color(0xa89ab0);
  const cTip = new THREE.Color(0xcbbdd0);

  const pushV = (x, y, z, c) => { pos.push(x, y, z); col.push(c.r, c.g, c.b); };

  // axis rings
  for (let j = 0; j <= HSEG; j++) {
    const t = j / HSEG;
    const y = t * L;
    const r = R0 + (R1 - R0) * t;
    const c = cStalk.clone().lerp(cTip, t);
    for (let k = 0; k < RAD; k++) {
      const a = (k / RAD) * Math.PI * 2;
      pushV(Math.cos(a) * r, y, Math.sin(a) * r, c);
    }
  }
  for (let j = 0; j < HSEG; j++) {
    for (let k = 0; k < RAD; k++) {
      const a = j * RAD + k;
      const b = j * RAD + ((k + 1) % RAD);
      const c = a + RAD, d = b + RAD;
      idx.push(a, c, b, b, c, d);
    }
  }
  // whorl calyces: small outward-pointing tetrahedra around the axis
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3(), dir = new THREE.Vector3();
  const c0 = new THREE.Vector3(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
  const p2 = new THREE.Vector3(), tip = new THREE.Vector3();
  for (let w = 0; w < W; w++) {
    const yFrac = 0.42 + (w / W) * 0.52;
    const y = yFrac * L;
    const r = R0 + (R1 - R0) * yFrac;
    for (let b = 0; b < B; b++) {
      const a = (b / B) * Math.PI * 2 + w * 0.9;
      dir.set(Math.cos(a), 0.35, Math.sin(a)).normalize();
      c0.set(Math.cos(a) * r, y, Math.sin(a) * r);
      t1.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      t2.crossVectors(dir, t1).normalize();
      p0.copy(c0).addScaledVector(t1, 0.16).addScaledVector(dir, -0.02);
      p1.copy(c0).addScaledVector(t2, 0.16).addScaledVector(dir, -0.02);
      p2.copy(c0).addScaledVector(t1, -0.16).addScaledVector(t2, -0.16).addScaledVector(dir, -0.02);
      tip.copy(c0).addScaledVector(dir, 0.30);
      const base = pos.length / 3;
      pushV(p0.x, p0.y, p0.z, cWhorl);
      pushV(p1.x, p1.y, p1.z, cWhorl);
      pushV(p2.x, p2.y, p2.z, cWhorl);
      pushV(tip.x, tip.y, tip.z, cTip);
      idx.push(base, base + 1, base + 2);
      idx.push(base, base + 3, base + 1);
      idx.push(base + 1, base + 3, base + 2);
      idx.push(base + 2, base + 3, base);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- stem vertex colours: pale woody base -> muted gray-green -> purple-brown tips
function addStemVertexColors(geometry, k) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const woody = new THREE.Color(0x8a7a5c);
  const green = new THREE.Color(0x5f7048);
  const purple = new THREE.Color(0x6a5a6a);
  const tmp = new THREE.Color();
  const lo = 0.12 * k, hi = 0.52 * k;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < lo) tmp.copy(woody).lerp(green, y / lo);
    else tmp.copy(green).lerp(purple, Math.min(1, (y - lo) / (hi - lo)));
    colors[i * 3] = tmp.r; colors[i * 3 + 1] = tmp.g; colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// ---- shared instancing scratch -------------------------------------------
const _dummy = new THREE.Object3D();
const _m = new THREE.Matrix4();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3();
const _proj = new THREE.Vector3();
const _xa = new THREE.Vector3();
const _za = new THREE.Vector3();

function placeLeaf(inst, idx, px, py, pz, leafDir, leafUp, scale, color) {
  _dir.copy(leafDir).normalize();
  _up.copy(leafUp);
  _proj.copy(_dir).multiplyScalar(_dir.dot(_up));
  _up.sub(_proj);
  if (_up.lengthSq() < 1e-12) _up.set(0, 1, 0);
  _up.normalize();
  _xa.crossVectors(_dir, _up).normalize();
  _za.crossVectors(_xa, _dir).normalize();
  _m.makeBasis(_xa, _dir, _za);
  _dummy.position.set(px, py, pz);
  _dummy.quaternion.setFromRotationMatrix(_m);
  _dummy.scale.setScalar(scale);
  _dummy.updateMatrix();
  inst.setMatrixAt(idx, _dummy.matrix);
  inst.setColorAt(idx, color);
}

function buildAdult(group, rand, H, k, seed) {
  const CHILDREN0 = 3, CHILDREN1 = 2;
  const { geometry, branches, sites } = makeBranching({
    seed,
    levels: 2,
    lengths: [0.16, 0.20, 0.16],
    radii: [0.006, 0.5, 0.45],
    children: [CHILDREN0, CHILDREN1],
    angles: [0, 58, 50],
    starts: [0, 0.15, 0.25],
    gnarliness: [0.0008, 0.002, 0.003],
    leafCount: 0,
  });

  geometry.scale(k, k, k);
  addStemVertexColors(geometry, k);

  const stemMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  const stemMesh = new THREE.Mesh(geometry, stemMat);
  stemMesh.name = 'stems';
  group.add(stemMesh);

  // ---- leaves -------------------------------------------------------------
  const leafGeom = buildLeafGeometry({ len: 0.045, halfW: 0.011, tipPow: 0.85, baseFrac: 0.45 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });

  const level1Count = CHILDREN0 + 1;          // children + terminal continuation
  const level2Count = level1Count * (CHILDREN1 + 1);
  const LEAF_CAP = level1Count * 6 + level2Count * 4;
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, LEAF_CAP);
  leaves.name = 'leaves';

  const UP = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const right = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const side = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const upv = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const col = new THREE.Color();

  let li = 0;
  const leafColorAt = (y) => {
    const t = Math.max(0, Math.min(1, y / (0.55 * k)));
    const r = rand();
    if (t < 0.35) {
      if (r < 0.45) col.setHSL(0.30 + rand() * 0.03, 0.40 + rand() * 0.08, 0.30 + rand() * 0.06);
      else col.setHSL(0.16 + rand() * 0.04, 0.45 + rand() * 0.10, 0.40 + rand() * 0.08);
    } else if (t < 0.7) {
      col.setHSL(0.29 + rand() * 0.04, 0.45 + rand() * 0.12, 0.36 + rand() * 0.10);
    } else {
      col.setHSL(0.25 + rand() * 0.05, 0.50 + rand() * 0.12, 0.46 + rand() * 0.10);
    }
    return col;
  };

  // Opposite decussate leaf pairs along every branch except the trunk.
  for (let bi = 1; bi < branches.length; bi++) {
    const branch = branches[bi];
    const isLevel1 = bi <= level1Count;
    const nodeIdx = isLevel1 ? [1, 2, 3] : [1, 2];
    const phase = rand() < 0.5 ? 0 : 1;
    for (let n = 0; n < nodeIdx.length; n++) {
      const sec = branch.sections[nodeIdx[n]];
      origin.copy(sec.origin).multiplyScalar(k);
      q.setFromEuler(sec.orientation);
      axis.set(0, 1, 0).applyQuaternion(q).normalize();
      right.set(1, 0, 0).applyQuaternion(q).normalize();
      fwd.set(0, 0, 1).applyQuaternion(q).normalize();
      side.copy((n + phase) % 2 === 0 ? right : fwd);
      const off = (sec.radius + 0.004) * k;
      const scl = k * (0.75 + rand() * 0.6);
      for (const sgn of [1, -1]) {
        dir.copy(side).multiplyScalar(0.72 * sgn).addScaledVector(UP, 0.55).normalize();
        upv.set(0, 1, 0).addScaledVector(side, 0.25 * sgn).normalize();
        const py = origin.y + side.y * sgn * off + 0.002 * k;
        if (py < 0.02 * k) continue;
        const px = origin.x + side.x * sgn * off;
        const pz = origin.z + side.z * sgn * off;
        placeLeaf(leaves, li, px, py, pz, dir, upv, scl, leafColorAt(py));
        li += 1;
      }
    }
  }
  leaves.count = li;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(leaves);

  // ---- flower spikes ------------------------------------------------------
  const spikeGeom = buildSpikeGeometry();
  const spikeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  const SPIKE_CAP = sites.length + level1Count * 2;
  const spikes = new THREE.InstancedMesh(spikeGeom, spikeMat, SPIKE_CAP);
  spikes.name = 'spikes';
  let si = 0;
  const outDir = new THREE.Vector3();
  const tint = new THREE.Color();

  const placeSpike = (sx, sy, sz, dirV, len, rad) => {
    _dummy.position.set(sx, sy, sz);
    _dummy.quaternion.setFromUnitVectors(UP, dirV.normalize());
    _dummy.scale.set(rad, len, rad);
    _dummy.updateMatrix();
    spikes.setMatrixAt(si, _dummy.matrix);
    tint.setHSL(0.72 + rand() * 0.14, 0.10 + rand() * 0.12, 0.88 + rand() * 0.12);
    spikes.setColorAt(si, tint);
    si += 1;
  };

  // terminal spikes at the tips of the level-2 twigs
  for (let i = 0; i < sites.length; i++) {
    origin.copy(sites[i].origin).multiplyScalar(k);
    outDir.set(origin.x, 0, origin.z);
    if (outDir.lengthSq() < 1e-8) outDir.set(Math.cos(rand() * 6.2832), 0, Math.sin(rand() * 6.2832));
    outDir.normalize();
    dir.copy(outDir).multiplyScalar(0.45).addScaledVector(UP, 0.78).normalize();
    placeSpike(origin.x, origin.y, origin.z, dir, (0.15 + rand() * 0.09) * k, 0.0022 * k * (0.85 + rand() * 0.35));
  }

  // axillary spikes from the upper main stems
  for (let bi = 1; bi <= level1Count; bi++) {
    const branch = branches[bi];
    for (const nIdx of [3, 4]) {
      const sec = branch.sections[nIdx];
      origin.copy(sec.origin).multiplyScalar(k);
      q.setFromEuler(sec.orientation);
      axis.set(0, 1, 0).applyQuaternion(q).normalize();
      dir.copy(axis).multiplyScalar(0.5).addScaledVector(UP, 0.7).normalize();
      placeSpike(origin.x, origin.y, origin.z, dir, (0.14 + rand() * 0.08) * k, 0.002 * k * (0.85 + rand() * 0.35));
    }
  }
  spikes.count = si;
  spikes.instanceMatrix.needsUpdate = true;
  if (spikes.instanceColor) spikes.instanceColor.needsUpdate = true;
  group.add(spikes);
}

function buildSeedling(group, rand, H, k) {
  const stemH = 0.5 * H;
  const stemGeom = new THREE.CylinderGeometry(0.0012 * k, 0.0022 * k, stemH, 4, 1, true);
  stemGeom.translate(0, stemH * 0.5, 0);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x5f7048, roughness: 0.8, metalness: 0 });
  const stem = new THREE.Mesh(stemGeom, stemMat);
  stem.name = 'stems';
  group.add(stem);

  const leafGeom = buildLeafGeometry({ len: 0.045, halfW: 0.016, tipPow: 0.5, baseFrac: 0.55 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  const LEAF_CAP = 6;
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, LEAF_CAP);
  leaves.name = 'leaves';

  const dir = new THREE.Vector3();
  const upv = new THREE.Vector3();
  const col = new THREE.Color();
  let li = 0;
  const nodes = [0.5, 0.7, 0.88];
  const phase = rand() < 0.5 ? 0 : 1;
  for (let n = 0; n < nodes.length; n++) {
    const y = nodes[n] * stemH;
    const azi = (n + phase) * Math.PI * 0.5 + rand() * 0.35; // decussate ~90 deg
    for (const sgn of [1, -1]) {
      const ca = Math.cos(azi), sa = Math.sin(azi);
      dir.set(ca * sgn * 0.8, 0.6, sa * sgn * 0.8).normalize();
      upv.set(ca * sgn * 0.2, 1, sa * sgn * 0.2).normalize();
      const scl = k * (0.9 + rand() * 0.5);
      col.setHSL(0.27 + rand() * 0.05, 0.50 + rand() * 0.10, 0.45 + rand() * 0.10);
      placeLeaf(leaves, li, 0, y, 0, dir, upv, scl, col);
      li += 1;
    }
  }
  leaves.count = li;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(leaves);
}

export function createPlant({
  height = 0.6,
  spread = 0.7,
  potDiameter = 0.3,
  seed = 1,
  width,
  depth,
} = {}) {
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  group.name = 'flowering_basil';
  const H = height;
  const k = H / ADULT_HEIGHT;
  const age = Math.max(0.05, Math.min(1, H / ADULT_HEIGHT));
  const R = Math.max(spread * 0.5, H * 0.583);
  group.userData = {
    family: 'flowering_basil',
    height: H,
    spread: R * 2,
    seed,
    age,
    hypothesis: 'connected branching herb + opposite decussate leaves + fountain of slender flowering spikes',
  };

  if (age < JUVENILE_AGE) buildSeedling(group, rand, H, k);
  else buildAdult(group, rand, H, k, seed);

  return group;
}
