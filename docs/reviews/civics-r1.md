# civics — builder self-review (round 1, not critic-scored)

**What shipped:** education & healthcare as civic services — a **school** and a **hospital** you plop like a fire
department, each with a Chebyshev coverage radius, city-wide coverage stats, and real effects on growth, happiness,
RCI demand, the HUD, inspect, save/load and the demo city.

> This document is the builder's own verification record, not an independent critic round. Every number and
> screenshot below was produced by the same agent that wrote the code; treat it as evidence, not as a pass.

## What was built

- **`simulation`** (`model.js`, `index.js`):
  - `SCHOOL_RADIUS = 14` / `HOSPITAL_RADIUS = 16` cells (Chebyshev), stamped exactly like power/water/police;
    per-building `schooled` / `hospitaled` flags and capacity-weighted `educationCoverage` / `healthCoverage`
    stats (`getUtilityRadii()` now returns `school`/`hospital`; `getBuildingCoverage()` adds the two flags;
    `getUtilityCoverage()` adds education/health).
  - **Level gate + speed-up:** school coverage both accelerates level-ups (`MATURE_TICKS_SCHOOLED = 12` vs
    `MATURE_TICKS = 20` at occupancy ≥ 0.9) and is **required for a building to reach level 3** (`lvl < 2 || s.schooled`).
    Hospital coverage is not a gate.
  - Happiness: `+0.07 × education`, `+0.08 × health` (existing weights trimmed slightly so the new services are a
    lever, not saturation). Demand: `+0.12 × education` commercial, `+0.06 × education` industrial,
    `+0.10 × health` residential.
  - Upkeep: school $1.1/tick, hospital $1.4/tick (`UPKEEP_UTILITY`).
- **`buildings`**: `generateSchool` (bright-yellow hall, white course bands, glazed bays with winWarm/winCool night
  overlays, red-canopied entrance, bell tower with a red pyramid cap and flag) and `generateHospital` (white ward
  block, lit sign board behind a red cross, glazed ambulance bay, framed ward windows, rooftop helipad with a white
  H + red beacon mast). Both 2×2 civic compositions like fire/police, dispatched from `generateBuilding`.
- **`tools`**: `utility:school` ($5,000) and `utility:hospital` ($8,000) stamps; inspect card shows the School/
  Hospital coverage radius (via a `UTILITY_RADIUS_KEY` table) and per-building Schooled/Hospital coverage rows;
  the coverage ring decal is colour-coded (school yellow, hospital red).
- **`ui`**: two toolbar buttons + hand-drawn icons, Education/Health rows in the Coverage panel, and Education/
  Health coverage rows in the Population modal. The toolbar was tightened (52px buttons, 8px padding, 2px divider
  margins) and four long labels shortened (Power, Water, Fire Dept, Police) so the six-button Utilities group
  clears the minimap at 1920×1080 — verified by measuring `.lc-toolbar` vs `.lc-minimap` rects (bar right edge
  1671 < minimap left 1688, no overlap).
- **`demo`**: each district now sites 5 civic buildings (fire, police, 2 schools, 1 hospital) — 8 schools +
  4 hospitals in the starter city, education coverage 35%, health 28%.
- Save/load needs no special casing (buildings replay generically; coverage is recomputed from the rebuilt world).

## Verification (real numbers, from this repo's tools)

Full-game batch (`node tools/critic.mjs --game --round civics`), 20 shots (5 presets × 4 tods):

```
minFps=85.5  maxGpuMs=11.35  maxDrawCalls=856  errors=0   (budget: ≥50 fps, ≤20 ms, ≤1500 calls)
```

Module sanity shots (`errors: []` on all): `--showcase demo --preset demo:closeup --tod 18`
(fps 144 / gpu 6.67 ms / 566 calls), `--showcase simulation --preset overview --tod 12`, and
`--showcase tools --preset tools:default --tod 18`.

Pure-model checks (`src/simulation/model.js` runs in Node; script against a synthetic 64×64 world):

- **Level-2 → 3 gate.** Level-2 building at occupancy ≥ 0.9, served power/water/road: **0 growth candidates in 80
  ticks** with no school; with a school in range it becomes a candidate on **tick 12** (`MATURE_TICKS_SCHOOLED`).
- **Effects at full coverage after 400 ticks** (same seed/city, one service added):
  - none → `demand r/c/i = 0.757/0.370/0.263`, happiness 0.650
  - + school → `0.793/0.494/0.312`, happiness 0.720
  - + hospital → `0.897/0.382/0.269`, happiness 0.730
- **Live-city gate audit** (demo city, after its 600-tick warm-up): 49 level-2 growth candidates, **0** without
  school coverage, while 121 unschooled level-2 buildings exist but correctly produce none.

Functional checks (scripted against the live dev server, all with `errors: []`):

- **Placement (real mouse):** selected `utility:school`, clicked a free 2×2 spot at cell (154,104) — building
  `b360` (`kind: 'school'`) appeared, exactly $5,000 was debited, toast "School built, $5,000".
- **Inspect:** clicking it with no tool shows `Civic / School #b360 / Level 1 / Height 13.4 m / Footprint 2×2
  (4 cells) / Coverage radius 112 m`, plus the yellow coverage square on the ground.
- **Save/load:** serialize → remove every school → `applySave` restores 9 schools + 4 hospitals (361 buildings),
  education 38% / health 28% recomputed — no errors.

Screenshots (inspected):

- `shots/feature/school-hero-day.png`, `school-hero-dusk.png`, `school-hero-night.png` — the yellow school, its
  lit classroom windows blooming at night, bell tower + flag.
- `shots/feature/hospital-hero-day.png`, `hospital-hero-dusk.png`, `hospital-hero-night.png` — white ward block,
  backlit red-cross sign at dusk, rooftop helipad + beacon.
- `shots/feature/school-placed-inspect.png` — placement toast, inspect card with the 112 m radius, coverage square.
- `shots/feature/after-load.png` — the city after the save/load round-trip.
- `shots/game/rcivics/*.png` (20) — the full game across all presets/tods; `shots/feature/demo-showcase.png`.

## Known gaps / honest caveats

1. **No independent critic round yet** — this is the builder's own evidence only; the STATUS entry is unscored.
2. **Education is a hard level-3 gate.** With 35% demo coverage, most of the starter city tops out at level 2 until
   the player builds more schools. That is the intended pressure ("educated neighbourhoods support density"), but
   it does make the late-game demo skyline school-dependent; retune `MATURE_TICKS*`/radii/gate if it reads as a wall.
3. **Healthcare is a flat happiness + housing-demand service** — there is no illness, hospital capacity, or death
   simulation behind it. Treat it as the "wellbeing" lever, not a second fire/police incident system.
4. **No new hazards/tools** specific to civics (no outbreak/school-strike demo tool; the existing fire/burglary
   tools already work on the new buildings).
5. **Coverage is footprint-weighted** (building cells), not population-weighted — same convention as power/water/
   police/transit.
6. **`simulation`'s own showcase still stages no schools/hospitals**, so its panel reads 0% education/health; the
   feature is verified through the full game and the `demo` showcase, which do stage them.
7. The toolbar label shortening (Power/Water/Fire Dept/Police) is a UI change to accommodate the six-button
   Utilities group; if a critic prefers the old full labels, the group needs another width solution.
