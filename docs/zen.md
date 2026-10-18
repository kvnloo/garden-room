# Zen garden layer

The module adds a care game without changing the planner's light model, score, saved layout or plant geometry. It uses the existing `GR` seam; `public/app.js` and `server.py` are not modified.

## Use

- **Zen** in the dock, or the leaf / level pill, opens daily rituals and the plant roster.
- Tap a floating thought in Explore to water, feed, trim, check, or reveal the relevant light / spacing controls. Edit-mode drag targets remain owned by the planner.
- The speaker in the pill or panel toggles low-volume synthesized sounds. No audio asset or third-party request is used. Audio begins only after a gesture.
- Care is a **virtual diary**, not moisture sensing. Check real soil before watering. First visits have no invented watering history. Approximate reminders range from two days for basil / banana / seedlings to fourteen for aloe; other families are in `zen-core.js`.

## Rules and persistence

Health = 55% planner light satisfaction + 25% hydration + 10% feeding + 10% recent check-in, with a 20-point crowding deduction from the planner's exact overlap warnings, clamped to 0–100. Water, feed and check timestamps affect the diary, not real light or overlap. Mood is happy, content, thirsty, sad, or sleepy during local 22:00–06:00. A crowded plant still needs moving after a trim.

Care has per-action cooldowns. Daily rituals capture the plants thirsty at the beginning of the local day, all-plants 100% light, and an actual changed position / rotation signature (not camera motion). Each ritual is claimable once per day. Arrangement rewards only cross new all-time five-point score tiers; restoring an old layout cannot farm coins. Milestones and visits produce achievements and a day streak. XP thresholds increase quadratically. Coins are earned but no shop or spending mechanic is included.

The authenticated `/api/zen/progress` GET/PUT route writes `data/zen/progress.json` atomically under a lock. It includes per-plant water / feed / trim / check timestamps, the last 128 care events, up to fourteen daily ritual records, XP, gold, streaks and achievements. PUT uses revision checks; conflicting tabs merge timestamps and completed rituals before retrying. Reward counters merge conservatively with maxima, not additive event accounting. This avoids duplicated rewards on retries but can undercount simultaneous rewards from two tabs. localStorage key: `gr_zen_v1`. Offline care remains local and retries on the browser's `online` event or a later action / visit. A successful save is read back before the UI says it was saved.

## Other modules

```js
GR.zen.health('p25');                 // 0..100; null for missing/non-plant IDs
GR.zen.mood('p25');                   // mood name; null if missing
GR.zen.care('p25', 'water');          // synchronous {ok, coins, xp, ...status}
GR.zen.care('p25', 'feed');           // water | feed | trim | check
GR.zen.status('p25');                 // includes need, waterDays and timestamps
await GR.zen.flush();                 // explicit persistence barrier
GR.zen.open();
```

`care` never throws for a missing plant, unknown action or cooldown. It returns `{ok:false, reason}`. Loading the module waits for its server read before exposing `GR.zen`, so voice should check that the module exists.

## Rendering and evidence

Faces, thought bubbles, gold, water droplets, sparkles, watering can and window motes share one canvas atlas and a fixed 320-instance billboard pool, costing one additional draw call. Holder sway / bounce preserves captured transforms and works with history's separate child growth wrapper. Grow-light materials preserve original emissive intensity rather than accumulating pulse values. Per-frame math reuses objects; inventory and health scans are throttled. Reduced motion disables moving effects by default.

Run from the repository:

```sh
systemctl --user restart garden-room
python tests/zen_route.py
node tests/zen.mjs
node tests/phone.mjs
```

The Zen test uses real NVIDIA Vulkan / ANGLE WebGL, isolates both room and care writes, exercises a real thought-bubble touch, cooldowns, local persistence, mute, offline recovery, conflict recovery, quest claims, and narrow layouts. `work/zen/` contains screenshots, results, GPU identity and a five-second moving-effects performance window with staggered real care actions. The disabled comparison retains mood billboards; it is not a whole-module removal baseline. This is a desktop GPU at a phone viewport, **not a physical-phone 60fps qualification**. The base scene is already over a thousand draw calls. See `performance.json` for measured costs rather than extrapolating desktop timings to a phone.

The phone smoke also isolates Zen persistence. Its drag fixture places a small pot in the visible middle of the room first: optimization can otherwise cluster every small pot along the window outside the portrait camera crop.

Not built: a coin shop, unlockable decorations, real soil / sensor integration, pests, plant growth as a gameplay reward, competitive leaderboards, weather-based watering, or offline additive multi-device reward accounting.
