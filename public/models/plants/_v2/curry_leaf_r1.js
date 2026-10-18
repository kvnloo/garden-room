import * as THREE from 'three';
import { makeBranching } from '/models/plants/_shared/branching.js';

// Curry leaf (Murraya koenigii) — v2 round 1.
//
// Rebuilt form hypothesis (single attributable physical cause):
//   The baseline built "fronds" as independent arcs that were detached from any
//   real node hierarchy and used a broad (1:1) flat leaflet twisted up to ±0.45
//   rad, which collapsed the pinnate sprays into angular, edge-on paddles over a
//   column of parallel poles. This rebuild couples (a) a connected, seeded
//   EZ-Tree branch skeleton of a few slim, subtly bent woody shoots that fork
//   once and terminate in leafy growth, with (b) a connected compound-leaf
//   coupon — a single tapered rachis arc carrying 9–13 narrow-ovate pointed
//   leaflets in opposite pairs plus a terminal leaflet, whose blades are tilted
//   up-and-outward by construction (not by random twist) so each compound leaf
//   reads as a broad pinnate spray from front, three-quarter and top views.
//
// Protected: soil-centre origin, +Y up, metres, height = plant above soil,
// seeded determinism (mulberry32 + seeded EZ-Tree), app factory contract.

const UP = new THREE.Vector3(0, 1, 0);
const FAMILY_ADULT_HEIGHT = 0.85;   // reference is an ~85 cm plant
const ARC = 2.2;                    // rachis sweep (rad): arches over, gentle droop
const A0 = 0.5;                     // rachis leaves the node ~29° above horizontal

// --- seeded PRNG (mulberry32) ------------------------------------------------
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- leaflet coupon ----------------------------------------------------------
// Unit length along +Y (base at y=0, tip at y=1), full width ~0.46 baked in
// (length:width ≈ 2.17:1 narrow ovate), rounded shoulders, tapered point, a
// gentle lengthwise bow with raised midrib and shallowly cupped edges. 4 length
// segments -> 16 tris. Smooth vertex normals keep the oval outline soft.
function buildLeafletGeometry() {
  const SEG = 4;
  const rows = SEG + 1;
  const halfW = [0.06, 0.19, 0.23, 0.17, 0.02];
  const pos = new Float32Array(rows * 3 * 3);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    const w = halfW[r];
    const s = Math.sin(Math.PI * t);
    const bow = s * 0.030;
    const midZ = bow + s * 0.040;   // raised central vein
    const edgeZ = bow - s * 0.030;  // shallowly cupped edges
    const y = t;
    const i = r * 3;
    pos[(i + 0) * 3 + 0] = -w; pos[(i + 0) * 3 + 1] = y; pos[(i + 0) * 3 + 2] = edgeZ;
    pos[(i + 1) * 3 + 0] = 0;  pos[(i + 1) * 3 + 1] = y; pos[(i + 1) * 3 + 2] = midZ;
    pos[(i + 2) * 3 + 0] = w;  pos[(i + 2) * 3 + 1] = y; pos[(i + 2) * 3 + 2] = edgeZ;
  }
  const idx = [];
  for (let r = 0; r < SEG; r++) {
    const a = r * 3, b = (r + 1) * 3;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
    idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --- canonical rachis --------------------------------------------------------
// One connected, tapered midrib arc in the local X(+outward)/Y(+up) plane,
// unit arc length (scaled per instance by rachisLen). 4 segments x 3 radial
// sides -> 24 tris; the whole compound leaf shares this one geometry so the
// rachis is a continuous curve, not stacked segments.
function buildTaperedTube(points, radii, radialSegs) {
  const rings = points.length;
  const pos = new Float32Array(rings * radialSegs * 3);
  const idx = [];
  const tan = new THREE.Vector3();
  const upRef = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const bin = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < rings; i++) {
    const p = points[i];
    const r = radii[i];
    const pPrev = points[Math.max(0, i - 1)];
    const pNext = points[Math.min(rings - 1, i + 1)];
    tan.subVectors(pNext, pPrev);
    if (tan.lengthSq() < 1e-9) tan.set(1, 0, 0);
    tan.normalize();
    upRef.set(0, 1, 0);
    if (Math.abs(tan.y) > 0.99) upRef.set(0, 0, 1);
    nrm.crossVectors(upRef, tan).normalize();
    bin.crossVectors(tan, nrm).normalize();
    for (let j = 0; j < radialSegs; j++) {
      const ang = (2 * Math.PI * j) / radialSegs;
      v.set(0, 0, 0)
        .addScaledVector(nrm, Math.cos(ang) * r)
        .addScaledVector(bin, Math.sin(ang) * r)
        .add(p);
      const o = (i * radialSegs + j) * 3;
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * radialSegs + j;
      const b = i * radialSegs + (j + 1) % radialSegs;
      const c = (i + 1) * radialSegs + j;
      const d = (i + 1) * radialSegs + (j + 1) % radialSegs;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildRachisGeometry() {
  const NSEG = 4;
  const R = 1 / ARC;
  const pts = [];
  const rads = [];
  const F0 = { x: -Math.cos(A0), y: Math.sin(A0) };
  for (let s = 0; s <= NSEG; s++) {
    const a = A0 + ARC * (s / NSEG);
    const F = { x: -Math.cos(a), y: Math.sin(a) };
    pts.push(new THREE.Vector3(R * (F.x - F0.x), R * (F.y - F0.y), 0));
    rads.push(0.006 * (1 - 0.55 * (s / NSEG)));
  }
  return buildTaperedTube(pts, rads, 3);
}

// --- compound leaf -----------------------------------------------------------
// Places one connected compound leaf (rachis instance + its leaflets) into the
// shared instanced lists. node/phi/pitch/rachisLen are world-space; the leaflet
// frames are built in the canonical (unit) rachis frame then carried into world
// by the leaf's azimuth+pitch quaternion. Leaflet blades are tilted up-and-
// outward by construction so broad faces read from front/three-quarter/top.
function emitCompoundLeaf(out, node, phi, pitch, rachisLen, pairs, fracY, rand, leafletRatio) {
  const R = rachisLen / ARC;
  const qY = new THREE.Quaternion().setFromAxisAngle(UP, phi);
  const qZ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pitch);
  const Q = qY.clone().multiply(qZ);

  out.rachis.push(new THREE.Matrix4().compose(node, Q, new THREE.Vector3(rachisLen, rachisLen, rachisLen)));

  const nLeaf = pairs * 2 + 1;
  const F0 = { x: -Math.cos(A0), y: Math.sin(A0) };
  const leafletLen = rachisLen * leafletRatio * (0.9 + 0.2 * rand());
  const tV = new THREE.Vector3();
  const lV = new THREE.Vector3();
  const ngV = new THREE.Vector3();
  const wV = new THREE.Vector3();
  const nV = new THREE.Vector3();
  const lat = new THREE.Vector3(0, 0, 1);
  const wp = new THREE.Vector3();

  for (let k = 0; k < nLeaf; k++) {
    const isTerm = k === nLeaf - 1;
    const side = isTerm ? 0 : (k % 2 === 0 ? -1 : 1);
    const tt = isTerm ? 1.0 : (Math.floor(k / 2) + 0.55) / pairs;
    const a = A0 + ARC * tt;
    const F = { x: -Math.cos(a), y: Math.sin(a) };
    // canonical unit position (x outward, y up, z lateral)
    const cx = (F.x - F0.x) / ARC;
    const cy = (F.y - F0.y) / ARC;
    const cz = side * 0.012;
    wp.set(cx * rachisLen, cy * rachisLen, cz * rachisLen).applyQuaternion(Q).add(node);

    tV.set(Math.sin(a), Math.cos(a), 0); // rachis tangent (canonical)
    if (isTerm) {
      lV.set(tV.x * 0.7, tV.y * 0.7 + 0.35, 0).normalize();
      ngV.set(0, 1, 0).multiplyScalar(0.72).addScaledVector(tV, 0.28).normalize();
    } else {
      lV.set(0, 0, side * 0.9).addScaledVector(tV, 0.35).addScaledVector(UP, 0.12).normalize();
      ngV.set(0, 1, 0).multiplyScalar(0.75).addScaledVector(tV, 0.30).addScaledVector(lat, side * 0.20).normalize();
    }
    wV.crossVectors(ngV, lV);
    if (wV.lengthSq() < 1e-8) wV.set(1, 0, 0);
    wV.normalize();
    nV.crossVectors(lV, wV).normalize();

    const Ww = wV.clone().applyQuaternion(Q);
    const Lw = lV.clone().applyQuaternion(Q);
    const Nw = nV.clone().applyQuaternion(Q);

    const M = new THREE.Matrix4().makeBasis(Ww, Lw, Nw);
    M.setPosition(wp);
    M.scale(new THREE.Vector3(leafletLen, leafletLen, leafletLen));
    out.leafMatrices.push(M);
    out.leafColors.push(leafColor(rand, fracY));
  }
}

function leafColor(rand, fracY) {
  // warm yellow-green new growth -> olive older growth, moderately saturated,
  // brighter tips. Coherent 3-5 green family, no neon.
  const hue = 0.245 + (1 - fracY) * 0.03 + (rand() - 0.5) * 0.05;
  const sat = 0.55 + rand() * 0.15;
  const light = 0.26 + fracY * 0.08 + rand() * 0.08;
  return new THREE.Color().setHSL(hue, sat, light);
}

// --- branch sampling ---------------------------------------------------------
// Interpolate a point at fraction f along a branch's section polyline.
function pointOnBranch(branch, f) {
  const secs = branch.sections;
  const n = secs.length;
  const g = Math.min(1, Math.max(0, f)) * (n - 1);
  const i = Math.min(n - 2, Math.floor(g));
  const t = g - i;
  const a = secs[i].origin, b = secs[i + 1].origin;
  return new THREE.Vector3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

// --- adult build -------------------------------------------------------------
function buildAdult(seed, rand) {
  const group = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x6b6647, roughness: 0.9, metalness: 0.0 });
  const rachisMat = new THREE.MeshStandardMaterial({ color: 0x8f9c4e, roughness: 0.7, metalness: 0.0 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.0, side: THREE.DoubleSide });

  const rachisGeom = buildRachisGeometry();
  const leafGeom = buildLeafletGeometry();

  const out = { rachis: [], leafMatrices: [], leafColors: [] };

  const stems = [
    { l0: 0.52, off: new THREE.Vector3(-0.025, 0, 0.012) },
    { l0: 0.46, off: new THREE.Vector3(0.030, 0, -0.020) },
    { l0: 0.40, off: new THREE.Vector3(-0.005, 0, -0.030) },
  ];

  let leafIdx = 0;
  for (let si = 0; si < stems.length; si++) {
    const stem = stems[si];
    const stemSeed = Math.floor(seed * 1000 + si * 1009 + 13);
    const { geometry, branches } = makeBranching({
      seed: stemSeed,
      levels: 2,
      lengths: [stem.l0, 0.25, 0.14, 0],
      radii: [0.005, 0.6, 0.5, 0.4],
      children: [1, 0, 0],
      angles: [0, 40, 45, 35],
      starts: [0, 0.5, 0.4, 0.3],
      gnarliness: [0.0015, 0.002, 0.003, 0.001],
      leafCount: 1,
    });

    const stemG = new THREE.Group();
    stemG.position.copy(stem.off);
    stemG.add(new THREE.Mesh(geometry, stemMat));
    group.add(stemG);

    // Trunk: 3 alternate compound leaves in the upper half (lowest well above soil).
    const trunk = branches[0];
    for (let j = 0; j < 3; j++) {
      const f = 0.42 + 0.24 * j + (rand() - 0.5) * 0.04;
      const node = pointOnBranch(trunk, f).add(stem.off);
      const phi = leafIdx * 2.4 + si * 0.7 + (rand() - 0.5) * 0.3;
      const fracY = Math.min(1, node.y / FAMILY_ADULT_HEIGHT);
      const pitch = (rand() - 0.5) * 0.24 - (1 - fracY) * 0.08;
      const rachisLen = (0.26 + 0.05 * rand()) * (0.92 + 0.08 * fracY);
      const pairs = 4 + Math.floor(rand() * 2);
      emitCompoundLeaf(out, node, phi, pitch, rachisLen, pairs, fracY, rand, 0.17);
      leafIdx++;
    }

    // Fork branches: a terminal compound leaf so each shoot ends in leafy growth.
    for (let b = 1; b < branches.length; b++) {
      const node = pointOnBranch(branches[b], 0.97).add(stem.off);
      const phi = leafIdx * 2.4 + si * 0.7 + (rand() - 0.5) * 0.3;
      const fracY = Math.min(1, node.y / FAMILY_ADULT_HEIGHT);
      const pitch = (rand() - 0.5) * 0.24 - (1 - fracY) * 0.08;
      const rachisLen = 0.22 + 0.05 * rand();
      const pairs = 4 + Math.floor(rand() * 2);
      emitCompoundLeaf(out, node, phi, pitch, rachisLen, pairs, fracY, rand, 0.17);
      leafIdx++;
    }
  }

  const rachisMesh = new THREE.InstancedMesh(rachisGeom, rachisMat, out.rachis.length);
  for (let i = 0; i < out.rachis.length; i++) rachisMesh.setMatrixAt(i, out.rachis[i]);
  rachisMesh.instanceMatrix.needsUpdate = true;
  group.add(rachisMesh);

  const leafMesh = new THREE.InstancedMesh(leafGeom, leafMat, out.leafMatrices.length);
  for (let i = 0; i < out.leafMatrices.length; i++) {
    leafMesh.setMatrixAt(i, out.leafMatrices[i]);
    leafMesh.setColorAt(i, out.leafColors[i]);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  group.add(leafMesh);

  return group;
}

// --- juvenile build ----------------------------------------------------------
// Seedling exception (local primitives, per brief): one short thin stem and a
// few small compound leaves with fewer leaflets, all above the soil — not a
// scaled-down copy of the mature canopy.
function buildJuvenile(seed, rand) {
  const group = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x6f6a48, roughness: 0.85, metalness: 0.0 });
  const rachisMat = new THREE.MeshStandardMaterial({ color: 0x96a450, roughness: 0.7, metalness: 0.0 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.30, metalness: 0.0, side: THREE.DoubleSide });

  const rachisGeom = buildRachisGeometry();
  const leafGeom = buildLeafletGeometry();

  // single bent stem
  const stemH = 0.115;
  const lean = 0.04 + 0.03 * rand();
  const leanAz = rand() * Math.PI * 2;
  const base = new THREE.Vector3(0, 0, 0);
  const tip = new THREE.Vector3(
    Math.sin(lean) * Math.cos(leanAz) * stemH,
    Math.cos(lean) * stemH,
    Math.sin(lean) * Math.sin(leanAz) * stemH,
  );
  const mid = base.clone().add(tip).multiplyScalar(0.5);
  mid.add(new THREE.Vector3(0, 0.012 + 0.01 * rand(), 0));
  const curve = new THREE.QuadraticBezierCurve3(base, mid, tip);
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 4, 0.0035, 4, false), stemMat));

  const out = { rachis: [], leafMatrices: [], leafColors: [] };
  const nLeaves = 4;
  for (let j = 0; j < nLeaves; j++) {
    const f = 0.38 + (0.56 * j) / (nLeaves - 1) + (rand() - 0.5) * 0.03;
    const node = curve.getPoint(f);
    const phi = j * 2.4 + (rand() - 0.5) * 0.4;
    const fracY = Math.min(1, node.y / 0.1275);
    const pitch = (rand() - 0.5) * 0.2;
    const rachisLen = 0.055 + 0.02 * rand();
    const pairs = 1 + Math.floor(rand() * 2); // 3 or 5 leaflets
    emitCompoundLeaf(out, node, phi, pitch, rachisLen, pairs, fracY, rand, 0.24);
  }

  const rachisMesh = new THREE.InstancedMesh(rachisGeom, rachisMat, out.rachis.length);
  for (let i = 0; i < out.rachis.length; i++) rachisMesh.setMatrixAt(i, out.rachis[i]);
  rachisMesh.instanceMatrix.needsUpdate = true;
  group.add(rachisMesh);

  const leafMesh = new THREE.InstancedMesh(leafGeom, leafMat, out.leafMatrices.length);
  for (let i = 0; i < out.leafMatrices.length; i++) {
    leafMesh.setMatrixAt(i, out.leafMatrices[i]);
    leafMesh.setColorAt(i, out.leafColors[i]);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  group.add(leafMesh);

  return group;
}

// --- factory -----------------------------------------------------------------
export function createPlant({
  height = 0.8,
  spread = 0.5,
  potDiameter = 0.3,
  seed = 1,
  width,
  depth,
} = {}) {
  const rand = mulberry32(seed);
  const relAge = Math.min(1, Math.max(0.05, height / FAMILY_ADULT_HEIGHT));

  const group = relAge < 0.4 ? buildJuvenile(seed, rand) : buildAdult(seed, rand);

  // Normalise so the built plant fills the requested height (above soil) and
  // spread (canopy diameter). Built dims already sit close to target so the
  // correction is small and aspect is preserved.
  const box = new THREE.Box3().setFromObject(group);
  const plantH = Math.max(1e-4, box.max.y);
  const plantW = Math.max(1e-4, box.max.x - box.min.x, box.max.z - box.min.z);
  group.scale.set(spread / plantW, height / plantH, spread / plantW);

  group.userData = { family: 'curry_leaf', relAge, seed, tris: 'see capture' };
  return group;
}
