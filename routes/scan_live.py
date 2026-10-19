"""Authenticated bounded proxy to the private GPU process; stdlib only."""
import http.client
import json
import os
from pathlib import Path
import re
import socket
import importlib.util
ROOT=Path(__file__).resolve().parents[1]
_spec=importlib.util.spec_from_file_location('garden_scan_layout',ROOT/'tools/scan_live_layout.py')
_layout=importlib.util.module_from_spec(_spec); _spec.loader.exec_module(_layout)
build_proposal,finite=_layout.build_proposal,_layout.finite
SOCKET=Path(os.environ.get('GARDEN_SCAN_SOCKET',str(ROOT/'work/scan-live.sock')))
DATA=ROOT/'data/scan_live'
MAX_BODY=1_200_000


class UnixConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout); self.sock.connect(str(SOCKET))


def handle(h,method,path):
    prefix='/api/scan_live/'
    if not path.startswith(prefix): return False
    sub=path[len(prefix):]
    match=re.fullmatch(r'([0-9a-f]{24})/(frame|status|stop|splat|proposal)',sub)
    if sub not in ('health','start','history') and not match:
        h.send_json(404,{'error':'No such scan route'}); return True
    expected='GET' if sub in ('health','history') or (match and match[2] in ('status','splat')) else 'POST'
    if method!=expected:
        h.send_json(405,{'error':'Method not allowed'}); return True
    if sub=='history':
        rows=[]
        targets=sorted((p for p in DATA.glob('*/latest.json') if re.fullmatch('[0-9a-f]{24}',p.parent.name)),key=lambda p:p.stat().st_mtime,reverse=True)[:200]
        for target in targets:
            try:
                if target.stat().st_size>5_000_000: continue
                r=json.loads(target.read_text()); proposal=r.get('proposal',{})
                rows.append(dict(id=target.parent.name,state=r.get('state'),createdAt=r.get('createdAt'),frames=r.get('seq',-1)+1,metric=r.get('metric',False),detections=len(r.get('observedDetections',r.get('detections',[]))),selected=proposal.get('selected',0)))
            except (OSError,ValueError,TypeError): continue
        h.send_json(200,rows); return True
    if match and match[2]=='proposal':
        try:
            n=int(h.headers.get('Content-Length','0'))
            if n<2 or n>MAX_BODY: raise ValueError('Review request too large or empty')
            target=DATA/match[1]/'latest.json'
            if not target.is_file(): h.send_json(404,{'error':'Scan session not found'}); return True
            if target.stat().st_size>5_000_000: h.send_json(413,{'error':'Artifact too large'}); return True
            r=json.loads(target.read_text()); body=h.body(); plan=body.get('plan') or r.get('planSnapshot')
            if not isinstance(plan,dict) or not isinstance(plan.get('items'),list) or len(plan['items'])>100: raise ValueError('Current plan required')
            poly=plan.get('room',{}).get('poly',[])
            if not 3<=len(poly)<=30 or any(len(p)!=2 or not all(finite(v) for v in p) for p in poly): raise ValueError('Invalid room')
            ids=set()
            for it in plan['items']:
                if not isinstance(it.get('id'),str) or it['id'] in ids or not all(finite(it.get(k)) for k in ('x','z','w','d','h')) or not all(0<it[k]<10 for k in ('w','d','h')) or type(it.get('rot',0)) is not int or it.get('rot',0) not in range(4): raise ValueError('Invalid plan item')
                ids.add(it['id'])
            result=build_proposal(plan,r.get('observedDetections',r.get('detections',[])),r.get('metric',False),r.get('alignment'),match[1],body.get('decisions'),r.get('createdAt'))
            h.send_json(200,result)
        except (ValueError,TypeError,KeyError,AttributeError): h.send_json(400,{'error':'Invalid scan review request'})
        return True
    # Artifacts remain readable after stop/worker restart. No static public mapping.
    if match and method=='GET' and match[2] in ('status','splat'):
        target=DATA/match[1]/('live.splat' if match[2]=='splat' else 'latest.json')
        if target.is_file():
            data=target.read_bytes()
            if len(data)>5_000_000: h.send_json(413,{'error':'Artifact too large'}); return True
            h.send_response(200); h.send_header('Content-Type','application/octet-stream' if match[2]=='splat' else 'application/json'); h.send_header('Content-Length',str(len(data))); h.end_headers(); h.wfile.write(data); return True
    conn=None
    try:
        body=None
        if method=='POST':
            n=int(h.headers.get('Content-Length','0'))
            if n<2 or n>MAX_BODY:
                h.send_json(413,{'error':'Use a JPEG keyframe under 640 px; request limit 1.2 MB'}); return True
            # body() is bounded again here; never relay raw arbitrary HTTP headers.
            body=json.dumps(h.body(),allow_nan=False).encode()
            if len(body)>MAX_BODY: h.send_json(413,{'error':'Too large'}); return True
        conn=UnixConnection('localhost',timeout=15)
        conn.request(method,'/'+sub,body=body,headers={'Content-Type':'application/json','Content-Length':str(len(body or b''))})
        res=conn.getresponse(); raw=res.read(5_000_001)
        if len(raw)>5_000_000: raise ValueError('Oversized GPU response')
        h.send_response(res.status); h.send_header('Content-Type',res.getheader('Content-Type','application/json')); h.send_header('Content-Length',str(len(raw))); h.end_headers(); h.wfile.write(raw)
    except (OSError,http.client.HTTPException):
        h.send_json(503,{'error':'Live scan GPU worker unavailable; retry shortly','service':'garden-room-scan-live'})
    except (ValueError,TypeError): h.send_json(400,{'error':'Invalid scan request'})
    finally:
        if conn: conn.close()
    return True
