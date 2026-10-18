// Pure metre-space geometry, shared by the live XR adapter and fake-XR tests.
export const IN = 0.0254;
export const snap = (m) => Math.round(m / (IN / 2)) * IN / 2;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const units = (m) => `${(m / IN).toFixed(1)}″ · ${(m * 100).toFixed(1)} cm`;
export function calibrate(a, b, p, q) {
  const ar = horizontal(a, b), plan = Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (ar < 0.3 || plan < 0.3) throw new Error('Choose two different corners, at least 12 inches apart.');
  const error = Math.abs(ar - plan);
  if (error > Math.max(0.12, plan * 0.08)) throw new Error(`Corners disagree by ${units(error)}. Retap the exact floor corners.`);
  if (Math.abs(a.y - b.y) > 0.12) throw new Error('Both corners must be on the same floor.');
  const angle = Math.atan2(q[1] - p[1], q[0] - p[0]) - Math.atan2(b.z - a.z, b.x - a.x);
  const c = Math.cos(angle), s = Math.sin(angle);
  // Rigid transform, never scale XR metres to hide a wrong correspondence.
  return { angle, tx: p[0] - c * a.x + s * a.z, tz: p[1] - s * a.x - c * a.z, floor: (a.y + b.y) / 2, error };
}
export function toPlan(t, v) {
  const c = Math.cos(t.angle), s = Math.sin(t.angle);
  return { x: c * v.x - s * v.z + t.tx, z: s * v.x + c * v.z + t.tz, y: v.y - t.floor };
}
export function toXR(t, v) {
  const c = Math.cos(t.angle), s = Math.sin(t.angle), x = v.x - t.tx, z = v.z - t.tz;
  return { x: c * x + s * z, z: -s * x + c * z, y: (v.y || 0) + t.floor };
}
export function direction(matrix) { return { x: -matrix[8], y: -matrix[9], z: -matrix[10] }; }
// Closest point between the centre-view ray and a world-up line through base.
export function verticalPoint(base, origin, ray) {
  const h2 = ray.x * ray.x + ray.z * ray.z;
  if (h2 < 0.015) return null;
  const t = ((base.x - origin.x) * ray.x + (base.z - origin.z) * ray.z) / h2;
  if (t <= 0 || t > 12) return null;
  const miss = Math.hypot(origin.x + t * ray.x - base.x, origin.z + t * ray.z - base.z);
  if (miss > 0.15) return null;
  const y = origin.y + t * ray.y;
  if (y < base.y || y - base.y > 6) return null;
  return { x: base.x, y, z: base.z };
}
export function measure(a, b, vertical = false) { return snap(vertical ? Math.abs(b.y - a.y) : horizontal(a, b)); }
export function photoScale(a, b, reference) {
  const px = Math.hypot(b.x - a.x, b.y - a.y);
  if (px < 8 || !(reference > 0 && reference < 10)) throw new Error('Reference must span at least 8 pixels and have a known positive size.');
  return reference / px;
}
export function photoDistance(a, b, scale) { return snap(Math.hypot(b.x - a.x, b.y - a.y) * scale); }
export function properties(item, values) {
  const keys = item.kind === 'plant' && !item.box ? ['potD', 'potH', 'height'] : item.kind === 'plant' ? ['w', 'd', 'potH', 'height'] : ['w', 'd', 'h'];
  if (!keys.every((k) => Number.isFinite(values[k]) && values[k] >= IN / 2 && values[k] <= 10)) throw new Error('Measure every dimension before applying (½ inch to 10 metres).');
  return Object.fromEntries(keys.map((k) => [k, snap(values[k])]));
}
// This adapter consumes actual XRFrame contracts; tests inject the same contract.
export function sampleFrame(frame, space, source) {
  const pose = frame.getViewerPose(space);
  if (!pose) return { tracked: false, hit: null };
  const origin = pose.transform.position, ray = direction(pose.transform.matrix);
  const result = source ? frame.getHitTestResults(source)[0] : null;
  const hitPose = result?.getPose(space);
  return { tracked: true, pose, origin, ray, result: hitPose ? result : null,
    hit: hitPose ? { x: hitPose.transform.position.x, y: hitPose.transform.position.y, z: hitPose.transform.position.z } : null,
    // Y basis is the surface normal: calibration accepts horizontal floor only.
    floorHit: !!hitPose && Math.abs(hitPose.transform.matrix[5]) > 0.9 && hitPose.transform.position.y < origin.y - 0.1 };
}
export function sessionOptions(root, extras = true) {
  return { requiredFeatures: ['hit-test', 'dom-overlay'], optionalFeatures: extras ? ['anchors', 'depth-sensing', 'local-floor'] : ['anchors', 'local-floor'],
    domOverlay: { root }, ...(extras ? { depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['float32', 'luminance-alpha'] } } : {}) };
}
