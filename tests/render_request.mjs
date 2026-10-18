// Creates a real render request through the phone UI (no mocks). node tests/render_request.mjs
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const key = fs.readFileSync(new URL('../data/.token', import.meta.url), 'utf8').trim();
const b = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
await p.goto(`http://127.0.0.1:8790/#k=${key}`);
await p.waitForFunction(() => window.__garden && document.querySelector('#score').textContent !== '–');
await p.tap('[data-panel=real]'); await p.fill('#rNote', 'afternoon light, LEDs on'); await p.tap('#rGo');
await p.waitForSelector('#toast:not(.hidden)'); console.log(await p.textContent('#toast'));
await b.close();
