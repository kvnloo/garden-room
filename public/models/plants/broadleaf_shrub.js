import * as THREE from 'three';

// broadleaf_shrub — tall leafy shrub / young fruit tree (ficus / citrus form):
// short slender trunk, irregular branching with hanging twigs, dense interior-filled
// top-heavy crown of long narrow cool dark-green wilted drooping leaves.

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Long narrow lanceolate leaf: widest ~35% up, tapered pointed tip, downward-bent
// midrib, gentle fold + curled edges. Unit length along +Y, width +X, fold +Z.
function buildLeafGeometry(halfW, rib, droop, edgeCurl, segments) {
  const rows = segments + 1;
  const vertCount = rows * 3;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  function widthAt(t) {
    return t < 0.35 ? halfW * (t / 0.35) : halfW * (1 - t) / 0.65;
  }
  for (let r = 0; r <= segments; r++) {
    const t = r / segments;
    const w = widthAt(t);
    const arch = Math.sin(Math.PI * t) * rib;
    const curl = Math.sin(Math.PI * t) * edgeCurl;
    const y = t - droop * t * t; // midrib bends down toward the tip
    const i = r * 3;
    positions[i * 3 + 0] = -w; positions[i * 3 + 1] = y; positions[i * 3 + 2] = -curl;
    positions[i * 3 + 3] = 0;  positions[i * 3 + 4] = y; positions[i * 3 + 5] = arch;
    positions[i * 3 + 6] = w;  positions[i * 3 + 7] = y; positions[i * 3 + 8] = -curl;
    uvs[i * 2 + 0] = 0; uvs[i * 2 + 1] = t;
    uvs[i * 2 + 2] = 0.5; uvs[i * 2 + 3] = t;
    uvs[i * 2 + 4] = 1; uvs[i * 2 + 5] = t;
  }
  const indices = [];
  for (let r = 0; r < segments; r++) {
    const a = r * 3, b = (r + 1) * 3;
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

export function createPlant({ height = 0.8, spread = 0.5, potDiameter = 0.3, seed = 1, width, depth } = {}) {
  const rng = mulberry32(seed);
  const group = new THREE.Group();
  const up = new THREE.Vector3(0, 1, 0);

  const trunkTop = height * 0.16;              // short bare trunk
  const crownBottom = trunkTop * 0.9;
  const crownTop = height * 0.96;
  const crownR = spread * 0.5;                 // crown horizontal radius

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x453c30, roughness: 0.9 });

  function stem(from, to, rBase, rTip) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 1e-4) return;
    const g = new THREE.CylinderGeometry(rTip, rBase, len, 4);
    const m = new THREE.Mesh(g, woodMat);
    m.position.copy(from).add(to).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, dir.normalize());
    group.add(m);
  }

  // ---- short slender trunk, slightly crooked ----
  const trunkPts = [new THREE.Vector3(0, 0, 0)];
  let prevR = 0.017;
  for (let s = 1; s <= 3; s++) {
    const y = trunkTop * (s / 3);
    const x = (rng() - 0.5) * 0.013 * s;
    const z = (rng() - 0.5) * 0.013 * s;
    const r = prevR - 0.0024 * s;
    stem(trunkPts[trunkPts.length - 1], new THREE.Vector3(x, y, z), prevR, r);
    trunkPts.push(new THREE.Vector3(x, y, z));
    prevR = r;
  }
  const trunkTip = trunkPts[trunkPts.length - 1];

  // ---- irregular branches (varying heights/lengths/angles) + hanging twigs ----
  const nBranches = 7;
  for (let i = 0; i < nBranches; i++) {
    const az = (i / nBranches) * Math.PI * 2 + (rng() - 0.5) * 1.3;
    const attachU = 0.3 + rng() * 0.65;
    const attach = new THREE.Vector3(
      trunkTip.x * attachU + (rng() - 0.5) * 0.012,
      trunkTop * attachU,
      trunkTip.z * attachU + (rng() - 0.5) * 0.012
    );
    const tipR = crownR * (0.5 + rng() * 0.55);
    const tipY = crownBottom + (crownTop - crownBottom) * (0.4 + rng() * 0.6);
    const tip = new THREE.Vector3(Math.cos(az) * tipR, tipY, Math.sin(az) * tipR);
    // slight crook: mid point bent sideways
    const mid = attach.clone().add(tip).multiplyScalar(0.5);
    mid.x += (rng() - 0.5) * 0.05;
    mid.z += (rng() - 0.5) * 0.05;
    stem(attach, mid, 0.005, 0.003);
    stem(mid, tip, 0.003, 0.0016);

    // hanging twig (cascades down-outward, no bare spike above foliage)
    const dir = tip.clone().sub(mid).normalize();
    const twigTip = tip.clone()
      .add(dir.multiplyScalar(0.04 + rng() * 0.05))
      .add(new THREE.Vector3(0, -(0.05 + rng() * 0.06), 0));
    stem(tip, twigTip, 0.0022, 0.0009);
  }

  // ---- leaves: dense, interior-filled, top-heavy crown ----
  const leafGeom = buildLeafGeometry(0.12, 0.045, 0.32, 0.035, 3);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0,
    side: THREE.DoubleSide,
  });

  const totalLeaves = 350;
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, totalLeaves);
  const dummy = new THREE.Object3D();
  const rollQuat = new THREE.Quaternion();
  const leafLen = height * 0.085;

  for (let i = 0; i < totalLeaves; i++) {
    const az = rng() * Math.PI * 2;
    const hF = Math.pow(rng(), 0.62);           // top-heavy bias
    const py = crownBottom + hF * (crownTop - crownBottom);
    const maxR = crownR * (0.6 + 0.4 * Math.sin(Math.PI * hF));
    const r = maxR * Math.sqrt(rng());          // fill the crown volume
    const px = Math.cos(az) * r;
    const pz = Math.sin(az) * r;
    const elev = -0.85 + 1.1 * hF + (rng() - 0.5) * 0.25; // wilted droop low, upright high
    const dir = new THREE.Vector3(
      Math.cos(az) * Math.cos(elev),
      Math.sin(elev),
      Math.sin(az) * Math.cos(elev)
    ).normalize();
    dummy.position.set(px, py, pz);
    rollQuat.setFromAxisAngle(up, (rng() - 0.5) * 1.7);
    dummy.quaternion.setFromUnitVectors(up, dir).multiply(rollQuat);
    const s = leafLen * (0.75 + rng() * 0.6);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    leaves.setMatrixAt(i, dummy.matrix);

    const col = new THREE.Color(0x244231);
    col.offsetHSL((rng() - 0.5) * 0.015, (rng() - 0.5) * 0.05, (rng() - 0.5) * 0.1);
    leaves.setColorAt(i, col);
  }
  leaves.count = totalLeaves;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(leaves);

  return group;
}
