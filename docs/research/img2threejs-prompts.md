# Exact recorded prompts and instructions
These are checked-in registry prompts/instructions, not a recovered private conversation. A commit saying “one prompt” without its text is not a recovered original prompt. Escapes in source are preserved.

## boxing-man
Source: `src/demos/registry.ts` (`prompt` field).
```text
Full body Boxing character with T pose
```

## electric-mouse-mascot
Source: `src/demos/registry.ts` (`prompt` field).
```text
Rebuild the stylized yellow electric-mouse mascot in the reference image as a code-only procedural Three.js character, then stage it celebrating 10,000 GitHub stars.\n\nSUBJECT. One rounded capsule that reads as body and head at once (Body_Head_Main), with a single soft belly crease rather than a waist seam. Two tall tapered ears with dark tips (Ear_L/Ear_R). Two round eyes with offset specular highlights (Eye_L/Eye_R, EyeHighlight_L/EyeHighlight_R), a small dark nose, and an open smiling mouth built as an outer lip, a dark inner cavity and a tongue (Mouth_Outer, Mouth_Inner, Tongue). Two red circular cheek patches (Cheek_L/Cheek_R) sitting flush on the body curvature, not floating above it. Short teardrop arms and feet (Arm_L/Arm_R, Foot_L/Foot_R). An angular lightning-bolt tail with brown flank accents at its base, hung off its own pivot so it can be animated independently (Tail_Pivot, Tail_Main, Tail_Accent, Tail_Accent_Flank_Upper/Lower).\n\nCELEBRATION STAGING. A speech bubble beside the head (SpeechBubble_Optional, SpeechBubble_Disc, SpeechBubble_Pointer) carrying a celebration star and a star-count label that rolls 9.80K → 9.86K → 9.91K → 9.95K → 9.98K → 9.99K → 9,999 → 10K and then holds on 10K (Star_10K_Label). On the hold, fire a lightning burst of bolts with an additive glow around the star (Star_Lightning_Burst) plus a lightning aura on the character (Celebration_Lightning_Aura), keeping the silhouette readable — the burst must not wash the mascot out.\n\nCONSTRAINTS. No imported meshes: every surface is generated in TypeScript. Every part is named and semantically addressable so the runtime can drive it. Materials are physical, lit by one bespoke look-dev rig (createElectricMouseMascotLookDevLights) rather than a generic studio rig. The belly crease and its contact shadow stay parametric — the values ship as DEFAULT_ELECTRIC_MOUSE_BELLY_TUNE and are editable live through the shared tune panel.
```

## girl-character
Source: `src/demos/registry.ts` (`prompt` field).
```text
Reconstruct the athletic dual-sword warrior as an independent code-only Three.js character, preserve the athletic silhouette, dual swords, layered outfit and expressive face, while exposing High/Medium/Low quality levels for a responsive interactive render.
```

## leesin
Source: `src/demos/registry.ts` (`prompt` field).
```text
Build the character in pure Three.js with no loader and no runtime fetch, using the reference only as a build-time measurement, and prove the result against its accessors.
```

## low-poly-humanoid
Source: `src/demos/registry.ts` (`prompt` field).
```text
Reconstruct the supplied low-poly male humanoid as an independent code-only Three.js character. Preserve the angular anatomy, orange shorts, dark swept hair, articulated hands and feet, continuous shoulder seams, and flexible animation-ready body rig without copying source topology.
```

## mars-cat
Source: `src/demos/registry.ts` (`prompt` field).
```text
Reconstruct every multipart GLB surface at its measured per-node cell size and bake declared material values into code. Use the source model only as a measurement instrument; do not ship its topology, textures, UV atlas or binary geometry.
```

## monster
Source: `src/demos/registry.ts` (`prompt` field).
```text
Gi\u00fap t\u00f4i t\u1ea1o 1 nh\u00e2n v\u1eadt high-poly c\u00f3 n\u1eafm \u0111\u1ea5m tay, nh\u00e2n v\u1eadt n\u00e0y l\u00e0 qu\u00e1i v\u1eadt c\u00f3 d\u00e1ng \u0111\u1ee9ng T pose, \u0111\u00e2y l\u00e0 qu\u00e1i v\u1eadt m\u1ea1nh m\u1ebd c\u00f3 c\u01a1 b\u1eafp, \u0111\u00e2y l\u00e0 qu\u00e1i v\u1eadt trong game, v\u00e0 n\u00f3 c\u00f3 xung quanh l\u00e0 c\u00e1c l\u1edbp v\u1ea9y v\u00e0 x\u01b0\u01a1ng, \u0111\u00f4i m\u1eaft \u0111\u00e1ng s\u1ee3 hung d\u1eef, c\u00f3 r\u0103ng nanh v\u00e0 \u0111\u00f4i c\u00e1nh, v\u00e0 kh\u1ed5ng l\u1ed3. background l\u00e0 transparent.
```

## monster-tree
Source: `src/demos/registry.ts` (`prompt` field).
```text
Rebuild every public animation for Groot: smooth articulated joints, expressive protective and playful actions, rooted botanical powers, golden spores and a forest of flying spirits. Bake native quaternion clips, measure their stops through AnimationMixer, and schedule pooled VFX.
```

## prs-ocean
Source: `src/demos/registry.ts` (`prompt` field).
```text
Preserve the measured Ocean guitar surface and source vertex appearance in a code-owned Three.js showcase, then add opt-in water flow and six addressable string details without shipping the source GLB or runtime texture maps.
```

## regret-warrior-reconstruction
Source: `src/demos/registry.ts` (`prompt` field).
```text
Reconstruct the supplied Regret Warrior GLB as a deterministic, animation-ready, code-only Three.js group while preserving every discovered source field and making no GLB/GLTF/BIN request.
```

## talon-doppler-ruby
Source: `src/demos/registry.ts` (`prompt` field).
```text
Rebuild the subject in this image as a procedural Three.js model. Hold proportions and silhouette to the reference; enumerate the identity-defining details first and drop any detail you cannot place on a real component instead of faking it. Derive the finish class and gradient stops from the reference pixels, not from memory, and flag any colour that will not survive tone-mapping. Expose pivots and sockets for whatever should move, plus a userData.tick for a looping idle animation.
```

## warrior
Source: `src/demos/registry.ts` (`prompt` field).
```text
Build a procedural Three.js mouse warrior from the supplied GLB measurement instrument, retarget every measured animation channel above the GLB export-noise floor into code, then retain the hand-driven wooden-staff attack and secondary motion.
```

# Relevant commit messages (exact bodies)
History was deepened with `git fetch --unshallow`. These are messages, not proof of original user prompts.
```text
c5c7c1474c917178b0e6060cace6798fd14f775a
Score the animation, and fix what scoring found

A reproducible harness drives the real showcase and reads eleven checks out of it: 9.98 three runs
running, from 7.32 at the start. It found three discontinuities no still frame shows — the ultimate
moving a hand 1.10 units in one frame when its pose dropped under a cross-fading clip, a lunge
snapping the figure home, and an incoming pose applied at full weight on frame one — all now handed
over across the clip's own fade window. Partial-weight aims work at all only because applyPose now
restores the value the clip left, the same PropertyMixer behaviour that made stretch compound.

Five rubric checks were measuring the wrong thing and are corrected in place; a sixth was missing
entirely, and it is the one that caught a pose scoring full marks in 3D while rendering as an
unreadable smear.

commit eec7a5d61dde979b7a869ddccc71ddf73fc86686
English skill names, a bullet-rain ultimate, and a vine that cracks the air

Seeds of Destiny is now 620 green bolts in three widening volleys, each staining the ground through
one shared instanced decal; Vine Lash arcs downrange and shatters the air where it lands; Nature's
Call holds both arms up with light winding around them instead of beating time with them; the
passive is undergrowth and nothing drawn; Fivefold Coppice takes Wildfire Sap's shape with a tighter
ring. The camera now leads the action — aimed squarely at him every attack ran off the right edge.

commit 3f2f973aec0e05cee9e703f2d8cf69a6eeff486f
Author the kit's animation instead of borrowing boxing clips

The four moves are now posed bone by bone through an aim solver over a trimmed standing_relax, so
the body does what the skill says: the arm winds back and throws, both arms are driven down and
forward on a rhythm, and the ultimate roots, grows and closes on its own chest. Beats are authored
in one place and swept back at 240 Hz to check the gesture matches them.

That sweep caught three teleports a still frame hides: aim directions lerped instead of slerped
(60.7 H/s spike through a forearm reversal), a payoff slam slower than its own jabs, and a stretch
that compounded to 106,195x because PropertyMixer skips writing a track whose value never changes.

commit 78afc2cefcd537c9bca64a1a0007fd7b884a3230
Name the character Y'bneth and give him his own measured kit

Passive plants real undergrowth and draws sap up out of it; Dây Leo asks whether that patch is
still standing before choosing its plain or empowered form; Thiên Nhiên Vẫy Gọi calls one log per
measured arrest, each further out; Hạt Giống Thần Mệnh grows the trunk, throws seeds on the three
hardest arrests and winds everything back to the centre. Phân Thân puts five real skinned copies on
stage, each with its own skeleton and its own measured beat, in the palette's one contrasting accent.

The stalls that made it feel broken were shader compiles, light-count recompiles and bone-texture
uploads landing on the beat, not the hitstop: all three are now warmed at load, hitstop has a
refractory gap and eases out, and the camera is aimed at the character instead of beside it.

commit 7ada8653ef4517d4aa87b98d17c4840dc70439fd
Schedule every impact off a measured event table, with hitstop and an impact vocabulary

A 240 Hz sweep through every clip finds arrests, plants and driven hits; skills schedule against
that table, which is what lets windups exist. Deep Root Surge moves to the real climax the sweep
found — both hands arresting at 1.800s, decel 366.5, the loudest stop in the library — behind a
measured flurry. Four impact kinds differ in motion before colour; a blow taken converges inward
with no hand flash. Hitstop holds the clip 35-95ms per hit. Trails, embers and breath calibrate
per clip against its own measured budget. Bursts are pooled, preallocated, invisible until fired.

commit efce3389c13891324de462be2be57b59f75b609b
feat(monster): add the Abyss Monster showcase with measured wind-rending VFX

Claw arcs, void rings and shear slivers fire on strike times swept off the embedded rig; 260 lagging aura wisps and shed ash haunt the body.

commit f14acded5628f7a0e35d1a580a299e1d8becb304
Merge pull request #25 from img2threejs/add-demo/talon

add demo talon - one prompt
commit 226114af5c9659dac93a9d697c112ffc42cb16e7
add demo talon - oneprompt

commit 08249d966087695a8bd8f1b74687d6271fb97440
add pistol glock 18 ghost protocol mw - 1 prompt

commit 3ca7b8717d2ec1217a53b9d33c84115ab9ec220c
feat(m9-doppler): pipeline build output — traced geo + projected Doppler textures (#10)

* Add m9-doppler showcase demo

CS2 M9 Bayonet reconstructed from a single broadside reference: traced
silhouette (sawteeth, thumb-hole, wedge-ground blade), single flat-bar
guard, knurled worn-gunmetal grip. Blade finish is an original procedural
gradient + domain-warped smoke generator inspired by the Doppler Phase 2
colourway -- not a copy of Valve's authored pattern (code-only, no
downloaded texture pack, per CONTRIBUTING.md).

* feat(m9-doppler): use pipeline build output (traced geo + projected Doppler textures)

Replace the fully-procedural M9 Doppler demo with the actual img2threejs pipeline
build (skill builds/m9-doppler): the traced geo.json silhouette and reference-crop
textures projected onto the blade/handle, rendered over the studio IBL.

- add public/m9-doppler/{blade-fill,handle-fill}.png (projected albedo crops)
- vendor the generated m9-bayonet.js verbatim (+ .d.ts); texture paths -> public/
- createM9DopplerModel.ts now wraps the build (loads geo, wires light rig + background)
- registry: exposure 1.42, own rig via installLights (no double-lighting), updated blurb

* style(m9-doppler): darken the demo's own stage background so the blade pops

Background is owned by the m9-doppler module (makeM9DopplerBackground, a near-black
radial set in build()), not by shared registry theming — scoped to this demo only.
```

# Prompt locations absent
No `docs/standard-prompts` or standalone prompt files were found in the current showcase tree. Registry fields supply the recoverable prompts. README and spec instructions are process constraints, not original user transcripts.

# Canonical standard prompt: README.md
Source: `$OSS_ROOT/img2threejs/docs/standard-prompts/README.md` ([upstream](https://github.com/img2threejs/img2threejs/blob/main/docs/standard-prompts/README.md)). Exact text follows:
# Standard prompts

Four prompts, one per job. Each is copy-paste, each completes in one pass, and each states its own
exit condition. Replace every `<PLACEHOLDER>` before pasting.

| Prompt | Use when | Route |
|---|---|---|
| [`build.md`](build.md) | a reference image, no mesh | reconstruct from primitives, gated |
| [`glb-force-measured.md`](glb-force-measured.md) | a GLB is available and every parameter it measures should be forced, not approximated | measure, force, prove with parity gates |
| [`polish.md`](polish.md) | a build that renders but does not match | bounded correction, one defect at a time |
| [`vfx.md`](vfx.md) | the rig and its clips play, only the effects are missing | measure the events off a real mixer, then schedule against them |

Rigging and animation on top of a GLB: [`../GLB_ANIMATED_CHARACTER_PROMPT.md`](../GLB_ANIMATED_CHARACTER_PROMPT.md).

## Why these were rewritten

The previous prompts blocked more than they built, for three reasons that were mechanical rather
than stylistic:

1. **They pointed at a file that does not exist.** `GLB_ANIMATED_CHARACTER_PROMPT.md` delegated the
   whole geometry route to `docs/GLB_CHARACTER_PROMPT.md`, which was never written. An agent
   reaching the largest step of the run found a dead reference. `build.md` is that missing file.

2. **They ran a gate before producing the gate's input.** `validate_sculpt_spec.py --strict-quality`
   fails with ~89 causes on a freshly scaffolded spec, because the scripts only scaffold —
   `preSpecAssessment.objectClass.primaryType` is literally `"unassessed"`, all eight complexity
   scores are `0`, and `detailInventory` is empty. Told to "run the gate and do not advance", an
   agent stops on its first command, every time. **Every prompt here now fills the scaffold before
   it validates**, and says exactly which fields.

3. **They treated every stop as equally serious.** A missing input and a failed measurement need
   different responses. Each prompt below separates *produce the input and continue* from
   *stop and ask*, and lists which is which.

## The rule the four share

> A gate is a question. Answer it with evidence, or say you could not — never by lowering the bar,
> and never by stopping before you have tried to produce the evidence it asked for.


# Canonical standard prompt: build.md
Source: `$OSS_ROOT/img2threejs/docs/standard-prompts/build.md` ([upstream](https://github.com/img2threejs/img2threejs/blob/main/docs/standard-prompts/build.md)). Exact text follows:
# Build — reference image to a gated procedural model

The reconstruction route. This is the file `GLB_ANIMATED_CHARACTER_PROMPT.md` delegates its
Stages 1–3 to.

**The one thing that makes this prompt not block:** the forge scripts *scaffold*, they do not
*assess*. A freshly generated spec carries `primaryType: "unassessed"`, eight complexity scores of
`0`, an empty `detailInventory` and `anatomy.applies` unset — so `--strict-quality` fails it with
around 89 causes. Those are not defects to report; they are **your fields to fill**. Fill them, then
validate.

Replace every `<PLACEHOLDER>`, paste as one prompt.

````text
Rebuild the subject in this reference as a procedural Three.js model, using img2threejs.

## Inputs
- Reference:      <ABSOLUTE_PATH_TO_IMAGE>
- Subject name:   <SubjectName>
- Demo id:        <subject-id>
- Profile:        <character | animated-character (requires plugin-character installed) | object>
- Real longest dimension: <e.g. 1.70 m>   # sanity-checks scale; never used to scale

## Step 0 — Can this subject be built at all?

Segment the figure from the background and report as numbers:
  · width/height at the hip band (48-54% of figure height), knee (68-74%), ankle (92-99%)
  · silhouette area / height²
  · whether the silhouette WIDENS below the hip, and by how much

The character template is 61 anatomy components and ZERO garments — clothing is not shipped in
v1.5. If a meaningful share of the silhouette is cloth standing away from the body (flared skirt,
hanging sleeve, cape, trailing panel), STOP HERE and tell me: what fraction, and what will be lost.
A body-shaped figure delivered under the subject's name is the failure this step exists to prevent.
For a subject like that the GLB route is the honest one — say so and stop.

## Step 1 — Intake

    python3 forge/state.py init --state .img2threejs/state.json \
      --reference <image> --profile <profile> --spec object-sculpt-spec.json
    python3 forge/stage1_intake/probe_image.py <image>
    python3 forge/stage1_intake/extract_landmarks.py <image> \
      --out anatomy.json --overlay overlay.png
    python3 forge/stage1_intake/build_detail_inventory.py <image> \
      --mode component-zones --out detail-inventory.json

Two things about the overlay, both measured, both worth knowing before you trust it:
  · it divides the IMAGE height, not the figure's bounding box, so every guide is offset by
    whatever margin sits above the head. Re-read the guides against the figure top.
  · `styleHeads` defaults to 6.0. Measure the head against the figure and set the real value;
    on a stylized 8-head figure the default puts the "nose base" guide on the eyes.

## Step 2 — Assess. This is YOUR work, not the script's.

Open the assessment and fill it from looking at the reference. Nothing downstream can succeed
until these hold real values:

    preSpecAssessment.objectClass.primaryType      not "unassessed"
    preSpecAssessment.objectClass.primaryDomain    object | character | hybrid
    objectClass.formLanguage / structureKind / motionPotential / materialFamilies   non-empty
    complexity.scores       all eight, from what you see, not defaults
    complexity.estimatedCounts                     real counts
    detailInventory                                >= targetMinDetails entries
    anatomy.applies = true, with styleHeads, proportions, pose, faceLandmarks

Enumerate the identity-defining details first — bevels and rounding, panel seams, fasteners,
engraved or painted linework, gloss vs matte zones, wear. Drop any detail you cannot place on a
real component rather than faking it.

## Step 3 — Spec, then gate

    python3 forge/stage2_spec/new_sculpt_spec.py "<SubjectName>" --image <image> \
      --assessment assessment.json --out object-sculpt-spec.json
    python3 forge/stage2_spec/validate_sculpt_spec.py object-sculpt-spec.json --strict-quality

Expect failures on the first run. Read each cause and answer it — a missing
`colorMaterialRecipe` means derive that component's colour from the reference pixels, not that the
gate is wrong. Iterate until it exits 0.

Only then:

    python3 forge/stage3_build/generate_threejs_factory.py object-sculpt-spec.json \
      --out src/create<SubjectName>Model.ts

The generator repeats the gate and is fail-closed: on failure it exits 2 with
`{"status":"BLOCKED", ...}` and writes NO file. If you see that, the spec is not ready — go back to
Step 2. Never pass `--allow-nonstrict`.

## Step 4 — Render and review, one pass at a time

Render, package one reference-vs-render sheet, and judge it. Do not advance a pass until its
review passes. Record per-region confidence for anything the single view cannot show.

## When to stop, and when not to

STOP and ask me:
  · Step 0 says the subject is mostly cloth
  · a gate fails for a reason you cannot resolve from the reference
  · `next.py` exits 3 / `status=stopped`

DO NOT stop for:
  · a scaffolded field being empty — fill it, that is the job
  · strict-quality failing on the first run — read the causes and answer them
  · a detail you cannot place — drop it, note it, continue

## Report

Components · strict-quality exit and cause count · passes cleared · details inventoried vs target ·
per-region confidence · and one line naming what still does not match. Never say "done" when it is
"improved".
````


# Canonical standard prompt: glb-force-measured.md
Source: `$OSS_ROOT/img2threejs/docs/standard-prompts/glb-force-measured.md` ([upstream](https://github.com/img2threejs/img2threejs/blob/main/docs/standard-prompts/glb-force-measured.md)). Exact text follows:
# Force-measured — lock the build to what the GLB actually measures

For a build that has a GLB alongside the reference. The GLB is a **measurement instrument**: the
pipeline reads its parameters, encodes the measured surface, and emits TypeScript that carries those
numbers. No `.glb` and no `.bin` ships or is fetched at runtime, and no texture image is copied —
this pipeline emits code, and that contract does not bend because a mesh happens to be available.

Same rule as [`build.md`](build.md) and the GLB prompts on `main`. What this one adds is a single
word: **force**.

## What "force" means, and what "1:1" refers to

Without it, a build measures the GLB and then *approximates* — a diameter becomes "about right", a
roughness becomes a plausible guess, a proportion drifts toward the template. Every one of those is
a value the GLB already answered exactly.

> **1:1 refers to the measured PARAMETERS, not to the file.** Every parameter the GLB genuinely
> carries is forced to its measured value instead of an inferred one, and each comes with the check
> that proves it landed in the emitted code.

Forced to measured:

| | |
|---|---|
| dimensions and proportions | overall size, per-band widths, centroids, part bounds |
| appearance scalars | base colour, roughness, metalness, emissive, alpha mode |
| structure | part count and hierarchy, socket and pivot positions |
| rig, when present | skeleton, skin joint order, inverse binds, joint weights |
| motion, when present | clip names, durations, keyframes |

## What the GLB cannot hand over — say this before the review, not after

None of these is a defect and none is negotiable:

- **Texture images and normal maps are deliberately not copied.** The code-only contract is the
  point of this project, not an obstacle to it. Appearance is carried as per-vertex colour sampled
  from the base-colour map at each vertex UV, so detail finer than the vertex spacing is not carried.
  Where a map drove metalness or roughness, the emitted value is a measured median, and that is
  recorded as a median rather than presented as an authored constant.
- **Nothing finer than the node's own cell size survives**, because nothing finer was measured.
- **Rigging and animation are usually absent.** `skinCount: 0` and `animationCount: 0` are the
  common case; then there is nothing to force and Stage R authoring applies instead.
- Quantisation, stated once so nobody rediscovers it at review: positions are 16-bit over the
  model's own bounding box (~0.03 mm on a 2 m figure, finer than the source triangles), normals are
  16-bit octahedral (~1°, and authored hard edges survive because normals are carried rather than
  recomputed), indices are lossless, and keyframes stay float32 — a quantised quaternion drifts
  visibly over a looping clip.

## Why the usual quality gate is the wrong instrument here

`--strict-quality` exists to stop a **shallow spec** reaching codegen: an unassessed `objectClass`,
an empty `detailInventory`, a `colorMaterialRecipe` nobody derived. Every one of those asks *"did
you infer this responsibly?"*

On a forced build the answer is that the value was not inferred at all — it was measured. So the
gate is **replaced, not lowered**: parity gates compare the emitted code against the measurement,
which is a stricter question than whether a judgement was defensible.

## The prompt

````text
Build this subject with every parameter the GLB measures FORCED to its measured value.

## Inputs
- GLB (measurement instrument): <ABSOLUTE_PATH_TO_GLB>
- Reference image (optional):   <PATH_OR_NONE>
- Subject name:  <SubjectName>
- Demo id:       <subject-id>
- Overwrite:     <yes | no>     # yes = replace an existing demo of this id in place

## Contract

The GLB is measured, never shipped. Symlink it somewhere gitignored; the running demo must fetch no
`.glb` and no `.bin`. Texture images are not copied — appearance is carried as per-vertex colour.
The deliverable is TypeScript.

Part names are HYPOTHESES from measured bounds and must say so. On a rigged mesh the BONE names are
the rig's own and must NOT carry that caveat.

## Step 1 — Ask the bytes what the file is, before decoding it

    python3 forge/stage1_intake/probe_glb.py <glb> --out glb-probe.json

`skinCount` and `animationCount` decide the route:
  · skinCount == 0        static: parts stay separate, an LOD ladder is allowed
  · skinCount >= 1        rigged: read the skin, never author one beside it. See Step 3.
  · skinCount > 1         choose one explicitly and say why
  · animationCount > 0    clips are measured too, keyed to BONE INDEX, never to bone name

## Step 2 — Measure, then force

Take every parameter in the table above from the GLB and write the measured value into the spec.
Where the pipeline would normally infer, it must not: name each forced field and the number it took.

Keep vertices in the space the file put them in. For a rigged mesh that is BIND space — the space
the inverse bind matrices are expressed in. Normalisation is a TRANSFORM, never an edit to the
buffer: scale on the mesh so bones parented to it scale with the skin, offset on the group. Editing
vertices to normalise moves the mesh out from under its own skeleton.

Per-vertex colour is sampled from the base-colour TEXTURE at each vertex UV, not from a `color`
attribute. A rigged GLB typically ships UVs and a texture and no vertex colours at all; reading only
the attribute makes every vertex fall back to the flat base colour and the figure comes out white.
The texture is sRGB bytes and the material factor is linear: apply the factor in linear space, then
convert back.

## Step 3 — If it is rigged, four rules, none negotiable

1. ONE detail level. Do not decimate. Decimation rewrites the vertex list while `skinIndex` /
   `skinWeight` are per-vertex — every weight would address a vertex that no longer exists and the
   figure tears apart the moment a clip plays. It looks perfect until then.
2. ONE skinned shell, not named parts. Rigging merges the mesh; advertising per-part pivots would be
   a contract the geometry cannot honour. Expose the skeleton instead.
3. Bones parents-first, `parent` as an INDEX with `-1` for a root, clip tracks keyed to bone index.
   A clip naming a bone the skeleton does not have is DROPPED and named in the report — never bound
   to whatever happens to sit at that index.
4. `updateMatrixWorld(true)` BEFORE constructing the Skeleton. `calculateInverses()` reads each
   bone's current world matrix; built in the wrong order it captures identity, the rest pose never
   cancels, and the model renders a corpse while reporting `bound: true`.

## Step 4 — Parity gates. These REPLACE the fidelity gates and are stricter, not looser.

Report each as a number, not a verdict:

    vertex count        emitted vs measured     EQUAL
    triangle count      emitted vs measured     EQUAL
    bounding box        emitted vs measured     within the quantisation step
    base colour         per part                within the stated tolerance
    roughness/metalness per part                EQUAL to the measured value or median
    Σ skin weights      per vertex              |Σw - 1| < 1e-5
    skinIndex range     every index             < bone count
    bone count          emitted vs measured     EQUAL
    clip count          emitted vs measured     EQUAL, or the difference named clip by clip
    clip duration       per clip                EQUAL
    binding delta       seek each clip to >= 5 times    <= 2^-23

The last one is the only check that separates a clip that PLAYS from one that merely exists, loads,
holds an action and reports a duration while driving nothing.

A parity gate that cannot be evaluated reports `unevaluated` with the missing input named. Never a
pass.

## Step 5 — Emit

Factory, embedded surface data, codec and spec — all TypeScript, nothing fetched at runtime. With
`Overwrite: yes`, replace the files for this demo id and KEEP its id, camera and registry entry;
do not re-litigate settled decisions.

## What NOT to do on this route

  · do not run `--strict-quality`; it asks about inference and there is none here. Parity is the gate.
  · do not enumerate a `detailInventory` for geometry the GLB already measured.
  · do not smooth, re-topologise, weld or decimate. Those change the thing you are measuring.
  · do not rename what the file already named.
  · do not stop because a fidelity gate is unhappy. Stop when a PARITY gate fails.

## Report

Forced parameters and the value each took · vertex/triangle counts emitted vs measured · bounds
delta · bone count · clips with durations · maxSampledBindingDelta per clip · LOD count · and one
line naming what the GLB could not hand over, from the list above.
````


# Canonical standard prompt: polish.md
Source: `$OSS_ROOT/img2threejs/docs/standard-prompts/polish.md` ([upstream](https://github.com/img2threejs/img2threejs/blob/main/docs/standard-prompts/polish.md)). Exact text follows:
# Polish — a build that renders but does not match

For a model that already exists and already passes its gates, and is still wrong to look at.

**Why polish used to stall:** told to "fix everything that does not match", an agent rewrites the
factory, and the next render is different in ways nobody can attribute. This prompt fixes **one
defect per cycle**, with the measurement before and after, so a change that made things worse is
visible immediately instead of being buried under four other changes.

````text
Polish this img2threejs build against its reference. One defect per cycle.

## Inputs
- Factory:    <PATH_TO_create<Name>Model.ts>
- Spec:       <PATH_TO_object-sculpt-spec.json>
- Reference:  <PATH_TO_REFERENCE>
- Budget:     <N> cycles          # stop when spent, and report what is left

## Cycle

1. RENDER and package one reference-vs-render sheet. One sheet, not a scattering of screenshots.

2. NAME the single worst defect in one sentence — what is wrong, where, and how you can tell.
   Rank by identity impact, not by how easy it is to fix. A wrong silhouette outranks a wrong
   gloss, always.

3. MEASURE it before touching anything. Interior difference banded by height, ΔE00 for a colour,
   silhouette IoU for a shape, per-region confidence for anything the view cannot show. Write the
   number down. "It looks off" is not a measurement and cannot be checked afterwards.

4. ATTRIBUTE it to a component id and a spec field. If you cannot name the field, you are guessing
   — say so and pick the next defect instead of editing blind.

5. FIX exactly that field. Do not touch a second component in the same cycle, however tempting.

6. RE-MEASURE the same number. Three outcomes and all three are results:
     improved   -> keep it, record both numbers
     unchanged  -> revert it. The hypothesis was wrong; say what it was.
     worse      -> revert it, and say what that rules out.

7. Re-run the gates that cover what you touched. Never lower a threshold to pass one.

## Rules

  · A cycle that reverts is a successful cycle. It bought information.
  · Never fix two defects at once. Attribution is the whole value here.
  · Never edit the generated factory by hand — edit the spec and regenerate, or the next
    regeneration silently discards your work.
  · If a defect traces to something the reference cannot show, stop and say so: no number of cycles
    will resolve what the image does not contain.
  · If the same defect survives two cycles, stop and report it. A third attempt is guessing.

## Report

Per cycle: defect · measured before · field changed · measured after · kept or reverted.
Then: which defects remain, ranked, and which of them the reference cannot resolve.
Say "improved", never "done", unless every ranked defect is closed.
````


# Canonical standard prompt: vfx.md
Source: `$OSS_ROOT/img2threejs/docs/standard-prompts/vfx.md` ([upstream](https://github.com/img2threejs/img2threejs/blob/main/docs/standard-prompts/vfx.md)). Exact text follows:
# VFX — the effects layer for a character that already moves

Use this once the rig and its clips exist and play. It is the effects pass, not a rigging pass.

**Read this first: img2threejs has no particle subsystem.** There is no emitter type, no VFX gate,
no effect registry. What the pipeline gives you is anchors, a destruction model, and — the part that
matters most here — **a way to measure the clips instead of eyeballing them**:

    actionProfile.sockets[]   attachment / effect / grip / joint positions, in local coordinates
    destruction{}             breakable, fractureGroup, seamRefs, detachableFragments,
                              breakImpulse, debrisMaterial
    material.emissive         the glow channel
    userData.sculptRuntime    nodes, meshes, sockets, colliders, destructionGroups, height
    userData.tick             the per-frame hook

Everything visual is code you write, in plain `three`. Say which parts are authored rather than
measured — the same honesty rule the rest of the pipeline runs on, applied to effects.

## The measuring machinery already exists — call it, don't rebuild it

The prompt below asks you to sweep every clip through a real `AnimationMixer` rather than reading
timings off a scrub bar. That harness is already emitted:

- `emit_animation_runtime.py` emits `seek(name, t)` — play, pause, set time, `mixer.update(0)`,
  `updateMatrixWorld(true)`. That is a real evaluation at a real time, which is exactly what Gate R1
  uses to tell a clip that plays from one that merely exists.
- `clip_features.py` already measures `handRange`, `footRange`, `stance` intervals and `poseReturn`
  at N = 25 samples per clip.
- Everything in this project is expressed as a fraction of figure height `H`, and
  `userData.sculptRuntime.height` carries it. The prompt's "normalise to figure heights" is that
  same convention, not a new one.

## Anchoring — the rule that keeps effects alive through a rebuild

Every effect binds to a socket, a bone, or a destruction group **that already exists in the spec**.
No magic coordinates. If the anchor you need is not there, add it to the spec and regenerate — a
`sockets[]` entry with an id and a local position — rather than hard-coding a vector into the effect
code. A hard-coded position silently detaches the moment geometry is regenerated, and nothing warns
you.

On a rigged model an effect that must follow a limb binds to the **bone**, not to a pivot: rigging
merges the mesh and the per-part pivots no longer reach the geometry.

Additive blending for anything emissive; disable depth WRITE but keep depth TEST, or the effect
punches a hole through the model it is attached to. One `userData.tick(dt, elapsed)` per effect
group. The mixer takes the frame **delta** while the generic tick contract passes elapsed — say in a
comment which one each call site is passing. Plain `three` only, no new dependency, no runtime
fetch, and every effect disposable: geometry, material and texture released on teardown.

## The prompt

````text
Build the effects layer for the character already in this showcase — the rig and its clips exist,
only the VFX is missing.

Start from the subject. Study what this character is and how its actions read in the world it
comes from; the effects should belong to it, not to a generic effect kit. Then find the events —
don't eyeball timings off a scrub bar. Sweep every embedded clip through a real AnimationMixer and
measure where a strike actually stops at extension, where weight actually meets the ground, and
where the body is driven by a force arriving from outside the clip. Normalise to figure heights so
the table survives a change of scale.

Build around the stop, not the travel — the interesting part of any impact is the instant it
arrests. Schedule the effects against that measured table rather than a live "it just decelerated"
test: scheduling fires on the exact frame, and it's the only way a windup can exist at all,
because nothing else knows a strike is coming. Add hitstop; the clip itself slowing for a few tens
of milliseconds is most of the felt impact.

Give the character a small vocabulary of impact kinds and make them differ in motion first, colour
second — a light hit that is only a paler heavy hit is still a heavy hit. Take the palette from
the world the character lives in, not from an element wheel, and keep one contrasting accent so
something in frame reads against the rest. A blow the character takes is not a strike played
backwards: rings turn inward, debris comes off the body, no flash at the hand.

Calibrate continuous layers — motion trails, breath, ambient drift — per clip against that clip's
own measured speed; one global threshold smears the fast clips and leaves the slow ones bare. Pool
everything, allocate nothing after construction, and start every object invisible so the viewer's
framing pass never measures an effect. Then show me the loudest action, the quietest one, and a
ground contact.
````

## Report

The measured event table — clip, time, event kind, position in figure heights — before any effect
exists, because everything downstream is scheduled against it. Then per effect: anchor
(socket / bone / destruction group id), scale basis, blend mode, tick owner, disposal path. Finally
one line naming what is authored rather than measured, and the frame cost you measured — not the one
you expect.

## For an object rather than a character

An object has no clips to sweep, so there is no event table to measure and the whole scheduling
argument does not apply. Anchor on the same sockets and destruction groups, drive from
`userData.tick`, and break along the `seamRefs` and `detachableFragments` the spec already declares —
`debrisMaterial` is authored there, so use it rather than inventing a second material that will
drift from it.


# Showcase README instructions (exact excerpt)
Source: `README.md:237-280`
## From reference to live study

```mermaid
graph LR
    A[Reference image or measured source] --> B[Analysis and sculpt specification]
    B --> C[TypeScript model factory]
    C --> D[Quality and safety gates]
    D --> E[Interactive Three.js study]
```

1. **Study the source.** Record visible proportions, silhouette, material behavior, and unknown depth.
2. **Build in code.** Assemble geometry, materials, named parts, and optional actions in a TypeScript factory.
3. **Measure the result.** Compare the render with the source, document inference, and iterate on the largest visible gaps.
4. **Publish the study.** Add catalog metadata and a local reference; CI builds the gallery and runs the static safety gate.

For the reconstruction workflow itself, start with the
[img2threejs repository](https://github.com/img2threejs/img2threejs).

## Contributing a study

Have an img2threejs model worth sharing? The repository includes a scaffold command and a
purpose-built contribution path.

```bash
git clone https://github.com/<your-user>/img2threejs-showcase.git
cd img2threejs-showcase
npm ci

git switch -c add-demo/<id>
npm run new-demo -- <id> "<Title>" object   # or: character

# Add the factory and reference, then complete the generated registry entry.
npm run build
node scripts/check-showcase-safety.mjs --base main
```

A submission must:

- for Three.js studies, build geometry in code without fetching remote meshes, textures, fonts or scripts;
  owner-reviewed source-derived PixiJS studies use the dedicated local-asset path documented below;
- include a catalog reference image you have the right to use (`.png`, `.jpg`, `.jpeg` or `.webp`, at most 800 KiB);
- use a kebab-case id unique across both catalogs and complete the selected renderer's required fields;
- set `status: 'final'` once the real implementation replaces the scaffold;
- pass both the production build and the same safety scan used by CI.

# Spec instructions: awp-medusa-v2
Source: `src/demos/awp-medusa-v2/object-sculpt-spec-v2.json`; selected exact JSON fields (not the entire spec).
```json
{
  "qualityContract": {
    "qualityBar": "ultra-complex",
    "definitionOfDone": [
      "Both supplied broadside silhouettes meet IoU >= 0.90 after map stripping.",
      "All critical assemblies have physical rendered contact evidence.",
      "Projection remains registered through three orbit stress views.",
      "Hidden/inferred regions carry confidence and no unsupported exact dimensions are claimed."
    ],
    "minimumSpecDepth": {
      "macroComponents": 5,
      "mesoComponents": 16,
      "microFeatureGroups": 8,
      "materialLayers": 4,
      "repetitionSystems": 2,
      "reviewViewpoints": 5
    },
    "featureGroups": [
      {
        "id": "silhouette",
        "name": "Silhouette and negative spaces",
        "required": true,
        "qualityCriteria": [
          "Stock, receiver, barrel, scope, bipod, thumbhole, trigger opening, and muzzle are explicitly measured."
        ],
        "evidenceRefs": [
          "front-broadside",
          "back-broadside"
        ],
        "failureModes": [
          "generic rifle proportions",
          "wrong thumbhole or stock mass"
        ]
      },
      {
        "id": "assembly",
        "name": "Semantic assembly and contact",
        "required": true,
        "qualityCriteria": [
          "Bolt, scope rings, trigger, magazine, hinge, springs, legs, feet, and fasteners have owned parents and contact contracts."
        ],
        "evidenceRefs": [
          "front-broadside",
          "bipod-reference"
        ],
        "failureModes": [
          "floating components",
          "socket metadata without physical contact"
        ]
      },
      {
        "id": "finish",
        "name": "Medusa finish and material response",
        "required": true,
        "qualityCriteria": [
          "Projected finish is surface-owned, with independent PBR response and no camera-facing extrusion."
        ],
        "evidenceRefs": [
          "front-broadside",
          "back-broadside",
          "scope-reference"
        ],
        "failureModes": [
          "projection drift",
          "flat plastic materials"
        ]
      },
      {
        "id": "runtime",
        "name": "Runtime action readiness",
        "required": true,
        "qualityCriteria": [
          "Root tick, pivots, sockets, and movable assemblies are exposed."
        ],
        "evidenceRefs": [
          "front-broadside"
        ],
        "failureModes": [
          "unowned transforms",
          "unanimatable merged mesh"
        ]
      }
    ],
    "visualDeltaChecks": [
      "broadside silhouette IoU",
      "landmark station residual",
      "component contact envelope",
      "projection registration under orbit",
      "material gradient/roughness response"
    ],
    "antiShallowSpecRules": [
      "Do not code before measured packet.",
      "Do not use camera-facing geometry for depth.",
      "Do not use maps alone for fasteners, springs, rails, rings, trigger, bore, hinge, legs, or feet.",
      "Do not accept metadata-only sockets as contact proof."
    ],
    "mustNotDo": [
      "Do not copy V1 geometry or transforms.",
      "Do not fallback to a knife component tree.",
      "Do not call hidden geometry observed.",
      "Do not apply projection before the silhouette gate."
    ]
  },
  "proceduralStrategy": [
    "Measure source masks and landmarks before geometry.",
    "Build normalized profile extrusions and coaxial primitives.",
    "Use parent sockets plus rendered contact envelopes.",
    "Build independent helix curve sweeps for both springs.",
    "Lock map-stripped silhouette before projection.",
    "Project de-lit front/back pixels only onto authored visible shell/optic surfaces.",
    "Validate three orbit stress views before optimization."
  ],
  "assumptions": [
    {
      "id": "scale",
      "value": "normalized rifle length 10.0 units; centimeters unknown",
      "confidence": 0.35
    },
    {
      "id": "camera",
      "value": "orthographic-first broadside framing",
      "confidence": 0.58
    },
    {
      "id": "hidden-thickness",
      "value": "mechanical symmetry and profile priors",
      "confidence": 0.35
    },
    "The 3D reference set contains NO top-down view, so rail width in plan, bipod leg spread in plan, and the objective seen from above are not established by any supplied image.",
    "SPATIAL OWNERSHIP, cols 60-61 (world x -2.49..-2.44), answering the state gate's request-input: the STOCK shell owns the solid material there. ref3d-05 shows the trigger guard is an OPENING CUT INTO the chassis, so `trigger-guard` contributes only the cut boundary and must not also supply solid material behind it, and `bolt-handle` travel is excluded from that cell in the rest pose. This is why four single-mesh sweeps and a two-owner combined move all rendered byte-identical: the cell was multiply-owned, so removing any one owner changed nothing."
  ],
  "risks": [
    {
      "id": "hidden-depth",
      "severity": "medium",
      "confidence": 0.35,
      "treatment": "mechanical symmetry and explicit inferred labels"
    },
    {
      "id": "projection-drift",
      "severity": "high",
      "confidence": 0.58,
      "treatment": "front/back visible-surface masks plus three orbit checks"
    },
    {
      "id": "canonical-cs2-family",
      "severity": "high",
      "confidence": 0.99,
      "treatment": "custom rifle-v2 adapter; never fallback to knife"
    }
  ],
  "selfCorrectLoop": {
    "enabled": true,
    "visualAcceptance": {
      "reviewer": "ai-vision",
      "threshold": 0.9,
      "comparisonArtifactRequired": true,
      "layerScoresRequired": true,
      "codePixelDiffIsAcceptanceAuthority": false,
      "requiredLayerScores": [
        "silhouetteProportion",
        "componentStructure",
        "formDetail",
        "materialSurface",
        "lightingCamera"
      ],
      "featureReviewPolicy": {
        "enabled": true,
        "reviewUnit": "semantic-subsystem",
        "maxCriticalFeaturesPerPass": 5,
        "maxImportantFeaturesPerPass": 3,
        "criticalDefaultThreshold": 0.9,
        "importantAverageThreshold": 0.8,
        "adaptiveEscalation": true,
        "singleImagePairOnly": false,
        "selectionRule": "Review broadside source matches plus orbit stress views; each critical failure blocks the pass."
      },
      "perPassLayerGates": {
        "_rationale": "The flat 0.9 threshold across all five layers is unsatisfiable before the material pass: buildPasses[0] is defined as 'map-stripped macro silhouette and camera framing' while materialSurface and lightingCamera belong to buildPasses[3] and [5]. Under the flat rule no early pass can ever close. Each build pass therefore gates on the layers it is responsible for; the other layers are still SCORED and recorded every pass so regressions stay visible.",
        "blockout": {
          "gatingLayers": [
            "silhouetteProportion"
          ],
          "threshold": 0.9
        },
        "structural-pass": {
          "gatingLayers": [
            "silhouetteProportion",
            "componentStructure"
          ],
          "threshold": 0.9
        },
        "form-refinement": {
          "gatingLayers": [
            "silhouetteProportion",
            "componentStructure",
            "formDetail"
          ],
          "threshold": 0.9
        },
        "material-pass": {
          "gatingLayers": [
            "silhouetteProportion",
            "componentStructure",
            "formDetail",
            "materialSurface"
          ],
          "threshold": 0.9
        },
        "lighting-pass": {
          "gatingLayers": [
            "silhouetteProportion",
            "componentStructure",
            "formDetail",
            "materialSurface",
            "lightingCamera"
          ],
          "threshold": 0.9
        }
      }
    },
    "reviewAfterPasses": [
      "blockout",
      "structural-pass",
      "form-refinement",
      "material-pass",
      "surface-pass",
      "lighting-pass",
      "interaction-pass",
      "optimization-pass"
    ],
    "allowedActions": [
      "continue",
      "refine-spec",
      "refine-code",
      "request-input",
      "stop"
    ],
    "specRefineTriggers": [
      "wrong camera",
      "wrong station",
      "wrong primitive family",
      "missing component",
      "missing attachment"
    ],
    "codeRefineTriggers": [
      "render differs from sound spec",
      "contact gap",
      "projection drift",
      "material response mismatch"
    ],
    "stopCriteria": [
      "acceptance gates pass",
      "remaining gaps require additional views"
    ],
    "screenshotPolicy": {
      "requiredForPasses": [
        "blockout",
        "structural-pass",
        "form-refinement",
        "material-pass",
        "surface-pass",
        "lighting-pass",
        "interaction-pass"
      ],
      "preferredCapture": "browser screenshot under fixed and orbit cameras",
      "fallbackCapture": "user-supplied screenshot path",
      "minimumEvidence": "reference, render, side-by-side sheet, layer scores, per-feature review, and critique",
      "reviewPairRule": "Compare both authoritative broadside views and at least three orbit stress views.",
      "acceptanceAuthority": "Agent vision review plus deterministic gates; code pixel diff is diagnostic only."
    }
  }
}
```

# Spec instructions: boxing-man
Source: `pipelines/boxing-man/object-sculpt-spec.json`; selected exact JSON fields (not the entire spec).
```json
{
  "qualityContract": {
    "qualityBar": "measured-surface",
    "exactnessTier": "measured",
    "definitionOfDone": [
      "Every part in the download renders from embedded data with no runtime asset fetch.",
      "Part identity is labelled as a hypothesis until a render review confirms it.",
      "Colour, roughness and metalness are measured from the source, not invented."
    ],
    "notDone": [
      "AI-vision review against the reference (the skill's stage 4) has not run in the browser.",
      "No authored animation beyond the idle motion; pivots exist, clips do not.",
      "Hidden sides are whatever the generator hallucinated; a single photo cannot confirm them."
    ]
  },
  "risks": [
    {
      "id": "hypothesis-labels",
      "severity": "medium",
      "note": "Part names come from bounds bands; a boot can be called a knee pad. Confirm in the viewer before publishing."
    },
    {
      "id": "generator-hidden-sides",
      "severity": "medium",
      "note": "Back and underside geometry is generated, not observed."
    },
    {
      "id": "vertex-colour-resolution",
      "severity": "low",
      "note": "Colour resolution equals vertex density; decimation lowers both."
    }
  ]
}
```

# Spec instructions: classic-fade
Source: `src/demos/classic-fade/object-sculpt-spec.json`; selected exact JSON fields (not the entire spec).
```json
{
  "qualityContract": {
    "route": "reference-projection",
    "exactnessTier": "image-only",
    "mustMatch": [
      "blade silhouette incl. 6-notch jimping, choil arc, drop-point tip",
      "hammer-head guard profile with forward-canted quillon and lower spur",
      "Fade colour order and transition positions along the blade",
      "5-step staircase butt + lanyard hole",
      "gold beaded ferrule as the only warm-metal band",
      "diamond-quilted grip relief",
      "4 bolster screws per face"
    ],
    "mayApproximate": [
      "Z thickness of every part (no view resolves depth)",
      "exact bead layout inside the ferrule",
      "micro-scratch/wear noise placement",
      "the interior of the lanyard bore"
    ],
    "mustNotDo": [
      "substitute a Bayonet/M9/Bowie/Navaja/Karambit component tree",
      "replace the observed Fade with a generic procedural gradient while projection is available",
      "reuse albedo as roughness/normal/AO/metalness",
      "claim exact-texture provenance from the skin name alone"
    ],
    "qualityBar": "ultra-complex",
    "minimumSpecDepth": {
      "macroComponents": 5,
      "mesoComponents": 16,
      "microFeatureGroups": 8,
      "materialLayers": 4,
      "repetitionSystems": 2,
      "reviewViewpoints": 5
    },
    "featureGroups": [
      {
        "id": "blade-system",
        "name": "Blade silhouette + grind",
        "componentRefs": [
          "blade",
          "spineJimping",
          "choil",
          "edgeBevel",
          "grindFacet",
          "ricassoFlat",
          "dropPointTip"
        ],
        "importance": 1.0
      },
      {
        "id": "guard-system",
        "name": "Hammer-head crossguard",
        "componentRefs": [
          "guard",
          "upperQuillon",
          "lowerSpur"
        ],
        "importance": 0.9
      },
      {
        "id": "finish-system",
        "name": "Fade finish placement",
        "componentRefs": [
          "blade"
        ],
        "importance": 1.0
      },
      {
        "id": "handle-system",
        "name": "Grip, bolsters and ferrule",
        "componentRefs": [
          "grip",
          "quiltField",
          "foreBolster",
          "rearBolster",
          "ferrule",
          "beadBand"
        ],
        "importance": 0.85
      },
      {
        "id": "pommel-system",
        "name": "Stepped butt + lanyard",
        "componentRefs": [
          "buttPlate",
          "buttStaircase",
          "lanyardBore",
          "lanyardChamfer"
        ],
        "importance": 0.8
      }
    ]
  },
  "proceduralStrategy": [
    "Block out macro silhouette first.",
    "Add component hierarchy and joints.",
    "Create stable pivot groups, sockets, collider proxies, and destruction metadata before visual polish.",
    "Refine forms with bevels, tapers, bends, and procedural noise.",
    "Run reference PBR extraction for important source-image materials and stop when confidence is below the target threshold.",
    "Add material variation before adding expensive micro-geometry."
  ],
  "assumptions": {
    "thickness": "INFERRED (confidence 0.45) - both supplied views are broadside",
    "float": "unknown - 'Minimal Wear' is a user-supplied label, not measured",
    "paintSeed": "unknown - not derivable from pixels",
    "uvLayout": "not the Valve UV layout; a purpose-built shared planar projection",
    "hiddenRegions": "extrusion walls and the bore interior are authored, not observed"
  },
  "risks": [],
  "selfCorrectLoop": {
    "enabled": true,
    "visualAcceptance": {
      "reviewer": "ai-vision",
      "threshold": 0.7,
      "comparisonArtifactRequired": true,
      "layerScoresRequired": true,
      "codePixelDiffIsAcceptanceAuthority": false,
      "scoringRule": "AI vision must inspect a side-by-side reference/render sheet and score the current pass from 0 to 1. Pixel-diff code may assist diagnostics but cannot approve a pass.",
      "requiredLayerScores": [
        "silhouetteProportion",
        "componentStructure",
        "formDetail",
        "materialSurface",
        "lightingCamera"
      ],
      "featureReviewPolicy": {
        "enabled": true,
        "reviewUnit": "semantic-subsystem",
        "maxCriticalFeaturesPerPass": 5,
        "maxImportantFeaturesPerPass": 3,
        "criticalDefaultThreshold": 0.8,
        "importantAverageThreshold": 0.65,
        "adaptiveEscalation": true,
        "singleImagePairOnly": true,
        "selectionRule": "Choose only the most visually salient, identity-defining, user-prioritized, or high-risk semantic systems. Group repeated parts instead of reviewing every mesh. AI vision scores every selected feature from the same full reference/render pair."
      }
    },
    "reviewAfterPasses": [
      "blockout",
      "structural-pass",
      "form-refinement",
      "material-pass",
      "surface-pass",
      "lighting-pass",
      "interaction-pass",
      "optimization-pass"
    ],
    "allowedActions": [
      "continue",
      "refine-spec",
      "refine-code",
      "request-input",
      "stop"
    ],
    "specRefineTriggers": [
      "missing component",
      "wrong primitive family",
      "wrong proportions",
      "material layer under-specified",
      "local feature not traceable to viewEvidence",
      "reference ambiguity discovered during implementation"
    ],
    "codeRefineTriggers": [
      "spec is adequate but generated geometry/material does not match",
      "browser render differs from reference",
      "performance budget exceeded",
      "lighting hides geometry or material response"
    ],
    "stopCriteria": [
      "target fidelity reached or user accepts current approximation",
      "remaining gaps require new reference images or manual art"
    ],
    "screenshotPolicy": {
      "requiredForPasses": [
        "blockout",
        "structural-pass",
        "form-refinement",
        "material-pass",
        "surface-pass",
        "lighting-pass",
        "interaction-pass"
      ],
      "preferredCapture": "in-app-browser-screenshot",
      "fallbackCapture": "user-supplied-screenshot-path",
      "minimumEvidence": "Each visual pass needs a reference image, rendered screenshot, side-by-side comparison sheet, AI vision score, layer scores, and critique before choosing continue.",
      "reviewPairRule": "Compare the same camera/viewpoint whenever possible; do not judge a front reference against a random render angle.",
      "acceptanceAuthority": "AI vision review of the comparison sheet. Code-generated pixel similarity is not sufficient evidence."
    }
  }
}
```

# Spec instructions: electric-mouse-mascot
Source: `src/demos/electric-mouse-mascot/object-sculpt-spec.json`; selected exact JSON fields (not the entire spec).
```json
{
  "qualityContract": {
    "qualityBar": "complex",
    "definitionOfDone": [
      "The rendered model matches the reference silhouette, primary proportions, visible component hierarchy, material response, and most recognizable local features for the selected fidelity tier."
    ],
    "minimumSpecDepth": {
      "macroComponents": 3,
      "mesoComponents": 8,
      "microFeatureGroups": 5,
      "materialLayers": 3,
      "repetitionSystems": 1,
      "reviewViewpoints": 4
    },
    "featureGroups": [
      {
        "id": "overall-silhouette",
        "name": "Overall silhouette and proportions",
        "required": true,
        "qualityCriteria": [
          "Bounding shape, dominant curves, negative spaces, and scale relationships are explicitly described."
        ],
        "evidenceRefs": [
          "full-object"
        ],
        "failureModes": [
          "model reads as a generic placeholder instead of the reference object",
          "major proportions are guessed without evidence"
        ]
      },
      {
        "id": "primary-structure",
        "name": "Primary structure and hierarchy",
        "required": true,
        "qualityCriteria": [
          "Major parts, joints, seams, contact points, and parent-child relationships are named before code generation."
        ],
        "evidenceRefs": [
          "full-object"
        ],
        "failureModes": [
          "large visible parts are merged into one mesh",
          "component hierarchy is too shallow for the observed complexity"
        ]
      },
      {
        "id": "attachment-joint-correctness",
        "name": "Attachment and joint correctness",
        "required": true,
        "qualityCriteria": [
          "Every visible child appendage, branch, limb, handle, connector, tube, cable, horn, wing, leg, or hinged part has an attachment contract with parent socket, localStart/localEnd, contact type, embed/overlap, and gap tolerance."
        ],
        "evidenceRefs": [
          "full-object"
        ],
        "failureModes": [
          "child part root floats away from the parent",
          "branch/limb/tube is centered in space instead of pivoting from its root",
          "parent-child transform mixes world and local coordinates"
        ]
      },
      {
        "id": "surface-material-response",
        "name": "Surface material response",
        "required": true,
        "qualityCriteria": [
          "Albedo zones, roughness, normal/bump/displacement intent, cavity dirt, edge wear, and local overrides are specified where visible.",
          "Important materials define independent albedo, roughness, height/normal, and AO responses instead of reusing one texture for unrelated PBR channels.",
          "Surface response is decomposed into macro, meso, and micro frequency bands with scale and amplitude tied to object scale."
        ],
        "evidenceRefs": [
          "full-object"
        ],
        "failureModes": [
          "surface looks like flat plastic",
          "local material variation is missing or not tied to image evidence"
        ]
      },
      {
        "id": "reference-lookdev",
        "name": "Reference color, material, and lighting response",
        "required": true,
        "qualityCriteria": [
          "Material-pass names the reference-derived albedo palette, roughness variation, tactile normal/bump/displacement response, and local masks.",
          "When a source image is available, run reference PBR extraction and require confidence >= 0.7 before treating maps as implementation-ready.",
          "Lighting-pass names key/fill/rim or environment light, exposure, tone mapping, background, and contact shadow behavior.",
          "Neutral, grazing-angle, and reference-matched renders prove that surface relief survives relighting and is not painted into albedo."
        ],
        "evidenceRefs": [
          "full-object"
        ],
        "failureModes": [
          "model has acceptable shape but reads as flat shaded or plastic",
          "colors are a generic average instead of reference-observed local color zones",
          "lighting is evenly ambient and cannot reproduce the source value range"
        ]
      }
    ],
    "visualDeltaChecks": [
      "silhouette and negative-space delta",
      "component hierarchy depth delta",
      "repetition density and distribution delta",
      "material albedo/roughness/normal response delta",
      "local feature placement and scale delta"
    ],
    "antiShallowSpecRules": [
      "Do not proceed to code if qualityContract.qualityBar is unassessed.",
      "Do not proceed to code if the spec only contains a root component for a moderate or complex object.",
      "Do not proceed to code if required featureGroups are not represented by componentTree, materials, or repetitionSystems.",
      "Do not proceed to code if visible local features are described only in prose and not attached to components/materials/evidenceRefs.",
      "Do not proceed past structural-pass if attached child parts lack attachment.parentSocket, localStart, localEnd, embedDepth/overlap, and gapTolerance.",
      "Do not pass material look-dev when albedo is reused as roughness, height, normal, or AO.",
      "Do not pass material look-dev without macro, meso, and micro surface frequency bands for close-up materials.",
      "Do not pass reference-fidelity material look-dev from a source image without usable referencePbr maps or an explicit documented limitation.",
      "Do not patch a spec with extracted PBR maps when extraction confidence is below the target threshold unless the user explicitly accepts lower fidelity.",
      "Do not place adjacent separate-geometry parts below 0.02 world-unit seam overlap (source: grimoire/build/geometry_patterns.md).",
      "Do not satisfy raised or recessed relief, fasteners, or grip structure with a map alone when the feature affects form; use geometry or displacement (source: grimoire/build/geometry_patterns.md).",
      "Adjacent components must overlap by at least 0.02 world units at shared seams (source: grimoire/build/geometry_patterns.md).",
      "Raised or recessed relief and fasteners must be geometry, instanced micro-parts, or displacement; a map alone is an approximation (source: grimoire/build/geometry_patterns.md)."
    ],
    "mustNotDo": [
      "Do not proceed to code if qualityContract.qualityBar is unassessed.",
      "Do not proceed to code if the spec only contains a root component for a moderate or complex object.",
      "Do not proceed to code if required featureGroups are not represented by componentTree, materials, or repetitionSystems.",
      "Do not proceed to code if visible local features are described only in prose and not attached to components/materials/evidenceRefs.",
      "Do not proceed past structural-pass if attached child parts lack attachment.parentSocket, localStart, localEnd, embedDepth/overlap, and gapTolerance.",
      "Do not pass material look-dev when albedo is reused as roughness, height, normal, or AO.",
      "Do not pass material look-dev without macro, meso, and micro surface frequency bands for close-up materials.",
      "Do not pass reference-fidelity material look-dev from a source image without usable referencePbr maps or an explicit documented limitation.",
      "Do not patch a spec with extracted PBR maps when extraction confidence is below the target threshold unless the user explicitly accepts lower fidelity.",
      "Do not place adjacent separate-geometry parts below 0.02 world-unit seam overlap (source: grimoire/build/geometry_patterns.md).",
      "Do not satisfy raised or recessed relief, fasteners, or grip structure with a map alone when the feature affects form; use geometry or displacement (source: grimoire/build/geometry_patterns.md).",
      "Adjacent components must overlap by at least 0.02 world units at shared seams (source: grimoire/build/geometry_patterns.md).",
      "Raised or recessed relief and fasteners must be geometry, instanced micro-parts, or displacement; a map alone is an approximation (source: grimoire/build/geometry_patterns.md)."
    ]
  },
  "proceduralStrategy": [
    "Block out macro silhouette first.",
    "Add component hierarchy and joints.",
    "Create stable pivot groups, sockets, collider proxies, and destruction metadata before visual polish.",
    "Refine forms with bevels, tapers, bends, and procedural noise.",
    "Run reference PBR extraction for important source-image materials and stop when confidence is below the target threshold.",
    "Add material variation before adding expensive micro-geometry."
  ],
  "assumptions": [],
  "risks": [],
  "selfCorrectLoop": {
    "enabled": true,
    "visualAcceptance": {
      "reviewer": "ai-vision",
      "threshold": 0.7,
      "comparisonArtifactRequired": true,
      "layerScoresRequired": true,
      "codePixelDiffIsAcceptanceAuthority": false,
      "scoringRule": "AI vision must inspect a side-by-side reference/render sheet and score the current pass from 0 to 1. Pixel-diff code may assist diagnostics but cannot approve a pass.",
      "requiredLayerScores": [
        "silhouetteProportion",
        "componentStructure",
        "formDetail",
        "materialSurface",
        "lightingCamera"
      ],
      "featureReviewPolicy": {
        "enabled": true,
        "reviewUnit": "semantic-subsystem",
        "maxCriticalFeaturesPerPass": 5,
        "maxImportantFeaturesPerPass": 3,
        "criticalDefaultThreshold": 0.8,
        "importantAverageThreshold": 0.65,
        "adaptiveEscalation": true,
        "singleImagePairOnly": true,
        "selectionRule": "Choose only the most visually salient, identity-defining, user-prioritized, or high-risk semantic systems. Group repeated parts instead of reviewing every mesh. AI vision scores every selected feature from the same full reference/render pair."
      }
    },
    "reviewAfterPasses": [
      "blockout",
      "structural-pass",
      "form-refinement",
      "material-pass",
      "surface-pass",
      "lighting-pass",
      "interaction-pass",
      "optimization-pass"
    ],
    "allowedActions": [
      "continue",
      "refine-spec",
      "refine-code",
      "request-input",
      "stop"
    ],
    "specRefineTriggers": [
      "missing component",
      "wrong primitive family",
      "wrong proportions",
      "material layer under-specified",
      "local feature not traceable to viewEvidence",
      "reference ambiguity discovered during implementation"
    ],
    "codeRefineTriggers": [
      "spec is adequate but generated geometry/material does not match",
      "browser render differs from reference",
      "performance budget exceeded",
      "lighting hides geometry or material response"
    ],
    "stopCriteria": [
      "target fidelity reached or user accepts current approximation",
      "remaining gaps require new reference images or manual art"
    ],
    "screenshotPolicy": {
      "requiredForPasses": [
        "blockout",
        "structural-pass",
        "form-refinement",
        "material-pass",
        "surface-pass",
        "lighting-pass",
        "interaction-pass"
      ],
      "preferredCapture": "in-app-browser-screenshot",
      "fallbackCapture": "user-supplied-screenshot-path",
      "minimumEvidence": "Each visual pass needs a reference image, rendered screenshot, side-by-side comparison sheet, AI vision score, layer scores, and critique before choosing continue.",
      "reviewPairRule": "Compare the same camera/viewpoint whenever possible; do not judge a front reference against a random render angle.",
      "acceptanceAuthority": "AI vision review of the comparison sheet. Code-generated pixel similarity is not sufficient evidence."
    }
  }
}
```

# Spec instructions: monster-tree
Source: `src/demos/monster-tree/object-sculpt-spec.json`; selected exact JSON fields (not the entire spec).
```json
{
  "qualityContract": {
    "qualityBar": "measured-surface",
    "exactnessTier": "measured",
    "definitionOfDone": [
      "Every part in the download renders from embedded data with no runtime asset fetch.",
      "Part identity is labelled as a hypothesis until a render review confirms it.",
      "Colour, roughness and metalness are measured from the source, not invented.",
      "Four character-native authored actions are visually reviewed and scored in the shared viewer."
    ],
    "notDone": [
      "Hidden sides are whatever the generator hallucinated; a single photo cannot confirm them.",
      "The twelve generic biped clips are retained as rig evidence but are not presented as authored character moves."
    ]
  },
  "risks": [
    {
      "id": "hypothesis-labels",
      "severity": "medium",
      "note": "Part names come from bounds bands; a boot can be called a knee pad. Confirm in the viewer before publishing."
    },
    {
      "id": "generator-hidden-sides",
      "severity": "medium",
      "note": "Back and underside geometry is generated, not observed."
    },
    {
      "id": "vertex-colour-resolution",
      "severity": "low",
      "note": "Colour resolution equals vertex density; decimation lowers both."
    },
    {
      "id": "costume-band-boundary",
      "severity": "low",
      "note": "the costume cut is a warmth-profile hypothesis, not a labelled asset. Leather outside the band stays on the skinned shell and still deforms; it keeps its leather vertex colour, so the join is not visible, but it is not rigid either."
    },
    {
      "id": "bracer-seam",
      "severity": "low",
      "note": "the bracer seam ring is ~26% weighted to the upper arm, so a rigid piece cannot track it exactly. Worst measured gap 0.053 on a 1.9 figure (2.8%), during a punch. The gloves, whose ring is pure hand, measure 0.0006 and 0.0."
    },
    {
      "id": "clip-appearance-unconfirmed",
      "severity": "medium",
      "note": "skill names come from each clip's measured kinematics, not from a visual review of the pose. The Tripo preset names were not used as evidence."
    }
  ]
}
```
