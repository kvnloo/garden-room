# Import a room scan as a layout

## What was missing

Recognition and layout import were separate, and only recognition existed. The scan worker returned detections plus per-object corrections; the client could apply one correction but had no whole-layout proposal, review, saved-layout action, or finished-scan history. Stopping cleared the active scan ID. Plant appearance matching exposed only three candidates and usually remained unsure without aligned metric positions. Geometry tracks also age out, so the last frame alone cannot represent a whole walkthrough.

The actual photograph replay confirms an additional limitation: the 2D camera path has no measured translation. Recovered COLMAP poses have arbitrary scale. Neither may silently become room metres. The new import path does not manufacture alignment to hide this.

## Owner workflow

1. Open **Live → Live room scan**, scan, then choose **Import scan as layout** during or after scanning. Alternatively choose **Scan history → Review** for a finished scan.
2. Compare the **Current** and **Scanned** mini-maps. Gold footprints indicate selected changes. Each observation shows its candidate identity, confidence, position/movement and reasons it cannot be imported. Unseen items remain unchanged and appear in a separate list.
3. Confirm ambiguous identities, exclude unwanted changes, or use **Place on map** / explicit x,z coordinates. Manual positions are estimates, not scan measurements. In 2D mode, this explicit placement is necessary; saving a wholly unlocated scan is disabled.
4. **Import as new layout** saves `Scan <date>` through `GR.saveLayout` without changing the live room. A successful response is followed by an exact saved-layout readback before reporting success.
5. **Apply to room** uses the same `applyPlan` function as Suggest, rebuilding Three meshes and persisting the arrangement. **Undo import** restores the previous arrangement while the review session remains open. Concurrent edits invalidate review/undo instead of being overwritten.

Known plants retain their existing dimensions: foliage height/width is not a reliable replacement for pot depth or support geometry. Confident unknown plants with measured dimensions can be proposed as **Unknown plant**; foliage width is a conservative footprint and is explicitly labelled. Existing locked items cannot move. Bounds and fridge swing are checked on individual changes and on the composed layout; the client also rejects new planner hard warnings such as collisions/clearance problems.

Matching uses a global one-to-one assignment over the current room items. Plant scores combine appearance against all 25 cutouts, distance continuity after XR-to-room transformation, and available PlantCV height. Furniture labels map to existing fridge, china cabinet, dining/glass table and lamp items. Confidence is a heuristic, not a validated probability. Similar foliage, duplicate tracks and poor camera coverage still require human review.

## Implementation and contracts

- `tools/scan_live_layout.py`: stdlib proposal generation shared by worker and persisted-scan review.
- `tools/scan_live_worker.py`: bounded 100-observation ledger, full appearance candidate list, `planSnapshot`, `createdAt` and `proposal` in scan results.
- `routes/scan_live.py`: authenticated `GET /api/scan_live/history` (latest 200), and `POST /api/scan_live/<id>/proposal` with `{plan, decisions}`. Both work from private persisted results after worker restart. Review does not mutate source scans or owner state. Plan/request/artifact sizes are bounded.
- `public/modules/scan-layout.{js,css}`: review, map/manual placement, selection, save/apply/undo and stale-review protection.
- `public/app.js`: optional proposal argument to `GR.saveLayout`, plus the shared `GR.applyPlan` and `GR.checkPlan` integration points. Legacy save calls retain offline behavior; scan saves require confirmed server persistence.
- `GR.scanLive.review(id)`, `.history()` and `.layout.{refresh,save,apply,undo,proposal}` expose the workflow for automation.

`proposal.coordinateFrame` is `room-x-east-z-south-metres`. Automatic positions require both metric WebXR observations and a valid rigid alignment. The transform is recomputed from raw XR positions instead of trusting a stale `planPosition`. Explicit manual x,z decisions are the only exception and are labelled as such. Nonmetric COLMAP/IMU data stays nonmetric even when it produces a 3D preview.

## Reproduction and evidence

```sh
python tests/scan_layout.py
python tests/scan_live_api.py
.venv/bin/python tests/scan_live_geometry.py
# Requires local owner JPEG derivatives + recovered poses from tools/scan_live_colmap.py.
env -u PYTHONPATH .venv/bin/python tests/scan_layout_pipeline.py
node tests/scan_layout.mjs
node tests/scan_live.mjs
node tests/scan_live_xr.mjs
node tests/scan_live_ui.mjs
node tests/scan_live_view.mjs
node tests/ar.mjs
node tests/phone.mjs
node tests/suggest.mjs
```

`tests/fixtures/scan-real.json` records actual OWLv2/PlantCV responses from the owner photograph `20261018_121441.jpg` (SHA256 `166cb095e005a8b45ae59a397938aac496b8ee6a53db60408bbc4a3c2fec2b0a`) plus a separate three-frame recovered-pose replay. It is not a physical WebXR scan. `tests/fixtures/scan-metric-contract.json` reuses an actual appearance record but **injects metric XR coordinates and alignment** solely to test the automatic import contract. It is explicitly not physical measurement evidence.

Latest real pipeline run: 10 plant detections with 25 identity candidates each; 10 tentative plant matches; three recovered-pose frames with 585 geometry points. Metric flag false and zero automatic changes, as required. The response/proposal is written to `work/scan-layout-evidence/real-pipeline.json`. Stationary plant frames and moving COLMAP furniture frames are distinct evidence, not falsely described as one metric walkthrough.

The browser suite exercises real app/Three meshes against recorded detections and the actual Python proposal function. It verifies manual placement of real 2D detections, item exclusion, exact saved-layout readback (including a discarded-write failure), scene movement, preservation of unseen items, undo, reload, history and stale-review guards including edits during the request. Owner state/layout writes are intercepted; `data/state.json` remains byte-identical.

Screenshots are under `work/scan-layout-evidence/` and copied to `$PRIVATE_DATA`: `scan-layout-imported-top.png`, `scan-layout-review-ready-{360,412,768}.png`, and `scan-real-review-412.png`. Visual review confirms visible imported room meshes and side-by-side review maps with unclipped footer actions. The top view remains crowded by existing plant care overlays; this is not a reconstruction-quality claim.

Broader regression receipts are in `regression-summary.json` with per-suite logs. Scan, geometry, AR, phone, Suggest, core, Zen, history and related Python API suites pass. Voice is not fully green: a live-provider 502 blocked `voice.mjs`; `voice_fallback.mjs` returned `reobserve` instead of `abstain`; `voice_suggest.mjs` found no clear arrangement; the WebRTC suite passed live audio/tool checkpoints but timed out. These are reported, not hidden by changing unrelated voice code.

## Still needs the S25 Ultra

A fresh slow sideways room scan with genuine WebXR raw-camera frames and metric poses is required to qualify automatic room alignment, drift, depth/plane availability, unique identification of all 25 plants, unknown-item sizing, furniture completeness, and microphone coexistence. Confirm the saved `Scan <date>` layout and apply/undo on-device. Current desktop tests prove the import mechanism and its safety boundaries, not measured physical layout accuracy or complete room coverage.
