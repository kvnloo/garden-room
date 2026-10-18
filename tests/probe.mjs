// Prints what the optimizer leaves unresolved (debug aid). node tests/probe.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage();
await p.route('**/api/state', (r) => r.request().method() === 'GET' ? r.fulfill({ json: {} }) : r.fulfill({ json: { ok: true } }));
await p.goto(`http://127.0.0.1:8790/#k=${key}`);
await p.waitForFunction(() => window.__garden);
const res = await p.evaluate(() => { const g = __garden; const out = [];
  for (const mf of [false, true]) for (const seed of [1, 2]) { const r = g.optimize(g.state.items, g.state.room, { seed, moveFurniture: mf, winWeight: 0.3 }); out.push({ mf, seed, score: Math.round(r.score), light: r.lightSat.toFixed(2), win: r.winProx.toFixed(2), pen: r.pen.toFixed(1), warns: r.warns }); }
  return out; });
console.log(JSON.stringify(res, null, 1));
await b.close();
