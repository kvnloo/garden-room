import * as THREE from 'three';
import { makeBranching } from '/models/plants/_shared/branching.js';

// broadleaf_shrub — v2 round 1.
// Real specimen (locked crop p23.webp) is a WILTED multi-stem woody shrub, not a
// healthy spherical citrus: 4-5 ascending woody stems from a short basal crown,
// each carrying a few tiered horizontal secondary branches, and strongly
// pendulous narrow-elliptical leaves that hang nearly vertical with a lengthwise
// fold and curved tips. Dark muted green, no fruit. Connected branch skeleton
// from the pinned EZ-Tree adapter; the folded lanceolate leaf coupon + petiole
// and the growth-dependent topology are species-specific.

const ADULT_H = 1.2; // family adult height (m) — the ~1.2 m specimen

// --- seeded PRNG (mulberry32); no Math.random ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------------------
// Leaf coupon: narrow-elliptical/lanceolate blade on a short petiole, folded
// lengthwise (midrib ridge up, edges curled down — a wilted closing leaf) with
// a bowed midrib, downward-curving tip and slight helical edge twist.
// Local frame: +X width (left -w .. right +w), +Y length (t=0 petiole base at
// branch .. t=1 blade tip), +Z fold crest. All lengths are fractions of blade
// length so a uniform scale maps width/fold/petiole with the leaf.
// ---------------------------------------------------------------------------
function buildLeafGeometry() {
  const SEG = 8;          // segments along petiole+blade
  const PET = 0.12;       // petiole length as fraction of blade length
  const HALF_W = 0.17;    // max blade half-width (narrow-elliptical, ~3:1 l:w)
  const FOLD = 0.12;      // V-fold depth (edges hang below the midrib ridge)
  const ARCH = 0.035;     // midrib bow (crest)
  const DROOP = 0.30;     // tip droop (curved tip, fraction of length)
  const TWIST = 0.045;    // helical edge twist

  const rows = SEG + 1;
  const vertCount = rows * 3;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  function bladeHalfW(s) {
    const peak = 0.40;
    const w = s < peak
      ? HALF_W * Math.pow(s / peak, 0.85)
      : HALF_W * Math.pow((1 - s) / (1 - peak), 0.9);
    return Math.max(0.008, w);
  }

  for (let r = 0; r <= SEG; r++) {
    const t = r / SEG;                 // 0 (petiole base) .. 1 (blade tip)
    const blade = t >= PET;
    const s = blade ? (t - PET) / (1 - PET) : 0; // blade progress 0..1
    const w = blade ? bladeHalfW(s) : 0.007;     // thin petiole
    const fold = blade ? FOLD * Math.sin(Math.PI * s) : 0;
    const arch = blade ? ARCH * Math.sin(Math.PI * s) : 0;
    const twist = blade ? TWIST * Math.sin(Math.PI * s) : 0;
    const y = t - (blade ? DROOP * s * s : 0);   // tip curves downward

    const i = r * 3;
    positions[(i + 0) * 3 + 0] = -w; positions[(i + 0) * 3 + 1] = y; positions[(i + 0) * 3 + 2] = -fold - twist;
    positions[(i + 1) * 3 + 0] = 0;  positions[(i + 1) * 3 + 1] = y; positions[(i + 1) * 3 + 2] = arch;
    positions[(i + 2) * 3 + 0] = w;  positions[(i + 2) * 3 + 1] = y; positions[(i + 2) * 3 + 2] = -fold + twist;

    // petiole: woody green; blade: dark green edges, pale midrib vein.
    let er, eg, eb;
    if (!blade) { er = 0.46; eg = 0.40; eb = 0.28; }
    else {
      const fade = 0.92 - 0.16 * s;               // darker toward the wilted tip
      er = 0.26 * fade; eg = 0.38 * fade; eb = 0.22 * fade;
    }
    colors[(i + 0) * 3] = er; colors[(i + 0) * 3 + 1] = eg; colors[(i + 0) * 3 + 2] = eb;
    colors[(i + 1) * 3] = 0.80; colors[(i + 1) * 3 + 1] = 0.84; colors[(i + 1) * 3 + 2] = 0.68;
    colors[(i + 2) * 3] = er; colors[(i + 2) * 3 + 1] = eg; colors[(i + 2) * 3 + 2] = eb;

    uvs[(i + 0) * 2] = 0;   uvs[(i + 0) * 2 + 1] = t;
    uvs[(i + 1) * 2] = 0.5; uvs[(i + 1) * 2 + 1] = t;
    uvs[(i + 2) * 2] = 1;   uvs[(i + 2) * 2 + 1] = t;
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
  const age = Math.min(1, Math.max(0.06, H / ADULT_H)); // relative age from height
  const mature = age >= 0.4;

  // ---- materials ----
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 0.9, metalness: 0.0 });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.55, metalness: 0.0,
    side: THREE.DoubleSide, vertexColors: true,
    emissive: 0x0c1a10, emissiveIntensity: 0.15,
  });

  // ---- connected multi-stem skeleton (pinned EZ-Tree adapter) ----
  // Short basal trunk -> 4 lateral woody stems + 1 central leader, each carrying
  // 3 tiered horizontal secondaries + 1 terminal twig. Juvenile collapses to
  // 3 slender stems with a few large leaves (growth = topology, not uniform scale).
  const cfg = mature
    ? {
        seed, levels: 2,
        lengths: [H * 0.05, H * 0.86, H * 0.28, H * 0.10],
        radii: [H * 0.009, 0.60, 0.48, 0.4],
        children: [4, 3, 0, 0],
        angles: [0, 15, 60, 52],
        starts: [0, 0.12, 0.28, 0.2],
        gnarliness: [0.0012, 0.0016, 0.002, 0.001],
        leafCount: 3,
      }
    : {
        seed, levels: 1,
        lengths: [H * 0.05, H * 0.60, H * 0.20],
        radii: [H * 0.008, 0.55, 0.45],
        children: [2, 0, 0, 0],
        angles: [0, 12, 40, 36],
        starts: [0, 0.2, 0.2, 0.2],
        gnarliness: [0.0008, 0.001, 0.0012, 0.001],
        leafCount: 1,
      };
  const { geometry: branchGeom, branches, sites } = makeBranching(cfg);
  const branchMesh = new THREE.Mesh(branchGeom, stemMat);
  branchMesh.castShadow = true;
  branchMesh.receiveShadow = true;
  group.add(branchMesh);

  // Stems = branches originating low on the basal trunk (y < 0.15 H); the
  // secondaries originate higher up along the stems.
  const stems = branches.filter((b, i) => i > 0 && b.sections[0].origin.y < 0.15 * H);

  // ---- instanced leaves ----
  const leafGeom = buildLeafGeometry();
  const MAX_LEAVES = mature ? 120 : 12;
  const leaves = new THREE.InstancedMesh(leafGeom, leafMat, MAX_LEAVES);
  leaves.castShadow = true;
  leaves.receiveShadow = true;

  const basis = new THREE.Matrix4();
  const dirV = new THREE.Vector3();
  const crest = new THREE.Vector3();
  const right = new THREE.Vector3();
  const qRoll = new THREE.Quaternion();
  const sV = new THREE.Vector3();
  let li = 0;

  function leafColor(yFrac, isYoung) {
    if (isYoung) {
      const hue = 0.29 + (rand() - 0.5) * 0.05;
      const sat = 0.42 + (rand() - 0.5) * 0.08;
      const light = 0.36 + (rand() - 0.5) * 0.06;
      return new THREE.Color().setHSL(hue, sat, light);
    }
    const hue = 0.31 + (rand() - 0.5) * 0.03;
    const sat = 0.36 + (rand() - 0.5) * 0.08;
    let light = 0.30 - 0.06 * yFrac + (rand() - 0.5) * 0.05; // older/lower darker
    if (rand() < 0.08) light += 0.05;                          // occasional stress leaf
    return new THREE.Color().setHSL(hue, sat, light);
  }

  // droopAngle measured from straight-down: 0 = fully pendulous, pi/2 = horizontal.
  function addLeaf(origin, az, droopAngle, roll, len, isYoung) {
    if (li >= MAX_LEAVES) return;
    if (origin.y < len + 0.02) return; // keep blade tip above the soil

    const ox = Math.cos(az), oz = Math.sin(az);
    const sd = Math.sin(droopAngle), cd = Math.cos(droopAngle);

    dirV.set(ox * sd, -cd, oz * sd).normalize();           // blade length axis, hanging
    crest.copy(UP).addScaledVector(dirV, -UP.dot(dirV));   // fold crest perpendicular, up
    crest.normalize();
    right.crossVectors(dirV, crest);                       // right-handed width axis
    if (roll) {
      qRoll.setFromAxisAngle(dirV, roll);
      right.applyQuaternion(qRoll);
      crest.applyQuaternion(qRoll);
    }
    basis.makeBasis(right, dirV, crest);
    basis.setPosition(origin);
    basis.scale(sV.set(len, len, len));

    leaves.setMatrixAt(li, basis);
    leaves.setColorAt(li, leafColor(Math.min(1, origin.y / H), isYoung));
    li++;
  }

  const azOf = (v) => Math.atan2(v.z, v.x);

  if (mature) {
    // One pendulous leaf per skeleton site (clustered on the terminal twigs), plus
    // a couple more at each stem tip to thicken the uneven upper crown.
    for (const site of sites) {
      const p = site.origin;
      const az = azOf(p) + (rand() - 0.5) * 0.5;
      const droop = 0.22 + 0.28 * rand() + 0.12 * (1 - Math.min(1, p.y / H)); // top droops less
      addLeaf(p, az, droop, (rand() - 0.5) * 1.3, H * (0.09 + 0.03 * rand()), false);
    }
    for (const st of stems) {
      const tip = st.sections[st.sections.length - 1].origin;
      for (let k = 0; k < 2; k++) {
        const az = azOf(tip) + (k - 0.5) * 0.9 + (rand() - 0.5) * 0.4;
        addLeaf(tip, az, 0.22 + 0.25 * rand(), (rand() - 0.5) * 1.2, H * (0.09 + 0.03 * rand()), false);
      }
    }
  } else {
    // Sapling: a few proportionally large, more upright young leaves at the stem tips.
    for (const st of stems) {
      const tip = st.sections[st.sections.length - 1].origin;
      for (let k = 0; k < 2; k++) {
        const az = azOf(tip) + (k - 0.5) * 1.1 + (rand() - 0.5) * 0.5;
        addLeaf(tip, az, 0.55 + 0.3 * rand(), (rand() - 0.5) * 0.7, H * (0.26 + 0.04 * rand()), true);
      }
    }
  }

  leaves.count = li;
  leaves.instanceMatrix.needsUpdate = true;
  if (leaves.instanceColor) leaves.instanceColor.needsUpdate = true;
  group.add(leaves);

  group.userData = {
    family: 'broadleaf_shrub',
    round: 1,
    age,
    mature,
    adultHeight: ADULT_H,
    leafCount: li,
    hypothesis:
      'connected reference-specific multi-stem branch/node/leaf reconstruction via pinned EZ-Tree adapter: ' +
      'short basal trunk -> 4-5 woody ascending stems -> tiered horizontal secondaries; strongly pendulous ' +
      'narrow-elliptical folded leaf coupon (lengthwise V-fold, curved tip, petiole) hung nearly vertical and ' +
      'clustered on outer shoots; juvenile collapses to 3 slender stems with a few large upright leaves.',
  };
  return group;
}
