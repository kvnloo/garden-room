// Voice "rearrange the plants" regression against the owner's crowded saved layout (read-only copy).
// Checks: misheard phrase alias -> suggest, honest success only with a conflict-free plan, meshes move, undo restores.
// Usage: node tests/voice_suggest.mjs [baseUrl]   Never writes the owner's state, layouts, zen or replay.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
const base = process.argv[2] || 'http://127.0.0.1:8790';
const key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
const owner = JSON.parse(fs.readFileSync(new URL('../data/state.json', import.meta.url), 'utf8'));
const rules = JSON.parse(fs.readFileSync(new URL('../data/voice/rules.json', import.meta.url), 'utf8'));
// Crowded fixture: every plant piled onto the dining table, like the owner's complaint snapshot.
const crowded = structuredClone(owner);
const table = crowded.items.find((i) => i.id === 'table');
crowded.items.filter((i) => i.kind === 'plant' && !i.box).forEach((p, n) => { p.x = table.x + ((n % 5) - 2) * 0.06; p.z = table.z + (Math.floor(n / 5) - 2) * 0.06; });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const errors = [], logged = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.route('**/api/state', (r) => r.fulfill({ json: r.request().method() === 'GET' ? crowded : { ok: true } }));
await page.route('**/api/layouts', (r) => r.fulfill({ json: r.request().method() === 'GET' ? [] : { ok: true } }));
await page.route('**/api/replay/batch', (r) => r.fulfill({ json: { ok: true } }));
await page.route('**/api/zen/progress', (r) => r.fulfill({ json: { v: 1, revision: 0 } }));
await page.route('**/api/voice/rules', (r) => r.fulfill({ json: rules }));
await page.route('**/api/voice/drive*', (r) => r.fulfill({ json: { actions: [] } }));
// The classifier picked reobserve for this utterance in the owner's session; the alias must still win.
await page.route('**/api/voice/jev', (r) => r.fulfill({ json: { selected_id: 'reobserve', confidence: 0.92 } }));
await page.route('**/api/voice/event*', (r) => { try { logged.push(r.request().postDataJSON()); } catch {} return r.fulfill({ json: { ok: true } }); });
await page.addInitScript((s) => { localStorage.clear(); localStorage.setItem('gr_state', JSON.stringify(s)); }, crowded);
const results = {};
try {
  await page.goto(`${base}/#k=${key}`);
  await page.waitForFunction(() => window.GR?.voice?.inject && window.__garden, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const hard = () => page.evaluate(() => { const g = window.__garden, e = g.evaluate(g.state.items, g.state.room, { winWeight: 0.3 }); return { overlaps: e.overlaps, spacing: e.spacingViolations, hard: e.warns.filter((w) => !w.startsWith('(soft)')).length }; });
  const before = await hard();
  assert.ok(before.overlaps > 10, 'fixture should be crowded: ' + JSON.stringify(before));
  const meshBefore = await page.evaluate(() => GR.state.items.filter((i) => i.kind === 'plant').map((i) => [i.id, GR.meshOf(i.id)?.position.x]));
  const t0 = Date.now();
  const decision = await page.evaluate(() => GR.voice.inject('Rearrange the plans for me.'));
  const ms = Date.now() - t0;
  assert.equal(decision.selected_id, 'suggest', JSON.stringify(decision));
  const after = await hard();
  const recent = await page.evaluate(() => GR.voice.recent[0]);
  if (recent.success) {
    assert.deepEqual([after.overlaps, after.spacing, after.hard], [0, 0, 0], 'claimed success with conflicts: ' + JSON.stringify(after));
    assert.match(recent.label, /^Plants rearranged\b/, 'successful action announces the applied rearrangement');
    const meshAfter = await page.evaluate(() => GR.state.items.filter((i) => i.kind === 'plant').map((i) => { const it = GR.itemById(i.id); return [i.id, GR.meshOf(i.id)?.position.x, it.x]; }));
    assert.ok(meshAfter.every(([, m, x]) => Math.abs(m - x) < 1e-6), '3D meshes follow the applied plan');
    assert.ok(meshAfter.some(([id, m]) => Math.abs(m - meshBefore.find((b) => b[0] === id)[1]) > 0.05), 'plants actually moved');
    results['misheard "rearrange the plans" applies a clear arrangement'] = `PASS ${ms}ms ${JSON.stringify(before)} -> ${JSON.stringify(after)}`;
    await page.evaluate(() => GR.voice.execute('undo'));
    const undone = await hard();
    assert.equal(undone.overlaps, before.overlaps); results['undo restores previous layout'] = 'PASS';
  } else {
    // Honest failure path: nothing moved and the error says so.
    assert.deepEqual(after, before); assert.match(recent.error || '', /nothing moved/);
    results['honest failure when no clear plan'] = `PASS ${ms}ms`;
  }
  assert.deepEqual(errors, []); results['no page errors'] = 'PASS';
} catch (error) { results.FAIL = String(error.stack || error); process.exitCode = 1; }
finally { console.log(JSON.stringify(results, null, 1)); await browser.close(); }
