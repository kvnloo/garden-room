import * as THREE from 'three';

// Deterministic PRNG (mulberry32). No Math.random anywhere.
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Closed tapered strap blade. Local frame: grows along +Y, width along +X,
// thickness along +Z. Six-vertex flattened cross-section (shallow top groove,
// convex bottom keel) swept along a gentle arc with gradual taper. A vertex
// colour ramp (base -> tip) encodes longitudinal shading and, for pruned
// blades, a dry brown cut tip.
function buildStrapGeometry({ length, baseWidth, tipWidth, thickness, segments,
  baseColor, tipColor, tipStart }) {
  const rows = segments + 1;
  const pos = new Float32Array(rows * 6 * 3);
  const col = new Float32Array(rows * 6 * 3);
  const idx = [];
  const c0 = new THREE.Color(baseColor);
  const c1 = new THREE.Color(tipColor);
  const tmp = new THREE.Color();
  const arc = length * 0.07;   // gentle forward curve
  const sway = length * 0.03;  // slight lateral sway

  for (let r = 0; r < rows; r++) {
    const t = r / segments;
    const tt = Math.pow(t, 0.62);             // gradual taper
    const w = baseWidth + (tipWidth - baseWidth) * tt;
    const h = (thickness / 2) * (1 - 0.68 * t); // thins toward tip
    const y = t * length;
    const bx = sway * t * t;
    const bz = -arc * t * t;
    // cross-section X/Z offsets (TL, TC, TR, BR, BC, BL)
    const xs = [-w / 2, 0, w / 2, w / 2, 0, -w / 2];
    const zs = [h, h * 0.55, h, -h, -h * 0.8, -h];
    tmp.copy(c0).lerp(c1, smoothstep(tipStart, 1, t));
    for (let v = 0; v < 6; v++) {
      const i = (r * 6 + v) * 3;
      pos[i] = xs[v] + bx;
      pos[i + 1] = y;
      pos[i + 2] = zs[v] + bz;
      col[i] = tmp.r; col[i + 1] = tmp.g; col[i + 2] = tmp.b;
    }
  }
  for (let r = 0; r < segments; r++) {
    for (let e = 0; e < 6; e++) {
      const a = r * 6 + e;
      const b = r * 6 + ((e + 1) % 6);
      const c = (r + 1) * 6 + ((e + 1) % 6);
      const d = (r + 1) * 6 + e;
      idx.push(a, b, c, a, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Orient +Y (blade length) along a tilted axis and place width tangentially,
// so each strap stands with its broad face horizontal to the fan.
function placeInstances(inst, blades) {
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const axis = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  inst.geometry.computeBoundingBox();
  const couponLength = inst.geometry.boundingBox.max.y;
  for (let i = 0; i < blades.length; i++) {
    const b = blades[i];
    const tilt = Math.max(0.04, b.tilt);
    axis.set(Math.sin(tilt) * Math.sign(b.p || .1), Math.cos(tilt),
      Math.sin(tilt) * Math.sin(b.azimuth) * .25).normalize();
    xAxis.crossVectors(axis, new THREE.Vector3(0, 0, 1));
    if (xAxis.lengthSq() < 1e-6) xAxis.set(1, 0, 0); else xAxis.normalize();
    zAxis.crossVectors(xAxis, axis).normalize();
    m4.makeBasis(xAxis, axis, zAxis);
    dummy.quaternion.setFromRotationMatrix(m4);
    dummy.position.set(0, b.baseY, 0);
    dummy.scale.set(.65, b.length / couponLength, 1);
    dummy.rotateOnAxis(axis, b.roll);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
    col.setRGB(b.tint * 0.98, b.tint, b.tint * 0.96);
    inst.setColorAt(i, col);
  }
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
}

// Blade layout: a narrow asymmetric upright fan. Central blades are taller and
// near-vertical; outer blades are shorter and lean outward. Returns per-blade
// parameters; blunt/pruned assignment is decided later by |p| (outer = older).
function bladeParams(count, reach, rand, juvenile) {
  const half = (count - 1) / 2;
  const out = [];
  for (let i = 0; i < count; i++) {
    const p = count === 1 ? 0 : (i - half) / half;          // -1..1, fan position
    const lenF = 1 - 0.38 * Math.pow(Math.abs(p), 1.3) + (rand() - 0.5) * 0.05;
    const tilt = (juvenile ? 0.18 : 0.62) * Math.pow(Math.abs(p), 0.9) + (rand() - 0.5) * 0.05;
    const az = p * (juvenile ? 0.45 : 0.5) + (rand() - 0.5) * 0.2 + 0.06 * (p >= 0 ? 1 : -1);
    const tint = 0.86 + 0.19 * (1 - Math.abs(p)) + (rand() - 0.5) * 0.05;
    out.push({
      length: Math.max(0.012, reach * lenF),
      tilt, azimuth: az,
      roll: (rand() - 0.5) * 0.12,
      baseY: 0.011 + rand() * 0.003,
      tint,
      p,
    });
  }
  return out;
}

// Soil-level compact crown knot where every blade base attaches.
function buildCrown(potD) {
  const g = new THREE.SphereGeometry(0.011 * (potD / 0.25), 10, 8);
  const m = new THREE.MeshStandardMaterial({ color: 0x4e6e2a, roughness: 0.8, metalness: 0 });
  const crown = new THREE.Mesh(g, m);
  crown.scale.set(1, 0.55, 1);
  crown.position.y = 0.009;
  return crown;
}

/**
 * Pruned strap-leaf succulent ("aloe" specimen). Not a broad aloe rosette: a
 * narrow upright fan of ~9 slender tapered blades from one soil-level crown,
 * several with blunt browned cut tips. Height is read as the nominal adult
 * scale; the true soil-to-tip reach is ~3/4 of the pot outer diameter (the
 * reference specimen is small for its pot). No pot, soil, flowers or offsets.
 */
export function createPlant({ height = 0.25, spread = 0.2, potDiameter = 0.25,
  seed = 1, width, depth } = {}) {
  const rand = mulberry32(seed);
  const group = new THREE.Group();
  group.name = 'aloe';

  const potD = potDiameter || 0.25;
  const familyAdultHeight = 0.25;                       // nominal adult (== potD here)
  const r = clamp(height / familyAdultHeight, 0.12, 1); // relative age
  const reach = 0.70 * height;                          // soil-to-tip reach (~3/4 potD at adult)
  const juvenile = r < 0.25;

  // Growth is topology, not uniform scale: fewer blades when young.
  const leafCount = juvenile ? 3 : r < 0.6 ? 6 : 9;
  const blades = bladeParams(leafCount, reach, rand, juvenile);

  const pointed = blades.filter(b => Math.abs(b.p) <= 0.55 || juvenile);
  const blunt = blades.filter(b => Math.abs(b.p) > 0.55 && !juvenile);

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, vertexColors: true, side: THREE.DoubleSide,
    roughness: 0.65, metalness: 0,
  });

  // Green pointed blades (fresher, lighter tip; the majority).
  if (pointed.length) {
    const baseW = reach * (juvenile ? 0.17 : 0.115);
    const geo = buildStrapGeometry({
      length: reach, baseWidth: baseW, tipWidth: baseW * 0.05,
      thickness: baseW * (juvenile ? 0.16 : 0.2),
      segments: juvenile ? 5 : 6,
      baseColor: juvenile ? 0x8fbf4d : 0x7fae4a,
      tipColor: juvenile ? 0xa8d45a : 0x9cc65a,
      tipStart: 0.72,
    });
    const inst = new THREE.InstancedMesh(geo, material, pointed.length);
    inst.frustumCulled = false;
    inst.name = 'pointed-leaves';
    placeInstances(inst, pointed);
    group.add(inst);
  }

  // Blunt pruned blades with dry brown cut tips (the outer, older leaves).
  if (blunt.length) {
    const baseW = reach * 0.115;
    const geo = buildStrapGeometry({
      length: reach, baseWidth: baseW, tipWidth: baseW * 0.4,
      thickness: baseW * 0.2,
      segments: 6,
      baseColor: 0x6b9a3e, tipColor: 0x9a6f3c, tipStart: 0.7,
    });
    const inst = new THREE.InstancedMesh(geo, material, blunt.length);
    inst.frustumCulled = false;
    inst.name = 'blunt-leaves';
    placeInstances(inst, blunt);
    group.add(inst);
  }

  const crown = buildCrown(potD);
  crown.name = 'crown';
  group.add(crown);

  group.userData = {
    family: 'aloe', hypothesis: 'narrow-asymmetric-strap-fan',
    ageRatio: r, leafCount, reach,
  };

  // Honour the public height contract, including juvenile construction.
  group.updateMatrixWorld(true);
  const maxY = new THREE.Box3().setFromObject(group).max.y;
  if (maxY > 0) group.scale.y = height / maxY;
  return group;
}
