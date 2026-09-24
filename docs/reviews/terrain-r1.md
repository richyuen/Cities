# terrain — round 1 critic review

**Score: 5.5 / 10 — FAIL** (pass needs ≥ 8.5, `errors: []`, within perf budget)

Reviewed against `docs/REFERENCE.md` and the five ground-truth images in `docs/reference/` (bright saturated green
baseplates, stud texture readable well into the mid-distance, terraced grey-rock hills, glossy blue water, warm sun with
real shadows). Builder's batch: `shots/terrain/r1/`. My batches: `shots/terrain/r1c/` (default variant),
`shots/terrain/r1c-water/` (`--variant water`), `shots/terrain/r1c-extra/` (13 custom-camera shots: 2 m, 60 m, 120 m,
200 m, 400 m, core `overview`, hills, plateau edge, river bank, map-edge skirt, night, shoreline, island).
Builder PNGs are byte-identical (closeup) or content-identical (default/water) to mine, so both batches were judged.

## Numbers
| batch | minFps | maxDrawCalls (budget 20) | maxTriangles | errors |
|---|---|---|---|---|
| r1 (builder) | 143.8 | 19 | **3 065 602** (closeup 6.5 h) | [] |
| r1c (default) | 142.9 | 19 | **3 065 602** (closeup 6.5 h) | [] |
| r1c-water | 143.0 | 19 | 2 770 338 | [] |
| r1c-extra | 142.9 | 19 | 2 810 600 (60 m) | [] |

- Console errors: **0** in every JSON (36 preset shots + 13 extras). Module status `terrain: ok` everywhere.
- Draw calls: 10–19, inside the 20 budget but with no headroom (9 chunks + shadow pass + studs + water).
- Triangles: **3.07 M at `terrain:closeup`** — the terrain alone exceeds the 3 M full-game ceiling. Overview alone is
  1.5 M (stepped-plate risers). Real studs are 70 000 × 30 tris = 2.1 M. Flagged as a budget failure; must come down.
- `Math.random`: no hits in `src/terrain/`. Folder contains only its own six files. `id`, `deps`, `order 10`, `init/update/
  dispose/showcase`, `showcaseVariants`, presets and all eight `api` functions exist.

## Ranked issues (most damaging first)

1. **Mid/far terrain is washed out to a pale mint — reads as a heightmap demo, not saturated Blox plastic.**
   Where: `r1c/terrain_default-12.png`, `r1c-extra/default-dist-120m.png`, `default-dist-200m.png`, `default-dist-400m.png`,
   `default-plateau-edge.png` (upper half), `default-hills-17h.png`.
   Split of blame: beyond ~600 m the wash is the **core fallback fog** (`fallbackLights.js`: `Fog(…, 600, 3000)`, colour =
   sky lerped 25 % to white) — note for the integrator/environment, not the module. But the desaturation is already
   strong at 100–300 m where fog is zero: that is the module's ground material. `groundMat` keeps clearcoat 0.55 on a
   surface viewed at 30–60°, the shader bumps roughness to 0.62 in the relief branch, and the env-map (RoomLikeSky) sheen
   plus `diffuseColor *= mix(0.9, shade, fade)` flattens the greens toward the sky colour. Compare the reference overview:
   grass stays a punchy brightGreen to the horizon.
   Fix: drop ground clearcoat to ≤ 0.25 and `envMapIntensity` ≈ 0.35 for the ground, do not multiply diffuse by 0.9 in the
   far branch, keep roughness constant (≈ 0.45) instead of jumping to 0.62; put the far studs into a darker contact-ring
   tint rather than a brightness change. Also move `terrain:default` preset closer (camera ≈ 1000 m away, not 1550 m) so
   the showcase is not judged through the core fog; and file a `docs/core-requests/terrain.md` asking for fog start ≥
   1500 m / exponential fog with a less white colour.

2. **Visible near/far stud LOD seam at 64 m chunk boundaries (popping).** Where: `r1c-extra/default-dist-120m.png`
   (diagonal brightness step running from bottom-left through centre), `default-dist-200m.png` (lighter wedge bottom
   centre), `default-plateau-edge.png` (band at top-left), `default-night-60m.png` (upper third). Real instanced studs
   (`StudManager`, radius 170 m, 64 m chunks, 70 k budget) render noticeably brighter/greener than the shader relief
   (`patchGroundMaterial`) that replaces them, so every chunk edge is a hard tone step, and the step moves with the camera
   every 6 m (`moved` threshold 36 m²) — that is popping in motion. Fix: (a) match the two representations — same
   effective albedo, same roughness, same AO ring strength — and verify with a split-screen shot at 120 m; (b) fade the
   real studs out over the last 20 m (scale to 0 or alpha) instead of a binary per-chunk mask; (c) make the shader relief
   fade in by distance, not by chunk mask; (d) re-select chunks per 8 m cell ring rather than 64 m squares.

3. **Water does not read as glossy translucent Blox water.** Where: `r1c-water/terrain_closeup-*.png` (opaque pale-lilac
   sheet, no plates visible beneath), `r1c-extra/water-shore-top.png` (top-down: flat opaque #5aa8f0, nothing under it,
   seabed plates invisible), `water-shore-close.png` and `water-island.png` (regular wave-grid moiré/checker at distance,
   large blobby ripples near), `default-skirt-edge.png` (water turns lavender at grazing angle, stripe aliasing lower
   left), `default-river-bank.png` (river is pale lilac, not transBlue). Opacity 0.86 + `#1a72c8` + ior 1.33 + env 0.4
   gives an opaque milky blue with sky-coloured haze; the sand/blue seabed plates the mesher builds are never seen.
   Fix: use `transmission` (0.6–0.8) with `thickness` ≈ 2 and `attenuationColor` deep blue so the seabed plates and
   their studs show through near the shore; keep `color` closer to Blox transBlue (#6ac6ff-ish, brighter and more
   saturated); reduce `uWaveStrength` to ≈ 1.0 and fade waves out by 150 m (currently `wfade` keys on `fwidth` so the
   grid pattern survives to the horizon and aliases); add a Fresnel-driven sky reflection instead of flat clearcoat.
   No shoreline z-fighting seen (WATER_OFFSET −0.12 works) — keep that.

4. **Hills read as contour-map noise, not Blox terraces.** Where: `r1c-extra/default-hills-17h.png`,
   `default-dist-400m.png` (upper strip), `default-core-overview.png` (top). Every slope is built from 0.4 m plate steps at
   2 m or 4 m sub-plate resolution (`cellCode` 2/4), so a 25 m hill becomes ~60 concentric 0.4 m ledges whose 0.9/0.68
   riser shading produces a scribble of thin green/grey lines with no readable shadow or silhouette. The reference hills
   are a handful of tall grey rock terraces (1–3 brick heights) with green tops. Fix: quantize hill slopes to brick
   height (0.96 m) or 3 plates (1.2 m) above ~8 m altitude and keep 0.4 m only on the plains; render tall risers (≥ 1.2 m)
   with real side geometry that receives shadow and give them a darker vertex tint (0.55) so the terrace edge reads;
   enable `castShadow` only for chunks with ≥ 1.2 m drops (already there) but make the drops big enough to matter.

5. **Over the triangle budget.** `terrain:closeup` = 3.07 M triangles, water variant closeup 2.77 M, plain 60 m shot 2.81 M.
   Studs: 70 000 × 30 tris; the stud geometry is a 10-side (8 in code: `CylinderGeometry(…, 8, 1, true)` + 8-seg cap) open
   cylinder — still 30 tris each. Ground: risers are emitted per sub-plate edge on both sides of every step
   (`edgeRisers` from each piece), so shared steps get double geometry. Fix: 6-sided stud with a single-quad top (≈ 16
   tris) or an impostor stud (billboard quad + normal) beyond 40 m; cap `MAX_STUDS` at 40 k; emit risers only from the
   higher piece; skip risers below the water surface. Target ≤ 1.2 M for terrain alone.

6. **Diorama skirt is bright blue, not a dark base.** Where: `r1c-extra/default-skirt-edge.png` (map edge = saturated blue
   gradient), `r1c/terrain_default-*.png` (right edge). `edgeRisers` colours the skirt with the edge cell's colour
   (brightBlue seabed) × 0.42 — a lit blue wall. Fix: give skirt quads a fixed darkStoneGrey/black colour and normal, add a
   1–2 plate lip of the same dark colour around the top edge so the slab reads as a display base.

7. **`terrain:default` and core `overview` compositions are flat and map-like.** Where: `r1c/terrain_default-12.png`,
   `r1c-extra/default-core-overview.png`. Relief is invisible from 800 m: the 4 m plateau, the flood plain and the hills
   have no shadowed edges, so the image is a 2-D colour map (green with darker blobs, a beige river outline). Good
   ingredients (river meander, bay, plateau, woods, rock patches) but no depth. Fix: items 1 and 4 plus a 2–3 plate
   raised rim on the plateau so downtown reads as a table; slightly larger, less speckled wooded patches (the `n > 0.34`
   patches are 1–3 cells and look like noise dots at overview).

8. **Sunlight never shows on the terrain.** No cast shadows are visible in any daylight PNG (steps are 0.4 m; studs
   `castShadow=false`), and at 6.5 h the ground sheen blows out to white (`r1c/terrain_water-6h5.png`, right).
   Partly core (fallback sun, no CSM yet), but the module can help: studs casting shadows within 60 m, larger terrace
   steps (item 4), lower clearcoat (item 1).

9. **Code / API nits.** (`src/terrain/index.js`)
   - `generate()` and `updateWaterTypes()` write `cell.type = 'water'` directly without `world.setCell` → no `world:cell`
     event; other modules (zoning/roads) cannot react. Use the mutator or emit the event.
   - `dispose()` does not restore `cell.type` for the water cells it flipped, nor `world.seaLevel`; after a showcase swap
     the world keeps stale water cells.
   - `rebuildRegion(i0,j0,i1,j1)` does not order min/max like `flatten` does; passing i1 < i0 silently rebuilds nothing.
   - `isBuildable` returns true for `road`/`building` cells (only water is excluded) — fine if intended as "terrain OK",
     but document it. `flatten` is correct: quantizes to PLATE, writes (i1+1, j1+1) vertex ring, refreshes cell heights
     for the 1-cell halo and emits `terrain:changed`; flattening below sea level will create water cells (by design).
   - Event cleanup is correct (`S.unsub` unsubscribes both listeners; textures, geometries, materials, cache entries
     disposed). `showcase()` with an unchanged variant rebuilds all 9 chunks + water + studs — cheap enough, but avoidable.

## What already works
- The near field is genuinely Blox: real instanced studs at 0.8 m pitch with correct radius/height, per-plate colours,
  terraced plate edges with risers (`r1c-extra/default-close-2m.png`, `default-plateau-edge.png` lower half,
  `r1c/terrain_closeup-12.png`). This is the right foundation.
- Colour banding logic is sound: tan beaches/river banks, brickYellow patches, dark-green woods, lime meadows, grey rock
  on steep bands, blue seabed shelf — visible and deterministic (`r1c-water/terrain_default-12.png`, islands ringed with sand).
- Engineering is solid: zero console errors across 49 captures, 143 fps, 9-chunk regional rebuild with dirty tracking,
  stud cache per chunk, no shoreline z-fighting, shader patches use `customProgramCacheKey`, `rng.fork('terrain')` used
  once and `fbm` everywhere instead of `Math.random`.
