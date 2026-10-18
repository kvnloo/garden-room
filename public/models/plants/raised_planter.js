import * as THREE from 'three';

// Deterministic PRNG (mulberry32) — same seed => same bed.
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LEAF_SEGMENTS = 8;
const LEAF_L = 0.085; // blade length (metres)
const LEAF_W = 0.015; // blade half-width (=> ~2.8:1 length:width)

// Lanceolate blade: sharp base and tip, fine edge serration, a midrib fold, a gentle
// lengthwise curl and a slightly curled tip. Length along +Y (tip at +Y), width +X,
// upper surface (midrib ridge) on +Z. Face-up leaves read as foliage, not slivers.
function buildLeafGeometry(L, W) {
  const rows = LEAF_SEGMENTS + 1;
  const positions = new Float32Array(rows * 3 * 3);
  const uvs = new Float32Array(rows * 3 * 2);
  for (let r = 0; r < rows; r++) {
    const t = r / LEAF_SEGMENTS;
    const s = Math.sin(Math.PI * Math.pow(t, 0.5)); // lanceolate envelope
    const teeth = Math.sin(Math.PI * 15 * t) * Math.sin(Math.PI * Math.min(1, t * 1.25));
    const w = W * s * (1 + 0.12 * teeth); // fine serration
    const fold = Math.sin(Math.PI * t) * W * 0.45; // midrib fold (upper face ridge)
    const arch = Math.sin(Math.PI * t) * L * 0.05; // gentle cup
    const curl = -Math.pow(t, 2.5) * L * 0.22; // curled tip
    const y = t * L + curl;
    const i = r * 3;
    positions[i * 3] = -w; positions[i * 3 + 1] = y; positions[i * 3 + 2] = arch - fold * 0.5;
    positions[i * 3 + 3] = 0; positions[i * 3 + 4] = y; positions[i * 3 + 5] = arch + fold;
    positions[i * 3 + 6] = w; positions[i * 3 + 7] = y; positions[i * 3 + 8] = arch - fold * 0.5;
    uvs[i * 2] = 0; uvs[i * 2 + 1] = t;
    uvs[i * 2 + 2] = 0.5; uvs[i * 2 + 3] = t;
    uvs[i * 2 + 4] = 1; uvs[i * 2 + 5] = t;
  }
  const indices = [];
  for (let r = 0; r < LEAF_SEGMENTS; r++) {
    const a = r * 3, b = (r + 1) * 3;
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

// A bed of young pepper/tomato plants filling a raised planter.
// width/depth are the bed's inner footprint: plants spread along the long axis (X).
// Asymmetric layout matching the reference: a substantial left cluster, a leafy central
// peak, and shorter sprawling growth trailing toward the right edge. Each plant is a
// slender leaning stem with dense branching; small face-up lanceolate leaves pack a low,
// leafy mass that spills over the rim. Two rigid green stakes.
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

  const bedW = width || 0.8;
  const bedD = depth || 0.35;
  const usableW = bedW * 0.94; // matches pots.js soil slab
  const usableD = bedD * 0.88;

  // fx = x position as a fraction of the soil width; hf = height factor; sp = sprawl.
  const LAYOUT = [
    { fx: -0.42, hf: 0.88, sp: 0.6, lean: 0.12, leanAz: Math.PI * 1.05 },
    { fx: -0.20, hf: 1.02, sp: 0.5, lean: 0.08, leanAz: Math.PI * 0.75 },
    { fx: 0.06, hf: 1.16, sp: 0.3, lean: 0.05, leanAz: 0.0 },
    { fx: 0.26, hf: 0.90, sp: 0.75, lean: 0.11, leanAz: 0.4 },
    { fx: 0.42, hf: 0.62, sp: 1.0, lean: 0.17, leanAz: 0.7 },
  ];
  const count = LAYOUT.length;
  const golden = 2.399963229728653;

  // ---- scratch objects ----
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const mPlant = new THREE.Matrix4();
  const mTmp = new THREE.Matrix4();
  const mRot = new THREE.Matrix4();
  const mScale = new THREE.Matrix4();

  const leafM = [], leafC = [], brM = [], stM = [];
  const plantPos = [];

  function leafDir(az, pitch, out) {
    return out.set(
      Math.sin(pitch) * Math.cos(az),
      Math.cos(pitch),
      -Math.sin(pitch) * Math.sin(az),
    );
  }

  const C_DARK = new THREE.Color(0x4c6b2e);
  const C_MID = new THREE.Color(0x7a9a50);
  const C_TIP = new THREE.Color(0xa8c268);
  const C_YELLOW = new THREE.Color(0x9aa843);

  function addLeaf(ax, ay, az, leafAz, pitch, roll, scale, ybFrac) {
    const dir = leafDir(leafAz, pitch, tmpV);
    const plen = 0.012 + rand() * 0.02; // short petiole (no separate mesh)
    const bx = ax + dir.x * plen, by = ay + dir.y * plen, bz = az + dir.z * plen;

    mTmp.makeTranslation(bx, by, bz)
      .multiply(mRot.makeRotationY(leafAz - Math.PI / 2))
      .multiply(mRot.makeRotationX(-pitch))
      .multiply(mRot.makeRotationY(roll))
      .multiply(mScale.makeScale(scale, scale, scale));
    leafM.push(mPlant.clone().multiply(mTmp));

    const c = new THREE.Color();
    if (ybFrac < 0.3 && rand() < 0.22) c.copy(C_YELLOW); // yellowing older low leaf
    else if (ybFrac < 0.5) c.copy(C_DARK).lerp(C_MID, ybFrac / 0.5);
    else c.copy(C_MID).lerp(C_TIP, (ybFrac - 0.5) / 0.5);
    c.offsetHSL((rand() - 0.5) * 0.05, (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.09);
    leafC.push(c);
  }

  for (let i = 0; i < count; i++) {
    const L = LAYOUT[i];
    const x = L.fx * usableW + (rand() - 0.5) * 0.02;
    const z = (rand() - 0.5) * usableD * 0.5;
    const h = height * L.hf * (0.94 + rand() * 0.12);
    const yaw = rand() * Math.PI * 2;
    const lean = L.lean * (0.8 + rand() * 0.4);
    const leanAz = L.leanAz + (rand() - 0.5) * 0.5;
    plantPos.push({ x, z, h });

    tmpQ.setFromAxisAngle(
      new THREE.Vector3(-Math.sin(leanAz), 0, Math.cos(leanAz)),
      lean,
    );
    mPlant.makeTranslation(x, 0, z).multiply(mRot.makeRotationFromQuaternion(tmpQ));

    // main stem (slender, tapered)
    const sr = 0.004 + (h / height) * 0.0016;
    stM.push(mPlant.clone().multiply(
      new THREE.Matrix4().makeTranslation(0, h / 2, 0).multiply(mScale.makeScale(sr, h, sr)),
    ));

    // dense primary branches: short, carrying leaves along their full length
    const nPrimary = 5;
    for (let b = 0; b < nPrimary; b++) {
      const yb = h * (0.05 + 0.6 * (b / (nPrimary - 1)) + (rand() - 0.5) * 0.05);
      const azB = rand() * Math.PI * 2;
      const elB = 0.1 + (1 - L.sp) * 0.5 + rand() * 0.25; // sprawling => flatter
      const bl = (0.05 + rand() * 0.06) * (0.75 + L.sp * 0.6);
      const d = new THREE.Vector3(Math.cos(elB) * Math.cos(azB), Math.sin(elB), Math.cos(elB) * Math.sin(azB));
      tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      mTmp.compose(
        new THREE.Vector3(d.x * bl * 0.5, yb + d.y * bl * 0.5, d.z * bl * 0.5),
        tmpQ,
        new THREE.Vector3(0.002, bl, 0.002),
      );
      brM.push(mPlant.clone().multiply(mTmp));

      // leaves along the whole branch (0.3, 0.6, ~0.95 of its length)
      const nL = 3;
      for (let k = 0; k < nL; k++) {
        const fr = 0.3 + 0.65 * (k / (nL - 1));
        const ax = d.x * bl * fr + (rand() - 0.5) * 0.015;
        const ay = yb + d.y * bl * fr;
        const az0 = d.z * bl * fr + (rand() - 0.5) * 0.015;
        const leafAz = azB + (rand() - 0.5) * 1.6;
        const pitch = 0.5 + L.sp * 0.5 + rand() * 0.8; // face-up, sprawl => droopier
        const roll = (rand() - 0.5) * 1.4;
        const scale = 0.75 + rand() * 0.4;
        addLeaf(ax, ay, az0, leafAz, pitch, roll, scale, 0.2 + 0.55 * fr);
      }
    }

    // secondary (tertiary) shoots off two of the primaries
    for (let s = 0; s < 2; s++) {
      const yb = h * (0.25 + rand() * 0.3);
      const azB = rand() * Math.PI * 2;
      const elB = 0.15 + (1 - L.sp) * 0.4 + rand() * 0.2;
      const bl = 0.04 + rand() * 0.04;
      const d = new THREE.Vector3(Math.cos(elB) * Math.cos(azB), Math.sin(elB), Math.cos(elB) * Math.sin(azB));
      tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      mTmp.compose(
        new THREE.Vector3(d.x * bl * 0.5, yb + d.y * bl * 0.5, d.z * bl * 0.5),
        tmpQ,
        new THREE.Vector3(0.0016, bl, 0.0016),
      );
      brM.push(mPlant.clone().multiply(mTmp));
      for (let k = 0; k < 2; k++) {
        const fr = 0.45 + 0.55 * k;
        const leafAz = azB + (rand() - 0.5) * 1.6;
        const pitch = 0.6 + L.sp * 0.5 + rand() * 0.7;
        const roll = (rand() - 0.5) * 1.4;
        addLeaf(d.x * bl * fr, yb + d.y * bl * fr, d.z * bl * fr, leafAz, pitch, roll, 0.75 + rand() * 0.3, 0.35);
      }
    }

    // main-stem leaves (alternate, low to tip) + terminal growing tip
    const nStem = 10;
    for (let j = 0; j < nStem; j++) {
      const f = (j + 0.5) / nStem;
      const yb = h * (0.04 + 0.88 * f);
      const az = j * golden + yaw + (rand() - 0.5) * 0.6;
      const pitch = (f < 0.35 ? 0.7 : 0.5) + L.sp * 0.3 + rand() * 0.55;
      const roll = (rand() - 0.5) * 1.2;
      const scale = (0.75 + rand() * 0.35) * (1.15 - 0.35 * f);
      addLeaf(0, yb, 0, az, pitch, roll, scale, f);
    }
    for (let k = 0; k < 3; k++) {
      const az = k * 2.1 + yaw;
      const pitch = 0.4 + rand() * 0.4;
      const roll = (rand() - 0.5) * 1.0;
      addLeaf(0, h * (0.97 - rand() * 0.03), 0, az, pitch, roll, 0.7 + rand() * 0.2, 0.95);
    }
  }

  // ---- build InstancedMeshes ----
  const leafGeom = buildLeafGeometry(LEAF_L, LEAF_W);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.8, metalness: 0, side: THREE.DoubleSide,
  });
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, leafM.length);
  leafM.forEach((m, i) => leaves.setMatrixAt(i, m));
  leafC.forEach((c, i) => leaves.setColorAt(i, c));
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(leaves);

  const stemGeom = new THREE.CylinderGeometry(0.6, 1.0, 1, 6, 1, true);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x5d7a38, roughness: 0.85 });
  const stems = new THREE.InstancedMesh(stemGeom, stemMat, stM.length);
  stM.forEach((m, i) => stems.setMatrixAt(i, m));
  stems.instanceMatrix.needsUpdate = true;
  group.add(stems);

  const twigGeom = new THREE.CylinderGeometry(1, 1, 1, 3, 1, true);
  const twigMat = new THREE.MeshStandardMaterial({ color: 0x5d7a38, roughness: 0.85 });
  const branches = new THREE.InstancedMesh(twigGeom, twigMat, brM.length);
  brM.forEach((m, i) => branches.setMatrixAt(i, m));
  branches.instanceMatrix.needsUpdate = true;
  group.add(branches);

  // ---- two rigid green stakes ----
  const stakeGeom = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0x3f7d3a, roughness: 0.55 });
  const stakes = new THREE.InstancedMesh(stakeGeom, stakeMat, 2);
  const stakeAt = [1, 3];
  for (let s = 0; s < 2; s++) {
    const p = plantPos[stakeAt[s]];
    const sh = p.h * 1.22;
    mTmp.makeTranslation(p.x + 0.03, sh / 2 - 0.01, p.z + 0.01)
      .multiply(mRot.makeRotationX(0.03))
      .multiply(mScale.makeScale(0.005, sh, 0.005));
    stakes.setMatrixAt(s, mTmp);
  }
  stakes.instanceMatrix.needsUpdate = true;
  group.add(stakes);

  return group;
}
