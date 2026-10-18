// Isolated phone journeys. Saved room AND saved care journal never receive test writes.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { condition, DAY, dayKey, freshProgress, level, mergeProgress, performCare, quests, visit, waterDays } from '../public/modules/zen-core.js';

const base = process.argv[2] || 'http://127.0.0.1:8790';
const out = new URL('../work/zen/', import.meta.url).pathname; fs.mkdirSync(out, { recursive: true });
const key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
const results = {};
function test(name, fn) { try { fn(); results[name] = 'PASS'; } catch (e) { results[name] = `FAIL ${e.message}`; } }
const now = new Date(2026, 9, 18, 12).getTime(), plant = { id: 'basil', name: 'Basil', family: 'flowering_basil', kind: 'plant', _sat: 1, x: 1, z: 1 };
test('family intervals aloe > basil', () => assert(waterDays({ family: 'aloe' }) > waterDays(plant)));
test('health bounds, light and crowding', () => { const p = freshProgress(); performCare(p, plant, 'water', now); performCare(p, plant, 'feed', now); assert.equal(condition(plant, p, [], now).health, 100); assert.equal(condition(plant, p, ['Basil overlaps Pepper'], now).health, 80); assert.equal(condition({ ...plant, _sat: 0 }, p, [], now).health, 45); });
test('water cooldown prevents coin farming', () => { const p = freshProgress(); assert(performCare(p, plant, 'water', now).ok); const coins = p.coins; assert(!performCare(p, plant, 'water', now + 1).ok); assert.equal(p.coins, coins); assert(performCare(p, plant, 'water', now + 2 * DAY).ok); });
test('all five moods and true sleepy night', () => { const p = freshProgress(); assert.equal(condition(plant, p, [], now).mood, 'thirsty'); performCare(p, plant, 'water', now); assert.equal(condition(plant, p, [], now).mood, 'happy'); assert.equal(condition(plant, p, [], now, true).mood, 'sleepy'); assert.equal(condition({ ...plant, _sat: 0.5 }, p, [], now).mood, 'content'); assert.equal(condition({ ...plant, _sat: 0 }, p, [], now).mood, 'sad'); });
test('care never repairs planner light or overlap', () => { const p = freshProgress(), it = { ...plant, _sat: .2 }; performCare(p, it, 'water', now); performCare(p, it, 'trim', now); const c = condition(it, p, ['Basil overlaps Pepper'], now); assert.equal(c.sat, .2); assert(c.crowded); assert(c.health < 60); });
test('daily water targets and rollover', () => { const p = freshProgress(); visit(p, [plant], now); performCare(p, plant, 'water', now); assert(quests(p, [plant], now)[0].done); p.days[dayKey(now)].claims.push('water'); const next = visit(p, [plant], now + DAY); assert.equal(p.streak, 2); assert.equal(next.claims.length, 0); visit(p, [plant], now + 3 * DAY); assert.equal(p.streak, 1); });
test('level progress and care journal cap', () => { assert.equal(level(60).n, 2); const p = freshProgress(); for (let i = 0; i < 140; i++) performCare(p, { ...plant, id: `p${i}` }, 'water', now); assert.equal(p.log.length, 128); });
test('conflict merge preserves both care histories', () => { const a = freshProgress(), b = freshProgress(); performCare(a, plant, 'water', now); performCare(b, { ...plant, id: 'other' }, 'feed', now); b.revision = 3; const c = mergeProgress(a, b); assert(c.care.basil.watered); assert(c.care.other.fed); assert.equal(c.revision, 3); assert.equal(c.log.length, 2); });

const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true });
let saved = freshProgress(), writes = 0, offline = false;
await context.route('**/api/state', (r) => r.fulfill({ json: r.request().method() === 'GET' ? {} : { ok: true } }));
await context.route('**/api/zen/progress', async (r) => {
  if (offline) return r.fulfill({ status: 503, json: { error: 'Test offline' } });
  if (r.request().method() === 'GET') return r.fulfill({ json: saved });
  const p = r.request().postDataJSON();
  if (p.revision !== saved.revision) return r.fulfill({ status: 409, json: { progress: saved } });
  saved = { ...p, revision: saved.revision + 1 }; writes++; return r.fulfill({ json: { ok: true, revision: saved.revision } });
});
const page = await context.newPage(), errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error' && !/\b(503|409)\b/.test(m.text())) errors.push(m.text()); });
const check = (name, value) => { results[name] = value ? 'PASS' : 'FAIL'; };
try {
  await page.goto(`${base}/#k=${key}`);
  await page.waitForFunction(() => window.GR?.zen && GR.state.items.length, null, { timeout: 40000 });
  await page.waitForTimeout(3300);
  const gpu = await page.evaluate(() => { const gl = GR.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unavailable', version: gl.getParameter(gl.VERSION), calls: GR.renderer.info.render.calls }; });
  fs.writeFileSync(out + 'gpu.json', JSON.stringify(gpu, null, 2));
  check('real hardware WebGL renderer', !/swiftshader|llvmpipe|software|unavailable/i.test(gpu.renderer));
  await page.screenshot({ path: out + '01-room-phone.png' });
  check('25 health values and public API', await page.evaluate(() => { const ps = GR.state.items.filter((it) => it.kind === 'plant'); return ps.length === 25 && ps.every((it) => GR.zen.health(it.id) >= 0 && GR.zen.health(it.id) <= 100) && typeof GR.zen.care === 'function'; }));
  await page.tap('#zen-summary');
  await page.waitForSelector('#zen-panel');
  await page.screenshot({ path: out + '02-zen-quests.png' });
  check('quests, roster and level render', await page.locator('.zen-quest').count() === 3 && await page.locator('.zen-plant').count() === 25);
  check('phone sheet has no horizontal overflow', await page.evaluate(() => { const s = document.querySelector('#sheet'); return s.scrollWidth <= s.clientWidth + 1; }));
  const before = await page.evaluate(() => ({ coins: GR.zen.progress.coins, xp: GR.zen.progress.xp, state: JSON.stringify(GR.state.items) }));
  await page.locator('.zen-next').first().tap();
  await page.waitForTimeout(200);
  const careResult = await page.evaluate(() => { const id = GR.state.items.find((it) => it.kind === 'plant').id; return { id, coins: GR.zen.progress.coins, xp: GR.zen.progress.xp, care: GR.zen.progress.care[id], state: JSON.stringify(GR.state.items), repeat: GR.zen.care(id, 'water'), sound: GR.zen.soundState }; });
  check('care gives coins XP and water log', careResult.coins > before.coins && careResult.xp > before.xp && careResult.care.watered > 0);
  check('care leaves saved room untouched', careResult.state === before.state);
  check('repeated water gets no reward', !careResult.repeat.ok);
  check('quiet synthesized sound starts on gesture', careResult.sound.state === 'running' && careResult.sound.volume <= .04);
  await page.tap('#zen-sound');
  check('mute accessible and persists locally', await page.evaluate(() => GR.zen.soundState.muted && document.querySelector('#zen-sound').getAttribute('aria-pressed') === 'true' && JSON.parse(localStorage.getItem('gr_zen_v1')).muted));
  await page.evaluate(() => GR.zen.flush());
  check('server readback matches care journal', saved.care[careResult.id]?.watered === careResult.care.watered && writes > 0);
  await page.screenshot({ path: out + '03-zen-roster.png' });
  await page.reload(); await page.waitForFunction(() => window.GR?.zen, null, { timeout: 40000 });
  check('reload restores progress and mute', await page.evaluate((id) => !!GR.zen.progress.care[id]?.watered && GR.zen.soundState.muted, careResult.id));
  await page.evaluate(() => GR.zen.open());
  const other = await page.evaluate(() => GR.state.items.filter((it) => it.kind === 'plant')[1].id);
  offline = true;
  await page.evaluate((id) => GR.zen.care(id, 'water'), other);
  await page.evaluate(() => GR.zen.flush());
  check('offline care is retained locally', await page.evaluate((id) => !!JSON.parse(localStorage.getItem('gr_zen_v1')).care[id]?.watered, other));
  offline = false; await page.evaluate(() => GR.zen.flush());
  check('offline care syncs on retry', !!saved.care[other]?.watered);
  // Simulate a second authenticated tab saving between this tab's GET and PUT.
  saved = { ...saved, revision: saved.revision + 1, care: { ...saved.care, 'other-tab': { checked: Date.now() } } };
  await page.evaluate((id) => GR.zen.care(id, 'trim'), other);
  await page.evaluate(() => GR.zen.flush());
  check('revision conflict merges without losing care logs', !!saved.care['other-tab']?.checked && !!saved.care[other]?.trimmed);
  const gain = await page.evaluate(() => { GR.closeSheet(); const it = GR.state.items.find((it) => it.kind === 'plant'); it.x += .15; GR.rescore(); return it.id; });
  await page.waitForTimeout(2200);
  check('arrangement quest follows actual plant move', await page.evaluate(() => GR.zen.progress.days[Object.keys(GR.zen.progress.days).sort().at(-1)].arranged));
  await page.evaluate(() => GR.zen.open());
  const claim = page.locator('[data-claim=arrange]'); await claim.tap();
  check('quest can be claimed only once', await claim.isDisabled());
  await page.evaluate(() => GR.closeSheet());
  const bubble = await page.evaluate(() => {
    const pool = GR.scene.getObjectByName('Zen pooled billboards').children[0], matrix = new GR.THREE.Matrix4(), v = new GR.THREE.Vector3();
    return GR.state.items.filter((it) => it.kind === 'plant').map((it, i) => {
      pool.getMatrixAt(i * 2 + 1, matrix); v.setFromMatrixPosition(matrix).project(GR.camera);
      return { id: it.id, x: (v.x + 1) * innerWidth / 2, y: (1 - v.y) * innerHeight / 2, active: matrix.elements[0] !== 0 };
    }).filter((b) => b.active && b.x > 80 && b.x < innerWidth - 75 && b.y > 220 && b.y < innerHeight - 180).sort((a, b) => b.x - a.x)[0];
  });
  assert(bubble, 'A visible bubble must be available');
  const logBeforeBubble = await page.evaluate(() => GR.zen.progress.log.length);
  await page.touchscreen.tap(bubble.x, bubble.y);
  await page.waitForTimeout(100);
  await page.screenshot({ path: out + '03b-watering-pour.png' });
  check('real thought-bubble tap performs care', await page.evaluate((n) => GR.zen.progress.log.length === n + 1, logBeforeBubble));
  // Every animation is enabled; new care actions keep pour, coin and sparkle pools active.
  await page.evaluate(() => {
    const ps = GR.state.items.filter((it) => it.kind === 'plant');
    for (const it of ps.slice(0, 12)) { GR.zen.care(it.id, 'water'); GR.zen.care(it.id, 'feed'); }
    GR.zen.setAnimations(true);
  });
  const measure = async (on) => page.evaluate(async (on) => {
    GR.zen.setAnimations(on); await new Promise((r) => setTimeout(r, 500));
    const m = GR.zen.metrics, frames = m.frames, cpu = m.cpuMs;
    const samples = [], start = performance.now(); let previous = start, nextCare = 12;
    const careTimer = on ? setInterval(() => { const it = GR.state.items.filter((it) => it.kind === 'plant')[nextCare++]; if (it) { GR.zen.care(it.id, 'water'); GR.zen.care(it.id, 'feed'); } }, 350) : null;
    await new Promise((resolve) => { const frame = (t) => { samples.push(t - previous); previous = t; if (t - start >= 5000) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
    clearInterval(careTimer);
    const sorted = [...samples].sort((a, b) => a - b);
    return { seconds: (previous - start) / 1000, frames: samples.length, avgFrameMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95FrameMs: sorted[Math.floor(sorted.length * .95)], zenCpuMs: (m.cpuMs - cpu) / (m.frames - frames), renderCalls: GR.renderer.info.render.calls };
  }, on);
  const enabled = await measure(true), disabled = await measure(false);
  await page.evaluate(() => GR.zen.setAnimations(true));
  await page.waitForTimeout(3200);
  await page.screenshot({ path: out + '04-happy-room.png' });
  fs.writeFileSync(out + 'performance.json', JSON.stringify({ scope: 'Desktop hardware Chromium, phone viewport; not a physical-phone benchmark. Disabled comparison keeps mood billboards, disables moving FX.', gpu, enabled, disabled, addedFrameMs: enabled.avgFrameMs - disabled.avgFrameMs }, null, 2));
  check('Zen CPU callback below 1ms', enabled.zenCpuMs < 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // A fresh context proves the initial media preference, not a test-only override.
  const reduced = await context.newPage(); await reduced.emulateMedia({ reducedMotion: 'reduce' }); await reduced.goto(`${base}/#k=${key}`); await reduced.waitForFunction(() => window.GR?.zen, null, { timeout: 40000 });
  check('reduced motion disables animated effects by default', await reduced.evaluate(() => !GR.zen.animations)); await reduced.close();
  await page.setViewportSize({ width: 360, height: 800 }); await page.evaluate(() => GR.zen.open()); await page.waitForTimeout(300);
  await page.screenshot({ path: out + '05-zen-360.png' });
  check('360px sheet has no horizontal overflow', await page.evaluate(() => { const s = document.querySelector('#sheet'); return s.scrollWidth <= s.clientWidth + 1; }));
  await page.setViewportSize({ width: 1024, height: 768 }); await page.evaluate(() => GR.closeSheet()); await page.waitForTimeout(300);
  await page.screenshot({ path: out + '06-room-tablet.png' });
  check('no browser or shader errors', errors.length === 0);
} catch (e) { results['journey completes'] = `FAIL ${e.stack}`; }
finally {
  fs.writeFileSync(out + 'results.json', JSON.stringify({ results, errors, writes }, null, 2));
  console.log(JSON.stringify({ results, errors, writes }, null, 2));
  await browser.close();
}
process.exit(Object.values(results).every((r) => r === 'PASS') ? 0 : 1);
