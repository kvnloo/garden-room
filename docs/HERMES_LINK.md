# Hermes link: live owner feedback

## Running system

- App: `garden-room.service`, loopback `127.0.0.1:8790`, existing Tailscale HTTPS access.
- Agent host: `garden-room-hermes-gateway.service`, loopback **127.0.0.1:8643**.
  Despite the historical unit name, this runs **only Hermes's native APIServerAdapter**;
  it does not run the full gateway dispatcher.
- Delivery: `garden-room-hermes.service`, no listening port. A single-instance lock tails
  the voice inbox and owns one turn at a time.
- Profile/home: `clean`, `$HERMES_HOME` (also the target of
  `$HERMES_HOME`). Agent cwd: this repository.
- Persistent session: **garden_room_live**, title **garden_room live**.
- Model/provider: **claude-opus-5-5 / anthropic**; explicit on each run. No substituted provider.
- API tools: terminal, file, web, vision, browser, delegation, skills, code_execution,
  todo, session_search (and the profile's normal allowed MCP tools). Browser/web availability
  still depends on the existing provider configuration.

Both new units are enabled and symlinked from `~/.config/systemd/user/` to `deploy/`.
The API key is generated once in `data/voice/.hermes-api-key`, mode 0600. It is never returned
by the app or printed. This is a separate key from `data/.token`, which authenticates the app.
Do not expose 8643 through Tailscale or a public listener: it is a full host-tool API.
The public phone uses the existing authenticated app routes, not the native Hermes API key.

### Why an API-only host, not `hermes chat -c` or a stock gateway?

Research used the official [documentation index](https://hermes-agent.nousresearch.com/docs/llms.txt)
and the **installed** `gateway/platforms/api_server*.py`, `gateway/run.py`, CLI help and toolset
configuration. The installed version is 0.21.5. It provides:

1. `POST /api/sessions`: create the named persistent session, with explicit model/provider lock.
2. `POST /v1/runs`: submit a turn immediately, returning a run ID (no blocking CLI invocation).
3. `GET /v1/runs/{id}`: poll durable completion, failure, approval and interruption status.
4. `Idempotency-Key`: retry a lost acceptance without starting the same turn twice.
5. `X-Hermes-Session-Key: garden_room live`: stable memory scope. The explicit `session_id`
   selects the transcript; the bridge follows compression continuations.

A stock named-profile gateway initially refused to start without its documented temporary
`gateway.standalone: true` compatibility setting. After enabling that, it **still started
cron for all nine host profiles and a shared kanban dispatcher**, despite multiplexing being
off. It was stopped promptly; the log showed one unrelated overdue job,
`homebase-local-twin-autoresearch`, admitted during that brief trial. No other profile files
were manually edited, and no attempt was made to restore another profile's scheduler state.
This side effect is why the deployed host does not call `start_gateway()` or construct
`GatewayRunner`. `gateway.standalone` was removed again.

The deployed launcher uses Hermes's own interpreter and native API adapter unchanged. This
retains real AIAgent/tool execution, SessionDB history, model selection and durable runs,
without initializing messaging adapters, host-wide cron, kanban dispatch, process recovery or
startup session-resume watchers. Logs explicitly state `adapters=[api_server]`,
`Telegram/Discord NOT started; cron/kanban NOT started`. No fake model server is used.

The clean profile was configured through `hermes config set` with:

```text
platforms.telegram.enabled = false
platforms.discord.enabled = false
gateway.multiplex_profiles = false
gateway.auto_multiplex_migration = false
gateway.scale_to_zero.idle_timeout_minutes = 0
platform_toolsets.api_server = [terminal, file, web, vision, browser, delegation,
                              skills, code_execution, todo, session_search]
```

These settings do not alter the owner's running CLI transcript. They also provide defense in
depth against stealing the shared Telegram token if someone later starts a full clean gateway.
The API host never instantiates those adapters in the first place.

## Voice data contract

All files are local/private and gitignored under `data/voice/`. Missing JSONL files are created
empty, and missing `rules.json` is created as `{}` (valid empty JSON, not an empty byte stream).
Existing files/rules are never overwritten by initialization.

| File | Owner / purpose |
|---|---|
| `inbox.jsonl` | Voice module appends `{ts,kind,text,context}`; kind complaint/request/bug/praise. App send endpoint appends the same shape plus a UUID. |
| `events.jsonl` | Voice module appends all actions, failures, confidence, corrections and activity. |
| `drive.jsonl` | Agent appends phone actions `{id,action,params,say}`. **IDs are increasing integers**, greater than all existing drive IDs, because the phone polls numerically. |
| `rules.json` | Agent edits phrase aliases/vocabulary; current voice contract is `{aliases: {"heard phrase": "action_id"}, vocabulary: [...]}`. Inspect the module before changing it. |
| `delivered.jsonl` | Bridge appends submitted/completed/failed/cancelled/interrupted/invalid-input receipts with batch/run/session IDs. Completion receipts include the actual assistant output. |
| `main_digest.md` | Compact recent deliveries + real assistant replies for the owner's main conversation. Refreshed within about 5 seconds. |
| `hermes_link_state.json` | Atomic bridge cursor, pending payload, seed state, recent receipts, active-use accumulator and heartbeat. Do not hand-edit while the service runs. |

Complaints/requests/bugs reach the worker after a **3-second fixed batching window**, plus
subsecond polling/admission time. A new batch waits behind an already-running turn, rather than
creating concurrent writers or interrupting a code edit. The queue is persistent on disk.

Every 900 seconds of **active use** (activity within the previous 60 seconds; idle periods pause
the clock), a digest goes to the same worker when its immediate feedback queue is empty. It
contains total event counts by kind, recent actions, and retained failures/low-confidence events
and corrections. Samples are bounded (60 recent + 60 salient, each capped) so telemetry cannot
grow the prompt without limit. No digest is sent for a completely idle app. Activity timing is
approximate, including a 60-second inactivity grace period.

The worker is seeded once with README.md, work/builders/BRIEF.md, actual recent git history,
and the owner's goals: phone 3D planner, latency-first voice, gamified zen garden, plant history
and timelapse, AR ruler. It is told to investigate/fix feedback immediately, preserve concurrent
builders' work, test with `node tests/phone.mjs`, commit only its own files with the owner's git
identity, fix aliases, and issue only supported phone actions. It must not claim action success
until the phone reports it. `[test]` messages request an isolated connectivity reply with no tools.

## App endpoints

All use existing `X-Garden-Key` auth (or the server's existing `?k=` support); no new public auth
scheme. Prefer headers so credentials do not enter URLs/logs.

- `GET /api/hermes_link/status`: current/root session ID, model/provider, worker heartbeat/PID,
  last receipt, queued inbox count, pending run, phase and error. `queue_depth` excludes a batch
  already accepted by Hermes; `pending`/`run_id` expose that in-flight work separately.
- `GET /api/hermes_link/replies?after=N`: only assistant replies, oldest-first, from the clean
  `state.db` opened with SQLite `mode=ro`. `N` is a message ID, not an array offset. Response has
  `session_id`, `messages` (also aliased as `replies`), `next_after`, `has_more`. Up to 100 per
  page; poll again with `next_after`. Includes earlier compression ancestors but not subagents.
- `POST /api/hermes_link/send` with `{"text":"..."}`: HTTP 202 with queued item ID. It appends
  to the inbox; **202 means durably queued, not fixed**. Text must be nonempty and <=16000 chars.

The existing legacy `/api/chat` tmux portal is **not** this bridge. The phone's voice module must
use inbox/these endpoints; do not call `bin/portal` while the main CLI is open.

Example without printing an app key:

```sh
python3 -c 'import json,urllib.request; from pathlib import Path
key=Path("data/.token").read_text().strip()
r=urllib.request.Request("http://127.0.0.1:8790/api/hermes_link/status",headers={"X-Garden-Key":key})
print(json.dumps(json.load(urllib.request.urlopen(r)),indent=2))'
```

## Main conversation: keep it in the loop without a second writer

The owner's main clean session is **20261018_121653_552390**. At installation it was running as
classic in-process CLI **pid 205293**, on Tern `/dev/pts/0`. This work did not resume it, type into
it, kill it, or write to its rows in state.db. Merely creating a gateway does not transfer an
in-process CLI's ownership. Never run `bin/portal` or a second `hermes --resume` against it.

**Now / on the next resume:** give the main agent this instruction:

> Read `$GARDEN_ROOT/data/voice/main_digest.md`
> and `docs/HERMES_LINK.md`. Reconcile the live worker's changes with git status/log;
> coordinate through `/api/hermes_link/send`. Do not duplicate its work.

The digest is a file handoff, **not an automatic injection into the live CLI**. It records only
what was delivered and what the worker actually said, not assumed success. For full details,
read delivered.jsonl and the assistant replies endpoint. The main agent can read the digest
at any time, even while it stays open. Its parent task receives the verification summary too.

### Later: move the same main chat to a programmatic runtime (NOT performed)

1. The owner must exit the current CLI normally. Verify pid 205293 is gone **and no replacement
   CLI has resumed that session** (check Tern/process list and Hermes session lease). Do not
   kill it to force a migration. Find the current compression continuation of the main session
   from read-only session metadata; use that tip ID, not a guessed replacement.
2. Do not copy/edit/merge state.db rows. The native API can resume an existing transcript using
   `session_id` directly. Keep the same clean home and project cwd. The current API-only host
   is suitable; it does not require restarting a gateway or taking a bot token.
3. After verifying there is **no current writer**, submit one API turn selecting that exact ID:
   `POST http://127.0.0.1:8643/v1/runs`, Bearer key loaded locally from `.hermes-api-key`, body
   `{"session_id":"<main-live-tip>","provider":"anthropic","model":"claude-opus-5-5",
   "input":"Read data/voice/main_digest.md and continue this conversation from the phone."}`.
   Read its run status and the same transcript's replies before treating ownership as moved.
   This reuses the main chat history, rather than creating another named worker session.
4. To make the phone's **main-chat panel** use it, replace that panel's legacy `/api/chat`
   tmux transport with a separate authenticated proxy selecting the adopted main tip. For
   sends, use `/v1/runs`; for reads, use the read-only DB/history for that main lineage. Follow
   compression continuations and serialize all submissions exactly as this worker does.
   Leave `/api/hermes_link/*` and the voice worker pointed at `garden_room_live` unless the
   owner explicitly wants to combine the two roles. This final phone-panel wiring is future
   work, not claimed to be installed by this bridge.
5. Use a gateway/API-connected client to view that chat after migration. Do not reopen a
   classic in-process CLI resume while the API owns an active turn. A true full host gateway
   can later replace this API-only host after its cross-profile cron/kanban behavior is audited;
   first stop the API host to release port 8643 and maintain the explicit Telegram/Discord
   disables. Do not run both native hosts on the same API port.

## Operations / recovery

```sh
systemctl --user status garden-room-hermes-gateway garden-room-hermes
journalctl --user -u garden-room-hermes-gateway -u garden-room-hermes -n 60 --no-pager
systemctl --user restart garden-room-hermes    # does not create a fresh agent session/seed
python3 tests/hermes_link.py
node tests/phone.mjs
```

To install after checkout, symlink the two `deploy/` units into `~/.config/systemd/user/`,
run `systemctl --user daemon-reload`, then `enable --now` both units. Apply the clean settings
above first using `HERMES_HOME=$HERMES_HOME hermes config set ...`.
The checked-in launchers assume this host's installed Hermes source path and launcher;
`GARDEN_HERMES_SOURCE` can point the API host at a moved source install.

Cursor state is fsynced/atomically replaced. Only complete newline-terminated inbox records
are consumed. Rotation/inode changes and truncation reset the cursor to the new file. Malformed
records remain in the source file and get an invalid-input receipt rather than poisoning the
whole queue. Preserve the original inbox and receipt/state files when diagnosing failures.

Intent/payload/idempotency key are saved **before** the HTTP submission. Accepted runs advance
the inbox cursor, and their pending run ID survives bridge restarts. Failed/interrupted runs
are recorded and **not automatically re-executed**, since tools may already have changed state.
An operator can inspect the reply and enqueue an explicit retry. Native idempotency retention
is 24h; do not blindly replay a pending submission that sat disconnected beyond that window.

Approval safeguards remain enabled. `waiting_for_approval` appears in status; inspect the native
run's approval card and respond deliberately via its `/v1/runs/{id}/approval` endpoint. No automatic
approval or permission-bypass mode is installed. Seed failure pauses unseeded work for operator
review; stop the delivery service before repairing its pending state, then restart.

## Real deployment verification

- One-time setup actually ran terminal `pwd` and `git status --short` in this repo and replied
  ready without editing concurrent builders' files.
- Inbox item `f697922d07a24be8ba2126767740ed58` contained exactly
  `[test] reply with the word pong and do nothing else`.
- Submitted batch `daf09120d29b42eea7801615386dca3e`, native run
  `run_b0f20438f5de4e5e8dc6fface7cde472`, completed with **pong**.
- `GET /api/hermes_link/replies?after=156741` read back assistant message **156846**, text
  **pong**, from clean state.db. The connectivity turn made no tool calls.
- `node tests/phone.mjs` passed every check (including no console errors/failed requests).
- Exact deployment PIDs and additional route/restart test results are recorded in the final
  delivery report; runtime PIDs naturally change after restarts.
