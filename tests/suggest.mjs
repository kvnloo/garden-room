// Suggest panel regression: suggestions survive closing/reopening and tab switches,
// and Use / Load actually rebuild the 3D room (meshes move), not just the data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:8790';
const key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
const current = JSON.parse(fs.readFileSync(new URL('../data/state.json', import.meta.url), 'utf8'));
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
let layouts = [];
await page.route('**/api/state', (r) => r.fulfill({ json: r.request().method() === 'GET' ? {} : { ok: true } }));
await page.route('**/api/layouts', (r) => { if (r.request().method() === 'PUT') { layouts = JSON.parse(r.request().postData()); return r.fulfill({ json: { ok: true } }); } r.fulfill({ json: layouts }); });
await page.route('**/api/replay/batch', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/zen/progress', (r) => r.fulfill({ json: { v: 1, revision: 0 } }));
await page.addInitScript((s) => { if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1'); localStorage.clear(); localStorage.setItem('gr_state', JSON.stringify(s)); }, current);
const results = {};
const meshPos = () => page.evaluate(() => GR.state.items.filter((i) => i.kind === 'plant').map((i) => { const g = GR.meshOf(i.id); return [i.id, +i.x.toFixed(3), +i.z.toFixed(3), g ? +g.position.x.toFixed(3) : null, g ? +g.position.z.toFixed(3) : null]; }));
try {
  await page.goto(`${base}/#k=${key}`);
  await page.waitForFunction(() => window.GR && document.querySelector('[data-panel=suggest]'), null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.click('[data-panel=suggest]');
  await page.click('#sGo');
  await page.waitForFunction(() => document.querySelectorAll('#sOut button[data-i]').length === 3 && !document.querySelector('#sGo').disabled, null, { timeout: 120000 });
  results['three suggestions generated'] = 'PASS';
  // leave and come back: via tab switch, then via closing the sheet and reopening the dock entry
  await page.click('[data-panel=layouts]'); await page.waitForSelector('#backSuggest'); await page.click('#backSuggest'); await page.waitForTimeout(300);
  assert.equal(await page.locator('#sOut button[data-i]').count(), 3);
  await page.evaluate(() => GR.closeSheet()); await page.click('[data-panel=suggest]');
  assert.equal(await page.locator('#sOut button[data-i]').count(), 3);
  await page.reload(); await page.waitForFunction(() => window.GR && document.querySelector('[data-panel=suggest]'), null, { timeout: 60000 });
  await page.click('[data-panel=suggest]');
  assert.equal(await page.locator('#sOut button[data-i]').count(), 3);
  results['suggestions survive tab switch, close/reopen and reload'] = 'PASS';
  await page.evaluate(() => { for (const it of GR.state.items) if (it.kind === 'plant') { it.x += 0.07; } GR.rescore(); });
  const before = await meshPos();
  const target = await page.evaluate(() => JSON.parse(localStorage.getItem('gr_suggestions'))[0].items.filter((i) => i.kind === 'plant').map((i) => [i.id, +i.x.toFixed(3), +i.z.toFixed(3)]));
  const enabled = page.locator('#sOut button[data-i]:not([disabled])').first();
  assert.ok(await enabled.count(), 'at least one applicable suggestion');
  const idx = +(await enabled.getAttribute('data-i'));
  await enabled.click(); await page.waitForTimeout(500);
  const after = await meshPos();
  const want = await page.evaluate((i) => JSON.parse(localStorage.getItem('gr_suggestions'))[i].items.filter((x) => x.kind === 'plant').map((x) => [x.id, +x.x.toFixed(3), +x.z.toFixed(3)]), idx);
  for (const [id, x, z] of want) { const m = after.find((a) => a[0] === id); assert.ok(m, id); assert.equal(m[1], x); assert.equal(m[2], z); assert.ok(m[3] !== null && Math.abs(m[3] - x) < 1e-3 && Math.abs(m[4] - z) < 1e-3, `mesh ${id} moved to its new spot`); }
  assert.notDeepEqual(before.map((b) => b.slice(1, 3)), after.map((a) => a.slice(1, 3)), 'layout changed');
  results['Use updates state AND moves the 3D meshes'] = 'PASS';
  void target;
  // saved layout load also rebuilds meshes
  await page.click('[data-panel=layouts]'); await page.waitForSelector('#lSave');
  await page.fill('#lName', 'probe'); await page.click('#lSave'); await page.waitForSelector('[data-load="0"]');
  await page.evaluate(() => { for (const it of GR.state.items) if (it.kind === 'plant') { it.x += 0.01; } GR.rebuildItem && 0; });
  await page.click('[data-load="0"]'); await page.waitForTimeout(500);
  const loaded = await meshPos();
  for (const m of loaded) assert.ok(Math.abs(m[1] - m[3]) < 1e-3 && Math.abs(m[2] - m[4]) < 1e-3);
  results['Load rebuilds meshes to the saved positions'] = 'PASS';
  assert.deepEqual(errors, []); results['no page errors'] = 'PASS';
} catch (e) { results.FAIL = String(e.stack || e).slice(0, 600); process.exitCode = 1; }
console.log(JSON.stringify(results, null, 1));
await browser.close();
