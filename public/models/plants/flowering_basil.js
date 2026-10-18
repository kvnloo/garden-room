import * as THREE from 'three';

// Flowering holy basil (Ocimum tenuiflorum) ~60 cm tall, ~70 cm wide: a dense,
// tangled, many-branched rounded bush (much wider than tall) of small bright
// yellow-green ovate leaves in opposite pairs along slender stems, with a dense
// sprawling spray of slender UPRIGHT flower spikes poking out all over the crown.
// Each spike is a thin green-purple stalk (never a cone) bearing closely spaced
// whorls of tiny muted mauve/purple/off-white florets along its upper half.
// Deterministic via mulberry32(seed).

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- small ovate leaf: rounded shoulders, tapered pointed tip, bow ---------
const LEAF_SEGMENTS = 3;
const LEAF_LENGTH = 0.05;
const LEAF_MAX_HALF_W = 0.0145;

// Teardrop ovate: width peaks at ~1/3 (rounded shoulder) and tapers to a point.
function leafHalfWidth(t) {
  const peak = 0.424;
  return LEAF_MAX_HALF_W * Math.pow(t, 0.45) * Math.pow(1 - t, 0.9) / peak;
}

function buildLeafGeometry() {
  const rows = LEAF_SEGMENTS + 1;
  const vpr = 3; // left wing, central rib, right wing
  const positions = new Float32Array(rows * vpr * 3);
  const uvs = new Float32Array(rows * vpr * 2);
  for (let r = 0; r < rows; r++) {
    const t = r / LEAF_SEGMENTS;
    const w = leafHalfWidth(t);
    const y = t * LEAF_LENGTH;
    const s = Math.sin(t * Math.PI);
    const bow = s * 0.007;         // lengthwise bow
    const arch = bow + s * 0.0035; // raised midrib
    const edge = bow - s * 0.004;  // curled edges
    const i = r * vpr;
    positions[i * 3] = -w; positions[i * 3 + 1] = y; positions[i * 3 + 2] = edge;
    positions[i * 3 + 3] = 0;  positions[i * 3 + 4] = y; positions[i * 3 + 5] = arch;
    positions[i * 3 + 6] = w;  positions[i * 3 + 7] = y; positions[i * 3 + 8] = edge;
    uvs[i * 2] = 0; uvs[i * 2 + 1] = t;
    uvs[(i + 1) * 2] = 0.5; uvs[(i + 1) * 2 + 1] = t;
    uvs[(i + 2) * 2] = 1; uvs[(i + 2) * 2 + 1] = t;
  }
  const indices = [];
  for (let r = 0; r < LEAF_SEGMENTS; r++) {
    const a = r * vpr, b = (r + 1) * vpr;
    indices.push(a, a + 1, b, b, a + 1, b + 1);
    indices.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
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
  const H = height;
  // The real bush is ~70 cm wide on a ~35 cm pot (~2x pot diameter), i.e. wider
  // than tall; honor that even when the caller passes a narrower spread.
  const R = Math.max(spread * 0.5, H * 0.583);
  const s = H / 0.6; // scale factor so proportions hold at any height

  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.DoubleSide,
  });
  const leafGeom = buildLeafGeometry();

  // ---- stems -------------------------------------------------------------
  const STEM_COUNT = 40;
  const NODE_S = [0.18, 0.55, 0.85];
  const TERMINAL = 2;
  const LEAF_COUNT = STEM_COUNT * (NODE_S.length * 2 + TERMINAL);

  const stemGeom = new THREE.CylinderGeometry(0.001, 0.0024, 1, 3, 1, true);
  stemGeom.translate(0, 0.5, 0);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x5a7040, roughness: 0.85, metalness: 0 });
  const stems = new THREE.InstancedMesh(stemGeom, stemMat, STEM_COUNT);

  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, LEAF_COUNT);

  const dummy = new THREE.Object3D();
  const UP = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const side = new THREE.Vector3();
  const xVec = new THREE.Vector3();
  const zVec = new THREE.Vector3();
  const zRot = new THREE.Vector3();
  const xRot = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const col = new THREE.Color();
  const growA = new THREE.Vector3();
  const growB = new THREE.Vector3();

  let leafIdx = 0;
  function placeLeaf(px, py, pz, grow, roll) {
    dir.copy(grow).normalize();
    radial.set(px, 0, pz);
    if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
    radial.normalize();
    const d = dir.dot(radial);
    zVec.set(radial.x - dir.x * d, -dir.y * d, radial.z - dir.z * d);
    if (zVec.lengthSq() < 1e-8) zVec.set(0, 0, 1);
    zVec.normalize();
    xVec.crossVectors(dir, zVec).normalize();
    const cj = Math.cos(roll), sj = Math.sin(roll);
    zRot.set(zVec.x * cj + xVec.x * sj, zVec.y * cj + xVec.y * sj, zVec.z * cj + xVec.z * sj).normalize();
    xRot.crossVectors(dir, zRot).normalize();
    rot.makeBasis(xRot, dir, zRot);
    dummy.position.set(px + dir.x * 0.005, py + dir.y * 0.005, pz + dir.z * 0.005);
    dummy.quaternion.setFromRotationMatrix(rot);
    dummy.scale.setScalar(s * (0.7 + rand() * 0.7)); // wider size range
    dummy.updateMatrix();
    leaves.setMatrixAt(leafIdx, dummy.matrix);
    // fresh yellow-green .. medium green .. occasional wilted yellow
    const kind = rand();
    if (kind < 0.6) col.setHSL(0.28 + rand() * 0.05, 0.52 + rand() * 0.12, 0.46 + rand() * 0.1);
    else if (kind < 0.9) col.setHSL(0.30 + rand() * 0.05, 0.44 + rand() * 0.12, 0.36 + rand() * 0.1);
    else col.setHSL(0.16 + rand() * 0.03, 0.4 + rand() * 0.1, 0.45 + rand() * 0.08);
    leaves.setColorAt(leafIdx, col);
    leafIdx += 1;
  }

  const rRoot = R * 0.42;
  for (let i = 0; i < STEM_COUNT; i++) {
    const r0 = rRoot * Math.sqrt(rand());
    const phi0 = rand() * Math.PI * 2;
    const bx = Math.cos(phi0) * r0, bz = Math.sin(phi0) * r0;

    let L = H * (0.30 + 0.26 * rand()) * (1 - 0.24 * (r0 / rRoot));
    let lean = (0.06 + 0.55 * (r0 / rRoot)) * (0.55 + rand() * 0.85);
    let sprawl = false;
    if (rand() < 0.15) { L *= 1.35; lean = 0.8 + rand() * 0.5; sprawl = true; } // near-horizontal shoots
    else if (rand() < 0.12) { L *= 1.3; lean *= 0.35; } // tall upright outliers

    const leanDir = phi0 + (rand() - 0.5) * 1.3;
    const sinL = Math.sin(lean), cosL = Math.cos(lean);
    const ox = Math.cos(leanDir), oz = Math.sin(leanDir);
    const dx = ox * sinL * L;
    const dy = cosL * L;
    const dz = oz * sinL * L;
    const tx = bx + dx, ty = dy, tz = bz + dz;
    const len = Math.hypot(dx, dy, dz) || 1e-4;

    dummy.position.set(bx + dx * 0.5, dy * 0.5, bz + dz * 0.5);
    dummy.quaternion.setFromUnitVectors(UP, dir.set(dx / len, dy / len, dz / len));
    dummy.scale.set(1, len, 1);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);

    for (const ns0 of NODE_S) {
      const ns = ns0 + (rand() - 0.5) * 0.07;
      const px = bx + dx * ns, py = dy * ns, pz = bz + dz * ns;
      const tH = Math.min(1, Math.max(0, py / H));
      radial.set(px, 0, pz);
      if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
      radial.normalize();
      // varied orientation: mostly up-out, some droop / near-horizontal
      const droop = sprawl ? 0.25 + rand() * 0.45 : 0.4 + rand() * 0.9;
      dir.set(radial.x * (1 - 0.5 * tH), (0.35 + 0.65 * tH) * droop, radial.z * (1 - 0.5 * tH)).normalize();
      side.crossVectors(UP, dir);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      growA.copy(dir).addScaledVector(side, 0.3).normalize();
      growB.copy(dir).addScaledVector(side, -0.3).normalize();
      const off = 0.011 * s;
      placeLeaf(px + side.x * off, py, pz + side.z * off, growA, 0.3 + rand() * 0.4);
      placeLeaf(px - side.x * off, py, pz - side.z * off, growB, -0.3 - rand() * 0.4);
    }

    radial.set(tx, 0, tz);
    if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
    radial.normalize();
    for (let k = 0; k < TERMINAL; k++) {
      const ang = (k / TERMINAL) * Math.PI * 2 + rand() * 0.7;
      const c = Math.cos(ang), sn = Math.sin(ang);
      growA.set(radial.x * 0.55 + c * 0.45, 0.55 + rand() * 0.35, radial.z * 0.55 + sn * 0.45).normalize();
      placeLeaf(tx, ty, tz, growA, ang);
    }
  }
  leaves.count = LEAF_COUNT;
  stems.instanceMatrix.needsUpdate = true;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(stems);
  group.add(leaves);

  // ---- pale woody basal stems --------------------------------------------
  const basalMat = new THREE.MeshStandardMaterial({ color: 0x7a6a48, roughness: 0.9, metalness: 0 });
  const basalGeom = new THREE.CylinderGeometry(0.0016, 0.004, 1, 4, 1, true);
  basalGeom.translate(0, 0.5, 0);
  const BASAL_COUNT = 5;
  const basal = new THREE.InstancedMesh(basalGeom, basalMat, BASAL_COUNT);
  for (let i = 0; i < BASAL_COUNT; i++) {
    const az = (i / BASAL_COUNT) * Math.PI * 2 + rand() * 0.8;
    const bx = Math.cos(az) * 0.02, bz = Math.sin(az) * 0.02;
    const len = H * (0.3 + 0.15 * rand());
    dummy.position.set(bx, len * 0.5, bz);
    dummy.quaternion.identity();
    dummy.scale.set(1, len, 1);
    dummy.updateMatrix();
    basal.setMatrixAt(i, dummy.matrix);
  }
  group.add(basal);

  // ---- flower spikes: dense sprawling spray of thin stalks + whorls --------
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0x4a5a36, roughness: 0.8, metalness: 0 });
  const stalkGeom = new THREE.CylinderGeometry(0.001, 0.0028, 1, 5, 1, true);
  stalkGeom.translate(0, 0.5, 0);
  const flowerMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
  const flowerGeom = new THREE.TetrahedronGeometry(0.005, 0);

  const SPIKE_COUNT = 42;
  const WHORLS = 4, FLOWERS_PER_WHORL = 2;
  const spikes = new THREE.InstancedMesh(stalkGeom, stalkMat, SPIKE_COUNT);
  const flowers = new THREE.InstancedMesh(flowerGeom, flowerMat, SPIKE_COUNT * WHORLS * FLOWERS_PER_WHORL);

  const mauve = new THREE.Color(0xa08ba6);
  const purple = new THREE.Color(0x8f759e);
  const offWhite = new THREE.Color(0xd6d0c8);
  const side1 = new THREE.Vector3();
  const side2 = new THREE.Vector3();
  const flowerCol = new THREE.Color();

  let flowerIdx = 0;
  for (let i = 0; i < SPIKE_COUNT; i++) {
    const az = rand() * Math.PI * 2;
    const rb = R * (0.04 + 0.5 * Math.sqrt(rand()));
    const bx = Math.cos(az) * rb, bz = Math.sin(az) * rb;
    const by = H * (0.30 + 0.26 * rand());
    const lean = (0.06 + 0.40 * (rb / R) + rand() * 0.06) * s;
    const la = az + (rand() - 0.5) * 0.9;
    const sdx = Math.cos(la) * Math.sin(lean);
    const sdy = Math.cos(lean);
    const sdz = Math.sin(la) * Math.sin(lean);
    const sdir = new THREE.Vector3(sdx, sdy, sdz).normalize();

    let L = H * (0.22 + 0.22 * rand());
    const tipY = by + sdir.y * L;
    if (tipY > H * 0.96) L = (H * 0.96 - by) / sdir.y;

    dummy.position.set(bx, by, bz);
    dummy.quaternion.setFromUnitVectors(UP, sdir);
    dummy.scale.set(1, L, 1);
    dummy.updateMatrix();
    spikes.setMatrixAt(i, dummy.matrix);

    const ax = Math.abs(sdir.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    side1.crossVectors(sdir, ax).normalize();
    side2.crossVectors(sdir, side1).normalize();

    for (let w = 0; w < WHORLS; w++) {
      const f = 0.42 + w * 0.17; // closely spaced whorls along the upper stalk
      const cx = bx + sdir.x * f * L;
      const cy = by + sdir.y * f * L;
      const cz = bz + sdir.z * f * L;
      const off = 0.005 * s;
      for (let k = 0; k < FLOWERS_PER_WHORL; k++) {
        const pv = k === 0 ? side1 : side2;
        dummy.position.set(cx + pv.x * off, cy + pv.y * off, cz + pv.z * off);
        dummy.quaternion.identity();
        dummy.scale.setScalar(s * (0.8 + rand() * 0.5) * (1 - w * 0.13)); // taper to tip
        dummy.updateMatrix();
        flowers.setMatrixAt(flowerIdx, dummy.matrix);
        const kind = rand();
        flowerCol.copy(kind < 0.4 ? mauve : kind < 0.7 ? purple : offWhite);
        flowerCol.offsetHSL((rand() - 0.5) * 0.02, (rand() - 0.5) * 0.06, (rand() - 0.5) * 0.06);
        flowers.setColorAt(flowerIdx, flowerCol);
        flowerIdx += 1;
      }
    }
  }
  flowers.count = flowerIdx;
  spikes.instanceMatrix.needsUpdate = true;
  flowers.instanceMatrix.needsUpdate = true;
  if (flowers.instanceColor) flowers.instanceColor.needsUpdate = true;
  group.add(spikes);
  group.add(flowers);

  return group;
}
