# Live room scanning — implementation and evidence

## Status and limits

The phone → authenticated route → persistent GPU worker → phone path is implemented and exercised with actual owner photographs. **It is not yet a phone-qualified automatic room survey.** Raw-camera permission, physical ARCore tracking, drift and microphone coexistence still need the S25 Ultra. The current offline splat is a **sparse 559-Gaussian preview**, not a coherent photorealistic room. Its estimated COLMAP poses have arbitrary scale; the viewer explicitly says scale unknown. Do not use it as measurement evidence.

Recognition finds the actual refrigerator, china cabinet, glass dining table and many plants. Review sheets also show duplicates/partial table boxes, objects seen through doorways and some false plant/lamp detections. Predictions never silently change the plan. Individual identity among 25 plants is not validated: HSV appearance + plan position produces candidates, usually **unsure**. Projected green area and colour indices are not total leaf area or a health diagnosis.

## Why the previous orientation did not work automatically

The old AR tools only fitted two manually selected floor corners. They did not request camera access, send images, detect furniture or fit walls. Ordinary hit-test results are surface points, not semantic room localization. Saved transforms cannot relocalize a new XR session without restored anchors. Required DOM overlay + hit-test and the separate transparent renderer were already correct; they were retained rather than claiming a different sensor bug without a phone.

Changes:
- Required features remain `hit-test` and `dom-overlay`; optional extras include `camera-access`, `plane-detection`, CPU depth, anchors and local-floor. A second explicit tap retries without optional camera/depth/planes if startup fails.
- Hit-test source is viewer-relative, explicitly requests planes, and is cancelled at session end.
- XR world/reference-space resets discard scan geometry and alignment; tracking/visibility loss hides localized overlays. Manual anchors remain authoritative and are never overridden by semantic estimates.
- Automatic fits consume the runtime `state.room.poly` and furniture positions, including the core app's rotated room. No old north/south corner coordinates are embedded.

## Phone usage

Open **Live → Room scan → Begin live scan**. This requests immersive AR synchronously within the button gesture, before awaiting the server. Chrome must grant raw camera access to send posed AR keyframes. Move slowly sideways around furniture; panning in place has no triangulation baseline.

In AR:
- A raw camera texture is copied/downscaled inside its active XRFrame using `XRWebGLBinding.getCameraImage`.
- Exact view pose and projection-derived intrinsics accompany the JPEG. CPU depth samples and posed XR plane polygons are included when granted.
- Keyframes are at most 640 px, JPEG quality .72, paced at 350 ms minimum, one request in flight. There is no growing upload queue.
- Detections appear as green labelled 3D brackets only after depth or multiview localization. Width/height are camera-plane estimates. Unknown object depth is shown as `depth ?`, not a made-up measured furniture box. Localized detections also appear on the mini plan.
- Corrections have explicit **Apply** buttons, call `GR.moveItem` and, only for a suggested visible-foliage-height change, `GR.setProps`. Locked items and stale/nonmetric corrections are rejected. Floor/wall fitting changes the AR alignment, not the room polygon.
- The existing voice orb/captions/audio element are mounted inside the actual DOM-overlay root using `GR.voice.mountInto`. Recognition key events use `GR.voice.say`. Microphone permission/session establishment remains the voice module's responsibility. Speech cannot bypass Chrome's physical-gesture requirement to enter XR.

If raw camera access is absent, choose **Use 2D camera instead**. The app ends immersive AR before requesting `getUserMedia`; it never contends with ARCore for a second camera. DeviceOrientation is sent with explicitly estimated intrinsics and **no metric translation**. This mode recognizes objects/green foliage but cannot generate metric corrections or a posed splat. It is visibly labelled 2D, not passed off as equivalent AR.

Manual two-corner alignment, rulers and measurement assignment remain available under Orient/Measure/Ruler.

## Geometry and reconstruction

`scan_live_geometry.py`:
- Validates rigid camera transforms and intrinsics; OpenCV undistortion when coefficients are supplied.
- ORB matching, ratio test, fundamental-matrix RANSAC, known-pose triangulation, positive-depth/reprojection/parallax checks.
- Bounded 320-pixel posed SGBM stereo every fourth usable frame; left-right, texture, positive-depth and photometric rejection. This supplies extra actual correspondences, not synthesized depth.
- Object tracks associate labels/appearance/projection and triangulate detection centroids or use in-box surface points. These are uncertain surface/centroid estimates, not full object shape or 3D orientation measurements.
- Plane RANSAC separates approximately horizontal/vertical surfaces. Two distinct unambiguous known furniture landmarks can seed a rigid SE(2) fit. Alternatively, at least three wall planes plus a floor can seed multi-start robust wall ICP. Competing nearly equivalent solutions are rejected. A valid prior can be refined with bounded wall ICP. No scaling of XR metres.
- The client smooths small automatic updates; large jumps are rejected. Manual two-corner anchors are not replaced by model output.

`scan_live_splats.py` uses **actual gsplat CUDA forward/backward optimization**, not a coloured point file renamed to `.splat`. It optimizes means, quaternions, log scales, opacity and colour against a bounded window of 8 posed images at up to 320×240, four iterations / ~130 ms soft budget per frame. Spatially new observations append Gaussians; cloud cap 18,000, optimizer cap 20,000. First optimizer initialization can exceed the soft budget. Exports are atomic standard 32-byte `.splat`, refreshed at least two seconds apart. This is an intentionally small incremental mapper, not a port of a complete SLAM system and not a guarantee of photorealistic quality.

## Chosen OSS and bounded comparison

| Component | Source | Licence | Decision |
|---|---|---|---|
| OWLv2 base ensemble | [Google model card](https://huggingface.co/google/owlv2-base-patch16-ensemble) | Apache-2.0 | Installed quickly; measured CUDA inference below. Text queries cover dining/glass table, refrigerator, china cabinet, potted plant, floor lamp, window, door; table synonyms merge. |
| OpenCV 4.11 | [opencv/opencv](https://github.com/opencv/opencv) | Apache-2.0 | Tracking, RANSAC, triangulation, stereo and colour geometry. |
| PlantCV 4.11.3 | [danforthcenter/plantcv](https://github.com/danforthcenter/plantcv) | MPL-2.0 | Real LAB segmentation and size analysis on detected crops; projected pixel area, camera-plane height/width when depth exists, excess-green/yellow colour proxies. |
| gsplat 1.5.3 | [nerfstudio-project/gsplat](https://github.com/nerfstudio-project/gsplat) | Apache-2.0 | Selected renderer/optimizer: supplied XR poses avoid re-solving SLAM; small bounded scene fits 12 GB. |
| pycolmap 4.2.1 | [colmap/pycolmap](https://github.com/colmap/pycolmap) | BSD-3-Clause | Offline evidence only; genuine camera recovery from room photographs. |
| Existing three.js / Spark | [three.js](https://github.com/mrdoob/three.js), [Spark](https://github.com/sparkjsdev/spark) | MIT | Reused phone rendering and actual splat decoder. |

Other reviewed alternatives (not installed/benchmarked):
- [MonoGS](https://github.com/muskie82/MonoGS): custom Imperial non-commercial/internal/academic research licence; not an unqualified permissive OSS dependency.
- [Splat-SLAM](https://github.com/google-research/Splat-SLAM): repository Apache-2.0, older CUDA/PyTorch environment and several custom extensions/pretrained backends; duplicates XR pose estimation. Submodule/checkpoint terms would need a separate audit.
- [Photo-SLAM](https://github.com/HuajianUP/Photo-SLAM): GPL-3.0, ORB-SLAM3/LibTorch/OpenCV CUDA build stack, unnecessary tracking stack for known poses.
- [GS-ICP-SLAM](https://github.com/Lab-of-AI-and-Robotics/GS_ICP_SLAM): repository MIT, RGB-D-first pipeline; phone depth is optional.
- [RTG-SLAM](https://github.com/MisEty/RTG-SLAM): GPL-3.0, RGB-D-first mapping/tracking stack.
- [LoopSplat](https://github.com/GradientSpaces/LoopSplat): repository MIT, coupled RGB-D tracking/mapping/loop closure; not a quick known-pose phone adapter. Dependency licences still need separate checking if adopted.

Research was bounded to the initial option selection. No third-party SLAM performance figures are presented as this host's measurements.

## Service / API / privacy

`deploy/garden-room-scan-live.service` is installed and enabled as user service `garden-room-scan-live`. It runs the project's `.venv`, not system Python, on `work/scan-live.sock` (mode 0600). The stdlib app route proxies only this Unix socket; no additional network listener or public static photo directory is opened. Existing app authentication applies to all `/api/scan_live/*` endpoints. Unauthenticated health returns 401.

```
GET  /api/scan_live/health
POST /api/scan_live/start        {plan:{room:{poly},items}}
POST /api/scan_live/<id>/frame   {seq,jpeg,camera,plan,alignment?}
GET  /api/scan_live/<id>/status
GET  /api/scan_live/<id>/splat
POST /api/scan_live/<id>/stop
```

IDs are 24 random hex digits. Frames must increase sequence number, JPEG must be <=1024 px and <=600 KB; proxy request cap 1.2 MB. The phone sends <=640 px. Concurrent GPU work gets 429 rather than queuing; unavailable workers return 503. Three active sessions maximum; abandoned sessions expire after 15 minutes when the next request arrives. Stop releases GPU scene/session references, exports final splat and persists state `stopped`. Exact authenticated status/splat artifacts remain readable after stop or worker restart.

Camera pixels are kept only in the in-memory eight-view window during the live session. Private results/splats persist under `data/scan_live/<id>/`; there is currently no automatic disk-retention policy. Offline evidence images, annotations and recovered poses stay under ignored `work/scan_live_evidence/`. Model/extension caches stay under `work/models/`. The worker never writes owner plan/state/calibration or plant assignments.

Client contracts:
```
GR.scanLive = { start(), stop(), status(), detections(), apply(objectId), open() }
GR.ar = { open(), start(), stop(), setTool(), recalibrate(), measure(id), ruler(),
          place(), status(), setAlignment(), toPlan(), toXR(),
          onXRFrame(), onLifecycle(), setVideoMode() }
```

`RawCamera` restores the previous Three render target after `renderer.resetState()`: restoring only the GL framebuffer is insufficient because resetState unbinds it and clears Three's target cache.

## Installation / reproduction

The existing venv already contained Torch, Transformers, OpenCV and PlantCV. Added gsplat and pycolmap. Exact validated versions are in `deploy/scan-live-requirements.txt`; keep the CUDA-enabled Torch wheel installed separately (this host used Torch 2.11.0+cu128, CUDA toolkit 13.4). gsplat's first CUDA JIT compile took 316 s with four jobs; it completed a real forward/backward probe. That compile cost is not a frame latency.

```
uv pip install --python .venv/bin/python -r deploy/scan-live-requirements.txt
systemctl --user link "$PWD/deploy/garden-room-scan-live.service"
systemctl --user daemon-reload
systemctl --user enable --now garden-room-scan-live
systemctl --user restart garden-room
.venv/bin/python tools/scan_live_probe.py
.venv/bin/python tools/scan_live_colmap.py
.venv/bin/python tools/scan_live_evidence.py
.venv/bin/python tests/scan_live_geometry.py
python tests/scan_live_api.py
node tests/scan_live.mjs
node tests/scan_live_xr.mjs
node tests/scan_live_ui.mjs
node tests/scan_live_view.mjs
node tests/ar.mjs
python tests/ar_api.py -v
node tests/phone.mjs
```

For high-resolution room photos, evidence preparation used `vips thumbnail ORIGINAL work/scan_live_evidence/highres/NAME.jpg 1600` on the fourteen selected originals under `$PRIVATE_DATA`. Do not feed those ~200 MP originals into unrestricted PIL decoding. The COLMAP script falls back to the smaller `refs/` images if bounded derivatives are unavailable.

## Measured evidence

Final server run (RTX 3080 Ti, 12 GB): 14 actual room/plant photographs at <=640 px, separate recognition sessions; plus 12 incremental updates cycling **three genuinely registered COLMAP views**, not 12 independent camera poses. COLMAP recovered 109 sparse points in about 14 s from the 1600 px derivatives; original 640 px thumbnails were insufficient for useful coverage. Offline scale is deliberately unknown. Existing MP4s were inspected: they are outdoor plant/root footage, not a room walkthrough, so they were not mislabeled as room evidence.

| Stage | Recognition median | Posed-room median (warm frames) |
|---|---:|---:|
| OWLv2 detection | 153.25 ms | 152.56 ms |
| Geometry | 7.07 ms | 48.26 ms |
| PlantCV / alignment | 5.10 ms across mixed plant/nonplant photos | 0 ms (registered views contain no plant detections; offline metric alignment disabled) |
| gsplat update/export | not run in 2D | 16.50 ms |
| Total server pipeline | 179.06 ms (p95 246.39 ms) | 219.57 ms |

These are **host processing timings**, not Samsung end-to-end latency, phone camera-readback time, WAN/network latency, physical tracking accuracy, or a benchmark at 18,000 Gaussians. The final replay processed 12 posed updates in 5.34 s: **2.25 fps**, including an explicit 200 ms pacing wait per frame and local HTTP overhead. Cold first optimizer initialization took ~146 ms for the splat stage in this run (an earlier run took ~293 ms). Target upload rate is 2–3 fps; actual phone rate remains to be measured. CUDA process memory was ~1.5 GB for this small scene; systemd's worker memory was ~3.2 GB.

Filtered detections across the 14 photos: refrigerator 6, china cabinet 6, dining-table 12, door 15, window 9, floor-lamp 6, potted-plant 50. These are **box counts across images, not unique object counts or precision/recall**. Contact sheets were visually inspected; no ground-truth accuracy score is claimed.

The exported artifact is 17,888 bytes / 559 Gaussians and was decoded/rendered by the actual installed Spark viewer with no JS errors. Visual inspection shows disconnected blurry sparse patches, not a complete room. Latest evidence viewer path is recorded in `work/scan_live_evidence/summary.json`; the current run is `/scan-live-view.html?s=8c2ff7f6e3b1a10e99ffa7d3`.

Evidence files:
- `work/scan_live_evidence/{recognition,posed,poses,summary}.json`
- `work/scan_live_evidence/detections-contact.jpg` and per-photo boxes, inspected visually
- `work/scan_live_evidence/evidence.splat`
- `work/shots/scan-live-real-splat.png`, actual Spark decode, software-WebGL screenshot
- `work/shots/scan-live-xr-injected.png`, injected XR/server contracts, **not real passthrough**
- `work/shots/scan-live-2d-fixture.png`, generated Chromium camera fixture, **not a room detection run**
- `work/shots/scan-live-ui-{360,412,768}.png`, actual voice-control layout, no microphone session

Deterministic verification: 8 geometry tests; 5 stdlib proxy/API tests; actual raw GL readback/vertical flip and XR-target restoration; injected posed-frame upload, runtime rotated plan, client automatic alignment, labelled brackets, explicit Apply, voice mount, tracking loss and origin reset; fallback camera release/backpressure/nonmetric restrictions; existing AR suite and calibration API tests.

The full phone smoke suite was rerun repeatedly. Earlier intermediate runs hit a Suggest timeout and transient `/api/replay/batch` failures while parallel app/replay work was changing. **The final `node tests/phone.mjs` run passed all assertions**, including 25 plants, touch drag, locks, fridge clearance, suggestions, dimensions, no console errors and no failed requests.

Physical acceptance still requires S25 Chrome: raw `camera-access` grant and actual image orientation/intrinsics, CPU depth/plane availability, sustained sideways scans, continuous localization and drift against known tape distances, dense splat coverage, furniture-size quality, plant identity confirmation, live voice mic/audio inside immersive overlay, exit/re-entry and tracking-reset behavior. A freshly recorded slow room walkthrough with real XR poses is needed to qualify reconstruction quality.
