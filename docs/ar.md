# About camera-based room measurement

Garden Room uses the existing MIT-licensed three.js 0.186 dependency with the browser's WebXR API. The session requires `immersive-ar`, `hit-test`, and `dom-overlay`. Anchors, CPU depth, and `local-floor` are optional. The renderer uses `local` space, so it does not require the runtime to estimate the floor origin.

This follows the [three.js hit-test example](https://threejs.org/examples/webxr_ar_hittest.html) and the [Immersive Web hit-test and anchor samples](https://immersive-web.github.io/webxr-samples/). No new framework, remote JavaScript, paid service, or native app is involved.

## Why hit testing is the baseline

[Google's WebXR comparison](https://developers.google.com/ar/develop/webxr/arcore-comparison) lists hit tests, anchors, and depth as shipped in Chrome. It still labels plane detection a developer trial. This table does not guarantee that a particular phone grants an optional capability. The implementation checks the active session rather than inferring support from the user agent.

The [2026 anchors draft](https://immersive-web.github.io/anchors/) describes persistent handles. Android support for ordinary anchors does not imply support for persistent handles. Garden Room calls `requestPersistentHandle` and `restorePersistentAnchor` only when present. Without successful restoration of both corners, the owner must tap the corners again. A saved matrix alone never localizes a new session.

[Depth sensing](https://immersive-web.github.io/depth-sensing/) supplies an optional centre-view depth point when no hit-test result exists. The UI calls this a **depth estimate**. Floor calibration always requires a horizontal hit below the phone. Depth availability does not imply precise measurement or object recognition.

[model-viewer](https://modelviewer.dev/examples/augmentedreality/) is a good model-placement component. It does not supply the custom multi-point ruler, room transform, or dimension-assignment workflow. Its native Scene Viewer fallback also cannot retain the app's DOM controls. A second scene component would duplicate the existing three.js renderer.

## How room alignment works

The owner chooses two numbered corners on the mini plan. The plan marks the window, fridge, and item footprints. The owner aims the centre reticle at each physical floor corner and taps **Place point**.

`ar-core.js` fits a rigid rotation and translation in the horizontal plane. It never rescales AR metres. It rejects duplicate corners, non-level floor points, and distances that disagree by more than the larger of 12 cm or 8 percent. The first point fixes translation. The direction between points fixes heading. An optional pair of anchors updates the transform as tracking improves.

The gold dot and cone update the mini plan and the host scene. Live tracking exists only during the XR session. After AR closes, the host scene retains a marker labelled **last tracked position**, not a live location. Tracking loss hides live overlays. A reference-space reset clears alignment.

Floor footprints are optional. Drag correction takes place on the mini plan and calls `GR.moveItem`. Locked items cannot be dragged. The host layout remains the authority.

## How dimensions are assigned

The owner chooses an item rather than relying on automatic recognition. Width and depth use horizontal endpoint distance. Height uses a vertical line through the base and the centre-view ray. The owner stays side-on, places the base, raises the aim along the guide, and places the top. Foliage height starts at the pot rim because `GR.setProps` adds pot height separately.

Every dimension displays inches first and centimetres second. Assignment snaps to half an inch and requires all dimensions for the chosen item. Round plants use `potD`, `potH`, and `height`. Box plants use `w`, `d`, `potH`, and `height`. Other objects use `w`, `d`, and `h`.

The free ruler stores a 3D polyline with segment labels, a total, undo, and clear. Placement requests a short vibration when the browser permits it. UI touches do not also generate XR placements.

## Why the photo fallback is an estimate

The fallback opens the phone's photo chooser with rear-camera capture requested. It does not upload images. A card's long edge is 85.6 mm. The other references are the fridge width from the current plan or a custom width in inches.

The owner taps two reference endpoints and then object endpoints. This is a 2D pixel ratio, not reconstructed depth. Reference and object must occupy the same plane, and the camera must face that plane square-on. A new side photo is needed for depth. Every new photo clears the reference scale but preserves completed dimensions. Canvas taps account for image letterboxing.

These measurements are estimates. Glass, thin leaves, blank walls, reflections, low light, perspective, and tracking drift can produce errors. Half-inch rounding is not an accuracy guarantee. A physical tape remains necessary before buying fitted furniture or cutting material.

## Implementation boundaries

- `public/modules/ar.js` owns the UI, session lifecycle, scene overlays, and GR calls.
- `public/modules/ar-core.js` contains pure geometry and the injectable `XRFrame` adapter.
- `public/modules/ar.css` reuses Living Night tokens and makes the expanded dock horizontally scrollable.
- `routes/ar.py` owns authenticated `GET` and `POST /api/ar/calib`. It atomically writes private `data/ar/calib.json`.
- Local calibration uses `gr_ar_calib_v1`. Records contain the room signature, corner IDs, transform, points, optional persistent handles, and timestamp.

AR has a separate transparent WebGLRenderer. The host owns a continuous `requestAnimationFrame` loop and camera-dependent cutaways. Sharing that renderer would introduce competing normal and XR renders. Neither `public/app.js` nor `server.py` changes.

## Verification boundaries

`node tests/ar.mjs` runs pure geometry checks, injected session and frame contracts, and actual Chromium photo-fallback UI tests. It intercepts state and calibration API writes. Generated test charts are not camera photographs. Screenshots under `work/shots/ar-*` include a fake-XR screenshot, not physical camera passthrough.

`python tests/ar_api.py -v` checks validation, an atomic save followed by exact readback, permissions, empty storage, and route boundaries. It uses an owned scratch directory and does not replace the owner's calibration.

Physical S25 Ultra verification remains necessary for camera permission, passthrough, DOM overlay visibility, surface acquisition, drift, optional depth, persistent handles, vertical aiming, haptics, and session exit. The tests cannot certify phone sensor accuracy or ARCore performance.
