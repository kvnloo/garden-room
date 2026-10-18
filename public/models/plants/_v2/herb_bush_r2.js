import * as THREE from 'three';
import { makeBranching } from '/models/plants/_shared/branching.js';

// herb_bush_r1 — connected reference-specific reconstruction.
//
// Replaces the r0 "42 straight rods in a fountain" with ONE short woody crown
// that forks into several ascending stems, each forking again into fine wiry
// twigs (pinned MIT EZ-Tree adapter). Small ovate leaves (rounded shoulders,
// rounded base, gently tapered tip, shallow cup + raised midrib) are instanced
// along the terminal twigs and as opposite pairs on the lower stems, forming a
// low, wide, sparse-lacy mound wider than tall, with sparse upper tips.
//
// Deterministic via mulberry32(seed) for placement/colour; EZ-Tree carries its
// own seeded RNG (branchSeed = seed*1000+7), so the whole plant is reproducible.

const ADULT_HEIGHT = 0.6; // family adult height used for growth staging

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

// ---- leaf coupon ------------------------------------------------------------
// Ovate blade, +Y = length (toward tip), +X = width, +Z = top face (midrib up).
// Width profile is a beta-ish curve (max at ~37% of length) so the base and tip
// are rounded rather than the diamond of r0; a subtle margin ripple breaks the
// outline; wings fold into a shallow cup under a raised midrib; the tip curls
// gently downward (longitudinal droop).
function buildLeafGeometry(L, W, droop, ripplePhase) {
  const SEG = 4;
  const rows = SEG + 1;
  const vpr = 3; // left wing, midrib, right wing
  const C = 2.212; // normalizer for t^0.45 * (1-t)^0.75
  const positions = new Float32Array(rows * vpr * 3);
  const uvs = new Float32Array(rows * vpr * 2);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    let w = W * 0.5 * C * Math.pow(t, 0.45) * Math.pow(1 - t, 0.75);
    w *= 1 + 0.06 * Math.sin(t * Math.PI * 2.5 + ripplePhase);
    const y = t * L;
    const lift = Math.sin(Math.PI * t); // 0 at base/tip, 1 mid-blade
    const cup = 0.0016 * lift;          // transverse fold
    const rib = 0.0014 * lift;          // midrib ridge
    const bend = droop * t * t;         // tip curls toward -Z (underside)
    const i = r * vpr;
    positions[i * 3 + 0] = -w; positions[i * 3 + 1] = y; positions[i * 3 + 2] = -cup - bend;
    positions[i * 3 + 3] = 0;  positions[i * 3 + 4] = y; positions[i * 3 + 5] = rib - bend;
    positions[i * 3 + 6] = w;  positions[i * 3 + 7] = y; positions[i * 3 + 8] = -cup - bend;
    uvs[i * 2] = 0; uvs[i * 2 + 1] = t;
    uvs[(i + 1) * 2] = 0.5; uvs[(i + 1) * 2 + 1] = t;
    uvs[(i + 2) * 2] = 1; uvs[(i + 2) * 2 + 1] = t;
  }
  const indices = [];
  for (let r = 0; r < SEG; r++) {
    const a = r * vpr, b = (r + 1) * vpr;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
    indices.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeVertexNormals();
  return geom;
}

// Shared leaf placer: orients leaf length along `grow`, tips the top face toward
// world up, rolls around the length axis; applies per-leaf scale and a coherent
// height-graded colour (darker/lower, paler/newer at the tips).
function makePlacer(leaves, H, rng) {
  const dummy = new THREE.Object3D();
  const UP = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const dir = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const m = new THREE.Matrix4();
  let idx = 0;
  function leafColor(y) {
    const t = clamp01(y / H);
    const j = rng();
    const hue = 0.258 - 0.035 * t + (j - 0.5) * 0.02;
    const sat = 0.50 - 0.05 * t + (rng() - 0.5) * 0.04;
    const light = 0.34 + 0.22 * t + (rng() - 0.5) * 0.03;
    col.setHSL(hue, sat, light);
  }
  return {
    place(px, py, pz, grow, roll, scl) {
      if (py < 0.004) py = 0.004;
      dir.copy(grow);
      if (dir.lengthSq() < 1e-9) dir.set(0, 1, 0);
      dir.normalize();
      zAxis.copy(UP).addScaledVector(dir, -dir.dot(UP));
      if (zAxis.lengthSq() < 1e-8) zAxis.set(0, 0, 1);
      zAxis.normalize();
      xAxis.crossVectors(dir, zAxis).normalize();
      const cj = Math.cos(roll), sj = Math.sin(roll);
      const zx = zAxis.x * cj + xAxis.x * sj;
      const zy = zAxis.y * cj + xAxis.y * sj;
      const zz = zAxis.z * cj + xAxis.z * sj;
      zAxis.set(zx, zy, zz).normalize();
      xAxis.crossVectors(dir, zAxis).normalize();
      m.makeBasis(xAxis, dir, zAxis);
      dummy.position.set(px + dir.x * 0.004, py + dir.y * 0.004, pz + dir.z * 0.004);
      dummy.quaternion.setFromRotationMatrix(m);
      dummy.scale.setScalar(scl);
      dummy.updateMatrix();
      leaves.setMatrixAt(idx, dummy.matrix);
      leafColor(py);
      leaves.setColorAt(idx, col);
      idx += 1;
    },
    count() { return idx; },
  };
}

// ---- mature: one connected woody crown --------------------------------------
function buildMature(group, rng, H, age, seed) {
  const maturity = smoothstep(0.35, 1, age);
  const s = H / ADULT_HEIGHT; // growth length scale tracks height, not a mini-dense scale
  const children0 = Math.max(3, Math.round(lerp(3, 6, maturity)));
  const leafCount = Math.max(3, Math.round(lerp(3, 8, maturity)));
  const lowerPairs = Math.max(1, Math.round(lerp(1, 3, maturity)));

  const res = makeBranching({
    seed: seed * 1000 + 7,
    levels: 2,
    lengths: [0.09 * s, 0.22 * s, 0.17 * s, 0.05 * s],
    radii: [0.006, 0.55, 0.5, 0.4],
    children: [children0, 2, 0],
    angles: [0, 52, 40, 40],
    starts: [0, 0.14, 0.10, 0.2],
    gnarliness: [0.0005, 0.001, 0.0012, 0.001],
    leafCount,
  });

  const branchMat = new THREE.MeshStandardMaterial({ color: 0x6e5d46, roughness: 0.9, metalness: 0 });
  const branchMesh = new THREE.Mesh(res.geometry, branchMat);
  branchMesh.castShadow = true;
  branchMesh.receiveShadow = true;
  group.add(branchMesh);

  const leafGeom = buildLeafGeometry(0.045, 0.027, 0.0035, 0.9);
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });

  const numL1 = children0 + 1; // terminal continuation + `children0` side stems
  const total = res.sites.length + numL1 * lowerPairs * 2;
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, total);
  leaves.castShadow = true;
  leaves.receiveShadow = true;

  const placer = makePlacer(leaves, H, rng);
  const UP = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  const tangent = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const side = new THREE.Vector3();
  const dir = new THREE.Vector3();

  // Terminal twig leaves (EZ-Tree sites carry the twig tip frame).
  for (const site of res.sites) {
    q.setFromEuler(site.orientation);
    tangent.set(0, 1, 0).applyQuaternion(q);
    radial.set(site.origin.x, 0, site.origin.z);
    if (radial.lengthSq() < 1e-8) radial.set(1, 0, 0);
    radial.normalize();
    dir.copy(tangent).multiplyScalar(0.62).addScaledVector(radial, 0.28).addScaledVector(UP, 0.10).normalize();
    placer.place(site.origin.x, site.origin.y, site.origin.z, dir, rng() * Math.PI * 2, 0.75 + rng() * 0.5);
  }

  // Opposite pairs along the lower/level-1 stems fill the low-mid canopy.
  const l1 = res.branches.slice(1, 1 + numL1);
  for (const b of l1) {
    const secs = b.sections;
    for (let k = 0; k < lowerPairs; k++) {
      const si = Math.min(secs.length - 1, 1 + Math.floor(k * (secs.length - 2) / Math.max(1, lowerPairs - 1)));
      const sec = secs[si];
      tangent.set(0, 1, 0).applyEuler(sec.orientation).normalize();
      side.set(1, 0, 0).applyEuler(sec.orientation).normalize();
      radial.set(sec.origin.x, 0, sec.origin.z);
      if (radial.lengthSq() < 1e-8) radial.set(1, 0, 0);
      radial.normalize();
      for (const sg of [1, -1]) {
        dir.copy(tangent).multiplyScalar(0.45).addScaledVector(radial, 0.45).addScaledVector(side, 0.10 * sg).normalize();
        const ox = sec.origin.x + side.x * 0.010 * sg;
        const oy = sec.origin.y;
        const oz = sec.origin.z + side.z * 0.010 * sg;
        placer.place(ox, oy, oz, dir, (rng() - 0.5) * 1.4, 0.8 + rng() * 0.5);
      }
    }
  }

  leaves.count = placer.count();
  group.add(leaves);
}

// ---- juvenile: sparse seedling shoots (seedling exception, no tree helper) --
function buildJuvenile(group, rng, H) {
  const STEMS = 3;
  const stemGeom = new THREE.CylinderGeometry(0.0008, 0.0014, 1, 3, 1, true);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x7a8a4a, roughness: 0.85, metalness: 0 });
  const stems = new THREE.InstancedMesh(stemGeom, stemMat, STEMS);
  stems.castShadow = true;

  const leafGeom = buildLeafGeometry(0.016, 0.012, 0.002, 1.7); // rounder young blade
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, STEMS * 3);
  leaves.castShadow = true;
  leaves.receiveShadow = true;

  const placer = makePlacer(leaves, H, rng);
  const dummy = new THREE.Object3D();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const g = new THREE.Vector3();

  for (let i = 0; i < STEMS; i++) {
    const az = (i / STEMS) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const lean = 0.25 + rng() * 0.3;
    const r0 = Math.max(0.004, H * 0.22 * (0.3 + rng()));
    const bx = Math.cos(az) * r0, bz = Math.sin(az) * r0;
    const L = H * (0.85 + rng() * 0.25);
    dir.set(Math.cos(az) * Math.sin(lean), Math.cos(lean), Math.sin(az) * Math.sin(lean)).normalize();
    dummy.position.set(bx + dir.x * L * 0.5, dir.y * L * 0.5, bz + dir.z * L * 0.5);
    dummy.quaternion.setFromUnitVectors(Y_AXIS, dir);
    dummy.scale.set(1, L, 1);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);

    // one opposite pair partway up + a terminal leaf
    const f = 0.55;
    const px = bx + dir.x * L * f, py = dir.y * L * f, pz = bz + dir.z * L * f;
    const rl = Math.hypot(px, pz);
    const ox = rl < 1e-6 ? 1 : px / rl, oz = rl < 1e-6 ? 0 : pz / rl;
    for (const sg of [1, -1]) {
      g.set(dir.x * 0.5 + ox * 0.5 * sg, 0.4, dir.z * 0.5 + oz * 0.5 * sg).normalize();
      placer.place(px, py, pz, g, sg * 0.4 + (rng() - 0.5) * 0.3, 0.8 + rng() * 0.4);
    }
    const tx = bx + dir.x * L, ty = dir.y * L, tz = bz + dir.z * L;
    g.copy(dir).multiplyScalar(0.7).addScaledVector(UP, 0.3).normalize();
    placer.place(tx, ty, tz, g, rng() * Math.PI * 2, 0.9 + rng() * 0.3);
  }

  leaves.count = placer.count();
  group.add(stems, leaves);
}

export function createPlant({ height = 0.6, spread = 0.7, potDiameter = 0.3, seed = 1, width, depth } = {}) {
  const group = new THREE.Group();
  const rng = mulberry32(seed);
  const H = height;
  const age = clamp01(H / ADULT_HEIGHT);

  if (age < 0.35) {
    buildJuvenile(group, rng, H);
  } else {
    buildMature(group, rng, H, age, seed);
  }

  group.userData = {
    family: 'herb_bush',
    round: 1,
    age: +age.toFixed(3),
    hypothesis: 'connected_woody_crown_branching_with_instanced_ovate_leaves',
  };
  group.updateMatrixWorld(true);
  const maximum = new THREE.Box3().setFromObject(group).max.y;
  if (maximum > 0) group.scale.y = height / maximum;
  return group;
}
