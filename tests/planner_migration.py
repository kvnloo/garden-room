"""Disposable clockwise migration receipts; never mutate the owner's room."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('garden_server', Path(__file__).resolve().parents[1] / 'server.py')
assert spec and spec.loader
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

class Rotation(unittest.TestCase):
    def test_complete_and_idempotent(self):
        plan = {'room': copy.deepcopy(server.LEGACY_ROOM), 'items': [{'id':'fridge','x':.655,'z':.455,'rot':0}], 'lightSources':[{'x':.5,'z':2,'rot':3}]}
        original = copy.deepcopy(plan)
        migrated = server.migrate_plan(plan)
        self.assertEqual(plan, original)
        self.assertEqual(migrated['room']['v'],3)
        self.assertEqual(migrated['room']['poly'][1],[3.6576,2.5576])
        self.assertEqual(migrated['room']['window']['edge'],4)
        self.assertEqual(migrated['room']['window']['facing'],'north')
        self.assertEqual(migrated['room']['openings'],plan['room']['openings'])
        self.assertAlmostEqual(migrated['items'][0]['x'],3.6576-.455)
        self.assertEqual(migrated['items'][0]['z'],.655)
        self.assertEqual(migrated['items'][0]['rot'],1)
        self.assertEqual(migrated['lightSources'][0]['rot'],0)
        self.assertAlmostEqual(migrated['lightSources'][0]['x'],1.6576)
        self.assertEqual(server.migrate_plan(migrated), migrated)

    def test_backups_and_legacy_saved_layouts(self):
        with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR']) as tmp:
            p=Path(tmp)
            original=json.dumps({'room':server.LEGACY_ROOM,'items':[{'x':1,'z':2,'rot':2}]})
            (p/'state.json').write_text(original)
            (p/'layouts.json').write_text(json.dumps([{'name':'old','items':[{'x':1,'z':2,'rot':2}]}]))
            server.migrate_saved_plans(p)
            self.assertEqual(next(p.glob('state.backup-*.json')).read_text(),original)
            layout=json.loads((p/'layouts.json').read_text())[0]
            self.assertEqual(layout['room']['v'],3)
            self.assertEqual(layout['items'][0]['rot'],3)
            self.assertAlmostEqual(layout['items'][0]['x'],1.6576)
            files={f.name:f.read_bytes() for f in p.iterdir()}
            server.migrate_saved_plans(p)
            self.assertEqual(files,{f.name:f.read_bytes() for f in p.iterdir()})

if __name__ == '__main__': unittest.main()
