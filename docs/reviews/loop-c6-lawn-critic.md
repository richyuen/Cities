<!-- Saved verbatim by the orchestrator, 2026-10-09 (extracted from the critic agent's final message). Integrity check: git status and diff hash identical before and after the run. Code reviewed: 7b85d48 + the lawn builder's src/terrain and the orchestrator's roads edit, before any fix round. -->

# loop-c6-lawn-critic

verdict: **FIX** (one item, frame 05)   score: **7.0/10**

All hard gates are green and `lawn=0` is a sound control. The one thing worth fixing before the panel is the dark-stud "polka dot" field in 05, and I could not validate a fix for it. If one builder attempt does not clear it, run the panel anyway with `lawn=1` and 05 flagged.

Recommended variant to face `lawn=0`: **`lawn=1` (sparse12)**.

Limits of this review:
- Time box reached; unmeasured items are listed at the end.
- `date` advanced only about 11 minutes (22:51 to 23:02) across far more GPU work than that, as the builder also saw. Capture JSON timestamps are authoritative.
- `git status --porcelain -- src tools docs ARCHITECTURE.md` is unchanged from the start of my run.
- I ran `node tools/check-detail.mjs` with its default output, so it overwrote `C:\Git\Cities\shots\props\c2\summary.json`.
- My scratch scripts live in `C:\Users\ryuen\AppData\Local\Temp\claude\C--Git-Cities\ac5f4a89-9f27-4edc-becd-51e343f136f0\scratchpad\crit\` (`diag.mjs`, `exp.mjs`, `fix.mjs`, `sheen.mjs`, plus the crops cited below). They change scene state at runtime only.

## Gates

| gate | measured | command / output path |
|---|---|---|
| `lawn=0` shot-list vs `c6d2-s1` | mean 0.0042; per frame 0 / 0.0043 / 0.0065 / 0.0101 / 0.0002; all within the 0.014 repeat noise | `node tools/shot-list.mjs --out shots/beauty/c6lawncrit0-s1 --seed 1 --param lawn=0`, then `diff.mjs`; `C:\Git\Cities\shots\beauty\c6lawncrit0-s1\diff-c6d2.json` |
| `lawn=0` game batch vs `c6d2` | 0/20 over 0.30; **mean 0.0293, worst closeup-12 at 0.0847** (0.23% of pixels). About 30x the quoted ~0.001 repeat noise, but it is not a lawn leak (see claims) | `node tools/critic.mjs --game --round 65 --dir shots/game/c6lawncrit0 --param lawn=0`; `C:\Git\Cities\shots\game\c6lawncrit0\diff-c6d2.json` |
| default batch errors | `errors []`, `moduleErrors {}` | `C:\Git\Cities\shots\game\c6lawncrit1\summary.json` |
| gpuMs ≤ 20 | max 7.09 (`lawn=0` in the same session: 7.76) | same |
| draws ≤ 1500, equal per shot | max 824; 20/20 shots identical to `lawn=0` | both `summary.json` files |
| fps ≥ 50 | min 135.5 (`lawn=0`: 123.8) | same |
| gpuMs change vs `lawn=0` | mean −0.08 ms, range −0.67 to +0.42. The design's own ±0.3 ms criterion is exceeded on skyline-6h5 (+0.40) and skyline-18 (+0.42), and on four shots in the negative direction. Single runs; not a hard-gate failure | same |
| textures | 38 → 39; programs unchanged (44–47) | per-shot JSONs |
| boot cost | readyMs 12,208 (`lawn=0`) vs 12,139 (`lawn=1`) on batches; 12,754 vs 12,009 on shot-lists. No measurable cost | per-shot JSONs |
| determinism re-stage (`lawn=1`, seed 1, new session vs builder capture) | mean 0.0528; 01 = 0 (meanAbs 0, maxDelta 0), 04 = 0.0011, 03 = 0.0429, 05 = 0.0432, 02 = 0.1767. All ≤ 0.30 | `C:\Git\Cities\shots\beauty\c6lawncrit1-s1\diff-builder.json` |
| check-detail | 46/46; nosp census e0f35033 == e0f35033 | `node tools/check-detail.mjs`; `C:\Git\Cities\shots\props\c2\summary.json` |
| check-background | 4/4; 0 plate rays with no tool, 216 with a zone tool | `C:\Git\Cities\shots\background\c6lawncrit1\summary.json` |
| `Math.random` | 0 hits in `src/terrain`, `src/roads` | grep |
| owner scope | 5 tracked files (+142/−8) plus new `src/terrain/lawn.js`; `src/roads/index.js` is +3 lines in `markFootprint` only | `git diff --stat 7b85d48` |
| `lawn.js` vs design text | keep-rule block identical except the added `LAWN_DEFAULT` line | `diff` of the two blocks |
| check-atmosphere, check-beauty, check-civics | **not run** | — |
| `nosp=1` + `lawn=0` batch | **not run** | — |

## Claims

| claim | reproduced? | my number | evidence |
|---|---|---|---|
| `lawn=0` shot-list mean 0.0033, all ≤ 0.03 | yes | 0.0042, worst 0.0101 | `shots\beauty\c6lawncrit0-s1\diff-c6d2.json` |
| `lawn=0` batch mean 0.0020, worst 0.0086 | **not reproduced** | mean 0.0293, worst 0.0847 | My run differs from the builder's own `lawn=0` batch by 0.0309 on the same code, so this is run-to-run variance. In closeup-12 the differing pixels are the pink bus and a far bus shifted a few pixels; the ground is unchanged (`scratchpad\crit\cmp-closeup12.png`) |
| `lawn=1` shot-list reproducible | yes, with caveat | 02 at 0.1767 | All 9,288 differing pixels in 02 sit in one box at (1712,13)–(1919,203), the blue vehicle top right. 03 and 05 differences are scattered small clusters on roads |
| default batch: errors [], draws identical 20/20, 7.09 ms, fps 135.5 | yes | identical figures | `shots\game\c6lawncrit1\summary.json` |
| mean gpuMs change −0.060 | roughly | −0.082 | same |
| goldens mode 1: 45ffee02 / 5,624 | yes (one boot) | 45ffee02 / 5,624 | `C:\Git\Cities\shots\terrain\c6lawncrit-diag1\result.json` |
| goldens modes 2 and 3 | **not reproduced** (not run) | — | — |
| texture metric table | yes, every `lawn=0` and `lawn=1` cell matches | e.g. 05 near box 0.222/24.3% → 0.040/1.3%; **05 far strip 0.127 / 12.0%, at the bound, not under it** | computed on my own captures |
| luminance 112.4 → 174.9 (05 near box) | yes | 112.4 → 174.9 (`lawn=2`: 166.2; `lawn=3`: 177.0) | same script |
| no dense stud hem beside roads | yes | field is sparse right up to the kerb in 05 | `shots\beauty\c6lawncrit1-s1\05-avenue-noon.png` |
| key `terrain-ground-v3-lawn\|csm`, CSM wrap kept | yes | as stated | `c6lawncrit-diag1\result.json` |
| studs lost and regained on building add/remove | partly | far-relief view before and after removal match | `scratchpad\crit\cmp-bld.png`. The "with building" frame is hidden by the roof, so the mask under a building is **not verified** |
| "stud tops match the plate; side walls are dark" (gap 1) | yes | top (153,204,176) vs plate (144,203,161); side wall (14,70,44) down to (8,52,24) | `shots\terrain\c6lawncrit-diag1\A-base.png`, zoom `scratchpad\crit\studzoom.png` |
| fade band has no seam | stills only | real hex studs at 140 m, relief rings in the same cells at 150 and 160 m, no doubling | `scratchpad\crit\cmp-fade.png`. Flicker during a pan is **not measured** |
| no added moiré (design risk 7, not run by the builder) | cleared | 0.05° yaw nudge, low-passed luminance difference: street far strip 2.778 (`lawn=0`) vs 0.726 (`lawn=1`); street near field 1.59 vs 0.185; skyline near 1.139 vs 0.693; skyline mid and far equal (0.43, 0.56) | `C:\Git\Cities\shots\terrain\c6lawncrit-exp0\`, `c6lawncrit-exp1\` |
| init-log suffix | **not verified** | `__city.logs` does not exist | — |

## Ranked issues

1. **05: dark studs on a pale plate read as polka dots (MEDIUM-HIGH; the reason for FIX).**
   - **Where:** `shots\beauty\c6lawncrit1-s1\05-avenue-noon.png`, and identical on seed 23 (`shots\beauty\c6lawncrit1-s23\05-avenue-noon.png`) because the pattern is seed-independent. Also the night frame `shots\game\c6lawncrit1\street-21h5.png`.
   - **What the pixels show:** stud tops match the plate. The side walls are about 10x darker in linear terms and saturated green. With the full grid those walls were the texture; sparse, they are isolated dark pucks on a mint plane.
   - **Why it hurts:** the reference lawn in `docs\reference\ss_f6da…jpg` is saturated green with small low-contrast studs. Ours is mint with high-contrast, figure-sized pucks next to an empty road. Set-7 judges already wrote "oversized studs" on this pair.
   - **Cause not established.** Three runtime previews did not change the picture:
     - stud shadows off: no change (`shots\terrain\c6lawncrit-diag1\B-noshadow.png`);
     - side-wall normals lifted to y = 0.8 and receiveShadow off: no visible change (`shots\terrain\c6lawncrit-fix1\F1-lift-norecv.png`);
     - ground and stud clearcoat 0 with env intensity 0.15, then 0: near-box luminance 174.9 → 175.3 (`shots\terrain\c6lawncrit-sheen1\`).
     - So it is neither stud self-shadow nor plate sky sheen. My best remaining reading is noon sun-to-ambient contrast on a saturated albedo, which is owned by environment, not terrain. I cannot rule out that my runtime tweaks failed to reach the rendered material.
   - **Only lever that moved anything:** half-height studs. The far-strip dark fraction went 12.0% → 8.9% (`F2-lift-half.png`); the dots are smaller but still dark.
   - **Candidate fixes inside `src/terrain`, all lawn-mode only, none validated:**
     - (a) Relief-only studs in lawn mode: hide the two instanced meshes and let the shader relief run at all distances. Relief has no walls, so there is nothing dark to see. This is my first choice; it needs a look at 01 and 04, where the 3D studs currently help.
     - (b) Lower studs (0.17 → about 0.08) plus a lighter wall colour through a per-vertex colour on the stud geometry.
     - (c) Drop density further for flat fields.
   - **Acceptance:** 05 far strip (1300,610,300x30) dark ≤ 8%, and stud-wall green ≥ 0.5x the plate's green in sRGB (now about 70 vs 203).

2. **`lawn=0` batch repeat noise is about 30x the figure the loop assumes (MEDIUM, harness and traffic, not terrain).**
   - **Where:** `shots\game\c6lawncrit0\diff-c6d2.json`, `scratchpad\crit\cmp-closeup12.png`.
   - **What:** 0.0293 mean and 0.0847 worst, from vehicles a few pixels off between sessions; the builder's 0.0020 was a lucky pairing with `c6d2`.
   - **Why it hurts:** a blind A/B of `lawn=0` vs `lawn=1` frames from different boots will also differ in vehicle positions, a small confound on 03 and 05.
   - **Fix:** capture both panel sides in the same session order, or accept and disclose.

3. **03 near fields keep sparse white glints (LOW-MEDIUM).**
   - **Where:** `scratchpad\crit\c03.png` (left `lawn=1`, right `lawn=0`).
   - **What:** the regular grid moiré is gone, which is a real gain, but single studs catch the low sun as scattered white specks that read as litter; hp/L is 0.136, the highest of the `lawn=1` boxes.
   - **Fix:** fix (a) above removes them; otherwise clamp the relief's specular at a distance.

4. **`lawn=2` fails the design's own falsifier.**
   - 01 box at (1770,575): 0.155 / 16.5%. 05 far strip: 0.179 / 20.5%. Bound is 0.15 / 12%.
   - It doubles the dots in 05 (`shots\beauty\c6lawn2-s1\05-avenue-noon.png`). Do not send it to the panel.

5. **`lawn=3` reads as a flat untextured plane with dots.**
   - **Where:** `scratchpad\crit\cmp04-0123.png`, bottom right; `shots\beauty\c6lawn3-s1\05-avenue-noon.png`.
   - The tile seams are what carry the craft. Do not send it.

6. **Cosmetic (LOW).**
   - Plate-colour boundaries cut straight through tiles (the light/dark vertical edge in `cmp-fade.png`).
   - Terrain tiles (0.8–1.6 m) sit next to 0.4 m deck tiles in 04, bottom right.
   - The stud instance tone never fades with distance while the shader tone does (code read, `studs.js` `_rebuild`); not visible in any frame I looked at.

## Metric prediction

### (a) Lawn panel: `lawn=0` vs `lawn=1`, as the code stands

| frame | pick | why (pixels) |
|---|---|---|
| 01 house | `lawn=1`, 3/3 | the background lots behind the road go from a dark stud carpet to flat tiled green; the house and garden are unchanged, so the subject separates better |
| 02 park | coin flip, lean `lawn=1` 2/3 | only the top-left and right-edge corners differ; the plaza is all set-piece deck |
| 03 skyline | `lawn=1`, 2/3 | grid moiré in the sunlit fields is gone; risk is the white glints |
| 04 farm | `lawn=1`, 3/3 | the surrounding lawn and background lots show seamed tiles instead of a stud grid (`cmp04-0123.png`) |
| 05 avenue | **`lawn=0`, 2/3** | the dense dark-green grid reads as a brick baseplate; `lawn=1` is a bright mint plane with scattered dark pucks. If issue 1 is fixed, I flip this to `lawn=1` 2/3 |

Overall: `lawn=1` wins the panel 4/5 frames as is.

### (b) Set 8 vs `docs/reference`, lawn on

| pair | reference's deciding advantage (set 7) | prediction | evidence |
|---|---|---|---|
| 01 house | house craft, plus "stud-grid lots to the horizon", "empty green baseplate lots" | **narrows**: the stud-grid reason disappears; "empty lots" may persist. No vote flips on the lawn alone | `shots\beauty\c6lawncrit1-s1\01-house-golden.png`, box (1480,615): 0.344/44.9% → 0.063/3.7% |
| 02 park | printed figures, textured ramps, loose pieces | **no change** | 02 frames are the same picture in the plaza |
| 03 skyline | balloon, bridge, signs, "empty green lots", glare | **no change**: the lots are still empty, now smoother | `c03.png` |
| 04 farm | richer farm content, "bare baseplates", "bare stud lots behind" | **narrows**: "stud lots" wording should go; "bare lots" may remain | `shots\beauty\c6lawncrit1-s1\04-farm-golden.png`, box (20,520): 0.170/19.1% → 0.055/1.6% |
| 05 avenue | signage, cafés, "ground-level empty road, oversized studs, repeated towers" | **no change**, with a risk of **worse**: the "oversized studs" are mostly the roads module's sidewalk rows, which are untouched, and the field adds a possible new reason (washed-out lawn with dark dots) | `shots\beauty\c6lawncrit1-s1\05-avenue-noon.png` |

Set 8 expectation: 0/5 votes moved by the lawn; reason-class change on 01 and 04.

## What works

1. **The revert path is real.** `lawn=0` reproduces the pre-lawn ground: 01 has meanAbs 0, and every other difference I localised is a moving vehicle. The CPU keep rule matches the design text and the mode-1 golden.
2. **01 and 04 are clearly better.** Seamed, toned tiles with a few studs replace the stud carpet in every background lot, at zero extra draws, +1 texture, and no measurable gpuMs or boot cost.
3. **Shimmer went down, not up.** The yaw-nudge test the builder skipped shows `lawn=1` at a quarter to a tenth of `lawn=0`'s low-frequency change in 05 and lower in the 03 near field.

## Unmeasured at the time box

- check-atmosphere, check-beauty, check-civics
- `nosp=1` + `lawn=0` census and batch
- goldens and game batches for modes 2 and 3
- pan flicker in the 130–170 m band
- the shader mask under a standing building
- the init-log suffix
- my own capture with a road tool active (I looked only at the builder's `shots\background\c6lawn1\zone-r-closeup.png`, where the zone plates read clearly)
- seed 2 (seed 23 was captured for `lawn=1`; I looked at its 01 and 05)
