// Pepper (Capsicum annuum), round 1 — reference-specific reconstruction.
//
// Declared physical hypothesis: the photographed specimen is a SPARSE, LEGGY
// young chili/bell pepper on a bamboo stake, not a full dense shrub. Its
// silhouette is a single tapered leader that keeps rising (EZ-Tree terminal
// continuations) while a few uneven lateral shoots leave low and mid-stem, each
// carrying 1-2 irregular pointed leaves and ending in a slender twig. Foliage
// is redistributed DOWN the stem into distinct gapped shoots rather than a
// top-heavy crown. Leaves are narrow/ovate lanceolate blades with indented,
// irregular margins, a raised midrib and shallow cup. NO fruit/flowers are
// invented (absent from the reference crop). Juvenile topology is a different
// organism, not a scaled adult: one short stem with 3-4 relatively large young
// leaves and no branching.
//
// Uses the pinned MIT EZ-Tree branching adapter for the genuinely branching
// herb stem; leaf coupons and petioles are authored here.

import * as THREE from 'three';
import { makeBranching } from '/models/plants/_shared/branching.js';

// Family adult height (metres): the reference plant is ~60 cm.
const ADULT_HEIGHT = 0.6;

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Irregular lanceolate/ovate half-width profiles (peak ~0.5, length = 1).
// Shallow indents at t~0.64 give the "conspicuously irregular, indented
// margin" the reference shows, instead of one smooth teardrop outline.
const NARROW = [0.0, 0.06, 0.15, 0.24, 0.33, 0.4, 0.44, 0.38, 0.43, 0.34, 0.15, 0.03];
const BROAD = [0.0, 0.09, 0.2, 0.32, 0.42, 0.47, 0.49, 0.43, 0.46, 0.34, 0.17, 0.04];

// Folded leaf coupon: length 1 along +Y (petiole at y=0, pointed tip at y=1),
// width along +X, raised midrib, cupped edges, tip droop and a gentle lengthwise
// twist. 11 segments, 3 vertices/row (left edge, midrib, right edge).
function buildLeafGeometry(halfWidths, opts = {}) {
  const { droop = 0.0, cup = 0.04, vein = 0.05, twist = 0.0 } = opts;
  const SEG = halfWidths.length - 1;
  const rows = SEG + 1;
  const pos = new Float32Array(rows * 3 * 3);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    const hw = halfWidths[r];
    const s = Math.sin(Math.PI * t);
    const bow = -droop * t * t;   // tip sags toward -Z
    const midZ = bow + vein * s;  // raised central vein
    const edgeZ = bow - cup * s;  // cupped edges
    const y = t;
    const ang = twist * t;        // roll the blade along its length
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const xs = [-hw, 0, hw];
    const zs = [edgeZ, midZ, edgeZ];
    for (let k = 0; k < 3; k++) {
      const x = xs[k], z = zs[k];
      const i = (r * 3 + k) * 3;
      pos[i] = x * ca - z * sa;
      pos[i + 1] = y;
      pos[i + 2] = x * sa + z * ca;
    }
  }
  const idx = [];
  for (let r = 0; r < SEG; r++) {
    const a = r * 3, b = (r + 1) * 3;
    idx.push(a, a + 1, b, b, a + 1, b + 1);       // left -> midrib
    idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2); // midrib -> right
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Unit vector perpendicular to `dir`, at azimuth `az` around `dir`.
function perpAtAz(dir, az) {
  const ref = Math.abs(dir.y) < 0.99 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const v = new THREE.Vector3().crossVectors(u, dir).normalize();
  return u.multiplyScalar(Math.cos(az)).addScaledVector(v, Math.sin(az)).normalize();
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
  group.name = 'pepper';

  // Relative age; bounded so extremes don't collapse or explode the plant.
  const age = Math.min(1, Math.max(0.05, height / ADULT_HEIGHT));
  const isSapling = age < 0.3;

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4e6b38, roughness: 0.9, metalness: 0 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, side: THREE.DoubleSide });
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0x828f4f, roughness: 0.9, metalness: 0 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x5b6b45, roughness: 0.95, metalness: 0 });

  const leaves = [];   // {px..sz, len, width, variant, color}
  const petioles = []; // {p0, p1, r}

  // Muted gray-green foliage; older lower leaves darker/less saturated, young
  // tips lighter. Restrained per-instance jitter only.
  function leafColor(yFrac) {
    const hue = 0.31 - yFrac * 0.02 + (rand() - 0.5) * 0.02;
    const sat = 0.36 - yFrac * 0.08 + (rand() - 0.5) * 0.05;
    let light = 0.29 + yFrac * 0.06 + (rand() - 0.5) * 0.04;
    light = Math.min(0.4, Math.max(0.27, light));
    return new THREE.Color().setHSL(hue, sat, light);
  }

  // Place one leaf at attachment point P whose shoot direction is `shootDir`.
  // Leaf length axis tilts outward from the shoot, blade face roughly up with
  // a wide random roll, and a short petiole separates blade base from stem.
  function addLeaf(P, shootDir, o) {
    const az = rand() * Math.PI * 2;
    const rad = perpAtAz(shootDir, az);
    const elev = o.elevMin + rand() * (o.elevMax - o.elevMin);
    const ldir = new THREE.Vector3()
      .addScaledVector(rad, Math.cos(elev))
      .addScaledVector(shootDir, Math.sin(elev))
      .normalize();
    let n = new THREE.Vector3().copy(shootDir).addScaledVector(ldir, -shootDir.dot(ldir));
    if (n.lengthSq() < 1e-8) n.set(0, 0, 1); else n.normalize();
    n.applyAxisAngle(ldir, (rand() - 0.5) * 2.6); // varied facing / droop
    const side = new THREE.Vector3().crossVectors(ldir, n).normalize();

    const len = o.sizeMin + rand() * (o.sizeMax - o.sizeMin);
    const widthRatio = o.widthRatio + (rand() - 0.5) * o.widthVar;
    const petLen = 0.006 + rand() * 0.008;
    const base = new THREE.Vector3().copy(P).addScaledVector(ldir, petLen);

    leaves.push({
      px: base.x, py: base.y, pz: base.z,
      lx: ldir.x, ly: ldir.y, lz: ldir.z,
      nx: n.x, ny: n.y, nz: n.z,
      sx: side.x, sy: side.y, sz: side.z,
      len, width: len * widthRatio,
      variant: o.variant, color: leafColor(o.yFrac),
    });
    petioles.push({ p0: P.clone(), p1: base.clone(), r: 0.001 + rand() * 0.0004 });
  }

  // --- branch skeleton (EZ-Tree, metre units) ---
  const nLateral = isSapling ? 0 : (age < 0.6 ? 2 : 4);
  const nSecondary = isSapling ? 0 : 1;
  const levels = isSapling ? 1 : 2;
  const r0 = 0.0014 + 0.0042 * age; // trunk base radius, thicker when older

  const { geometry: branchGeom, branches: skelBranches } = makeBranching({
    seed: Math.floor(seed),
    levels,
    lengths: [height * 0.52, height * 0.3, height * 0.18, 0.02],
    radii: [r0, 0.55, 0.6, 0.5],
    children: [nLateral, nSecondary, 0],
    angles: [0, 36, 40, 38],
    starts: [0, 0.3, 0.22, 0.22],
    gnarliness: [0.0008, 0.004, 0.005, 0.002],
    leafCount: 1,
  });

  const branchMesh = new THREE.Mesh(branchGeom, stemMat);
  branchMesh.name = 'pepper_branches';
  group.add(branchMesh);

  // skeleton.branches order is BFS: [trunk, level1 (terminal leader + laterals), level2...]
  const Y = new THREE.Vector3(0, 1, 0);
  const secDir = (sec) => Y.clone().applyEuler(sec.orientation).normalize();
  const frac = (y) => Math.min(1, Math.max(0, y / height));

  const leafAt = (sec, o) => addLeaf(sec.origin, secDir(sec), { ...o, yFrac: frac(sec.origin.y) });

  if (isSapling) {
    // Juvenile: single short stem, 3 relatively large leaves, no branching.
    const trunk = skelBranches[0];
    const n = 3;
    for (let i = 0; i < n; i++) {
      const f = 0.35 + i * (0.55 / Math.max(1, n - 1)) + (rand() - 0.5) * 0.06;
      const idx = Math.min(trunk.sections.length - 1, Math.floor(f * (trunk.sections.length - 1)));
      leafAt(trunk.sections[idx], {
        sizeMin: height * 0.5, sizeMax: height * 0.62,
        widthRatio: 0.46, widthVar: 0.06,
        elevMin: -0.15, elevMax: 0.35,
        variant: rand() < 0.5 ? 0 : 1,
      });
    }
  } else {
    // Trunk (index 0): a few leaves on the upper half; bare lower stem.
    const trunk = skelBranches[0];
    const nTrunk = 4;
    for (let i = 0; i < nTrunk; i++) {
      const f = 0.45 + i * (0.5 / Math.max(1, nTrunk - 1)) + (rand() - 0.5) * 0.05;
      const idx = Math.min(trunk.sections.length - 1, Math.floor(f * (trunk.sections.length - 1)));
      leafAt(trunk.sections[idx], {
        sizeMin: height * 0.1, sizeMax: height * 0.14,
        widthRatio: 0.36, widthVar: 0.05,
        elevMin: -0.1, elevMax: 0.5,
        variant: rand() < 0.5 ? 0 : 1,
      });
    }

    // Level-1 branches: terminal leader + lateral shoots, 2 leaves each.
    const nL1 = 1 + nLateral;
    for (let b = 1; b <= nL1; b++) {
      const branch = skelBranches[b];
      for (let i = 0; i < 2; i++) {
        const f = 0.5 + i * 0.45 + (rand() - 0.5) * 0.08;
        const idx = Math.min(branch.sections.length - 1, Math.floor(f * (branch.sections.length - 1)));
        leafAt(branch.sections[idx], {
          sizeMin: height * 0.09, sizeMax: height * 0.12,
          widthRatio: 0.38, widthVar: 0.06,
          elevMin: -0.15, elevMax: 0.45,
          variant: rand() < 0.5 ? 0 : 1,
        });
      }
    }

    // Level-2 twigs: one terminal leaf each.
    for (let b = nL1 + 1; b < skelBranches.length; b++) {
      const branch = skelBranches[b];
      leafAt(branch.sections[branch.sections.length - 1], {
        sizeMin: height * 0.07, sizeMax: height * 0.1,
        widthRatio: 0.34, widthVar: 0.05,
        elevMin: 0.0, elevMax: 0.5,
        variant: rand() < 0.5 ? 0 : 1,
      });
    }
  }

  // --- leaf instanced meshes (narrow vs broad silhouettes) ---
  const leafGeomNarrow = buildLeafGeometry(NARROW, { droop: 0.03, cup: 0.04, vein: 0.05, twist: 0.1 });
  const leafGeomBroad = buildLeafGeometry(BROAD, { droop: 0.02, cup: 0.035, vein: 0.05, twist: 0.06 });
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

  function assembleLeafMesh(geom, list, name) {
    const mesh = new THREE.InstancedMesh(geom, leafMat, list.length);
    mesh.name = name;
    for (let i = 0; i < list.length; i++) {
      const L = list[i];
      v1.set(L.sx, L.sy, L.sz);
      v2.set(L.lx, L.ly, L.lz);
      v3.set(L.nx, L.ny, L.nz);
      m4.makeBasis(v1, v2, v3);
      m4.setPosition(L.px, L.py, L.pz);
      s3.set(L.width, L.len, L.len);
      m4.scale(s3);
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, L.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  const narrow = leaves.filter((l) => l.variant === 0);
  const broad = leaves.filter((l) => l.variant === 1);
  if (narrow.length) group.add(assembleLeafMesh(leafGeomNarrow, narrow, 'pepper_leaves_narrow'));
  if (broad.length) group.add(assembleLeafMesh(leafGeomBroad, broad, 'pepper_leaves_broad'));

  // --- petioles (thin tapered cylinders from stem to blade base) ---
  const petGeom = new THREE.CylinderGeometry(1, 1, 1, 4, 1, true);
  petGeom.translate(0, 0.5, 0);
  const petMesh = new THREE.InstancedMesh(petGeom, stemMat, petioles.length);
  petMesh.name = 'pepper_petioles';
  const dir3 = new THREE.Vector3();
  for (let i = 0; i < petioles.length; i++) {
    const b = petioles[i];
    dir3.subVectors(b.p1, b.p0);
    const len = dir3.length();
    dir3.normalize();
    q4.setFromUnitVectors(Y, dir3);
    p3.copy(b.p0);
    s3.set(b.r, len, b.r);
    m4.compose(p3, q4, s3);
    petMesh.setMatrixAt(i, m4);
  }
  group.add(petMesh);

  // --- slim green bamboo stake + twine ties (kept subtle, not dominant) ---
  if (!isSapling) {
    const stakeH = height * 0.82;
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.004, stakeH, 6, 1, false), stakeMat);
    stake.name = 'pepper_stake';
    stake.position.set(0.022, stakeH / 2, 0.012);
    stake.rotation.z = -0.04;
    stake.rotation.x = 0.02;
    group.add(stake);
    for (const ty of [height * 0.3, height * 0.52]) {
      const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.042, 5), tieMat);
      tie.position.set(0.011, ty, 0.006);
      tie.rotation.z = Math.PI / 2;
      group.add(tie);
    }
  }

  group.userData = {
    family: 'pepper',
    age,
    isSapling,
    branchLevels: levels,
    leafCount: leaves.length,
  };

  // --- normalise to requested height (above soil) and spread ---
  const box = new THREE.Box3().setFromObject(group);
  const minY = box.min.y;
  const plantH = Math.max(1e-4, box.max.y - minY);
  const plantW = Math.max(1e-4, box.max.x - box.min.x, box.max.z - box.min.z);
  let s = height / plantH;
  if (plantW * s > spread) s = spread / plantW;
  group.position.y = -minY * s;
  group.scale.setScalar(s);

  return group;
}
