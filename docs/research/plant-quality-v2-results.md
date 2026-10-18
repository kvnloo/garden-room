# Plant quality v2: measured outcome
Research and BRIEF_v2 were implemented, all12 families received a DeepSeek V4 Pro candidate and two critic systems. This batch did NOT solve plant quality globally: only aloe met strict promotion policy.
| Family | Baseline | Selected after | Selected | Judged candidates | Candidate scores / A/B |
|---|---:|---:|---|---:|---|
| curry_leaf | 4.8 | 4.8 | r0 | 1 | r1 4.2 parent |
| pepper | 4.0 | 4.0 | r0 | 1 | r1 4.0 candidate |
| eggplant | 4.5 | 4.5 | r0 | 1 | r1 3 parent |
| banana | 4.8 | 4.8 | r0 | 1 | r1 4.5 candidate |
| aloe | 1.5 | 5.5 | r2 | 2 | r1 4.5 candidate, r2 5.5 candidate |
| herb_bush | 3 | 3 | r0 | 2 | r1 4.0 candidate, r2 4 tie-or-conflict |
| flowering_basil | 4.2 | 4.2 | r0 | 1 | r1 3.0 parent |
| raised_planter | 4.3 | 4.3 | r0 | 1 | r1 3 parent |
| seedling | 3.5 | 3.5 | r0 | 1 | r1 3.5 candidate |
| broadleaf_shrub | 3 | 3 | r0 | 1 | r1 3 candidate |
| tomato | 4.0 | 4.0 | r0 | 1 | r1 3 parent |
| plectranthus | 3.0 | 3.0 | r0 | 2 | r1 2 parent, r2 3 parent |

## Evidence
- Machine-readable aggregation: `work/models/v2-summary.json`; per-family `v2/{CURRENT,rounds}.json`.
- Contact sheet: `work/models/v2-before-after-contact.jpg`; individual per-round compare.png and multiview.jpg, raw judge.json and ab/trial-*/verdict.json.
- All selected after scores are from their named saved files, not worker claims. Scores are fresh fixed-fixture baselines, not historical mixed-frame scores.
- Aloe previous: `work/models/aloe/approved_prev.js`; exact source replay matches all five judged PNGs; served source hash verified.
- Public approved flags intentionally unchanged: existing true entries retained; plectranthus p01 remains false because both attempts failed.

## Why the broad rewrite mostly failed
- Choosing MIT EZ-Tree solved a code-reuse/licence/connectivity concern, not botanical appearance. Default terminal site distribution under-filled crowns, while wrong leaf frames made coupons read edge-on or as folded spears.
- The coordinator made a wrong tomato observation (fruit absent) despite visible green fruits in the native crop. The bad instruction is preserved; the original parent with fruits remains.
- Code models cannot independently approve leaf coupons. V2 needs coordinator-approved native leaf/attachment coupons before full-family bulk dispatch, not a checklist paragraph saying “test a coupon”.
- Root height and juvenile topology must be measured before visual spend. Some candidates report “height supported” while overshooting juvenile height by multiples. Technical evidence overrides visual preference.

## Stop state and alternate mechanisms
- Plectranthus and herb retain the same visible blockers after two completed focused candidates; stop that mechanism, do not spend a third near-variant.
- Direction A: build and vision-approve a single botanical leaf+petiole coupon and one short two-node shoot, then attach calibrated systems to preserved parent architecture. Low cost, addresses frame/outline errors directly.
- Direction B: infer a measured per-height crown occupancy/branch landmark map from native crops, fit a generator skeleton to it before adding leaves. Higher cost and occlusion uncertainty; requires explicit segmentation/exclusions.
- No claim of owner acceptance, complete timelapse biology, photorealism, full calibrated ranker benchmark or matched hidden viewpoints.

## Execution issues
- Parallel bws reads returned429; launcher now resolves secret environment once before fan-out, without exposing values.
- Some worker wrappers were terminated with SIGTERM and one judge wrapper with SIGKILL; cause was not established. Current memory check showed no pressure and earlyoom journal had no entries. Completed artifacts were audited, incomplete native sessions were not treated as success.
- Native stream-json truncates vision result payload strings to5000chars. Audit verifies actual vision tool paths, successful multimodal-load text, surviving PNG/JPEG dimensions, requested model, distinct sessions and saved verdicts; it does not claim complete transport-byte identity from truncated logs.
