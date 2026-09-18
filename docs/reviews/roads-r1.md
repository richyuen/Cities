# roads — critic review, round 1

**Score: 6.5 / 10 — FAIL** (pass needs ≥ 8.5). Good indie: the right idea and a clean straight grid, but bends, dead ends,
the highway and the terrain seam are visibly unfinished.

## Numbers
| set | shots | minFps | maxDrawCalls (budget 60) | errors |
|---|---|---|---|---|
| `shots/roads/r1c/` (default, 5 presets × 4 tods) | 20 | 142.4 | 27 | 0 |
| `shots/roads/r1c-int/` (variant intersection) | 10 | 143.4 | 24 | 0 |
| `shots/roads/r1c-hwy/` (variant highway) | 15 | 143.0 | 24 | 0 |
| `shots/roads/r1c-custom/` (21 custom cameras: 2.5–3 m over junctions/bends, 40–50 m top-downs, 380 m overview, night) | 21 | 142.3 | 29 | 0 |

- `api.lastBuildMs()` = 18.0 ms after showcase stage, 11.4 ms on a forced `api.rebuild()` (50 edges / 41 nodes). 8 meshes in the `roads` group.
- Only `terrain` + `roads` are loaded in the showcase, so lighting/sky/night are core defaults (21:30 renders as blue dusk; no streetlights — not this module's fault, noted but not scored).
- Console errors: **none** in any JSON. `Math.random`: **0 hits** in `src/roads/`. Folder contains only its own five files.

## API contract (verified via page.evaluate)
- `id:'roads'`, `deps:['terrain']` (glob-guarded), `order 30`, `init/update/dispose/showcase`, `showcaseVariants ['default','intersection','highway']`, 5 presets — all present.
- `getLanePath(e0..e3, 0, fwd/back)`: 15 points each, all finite, monotonic along the edge, y = 2.16 (road bed + `Y.lane`), right-hand offset (x = −130 fwd vs −126 back on an x = −128 street). OK.
- `getLaneConnections('n10')` (4-way avenue×street at 0,32): 14 connections = 6 through / 4 left / 4 right, 5- or 9-point finite curves whose endpoints coincide with lane-path endpoints. T-node n2: 6 conns (2/2/2). Dead end n22: 1 `uturn`. OK.
- `snapToRoad(5,40)` → e8 at (0, 2.16, 40) dist 5; with `maxDist 2` → `null`; far away (500,500) returns the nearest end (dist 328, correct given `maxDist=Infinity`). `heightAt(0,32)` = 2.16, `heightAt(400,400)` = terrain + 0.16. OK.
- `roadWidth/footprintWidth`: street 8/12, avenue 16/20, highway 16/19.2, path 3/3. OK.
- `dispose`: unsubscribes, disposes edge geometries, stud instancer and fallback ground, removes group. Nit: the `roads-lots` showcase mesh geometry is not disposed (small leak); materials come from the `ctx.materials` cache, fine.

## Ranked issues (most damaging first)
1. **Bends are mitred, not curved.** `r1c-custom/bend90-12m.png`, `bend50-3m.png`, `bend50-10m.png`. Every 2-arm bend gets an inner fillet but a *sharp outer mitre* (`computeNodeCorners` reflex pair → `mode:'sharp'`), a large blank asphalt polygon, and all lane/edge markings stop dead at the trim. The curved plate is the most recognisable Lego road element; these read as a plotted polygon, not a plate. Fix: for 2-arm `joint` nodes build an arc (centre on the inner bisector, radius ≥ carriageway width) for surface, curbs, sidewalk *and* continue centre/edge dashes along the arc; reuse the arc for `getLaneConnections` through-paths.
2. **Embankment "wedge" polygons.** `r1c/roads_deadend-*.png`, `r1c-custom/culdesac-wedge.png`. Where the road bed leaves the terrain (street 64,96→64,148 climbing the slope) `addSkirt` emits a single flat light-grey triangle ~20 m long with no studs, bricks or steps; it reads as a leaked polygon. The cul-de-sac bulb also sits on a visible plinth with a bare wall. Fix: build the skirt as stepped 0.4 m brick terraces (match terrain quantisation) in a darker grey/green, or clamp the road profile to the terrain and let terrain do the cut; never a single untextured quad.
3. **Terrain studs and plates poke through the road.** `r1c-custom/hwy-west-end.png` (green studs inside the highway bulb), `hwy-kink.png` (studs on the carriageway and a green patch through the verge), `ramp-T-4m.png` (green terrain wedges rising through the sidewalk corner), `hwy-side-2m.png` (half-buried studs along the verge). The `world` road-cell marking does not cover bulbs, verges or the flared node polygons, so terrain keeps its studs/height there. Fix: mark cells for the *full footprint incl. bulbs and node polygons*, and raise `Y.surface` where the 0.4 m terrain quantisation can exceed the bed.
4. **Highway dead ends are cul-de-sac bulbs.** `r1c-custom/far-overview.png`, `hwy-west-end.png`. A 16 m motorway terminating in a turning circle with a stud sidewalk is nonsense (`kindSpec('highway').bulb = 11`). Fix: highways (and avenues) end square or taper to a stub — bulbs only for streets.
5. **Oversized T/junction polygons push crosswalks away from the junction.** `r1c-custom/ramp-topdown50.png` (street crosswalk + stop line ~20 m from the highway with blank asphalt in between and a jagged notch in the highway verge), `topdown40-T.png` (T at 0,−128: avenue median stub sits mid-arm, yellow lines run past it). Trims accumulate `max()` over every pair including the reflex mitre point `Cf`, so wide arms inflate the node. Fix: cap trim at ~1.25 × the widest crossing half-width; place the crosswalk at the curb line, not at the trim; extend the median consistently to 6 m before the crosswalk.
6. **Stud collisions on fillets.** `r1c-custom/T-west-2p5m.png`, `night-T-west.png` (bottom centre), `bend50-3m.png`. Corner sidewalks get studs along the arc *and* the straight rows; they intersect. Not Lego-legal. Fix: generate corner studs on the global 0.8 m lattice and reject any stud closer than 0.5 m to another or outside the plate polygon.
7. **Road plastic too light and flat at high sun.** `r1c/roads_closeup-12.png`, `roads_intersection-12.png`. At noon the carriageway renders pale blue-grey with no visible sheen or normal grain (roughness 0.58, clearcoat 0.22); it only reads as glossy ABS at 06:30 (`roads_closeup-6h5.png`, where it looks right). Fix: albedo nearer darkStoneGrey, roughness ~0.35–0.42, clearcoat ~0.4, keep the normal map; markings slightly rougher than the plate so they read as print.
8. **Highway polyline kinks.** `r1c-custom/hwy-kink.png`, `far-overview.png`. Straight segments meet at visible angles in the lane lines. Fix: treat 2-arm joints with small deflection as an arc/spline (same code path as issue 1).
9. **Stud-free light-green margins around every road.** `r1c-custom/topdown40-avenue.png`, `bend90-12m.png`. Cells marked `road` (8 m) do not match footprints (12/20 m) — terrain drops studs in a band the sidewalk does not cover, leaving flat bright strips and rectangular stud-less patches at corners. Fix: mark cells only where the footprint covers ≥ 50 % of the cell, or have terrain read `footprintWidth`.
10. **Presets not variant-aware.** `r1c-int/roads_intersection-12.png` frames an empty block; `roads:highway` in the intersection variant shows nothing. Fix: derive presets from `getIntersections()` (first 4-way / first highway edge).
11. Minor: street stop bars span the whole carriageway (`topdown40-avenue.png`); the `path` kind ends in rounded bulbs (`roads_intersection-12.png`, left); `roads-lots` geometry not disposed.

## What already works
- 4-way and avenue×street intersections are genuinely clean: correct fillets, curbs, zebra crossings with stop lines, avenue median with double yellow, no z-fighting or gaps at any camera distance (`r1c-custom/T-west-8m.png`, `topdown40-avenue.png`).
- Merged geometry: 8 meshes, ≤ 29 draw calls for the whole scene, 11–18 ms rebuilds, 144 fps, deterministic, no `Math.random`.
- The lane/connection API is complete, finite and geometrically consistent — traffic can build on it today.
