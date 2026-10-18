// Phone smoke test: S25-Ultra-sized touch viewport against the running server.
// Usage: node tests/phone.mjs [baseUrl]   (screenshots -> work/shots/)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const base = process.argv[2] || 'http://127.0.0.1:8790';
const key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
const out = new URL('../work/shots/', import.meta.url).pathname; fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S938U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Mobile Safari/537.36' });
const page = await ctx.newPage();
const errors = [], failed = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
page.on('requestfailed', (r) => failed.push(r.url()));
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
const results = {};
// isolate from the owner's saved layout: start from photo defaults, never write back
await page.route('**/api/state', (r) => r.request().method() === 'GET' ? r.fulfill({ json: {} }) : r.fulfill({ json: { ok: true } }));
await page.route('**/api/layouts', (r) => r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.fulfill({ json: { ok: true } }));
// Replay is tested by its own suite; do not record synthetic phone gestures into owner history.
await page.route('**/api/replay/batch', (r) => r.fulfill({ json: { ok: true } }));
// Zen's onboarding also persists; keep smoke runs out of the owner's care journal.
let zenProgress = { v: 1, revision: 0 };
await page.route('**/api/zen/progress', (r) => {
  if (r.request().method() === 'GET') return r.fulfill({ json: zenProgress });
  zenProgress = { ...r.request().postDataJSON(), revision: zenProgress.revision + 1 };
  return r.fulfill({ json: { ok: true, revision: zenProgress.revision } });
});
await page.route('**/api/render', (r) => r.fulfill({ json: { ok: true, id: 'test', chat: false, detail: 'test' } }));
await page.route('**/api/chat', (r) => r.request().method() === 'POST' ? r.fulfill({ json: { ok: true } }) : r.continue());
await page.addInitScript(() => localStorage.removeItem('gr_state'));
const ok = (name, cond, extra = '') => { results[name] = cond ? 'PASS' : 'FAIL ' + extra; };
await page.goto(`${base}/#k=${key}`);
await page.waitForFunction(() => window.__garden && document.querySelector('#score').textContent !== '–', null, { timeout: 20000 });
await page.waitForTimeout(800);
await page.screenshot({ path: out + '01-top.png' });
const s0 = await page.evaluate(() => ({ n: __garden.state.items.length, plants: __garden.state.items.filter((i) => i.kind === 'plant').length, score: +document.querySelector('#score').textContent }));
ok('loads 25 plants', s0.plants === 25, JSON.stringify(s0));

await page.evaluate(() => { __garden.setMode('edit'); GR.moveItem('p18', 2.05, 2.1); }); await page.waitForTimeout(400);
// Give the drag test a visible, isolated footprint: the optimizer can place every
// small pot along the left window, outside the portrait camera's crop.
// drag a plant with touch: find its screen position via the debug hook
const before0 = await page.evaluate(() => Object.fromEntries(__garden.state.items.map((i) => [i.id, [i.x, i.z]])));
const pos = await page.evaluate(() => { const ps = __garden.state.items.filter((i) => i.kind === 'plant' && !i.box);
  const withS = ps.map((it) => { const y = it._on ? __garden.state.items.find((s) => s.id === it._on).h : 0; const s = __garden.project(it.x, it.z, y); return { id: it.id, x: it.x, z: it.z, y, d: Math.hypot(s.x - innerWidth / 2, s.y - innerHeight / 2) }; });
  return withS.sort((a, b) => a.d - b.d)[0]; });
const scr = await page.evaluate(({ x, z, y }) => window.__garden.project(x, z, y), pos);
if (scr) {
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await tp('touchStart', scr.x, scr.y); for (let i = 1; i <= 8; i++) await tp("touchMove", scr.x + i * 12, scr.y - i * 6); await tp('touchEnd');
  await page.waitForTimeout(500);
  const moved = await page.evaluate((b) => __garden.state.items.filter((i) => { const o = b[i.id]; return o && Math.hypot(i.x - o[0], i.z - o[1]) > 0.1; }).map((i) => i.id), before0);
  ok('touch drag moves plant', moved.length === 1, JSON.stringify({ pos, moved }));
  await page.screenshot({ path: out + '02-after-drag.png' });
}
// explore mode must lock everything
await page.evaluate(() => __garden.setMode('explore')); await page.waitForTimeout(300);
{ const before = await page.evaluate(() => { const it = __garden.state.items.find((i) => i.id === 'p08'); return { x: it.x, z: it.z, s: __garden.project(it.x, it.z, 0.8) }; });
  const cdp2 = await ctx.newCDPSession(page); const t2 = (type, x, y) => cdp2.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  await t2('touchStart', before.s.x, before.s.y); for (let i = 1; i <= 8; i++) await t2('touchMove', before.s.x - i * 12, before.s.y); await t2('touchEnd'); await page.waitForTimeout(300);
  const after = await page.evaluate(() => { const it = __garden.state.items.find((i) => i.id === 'p08'); return { x: it.x, z: it.z }; });
  ok('explore mode locks items', after.x === before.x && after.z === before.z, JSON.stringify({ before, after })); }
await page.screenshot({ path: out + '02b-explore.png' });
await page.evaluate(() => __garden.setMode('edit'));
// put a plant in front of the fridge: the app must flag the door
await page.evaluate(() => { const it = __garden.state.items.find((i) => i.id === 'p02'), f = GR.itemById('fridge'); it.x = f.x - f.w / 2 - .3; it.z = f.z; __garden.rescore(); });
const blocked = await page.evaluate(() => document.querySelector('#warn').textContent);
ok('flags plant blocking fridge door', /fridge door/.test(blocked), blocked);
const s0b = await page.evaluate(() => +document.querySelector('#score').textContent);
// fridge door
await page.tap('#bFridge'); await page.waitForTimeout(300); await page.evaluate(() => __garden.setView('overview')); await page.waitForTimeout(600);
await page.screenshot({ path: out + '03-3d-fridge-open.png' });
// suggest
await page.tap('[data-panel=suggest]'); await page.tap('#sGo');
await page.waitForSelector('#sOut .card', { timeout: 30000 });
await page.screenshot({ path: out + '04-suggest.png' });
await page.tap('#sOut .card button');
await page.waitForTimeout(500);
const s1 = await page.evaluate(() => ({ score: +document.querySelector('#score').textContent, warn: document.querySelector('#warn').textContent,
  fridgeClear: !document.querySelector('#warn').textContent.includes('fridge') }));
ok('suggestion keeps fridge door clear', s1.fridgeClear, JSON.stringify(s1));
ok('suggestion improves score', s1.score > s0b, `${s0b} -> ${s1.score}`);
await page.tap('[data-panel=suggest]'); // close
await page.evaluate(() => __garden.setView('top')); await page.waitForTimeout(600);
const onTable = await page.evaluate(() => __garden.state.items.filter((i) => i.kind === 'plant' && i._on).length);
ok('suggestion uses tables as plant shelves', onTable > 0, String(onTable));
await page.screenshot({ path: out + '05-applied-top.png' });
// item sheet edit pot size
await page.tap('[data-panel=items]'); await page.tap('.tile[data-id=p02]');
await page.fill('input[data-k=potD]', '18'); await page.dispatchEvent('input[data-k=potD]', 'change'); await page.waitForTimeout(300);
const potD = await page.evaluate(() => __garden.state.items.find((i) => i.id === 'p02').potD / 0.0254);
ok('edit pot diameter (in)', Math.abs(potD - 18) < 0.01, String(potD));
await page.screenshot({ path: out + '06-item-sheet.png' });
for (const p of ['layouts', 'scan', 'chat']) { await page.evaluate((key) => GR.openPanel(key), p); await page.waitForTimeout(900); await page.screenshot({ path: out + `07-${p}.png` }); }
ok('no console errors', errors.length === 0, errors.slice(0, 5).join(' | '));
ok('no failed requests', failed.length === 0, failed.slice(0, 5).join(' | '));
console.log(JSON.stringify(results, null, 1));
await browser.close();
process.exit(Object.values(results).every((v) => v === 'PASS') ? 0 : 1);
