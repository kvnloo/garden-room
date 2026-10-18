import { execFileSync } from 'node:child_process';
console.log(execFileSync('python3', ['-c', `
import json,os,pathlib,sys,tempfile,time
sys.path.insert(0,'tools')
import replay_common as r
with tempfile.TemporaryDirectory(dir=os.environ['TMPDIR'],prefix='replay-unit-') as tmp:
 r.DATA=pathlib.Path(tmp)/'replay';r.VOICE=pathlib.Path(tmp)/'voice'
 r.MAX_BYTES=2000000;r.DISK_BYTES=None;r.LAST_PRUNE=0
 now=int(time.time()*1000)
 key=(r.ROOT/'data/.token').read_text().strip()
 event={'type':5,'timestamp':now,'data':{'tag':'gr:console','payload':{'text':key+' ?k='+key}}}
 body={'session':'unit','batch':1,'events':[{'type':4,'timestamp':now-1,'data':{'width':412,'height':915}},event]}
 assert r.ingest(body)['ok']
 assert r.ingest(body)['duplicate']
 p=r.DATA/'sessions/unit/batch-00000001.json'
 assert key not in p.read_text() and '[redacted]' in p.read_text()
 assert p.stat().st_mode & 0o777 == 0o600
 try:r.ingest({**body,'batch':3})
 except ValueError:pass
 else:raise AssertionError('sequence accepted a gap')
 try:r.ingest({**body,'session':'../escape'})
 except ValueError:pass
 else:raise AssertionError('path traversal accepted')
 r.ingest({**body,'batch':2,'events':[{'type':5,'timestamp':now+1,'data':{'tag':'gr:state','payload':{'sheet':'Items'}}}]})
 assert len(r.load_events('unit',after=1)['events'])==1
 assert len(r.timeline('unit',since=now-100,until=now+100))==2
 item={'ts':now/1000,'kind':'complaint','text':'unit'}
 assert r.inbox_id(item)==r.inbox_id(dict(item))
 assert r.delivery_context(item)['status']=='pending'
 old=r.DATA/'complaints/old';old.mkdir(parents=True);f=old/'old.json';f.write_text('{}');os.utime(f,(time.time()-8*86400,)*2)
 r.LAST_PRUNE=0;r.prune();assert not old.exists()
 r.MAX_BYTES=1;r.LAST_PRUNE=0;r.prune();assert not (r.DATA/'sessions/unit').exists()
 print('PASS redaction, private permissions, retry dedupe, ordered batches, path validation, cursor pagination, timeline, stable complaint IDs, 7-day retention, byte cap')
`], { encoding: 'utf8' }));
