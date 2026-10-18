// Isolated phone-sized almanac journey. Never writes the owner's layout or care journal.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const local = !process.argv[2], base = process.argv[2] || 'http://127.0.0.1:8797';
const out = new URL('../work/shots/almanac/', import.meta.url).pathname;
fs.mkdirSync(out, { recursive: true });
let server, browser;
const report = { checks: [], screenshots: [], errors: [] };
const check = (name, condition, detail) => { assert.ok(condition, `${name}: ${JSON.stringify(detail)}`); report.checks.push(name); };
try {
  if (local) {
    server = spawn('python', ['server.py', '--port', '8797'], { cwd: new URL('..', import.meta.url), stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); }
  }
  const key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
  const args = process.env.ALMANAC_SOFTWARE ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] : ['--use-gl=angle', '--use-angle=vulkan', '--enable-features=Vulkan', '--disable-vulkan-surface'];
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args });
  const context = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (err) => report.errors.push(String(err)));
  // Intercept ALL mutating requests, not just the known care/plan endpoints.
  await page.route('**/api/**', async (r) => {
    if (r.request().method() !== 'GET') return r.fulfill({ json: { ok: true, revision: 1 } });
    if (r.request().url().endsWith('/api/state')) return r.fulfill({ json: {} });
    if (r.request().url().endsWith('/api/zen/progress')) return r.fulfill({ json: { v: 1, revision: 0 } });
    return r.continue();
  });
  await page.addInitScript(() => { localStorage.removeItem('gr_state'); localStorage.removeItem('gr_zen'); });
  await page.goto(`${base}/#k=${key}`);
  await page.waitForFunction(() => window.GR?.almanac && GR.state.items.filter((it) => it.kind === 'plant').length === 25, null, { timeout: 30000 });
  await page.waitForFunction(() => window.GR?.zen, null, { timeout: 15000 });
  report.gpu = await page.evaluate(() => { const gl = GR.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
  // The dock is the actual user entry point.
  await page.locator('#dock [data-panel="almanac"]').click();
  await page.waitForSelector('#plant-almanac .alm-card');
  check('25 unique cards', await page.locator('.alm-card').count() === 25);
  const ids = await page.locator('.alm-card').evaluateAll((cards) => cards.map((c) => c.dataset.plant));
  check('stable inventory IDs', new Set(ids).size === 25 && ids[0] === 'p01' && ids[24] === 'p25', ids);
  check('full screen modal', await page.locator('#plant-almanac').evaluate((el) => el.matches(':modal') && el.getBoundingClientRect().height === innerHeight));
  check('one shared renderer', await page.evaluate(() => GR.almanac.metrics.rendererCount <= 1));
  const visited = [];
  for (const id of ids) {
    const canvas = page.locator(`[data-model="${id}"]`);
    await canvas.scrollIntoViewIfNeeded();
    await page.waitForFunction((id) => GR.almanac.metrics.visited.includes(id), id);
    await page.waitForFunction((id) => document.querySelector(`[data-model="${id}"]`)?.dataset.rendered, id, { timeout: 15000 });
    check(`cutout and care ${id}`, await page.locator(`[data-plant="${id}"]`).evaluate((card) => card.querySelector('img').complete && card.querySelector('img').naturalWidth > 0 && card.querySelectorAll('.alm-fact').length === 8));
    visited.push(id);
  }
  check('scrolled all 25 actual cards', visited.length === 25 && (await page.evaluate(() => GR.almanac.metrics.visited.length)) === 25, visited);
  await page.locator('[data-model="p01"]').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  check('newest photo matches actual history API', await page.evaluate(async () => {
    const data = await GR.api('/api/history/plant/p01');
    const newest = [...data.photos].sort((a, b) => +new Date(b.ts) - +new Date(a.ts))[0], memory = document.querySelector('[data-history="p01"]');
    return newest ? memory.querySelector('img')?.getAttribute('src') === newest.thumb512 : memory.textContent.includes('No history photographs');
  }));
  await page.screenshot({ path: out + '01-cards.png' }); report.screenshots.push(out + '01-cards.png');
  await page.locator('[data-toggle]').click();
  check('compact grid toggle', await page.locator('#plant-almanac').getAttribute('data-view') === 'grid');
  check('grid rows do not overlap', await page.locator('.alm-card').evaluateAll((cards) => cards.every((c, i) => i < 2 || c.getBoundingClientRect().top >= cards[i - 2].getBoundingClientRect().bottom - 1)));
  await page.waitForFunction(() => [...document.querySelectorAll('[data-plant="p01"] canvas,[data-plant="p02"] canvas')].every((c) => c.dataset.rendered));
  await page.screenshot({ path: out + '02-grid.png' }); report.screenshots.push(out + '02-grid.png');
  await page.locator('[data-search]').fill('curry');
  check('search returns three curry plants', await page.locator('.alm-card').count() === 3);
  await page.locator('[data-search]').fill(''); await page.selectOption('[data-filter="family"]', 'pepper');
  check('family filter', await page.locator('.alm-card').count() === 3);
  await page.selectOption('[data-filter="family"]', ''); await page.selectOption('[data-filter="light"]', 'med');
  check('light filter', await page.locator('.alm-card').count() === 7);
  await page.selectOption('[data-filter="light"]', '');
  await page.selectOption('[data-filter="health"]', 'unknown');
  check('health filter uses Zen status', await page.locator('.alm-card').count() === 0);
  await page.selectOption('[data-filter="health"]', '');
  await page.locator('[data-plant="p04"] .alm-more').click();
  check('detail opens selected plant', await page.locator('#plant-almanac[data-view="detail"] [data-plant="p04"]').count() === 1);
  await page.waitForFunction(() => document.querySelector('[data-model="p04"]')?.dataset.rendered);
  await page.screenshot({ path: out + '03-detail.png' }); report.screenshots.push(out + '03-detail.png');
  await page.locator('.alm-sources summary').click();
  check('detail has attributed care sources', await page.locator('.alm-sources a').count() >= 2);
  await page.locator('[data-room="p04"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: out + '03b-sources-actions.png' }); report.screenshots.push(out + '03b-sources-actions.png');
  await page.locator('[data-model="p04"]').scrollIntoViewIfNeeded();
  // Real touch swipe, not a call to the detail navigation helper.
  const cdp = await context.newCDPSession(page), area = await page.locator('[data-scroll]').boundingBox();
  const y = area.y + 160;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 320, y }] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 320 - i * 25, y: y + i }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  check('horizontal detail swipe', await page.locator('[data-plant="p05"]').count() === 1);
  await page.locator('[data-room="p05"]').click();
  check('Show in room selects and closes', await page.evaluate(() => GR.selected === 'p05' && !GR.almanac.isOpen && !document.querySelector('#plant-almanac')));
  check('Show in room frames the plant', await page.evaluate(() => { const it = GR.itemById('p05'); return Math.abs(GR.controls.target.x - it.x) < .01 && Math.abs(GR.controls.target.z - it.z) < .01; }));
  await page.screenshot({ path: out + '04-room.png' }); report.screenshots.push(out + '04-room.png');
  await page.evaluate(() => GR.almanac.open('p08'));
  await page.waitForSelector('[data-plant="p08"]');
  await page.locator('[data-edit="p08"]').click();
  check('Edit opens existing size editor', await page.evaluate(() => GR.mode === 'edit' && GR.selected === 'p08' && !!document.querySelector('input[data-k="potD"]')));
  // Existing History integration: current module is an item action, not GR.history.
  await page.evaluate(() => GR.almanac.open('p08')); await page.waitForSelector('[data-history-open="p08"]');
  await page.locator('[data-history-open="p08"]').click();
  await page.waitForSelector('#plant-history', { timeout: 20000 }); check('History opens actual history module', true);
  // Performance sample excludes screenshots and initial model compilation.
  await page.evaluate(() => GR.almanac.open()); await page.waitForSelector('.alm-card');
  await page.waitForTimeout(600);
  report.scroll = await page.evaluate(async () => {
    const el = document.querySelector('[data-scroll]'), times = [], long = []; let prev = 0;
    const observer = new PerformanceObserver((list) => long.push(...list.getEntries().map((e) => ({ duration: e.duration, startTime: e.startTime })))); observer.observe({ type: 'longtask' });
    const snap = el.style.scrollSnapType; el.style.scrollSnapType = 'none';
    const start = performance.now(), duration = 5200;
    await new Promise((resolve) => {
      function frame(now) {
        if (prev) times.push(now - prev); prev = now;
        const progress = Math.min(1, (now - start) / duration);
        // Continuous vertical traversal of the same first six cards and back.
        el.scrollTop = (1 - Math.cos(progress * Math.PI * 2)) / 2 * Math.min(el.scrollHeight - el.clientHeight, 5000);
        if (progress < 1) requestAnimationFrame(frame); else resolve();
      }
      requestAnimationFrame(frame);
    });
    observer.disconnect(); el.style.scrollSnapType = snap; times.sort((a, b) => a - b);
    const q = (v) => times[Math.min(times.length - 1, Math.floor(times.length * v))];
    return { sampleMs: performance.now() - start, frames: times.length, medianMs: q(.5), p95Ms: q(.95), p99Ms: q(.99), maxMs: q(1), over33ms: times.filter((v) => v > 33.4).length, longTasks: long };
  });
  check('scroll sample has measured frames', report.scroll.frames > 90, report.scroll);
  check('scroll p95 under 40ms desktop budget', report.scroll.p95Ms < 40, report.scroll);
  report.metrics = await page.evaluate(() => GR.almanac.metrics);
  check('single renderer and bounded cache', report.metrics.rendererCount === 1 && report.metrics.cachedModels <= 8, report.metrics);
  check('all procedural previews built without errors', report.metrics.modelErrors.length === 0, report.metrics.modelErrors);
  await page.evaluate(() => GR.almanac.close());
  const renders = await page.evaluate(() => GR.almanac.metrics.renders); await page.waitForTimeout(150);
  check('closing stops preview work and frees cache', await page.evaluate((n) => GR.almanac.metrics.renders === n && GR.almanac.metrics.cachedModels === 0 && GR.almanac.metrics.visible === 0, renders));
  await page.setViewportSize({ width: 360, height: 800 }); await page.evaluate(() => GR.almanac.open()); await page.waitForSelector('.alm-card'); await page.waitForTimeout(300);
  check('narrow phone has no horizontal overflow', await page.locator('#plant-almanac').evaluate((el) => el.scrollWidth === el.clientWidth && el.querySelector('[data-scroll]').scrollWidth === el.querySelector('[data-scroll]').clientWidth));
  await page.screenshot({ path: out + '05-narrow.png' }); report.screenshots.push(out + '05-narrow.png');
  await page.evaluate(() => GR.almanac.close()); await page.setViewportSize({ width: 900, height: 1000 }); await page.evaluate(() => GR.almanac.open()); await page.waitForSelector('.alm-card'); await page.waitForTimeout(300);
  await page.screenshot({ path: out + '06-tablet.png' }); report.screenshots.push(out + '06-tablet.png');
  await page.evaluate(() => { GR.almanac.close(); window.__almanacZen = GR.zen; GR.zen = null; window.__almanacHistory = GR.history; GR.history = null; document.querySelector('link[data-history]')?.remove(); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => GR.almanac.open('p08')); await page.waitForSelector('[data-model="p08"][data-rendered]');
  check('optional Zen and history absent gracefully', await page.locator('.alm-card').evaluate((card) => card.textContent.includes('Zen health not available') && !card.querySelector('[data-history-open]')));
  const staticRenders = await page.evaluate(() => GR.almanac.metrics.renders); await page.waitForTimeout(200);
  check('reduced motion stops turntable rotation', await page.evaluate((n) => GR.almanac.metrics.renders === n, staticRenders));
  await page.keyboard.press('Escape'); check('Escape closes modal', await page.evaluate(() => !GR.almanac.isOpen));
  await page.evaluate(() => { GR.zen = window.__almanacZen; GR.history = window.__almanacHistory; delete window.__almanacZen; delete window.__almanacHistory; });
  check('no uncaught browser errors', report.errors.length === 0, report.errors);
  report.ok = true;
} catch (err) { report.ok = false; report.failure = String(err); process.exitCode = 1; }
finally {
  if (browser) await browser.close(); if (server) server.kill();
  fs.writeFileSync(out + 'receipt.json', JSON.stringify(report, null, 2));
  const summary = { ...report, checkCount: report.checks.length };
  if (report.metrics) { const { renderMs, ...rest } = report.metrics; const ordered = [...renderMs].sort((a, b) => a - b); summary.metrics = { ...rest, renderSampleCount: ordered.length, renderMedianMs: ordered[Math.floor(ordered.length * .5)], renderP95Ms: ordered[Math.floor(ordered.length * .95)] }; }
  console.log(JSON.stringify(summary, null, 2));
}
