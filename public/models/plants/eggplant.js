import * as THREE from 'three';

// Eggplant (Solanum melongena): upright bushy plant ~75 cm tall, tied to green
// bamboo stakes. A thick, crooked, tapered purple-green main stem carries short
// side branches and many LARGE soft irregularly-lobed ovate leaves (12-20 cm) that
// hang nearly vertically from their petioles, forming a full irregular column.
// Yellow-green new growth clustered at the tip, darker older leaves below, pale
// central veins, and a small cluster of glossy purple fruits with pointed green
// calyces in the upper-middle foliage. Reads as a leafy bush.

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Irregular broad ovate leaf, unit length +Y (base 0, tip 1), unit full width +X,
// soft +Z face. Rounded base, several shallow rounded lobes, wavy margin, curled
// edges with a gentle lengthwise twist (asymmetry), curved midrib, soft tip droop
// and a pale central vein via vertex colours.
function buildLeafGeometry() {
  const SEG = 16;
  const rows = SEG + 1;
  const vertCount = rows * 3;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  // Half-width profile (max 1.0 -> full width 1.0): rounded base, full middle, tip.
  const profile = [0.30, 0.56, 0.82, 0.98, 1.0, 0.93, 0.78, 0.55, 0.31, 0.11, 0.02];
  const WMAX = 0.5;
  const RIB = 0.09;   // curved (bowed) midrib
  const CURL = 0.06;  // cupped edges
  const WAVE = 0.022; // wavy margin
  for (let r = 0; r <= SEG; r++) {
    const t = r / SEG;
    const f = t * (profile.length - 1);
    const i = Math.min(profile.length - 2, Math.floor(f));
    const u = f - i;
    let prof = profile[i] + (profile[i + 1] - profile[i]) * u;
    prof *= 1 + 0.13 * Math.sin(Math.PI * 3.0 * t + 0.4); // ~1.5 shallow lobes per side
    const w = WMAX * prof * (1 + 0.05 * Math.sin(t * Math.PI * 7)); // wavy outline
    const arch = Math.sin(Math.PI * t) * RIB;
    const tipCurl = t > 0.7 ? -Math.pow((t - 0.7) / 0.3, 2) * 0.08 : 0;
    const curl = Math.sin(Math.PI * t) * CURL;
    const wave = WAVE * Math.sin(t * Math.PI * 3 + 1.3);
    const twist = 0.02 * Math.sin(Math.PI * t); // one edge up, other down
    const i3 = r * 3;
    positions[(i3 + 0) * 3 + 0] = -w; positions[(i3 + 0) * 3 + 1] = t; positions[(i3 + 0) * 3 + 2] = -curl + wave + twist + tipCurl;
    positions[(i3 + 1) * 3 + 0] = 0;  positions[(i3 + 1) * 3 + 1] = t; positions[(i3 + 1) * 3 + 2] = arch + tipCurl;
    positions[(i3 + 2) * 3 + 0] = w;  positions[(i3 + 2) * 3 + 1] = t; positions[(i3 + 2) * 3 + 2] = -curl + wave - twist + tipCurl;
    colors[(i3 + 0) * 3] = 0.86; colors[(i3 + 0) * 3 + 1] = 0.90; colors[(i3 + 0) * 3 + 2] = 0.80;
    colors[(i3 + 1) * 3] = 1.0;  colors[(i3 + 1) * 3 + 1] = 0.97; colors[(i3 + 1) * 3 + 2] = 0.88;
    colors[(i3 + 2) * 3] = 0.86; colors[(i3 + 2) * 3 + 1] = 0.90; colors[(i3 + 2) * 3 + 2] = 0.80;
    uvs[(i3 + 0) * 2] = 0; uvs[(i3 + 0) * 2 + 1] = t;
    uvs[(i3 + 1) * 2] = 0.5; uvs[(i3 + 1) * 2 + 1] = t;
    uvs[(i3 + 2) * 2] = 1; uvs[(i3 + 2) * 2 + 1] = t;
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
  const UP = new THREE.Vector3(0, 1, 0);

  const H = height;
  const R = spread * 0.5; // canopy radius

  // ---- materials ----
  const stemLowMat = new THREE.MeshStandardMaterial({ color: 0x55603e, roughness: 0.85 });  // green base
  const stemMidMat = new THREE.MeshStandardMaterial({ color: 0x5d5148, roughness: 0.85 });  // olive-purple
  const stemHighMat = new THREE.MeshStandardMaterial({ color: 0x654a58, roughness: 0.85 }); // purple top
  const petioleMat = new THREE.MeshStandardMaterial({ color: 0x5d5148, roughness: 0.85 });
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0x8aa04a, roughness: 0.7 });      // green bamboo
  const nodeMat = new THREE.MeshStandardMaterial({ color: 0x75883c, roughness: 0.75 });      // bamboo node
  const tieMat = new THREE.MeshStandardMaterial({ color: 0xc8a860, roughness: 0.95 });       // pale twine
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.5, side: THREE.DoubleSide, vertexColors: true,
    emissive: 0x1a2a18, emissiveIntensity: 0.16,
  });
  const fruitMat = new THREE.MeshStandardMaterial({ color: 0x6a3a8a, roughness: 0.22 });     // glossy purple
  const calyxMat = new THREE.MeshStandardMaterial({ color: 0x4a5a30, roughness: 0.8 });      // green calyx
  const fruitStemMat = new THREE.MeshStandardMaterial({ color: 0x5a4a4a, roughness: 0.85 });

  // Tapered cylinder segment between two points (also tie bands / fruit stems / petioles).
  function stem(from, to, rBase, rTip, mat, radial = 5) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(rTip, rBase, len, radial, 1);
    const m = new THREE.Mesh(g, mat);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(UP, dir.normalize());
    group.add(m);
  }

  // ---- main stem: thick, tapered, crooked, green -> purple ----
  const q0 = new THREE.Vector3(0, 0, 0);
  const q1 = new THREE.Vector3(0.009, H * 0.24, -0.011);
  const q2 = new THREE.Vector3(0.022, H * 0.48, 0.006);
  const q3 = new THREE.Vector3(0.011, H * 0.72, -0.007);
  const q4 = new THREE.Vector3(0.017, H * 0.95, 0.003);
  stem(q0, q1, 0.016, 0.0125, stemLowMat);
  stem(q1, q2, 0.0125, 0.009, stemMidMat);
  stem(q2, q3, 0.009, 0.0055, stemMidMat);
  stem(q3, q4, 0.0055, 0.0035, stemHighMat);

  // ---- two clearly separated green bamboo stakes: one vertical, one strongly angled ----
  const stakeX = 0.042, stakeZ = 0.026;
  stem(new THREE.Vector3(stakeX, 0, stakeZ), new THREE.Vector3(stakeX, H * 0.90, stakeZ), 0.009, 0.007, stakeMat);
  const angleBot = new THREE.Vector3(-0.038, 0, -0.036);
  const angleTop = new THREE.Vector3(0.026, H * 0.78, 0.014);
  stem(angleBot, angleTop, 0.0065, 0.0045, stakeMat);
  const nodeRingGeom = new THREE.CylinderGeometry(0.0105, 0.0105, 0.008, 8);
  for (const ny of [0.30, 0.55, 0.78]) {
    const ring = new THREE.Mesh(nodeRingGeom, nodeMat);
    ring.position.set(stakeX, H * ny, stakeZ);
    group.add(ring);
  }

  // ---- pale twine loops wrapping stem + stakes at their contact points ----
  const tieGeom = new THREE.TorusGeometry(0.026, 0.0034, 6, 14);
  for (const [ty, tz] of [[0.44, 0.004], [0.63, -0.002]]) {
    const tie = new THREE.Mesh(tieGeom, tieMat);
    tie.rotation.x = Math.PI / 2;
    tie.position.set(0.016, H * ty, tz);
    group.add(tie);
  }

  // ---- short side branches angling outward/up from the main stem ----
  const nBranches = 6;
  const branches = [];
  for (let i = 0; i < nBranches; i++) {
    const az = i * 2.399963 + (rand() - 0.5) * 0.9;
    const yFrac = 0.22 + (i / (nBranches - 1)) * 0.50 + (rand() - 0.5) * 0.06;
    const attach = new THREE.Vector3(
      0.012 + (rand() - 0.5) * 0.006,
      H * yFrac,
      -0.003 + (rand() - 0.5) * 0.006,
    );
    const reach = R * (0.22 + 0.18 * rand());
    const tipY = H * Math.min(0.82, yFrac + 0.07 + 0.10 * rand());
    const tip = new THREE.Vector3(
      attach.x + Math.cos(az) * reach,
      tipY,
      attach.z + Math.sin(az) * reach,
    );
    const mid = attach.clone().add(tip).multiplyScalar(0.5);
    mid.x += (rand() - 0.5) * 0.02;
    mid.z += (rand() - 0.5) * 0.02;
    mid.y += 0.007;
    stem(attach, mid, 0.0045, 0.003, stemMidMat);
    stem(mid, tip, 0.003, 0.0018, stemHighMat);
    branches.push({ az, attach, mid, tip, yFrac });
  }

  // ---- leaves ----
  const leafGeom = buildLeafGeometry();
  const leafMesh = new THREE.InstancedMesh(leafGeom, leafMat, 36);
  const basis = new THREE.Matrix4();
  const scaleV = new THREE.Vector3();
  const right = new THREE.Vector3();
  const dirV = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const outward = new THREE.Vector3();
  let li = 0;

  // Leaf tilt from straight-down: old lower leaves hang near-vertical, top rises.
  function tiltOf(yFrac) {
    return Math.max(0.28, Math.min(1.5, 0.28 + 0.95 * yFrac + (rand() - 0.5) * 0.16));
  }

  // leaf colour: yellow-green new growth up top -> fresh green older leaves below,
  // with occasional patchy yellowing
  function leafColor(yFrac) {
    let hue = 0.30 - 0.14 * yFrac + (rand() - 0.5) * 0.03;
    let sat = 0.58 + (rand() - 0.5) * 0.12;
    let light = 0.40 + 0.15 * yFrac + (rand() - 0.5) * 0.07;
    if (rand() < 0.15) { hue = 0.13; sat = 0.38; light = 0.46 + (rand() - 0.5) * 0.06; } // yellowing
    return new THREE.Color().setHSL(hue, sat, light);
  }

  // Place one broad blade on a short petiole: base hangs down-outward (tilt from
  // straight-down) with its broad face turned outward, rolled about its own axis.
  function addLeaf(node, az, tilt, roll, len, yFrac) {
    outward.set(Math.cos(az), 0, Math.sin(az));
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    dirV.set(outward.x * st, -ct, outward.z * st);  // blade length axis (hangs)
    normal.set(outward.x * ct, st, outward.z * ct); // face normal (outward-ish)
    right.crossVectors(dirV, normal);               // width axis, horizontal
    // twist about the blade axis
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const rx = right.x, ry = right.y, rz = right.z;
    const nx = normal.x, ny = normal.y, nz = normal.z;
    right.set(rx * cr + nx * sr, ry * cr + ny * sr, rz * cr + nz * sr);
    normal.set(nx * cr - rx * sr, ny * cr - ry * sr, nz * cr - rz * sr);

    const petiole = 0.030 + 0.02 * rand();
    const base = new THREE.Vector3(
      node.x + outward.x * petiole,
      node.y - 0.004,
      node.z + outward.z * petiole,
    );
    stem(node, base, 0.002, 0.0016, petioleMat, 4); // visible petiole

    basis.makeBasis(right, dirV, normal);
    basis.setPosition(base.x, base.y, base.z);
    scaleV.set(len * 0.70, len, len);               // elongated ovate
    basis.scale(scaleV);
    leafMesh.setMatrixAt(li, basis);
    leafMesh.setColorAt(li, leafColor(yFrac));
    li++;
  }

  // Main-stem leaves: alternate with irregular spacing/jitter along the stem.
  const nStemLeaves = 10;
  for (let k = 0; k < nStemLeaves; k++) {
    const yFrac = 0.13 + (k / (nStemLeaves - 1)) * 0.70 + (rand() - 0.5) * 0.07;
    const az = k * 2.399963 + 1.2 + (rand() - 0.5) * 1.0;
    const pos = new THREE.Vector3(0.012, H * Math.max(0.13, yFrac), -0.003);
    addLeaf(pos, az, tiltOf(yFrac), (rand() - 0.5) * 0.9, H * (0.19 + 0.04 * rand()), yFrac);
  }

  // Branch leaves + a small axillary leaf at each branch node (fills the column).
  for (const b of branches) {
    for (let j = 0; j < 2; j++) {
      const node = j === 0 ? b.mid : b.tip;
      const yFrac = node.y / H;
      const az = b.az + (j === 0 ? 0 : (rand() - 0.5) * 0.8);
      addLeaf(node, az, tiltOf(yFrac), (rand() - 0.5) * 0.9, H * (0.18 + 0.04 * rand()), yFrac);
    }
    // small axillary leaf near the branch attachment
    addLeaf(
      b.attach, b.az + Math.PI * 0.5, tiltOf(b.yFrac + 0.03), (rand() - 0.5) * 0.9,
      H * (0.13 + 0.03 * rand()), b.yFrac + 0.03,
    );
  }

  // Growing-tip cluster: smaller, more upright yellow-green leaves at the very top.
  for (let t = 0; t < 4; t++) {
    const yFrac = 0.85 + 0.10 * rand();
    const az = t * 2.399963 + 2.0 + (rand() - 0.5) * 0.8;
    const pos = new THREE.Vector3(0.014, H * yFrac, 0.002);
    addLeaf(pos, az, 1.5 + 0.5 * rand(), (rand() - 0.5) * 0.7, H * (0.13 + 0.03 * rand()), yFrac);
  }

  leafMesh.count = li;
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  group.add(leafMesh);

  // ---- small cluster of glossy purple fruits side-by-side in the upper-middle ----
  const fruitGeom = new THREE.SphereGeometry(1, 10, 8);
  const calyxGeom = new THREE.ConeGeometry(0.032, 0.036, 6);
  const sepalGeom = new THREE.ConeGeometry(0.006, 0.020, 4);
  const fruitPts = [
    new THREE.Vector3(0.030, H * 0.62, 0.012),
    new THREE.Vector3(-0.018, H * 0.58, -0.020),
    new THREE.Vector3(0.008, H * 0.55, 0.028),
  ];
  for (const anchor of fruitPts) {
    const stemLen = 0.030 + 0.015 * rand();
    const fruitTop = new THREE.Vector3(anchor.x, anchor.y - stemLen, anchor.z);
    stem(anchor, fruitTop, 0.0022, 0.0022, fruitStemMat, 4);

    // prominent pointed green calyx: central cone + ring of sepals
    const calyx = new THREE.Mesh(calyxGeom, calyxMat);
    calyx.position.set(fruitTop.x, fruitTop.y - 0.002, fruitTop.z);
    group.add(calyx);
    for (let s = 0; s < 5; s++) {
      const sa = (s / 5) * Math.PI * 2;
      const sepal = new THREE.Mesh(sepalGeom, calyxMat);
      sepal.position.set(
        fruitTop.x + Math.cos(sa) * 0.024,
        fruitTop.y - 0.002,
        fruitTop.z + Math.sin(sa) * 0.024,
      );
      sepal.rotation.z = Math.cos(sa) * 0.9;
      sepal.rotation.x = Math.sin(sa) * 0.9;
      group.add(sepal);
    }

    // plump glossy fruit body hanging below
    const body = new THREE.Mesh(fruitGeom, fruitMat);
    const bodyHalf = 0.040 + 0.010 * rand();
    body.position.set(fruitTop.x, fruitTop.y - bodyHalf - 0.010, fruitTop.z);
    body.scale.set(0.028, bodyHalf, 0.028);
    body.rotation.z = (rand() - 0.5) * 0.3;
    body.rotation.x = (rand() - 0.5) * 0.3;
    group.add(body);
  }

  return group;
}
