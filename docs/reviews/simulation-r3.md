# simulation — critic review, round 3

**Score: 8.8 / 10 — PASS** (pass needs ≥ 8.5). Errors: 0. Perf inside budget with large headroom.

All three round-2 issues are fixed, not just "improved" — and unlike round 2 (where the stud LOD fix only worked at
the builder's own camera spot), I deliberately re-verified all three at camera locations the builder's own r3-extra
set never used, to check the fixes generalize rather than being cherry-picked screenshots. They do. One unplanned
bug the builder also fixed (instanced-mesh frustum culling using a tiny local bounding sphere, invisible at any
close-range shot away from the group origin) is real and verified fixed too.

## Numbers
| run | minFps | maxGpuMs | maxDrawCalls | maxTriangles | errors |
|---|---|---|---|---|---|
| default (`shots/simulation/r3c/`, 12 shots) | 125.2 | 7.5 | 107 | 3,864,758 | [] |
| boom (`shots/simulation/r3c-boom/`, 12 shots) | 124.7 | 7.43 | 99 | 3,976,318 | [] |
| bust (`shots/simulation/r3c-bust/`, 12 shots) | 125.3 | 7.43 | 113 | 3,491,008 | [] |
| builder's `r3-dev` / `r3-dev-boom` / `r3-dev-bust` (36 shots, independently re-checked) | 118.3–127.2 | ≤7.30 | ≤113 | — | [] |
| builder's `r3-extra` (4 shots: roof-cap-close, ground-studs-close, window-point-blank, bankrupt-banner-close) | — | ≤7.45 | ≤122 | — | [] |
| my own `r3-extra-critic` (21 files: independent close-range LOD/window checks + bankruptcy-legibility combos) | — | ≤7.87 | ≤121 | — | [] |

gpuMs peaks at 7.87 ms across every shot examined this round (mine and the builder's) — well inside the 20 ms
budget, with more headroom than round 2 despite the LOD system now doing per-instance camera-distance bucketing on
every camera move. Draw calls stay in the 95–121 range depending on variant/shot, comfortably under the buildings
(400) + props (300) budget. All 73 total screenshot JSONs examined (36 my critic runs + 36 builder round-3 runs +
4 builder extras, cross-checked against my own 21 extra files) report `errors: []`. No `Math.random` in
`src/simulation/` (grep, confirmed again). Folder still contains only its own six files
(`citygen.js, desirability.js, index.js, model.js, panel.js, visuals.js`).

**Model sanity, re-verified live and independently this round** (fresh `page.evaluate` sessions, not reused from
round 2):
- Determinism: `reset()` + 500 ticks, twice, sampled every 50 ticks → byte-identical `JSON.stringify(stats)`.
- 3000-tick runs on default/boom/bust: no NaN anywhere in population/jobs/money/happiness/traffic/demand/debt/wealth,
  no negative population/jobs. `maxAbsDelta` on money/tick stayed bounded (24 default, 29 boom, **0** for bust once
  the floor is reached — see below).
- Variant distinctness after 3000 ticks: default pop 3563/happy 0.887/demand(.35/.19/.12); boom pop 4316/happy
  0.889/demand(.81/.27/.71); bust pop 1169/happy 0.470/money **exactly -$194,520**/demand(0/0/0), bankrupt=true.
  Genuinely distinct, not cosmetic.
- **Bankruptcy floor, independently reproduced**: ran the bust model from a fresh `reset()` for 11,800 ticks
  (`bankruptcy-probe.json`) — debt saturates and `bankrupt` flips true by tick ~4801 (matches the showcase's own
  `WARMUP_TICKS.bust = 4800`, which is why the **standard round-3c-bust critic screenshots already show the
  bankruptcy banner out of the box** — `shots/simulation/r3c-bust/simulation_city-21h5.png`), and money then holds
  dead flat at **-$194,520** (sampled every 200 ticks from 4801 to 11,800 — `moneySettleDelta: 0` throughout). A
  wholly separate session (`critic-r3-sanity.mjs`, different tick count/path) reproduced the **exact same
  -$194,520** floor value independently — strong confirmation this is a real, deterministic equilibrium
  (`BANKRUPT_FLOOR = -DEBT_SCALE * 1.6 = -192,000` plus the steady-state offset from `BANKRUPT_SPRING` pulling
  against the residual -$61,724/day net loss), not a fluke or a stuck clamp. Happiness (0.47), services (0.40) and
  debt (1.0) are all bounded too — nothing slides forever.

## Round-2 issues, verified this round
1. **Hexagonal studs beyond a 60 m hero radius → FIXED, and confirmed to generalize.** `visuals.js` replaced the old
   `chartZ`-distance bucketing with true camera-distance LOD (`CAM_HI_RADIUS = 62 m` from the live camera position,
   re-bucketed via `refreshCameraLOD()` whenever the camera moves >12 m), applied both to ground/sidewalk studs
   (`refreshGroundLOD`) and — new this round — building roof caps (`rebuildCaps`, previously hard-coded to
   `studGeoLow` for every rooftop regardless of distance). I did not just re-check the builder's own
   `roof-cap-close.png` / `ground-studs-close.png` (both now clean 14-sided studs, confirmed) — I shot two entirely
   new locations on the opposite side of the district the builder never visited: east-side rooftops
   (`shots/simulation/r3-extra-critic/roof-studs-east.png`, building at world x=68,z=4) and a southeast corner
   (`roof-studs-far-corner.png`, x=68,z=44), plus an east-side sidewalk/road corner
   (`ground-studs-east3.png`, near a lamp post and curb). All three show correctly round, hi-poly studs — the fix is
   a genuine per-instance distance test, not a second fixed radius that happens to cover more ground.
2. **Unbounded, consequence-free money at debt saturation → FIXED.** `model.js` adds `BANKRUPT_HOLD_TICKS` (debt
   held at 1.0 for 400 ticks declares the city bankrupt) and a `BANKRUPT_FLOOR` with a `BANKRUPT_SPRING` pull that
   arrests the slide instead of letting the treasury count down forever. Independently verified live (see Model
   sanity above) — the number really does stop, at a reproducible value, and the state is visible in-world (a red
   "CITY BANKRUPT · TREASURY IN STATE RECEIVERSHIP" banner mounted above the chart, `refreshDistress`) and in the
   DOM panel (`.sim-distress` strip, keyed off the same `stats.bankrupt`). I checked banner+panel legibility across
   four tod/preset combos on a bankrupt city (`default@6.5h`, `closeup@12h`, `city@18h`, `default@21.5h` —
   `shots/simulation/r3-extra-critic/bankrupt-*.png`): legible at every one, panel never clips other rows, in-world
   banner never overlaps the skyline or bar chart labels.
3. **Minor: close-range window bloom losing shape → FIXED.** `visuals.js` now gives each lit window a smaller inset
   "hot core" (`litBackGeo`, 68%×60% of the pane) instead of lighting the full pane, so a dark margin/frame survives
   even at point-blank range. Confirmed in the builder's own `window-point-blank.png` (crisp single-window
   rectangle, not a blob) and independently at a new east-side building
   (`shots/simulation/r3-extra-critic/window-east-night4.png`): individual lit windows on the same wall face stay
   visually separate, each with a clear dark border, at the closest distance the game's own camera controls allow
   (`controls.minDistance = 4` in `src/core/camera.js` hard-floors every custom/orbit camera to ≥4 m from its
   target — a core-engine constraint, not something `simulation` owns or can violate; below that the game simply
   cannot point a camera, so it's not a fair test range).

## Unplanned fix, verified
- **Instanced-mesh frustum culling** was using each geometry's raw local bounding sphere (centred near the
  `simulation` group's own origin near the chart), so any close-up camera framed on a district corner far from that
  origin — which is most close-up shots that don't also see the chart — could have entire instanced meshes culled
  as a whole, even though individual instances were plainly in view. `visuals.js` now disables `frustumCulled` on
  every `InstancedMesh` in the group at init. I could not reproduce any missing/culled geometry in any of my 13
  independent close-range shots at four different district locations, including ones the builder's own extras don't
  cover — ground, roofs, walls and windows all rendered correctly regardless of camera framing. Cost is negligible:
  draw calls and gpuMs stayed essentially flat vs round 2 (95–121 calls, ≤7.87 ms vs round 2's 86–102 calls,
  ≤12.24 ms — actually *better* headroom this round).

## What already works (unchanged, re-confirmed)
- Lighting, sky and night: correct low-sun golden-hour shadows, bright noon, warm dusk, deep starlit night with
  occupancy-driven window glow — all re-checked across all four tods in `r3c/`, `r3c-boom/`, `r3c-bust/` with no
  regressions.
- The district reads as a real neighbourhood: sidewalks with curbs, lamp posts, park trees/flowers, cranes on
  growth candidates in boom, "FOR SALE" signs and a visibly shorter/dimmer skyline in bust.
- Boom/bust/default remain distinct both in the model (independently re-verified this round: pop/happiness/demand
  all diverge) and on screen (crane count, lit-window fraction, for-sale signs, debt-red chart bar, bankruptcy
  banner).
- The DOM panel and 3D bar chart are legible plastic-plate UI with real axes, unchanged from round 2's fix.
- Engineering discipline held through another round of changes: deterministic, zero console errors across every
  screenshot I or the builder took (73 total), no `Math.random`, clean six-file folder, API contract (`id`, `deps`,
  `order`, `presets`, `showcaseVariants`, `api`, `init/update/dispose/showcase`) unchanged and intact.

## Remaining polish (does not block pass; nothing rises to a ranked deduction)
- Draw calls have crept up over three rounds (26 → ~100 → up to 121) as visual detail was added; still far under
  budget (buildings 400 + props 300) and GPU time is <40% of the 20 ms cap, so there's no urgency, but it's worth
  tracking if a future round adds substantially more detail.
- The only camera position where the window-bloom fix could theoretically still be stressed further (sub-4 m from
  a wall) is unreachable through any in-game camera control (`controls.minDistance = 4`), so this is an observation,
  not an issue to fix in `simulation`.

## Verdict
Round 2 closed 7 of 10 issues outright and left 2 partial + 1 minor. Round 3 closes all three of those cleanly, and
the fixes hold up under independent testing at locations and via live probes the builder didn't run itself — which
is the bar that matters more than a good screenshot at a chosen spot. Combined with zero errors, deterministic
model behaviour, and comfortable perf headroom, this clears AAA-with-nits. **Pass at 8.8.**
