# Voice control

The single gold mic starts **Talk by default** and stops voice; Voice is also discoverable in the Live hub. There is no mode choice to discover. A successful connection greets the owner out loud. Microphone permission and audio playback priming start synchronously from the tap, before token minting or SDP. The badge/panel show connecting, listening, speaking or an error/recovery reason. If Chrome blocks remote audio, the same orb becomes **Resume voice audio** and the panel offers Resume audio. Long-press/right-click opens the panel. Normal backgrounding stops voice; mounting into the AR overlay keeps the connection alive across immersive visibility transitions. Pagehide always stops it.

- **Automatic backup (Commands):** if permission acquisition, token minting, SDP, data-channel connection, or the live connection fails, release WebRTC tracks and use Chrome SpeechRecognition → Jev → validated app action + on-device speechSynthesis confirmation. Conversational `abstain` utterances now call Cerebras directly from the phone for a short spoken reply. If Cerebras also fails, a local spoken explanation replaces silence. A denied microphone or unavailable Speech API cannot transcribe: show the reason and speak a recovery explanation. Chrome may use Google’s speech service; offline/on-device transcription availability is browser-dependent.
- **Talk:** microphone → OpenAI WebRTC (`/v1/realtime/calls`, GA). An ephemeral client secret is minted from the host's ChatGPT OAuth login; the OAuth token never leaves the server. Browser recognition is attempted for fast actions. On microphone contention/unavailability, Realtime completed user transcripts feed the same Jev path. Assistant audio is echo-suppressed and browser recognition pauses during playback.
- Jev never writes code or parameters. A lexical shortlist includes named/selected items plus global actions; Jev chooses one ID, with a **0.65** minimum confidence. `abstain` means conversation (Realtime answers in Talk; Cerebras + speechSynthesis answers in backup); `reobserve` makes no change and requests clarification out loud in backup. Jev's API permits at most **255** criteria; the full room capability table may be larger, but the submitted shortlist stays bounded.
- Parameterized commands use Cerebras `gpt-oss-120b` **directly from the phone**, including real CORS, not another server hop. The authenticated, no-store `/api/voice/config` exposes only the Cerebras key. It stays in memory, never localStorage. Sizes require units and are converted deterministically to metres; locations must fit inside the room. Locked objects cannot move/rotate until unlocked.
- Say **undo** or use the panel button to restore the previous voice state (items, room, fridge, light overlay, mode, view, selection; up to 20 snapshots). Manual edits are not separately recorded by voice undo.

## Hermes file contract

All files are under `data/voice/`, not `public/`. Do not commit them.

`events.jsonl`: server timestamp `ts`, `type`, transcript `text`, optional `source`, `action` (chosen action ID), `confidence`, `params`, `success`, `error`, and `context {mode, view, selected, last_actions}`. Completed GPT transcripts are logged, and user transcription deltas may also be logged. Corrections/undo utterances are marked `correction`. Recording delivery is queued/retried through a bounded 200-event `gr_voice_outbox` in localStorage, retried on reload/online; acknowledged records are removed and the panel exposes a pending count. Provider keys are never persisted. If browser storage is disabled/full, the queue remains in memory; a very long outage can overflow the bounded buffer.

`inbox.jsonl`: `{ts,kind,text,context}`. Explicit `tell_hermes` feedback (complaint/request/bug/praise), plus recognizable complaint/bug/feature-request utterances, is appended here. Delivery into the owner's live Hermes agent is owned by the separate portal worker. Every final transcript is classified independently of GPT tool use using a binary Jev feedback question (splitting bug versus complaint previously lost ambiguous reports at the confidence threshold). Obvious “broken”, “why is/does…” and “it should…” utterances also enter the inbox from the event route even if Jev is offline. Inbox writes atomically deduplicate the same utterance ID or normalized text for 120 seconds, persisted across retries/restarts; GPT tell_hermes carries the last transcript ID. Different wording with no shared utterance ID is not semantic deduplication. Final Realtime transcripts are checked even if SpeechRecognition already claimed the action.

`rules.json` (hot-reloaded while voice is on, about every 10 seconds):

```json
{"aliases":{"open the icebox":"fridge_open"},"vocabulary":["eggplant","pot diameter"]}
```

Aliases are normalized **exact phrase matches**, not executable regexes. They must refer to an action currently allowed by the room capability table. A matched alias overrides action selection with confidence 1, but every final transcript still goes to Jev for independent complaint classification. Vocabulary goes to Jev and to experimental SpeechRecognition phrase hints when supported. Empty `{}` uses defaults. No write endpoint is exposed; Hermes edits the file directly.

`drive.jsonl` producer appends newline-terminated records:

```json
{"id":1,"action":"set_size:p02","params":{"potD":0.4572},"say":"Eggplant pot set to eighteen inches"}
{"id":2,"action":"fridge_open","params":{},"say":"Fridge open"}
```

`id` is an integer, monotonically increasing. Parameters are already validated application units (metres); `rotate:ID` uses `{turns:1}` for a clockwise quarter turn. `GET /api/voice/drive?after=N` returns `{actions,after}` sorted/deduplicated by ID, at most 50 per batch. The phone polls every 2 seconds **only while voice is on**. Each browser persists its consumed cursor in `gr_voice_drive`. Failed validated actions are logged and consumed rather than blindly retried. This is a single-owner/browser queue, not an exactly-once multi-device job service.

## Server runtime

`routes/voice.py` is stdlib-only. The host resolves keys lazily from runtime environment/simple `.env` assignments, then Bitwarden Secrets Manager (`JEV_API_KEY`, `CEREBRAS_API_KEY`). BWS credentials are loaded from the existing secrets-profile profile without printing or executing its shell contents; values are cached for five minutes. OpenAI uses `~/.codex/auth.json` (`tokens.access_token` + JWT account claim); `GARDEN_CODEX_AUTH` can override the auth-file path. Refresh the host Codex login if OAuth expires.

Every route inherits garden-room authentication and additionally restricts peers to loopback or Tailscale IP ranges. Config/secrets return `Cache-Control: no-store`. Upstream error bodies are not reflected. No CORS is enabled on these server routes. Keep `tailscale serve` tailnet-only; do not expose this key-bearing app publicly or share its authenticated link with untrusted users.

## Verification

```sh
python tests/voice_api.py
node tests/voice.mjs
node tests/voice_fallback.mjs
node tests/voice_webrtc.mjs https://<your-tailnet-host>:8790
node tests/phone.mjs
```

`voice.mjs` runs unit tests and real Jev + direct-browser Cerebras commands with isolated room/Zen/history/drive fixtures. `voice_webrtc.mjs` uses a temporary **silent synthetic microphone**, verifies a real GA SDP exchange and live data channel, injects a synthetic transcription event into the actual handler, and exercises real GPT tools. No host microphone is recorded. Test room writes and feedback are intercepted; storage tests use a scratch directory. Screenshots live in `work/shots/voice-*.png`. Physical Samsung microphone arbitration, audio route/volume, recognition accuracy, WebRTC behavior across tailnet/mobile handovers, and speech timing still require phone testing.

## GR additions

`GR.voice`: `start()`, `stop()`, `say(text)`, `mountInto(element|null)`, `getState()`, `open()`, `setMode('commands'|'talk')`, `inject(text)` (same live decision path used for tests), `execute(action,params)` (validated closed-table drive path), `buildActionTable()`, read-only `on`, `mode`, `recent`. No other GR methods are monkeypatched. History and AR integrate with their namespace if present, or their existing item-action/panel UI at call time.

### AR/scan contract

Call `GR.voice.mountInto(overlayHost)` before entering immersive AR, and `mountInto(null)` when closing the AR surface. This **moves** the existing orb, state badge, caption and remote audio element; it does not create another mic or stop/recreate tracks/peer. The host must be inside the WebXR `dom-overlay` root. Overlay voice/captions use viewport positioning, above the bottom tool form rather than obscuring its fields; hosts can override `--voice-overlay-top` / `--voice-overlay-caption-top`. Do not stop voice from AR teardown. `say(text)` supplies local spoken feedback with input echo suppression. Current `ar.js` mounts in `#ar-voice` and restores the HUD on close.

`get_app_state` includes AR and live-scan state via `getState()`, `state`, or `status()` at call time. The GPT `ar_action` tool resolves exposed methods at call time: start_scan/stop_scan → GR.scanLive.start/stop, measure → GR.ar.measure or setTool('measure'), place → GR.ar.place (if exposed), enter/exit → GR.ar.start/stop (or enter/exit). Unsupported operations return explicit errors; immersive entry can require a fresh physical tap. Starting AR without an active session is never reported as success.

### Root cause and qualification evidence

The owner’s captured log contained 62 SpeechRecognition utterances and 62 corresponding actions, with **no Realtime events**. “hey what's up can you hear me” selected Jev `abstain` at confidence 1. The old default was Commands; its abstain branch only changed the caption to “switch to Talk”, with no spoken response. Talk was hidden behind the separate mode choice. The old live transport could connect headlessly, but its audio element was created only after permission and token awaits, and old tests never checked remote-track playback. This does not establish that Android autoplay was the owner’s original fault; he never started Talk.

The live test now uses fake media + a silent WAV (never the host mic), strict `user-gesture-required` autoplay policy, and the actual HTTPS tailnet origin. It checks token mint HTTP 200, SDP HTTP 201, live incoming audio track, `paused === false`, `muted === false`, volume 1, and inbound audio RTP with nonzero energy. It runs actual GPT get_app_state, tell_hermes and ar_action(measure) turns, and verifies that overlay mount/unmount preserves the same connected peer/audio. Final input-transcription events are injected into the actual handler; this is not a real spoken-input transcription-accuracy test. `voice_fallback.mjs` replays the owner’s exact conversational utterance through real Jev + direct-browser Cerebras and asserts speechSynthesis.speak delivery (synthesis is recorded at the browser seam, not acoustically heard). Provider outage still delivers a local reply. Server storage/classifier/dedup tests use scratch data, never the owner inbox.

Still requires the Samsung: real microphone permission prompts, SpeechRecognition coexistence, speaker/Bluetooth route and audible volume, natural VAD/transcription, immersive AR lifecycle/audio focus and mobile network changes. Headless playback is not proof of physical speaker output.
