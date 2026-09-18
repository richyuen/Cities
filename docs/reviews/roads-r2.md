# roads — critic review, round 2

**Score: 8.0 / 10 — FAIL (0.5 short of the 8.5 pass bar)**. This is a real rebuild, not a polish pass: 9 of round 1's 11 ranked
issues are fixed, including the two structurally worst ones (mitred bends, highway cul-de-sac bulbs). What's left is genuine
nits — a slightly flat noon plastic and one new small geometry artefact on a subset of bends — not unfinished features.

## Numbers
| set | shots | minFps | maxGpuMs | maxDrawCalls (scene) | errors |
|---|---|---|---|---|---|
| `shots/roads/r2c/` (default, 5 presets × 4 tods) | 20 | 67.6 | 14.52 | 78 | 0 |
| `shots/roads/r2c-int/` (variant intersection) | 20 | 121.7 | 8.27 | 69 | 0 |
| `shots/roads/r2c-hwy/` (variant highway) | 20 | 92.8 | 10.39 | 70 | 0 |
| `shots/roads/r2c-custom/` (23 custom cameras: 90°/50° bends at 3–12 m, highway ends, ramp T, top-downs, cul-de-sac, embankment, 380 m overview, night 4-way) | 23 | 104.3 | 6.72 | 77 | 0 |

- Numbers above are the whole scene (terrain + environment + roads + effects/composer), per the brief's note that showcases now
  auto-load environment/effects. **Roads' own contribution**, read via `scene.getObjectByName('roads').traverse`: 8 static
  merged meshes (`roads-lots`, `roads-surface`, `roads-path`, `roads-curb`, `roads-sidewalk`, `roads-terrace`, `roads-white`,
  `roads-yellow`) + 2 `InstancedMesh` stud fields (`roads-studs`, `roads-infill-studs`) = **10 draw calls**, well inside the
  §7 budget of 60.
- `gpuMs` (the truth metric per the brief) never exceeds 14.5 ms anywhere (budget ≤ 20 ms for the *full* city with far more
  modules loaded than this showcase) — roads alone is nowhere near a perf problem.
- `api.lastBuildMs()` = 60.1 ms on the default network (heavier than round 1's 18 ms — arcs and terraces cost more to build —
  but this is a one-off staging cost, not a frame cost, and isn't budgeted). Breakdown: network 8.8 ms, geometry 18.9 ms,
  footprint 23.9 ms (raster 7.2 + cells 0.4 + infill 16.3), upload 8.5 ms.
- `api.studStats()` = `{ total: 57394, terrain: 29972, rejected: 26 }` — the overlap-rejection from round 1's issue 6 fix is
  live and actually rejecting collisions, not a no-op.
- Console errors: **none** in any of the 83 shot JSONs taken this round. `Math.random`: **0 hits** in `src/roads/` (checked
  all 5 files). Folder still contains only its own five files (`index.js`, `network.js`, `geometry.js`, `studs.js`, `showcase.js`).

## API contract (verified live via `page.evaluate`)
- `getIntersections()` now reports 41 nodes with real per-bend geometry: `bend.radius`/`bend.deflection` on every 2-arm joint,
  e.g. `R=8 m, defl=90°` on the street grid corners, `R=8 m, defl≈51.7°` on the 50° bend, and — new — `R=60 m, defl≈3.8–8.6°`
  on the highway's gentle polyline joints (this is what fixed round 1 issue 8, the highway kinks).
- `getLanePath(e15, 0, 'forward')` on a bend edge: 14 points, all finite, first/last endpoints on the arc.
- `getLaneConnections(bendNodeId)`: 2 through-connections, 11-point curves, all finite.
- `getLaneConnections(fourWayId)`: 12 connections, `{left:4, through:4, right:4}`, all finite, endpoints consistent with lane paths.
- `snapToRoad(5,40)` → `e8` at dist 5, `t=0.125`. `snapToRoad(5,40,2)` → `null` (maxDist respected). `snapToRoad(500,500)` →
  nearest edge end, dist 328. `snapToRoad(500,500,30)` → `null`. `heightAt(0,32)=2.16`, `heightAt(400,400)=10.16`. All correct.
- Removing a road edge and calling `api.rebuild()` releases its cells with no throw (regression-checked, carried over from R1).
- `dispose()` now disposes `roads-lots` geometry explicitly — round 1's small-leak nit is fixed.

## Round 1 issues — verified status
1. **Bends mitred, not curved** → **FIXED.** `r2c-custom/bend90-3m.png`, `bend90-12m.png`, `bend50-3m.png`, `bend50-10m.png`:
   every 2-arm joint is now a true arc — curb, sidewalk, and the dashed centreline all sweep continuously through the turn.
   This was the single most damaging issue and it's gone.
2. **Embankment wedge polygons** → **FIXED, with a new minor artefact.** `r2c-custom/culdesac-5m.png`, `culdesac-topdown.png`,
   `embank-3m.png` show real stepped brick terraces (matches the suggested fix almost exactly) instead of a bare flat quad.
   However `bend50-10m.png` and the confirming `bend50-node-6m.png` shot show a small dark trapezoidal fin poking out past
   the sidewalk curb on the outside of that bend, sitting flush on the grass — looks like the terrace/skirt code is firing on
   a tiny, near-flat height mismatch it shouldn't bother with. Minor and only visible at grazing angles, but it's a real stray
   polygon. See "Remaining issues" below.
3. **Terrain studs/plates poking through roads, bulbs, verges** → **FIXED.** Checked specifically at the old trouble spots:
   `hwy-west-end.png`, `hwy-east-end-3m.png`, `ramp-T-4m.png`, `culdesac-5m.png` — no green studs breaking through pavement,
   verges, or node polygons in any of them.
4. **Highway dead ends were cul-de-sac bulbs** → **FIXED.** `hwy-west-end.png` and `hwy-east-end-3m.png` both show a clean
   squared/tapered stub with a curb cap — no turning circle. Street dead ends (`roads_deadend-*.png`) still correctly bulb.
5. **Oversized junction polygons, crosswalks far from the junction** → **FIXED.** `topdown40-T.png`, `topdown40-avenue.png`,
   `ramp-topdown50.png`: crosswalks sit right at the curb line, medians run to the crosswalk, no blank asphalt gap, no jagged
   verge notches.
6. **Stud collisions on fillets** → **FIXED.** `T-west-2p5m.png`, `fourway-2p5m.png` at 2.5 m show single, non-intersecting
   stud rows on every corner arc; `studStats().rejected = 26` confirms the overlap-rejection is functioning, not decorative.
7. **Road plastic too light/flat at noon** → **PARTIALLY FIXED.** Code now uses `#4A4E52` albedo, `roughness 0.4`,
   `clearcoat 0.4`, `clearcoatRoughness 0.25` plus a normal map (`src/roads/index.js:225`) — exactly the round-1 suggestion.
   At golden hour (`golden-avenue.png`, tod 18) and dawn (`roads_intersection-6h5.png`) it reads convincingly as glossy ABS
   with visible sheen and grain. At true noon with no sun glare in frame (`r2c-int/roads_closeup-12.png`) it still reads
   fairly flat pale blue-grey with only a faint reflective band — better than round 1's completely flat noon look, but not
   fully there.
8. **Highway polyline kinks** → **FIXED.** `hwy-kink.png`: the lane lines now sweep smoothly through the polyline joints
   (confirmed as `R=60 m` arcs via the API, not sharp angles).
9. **Stud-free light-green margins around roads** → **FIXED** as far as checked. `topdown40-T.png`, `topdown40-avenue.png`,
   `bend90-3m.png`: sidewalk/footprint edges line up with the stud-covered terrain, no bare strip.
10. **Presets not variant-aware** → **FIXED.** `r2c-int/roads_highway-12.png` (intersection variant, no highway edges exists)
    now falls back sensibly to the longest street instead of framing empty ground; `r2c-hwy/roads_intersection-12.png`
    (highway variant) frames a real intersection. Presets are built from `getIntersections()`/`netNodes()`/`netEdges()` live.
11. **Minor items** → **FIXED.** `topdown40-T.png`/`ramp-topdown50.png` stop bars now span one lane, not the whole carriageway;
    `path-end-4m.png` shows the `path` kind ending in a plain square cut, not a rounded bulb; `roads-lots` geometry is disposed
    (see API section).

## Remaining issues (ranked)
1. **New: stray dark fin poking past the curb on some bends.** `r2c-custom/bend50-10m.png`, `bend50-node-6m.png` (west T→50°
   bend at x≈-176,z≈-32, a mostly-flat part of the showcase terrain). A small dark-grey trapezoid, the colour of the
   `terrace` material, sits half-buried in the grass just outside the sidewalk band on the outer side of the curve. Reads as
   a leaked/self-shadowed polygon fragment. Likely the terrace/skirt code triggering on a sub-threshold height delta at a
   bend that shouldn't need a terrace at all. Fix: skip terrace generation below some minimum height-delta threshold (e.g.
   < 0.4 m, one terrain plate step), or clip the terrace polygon to the sidewalk's outer edge so it can't protrude past it.
2. **Road plastic still reads a bit flat at true noon with no direct sun in frame.** `r2c-int/roads_closeup-12.png`. The
   material change (darker albedo, clearcoat 0.4, normal map) clearly helps at low sun angles but the overhead-sun case from
   round 1 is only partially addressed. Fix: consider a touch more clearcoat (0.5) or a stronger/larger-scale normal map so
   the plate keeps some visible grain/sheen even when the sun is straight overhead and not producing a specular streak.
3. **`lastBuildMs` more than tripled (18 ms → 60 ms) for the same class of network.** Not perf-budgeted (it's a one-time
   showcase-staging cost, not per-frame), and `gpuMs` stays comfortably under budget everywhere — so this doesn't affect the
   score — but it's worth watching if the real game rebuilds the network interactively while the player is drawing roads;
   a 60 ms main-thread stall on every edit would be noticeable. Not scored as an issue, flagged for awareness.

## What already works (carried over and reconfirmed)
- Bends, kinks, highway ends, junction crosswalks, and stud placement are now all correct and consistent across every time of
  day and every custom camera checked — this is the headline win of round 2 and it holds up under close (2.5 m) and far
  (380 m) inspection alike.
- Merged geometry stays tight: 10 draw calls for the entire roads group regardless of network size, `gpuMs` ≤ 14.5 ms in
  every shot this round, deterministic, zero `Math.random`, zero console errors across 83 screenshots.
- The lane/connection/snap API remains complete, finite, and now additionally exposes real arc geometry (`bend.radius`,
  `bend.deflection`) that traffic can consume directly instead of working around mitred corners.
