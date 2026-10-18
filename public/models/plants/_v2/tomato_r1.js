import * as THREE from 'three';
import { makeBranching } from '/models/plants/_shared/branching.js';

// Tomato (Solanum lycopersicum) — v2 round 1. Reference-specific reconstruction.
//
// Declared physical hypothesis (FORM rebuild): the photographed specimen is a
// THIN, LANKY, NEAR-BARE herb stem tied to a GREEN stake — not the dense fruiting
// "Christmas tree" of the baseline. It carries only a FEW drooping pinnately
// COMPOUND leaves, each built as a real connected structure (petiole -> tapered
// rachis -> unequal lateral leaflet pairs + small intercalary leaflets + a larger
// terminal leaflet), arranged ALTERNATELY up the main stem, plus several thin
// SIDE SHOOTS (suckers), most of which end bare or in shrivelled twigs. Lower
// foliage is sparse and YELLOWING; there is NO conspicuous fruit (absent from the
// locked reference crop). The connected branch/node/leaf architecture comes from
// the pinned MIT EZ-Tree adapter; the lobed+serrated leaflet coupon, rachis and
// stake are authored here. Growth is topology, not uniform scaling: the juvenile
// is a short single green stem with two cotyledons and a few small young compound
// leaves (one leaflet pair + terminal), no branching, no stake, no fruit, no dead
// debris — every blade kept above the soil.

const ADULT_HEIGHT = 1.0; // family adult height (m) — the ~1 m staked specimen

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const Y = new THREE.Vector3(0, 1, 0);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Unit vector perpendicular to `dir`, at azimuth `az` around `dir`.
function perpAtAz(dir, az) {
  const ref = Math.abs(dir.y) < 0.99 ? Y : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const v = new THREE.Vector3().crossVectors(u, dir).normalize();
  return u.multiplyScalar(Math.cos(az)).addScaledVector(v, Math.sin(az)).normalize();
}

// ---------------------------------------------------------------------------
// Leaflet coupon: irregularly LOBED + SERRATED tomato leaflet. Length 1 along
// +Y (base y=0 -> pointed tip y=1), width along +X, face toward +Z. Two uneven
// lobes per side plus ~7 triangular teeth, a raised pale midrib, cupped edges
// and a gentle lengthwise twist. Vertex colours carry the pale midrib/vein and
// darker edges; per-instance colour supplies the health hue.
// ---------------------------------------------------------------------------
function leafHalfWidth(t) {
  const s = Math.sin(Math.PI * t);
  let w = 0.34 * Math.pow(s, 0.58) * (1 - 0.28 * t); // ovate-lanceolate taper
  w *= 1 + 0.34 * Math.sin(Math.PI * 2.5 * t + 0.8) * Math.sin(Math.PI * Math.min(1, t * 1.1));
  const TEETH = 7;
  const saw = 2 * Math.abs(((t * TEETH) % 1) - 0.5) * 2 - 1; // -1..1 triangle
  w *= 1 + 0.24 * saw * Math.min(1, t * 5) * (1 - 0.45 * t * t);
  return Math.max(0.010, w);
}

function buildLeafletGeometry() {
  const SEG = 9;
  const rows = SEG + 1;
  const pos = new Float32Array(rows * 3 * 3);
  const col = new Float32Array(rows * 3 * 3);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    const w = leafHalfWidth(t);
    const s = Math.sin(Math.PI * t);
    const bow = s * 0.045;              // lengthwise upward bow (+Z)
    const midZ = bow + s * 0.05;        // raised midrib
    const edgeZ = bow - s * 0.05;       // cupped edges
    const skew = 0.055 * Math.sin(Math.PI * t); // one edge up, other down
    const i = r * 3;
    pos[(i + 0) * 3 + 0] = -w; pos[(i + 0) * 3 + 1] = t; pos[(i + 0) * 3 + 2] = edgeZ + (-w) * skew;
    pos[(i + 1) * 3 + 0] = 0;  pos[(i + 1) * 3 + 1] = t; pos[(i + 1) * 3 + 2] = midZ;
    pos[(i + 2) * 3 + 0] = w;  pos[(i + 2) * 3 + 1] = t; pos[(i + 2) * 3 + 2] = edgeZ + w * skew;
    // pale midrib/vein column vs darker green edges
    col[(i + 0) * 3] = 0.76; col[(i + 0) * 3 + 1] = 0.83; col[(i + 0) * 3 + 2] = 0.68;
    col[(i + 1) * 3] = 1.0;  col[(i + 1) * 3 + 1] = 1.0;  col[(i + 1) * 3 + 2] = 0.94;
    col[(i + 2) * 3] = 0.76; col[(i + 2) * 3 + 1] = 0.83; col[(i + 2) * 3 + 2] = 0.68;
  }
  const idx = [];
  for (let r = 0; r < SEG; r++) {
    const a = r * 3, b = (r + 1) * 3;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
    idx.push(a + 1, a + 2, b + 1, b + 1, a + 2, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Tapered unit stalk (petiole / rachis segment), open-ended, base at y=0.
function buildStalkGeometry() {
  const g = new THREE.CylinderGeometry(0.5, 1, 1, 4, 1, true);
  g.translate(0, 0.5, 0);
  return g;
}

// Reconstruct the main axis (trunk + terminal leader continuation) as a flat
// list of section frames, walking from the trunk tip to whichever branch
// continues from it. Used for alternate compound-leaf nodes on the main stem.
function mainAxis(branches) {
  const axis = [];
  const used = new Set();
  let cur = 0;
  while (true) {
    used.add(cur);
    const b = branches[cur];
    for (let k = 0; k < b.sections.length; k++) axis.push(b.sections[k]);
    const tip = b.sections[b.sections.length - 1].origin;
    let next = -1, best = 1e9;
    for (let i = 0; i < branches.length; i++) {
      if (used.has(i)) continue;
      const d = branches[i].sections[0].origin.distanceToSquared(tip);
      if (d < best) { best = d; next = i; }
    }
    if (next < 0 || best > 1e-6) break;
    cur = next;
  }
  return { axis, used };
}

// Non-main-axis branches that nothing continues from — the side-shoot tips.
function terminalTips(branches, used) {
  const tips = [];
  for (let i = 0; i < branches.length; i++) {
    if (used.has(i)) continue;
    const b = branches[i];
    const tip = b.sections[b.sections.length - 1].origin;
    let isTerm = true;
    for (let j = 0; j < branches.length; j++) {
      if (j === i) continue;
      if (branches[j].sections[0].origin.distanceToSquared(tip) < 1e-8) { isTerm = false; break; }
    }
    if (isTerm) tips.push(b);
  }
  return tips;
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
  group.name = 'tomato';

  const H = height;
  const age = Math.min(1, Math.max(0.05, H / ADULT_HEIGHT));
  const isSapling = age < 0.3;

  // ---- materials (muted, coherent; older/drier = yellower/browner) ----
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x6d7a46, roughness: 0.9, metalness: 0 });
  const stakeMat = new THREE.MeshStandardMaterial({ color: 0x7c9450, roughness: 0.7, metalness: 0 }); // green bamboo stake
  const tieMat = new THREE.MeshStandardMaterial({ color: 0x9a7f4a, roughness: 0.95, metalness: 0 });
  const stalkMat = new THREE.MeshStandardMaterial({ color: 0x64723f, roughness: 0.75, metalness: 0 });
  const deadMat = new THREE.MeshStandardMaterial({ color: 0x7a5c42, roughness: 0.9, metalness: 0 });
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.55, metalness: 0, side: THREE.DoubleSide, vertexColors: true,
    emissive: 0x16230f, emissiveIntensity: 0.14,
  });

  // Collectors (assembled into InstancedMesh after placement).
  const out = { stalks: [], leaflets: [], dead: [] };

  function leafColor(health) {
    let hue, sat, light;
    if (health > 0.55) { hue = lerp(0.30, 0.26, (1 - health) / 0.45); sat = 0.34; light = 0.30; }
    else if (health > 0.22) { hue = lerp(0.17, 0.11, (0.55 - health) / 0.33); sat = 0.30; light = 0.33; }
    else { hue = 0.08; sat = 0.20; light = 0.26; }
    return new THREE.Color().setHSL(
      clamp(hue + (rand() - 0.5) * 0.05, 0.03, 0.34),
      clamp(sat + (rand() - 0.5) * 0.07, 0.12, 0.5),
      clamp(light + (rand() - 0.5) * 0.06, 0.15, 0.45),
    );
  }

  // One connected compound leaf: petiole + drooping rachis arc + leaflets.
  // `node` attachment point, `shootDir` local up, `az` azimuth, `health` 0..1,
  // `scale` leaf length, `nPairs` lateral leaflet pairs, `nInter` intercalaries.
  function addCompoundLeaf(node, shootDir, az, health, scale, nPairs, nInter) {
    const droop = 1 - health;
    const rad = perpAtAz(shootDir, az);
    const leafLen = scale * (0.24 - 0.06 * droop) * (0.92 + 0.16 * rand());

    // petiole: outward and slightly up (healthy) -> near-horizontal (droopy)
    const pElev = lerp(0.5, -0.05, droop);
    const petDir = new THREE.Vector3()
      .addScaledVector(rad, Math.cos(pElev))
      .addScaledVector(shootDir, Math.sin(pElev)).normalize();
    const plen = leafLen * 0.13;
    const base = node.clone().addScaledVector(petDir, plen);
    out.stalks.push({ p0: node.clone(), p1: base.clone(), r: 0.0012 });

    // rachis: circular drooping arc from the petiole end
    const L = leafLen * 0.82;
    const tipElev = lerp(0.15, -0.6, droop);
    const NSEG = 4;
    const arcPt = [];
    for (let k = 0; k <= NSEG; k++) {
      const a = lerp(pElev, tipElev, k / NSEG);
      arcPt.push(base.clone().addScaledVector(rad, Math.cos(a) * L).addScaledVector(shootDir, Math.sin(a) * L));
    }
    for (let k = 0; k < NSEG; k++) {
      out.stalks.push({ p0: arcPt[k].clone(), p1: arcPt[k + 1].clone(), r: lerp(0.0012, 0.0005, k / NSEG) });
    }

    const placeLeaflet = (f, sgn, lenFrac) => {
      const a = lerp(pElev, tipElev, f);
      const pt = base.clone().addScaledVector(rad, Math.cos(a) * L).addScaledVector(shootDir, Math.sin(a) * L);
      const tang = new THREE.Vector3()
        .addScaledVector(rad, -Math.sin(a))
        .addScaledVector(shootDir, Math.cos(a)).normalize();
      const lengthAxis = tang.clone().addScaledVector(rad, 0.35).normalize();
      let normal = shootDir.clone().addScaledVector(lengthAxis, -shootDir.dot(lengthAxis));
      if (normal.lengthSq() < 1e-8) normal = rad.clone();
      normal.normalize();
      let side = new THREE.Vector3().crossVectors(lengthAxis, normal).normalize();

      const len = leafLen * lenFrac * (0.9 + 0.2 * rand());
      const w = len * 0.5;
      const roll = (rand() - 0.5) * 0.5;
      const cr = Math.cos(roll), sr = Math.sin(roll);
      const side2 = side.clone().multiplyScalar(cr).addScaledVector(normal, sr).normalize();
      const normal2 = normal.clone().multiplyScalar(cr).addScaledVector(side, -sr).normalize();

      const center = pt.clone().addScaledVector(side2, sgn * w * 0.55);
      out.leaflets.push({
        px: center.x, py: center.y, pz: center.z,
        sx: side2.x, sy: side2.y, sz: side2.z,
        ax: lengthAxis.x, ay: lengthAxis.y, az: lengthAxis.z,
        nx: normal2.x, ny: normal2.y, nz: normal2.z,
        w, l: len, color: leafColor(health),
      });
    };

    // unequal subopposite lateral pairs
    const pairFracs = [0.2, 0.46, 0.66];
    for (let i = 0; i < nPairs; i++) {
      const f = pairFracs[i] + (rand() - 0.5) * 0.05;
      const size = 0.30 + 0.05 * rand();
      placeLeaflet(f, 1, size);
      placeLeaflet(f + 0.03 + (rand() - 0.5) * 0.03, -1, size * (0.85 + 0.2 * rand()));
    }
    // small intercalary leaflets between the larger pairs
    for (let i = 0; i < nInter; i++) {
      const sgn = rand() < 0.5 ? 1 : -1;
      placeLeaflet(0.34 + i * 0.16 + (rand() - 0.5) * 0.05, sgn, 0.14 + 0.04 * rand());
    }
    // larger terminal leaflet at the rachis tip
    placeLeaflet(1.0, 0, 0.46 + 0.06 * rand());
  }

  // ---- connected stem + side shoots (pinned EZ-Tree adapter) ----
  const branchCfg = isSapling
    ? {
        seed, levels: 1,
        lengths: [H * 0.55, H * 0.30, H * 0.10, 0.02],
        radii: [0.0028, 0.5, 0.45, 0.4],
        children: [0, 0, 0, 0],
        angles: [0, 40, 38, 36],
        starts: [0, 0.30, 0.30, 0.30],
        gnarliness: [0.0008, 0.001, 0.001, 0.001],
        leafCount: 0,
      }
    : {
        seed, levels: 2,
        lengths: [H * 0.5, H * 0.28, H * 0.12, 0.03],
        radii: [0.0055, 0.5, 0.5, 0.45],
        children: [4, 1, 0, 0],
        angles: [0, 52, 46, 40],
        starts: [0, 0.30, 0.28, 0.28],
        gnarliness: [0.002, 0.004, 0.006, 0.002],
        leafCount: 0,
      };
  const { geometry: branchGeom, branches } = makeBranching(branchCfg);
  group.add(new THREE.Mesh(branchGeom, stemMat));

  const secDir = (sec) => Y.clone().applyEuler(sec.orientation).normalize();

  if (isSapling) {
    // Juvenile: short green stem, two cotyledons + a few young compound leaves.
    const trunk = branches[0];
    const topY = trunk.sections[trunk.sections.length - 1].origin.y || H;

    // cotyledons (opposite, simple, low on the stem)
    {
      const sec = trunk.sections[Math.floor(0.30 * (trunk.sections.length - 1))];
      const d = secDir(sec);
      const rad0 = perpAtAz(d, rand() * Math.PI * 2);
      for (let k = 0; k < 2; k++) {
        const rad = k === 0 ? rad0 : rad0.clone().negate();
        const ldir = d.clone().addScaledVector(rad, 0.5).normalize();
        let n = d.clone().addScaledVector(ldir, -d.dot(ldir));
        if (n.lengthSq() < 1e-8) n = rad.clone(); else n.normalize();
        const side = new THREE.Vector3().crossVectors(ldir, n).normalize();
        const len = H * 0.34, w = len * 0.62;
        const c = leafColor(0.95);
        out.leaflets.push({
          px: sec.origin.x, py: sec.origin.y, pz: sec.origin.z,
          sx: side.x, sy: side.y, sz: side.z,
          ax: ldir.x, ay: ldir.y, az: ldir.z,
          nx: n.x, ny: n.y, nz: n.z,
          w, l: len, color: c,
        });
      }
    }

    // young true leaves: small compound, one pair + terminal, no stake
    let az = rand() * Math.PI * 2;
    for (let i = 0; i < 3; i++) {
      const f = 0.5 + i * 0.15 + (rand() - 0.5) * 0.05;
      const sec = trunk.sections[Math.min(trunk.sections.length - 1, Math.floor(f * (trunk.sections.length - 1)))];
      az += 2.4 + (rand() - 0.5) * 0.6;
      addCompoundLeaf(sec.origin, secDir(sec), az, 0.92, H * 0.42, 1, 0);
    }
    group.userData = { family: 'tomato', round: 1, age, isSapling, leafCount: out.leaflets.length };
    topY; // (kept: no side shoots / stake / dead debris on a juvenile)
  } else {
    const { axis, used } = mainAxis(branches);
    const axisTopY = axis[axis.length - 1].origin.y || H;

    // alternate compound leaves along the main axis (bare lower stem)
    let azAcc = rand() * Math.PI * 2;
    let placed = 0;
    const minY = 0.30, maxY = 0.92;
    for (let s = 0; s < axis.length; s++) {
      const sec = axis[s];
      const yFrac = clamp(sec.origin.y / axisTopY, 0, 1);
      if (yFrac < minY || yFrac > maxY) continue;
      if (s % 2 !== 0) continue;
      azAcc += 2.4 + (rand() - 0.5) * 0.9; // ~137.5° alternate phyllotaxis + jitter
      const health = clamp(lerp(0.85, 0.35, yFrac) + (rand() - 0.5) * 0.1, 0.05, 0.95);
      addCompoundLeaf(sec.origin, secDir(sec), azAcc + (rand() - 0.5) * 0.5, health, H, 3, 1);
      placed++;
      if (placed >= 5) break;
    }

    // sparse drooping/yellowing leaves on the lower side-shoot tips
    let sideLeaves = 0;
    for (const tb of terminalTips(branches, used)) {
      const tip = tb.sections[tb.sections.length - 1].origin;
      const yFrac = clamp(tip.y / axisTopY, 0, 1);
      if (yFrac > 0.55) continue; // upper shoots stay bare/shrivelled
      const az = Math.atan2(tip.z, tip.x) + (rand() - 0.5) * 0.6;
      const health = 0.2 + 0.18 * rand();
      addCompoundLeaf(tip, secDir(tb.sections[tb.sections.length - 1]), az, health, H * 0.7, 1, 0);
      sideLeaves++;
      if (sideLeaves >= 3) break;
    }

    // fine bare / shrivelled stalks on the lower stem
    for (let i = 0; i < 4; i++) {
      const yFrac = 0.12 + 0.4 * rand();
      const si = Math.min(axis.length - 1, Math.floor(yFrac * (axis.length - 1)));
      const p0 = axis[si].origin.clone();
      const az = rand() * Math.PI * 2;
      const len = (0.035 + 0.05 * rand());
      const p1 = p0.clone().add(new THREE.Vector3(Math.cos(az) * len, -(0.015 + 0.03 * rand()), Math.sin(az) * len));
      out.dead.push({ p0, p1, r: 0.0009 });
    }

    // green bamboo stake + twine ties (kept slim, not dominant)
    {
      const stakeH = H * 0.9;
      const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.008, stakeH, 6), stakeMat);
      stake.position.set(0.03, stakeH / 2, 0.012);
      stake.rotation.z = 0.02;
      stake.rotation.x = -0.015;
      group.add(stake);
      for (const ty of [H * 0.34, H * 0.58]) {
        const tie = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, 0.042, 5), tieMat);
        tie.position.set(0.016, ty, 0.006);
        tie.rotation.z = Math.PI / 2;
        group.add(tie);
      }
    }

    group.userData = {
      family: 'tomato', round: 1, age, isSapling,
      leafCount: out.leaflets.length,
      branchLevels: branchCfg.levels,
      hypothesis: 'thin lanky near-bare stem on a green stake; few drooping pinnately-compound leaves alternating up the main axis + bare/yellowing side shoots; connected EZ-Tree branch/node architecture with species-specific lobed+serrated leaflet coupon; no fruit; juvenile is a short single stem with cotyledons + young leaves, not a scaled adult.',
    };
  }

  // ---- assemble instanced meshes ----
  const m4 = new THREE.Matrix4();
  const q4 = new THREE.Quaternion();
  const s3 = new THREE.Vector3();
  const p3 = new THREE.Vector3();
  const d3 = new THREE.Vector3();
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();

  // petioles + rachis segments (one tapered stalk geometry)
  if (out.stalks.length) {
    const stalkGeom = buildStalkGeometry();
    const stalkMesh = new THREE.InstancedMesh(stalkGeom, stalkMat, out.stalks.length);
    stalkMesh.name = 'tomato_stalks';
    for (let i = 0; i < out.stalks.length; i++) {
      const b = out.stalks[i];
      d3.subVectors(b.p1, b.p0);
      const len = Math.max(1e-5, d3.length());
      d3.normalize();
      q4.setFromUnitVectors(Y, d3);
      p3.copy(b.p0);
      s3.set(b.r, len, b.r);
      m4.compose(p3, q4, s3);
      stalkMesh.setMatrixAt(i, m4);
    }
    group.add(stalkMesh);
  }

  // dead / shrivelled stalks
  if (out.dead.length) {
    const stalkGeom = buildStalkGeometry();
    const deadMesh = new THREE.InstancedMesh(stalkGeom, deadMat, out.dead.length);
    deadMesh.name = 'tomato_dead';
    for (let i = 0; i < out.dead.length; i++) {
      const b = out.dead[i];
      d3.subVectors(b.p1, b.p0);
      const len = Math.max(1e-5, d3.length());
      d3.normalize();
      q4.setFromUnitVectors(Y, d3);
      p3.copy(b.p0);
      s3.set(b.r, len, b.r);
      m4.compose(p3, q4, s3);
      deadMesh.setMatrixAt(i, m4);
    }
    group.add(deadMesh);
  }

  // lobed+serrated leaflets
  if (out.leaflets.length) {
    const leafGeom = buildLeafletGeometry();
    const leafMesh = new THREE.InstancedMesh(leafGeom, leafMat, out.leaflets.length);
    leafMesh.name = 'tomato_leaflets';
    for (let i = 0; i < out.leaflets.length; i++) {
      const L = out.leaflets[i];
      v1.set(L.sx, L.sy, L.sz);
      v2.set(L.ax, L.ay, L.az);
      v3.set(L.nx, L.ny, L.nz);
      m4.makeBasis(v1, v2, v3);
      m4.setPosition(L.px, L.py, L.pz);
      s3.set(L.w, L.l, L.l);
      m4.scale(s3);
      leafMesh.setMatrixAt(i, m4);
      leafMesh.setColorAt(i, L.color);
    }
    leafMesh.instanceMatrix.needsUpdate = true;
    if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
    group.add(leafMesh);
  }

  // ---- normalise to requested height (above soil) and canopy spread ----
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
