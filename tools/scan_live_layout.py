"""Review-only room-coordinate proposals. Stdlib, shared by worker and history API.
Never treats orientation-only video or arbitrary-scale COLMAP as measured metres.
"""
from copy import deepcopy
from datetime import datetime, timezone
import math
import re


def finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def assignment(scores):
    """Rectangular Hungarian assignment with private unmatched columns (score .42)."""
    if not scores or not scores[0]: return [None] * len(scores)
    n, real = len(scores), len(scores[0]); m = real + n
    cost = [[-s for s in row] + [-.42] * n for row in scores]
    u, v, p, way = [0.]*(n+1), [0.]*(m+1), [0]*(m+1), [0]*(m+1)
    for i in range(1,n+1):
        p[0]=i; j0=0; mins=[float('inf')]*(m+1); used=[False]*(m+1)
        while True:
            used[j0]=True; i0=p[j0]; delta=float('inf'); j1=0
            for j in range(1,m+1):
                if used[j]: continue
                cur=cost[i0-1][j-1]-u[i0]-v[j]
                if cur<mins[j]: mins[j]=cur; way[j]=j0
                if mins[j]<delta: delta=mins[j]; j1=j
            for j in range(m+1):
                if used[j]: u[p[j]]+=delta; v[j]-=delta
                else: mins[j]-=delta
            j0=j1
            if p[j0]==0: break
        while True:
            j1=way[j0]; p[j0]=p[j1]; j0=j1
            if j0==0: break
    out=[None]*n
    for j in range(1,m+1):
        if p[j] and j<=real: out[p[j]-1]=j-1
    return out


def room_position(d, metric, t):
    if not metric or d.get('metric') is False: return None
    # Re-transform raw XR coordinates, rather than trusting an earlier alignment.
    p=d.get('position')
    if not isinstance(t,dict) or not all(finite(t.get(k)) for k in ('angle','tx','tz','floor')): return None
    if not isinstance(p,dict) or not all(finite(p.get(k)) for k in ('x','y','z')): return None
    c,s=math.cos(t['angle']),math.sin(t['angle'])
    return dict(x=c*p['x']-s*p['z']+t['tx'],z=s*p['x']+c*p['z']+t['tz'],y=p['y']-t['floor'])


def footprint(it):
    w,d=it.get('w',.2),it.get('d',.2)
    if it.get('rot',0)%2: w,d=d,w
    return (it['x']-w/2,it['z']-d/2,it['x']+w/2,it['z']+d/2)


def inside(poly,x,z):
    result=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        cross=(x-a[0])*(b[1]-a[1])-(z-a[1])*(b[0]-a[0])
        if abs(cross)<1e-8 and min(a[0],b[0])-1e-8<=x<=max(a[0],b[0])+1e-8 and min(a[1],b[1])-1e-8<=z<=max(a[1],b[1])+1e-8: return True
        if (a[1]>z)!=(b[1]>z) and x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]: result=not result
    return result


def constraints(it,items,room):
    f=footprint(it); poly=room.get('poly',[]); reasons=[]
    if len(poly)<3 or not all(inside(poly,x,z) for x,z in ((f[0],f[1]),(f[2],f[1]),(f[2],f[3]),(f[0],f[3]))): reasons.append('Outside room bounds')
    fridge=next((i for i in items if i.get('kind')=='fridge'),None)
    if fridge and it['id']!=fridge['id']:
        x0,z0,x1,z1=footprint(fridge); dp=max(fridge['w'],.75)+.1
        swing=[(x0,z1,x1,z1+dp),(x0-dp,z0,x0,z1),(x0,z0-dp,x1,z0),(x1,z0,x1+dp,z1)][fridge.get('rot',0)%4]
        if min(f[2],swing[2])-max(f[0],swing[0])>.01 and min(f[3],swing[3])-max(f[1],swing[1])>.01: reasons.append('Blocks fridge door swing')
    return reasons


def eligible(label,it):
    kind=it.get('kind',''); name=it.get('name','').lower()
    return {'potted plant':kind=='plant','refrigerator':kind=='fridge',
            'china cabinet':kind=='china' or bool(re.search('china|cabinet|hutch',name)),
            'dining table':kind in ('table','glass'),'glass table':kind in ('glass','table'),
            'floor lamp':kind in ('lamp5','ring')}.get(label,False)


def build_proposal(plan,detections,metric=False,alignment=None,scan_id='scan',decisions=None,created_at=None):
    current=deepcopy(plan.get('items',[])); room=deepcopy(plan.get('room',{})); decisions=decisions or {}
    if len(decisions)>100: raise ValueError('Too many review decisions')
    ds=[deepcopy(d) for d in detections[:100] if d.get('label') in ('potted plant','refrigerator','china cabinet','dining table','glass table','floor lamp')]
    # Repeated tracks at the same localized centre are one observation, not new pots.
    unique=[]
    for d in sorted(ds,key=lambda d:-(d.get('views',0)+d.get('confidence',0))):
        d['_pos']=room_position(d,metric,alignment)
        if d['_pos'] and any(o['label']==d['label'] and o['_pos'] and math.hypot(o['_pos']['x']-d['_pos']['x'],o['_pos']['z']-d['_pos']['z'])<.10 for o in unique): continue
        unique.append(d)
    ds=unique; scores=[]; evidence=[]
    for d in ds:
        candidates={c['id']:c for c in d.get('identity',{}).get('candidates',[])}; row=[]; ev=[]
        for it in current:
            if not eligible(d['label'],it): row.append(-1.); ev.append({}); continue
            c=candidates.get(it['id'],{}); app=c.get('appearanceSimilarity',0.); pos=d['_pos']
            distance=math.hypot(pos['x']-it['x'],pos['z']-it['z']) if pos else None
            continuity=math.exp(-distance/.65) if distance is not None else 0
            measured=d.get('plant',{}).get('heightM'); expected=it.get('height')
            size=math.exp(-abs(math.log(max(.03,measured)/max(.03,expected)))) if finite(measured) and finite(expected) else .5
            # Similar leaf hues alone cannot confidently identify one of 25 plants.
            score=.4*app+.45*continuity+.15*size if it.get('kind')=='plant' else .3+.7*continuity if pos else .3
            if not pos and it.get('kind')=='plant': score=.5*app
            row.append(score); ev.append(dict(appearance=round(app,3),distanceM=distance,sizeSimilarity=round(size,3)))
        scores.append(row); evidence.append(ev)
    matches=assignment(scores); changes=[]; used=set(); warnings=[]
    for idx,d in enumerate(ds):
        key=d['id']; decision=decisions.get(key,{})
        if not isinstance(decision,dict): raise ValueError('Invalid review decision')
        match=matches[idx]; explicit=decision.get('itemId')
        if explicit:
            match=next((j for j,it in enumerate(current) if it['id']==explicit and eligible(d['label'],it)),None)
            if match is None: raise ValueError('Review item does not match detection type')
        it=deepcopy(current[match]) if match is not None else None
        if it and it['id'] in used: it=None
        pos=d['_pos']; manually_placed=False
        if 'x' in decision or 'z' in decision:
            if not all(finite(decision.get(k)) and abs(decision[k])<100 for k in ('x','z')): raise ValueError('Invalid review position')
            pos={k:decision[k] for k in ('x','z')}; manually_placed=True
        ranked=sorted([(scores[idx][j],j) for j in range(len(current)) if eligible(d['label'],current[j])],reverse=True)
        candidates=[dict(id=current[j]['id'],name=current[j]['name'],score=round(s,3),**evidence[idx][j]) for s,j in ranked[:5]]
        score=scores[idx][match] if it else 0; detail=evidence[idx][match] if it else {}
        gap=score-max([s for s,j in ranked if j!=match]+[0])
        confident=bool(it and pos and d.get('views',0)>=3 and d.get('confidence',0)>=.35 and ((d['label']!='potted plant' and score>.7) or (score>.65 and gap>.06)))
        if explicit: confident=True
        reasons=[]; new=False
        if it is None:
            best_app=max([c.get('appearanceSimilarity',0) for c in d.get('identity',{}).get('candidates',[])]+[0])
            far=not ranked or ranked[0][0]<.42
            size=d.get('size',{}); width=d.get('plant',{}).get('widthM') or size.get('w'); height=size.get('h')
            if d['label']=='potted plant' and pos and d.get('confidence',0)>=.5 and d.get('views',0)>=3 and (best_app<.55 or far) and all(finite(v) and .05<v<3.5 for v in (width,height)):
                safe=re.sub('[^a-zA-Z0-9_-]','',str(scan_id)+'-'+str(key))[:80]
                it=dict(id='scan-'+safe,kind='plant',name='Unknown plant',x=pos['x'],z=pos['z'],rot=0,w=width,d=width,potD=width,potH=min(.25,height*.25),height=height-min(.25,height*.25),h=height,light='med',family='broadleaf_shrub',pot='dark_plastic',box=False)
                new=True; confident=True; score=d['confidence']; reasons.append('Foliage width used as conservative footprint; pot depth not measured')
            else:
                changes.append(dict(object=key,id=None,name='Unmatched '+d['label'],status='unmatched',confidence=round(max([s for s,j in ranked]+[0]),3),included=False,allowed=False,reasons=['Confirm identity and place on map' if not pos else 'Identity uncertain; choose a known item'],candidates=candidates,detection=d['label'],position=pos,measurement=d.get('plant')))
                continue
        before=None if new else deepcopy(it); after=deepcopy(it)
        if pos: after.update(x=pos['x'],z=pos['z'])
        if not pos: reasons.append('No metric room position: align AR, or place manually on the review map')
        if it.get('locked'): reasons.append('Item locked; unlock in Edit before importing this change')
        blocks=constraints(after,current,room) if pos else []
        reasons.extend(blocks)
        allowed=bool(pos and not it.get('locked') and not blocks)
        changed=new or (pos and math.hypot(after['x']-before['x'],after['z']-before['z'])>.005)
        included=bool(allowed and (confident or decision.get('include') is True) and changed and decision.get('include',True))
        used.add(it['id'])
        changes.append(dict(object=key,id=it['id'],name=it['name'],status='new' if new else 'matched' if confident else 'uncertain',confidence=round(score,3),included=included,allowed=allowed,reasons=reasons,candidates=candidates,before=before,after=after,position=pos,distanceM=None if new or not pos else math.hypot(after['x']-before['x'],after['z']-before['z']),evidence=detail,manualPosition=manually_placed,measurement=d.get('plant')))
    for it in current:
        if it['id'] not in used: changes.append(dict(object=None,id=it['id'],name=it['name'],status='not seen',confidence=0,included=False,allowed=False,before=deepcopy(it),after=deepcopy(it),reasons=['Not seen — kept in current position']))
    def compose():
        items=deepcopy(current)
        for c in changes:
            if not c['included']: continue
            found=next((i for i,it in enumerate(items) if it['id']==c['id']),None)
            if found is None: items.append(deepcopy(c['after']))
            else: items[found]=deepcopy(c['after'])
        return items
    # Recheck the composed layout: moving a fridge also moves its swing zone.
    # Reject conflicting changes rather than silently relocating unseen objects.
    items=compose()
    while True:
        rejected=[]
        for c in changes:
            if not c['included']: continue
            blocks=constraints(c['after'],items,room)
            if c['after']['kind']=='fridge':
                for it in items:
                    if 'Blocks fridge door swing' in constraints(it,items,room) and 'Blocks fridge door swing' not in constraints(it,current,room):
                        blocks.append('Fridge door swing would reach '+it['name'])
            if blocks:
                c['included']=False; c['allowed']=False; c['reasons'].extend(blocks); rejected.append(c)
        if not rejected: break
        items=compose()
    if not metric or not alignment: warnings.append('Scan has no aligned metric coordinates. Recognition is real; positions require AR alignment or explicit manual placement.')
    return dict(version=1,scanId=scan_id,name='Scan '+(created_at or datetime.now(timezone.utc).isoformat())[:16].replace('T',' '),createdAt=created_at or datetime.now(timezone.utc).isoformat(),coordinateFrame='room-x-east-z-south-metres',metric=bool(metric and alignment),room=room,items=items,changes=changes,warnings=warnings,selected=sum(c['included'] for c in changes),notSeen=sum(c['status']=='not seen' for c in changes))
