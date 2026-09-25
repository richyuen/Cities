# views — builder self-review (round 1, not critic-scored)

**What shipped:** data-view overlays ("info views") — the map can be painted, one layer at a time, with the
Power / Water / Services / Police / School / Health / Transit / land-value simulation data, so the player can see
*where* coverage is missing instead of guessing from the HUD percentages.

> This document is the builder's own verification record, not an independent critic round. Every number and
> screenshot below was produced by the same agent that wrote the code; treat it as evidence, not as a pass.

## What was built

- **New module `src/views/`** (`index.js`, `overlay.js`, `scene.js`). Read-only consumer: it owns no world data
  and never mutates the simulation.
  - **Eight views**: `power`, `water`, `services` (road + power + water combined), `police`, `school`, `health`,
    `transit`, `land` (land value). Each is a per-cell colour map: blue = served, red = zoned/built but
    unserved, yellow = the service building itself; land value is a red→yellow→green ramp on zoned cells.
  - **Rendering**: two `InstancedMesh`es in one group — ground plates for open/zoned cells and a tint box per
    building — so the whole map costs **2 draw calls**. The material is an emissive-driven
    `MeshPhysicalMaterial` (never `MeshBasicMaterial`) so its colour survives blending with grass/asphalt
    (a lit translucent red over green terrain always turns brown; that was the first iteration's failure).
    Night adds a small tinted emissive boost that stays under the bloom threshold.
  - **Data sources** (public APIs only): `simulation.getCoverageGrid(layer)` (new — recomputes stale grids
    first, so it is correct even while the game is paused), `transit.getCoverageGrid()` (new),
    `simulation.cellDesirability(i,j)`.
  - **Rebuilds are event-driven and debounced** (0.25 s): zone/building/road/transit/prop world events mark it
    dirty; nothing is recomputed per frame. While a view is active the module hides `zoning`'s plates
    (`zoning.api.setOverlayVisible(false)`) so the two translucent overlays don't blend into each other.
  - **api**: `list()`, `getView()`, `setView(id|null)`, `toggle(id)`, `cycle(dir)`, `refresh()`; emits
    `view:changed`.
- **HUD (`ui`)**: the Coverage panel rows are now view toggles (eye icon, `data-view` attribute, gold highlight
  on the active row) plus two new rows — **Police** and **Land value**. The panel grows a small legend for the
  active view (colour chips, or a gradient bar for land value, plus "V next view · Esc close"). `V` cycles all
  eight views (Shift+V steps back); `Esc` closes the view first, before deselecting the tool.
- **Seams fixed while integrating**:
  - `menu`'s Escape handler now defers when a view is active (same as ui's modals/settings/tool), otherwise the
    pause menu would open on top of — and make it impossible to close — the overlay.
  - `simulation.publish()` now copies `policeCoverage` into `world.stats` (the new HUD Police row exposed the
    gap: the HUD read 0% until the next live tick, and forever if the clock was paused).
  - `tools/critic.mjs` warms the page with ~2 s of frames before the first capture (the pending todo item: the
    first shot of a batch could come back as a cold start and land a false fps floor in `summary.json`).

## Verification (real numbers, from this repo's tools)

Showcase batch (`node tools/critic.mjs --module views --round 1 --dir shots/views/r1`), 3 presets × 4 tods:

```
minFps=143.4  maxGpuMs=6.97  maxDrawCalls=413  errors=0
```

Full game batch (`node tools/critic.mjs --game --round 5 --dir shots/game/r5`), run alone:

```
minFps=53.9  maxGpuMs=10.06  maxDrawCalls=856  errors=0   (budget: ≥50 fps, ≤20 ms, ≤1500 calls)
```

Functional checks (scripted against the live dev server, all with `errors: []`):

- **HUD row click** activates the matching view (`School` row → `view=school`, overlay group visible, 4917
  ground plates / 360 tint boxes, legend shown, row highlighted).
- **Esc** closes it and does **not** open the pause menu (the menu deferral fix).
- **V** cycles all eight views in order and wraps; **Shift+V** steps backwards.
- **Event-driven rebuild**: with the School view active, adding a school in an uncovered zone (no manual
  `refresh()` call) grew the overlay from 4917 → 5453 ground plates and 360 → 367 boxes within the debounce —
  and the simulation's grid read `1` at the new site. (The +7 boxes include the buildings module's own live
  auto-growth during the wait.)
- **World wipe**: `world.clearContent()` while a view is active leaves 0 instances, no stale plates, no errors.
- **Save/load**: saved through the pause menu with a view active, reloaded via `?load=`, city restored
  (360 buildings / 447 road edges / population 8288 → 8289), view correctly off on the fresh page, zoning
  overlay restored to visible, then a new view activated post-load (9430 plates, zero errors).
- **Regression showcases**: `ui` (Coverage panel without the views module: no eye icons, no legend), `zoning`
  (showcase plates untouched) and `simulation` all load with `errors: []`.
- **Boot path** (`?menu=pause`, no `fixeddt`): menu open → Resume → Transit row click activates the view
  (4110 plates, zero errors/warnings) → Esc clears the view and does not open the pause menu; zoning plates
  restored. Same flow after a real save/reload cycle (see above).

Performance A/B at a fixed camera (`overview`, 12:00, three reps, view off vs School on):

```
draws 769/775/767 → 623/641/604      gpuMs 6.57/6.67/6.70 → 6.39/5.24/6.62
```

An active view does not add cost at the overview camera: the two overlay meshes are cheaper than the zoning
plates they replace (hiding zoning also skips its transmission pass, which costs ~140-216 draw calls/frame).

Screenshots (inspected):

- `shots/views/final-school-overview.png` — whole-day full game, School view: blue covered south/east,
  red uncovered north, yellow school buildings, HUD legend.
- `shots/views/final-land-overview.png` — land-value ramp across the zoned city.
- `shots/views/hud-school.png`, `shots/views/night-land.png` — HUD + overlay day/night.
- `shots/views/showcase-school.png`, `showcase-police-aerial.png`, `showcase-health-dusk.png` — staged
  showcase scene (grid + districts + partial utilities + bus stops) under the overlay.
- `shots/views/r1/*` — full showcase batch; `shots/game/r5/*` — full game batch with the module present.

## Known gaps / honest caveats

1. **No traffic/road-congestion view**: traffic is lane-based, not per-cell, and nothing in `traffic` exposes a
   per-cell volume — a road-level overlay would need a new public API there.
2. **Coverage, not capacity**: the grids are `0/1` per cell (in radius / not), matching how the simulation gates
   buildings; they don't show *how much* slack a station has left.
3. **Land value only tints zoned cells** (unzoned wilderness is left untinted) because `cellDesirability`
   returns 0 away from roads by design; showing it everywhere painted the whole map red on the first iteration.
4. **The overlay is a flat data layer**, deliberately unlit: up close it is less pretty than the lit world
   (A/B: 25.7% of street-level pixels change with a view on), which is the point of an info view but is a
   visible mode switch.
5. **No minimap integration**: the minimap still shows the base zone/road colours while a view is active.
6. **No view persistence in saves** — the active view is transient UI, deliberately not serialized.
7. The module is not yet in any independent critic round; the STATUS.json entry is deliberately unscored.
