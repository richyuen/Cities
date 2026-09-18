# environment — critic review, round 4 (FINAL)

**Score: 8.0 / 10 — FAIL** (pass needs ≥ 8.5). This is the hard-capped final round; no round 5 follows.

## Headline verdict
The builder was asked to fix round 3's top issue — the showcase terrain reading as a circular "crater" with visible
concentric ring-banding from pulled-back/aerial views — and **they genuinely did.** The rebuild from a polar
ring+segment mesh to a graded Cartesian (x, z) grid, with height sampled from Cartesian-domain noise (never a
function of radius), angular-jittered near falloff, and a Cartesian domain-warp on the far falloff, removes the
literal geometric artifact. I re-tested this independently at altitudes and positions the builder never shot
(1500 m dead-centre, 1200 m off-centre by 900 m in two different directions, plus four pullback azimuths — E/W/SW/NW
— the builder didn't use) and found **zero concentric banding in any of them**. That is a real, substantiated fix,
not a re-hidden version of the same defect.

What did *not* get fixed, and what the builder is honest about in their own notes: the terrain still reads as a
small oasis sitting in the middle of an amphitheatre of hills — every one of six independently-checked azimuths
(builder's NE/S + my E/W/SW/NW) shows a mountain ridge rising to a similar height at a similar distance in every
direction. That's a direct consequence of the height field still being fundamentally a radial falloff (jittered and
domain-warped, but still gated by distance-from-origin), so "basin surrounded on all sides" persists as a *character*
of the terrain even with the *artifact* gone. Round 3's other named issue — a flat, gradientless "sea" filling the
lower half of grazing/low-camera shots — is measurably softer (the flat near-zone shrank from r=170–380 to a
jittered r≈160–260) but is not gone: it is still clearly visible in the module's own `environment:sky` preset at
every tod, and I reproduced it independently at a different azimuth and distance (2000 m targets, camera safely
inside the flat skirt) than the builder's own re-check.

Because this is the final round, the practical calibration matters: this terrain mesh is **`environment`'s own
self-contained lighting test rig** (`showcase.js`'s own comment: "exists only so the environment module's lighting
can be judged"), not the real game's ground — `terrain` owns the shipped heightfield. So the residual basin/sea
character does not leak into other modules' showcases or the shipped city; it only affects how *this* showcase
looks when judged on its own terms, which is exactly what this review scores. Weighed that way: the single most
damaging, "obviously broken" defect (procedural ring-banding, unmistakable from any aerial shot) is authentically
gone; the softer, harder-to-fully-solve "does it read as natural landscape" question is improved but still an honest
no. That's real progress from 7.7, not enough to clear 8.5.

## Verification of this round's mandate: is the ring-banding genuinely gone?
**Yes**, checked from angles/altitudes the builder did not use:
- `shots/environment/r4c-custom/topdown-1500m-centered.png` — steep top-down at 1500 m (builder used 1000 m,
  `r4-custom/aerial-topdown-1000m.png`). Same mottled, non-repeating noise texture, no rings, no radial banding.
- `shots/environment/r4c-custom/topdown-1200m-offcenter-E.png` and `-offcenter-SW.png` — top-down at 1200 m, camera
  and target both offset 900–1000 m off the plate's centre (never done by the builder — their only top-down was
  centred). No concentric structure visible; texture reads as irregular noise all the way to the mesh's own edge.
- `shots/environment/r4c-custom/pullback-1000m-E-noon.png`, `-W-noon.png`, `-SW-dawn.png`, `-NW-golden.png` — four
  azimuths at the builder's own 1000 m pullback distance that they didn't shoot (they had NE and S only). All four
  show the same style of irregular, non-repeating ridge silhouette as the builder's NE/S shots — consistent, not a
  coincidence of the two directions the builder happened to pick.
- The builder's own new evidence (`r4-custom/aerial-topdown-1000m.png`) independently confirms the same: a diamond-
  shaped Cartesian facet pattern, not rings.

Conclusion: the round's specific ask is met. This is a genuine, verified fix, not cosmetic reshuffling.

## Does the terrain read as natural rather than basin-like?
**No, not fully** — this is the honest gap. Every pullback shot from every azimuth tested (6 total across both
rounds' custom batches) shows the same gestalt: a small green plate, a mid-distance dark "moat" of gently rolling
ground, then a wall of green mountains rising to a broadly similar height at a broadly similar distance, wrapping
the plate on all sides (`r4-custom/pullback-1000m-NE-golden.png`, `pullback-1000m-S-dawn.png`,
`r4c-custom/pullback-1000m-E-noon.png`, `-W-noon.png`, `-SW-dawn.png`, `-NW-golden.png`). The regional ridged mask
(`showcase.js`'s `regional` term) does vary hill height by direction in principle, but not enough at the pullback
distances actually used to break the "walled-in" read — a real landscape has some low horizons and some high ones;
this one is uniformly enclosing. The builder's own writeup acknowledges this ("basin surrounded on all sides…
bounded by the small showcase plate's design") rather than claiming it's fixed, which matches what I found.

Secondary, unaddressed since round 3: **terrain silhouette is still visibly low-poly/faceted** (sharp shark-tooth
ridge lines) at every distance and tod — visible in every pullback and grazing shot this round, unchanged in
character from r3's ranked issue #3. No normal-smoothing or extra near-camera tessellation was added this round.

## Verification of the "flat sea" grazing issue (r3's original top issue)
**Softer, not fixed.** The near falloff now starts at r≈160–260 (jittered) instead of r=170–380, and the builder
added a small always-on "micro" texture inside the flat skirt so a dead-flat normal isn't feeding the fog — both
real, sensible changes. But the perceptual defect the r3 review actually cared about — does a grazing view down the
near-ground read as flat/gradientless "sea" before real relief appears — is still present:
- Module's own `environment:sky` preset (deliberately low camera), every tod: `r4-dev/environment_sky-6h5.png`
  through `-21h5.png` — a near-solid, only-faintly-graded dark-teal/green fill still occupies roughly the lower half
  of the frame under the ridge line.
- My independent re-check at a different azimuth/distance than the builder's own graze shots:
  `r4c-custom/graze-2000m-E.png` and `-graze-2000m-W.png` (camera kept safely inside the flat skirt at r=140,
  aimed at 2000 m targets — twice the builder's own re-test distance) shows the identical symptom.
- The builder's own `r4-custom/graze-1000m-N.png`, `graze-600m-N.png`, `graze-300m-*.png` show the same thing, so
  this isn't a shot-selection artifact on my part either.
- It is essentially invisible in the `environment:default` and `environment:closeup` presets (moderate/close camera
  height), which is the good news: the presets most representative of how this environment is actually seen (behind
  another module's showcase, or in the module's own non-`sky` presets) mostly avoid it. It's concentrated in the
  `sky` preset and in adversarial low/grazing custom cameras.

## Whole-module verdict across all 4 rounds (against `docs/REFERENCE.md`)
Judging `environment` fresh, as the module every other showcase depends on for its lighting/sky/shadow/fog/exposure
contract (not for this terrain mesh specifically, which is showcase-only):
- **Sun/sky/exposure (ref. criterion 3)** — strong across all 4 rounds. Correct sun/shadow direction, ACES via the
  composer, golden-hour warmth with long shadows, bright short-shadow noon, deep-blue night with visible stars
  (`r4c/environment_sky-21h5.png`-style shots each round). No regressions found this round.
- **Weather (ref. criterion 4)** — rain (streaks + wet ground sheen + puddle reflection: `r4c-rain/
  environment_default-18.png`), fog (heavy near-white wash that genuinely hides distance:
  `r4c-fog/environment_default-12.png`), overcast (soft uniform grey deck, no hard shadows:
  `r4c-overcast/environment_default-6h5.png`) all remain visually distinct and correct this round, unchanged from
  r2/r3's verified state.
- **Moon under cloud (r2 issue, r3 fix)** — held up; no regression observed this round (not re-swept exhaustively
  since r3 already verified the full 0→0.85 cloud sweep and nothing in this round touches that code path).
- **Sky/ground reflection "patch" (r2 issue, r3 fix)** — held up in this round's closeup shots
  (`r4-dev/environment_closeup-*.png` show smooth, continuous plastic reflections, no hard rectangular boundary).
- **Terrain (r2/r3/r4 issue)** — this round's real, substantiated win is killing the literal ring-banding artifact.
  The deeper "does the showcase terrain read as a natural landscape" question is still an honest no, for the third
  round in a row in some form (r2: flat-disc/ring seam; r3: sea-under-fog + new ring-banding; r4: sea-under-fog
  survives + ring-banding gone but basin/amphitheatre character remains). Given this is a self-contained lighting
  test rig rather than shipped terrain, this weighs as a real but *bounded* deduction against an otherwise strong
  module, not a module-wide failure.
- **Code/API/perf** — clean across all 4 rounds. No `Math.random` (grep clean this round too), folder holds only
  its 7 files, `dispose()` behaviour unchanged and correct, `id`/`deps`/`order`/`init`/`update`/`dispose`/`showcase`/
  `showcaseVariants`/presets/`api` all present and match `ARCHITECTURE.md`.

## Numbers
| | value | budget / note |
|---|---|---|
| console errors | **0** across every batch (`r4c`, `r4c-rain`, `r4c-fog`, `r4c-overcast`, `r4c-custom`, plus builder's own `r4-dev/-rain/-fog/-overcast/-custom`) | pass |
| gpuMs | 4.33–8.27 ms across my preset batches (12 shots × 4 variants); builder's own batches 3.94–7.15 ms; custom shots all well under 15 ms | ≤ 20 ms budget, comfortable margin, pass |
| fps | 119.1–126.7 (vsync/GPU-bound, per-instructions treated as secondary to gpuMs) | pass |
| draw calls | 46–54 across all preset batches (composer/effects fixed overhead + environment's own sky/nightDome/stars/rain draws, consistent with r3's accounting) | within budget, pass |
| Math.random | none (grep clean) | pass |
| folder | only its 7 files (`csmPatch.js, index.js, nightSky.js, rain.js, showcase.js, sky.js, skyMath.js`) | pass |
| API | `id`, `deps: []`, `order 15`, init/update/dispose/showcase, `showcaseVariants` ×4, presets ×3, `api` {setupMaterial, refreshMaterials, setWeather, state, sunDirection, shadowMode, csm, sky, refreshShadowParams} all present, unchanged since r3, matches ARCHITECTURE.md | pass |

Shots reviewed (every PNG opened): builder's `r4-dev/` (12), `r4-rain/`, `r4-fog/`, `r4-overcast/` (6 each), `r4-
custom/` (9, incl. `aerial-topdown-1000m.png`); mine: `r4c/` (12), `r4c-rain/`, `r4c-fog/`, `r4c-overcast/` (12
each), `r4c-custom/` (9: two centred/off-centre top-downs at 1200–1500 m, four 1000 m-pullback azimuths not used by
the builder, two 2000 m grazing shots at a different azimuth/distance than the builder's own re-check).

## Ranked issues (most damaging first — for the record, since there is no round 5)
1. **Terrain still reads as a "basin surrounded on all sides" from any pulled-back/aerial vantage**, even with the
   literal ring-banding gone. Confirmed at 6 independent azimuths across builder + critic custom shots. Root cause:
   the far falloff's amplitude is still gated primarily by (warped) distance-from-origin, so every direction
   eventually reaches similar height — true directional variation (some horizons staying low, gaps between ridges)
   would need the regional mask to actually suppress amplitude in some directions at the *pullback* distances
   people actually view from, not just add peaks-with-gaps at the noise's own wavelength.
2. **Flat "sea" near-zone under grazing/low cameras persists**, softened but not solved — worst in the module's own
   `environment:sky` preset at every tod, reproducible at a different azimuth/distance than either round's own
   re-checks. Root cause unchanged from r3: `FogExp2` saturates a still-fairly-flat near ramp before real relief
   appears. Fix options carried over from r3 unchanged: start relief even closer in, or make fog density depend on
   ray grazing angle/height rather than pure distance so a near-horizontal ray over flat ground doesn't saturate as
   fast as it currently does.
3. **Terrain silhouette still low-poly/faceted** (unaddressed this round, same as r3's ranked issue #3) — visible at
   every distance/tod in every pullback and grazing shot.
4. Far-cascade quality at real city-overview distances still not conclusively verified (unchanged since r1/r2/r3 —
   the showcase's own brick stacks are too small/sparse to stress cascade-3 texel density like a dense downtown
   would; flag for whoever eventually reviews `buildings` at the real `overview` preset).
5. PMREM regen cadence unaddressed (carried since r1, low priority, never re-verified as visible).

## What already works (final-round summary across the whole module)
- **Ring-banding is genuinely fixed** — the round's actual mandate — verified independently at altitudes/positions
  the builder never shot, with zero banding found anywhere.
- Sun/sky/exposure, CSM shadow cleanliness at close range, and weather identity (rain/wet-sheen, fog, overcast) have
  been strong and stable across all 4 rounds, with zero console errors and a Math.random-free codebase throughout.
- Moon-under-cloud dimming and the sky-reflection "patch" fix (both landed in r3) show no regression this round.
- Perf has comfortable headroom in every round (max gpuMs 8.27 ms vs a 20 ms budget) — never close to the cap.

## Final call
**FAIL at 8.0/10.** The gap to 8.5 is specific and has been consistent in kind (if not exact form) for three
rounds: the showcase terrain's *shape* — a small green island uniformly ringed by hills/mountains at similar
distance in every direction, with a flat, fog-saturated near-zone under low cameras and a visibly faceted low-poly
silhouette — still doesn't read as a naturally-formed landscape once a viewer pulls back or grazes the horizon, even
though this round did genuinely kill the most embarrassing symptom of that (the literal concentric-ring geometry).
Because this terrain is `environment`'s own self-contained lighting test rig rather than the shipped city's ground,
this gap doesn't propagate to other modules or to the real game, which is why the module still lands close to (not
far below) the passing bar rather than failing badly. If there were a round 5, the fix would need to attack the
terrain's *amplitude* directionally (make the regional mask actually suppress height in some sectors at real
pullback distances, not just add local peaks/gaps), soften fog specifically for grazing rays, and add a
normal-smoothing or near-camera tessellation pass for the silhouette — none of which happened this round, so the
remaining gap is exactly what round 3 already named, just meaningfully smaller.
