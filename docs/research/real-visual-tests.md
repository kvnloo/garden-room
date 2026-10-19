# Real visual qualification — camera redesign

## Frozen experiment

Owner-layout fixture: `$PRIVATE_DATA`.
SHA-256: `ef59037607474726fa4ba3d9141337e63c8bd06b86cbc3cb9f7afa719e49b8b1`.
Baseline source: `f04e1c4` (Real implementation `df81584`), archived byte-for-byte under `baseline-code/` before changes.

`tests/real_visual.mjs` captures six fixed poses: overview, window-facing eye level, fridge/china-facing eye level, top, high intermediate, eye intermediate. Each has exact camera matrices/FOV/aspect, beauty, metric depth and item-ID passes. It makes no implicit image requests; an explicit `--generate` is limited to six cached jobs per output directory. Owner state reads are mocked to `{}`, fixture comes from localStorage, owner state/journal writes are intercepted.

Each source is rendered as actual Spark splats at the capture pose and at local yaw offsets 5°, 15°, 30°, each with 0.3 m lateral translation. Raw diagnostics forcibly disable the pinned image, procedural fallback and non-scene UI/care sprites. The 30° diagnostic deliberately exceeds the redesigned valid region; it must not be mistaken for supported navigation.

## Baseline diagnosis before integration

Six new baseline HQ images were necessary: previously cached photographs qualified a different owner layout/camera cohort. No HQ retries. Top-down initially failed SHARP GPU admission (shared 12 GB GPU); one SHARP-only retry reused its HQ and produced a rejected fit. Initial failure retained in `before/top-initial-error.json`.

Depth fits already explain why this is not a faithful room reconstruction:

| Pose | Pre-anchor median | Pre-anchor p90 | Decision |
|---|---:|---:|---|
| Overview | 22.2 cm | 105.3 cm | rejected |
| Window | 18.7 cm | 87.1 cm | accepted, coarse gate only |
| Fridge/china | 24.6 cm | 86.1 cm | rejected |
| Top | 27.1 cm | 94.7 cm | rejected after inference-only retry |

These compare predicted depth to procedural low-gradient surfaces, excluding the window proxy. They are not a survey against real room measurements. The accepted window fit still has nearly metre-scale p90 error. The old 65% anchoring hides much of the numerical residual but does not recover the correct surfaces.

Direct inspection of `baseline-first-three.jpg` showed the fast previews remain flat planning renders, whereas HQ is much more photographic. Both retain the source magenta light panels; HQ invents photographic pink spill and details on pots/floor. The first raw Spark capture showed fragmented stems, soft window detail, double light-panel edges and a large pink smear. Non-scene Zen sprites were found contaminating initial screenshots; these are preserved under `before/with-ui-initial/`, excluded from final metric captures, and not silently passed off as clean evidence.

The causes are distinct:

1. **Single-image depth ambiguity:** SHARP lifts invented photo details without measured hidden geometry. Large offsets expose holes and stretched surfaces.
2. **Inconsistent generated sources:** different HQ calls invent different leaves/pots/lighting. Voxel fusion cannot reconcile these identities; centimetre-scale voxel deduplication does not remove surfaces separated by tens of centimetres.
3. **Alignment error:** robust positive scale/shift does not fix local deformation or photo/procedural silhouette disagreement. Half this cohort fails its already permissive gate.
4. **Preview mismatch:** low-step local img2img does not establish photographic realism or preserve the plant identities. It adds GPU contention before the photo arrives.
5. **Rendering versus reconstruction:** Spark sorting/opacity can cause popping and softness, but a replacement transparency renderer cannot repair wrong colours, missing backsides, or inconsistent geometry.

## Metric interpretation

`tools/score_real_visual.py` computes PSNR, SSIM and learned LPIPS-Alex against each generated HQ photo, black/background fraction within procedural geometry support, expected plant counts/positions from item IDs with a foliage-support proxy, and projected Gaussian-centre depth residual. HQ is a **generated target**, not ground-truth reality. HQ self-comparison is not an image quality score. Off-angle comparison against the capture photo conflates legitimate parallax with errors; no novel-view ground-truth photo exists. Black threshold includes legitimately dark furniture, so it is a conservative diagnostic, not true alpha coverage. ID/green support does not prove semantic plant count/species. ChatGPT vision judging through `tools/judge.py` is separately cached and reports uncertainty.

## Research / rights

Primary sources and licence receipts: `real-camera-20261018/research/` in the artifact store.

- [SteadySplats, arXiv 2610.05576](https://arxiv.org/html/2610.05576) combines history-based spatial reuse, temporal importance resampling and a training-time variance regularizer. Its reported +13 dB is against prior **stochastic 1-spp** renderers, not Spark's deterministic sorted blending. It needs new per-pixel sample/history/K-buffer machinery; it does not repair geometry or independently generated photos. [The original browser demo](https://x.com/sameh_khamis/status/2111642795765342345) was confirmed from the author's timeline/thread; the author identifies RTX 3090 Ti, no reusable source/licence link was found. Do not quote its 240 fps as this phone's performance.
- [TripoSplat](https://github.com/VAST-AI-Research/TripoSplat), 2026, explicitly [MIT code and weights](https://huggingface.co/VAST-AI/TripoSplat). Production-rights candidate, but the released inference path background-removes a foreground object and generates a canonical object; not qualified for exact-camera metric room reconstruction. Its DINOv3/Flux2-VAE/BiRefNet dependencies require a transitive rights audit. Not adopted without a room reprojection test.
- [ZipSplat](https://github.com/cvg/ZipSplat), 2026: Apache-2.0 code, **CC-BY-NC-4.0 weights** because of DA3-Giant/DL3DV. Not commercial-safe merely because its code is Apache.
- [SPFSplat](https://github.com/ranrhuang/SPFSplat), 2025: MIT code, sparse multi-view rather than qualified single-image room lift; checkpoint rights still need separate confirmation.
- [Flash3D](https://github.com/eldar/flash3d): single-image scene research; no affirmative production licence established (LICENSE and GitHub licence endpoint returned 404).
- [SHARP weights](https://huggingface.co/apple/Sharp/raw/main/LICENSE): Apple AMLR, scientific research only, explicitly excludes product development/commercial products. This blocks the old default pipeline.

## Baseline image metrics and human/vision inspection

All **6 poses / 24 raw splat frames** were captured and scored, with 6 cached ChatGPT judge verdicts. I inspected the complete `before/contact-sheet.jpg` and a full-size window frame. The overview and top rows retain only a narrow fragment of the room in raw splat mode; those black gaps are not the legitimate black area outside the cutaway. Fridge/china loses its large foreground eggplant canopy. Eye-level rows remain recognizable but show doubled magenta panels, fragmented stems and smeared window texture.

Six-pose arithmetic means against each pose's generated HQ:

| Image | PSNR dB ↑ | SSIM ↑ | LPIPS-Alex ↓ | Black/background diagnostic ↓ |
|---|---:|---:|---:|---:|
| Procedural | 15.772 | 0.4511 | 0.3267 | 6.97% |
| Fast preview | 15.222 | 0.4110 | 0.3812 | 4.24% |
| Raw capture-pose splat | 13.006 | 0.3712 | 0.5180 | 35.77% |
| Raw splat 5° / 0.3 m | 11.082 | 0.2629 | 0.6198 | 41.76% |
| Raw splat 15° / 0.3 m | 9.449 | 0.2304 | 0.7119 | 47.90% |
| Raw splat 30° / 0.3 m | 8.289 | 0.2068 | 0.8081 | 63.18% |

The local preview is **worse than beauty in PSNR, SSIM and LPIPS**, despite a modest judge realism increase (3.08 → 3.67 / 10). Its plant/layout faithfulness is essentially unchanged (5.58 → 5.53). It is removed from the default path rather than adding GPU contention and presenting a mismatched provisional style. HQ judge realism is 6.50 / 10 but faithfulness only 4.83; raw capture splat is 3.50 / 4.00, falling to 1.58 / 1.75 at 30°. These subjective ordinal scores are not calibrated measurements or a statistical significance claim.

Item-ID visible plant counts are 19, 6, 4, 21, 11, 6 by pose; HQ green-support counts are 18, 5, 4, 20, 11, 5. The judge explicitly declined reliable instance counting on small/overlapping plants. Thus neither colour support nor these judge verdicts certify that every real plant/pot identity was faithfully reproduced.

## Redesign and paired before/after experiment

The shutter/gallery implementation is in `ce02908`, pipeline-v3 backend in
`68f9fce`, and the deterministic depth-shell follow-up in `4ab5e7f`. The final
comparison **reuses all six original HQ images byte-for-byte**. This isolates
playback/geometry changes and spends **zero additional image-generation turns**.
`tools/replay_real_shell.py` refuses splat-only generation without an existing HQ,
copies immutable captures/depth/IDs, records source hashes, and produces independent
artifact-local coarse/fine shells. `tests/real_visual.mjs --cached` serves those
bytes through intercepted URLs, not owner photo jobs or a mutable fused manifest.

This does **not** show that the redesigned generation prompt improves plant
identity: the old HQ inputs predate the new per-plant/depth conditioning. Ordered
conditioning, per-instance cutouts/positions, prompt delivery and recovery are
exercised by backend tests, but a new live subscription shot with that conditioning
has not been visually qualified. The six original HQ turns remain the cohort.

Changes:

- One explicit exact-pose capture per shutter tap; flash/sound/Almanac flight;
  no generation from idle, camera movement, opening playback or polling.
- Default preview is a blurred developing beauty frame. The local SD/depth preview
  is research-only opt-in because its three image metrics were worse than beauty.
- Photos in Almanac and each visible plant's card, newest first; full viewer,
  Go to this view, Walk around, delete; stale selection/download guards.
- Crisp HQ overlay at the capture pose, fading to that **single photo's** coarse
  then fine shell. No cross-photo fusion/identity ghosting in the new default.
- CPU procedural-depth Gaussian shell: no learned lift weights; pixel-centred
  exact-camera rays; tangent covariance that skips depth jumps, bounded grazing
  footprints, unsupported-depth rejection and window-on-glass proxy.
- Backend in immutable cache identity; 40k coarse / 400k fine caps; atomic
  publication and deletion tombstones. SHARP requires explicit `sharp-research`.
- Navigation falls back to procedural geometry unless angle <15° AND translation
  <0.3 m with matching intrinsics. It is **not** advertised as full-room scanning.

### Six-pose means, identical cached generated target

| Raw rendering | PSNR dB before → after ↑ | SSIM before → after ↑ | LPIPS before → after ↓ | Black/background before → after ↓ |
|---|---:|---:|---:|---:|
| Capture pose | 13.006 → **23.427** | .3712 → **.7880** | .5180 → **.0703** | 35.77% → **3.51%** |
| 5° + 0.3 m | 11.082 → 11.879 | .2629 → .3074 | .6198 → .4418 | 41.76% → 23.32% |
| 15° + 0.3 m | 9.449 → 9.580 | .2304 → .2357 | .7119 → .6631 | 47.90% → 35.23% |
| 30° + 0.3 m | 8.289 → **7.886** | .2068 → **.1968** | .8081 → **.8553** | 63.18% → **69.43%** |

All three nonzero offset diagnostics are at the **0.3 m distance boundary**, hence
outside the strict production-valid region even at 5°. They intentionally bypass
the fallback and force the image overlay off. The 30° result is **worse**, not a
successful large-orbit reconstruction. The product returns to procedural geometry
there. The actual capture-pose pinned overlay is pixel-identical to the cached HQ
(SSIM 1, LPIPS 0; PSNR infinite/serialized as null), an overlay-integrity result,
**not** improved realism or a reconstruction score.

Each side contains **6 poses, 24 raw Spark frames, 6 cached vision verdicts**.
There are also 6 after pinned-photo screenshots. Direct visual inspection covered both
complete sheets, the paired comparison, and a full-resolution window offset.
Overview/top and fridge/china no longer collapse to a narrow unrelated fragment
at capture. Window/planter edges are much cleaner and capture-pose foreground
foliage is retained. At offsets foliage still fractures into dark leaf-shaped
cutouts, the planter shears into unsupported side strips, and pink LED rectangles
split/duplicate. Large black wedges at the right/top are unsupported view regions,
not merely the legitimate dark furniture.

The colour-support proxy at expected capture positions improves **35/67 → 63/67**
across repeated pose instances; this is **not 67 unique plants** or a semantic
count. ID-visible counts remain 19,6,4,21,11,6; four source-HQ support failures remain.

The independently projected exported-centre diagnostic has six-pose mean median /
p90 residual **5.17 / 84.16 cm before → 0 / 0.217 cm after**, with projected
procedural-support coverage **52.77% → 99.99%**. This includes the old fused scene's
post-anchor depths. Shell geometry is the procedural prior itself, so this is an
implementation-consistency check, **not** recovered photo-depth accuracy. The
shell's direct source-depth check accepts 6/6 by construction; it must not be
compared as a learned depth-estimator win against the 3/6 SHARP alignment rejects.

Judge realism / faithfulness for raw capture goes **3.50 / 4.00 → 5.33 / 4.97**;
5° goes **3.20 / 3.50 → 4.08 / 3.92**; 30° goes **1.58 / 1.75 → 1.25 / 1.25**.
The *unchanged* HQ is scored 6.50 / 4.83 before and 5.92 / 5.08 after: this drift
on identical images illustrates judgement/context variability. No significance or
semantic-fidelity claim follows from these uncalibrated ordinal scores.

## Latency by stage

Desktop RTX 3080 Ti Chromium, 412×915 emulated phone viewport; not a physical S25
or Tailscale benchmark. Capture below is the saved frozen capture timing. HQ is
**historical original generation**, not a fresh redesigned request. Shell timings
are new CPU wall time at nice 10; coarse elapsed includes input read/sampling and
fine/full elapsed includes the full preceding stage. Do not add them as disjoint
stage durations. Download is an **artifact-local Playwright intercepted transfer**,
not a network throughput claim; decode is real Spark decoding.

| Pose | Capture ms | Original HQ s | Coarse available ms | Full shell ms | Fine transfer / decode ms | Fine Gaussians |
|---|---:|---:|---:|---:|---:|---:|
| Overview | 219 | 45.29 | 106 | 747 | 154 / 59 | 189,582 |
| Window | 77 | 34.89 | 214 | 1,426 | 237 / 107 | 357,658 |
| Fridge/china | 79 | 45.05 | 200 | 1,885 | 378 / 115 | 356,961 |
| Top | 121 | 45.15 | 208 | 1,381 | 194 / 91 | 314,347 |
| Between high | 142 | 42.80 | 274 | 2,062 | 582 / 112 | 368,965 |
| Between eye | 122 | 43.39 | 197 | 1,637 | 338 / 112 | 375,289 |

Original SHARP: GPU queue 0–50.68 s, model load 17.36–23.83 s, network inference
6.98–10.40 s, total lift 33.11–86.61 s; alignment 0.145–4.393 s. The original local
preview's elapsed arrival was 0.77–44.58 s, despite warm inference of hundreds of
milliseconds. The new default removes both ML preview and ML lift waits, not the
34.89–45.29 s photo generation wait. Cached replay `hqElapsedMs` of 1–3 ms is only
receipt/image reuse, never a claim of millisecond image generation. Phone-viewport
playback samples have 16.60–16.75 ms median and 17.0–23.8 ms p95; short desktop
samples, not physical-phone performance qualification.

## Artifacts and regression receipts

All paths below are relative to
`$PRIVATE_DATA`:

- **Before sheet:** `before/contact-sheet.jpg`
- **After sheet:** `after/contact-sheet.jpg`
- **Paired comparison:** `comparison-contact-sheet.jpg`
- `before/metrics.json`, `after/metrics.json`, `comparison-summary.json` — numeric
  receipts; six individual `judge.json` files on each side.
- `after/<pose>/photo-pinned.png`, `splat-{0,5,15,30}.png`, `alignment.json`,
  `coarse.splat`, `fine.splat`; `after/records.json` carries original source hashes,
  frozen cameras, real-render assertions and per-pose playback timings.
- **All 33 selected free regression scripts pass**, including the four interrupted
  gates (`real_backend.py`, `real_pipeline_backend.py`, `camera_progressive.mjs`,
  `core.mjs`), capture/UI/race/progressive suites, depth-shell/replay/scorer unit
  tests, phone/Almanac/history/planner/AR/scan UI and voice regressions. The backend
  suite additionally passes its new legacy-gallery cache invalidation test (27
  backend-pipeline cases).
- `regression/suite.json` and per-script `.log` files preserve the final outcomes;
  `suite-initial.json` preserves the initial 29/31 sweep. The stale voice test
  required a literal “clear spacing” label although the actual successful UI says
  “Plants rearranged, score 79”; it now asserts semantic success while retaining
  zero-conflict, actual mesh-movement and undo checks. The scan geometry test
  failed under the **wrong interpreter** (ComfyUI OpenCV 5.0) and passes in the
  declared garden scan runtime (`.venv/bin/python`, OpenCV 4.11); scan code was not
  changed. Paid generation, live OAuth/WebRTC and GPU scan inference are excluded.
- Actual live photo-index readback exposed repeated legacy PNG inventory decoding:
  one pre-fix request took 21.95 s. Derived inventories are now persisted with
  input size/mtime invalidation (without altering capture/image inputs). The
  14-photo index took 5.75 s for the one-time legacy backfill, **9.15 ms cached**,
  and **24.37 ms after another web-service restart**. Receipt:
  `regression/live-gallery-index.json`; the web and independent scan services are
  active. This is loopback index latency, not image download latency.
- `after/gallery.png`, `photo-viewer.png`, `plant-photo-card.png` are inspected
  phone-width UI receipts using actual cached HQ images and recovered original
  timestamps/item-ID inventories. Newest-first ordering, all six cards and the
  plant-card photo strip were exercised without generation.

Reproduction commands and current backend/licence details: [../REAL.md](../REAL.md).
The owner-state SHA-256 still matched the frozen `ef5903…b1` after the paired replay.
Concurrent scan-import work and its `public/app.js` proposal-saving hunk are not
part of this Real change and must not be committed or reverted here.

## Remaining limitations

This is a better **camera/photo experience with bounded parallax**, not a solved
photoreal navigation system. The unchanged HQ can still invent pots, foliage,
pink spill, furnishings and fine texture; the new conditioning has no live visual
acceptance yet. Thin stems and leaves expose disocclusion holes immediately when
moving; an enlarged 2.5D shell cannot supply unseen sides. The top-down shell is a
photo-painted procedural surface rather than a reconstructed floor/plant canopy.
Large offsets remain bad and are hidden by honest fallback, not repaired. Spark
sorting/opacity can still soften edges; SteadySplats would not correct these wrong
surfaces and its browser source/reuse rights were not established. Semantic
plant/pot verification, real-phone latency, remote transfers and production rights
for any future learned replacement remain open. Spark/three.js are MIT; the shell
has no learned lift weights, while generated RGB remains subject to applicable
OpenAI terms. Do not call the whole pipeline production-certified.
