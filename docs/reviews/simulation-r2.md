# simulation — critic review, round 2

**Score: 7.5 / 10 — FAIL** (pass needs ≥ 8.5). Errors: 0. Perf inside budget.

Huge round: 7 of round 1's 10 ranked issues are fixed outright, 2 are genuinely improved but only partial, and 1 is a
minor new nit found while re-testing at close range. This is a different module to look at than r1 — lighting,
night, the district and the panel all read like a real production pass now.

## Numbers
| run | minFps | maxGpuMs | maxDrawCalls | maxTriangles | errors |
|---|---|---|---|---|---|
| default (`shots/simulation/r2c/`, 12 shots) | 63.7 | 12.24 | 102 | 3,958,470 | [] |
| boom (`shots/simulation/r2c-boom/`, 12 shots) | 124.8 | 7.63 | 97 | 4,074,174 | [] |
| bust (`shots/simulation/r2c-bust/`, 12 shots) | 102.6 | 7.86 | 100 | 3,647,260 | [] |
| 13 extra custom-camera shots (`shots/simulation/r2c-extra/`) | — | — | ≤ 99 | — | [] |

gpuMs (the documented source of truth now that headless fps is vsync-pinned) peaks at 12.24 ms, well inside the 20 ms
budget. Draw calls rose from r1's 26 to ~86–102: expected and not penalised — showcases now auto-load `environment`
+ `effects` (shadow cascades, sky, post), and the module itself added sidewalks, lamps, per-window frames/panes,
cranes and sale signs. All 36 critic JSONs + 13 extra-shot JSONs + the api-sanity harness report `errors: []`. No
`Math.random` in `src/simulation/` (grep). Folder still contains only its own six files.

**Model sanity** (`page.evaluate`, live):
- `api.tick()` × 4000 (default warm city): no NaN, no runaway; happiness/traffic stayed in `[0,1]`; population/jobs
  never negative; `maxAbsDelta` on money/tick = 24 (linear, not exploding).
- Bust run to 6000 ticks: money slides from -$52k → -$334k in a straight line (net ≈ -$51.4/tick, never worsens or
  recovers), happiness bottoms at 0.47 (was stuck at 0.71 in r1 — the new debt term works), `debt` saturates at 1.0
  by tick ~2000 and `services` floors at 0.40, population stabilizes at 1169 (doesn't hit zero — occupancy floor
  0.08–0.3 by design).
- Variant distinctness after 1500 ticks each: default pop 3555/happy 0.877/demand(.35/.19/.12); boom pop
  4316/happy 0.875/occ R,I ≈ 100%/demand(.81/.27/.71); bust pop 1174/happy 0.546/money -$102k/occ ≈ 30% across all
  three zones/demand(0/0/0). Genuinely, numerically distinct — not just bar-height cosmetics.
- Determinism: `reset()` + 500 ticks, twice, sampled every 50 ticks → byte-identical `JSON.stringify(stats)` both
  runs.

## Round-1 issues, verified
1. **Flat/no lighting** → **FIXED.** Showcase now runs under the real sun/sky/night rig (auto-loaded `environment`
   + `effects`). `shots/simulation/r2c/simulation_default-6h5.png` shows genuine warm low-sun light and cast shadows;
   `-12.png` is bright midday; `-18.png` is a warm dusk sky; `-21h5.png` is a deep, starry blue night. No code change
   was even needed on simulation's side — this was the "declare deps" fix r1 suggested, done at the platform level.
2. **Night white hotspot** → **FIXED.** The bare point lights are gone; four pooled warm `SpotLight`s light the
   chart, lamp glass glows a believable amber, and per-building windows glow individually by occupancy
   (`shots/simulation/r2c/simulation_default-21h5.png`, `simulation_city-21h5.png`). No blown-white studs or signage.
3. **Closeup preset clips its own labels** → **FIXED.** Title board and label wedges no longer overlap in any
   variant; `simulation_closeup-12.png` / `-21h5.png` and the boom/bust closeup extras all show every value
   ("3,500", "$56,600", "87%"…) fully legible.
4. **Floating window stickers** → **FIXED.** Windows are now a recessed frame + dark backing + trans-clear pane
   (`extra/window-3m.png`); lit fraction tracks per-building occupancy (`litFraction`, seeded per-window hash) —
   boom shows ~85%+ lit windows, bust ~10–15%, confirmed visually in `extra/boom-cranes.png` vs
   `r2c-bust/simulation_city-21h5.png`.
5. **Hexagonal studs below ~20 m** → **PARTIAL, still a real problem.** Fixed only in a 60 m radius *around the
   chart itself* (`HI_STUD_RADIUS` in visuals.js, measured from `chartZ`, not from the camera). Two consequences
   survive: (a) building roof caps call `studdedPlateGeometry(materials, grp.sx, grp.sz, studGeoLow)`
   unconditionally — every one of the 207 rooftops in the district uses 6-sided studs regardless of camera distance
   (`extra/bust-forsale.png`, clearly faceted rooftop stud caps at ~5 m); (b) ground/sidewalk studs anywhere in the
   district that's more than 60 m from the chart (i.e., most of the district — it's a ~200×200 m grid, the chart
   sits at its southern edge) are also low-poly, confirmed at `extra/ground-studs-close.png` (camera 1.4 m off the
   ground, hexagons unmistakable). This is the same rubric deduction as r1, just relocated from "the chart" (now
   fixed) to "everywhere else" (now the norm, since the district is bigger than the chart's hero radius).
6. **Boxes on bare green / park quota bug** → **FIXED.** Sidewalks with curbs, lamp posts at every intersection,
   trees + flower plates in parks, and varied 1×1/1×2/2×1/2×2 footprints are all present (`r2c/simulation_city-12.png`).
   The quota bug is fixed — `parkQuota` now counts blocks, not cells, plus two fixed park blocks — and "Park access"
   reads 86% (default), 57% (boom), 72% (bust) — never the r1 0%.
7. **Variants don't read visually** → **FIXED.** Boom shows a denser skyline, ~10 visible tower cranes striding the
   growth candidates, near-fully-lit windows at night, and demand bars pinned high (`extra/boom-cranes.png`,
   `extra/closeup-preset-boom.png`). Bust shows a shorter, dimmer skyline, "FOR SALE" signs on unwanted lots, a red
   debt brick-stack on the treasury bar with the label board turning the treasury text red too
   (`extra/closeup-preset-bust.png`).
8. **Generic DOM panel, no axes** → **FIXED.** The panel is now a proper Lego-plate: SVG stud strip along the top
   edge, brick-red accent, dark-stone-grey gloss gradient with an inset highlight, bottom-left (never over the
   skyline). The chart has a real people axis (left, k-formatted), a real net-$/day axis (right, signed, colour-coded
   by sign), a 0/50/100% strip for happiness/traffic, and a labelled time axis ("-2:00 … now"). Legible at 1080p in
   every shot examined.
9. **No money feedback** → **PARTIAL.** A real feedback loop now exists: `debt = clamp01(-money/120000)` cuts
   `services` (parkShare, road capacity) and feeds directly into the happiness target and all three RCI pressures.
   Verified live: a sustained bust now correctly tanks happiness to 0.47 and holds population at a floor instead of
   the r1 "-258k treasury but 71% happy" disconnect. But the treasury number itself is still an unbounded one-way
   slide — 6000 ticks of bust run to -$334k with no floor, bankruptcy state, or other consequence once `debt` already
   saturates at 1.0 (which happens by tick ~2000); the last ~4000 ticks of the run just keep counting down forever
   with everything else already pinned. Half a fix.
10. **Atlas redraw / label aliasing / floating baseplate** → **FIXED.** `drawAtlas` now early-returns unless the
    formatted text actually changed (`atlasKey` guard) instead of redrawing 24×/s. Label text is crisp even at ~2.5 m
    (`extra/label-close2.png`, chartZ-derived custom camera on the POPULATION tile) — no visible aliasing. The far
    overview (`extra/far-overview.png`) shows a clean plate edge, no moiré.

## New, minor issue found this round
- At true close range a lit window's bloom blows out to a near-solid, shapeless glow that swallows the frame and
  neighbouring windows (`extra/night-lamp-low.png`). `emissiveIntensity 3.2` is within the rubric's own guidance for
  yellow/white bloom (2.5–3), so this isn't a rule violation, but the total loss of shape at point-blank range reads
  unpolished in a would-be street-level night shot. Minor; not rescored separately, folded into "studs/detail" below.

## Ranked issues (most damaging first)
1. **Building roof caps and most of the district's ground studs are still 6-sided/hexagonal up close** — the r2 fix
   only covers a 60 m hero radius around the chart, not the district itself or any rooftop. Where:
   `extra/bust-forsale.png` (rooftop), `extra/ground-studs-close.png` (sidewalk/ground). Fix: give building roof
   caps a camera-distance LOD (swap `studGeoLow` for `materials.studGeometry()` within, say, 40 m of the camera, not
   a fixed low-poly choice), and switch the ground stud hi/lo bucketing in `createVisuals` from
   `distance-to-chartZ` to `distance-to-camera`, or simply extend "hi-poly everywhere in the district" since the
   whole showcase is under 5 ms of GPU headroom against budget.
2. **Money is an unbounded, consequence-free number once debt saturates** — the new debt feedback caps out at
   `debt=1` (services floor, happiness floor) around tick 2000 in a sustained bust, after which the treasury keeps
   sliding linearly forever (-$334k @ tick 6000) with no further in-world effect. Fix: either explicitly cap the
   debt display/behavior once saturated and treat it as an intentional "struggling but stable" end-state, or add a
   harder consequence (building abandonment / an on-screen distress state) once debt has been at 1.0 for a while.
3. **Minor: extreme close-range window bloom loses shape** — see above. Fix: slightly lower emissive intensity or
   add a distance-based clamp so the frame/pane silhouette survives at point-blank range.

## What already works
- Lighting, sky and night are now genuinely good: correct sun-angle shadows at golden hour, bright flat noon,
  saturated dusk, and a proper deep-blue starlit night with warm, occupancy-driven window glow and no hotspots.
- The district reads as a real neighbourhood now: sidewalks with curbs, lamp posts at every corner, park trees and
  flower plates, cranes on growth candidates, varied footprints and colours — a different picture from r1's
  "boxes on bare green."
- Boom/bust/default are distinct in the model (verified live: population, happiness, occupancy, demand all diverge)
  *and* on screen (lit-window fraction, cranes, for-sale signs, a red debt bar).
- The DOM panel is a legitimate Lego-plate UI now — stud strip, plastic bevel, dual-axis chart with real ticks —
  replacing the old generic dark debug HUD.
- Engineering stayed clean through a big visual rewrite: deterministic, zero console errors across 49 captures
  (36 critic + 13 extra) plus a 4000-tick live sanity loop, clean API surface, no `Math.random`, folder still just
  its own six files.
