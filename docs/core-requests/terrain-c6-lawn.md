# terrain-c6-lawn: cross-module requests from the lawn fix round (2026-10-09)

Written by the lawn fix builder. Nothing outside `src/terrain/` was edited; both requests below describe a terrain-side
mitigation that is in place and what the owning module could do so the mitigation can be removed.

## Cause (measured)

In lawn mode an isolated stud's side wall rendered about 10x darker than the plate ("dark polka dots", frame 05).
The cause is the post-process ambient occlusion: `src/effects/index.js` GTAO (`AO_PARAMS.radius 0.7`, normals from
depth) composited by `src/effects/grade.js` as `col *= pow(ao, 2.5)`. A 0.17 m wall standing on an open plate sits
wholly inside the 0.7 m radius, half its hemisphere is the plate, and the power curve takes it close to black. On the
full stud grid the same darkening is the "stud texture"; on a sparse lawn every stud becomes a dark puck.

One boot, seed 1, `lawn=1`, street preset, tod 12, only `effects.api.setAO({ intensity: 0 })` changed
(`shots/terrain/c6lawnfix-diag/A-base.png` vs `B-ao0.png`):

| | darkest 1% of the field box (1250,640,600x200), sRGB | far strip (1300,610,300x30) dark fraction |
|---|---|---|
| AO on (as shipped) | (8, 48, 25) | 12.0% |
| AO off | (56, 132, 88) | 3.8% |
| plate (median) | (140, 197, 161) | |

Not the cause: `material.envMapIntensity` on the stud material (x1/0.35 and x3 gave byte-identical frames,
`C-studenv1.png`, `D-studenv3.png`). Side note for whoever owns it: that also means the `GROUND_ENV_MUL` getter in
`src/terrain/index.js` currently has no effect on the picture (three reads `scene.environmentIntensity` when the
material has no own `envMap`).

## Request 1 (effects): do not let the AO term crush small free-standing features

Options, cheapest first:
1. A floor on the composited term for thin features, e.g. `ao = max(ao, aoFloor)` with a floor around 0.45-0.5, or a
   lower `AO_POWER` (2.5 -> about 1.5). Either changes every frame, so it needs its own A/B.
2. An AO exclusion: a second depth target, or a stencil/alpha flag, for meshes that opt out.

Terrain's mitigation meanwhile (lawn mode only, `src/terrain/studs.js`): the two lawn stud meshes use
`depthWrite = false`, `renderOrder` 1 (far) / 2 (near), and their instances are sorted back to front on every rebuild
(re-sort after 2 m of camera travel instead of 6 m). GTAO therefore never sees them. Trade-offs to know about:
- they are still depth-tested, but anything drawn later that lies behind a stud paints over it: transparent surfaces
  (zone plates, the `views` overlay, glass, water) now tint a stud instead of being occluded by it;
- between two re-sorts (2 m of camera travel) a pair of overlapping studs can be drawn in the wrong order;
- an opaque mesh with `renderOrder > 2` would also overdraw them. The other positive values in `src` are 6 and 7
  (`views` overlay), 10 (tool ghosts, the zoning preview box) and 50 (rain); whether each of those materials is
  transparent was not checked;
- the stud grounding now comes from a contact ring in the lawn ground shader (`uLawn.w = 0.18`), not from AO.

## Request 2 (roads): the verge infill studs are depth-writing and stay dark

`markFootprint()` emits the lattice infill on road-typed cells into roads' own stud instancer. With terrain's studs
fixed, those were the remaining dark pucks in 05: every puck in the near half of the field is a roads instance
(`shots/terrain/c6lawnfix-diag/E-hidden.png`: terrain studs hidden, pucks still there; `F-nodepth.png`: terrain studs
light, the same pucks still dark).

Terrain's mitigation meanwhile: `LAWN_VERGE_STUDS = false` in `src/terrain/index.js` makes `terrain.api.studKeep()`
return `false` in lawn mode, so roads emits no infill studs and the verges are tiles only (the same rule the design
gives building yards). Cost: the first road cell(s) beside a kerb carry no studs; in 05 the near half of the field is
bare tiles and the studs start further out. `?lawn=0` is unaffected (`studKeep` is `true`).

To get sparse studs back on the verges, either of:
1. roads hands the infill points to terrain instead of its own instancer (new `terrain.api` entry taking
   `(x, y, z, cellColor)` lists per rebuild), so they join the AO-free lawn meshes: no extra draw; or
2. request 1 is done, after which `LAWN_VERGE_STUDS` goes back to `true` and terrain's depth trick can be dropped.
