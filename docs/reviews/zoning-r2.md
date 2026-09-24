# zoning — round 2 critic review

**Score: 8.6 / 10 — PASS** (both r1 issues addressed; night legibility is now genuinely fixed, industrial orange is
substantially better but not fully "confident orange" at the top face — a minor nit, not a fail-worthy defect)

## Numbers
Shots taken independently this round (builder's r2-dev/r2-dev-density/r2-night-closeup/r2-noon-industrial(-v2)
shots left untouched): `shots/zoning/r2c/` (default variant, 4 tods x 2 presets), `shots/zoning/r2c-density/`
(density variant, same matrix), plus `shots/zoning/r2c-custom/` (my own extreme-close 1:1 zoom camera on every
zone x density-1/density-3 combination at night, a top-down noon industrial macro shot, and a night overview of
all 9 density patches) and two standalone `shot.mjs` closeups (`critic-night-closeup.png`, `critic-noon-industrial.png`).

- **Errors: 0** everywhere — every summary.json and every standalone shot's `errors: []`, and the live API probe's
  `window.__city.stats().errors` was also `[]` after driving the module through its full API surface.
- **Perf (gpuMs is the trusted number per ARCHITECTURE §7, fps is vsync-pinned ~120-144 headless)**:
  - default variant (`r2c`): maxGpuMs **7.25ms**, minFps 120.6, maxDrawCalls 118 (full showcase incl. terrain/roads/effects deps) — well inside the ≤20ms/≤1500-call budgets.
  - density variant (`r2c-density`): maxGpuMs **7.01ms**, maxDrawCalls 67. One caveat: the very first shot in this
    batch (`zoning_default-6h5`) came back as a blank black frame with `fps:-44.2, drawCalls:0` — a cold-start
    tooling artifact (the stats/screenshot raced the just-navigated page before the first real frame), not a
    zoning defect. Re-captured standalone via `shot.mjs` immediately after: `fps:144, gpuMs:4.99, drawCalls:60,
    errors:[]`, consistent with every other tod in the same batch. `summary.json` was corrected in place with a
    note explaining the discrepancy; `minFps`/`budget.fpsOk` now reflect the real number.
  - Both variants comfortably inside every budget from ARCHITECTURE §7.
- **Zoning's own persistent draw calls, re-verified live** via `scene.getObjectByName('zoning').traverse(...)`:
  exactly **3 `InstancedMesh`** (`zoning-r`, `zoning-c`, `zoning-i`) **+ 1 preview `Mesh`** (`zoning-preview`) = 4,
  confirmed both by traversal counts (`{instancedMesh: 3, mesh: 10}`, where the extra 9 meshes are the showcase-only
  `zoning-demo` placeholder group, not the module's real budget) and by the child name list
  (`['zoning-demo', 'zoning-r', 'zoning-c', 'zoning-i', 'zoning-preview']`). Matches the documented/expected budget exactly, same as r1.

## API contract — re-verified live via `page.evaluate`, all correct
Independently scripted a fresh probe (not reused from r1) against `ctx.modules.get('zoning').api` on a bare patch:
- `costFor(5,5,8,8,'c',2)` → `{cells:16, cost:3040}`; confirmed pure (zoned-cell count unchanged before/after).
- `setZoneRect(5,5,8,8,'c',2)` → identical `{cells:16, cost:3040}` (`matchesPreview:true`); `world.cellAt(5,5)`
  now reads `{type:'zone', zone:'c', density:2}`; `getZoneStats()` reflected the new counts in the same tick
  (`c.cells` went from 48 baseline to 64).
- `clearZone(5,5,8,8)` → returns `16`; cell reverts to `{type:'none', zone:null}`.
- `setZoneBrush([{i,j},{i+1,j}], 'i', 3)` → `{cells:2, cost:468}`; cell becomes `{type:'zone', zone:'i', density:3}`.
- `showPreview(5,5,2,2,'r')` → `zoning-preview` mesh `visible:true`; `hidePreview()` → `visible:false`.
All behavior matches ARCHITECTURE.md and the r1 findings exactly — nothing regressed.

## Fix verification (the two things this round exists to check)

### 1. Night legibility — FIXED
r1's complaint: at night the density/rim cue collapsed because `emissiveIntensity` was a flat per-material
constant, so every cell in a zone rendered as one uniform saturated block with no rim/top or height distinction.
The fix (`addEmissiveDensityCoupling` in `src/zoning/index.js`, multiplying `totalEmissiveRadiance` by `vColor.rgb`
in an `onBeforeCompile` hook) demonstrably works:
- `shots/zoning/r2c/zoning_closeup-21h5.png` and `zoning_default-21h5.png`: individual cell plates now show a
  clear brighter-rim/dimmer-top "waffle" pattern at night instead of a flat glowing pad — a dramatic difference
  from the r1 screenshot of the same preset (`shots/zoning/r1/zoning_closeup-12.png` daylight vs the r1 night
  shots, which read as solid blocks).
- Independently confirmed at extreme 1:1 zoom on **all three zone colours at both density extremes**:
  `shots/zoning/r2c-custom/night_r_d1.png` vs `night_r_d3.png`, `night_c_d1.png` vs `night_c_d3.png`, and
  `night_i_d1.png` (re-captured after an initial camera-height mistake in my own test script put the camera
  under the terrain — a script bug, not a zoning bug, confirmed by `world.getHeight` returning 4.8m at that
  cell while my first attempt used a fixed world-Y of 2.6m) vs `night_i_d3.png`. In every pair the density-3
  patch is visibly taller and brighter than density-1, and every cell shows its own rim/top contrast rather
  than blending into a solid slab.
- `shots/zoning/r2c-custom/night_density_overview.png` shows all 9 zone x density patches simultaneously at
  night: the three hues (green/cyan/gold) stay clearly distinct, and within each row the height+brightness
  progression across the three density columns is legible at a glance. This is exactly what the r1 review asked for.

### 2. Industrial orange vs olive — substantially improved, not fully resolved
r1's complaint: brightOrange desaturated to "muddy yellow-olive." The fix (a warmer/redder base hue `#F2560A`
instead of the official `#F58624`, plus raising industrial's opacity to 0.5 and dropping transmission to 0.03 so
less grass bleeds through) clearly worked on the **olive** problem — side-by-side with the r1 screenshot at the
identical camera (`shots/zoning/r1/zoning_closeup-12.png` vs `shots/zoning/r2c/zoning_closeup-12.png`), the r1
patch is unambiguously yellow-green/olive and the r2 patch is unambiguously warm tan/gold with an orange-red rim
— a real, visible fix, not a wash.
However, at true top-down 1:1 zoom with no atmospheric/grass interference (`shots/zoning/r2c-custom/noon_industrial_extreme.png`),
the **top face** of the plate — the dominant surface in every standard aerial/closeup camera angle used in this
game — still reads as a desaturated sandy/tan colour, not a confident saturated orange; only the vertical rim
faces (boosted by `EDGE_BRIGHT`) read as true warm orange-red. This matches the module's own code comment in
`src/zoning/index.js`, which candidly documents that "opacity 0.5, transmission 0.03 alone still reads as sandy
tan rather than orange next to grass" and that the redder hue is meant to compensate for that, not eliminate it.
The compensation is only partial: `zoning_closeup-6h5.png`, `zoning_closeup-12.png` (both variants), and
`zoning_default-12.png`/`-18.png` all still show the industrial zone's top face as tan/mustard/khaki rather than
the "distinct, confident orange" the r1 fix aimed for — it no longer collides with green (good), but it doesn't
yet read as clearly as r's green or c's blue read as their respective hues. This is a real but much less severe
residual issue than r1's — an "AAA with nits" nit, not a rubric-failing defect on its own.

## What already works well (carried forward + reconfirmed)
- **The documented API is implemented exactly as specified**, reverified this round with an independently-written
  probe script (not reused from r1): pure `costFor`, matching `setZoneRect`/`setZoneBrush`, correct `clearZone`,
  live (non-debounced) `getZoneStats`, and correct preview show/hide.
- **Draw-call budget is hit exactly as designed** — 3 `InstancedMesh` + 1 preview, reconfirmed by direct scene
  traversal this round, independent of the builder's own claims.
- **Night legibility is now a genuine strength, not just "fixed"**: the rim/top vertex-colour x emissive coupling
  is a clean, cheap technique (no extra draw calls, no extra geometry) and it reads correctly across all three
  zone colours and the full density range, verified with dedicated extreme-close and overview shots this round.

## Ranked issues (most damaging first)
1. **Industrial zone's top face still reads as tan/sandy/mustard rather than a confident, saturated orange** at
   standard aerial/closeup camera angles and at true top-down 1:1 zoom — `shots/zoning/r2c-custom/noon_industrial_extreme.png`,
   `shots/zoning/r2c/zoning_closeup-12.png`, `shots/zoning/r2c-density/zoning_closeup-12.png`,
   `shots/zoning/r2c/zoning_default-12.png`/`-18.png`. Real improvement over r1's olive, but the top face (the
   surface players actually look at from above) doesn't yet deliver on "official Blox colours" / "distinct,
   confident orange next to r/c's saturated green/blue." Fix: either raise the top face's own `INTERIOR_SHADE`
   for industrial specifically (it currently shares the flat 0.8 constant with r/c, which was tuned for their
   already-saturated hues, not for a fainter-surviving orange), or reduce industrial's `BASE_OPACITY`/increase its
   saturation input further so the top face survives the grass blend the same way the rim now does.
2. **Minor/cosmetic, not zoning-specific**: the density-variant critic batch's very first shot came back as a
   blank cold-start frame (`fps:-44.2, drawCalls:0`) before a real screenshot loaded — this is a `tools/critic.mjs`
   /`shot.mjs` timing quirk (first stage() in a freshly-opened page racing the initial render), not a module
   defect; confirmed by an immediate standalone re-capture returning normal numbers. Worth a `critic.mjs` fix
   (e.g. an extra settle-frame on the very first shot of a batch) so future rounds don't have to manually verify
   outlier first-frame numbers.
3. **Carried forward from r1, still very low severity**: faint hazy "ghosting" on transparent zone patches at
   long, low-grazing distances (aerial-perspective fog interacting with alpha-blended flat boxes) is still
   visible at the far edges of `zoning_default-6h5.png`/`-18.png`. Not worth a fix on its own; unchanged from r1.
