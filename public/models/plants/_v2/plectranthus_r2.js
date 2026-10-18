import * as THREE from 'three';

// Trailing plectranthus (Swedish ivy, Plectranthus verticillatus).
// Identity: many slender succulent stems emerge from a low crown, arch up and
// outward, then spill over the pot rim and hang down the outside. Along each
// stem, broad rounded, softly scalloped (crenate) yellow-green leaves grow in
// opposite pairs; blades are held at varied angles so their broad faces show.
// Silhouette = a low, wide, sprawling mound with leafy runners down the pot.

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Broad rounded (reniform) leaf with a blunt tip and a softly scalloped margin.
// Petiole attaches at local (0,0), blade extends to (0,1); wider than it is
// long. A gentle raised midrib (visible vein) and softly cupped edges give a
// fleshy look without sharp folds. 8 length segments -> 32 tris.
function buildLeafGeometry() {
  const SEG = 16;
  const rows = SEG + 1;
  const baseHalfW = [0.14, 0.42, 0.55, 0.57, 0.53, 0.43, 0.30, 0.20, 0.13];
  const teeth = 4;      // soft scallop lobes per side
  const amp = 0.04;     // subtle scallop amplitude
  const pos = new Float32Array(rows * 3 * 3);
  for (let r = 0; r < rows; r++) {
    const t = r / SEG;
    const s = Math.sin(Math.PI * t);
    const scallop = 1 + amp * Math.cos(2 * Math.PI * teeth * t);
    const w = .55 * Math.pow(Math.max(0, Math.sin(Math.PI * t)), .6) * (1 + .10 * Math.cos(2 * Math.PI * 6 * t));
    const bow = s * 0.045;
    const midZ = bow + s * 0.035;   // gentle midrib
    const edgeZ = bow - s * 0.035;  // gentle cup
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

export function createPlant({
  height = 0.4,
  spread = 0.4,
  potDiameter = 0.25,
  seed = 1,
  width,
  depth,
} = {}) {
  const rand = mulberry32(seed);
  const group = new THREE.Group();

  const stemMat = new THREE.MeshStandardMaterial({ color: 0x9cb060, roughness: 0.55 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, side: THREE.DoubleSide });

  const leafGeo = buildLeafGeometry();
  const rimR = potDiameter / 2; // pot rim radius, stems must clear this

  const stems = [];    // array of CatmullRomCurve3
  const leafList = []; // { px,py,pz, Xx..Zz, w, l, color }

  const age = Math.min(1, Math.max(.08, height / .4));
  const juvenile = age < .3;
  const stemCount = juvenile ? 2 : 8;

  for (let i = 0; i < stemCount; i++) {
    const az = (i / stemCount) * Math.PI * 2 + (rand() - 0.5) * 0.9;
    const cosA = Math.cos(az), sinA = Math.sin(az);

    // Per-stem character: mound (arches up), or runner (spreads sideways then
    // hangs). Irregular mix gives an asymmetric, sprawling silhouette.
    const kind = rand();                       // 0=mound .. 1=runner
    const baseR = (0.008 + 0.02 * rand()) * age;
    const apexR = (0.14 + 0.08 * rand()) * Math.pow(age, .65);        // wide mound (0.14..0.22)
    const apexH = height * (0.55 - 0.30 * kind + 0.28 * rand());  // lower for runners
    const overR = juvenile ? height * .18 : rimR + 0.02 + 0.035 * rand();
    const overH = height * (0.04 + 0.12 * rand());
    const trail = 0.4 + 0.6 * rand();
    const tipR = overR + 0.015 + 0.04 * rand();
    const tipH = juvenile ? height * .65 : -Math.min(height * .15, potDiameter * .25) * (.6 + .4 * trail);        // hang down the outside

    const midR = (baseR + apexR) * 0.5;
    const pts = [
      new THREE.Vector3(baseR * cosA, 0, baseR * sinA),
      new THREE.Vector3(midR * cosA, apexH * 0.55, midR * sinA),
      new THREE.Vector3(apexR * cosA, apexH, apexR * sinA),
      new THREE.Vector3(overR * cosA, overH, overR * sinA),
      new THREE.Vector3(tipR * cosA, tipH, tipR * sinA),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    stems.push(curve);

    const pairs = juvenile ? 1 : 3 + (rand() < 0.6 ? 1 : 0); // 3..4 opposite pairs -> 6..8 leaves
    const nodeTs = [];
    for (let k = 0; k < pairs; k++) nodeTs.push((k + 0.5) / pairs + (rand() - 0.5) * 0.14);
    nodeTs.sort((x, y) => x - y);

    for (let k = 0; k < pairs; k++) {
      const t = Math.min(0.93, Math.max(0.06, nodeTs[k]));
      const P = curve.getPointAt(t);
      const T = curve.getTangentAt(t).normalize();

      // radial-outward (horizontal) direction, perpendicular to the stem
      let rx = P.x, rz = P.z;
      const rl = Math.hypot(rx, rz);
      if (rl < 1e-4) { rx = cosA; rz = sinA; }
      else { rx /= rl; rz /= rl; }
      const dotT = rx * T.x + rz * T.z;
      let Dx = rx - T.x * dotT;
      let Dy = -T.y * dotT;
      let Dz = rz - T.z * dotT;
      const dl = Math.hypot(Dx, Dy, Dz) || 1;
      Dx /= dl; Dy /= dl; Dz /= dl;

      const pAz = (rand() - 0.5) * 1.1;
      const cx = T.y * Dz - T.z * Dy, cy = T.z * Dx - T.x * Dz, cz = T.x * Dy - T.y * Dx;
      const cp = Math.cos(pAz), sp = Math.sin(pAz);
      const jx = Dx * cp + cx * sp, jy = Dy * cp + cy * sp, jz = Dz * cp + cz * sp;

      placeLeaf(P, T, jx, jy, jz, t);
      placeLeaf(P, T, -jx, -jy, -jz, t);
    }
  }

  function placeLeaf(P, T, Dx, Dy, Dz, t) {
    // Leaf tip direction: outward with a tilt ranging from slightly upturned
    // (young upper leaves) to hanging down (trailing leaves), so broad faces
    // show at many angles instead of all pointing down.
    const tilt = -0.10 + 0.85 * rand() + 0.35 * t;
    let Yx = Dx, Yy = tilt, Yz = Dz;
    let yl = Math.hypot(Yx, Yy, Yz) || 1; Yx /= yl; Yy /= yl; Yz /= yl;

    // Face normal: outward with an up-lean (more up for upper leaves -> faces
    // visible from the top; more outward for trailing leaves -> faces visible
    // from the side).
    const faceUp = 0.25 + 0.45 * rand() - 0.15 * t;
    let Zx = Dx, Zy = faceUp, Zz = Dz;
    let zl = Math.hypot(Zx, Zy, Zz) || 1; Zx /= zl; Zy /= zl; Zz /= zl;

    const dot = Yx * Zx + Yy * Zy + Yz * Zz;
    Yx -= Zx * dot; Yy -= Zy * dot; Yz -= Zz * dot;
    yl = Math.hypot(Yx, Yy, Yz) || 1; Yx /= yl; Yy /= yl; Yz /= yl;

    let Xx = Yy * Zz - Yz * Zy, Xy = Yz * Zx - Yx * Zz, Xz = Yx * Zy - Yy * Zx;
    const xl = Math.hypot(Xx, Xy, Xz) || 1; Xx /= xl; Xy /= xl; Xz /= xl;

    const sizeScale = 0.82 + 0.32 * Math.sin(Math.PI * t); // larger mid-stem, smaller at tips
    const l = (0.050 + 0.024 * rand()) * sizeScale * Math.pow(age, .6);
    const w = l * (0.80 + 0.16 * rand());

    let hue, sat, light;
    if (rand() < 0.28) {                    // pale sage
      hue = 0.24 + rand() * 0.04;
      sat = 0.20 + rand() * 0.10;
      light = 0.55 + rand() * 0.10;
    } else {                                // fresh yellow-green / medium green
      hue = 0.17 + rand() * 0.07;
      sat = 0.33 + rand() * 0.17;
      light = 0.47 + rand() * 0.13;
    }
    const color = new THREE.Color().setHSL(hue, sat, light);

    leafList.push({
      px: P.x + Dx * 0.010, py: P.y + Dy * 0.010, pz: P.z + Dz * 0.010,
      Xx, Xy, Xz, Yx, Yy, Yz, Zx, Zy, Zz, w, l, color,
    });
  }

  // ---- stems ----
  for (const s of stems) {
    const geom = new THREE.TubeGeometry(s, 12, .0025 * Math.sqrt(age), 4, false);
    group.add(new THREE.Mesh(geom, stemMat));
  }

  // ---- leaves (instanced) ----
  const leafMesh = new THREE.InstancedMesh(leafGeo, leafMat, leafList.length);
  const m = new THREE.Matrix4();
  const vX = new THREE.Vector3(), vY = new THREE.Vector3(), vZ = new THREE.Vector3(), vP = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (let i = 0; i < leafList.length; i++) {
    const L = leafList[i];
    vX.set(L.Xx, L.Xy, L.Xz);
    vY.set(L.Yx, L.Yy, L.Yz);
    vZ.set(L.Zx, L.Zy, L.Zz);
    m.makeBasis(vX, vY, vZ);
    vP.set(L.px, L.py, L.pz);
    m.setPosition(vP);
    scale.set(L.w, L.l, L.w);
    m.scale(scale);
    leafMesh.setMatrixAt(i, m);
    leafMesh.setColorAt(i, L.color);
  }
  leafMesh.instanceMatrix.needsUpdate = true;
  if (leafMesh.instanceColor) leafMesh.instanceColor.needsUpdate = true;
  group.add(leafMesh);

  // Uniform scale so the canopy fills the requested spread while preserving the
  // plant's naturally wide, sprawling aspect (a trailing plant is wider than
  // tall; a per-axis scale would stretch it into a narrow tent).
  const box = new THREE.Box3().setFromObject(group);
  const plantW = Math.max(1e-4, box.max.x - box.min.x, box.max.z - box.min.z);
  const desiredSpread = juvenile ? Math.min(spread, height * 1.2) : spread;
  const s = desiredSpread / plantW;
  group.scale.set(s, height / Math.max(.001, box.max.y), s);

  return group;
}
