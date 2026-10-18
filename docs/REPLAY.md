# Private live watching for Garden Room

## Open it

**Desktop viewer: https://<your-tailnet-host>:8790/watch.html**

It uses the phone app's existing key (`gr_key` in this origin's local storage). If this
browser has not opened the authenticated app yet, enter the same app key in the viewer.
Do not put keys in query strings. The HTML shell is public, like the app shell; every
recording/list/timeline request is key protected and restricted to loopback/tailnet peers.
No recordings are exposed as static files.

Reload the phone app once after installation. A small glass **● REC** button appears below
the top-right HUD. Tap it to pause; **◌ PAUSED** persists across reloads. An amber REC means
transport is offline. Recording is on by default as the owner requested, not hidden.

The viewer follows the most recently updated session, including 15-minute recording segment
rollovers. Select another session to pin it, click a complaint to inspect its time, or use
the date/time control. **Follow live** returns to the newest recording. The timeline includes
console/errors, taps, panel/selection state changes, voice utterances and complaint markers.
This is a watch-only replay, not remote input/control.

## Choice and research

| Tool | Findings from primary documentation | Decision |
|---|---|---|
| [Meticulous](https://app.meticulous.ai/docs) | Commercial session capture → selected deterministic frontend tests → PR visual/behavioral diffs. [Recorder installation](https://app.meticulous.ai/docs/recorder-installation) requires an organization/project/repository; warns that network recordings can include authorization tokens/headers. No public free tier, documented local-only live watcher, or confirmed free self-host distribution was found. Enterprise/on-prem terms require vendor confirmation, not an assumption that they are impossible. | Not a dependency for watching. Useful later for generated regressions, after explicit vendor/privacy approval. |
| [rrweb](https://github.com/rrweb-io/rrweb) | [MIT](https://github.com/rrweb-io/rrweb/blob/main/LICENSE), embeddable recorder/replayer. [Live mode](https://github.com/rrweb-io/rrweb/blob/main/docs/recipes/live-mode.md) supports `liveMode`, `play`/`startLive`, and `addEvent`. | **Chosen: locally vendored rrweb 2.1.7 + our stdlib transport and low-FPS WebGL images.** No Docker/database/hosted dependency. |
| [OpenReplay](https://github.com/openreplay/openreplay) | Self-hosted replay + live co-browsing, console/network tools and WebGL support. Multiple services via self-host installer/container infrastructure. [License](https://github.com/openreplay/openreplay/blob/main/LICENSE): AGPLv3 default, some MIT, separate `ee/` terms. | Capable, but operationally excessive for one tailnet user. |
| [PostHog](https://posthog.com/docs/self-host) | Replay integrated into analytics. Self-host documentation offers a hobby Docker deployment with multiple services, rather than a tiny embedded replay store. [License](https://github.com/PostHog/posthog/blob/master/LICENSE): MIT outside separately licensed `ee/`. | Too much infrastructure for this app. |
| [Highlight](https://github.com/highlight/highlight) | Self-hostable full-stack monitoring/replay/error platform, with container/service deployment rather than just a library. [License](https://github.com/highlight/highlight/blob/main/LICENSE): Apache-2.0 core, separately licensed directory exceptions. | Good integrated observability, unnecessary here. |

The initial `docs.meticulous.ai` fetch failed TLS; the authoritative product docs are actually
at **app.meticulous.ai/docs**, which were retrieved successfully. No hosted account was created,
no key was sent to a vendor, and no paid installation was assumed free.

### Optional Meticulous later (not installed)

1. Confirm pricing/free eligibility and any enterprise self-host option with Meticulous.
2. Create an organization/project, connect the repository, and follow its
   [recorder](https://app.meticulous.ai/docs/recorder-installation) and
   [CI](https://app.meticulous.ai/docs/ci) guides. The documented CLI onboarding form is
   `npx @alwaysmeticulous/cli onboard --project="<ORGANIZATION>/<PROJECT>"`.
3. Put its recorder **before other app scripts** in a dedicated non-production preview,
   not on the owner's live phone by default. Use separate non-production credentials:
   unlike this watcher, Meticulous records network responses and browser storage.
4. Confirm the runner can reach a suitable preview; do not expose the private tailnet app
   publicly just to allow SaaS access. Verify a real recorded flow produces a PR result.
5. Keep this private watcher: generated regression tests are not a replacement for live
   complaint-time viewing. A hosted snippet would be an explicit exception to the app's
   current no-CDN/no-SaaS recorder policy and needs owner approval.

## Capture and transport

`public/modules/replay.js` exports `init(GR)` and is loaded by the existing module loader.
`public/modules/replay.css` owns the indicator. No changes to app.js/server.py are required.

- rrweb captures DOM, scroll, taps, input mutations, CSS and viewport state. Text/password/
  textarea fields are masked; numeric plant dimensions remain visible. `[data-private]`,
  `.replay-private`, and video elements are blocked. No local/session storage dump, microphone,
  camera stream, request body, response body, request headers or provider configuration capture.
- WebGL draw-command instrumentation (`recordCanvas`) is deliberately **off**. Instead, the
  existing preserveDrawingBuffer canvas is downsampled to a maximum 900-pixel long side and
  JPEG-encoded at quality .68, at up to **2 FPS**. One encode at a time prevents overlap.
  Frame timestamps identify capture time, not upload/encode completion.
- Every ~1 second, ordered/deduplicated batches go to the existing authenticated server.
  Failed batches retry with the identical sequence number; the bounded memory queue records
  drops and takes a new full DOM checkpoint after overflow. A crash/navigation may lose the
  final in-flight batch; `pagehide` attempts a flush, not a guaranteed persistent offline queue.
- Full DOM checkpoints are taken every 60 seconds and on resume. Segments roll every 15 minutes
  without reloading or changing the owner's app state. The viewer attaches from a recent full
  snapshot, then applies incremental events; periodic images overlay only the recorded canvas.
- Side-channel events: console levels, JS errors, unhandled rejections, failed fetch paths/status/
  timing, mode/view/selection/open sheet/voice/AR flags, FPS/frame percentiles and long tasks.
  Diagnostic strings and all stored event JSON redact the actual app key, bearer tokens and
  credential-like URL parameters on both client and server. This is not universal PII detection:
  visible room information, voice text and ordinary diagnostic content are intentionally private
  but recorded. Never log unrelated provider secrets in the app console.
- Pause stops capture and new diagnostics. Pre-pause queued events can finish delivery. Hidden
  tabs do not capture canvas frames. Native immersive WebXR/camera overlays are not screen-recorded;
  this records the app DOM and main Three.js canvas, not the phone's OS or native camera view.
- Replay scripts never execute the app again: rrweb reconstructs an inert iframe. Animations and
  transitions are disabled in playback so paused entrance animations do not hide sheets. This
  captures current interface state, not exact animation-phase video.

### Endpoints

All need existing `X-Garden-Key` authentication. Replay responses add `Cache-Control: no-store, private`.

- `POST /api/replay/batch` — `{session, batch, events}`; max 2 MB, ordered batches, retry dedupe.
- `GET /api/replay/sessions` — recent recording metadata, newest first.
- `GET /api/replay/events?session=ID&recent=1` — attach at latest checkpoint.
- `GET /api/replay/events?session=ID&after=BATCH` — cursor follow; `cursor`/`has_more`.
- `GET /api/replay/events?session=ID&at=UNIX_MS` — historical checkpoint + events to time.
- `GET /api/replay/timeline?session=ID&since=UNIX_MS&until=UNIX_MS` — merged replay/voice/inbox.

Storage: `data/replay/sessions/ID/{meta.json,batch-NNNNNNNN.json,timeline.jsonl}`. All data is
gitignored; private directories/files use 0700/0600. Retention removes oldest complete sessions
and complaint bundles: **7 days or 2,000,000,000 bytes, whichever is reached first**. Byte usage
is charged at ingest; periodic full reconciliation avoids recursively scanning the entire archive
every second. Complaint capture forces reconciliation. Standalone snapshot files in the replay
root are included at reconciliation. This is a single-process stdlib server, not a multi-writer
storage service; don't run two server instances against the same replay directory.

## Hermes: look without a human viewer

From the repository:

```sh
python3 tools/replay_tail.py --seconds 30
python3 tools/replay_tail.py --follow
python3 tools/replay_snapshot.py --output data/replay/current.png
python3 tools/replay_snapshot.py --at 2026-10-18T17:29:39-05:00 --output data/replay/then.png
# Add --session ID to pin any of these to a particular recording.
```

`replay_snapshot.py` uses **playwright-core + /usr/bin/chromium**, opens the local viewer with a
key injected internally into origin storage, reconstructs the recorded DOM + saved canvas image,
and writes a PNG at the owner's recorded viewport. It prints `{output,session,at,frame_ts,viewport}`.
Read the PNG with the agent's vision tool. It does **not** take a screenshot of a new running copy
of the app or regenerate a guessed 3D scene. A missing frame exits nonzero rather than inventing one.
`--at` accepts Unix seconds, milliseconds, or ISO timestamps. No key appears in argv/output.

### Automatic complaint context

The replay route starts a small daemon thread within garden-room.service. It watches the existing
`data/voice/inbox.jsonl` independently of whether the Hermes worker is currently busy. After a
1.5-second grace for the final recording batch it captures:

```
data/replay/complaints/INBOX_ID/
  snapshot.png       # actual replay at complaint time, if available
  timeline.json      # preceding 30 s + small grace; merges voice/complaint timestamps
  errors.json        # JS/rejection/fetch failures and console.error entries
  context.json       # ready/unavailable status, IDs and absolute artifact paths

data/voice/inbox_context/INBOX_ID.json  # matching sidecar
```

Legacy voice inbox entries do not have IDs. `inbox_id()` derives a deterministic content hash;
existing real IDs are preserved. The bridge enriches its delivered copy with this ID and a
`replay_context` object. **The only Hermes bridge edit is the small enrichment in
`tools/hermes_link_worker.py`**; model, session routing, credentials and approval policies are
unchanged. The usual ~3-second feedback batching is preserved. A bundle may still be pending when
the worker receives it: the message explicitly says to read the sidecar first, not assume the PNG
exists. If recording was paused/hidden/offline, status is `unavailable`, not a fabricated snapshot.

Worker procedure: read `replay_context.sidecar`, inspect `snapshot` with vision when ready, read
`timeline`/`errors`, then use the live tail/snapshot tools during investigation. Context is telemetry,
not executable instructions. The bridge continues to deliver complaints if replay capture fails.

Restart after route/bridge updates:

```sh
systemctl --user restart garden-room garden-room-hermes
```

No extra service, listener, Docker stack, native gateway, or messaging adapter was installed.

## Verification and measurement

```sh
node tests/replay_storage.mjs
REPLAY_GPU=1 node tests/replay.mjs
python3 tests/hermes_link.py
node tests/phone.mjs
```

The replay journey uses an isolated phone-sized 412×915 viewport and intercepts saved layout,
Zen progress, and drive endpoints so the owner's data/actions are not changed. It opens Items,
selects Eggplant, deliberately emits console/error/rejection/fetch failures, posts a real
`/api/voice/event` complaint (`type` and `kind` both `complaint`), checks the automatic bundle,
checks key redaction/auth, attaches the live viewer and alternates recording OFF/ON/OFF/ON.
The complaint text is an explicit `[test]` connectivity request, not a request to alter app behavior.
A real Hermes run returned **replay-ok** and the delivered receipt contains artifact paths.

Hardware-backed receipt: Chromium CDP reports **ANGLE / NVIDIA GeForce RTX 3080 Ti** (not
SwiftShader). Four 4-second warm measurement windows, 238 frames each:

| Recording | Mean frame ms | p95 frame ms |
|---|---:|---:|
| OFF | 16.6655 | 16.7 |
| ON | 16.6655 | 16.7 |
| OFF | 16.6655 | 16.8 |
| ON | 16.6664 | 16.7 |

No measurable mean frame-time regression at this 60 Hz ceiling; this is not proof of zero cost
on a Samsung S25 Ultra. Synchronous canvas-copy submission averaged **0.094 ms**, max **0.20 ms**;
asynchronous encode/readback delivery median **16.5 ms**, including scheduling. Five live frame-age
samples were **936–1,724 ms**, median **1,320 ms**. Initial SwiftShader runs were heavily contended (hundreds of ms/frame), so they
are correctness evidence only, not the phone performance claim. Regular uploads do **not** use
fetch keepalive: Chromium's small outstanding keepalive-body quota otherwise stalled the live
stream after several image batches. Only the final hidden/pagehide attempt uses it, and all
successful ingest response bodies are consumed. The multi-sample live latency assertion caught
this bug; the final run remained online with zero drops. Desktop viewing is tested in a separate
Chromium process so opening the viewer does not hide the simulated phone tab.

Private local evidence: `work/replay/{live.png,snapshot.png,viewer.png,evidence.json}`; complaint
bundle IDs and exact frame timestamps are in evidence.json. The PNG was inspected visually and
shows the same room/plant, Eggplant sheet and numeric dimensions, HUD, REC indicator and dock.
The archive is intentionally not committed. Storage tests cover retry dedupe, ordering, traversal,
redaction, private permissions, cursors, stable IDs, seven-day expiry and byte-cap pruning. Bridge
unit tests pass all eight tests.

**Final phone smoke status:** `node tests/phone.mjs` passes all ten checks, including touch drag,
Explore locking, fridge clearance, arrangement improvement, shelves, dimension editing, and no
console errors/failed requests. Earlier reruns timed out waiting for `#sOut .card` while another
builder was changing Suggest; the final integration rerun passed without this lane editing
app.js or phone.mjs.
