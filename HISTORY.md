# Plant history (private local data)

Open a plant → **History**. The timeline has real, dated photos; the model-growth preview is explicitly illustrative, not a measurement or a diagnosis. It scales the existing seed-stable model through 24 interpolated logistic stages, from 15% height/spread to today's size. The pot never scales. A separate nested preview group avoids fighting Zen's animated holder transform. Closing/changing sheets restores the original scene without saving a layout.

- Play defaults to 4 seconds; speed 0.25–4×, pause, date scrub, filmstrip seek.
- Real timelapse restores the full-size model and crossfades actual photos, centering/zooming on known normalized boxes.
- Grid is newest-first; full viewer uses the 1600px derivative, with swipe/arrow controls.
- “Not this plant”, “Confirm”, and library “Add to this plant” persist owner overrides. Client verifies each write by re-reading that plant's timeline.
- Unsure means **identity is not confirmed**. Similar pepper/curry plants and changed pots are not separable reliably from a whole-photo embedding. Scores are cosine similarity, not probabilities.
- File-modification dates are identified in the viewer when no capture EXIF/filename timestamp exists. Undated Telegram exports are common.

## Re-index

From this project directory:

```sh
uv pip install --python .venv/bin/python torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv/bin/python transformers safetensors rawpy pillow numpy
.venv/bin/python tools/history_index.py
.venv/bin/python tools/history_review.py
```

System dependencies: `vips`, `exiv2`, libraw; GPU models download once into `work/models/{hf,torch}`. Tested with torch 2.11.0+cu128, torchvision 0.26.0+cu128, transformers 5.20.1, rawpy 0.27.1. EXIF is read without decoding a raw pixel array. Samsung JPEG-XL DNGs unsupported by system libraw use the embedded camera JPEG via rawpy, then vips shrink-on-load. HEIC's item-count guard is relaxed only for these explicitly selected local sources.

The three configured source roots are recursively scanned for JPG/JPEG/PNG/WebP/HEIC/DNG. Videos/archives are not indexed. Telegram chat-export image subdirectories are included (not just the few direct image files). Path-derived SHA1 IDs deliberately retain duplicates in different source paths. Original bytes are never edited. The intake manifest is in the **parent** of `raw/`, not inside it.

`data/history/index.json` records paths and date provenance; `thumbs/` holds 512px/1600px WebPs. All images fed to GPU/Python pixel processing are <=1600px derivatives. The optional full-resolution DNG array is never accessed. The detector is torchvision COCO FasterRCNN (potted plant), followed by DINOv2-small whole/object/multiscale embeddings, with a 15% lower-crop pot-appearance component. Normalized boxes are tagged with their source method. CPU fallback works but is slower.

Default confident cutoff .86; .68–.86 is unsure. These conservative cutoffs were raised after visual review found near-identical plants and missing/ambiguous pots. Deterministic source-photo assignments reuse the existing hand-picked reference boxes, which may themselves need owner correction. `tools/history_review_decisions.json` excludes visually rejected proposals; **owner overrides always win**, including re-adding a rejected candidate.

Runs reuse thumbnail fingerprints and cached embeddings/detections; changed sources invalidate both feature caches. Final index writes and overrides use atomic replace. `--thumbs-only` skips GPU identification. The data and caches remain ignored by Git. To re-evaluate from scratch, remove only `work/history/*-{dino,detector}.npz`; do not remove owner overrides.

## API and privacy

Authenticated API:

- `GET /api/history/plant/pNN` → chronological photos, assignments, crop boxes; never source paths/descriptions/EXIF.
- `GET /api/history/photos?offset=0&limit=24` → paged private library (max 60/page).
- `POST /api/history/assign {photo,plant,on}` → atomic `overrides.json`; validates IDs and real booleans.

The existing server's `/history/` static mapping serves derivatives **and the raw index**. This feature does not change the server's network/auth policy. Keep deployment tailnet/private; hardening static history access belongs in `server.py` (outside this module's edit scope). Source paths must not be treated as public-safe data.

Only 48 grid images, eight film neighbours, two crossfade slots, and one full-size viewer stay active; the optional library has 24 lazy thumbnails. No raw files or model weights transfer to the phone. The real-data test additionally verifies every current plant's **entire** 512px photo timeline plus largest 1600px viewer is <8 MB.

## Verify without touching saved layout/corrections

```sh
.venv/bin/python tests/history_api.py
node tests/history.mjs
node tests/history_real.mjs
node tests/phone.mjs
```

UI fixtures explicitly mock corrections. API tests use a temporary local directory. Real-data and original phone tests intercept state/layout writes; the real-data history journey forbids assignment POSTs. Screenshots/review sheets are under `work/history-{shots,review}/`; downscale/contact-sheet to <=768px before vision review.
