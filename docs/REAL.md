# Real: exact-camera photoreal views and metric Gaussian playback

## What the button does

`Real` is no longer a plant-cutout/floor-texture toggle. With it enabled:

1. Wait for the camera to settle for 600 ms. Capture its full world matrix, position,
   quaternion, vertical FOV, aspect, and near/far planes. Do **not** switch to a
   different eye/top camera.
2. Render the procedural scene at that camera: sRGB beauty, camera-Z depth in
   metres, and integer item IDs. The depth/ID shaders support `InstancedMesh`, alpha
   tests/maps, and material sidedness. Hide labels, care sprites, heat maps,
   selection lines and all non-procedural scene roots while capturing. Restore
   visibility/materials/render targets even on failure.
3. POST `/api/real/view`. A local depth-ControlNet img2img gives a **provisional**
   preview; the subscription gpt-image-2 route runs concurrently using the beauty,
   two real-room photographs, and the actual plant/pot contact sheet. A style prompt
   for the local model was derived from those room photographs; no IP-Adapter.
4. Crossfade the accepted preview/HQ image only at its capture pose. Hide it
   immediately on camera movement; it is not a pretend walkable image sphere.
5. Run SHARP with the capture focal length, then robustly align camera-Z to the
   procedural metric depth and transform Gaussian centres **and covariances** into
   the planner's room coordinates. Rejected fits never enter the published scene.
6. Confidence-weighted 4 mm voxel fusion produces a bounded `.splat` plus diagnostic
   PLY. Spark loads it into the **main planner scene**. Procedural meshes are hidden
   under a covered live view, but remain present for selection/raycasting.
7. A settled camera more than 25 degrees or 0.65 m from every captured source
   requests another view. Camera FOV/aspect differences also require a new capture.
   Coverage is currently this geometric heuristic, **not** measured per-pixel
   visibility/occlusion. Outside coverage, show procedural geometry underneath.

The chip shows generating, preview/refining, photoreal, cached, live Gaussian view,
errors and rejected alignment. Tap it for the Real details/regeneration panel.
There is one separate retry cache slot per pose, not unbounded retries.

## Cache and persistence

- Layout revision hashes room geometry and geometry/identity-bearing item fields,
  including fridge-open state. Care scores/support caches do not invalidate it.
- Pose cache lookup rounds position/quaternion to 0.001 and FOV/aspect to 0.01/0.001.
  The stored capture matrices themselves are never rounded.
- A layout edit clears the current overlay, splats and pending client epoch. Late
  image/download completions cannot reattach stale layout geometry.
- Immutable jobs live in `data/renders/real/<revision>/<view-id>/`.
- `GET /api/real/<revision>/views` returns jobs plus the current scene manifest.
  `POST /api/real/layout` identifies a layout without generating an image.
- Three in-flight jobs maximum. Web-service restart recovery resumes an unfinished
  original capture; an existing HQ image/provenance is reused, not repurchased.
- The old `/api/render` and CLI panorama workflow remain for historical callers;
  the planner Real UI no longer uses that uncalibrated gallery path.
- No Real route reads or writes `data/state.json`. Browser regression tests mock
  GET `/api/state` as `{}` and intercept owner-state writes.

## Metric calibration and its limits

Use RANSAC positive scale/shift hypotheses followed by Huber refinement **inside
its consensus**, avoiding high-leverage exterior depths pulling scale toward zero.
Report median, p90, RMSE and the fraction within 25 cm on the sampled correspondence
set, including outliers. Current acceptance: positive scale 0.05–20, median <25 cm,
p90 <90 cm and >55% within 25 cm. These are coarse generated-view gates, **not**
survey-grade accuracy or held-out reconstruction validation.

Exclude the procedural window's flat glass proxy from fitting: generated trees
outside it are not known metric room surfaces. After acceptance, bounded 65%
residual anchoring to procedural surfaces reduces independent-view ghosting. Window
colour is represented on the known glass proxy, not a reconstructed exterior.
Report pre-anchor residuals separately from post-anchor residuals; the latter are
not an independent accuracy result. Non-window Gaussians farther than 65 cm from
known surfaces are discarded.

The consistency gate checks green foliage support around the **rendered item-ID
masks**, and refuses gross foliage loss. It is deliberately a weak proxy: it does
not prove plant count, species, pot identity, furniture identity or exact layout.
A badly failed image is labelled needs-review and is not fused; manual regeneration
is available. There is no automatic semantic/count verifier or gsplat refinement.

## Models, memory and licences

| Stage | Model/route | Licence / constraint |
|---|---|---|
| Local preview | `stabilityai/sd-turbo`, fp16, 4 configured steps, strength 0.5 (2 effective img2img steps) | Stability model-card licence/membership conditions; do not assume MIT/Apache or an unrestricted commercial licence. <https://huggingface.co/stabilityai/sd-turbo> |
| Local depth condition | `thibaud/controlnet-sd21-depth-diffusers` | Model card says `license: other`, referring to preprocessor licences. **Unclear production rights**; research prototype only pending clarification. <https://huggingface.co/thibaud/controlnet-sd21-depth-diffusers> |
| HQ | Existing ChatGPT subscription `image_generation` / gpt-image-2 | OpenAI subscription terms, not open model weights; no API key route. |
| 3D lift | Existing Apple SHARP `sharp_2572gikvuh.pt` | **Apple AMLR weights are restricted to research purposes and explicitly exclude product development/commercial products. This is a production-licensing blocker**, not merely a non-commercial-use checkbox. Code has separate Apple terms. <https://huggingface.co/apple/Sharp/blob/main/LICENSE> |
| Playback | Existing vendored Spark + three.js | Library licences in their installed packages; no model inference on phone. |

ComfyUI Python runs preview/HQ; the existing SHARP venv runs SHARP. Dependencies
added to ComfyUI: diffusers 0.36.0, accelerate, plyfile, opencv-python-headless.
Weights are in `$PRIVATE_DATA`, not Git.

Preview weights load lazily, move to CPU after 45 seconds idle or before SHARP,
and can return to CUDA without rereading the checkpoint. Real GPU stages use a
file lock. Check for at least 6 GB free for preview / 5.5 GB for SHARP and do not
stop the independent scan worker. That worker does not share this file lock, so
free-memory admission is not a guarantee against other processes allocating later.

Mobile cap: 900,000 fused Gaussians, 450,000 retained per source, SH degree zero,
32 bytes per transferred Gaussian; Real render DPR capped at 1.25 and restored on
exit. This is a hard cap/resolution budget, not adaptive spatial LOD.

## Real evidence, 2026-10-18

Canonical latest-layout receipt directory:

`$PRIVATE_DATA`

The owner layout changed during work. The first three generations and failed
calibration/preview attempts are retained separately under `real-20261018/`.
Exactly **six explicit verification** subscription generations were requested:
three for the original snapshot, three for the next saved layout. Later readback
found **two additional automatic runtime jobs** from a 411×783 client in that same
revision; their origin was not logged, so they cannot be attributed to a specific
person/test. Total stored HQ images became eight. The live manifest consequently
grew to five sources and the **900,000**-Gaussian cap; the 693,125-Gaussian artifact
below remains immutable and is what the saved screenshots/frame timings qualify.
Playback verification pins the recorded manifest while fetching/rendering the real
stored splat bytes, so concurrent client fusion does not silently change evidence.
The final qualified snapshot SHA-256 matched the owner file at that verification:

`5551cc5ee9bbff8b3b3f1600fcd700535882e47b484fe857b54f4d771fac5a4b`

Latest qualified revision `4bb1fe2a7238c12ea5ccf231`, sources:

**Later owner edit:** during the final regression pass the parent changed the
saved plan again to SHA-256
`ef59037607474726fa4ba3d9141337e63c8bd06b86cbc3cb9f7afa719e49b8b1`.
The six-turn explicit verification budget was not exceeded and that owner edit was not
rolled back. The three HQ/splat viewpoints below qualify the `5551…` snapshot,
not that later plan. Opening Real on the later plan correctly selects a new
revision and generates new views; do not present the old scene as its evidence.

Sources for the qualified snapshot:

| View | Job ID | Capture | Preview inference/job | HQ | SHARP incl GPU queue/load/export | Alignment | Pre-anchor median / p90 |
|---|---|---:|---:|---:|---:|---:|---:|
| 1 | `a6845cee2bfcfcd82f29ba0a` | 172 ms | 330 ms warm | 52.35 s | 53.26 s | 2.66 s | 14.0 / 38.5 cm |
| 2 | `f9806fefb7e50195ea6d5688` | 75 ms | 9.48 s cold | 48.39 s | 31.39 s | 2.21 s | 8.6 / 29.2 cm |
| 3 | `cce33b5d509a059ea26d9791` | 87 ms | 328 ms warm | 56.15 s | 70.43 s | 1.64 s | 11.9 / 35.8 cm |

All three previews arrived about 14.6–14.9 s after their jobs started in the
concurrent cold batch, including worker startup and waiting for the first GPU
model load. **Cold preview did not meet the <2-second target.** Separate measured
CPU-resident resume was 981 ms; warm model generation was 313–330 ms. SHARP network
inference alone was 5.92–6.41 s. The receipt's `sharpLoadMs` originally includes
queue waiting; subsequent runs now expose `gpuQueueMs` separately. Do not relabel
those batch load values as pure model-loading times.

Latest fusion: **693,125 Gaussians**, 22,180,000 bytes, 2.01 s fusion.

- `generated-contact.jpg`: local previews (top) and HQ photos (bottom), all 3 views.
- `novel-1.png`, `novel-2.png`, `novel-3.png`: **new** live-splat positions between
  the sources. The test asserts image opacity zero and procedural roots hidden.
- `novel-contact.jpg`: downscaled contact sheet inspected with vision.
- `results.json`, `metrics.json`, `hardware.json`, `novel-views.json`: raw receipts.
- Capture JSON includes the exact cameras, beauty, IDs and metric depth bytes.
- The fused artifact URL is in `results.json`, with diagnostic PLY beside it.

Hardware Chromium: NVIDIA RTX 3080 Ti via ANGLE/Vulkan, three.js 186,
412×915 CSS viewport, emulated DPR 2.6, Real render DPR 1.25. **560** frame intervals:
median **16.7 ms**, p95 **16.8 ms**. Includes the controlled evidence trace, not a
physical Samsung benchmark. Loopback transfer **63.6 ms**, Spark decode **148.2 ms**;
these are **not** Tailscale/phone download measurements.

### Honest visual assessment / remaining gaps

The HQ outputs look photographic and broadly retain the visible planters, window,
light stands and plants. They still invent fine detail, change some leaves/pots,
and turn grow-light spill into a purple band on planters. The local preview is
mostly enhanced procedural style, **not convincingly photoreal**, and the third
preview can change the planter's appearance. The foliage-only check does not
catch that furniture-identity error.

Novel splat views are real-time and recognisable, but have window holes, noisy thin
stems, soft planter edges and some multi-view ghosting. They are not a clean,
measured room reconstruction. Only a small window-facing eye-level region was
qualified; reverse views, large orbits, cutaway overview generations and full-room
coverage were not visually certified. No physical-phone frame/transfer measurement.

The final capture cleanup removes Zen/care sprites from **future** beauty/depth
conditioning. The six budgeted generation inputs preceded that cleanup and some
HQ outputs retain small white-flower-like detail from those sprites. No more
subscription calls were spent to hide that limitation. The capture test explicitly
checks that an unrelated scene overlay cannot contaminate the depth pass.

Production blockers: SHARP research-only licence, unclear ControlNet licence,
semantic consistency verification, cold-start latency and splat reconstruction
quality. Do not call this production-ready photoreal navigation.

## Verify without spending image turns

```sh
node tests/real_capture.mjs
env -u PYTHONPATH -u PYTHONHOME $PRIVATE_DATA tests/real_backend.py
node tests/real_ui.mjs
REAL_OUT=$PRIVATE_DATA node tests/real_evidence.mjs --views-only
node tests/phone.mjs
node tests/core.mjs
```

`real_evidence.mjs` without an explicit mode skips paid/live generation. Use
`--capture-only` for conditioning-only evidence. `--generate` makes three real
subscription generations and GPU jobs; it must be an intentional operator action.
For disposable tests, keep generated artifacts under the artifact store and keep
owner state API writes mocked. Do not restore an older backup over an owner edit.

Restart: `systemctl --user restart garden-room`. New route modules are discovered
by the existing server loader; the web process remains stdlib-only. Do not print
the app token, OAuth credentials or request headers in receipts.
