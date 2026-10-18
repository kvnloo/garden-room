import * as THREE from 'three';

// Trailing plectranthus (Swedish ivy, Plectranthus verticillatus) — v2 round 1.
//
// Declared FORM hypothesis (one attributable physical cause):
//   The baseline scattered ~16 near-vertical "rods" with sharp 5-point elbows,
//   then hung each with a few small, thin, pointed polygons, collapsing the
//   plant into a crowded narrow bundle of evenly-spaced dangling ends. This
//   rebuild couples (a) a connected, seed-driven architecture of 7-9 smooth
//   Catmull-Rom stem arcs that emerge from one low crown, arch outward over the
//   rim and — for the trailing half — continue down OUTSIDE the pot below soil
//   level, with (b) a single broad rounded-ovate, scalloped, fleshy leaf coupon
//   (raised midrib, curled-down edges, rounded tip) instanced in clear
//   OPPOSITE pairs at spaced nodes that rotate ~90 deg (decussate) node to
//   node, each blade carried on a short petiole, with a small young terminal
//   pair so no bare rod tip remains. Juvenile = few short upright shoots with a
//   few small opposite pairs, all above soil, no premature trailing.
//
// Anatomy note (per brief + feedback): plectranthus is a lax trailing herb,
// not a woody tree — no trunk -> child-branch hierarchy. makeBranching (EZ-Tree)
// is therefore NOT applied; local primitives (CatmullRomCurve3 + swept tubes)
// are the correct exception for trailing vines. Leaf meshes are ours.
//
// Protected: soil-centre origin, +Y up, metres, height = plant above soil,
// seeded determinism (mulberry32), app factory contract (no pot/soil/lights).

const UP = new THREE.Vector3(0, 1, 0);
const FAMILY_ADULT_HEIGHT = 0.4; // reference is ~40 cm

// --- seeded PRNG (mulberry32) ------------------------------------------------
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- leaf coupon --------------------------------------------------------------
// Unit blade: base at y=0, tip at y=1, full width ~1.0 (max halfWidth 0.5).
// Broad rounded-ovate outline (widest just below middle), a blunt rounded tip,
// a softly scalloped (crenate) margin and a fleshy cross-section: raised
// midrib, curled-down edges, gentle lengthwise bow. 9 length segments x 3
// columns -> 36 tris, smooth vertex normals.
function buildLeafGeometry() {
  const SEG = 9;
  const rows = SEG + 1;
  const baseHalfW = [0.19, 0.32, 0.43, 0.49, 0.50, 0.47, 0.40, 0.31, 0.20, 0.07];
  const teeth = 6;      // shallow rounded scallop lobes per side
  const amp = 0.07;     // shallow scallop amplitude (fraction of half-width)
  const pos = new Float32Array(rows * 3 * 3);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    const s = Math.sin(Math.PI * t);
    const scallop = 1 + amp * Math.sin(2 * Math.PI * teeth * t); // 0 at base & tip
    const w = baseHalfW[r] * scallop;
    const bow = s * 0.035;         // gentle lengthwise droop
    const midZ = bow + s * 0.050;  // raised fleshy midrib
    const edgeZ = bow - s * 0.050; // curled-down fleshy edges
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

// --- petiole coupon -----------------------------------------------------------
// Unit tapered tube along +Y (base y=0 at the node, tip y=1 at the leaf base),
// 3 radial sides -> 6 tris. Instanced per leaf with Y mapped to the outward
// petiole direction.
function buildPetioleGeometry() {
  const sides = 3;
  const pos = new Float32Array(2 * sides * 3);
  const idx = [];
  for (let i = 0; i < 2; i++) {
    const y = i;
    const r = i === 0 ? 1.0 : 0.55;
    for (let j = 0; j < sides; j++) {
      const ang = (2 * Math.PI * j) / sides;
      const o = (i * sides + j) * 3;
      pos[o] = Math.cos(ang) * r; pos[o + 1] = y; pos[o + 2] = Math.sin(ang) * r;
    }
  }
  for (let j = 0; j < sides; j++) {
    const a = j, b = (j + 1) % sides, c = sides + j, d = sides + (j + 1) % sides;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --- swept tapered tube -------------------------------------------------------
// Sweeps a circle of varying radius along a polyline (stem), 4 radial sides.
// Tangent from neighbour points; stable reference frame that flips only on
// near-vertical segments.
function buildSweptTube(points, radii, radialSegs) {
  const rings = points.length;
  const pos = new Float32Array(rings * radialSegs * 3);
  const idx = [];
  const tan = new THREE.Vector3();
  const upRef = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const bin = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < rings; i++) {
    const p = points[i];
    const r = radii[i];
    const pPrev = points[Math.max(0, i - 1)];
    const pNext = points[Math.min(rings - 1, i + 1)];
    tan.subVectors(pNext, pPrev);
    if (tan.lengthSq() < 1e-9) tan.set(0, 1, 0);
    tan.normalize();
    upRef.set(0, 1, 0);
    if (Math.abs(tan.y) > 0.99) upRef.set(0, 0, 1);
    nrm.crossVectors(upRef, tan);
    if (nrm.lengthSq() < 1e-9) nrm.set(1, 0, 0);
    nrm.normalize();
    bin.crossVectors(tan, nrm).normalize();
    for (let j = 0; j < radialSegs; j++) {
      const ang = (2 * Math.PI * j) / radialSegs;
      v.set(0, 0, 0)
        .addScaledVector(nrm, Math.cos(ang) * r)
        .addScaledVector(bin, Math.sin(ang) * r)
        .add(p);
      const o = (i * radialSegs + j) * 3;
      pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z;
    }
  }
  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radialSegs; j++) {
      const a = i * radialSegs + j;
      const b = i * radialSegs + (j + 1) % radialSegs;
      const c = (i + 1) * radialSegs + j;
      const d = (i + 1) * radialSegs + (j + 1) % radialSegs;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// --- palette ------------------------------------------------------------------
// Pale fresh green family, coherent with age: light fresh tips -> deeper older
// growth near the crown. Matte, faintly velvety (roughness .85, nonmetallic).
function leafColor(t, rand) {
  const young = Math.min(1, Math.max(0, t)); // 0 base(old) .. 1 tip(young)
  const hue = 0.365 - young * 0.035 + (rand() - 0.5) * 0.035;
  const sat = 0.30 + (rand() - 0.5) * 0.08;
  const light = 0.47 + young * 0.15 + (rand() - 0.5) * 0.05;
  return new THREE.Color().setHSL(hue, sat, light);
}

// --- per-leaf placement --------------------------------------------------------
// Places ONE blade + its petiole into the shared instanced lists. Leaf LENGTH
// (local +Y) points outward from the node, tilted up on rising stem sections and
// drooping on descending (trailing) sections; the blade normal leans up-and-out
// so broad faces read from front/three-quarter/top. Base of blade sits exactly
// at the end of its petiole.
function placeLeaf(P, T, D, t, rand, leafMats, leafColors, petMats, sizeMul) {
  const droop = Math.max(0, -T.y) * 0.7;      // hang more on descending stems
  const tilt = -0.10 + 0.20 * rand() - droop; // slight spread of attitudes
  const Ldir = new THREE.Vector3().copy(D).addScaledVector(UP, tilt).normalize();

  const n = new THREE.Vector3().addScaledVector(UP, 0.7).addScaledVector(D, 0.45);
  n.addScaledVector(Ldir, -n.dot(Ldir));      // keep normal orthogonal to length
  n.normalize();
  const Wdir = new THREE.Vector3().crossVectors(Ldir, n).normalize();

  const petLen = 0.012 + 0.010 * rand();
  const leafBase = new THREE.Vector3().copy(P).addScaledVector(D, petLen);

  // size: largest at mid-stem (mature), smaller basal and at the young tip
  const sizeScale = (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, t / 0.78))) * sizeMul;
  const l = (0.052 + 0.020 * rand()) * sizeScale;
  const w = l * (0.82 + 0.12 * rand());       // round-ovate, nearly as wide as long

  const M = new THREE.Matrix4().makeBasis(Wdir, Ldir, n);
  M.setPosition(leafBase);
  M.scale(new THREE.Vector3(w, l, w));
  leafMats.push(M);
  leafColors.push(leafColor(t, rand));

  const petY = D.clone().normalize();
  const petX = new THREE.Vector3();
  if (Math.abs(petY.y) < 0.99) petX.crossVectors(UP, petY).normalize();
  else petX.set(1, 0, 0);
  const petZ = new THREE.Vector3().crossVectors(petX, petY).normalize();
  const PM = new THREE.Matrix4().makeBasis(petX, petY, petZ);
  PM.setPosition(P);
  const petR = 0.0012 + 0.0006 * rand();
  PM.scale(new THREE.Vector3(petR, petLen, petR));
  petMats.push(PM);
}

// One OPPOSITE pair of leaves at node fraction t: two blades on opposite sides
// of the stem, the pair rotated around the stem tangent by pairRot (decussate
// ~90 deg between successive nodes).
function emitNode(curve, t, pairRot, rand, leafMats, leafColors, petMats, sizeMul) {
  const P = curve.getPointAt(t);
  const T = curve.getTangentAt(t).normalize();
  const S = new THREE.Vector3().crossVectors(UP, T);
  if (S.lengthSq() < 1e-6) S.set(0, 0, 1).cross(T);
  S.normalize();
  const qPair = new THREE.Quaternion().setFromAxisAngle(T, pairRot);
  const D = S.applyQuaternion(qPair);
  for (let side = -1; side <= 1; side += 2) {
    placeLeaf(P, T, D.clone().multiplyScalar(side), t, rand, leafMats, leafColors, petMats, sizeMul);
  }
}

// --- adult build ----------------------------------------------------------------
// 7-9 stems; each a smooth Catmull-Rom arc blending an upright mound into a
// trailing runner by per-stem "trailness" tau. Irregular azimuth spacing keeps
// real gaps and asymmetry (no even ring). Opposite decussate leaf pairs with a
// short bare crown section, foliage running down the trailing part, and a small
// young terminal pair instead of a bare tip.
function buildAdult(seed, rand) {
  const group = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x7d9a52, roughness: 0.7, metalness: 0.0,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
  });

  const leafGeo = buildLeafGeometry();
  const petioleGeo = buildPetioleGeometry();

  const leafMats = [], leafColors = [], petMats = [];
  const stemMeshes = [];

  const stemCount = 7 + (rand() < 0.5 ? 1 : 0); // 7..8, irregular
  const azimuths = [];
  let a = rand() * Math.PI * 2;
  for (let i = 0; i < stemCount; i++) {
    azimuths.push(a);
    a += (Math.PI * 2 / stemCount) * (0.55 + rand() * 1.0); // uneven gaps
  }

  for (let i = 0; i < stemCount; i++) {
    const az = azimuths[i];
    const tau = rand(); // 0 upright mound .. 1 trailing runner
    const cosA = Math.cos(az), sinA = Math.sin(az);
    const baseR = 0.012 + 0.014 * rand();
    const apexR = 0.14 + 0.04 * rand();  // upright apex radius (0.14..0.18)
    const apexH = 0.34 + 0.08 * rand();  // irregular crown height (0.34..0.42)
    const hang = 0.12 + 0.10 * rand();   // trailing drop below soil (0.12..0.22)

    // 7-point skeletons blended by tau: upright mound vs over-rim trailing drop.
    const upright = [
      [baseR, 0.004], [0.05, 0.10], [0.115, 0.205], [apexR, apexH],
      [apexR + 0.02, apexH - 0.05], [apexR + 0.03, apexH - 0.12], [apexR + 0.04, apexH - 0.20],
    ];
    const trailing = [
      [baseR, 0.004], [0.05, 0.09], [0.11, 0.165], [0.145, 0.20],
      [0.153, 0.13], [0.163, 0.01], [0.172, -hang],
    ];
    const pts = [];
    for (let k = 0; k < 7; k++) {
      const r = upright[k][0] + (trailing[k][0] - upright[k][0]) * tau;
      const y = upright[k][1] + (trailing[k][1] - upright[k][1]) * tau;
      pts.push(new THREE.Vector3(r * cosA, y, r * sinA));
    }
    const curve = new THREE.CatmullRomCurve3(pts);

    // node positions (opposite pairs), sparse and jittered, + terminal young pair
    const pairs = 4;
    const nodeFracs = [];
    for (let k = 0; k < pairs; k++) {
      nodeFracs.push(0.24 + (0.66 * k) / pairs + (rand() - 0.5) * 0.05);
    }
    const stemTwist = rand() * Math.PI * 2;
    for (let k = 0; k < pairs; k++) {
      const pairRot = stemTwist + k * (Math.PI / 2) + (rand() - 0.5) * 0.35;
      emitNode(curve, Math.min(0.9, nodeFracs[k]), pairRot, rand, leafMats, leafColors, petMats, 1.0);
    }
    // small young terminal pair (no bare rod tip)
    emitNode(curve, 0.92, stemTwist + pairs * (Math.PI / 2) + (rand() - 0.5) * 0.35,
      rand, leafMats, leafColors, petMats, 0.72);

    // tapered stem tube with modest node swelling
    const N = 14;
    const radii = [];
    const samplePts = [];
    for (let s = 0; s < N; s++) {
      const f = s / (N - 1);
      let r = baseR * (1 - 0.5 * f);
      for (const nf of nodeFracs) {
        const d = f - nf;
        r += 0.0008 * Math.exp(-(d * d) / 0.006);
      }
      radii.push(r);
      samplePts.push(curve.getPointAt(f));
    }
    const stemGeo = buildSweptTube(samplePts, radii, 4);
    const stemMesh = new THREE.Mesh(stemGeo, stemMat);
    stemMesh.castShadow = true;
    stemMesh.receiveShadow = true;
    group.add(stemMesh);
    stemMeshes.push(stemMesh);
  }

  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, leafMats.length);
  for (let i = 0; i < leafMats.length; i++) {
    leafMesh.setMatrixAt(i, leafMats[i]);
    leafMesh.setColorAt(i, leafColors[i]);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;
  group.add(leafMesh);

  const petioleMesh = new THREE.InstancedMesh(petioleGeo, stemMat, petMats.length);
  for (let i = 0; i < petMats.length; i++) petioleMesh.setMatrixAt(i, petMats[i]);
  petioleMesh.instanceMatrix.needsUpdate = true;
  petioleMesh.castShadow = true;
  group.add(petioleMesh);

  return group;
}

// --- juvenile build --------------------------------------------------------------
// A few short upright shoots (no trailing), each carrying a few small opposite
// pairs all well above the soil — not a flattened miniature adult canopy.
function buildJuvenile(seed, rand) {
  const group = new THREE.Group();
  const stemMat = new THREE.MeshStandardMaterial({
    color: 0x83a35a, roughness: 0.7, metalness: 0.0,
  });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.85, metalness: 0.0, side: THREE.DoubleSide,
  });
  const leafGeo = buildLeafGeometry();
  const petioleGeo = buildPetioleGeometry();

  const leafMats = [], leafColors = [], petMats = [];
  const shoots = 2 + Math.floor(rand() * 2); // 2..3 shoots
  let a = rand() * Math.PI * 2;
  for (let s = 0; s < shoots; s++) {
    const az = a + (rand() - 0.5) * 0.8;
    a += (Math.PI * 2 / shoots) * (0.7 + rand() * 0.6);
    const cosA = Math.cos(az), sinA = Math.sin(az);
    const h = 0.045 + 0.020 * rand(); // shoot height 4.5..6.5 cm
    const lean = 0.05 + 0.10 * rand();
    const base = new THREE.Vector3(0.006 * cosA, 0.004, 0.006 * sinA);
    const tip = new THREE.Vector3(
      Math.sin(lean) * Math.cos(az) * h + 0.012 * cosA,
      Math.cos(lean) * h,
      Math.sin(lean) * Math.sin(az) * h + 0.012 * sinA,
    );
    const mid = base.clone().add(tip).multiplyScalar(0.5);
    mid.addScaledVector(UP, 0.008);
    mid.x += 0.006 * cosA; mid.z += 0.006 * sinA;
    const curve = new THREE.QuadraticBezierCurve3(base, mid, tip);

    const pairRot0 = rand() * Math.PI * 2;
    emitNode(curve, 0.42, pairRot0, rand, leafMats, leafColors, petMats, 1.0);
    emitNode(curve, 0.70, pairRot0 + Math.PI / 2 + (rand() - 0.5) * 0.3, rand, leafMats, leafColors, petMats, 0.9);
    emitNode(curve, 0.90, pairRot0 + Math.PI + (rand() - 0.5) * 0.3, rand, leafMats, leafColors, petMats, 0.7);

    const N = 12;
    const radii = [], samplePts = [];
    for (let k = 0; k < N; k++) {
      const f = k / (N - 1);
      radii.push(0.003 * (1 - 0.4 * f));
      samplePts.push(curve.getPointAt(f));
    }
    const stemMesh = new THREE.Mesh(buildSweptTube(samplePts, radii, 4), stemMat);
    stemMesh.castShadow = true;
    group.add(stemMesh);
  }

  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, leafMats.length);
  for (let i = 0; i < leafMats.length; i++) {
    leafMesh.setMatrixAt(i, leafMats[i]);
    leafMesh.setColorAt(i, leafColors[i]);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  leafMesh.castShadow = true;
  leafMesh.receiveShadow = true;
  group.add(leafMesh);

  const petioleMesh = new THREE.InstancedMesh(petioleGeo, stemMat, petMats.length);
  for (let i = 0; i < petMats.length; i++) petioleMesh.setMatrixAt(i, petMats[i]);
  petioleMesh.instanceMatrix.needsUpdate = true;
  petioleMesh.castShadow = true;
  group.add(petioleMesh);

  return group;
}

// --- factory -------------------------------------------------------------------
export function createPlant({
  height = 0.4,
  spread = 0.4,
  potDiameter = 0.25,
  seed = 1,
  width,
  depth,
} = {}) {
  const rand = mulberry32(seed);
  const relAge = Math.min(1, Math.max(0.05, height / FAMILY_ADULT_HEIGHT));

  const group = relAge < 0.4 ? buildJuvenile(seed, rand) : buildAdult(seed, rand);

  // Uniform scale so the built canopy fills the requested spread while keeping
  // the plant's naturally wide, sprawling aspect (a per-axis scale would
  // stretch round leaves oval / the mound into a tent). Built dims already sit
  // near target, so the correction is small.
  const box = new THREE.Box3().setFromObject(group);
  const plantW = Math.max(1e-4, box.max.x - box.min.x, box.max.z - box.min.z);
  const s = spread / plantW;
  group.scale.setScalar(s);

  group.userData = {
    family: 'plectranthus',
    relAge,
    seed,
    tris: 'see capture',
    note: 'trailing-vine local primitives; opposite decussate pairs on smooth arching/trailing arcs',
  };
  return group;
}
