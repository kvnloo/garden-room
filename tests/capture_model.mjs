// Render a plant model from 4 views with the real GPU. Prints triangle count + size.
// node tests/capture_model.mjs plants/curry_leaf.js out_dir "h=0.9&potD=0.35&potH=0.28&pot=dark_plastic"
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [m, out, extra = ''] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'] });
const p = await b.newPage({ viewport: { width: 768, height: 768 } });
const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (x) => x.type() === 'error' && errs.push(x.text()));
let stats;
for (const view of ['front', 'three', 'side', 'top']) {
  await p.goto(`http://127.0.0.1:8790/models/preview.html?m=${encodeURIComponent(m)}&view=${view}&${extra}`);
  try { await p.waitForFunction(() => window.__ready, null, { timeout: 20000 }); } catch { break; }
  stats = await p.evaluate(() => window.__stats);
  await p.screenshot({ path: `${out}/${view}.png` });
}
console.log(JSON.stringify({ stats, errors: errs.slice(0, 5), files: fs.readdirSync(out) }));
await b.close();
process.exit(errs.length ? 1 : 0);
