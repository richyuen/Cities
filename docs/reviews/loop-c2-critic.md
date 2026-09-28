# LOOP cycle 2 — hostile verification (props diorama detail layer)

Critic: fresh subagent, round 2. Scope: `src/props/*` (+`tools/check-detail.mjs`) uncommitted on top of `63527ad`.
All numbers below are from my own runs; `gpuMs` is the perf truth. Scratch evidence (mine): `C:\Users\ryuen\AppData\Local\Temp\opencode\c2v\` (`probe.json`, `probe2..12.json`, `floater*.png`, `heat-*.png`, `boot.json`). No source/tools/docs were edited except this file; the dev server (5173) was never touched; one headless browser per batch, `nvidia-smi` before each.

## Score: 7.0 / 10 — PASS (with follow-ups)

The L2 lever is materially delivered: yards, civic entrances and sidewalks now carry deterministic, budgeted micro-dressing, and the only C2 defect class that reaches the hero framings is two levitating pedestrians (rare, fixable). Fail = no: check-detail is green, all perf budgets pass, errors 0, ownership respected. But it is a 7, not an 8-plus: the flagship `default`/`park`/`night` props batches contain **zero** visible cycle-2 content (they are pixel-identical to pre-C2), the night street framing is still asphalt-dominated, and the full-game diff is not purely "new dressing" (see issue 2).

## Measured table (my runs)

| item | measurement | gate | verdict |
|---|---|---|---|
| `node tools/check-detail.mjs` | **23/23**, census hash `bd44681e` (twice), errors 0, 441 buildings / 4688 props | green | pass |
| props r6 default (`--variant default`) | minFps 143.6, maxGpuMs 6.81, maxDraws **198**, errors 0 | ≤300 draws, ≤20 ms, ≥50 fps | pass |
| props r6 park | 143.7 / 5.73 / **107** / 0 | idem | pass |
| props r6 night | 143.7 / 6.80 / **198** / 0 | idem | pass |
| props r6 yards | 143.9 / 6.81 / **384**, errors 0; props' own share **38**, scene 379–384 | 300 (batch) | **exceeds the named figure; module-own 38 ≤300** |
| game r39 | minFps **94.5**, maxGpuMs **10.24**, maxDraws **921**, errors 0 | ≤1500 / ≤20 ms / ≥50 fps | pass |
| full-game census (mine) | 4688 props / 1753 C2; 398 figures (cap 900); 1355 yard props; 441/441 dressed; props draws **61**; scene 828; `detailMs` 789.2/796.2 ms | module 300 | pass |
| boot (`shot.mjs --preset skyline --tod 12`) | readyMs **13115** vs r37 11724 = **+11.9%**; r39 `skyline-12` 13432 = **+14.6%** | ≤ ~15% | pass, marginal |
| diff r6 default vs r4b | meanAbs **0.0032** (pixel-identical, drift-level) | attribute changes | C2 invisible in this batch |
| diff r6 night vs r4b | **0.0031** | idem | idem |
| diff r6 park vs r4b | 25.18 — **invalid comparison** (r4b is the *default*-variant staging; its `props:park` frames the street, r6-park frames a real park) | idem | flagged, see issue 5 |
| diff r6-park vs `final-park` (only pre-C2 park capture, tod 12) | 1.09 total; sky band 2.29 / mid 0.34 / ground 0.24; heatmap = 2 new figure silhouettes + edge AA | idem | only the figure knot added (code + census + image agree) |
| diff r6-yards vs r5-yards | **0.0004** (cross-session determinism) | drift | pass |
| diff r6 vs r5 default, r6 vs r6-night | 0.0003 / 0.0005 (`night` variant = duplicate of `default` staging) | — | note |
| diff game r39 vs r37 | meanAbs 0.2941, worst `street-6h5` 0.9244 (pctOver 2.2%), `overview-6h5` 0.0121 | attribute | attributable to dressing **plus** issue 2 |
| C2 placement (all 1753 C2 props) | inside footprint **0**, on carriageway **0** (strict half-width), floating >0.6 m **4** (2 raycast-confirmed, 2 on raised sidewalks) | 0 / 0 / 0 | 2 genuine floaters → issue 1 |
| 300-prop deterministic sample | 5 inside / 3 on road / 1 float — all legacy street furniture | sample ≥300 | pass for C2 |
| legacy offenders (non-C2) | **116** under check-detail's definition; **120** under my stricter one (streetlamp 66→69, road_sign 10→11); builder's 116 verified as definition-dependent | report separately | verified |
| lifecycle: `world.removeBuilding` on a dressed apartment (b280) | 7/7 belonging props gone, 0 still in world, size delta −7, `yardProps` −7, no orphans in the lot band | no orphans | pass |
| lifecycle: street paved through a yard (b280 side yard) | 3 `fence_picket` at 1.5 m from the new centreline removed; **0** C2 props within half+0.4 m after; mechanism `road:added → onRoadAdded → sweepDetailNearEdge → onCarriageway → world.removeProp` | sweep works | pass |
| lifecycle: later building over props | 1 `crate_stack` swept from the new footprint (`sweepDetailInFootprint`) | works | pass |
| level-up house→apartment→tower (b441, buildings `rebuild`) | level 1→2→3, height 4.9→15.7→49 m, **w/d unchanged 1×1**, 4 items survive, 0 props inside footprint | props not inside | survives (trivially: level-up never grows the footprint) |
| `Math.random` in `src/props/` | none | none | pass |
| fence segment overlaps | **8 pairs** 1.22–1.88 m apart, same orientation (2 m panels) → interpenetration (≤16 of 420 panels) | — | issue 3 |
| claims check: yards showcase buildings | **36**, builder's report says 37 | — | minor claim error |

## Falsification table

| # | test | what I did | what I saw | verdict |
|---|---|---|---|---|
| a | **Determinism** | two fresh boots (fresh process + reload), own FNV over every `(id,kind,x,y,z,rot)` + by-kind + building-kind hash; `grep` for `Math.random`; r6-yards vs r5-yards pixel diff | hash `9e61d1f8` identical, totals/by-kind/figures/yardProps identical, r6-yards vs r5-yards meanAbs 0.0004, no `Math.random` | **survives** |
| b | **Cleanup/lifecycle** | full-game page: `world.removeBuilding` on a dressed lot; `world.addRoad` through a yard side band; extra `addBuilding` over a crate | 7/7 props removed / 0 orphans; 3 fences swept, 0 carriageway violations after; crate swept from the new footprint; all removals C2-only | **survives** |
| c | **Placement validity** | all 4688 props: strict building AABB, `roads.api.snapToRoad` (strict half-width and half+0.4), float vs max(`terrain.api.surfaceHeight`, roads Y); 300-prop stride sample; raycast down from each C2 floater to the actual mesh | C2: 0 inside, 0 on road; 4 float candidates → 2 confirmed floating **+1.23 m / +0.95 m above the visible sidewalk**, 2 standing on an elevated sidewalk (metric false positives); legacy 116/120; sample offenders all legacy | **refuted for "no floaters"** (2 real), placement otherwise survives |
| d | **Budget edge** | yards-variant page: `props.stats()` + `c.stats()`; game batch r39 max | yards scene 384 (props own **38**), full game props 61/300, game max 921 ≤1500, gpuMs ≤10.24 | **survives** as module budget; 384 > the batch figure the brief names (issue 4) |
| e | **Interaction (level-up)** | `b.level = 2/3` + `buildings.api.rebuild` on a dressed house | footprint stays 1×1 (level-up never changes `w/d`), dressing survives, 0 props inside | **survives** (weak test: the code path cannot grow the footprint; a future `FOOTPRINTS` use in level-up would break it) |
| f | **Existing behaviour** | r6 default/park/night vs r4b; r6-park vs `final-park` + heatmap; code diff of `populateAlongRoad`/`populateIntersectionNode`/`populatePark`; park furniture census | default/night **pixel-identical** to r4b (0.003); park delta = 2 new figures only (heatmap); streetlamp/traffic_light counts 767/242 and code paths unchanged; park furniture counts stable | **survives**, with the caveat of issue 2 (full-game variation reseed) |

## RANKED issues

1. **Two pedestrians levitate ~1 m above the sidewalk (new defect class).**
   *What/where:* full game seed 1 — `figure` at (−625.2, −97.8) is **1.23 m above the `roads-sidewalk` mesh** (y 6.66 vs sidewalk 5.43) and at (−597.4, −231.2) **0.95 m** (y 3.78 vs 2.83); raycast-verified in `probe4.json`, visible in `c2v/floater-2.png` / `c2v/floater2-side.png`. *Why:* `props.addProp` resolves Y once at placement (`resolveHeight`), and later citygen flattening/road regrading moves the surface underneath; nothing re-resolves C2 heights. 2/398 figures; the same mechanism also leaves legacy props up a few metres (not C2, pre-existing). check-detail has no height test, so it is green. *Fix:* after the last citygen/terrain phase (or on a throttled guard), re-resolve Y for C2 props whose `|p.y − resolveHeight(p.x,p.z)| > 0.5` and re-rebuild; or place pedestrians only in the final citygen phase.

2. **Full-game regression diff is not purely "new dressing": pre-existing props get reseeded.**
   *What/where:* `rebuild()` renders each prop's variation from `S.rng.fork(prop.id)`; C2 props inserted mid-citygen shift later ids, so trees/signs/flower beds change colour/shape without moving — visible as whole-tree deltas in `c2v/heat-street-12.png` and `heat-closeup-18.png`. `probe10` proves the variation is id-keyed (same id reproduces; different id swaps `tree_small` canopy colours, `road_sign` red↔yellow, `flower_bed` tan↔darkGreen). *Why it hurts:* the cycle claim "existing park/road/signal behaviour unchanged" holds for counts/positions but not appearance, and the r39↔r37 diff (0.294 meanAbs, worst 0.924) cannot be attributed to dressing alone. *Fix:* fork the per-instance variation on a stable key (kind + rounded position) instead of the sequential id, or give C2 props a separate id range.

3. **Some picket-fence segments interpenetrate.**
   *What/where:* 8 pairs of `fence_picket` at 1.22–1.88 m centre distance with near-identical rotation (worst 1.22 m, `probe11.json`; e.g. @(572.9,−371.2), (−460.6,−371.2)); each panel spans 2 m. Cause: `PLACE_SEP.fence_picket = 1.2 m` is smaller than the panel length, and `tryPlace`'s ±0.8 m retry jitter can land a replacement segment inside its neighbour. *Why it hurts:* those 8 pairs (≤16 of 420 panels) read as doubled/crossed rails at close range. *Fix:* enforce ≥2.0 m between two fence props (or treat a placed fence as a segment in the placer) and/or snap retries back to the run lattice.

4. **`yards` batch is 384 draws against the 300 figure the brief names.**
   *What/where:* `shots/props/r6-yards` max scene draws 384; props' own share 38, the rest is `buildings` (CSM ×4 on its chunk) + scene. Full game is 61/300 and every other batch is ≤198. The builder disclosed this, and the §7 budget is a full-city module budget — but the numeric gate in the brief is not met for that variant as written. *Fix:* restate the gate as the module's own draw calls (already asserted by check-detail) or drop the `buildings` dep for that variant; needs an orchestrator decision, not another silent exception.

5. **The evidence batches mostly do not show the new layer.**
   *What/where:* default/park/night are pixel-identical to pre-C2 (`props` stages no buildings and never calls `populatePedestrians` in showcase mode); `r6-night` equals `r6` (0.0005); in non-yards variants the `props:yards` preset falls back to `props:default` (0.0043 = same framing); in the yards batch 12/16 shots frame the bare origin street block (e.g. `shots/props/r6-yards/props_closeup-12.png` — a junction with no buildings, no C2). The only C2-visible evidence is the 4 `props_yards-*` shots + full-game captures. *Why it hurts:* the cycle's module-batch gate does not actually exercise its own acceptance. *Fix:* add one C2-aware preset per variant (or stage a couple of houses in `stageStreet`) and/or make `check-detail`'s captures the official batch evidence; mark preset fallbacks in `summary.json`.

6. **Boot cost is at the gate edge.**
   *What/where:* my fresh `skyline-12` readyMs 13115 vs r37 11724 (**+11.9%**); r39 captures 13432 (**+14.6%**); the builder's own pairs +8.7%/+16.7%; `detailMs` 789–796 ms synchronous inside boot. *Why it hurts:* one of the four measured pairs exceeds the ~15% gate; wall-clock readyMs is noisy but the synchronous pass is a real cost. *Fix:* time-slice/defer the detail pass as the builder already proposed; keep the first-frame-complete contract only for the visible seed area.

7. **Report claim nits.** The `yards` showcase contains **36** buildings, not 37 (`probe6.json`); "existing park/road/signal behaviour unchanged" should read "unchanged counts/positions" (issue 2); the legacy-offender figure 116 is only exact under check-detail's test (my stricter test: 120).

## What works (verified)

- Deterministic dressing: identical census on two boots, identical pixel output for the C2-heavy yards batch across two sessions (0.0004), `Math.random` absent.
- Placement hygiene: 0 C2 props inside footprints or on carriageways city-wide (1753 C2 props, strict test), 0 in the yards showcase too; 441/441 buildings dressed; 20/20 civic entrances have ≥2 cluster props + ≥1 figure (my check-detail run); idempotent `populateYard`.
- Lifecycle: building removal, late-road sweeping and late-building sweeping all remove exactly the C2 props involved, leave no orphans, and never touch other modules' furniture.
- Budgets: module draws 61/300 in the full city, 38 in the yards scene; game batch 921 ≤1500 draws, gpuMs ≤10.24 ≤20, fps ≥94.5; errors `[]` in every capture.
- Existing furniture: streetlamp/traffic_light/bench/sign counts 767/242/92/83 and the default + night batches are pixel-identical to pre-C2; the park batch differs from the last pre-C2 park frame only by the intended 2-figure knot (heatmap + census).
- Reads lived-in where it is staged: `yard-house.png` (bike/garden/fence), `civic-entrance.png` (door figures + bin), `hero-closeup-17h7.png` (two figures + bench at the hospital), `props_yards-12.png` / `props_yards-21h5.png` (fenced, gardened, lit suburb with sidewalk figures), my full-game close-up `c2v/yard-default-12.png`.

## What I did NOT verify

- A same-session pre-C2 park baseline: `r4b` contains only `variant=default` captures, so my park pre/post uses `final-park` (4 days old) + code inspection; the 1.09 residual includes sky/session drift I could not fully separate from the 2 figures.
- Re-runs of `check-beauty.mjs`, `check-atmosphere.mjs`, the other modules' batches, or the blind-judge set — not in my mandate; the beauty-source hero images (`shots/beauty/c2`) were not independently reviewed by me.
- Whether the two floaters reproduce on other seeds/cities (seed 1 only), and the exact number of legacy props that genuinely float (I only raycast-verified C2 candidates; the legacy float numbers are metric-only).
- Memory/GC behaviour of the added ~1800 instances over long sessions, and long-session HMR/staging edge cases beyond the 16-shot restages.
- That level-up can never grow a footprint in *other* code paths (I verified only the `buildings.api.rebuild` path).

Evidence: `C:\Users\ryuen\AppData\Local\Temp\opencode\c2v\` (`probe*.json`, `floater-2.png`, `floater2-side.png`, `heat-street-12.png`, `heat-closeup-18.png`, `park-diff-heat.png`, `boot.json`); repo evidence `shots/props/r6*`, `shots/game/r39`, `shots/props/c2/*`, `shots/props/r5-yards`.
