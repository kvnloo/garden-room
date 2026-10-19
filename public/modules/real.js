// Exact-camera photoreal generation + calibrated Gaussian views in the planner.
// No image is screen-pinned after its capture pose changes; selection stays procedural.
export function layoutSnapshot(GR) {
  const keys = ['id','kind','name','src','family','pot','x','z','rot','w','d','h','potD','potH','height','attach','hinge','box'];
  return { room: GR.state.room, items: GR.state.items.map(it => Object.fromEntries(keys.filter(k => k in it).map(k => [k,it[k]]))), fridgeOpen: !!GR.state.fridgeOpen };
}

function base64(bytes) {
  let s = ''; for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(s);
}

export function init(GR) {
  const { THREE, renderer, scene, camera, controls } = GR;
  const style = document.createElement('style');
  style.textContent = `.real-image{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1;opacity:0;transition:opacity .3s;object-fit:fill}.real-chip{position:absolute;bottom:calc(env(safe-area-inset-bottom) + 132px);left:10px;max-width:calc(100% - 20px);z-index:3;padding:7px 12px;border-radius:18px;border:1px solid #b9a88155;background:#171b17dd;color:#e7dfca;font:11px system-ui;cursor:pointer;min-height:44px}.real-chip[hidden]{display:none}`;
  document.head.appendChild(style);
  const image = document.createElement('img'); image.className='real-image';image.alt='Photoreal view at the captured camera';
  const chip = document.createElement('button');chip.className='real-chip';chip.hidden=true;chip.id='real-status';chip.setAttribute('aria-live','polite');
  document.querySelector('#app').append(image,chip);
  const root = new THREE.Group();root.name='Calibrated Real splats';
  let revision=null, signature='', epoch=0, busy=false, lookup=false, enabled=false, lastPose='', stillSince=performance.now();
  let views=[], splat=null, spark=null, sceneUrl=null, requested=new Set(), lastPoll=0, pinned=null, loadedImage='', loadingScene=false;
  let stats={captureMs:0,transferMs:0,decodeMs:0,count:0,frames:[],revision:null};
  let normalPixelRatio=renderer.getPixelRatio();
  let lastTick=0, lastFrame=performance.now(), requestAfter=0, errorText='';
  function status(text) {chip.textContent=text;chip.hidden=!enabled;}
  function pose() {return {position:camera.position.toArray(),quaternion:camera.quaternion.toArray(),matrixWorld:camera.matrixWorld.toArray(),fov:camera.fov,aspect:camera.aspect,near:camera.near,far:camera.far};}
  function distance(c) {
    if(!c) return {angle:Infinity,move:Infinity,intrinsics:false};
    const q=new THREE.Quaternion().fromArray(c.quaternion), p=new THREE.Vector3().fromArray(c.position);
    return {angle:THREE.MathUtils.radToDeg(q.angleTo(camera.quaternion)),move:p.distanceTo(camera.position),intrinsics:Math.abs(c.fov-camera.fov)<.1&&Math.abs(c.aspect-camera.aspect)<.01};
  }
  function same(c) {const d=distance(c);return d.angle<.12&&d.move<.005&&d.intrinsics;}
  function hideImage() { image.style.transition='none';image.style.opacity='0';pinned=null; }
  function clearScene() {
    hideImage(); if(splat) {root.remove(splat);splat.dispose();splat=null;}sceneUrl=null;stats.count=0;
    GR.setRealCoverage(false);
  }
  function invalidate() {
    ++epoch;revision=null;views=[];requested=new Set();errorText='';clearScene();loadedImage='';stillSince=performance.now();
    status('Real · layout changed · generating new view');
  }
  async function identify() {
    if(lookup) return;
    lookup=true;const mine=epoch;
    try {
      const r=await GR.api('/api/real/layout',{method:'POST',body:JSON.stringify({layout:layoutSnapshot(GR)})});
      if(r.error) throw new Error(r.error);
      if(mine!==epoch) return;
      revision=r.revision;stats.revision=revision;await poll();
    } catch(e) {errorText=e.message;status('Real unavailable · tap to retry');requestAfter=performance.now()+10000;}
    finally {lookup=false;}
  }
  async function loadScene(meta) {
    if(!meta?.url||meta.url===sceneUrl||loadingScene||meta.count>1_000_000) return;
    loadingScene=true;const mine=epoch;
    let next;
    try {
      const mod=await import('/vendor/spark/dist/spark.module.min.js');
      if(!spark) {spark=new mod.SparkRenderer({renderer,maxStdDev:Math.sqrt(5),preUpdate:true});scene.add(spark);}
      const t=performance.now(),res=await fetch(meta.url);
      if(!res.ok) throw new Error('Splat download '+res.status);
      const bytes=await res.arrayBuffer();stats.transferMs=performance.now()-t;
      const decoded=performance.now();
      next=new mod.SplatMesh({fileBytes:new Uint8Array(bytes),fileType:'splat'});
      await next.initialized;
      stats.decodeMs=performance.now()-decoded;
      if(mine!==epoch) {next.dispose();return;}
      if(splat) {root.remove(splat);splat.dispose();}
      splat=next;root.add(next);sceneUrl=meta.url;stats.count=meta.count;
    } catch(e) {if(next&&next!==splat)next.dispose();errorText=e.message;status('Real · splat unavailable');console.warn('Real splat',e);}
    finally {loadingScene=false;}
  }
  async function poll() {
    if(!revision)return;
    const mine=epoch,rev=revision;
    const r=await GR.api(`/api/real/${rev}/views`);
    if(mine!==epoch)return;
    views=r.views||[];
    await loadScene(r.scene);
  }
  function displayPhoto() {
    const v=views.filter(v=>same(v.camera)&&(v.status.hq||v.status.preview)).sort((a,b)=>Number(!!b.status.alignment?.accepted)-Number(!!a.status.alignment?.accepted)||Number(!!b.status.hq)-Number(!!a.status.hq))[0];
    if(!v) {if(pinned)hideImage();return;}
    const file=v.status.hq?'real.png':'preview.png',url=v.base+file;
    if(loadedImage!==url) {
      loadedImage=url;const mine=epoch;
      image.onload=()=>{if(mine===epoch&&enabled&&same(v.camera)){pinned=v.camera;image.style.transition='opacity .3s';image.style.opacity='1';}};
      image.src=url;
    } else if(same(v.camera)) {pinned=v.camera;image.style.transition='opacity .3s';image.style.opacity='1';}
    const rejected=v.status.state==='alignment-rejected';
    status(`Real · ${!requested.has(v.id)?'cached · ':''}${rejected?'photoreal · depth fit rejected':v.status.hq?'photoreal':'preview · refining'}`);
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
    const result={camera:c,view:toImage(beauty,w,h,'image/jpeg'),ids:toImage(ids,w,h,'image/png'),
      depth:{width:w,height:h,encoding:'float32-le-meters-camera-z',data:base64(new Uint8Array(depth.buffer))},
      objects:GR.state.items.map((it,i)=>({id:it.id,kind:it.kind,label:i+1})),layout:layoutSnapshot(GR)};
    result.captureMs=performance.now()-started;stats.captureMs=result.captureMs;return result;
  }
  async function requestView(retry=false) {
    if(busy||!revision)return null;
    const mine=epoch;busy=true;status('Real · capturing current view');
    try {
      const data=capture();data.retry=!!retry;
      const r=await GR.api('/api/real/view',{method:'POST',body:JSON.stringify(data)});
      if(r.error)throw new Error(r.error);
      if(mine!==epoch)return null;
      if(!r.cached)requested.add(r.id);status(r.cached?'Real · cached':'Real · generating preview + photoreal');await poll();return r;
    } catch(e) {errorText=e.message;status('Real · '+e.message);requestAfter=performance.now()+15000;return null;}
    finally {busy=false;}
  }
  function coverage() {
    return views.some(v=>v.status.alignment?.accepted&&distance(v.camera).angle<25&&distance(v.camera).move<.65&&distance(v.camera).intrinsics);
  }
  function setEnabled(on) {
    if(on&&!enabled){normalPixelRatio=renderer.getPixelRatio();renderer.setPixelRatio(Math.min(devicePixelRatio,1.25));}
    if(!on&&enabled)renderer.setPixelRatio(normalPixelRatio);
    enabled=on;root.visible=on;chip.hidden=!on;
    if(!on){hideImage();GR.setRealCoverage(false);return;}
    stillSince=performance.now();status('Real · hold still to generate');if(!revision)identify();
  }
  chip.onclick=()=>{
    if(errorText){errorText='';requestAfter=0;revision?requestView():identify();}
    else GR.openPanel('real');
  };
  GR.addPanel('real',()=>{
    const failures=views.filter(v=>['alignment-rejected','needs-review','failed'].includes(v.status.state));
    GR.openSheet('real',`<h3>Real <em>current view</em></h3><p class="sub">Hold the camera still for 0.6 seconds. A depth-guided local preview is refined by ChatGPT. Calibrated splats stay interactive as you move.</p><p class="micro">${stats.count.toLocaleString()} GAUSSIANS · ${views.length} CAPTURED VIEWS</p>${failures.map(v=>`<p class="sub">${GR.esc(v.status.error||v.status.state)} · ${v.status.alignment?.medianM?.toFixed(2)||'—'} m depth residual</p>`).join('')}<button class="btn gold" id="real-generate">Generate here</button><p class="micro">Generated interpretation, not a measured room scan. Layout changes clear old views. Experimental research pipeline: SHARP weights are research-only, not production-licensed.</p>`);
    document.querySelector('#real-generate').onclick=()=>{GR.closeSheet();GR.setRealLook(true);requestView(failures.some(v=>same(v.camera)));};
  });
  GR.real={capture,requestView,poll,identify,setEnabled,get stats(){return stats;},get views(){return views;},get revision(){return revision;},get enabled(){return enabled;},get coverage(){return coverage();}};
  GR.setRealScene(root);signature=JSON.stringify(layoutSnapshot(GR));setEnabled(GR.realLook);
  GR.onFrame(()=>{
    const now=performance.now();if(enabled&&splat){stats.frames.push(now-lastFrame);if(stats.frames.length>600)stats.frames.shift();}lastFrame=now;
    if(!enabled)return;
    const key=JSON.stringify([camera.position.toArray().map(x=>Math.round(x*10000)),camera.quaternion.toArray().map(x=>Math.round(x*10000)),camera.fov,camera.aspect]);
    if(key!==lastPose){lastPose=key;stillSince=now;if(pinned&&!same(pinned))hideImage();}
    if(now-lastTick<150)return;lastTick=now;
    const next=JSON.stringify(layoutSnapshot(GR));if(signature!==next){signature=next;invalidate();}
    if(!revision){if(!lookup&&now>requestAfter)identify();return;}
    const covered=!!splat&&coverage();GR.setRealCoverage(covered);
    if(now-lastPoll>1200){lastPoll=now;poll().catch(e=>{errorText=e.message;});}
    displayPhoto();
    if(!pinned&&covered)status('Real · live Gaussian view');
    const near=views.find(v=>{const d=distance(v.camera);return d.angle<22&&d.move<.6&&d.intrinsics;});
    const exact=views.find(v=>same(v.camera));
    if(exact&&['needs-review','failed'].includes(exact.status.state))status('Real · generated view needs review · tap');
    if(!near&&!busy&&now-stillSince>600&&now>requestAfter){requestAfter=now+6000;requestView();}
  });
}
