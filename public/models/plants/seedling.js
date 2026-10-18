import * as THREE from 'three';

// Seedling pot: a low, sparse, stressed clump of young sprouts. A couple of
// shoots stand taller; most stems arch outward and droop over the rim, each
// branched and carrying small rounded-oval leaves, over a dense tangle of fine
// brown dead twigs spread across the soil. Muted olive / dusty gray-green /
// dry brown, deterministic via mulberry32(seed).

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

// Rounded-oval leaf blade: unit length along +Y (petiole y=0, tip y=1), full
// width 1 along +X, `halfW` normalised base -> tip (blunt rounded tip). Subtle
// bow + midrib + cupping; UVs so a shared vein/mottle texture maps onto it.
function buildLeafGeometry(halfW) {
  const SEG = halfW.length - 1;
  const rows = halfW.length;
  const pos = new Float32Array(rows * 3 * 3);
  const uv = new Float32Array(rows * 3 * 2);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    const w = halfW[r];
    const s = Math.sin(Math.PI * t);
    const bow = s * 0.05;
    const midZ = bow + s * 0.04;
    const edgeZ = bow - s * 0.04;
    const i = r * 3;
    pos[i * 3 + 0] = -w; pos[i * 3 + 1] = t; pos[i * 3 + 2] = edgeZ;
    pos[i * 3 + 3] = 0;  pos[i * 3 + 4] = t; pos[i * 3 + 5] = midZ;
    pos[i * 3 + 6] = w;  pos[i * 3 + 7] = t; pos[i * 3 + 8] = edgeZ;
    uv[i * 2 + 0] = 0;   uv[i * 2 + 1] = t;
    uv[i * 2 + 2] = 0.5; uv[i * 2 + 3] = t;
    uv[i * 2 + 4] = 1;   uv[i * 2 + 5] = t;
  }
  const idx = [];
  for (let r = 0; r < SEG; r++) {
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
let _leafTex = null;
function leafTexture() {
  if (_leafTex) return _leafTex;
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
  const S = H / 0.25;
  const potR = potDiameter * 0.5;

  const roundGeom = buildLeafGeometry([0.18, 0.47, 0.50, 0.38, 0.16]); // cotyledon (blunt)
  const ovalGeom = buildLeafGeometry([0.08, 0.34, 0.46, 0.36, 0.14]);  // true leaf (blunt)
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, map: leafTexture(), roughness: 0.7, side: THREE.DoubleSide,
  });

  const cotList = [];
  const leafList = [];

  function leafColor() {
    const r = rand();
    if (r < 0.30) return new THREE.Color().setHSL(0.07 + rand() * 0.05, 0.30 + rand() * 0.15, 0.20 + rand() * 0.10);
    if (r < 0.50) return new THREE.Color().setHSL(0.22 + rand() * 0.04, 0.30 + rand() * 0.12, 0.30 + rand() * 0.10);
    return new THREE.Color().setHSL(0.25 + rand() * 0.05, 0.18 + rand() * 0.12, 0.24 + rand() * 0.10);
  }

  function pushLeaf(list, node, az, elev, isCot) {
    const roll = (rand() - 0.5) * 0.6;
    const len2 = (isCot ? S * (0.010 + 0.010 * rand()) : S * (0.008 + 0.010 * rand()));
    const w = len2 * (0.58 + 0.16 * rand());
    list.push({ node: node.clone(), az, elev, roll, len: len2, w, color: leafColor() });
  }

  // ---- live sprouts: a few taller, the rest low, wide, drooping & branched ----
  const sproutCount = 4 + Math.floor(rand() * 3);       // 4..6
  const clusterR = Math.min(0.035, potR * 0.28);

  for (let i = 0; i < sproutCount; i++) {
    const ang = rand() * Math.PI * 2;
    const rr = clusterR * Math.sqrt(rand());
    const bx = Math.cos(ang) * rr;
    const bz = Math.sin(ang) * rr;
    const outAz = ang + (rand() - 0.5) * 1.0;

    let hF, d;
    if (i === 0) { hF = 1.0; d = 0.10 + 0.15 * rand(); }
    else if (i === 1) { hF = 0.72 + 0.18 * rand(); d = 0.22 + 0.28 * rand(); }
    else { hF = 0.40 + 0.26 * rand(); d = 0.55 + 0.40 * rand(); }

    const peak = H * hF;
    const reach = peak * (0.20 + 0.60 * d) + 0.015;
    const tipY = peak * (1 - 0.45 * d);
    const ctrlY = peak * (0.40 + 0.55 * d);

    const base = new THREE.Vector3(bx, 0, bz);
    const tip = new THREE.Vector3(bx + Math.cos(outAz) * reach, tipY, bz + Math.sin(outAz) * reach);
    const ctrl = new THREE.Vector3(bx + Math.cos(outAz) * reach * 0.55, ctrlY, bz + Math.sin(outAz) * reach * 0.55);
    const curve = new THREE.QuadraticBezierCurve3(base, ctrl, tip);

    const stemMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.23 + rand() * 0.03, 0.15 + rand() * 0.08, 0.55 + rand() * 0.10),
      roughness: 0.9,
    });
    group.add(new THREE.Mesh(buildTaperedStemGeometry(curve, S * (0.0010 + 0.0008 * rand()), 0.14, 4, 4), stemMat));

    // main-stem leaves
    const pairs = 1 + Math.floor(rand() * 3);           // 1..3 pairs
    const phi0 = rand() * Math.PI * 2;
    for (let p = 0; p < pairs; p++) {
      const f = pairs === 1 ? 0.45 : 0.26 + 0.60 * (p / (pairs - 1)) + (rand() - 0.5) * 0.06;
      const node = curve.getPointAt(Math.min(0.92, f));
      const elev = 0.25 + 0.55 * (p / Math.max(1, pairs - 1)) + (rand() - 0.5) * 0.22;
      for (const sgn of [-1, 1]) {
        pushLeaf(p === 0 ? cotList : leafList, node, phi0 + (sgn > 0 ? 0 : Math.PI) + (rand() - 0.5) * 0.6, elev, p === 0);
      }
    }

    // side branches (leafy shoots)
    const nBranch = Math.floor(rand() * 3);             // 0..2
    for (let bi = 0; bi < nBranch; bi++) {
      const fb = 0.30 + 0.45 * rand();
      const origin = curve.getPointAt(fb);
      const bAz = outAz + (rand() - 0.5) * 2.4;
      const bLen = peak * (0.22 + 0.28 * rand());
      const bUp = 0.35 + 0.5 * rand();
      const bt = new THREE.Vector3(origin.x + Math.cos(bAz) * bLen * 0.8, origin.y + bLen * bUp, origin.z + Math.sin(bAz) * bLen * 0.8);
      const bc = new THREE.Vector3(origin.x + Math.cos(bAz) * bLen * 0.35, origin.y + bLen * (bUp * 0.75 + 0.15), origin.z + Math.sin(bAz) * bLen * 0.35);
      const bcurve = new THREE.QuadraticBezierCurve3(origin, bc, bt);
      group.add(new THREE.Mesh(buildTaperedStemGeometry(bcurve, S * (0.0006 + 0.0004 * rand()), 0.15, 3, 3), stemMat));
      const bLeaves = 1 + Math.floor(rand() * 3);       // 1..3
      const bphi = rand() * Math.PI * 2;
      for (let k = 0; k < bLeaves; k++) {
        const f = 0.30 + 0.55 * (k / Math.max(1, bLeaves - 1)) + (rand() - 0.5) * 0.1;
        const node = bcurve.getPointAt(Math.min(0.92, f));
        pushLeaf(leafList, node, bphi + k * 2.4 + (rand() - 0.5) * 0.5, 0.3 + 0.5 * rand(), false);
      }
    }
  }

  // ---- dense tangle of fine dead twigs across the soil (instanced) ----
  const twigCount = 42;
  const twigGeom = new THREE.CylinderGeometry(0.1, 1, 1, 3, 1, true); // tapered, open
  const twigMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  const twigs = new THREE.InstancedMesh(twigGeom, twigMat, twigCount);
  const _q = new THREE.Quaternion();
  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _c = new THREE.Color();
  const UP = new THREE.Vector3(0, 1, 0);
  const _dir = new THREE.Vector3();
  for (let i = 0; i < twigCount; i++) {
    const a = rand() * Math.PI * 2;
    const r0 = 0.008 + 0.06 * Math.sqrt(rand());
    const r1 = Math.min(potR * 1.15, r0 + 0.05 + 0.09 * rand());
    const a1 = a + (rand() - 0.5) * 0.8;
    _p.set(Math.cos(a) * r0, 0.002 + 0.004 * rand(), Math.sin(a) * r0);
    _dir.set(Math.cos(a1) * r1 - _p.x, 0.004 + 0.02 * rand(), Math.sin(a1) * r1 - _p.z);
    const len = _dir.length() || 1e-4;
    _dir.multiplyScalar(1 / len);
    _q.setFromUnitVectors(UP, _dir);
    const r = S * (0.0005 + 0.0005 * rand());
    _m.compose(_p, _q, _s.set(r, len, r));
    twigs.setMatrixAt(i, _m);
    _c.setHSL(0.06 + rand() * 0.05, 0.20 + rand() * 0.16, 0.28 + rand() * 0.16);
    twigs.setColorAt(i, _c);
  }
  twigs.instanceMatrix.needsUpdate = true;
  if (twigs.instanceColor) twigs.instanceColor.needsUpdate = true;
  group.add(twigs);

  // a few curved "curled fragment" twigs near the rim
  const curlCount = 6;
  for (let i = 0; i < curlCount; i++) {
    const a = rand() * Math.PI * 2;
    const r0 = 0.02 + 0.05 * rand();
    const r1 = potR * (0.85 + 0.35 * rand());
    const base = new THREE.Vector3(Math.cos(a) * r0, 0.004, Math.sin(a) * r0);
    const tip = new THREE.Vector3(Math.cos(a + 0.5) * r1, 0.02 + 0.03 * rand(), Math.sin(a + 0.5) * r1);
    const ctrl = new THREE.Vector3((base.x + tip.x) * 0.5, 0.05 + 0.04 * rand(), (base.z + tip.z) * 0.5);
    const curve = new THREE.QuadraticBezierCurve3(base, ctrl, tip);
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.07 + rand() * 0.05, 0.24 + rand() * 0.14, 0.28 + rand() * 0.12), roughness: 0.95 });
    group.add(new THREE.Mesh(buildTaperedStemGeometry(curve, S * (0.0006 + 0.0005 * rand()), 0.2, 3, 3), mat));
  }

  // ---- leaves (instanced) ----
  const _dummy = new THREE.Object3D();
  const _wA = new THREE.Vector3();
  const _d = new THREE.Vector3();
  const _n = new THREE.Vector3();
  const _rot = new THREE.Matrix4();

  function buildLeaves(list, geom, count) {
    const mesh = new THREE.InstancedMesh(geom, leafMat, count);
    for (let i = 0; i < count; i++) {
      const L = list[i];
      const cx = Math.cos(L.az), cz = Math.sin(L.az);
      const ce = Math.cos(L.elev), se = Math.sin(L.elev);
      _d.set(cx * ce, se, cz * ce);
      _n.set(-cx * se, ce, -cz * se);
      _wA.set(-cz, 0, cx);
      _rot.makeBasis(_wA, _d, _n);
      _dummy.position.copy(L.node).addScaledVector(_d, L.len * 0.18);
      _dummy.quaternion.setFromRotationMatrix(_rot);
      _dummy.rotateY(L.roll);
      _dummy.scale.set(L.w, L.len, L.w);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      mesh.setColorAt(i, L.color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  buildLeaves(cotList, roundGeom, cotList.length);
  buildLeaves(leafList, ovalGeom, leafList.length);

  return group;
}
