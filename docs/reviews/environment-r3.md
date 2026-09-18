# environment — critic review, round 3

**Score: 7.7 / 10 — FAIL** (pass needs ≥ 8.5). The builder did a real rebuild of the round-2 top issue: the flat
2.6 km ground disc + separate hill ring is gone, replaced by one continuous ridged-noise terrain mesh (`showcase.js`,
`buildDiscGeometry` + `makeTerrainHeight`). That genuinely kills the *literal* r2 defect — there is no more hard,
razor-edged material seam at a fixed radius where a flat plate met a raised ring. But re-testing at the grazing and
oblique angles the builder's own round-3 shots mostly didn't cover shows the **same symptom the r2 fix was chasing
is still present almost everywhere**, just produced a different way: `FogExp2` on a near-horizontal view ray across
the terrain's still-fairly-flat near zone (radius ≈120–380 m, where the height ramp is only just kicking in)
saturates to a near-solid, gradientless colour long before the ray reaches any relief, so every shot with a
low/grazing camera — including the module's own `environment:sky` preset and, more softly, `environment:default` —
still reads as a flat "sea" body under a jagged ridge crest, not as rolling terrain fading into haze. On top of that,
pulling the camera back to a typical aerial/overview distance reveals a **new** problem: the tiny showcase now sits
in a near-perfectly circular "crater," with visible concentric ring-banding from the radial mesh construction
(`shots/environment/r3c-custom/pullback-300m-NE-golden.png` — the ripples are unmistakable), which reads as an
obvious procedural/repeating artifact, not natural terrain. Genuine wins this round: the moon now dims and veils
progressively under cloud instead of vanishing (verified across a full 0→0.85 cloud sweep), and the sky-reflection
"patch" edge is smoother (PMREM bumped 512→768×1024 res). Those are real, but the terrain — the thing r2 flagged as
the single most damaging issue — has not actually been fixed in substance, so the score moves only slightly.

Shots reviewed (every PNG opened): `shots/environment/r3c/` (12 preset shots), `r3c-rain/`, `r3c-fog/`,
`r3c-overcast/` (12 each), `r3c-custom/` (28: 9 near-ground grazing at 3 azimuths × 3 target distances, 6 elevated
pull-backs at 300/600/1000 m camera-to-target distance × 2 azimuths, 4 oblique-at-800m across all tods, 3 weather
panoramas, a full moon cloud-intensity sweep 0/0.2/0.4/0.6/0.85, glass-brick closeups ×2, shadow closeups at 3 m and
300 m ×2 tods). Builder's own round-3 shots in `r3-dev/`, `r3-custom/`, `r3-rain/`, `r3-fog/`, `r3-overcast/` were
read but not overwritten, and independently reproduce the same terrain artifacts (e.g. `r3-custom/horizon-grazing-
dawn.png`, `r3-custom/shadow-300m-golden.png`). Reference: `docs/REFERENCE.md` (no `docs/reference/` images present).

Two of my early custom-shot attempts had to be discarded and redone: (1) my first grazing batch opened the app
without `showcase` in the URL, so `c.showcase()` ran on top of an already-booted full game and picked up the real
`terrain`/`roads`/water instead of the isolated showcase — fixed by passing `showcase: 'environment'` to `openApp`.
(2) my first "distance" grazing shots placed the camera itself out past the ramp radius, embedding it inside the
terrain mesh (`horizon-600m-N-graze.png` v1 showed inside-out shredded geometry) — fixed by keeping the camera in
the flat safe zone (radius ≈120 m) and only varying the look-target distance. Both are noted here for transparency;
the terrain findings below are from the corrected, re-shot batch.

## Numbers
| | value | budget / note |
|---|---|---|
| console errors | **0** across every batch (r3c, rain, fog, overcast, custom — ~78 captures total) | pass |
| gpuMs | 3.7–9.8 ms across preset batches; custom shots 1.3–12.2 ms (one moon shot briefly hit 12.2 ms) | ≤ 20 ms pass, comfortable margin |
| fps | 104–144 (vsync/GPU-bound) | pass |
| draw calls | 46–55 in preset batches (environment's own sky/nightDome/stars/rain ≤ 4; rest is composer/effects) | ≤ 10 for environment's own draws; pass |
| Math.random | none (grep clean) | pass |
| folder | only its 7 files (`csmPatch.js, index.js, nightSky.js, rain.js, showcase.js, sky.js, skyMath.js`) | pass |
| API | `id`, `deps: []`, `order 15`, init/update/dispose/showcase, `showcaseVariants` ×4, presets ×3, `api` {setupMaterial, refreshMaterials, setWeather, state, sunDirection, shadowMode, csm, sky, refreshShadowParams} all present and match ARCHITECTURE.md | pass |
| CSM | unchanged since r2; no acne/peter-panning in any 3 m or 300 m shot this round either | pass, cascade-3-at-real-city-scale still unverified (see issues) |

## Verification of round-2's top issue ("sea horizon" seam)
**NOT actually fixed, though the specific defect described in r2 is gone.** The literal complaint — a flat disc and
a separate hill ring fogging at different rates and meeting at a hard, uniformly-coloured edge — no longer exists;
`showcase.js` now builds one continuous mesh and the transition line is a soft shading gradient, not a razor cut.
But the underlying *perceptual* problem (a flat, nearly gradientless "sea" body filling most of the terrain's visible
height under a jagged crest) is still present in nearly every shot with a low or grazing camera, because the new
terrain still has a genuinely flat/near-flat near zone (ramp only starts at r=170, full by r=380) that a near-
horizontal ray sits in for a long optical path before reaching any relief, and `FogExp2` saturates that path to
solid colour. This is visible in:
- The module's own **`environment:sky` preset** (deliberately low camera) at every tod: `r3c/environment_sky-6h5.png`,
  `-12.png`, `-18.png`, `-21h5.png` — a flat, near-solid dark-teal/sepia/near-black band fills the lower ~55% of the
  terrain, with only the top ridge line showing any faceted detail.
- The module's own **`environment:default` preset** (moderate 24 m camera) — same pattern, softer: `r3c/
  environment_default-6h5.png` through `-21h5.png`.
- My re-shot near-ground grazing set at a *fixed, safe* camera radius (120 m, never inside the mesh) aimed at 300/
  600/1000 m targets across 3 azimuths — all 9 shots show the identical flat band regardless of azimuth or target
  distance: `r3c-custom/graze-300m-N.png`, `graze-600m-N.png`, `graze-1000m-N.png`, `graze-300m-E.png`, etc.
- The builder's own `r3-custom/horizon-grazing-dawn.png` and `r3-custom/shadow-300m-golden.png`/`shadow-600m-tight-
  golden.png` show the same thing — this was reproducible without any unusual camera placement on my part.
- Weather variants don't hide it (fog genuinely does, since it obscures everything — `r3c-fog/*` — but clear/
  overcast/rain all show it): `r3c-overcast/environment_sky-18.png`.

Net effect: the specific bug is fixed, but the module still fails the actual question ("does the horizon read as a
flat sea meeting land?") — yes, it still does, just with a gradient instead of a hard edge.

## New issue this round: terrain reads as a circular "crater," not a landscape
Pulling the camera back to typical aerial/overview distances (300/600/1000 m camera-to-target, height scaled to
clear the terrain's own profile) shows the showcase sitting inside a near-perfectly radially-symmetric bowl of
hills, with visible **concentric ring banding** from the mesh's ring-based construction (`buildDiscGeometry`'s 90
rings): `r3c-custom/pullback-300m-NE-golden.png` shows unmistakable circular ripples radiating from the plate, and
the same shape (a uniform ring of hills on all sides, no variation in distance/height by direction) is visible in
`pullback-600m-S-dawn.png` and `pullback-1000m-NE-golden.png`. This directly reads as "obviously procedural" rather
than natural terrain — a real landscape doesn't form a perfect circle around a point. Also visible in the builder's
own `r3-custom/shadow-300m-golden.png` and `shadow-600m-tight-golden.png` (described there as looking like "a tiny
island," which undersells how geometrically regular the surrounding ring actually is once you look at it from above
rather than in profile).

## Verification of other items
- **Moon vanishing under cloud (r2 issue) — FIXED, well-verified.** Re-shot a full cloud-intensity sweep at tod 3.5
  with a camera aimed precisely at the moon's actual direction (queried from `ctx.clock.moonDir` rather than
  guessed): `r3c-custom/moon-clear-ref.png` (clear), `moon-cloudy-02.png`, `-04.png`, `-06.png`, `-085.png`. The
  glow progressively and smoothly dims from a bright soft halo at clear, through a hazy grey-veiled patch at 0.4–0.6,
  to a faint but still-visible glow at 0.85 — no hard cutoff anywhere in the sweep. This is a real fix (`sky.js`'s
  post-cloud-composite veil re-bleed works as intended).
- **Sky/ground reflection "patch" (r2 issue) — improved.** `r3c-custom/glass-reflect-noon.png` and `-golden.png`
  (very close framing on the glass brick) show a smooth, continuous refraction/reflection gradient on the studs
  behind the glass with no visible hard rectangular boundary; the PMREM bump (512³, up from 256) appears to have
  helped. Not re-tested at the same wider framing r2 used, so treat as improved-but-not-exhaustively-reverified.
- **Far-cascade quality at real city-overview distances — still not conclusively verified**, same caveat as r2: no
  acne, seams, or peter-panning observed in any 3 m or 300 m shot this round, but the showcase's small brick stacks
  still don't fill enough of a frame at distance to stress-test cascade-3 texel density like a dense downtown would.
- **Weather identity — still good.** Rain/fog/overcast remain visually distinct and match the reference rubric's
  intent (rain: dim green-grey streaks + wet specular sheen; fog: heavy near-white wash that genuinely hides
  distance; overcast: soft uniform grey deck, no hard shadows): `r3c-rain/environment_default-18.png`, `r3c-fog/
  environment_default-12.png`, `r3c-overcast/environment_default-6h5.png`.
- **Code** — clean: no `Math.random`, folder holds only its 7 files, `dispose()` still tears down sky/stars/rain/
  CSM/PMREM/env-RT and resets state, `rain.js`/`nightSky.js` are well-commented single-draw-call shader setups with
  no seeded-RNG leaks. No regressions found versus r2's code-quality assessment.

## Ranked issues (most damaging first)
1. **Terrain still reads as a flat "sea" under grazing/low cameras — the r2 seam's symptom persists even though its
   literal cause (disc-vs-ring) is gone.** Worst in the module's own `environment:sky` preset at every tod
   (`r3c/environment_sky-*.png`) and any near-ground grazing shot (`r3c-custom/graze-*.png`); softer but still
   visible in `environment:default` (`r3c/environment_default-*.png`). Root cause: the terrain's near zone (r
   170–380) is only gently sloped, so a near-horizontal ray travels a long, nearly-constant-height path through it
   before hitting real relief, and `FogExp2`'s exponential density saturates that whole path to solid colour. Fix
   options: start the height ramp closer in (reduce the 170 m flat-zone radius so relief begins sooner), steepen the
   near-zone ramp curve so height gains happen faster per metre of distance, or reduce fog density specifically for
   near-horizontal rays (e.g. blend a height-based fog falloff so grazing rays over ground don't saturate as fast as
   they currently do).
2. **New: terrain reads as an artificial circular crater from any pulled-back/aerial vantage**, with visible
   concentric ring-banding from the radial mesh construction (`r3c-custom/pullback-300m-NE-golden.png`,
   `pullback-600m-S-dawn.png`, `pullback-1000m-NE-golden.png`). A real landscape isn't radially symmetric around a
   point. Fix: break the radial regularity — e.g. don't scale ring radius purely by `i/rings`, jitter ring radii
   per-vertex-angle, or build the height field from a noise domain that isn't centred on the origin (offset/rotate
   the noise sampling per ring) so the silhouette doesn't repeat the same distance-from-centre pattern in every
   direction.
3. **Terrain silhouette is very low-poly/faceted** (sharp shark-tooth ridge line) at every distance and time of day,
   most visible against a bright sky at dawn/noon (`r3c/environment_sky-12.png`, `graze-*-N/E/SW.png`). Combined
   with issues 1–2, the terrain doesn't read as AAA background dressing. Fix: more rings/segments near the ramp-in
   zone where the silhouette is closest to camera, or a normal-smoothing pass so faces blend instead of showing
   hard facets, would help even without more geometry.
4. **Far-cascade quality at real city-overview distances still not conclusively verified** (unchanged from r2 —
   flag again for a follow-up check once `buildings` has real geometry at the actual `overview` preset).
5. **PMREM regen cadence unaddressed (carried over from r1/r2, low priority, not re-verified as visible this round).**

## What already works
- Moon under cloud now dims and veils smoothly instead of vanishing — a genuine, well-verified fix (`r3c-custom/
  moon-cloudy-02/04/06/085.png`).
- Golden hour, noon, and night sky rendering, weather identity (rain/fog/overcast), CSM shadow cleanliness at close
  range, and glossy-plastic sky reflection all remain as strong as r2 found them — zero console errors and
  Math.random-free across every capture this round (~78 shots).
- The showcase no longer has a hard, razor-edged material seam at a fixed radius; the terrain-to-sky transition is
  now a continuous gradient rather than an instant colour jump, which is a real (if insufficient on its own)
  improvement in how the defect presents.
