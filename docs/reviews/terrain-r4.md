# terrain — round 4 critic review (FINAL — hard cap reached)

**Score: 7.3 / 10 — FAIL** (pass needs ≥ 8.5, `errors: []`, within perf budget)

Round 4 was a no-code-change round: the builder made **zero edits to `src/terrain/`** and instead argued that round 3's
"no cast shadows" A/B test was methodologically flawed (the `tod=6.6` / `tod=17.4` pair is mirror-symmetric around
solar noon and, by construction of `src/core/clock.js`'s sun model, produces an **identical** horizontal
south/north light component at both times — only the east/west component flips). They backed this with
`shots/terrain/r4-ab/` (stud-shadow control, an east-wall pair, toggle diffs, a "FINAL" rim pair) and asked that the
issue be re-scored on that basis. I independently verified this claim rather than taking it on faith, since this is
the final round and the pass/fail call matters. Every PNG referenced below was opened and inspected directly; I also
built my own additional test (`shots/terrain/r4-critic/`, 8 shots, a script driving `tools/shot.mjs`'s `openApp`) at
a location and time pair the builder did not use.

## Numbers
| batch | minFps | maxGpuMs | maxDrawCalls | maxTriangles | errors |
|---|---|---|---|---|---|
| r4c (default/closeup/water, lit showcase, 12 shots, my own capture) | 125.3 | 6.15 | 58 | 2,788,174 | [] |
| r4c-water (water variant, lit, 12 shots) | 125.0 | 7.8 | 54 | 1,858,990 | [] |
| builder's r4-bare-* (4 bare `?bare=1` captures, re-checked) | — | — | **18** | **1,320,688** | [] |
| r3 same numbers (for comparison) | — | — | 18 | 1,320,688 | [] |

- **Console errors: 0** across every JSON this round (12 + 12 + 4 bare + 23 in `r4-ab/` + 8 in my own `r4-critic/` = 59
  captures). `modules: {terrain: "ok", ...}` throughout.
- **Triangle/draw-call budget: PASS, unchanged from r3.** Bare terrain-only: 18 draw calls, 1,320,688 triangles —
  identical to r3's numbers (expected: no source files changed). Within the 20-draw-call terrain budget.
- `Math.random`: no hits in `src/terrain/` (grep clean, re-verified). Folder still exactly its own six files
  (`data.js`, `heightgen.js`, `index.js`, `mesher.js`, `shaders.js`, `studs.js`) — unchanged from r3.
- No API/contract changes to verify since no code changed.

## The central question, re-litigated: was the r3 "no cast shadows" verdict fair, and does it matter now?

**The builder's methodology critique is correct, and I can independently confirm it.** `src/core/clock.js`'s sun
model sets `sunDir.z = sin(ang) * cosE * 0.6` where `ang` is derived from `hours`; for any two times symmetric about
solar noon (`12 - t` and `12 + t`, e.g. 6.6/17.4, 8/16, 9/15), `sin(ang)` is identical at both times, so **the
north/south light component is mathematically invariant across any mirror-time pair** — only the east/west
(`sunDir.x = cos(ang) * cosE`) component flips sign. The r3 test used a purely south-facing wall (`x=0, z≈-265`,
normal `(0,0,-1)`) with exactly such a mirror pair, so it could never have shown a difference **even if terrain
lighting were fully correct** — that's a real flaw in the r3 test, not a refutation of its concern.

**My own independent test, at a different location than any the builder used:** I probed the plateau rim's *east*
edge (`x≈258→280, z=0`, symmetric to the builder's south edge by the height field's `(x⁴+z⁴)^0.25` formula, normal
≈`(1,0,0)`) via `window.__city.world.getHeight`, then shot it from a fixed ground-level camera at `tod=8` and
`tod=16` (mirror pair, chosen per the brief's suggestion, elevation ~31° so the sun disc stays out of frame) —
`shots/terrain/r4-critic/eastwall3-8.png` vs `-16.png`. **The riser is visibly, unambiguously brighter/highlighted at
tod=8 (sun mostly +X, facing the wall) and darker/flatter at tod=16 (sun mostly −X, wall self-shadowed)** — this is
real, direction-dependent diffuse (NdotL) shading on the terrain chunk geometry itself, not a baked constant. This
independently confirms the builder's claim 1: terrain *does* respond to sun direction on walls with a real east-west
normal component; the r3 test simply couldn't see it.

**However — and this is the decisive point — this is diffuse self-shading, not a cast shadow, and it does not fix
the practical problem the round-2/3 issue was about.** I looked hard for an actual dropped/cast shadow (a hard-edged
dark band projected from the riser onto the adjacent flat tread or apron, the kind a shadow-map pass produces) in
every relevant pair:
- `shots/terrain/r4-ab/FINAL-rim-6h6.png` vs `-17h4.png`: `FINAL-diff.png` shows a **uniform, full-frame speckle
  diff over the entire stud field to the horizon** (consistent with a global exposure/tone-mapping shift between
  times of day) while the terraced steps in the middle of the frame — the one place a real shadow should show the
  *strongest* signal — are comparatively **blank/white** in the diff. That is the opposite of what a genuine moving
  cast shadow would produce.
- `shots/terrain/r4-ab/stairs-overview-6h6.png` vs `-17.4.png`: the dark rectangular ground patches in the mid-frame
  (the most shadow-like feature in either image) sit at **pixel-identical positions and sizes** in both shots —
  they do not move, elongate, or flip side with the sun, so they are baked colour/zone patches, not shadows.
- `shots/terrain/r4-ab/toggle-off.png` vs `toggle-on.png` (the actual controlled `receiveShadow` toggle on the
  `terrain:default` overview, fixed camera/time, triangle count identical so it's a clean flag flip): the diff
  (`diff-toggle.png`) is **almost nothing** — a single faint dotted line along one ridge edge, not a shadow-shaped
  region. At the closeup preset (`toggle3-off/on.png`, `diff-toggle3.png`) there is a real, shaped diff patch, so
  shadow reception does switch *something* on close-range terrain — but it's a small, localized effect near a stud,
  not the riser-onto-tread cast shadow the issue is about, and it does not show up at all at overview distance.
- `shots/terrain/r4-ab/east-wall-17h4.png` points the camera into the sun (visible disc + bloom in frame), the same
  contamination pattern the r3 review specifically flagged as unusable — `diff-east-wall.png` is dominated by that
  glare, not by the wall.
- `shots/terrain/r4-ab/stud-ground-shadow-6h6.png` **is** genuine, convincing evidence (individual studs cast sharp,
  correctly-shaped, elongated cast shadows onto the ground and each other) — but it demonstrates the CSM pipeline
  works on the small instanced stud mesh, which round 3 had already established. It says nothing new about whether
  the terrain's own large-scale terrace risers cast a legible shadow on the terrain itself.

**So: terrain lighting is less broken than r3's specific test suggested (real NdotL response exists on
non-south-facing walls), but there is still no demonstrated, legible cast shadow from one part of the terrain mesh
onto another, at any distance or angle, in any image produced this round by either the builder or myself.**

## The real rubric question: does it look flat/map-like from a realistic camera, regardless of the technical proof?

I took a fresh overview at low sun (`shots/terrain/r4-critic/overview-default-8.png` / `-17.png`, the
`terrain:default` preset — the module's own "normal" camera) and a second, more oblique, closer "play-camera style"
shot directly over the rim I tested (`playcam-rim-8.png` / `-17.png`, ~190 m out, ~55 m up).

**Yes — it still reads as flat and map-like at both distances, at both times of day.** All four images resolve
entirely through flat colour banding: grassy green, darker green zone-plot rectangles, grey rocky hill texture, blue
river with a tan bank, yellow patches. There is no shading gradient, no cast shadow, no highlight/shadow pair
distinguishing a riser from a tread anywhere in these four shots — the plateau rim and hillside terraces that read
clearly as raised ledges at 50-70 m ground level (confirmed again this round, `eastwall3-*.png`) are essentially
invisible from the height and distance a player would actually see them at. The two times of day are
barely distinguishable from each other in these overview shots — exactly the "still flat/map-like" failure mode r3
called out, now re-confirmed with a different camera and a different, non-degenerate time pair. The diffuse-lighting
fix I found only shows up at close range on a wall aimed almost square at the camera; it does not survive the
distance/angle compression of a normal play or overview camera.

## Verdict

The builder's investigation this round is genuinely good work — the mirror-time-pair flaw in the r3 A/B test is
real, correctly diagnosed, and independently reproducible (I derived and confirmed it from `clock.js`'s math, then
verified it visually at a location the builder never tested). That is worth crediting: the module is not "the
lighting pipeline is broken," it's "terrain lighting works but doesn't produce a legible shadow, and there's no cast
shadow at all." That is a meaningfully more accurate (and more actionable) diagnosis than r3 had. But **diagnosis is
not a fix**, no code changed, and the thing that actually matters for score — what the terrain looks like on screen
— is unchanged: overview and play-distance shots still read as flat, shaded-map colour bands with no legible
depth/shadow cue, which is the practical substance of the original issue, not just its (imperfect) round-3 proof.

**Final score: 7.3/10 — FAIL.** This is essentially flat versus r3's 7.4 (a hair down, reflecting three rounds now
stalled on the module's #1 issue with zero visual movement, offset by credit for a real and useful methodology
correction). Since this is the hard-capped final round, there will be no round 5 to confirm a fix — the module ships
in its current state: solid baked terrace legibility at close range, correct (if easy to miss) diffuse lighting
response on non-south-facing walls, zero errors, comfortably within budget, but **no legible cast shadow anywhere,
and overview/play-camera compositions that still read as a flat, textured map rather than sculpted 3D terrain.**

## Ranked issues (most damaging first)

1. **No legible cast shadow anywhere on terrain, at any distance, confirmed again this round with a corrected
   methodology.** (`r4-ab/FINAL-diff.png` — diff is strongest as uniform full-frame speckle, weakest exactly at the
   terraced steps; `r4-ab/stairs-overview-6h6/-17h4.png` — shadow-shaped dark patches pixel-identical between times;
   `r4-ab/toggle-off/on.png` + `diff-toggle.png` — clean `receiveShadow` A/B at overview distance shows almost no
   effect.) This is the module's #1 problem for a fourth round running, now with the added finding that it's not a
   simple "flag isn't working" bug (the toggle does something at close range) but something about riser/tread cast
   geometry, or shadow-camera cascade coverage, specifically not producing a legible dropped shadow at any distance
   tested.
2. **Overview/game-altitude and play-camera compositions still read as flat/map-like — the practical, player-facing
   form of issue #1 — reconfirmed with a fresh, independent camera and time pair.** (`r4-critic/overview-default-8/
   -17.png`, `r4-critic/playcam-rim-8/-17.png`.) This is the actual rubric failure regardless of what the shadow
   pipeline technically computes under the hood.
3. **Diffuse (NdotL) self-shading on terrain walls is real but too subtle/angle-dependent to help at normal
   distances.** (`r4-critic/eastwall3-8.png` vs `-16.png` — genuine, confirmable brightness flip at ~40 m ground
   level; invisible in the same module's own overview preset.) Worth keeping conceptually distinct from "cast
   shadow" in future rounds/backlog items — they are different features and this round's evidence should not be
   read as "shadows now work."
4. **The r3 A/B methodology gap is now closed, which is useful, but the round's evidence set includes at least two
   tests that repeat known pitfalls** — `east-wall-17h4.png` stares straight into the sun (the exact contamination
   r3 flagged as unusable), and the `FINAL-rim`/`stairs-overview` diffs read as global-exposure-dominated rather than
   localized-shadow-dominated. Future rounds should default to the toggle-based (`receiveShadow` on/off, fixed
   camera/time) test over any time-of-day A/B, since it's the only one of this round's tests that isolates the
   variable cleanly — and even it showed only a marginal, close-range-only effect.
5. **Triangle cost (+29% over r2, unchanged this round) still buys baked shading, not real shadows.** 18 draw
   calls / 1,320,688 triangles bare — comfortably within the 20-call ceiling, not a fail, but the `GROUT_MIN_DROP`/
   `treadAO` investment from r3 remains unvalidated against the feature it was meant to support.

## What already works well (reconfirmed this round)
- Zero console errors across 59 captures this round (my 24 + builder's 35), draw-call/triangle budget unchanged and
  within the ARCHITECTURE ceiling, `Math.random` clean, folder scope clean — engineering hygiene remains solid.
- Close-to-mid-range terrace legibility (BRICK2 risers + grout + tread AO) still reads well as blocky terraces
  within ~100 m, on both south- and east-facing walls (`r4-critic/eastwall3-*.png`).
- Diffuse lighting genuinely does respond to sun direction on terrain geometry with an east/west normal component —
  a real, previously-undocumented positive finding, independently reproduced at a location the builder didn't test.
- Individual studs cast correct, sharp, direction-flipping cast shadows onto the ground (`r4-ab/stud-ground-
  shadow-6h6.png`) — the CSM pipeline itself is healthy; the gap is specifically terrain-riser-onto-terrain-tread
  cast shadows, not the shadow system in general.
