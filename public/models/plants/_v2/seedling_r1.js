import * as THREE from 'three';
import { makeBranching } from '/models/plants/_shared/branching.js';

// Seedling pot — species-specific sparse reconstruction.
//
// FORM HYPOTHESIS (round 1): the reference is a sparse clump of 3-5 slender,
// gently arching upright sprouts, each carrying very few tiny pale-green
// rounded-ovate leaves at successive upper nodes over a bare lower stem, plus
// a couple of bare branching twigs near the base. The r0 candidate failed
// because it built two dominant straight shoots (a narrow vertical spray),
// left long empty internodes, drew narrow pointed "sliver" leaves, and
// scattered 42 isolated straight dead segments instead of connected branching
// twigs. This round couples (a) one broader rounded-ovate leaf coupon with a
// real short petiole, (b) even-height gently curved upright stems with paired
// leaves at successive nodes, and (c) makeBranching() bare-twig skeletons, as
// a single botanical reconstruction of a sparse, upright, stressed seedling.
// Not a lush bouquet. Soil and mosaic pot are supplied by the harness.

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Strongly tapered, curved stem: a circle swept along `curve` whose radius
// shrinks from rBase to tipFrac*rBase (delicate point). Parallel-transport
// framing. radialSeg x tubularSeg x 2 triangles.
function buildTaperedStemGeometry(curve, rBase, tipFrac, radialSeg, tubularSeg) {
  const pts = [], tans = [];
  for (let i = 0; i <= tubularSeg; i++) {
    const t = i / tubularSeg;
    pts.push(curve.getPointAt(t));
    tans.push(curve.getTangentAt(t).normalize());
  }
  const up = new THREE.Vector3(0, 1, 0);
  const n = new THREE.Vector3().copy(up).addScaledVector(tans[0], -up.dot(tans[0]));
  if (n.lengthSq() < 1e-8) n.set(1, 0, 0); else n.normalize();
  const b = new THREE.Vector3();
  const positions = [];
  const idx = [];
  for (let i = 0; i <= tubularSeg; i++) {
    const p = pts[i], t = tans[i];
    if (i > 0) {
      n.addScaledVector(t, -n.dot(t));
      if (n.lengthSq() < 1e-8) n.set(1, 0, 0); else n.normalize();
    }
    b.crossVectors(t, n).normalize();
    const r = rBase * (1 - (1 - tipFrac) * (i / tubularSeg));
    for (let k = 0; k < radialSeg; k++) {
      const th = (k / radialSeg) * Math.PI * 2;
      const cx = Math.cos(th), sx = Math.sin(th);
      positions.push(
        p.x + r * (cx * n.x + sx * b.x),
        p.y + r * (cx * n.y + sx * b.y),
        p.z + r * (cx * n.z + sx * b.z),
      );
    }
  }
  for (let i = 0; i < tubularSeg; i++) {
    for (let k = 0; k < radialSeg; k++) {
      const a = i * radialSeg + k;
      const bb = i * radialSeg + (k + 1) % radialSeg;
      const c = (i + 1) * radialSeg + k;
      const d = (i + 1) * radialSeg + (k + 1) % radialSeg;
      idx.push(a, bb, c, bb, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Rounded-ovate leaf coupon: a short petiole (y = 0..petioleLen, narrow,
// flat) fused to an ovate blade (y = petioleLen..1+petioleLen). The blade
// has a shallow V-cup (edges folded down) and a raised, bowed midrib, and a
// rounded (not pointed) tip. Origin sits AT the stem attachment so the
// petiole always touches the stem; local +Y = leaf length axis.
function buildLeafGeometry(halfW, petioleLen = 0.30) {
  const petRows = 3;
  const bladeRows = halfW.length;
  const totalRows = petRows + bladeRows - 1;
  const pos = new Float32Array(totalRows * 3 * 3);
  const uv = new Float32Array(totalRows * 3 * 2);
  for (let r = 0; r < totalRows; r++) {
    let y, w, zMid, zEdge;
    if (r < petRows - 1) {
      const f = r / (petRows - 1);
      y = petioleLen * f;
      w = 0.03 + 0.04 * f;
      zMid = 0.012 * f;         // petiole leaves the stem with a slight rise
      zEdge = zMid - 0.004;
    } else {
      const t = (r - (petRows - 1)) / (bladeRows - 1);
      y = petioleLen + t;
      w = halfW[r - (petRows - 1)];
      const s = Math.sin(Math.PI * t);
      const bow = 0.03 * s;     // lengthwise bend
      zMid = bow + 0.05 * s;    // raised midrib
      zEdge = bow - 0.05 * s;   // cupped edges
    }
    const i = r * 3;
    pos[i * 3 + 0] = -w; pos[i * 3 + 1] = y; pos[i * 3 + 2] = zEdge;
    pos[i * 3 + 3] = 0;   pos[i * 3 + 4] = y; pos[i * 3 + 5] = zMid;
    pos[i * 3 + 6] = w;   pos[i * 3 + 7] = y; pos[i * 3 + 8] = zEdge;
    const u = y / (1 + petioleLen);
    uv[i * 2 + 0] = 0;   uv[i * 2 + 1] = u;
    uv[i * 2 + 2] = 0.5; uv[i * 2 + 3] = u;
    uv[i * 2 + 4] = 1;   uv[i * 2 + 5] = u;
  }
  const idx = [];
  for (let r = 0; r < totalRows - 1; r++) {
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

// Tiny deterministic leaf-vein + mottle texture (white base so instanceColor
// supplies the hue; darker veins/mottling add the "not flat" shading).
let _leafTex;
function leafTexture() {
  if (_leafTex) return _leafTex;
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    _leafTex = null;
    return null;
  }
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 64, 64);
  let s = 12345;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 200; i++) {
    g.fillStyle = `rgba(40,60,40,${0.04 + rnd() * 0.07})`;
    g.beginPath(); g.arc(rnd() * 64, rnd() * 64, 1 + rnd() * 3, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(30,60,30,0.4)';
  g.lineWidth = 2;
  g.beginPath(); g.moveTo(32, 4); g.quadraticCurveTo(31, 32, 32, 60); g.stroke();
  g.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    const y = 12 + i * 9;
    g.beginPath();
    g.moveTo(32, y); g.quadraticCurveTo(20, y - 3, 12, y - 6);
    g.moveTo(32, y); g.quadraticCurveTo(44, y - 3, 52, y - 6);
    g.stroke();
  }
  _leafTex = new THREE.CanvasTexture(c);
  _leafTex.colorSpace = THREE.SRGBColorSpace;
  return _leafTex;
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
  const H = height;
  const ADULT_H = 0.25;                       // full-size reference height (m)
  const S = H / ADULT_H;                       // metre-unit scale, 1.0 at reference
  const age = Math.min(1, Math.max(0.05, H / ADULT_H)); // 0.05..1 relative maturity
  const potR = potDiameter * 0.5;
  const clusterR = Math.min(0.03, potR * 0.28);

  // ---- one shared leaf coupon + material (instance-coloured) ----
  const leafGeom = buildLeafGeometry([0.08, 0.33, 0.47, 0.34, 0.12]);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: leafTexture() || undefined, roughness: 0.75, side: THREE.DoubleSide,
  });

  const leafList = [];

  // rank 0 = young upper leaf (pale yellow-green), 1 = older lower (olive/brown)
  function leafColor(rank) {
    if (rank < 0.35) return new THREE.Color().setHSL(0.17 + rand() * 0.05, 0.32 + rand() * 0.15, 0.42 + rand() * 0.10);
    if (rank < 0.8) return new THREE.Color().setHSL(0.28 + rand() * 0.05, 0.34 + rand() * 0.13, 0.30 + rand() * 0.09);
    return new THREE.Color().setHSL(0.11 + rand() * 0.04, 0.30 + rand() * 0.12, 0.26 + rand() * 0.08);
  }

  function pushLeaf(node, az, elev, roll, len, rank) {
    leafList.push({ node: node.clone(), az, elev, roll, len, color: leafColor(rank) });
  }

  // ---- live sprouts: even-height, gently arching upright stems ----
  const adultSprouts = 3 + Math.floor(rand() * 3);            // 3..5
  const sproutCount = 2 + Math.round((adultSprouts - 2) * age); // 2 at sapling

  for (let i = 0; i < sproutCount; i++) {
    const ang = (i / sproutCount) * Math.PI * 2 + rand() * 0.6;
    const rr = clusterR * Math.sqrt(rand());
    const bx = Math.cos(ang) * rr;
    const bz = Math.sin(ang) * rr;

    // Slight outward lean; all sprouts stay upright and comparable in height
    // (no two dominant vertical shoots). Clamped inside the spread envelope.
    let lean = 0.10 + rand() * 0.22;
    const hF = 0.72 + rand() * 0.26;
    const peak = H * hF;
    const maxLean = Math.asin(Math.max(0, Math.min(1, (spread * 0.5 - rr) / Math.max(peak, 1e-4))));
    if (lean > maxLean) lean = maxLean;

    const tx = bx + Math.sin(lean) * Math.cos(ang) * peak;
    const ty = Math.cos(lean) * peak;
    const tz = bz + Math.sin(lean) * Math.sin(ang) * peak;
    const base = new THREE.Vector3(bx, 0, bz);
    const tip = new THREE.Vector3(tx, ty, tz);
    // Control point bows the lower half slightly outward for a gentle C-curve.
    const ctrl = new THREE.Vector3(
      bx + (tx - bx) * 0.55 + Math.cos(ang) * peak * 0.04,
      ty * 0.60,
      bz + (tz - bz) * 0.55 + Math.sin(ang) * peak * 0.04,
    );
    const curve = new THREE.QuadraticBezierCurve3(base, ctrl, tip);

    const stemMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.28 + rand() * 0.03, 0.18 + rand() * 0.08, 0.42 + rand() * 0.08),
      roughness: 0.9,
    });
    group.add(new THREE.Mesh(buildTaperedStemGeometry(curve, S * (0.0009 + 0.0006 * rand()), 0.14, 4, 5), stemMat));

    // Paired leaves at successive upper nodes; bare lower stem below ~0.40.
    const adultPairs = 1 + Math.floor(rand() * 3);             // 1..3
    const pairs = 1 + Math.round((adultPairs - 1) * age);      // 1 at sapling
    const phi0 = rand() * Math.PI * 2;
    for (let p = 0; p < pairs; p++) {
      const f = pairs === 1 ? 0.68 : 0.40 + 0.40 * (p / (pairs - 1)) + (rand() - 0.5) * 0.04;
      const node = curve.getPointAt(Math.min(0.9, f));
      // p=0 is the lowest (oldest) pair; top pairs are younger/paler.
      const rank = pairs === 1 ? 0.4 : (1 - p / (pairs - 1)) * 0.9;
      for (const sgn of [-1, 1]) {
        const az = phi0 + (sgn > 0 ? 0 : Math.PI) + (rand() - 0.5) * 0.5;
        const elev = 0.55 + 0.45 * rand() + rank * 0.2;
        const roll = (rand() - 0.5) * 0.5;
        // Juvenile leaves keep young (relatively large) proportions.
        const len = S * (0.010 + 0.006 * rand()) * (1 + 1.8 * Math.max(0, 1 - age));
        pushLeaf(node, az, elev, roll, len, rank);
      }
    }
  }

  // ---- bare branching twigs near the base (makeBranching skeletons) ----
  const twigCount = age < 0.35 ? 0 : 2;      // none on the juvenile seedling
  for (let ti = 0; ti < twigCount; ti++) {
    const tseed = Math.floor(Math.abs(seed)) * 100003 + ti * 7919 + 13;
    const { geometry } = makeBranching({
      seed: tseed,
      levels: 1,
      lengths: [S * 0.05, S * 0.035, S * 0.02],
      radii: [S * 0.0022, 0.55, 0.5],
      children: [2, 0, 0],
      angles: [0, 42, 35],
      starts: [0, 0.35, 0.5],
      gnarliness: [0.002, 0.005, 0.008],
      leafCount: 0,
    });
    const twigMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.07 + rand() * 0.04, 0.22 + rand() * 0.10, 0.30 + rand() * 0.10),
      roughness: 0.95,
    });
    const mesh = new THREE.Mesh(geometry, twigMat);
    const ta = rand() * Math.PI * 2;
    const tr = clusterR * 1.4 * Math.sqrt(rand());
    mesh.position.set(Math.cos(ta) * tr, 0, Math.sin(ta) * tr);
    mesh.rotation.z = (rand() - 0.5) * 0.5;
    mesh.rotation.x = (rand() - 0.5) * 0.5;
    group.add(mesh);
  }

  // ---- instanced leaves ----
  const _dummy = new THREE.Object3D();
  const _wA = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _rot = new THREE.Matrix4();

  const leafMesh = new THREE.InstancedMesh(leafGeom, leafMat, leafList.length);
  for (let i = 0; i < leafList.length; i++) {
    const L = leafList[i];
    const cx = Math.cos(L.az), cz = Math.sin(L.az);
    const ce = Math.cos(L.elev), se = Math.sin(L.elev);
    _d.set(cx * ce, se, cz * ce);
    _n.set(-cx * se, ce, -cz * se);
    _wA.set(-cz, 0, cx);
    _rot.makeBasis(_wA, _d, _n);
    _dummy.position.copy(L.node);              // leaf base sits on the stem node
    _dummy.quaternion.setFromRotationMatrix(_rot);
    _dummy.rotateY(L.roll);
    const w = L.len * 0.75;
    _dummy.scale.set(w, L.len, w);
    _dummy.updateMatrix();
    leafMesh.setMatrixAt(i, _dummy.matrix);
    leafMesh.setColorAt(i, L.color);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  group.add(leafMesh);

  group.userData = {
    family: 'seedling',
    hypothesis: 'sparse 3-5 upright sprouts, few pale ovate leaves, bare branching twigs',
    sprouts: sproutCount,
    leaves: leafList.length,
    twigs: twigCount,
    age,
  };
  return group;
}
