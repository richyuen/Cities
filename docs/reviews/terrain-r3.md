# terrain — round 3 critic review

**Score: 7.4 / 10 — FAIL** (pass needs ≥ 8.5, `errors: []`, within perf budget)

Reviewed against `docs/REFERENCE.md` (no `docs/reference/` images present). Builder's round-3 batches inspected but not
relied on for scoring: `shots/terrain/r3-dev/` (16 preset shots + summary), `r3-bare/` (3), `r3-custom/` (4:
hillside-9h/17h, plateau-edge-9h/17h), `r3-game-overview-12/21h5.png`. My own batches: `shots/terrain/r3c/` (12,
`critic.mjs --round 3c`), `r3c-water/` (12, `--variant water`), `r3c-bare/` (3, terrain-only via `?bare=1`),
`r3c-rimcheck/` (23 custom-camera shots built with `tools/shot.mjs`'s `openApp`, targeting the exact plateau-rim and
hill-terrace geometry at true grazing-sun times, both close-range and top-down), plus a stud-shadow control test.
Every PNG produced was opened and inspected.

## Numbers
| batch | minFps | maxGpuMs | maxDrawCalls | maxTriangles | errors |
|---|---|---|---|---|---|
| r3c (default/closeup/water, lit showcase, 12 shots) | 85.2 | 10.77 | 58 | 2,788,174 | [] |
| r3c-water (water variant, lit, 12 shots) | 143 | 6.34 | 54 | 1,856,990 | [] |
| r3c-bare (`?bare=1`, terrain-only, 3 presets) | — | — | **18** | **1,320,688** | [] |
| builder's r3-bare (own numbers, for cross-check) | — | — | 19 | 1,370,214 | [] |
| r3c-rimcheck (23 custom shots: rim/hillside close-range + top-down, both sun sides, stud-shadow control) | — | 3.29–8.4 | — | — | [] |
| builder's `r3-game-overview-12/21h5.png` (re-verified) | — | 6.07/6.54 | 48/51 | 1.80M/1.98M | [] |

- **Console errors: 0** across every JSON this round (12 + 12 + 3 + 23 + 2 = 52 captures). `modules: {terrain: "ok",
  environment: "ok", effects: "ok"}` throughout.
- **Triangle/draw-call budget: PASS, but the increase needs a caveat.** Bare terrain-only: **max 18 draw calls,
  1,320,688 triangles** (my numbers) / builder's own bare batch: **19 draw calls, 1,370,214 triangles** — both inside
  the 20-draw-call terrain budget (`ARCHITECTURE.md` §7) and nowhere near the full-game 3 M triangle ceiling (full-game
  `overview` re-shot this round: 1.80 M / 1.98 M triangles, 48–51 draw calls, well under 3 M / 1500). This is a real
  ~29% triangle increase over r2's 1.04 M, from the new grout-band and tread-AO-strip geometry
  (`src/terrain/mesher.js` `GROUT_MIN_DROP`/`treadAO`, gated to drops ≥ 0.7 m so it doesn't spread over every gentle
  plains ripple) plus the new BRICK2 (2.0 m) riser tier. It is within budget and the extra geometry does earn its
  keep visually (see below) — but see ranked issue #4: this cost is currently buying *baked* shading, not the actual
  cast shadow it was meant to support, so it may need re-tuning once real shadows work.
- `Math.random`: no hits in `src/terrain/` (grep clean). Folder contains exactly its own six files (`data.js`,
  `heightgen.js`, `index.js`, `mesher.js`, `shaders.js`, `studs.js`). `id`, `deps: []`, `order: 10`,
  `init/update/dispose/showcase`, `showcaseVariants: ['default','closeup','water']`, three presets, and the documented
  `api` functions (`flatten`, `isBuildable`, `rebuildRegion`, etc.) all exist and behave as documented.
- **Dispose correctness: verified in code, unchanged from r2's fix.** `dispose()` flips every `S.waterCells` entry
  back to `'none'` via `world.setCell`, restores `world.seaLevel`, and disposes every geometry/material/texture
  (`ch.mesh.geometry`, `S.water.geometry`, `S.studs.dispose()`, `S.studMaskTex`, `S.heightTex`, three cached
  materials). No regression.
- **`docs/core-requests/terrain.md`: filed this round** (the r2 ask). Documents the core fallback-fog wash
  (`src/core/fallbackLights.js`'s `THREE.Fog(0xb9d3ee, 600, 3000)`) with a concrete proposed diff and correctly notes
  it's out of `src/terrain/`'s ownership.

## The central question this round: do terraces now cast real, legible cast shadows?

**No — this is not fixed, and I want to be precise about why, because a surface read of the builder's own
`r3-custom/hillside-9h.png` vs `-17h.png` looks convincing at first glance.** Those two shots (default camera,
`tod=9` vs `tod=17`) show strongly banded, terraced hillsides that *look* physically shaded. But comparing the two
images structurally (not just their overall warm/cool colour grading) shows the dark/light band **positions are
pixel-for-pixel identical** between morning and afternoon sun — which a real cast shadow, whose length and side flip
with the sun's azimuth, cannot produce. That match is consistent with `src/terrain/mesher.js`'s new baked riser
shading: `GROUT_DARK` (a fixed 0.55 brightness band at every riser's top edge, explicitly "independent of any
real-time shadow" per the code comment), `treadAO` (a fixed 12%-darker vertex-colour strip on the tread beside a
riser), and the `tall`-scaled `fTop`/`fBot` riser-face brightness — all constants that do not depend on light
direction at all.

To settle this definitively I ran a controlled A/B test, bypassing the ambiguity of a single default-camera shot:

1. **Located the exact plateau rim** via `window.__city.world.getHeight(x,z)` probes (not guesswork): the default
   variant's plateau top sits at a flat 4.8 m for `r4 < 260` and drops to a 1.6 m apron by `r4 ≈ 280`, confirming the
   rim is a real, findable ~2–3.2 m cliff, not a gentle ramp.
2. **Parked a custom camera** (`tools/shot.mjs`'s `openApp` + `window.__city.setCamera({pos,target})`) 50–70 m from
   the **south-facing** segment of that rim (`x=0, z≈-265`, outward normal `(0,0,-1)`) — a wall whose orientation
   means it is self-shadowed (or fully lit) essentially all day depending on the sun's `z`-component, giving a clean,
   glare-free test independent of the camera-vs-sun-azimuth alignment problems that plagued my first few attempts
   (`r3c-rimcheck/east-rim-*.png`, which stared straight into the sun at low azimuth and were unusable).
3. **Shot the same close-range framing at true opposite grazing-sun times**, `tod=6.6` and `tod=17.4`
   (`r3c-rimcheck/south-close2-6h6.png` vs `-17h4.png`). **The two renders are visually identical** — same wall-face
   brightness, same flat, evenly-lit tread right up to the wall base, **no shadow band anywhere on the ground**, no
   self-shadow darkening on the wall face itself. I repeated this at `tod=7.5/9/12/15/17/17.5` and from directly
   overhead (`r3c-rimcheck/south-hi-*.png`, elevated 150 m) — same result every time: the rim reads as, at most, a
   hairline grout seam, never a cast shadow.
4. **Control test — does the shadow pipeline work at all near terrain?** `r3c-rimcheck/studs-close-6h8.png` vs
   `-17h2.png`: a close (2–3 m), grazing-sun shot of the real (non-shrunk) instanced ground studs. Here, **individual
   studs unambiguously cast real, elongated, direction-dependent shadows onto neighbouring studs and the ground**,
   and the shadow direction visibly flips between the two times. This proves CSM shadow mapping is fundamentally
   functional in this build (likely `environment`'s system, confirmed working per `environment-r2.md`'s own
   close-range shadow tests) — the studs mesh (`S.studs`, a separate InstancedMesh) receives and casts real shadows
   just fine. **The terrain ground mesh's own riser walls do not**, at the same distance, under the same light. That
   contrast — one mesh in the same scene shadows correctly, the other never does — is the most actionable lead for
   next round: compare `S.studs`' shadow-relevant settings/geometry against `ch.mesh`'s (`src/terrain/index.js`
   sets `ch.mesh.castShadow = true` and `receiveShadow = true` unconditionally per chunk, so the flags are right;
   the defect is more likely in the merged-chunk geometry itself, e.g. per-vertex normals on riser quads, chunk
   bounding-volume computation feeding shadow-camera frustum culling, or something chunk-specific that excludes
   these quads from the shadow depth pass).

So: **the #1 issue from r2 ("no cast shadows on terrain at any sun angle") is still open**, verified more rigorously
than a glance at the builder's own hillside shots would suggest. What genuinely improved is baked terrace
*legibility* — a real, worthwhile change, just not the thing the issue asked for.

## Is the plateau rim's shadow legible? (builder's specific worry)

Moot given the above — it casts no shadow at all, real or baked-shadow-like, from any distance. What legibility it
has comes entirely from the baked grout/riser darkening at close range (`r3c-rimcheck/south-close2-*.png`: the wall
reads clearly as a raised ledge at 50–70 m, ground level). From altitude or at the ~830 m distance of the
`terrain:default` preset, the rim is a hairline at best (`r3c-rimcheck/south-hi-*.png`, `overview-*.png`) — not
"shallow," effectively invisible. The builder's instinct that the rim (2–3.2 m) might be a remaining gap was right,
but the deeper problem is that no terrain riser of any height casts a shadow yet, so height alone won't fix it.

## Round-2 issues re-verified this round
1. **No cast shadows** — **still open**, see above (was ranked issue #1 last round).
2. **Hills read as banded isolines, not rock terraces** — **improved, now closer to a wash than a fail.** The new
   BRICK2 (2.0 m) crest tier, grout band, and tread-AO strip (`heightgen.js#stepFor`, `mesher.js#riser`/`treadAO`)
   give hillsides genuinely blockier, higher-contrast terrace bands at close-to-mid range
   (`r3-custom/hillside-9h.png`/`-17h.png`, `r3c/terrain_closeup-*.png`) — a real step up from r2's hairline
   scribble. Still baked, not lit, so it doesn't hold up from altitude, but as a close-range cue it now reads as
   "terraces," which is what this issue asked for.
3. **Overview/game-altitude compositions still flat/map-like** — **still open**, direct consequence of #1.
   `r3-dev/terrain_default-12.png` and the full-game `r3-game-overview-12.png`/`-21h5.png` still read almost entirely
   through colour banding (river, plateau apron, hill masses) with no shadow giving height any sense of form.
4. **No `docs/core-requests/terrain.md` filed** — **fixed**, filed this round with a specific, actionable diff
   proposal for `fallbackLights.js`'s fog range.
5. **Water flat pale-lilac under low sun** — **fixed.** `r3c-water/terrain_water-6h5.png` and
   `r3-dev/terrain_water-6h5.png` show a convincing grazing sun-glint, blue-grey depth gradient, and a clean island
   silhouette — no trace of the milky/lilac wash. Good.

## Ranked issues (most damaging first)

1. **No cast shadows anywhere on terrain, at any sun angle — confirmed unresolved by direct A/B test, not just
   unchanged.** (`r3c-rimcheck/south-close2-6h6.png` vs `-17h4.png` — pixel-identical; `builder-default-cam-6h6.png`
   vs `-17h4.png` — same hill terrace pattern at opposite sun azimuths). This is the module's #1 problem for a third
   round running. Fix direction: the CSM pipeline itself works (studs shadow correctly, `r3c-rimcheck/studs-close-*`)
   so this is very likely specific to the merged per-chunk ground geometry in `mesher.js`/`index.js` — check riser
   quad normals, chunk bounding-sphere/box computation (shadow-camera frustum culling could be dropping these
   chunks from the depth pass even though `castShadow=true` is set), and whether `receiveShadow` chunks are actually
   being submitted to the shadow map render list.
2. **Baked riser/grout shading can visually pass for "fixed" at a glance, masking issue #1.** The new BRICK2 tier +
   grout + tread-AO (`mesher.js`) makes terraces look convincingly lit in a single screenshot, but is provably
   static across time-of-day (see A/B test). Risk: a less rigorous check next round could mark this issue resolved
   when it isn't. Recommend the integrator explicitly diff two opposite-sun-angle shots of the same camera before
   closing this issue, not just eyeball one.
3. **Overview/game-altitude compositions still map-like** (`r3-dev/terrain_default-12.png`,
   `r3-game-overview-12/21h5.png`) — direct consequence of #1; will likely resolve largely on its own once real
   shadows render.
4. **Triangle cost (+29% over r2) is currently paying for baked shading rather than the real shadow it was meant to
   support.** Still comfortably within budget (18–19 draw calls, 1.32–1.37 M tris, vs. the 20-call/3 M ceilings), so
   not a fail on its own, but worth re-tuning `GROUT_MIN_DROP`/`AO_W` once real cast shadows work, in case the two
   effects end up redundant or need rebalancing against each other.
5. **Minor, not re-verified this round in isolation:** `r2`'s note about water going slightly flat under a
   sun-glint at low angle — no longer visible as a problem; downgraded off the list, see "what works."

## What already works well (new or reconfirmed)
- Water is fully fixed at low sun: convincing sun-glint, seabed/sand depth gradient, Fresnel rim, clean island
  silhouettes, no more pale-lilac wash (`r3c-water/terrain_water-6h5.png`).
- Close-to-mid-range terrace legibility is a real, worthwhile improvement: BRICK2 tall risers + grout line + tread
  AO strip make hillsides and the plateau rim read as blocky terraces rather than isoline scribbles when viewed
  within ~100 m (`r3-custom/hillside-*.png`, `r3c-rimcheck/south-close2-*.png`).
- Engineering: zero console errors across 52 captures this round, terrain-only draw-call/triangle budget inside both
  the builder's claim and the ARCHITECTURE ceiling, dispose leaves no stale water cells, `core-requests/terrain.md`
  filed with a concrete proposed diff, `rng.fork('terrain')`/`fbm` only (no `Math.random`).
- The shadow *pipeline* itself is confirmed functional close to terrain (instanced studs cast real, direction-
  correct shadows) — this narrows next round's fix to the ground mesh specifically rather than a full CSM
  investigation.
