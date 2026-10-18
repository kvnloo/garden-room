import * as THREE from 'three';

// Curry leaf (Murraya koenigii): thin upright woody stems bearing pinnately
// compound leaves whose thin rachis arcs outward and droops, lined with small
// glossy ovate leaflets in opposite pairs plus a terminal leaflet. Foliage
// cascades down over the pot rim into an airy but full canopy.

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Unit leaflet: length 1 along +Y (petiole at y=0, tip at y=1), full width 1
// along +X. Elongated ovate silhouette (rounded base/shoulders, broad middle,
// tapered tip) with a lengthwise bow, raised midrib and gently cupped edges.
// 4 length segments -> 16 tris.
function buildLeafletGeometry() {
  const SEG = 4;
  const rows = SEG + 1;
  const halfW = [0.12, 0.42, 0.50, 0.36, 0.02];
  const pos = new Float32Array(rows * 3 * 3);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    const w = halfW[r];
    const s = Math.sin(Math.PI * t);
    const bow = s * 0.035;            // lengthwise upward bow
    const midZ = bow + s * 0.045;     // raised midrib (central vein)
    const edgeZ = bow - s * 0.045;    // cupped edges
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

// Tapered unit rachis segment (compound-leaf midrib), base at y=0. Open-ended.
function buildRachisGeometry() {
  const g = new THREE.CylinderGeometry(0.6, 1, 1, 4, 1, true);
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
  const S = height / 0.85; // reference is an ~85 cm plant

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x7a6a45, roughness: 0.85 });
  const rachisMat = new THREE.MeshStandardMaterial({ color: 0x8a9a5a, roughness: 0.7 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.26, side: THREE.DoubleSide });

  // ---- stems (thin, bent, green-brown, mostly hidden by foliage) ----
  const stemCount = 4;
  const stems = [];
  for (let i = 0; i < stemCount; i++) {
    const h = height * (0.42 + 0.30 * rand()); // 0.42..0.72 of height
    const leanAz = rand() * Math.PI * 2;
    const lean = 0.03 + 0.08 * rand();
    const bendAz = leanAz + (rand() - 0.5) * 1.4;
    const base = new THREE.Vector3((rand() - 0.5) * 0.04 * S, 0, (rand() - 0.5) * 0.04 * S);
    const tip = new THREE.Vector3(
      base.x + Math.sin(lean) * Math.cos(leanAz) * h,
      Math.cos(lean) * h,
      base.z + Math.sin(lean) * Math.sin(leanAz) * h,
    );
    const mid = base.clone().add(tip).multiplyScalar(0.5);
    const bend = (0.06 + 0.12 * rand()) * h;
    const control = mid.clone().add(new THREE.Vector3(Math.cos(bendAz) * bend, 0, Math.sin(bendAz) * bend));
    const curve = new THREE.QuadraticBezierCurve3(base, control, tip);
    const geom = new THREE.TubeGeometry(curve, 4, 0.005 * S, 4, false);
    const mesh = new THREE.Mesh(geom, stemMat);
    group.add(mesh);
    stems.push({ curve, h });
  }

  // ---- compound leaves (fronds): arching then cascading down ----
  const rachisGeom = buildRachisGeometry();
  const leafGeom = buildLeafletGeometry();
  const rachisSegList = [];
  const leafList = [];

  const UP = new THREE.Vector3(0, 1, 0);

  for (let si = 0; si < stemCount; si++) {
    const stem = stems[si];
    const nF = 5 + Math.floor(rand() * 3); // 5..7 fronds per stem
    for (let j = 0; j < nF; j++) {
      const frac = Math.min(0.92, Math.max(0.05, 0.05 + (j / Math.max(1, nF - 1)) * 0.78 + (rand() - 0.5) * 0.07));
      const node = stem.curve.getPoint(frac);
      const phi = j * 2.399 + (rand() - 0.5) * 0.7 + si * 0.8;

      // Tangent angle of the frond centreline, measured from +Y (0=up, pi=down).
      const a0 = 0.45 + 0.50 * rand();                     // starts near-horizontal/up
      let arc = 1.0 + 1.1 * rand();                        // sweeps downward
      arc += Math.max(0, 0.5 - frac) * 1.6;                // low fronds cascade harder
      arc = Math.min(arc, 2.1, Math.PI - a0 - 0.15);       // keep tips from curling far under
      const rachisLen = (0.22 + 0.15 * rand()) * S * (1 - 0.10 * frac);
      const R = rachisLen / arc;

      // F(a) = (-cos a cos phi, sin a, -cos a sin phi); position(a) = node + R*(F(a)-F(a0)).
      const F0x = -Math.cos(a0) * Math.cos(phi);
      const F0y = Math.sin(a0);
      const F0z = -Math.cos(a0) * Math.sin(phi);
      const F = (a) => ({
        x: -Math.cos(a) * Math.cos(phi),
        y: Math.sin(a),
        z: -Math.cos(a) * Math.sin(phi),
      });

      // Curved rachis: NSEG short segments following the arc (so the axis visibly droops).
      const NSEG = 3;
      for (let s = 0; s < NSEG; s++) {
        const aMid = a0 + arc * ((s + 0.5) / NSEG);
        const f = F(aMid);
        const sinA = Math.sin(aMid), cosA = Math.cos(aMid);
        rachisSegList.push({
          px: node.x + R * (f.x - F0x),
          py: node.y + R * (f.y - F0y),
          pz: node.z + R * (f.z - F0z),
          tx: sinA * Math.cos(phi), ty: cosA, tz: sinA * Math.sin(phi),
          len: R * (arc / NSEG),
        });
      }

      const pairs = 5 + Math.floor(rand() * 3); // 5..7 pairs -> 11..15 leaflets
      const leafSize = 0.85 + 0.35 * Math.sin(Math.PI * frac);
      const leafLen = rachisLen * 0.20 * leafSize * (0.9 + 0.2 * rand());
      const leafW = leafLen * 0.52;

      const Ux = -Math.sin(phi), Uz = Math.cos(phi); // horizontal sideways axis

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
        else { upx = Ux * side + tx * 0.45; upy = ty * 0.45; upz = Uz * side + tz * 0.45; }
        upx += (rand() - 0.5) * 0.16; upy += (rand() - 0.5) * 0.16; upz += (rand() - 0.5) * 0.16;
        const ul = Math.hypot(upx, upy, upz) || 1; upx /= ul; upy /= ul; upz /= ul;

        let rx = upy * mz - upz * my, ry = upz * mx - upx * mz, rz = upx * my - upy * mx;
        const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
        let nx = ry * upz - rz * upy, ny = rz * upx - rx * upz, nz = rx * upy - ry * upx;

        const twist = (rand() - 0.5) * 0.9;
        const ct = Math.cos(twist), st = Math.sin(twist);
        const r2x = rx * ct + nx * st, r2y = ry * ct + ny * st, r2z = rz * ct + nz * st;
        const n2x = nx * ct - rx * st, n2y = ny * ct - ry * st, n2z = nz * ct - rz * st;

        const hue = 0.285 + (rand() - 0.5) * 0.09;
        const sat = 0.45 + (rand() - 0.5) * 0.20;
        const light = 0.25 + (rand() - 0.5) * 0.12 + (frac - 0.5) * 0.05;
        const color = new THREE.Color().setHSL(hue, sat, light);

        leafList.push({
          px, py, pz,
          rx: r2x, ry: r2y, rz: r2z,
          ux: upx, uy: upy, uz: upz,
          nx: n2x, ny: n2y, nz: n2z,
          w: leafW, l: leafLen, color,
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
  }

  // curved rachis instanced mesh
  const rachisMesh = new THREE.InstancedMesh(rachisGeom, rachisMat, rachisSegList.length);
  const rachisScale = new THREE.Vector3();
  const rdir = new THREE.Vector3();
  for (let i = 0; i < rachisSegList.length; i++) {
    const s = rachisSegList[i];
    rdir.set(s.tx, s.ty, s.tz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, rdir);
    const r = 0.0022 * S;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(s.px, s.py, s.pz), q, new THREE.Vector3(r, s.len, r));
    rachisMesh.setMatrixAt(i, m);
  }
  rachisMesh.instanceMatrix.needsUpdate = true;
  group.add(rachisMesh);

  // leaflet instanced mesh
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
    rachisScale.set(L.w, L.l, L.l);
    mm.scale(rachisScale);
    leafMesh.setMatrixAt(i, mm);
    leafMesh.setColorAt(i, L.color);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  group.add(leafMesh);

  // Normalise so the built plant fills the requested height (above soil) and
  // spread (canopy diameter).
  const box = new THREE.Box3().setFromObject(group);
  const plantH = Math.max(1e-4, box.max.y); // height above soil (origin = soil surface)
  const plantW = Math.max(1e-4, box.max.x - box.min.x, box.max.z - box.min.z);
  group.scale.set(spread / plantW, height / plantH, spread / plantW);

  return group;
}
