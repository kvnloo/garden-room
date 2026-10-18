# garden_room

Phone app for laying out the owner's dining room in 3D: 25 plants, the fridge, the china cabinet, the dining
table (pushed against the window wall as a plant shelf), 2 glass tables, 8 LED panels, 3 stake lights, a
5-arm floor lamp and 2 ring lights. The room has 5 walls: the **SE** corner is cut by an angled wall
that holds **only the narrow kitchen arch**. Coordinates are metres, x=east and z=south. Room v3 is the
entire v2 plan rotated 90° clockwise: fridge/china on east, window on north, main entrance on west,
mirror on south. Edge indices and edge-local opening/window distances stay attached to their walls.

- **Explore** (default): everything is locked; orbit, eye-level and fitted top views; tap items for stats.
  The dock is **Suggest · Live · Zen · Almanac** (Edit additionally exposes Items).
- **Edit**: drag items (plants can sit on the dining table and glass tables), tap to edit sizes in inches,
  lock/unlock, rotate. Doorways, the fridge door swing and a 72 cm entrance-to-kitchen route are no-go zones.
- **Suggest** combines arrangement proposals and **Saved layouts** in one sheet. A largest-first shelf/floor
  packing pass, simulated annealing, plant swaps and conflict repair penalize actual pot footprints and
  5–10 cm breathing room; different support IDs cannot conceal clumps. Light preference is weighted by
  high/medium/low need, while LED and floor-lamp pools let plants live away from the window. Unsafe results
  cannot be applied. The old arrangement is saved as **before cleanup**.
- **Real** is an Explore HUD filter: it switches all plants to their own photo cutouts and uses a carpet
  sample cropped from `refs/20261018_121414.jpg`, rather than opening a render-gallery dock panel.
  `GR.setRealScene(alignedObject)` allows a registered, spatially aligned scan to replace the procedural
  room. Older generated SHARP splats have no room calibration and are not silently overlaid on the plan;
  the existing render gallery / generation workflow remains available through `GR.openPanel('real')`.
- **Live** brings talk/start-stop voice, voice options, AR measurement, live room scan (legacy upload
  fallback) and the Hermes chat thread together. Modules can use `GR.addHubItem({key,label,icon,open})`;
  legacy `GR.addDock` keys ar/voice/chat/scan/scan_live automatically register in Live instead of the dock.
- **Scan** takes photos or video of the room, uploads to `data/scans/<id>/`, and asks Hermes to rebuild a
  `layout.json` for import. Hermes chat uses the exact local tmux/session portal (`bin/portal`).

## Geometry / light migration

Server startup backs up v2 state/layouts to timestamped `data/{state,layouts}.backup-*.json` and atomically
migrates every x/z/quarter-turn rotation, including light sources and saved layouts. It is idempotent and
also normalizes incoming v2 writes, so an older tab cannot put the NE geometry back. No compass was
inferred from the photos: the owner's SE designation is authoritative. The photos show the fridge at the
window end of the cabinet wall and the narrow dark kitchen arch at its other end. In 121348/121353 the
white double doors are visible **beyond the broad arch adjacent to the window**, not a clearly independent
opening opposite the window. The model keeps the broad west entrance separate from the SE kitchen;
a distinct extra closet opening needs owner confirmation rather than invented coordinates.

The north window now contributes **diffuse skylight only**: no directional sun shadows, cool soft fill,
and 0.65× normalized window contribution in the light score/heatmap. Grow-light pools are unchanged.
These are relative planning estimates, not measured lux or a location/date-calibrated solar simulation.

Design: zerOS Living Night tokens/primitives (`public/zeros/`, copied from zerOS `packages/ui-foundation`)
with liquid-glass surfaces and gold accents; fonts are Hanken Grotesk, Cormorant Garamond and IBM Plex Mono
(vendored via @fontsource).

Plant models: procedural three.js factories in `public/models/plants/<family>.js` (img2threejs approach)
on pots from `public/models/pots.js`. Families are mapped per plant in `public/plant_models.json`;
`approved: false` falls back to the photo cutout. Builders: `work/builders/run*.sh`. DeepSeek or Cerebras
writes the code, and `tools/judge.py` (ChatGPT vision) scores renders from `tests/capture_model.mjs`.

Run: `systemctl --user status garden-room` (port 8790 on 127.0.0.1 and the tailnet IP). Phone link: `bin/url`.
Test: `node tests/phone.mjs`, `node tests/core.mjs`, `python tests/planner_migration.py`, and
`node tests/{zen,voice,ar,history}.mjs` individually. Core/phone tests isolate state and care writes; core
captures the current saved fixture at 412×915 and checks spacing penalties and worker/direct parity.
Plant stands can be added from Edit → Items, measured in inches, and removed; no stands were invented
in the saved cleanup arrangement (it uses the existing dining table, both glass tables and floor).
Plant cutouts: `U2NET_HOME=work/models .venv/bin/python tools/cutouts.py` (rembg + excess-green mask).
