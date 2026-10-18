"""Authenticated bounded proxy to the private GPU process; stdlib only."""
import http.client
import json
import os
from pathlib import Path
import re
import socket
ROOT=Path(__file__).resolve().parents[1]
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
    match=re.fullmatch(r'([0-9a-f]{24})/(frame|status|stop|splat)',sub)
    if sub not in ('health','start') and not match:
        h.send_json(404,{'error':'No such scan route'}); return True
    expected='GET' if sub=='health' or (match and match[2] in ('status','splat')) else 'POST'
    if method!=expected:
        h.send_json(405,{'error':'Method not allowed'}); return True
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
