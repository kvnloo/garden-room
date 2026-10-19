# Real: camera photos with nearby Gaussian playback

Current pipeline: **3**, implemented in `public/modules/real.js`, `routes/real.py`,
`tools/render_real.py` and `tools/real_depth_shell.py`.

## User flow

- The HUD camera button is a **shutter**, not a persistent auto-generation toggle.
  A tap freezes the exact current camera matrix, quaternion, FOV/aspect, beauty,
  metric camera-Z depth and item-ID passes and submits one explicit job.
- A short flash, optional WebAudio shutter sound and thumbnail flight to Almanac
  acknowledge the capture. Reduced-motion preferences suppress the flight.
- While developing, show the blurred **procedural capture**, not a purported local
  photograph. Camera movement, idle, polling and playback never buy image turns.
- The subscription gpt-image-2 request receives beauty, a depth-layout guide, two
  real-room photographs, and individual cutouts for **every item-ID-visible plant**,
  with names, normalized bounding boxes and exact camera parameters in its prompt.
  These are conditioning inputs, not a guarantee of semantic correctness.
- Almanac → Photos lists shots newest first with time, camera and visible plants.
  The same shots appear on their plants' cards. A photo opens full view, **Go to
  this view**, **Walk around**, and delete actions.
- At the exact capture pose the HQ photograph stays crisp. Its opacity smoothly
  falls to zero by 4° or 8 cm movement. Nearby playback uses only that photo's
  Gaussians, first coarse then fine; it does not fuse independently invented photos.
- Live splat coverage requires **angle <15°, distance <0.3 m and matching
  intrinsics**. Outside that region the procedural room returns. These limits are
  conservative heuristics, not measured unseen-surface coverage.

## Default geometry: deterministic depth shell

The generated photo is projected onto the captured procedural metric depth, with
pixel-centred camera rays and tangent-aligned, bounded Gaussian covariance. Invalid
source depth is skipped; window colour stays on the captured glass proxy rather
than an inferred outdoor surface. Depth jumps do not create stretched tangents.

The CPU implementation uses NumPy, SciPy and Pillow, **no ML lift weights**, no
GPU queue and no SHARP inference. Coarse uses at most 40,000 Gaussians; fine at most
400,000. Each standard `.splat` record is 32 bytes. Coarse and fine are published
atomically under the deletion/publication lock, with per-stage timing receipts.
The browser caps Real DPR at 1.25 and restores the original DPR on exit.

This is a **single-view photo shell, not recovered photographic depth or a scanned
room**. Near-zero procedural-depth residual is expected by construction. Thin
foliage can carry the photo's wrong surfaces/occlusions; hidden sides are missing.
Do not advertise the acceptance check as reconstruction accuracy.

## Backends, rights and cache identity

| Component | Default / rights |
|---|---|
| HQ photo | ChatGPT subscription `image_generation` / gpt-image-2; applicable OpenAI terms, not open model weights |
| Gaussian lift | `GARDEN_REAL_BACKEND=shell` (default), alias `procedural-depth-shell`; no learned lift weights |
| Experimental lift | `GARDEN_REAL_BACKEND=sharp-research` only; Apple SHARP AMLR weights explicitly exclude product development/commercial products |
| Playback | Spark 2.3.1 and three.js 0.186.1, MIT |
| Research preview | Disabled. `REAL_RESEARCH_PREVIEW=1` explicitly opts in to the old SD-Turbo/depth-ControlNet comparison; ControlNet production rights remain unclear |

`productionSafe` on a shell receipt concerns **lift-weight licensing only**, not
photo fidelity, all transitive rights, or general product readiness. SteadySplats,
TripoSplat, ZipSplat, SPFSplat and Flash3D research/rights decisions are documented
in [the visual report](research/real-visual-tests.md). None is silently installed
or claimed as a qualified replacement.

A backend is frozen in a new capture and forms part of its cache identity, alongside
pipeline, layout revision and quantized lookup pose. Stored camera matrices are not
rounded. Layout edits invalidate active overlays and scene epochs; late downloads
cannot attach to a newer layout/selection. Old SHARP jobs remain labelled research.
Existing HQ/raw HQ files survive worker restart without repurchase, including an
explicit provenance-gap label if a receipt was interrupted.

Photos and tombstones live in `data/renders/real/<revision>/<view-id>/`:

- `POST /api/real/view`: requires `explicit: true`; max three in-flight jobs.
- `POST /api/real/layout`: identify layout, never generates an image.
- `GET /api/real/<revision>/views`: jobs and legacy manifest.
- `GET /api/real/photos`: all non-deleted HQ photos, across revisions.
- `POST /api/real/photo/<revision>/<view-id>/delete`: durable tombstone; late
  publication cannot resurrect a deleted photo in the index.

No Real route reads or writes `data/state.json`. Tests route owner-state reads to
`{}` and intercept owner-state/journal writes. Do not restore old owner data.
Legacy panorama/uncalibrated SHARP CLI work requires the explicit research backend;
`--splat-only` on a captured job requires an already-existing HQ image.

## Qualification and repeatable evidence

Current evidence root:
`$PRIVATE_DATA`

The immutable owner snapshot SHA-256 is
`ef59037607474726fa4ba3d9141337e63c8bd06b86cbc3cb9f7afa719e49b8b1`.

See [real-visual-tests.md](research/real-visual-tests.md) for six-pose before/after
metrics, contact sheets, cached vision judgements, per-stage latency, regressions
and remaining visual defects. Earlier `real-20261018*` artifact directories qualify
older revisions and remain historical evidence, not this pipeline's acceptance.

Free regression commands (ComfyUI Python has scorer/geometry dependencies):

```sh
node tests/camera_capture.mjs
node tests/camera_ui.mjs
node tests/camera_races.mjs
node tests/camera_progressive.mjs
node tests/real_capture.mjs
node tests/real_ui.mjs
env -u PYTHONPATH -u PYTHONHOME $PRIVATE_DATA tests/real_backend.py
env -u PYTHONPATH -u PYTHONHOME $PRIVATE_DATA tests/real_pipeline_backend.py
env -u PYTHONPATH -u PYTHONHOME $PRIVATE_DATA tests/real_depth_shell.py
env -u PYTHONPATH -u PYTHONHOME $PRIVATE_DATA tests/real_visual_metrics.py
env -u PYTHONPATH -u PYTHONHOME $PRIVATE_DATA tests/real_replay.py
node tests/core.mjs
node tests/phone.mjs
node tests/almanac.mjs http://127.0.0.1:8790
```

Cached visual replay, **zero new image turns**:

```sh
E=$PRIVATE_DATA
P=$PRIVATE_DATA
env -u PYTHONPATH -u PYTHONHOME "$P" tools/replay_real_shell.py "$E/before" "$E/after"
REAL_STAGE=after REAL_OUT="$E/after" node tests/real_visual.mjs --cached
env -u PYTHONPATH -u PYTHONHOME "$P" tools/score_real_visual.py "$E/after"
```

`--judge` additionally invokes a cached ChatGPT vision judge, once per pose if no
verdict exists. `tests/real_visual.mjs --generate` is **paid/live opt-in**, limited
to six cached pose jobs per output directory; do not use it in a normal suite.
After shell-only replay the HQ timings are retained historical generation costs;
`hqElapsedMs` is cached receipt loading, **not** a new generation speed claim.

Restart after route changes: `systemctl --user restart garden-room`. Never print
app tokens, OAuth credentials, headers, private source photos or cutouts in logs.
