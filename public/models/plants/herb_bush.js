import * as THREE from 'three';

// Dense bushy herb mix (basil/oregano-like): a low, tangled, rounded mound wider
// than tall, made of many short thin stems rooted across the soil, each densely
// lined with small ovate light-green leaves (opposite pairs + a leafy tip tuft).
//
// Deterministic via mulberry32(seed). Leaves are a narrow ovate ribbon with a faint
// midrib, instanced with per-leaf colour (vivid new growth .. darker mature greens).

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- leaf geometry ---------------------------------------------------------
const LEAF_SEGMENTS = 3;
const LEAF_LENGTH = 0.04;      // ~4 cm
const LEAF_MAX_HALF_W = 0.0135; // ~2.7 cm wide (small ovate)

// Narrow ovate blade: wide just below the middle, soft taper to a rounded tip.
function leafHalfWidth(t) {
  return LEAF_MAX_HALF_W * Math.sin(Math.PI * Math.pow(t, 0.85));
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
    // Nearly flat blade with a faint cup and a subtle raised midrib.
    const arch = Math.sin(t * Math.PI) * 0.0012;
    const rib = Math.sin(t * Math.PI) * 0.0015;
    const i = r * vpr;
    positions[i * 3] = -w;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = arch;
    positions[i * 3 + 3] = 0;
    positions[i * 3 + 4] = y;
    positions[i * 3 + 5] = arch + rib;
    positions[i * 3 + 6] = w;
    positions[i * 3 + 7] = y;
    positions[i * 3 + 8] = arch;
    uvs[i * 2] = 0;
    uvs[i * 2 + 1] = t;
    uvs[(i + 1) * 2] = 0.5;
    uvs[(i + 1) * 2 + 1] = t;
    uvs[(i + 2) * 2] = 1;
    uvs[(i + 2) * 2 + 1] = t;
  }
  const indices = [];
  for (let r = 0; r < LEAF_SEGMENTS; r++) {
    const a = r * vpr;
    const b = (r + 1) * vpr;
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

export function createPlant({ height = 0.6, spread = 0.7, potDiameter = 0.3, seed = 1, width, depth } = {}) {
  const group = new THREE.Group();
  const rng = mulberry32(seed);
  const H = height;
  const R = spread * 0.5;

  // ---- leaves + stems ------------------------------------------------------
  const STEM_COUNT = 42;
  const NODE_S = [0.22, 0.45, 0.68, 0.88];
  const TERMINAL = 2;
  const LEAF_COUNT = STEM_COUNT * (NODE_S.length * 2 + TERMINAL);

  const leafGeom = buildLeafGeometry();
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, LEAF_COUNT);
  leaves.castShadow = true;
  leaves.receiveShadow = true;

  // Thin tapered twig, open-ended (no caps) to keep it cheap.
  const stemGeom = new THREE.CylinderGeometry(0.001, 0.0024, 1, 3, 1, true);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x5a7a38, roughness: 0.85, metalness: 0 });
  const stems = new THREE.InstancedMesh(stemGeom, stemMat, STEM_COUNT);
  stems.castShadow = true;

  const dummy = new THREE.Object3D();
  const Y_AXIS = new THREE.Vector3(0, 1, 0);
  const UP = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const radial = new THREE.Vector3();
  const side = new THREE.Vector3();
  const zVec = new THREE.Vector3();
  const xVec = new THREE.Vector3();
  const zRot = new THREE.Vector3();
  const xRot = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const col = new THREE.Color();
  const growA = new THREE.Vector3();
  const growB = new THREE.Vector3();

  let leafIdx = 0;

  function leafColor() {
    const kind = rng();
    if (kind < 0.4) {
      // vivid new growth: yellow-green
      col.setHSL(0.25 + rng() * 0.03, 0.62 + rng() * 0.13, 0.5 + rng() * 0.08);
    } else if (kind < 0.8) {
      // mature: fresh medium green
      col.setHSL(0.27 + rng() * 0.04, 0.55 + rng() * 0.12, 0.42 + rng() * 0.09);
    } else {
      // older: darker green
      col.setHSL(0.28 + rng() * 0.05, 0.5 + rng() * 0.12, 0.33 + rng() * 0.07);
    }
  }

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

    const cj = Math.cos(roll);
    const sj = Math.sin(roll);
    zRot.set(
      zVec.x * cj + xVec.x * sj,
      zVec.y * cj + xVec.y * sj,
      zVec.z * cj + xVec.z * sj,
    ).normalize();
    xRot.crossVectors(dir, zRot).normalize();

    rot.makeBasis(xRot, dir, zRot);
    dummy.position.set(px + dir.x * 0.005, py + dir.y * 0.005, pz + dir.z * 0.005);
    dummy.quaternion.setFromRotationMatrix(rot);
    dummy.scale.setScalar(0.8 + rng() * 0.5);
    dummy.updateMatrix();
    leaves.setMatrixAt(leafIdx, dummy.matrix);
    leafColor();
    leaves.setColorAt(leafIdx, col);
    leafIdx += 1;
  }

  for (let i = 0; i < STEM_COUNT; i++) {
    // Root scattered across the soil (uniform disk, so the centre fills in too).
    const r0 = 0.19 * Math.sqrt(rng());
    const phi0 = rng() * Math.PI * 2;
    const bx = Math.cos(phi0) * r0;
    const bz = Math.sin(phi0) * r0;

    // Short stem; central ones a little taller, outer ones shorter and leaning more.
    let L = (0.2 + rng() * 0.22) * (1 - 0.28 * (r0 / 0.19)) + 0.04;
    let lean = (0.18 + 0.6 * (r0 / 0.19)) * (0.55 + rng() * 0.75);
    // A few tall upright outliers and a few low spreading branches over the rim.
    if (rng() < 0.14) { L *= 1.45 + rng() * 0.5; lean *= 0.35; }
    else if (r0 > 0.07 && rng() < 0.22) { L *= 1.15; lean *= 1.5; }

    // Lean direction: mostly outward, with tangential jitter so stems crisscross.
    const leanDir = phi0 + (rng() - 0.5) * 1.1;
    const sinL = Math.sin(lean);
    const cosL = Math.cos(lean);
    const ox = Math.cos(leanDir);
    const oz = Math.sin(leanDir);
    const dx = ox * sinL * L;
    const dy = cosL * L;
    const dz = oz * sinL * L;
    const tx = bx + dx;
    const ty = dy;
    const tz = bz + dz;
    const len = Math.hypot(dx, dy, dz) || 1e-4;

    dir.set(dx / len, dy / len, dz / len);
    dummy.position.set(bx + dx * 0.5, dy * 0.5, bz + dz * 0.5);
    dummy.quaternion.setFromUnitVectors(Y_AXIS, dir);
    dummy.scale.set(1, len, 1);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);

    // Leaves in opposite pairs along the stem, plus a leafy tip tuft.
    for (const s of NODE_S) {
      const px = bx + dx * s;
      const py = dy * s;
      const pz = bz + dz * s;
      const tH = Math.min(1, Math.max(0, py / H));
      radial.set(px, 0, pz);
      if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
      radial.normalize();
      dir.set(
        radial.x * (1 - 0.5 * tH),
        0.35 + 0.65 * tH,
        radial.z * (1 - 0.5 * tH),
      ).normalize();
      side.crossVectors(UP, dir);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();

      growA.copy(dir).addScaledVector(side, 0.3).normalize();
      growB.copy(dir).addScaledVector(side, -0.3).normalize();
      const off = 0.011;
      placeLeaf(px + side.x * off, py, pz + side.z * off, growA, 0.3 + rng() * 0.25);
      placeLeaf(px - side.x * off, py, pz - side.z * off, growB, -0.3 - rng() * 0.25);
    }

    const tH = Math.min(1, Math.max(0, ty / H));
    radial.set(tx, 0, tz);
    if (radial.lengthSq() < 1e-6) radial.set(1, 0, 0);
    radial.normalize();
    for (let k = 0; k < TERMINAL; k++) {
      const ang = (k / TERMINAL) * Math.PI * 2 + rng() * 0.7;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      growA.set(radial.x * 0.55 + c * 0.45, 0.72, radial.z * 0.55 + s * 0.45).normalize();
      placeLeaf(tx, ty, tz, growA, ang);
    }
  }

  group.add(leaves);
  group.add(stems);
  return group;
}
