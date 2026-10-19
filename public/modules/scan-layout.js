// Whole-scan review. Saving a proposal never temporarily mutates the live room.
export function initScanLayout(GR, getPlan) {
  const esc = GR.esc || ((s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])));
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/modules/scan-layout.css'; document.head.append(css);
  let dialog, proposal, scanId, decisions = {}, baseline, undoState, appliedFingerprint, placing = null, pending = false;
  const fingerprint = () => JSON.stringify(getPlan());
  const request = async (path, body) => { const r = await GR.api(path, body === undefined ? {} : {method:'POST',body:JSON.stringify(body)}); if(r.error) throw new Error(r.error); return r; };
  function mount(title) {
    dialog?.remove(); dialog = document.createElement('section'); dialog.id = 'scan-layout-review'; dialog.className = 'scan-review'; dialog.setAttribute('role','dialog'); dialog.setAttribute('aria-label',title); dialog.setAttribute('aria-modal','true');
    dialog.innerHTML = `<header><h2>${esc(title)}</h2><button class="btn" data-close aria-label="Close scan review">×</button></header><div class="scan-review-body"></div><footer></footer>`;
    const host = !document.querySelector('#gr-ar')?.hidden && GR.ar?.status().active ? document.querySelector('#gr-ar') : document.body;
    host.append(dialog); dialog.querySelector('[data-close]').onclick = () => dialog.remove(); dialog.querySelector('[data-close]').focus();
    dialog.onkeydown = (e) => { if(e.key==='Escape') dialog.remove(); if(e.key==='Tab') {const focus=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select,summary')].filter(el=>el.getClientRects().length); const first=focus[0],last=focus.at(-1); if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}} };
    return dialog.querySelector('.scan-review-body');
  }
  async function run(fn) { if(pending) return; pending=true; try { await fn(); } catch(e) { GR.toast(e.message,6000); if(dialog?.isConnected) dialog.querySelector('[data-message]')?.replaceChildren(document.createTextNode(e.message)); } finally { pending=false; } }
  async function history() {
    const body = mount('Scan history'); body.innerHTML = '<p>Loading private scans…</p>';
    const rows = await request('/api/scan_live/history');
    body.innerHTML = rows.length ? rows.map((s)=>`<article class="scan-history-row"><div><b>${esc(s.createdAt ? new Date(s.createdAt).toLocaleString() : s.id.slice(0,8))}</b><p class="micro">${esc(s.state)} · ${s.frames} frames · ${s.detections} observations · ${s.metric ? 'AR metres' : '2D / scale unknown'}</p></div><button class="btn" data-review="${esc(s.id)}">Review</button></article>`).join('') : '<p>No scans yet. Finished scans stay here for later import.</p>';
    body.querySelectorAll('[data-review]').forEach((b)=>b.onclick=()=>run(()=>review(b.dataset.review)));
  }
  async function refresh() {
    const plan = getPlan(), sourceFingerprint = JSON.stringify(plan);
    proposal = await request(`/api/scan_live/${scanId}/proposal`, {plan,decisions}); baseline=sourceFingerprint; render(); return proposal;
  }
  async function review(id) {
    scanId=id; decisions={}; placing=null; await refresh(); return proposal;
  }
  function itemsForSelection() {
    const items = structuredClone(getPlan().items);
    for(const c of proposal.changes) if(c.included && c.allowed && c.after) { const i=items.findIndex((it)=>it.id===c.id); if(i<0) items.push(structuredClone(c.after)); else items[i]=structuredClone(c.after); }
    return items;
  }
  function guard() {
    if(baseline!==fingerprint()) throw new Error('Room changed since review. Refresh scan review before importing.');
    const items=itemsForSelection(), issues=GR.checkPlan?.(items)||[];
    if(issues.length) throw new Error('Resolve or exclude changes: '+issues.join('; '));
    if(!proposal.changes.some(c=>c.included)) throw new Error('Select a located change first. Align AR or place a detection on the map.');
    return items;
  }
  async function save() {
    const items=guard(); const r=await GR.saveLayout(proposal.name,{items,room:getPlan().room,scanId});
    dialog.querySelector('[data-message]').textContent='Saved '+r.saved+' — room unchanged. Use Apply to room when ready.'; return r;
  }
  function apply() {
    const items=guard(); undoState=structuredClone(getPlan()); GR.applyPlan(items,'Scan applied · Undo available in review'); appliedFingerprint=fingerprint(); baseline=appliedFingerprint; render(); return true;
  }
  function undo() {
    if(!undoState) return false;
    if(fingerprint()!==appliedFingerprint) throw new Error('Room changed after import. Undo would overwrite your edits.');
    GR.applyPlan(undoState.items,'Scan import undone'); undoState=null; baseline=fingerprint(); render(); return true;
  }
  function map(items, editable=false) {
    const poly=getPlan().room.poly, xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]); const x0=Math.min(...xs)-.1,z0=Math.min(...zs)-.1,w=Math.max(...xs)-x0+.1,h=Math.max(...zs)-z0+.1;
    const selected=new Set(proposal.changes.filter(c=>c.included).map(c=>c.id));
    return `<svg ${editable?'id="scan-proposed-map" tabindex="0" role="img" aria-label="Scanned room mini-map; select Place on map then tap a location"':'role="img" aria-label="Current room mini-map"'} viewBox="${x0} ${z0} ${w} ${h}" data-x0="${x0}" data-z0="${z0}" data-w="${w}" data-h="${h}"><polygon points="${poly.map(p=>p.join(',')).join(' ')}" fill="#242d27" stroke="#a4b89d" stroke-width=".025"/>${items.map(it=>{ const f=GR.footprint(it); return `<rect x="${f.x0}" y="${f.z0}" width="${f.x1-f.x0}" height="${f.z1-f.z0}" rx="${it.kind==='plant'?.04:0}" fill="${selected.has(it.id)&&editable?'#d1b875':it.kind==='plant'?'#73a782':'#8a9691'}" opacity=".85"><title>${esc(it.name)}</title></rect>`; }).join('')}${placing?'<text x="'+(x0+.15)+'" y="'+(z0+.22)+'" font-size=".13" fill="#ffe4a5">Tap position for selected detection</text>':''}</svg>`;
  }
  function render() {
    if(!proposal) return;
    const items=itemsForSelection(), issues=GR.checkPlan?.(items)||[],selected=proposal.changes.filter(c=>c.included).length;
    const body=mount('Import scan as layout');
    body.innerHTML=`<p class="sub">Review before changing the room. Gold footprints are selected changes. Unseen items stay where they are.</p><div class="scan-compare"><figure><figcaption>Current</figcaption>${map(getPlan().items)}</figure><figure><figcaption>Scanned · ${selected} selected</figcaption>${map(items,true)}</figure></div><p class="micro" data-message role="status">${esc(proposal.warnings.join(' '))}</p>${issues.length?'<p class="scan-review-warning">'+esc(issues.join(' · '))+'</p>':''}<div class="scan-review-items">${proposal.changes.filter(c=>c.object).map(c=>row(c)).join('')}<details class="scan-not-seen"><summary>${proposal.notSeen} not seen — kept unchanged</summary>${proposal.changes.filter(c=>!c.object).map(c=>`<p class="micro">${esc(c.name)} · not seen</p>`).join('')}</details></div>`;
    const footer=dialog.querySelector('footer'); footer.innerHTML=`<button class="btn" id="scan-review-refresh">Refresh scan</button><button class="btn" id="scan-review-save" ${!selected||issues.length?'disabled':''}>Import as new layout</button><button class="btn gold" id="scan-review-apply" ${!selected||issues.length?'disabled':''}>Apply to room</button><button class="btn" id="scan-review-undo" ${!undoState?'disabled':''}>Undo import</button>`;
    footer.querySelector('#scan-review-save').onclick=()=>run(save);footer.querySelector('#scan-review-apply').onclick=()=>run(apply);footer.querySelector('#scan-review-undo').onclick=()=>run(undo);footer.querySelector('#scan-review-refresh').onclick=()=>run(refresh);
    body.querySelectorAll('[data-include]').forEach(el=>el.onchange=()=>{const c=proposal.changes.find(c=>c.object===el.dataset.include);c.included=el.checked;decisions[c.object]={...decisions[c.object],include:el.checked};render();});
    body.querySelectorAll('[data-identity]').forEach(el=>el.onchange=()=>run(async()=>{decisions[el.dataset.identity]={...decisions[el.dataset.identity],itemId:el.value,include:true};await refresh();}));
    body.querySelectorAll('[data-place]').forEach(el=>el.onclick=()=>{placing=el.dataset.place;render();dialog.querySelector('#scan-proposed-map').focus();});
    body.querySelector('#scan-proposed-map').onclick=(event)=>{if(!placing)return;const svg=event.currentTarget,pt=new DOMPoint(event.clientX,event.clientY).matrixTransform(svg.getScreenCTM().inverse()),key=placing;decisions[key]={...decisions[key],x:pt.x,z:pt.y,include:true};placing=null;run(refresh);};
    body.querySelectorAll('[data-coords]').forEach(el=>el.onclick=()=>run(async()=>{const key=el.dataset.coords,article=el.closest('article');decisions[key]={...decisions[key],x:Number(article.querySelector('[data-x]').value),z:Number(article.querySelector('[data-z]').value),include:true};await refresh();}));
  }
  function row(c) {
    const p=c.after||c.position,change=c.distanceM===null||c.distanceM===undefined?'':` · ${Math.round(c.distanceM*100)} cm move`;
    const eligible=getPlan().items.filter(it=>c.candidates?.some(v=>v.id===it.id)|| (c.detection==='potted plant' && it.kind==='plant') || c.after?.kind==='plant'&&it.kind==='plant');
    const thumb=c.after?.src||c.before?.src;
    return `<article class="scan-review-item" data-object="${esc(c.object)}"><label class="scan-review-choice"><input type="checkbox" data-include="${esc(c.object)}" ${c.included?'checked':''} ${!c.allowed?'disabled':''}>${thumb?`<img src="/${esc(thumb)}" alt="">`:''}<span><b>${esc(c.name)}</b><span class="micro">${esc(c.status)} · ${Math.round(c.confidence*100)}% confidence${change}${c.manualPosition?' · manually located':''}</span></span></label><p class="micro">${c.before?`Current ${c.before.x.toFixed(2)}, ${c.before.z.toFixed(2)} m → `:''}${p?`${p.x.toFixed(2)}, ${p.z.toFixed(2)} m`:'Position not measured'}${c.measurement?.heightM?` · visible foliage ~${Math.round(c.measurement.heightM*100)} cm`:''}</p>${c.reasons.length?`<p class="micro scan-review-warning">${esc(c.reasons.join(' · '))}</p>`:''}<details><summary>Confirm identity / position</summary>${eligible.length?`<select aria-label="Identity for ${esc(c.object)}" data-identity="${esc(c.object)}"><option value="">Choose known item</option>${eligible.map(it=>`<option value="${esc(it.id)}" ${it.id===c.id?'selected':''}>${esc(it.name)}</option>`).join('')}</select>`:''}<div class="row"><button class="btn" data-place="${esc(c.object)}">Place on map</button><label>x <input data-x type="number" step=".01" value="${p?.x?.toFixed(2)||''}" aria-label="Room x metres"></label><label>z <input data-z type="number" step=".01" value="${p?.z?.toFixed(2)||''}" aria-label="Room z metres"></label><button class="btn" data-coords="${esc(c.object)}">Set position</button></div><p class="micro">Manual positions are your estimates, not scanned measurements. Dimensions stay unchanged for known items; foliage size is not pot depth.</p></details></article>`;
  }
  return {review,history,refresh,save,apply,undo,proposal:()=>structuredClone(proposal)};
}
