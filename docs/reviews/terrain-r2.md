# terrain — round 2 critic review

**Score: 7.2 / 10 — FAIL** (pass needs ≥ 8.5, `errors: []`, within perf budget)

Reviewed against `docs/REFERENCE.md` and the five ground-truth images in `docs/reference/`. Builder's round-2 batches
(`shots/terrain/dev-r2-2.png`, `dev-r2/*`, `r2-dev/`, `r2-dev-water/`) inspected but not relied on for scoring; my own
batches: `shots/terrain/r2c/` (default variant, `critic.mjs --round 2c`), `shots/terrain/r2c-water/` (`--variant
water`), `shots/terrain/r2c-extra/` (28 custom-camera shots: 2/60/120/200/400 m over the same patch, a top-down and
oblique view across the stud fade ring, a 4 m camera-move pop-check either side of the fade radius, a shoreline at
10 m and top-down, a plateau edge + far rim, hills at 12h/18h + close-up, the skirt edge, core `overview` at 12h/18h,
water-variant shore/island/bay shots, `?bare=1` terrain-only shots for every preset, and the full-game `overview` at
12h/21.5h). Every PNG produced was opened and inspected.

## Numbers
| batch | minFps | maxGpuMs | maxDrawCalls | maxTriangles | errors |
|---|---|---|---|---|---|
| r2c (default, lit showcase) | 60.9 | 16.03 | 58 | 2,064,680 | [] |
| r2c-water (water variant, lit) | n/a¹ | 13.25 | 52 | 1,369,144 | [] |
| bare `?bare=1` (terrain only, all presets) | — | ~0.4 | **19** | **1,038,316** | [] |
| bare-w `?bare=1` (water variant) | — | — | ≤15 | 726,300 | [] |
| custom extras (28 shots) | — | 4.2–13.7 | 37–51 | 0.5M–1.65M | [] |
| full-game overview 12h/21.5h | — | 6.2/7.2 | 48/51 | 1.20M/1.32M | [] |

¹ One capture in the middle of the water-variant batch hit a Vite HMR reload from another module's mid-edit (another
critic's note warned this would happen); two of the twelve shots in that run logged a nonsensical negative `fps`
(`-303`, `-909`) because the frame counter reset under the tool mid-sample, while `gpuMs` for those same frames stayed
sane (7–8 ms) and `errors` stayed `[]`. Re-running those two shots individually confirmed 90–130 real fps / 7–8 ms
gpu. This is a tooling artifact of the reload, not a terrain regression — flagging per the brief's "rerun a batch if
it dies" note rather than scoring it as a failure.

- **Console errors: 0** across every JSON this round (48 preset shots + 28 extras + 12 bare shots + 2 full-game).
  `modules: {terrain: "ok", environment: "ok", effects: "ok"}` throughout.
- **Triangle/draw-call budget: PASS.** The brief asks this be checked via `?bare=1` (terrain module alone, no
  environment/effects overhead). Bare batch: **max 19 draw calls, max 1,038,316 triangles** — inside the builder's
  claimed ≤ 20 / ≤ 1.06 M and inside the ARCHITECTURE §7 terrain budget of 20 draw calls. This is a large
  improvement over r1's measured 3.07 M triangles / 19 draw calls (r1 did not separate terrain-only via `bare`, but
  the fix — 6-sided far studs, single higher-side riser emission — is visible in `src/terrain/studs.js` and
  `mesher.js` and confirmed by the number). Lit-showcase totals (58 draw calls, 2.06 M tris at `terrain:closeup`) are
  environment/effects overhead (sky, 3 CSM cascades, post) layered on top, not terrain's own budget, and stayed
  within the full-game gpuMs ≤ 20 ceiling (max 16.03 ms).
- `Math.random`: no hits in `src/terrain/`. Folder contains exactly its own six files (`data.js`, `heightgen.js`,
  `index.js`, `mesher.js`, `shaders.js`, `studs.js`). `id`, `deps: []`, `order: 10`, `init/update/dispose/showcase`,
  `showcaseVariants: ['default','closeup','water']`, three presets, and all eight documented `api` functions exist
  and behave as documented.
- **Dispose correctness: verified in code.** `dispose()` now flips every cell in `S.waterCells` back to `'none'` via
  `world.setCell` and restores `world.seaLevel = S.seaLevel0` before clearing state — the r1 "stale water cells after
  showcase swap" bug is gone. Geometries/materials/textures are all disposed (`ch.mesh.geometry`, `S.water.geometry`,
  `S.studs.dispose()`, `S.studMaskTex`, `S.heightTex`, three cached materials).

## Round-1 issues verified this round
1. **Mid/far wash to pale mint** — **mostly fixed.** `groundMat` clearcoat dropped 0.55→0.2, `GROUND_ENV_MUL` scales
   envMapIntensity to 0.35, and the far-branch brightness multiply is gone. `r2c-extra/default-patch-60m.png` /
   `-120m.png` / `-200m.png` (same patch, same azimuth, increasing distance) keep a punchy saturated green out to
   200 m with only mild aerial-perspective lightening — a big step up from r1's washed heightmap look. The residual
   wash starting around 500-800 m out (`r2c/terrain_default-12.png` upper half, `r2c-extra/default-core-overview-12
   /18.png` top) is the core fallback fog band r1 already attributed to `fallbackLights.js`/`environment`, confirmed
   unaffected by the module's own material change — no `docs/core-requests/terrain.md` has been filed yet for it,
   which the r1 review asked for; still missing.
2. **Near/far stud LOD seam / popping** — **fixed.** `r2c-extra/default-fadering-top.png` (top-down over the full
   130–170 m fade ring) and `-oblique.png` show no ring or brightness step; `default-popcheck-a.png` vs
   `-popcheck-b.png` (camera moved 4 m across the fade edge) are visually identical — the real-stud shrink and the
   shader-relief fade-in are matched in albedo/AO now, and the per-cell radial pick smooths the transition. Confirmed
   at the exact `uStudFade` band width (40 m) called out in r1.
3. **Water not reading as glossy translucent plastic** — **mostly fixed.** `patchWaterMaterial` now uses Beer-Lambert
   depth attenuation from the real height-field seabed plus a Fresnel term instead of a flat opaque colour.
   `r2c-water/terrain_water-12.png`, `r2c-extra/water-shore-10m.png` and `water-island.png` clearly show sand shelves
   and darker seabed plates through shallow water, a convincing gradient into saturated blue in the depths, and a
   sky-reflecting Fresnel rim at grazing angles (`water-bay-grazing.png`) with no visible tiling moiré at distance.
   Shoreline z-fighting still absent. Minor residual nit: `r2c-water/terrain_water-6h5.png` and `-18.png` show the
   water going a slightly flat pale lilac-white directly under a low sun (bloom/exposure interaction, likely shared
   with `environment`), not the milky-opaque problem from r1.
4. **Hills reading as contour-map noise** — **partial.** `heightgen.js#stepFor` now quantizes hills/steep slopes
   (h > 7 m or slope > 0.06) to brick height (1.2 m) instead of 0.4 m plates, and `mesher.js#riser` darkens tall
   risers. `r2c-extra/default-hills-12h.png` / `-18h.png` and `default-hills-close.png` show visibly bigger, more
   legible terrace bands than r1's hairline scribble — real progress — but the terrace faces still don't cast or
   receive a strong shadow (see #8 below), so from a distance the hills still read as a purple/grey/green isoline
   pattern rather than the reference's blocky sunlit rock terraces. Not yet a "handful of tall rock terraces."
5. **Over triangle budget** — **fixed**, see Numbers above (bare: 1.04 M tris / 19 draw calls, under the 1.06 M/20
   the builder claimed and under ARCHITECTURE's 20-draw-call terrain budget).
6. **Diorama skirt bright blue** — **fixed.** `skirtColor` is now `#0b1119` (near-black navy) with a lip; confirmed
   dark and edge-lit correctly in `r2c-extra/default-skirt-edge.png` and visible at the map edge in
   `default-core-overview-12.png`. Reads as a display base now, not a lit water wall.
7. **`terrain:default`/core `overview` flat and map-like** — **partial.** Colour banding (river meander, plateau
   apron, hill masses, ponds) is more legible than r1 thanks to items 1 and 6, and the plateau rim is a bit more
   readable at `default-plateau-rim-far.png`. But `default-core-overview-12/18.png` and the full-game
   `game-overview-12/21h5.png` still read close to a 2-D colour map from altitude — no cast shadow gives the plateau
   or hill masses a sense of height, so relief still depends entirely on colour, not form. Still open.
8. **No visible sun shadows on terrain** — **still open.** Across every daylight shot this round (closeups, patch
   shots at all distances, plateau edge, hills at 12h/18h, both overviews) no terrace riser, however tall, casts a
   legible shadow onto the plate beside it, even where `rebuildChunk` sets `castShadow = true` for chunks with > 1.2 m
   drop. This is very likely tangled up with `environment`'s CSM issues already flagged in `environment-r1.md` (far
   cascade texel size, shading light floored ≥ 2.5°), but the module could help more on its own side: the tallest
   risers in this map are still only 1.2 m (one brick) over a run that can be 8 m of sub-plate width, which is a
   shallow enough wall that even a working shadow map would show only a thin sliver at low sun angles. Combined with
   #4, this is the main thing keeping hills/plateau from reading as physically-lit Lego terraces.
9. **Code nits** — **fixed.** `updateWaterTypes` now calls `world.setCell(...)` (emits `world:cell`); `dispose()`
   restores flipped water cells to `'none'` and resets `world.seaLevel`; `api.rebuildRegion` calls `clampRegion`
   before use so unordered corners work. Verified by reading `src/terrain/index.js` directly (see call sites for
   `updateWaterTypes`, `dispose`, `rebuildRegion`).

## Fresh judgement against the reference
The near field is genuinely Lego and now holds its saturation much further out — walking the same patch from 2 m to
200 m (`r2c-extra/default-patch-*.png`) no longer shows the r1 "heightmap demo" wash, and the water finally looks like
tinted plastic over visible seabed plates rather than an opaque lilac sheet. The skirt reads as a proper display base.
Set against the reference's punchy, physically-lit rock terraces and sun-raked baseplate, though, this still falls
short in exactly the two related ways flagged above: relief at anything beyond ~50 m depends on colour banding alone
because terrain never casts a shadow on itself, and hill slopes — even after brick-quantization — still read as
banded isolines rather than blocky sunlit steps. That keeps the overview and the hills in "good indie, clearly lower
fidelity" territory rather than AAA-with-nits, even though the ground-level material and water fixes are a real,
measurable step up from round 1.

## Ranked issues (most damaging first)
1. **No cast shadows anywhere on terrain, at any sun angle** (`r2c-extra/default-plateau-edge.png`,
   `default-hills-18h.png`, both `default-core-overview-*.png`, `game-overview-*.png`) — relief still reads only
   through flat colour, not light. Likely shared with `environment`'s CSM cascade problems (see
   `environment-r1.md`), but the module's own terraces are also shallow (max 1.2 m over wide runs); raising the
   riser height on hill crests (e.g. 2–3 plates minimum drop before a new terrace is cut) would give any shadow map a
   thicker wall to render.
2. **Hills still read as banded isolines, not blocky rock terraces** (`default-hills-12h.png`, `-18h.png`,
   `default-hills-close.png`) — brick quantization helped, but there is no strong AO/shading differentiation between
   terrace tread and riser at a distance, so the purple/grey rock patches look like a topographic map fill rather
   than stacked stone. Tie a stronger fixed vertex-colour darkening (not just the existing 0.08–0.2 riser tint) to
   riser height, and consider merging adjacent same-height terraces across more than one sub-plate so hills don't
   keep so many distinct bands.
3. **Overview-altitude compositions still flat/map-like** (`default-core-overview-12/18.png`,
   `game-overview-12h/21h5.png`) — a direct consequence of #1; once terrain can cast a visible shadow at these
   distances this should mostly resolve itself.
4. **No `docs/core-requests/terrain.md` filed** for the core fallback-fog wash beyond ~600 m that r1 asked for —
   process nit, not a visual regression (the module's own material fix already did most of the work), but the request
   is still outstanding and the wash is still visible in `default-core-overview-12.png` and
   `game-overview-12.png`'s far ridgeline.
5. **Minor: water goes flat pale-lilac directly under a low sun** (`r2c-water/terrain_water-6h5.png`, `-18.png`) —
   much less severe than r1's opaque-milk problem, likely a bloom/exposure interaction at the sun-glint angle rather
   than the water material itself; worth a quick look next round but not blocking.

## What already works well (new or reconfirmed)
- Water is now the strongest part of the module: real depth-based translucency, visible seabed/sand through shallows,
  a Fresnel sky-reflection rim, and no tiling aliasing at distance (`r2c-water/terrain_default-12.png`,
  `r2c-extra/water-island.png`).
- The stud/relief LOD system is seamless under both a static top-down view and a 4 m camera nudge straddling the fade
  ring — a real fix, not just a smaller symptom.
- Engineering: zero console errors across 90 captures this round, terrain-only budget solidly inside both the
  builder's claim and the ARCHITECTURE ceiling, dispose leaves no stale water cells, event-based cell mutation now
  used everywhere, `rng.fork('terrain')`/`fbm` only (no `Math.random`).
