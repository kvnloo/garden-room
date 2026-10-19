"""Stdlib route proxy tests, with a real private Unix HTTP upstream."""
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import socketserver
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
import unittest
spec=importlib.util.spec_from_file_location('garden_scan_route',Path(__file__).resolve().parents[1]/'routes/scan_live.py')
route=importlib.util.module_from_spec(spec); spec.loader.exec_module(route)

class Request:
    def __init__(self,data=None):
        self.data=data; self.headers={'Content-Length':str(len(json.dumps(data)))}; self.wfile=io.BytesIO(); self.status=None; self.result=None; self.response_headers={}
    def body(self): return self.data
    def send_json(self,status,result): self.status=status; self.result=result
    def send_response(self,status): self.status=status
    def send_header(self,k,v): self.response_headers[k]=v
    def end_headers(self): pass

class Upstream(BaseHTTPRequestHandler):
    def log_message(self,*_): pass
    def do_GET(self):
        body=json.dumps(dict(ok=True,path=self.path)).encode(); self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        body=self.rfile.read(int(self.headers['Content-Length'])); self.send_response(202); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
class Unix(HTTPServer):
    address_family=socket.AF_UNIX
    def server_bind(self): socketserver.TCPServer.server_bind(self); self.server_name='localhost'; self.server_port=0

class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='scan-route-',dir=os.environ['TMPDIR']); self.previous=(route.SOCKET,route.DATA); route.SOCKET=Path(self.tmp.name)/'worker.sock'; route.DATA=Path(self.tmp.name)/'private'
    def tearDown(self): route.SOCKET,route.DATA=self.previous; self.tmp.cleanup()
    def test_real_unix_http_proxy_preserves_status_and_json(self):
        server=Unix(str(route.SOCKET),Upstream); thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
        try:
            h=Request(); self.assertTrue(route.handle(h,'GET','/api/scan_live/health')); self.assertEqual(h.status,200); self.assertEqual(json.loads(h.wfile.getvalue()),dict(ok=True,path='/health'))
            payload=dict(plan=dict(items=[],room=dict(poly=[]))); h=Request(payload); route.handle(h,'POST','/api/scan_live/start'); self.assertEqual(h.status,202); self.assertEqual(json.loads(h.wfile.getvalue()),payload)
        finally: server.shutdown(); server.server_close(); thread.join()
    def test_unavailable_worker_returns_actionable_503(self):
        h=Request(); route.handle(h,'GET','/api/scan_live/health'); self.assertEqual(h.status,503); self.assertEqual(h.result['service'],'garden-room-scan-live')
    def test_route_method_and_path_boundaries(self):
        self.assertFalse(route.handle(Request(),'GET','/api/state'))
        for path in ['/api/scan_live/../state','/api/scan_live/123/splat','/api/scan_live/'+'a'*24+'/../../state']:
            h=Request(); route.handle(h,'GET',path); self.assertEqual(h.status,404)
        h=Request(); route.handle(h,'POST','/api/scan_live/health'); self.assertEqual(h.status,405)
    def test_body_limits_and_invalid_json_numbers(self):
        h=Request({}); h.headers['Content-Length']='1200001'; route.handle(h,'POST','/api/scan_live/start'); self.assertEqual(h.status,413)
        h=Request(dict(value=float('nan'))); route.handle(h,'POST','/api/scan_live/start'); self.assertEqual(h.status,400)
        h=Request({}); h.headers['Content-Length']='nonsense'; route.handle(h,'POST','/api/scan_live/start'); self.assertEqual(h.status,400)
    def test_exact_private_artifacts_survive_worker_exit(self):
        id='b'*24; target=route.DATA/id; target.mkdir(parents=True)
        splat=bytes(range(32)); (target/'live.splat').write_bytes(splat); status=dict(state='stopped',seq=7); (target/'latest.json').write_text(json.dumps(status))
        h=Request(); route.handle(h,'GET',f'/api/scan_live/{id}/splat'); self.assertEqual(h.status,200); self.assertEqual(h.wfile.getvalue(),splat)
        h=Request(); route.handle(h,'GET',f'/api/scan_live/{id}/status'); self.assertEqual(json.loads(h.wfile.getvalue()),status)

    def test_history_and_rebased_proposal_survive_worker_exit(self):
        fixture=json.loads((Path(__file__).parent/'fixtures/scan-real.json').read_text()); sid='c'*24; target=route.DATA/sid;target.mkdir(parents=True)
        scan=fixture['scan'];(target/'latest.json').write_text(json.dumps(scan))
        h=Request();route.handle(h,'GET','/api/scan_live/history'); self.assertEqual(h.status,200); self.assertEqual(h.result[0]['id'],sid)
        h=Request(dict(plan=fixture['plan']));route.handle(h,'POST',f'/api/scan_live/{sid}/proposal'); self.assertEqual(h.status,200);self.assertEqual(h.result['selected'],0);self.assertEqual(h.result['items'],fixture['plan']['items'])
        matches=[c for c in h.result['changes'] if c['object'] and c['id']];self.assertGreater(len(matches),3)
        c=matches[0];it=next(i for i in fixture['plan']['items'] if i['id']==c['id'])
        h=Request(dict(plan=fixture['plan'],decisions={c['object']:dict(itemId=c['id'],x=it['x']+.02,z=it['z'],include=True)}));route.handle(h,'POST',f'/api/scan_live/{sid}/proposal');self.assertEqual(h.status,200);self.assertTrue(next(v for v in h.result['changes'] if v['object']==c['object'])['manualPosition'])
        self.assertEqual(json.loads((target/'latest.json').read_text()),scan,'review never modifies source scan')
    def test_proposal_rejects_malformed_input_and_traversal(self):
        sid='d'*24;target=route.DATA/sid;target.mkdir(parents=True);(target/'latest.json').write_text('{}')
        for body in [dict(plan={}),dict(plan=dict(items=[],room=dict(poly=[[0,0],[1,0],[float('nan'),1]])))]:
            h=Request(body);route.handle(h,'POST',f'/api/scan_live/{sid}/proposal');self.assertEqual(h.status,400)
        h=Request({});route.handle(h,'POST','/api/scan_live/'+'e'*24+'/proposal');self.assertEqual(h.status,404)
        fixture=json.loads((Path(__file__).parent/'fixtures/scan-real.json').read_text())
        for rot in [.5,True,4]:
            fixture['plan']['items'][0]['rot']=rot
            h=Request(dict(plan=fixture['plan']));route.handle(h,'POST',f'/api/scan_live/{sid}/proposal');self.assertEqual(h.status,400)
        (target/'latest.json').write_text(' '*5_000_001)
        h=Request(dict(plan=fixture['plan']));route.handle(h,'POST',f'/api/scan_live/{sid}/proposal');self.assertEqual(h.status,413)

if __name__=='__main__': unittest.main(verbosity=2)
