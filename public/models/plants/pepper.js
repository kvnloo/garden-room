import * as THREE from 'three';

// Chili pepper (Capsicum annuum): a single gently curving stem that forks near
// its middle into thin green branches carrying many glossy mid-green
// ovate/lanceolate leaves in a loose rounded canopy, a few small green peppers
// hanging from the upper nodes on curved pedicels, and a bamboo stake beside
// the stem tied with twine.

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ovate-lanceolate leaf: length 1 along +Y (petiole at y=0, pointed tip at
// y=1), full width 1 along +X, raised midrib and cupped edges. 7 segments.
function buildLeafGeometry() {
  const SEG = 7;
  const rows = SEG + 1;
  const halfW = [0.14, 0.45, 0.50, 0.47, 0.38, 0.24, 0.09, 0.02];
  const pos = new Float32Array(rows * 3 * 3);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    const w = halfW[r];
    const s = Math.sin(Math.PI * t);
    const bow = s * 0.035;         // lengthwise arch
    const midZ = bow + s * 0.055;  // raised central vein
    const edgeZ = bow - s * 0.04;  // cupped edges
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

// Tapered branch segment, base (radius 1) at y=0, tip (radius 0.55) at y=1.
function buildBranchGeometry() {
  const g = new THREE.CylinderGeometry(0.55, 1, 1, 8, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

// Pendulous chili fruit: lathe, rounded shoulder at y=0, tapering to a point
// at y=-1, then gently bent sideways toward the tip.
function buildPepperGeometry() {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.15, 0.0),
    new THREE.Vector2(0.19, -0.05),
    new THREE.Vector2(0.18, -0.18),
    new THREE.Vector2(0.14, -0.40),
    new THREE.Vector2(0.09, -0.64),
    new THREE.Vector2(0.045, -0.84),
    new THREE.Vector2(0.0, -1.0),
  ];
  const g = new THREE.LatheGeometry(pts, 9);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = -pos.getY(i); // 0 at calyx, 1 at tip
    pos.setX(i, pos.getX(i) + 0.11 * t * t); // gentle bend toward +X
  }
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

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x55703a, roughness: 0.85 });
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0xc2a46e, roughness: 0.85 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0x9a7a4a, roughness: 0.85 });
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x4a5a34, roughness: 0.9 });
  const calyxMat = new THREE.MeshStandardMaterial({ color: 0x4a7030, roughness: 0.7 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, side: THREE.DoubleSide });
  const pepperMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26 });

  const segments = []; // tapered branch sub-segments {p0, p1, r}
  const leaves = [];   // {px,py,pz, lx,ly,lz, nx,ny,nz, sx,sy,sz, len, w, color}
  const peppers = [];  // {px,py,pz, len, ax, az, lean, color}
  const pedicels = []; // {p0, p1, r}
  const calyxes = [];  // {px,py,pz, ax, az, lean}

  const UP = new THREE.Vector3(0, 1, 0);

  function pointAtFraction(pts, f) {
    const total = pts.length - 1;
    const scaled = Math.min(total, Math.max(0, f * total));
    const i = Math.min(total - 1, Math.floor(scaled));
    const t = scaled - i;
    return pts[i].clone().lerp(pts[i + 1], t);
  }

  function leafColor(y) {
    const hue = 0.33 + (rand() - 0.5) * 0.08;
    const sat = 0.5 + (rand() - 0.5) * 0.14;
    let light = 0.29 + (rand() - 0.5) * 0.07 + Math.min(0.05, y * 0.06);
    light = Math.min(0.4, Math.max(0.26, light));
    return new THREE.Color().setHSL(hue, sat, light);
  }

  // Leaf at point P: midrib radiates outward at a random azimuth/elevation, and
  // the blade is rolled around the midrib by a wide angle so blades face varied
  // directions and side views show faces rather than thin edges.
  function pushLeafAt(P, elevMin, elevMax, sizeMin, sizeMax) {
    const phi = rand() * Math.PI * 2;
    const ox = Math.cos(phi), oz = Math.sin(phi);
    const elev = elevMin + rand() * (elevMax - elevMin);
    const ce = Math.cos(elev), se = Math.sin(elev);
    const ldir = new THREE.Vector3(ox * ce, se, oz * ce).normalize();
    let n = new THREE.Vector3(0, 1, 0).addScaledVector(ldir, -ldir.y);
    if (n.lengthSq() < 1e-8) n.set(0, 0, 1); else n.normalize();
    n.applyAxisAngle(ldir, (rand() - 0.5) * 2.2);
    const side = new THREE.Vector3().crossVectors(ldir, n).normalize();
    const off = 0.004 + rand() * 0.004;
    const len = sizeMin + rand() * (sizeMax - sizeMin);
    leaves.push({
      px: P.x + ox * off, py: P.y, pz: P.z + oz * off,
      lx: ldir.x, ly: ldir.y, lz: ldir.z,
      nx: n.x, ny: n.y, nz: n.z,
      sx: side.x, sy: side.y, sz: side.z,
      len, w: len * 0.62, color: leafColor(P.y),
    });
  }

  // Curved branch: start -> (bent midpoint) -> end, leaves at irregular intervals.
  function emitBranch(start, dir, len, r, nLeaves, elevMin, elevMax, sizeMin, sizeMax) {
    const end = start.clone().addScaledVector(dir, len);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const axis = perpAtAz(dir, rand() * Math.PI * 2);
    mid.addScaledVector(axis, (0.05 + rand() * 0.12) * len);
    segments.push({ p0: start.clone(), p1: mid.clone(), r });
    segments.push({ p0: mid.clone(), p1: end.clone(), r: r * 0.8 });
    const pts = [start, mid, end];
    for (let i = 0; i < nLeaves; i++) {
      const f = 0.08 + rand() * 0.84; // irregular internode spacing
      pushLeafAt(pointAtFraction(pts, f), elevMin, elevMax, sizeMin, sizeMax);
    }
    return end;
  }

  function addPepper(P) {
    const len = 0.048 + rand() * 0.016;
    const pedLen = 0.022 + rand() * 0.012;
    const lean = 0.05 + rand() * 0.18;
    const az = rand() * Math.PI * 2;
    const ax = Math.cos(az), azz = Math.sin(az);
    const top = new THREE.Vector3(
      P.x + ax * pedLen * Math.sin(lean),
      P.y - pedLen * Math.cos(lean),
      P.z + azz * pedLen * Math.sin(lean),
    );
    const pmid = P.clone().add(top).multiplyScalar(0.5);
    pmid.add(new THREE.Vector3((rand() - 0.5) * 0.009, 0, (rand() - 0.5) * 0.009));
    pedicels.push({ p0: P.clone(), p1: pmid.clone(), r: 0.0015 });
    pedicels.push({ p0: pmid.clone(), p1: top.clone(), r: 0.0012 });
    calyxes.push({ px: top.x, py: top.y, pz: top.z, ax, az: azz, lean });
    const hue = 0.30 + (rand() - 0.5) * 0.04;
    const light = 0.44 + (rand() - 0.5) * 0.06;
    peppers.push({ px: top.x, py: top.y, pz: top.z, len, ax, az: azz, lean, color: new THREE.Color().setHSL(hue, 0.5, light) });
  }

  // ---- main stem: gentle S-curve up to the fork point ----
  const stemPts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0.006, 0.08, 0.004),
    new THREE.Vector3(0.001, 0.15, -0.005),
    new THREE.Vector3(0.008, 0.24, 0.003),
  ];
  const forkPoint = stemPts[stemPts.length - 1];
  for (let i = 0; i < stemPts.length - 1; i++) {
    const t = i / (stemPts.length - 1);
    segments.push({ p0: stemPts[i].clone(), p1: stemPts[i + 1].clone(), r: 0.0045 - 0.0015 * t });
  }
  const mainDir = stemPts[stemPts.length - 1].clone().sub(stemPts[stemPts.length - 2]).normalize();
  for (let i = 0; i < 3; i++) {
    const f = 0.3 + i * 0.28 + (rand() - 0.5) * 0.08;
    pushLeafAt(pointAtFraction(stemPts, f), -0.5, -0.1, 0.08, 0.095);
  }

  // ---- primary branches (4, forking out of the stem top) ----
  const nPrim = 4;
  const prim = [];
  for (let i = 0; i < nPrim; i++) {
    const az = (i / nPrim) * Math.PI * 2 + rand() * 0.5;
    const axis = perpAtAz(mainDir, az);
    const tilt = 0.5 + (rand() - 0.5) * 0.16;
    const dir = mainDir.clone().applyAxisAngle(axis, tilt).normalize();
    const tip = emitBranch(forkPoint, dir, 0.16, 0.003, 4, -0.2, 0.35, 0.065, 0.085);
    prim.push({ tip, dir });
    if (rand() < 0.5) addPepper(tip);
  }

  // ---- secondary branches (2 per primary) ----
  const secTips = [];
  for (let i = 0; i < nPrim; i++) {
    const { tip, dir } = prim[i];
    for (let k = 0; k < 2; k++) {
      const az = (k / 2) * Math.PI * 2 + rand() * 0.7;
      const axis = perpAtAz(dir, az);
      const tilt = 0.55 + (rand() - 0.5) * 0.16;
      const dir2 = dir.clone().applyAxisAngle(axis, tilt).normalize();
      const tip2 = emitBranch(tip, dir2, 0.12, 0.0018, 3, 0.1, 0.55, 0.055, 0.075);
      secTips.push({ tip: tip2, dir: dir2 });
      if (rand() < 0.25) addPepper(tip.clone().addScaledVector(dir2, 0.12 * (0.2 + rand() * 0.5)));
    }
  }

  // ---- tertiary twigs (short, bearing young leaves at the growing tips) ----
  for (let i = 0; i < secTips.length; i++) {
    const { tip, dir } = secTips[i];
    for (let k = 0; k < 2; k++) {
      const az = (k / 2) * Math.PI * 2 + rand();
      const axis = perpAtAz(dir, az);
      const tilt = 0.4 + (rand() - 0.5) * 0.3;
      const dir3 = dir.clone().applyAxisAngle(axis, tilt).normalize();
      const end = tip.clone().addScaledVector(dir3, 0.05);
      segments.push({ p0: tip.clone(), p1: end.clone(), r: 0.0011 });
      pushLeafAt(end, 0.2, 0.7, 0.045, 0.06); // terminal young leaf at the tip
    }
  }

  // ---- bamboo stake beside the stem, tied to it ----
  const stakeGroup = new THREE.Group();
  const stakeH = 0.55;
  const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.0075, stakeH, 8), stakeMat);
  stake.position.y = stakeH / 2;
  stakeGroup.add(stake);
  for (const ny of [0.16, 0.34, 0.48]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8), ringMat);
    ring.position.y = ny;
    stakeGroup.add(ring);
  }
  stakeGroup.position.set(0.034, 0, 0.02);
  stakeGroup.rotation.z = -0.05;
  group.add(stakeGroup);
  for (const ty of [0.24, 0.4]) {
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.0022, 0.0022, 0.05, 6), tieMat);
    tie.position.set(0.017, ty, 0.01);
    tie.rotation.z = Math.PI / 2;
    group.add(tie);
  }

  // ---- assemble instanced meshes ----
  const branchGeom = buildBranchGeometry();
  const branchMesh = new THREE.InstancedMesh(branchGeom, stemMat, segments.length);
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const dir3 = new THREE.Vector3();
  for (let i = 0; i < segments.length; i++) {
    const b = segments[i];
    dir3.set(b.p1.x - b.p0.x, b.p1.y - b.p0.y, b.p1.z - b.p0.z);
    const len = dir3.length();
    dir3.normalize();
    q4.setFromUnitVectors(UP, dir3);
    p3.set(b.p0.x, b.p0.y, b.p0.z);
    s3.set(b.r, len, b.r);
    m4.compose(p3, q4, s3);
    branchMesh.setMatrixAt(i, m4);
  }
  group.add(branchMesh);

  const pedicelMesh = new THREE.InstancedMesh(branchGeom, stemMat, pedicels.length);
  for (let i = 0; i < pedicels.length; i++) {
    const b = pedicels[i];
    dir3.set(b.p1.x - b.p0.x, b.p1.y - b.p0.y, b.p1.z - b.p0.z);
    const len = dir3.length();
    dir3.normalize();
    q4.setFromUnitVectors(UP, dir3);
    p3.set(b.p0.x, b.p0.y, b.p0.z);
    s3.set(b.r, len, b.r);
    m4.compose(p3, q4, s3);
    pedicelMesh.setMatrixAt(i, m4);
  }
  group.add(pedicelMesh);

  const leafGeom = buildLeafGeometry();
  const leafMesh = new THREE.InstancedMesh(leafGeom, leafMat, leaves.length);
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
  for (let i = 0; i < leaves.length; i++) {
    const L = leaves[i];
    v1.set(L.sx, L.sy, L.sz);
    v2.set(L.lx, L.ly, L.lz);
    v3.set(L.nx, L.ny, L.nz);
    m4.makeBasis(v1, v2, v3);
    m4.setPosition(L.px, L.py, L.pz);
    s3.set(L.w, L.len, L.len);
    m4.scale(s3);
    leafMesh.setMatrixAt(i, m4);
    leafMesh.setColorAt(i, L.color);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  group.add(leafMesh);

  const pepperGeom = buildPepperGeometry();
  const pepperMesh = new THREE.InstancedMesh(pepperGeom, pepperMat, peppers.length);
  for (let i = 0; i < peppers.length; i++) {
    const P = peppers[i];
    q4.setFromAxisAngle(new THREE.Vector3(P.ax, 0, P.az), P.lean);
    p3.set(P.px, P.py, P.pz);
    m4.compose(p3, q4, s3.setScalar(P.len));
    pepperMesh.setMatrixAt(i, m4);
    pepperMesh.setColorAt(i, P.color);
  }
  pepperMesh.instanceMatrix.needsUpdate = true;
  if (pepperMesh.instanceColor) pepperMesh.instanceColor.needsUpdate = true;
  group.add(pepperMesh);

  const calyxGeom = new THREE.ConeGeometry(0.0035, 0.006, 6);
  const calyxMesh = new THREE.InstancedMesh(calyxGeom, calyxMat, calyxes.length);
  for (let i = 0; i < calyxes.length; i++) {
    const c = calyxes[i];
    q4.setFromAxisAngle(new THREE.Vector3(c.ax, 0, c.az), c.lean);
    p3.set(c.px, c.py, c.pz);
    m4.compose(p3, q4, s3.setScalar(1));
    calyxMesh.setMatrixAt(i, m4);
  }
  group.add(calyxMesh);

  // ---- normalise to requested height (above soil) and spread, uniform ----
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
