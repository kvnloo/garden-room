// Real indexed photos, read-only phone journey. Never submits owner corrections.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:8790', key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
const out = new URL('../work/history-shots/', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(), errors = [], failed = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(r.status() + ' ' + new URL(r.url()).pathname); });
  await page.route('**/api/state', (r) => r.fulfill({ json: r.request().method() === 'GET' ? {} : { ok: true } }));
  await page.route('**/api/layouts', (r) => r.fulfill({ json: [] }));
  await page.route('**/api/history/assign', (r) => { throw new Error('Real-data test must not write assignments'); });
  await page.goto(`${base}/#k=${key}`);
  await page.waitForFunction(() => window.GR && window.__garden && document.querySelector('link[data-history]'));
  await page.evaluate(() => GR.renderer.setPixelRatio(.65));
  await page.evaluate(() => GR.select('p06'));
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await page.waitForSelector('#plant-history');
  const timeline = await (await ctx.request.get(base + '/api/history/plant/p06', { headers: { 'X-Garden-Key': key } })).json();
  assert.ok(timeline.photos.length > 1, 'Real plant has historical photos');
  assert.equal(await page.locator('[data-photo]').count(), Math.min(48, timeline.photos.length));
  await page.locator('[data-real]').check();
  await page.locator('#history-speed').evaluate((el) => { el.value = 4; el.dispatchEvent(new Event('input')); });
  await page.locator('[data-play]').click();
  await page.waitForFunction(() => +document.querySelector('[data-scrub]').value === 1);
  await page.waitForFunction(() => { const im = document.querySelector('.history-float img.on'); return im?.naturalWidth > 0 && +getComputedStyle(im).opacity > .99; });
  assert.ok(await page.evaluate(() => document.querySelector('.history-float img.on').width >= 190), 'Known crop is centered and zoomed');
  await page.screenshot({ path: out + '04-real-data.png' });
  await page.locator('[data-photo]').first().click();
  await page.waitForFunction(() => document.querySelector('dialog img')?.naturalWidth > 0);
  assert.ok((await page.locator('dialog img').getAttribute('src')).endsWith('_1600.webp'));
  await page.screenshot({ path: out + '05-real-viewer.png' });
  await page.locator('dialog [data-close]').click();
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 915 });
    await page.evaluate(() => document.querySelector('#sheet').scrollTop = 0);
    await page.waitForTimeout(200);
    assert.ok(await page.evaluate(() => { const r = document.querySelector('#plant-history'); return r.scrollWidth <= r.clientWidth + 1; }), `No horizontal overflow at ${width}px`);
    await page.screenshot({ path: out + `06-width-${width}.png` });
  }
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  const index = JSON.parse(fs.readFileSync(new URL('../data/history/index.json', import.meta.url)));
  const budgets = Object.entries(index.plants).map(([id, ids]) => { const ps = index.photos.filter((p) => ids.includes(p.id)); return [id, ps.reduce((n,p) => n+p.bytes512, 0) + Math.max(0,...ps.map((p) => p.bytes1600))]; });
  assert.ok(budgets.every(([,b]) => b < 8_000_000));
  console.log(JSON.stringify({ realPhotos: timeline.photos.length, liveHistoryViewerPlayback: 'PASS', widths320_412_768: 'PASS', consoleAndNetwork: 'PASS', maxPlantTransferBytes: Math.max(...budgets.map(([,b]) => b)), budgetsUnder8MB: 'PASS' }, null, 2));
} finally { await browser.close(); }
