import * as THREE from 'three';

// banana — dwarf banana (Musa, ~1.4 m): a slim pseudostem of overlapping leaf
// sheaths, crowned by long paddle leaves on visible petioles that shoot up and
// arch outward, the older ones drooping hard at the tip, plus a small basal
// sucker shoot. Bright yellow-green blades with a pale midrib, fine transverse
// veins, mottled tones and a weathered brown margin.

// --- seeded PRNG (mulberry32) ---
function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Leaf: an arched paddle. The midrib "spine" is a curve in the local YZ plane
// (Y = up, Z = outward from the plant) that starts nearly vertical at the base
// and sweeps toward horizontal / past it at the tip. The blade spans the X
// axis (width, horizontal) and hangs down from the ridge so the cross-section
// reads as a shallow inverted V. Unit length; the instancer scales by the real
// leaf length and rotates around Y for azimuth (Y stays vertical).
// ---------------------------------------------------------------------------
function buildLeafGeometry({ a0, a1, wmax, rib, edgeDroop, petioleT, segments, widthPts }) {
  const stations = segments + 1;
  const center = new Float32Array(stations * 3);
  const tangent = new Float32Array(stations * 3);
  const step = 1 / segments;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const a = a0 + (a1 - a0) * t;
    const am = i === 0 ? a0 : (a0 + (a1 - a0) * (t - step * 0.5));
    tangent[i * 3 + 1] = Math.cos(a);
    tangent[i * 3 + 2] = Math.sin(a);
    if (i === 0) { center[i * 3 + 1] = 0; center[i * 3 + 2] = 0; }
    else {
      center[i * 3 + 1] = center[(i - 1) * 3 + 1] + Math.cos(am) * step;
      center[i * 3 + 2] = center[(i - 1) * 3 + 2] + Math.sin(am) * step;
    }
  }

  const vertCount = stations * widthPts;
  const positions = new Float32Array(vertCount * 3);
  const colors = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);

  const bladeColor = new THREE.Color().setHSL(0.21, 0.56, 0.50);
  const midribColor = new THREE.Color().setHSL(0.15, 0.26, 0.85);
  const edgeColor = new THREE.Color().setHSL(0.09, 0.40, 0.47);
  const petioleColor = new THREE.Color().setHSL(0.20, 0.46, 0.44);
  const tmp = new THREE.Color();

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const cy = center[i * 3 + 1];
    const cz = center[i * 3 + 2];
    const ty = tangent[i * 3 + 1];
    const tz = tangent[i * 3 + 2];
    const ry = tz;   // ridge direction = T x (1,0,0) = (0, tz, -ty)
    const rz = -ty;

    const blade = smoothstep(petioleT, petioleT + 0.06, t);
    const x = Math.min(1, Math.max(0, (t - petioleT) / (1 - petioleT)));
    // Broad paddle with a rounded (obtuse) tip, not a sharp point.
    let paddle = 0;
    if (x > 0) paddle = Math.max(0.06, Math.pow(Math.sin(Math.PI * x), 0.6));

    for (let j = 0; j < widthPts; j++) {
      const u = -1 + (2 * j) / (widthPts - 1);
      const au = Math.abs(u);

      const halfW = 0.008 + (wmax - 0.008) * blade * paddle;
      const zoff = rib * (1 - au) - edgeDroop * au * au * blade;

      const vIdx = (i * widthPts + j) * 3;
      positions[vIdx] = halfW * u;
      positions[vIdx + 1] = cy + ry * zoff;
      positions[vIdx + 2] = cz + rz * zoff;

      const pale = blade * Math.exp(-au * 3.4);
      tmp.copy(bladeColor).lerp(midribColor, Math.min(1, pale * 0.88));
      if (blade < 0.5) tmp.copy(petioleColor);
      tmp.lerp(edgeColor, blade * smoothstep(0.5, 0.98, au) * 0.5);
      colors[vIdx] = tmp.r;
      colors[vIdx + 1] = tmp.g;
      colors[vIdx + 2] = tmp.b;

      const uvIdx = (i * widthPts + j) * 2;
      uvs[uvIdx] = (u + 1) * 0.5;
      uvs[uvIdx + 1] = t;
    }
  }

  const indices = [];
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < widthPts - 1; j++) {
      const a = i * widthPts + j;
      const b = a + 1;
      const c = (i + 1) * widthPts + j;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

// ---------------------------------------------------------------------------
// Pseudostem texture: mottled tan->green gradient with longitudinal sheath
// streaks and dried patches near the base.
// ---------------------------------------------------------------------------
function buildStemTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#8da34a');
  grd.addColorStop(0.6, '#7d9a3e');
  grd.addColorStop(1, '#8a7a4e');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 16; i++) {
    const x = i * 8 + ((i * 37) % 5);
    g.fillStyle = i % 2 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,240,0.09)';
    g.fillRect(x, 0, 2 + (i % 3), 256);
  }
  for (let k = 0; k < 6; k++) {
    const x = 10 + ((k * 29) % 100), y = 200 + ((k * 17) % 44);
    g.fillStyle = 'rgba(120,90,50,0.22)';
    g.fillRect(x, y, 15, 10);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// Leaf blade texture: pale midrib stripe, fine irregular transverse veins,
// faint mottling for tonal variation.
function buildVeinTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 256);
  // Faint mottling.
  for (let k = 0; k < 40; k++) {
    const x = (k * 31) % 128, y = (k * 53) % 256;
    g.fillStyle = k % 2 ? 'rgba(210,220,160,0.10)' : 'rgba(230,235,180,0.10)';
    g.fillRect(x, y, 10, 14);
  }
  const grd = g.createLinearGradient(46, 0, 82, 0);
  grd.addColorStop(0, 'rgba(205,218,160,0)');
  grd.addColorStop(0.5, 'rgba(196,212,148,0.55)');
  grd.addColorStop(1, 'rgba(205,218,160,0)');
  g.fillStyle = grd; g.fillRect(40, 0, 48, 256);
  // Irregular transverse veins.
  g.strokeStyle = 'rgba(42,82,30,0.10)';
  g.lineWidth = 1;
  let v = 6;
  while (v < 256) {
    g.beginPath(); g.moveTo(11, v); g.lineTo(117, v); g.stroke();
    v += 3 + ((v * 7) % 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4;
  return t;
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

  // ---- pseudostem (slim, smooth, overlapping-sheath texture) ----
  const stemH = height * 0.44;
  const stemGeom = new THREE.CylinderGeometry(height * 0.021, height * 0.032, stemH, 18);
  const stemMat = new THREE.MeshStandardMaterial({
    map: buildStemTexture(),
    color: 0xffffff,
    roughness: 0.8,
  });
  const stem = new THREE.Mesh(stemGeom, stemMat);
  stem.position.y = stemH / 2;
  group.add(stem);

  // ---- leaves ----
  const leafMat = new THREE.MeshStandardMaterial({
    map: buildVeinTexture(),
    color: 0xffffff,
    roughness: 0.52,
    metalness: 0,
    side: THREE.DoubleSide,
    vertexColors: true,
    emissive: 0x0e2006,
    emissiveIntensity: 0.3,
  });

  // Young folded cigar leaf: narrow, upright, blade halves folded up.
  const cigarGeom = buildLeafGeometry({ a0: 0.06, a1: 0.30, wmax: 0.07, rib: 0.018, edgeDroop: -0.018, petioleT: 0.10, segments: 12, widthPts: 7 });
  const innerGeom = buildLeafGeometry({ a0: 0.16, a1: 0.90, wmax: 0.17, rib: 0.012, edgeDroop: 0.022, petioleT: 0.20, segments: 22, widthPts: 9 });
  const outerGeom = buildLeafGeometry({ a0: 0.24, a1: 1.70, wmax: 0.17, rib: 0.012, edgeDroop: 0.030, petioleT: 0.20, segments: 22, widthPts: 9 });
  const droopyGeom = buildLeafGeometry({ a0: 0.34, a1: 2.10, wmax: 0.16, rib: 0.012, edgeDroop: 0.036, petioleT: 0.20, segments: 22, widthPts: 9 });
  const pupGeom = buildLeafGeometry({ a0: 0.40, a1: 1.35, wmax: 0.15, rib: 0.010, edgeDroop: 0.024, petioleT: 0.18, segments: 13, widthPts: 9 });

  const dummy = new THREE.Object3D();

  // { geom, count, lenScale, yFrac, yJit, baseR } — baseR offsets the sucker
  // shoot away from the trunk so it reads as a distinct basal shoot.
  const batches = [
    { geom: cigarGeom, count: 1, lenScale: 0.58, yFrac: 0.98, yJit: 0.01, baseR: 0.012 },
    { geom: innerGeom, count: 2, lenScale: 0.66, yFrac: 0.86, yJit: 0.06, baseR: 0.014 },
    { geom: outerGeom, count: 4, lenScale: 0.74, yFrac: 0.56, yJit: 0.18, baseR: 0.016 },
    { geom: droopyGeom, count: 2, lenScale: 0.72, yFrac: 0.42, yJit: 0.12, baseR: 0.016 },
    { geom: pupGeom, count: 3, lenScale: 0.24, yFrac: 0.06, yJit: 0.02, baseR: 0.062 },
  ];

  for (const b of batches) {
    const mesh = new THREE.InstancedMesh(b.geom, leafMat, b.count);
    for (let i = 0; i < b.count; i++) {
      const az = (i / b.count) * Math.PI * 2 + (rand() - 0.5) * 0.9;
      const len = height * b.lenScale * (0.86 + rand() * 0.28);
      const attachY = stemH * (b.yFrac + (rand() - 0.5) * 2 * b.yJit);
      const tiltX = (rand() - 0.5) * 0.14;
      const tiltZ = (rand() - 0.5) * 0.14;
      dummy.position.set(Math.cos(az) * b.baseR, attachY, Math.sin(az) * b.baseR);
      dummy.rotation.set(tiltX, az, tiltZ);
      dummy.scale.setScalar(len);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      const c = new THREE.Color().setHSL(0.21 + (rand() - 0.5) * 0.04, 0.56 + (rand() - 0.5) * 0.10, 0.50 + (rand() - 0.5) * 0.06);
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }

  return group;
}
