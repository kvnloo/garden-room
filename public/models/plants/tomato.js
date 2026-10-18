import * as THREE from 'three';

// Tomato (Solanum lycopersicum) ~1 m on a thin dark-green stake: a sparse, stressed
// pot plant with a WIDE, irregular network of side stems. One thin crooked main stem
// tied to the stake tapers to a sparse tip; a tall right-hand fork and long lower
// branches reach well past the pot, many bare or ending in shrivelled twigs. Foliage
// is uneven: pinnately-compound leaves with large, irregularly lobed and serrated,
// curled leaflets. Fresh dull-green leaves cluster near the top and the right fork;
// middle-left and lower-right branches carry drooping yellow-brown and dead-brown
// clusters. Six small round, bright-green unripe tomatoes with pointed calyxes hang
// on thin trusses (three near the top, plus isolated middle-right and lower-left
// fruit). A little dead debris lies on the soil inside the pot rim.

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

const UP = new THREE.Vector3(0, 1, 0);

// Tapered cylinder from point a (radius r1) to point b (radius r2).
function cylinderBetween(a, b, r1, r2, radial, mat) {
  const dir = b.clone().sub(a);
  const len = Math.max(1e-5, dir.length());
  const g = new THREE.CylinderGeometry(r2, r1, len, radial);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, dir.normalize());
  return m;
}

// Unit lobed + serrated leaflet: length 1 along +Y (base y=0, tip y=1), width along +X.
// Broad ovate-lanceolate outline with a few irregular lobes plus triangular serrations,
// a lengthwise bow, raised midrib and curled (cupped) edges.
function buildLeafletGeometry() {
  const SEG = 10;
  const rows = SEG + 1;
  const TEETH = 6, LOBES = 2.3;
  const pos = new Float32Array(rows * 3 * 3);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    const s = Math.sin(Math.PI * t);
    let w = 0.36 * Math.pow(s, 0.62) * (1 - 0.24 * t);
    const lobeEnv = Math.sin(Math.PI * Math.min(1, t * 1.08));
    w *= 1 + 0.24 * Math.sin(Math.PI * LOBES * t + 0.7) * lobeEnv;   // irregular lobes
    const tri = 2 * Math.abs(((t * TEETH) % 1) - 0.5);
    const saw = tri * 2 - 1;
    const serrEnv = Math.min(1, t * 6) * (1 - t * t * 0.55);
    w *= 1 + 0.20 * saw * serrEnv;                                   // serrations
    w = Math.max(0.008, w);
    const bow = s * 0.03;        // lengthwise upward bow
    const midZ = bow + s * 0.052; // raised midrib
    const edgeZ = bow - s * 0.052; // curled edges
    const i = r * 3;
    pos[(i + 0) * 3 + 0] = -w; pos[(i + 0) * 3 + 1] = t; pos[(i + 0) * 3 + 2] = edgeZ;
    pos[(i + 1) * 3 + 0] = 0;  pos[(i + 1) * 3 + 1] = t; pos[(i + 1) * 3 + 2] = midZ;
    pos[(i + 2) * 3 + 0] = w;  pos[(i + 2) * 3 + 1] = t; pos[(i + 2) * 3 + 2] = edgeZ;
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

// Tapered unit rachis segment (compound-leaf midrib), base at y=0, open-ended.
function buildRachisGeometry() {
  const g = new THREE.CylinderGeometry(0.55, 1, 1, 4, 1, true);
  g.translate(0, 0.5, 0);
  return g;
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
  const S = height / 1.0; // reference plant ~1 m tall above soil

  // ---- materials ----
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x8a9460, roughness: 0.9 });   // pale green, softly hairy
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0x2c4a30, roughness: 0.75 });  // thin dark-green support
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x4a3a26, roughness: 0.95 });    // twine
  const rachisMat = new THREE.MeshStandardMaterial({ color: 0x6a7a48, roughness: 0.7 });
  const deadTwigMat = new THREE.MeshStandardMaterial({ color: 0x6a5238, roughness: 0.9 }); // brown dead shoots
  const debrisMat = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 0.9, side: THREE.DoubleSide });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, side: THREE.DoubleSide });
  const tomatoMat = new THREE.MeshStandardMaterial({ color: 0x6fae3a, roughness: 0.34 }); // slightly darker green, subtle gloss
  const calyxMat = new THREE.MeshStandardMaterial({ color: 0x3d5a2a, roughness: 0.85 });   // pointed green calyx

  // ---- main stem: thin, crooked, tapering to a sparse tip ----
  const stemTop = 0.85 * S;
  const stemPts = [new THREE.Vector3(0, 0, 0)];
  {
    let px = 0, py = 0, pz = 0;
    const steps = 14;
    for (let i = 0; i < steps; i++) {
      py += (stemTop / steps);
      px += (rand() - 0.5) * 0.030 * S - 0.003 * S; // slight bias toward the stake (-x)
      pz += (rand() - 0.5) * 0.024 * S;
      stemPts.push(new THREE.Vector3(px, py, pz));
    }
  }
  for (let i = 0; i < stemPts.length - 1; i++) {
    const y0 = stemPts[i].y, y1 = stemPts[i + 1].y;
    const r0 = lerp(0.0072, 0.0032, y0 / stemTop) * S;
    const r1 = lerp(0.0072, 0.0032, y1 / stemTop) * S;
    group.add(cylinderBetween(stemPts[i], stemPts[i + 1], r0, r1, 5, stemMat));
  }
  // woody brown basal collar of the stem
  group.add(cylinderBetween(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.07 * S, 0), 0.010 * S, 0.0075 * S, 5, deadTwigMat));
  function stemPointAtY(y) {
    for (let i = 0; i < stemPts.length - 1; i++) {
      if (y <= stemPts[i + 1].y) {
        const t = (y - stemPts[i].y) / Math.max(1e-6, stemPts[i + 1].y - stemPts[i].y);
        return stemPts[i].clone().lerp(stemPts[i + 1], t);
      }
    }
    return stemPts[stemPts.length - 1].clone();
  }

  // ---- thin dark-green stake, slightly tilted, tied to the stem ----
  const stakeH = 0.86 * S;
  const stakeRad = 0.008 * S;
  const stakeBase = new THREE.Vector3(-0.03 * S, 0, 0.008 * S);
  const stakeMesh = new THREE.Mesh(new THREE.CylinderGeometry(stakeRad, stakeRad * 1.2, stakeH, 8), stakeMat);
  stakeMesh.position.copy(stakeBase).add(new THREE.Vector3(0, stakeH / 2, 0));
  stakeMesh.rotation.z = 0.035;
  stakeMesh.rotation.x = -0.025;
  group.add(stakeMesh);

  for (const ty of [0.3, 0.5, 0.66].map((f) => f * S)) {
    const sp = stemPointAtY(ty);
    const off = stakeBase.clone().sub(sp);
    const mid = sp.clone().add(off.clone().multiplyScalar(0.5));
    const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.0035 * S, 0.0035 * S, off.length() + 0.014 * S, 4), tieMat);
    tie.position.copy(mid);
    tie.quaternion.setFromUnitVectors(UP, off.normalize());
    group.add(tie);
  }

  // ---- side branches: a crooked tapered tube between two points ----
  function makeBranch(origin, end, r0, r1, mat, sag) {
    const mid = origin.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(origin);
    const len = dir.length();
    const n = dir.clone().normalize();
    const perp = new THREE.Vector3(-n.z, 0, n.x).multiplyScalar(len * 0.35 * (rand() - 0.5));
    const control = mid.clone().add(perp).add(new THREE.Vector3(0, -sag * len, 0));
    const curve = new THREE.QuadraticBezierCurve3(origin, control, end);
    const N = 4;
    for (let i = 0; i < N; i++) {
      const a = curve.getPoint(i / N);
      const b = curve.getPoint((i + 1) / N);
      group.add(cylinderBetween(a, b, lerp(r0, r1, i / N), lerp(r0, r1, (i + 1) / N), 4, mat));
    }
    return curve;
  }

  // tall right-hand fork: outward and upward
  makeBranch(stemPointAtY(0.28 * S), new THREE.Vector3(0.24 * S, 0.80 * S, 0.03 * S), 0.0045 * S, 0.0016 * S, stemMat, 0.03);
  // upper-right secondary twig off the fork
  makeBranch(new THREE.Vector3(0.14 * S, 0.56 * S, 0.02 * S), new THREE.Vector3(0.27 * S, 0.62 * S, 0.08 * S), 0.0028 * S, 0.0009 * S, stemMat, 0.05);
  // middle-left branch (drooping yellow cluster)
  makeBranch(stemPointAtY(0.37 * S), new THREE.Vector3(-0.27 * S, 0.24 * S, -0.01 * S), 0.0040 * S, 0.0014 * S, stemMat, 0.22);
  // mid-left secondary (bare)
  makeBranch(new THREE.Vector3(-0.14 * S, 0.30 * S, -0.01 * S), new THREE.Vector3(-0.31 * S, 0.18 * S, 0.02 * S), 0.0026 * S, 0.0008 * S, deadTwigMat, 0.25);
  // lower-right branch (decayed cluster)
  makeBranch(stemPointAtY(0.20 * S), new THREE.Vector3(0.29 * S, 0.09 * S, 0.06 * S), 0.0036 * S, 0.0011 * S, deadTwigMat, 0.3);
  // lower-left branch (mostly bare)
  makeBranch(stemPointAtY(0.16 * S), new THREE.Vector3(-0.23 * S, 0.07 * S, -0.04 * S), 0.0032 * S, 0.0010 * S, deadTwigMat, 0.34);
  // low bare twig (right)
  makeBranch(stemPointAtY(0.10 * S), new THREE.Vector3(0.13 * S, 0.04 * S, 0.09 * S), 0.0024 * S, 0.0007 * S, deadTwigMat, 0.3);
  // mid-back branch (green)
  makeBranch(stemPointAtY(0.46 * S), new THREE.Vector3(0.03 * S, 0.50 * S, 0.26 * S), 0.0036 * S, 0.0014 * S, stemMat, 0.1);
  // front branch (yellowing, balances the depth)
  makeBranch(stemPointAtY(0.42 * S), new THREE.Vector3(0.0 * S, 0.32 * S, -0.22 * S), 0.0036 * S, 0.0014 * S, stemMat, 0.16);

  // ---- extra fine dead twigs / shrivelled petioles ----
  for (let i = 0; i < 7; i++) {
    const y = (0.14 + 0.6 * rand()) * S;
    const node = stemPointAtY(y);
    const az = rand() * Math.PI * 2;
    const len = (0.035 + 0.055 * rand()) * S;
    const end = new THREE.Vector3(node.x + Math.cos(az) * len, node.y - (0.01 + 0.04 * rand()) * S, node.z + Math.sin(az) * len);
    group.add(cylinderBetween(node, end, 0.0022 * S, 0.0011 * S, 3, deadTwigMat));
  }

  // ---- compound leaves ----
  const rachisGeom = buildRachisGeometry();
  const leafGeom = buildLeafletGeometry();
  const rachisSegList = [];
  const leafList = [];

  function addLeaf(node, phi, health) {
    const droop = 1 - health;
    const elev = lerp(-0.6, 0.35, health) + (rand() - 0.5) * 0.18;
    const a0 = Math.PI / 2 - elev;
    let arc = 0.36 + 0.66 * droop;
    arc = Math.min(arc, Math.PI - a0 - 0.1);

    const rachisLen = (0.20 - 0.05 * droop) * S * (0.9 + 0.2 * rand());
    const R = rachisLen / arc;

    const F = (a) => ({
      x: -Math.cos(a) * Math.cos(phi),
      y: Math.sin(a),
      z: -Math.cos(a) * Math.sin(phi),
    });
    const F0x = -Math.cos(a0) * Math.cos(phi);
    const F0y = Math.sin(a0);
    const F0z = -Math.cos(a0) * Math.sin(phi);

    const NSEG = 3;
    for (let s = 0; s < NSEG; s++) {
      const aMid = a0 + arc * ((s + 0.5) / NSEG);
      const f = F(aMid);
      rachisSegList.push({
        px: node.x + R * (f.x - F0x),
        py: node.y + R * (f.y - F0y),
        pz: node.z + R * (f.z - F0z),
        tx: Math.sin(aMid) * Math.cos(phi), ty: Math.cos(aMid), tz: Math.sin(aMid) * Math.sin(phi),
        len: R * (arc / NSEG),
      });
    }

    const pairs = health < 0.3 ? 1 + Math.floor(rand() * 2) : 2 + Math.floor(rand() * 3);
    const leafLen = (0.074 + 0.016 * rand()) * S;
    const leafW = leafLen * 0.58;
    const Ux = -Math.sin(phi), Uz = Math.cos(phi);
    const zs = 1 + 0.9 * droop;
    const twistAmp = 0.55 + 0.85 * droop;

    let hue, sat, light;
    if (health > 0.55) { hue = lerp(0.30, 0.24, (1 - health) / 0.45); sat = 0.36; light = 0.30; }
    else if (health > 0.22) { hue = lerp(0.17, 0.11, (0.55 - health) / 0.33); sat = 0.30; light = 0.34; }
    else { hue = 0.08; sat = 0.22; light = 0.27; }

    const place = (alpha, side) => {
      const sinA = Math.sin(alpha), cosA = Math.cos(alpha);
      const f = F(alpha);
      const px = node.x + R * (f.x - F0x);
      const py = node.y + R * (f.y - F0y);
      const pz = node.z + R * (f.z - F0z);
      const tx = sinA * Math.cos(phi), ty = cosA, tz = sinA * Math.sin(phi);
      let mx = ty * Uz, my = tz * Ux - tx * Uz, mz = -ty * Ux;
      const ml = Math.hypot(mx, my, mz) || 1; mx /= ml; my /= ml; mz /= ml;

      let upx, upy, upz;
      if (side === 0) { upx = tx; upy = ty; upz = tz; }
      else { upx = Ux * side + tx * 0.4; upy = ty * 0.4; upz = Uz * side + tz * 0.4; }
      upx += (rand() - 0.5) * 0.3; upy += (rand() - 0.5) * 0.3; upz += (rand() - 0.5) * 0.3;
      const ul = Math.hypot(upx, upy, upz) || 1; upx /= ul; upy /= ul; upz /= ul;

      let rx = upy * mz - upz * my, ry = upz * mx - upx * mz, rz = upx * my - upy * mx;
      const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
      let nx = ry * upz - rz * upy, ny = rz * upx - rx * upz, nz = rx * upy - ry * upx;

      const twist = (rand() - 0.5) * twistAmp;
      const ct = Math.cos(twist), st = Math.sin(twist);
      const r2x = rx * ct + nx * st, r2y = ry * ct + ny * st, r2z = rz * ct + nz * st;
      const n2x = nx * ct - rx * st, n2y = ny * ct - ry * st, n2z = nz * ct - rz * st;

      const j = (rand() - 0.5) * 0.04;
      const color = new THREE.Color().setHSL(
        clamp(hue + j, 0.03, 0.34),
        clamp(sat + (rand() - 0.5) * 0.07, 0.15, 0.5),
        clamp(light + (rand() - 0.5) * 0.055, 0.18, 0.45),
      );

      const sf = 0.76 + 0.48 * rand(); // unequal leaflet sizes along the rachis
      leafList.push({
        px, py, pz,
        rx: r2x, ry: r2y, rz: r2z,
        ux: upx, uy: upy, uz: upz,
        nx: n2x, ny: n2y, nz: n2z,
        w: leafW * sf, l: leafLen * sf, zs, color,
      });
    };

    for (let k = 0; k < pairs; k++) {
      const tt = (k + 1) / (pairs + 1);
      const alpha = a0 + arc * tt;
      place(alpha, -1);
      place(alpha, 1);
    }
    place(a0 + arc, 0); // terminal leaflet
  }

  // foliage patches (uneven): upper green on the right fork + stem, middle-left yellow,
  // lower-right decayed, lower-left dead, one mid-back green.
  addLeaf(new THREE.Vector3(0.14 * S, 0.62 * S, 0.02 * S), 0.5, 0.85);
  addLeaf(new THREE.Vector3(0.16 * S, 0.72 * S, 0.03 * S), 1.2, 0.8);
  addLeaf(stemPointAtY(0.72 * S), 2.2, 0.75);
  addLeaf(new THREE.Vector3(0.02 * S, 0.50 * S, 0.24 * S), 4.0, 0.6);
  addLeaf(new THREE.Vector3(0.0 * S, 0.30 * S, -0.19 * S), 5.5, 0.42);
  addLeaf(new THREE.Vector3(-0.20 * S, 0.27 * S, -0.01 * S), 3.2, 0.4);
  addLeaf(new THREE.Vector3(-0.16 * S, 0.30 * S, 0.0 * S), 2.6, 0.32);
  addLeaf(new THREE.Vector3(0.22 * S, 0.12 * S, 0.05 * S), 5.9, 0.2);
  addLeaf(new THREE.Vector3(0.16 * S, 0.15 * S, 0.03 * S), 5.3, 0.12);
  addLeaf(new THREE.Vector3(-0.17 * S, 0.09 * S, -0.03 * S), 3.8, 0.08);

  // instanced rachis segments
  const rachisMesh = new THREE.InstancedMesh(rachisGeom, rachisMat, rachisSegList.length);
  const rachisScale = new THREE.Vector3();
  const rdir = new THREE.Vector3();
  for (let i = 0; i < rachisSegList.length; i++) {
    const s = rachisSegList[i];
    rdir.set(s.tx, s.ty, s.tz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, rdir);
    const r = 0.0028 * S;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(s.px, s.py, s.pz), q, new THREE.Vector3(r, s.len, r));
    rachisMesh.setMatrixAt(i, m);
  }
  rachisMesh.instanceMatrix.needsUpdate = true;
  group.add(rachisMesh);

  // instanced lobed/serrated leaflets
  const leafMesh = new THREE.InstancedMesh(leafGeom, leafMat, leafList.length);
  const mm = new THREE.Matrix4();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
  for (let i = 0; i < leafList.length; i++) {
    const L = leafList[i];
    v1.set(L.rx, L.ry, L.rz);
    v2.set(L.ux, L.uy, L.uz);
    v3.set(L.nx, L.ny, L.nz);
    mm.makeBasis(v1, v2, v3);
    v4.set(L.px, L.py, L.pz);
    mm.setPosition(v4);
    rachisScale.set(L.w, L.l, L.l * L.zs);
    mm.scale(rachisScale);
    leafMesh.setMatrixAt(i, mm);
    leafMesh.setColorAt(i, L.color);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  group.add(leafMesh);

  // ---- six small round bright-green tomatoes with pointed calyxes ----
  const tomatoGeom = new THREE.SphereGeometry(0.028 * S, 8, 6);
  function makeCalyx() {
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sep = new THREE.Mesh(new THREE.ConeGeometry(0.0035 * S, 0.009 * S, 3), calyxMat);
      sep.position.set(Math.cos(a) * 0.005 * S, 0.002 * S, Math.sin(a) * 0.005 * S);
      sep.rotation.z = Math.cos(a) * 0.7;
      sep.rotation.x = -Math.sin(a) * 0.7;
      g.add(sep);
    }
    return g;
  }
  const calyxTemplate = makeCalyx();

  function addTomato(node, az, drop, reach) {
    const stalkEnd = new THREE.Vector3(node.x + Math.cos(az) * reach, node.y - drop, node.z + Math.sin(az) * reach);
    const stalkDir = stalkEnd.clone().sub(node);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.0018 * S, 0.0018 * S, stalkDir.length(), 3), rachisMat);
    stalk.position.copy(node).add(stalkDir.clone().multiplyScalar(0.5));
    stalk.quaternion.setFromUnitVectors(UP, stalkDir.clone().normalize());
    group.add(stalk);
    const t = new THREE.Mesh(tomatoGeom, tomatoMat);
    t.position.copy(stalkEnd);
    t.rotation.y = rand() * Math.PI;
    group.add(t);
    const c = calyxTemplate.clone();
    c.position.copy(stalkEnd).add(stalkDir.clone().normalize().multiplyScalar(-0.022 * S));
    c.quaternion.setFromUnitVectors(UP, stalkDir.clone().normalize().multiplyScalar(-1));
    group.add(c);
    return stalkEnd;
  }

  // three clustered at the plant apex (tip of the tall right fork)
  {
    const n = new THREE.Vector3(0.22 * S, 0.78 * S, 0.03 * S);
    const az = 0.4;
    const end = addTomato(n, az, 0.028 * S, 0.042 * S);
    addTomato(end, az + 0.55, 0.016 * S, 0.016 * S);
    addTomato(end, az - 0.55, 0.018 * S, 0.018 * S);
  }
  // isolated middle-right fruit (out on the lower-right branch)
  addTomato(new THREE.Vector3(0.25 * S, 0.11 * S, 0.05 * S), 5.8, 0.032 * S, 0.032 * S);
  // lower-left fruit (out on the lower-left branch)
  addTomato(new THREE.Vector3(-0.19 * S, 0.09 * S, -0.035 * S), 3.4, 0.036 * S, 0.032 * S);
  // mid fruit (out on the front branch)
  addTomato(new THREE.Vector3(0.0 * S, 0.36 * S, -0.19 * S), 1.9, 0.032 * S, 0.04 * S);

  // ---- small curled dead leaves + fine dry stems on the soil (inside the pot) ----
  for (let i = 0; i < 3; i++) {
    const a = rand() * Math.PI * 2;
    const rr = (0.04 + 0.08 * rand()) * S;
    const m = new THREE.Mesh(leafGeom, debrisMat);
    m.position.set(Math.cos(a) * rr, 0.005 * S, Math.sin(a) * rr);
    m.rotation.x = -Math.PI / 2 + (rand() - 0.5) * 0.5;
    m.rotation.z = rand() * Math.PI;
    m.scale.setScalar(0.05 * S);
    group.add(m);
  }
  for (let i = 0; i < 6; i++) {
    const a = rand() * Math.PI * 2;
    const rr = (0.03 + 0.09 * rand()) * S;
    const p0 = new THREE.Vector3(Math.cos(a) * rr, 0.003 * S, Math.sin(a) * rr);
    const p1 = new THREE.Vector3(p0.x + (rand() - 0.5) * 0.06 * S, 0.006 * S, p0.z + (rand() - 0.5) * 0.06 * S);
    group.add(cylinderBetween(p0, p1, 0.0012 * S, 0.0008 * S, 3, deadTwigMat));
  }

  // ---- normalise to requested height (above soil) and canopy spread ----
  const box = new THREE.Box3().setFromObject(group);
  const plantH = Math.max(1e-4, box.max.y);
  const plantW = Math.max(1e-4, box.max.x - box.min.x, box.max.z - box.min.z);
  group.scale.set(spread / plantW, height / plantH, spread / plantW);

  return group;
}
