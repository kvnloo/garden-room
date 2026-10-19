#!/usr/bin/env python3
"""Rebuild six frozen camera jobs with cached HQ RGB; never generate an image.

Usage: ComfyUI-python tools/replay_real_shell.py BEFORE_DIR AFTER_DIR
Then REAL_STAGE=after REAL_OUT=AFTER_DIR node tests/real_visual.mjs --cached
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def replay(before, after):
    before, after = before.resolve(), after.resolve()
    if before == after:
        raise ValueError('Keep baseline and redesigned evidence separate')
    records = json.loads((before/'records.json').read_text())
    if len(records) != 6 or len({r['name'] for r in records}) != 6:
        raise ValueError('Require six unique frozen poses')
    after.mkdir(parents=True, exist_ok=True)
    spec = importlib.util.spec_from_file_location('replay_route', ROOT/'routes/real.py')
    assert spec is not None and spec.loader is not None
    route = importlib.util.module_from_spec(spec); spec.loader.exec_module(route)
    output = []
    for record in records:
        name = record['name']
        if Path(name).name != name:
            raise ValueError('Unsafe pose name')
        source, target = before/name, after/name
        target.mkdir(exist_ok=True)
        hashes = {}
        for filename in ('capture.json', 'depth.f32', 'ids.png', 'procedural.jpg', 'real.png', 'provenance.json'):
            data = (source/filename).read_bytes()
            hashes[filename] = hashlib.sha256(data).hexdigest()
            destination = target/filename
            if destination.exists() and destination.read_bytes() != data and filename != 'provenance.json':
                raise ValueError('Refusing to replace frozen evidence: '+str(destination))
            destination.write_bytes(data)
        capture = json.loads((target/'capture.json').read_text())
        (target/'layout.json').write_text(json.dumps(capture['layout']))
        shutil.copyfile(target/'procedural.jpg', target/'view.jpg')
        (target/'status.json').write_text(json.dumps({'state': 'photoreal', 'hq': True,
            'timings': {'captureMs': capture.get('captureMs')}}))
        env = dict(os.environ, GARDEN_REAL_BACKEND='shell', REAL_RESEARCH_PREVIEW='0')
        # Existing real.png is mandatory. --splat-only refuses generation without it.
        subprocess.run([sys.executable, str(ROOT/'tools/render_real.py'), str(target), '--splat-only'],
                       check=True, env=env, timeout=120)
        status = json.loads((target/'status.json').read_text())
        if status['state'] != 'ready' or status['backend'] != 'procedural-depth-shell':
            raise RuntimeError('Shell failed: '+json.dumps(status))
        # Offline browser URLs map only to immutable artifact bytes, not owner data.
        base = '/real-visual-cache/'+name+'/'
        for stage in ('coarse', 'fine'):
            status['splat'][stage]['url'] = base+stage+'.splat'
        photo = dict(record['view'], base=base, status=status, revision=record['revision'],
                     plants=route.visible_plants(target),
                     created=json.loads((source/'status.json').read_text())['created'])
        item = {k: record[k] for k in ('name', 'revision', 'id', 'camera')}
        item.update(view=photo, scene=None, sceneLocal=str(target/'fine.splat'),
                    reusedHQ=True, sourceHashes=hashes)
        output.append(item)
        (after/'records.json').write_text(json.dumps(output, indent=2))
        print(name, json.dumps(status['timings']), flush=True)
    return output


if __name__ == '__main__':
    replay(Path(sys.argv[1]), Path(sys.argv[2]))
