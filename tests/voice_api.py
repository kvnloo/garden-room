"""Isolated storage/validation tests. No owner files or providers are touched."""
import concurrent.futures
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('voice', Path(__file__).resolve().parents[1] / 'routes/voice.py')
assert spec is not None and spec.loader is not None
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)


class Handler:
    client_address: tuple[str, int] = ('127.0.0.1', 1)
    path = '/api/voice/config'
    def __init__(self, body=None):
        self.payload = body
        self.wfile = io.BytesIO()
        self.headers_out = {}
    def body(self): return self.payload
    def send_response(self, status): self.status = status
    def send_header(self, name, value): self.headers_out[name] = value
    def end_headers(self): pass
    def result(self): return json.loads(self.wfile.getvalue())


class VoiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=os.environ.get('TMPDIR'))
        self.data = patch.object(voice, 'DATA', Path(self.temp.name))
        self.data.start()
    def tearDown(self):
        self.data.stop()
        self.temp.cleanup()
    def test_events_inbox_and_concurrent_append(self):
        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
            list(pool.map(lambda n: voice._event({'type':'utterance','text':f'Test utterance {n}','context':{'mode':'edit','view':'top','selected':'p02','last_actions':[],'extra':'discard'}}),range(40)))
        voice._event({'type':'correction','text':'no, I meant eggplant','context':{'mode':'edit'}})
        voice._event({'type':'utterance','text':'Please add a new button','context':{'view':'top'}})
        voice._event({'type':'tell_hermes','kind':'praise','text':'Love it','context':{}})
        voice._event({'type':'transcript','source':'gpt_assistant','text':'a bug','partial':True})
        rows = [json.loads(s) for s in (voice.DATA/'events.jsonl').read_text().splitlines()]
        self.assertEqual(len(rows),44)
        self.assertTrue(all('extra' not in row['context'] for row in rows))
        inbox = [json.loads(s) for s in (voice.DATA/'inbox.jsonl').read_text().splitlines()]
        self.assertEqual([row['kind'] for row in inbox],['complaint','request','praise'])
        self.assertEqual(set(inbox[0]),{'ts','kind','text','context'})
    def test_rules_and_drive_cursor(self):
        self.assertIn('vocabulary',voice._rules())
        (voice.DATA/'rules.json').write_text('{"aliases":{"open icebox":"fridge_open"},"vocabulary":["eggplant"]}')
        self.assertEqual(voice._rules()['aliases']['open icebox'],'fridge_open')
        (voice.DATA/'drive.jsonl').write_text('\n'.join([json.dumps({'id':3,'action':'fridge_close'}), 'bad json', json.dumps({'id':2,'action':'fridge_open','params':{}}), json.dumps({'id':2,'action':'fridge_open','params':{}})])+'\n'+ '{"id":4')
        self.assertEqual([row['id'] for row in voice._drive(0)['actions']],[2,3])
        self.assertEqual(voice._drive(2)['after'],3)
        self.assertEqual(voice._drive(3),{'actions':[],'after':3})
    def test_floor_and_allowlist(self):
        request={'state':'open fridge','questions':{'next_action':{'type':'choice','criteria':{'fridge_open':'Open fridge','reobserve':'Look again','abstain':'No action'}}}}
        with patch.object(voice,'_key',return_value='test-only'), patch.object(voice,'_post',return_value={'answers':{'next_action':{'type':'choice','choice':'fridge_open','confidence':.64}}}):
            self.assertEqual(voice._jev(request)['selected_id'],'reobserve')
        for answer in [{'choice':'not_offered','confidence':1},{'choice':'fridge_open','confidence':float('nan')},{'choice':'fridge_open','confidence':True}]:
            with patch.object(voice,'_key',return_value='test-only'),patch.object(voice,'_post',return_value={'answers':{'next_action':{'type':'choice',**answer}}}):
                self.assertRaises(RuntimeError,voice._jev,request)
        with patch.object(voice,'_key',return_value='test-only'),patch.object(voice,'_post',return_value={'answers':{'next_action':{'type':'choice','choice':'fridge_open','confidence':.65}}}):
            self.assertEqual(voice._jev(request)['selected_id'],'fridge_open')
    def test_network_guard_and_secret_cache_control(self):
        h=Handler(); h.client_address=('8.8.8.8',1)
        self.assertTrue(voice.handle(h,'GET','/api/voice/config')); self.assertEqual(h.status,403)
        h=Handler()
        with patch.object(voice,'_key',return_value='test-only-not-a-secret'):
            voice.handle(h,'GET','/api/voice/config')
        self.assertEqual(h.status,200); self.assertEqual(h.headers_out['Cache-Control'],'no-store')
        self.assertEqual(h.result()['model'],'gpt-oss-120b')
        self.assertFalse(voice.handle(h,'GET','/api/history/list'))

if __name__ == '__main__': unittest.main(verbosity=2)
