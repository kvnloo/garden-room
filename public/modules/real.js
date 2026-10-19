// A shutter captures once. Playback and polling never submit generation jobs.
export function layoutSnapshot(GR) {
  const keys = ['id','kind','name','src','family','pot','x','z','rot','w','d','h','potD','potH','height','attach','hinge','box'];
  return structuredClone({ room: GR.state.room, items: GR.state.items.map(it => Object.fromEntries(keys.filter(k => k in it).map(k => [k,it[k]]))), fridgeOpen: !!GR.state.fridgeOpen });
}

function base64(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(s);
}
const photoKey = p => p ? `${p.revision}/${p.id}` : '';
const createdTime = p => typeof p.created === 'number' ? p.created * (p.created < 1e12 ? 1000 : 1) : Date.parse(p.created) || 0;
const unfinished = p => !['ready','failed','needs-review','alignment-rejected','capture-failed'].includes(p.status?.state);
export function photoImage(p) {
  // Local previews are deliberately never presented as finished photographs.
  return p?.status?.hq ? (p.status.hq.url || `${p.base}real.png`) : '';
}
export function init(GR) {
  const { THREE, renderer, scene, camera, controls } = GR;
  const style = document.createElement('style');
  style.textContent = `
.real-image{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;opacity:0;object-fit:fill;transition:opacity .12s linear}
.real-image.developing{filter:blur(18px) saturate(.65);transform:scale(1.06);opacity:.88}
.real-chip{position:absolute;bottom:calc(env(safe-area-inset-bottom) + 132px);left:10px;max-width:calc(100% - 20px);z-index:3;padding:7px 12px;border-radius:18px;border:1px solid #b9a88155;background:#171b17ee;color:#e7dfca;font:11px system-ui;min-height:44px;cursor:pointer}
.real-chip[hidden],.real-exit[hidden]{display:none}.real-exit{position:absolute;top:calc(env(safe-area-inset-top) + 70px);right:12px;z-index:4;min-height:44px;padding:9px 14px;border:1px solid #d4bb7a66;border-radius:22px;background:#171b17ee;color:#eee9db;font:12px system-ui;cursor:pointer}
#bReal.real-shutter{border-radius:50%;border:2px solid #eee9db;outline:1px solid #d4bb7a88;outline-offset:3px;background:#eee9db;color:#182018;min-width:44px;min-height:44px}#bReal.real-shutter svg{width:24px;height:24px}
.real-flash{position:fixed;inset:0;background:#fff8e9;z-index:50;pointer-events:none;opacity:0}.real-flight{position:fixed;inset:0;z-index:49;pointer-events:none;object-fit:cover;border:3px solid #eee9db;border-radius:6px;box-sizing:border-box;transform-origin:center;width:100%;height:100%}
.real-album-arrival{animation:real-arrival .45s ease-out}@keyframes real-arrival{50%{filter:brightness(1.8);transform:scale(1.12)}}
@media(prefers-reduced-motion:reduce){.real-image{transition:none}.real-album-arrival{animation:none}.real-flight{display:none}}
`;
  document.head.appendChild(style);
  const image = document.createElement('img'); image.className='real-image';image.alt='Generated interpretation at the captured camera';
  const chip = document.createElement('button');chip.className='real-chip';chip.hidden=true;chip.id='real-status';chip.setAttribute('aria-live','polite');
  const exit = document.createElement('button');exit.className='real-exit';exit.id='real-exit';exit.textContent='Leave camera';exit.hidden=true;
  const flash = document.createElement('div');flash.className='real-flash';flash.setAttribute('aria-hidden','true');
  document.querySelector('#app').append(image,chip,exit,flash);
  const shutter = document.querySelector('#bReal');
  shutter.classList.add('real-shutter');shutter.innerHTML=GR.ICON.camera;shutter.removeAttribute('aria-pressed');shutter.setAttribute('aria-label','Camera shutter');shutter.title='Camera · take a photo';
  const root = new THREE.Group();root.name='Selected camera photo splat';
  let revision=null, signature='', epoch=0, enabled=false, selection=0, selected=null;
  let views=[], photos=[], splat=null, spark=null, sceneUrl=null, legacyScene=null, sceneTask=0, desiredScene='';
  let loadedImage='', imageReady=false, imageTask=0, galleryTask=0, pollTask=0, identifyTask=0, lastPoll=0, lastGallery=0;
  let normalPixelRatio=renderer.getPixelRatio(), lastFrame=performance.now(), nextLocal=0, audio=null, gallerySignature='', lastLayoutCheck=0;
  const pending=new Map(), deleted=new Set();
  const stats={captureMs:0,transferMs:0,decodeMs:0,count:0,frames:[],revision:null};
  function status(text) {if(chip.textContent!==text)chip.textContent=text;chip.hidden=!enabled;}
  function notify() {
    const next=JSON.stringify(photos.map(p=>[photoKey(p),p.status,p.base,p.created,p.plants]));
    if(next===gallerySignature)return;gallerySignature=next;
    window.dispatchEvent(new CustomEvent('real-photos-changed'));
  }
  function mergePhoto(previous, incoming) {
    if(!previous)return incoming;
    const old=previous.status||{},next=incoming.status||{};
    const status={...old,...next};
    if(old.hq&&!next.hq)status.hq=old.hq;
    if(old.splat||next.splat)status.splat={...old.splat,...next.splat};
    if(!unfinished(previous)&&['queued','generating','preview','photoreal','splatting'].includes(next.state))status.state=old.state;
    return {...previous,...incoming,status};
  }
  function sorted(list) {return list.sort((a,b)=>createdTime(b)-createdTime(a));}
  function upsert(p) {if(pending.has(photoKey(p)))pending.set(photoKey(p),p);photos=sorted([...photos.filter(v=>photoKey(v)!==photoKey(p)),p]);notify();}
  function pose() {return {position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),matrixWorld:camera.matrixWorld.toArray(),target:controls.target.toArray(),fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far};}
  function distance(c) {
    if(!c?.position||!c?.quaternion) return {angle:Infinity,move:Infinity,intrinsics:false};
    return {angle:THREE.MathUtils.radToDeg(new THREE.Quaternion().fromArray(c.quaternion).angleTo(camera.quaternion)),move:new THREE.Vector3().fromArray(c.position).distanceTo(camera.position),intrinsics:Math.abs(c.fov-camera.fov)<.0001&&Math.abs(c.aspect-camera.aspect)<.00001};
  }
  function photoOpacity(c) {
    const d=distance(c);if(!d.intrinsics||d.angle>=15||d.move>=.3)return 0;
    const t=Math.min(1,Math.max(d.angle/4,d.move/.08));
    return 1-t*t*(3-2*t);
  }
  function coverage() {const d=distance(selected?.camera);return !!splat&&d.intrinsics&&d.angle<15&&d.move<.3;}
  function hideImage() {image.style.opacity='0';image.classList.remove('developing');}
  function clearScene() {
    ++sceneTask;desiredScene='';if(splat){root.remove(splat);splat.dispose();splat=null;}sceneUrl=null;stats.count=0;
    GR.setRealCoverage(false);
  }
  function clearSelection() {selection++;selected=null;legacyScene=null;loadedImage='';imageReady=false;++imageTask;hideImage();clearScene();}
  function invalidate() {
    ++epoch;++pollTask;revision=null;views=[];stats.revision=null;clearSelection();
    status('Camera · layout changed · tap the shutter to take a photo');
  }
  function checkLayout() {const next=JSON.stringify(layoutSnapshot(GR));if(signature!==next){signature=next;invalidate();}}
  async function identify() {
    checkLayout();const mine=epoch,chosen=selection,task=++identifyTask,layout=layoutSnapshot(GR);
    const r=await GR.api('/api/real/layout',{method:'POST',body:JSON.stringify({layout})});
    if(mine!==epoch||chosen!==selection||task!==identifyTask)return null;if(r.error)throw new Error(r.error);
    revision=r.revision;stats.revision=revision;await poll();return r;
  }
  async function loadScene(meta) {
    const url=meta?.url||'';
    if(url===desiredScene)return;
    if(!url||meta.count>1_000_000){clearScene();return;}
    desiredScene=url;const mine=++sceneTask,chosen=selection;let next;
    try {
      const mod=await import('/vendor/spark/dist/spark.module.min.js');
      if(mine!==sceneTask||chosen!==selection)return;
      if(!spark){spark=new mod.SparkRenderer({renderer,maxStdDev:Math.sqrt(5),preUpdate:true});scene.add(spark);}
      const t=performance.now(),res=await fetch(url);if(!res.ok)throw new Error('Splat download '+res.status);
      const bytes=await res.arrayBuffer(),transferMs=performance.now()-t,decoded=performance.now();
      if(mine!==sceneTask||chosen!==selection)return;
      next=new mod.SplatMesh({fileBytes:new Uint8Array(bytes),fileType:'splat'});await next.initialized;
      if(mine!==sceneTask||chosen!==selection){next.dispose();return;}
      if(splat){root.remove(splat);splat.dispose();}
      splat=next;root.add(next);sceneUrl=url;stats.count=meta.count||0;stats.transferMs=transferMs;stats.decodeMs=performance.now()-decoded;
      renderPhoto();
      // Even when both assets were ready before the first poll, render coarse
      // once before downloading/refining the selected photo's fine representation.
      if(url===selected?.status?.splat?.coarse?.url)requestAnimationFrame(()=>requestAnimationFrame(()=>{if(mine===sceneTask&&chosen===selection)selectSplat();}));
    } catch(e){if(next&&next!==splat)next.dispose();if(mine===sceneTask){status('Camera · 3D view unavailable');console.warn('Camera splat',e);}}
  }
  function selectSplat() {
    if(!enabled||!selected){void loadScene(null);return;}
    const source=selected?.status?.splat;
    // A single shot wins over the old fused manifest, including during coarse loading.
    const legacy=selected.status?.state==='ready'&&photoImage(selected)?legacyScene:null;
    const firstCoarse=source?.coarse?.url&&sceneUrl!==source.coarse.url&&sceneUrl!==source.fine?.url;
    const meta=firstCoarse?source.coarse:source?.fine?.url?source.fine:source?.coarse?.url?source.coarse:source?.url?source:source?null:legacy;
    void loadScene(meta);
  }
  async function refreshPhotos() {
    const mine=++galleryTask;
    const r=await GR.api('/api/real/photos');
    if(mine!==galleryTask)return photos;
    if(r.error||!Array.isArray(r.photos))throw new Error(r.error||'Photos unavailable');
    const incoming=r.photos.filter(p=>!deleted.has(photoKey(p))).map(p=>mergePhoto(photos.find(old=>photoKey(old)===photoKey(p)),p));
    const keys=new Set(incoming.map(photoKey));
    // Retain submissions until the all-revisions index publishes them.
    photos=sorted([...incoming,...[...pending.values()].filter(p=>!keys.has(photoKey(p))&&!deleted.has(photoKey(p)))]);
    for(const p of incoming)if(!unfinished(p))pending.delete(photoKey(p));
    const updated=photos.find(p=>photoKey(p)===photoKey(selected));
    if(updated){selected=updated;selectSplat();renderPhoto();}
    notify();return photos;
  }
  async function poll() {
    if(!revision)return;
    const mine=++pollTask,rev=revision,chosen=selection,layoutEpoch=epoch;
    const r=await GR.api(`/api/real/${encodeURIComponent(rev)}/views`);
    if(mine!==pollTask||layoutEpoch!==epoch||rev!==revision||chosen!==selection)return;
    if(r.error)throw new Error(r.error);
    views=(r.views||[]).map(v=>({...v,revision:rev})).filter(v=>!deleted.has(photoKey(v)));legacyScene=r.scene||null;
    const updated=views.find(v=>photoKey(v)===photoKey(selected));
    if(updated&&!deleted.has(photoKey(updated))){selected=mergePhoto(selected,updated);upsert(selected);}
    selectSplat();renderPhoto();
  }
  function renderPhoto() {
    if(!enabled||!selected){hideImage();GR.setRealCoverage(false);return;}
    const opacity=photoOpacity(selected.camera),hq=photoImage(selected),waiting=unfinished(selected);
    const url=hq||selected.beauty||(selected.base?`${selected.base}view.jpg`:'');
    if(url!==loadedImage){
      loadedImage=url;imageReady=false;hideImage();const mine=++imageTask,chosen=selection;
      const loader=new Image();loader.onload=()=>{if(mine!==imageTask||chosen!==selection||!enabled)return;image.src=url;imageReady=true;renderPhoto();};
      loader.onerror=()=>{if(mine===imageTask){imageReady=false;hideImage();}};loader.src=url;
    }
    const developing=!hq;
    image.classList.toggle('developing',developing&&waiting&&imageReady&&opacity>0);
    image.alt=developing?'Blurred procedural capture · photo developing':'Generated photo interpretation at its capture pose';
    image.style.opacity=String(imageReady&&(hq||waiting)?opacity*(developing ? .88 : 1):0);
    const covered=coverage();GR.setRealCoverage(covered);
    if(opacity===0&&!covered)status('Camera · outside this photo’s view · procedural room');
    else if(!hq&&waiting)status('Photo developing · blurred procedural capture · saved in Almanac');
    else if(['failed','capture-failed','needs-review'].includes(selected.status?.state))status('Photo needs review · open Almanac');
    else if(covered&&opacity<.99)status('Camera · selected photo’s 3D view');
    else if(hq)status('Generated photo · saved in Almanac');
    else status('Camera · procedural room · tap the shutter to take a photo');
  }
  function shutterFeedback(data) {
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    flash.getAnimations().forEach(a=>a.cancel());
    flash.animate([{opacity:reduced ? .16 : .8},{opacity:0}],{duration:reduced?80:180,easing:'ease-out'});
    try {
      const Audio=window.AudioContext||window.webkitAudioContext;
      if(Audio){
        audio||=new Audio();if(audio.state==='suspended')void audio.resume().catch(()=>{});
        const at=audio.currentTime,osc=audio.createOscillator(),gain=audio.createGain();osc.type='triangle';
        osc.frequency.setValueAtTime(900,at);osc.frequency.exponentialRampToValueAtTime(180,at+.075);
        gain.gain.setValueAtTime(.055,at);gain.gain.exponentialRampToValueAtTime(.001,at+.095);
        osc.connect(gain);gain.connect(audio.destination);osc.start(at);osc.stop(at+.1);osc.onended=()=>{osc.disconnect();gain.disconnect();};
      }
    } catch { /* Sound is optional when the browser blocks audio. */ }
    const album=document.querySelector('#dock [data-panel="almanac"]');
    if(reduced){album?.classList.add('real-album-arrival');setTimeout(()=>album?.classList.remove('real-album-arrival'),400);return;}
    const thumb=document.createElement('img');thumb.className='real-flight';thumb.src=data.view;thumb.alt='';thumb.setAttribute('aria-hidden','true');document.body.append(thumb);
    const box=album?.getBoundingClientRect(),x=box?box.left+box.width/2:innerWidth-40,y=box?box.top+box.height/2:innerHeight-40;
    const animation=thumb.animate([{transform:'translate(0,0) scale(1)',opacity:.95},{transform:`translate(${x-innerWidth/2}px,${y-innerHeight/2}px) scale(.055)`,opacity:.2}],{duration:620,easing:'cubic-bezier(.2,.8,.2,1)',fill:'forwards'});
    animation.finished.catch(()=>{}).finally(()=>{thumb.remove();album?.classList.add('real-album-arrival');setTimeout(()=>album?.classList.remove('real-album-arrival'),450);});
  }
  function readTarget(target) {
    const {width:w,height:h}=target,pixels=new Uint8Array(w*h*4);renderer.readRenderTargetPixels(target,0,0,w,h,pixels);
    const flipped=new Uint8ClampedArray(pixels.length);
    for(let y=0;y<h;y++)flipped.set(pixels.subarray(y*w*4,(y+1)*w*4),(h-1-y)*w*4);
    return flipped;
  }
  function toImage(pixels,w,h,type) {
    const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').putImageData(new ImageData(pixels,w,h),0,0);return c.toDataURL(type,.9);
  }
  function capture() {
    const started=performance.now();camera.updateMatrixWorld();
    const c=pose(),scale=Math.min(1,1280/innerHeight,1280/innerWidth),w=Math.max(64,Math.round(innerWidth*scale)),h=Math.max(64,Math.round(innerHeight*scale));
    // Preserve the actual camera intrinsics. A phone viewport fits the cap without
    // resampling; desktop pixel rounding must never rewrite camera.aspect.
    const target=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true});target.texture.colorSpace=THREE.SRGBColorSpace;
    const rawTarget=new THREE.WebGLRenderTarget(w,h,{depthBuffer:true});
    const vertex=`varying float metricZ;varying vec2 texUV;void main(){texUV=uv;vec4 local=vec4(position,1.);
#ifdef USE_INSTANCING
local=instanceMatrix*local;
#endif
vec4 p=modelViewMatrix*local;metricZ=-p.z;gl_Position=projectionMatrix*p;}`;
    const labels=new Map(GR.state.items.map((it,i)=>[it.id,i+1]));
    const discard=`uniform sampler2D colorMap;uniform sampler2D alphaMap;uniform float hasMap;uniform float hasAlpha;uniform float cutoff;uniform vec3 objectId;varying vec2 texUV;varying float metricZ;void main(){float a=1.;if(hasMap>.5)a*=texture2D(colorMap,texUV).a;if(hasAlpha>.5)a*=texture2D(alphaMap,texUV).g;if(a<cutoff)discard;`;
    function renderPass(kind) {
      const saved=[],materials=[];
      try {
        GR.proceduralRoots.forEach(group=>group.traverse(o=>{
          if(!o.isMesh)return;
          saved.push([o,o.material,o.visible]);
          if((Array.isArray(o.material)?o.material:[o.material]).every(m=>!m.depthWrite)){o.visible=false;return;}
          const id=labels.get(o.userData.id)||0;
          const replace=m=>{
            const end=kind==='depth'?`float mm=floor(metricZ*1000.+.5);gl_FragColor=vec4(mod(mm,256.),mod(floor(mm/256.),256.),floor(mm/65536.),255.)/255.;}`:`gl_FragColor=vec4(objectId,1.);}`;
            const mat=new THREE.ShaderMaterial({vertexShader:vertex,fragmentShader:discard+end,side:m.side,toneMapped:false,
              uniforms:{colorMap:{value:m.map||null},alphaMap:{value:m.alphaMap||null},hasMap:{value:m.map?1:0},hasAlpha:{value:m.alphaMap?1:0},cutoff:{value:m.alphaTest||.001},objectId:{value:new THREE.Vector3((id%256)/255,Math.floor(id/256)/255,0)}}});
            materials.push(mat);return mat;
          };
          o.material=Array.isArray(o.material)?o.material.map(replace):replace(o.material);
        }));
        renderer.setRenderTarget(rawTarget);renderer.render(scene,camera);return readTarget(rawTarget);
      } finally {for(const [o,m,v] of saved){o.material=m;o.visible=v;}materials.forEach(m=>m.dispose());}
    }
    let beauty,depthBytes,ids;
    const oldTarget=renderer.getRenderTarget(),oldOverride=scene.overrideMaterial,oldBackground=scene.background;
    try {
      GR.withProceduralRender(()=>{
        scene.background=new THREE.Color(0x0c0c0a);renderer.setRenderTarget(target);renderer.render(scene,camera);beauty=readTarget(target);
        scene.background=new THREE.Color(0);scene.overrideMaterial=null;
        depthBytes=renderPass('depth');ids=renderPass('ids');
      });
    } finally {
      scene.overrideMaterial=oldOverride;scene.background=oldBackground;renderer.setRenderTarget(oldTarget);
      target.dispose();rawTarget.dispose();
    }
    const depth=new Float32Array(w*h);
    for(let i=0;i<depth.length;i++){const j=i*4;depth[i]=(depthBytes[j]+depthBytes[j+1]*256+depthBytes[j+2]*65536)/1000;}
    const visibleIds=new Set();
    for(let i=0;i<ids.length;i+=4)visibleIds.add(ids[i]+ids[i+1]*256);
    const plants=GR.state.items.filter((it,i)=>it.kind==='plant'&&visibleIds.has(i+1)).map(it=>({id:it.id,name:it.name,family:it.family,src:it.src}));
    const result={camera:c,plants,view:toImage(beauty,w,h,'image/jpeg'),ids:toImage(ids,w,h,'image/png'),
      depth:{width:w,height:h,encoding:'float32-le-meters-camera-z',data:base64(new Uint8Array(depth.buffer))},
      objects:GR.state.items.map((it,i)=>({id:it.id,kind:it.kind,label:i+1})),layout:layoutSnapshot(GR)};
    result.captureMs=performance.now()-started;stats.captureMs=result.captureMs;return result;
  }
  async function requestView(retry=false) {
    // No await is allowed above capture: this is the tap's camera, even if a
    // request or layout lookup later stalls while the user keeps moving.
    let data;
    try {checkLayout();data=capture();} catch(e){GR.toast('Camera capture failed: '+e.message);return null;}
    GR.setRealLook(true);clearSelection();
    const mine=epoch,chosen=selection,local={id:`shutter-${++nextLocal}`,revision:'pending',camera:data.camera,plants:data.plants,created:Date.now()/1000,beauty:data.view,status:{state:'queued'}};
    selected=local;pending.set(photoKey(local),local);upsert(local);shutterFeedback(data);renderPhoto();
    try {
      data.retry=!!retry;data.explicit=true;
      const r=await GR.api('/api/real/view',{method:'POST',body:JSON.stringify(data)});
      if(r.error)throw new Error(r.error);
      if(!r.id||!r.revision)throw new Error('Photo receipt missing');
      pending.delete(photoKey(local));photos=photos.filter(p=>photoKey(p)!==photoKey(local));
      const saved={...local,id:r.id,revision:r.revision,base:r.base||`/renders/real/${r.revision}/${r.id}/`,status:r.status||{state:'queued'}};
      if(!deleted.has(photoKey(saved))){pending.set(photoKey(saved),saved);upsert(saved);}
      if(mine===epoch&&chosen===selection&&enabled&&!deleted.has(photoKey(saved))){
        selected=saved;revision=r.revision;stats.revision=revision;renderPhoto();void poll().catch(()=>{});
      }
      void refreshPhotos().catch(()=>{});return r;
    } catch(e){
      pending.delete(photoKey(local));local.status={state:'capture-failed',error:e.message};upsert(local);
      if(mine===epoch&&chosen===selection){selected=local;renderPhoto();status('Photo could not be saved · '+e.message);}
      return null;
    }
  }
  function setEnabled(on) {
    on=!!on;
    if(on&&!enabled){normalPixelRatio=renderer.getPixelRatio();renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));}
    if(!on&&enabled){renderer.setPixelRatio(normalPixelRatio);selection++;++imageTask;loadedImage='';imageReady=false;clearScene();}
    enabled=on;root.visible=on;chip.hidden=!on;exit.hidden=!on;
    if(!on){hideImage();GR.setRealCoverage(false);return;}
    status('Camera · tap the shutter to take a photo');selectSplat();renderPhoto();
  }
  function choose(photo) {
    checkLayout();clearSelection();selected=photo;revision=photo.revision;stats.revision=revision;
    GR.setRealLook(true);selectSplat();renderPhoto();void poll().catch(()=>{});
  }
  function goToView(photo) {
    if(!photo?.camera)return;
    GR.almanac?.close();GR.closeSheet();
    const c=photo.camera,q=new THREE.Quaternion().fromArray(c.quaternion),forward=new THREE.Vector3(0,0,-1).applyQuaternion(q);
    const distance=Math.max(.1,controls.target.distanceTo(camera.position));
    controls.enabled=true;controls.update();camera.position.fromArray(c.position);camera.quaternion.copy(q);
    controls.target.copy(camera.position).addScaledVector(forward,c.target?new THREE.Vector3().fromArray(c.target).distanceTo(camera.position):distance);
    camera.fov=c.fov;camera.near=c.near??camera.near;camera.far=c.far??camera.far;camera.updateProjectionMatrix();controls.update();camera.updateMatrixWorld();
    choose(photo);
  }
  function walkAround(photo) {goToView(photo);GR.toast('Drag to walk around · nearby 3D view only');}
  function openPhoto(photo) {if(photo&&!deleted.has(photoKey(photo)))upsert(photo);return GR.almanac?.openPhoto(photo);}
  async function deletePhoto(photo) {
    const key=photoKey(photo);
    if(photo.revision==='pending'&&photo.status?.state!=='capture-failed')throw new Error('Wait for the photo to be saved');
    if(photo.revision!=='pending'){
      const r=await GR.api(`/api/real/photo/${encodeURIComponent(photo.revision)}/${encodeURIComponent(photo.id)}/delete`,{method:'POST',body:'{}'});
      if(r.error||!r.ok)throw new Error(r.error||'Photo could not be deleted');
    }
    deleted.add(key);++galleryTask;pending.delete(key);photos=photos.filter(p=>photoKey(p)!==key);views=views.filter(p=>photoKey(p)!==key);
    if(photoKey(selected)===key){clearSelection();status('Photo deleted · procedural room');}
    notify();return true;
  }
  chip.onclick=()=>{if(selected)openPhoto(selected);else GR.almanac?.openPhotos();};
  exit.onclick=()=>{GR.setRealLook(false);shutter.focus();};
  GR.addPanel('real',()=>GR.almanac?.openPhotos());
  GR.real={capture,requestView,poll,identify,setEnabled,openPhoto,goToView,walkAround,refreshPhotos,deletePhoto,
    get stats(){return stats;},get views(){return views;},get photos(){return photos;},get revision(){return revision;},get enabled(){return enabled;},get coverage(){return coverage();},get selected(){return selected;},get sceneUrl(){return sceneUrl;}};
  GR.setRealScene(root);signature=JSON.stringify(layoutSnapshot(GR));setEnabled(GR.realLook);
  GR.onFrame(()=>{
    const now=performance.now();if(enabled&&splat){stats.frames.push(now-lastFrame);if(stats.frames.length>600)stats.frames.shift();}lastFrame=now;
    if(now-lastLayoutCheck>150){lastLayoutCheck=now;checkLayout();}
    if(enabled){renderPhoto();if(revision&&now-lastPoll>1200){lastPoll=now;void poll().catch(()=>{});}}
    if(pending.size&&now-lastGallery>1500){lastGallery=now;void refreshPhotos().catch(()=>{});}
  });
}
