#!/usr/bin/env python3
"""Render recorded DOM + actual WebGL frame in headless Chromium, never re-run app."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
from replay_common import ROOT, choose_session, millis


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--session')
    p.add_argument('--at', help='Unix seconds, milliseconds, or ISO timestamp; defaults to latest recorded frame')
    p.add_argument('--output', '-o', default=str(ROOT / 'data/replay/current.png'))
    p.add_argument('--base', default='http://127.0.0.1:8790')
    a = p.parse_args()
    try:
        m = choose_session(a.session, a.at)
        at = millis(a.at) if a.at else m['last_ts']
        output = str(Path(a.output).resolve())
        Path(output).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        config = dict(session=m['id'], at=at, output=output, base=a.base)
        script = r'''
const fs = require('fs'); const { chromium } = require('playwright-core');
(async () => {
 const c = JSON.parse(fs.readFileSync(0,'utf8'));
 const key = fs.readFileSync('data/.token','utf8').trim();
 const browser = await chromium.launch({ executablePath:'/usr/bin/chromium', args:['--disable-dev-shm-usage'] });
 try {
  const ctx = await browser.newContext({viewport:{width:412,height:915}, deviceScaleFactor:1});
  await ctx.addInitScript(k => localStorage.setItem('gr_key', k), key);
  const page = await ctx.newPage();
  await page.goto(c.base + '/watch.html?' + new URLSearchParams({snapshot:'1',session:c.session,at:String(c.at)}), {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.replayReady && window.replayFrameTs, null, {timeout:16000});
  const size = await page.evaluate(() => ({width:Math.ceil(parseFloat(document.body.style.width)),height:Math.ceil(parseFloat(document.body.style.height))}));
  if (!size.width || !size.height) throw new Error('Replay viewport unavailable');
  await page.setViewportSize(size);
  await page.evaluate(async () => { const doc = window.replayPlayer.iframe.contentDocument; await doc.fonts.ready; await Promise.all([...doc.images].map(i => i.complete ? null : new Promise(resolve => { i.onload=resolve;i.onerror=resolve;setTimeout(resolve,1000); }))); });
  await page.locator('#stage').screenshot({path:c.output, timeout:8000});
  console.log(JSON.stringify({output:c.output,session:c.session,at:c.at,frame_ts:await page.evaluate(()=>window.replayFrameTs),viewport:size}));
 } finally { await browser.close(); }
})().catch(e=>{console.error(e.message);process.exit(1)});
'''
        proc = subprocess.run(['node', '-e', script], input=json.dumps(config), text=True, capture_output=True, cwd=ROOT, timeout=24)
        if proc.returncode:
            raise RuntimeError(proc.stderr.strip())
        Path(output).chmod(0o600)
        print(proc.stdout.strip())
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
