"""Isolated API tests; never touch the owner's assignments or layout."""
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('history', ROOT / 'routes/history.py')
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)


class Handler:
    def __init__(self, path, data=None):
        self.path, self.data, self.result = path, data, None
    def body(self):
        return self.data
    def send_json(self, code, data):
        self.result = code, data


class HistoryTest(unittest.TestCase):
    def setUp(self):
        (ROOT / 'work').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / 'work')
        history.DATA = Path(self.temp.name)
        history._CACHE = (None, {})
        rows = [dict(id=f'{i:012x}', ts=f'2026-0{i+1}-01T12:00:00-05:00', src='/private/secret.jpg', thumb512='/history/test.webp', thumb1600='/history/test1600.webp', plants=[dict(id='p01', score=.9)]) for i in range(3)]
        (history.DATA / 'index.json').write_text(json.dumps({'photos': rows}))
    def tearDown(self):
        self.temp.cleanup()
    def call(self, method, path, body=None):
        h = Handler(path, body)
        self.assertTrue(history.handle(h, method, path.split('?')[0]))
        return h.result
    def test_timeline_and_private_fields(self):
        code, r = self.call('GET', '/api/history/plant/p01')
        self.assertEqual(code, 200)
        self.assertEqual(len(r['photos']), 3)
        self.assertNotIn('secret', json.dumps(r))
        self.assertEqual([p['ts'] for p in r['photos']], sorted(p['ts'] for p in r['photos']))
    def test_remove_add_readback_persists(self):
        body = {'photo': '000000000000', 'plant': 'p01', 'on': False}
        self.assertEqual(self.call('POST', '/api/history/assign', body)[0], 200)
        self.assertEqual(len(self.call('GET', '/api/history/plant/p01')[1]['photos']), 2)
        self.assertIs(json.loads((history.DATA / 'overrides.json').read_text())[body['photo']]['p01'], False)
        body['on'] = True
        self.call('POST', '/api/history/assign', body)
        self.assertEqual(len(self.call('GET', '/api/history/plant/p01')[1]['photos']), 3)
    def test_validation(self):
        for body in [{'photo':'../../x','plant':'p01','on':True}, {'photo':'000000000000','plant':'p99','on':True}, {'photo':'000000000000','plant':'p01','on':'false'}]:
            self.assertEqual(self.call('POST', '/api/history/assign', body)[0], 400)
        self.assertEqual(self.call('POST', '/api/history/assign', {'photo':'ffffffffffff','plant':'p01','on':True})[0], 404)
        self.assertEqual(self.call('GET', '/api/history/plant/p99')[0], 404)
    def test_library_pagination_uses_handler_query(self):
        code, r = self.call('GET', '/api/history/photos?offset=1&limit=1')
        self.assertEqual(code, 200)
        self.assertEqual(r['offset'], 1)
        self.assertEqual(len(r['photos']), 1)
        self.assertTrue(r['hasMore'])
        self.assertEqual(r['total'], 3)


if __name__ == '__main__':
    unittest.main()
