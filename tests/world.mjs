// Loads world.html for the newest render and screenshots it. node tests/world.mjs <renderId> <file>
import { chromium } from 'playwright-core';
const [rid, f] = process.argv.slice(2);
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: (process.env.GL || '--use-angle=vulkan --enable-features=Vulkan --ignore-gpu-blocklist --enable-gpu').split(' ') });
const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`http://127.0.0.1:8790/world.html?r=${rid}&f=${f}`);
await p.waitForFunction(() => /drag/.test(document.getElementById('msg').textContent), null, { timeout: 120000 });
await p.waitForTimeout(4000);
console.log(await p.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; }));
await p.screenshot({ path: `work/shots/world-${f}.png` });
console.log(JSON.stringify({ msg: await p.textContent('#msg'), errs: errs.slice(0, 3) }));
await b.close();
