# garden_room

Phone app for laying out the owner's dining room in 3D: 25 plants, the fridge, the china cabinet, the dining
table (pushed against the window wall as a plant shelf), 2 glass tables, 8 LED panels, 3 stake lights, a
5-arm floor lamp and 2 ring lights. The room has 5 walls: the NE corner is cut by an angled wall that holds
the kitchen archway.

- **Explore** (default): everything is locked; orbit, eye-level and top views; tap anything for its stats.
- **Edit**: drag items (plants can sit on the dining table and glass tables), tap to edit sizes in inches,
  lock/unlock, rotate. Doorways and the fridge door swing are shown as no-go zones.
- **Suggest**: simulated annealing proposes 3 arrangements. The fridge never moves, door clearances are
  hard constraints, and plants are pulled toward the window and onto table shelves.
- **Real**: sends the view to Hermes. It runs gpt-image-2 (photo + 360° panorama) and SHARP (photo → 3D
  Gaussian splat), and the app can walk you through the result (`world.html`, Spark viewer).
- **Scan**: take photos or a video of the whole room. They upload to `data/scans/<id>/` and Hermes is
  asked to rebuild the layout into `layout.json`, which the app offers to import.
- **Hermes**: types into the tmux pane running this exact Hermes session (`bin/portal`) and reads the
  replies from `state.db`.

Design: zerOS Living Night tokens/primitives (`public/zeros/`, copied from zerOS `packages/ui-foundation`)
with liquid-glass surfaces and gold accents; fonts are Hanken Grotesk, Cormorant Garamond and IBM Plex Mono
(vendored via @fontsource).

Plant models: procedural three.js factories in `public/models/plants/<family>.js` (img2threejs approach)
on pots from `public/models/pots.js`. Families are mapped per plant in `public/plant_models.json`;
`approved: false` falls back to the photo cutout. Builders: `work/builders/run*.sh`. DeepSeek or Cerebras
writes the code, and `tools/judge.py` (ChatGPT vision) scores renders from `tests/capture_model.mjs`.

Run: `systemctl --user status garden-room` (port 8790 on 127.0.0.1 and the tailnet IP). Phone link: `bin/url`.
Test: `node tests/phone.mjs` (S25-sized touch viewport; does not write to the saved layout).
Plant cutouts: `U2NET_HOME=work/models .venv/bin/python tools/cutouts.py` (rembg + excess-green mask).
