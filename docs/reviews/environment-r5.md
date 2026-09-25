# environment — round 5 critic review (approved §6.1 exception)

**Score: 8.7 / 10 — PASS** (pass needs ≥ 8.5, `errors: []`, within perf budget)

## Headline verdict

This round changed **no environment source at all** (`git status` clean for `src/environment/`; the only live change is the
integrator's `src/terrain/heightgen.js` 0.8 m plains step). So round 5 is a verification round, not a fix round. I re-ran
environment's four r4 issues with fresh captures, and then judged the module as the **shipped product surface** — sun/sky/
tonemapping/exposure/fog/weather/shadows across the real game, the real terrain, and the game/terrain waveB1 batches — as the
exception instructs, rather than scoring its showcase test rig twice.

Result: **every remaining visual loss in environment's own showcase is the test rig** (the module's self-contained lighting
platform, `deps: []`, `showcase.js`), not the shipped surface. In the real game none of the r4 rig symptoms appear: the map is a
broad river valley with a coast and stepped plateau, not an enclosing basin; the near ground is studded 0.8 m-stepped plates with
visible relief, not a gradient sea; the silhouette is intentionally stepped, not faceted. The one r4 unknown — far-cascade
quality at real overview distances — is now closed with P3 numbers plus my own crops showing legible building shadows at the real
`overview` camera. The core lighting/sky/shadow/weather contract has been stable since r2 and still is. Scored on its real
contribution: **8.7, AAA with nits**. The rig itself remains a weak, documented best-effort item (see decision paragraph).

## r4 issues, re-checked one by one

| # | r4 issue | fresh r5 evidence (mine) | verdict |
|---|---|---|---|
| 1 | **Basin read from pulled-back/aerial views** | Real game: `r5-game/overview-6h5/-12/-18/-21h5.png`, `aerial-12.png`, `aerial-fog-18.png`, `skyline-21h5.png` — broad valley, river, coast, stepped plateau rim; no enclosing wall in any direction. Rig: 5 fresh 1000 m pullbacks (N/E/S/W/NW, `r5-custom/pullback-1000m-*.png`) + off-centre topdowns (`topdown-1100m-offcenter-NE/-SW.png`) — the rig is a **literal circular disc with a mountain rim on all sides**, unmistakable from off-centre aerial views. | **(b) still present in the test rig only.** The real game never had it. |
| 2 | **Flat "sea" near-zone under grazing/low cameras** | Real game: `street-12/-18/-fog-6h5`, `closeup-18`, `overview-*` — studded near ground, step-contour lines, sand/rock shore steps; no gradientless fill. Rig: fresh `graze-2000m-E-low.png`, `graze-2000m-N-low-dawn.png`, `graze-1200m-SW-low-golden.png`, plus every `environment:sky` preset and `r5-rain/-fog/-overcast` sky shots — the smooth, low-detail green/teal ramp between the stud plate and the ridge is unchanged from r4. | **(b) still present in the test rig only.** |
| 3 | **Low-poly/faceted silhouette** | Real game: terrain silhouette is terraced 0.8 m steps + stepped rock (by design); no origami facets in game shots (`overview-6h5`, `overview-18`, `terrain_default-18`). Rig: `pullback-*`, `environment_sky-12/-18`, `r5-fog/environment_sky-12` — sharp triangular "shark-tooth" ridge facets at every azimuth/tod, unchanged (no normals/tessellation pass was added). | **(b) still present in the test rig only** (r4 issue 3 never had a fix; env untouched). |
| 4 | **Far-cascade quality at real overview distances unverified (P3)** | P3 now measured (plan §4): CSM active, maxFar 2139 m, far 4096 @ ±2130 m → texel ≈ 1.04 m, near texel ≈ 5 cm at play distance; no churn drift. Visually corroborated this round: `r5-zoom/ov-6h5-c1/-c2.png` (2× crops of my own fresh `overview-6h5`) show long, correctly-oriented building/silo shadows legible on terrain at the real overview camera; `waveB1/overview-6h5.png` confirms the same. | **(a) closed/verified adequate for environment's remit.** Terrain-vs-terrain riser self-shadow magnitude remains, but that is terrain's lever (terrain r5). |
| — | (r4 mandate) ring-banding gone | Fresh topdowns at 1500 m centred / 1100 m off-centre NE & SW (`r5-custom/topdown-*`): Cartesian mottled texture, no concentric bands. | **(a) holds** — no regression. |

## Whole-module verdict as shipped surface

- **Sun / sky / exposure** — strong at all four tods in-game and in every other module's showcase: pale-but-warm dawn over the
  city (`r5-game/overview-6h5`), bright noon (`overview-12`, `street-12`), orange golden hour with a sun reflection streak across
  the stud ground and long shadows (`overview-18`, `closeup-18`, `terrain_default-18`), deep-blue night with stars and lit windows
  (`overview-21h5`, `waveB1/street-21h5`). ACES exposure tracks elevation; no blown or crushed frames.
- **Weather** — all three variants remain sharply distinct in-game *and* on the rig: rain streaks + wet ground with a low-sun
  smear (`r5-rain/environment_default-18`, `r5-game/street-rain-18`), fog that genuinely hides distance
  (`r5-game/overview-fog-12`, `r5-fog/environment_sky-12`), overcast soft grey deck with no hard shadows and no directional
  sun (`r5-overcast/environment_default-12`).
- **Shadows** — CSM pipeline healthy: legible building/silo shadows at street and real overview distance (crops above),
  clean close range (`closeup-18`, `street-12` 2× crops) — no acne or peter-panning found. The terrain self-shadow magnitude
  gap is owned by terrain per the round's framing, and the integrator's bias/radius A/B (`normalBias 0.079→0.012`,
  radius 1.5→0.8) produced visually identical captures, so environment's parameters are not the missing lever.
- **Aerial perspective / tonemapping / night life** — distance desaturates toward sky in the game shots; night city reads with
  window bloom and deep-blue ambience. Moon-under-cloud dimming and the sky-reflection patch (r2/r3 fixes) unchanged and show no
  regression (env source byte-identical to the version r4 cleared).

## Numbers (all fresh, this round)

| batch | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `r5-critic` (default) | 12 | 143.2 | 5.17 | 53 | `[]` |
| `r5-rain` | 12 | 143.4 | 5.36 | 54 | `[]` |
| `r5-fog` | 12 | 143.0 | 5.08 | 53 | `[]` |
| `r5-overcast` | 12 | 142.9 | 5.05 | 53 | `[]` |
| `r5-custom` (my pulled-back/grazing rig probes) | 11 | 143.2 | 4.55 | 52 | `[]` |
| `r5-game` (my whole-game atmosphere set: clear×9, rain×3, fog×3) | 15 | 46.0* | 7.55 | 846 | `[]` |
| `waveB1` game batch (re-read) | 20 | 54.5 | 10.49 | 860 | `[]` |

- **Zero console errors across all 62 fresh captures** (48 critic + 11 custom + 15 game) plus the waveB1 batch; `moduleErrors: {}`,
  `modules: {environment:"ok", effects:"ok"}`.
- **Budget: PASS.** gpuMs is the truth per `ARCHITECTURE.md` §7 (≤ 20 ms): my worst game shot is 7.55 ms, worst showcase 5.36 ms,
  waveB1 10.49 ms — all with wide margin. Environment's own draws are unchanged (sky/nightDome/stars/rain + 3 CSM passes); the
  36–54 showcase call counts are the rig + composer, consistent with r3/r4 accounting, and the 742–846 game counts are the whole
  city, unchanged in character.
- \*Single-shot game launches report 46–48 fps because each `shot.mjs` run opens a fresh browser and samples 1 s immediately after
  load (known cold-start/first-shot artifact, see zoning r2); the warm game batch (`waveB1`, 20 shots) is 54.5 minFps. GPU headroom
  (gpuFps ≈ 150+) confirms CPU/load-bound cold reads, not a budget breach.
- Hygiene: `src/environment/` still exactly its 7 files; no `Math.random` anywhere in the folder (grep clean); `id`, `deps: []`,
  `order 15`, `init/update/dispose/showcase`, `showcaseVariants` ×4, presets ×3, and `api` (`setupMaterial`, `refreshMaterials`,
  `setWeather`, `state`, `sunDirection`, `shadowMode`, `csm`, `sky`, `refreshShadowParams`) all present and matching
  `ARCHITECTURE.md`.

## Ranked remaining issues (most damaging first)

1. **Showcase test-rig terrain still reads as a literal circular disc/basin with an enclosing rim** — worst from any pulled-back or
   off-centre aerial view (`r5-custom/topdown-1100m-offcenter-*.png` shows the disc edge; all five 1000 m pullbacks show the ring of
   ridges). Rig-only: this geometry is never shipped or staged by any other module. Fix is showcase-scoped, not gameplay-scoped.
2. **Rig near-zone is still a flat, low-detail gradient under grazing/low cameras and under fog/rain/overcast**
   (`graze-2000m-*`, `environment_sky-*`, `r5-fog/environment_sky-12`). Softer than r3 but unchanged this round.
3. **Rig ridge silhouette still visibly low-poly/faceted** (`pullback-1000m-*-noon/-golden`, `environment_sky-12`) — sharp
   triangular facets; no normal smoothing or near-camera tessellation was added, and none was mandated this round.
4. **Cross-module watch item: terrain-vs-terrain riser self-shadow magnitude is still sub-threshold at ~20 m** (terrain r5). Per the
   round's framing this is terrain's lever; the environment-side A/B (normalBias/radius) showed no visible delta, so do not count it
   as an environment failure. If terrain reopens it, the far cascade's `normalBias 0.45`/`radius 1.5` are the parameters to revisit.
5. **Minor game nit: rain at intensity 0.6 dominates wide/overview framings** — streak layer does not LOD down at overview distance,
   so the city hazes out fast (`r5-game/overview-rain-12.png`). Consider scaling streak opacity/length with camera distance for wide
   presets.
6. PMREM regen cadence (carried since r1, still never observed as visible) — low priority, informational.

## What already works

- **The whole game atmosphere contract**: one sun with correctly-oriented, legible shadows at every distance (incl. the real
  `overview`), ACES exposure that tracks sun elevation, golden-hour warmth with a ground reflection streak, deep-blue starry night
  with living lit windows — stable since r2, re-verified fresh across game + terrain + waveB1.
- **Weather identity is unambiguous and game-wide**: rain (streaks + wet sheen), fog (distance genuinely hidden), overcast (soft
  uniform deck, no hard shadows) all read instantly and survive at multiple camera distances.
- **Perf/robustness**: 62 fresh captures, `errors: []` everywhere, worst gpuMs 7.55 game / 5.36 showcase vs a 20 ms budget, no
  `Math.random`, API contract and 7-file folder unchanged — the module remains the stable lighting backbone for every other showcase.

## Best-effort decision (roadmap §2.4 / acceptance)

The remaining loss is **entirely the showcase test rig**, and the module has no code change left that a builder round was allowed to
make (4/4 rounds used; r4 explicitly named the rig levers). Per the exception's acceptance clause I am recording the best-effort
decision instead of silently absorbing a round: the remaining lever is the **rig's own geometry** (radial-falloff height field →
circular rim; flat near field; coarse tessellation), and the next concrete step, if the rig is ever worth another cycle, is one
showcase-scoped change in `src/environment/showcase.js` — either stage the lighting rig on the real terrain heightfield when a
showcase closure can reach it, or (cheapest honest fix) drop the mountain mesh entirely and keep a flat stud plate + sky, since the
rig exists only to judge lighting and the failed imagery is the rig's fake landscape, not the lighting. No gameplay or shipped
surface work depends on it.

## Shots reviewed

- Mine, fresh: `r5-critic/` (12), `r5-rain/` (12), `r5-fog/` (12), `r5-overcast/` (12), `r5-custom/` (11: 3 topdowns, 5 pullbacks,
  3 grazes), `r5-game/` (15: clear 9 across 4 tods/presets, rain 3, fog 3), `r5-zoom/` (6 × 2× crops of game shots).
- Prior-round/other-module evidence re-read: `shots/game/waveB1/` (summary + `overview-6h5`, `street-21h5`), `shots/terrain/r5-critic/`
  (`default-12/-18/-21h5`, `closeup-12`), `terrain r5-critic-zoom` filenames for cross-reference; r4's review and the P3 numbers
  in `C:\Users\ryuen\.opencode\plan\terrain-shadow-terrace-pass.md` §4.
