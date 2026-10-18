import * as THREE from 'three';
import {makeBranching} from '/models/plants/_shared/branching.js';

// Deterministic PRNG (mulberry32) — same seed => same bed.
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Nominal adult plant height for this bed (~45 cm young pepper/tomato row).
// Relative age = height / ADULT_H drives juvenile vs mature topology.
const ADULT_H = 0.45;

// Elongated pointed blade silhouette (normalised half-widths, max 1.0 at ~1/3
// of length). A 4:1-ish length:width reads as a thin herb/vegetable leaf, not
// the previous diamond. Values stay as fractions so a single geometry supports
// per-instance width AND length variation via non-uniform scale.
const BLADE_HALFW = [0.04, 0.65, 1.0, 0.95, 0.70, 0.42, 0.10];
const PETIOLE_T = 0.16;   // petiole length as a fraction of blade length
const PETIOLE_HALFW = 0.14; // petiole stalk width relative to blade max width

// One leaf coupon: a short visible petiole (y<0) fused to an elongated pointed
// blade (y 0..1) with a midrib ridge, shallow V-fold and a downward-hanging tip.
// Blade +Y = tip direction, +X = width, +Z = upper (midrib-ridge) face. Base of
// the petiole (y = -PETIOLE_T) is the stem attachment point.
function buildLeafGeometry() {
  const petN = 2;
  const bladeN = BLADE_HALFW.length;
  const rows = petN + bladeN;
  const pos = new Float32Array(rows * 3 * 3);
  const uv = new Float32Array(rows * 3 * 2);
  for (let r = 0; r < rows; r++) {
    let y, w;
    if (r < petN) {
      y = -PETIOLE_T + PETIOLE_T * (r / (petN - 1));
      w = PETIOLE_HALFW;
    } else {
      const t = (r - petN) / (bladeN - 1);
      y = t;
      w = BLADE_HALFW[r - petN];
    }
    const bladeT = Math.max(0, y);           // fold/droop only on the blade
    const s = Math.sin(Math.PI * bladeT);
    const droop = Math.pow(bladeT, 2.0) * 0.18; // tip hangs down (local -Z)
    const midZ = s * 0.05 - droop;           // midrib ridge near base, droops at tip
    const edgeZ = -s * 0.02 - droop;         // edges slightly lower than midrib
    const i = r * 3;
    pos[i * 3 + 0] = -w; pos[i * 3 + 1] = y; pos[i * 3 + 2] = edgeZ;
    pos[i * 3 + 3] = 0;  pos[i * 3 + 4] = y; pos[i * 3 + 5] = midZ;
    pos[i * 3 + 6] = w;  pos[i * 3 + 7] = y; pos[i * 3 + 8] = edgeZ;
    uv[i * 2 + 0] = 0;   uv[i * 2 + 1] = y;
    uv[i * 2 + 2] = 0.5; uv[i * 2 + 3] = y;
    uv[i * 2 + 4] = 1;   uv[i * 2 + 5] = y;
  }
  const idx = [];
  for (let r = 0; r < rows - 1; r++) {
    const a = r * 3, b = (r + 1) * 3;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
    idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Bed layout, read left to right along the bed's long axis (+X). fx = fraction
// of usable soil width, fz = fraction of usable depth (staggered so roots and
// branch spread cross the bed, not one even line), hf = height factor, leafy =
// foliage density, lean/leanAz = slight bend of the whole shoot.
const LAYOUT = [
  { fx: -0.40, fz: -0.25, hf: 0.60, leafy: 1.00, lean: 0.10, leanAz: 2.6 }, // left cluster, short + leafy
  { fx: -0.25, fz: 0.28, hf: 0.85, leafy: 0.90, lean: 0.08, leanAz: 2.0 },
  { fx: 0.00, fz: -0.05, hf: 1.30, leafy: 0.35, lean: 0.05, leanAz: 3.4 },  // tall leggy centre, sparse
  { fx: 0.21, fz: 0.22, hf: 1.05, leafy: 0.55, lean: 0.09, leanAz: 1.2 },
  { fx: 0.33, fz: -0.22, hf: 0.85, leafy: 0.80, lean: 0.11, leanAz: 0.9 },
  { fx: 0.44, fz: 0.20, hf: 0.62, leafy: 1.00, lean: 0.13, leanAz: 1.6 },   // right cluster, short + leafy
];

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
  group.name = 'raised_planter';

  const bedW = width || 0.8;
  const bedD = depth || 0.35;
  const usableW = bedW * 0.94; // matches the soil slab inset
  const usableD = bedD * 0.86;
  const age = Math.max(0.05, Math.min(1.35, height / ADULT_H));
  const mature = age >= 0.5;

  // Light yellow-green family (older darker low leaves -> lighter new tips).
  const C_DARK = new THREE.Color(0x6a8c2e);
  const C_MID = new THREE.Color(0x8cab42);
  const C_TIP = new THREE.Color(0xbcd260);
  const C_YEL = new THREE.Color(0xc4c95a);

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x7a9a3a, roughness: 0.85 });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide,
  });

  // Scratch objects (allocated once).
  const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3();
  const tmpV3 = new THREE.Vector3(), tmpV4 = new THREE.Vector3();
  const tmpW = new THREE.Vector3(), tmpN = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const mPlant = new THREE.Matrix4(), mLocal = new THREE.Matrix4();
  const mRot = new THREE.Matrix4(), mScale = new THREE.Matrix4(), mTmp = new THREE.Matrix4();
  const dummy = new THREE.Object3D();

  const leafM = [], leafC = [];
  const stemM = []; // juvenile stem matrices
  const plantPos = [];

  function leafColor(yb) {
    const c = new THREE.Color();
    if (yb < 0.25 && rand() < 0.25) c.copy(C_YEL); // uneven yellowing on older low leaves
    else if (yb < 0.45) c.copy(C_DARK).lerp(C_MID, yb / 0.45);
    else c.copy(C_MID).lerp(C_TIP, (yb - 0.45) / 0.55);
    c.offsetHSL((rand() - 0.5) * 0.03, (rand() - 0.5) * 0.10, (rand() - 0.5) * 0.06);
    return c;
  }

  // Place one leaf instance (world matrix = mPlant * local). `node` is the
  // attachment point in plant-local space, `dirIn` the local shoot direction.
  // The leaf is tilted downward out of the shoot axis, azimuth-jittered, then
  // rolled; length and half-width vary independently.
  function addLeaf(node, dirIn, leafLen, yb) {
    const droop = (dirIn.y > 0.5 ? 0.45 : 0.15) * (0.5 + rand() * 0.5);
    tmpV.copy(dirIn).add(tmpV2.set(0, -droop, 0)).normalize();
    tmpV.x += (rand() - 0.5) * 0.22;
    tmpV.z += (rand() - 0.5) * 0.22;
    tmpV.normalize();
    tmpW.set(-tmpV.z, 0, tmpV.x);
    if (tmpW.lengthSq() < 1e-6) tmpW.set(1, 0, 0); else tmpW.normalize();
    tmpN.crossVectors(tmpV, tmpW).normalize();
    mRot.makeBasis(tmpW, tmpV, tmpN);
    const halfW = leafLen * (0.11 + rand() * 0.05);
    dummy.position.copy(node).addScaledVector(tmpV, leafLen * PETIOLE_T);
    dummy.quaternion.setFromRotationMatrix(mRot);
    dummy.rotateY((rand() - 0.5) * 1.5);
    dummy.scale.set(halfW, leafLen, halfW);
    dummy.updateMatrix();
    mLocal.copy(mPlant).multiply(dummy.matrix);
    leafM.push(mLocal.clone());
    leafC.push(leafColor(yb));
  }

  for (let i = 0; i < LAYOUT.length; i++) {
    const L = LAYOUT[i];
    const x = L.fx * usableW + (rand() - 0.5) * 0.02;
    const z = L.fz * usableD + (rand() - 0.5) * 0.02;
    const hf = L.hf * (0.94 + rand() * 0.12);
    const plantH = height * hf;
    const lean = L.lean * (0.8 + rand() * 0.4);
    const leanAz = L.leanAz + (rand() - 0.5) * 0.5;
    tmpQ.setFromAxisAngle(
      new THREE.Vector3(-Math.sin(leanAz), 0, Math.cos(leanAz)),
      lean,
    );
    mPlant.makeTranslation(x, 0, z).multiply(mRot.makeRotationFromQuaternion(tmpQ));
    plantPos.push({ x, z, plantH });

    if (mature) {
      // Genuinely branching young herb shoot: connected tapered trunk + low
      // side branches from the pinned EZ-Tree adapter. Foliage density, branch
      // count and leaf count all scale with the plant's leafy factor.
      const children = L.leafy >= 0.75 ? 3 : 2;
      const leafCount = L.leafy >= 0.75 ? 2 : 1;
      const brSeed = 1 + Math.floor(rand() * 1000000);
      const { geometry, branches, sites } = makeBranching({
        seed: brSeed,
        levels: 2,
        lengths: [plantH * 0.5, plantH * 0.28, plantH * 0.12, plantH * 0.05],
        radii: [plantH * 0.009, 0.5, 0.5, 0.4],
        children: [children, 0, 0, 0],
        angles: [0, 52, 50, 40],
        starts: [0, 0.16, 0.25, 0.2], // side branches begin low => foliage near bed
        gnarliness: [0.0012, 0.0028, 0.0028, 0.0012],
        leafCount,
      });

      const pg = new THREE.Group();
      pg.name = 'shoot_' + i;
      pg.position.set(x, 0, z);
      pg.quaternion.copy(tmpQ);
      pg.add(new THREE.Mesh(geometry, stemMat));
      group.add(pg);

      // Real leaf coupon replaces the library leaf quads at terminal sites.
      for (const s of sites) {
        const dir = tmpV2.set(0, 1, 0).applyEuler(s.orientation);
        const leafLen = plantH * 0.13 * (0.75 + rand() * 0.5);
        addLeaf(s.origin, dir, leafLen, Math.max(0, Math.min(1, s.origin.y / plantH)));
      }

      // Extra basal leaves along the low trunk for the dense low row.
      const trunk = branches[0].sections;
      const nBasal = Math.max(1, Math.round(L.leafy * 2));
      for (let k = 0; k < nBasal; k++) {
        const frac = 0.10 + 0.28 * (k / Math.max(1, nBasal - 1)) + (rand() - 0.5) * 0.04;
        const idx = Math.max(0, Math.min(trunk.length - 2, Math.floor(frac * (trunk.length - 1))));
        const node = tmpV3.copy(trunk[idx].origin).lerp(trunk[idx + 1].origin, 0.5);
        const dir = tmpV4.copy(trunk[idx + 1].origin).sub(trunk[idx].origin).normalize();
        const az = k * 2.4 + rand() * 1.2;
        dir.x += Math.cos(az) * 0.55;
        dir.z += Math.sin(az) * 0.55;
        dir.y += 0.2;
        dir.normalize();
        const leafLen = plantH * 0.13 * (0.8 + rand() * 0.4);
        addLeaf(node, dir, leafLen, Math.max(0, Math.min(1, node.y / plantH)));
      }
    } else {
      // Juvenile (seedling): short simple tapered stem, a few young leaves near
      // the tip, no lateral branching. Distinct sparse topology, not a scaled
      // adult canopy.
      const sr = plantH * 0.007;
      stemM.push(mTmp.copy(mPlant).multiply(
        new THREE.Matrix4().makeTranslation(0, plantH / 2, 0)
          .multiply(mScale.makeScale(sr, plantH, sr)),
      ));
      const nLeaves = 2 + Math.floor(rand() * 3); // 2..4 true leaves
      const phi0 = rand() * Math.PI * 2;
      for (let k = 0; k < nLeaves; k++) {
        const f = 0.42 + 0.5 * (k / Math.max(1, nLeaves - 1)) + (rand() - 0.5) * 0.06;
        const node = tmpV3.set(0, plantH * f, 0);
        const elev = 0.3 + 0.4 * (k / Math.max(1, nLeaves - 1)) + (rand() - 0.5) * 0.15;
        const az = phi0 + k * 2.4 + (rand() - 0.5) * 0.4;
        const dir = tmpV4.set(
          Math.cos(az) * Math.cos(elev),
          Math.sin(elev) + 0.35,
          Math.sin(az) * Math.cos(elev),
        ).normalize();
        const leafLen = plantH * 0.20 * (0.75 + rand() * 0.5); // young proportions
        addLeaf(node, dir, leafLen, f);
      }
    }
  }

  // Foliage (single instanced mesh; instance colour supplies the yellow-green
  // variation, older darker low leaves -> lighter new tips).
  const leafGeom = buildLeafGeometry();
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, leafM.length);
  leafM.forEach((m, i) => leaves.setMatrixAt(i, m));
  leafC.forEach((c, i) => leaves.setColorAt(i, c));
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  leaves.name = 'foliage';
  group.add(leaves);

  // Juvenile stems (instanced tapered cylinders).
  if (stemM.length) {
    const jStemGeom = new THREE.CylinderGeometry(0.4, 1, 1, 5, 1, true);
    const jStems = new THREE.InstancedMesh(jStemGeom, stemMat, stemM.length);
    stemM.forEach((m, i) => jStems.setMatrixAt(i, m));
    jStems.instanceMatrix.needsUpdate = true;
    jStems.name = 'seedling_stems';
    group.add(jStems);
  }

  // Two slender rigid green stakes beside the tallest shoots (adult only).
  if (mature) {
    const stakeGeom = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    const stakeMat = new THREE.MeshStandardMaterial({ color: 0x3e7d3a, roughness: 0.6 });
    const stakes = new THREE.InstancedMesh(stakeGeom, stakeMat, 2);
    const stakeAt = [2, 3];
    for (let s = 0; s < 2; s++) {
      const p = plantPos[stakeAt[s]];
      const sh = p.plantH * 1.3;
      mTmp.makeTranslation(p.x + 0.03, sh / 2 - 0.02, p.z + 0.01)
        .multiply(mRot.makeRotationX(0.03))
        .multiply(mScale.makeScale(0.004, sh, 0.004));
      stakes.setMatrixAt(s, mTmp);
    }
    stakes.instanceMatrix.needsUpdate = true;
    stakes.name = 'stakes';
    group.add(stakes);
  }

  group.userData = {
    family: 'raised_planter',
    hypothesis: 'connected_branch_leaf_juvenile_reconstruction',
    adultHeight: ADULT_H,
    age,
    mature,
  };
  return group;
}
