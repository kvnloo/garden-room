// AR geometry + injectable XR contracts + real unsupported-camera fallback.
// All owner state and calibration API writes are intercepted. No physical XR claims.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { IN, snap, distance, calibrate, toPlan, toXR, verticalPoint, measure, photoScale, photoDistance, properties, sampleFrame, sessionOptions } from '../public/modules/ar-core.js';
const results = {};
function test(name, fn) { fn(); results[name] = 'PASS'; }
const near = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);
const point = (x, y, z) => ({ x, y, z });
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const pose = (p, matrix = identity) => ({ transform: { position: p, matrix } });
test('rigid rotation / translation / inverse (no scaling)', () => {
  const t = calibrate(point(1, -0.3, 2), point(1, -0.3, 5), [0, 0], [3, 0]);
  const p = toPlan(t, point(2, 1, 4)); near(p.x, 2); near(p.z, -1); near(p.y, 1.3);
  const v = toXR(t, p); near(v.x, 2); near(v.y, 1); near(v.z, 4);
});
test('wrong corners / floor / degenerate calibration rejected', () => {
  assert.throws(() => calibrate(point(0, 0, 0), point(0, 0, 0), [0, 0], [0, 0]));
  assert.throws(() => calibrate(point(0, 0, 0), point(1, 0, 0), [0, 0], [4, 0]));
  assert.throws(() => calibrate(point(0, 0, 0), point(3, 0.5, 0), [0, 0], [3, 0]));
});
test('half-inch snapping / 3D ruler / horizontal dimensions', () => {
  near(snap(10.26 * IN), 10.5 * IN); near(distance(point(0, 0, 0), point(3, 4, 0)), 5);
  near(measure(point(0, 1, 0), point(1, 2, 0)), snap(1));
  near(measure(point(0, 1, 0), point(1, 2, 0), true), snap(1));
});
test('vertical guide ray-line intersection and rejection', () => {
  const p = verticalPoint(point(0, 0, -2), point(0, 1.5, 0), point(0, 0.25, -1)); near(p.y, 2);
  assert.equal(verticalPoint(point(0, 0, -2), point(0, 1.5, 0), point(0, 1, 0)), null);
  assert.equal(verticalPoint(point(0, 0, -2), point(0, 1.5, 0), point(0, 0, 1)), null);
  assert.equal(verticalPoint(point(0, 0, -2), point(1, 1.5, 0), point(0, 0.25, -1)), null);
});
test('photo scale / endpoints / reference rejection', () => {
  const scale = photoScale({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.0856);
  near(photoDistance({ x: 0, y: 0 }, { x: 1000, y: 0 }, scale), snap(0.856));
  assert.throws(() => photoScale({ x: 0, y: 0 }, { x: 1, y: 0 }, 1));
});
test('plant and furniture apply schemas / incomplete rejection', () => {
  assert.deepEqual(Object.keys(properties({ kind: 'plant' }, { potD: 0.3, potH: 0.2, height: 1 })), ['potD', 'potH', 'height']);
  assert.deepEqual(Object.keys(properties({ kind: 'plant', box: true }, { w: 1, d: 0.5, potH: 0.3, height: 1 })), ['w', 'd', 'potH', 'height']);
  assert.throws(() => properties({}, { w: 1, d: 1 })); assert.throws(() => properties({}, { w: Infinity, d: 1, h: 1 }));
});
test('fake XRFrame hit-test and tracking-loss contract', () => {
  const result = { getPose: () => pose(point(1, 0, -2)) }, frame = { getViewerPose: () => pose(point(0, 1, 0)), getHitTestResults: () => [result] };
  const s = sampleFrame(frame, {}, {}); assert.equal(s.floorHit, true); near(s.hit.z, -2); near(s.ray.z, -1);
  assert.deepEqual(sampleFrame({ getViewerPose: () => null }, {}, {}), { tracked: false, hit: null });
  result.getPose = () => null; assert.equal(sampleFrame(frame, {}, {}).hit, null);
});
test('required overlay+hit-test, optional anchors+depth, no plane dependency', () => {
  const o = sessionOptions({}); assert.deepEqual(o.requiredFeatures, ['hit-test', 'dom-overlay']); assert.ok(o.optionalFeatures.includes('anchors')); assert.ok(o.optionalFeatures.includes('depth-sensing')); assert.ok(!o.requiredFeatures.includes('plane-detection'));
  assert.ok(!sessionOptions({}, false).optionalFeatures.includes('depth-sensing'));
});
const base = process.argv[2] || 'http://127.0.0.1:8790';
const key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
const out = new URL('../work/shots/', import.meta.url).pathname; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage(), errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let calibRecord = null;
await page.route('**/api/state', (r) => r.fulfill({ json: r.request().method() === 'GET' ? {} : { ok: true } }));
await page.route('**/api/ar/calib', (r) => { if (r.request().method() === 'POST') { calibRecord = r.request().postDataJSON(); return r.fulfill({ json: { ok: true } }); } return r.fulfill({ json: calibRecord }); });
await page.addInitScript(() => { localStorage.clear(); Object.defineProperty(navigator, 'xr', { configurable: true, value: { isSessionSupported: async () => false } }); });
try {
  await page.goto(`${base}/#k=${key}`); await page.waitForFunction(() => window.GR && document.querySelector('[data-panel=ar]'));
  await page.tap('[data-panel=ar]'); await page.waitForFunction(() => document.querySelector('#ar-mode').textContent.includes('PHOTO'));
  assert.equal(await page.locator('#ar-start').isDisabled(), true); assert.match(await page.locator('#ar-instruction').textContent(), /photo/i);
  await page.screenshot({ path: out + 'ar-fallback.png' }); results['real app: unsupported AR clearly labelled, no camera permission'] = 'PASS';
  // Explicitly generated test calibration chart; never presented as camera evidence.
  const chart = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 1200; c.height = 800; const x = c.getContext('2d'); x.fillStyle = '#d9d2bb'; x.fillRect(0, 0, 1200, 800); x.fillStyle = '#4b6253'; x.fillRect(300, 220, 600, 360); x.fillStyle = '#eee5d1'; x.fillRect(80, 620, 100, 62); x.fillStyle = '#272a22'; x.font = '28px sans-serif'; x.fillText('TEST CHART · known reference', 40, 60); return c.toDataURL().split(',')[1]; });
  await page.setInputFiles('#ar-file', { name: 'test-chart.png', mimeType: 'image/png', buffer: Buffer.from(chart, 'base64') });
  await page.waitForFunction(() => !document.querySelector('#ar-photo-canvas').hidden);
  async function photoTap(x, y) { const p = await page.evaluate(({ x, y }) => { const c = document.querySelector('#ar-photo-canvas'), r = c.getBoundingClientRect(), f = Math.min(r.width / c.width, r.height / c.height); return { x: r.left + (r.width - c.width * f) / 2 + x * f, y: r.top + (r.height - c.height * f) / 2 + y * f }; }, { x, y }); await page.mouse.click(p.x, p.y); }
  await photoTap(80, 620); await photoTap(180, 620); assert.match(await page.locator('#ar-photo-status').textContent(), /Reference:/);
  await photoTap(300, 220); await photoTap(900, 220); assert.match(await page.locator('#ar-segments').textContent(), /Total/);
  await page.tap('#ar-undo'); assert.match(await page.locator('#ar-segments').textContent(), /No segments/); await page.tap('#ar-clear');
  results['photo ruler: image, aspect-correct reference, polyline, undo, clear'] = 'PASS';
  await page.tap('[data-tool=measure]'); await page.selectOption('#ar-item', 'p02');
  for (const [dim, x2, y2] of [['potD', 900, 220], ['potH', 300, 580], ['height', 300, 720]]) { await page.tap(`[data-dimension=${dim}]`); await photoTap(300, 220); await photoTap(x2, y2); }
  assert.equal(await page.locator('#ar-apply').isEnabled(), true); await page.tap('#ar-apply');
  const plant = await page.evaluate(() => { const p = GR.itemById('p02'); return { potD: p.potD, potH: p.potH, height: p.height }; }); near(plant.potD, snap(0.5136), IN / 2 + 1e-6); near(plant.potH, snap(0.30816), IN / 2 + 1e-6); near(plant.height, snap(0.428), IN / 2 + 1e-6);
  await page.screenshot({ path: out + 'ar-photo-measure.png' }); results['photo measurement applies snapped plant dimensions through real GR'] = 'PASS';
  await page.setViewportSize({ width: 360, height: 800 }); await page.screenshot({ path: out + 'ar-photo-narrow.png' });
  assert.equal(await page.evaluate(() => document.querySelector('.ar-bottom').scrollWidth <= document.querySelector('.ar-bottom').clientWidth), true);
  await page.tap('#ar-close'); await page.evaluate(() => GR.select('p02')); await page.getByRole('button', { name: 'Measure in AR', exact: true }).click();
  assert.equal(await page.locator('#ar-item').inputValue(), 'p02'); results['item sheet action and 360px phone layout'] = 'PASS';
  assert.deepEqual(errors, []); results['real app fallback has no JS errors'] = 'PASS';

  // Isolated host adapter: real module + real three.js geometry, fake XR renderer/session.
  const fake = await ctx.newPage(); const fakeErrors = []; fake.on('pageerror', (e) => fakeErrors.push(String(e)));
  await fake.route('**/ar-fixture', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en" data-zeros-theme="living-night" data-zeros-lens="garden"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/vendor/fonts/hanken-grotesk/400.css"><link rel="stylesheet" href="/vendor/fonts/cormorant-garamond/500.css"><link rel="stylesheet" href="/zeros/tokens.css"><link rel="stylesheet" href="/zeros/product-bridge.css"><link rel="stylesheet" href="/style.css"><script type="importmap">{"imports":{"three":"/vendor/three/build/three.module.js"}}</script>' }));
  await fake.goto(`${base}/ar-fixture`);
  await fake.evaluate(async () => {
    localStorage.clear(); const T = await import('three'), mod = await import('/modules/ar.js');
    const scene = new T.Scene(), camera = new T.PerspectiveCamera(70, innerWidth / innerHeight, .01, 40), ref = new EventTarget();
    window.fake = { ticks: 0, sample: { x: 0, y: 0, z: 0 }, tracked: true, anchors: [], stored: null, pose: { x: 0, y: 1.5, z: 1 }, ray: { x: 0, y: 0, z: -1 }, lostAnchor: false, vibration: 0, hooks: [] };
    class Session extends EventTarget { visibilityState = 'visible'; domOverlayState = { type: 'screen' }; depthUsage = 'cpu-optimized'; async requestReferenceSpace() { return ref; } async requestHitTestSource() { return { cancel() { window.fake.cancelled = true; } }; } async end() { this.dispatchEvent(new Event('end')); } async restorePersistentAnchor(h) { return window.fake.anchors.find((a) => a.handle === h); } }
    const s = new Session(); window.fake.session = s;
    Object.defineProperty(navigator, 'xr', { configurable: true, value: { isSessionSupported: async () => true, requestSession: async (_mode, opts) => { window.fake.options = { required: opts.requiredFeatures, optional: opts.optionalFeatures }; const next = new Session(); window.fake.session = next; return next; } } });
    Object.defineProperty(navigator, 'vibrate', { value: () => { window.fake.vibration++; return true; }, configurable: true });
    class Renderer { constructor() { this.xr = { enabled: false, setReferenceSpaceType() {}, async setSession() {}, getReferenceSpace: () => ref, getCamera: () => camera }; } setPixelRatio() {} setSize() {} setClearColor() {} setAnimationLoop(fn) { window.fake.loop = fn; } render() {} }
    const items = [{ id: 'chair', name: 'Chair', w: .5, d: .5, h: 1, x: 1, z: 1, rot: 0 }, { id: 'plant', name: 'Plant', kind: 'plant', w: .3, d: .3, h: 1, potD: .3, potH: .2, height: .8, x: 2, z: 1, rot: 0 }];
    const GR = { THREE: { ...T, WebGLRenderer: Renderer }, scene, camera, state: { room: { poly: [[0, 0], [3, 0], [3, 3], [0, 3]] }, items }, ICON: { scan: '' }, itemById: (id) => items.find((i) => i.id === id), footprint: (it) => ({ x0: it.x - it.w / 2, x1: it.x + it.w / 2, z0: it.z - it.d / 2, z1: it.z + it.d / 2 }), closeSheet() {}, api: async (_p, opts) => { if (opts) { window.fake.stored = JSON.parse(opts.body); return { ok: true }; } return window.fake.stored; }, toast() {}, onFrame: (fn) => window.fake.hooks.push(fn), addDock: (d) => window.fake.open = d.open, addItemAction() {}, setProps: (id, props) => { Object.assign(items.find((i) => i.id === id), props); window.fake.applied = props; return true; }, moveItem: (id, x, z) => { Object.assign(items.find((i) => i.id === id), { x, z }); window.fake.moved = { id, x, z }; } };
    window.fake.ref = ref; window.fake.scene = scene;
    window.fake.tick = (sample, extra = {}) => {
      Object.assign(window.fake, extra); window.fake.sample = sample;
      const f = window.fake, matrix = new T.Matrix4().identity().toArray(); matrix[8] = -f.ray.x; matrix[9] = -f.ray.y; matrix[10] = -f.ray.z;
      const transform = (p) => ({ transform: { position: p, matrix: new T.Matrix4().makeTranslation(p.x, p.y, p.z).toArray() } });
      const frame = { getViewerPose: () => f.tracked ? { transform: { position: f.pose, matrix }, views: f.depthView ? [{ projectionMatrix: camera.projectionMatrix.toArray(), transform: { matrix: new T.Matrix4().makeTranslation(f.pose.x, f.pose.y, f.pose.z).toArray() } }] : [{}] } : null,
        getHitTestResults: () => sample ? [{ getPose: () => transform(sample), createAnchor: () => { const a = { anchorSpace: { p: { ...sample } }, handle: `anchor-${f.anchors.length}`, requestPersistentHandle: async function () { return this.handle; }, delete() {} }; f.anchors.push(a); return Promise.resolve(a); } }] : [],
        getPose: (as) => f.lostAnchor ? null : transform(as.p), getDepthInformation: () => ({ getDepthInMeters: () => 2.5 }) };
      f.loop?.(++f.ticks * 200, frame); f.hooks.forEach((fn) => fn());
    };
    mod.init(GR); await window.fake.open();
  });
  await fake.tap('#ar-start'); await fake.waitForFunction(() => window.fake.loop);
  await fake.selectOption('#ar-corner-b', '1');
  const tick = (p, extra = {}) => fake.evaluate(({ p, extra }) => window.fake.tick(p, extra), { p, extra });
  async function place(p, extra = {}) { await tick(p, extra); await fake.tap('#ar-place'); await tick(p, extra); await fake.waitForTimeout(30); }
  await place({ x: 0, y: 0, z: 0 }); await place({ x: 3, y: 0, z: 0 }); await tick({ x: 1, y: 0, z: 0 });
  assert.match(await fake.locator('#ar-tracking').textContent(), /aligned/);
  const record = await fake.evaluate(() => window.fake.stored); assert.equal(record.anchorHandles.length, 2); assert.ok(record.anchorHandles.every(Boolean));
  await fake.check('#ar-footprints'); await tick({ x: 1, y: 0, z: 0 }); assert.match(await fake.locator('#ar-mode').textContent(), /DEPTH AVAILABLE/);
  assert.equal(await fake.evaluate(() => window.fake.scene.children.at(-1).visible), true);
  await tick(null, { tracked: false }); assert.equal(await fake.locator('#ar-place').isDisabled(), true); assert.equal(await fake.evaluate(() => window.fake.scene.children.at(-1).visible), false);
  await tick({ x: 1, y: 0, z: 0 }, { tracked: true, lostAnchor: true }); assert.match(await fake.locator('#ar-tracking').textContent(), /anchors lost/);
  await tick({ x: 1, y: 0, z: 0 }, { lostAnchor: false });
  await fake.screenshot({ path: out + 'ar-fake-oriented.png' }); results['fake XR: two-corner calibration, anchor persistence, pose, depth, tracking loss'] = 'PASS';
  await fake.check('#ar-correct');
  const mapBox = await fake.locator('#ar-map').boundingBox();
  const mx = mapBox.x + 145 / 360 * mapBox.width, my = mapBox.y + 100 / 270 * mapBox.height;
  await fake.mouse.move(mx, my); await fake.mouse.down(); await fake.mouse.move(mx + 20, my + 10); await fake.mouse.up();
  assert.equal((await fake.evaluate(() => window.fake.moved)).id, 'chair'); results['fake XR: mini-plan drag corrects unlocked footprints through GR.moveItem'] = 'PASS';
  await fake.tap('[data-tool=measure]');
  for (const dim of ['w', 'd']) { await fake.tap(`[data-dimension=${dim}]`); await place({ x: 0, y: 0, z: -2 }); await place({ x: dim === 'w' ? .514 : 0, y: 0, z: dim === 'd' ? -2.75 : -2 }); }
  await fake.tap('[data-dimension=h]'); await place({ x: 0, y: 0, z: -2 });
  await place(null, { pose: { x: 0, y: 1.5, z: 0 }, ray: { x: 0, y: .25, z: -1 } });
  await fake.tap('#ar-apply'); const applied = await fake.evaluate(() => window.fake.applied); near(applied.w, snap(.514)); near(applied.d, snap(.75)); near(applied.h, snap(2));
  results['fake XR: width, depth, vertical height, snapped assignment'] = 'PASS';
  await fake.tap('[data-tool=ruler]'); await place({ x: 0, y: 0, z: -2 }); await place({ x: 1, y: 0, z: -2 }); await place({ x: 1, y: 1, z: -2 });
  assert.match(await fake.locator('#ar-segments').textContent(), /Total/); assert.equal(await fake.locator('.ar-segment-label').count(), 2);
  await fake.tap('#ar-undo'); assert.equal(await fake.locator('.ar-segment-label').count(), 1); await fake.tap('#ar-clear'); assert.equal(await fake.locator('.ar-segment-label').count(), 0); assert.ok(await fake.evaluate(() => window.fake.vibration) >= 10);
  results['fake XR: multi-point ruler, labels, undo, clear, haptics'] = 'PASS';
  await place(null, { depthView: true, pose: { x: 0, y: 1.5, z: 1 }, ray: { x: 0, y: 0, z: -1 } });
  await place(null, { pose: { x: 1, y: 1.5, z: 1 } });
  assert.match(await fake.locator('#ar-mode').textContent(), /DEPTH ESTIMATE/); assert.match(await fake.locator('#ar-segments').textContent(), /39.4/);
  results['fake XR: optional depth reconstructs centre-view points without hit results'] = 'PASS';
  await fake.tap('#ar-end'); await fake.tap('#ar-start'); await fake.waitForFunction(() => window.fake.loop); await tick({ x: 0, y: 0, z: -2 }, { depthView: false });
  assert.match(await fake.locator('#ar-tracking').textContent(), /aligned/); results['fake XR: persistent handles restore and recompute transform in next session'] = 'PASS';
  await fake.evaluate(() => window.fake.ref.dispatchEvent(new Event('reset'))); await tick({ x: 0, y: 0, z: -2 }); assert.match(await fake.locator('#ar-tracking').textContent(), /not aligned/);
  await fake.tap('#ar-end'); assert.equal(await fake.evaluate(() => window.fake.cancelled), true); assert.match(await fake.locator('#ar-mode').textContent(), /CAMERA TOOLS/);
  assert.deepEqual(fakeErrors, []); results['fake XR: origin reset invalidates alignment; session cleanup; no JS errors'] = 'PASS';
} finally { await browser.close(); }
console.log(JSON.stringify(results, null, 2));
