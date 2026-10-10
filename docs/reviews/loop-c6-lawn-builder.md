<!-- Saved verbatim by the orchestrator, 2026-10-09. UNVERIFIED: no critic has run on this work (the owner stopped the loop before E3). -->

## LOOP c6 terrain lawn (lever A2): builder report

**Code state.** `src/terrain/` was patched once, before the first capture, and not touched afterwards. Every number below comes from that final code. No fade threshold was tuned; the design's first guesses stand (0.12/0.40 seams, 0.20/0.60 tone). Nothing is committed. No `docs/core-requests/terrain-c6-lawn.md` was needed. Your `src/roads/index.js` edit 5 works unchanged with `api.studKeep`.

### What changed per file
- **`src/terrain/lawn.js` (new):** the design's keep-rule text verbatim, plus `LAWN_DEFAULT = 1`, FNV-1a and `createLawn(mode)` returning `{ mode, name, tone, seamDark, seamHalf, pattern, fnv, studs, keep, toneAt }`. `seamDark` and `seamHalf` are two fields beyond the design's list; they feed the uniforms.
- **`src/terrain/shaders.js`:** `patchGroundMaterial(mat, uniforms, lawn = null)`. With `lawn` null the v2 body, strings and key `terrain-ground-v2` are untouched. Otherwise a separate function carries the design's v3 GLSL with key `terrain-ground-v3-lawn`. New `makeLawnTexture(pattern, n)`. The GLSL compiled as written.
- **`src/terrain/studs.js`:** `lawn` constructor option; keep test before the four `topAt` calls; `rec.tone`; tone factor applied through a scratch colour (the shared palette colours are not mutated). Without lawn, loop order and buffers are unchanged.
- **`src/terrain/index.js`:** flag parsing per the design; `uLawnTex`/`uLawn` uniforms only when lawn is on; `building:spawned`/`building:removed` subscription only when lawn is on; `api.studKeep`, `api.lawn()`; init-log suffix; texture dispose.

### Acceptance

| | Result | Command | Output |
|---|---|---|---|
| (a) `lawn=0` shot-list vs c6d2-s1 | **Met.** Mean 0.0033; per frame 0 / 0 / 0.0065 / 0.0101 / 0.0001 (all ≤ 0.03) | `shot-list.mjs --out shots/beauty/c6lawn0-s1 --seed 1 --param lawn=0`, then `diff.mjs` | `shots/beauty/c6lawn0-s1/diff-c6d2.json` |
| (a) `lawn=0` game batch vs c6d2 | **Met.** 0/20 over 0.30; mean 0.0020; worst street-18 at 0.0086 (single run) | `critic.mjs --game --round 64 --dir shots/game/c6lawn0 --param lawn=0`, then `diff.mjs` | `shots/game/c6lawn0/diff-c6d2.json` |
| (b) goldens | **Met.** Modes 1 and 3: 45ffee02 / 5,624. Mode 2: db8ae529 / 10,501. Two fresh boots each (seeds 1 and 2) | scratch `goldens.mjs` | `shots/terrain/c6lawn-goldens.json` |
| (c) shot-lists lawn 1 / 2 / 3 | **Met.** Errors 0 on all 15 frames | `shot-list.mjs --out shots/beauty/c6lawnN-s1 --seed 1 [--param lawn=N]` | `shots/beauty/c6lawn1-s1`, `c6lawn2-s1`, `c6lawn3-s1` |
| (c) default game batch | **Met.** `errors []`; draws identical on 20/20 shots; max gpuMs 7.09; min fps 135.5; mean gpuMs change vs the lawn=0 batch −0.060 ms | `critic.mjs --game --round 64 --dir shots/game/c6lawn1` | `shots/game/c6lawn1/summary.json`, `diff-c6lawn0.json` |
| (d) CPU/GPU agreement | **Met.** In a 10x10-cell box, mode 1: 9 real instances = 9 `studKeep` hits, same lattice keys; mode 2: 21 = 21. The far capture has 0 instances (relief only) | scratch `topdown.mjs` | `shots/terrain/c6lawn1-topdown/`, `c6lawn2-topdown/` (near.png, far.png, result.json) |
| (e) PNGs looked at | See below | | |
| (e) check-background | **Met.** 4/4; 0 plate rays with no tool, 216 with `zone:r` | `check-background.mjs --out shots/background/c6lawn1` | `shots/background/c6lawn1/summary.json` |
| (f) check-detail | **Met.** 46/46; nosp census e0f35033 == e0f35033 | `check-detail.mjs` | `shots/props/c2/summary.json` |
| (f) check-atmosphere | **Met.** 22/22 | `check-atmosphere.mjs` | `shots/atmosphere/b3/summary.json` |
| (f) check-beauty | **Met.** 37/37 | `check-beauty.mjs --out shots/beauty/c6lawn1-beauty` | `shots/beauty/c6lawn1-beauty/summary.json` |
| (g) texture metric | **Met on all four 01/04 boxes.** The 05 far strip sits exactly at the dark bound (12.0%) | scratch `metric.mjs` | table below |

**Perf detail for (c).** Per-shot gpuMs change is mixed-sign: mean −0.060, max +0.38 (closeup-6h5), min −0.70 (street-21h5). The lawn=0 batch carried its own spikes (street-21h5 at 7.79 ms, fps 124), so I read the spread as machine noise. Texture count goes 38 → 39. Stud instances at the top-down near view: 7,263 (mode 1) and 13,567 (mode 2), so the 40,000 budget no longer binds there.

**Other facts from the golden boots.**
- Flag absent and `lawn=7` both resolve to sparse12.
- `lawn=0` gives `api.lawn()` = `{mode: 0}`, `studKeep` → true, cache key `terrain-ground-v2|csm`.
- Lawn modes give key `terrain-ground-v3-lawn|csm`, so the CSM wrap is kept.
- Building-mask refresh: real studs on a 2x2 footprint go 32 → 0 after `addBuilding` → 32 after `removeBuilding`, errors `[]`.

### (g) Texture metric (hp/L, dark)

| Box (x, y, wxh) | lawn=0 | lawn=1 |
|---|---|---|
| 01 at 1480, 615, 105x60 | 0.344, 44.9% | 0.063, 3.7% |
| 01 at 1770, 575, 130x35 | 0.493, 54.6% | 0.095, 8.0% |
| 04 at 1560, 960, 340x110 | 0.073, 4.6% | 0.048, 1.4% |
| 04 at 20, 520, 150x110 | 0.170, 19.1% | 0.055, 1.6% |
| 05 at 1500, 720, 380x280 (design box) | 0.222, 24.3% | 0.040, 1.3% |
| 05 at 1300, 610, 300x30 (design box) | 0.295, 36.2% | 0.127, 12.0% |
| 03 at 640, 720, 240x60 (design box) | 0.226, 23.0% | 0.136, 8.8% |

- The 01 and 04 boxes are re-picked pure terrain ground, so the lawn=0 values do not reproduce the design table. The design's 01/04 boxes were chosen on c6h5, which had a different composition.
- The 01 foreground lawn is the demo set-piece deck (0.4 m tiles). It is the same picture in both modes and is excluded.
- Mean luminance rises a lot where dense studs used to shade the plate: the 05 near box goes 112.4 → 174.9 and the first 01 box 72.1 → 103.4. The design's "within about 3%" prediction was for far ground; near fields move far more.

### PNGs I looked at
- **lawn 1, 01-house-golden:** background lots beyond the road are flat tiled green with a few studs, where lawn=0 had a full stud carpet. Foreground deck unchanged.
- **lawn 1, 03-skyline-golden:** the lawn=0 crop shows a regular grid moiré across the sunlit fields. In lawn=1 it is gone, leaving sparse bright glints from single studs in the low sun. No band.
- **lawn 1, 04-farm-golden:** lawn around the farm and the background lots show 0.8–1.6 m tiles with thin dark seams, tone variation and sparse studs. Terrain tiles are visibly coarser than the deck's 0.4 m tiles (design risk 12).
- **lawn 1, 05-avenue-noon:** the field beside the kerb is sparse right up to the kerb, so there is no dense hem. The dense grey stud row is the sidewalk's own (roads module, unchanged). Seams are faint at this grazing angle.
- **lawn 2, 01 and 04:** same as lawn 1 with roughly twice the studs.
- **lawn 3, 01 and 04:** flat untiled green with sparse studs; background lots read as plain colour.
- **Top-down near and far (mode 1):** real studs (near) and relief studs (far) sit on the same tiles, e.g. the vertical pair near centre and the two horizontal pairs lower-left. Seams and tones coincide.
- **Terrain showcases (`shots/terrain/c6lawn1-{default,closeup,water}.png`):** errors `[]`. Water: no seams on the seabed or under water; the beach gets tiles and sparse tan studs. Closeup: sparse studs, seams fade with distance.
- **830 m overview:** lawn 0, 1 and 3 are pixel-identical (meanAbs 0, maxDelta 0). The concentric moiré arcs on the far plain are therefore in the lawn=0 path too and not caused by this change.
- **Zone tool (`shots/background/c6lawn1/zone-r-aerial.png`, `zone-r-closeup.png`):** with Homes selected the blue/green/yellow zoning plates are clearly readable over the tiled ground in the aerial; errors `[]`.
- **Game batch:** closeup-12 and overview-12 look as expected.

### Known gaps and things I would flag before shipping
1. **Studs read as dark dots at noon grazing views.** In 05, closeup-12 and terrain closeup, the stud side walls are much darker than the pale, sky-reflecting plate. Top-down the stud tops match the plate. The lawn=0 crop of 05 shows the same dark studs, but a full grid hid the plate; sparse, it reads as dark polka dots on mint. I would have a judge look at 05 before shipping. I did not try a fix.
2. **Near fields get much brighter** (luminance figures above). This is a visible change of look, not only of texture.
3. **Terrain tiles are twice as coarse as set-piece deck tiles**, side by side in 01 and 04.
4. **03 keeps sparse sun glints** from single studs: hp/L 0.136, under the bound but the highest of the lawn=1 boxes.

### Unverified
- The init log suffix `lawn=1:sparse12 fnv=…` was not observed; `stats()` exposes no log lines.
- Design risk 4 (fade-band flicker while panning at 130–170 m) and risk 7 (0.05° yaw-nudge shimmer comparison) were not run. No-moiré evidence is still frames only.
- The building-mask refresh was checked through real stud instances only, not by reading the shader mask texture.
- lawn 2 and 3 have no game batch and no check-tool runs, only shot-lists; mode 2 also has the top-down pair.
- Seeds other than 1 were not captured for lawn 1, apart from the golden boots on seed 2 and whatever seeds check-beauty runs.
- `date` reported only about 17 minutes of wall time for the whole session, which seems too short for the batches run. I did not investigate; timestamps in the capture JSONs are authoritative.

Scratch scripts (`gold.mjs`, `goldens.mjs`, `topdown.mjs`, `metric.mjs`, `zone.mjs`, `patch1.mjs`) and logs are in `C:\Users\ryuen\AppData\Local\Temp\claude\C--Git-Cities\ac5f4a89-9f27-4edc-becd-51e343f136f0\scratchpad\lawn\`.
