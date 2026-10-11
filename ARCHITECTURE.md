# ARCHITECTURE — Blox City (Three.js 0.186 + Vite 8, plain ES modules)

This document is the contract. Builders read it before writing code. Only the **integrator** may change `src/core/`
or this file. Builders own exactly one folder under `src/` and never touch another module's folder.

## 0. Non-negotiables
- **Units**: meters, **+Y up**, right-handed. Time of day = float hours `[0, 24)`. World origin at the center of the map.
- **Determinism**: no `Math.random()` anywhere. Use `ctx.rng` (seeded sfc32) or `ctx.rng.fork('name')`. Same seed → same city, same screenshot.
- **Assets**: CC0 only — Poly Haven, ambientCG, or procedural. Every downloaded file is listed in `public/assets/manifest.json` with source URL and license. If an asset is missing, the module must fall back to procedural and keep working.
- **Isolation**: a module that throws in `init/update/showcase` is marked failed and skipped; it must never take the app down. Don't rely on another module having succeeded; check `ctx.modules.get('id')?.status === 'ok'`.
- **Perf budget** (full demo city, 1920×1080): **≥ 50 fps**, **≤ 1500 draw calls**, **gpuMs ≤ 20 ms** (the authoritative perf metric — see §7). Use `InstancedMesh`, merged geometry, texture atlases. Per-module budgets in §7.
  **Triangle count is not budgeted** (revised after Wave 3): the original 3 M ceiling was set before any geometry existed and proved unrealistic for a stud/bevel Blox art style — terrain + CSM shadows alone cost ~1.8 M, and 234 buildings in isolation already cost ~2.3 M (see `docs/reviews/demo-*.md`). The real demo city runs 14.7–20 M triangles at 73+ fps / ≤12.8 ms GPU time on the reference RTX 4070 Ti with 700–780 draw calls — both real budgets pass with large margin. Triangle count is a proxy, not a target; gpuMs is ground truth. Don't gut city density to chase a triangle number when fps/gpuMs/draw-calls all pass.
- **Look**: "Blox Skylines" — see `docs/REFERENCE.md`. Glossy ABS plastic, studs, bold palette, physically plausible lighting. **Never programmer art**: no flat-colored `MeshBasicMaterial` for world objects, no un-shadowed scenes, no default cubes.
- **Showcase**: every module ships `showcase(ctx, variant)` staging a representative scene of *only that module* (plus whatever core provides). `?showcase=<id>` loads only core + that module + its `deps` (transitively).
- **Verification**: nothing is "done" until `node tools/shot.mjs --showcase <id> ...` produced a PNG you looked at, with `errors: []` in the JSON.

## 1. Folder layout
```
src/main.js                 boot
src/core/                   INTEGRATOR ONLY
  world.js      shared world data model (§3)
  eventbus.js   pub/sub (§4)
  rng.js        sfc32 seeded RNG: fork(), float(), int(), range(), pick(), chance(), noise2D()
  clock.js      time of day, day length, pause, timeScale, sun direction
  registry.js   module loader, dependency order, failure isolation
  bootScreen.js boot overlay controller (markup + CSS are inline in index.html so they paint pre-bundle)
  renderer.js   WebGLRenderer, color management, shadows, resize, stats
  camera.js     PerspectiveCamera + orbit/pan controls + presets (§6)
  composition.js subject selection for the core presets (LOOP cycle 1): civic/avenue/tower scoring, sun azimuth
  assets.js     texture/HDRI loader with manifest + procedural fallbacks
  materials.js  Blox palette + shared MeshPhysicalMaterial presets + stud instancer
  showcase.js   ?showcase= runner
  debug.js      window.__city API (§5)
  context.js    builds ctx
  modules.js    static list of module ids → dynamic import
src/<module>/index.js       default export module object (§2). Everything else in that folder is private.
tools/shot.mjs              headless screenshot (§8)
tools/critic.mjs            batch screenshots for critics
tools/status.mjs            docs/STATUS.json helper
tools/fetch-assets.mjs      CC0 asset downloader
docs/STATUS.json            scores, rounds, open issues (source of truth for the loop)
docs/reviews/               critic reports
docs/core-requests/<id>.md  a builder's requests for core changes (integrator applies)
```

## 2. Module API
```js
// src/<id>/index.js
export default {
  id: 'roads',                 // == folder name
  deps: ['terrain'],           // module ids that must init first (may be empty)
  order: 30,                   // update order (lower first). terrain 10, environment 15, roads 30, zoning 35,
                               // buildings 40, props 45, traffic 50, transit 55, simulation 60, disasters 65,
                               // tools 70, views 72, ui 80, audio 85, effects 90, menu 95, demo 5
  async init(ctx) {},          // build persistent state, subscribe to events, add objects to ctx.scene
  update(dt, ctx) {},          // per frame; dt seconds (clamped ≤ 0.1). Keep it cheap.
  dispose(ctx) {},             // remove objects, unsubscribe
  async showcase(ctx, variant = 'default') {}, // stage a demo scene of this module; may call ctx.world mutators
  showcaseVariants: ['default', 'night'],       // optional list, for tools/critic.mjs
  presets: { 'roads:intersection': { pos: [40, 30, 60], target: [0, 0, 0] } }, // optional camera presets
  api: {},                     // public functions other modules may call via ctx.modules.get('roads').api
};
```
Optional boot hook: a module whose `init()` leaves deferred work (e.g. `buildings` merging a warm-up backlog in
time-sliced chunks) may expose `api.settle()` — a synchronous drain the seeding module calls once before
`ready` so the first drawn frame is complete (demo calls `buildings.api.settle()` after its warm-up). Callers
must use optional chaining: the hook is module-specific, not part of core. It is a single-shot drain, not
idempotent: a second immediate call can replay the same (stale) candidate list and double-apply.
`ctx` fields:

| field | type | notes |
|---|---|---|
| `scene` | `THREE.Scene` | add one `Group` named by module id: `group.name = 'roads'` |
| `renderer` | `THREE.WebGLRenderer` | do not change global state (tone mapping, shadow type) — request via integrator. `effects` may wrap rendering via `ctx.setRenderFn(fn)` |
| `camera` | `THREE.PerspectiveCamera` | read-only unless you are `tools`/`ui` |
| `controls` | camera controls | `ctx.controls.enabled` may be toggled by `tools` |
| `world` | `World` | §3 |
| `events` | `EventBus` | §4 |
| `rng` | `Rng` | seeded; call `ctx.rng.fork(id)` once in init and keep it |
| `clock` | `Clock` | `hours`, `dayLengthSec`, `timeScale`, `paused`, `set(h)`, `sunDir` (Vector3, unit, points *toward* sun), `sunElevation` (rad), `isNight` |
| `assets` | `Assets` | `await texture(name)`, `await hdri(name)`, `await pbr(name)` → `{map, normalMap, roughnessMap, aoMap}` (procedural if missing) |
| `materials` | `Materials` | `palette` (§7), `plastic(colorName, opts)`, `glass(colorName)`, `studs()` instancer, `bevelBox(w,h,d)` geometry |
| `modules` | `Map<id, ModuleRecord>` | `{ id, status: 'ok'/'failed'/'skipped', api, error, module }` |
| `log` | `(…args)=>void` | prefixed console logger; use `ctx.error(...)` for real errors (captured by the screenshot tool as failures) |
| `dom` | `HTMLElement` | `#ui-root` (UI/tools only) |
| `showcase` | `string/null` | id of the active showcase module, else `null` (full game) |
| `params` | `URLSearchParams` | url params |
| `setRenderFn(fn)` | | `effects` only: replaces the default `renderer.render(scene, camera)` with `fn(dt)` |
| `stats` | | `{ fps, frameMs, drawCalls, triangles }` updated every frame by core |
| `paused` | `boolean` | owned by `menu`; when true, main.js skips `clock.update`/`cameraApi.update`/`registry.update` for that frame (rendering still happens, so the last live frame stays visible behind the menu) |

## 3. World data model (`src/core/world.js`)
```
World {
  size: { w: 256, h: 256 }          // cells
  cellSize: 8                        // meters; cell (i,j) covers x∈[(i-w/2)*8, +8), z∈[(j-h/2)*8, +8)
  cells: Cell[w*h]                   // index = j*w + i
  Cell { i, j, height, type: 'none'|'road'|'zone'|'park'|'water'|'building', zone: null|'r'|'c'|'i', density: 0..3,
         roadId, buildingId, level }
  roads: { nodes: Map<id, {id, x, z, y}>, edges: Map<id, {id, a, b, lanes, kind: 'street'|'avenue'|'highway', width, bridge, oneway}> }
  // oneway: 0 = two-way (default), 1 = traffic flows a->b, -1 = flows b->a. One-way edges use the full carriageway
  // in the permitted direction (street 2 lanes, avenue/highway 4) and render lane arrows.
  buildings: Map<id, { id, i, j, w, d, zone, level, height, seed, kind }>
  props: Map<id, { id, x, y, z, rot, kind }>   // + optional owner tags written by `props`: edgeId | nodeId | yardOf | park
  weather: { kind: 'clear'|'cloudy'|'rain'|'fog', intensity: 0..1, wind: [x,z] }
  stats: { population, jobs, money, happiness, traffic }
  heightField: Float32Array((w+1)*(h+1))   // vertex heights, meters; terrain owns
}
```
Mutators (all emit events, all deterministic): `setHeight(i,j,h)`, `getHeight(x,z)` (bilinear, meters), `setCell(i,j,patch)`,
`addRoad(a:{x,z}, b:{x,z}, kind, {bridge?, snapNodes?, oneway?})` → edgeId, `removeRoad(edgeId)`,
`planRoadEdit(a, b, kind)` → read-only `{ edges, length, coverage, blocked } | null` (the drag-over upgrade verdict),
`previewRoadRoute(a, b, kind, {bridge?})` → read-only `[{x,z}]` (the centreline an interactive `addRoad` would run
through, existing junctions within reach included; the tools' road ghost draws it),
`upgradeRoad(a, b, kind, {oneway?})` → `{ edges, length, kindChanged, dirChanged } | null` (in-place kind/width/
direction edit of the existing road the drag follows; emits `road:changed` per edge), `setZone(i,j,zone,density)` (returns `true` when the cell
changed; `false` no-op for road/water cells and for cells claimed by a building — a built cell's type is owned by its
building, so zoning can never flip it back to `'zone'`), `addBuilding(rec)` → id, `removeBuilding(id)`,
`addProp(rec)` → id, `removeProp(id)`, `setWeather(patch)`, `worldToCell(x,z)`, `cellToWorld(i,j)` (center), `cellAt(i,j)`, `raycastGround(ray, maxDist?, heightFn?)`
(terrain heightfield only), `raycastBuildings(ray, maxDist?, heightFn?)` (nearest building footprint AABB), `raycastScene(ray, maxDist?, heightFn?)` →
`{ point, buildingId }` (whichever of the two the ray reaches first — use this one for pointer picking so a building's facade/roof stops the ray
instead of the ray passing through to the terrain behind it). `heightFn` defaults to `getHeight` (smooth bilinear); pass the `terrain` module's
`surfaceHeight` (the actual rendered plate-quantized surface) for pointer picking, or the raycast can settle a visible distance from the rendered
ground and shift the resolved cell — see `tools/index.js` `groundHeightFn()`.
Ownership: terrain owns `heightField/height`; roads own `roads`; zoning owns `zone/density`; buildings own `buildings`; props own `props`; simulation owns `stats`; environment owns `weather`.

## 4. Events (`ctx.events.on(name, fn)` → unsubscribe fn; `emit(name, payload)`)
| event | payload | emitted by |
|---|---|---|
| `world:cell` | `{ i, j, cell }` | world |
| `terrain:changed` | `{ region: {i0,j0,i1,j1} }` | terrain |
| `road:added` / `road:removed` | `{ edgeId, edge }` | world |
| `road:changed` | `{ edgeId, edge, prev: {kind,width,oneway} }` | world (in-place upgrade/downgrade/one-way edit) |
| `zone:changed` | `{ i, j, zone, density }` | world |
| `building:spawned` / `building:removed` | `{ building }` | world |
| `prop:added` / `prop:removed` | `{ prop }` | world |
| `time:changed` | `{ hours, sunDir: [x,y,z], sunElevation, isNight }` | clock (each frame if changed) |
| `weather:changed` | `{ weather }` | world |
| `sim:tick` | `{ tick, stats, demand: {r,c,i}, day }` | simulation (≈ 2 Hz) |
| `sim:levelup` | `{ building }` | simulation |
| `sim:milestone` | `{ level, name, pop, reward: { cash, badge } }` (one-time city milestone claimed; reward-only, no tool gating) | simulation |
| `settings:changed` | `{ quality?: 'low'/'medium'/'high', studs?: boolean }` (only changed key) | ui |
| `transit:changed` | `{}` (stops/lines/coverage changed) | transit |
| `transit:draft` | `{ stops }` (line tool draft length; 0 = no draft) | transit |
| `view:changed` | `{ view: id\|null, label }` (active data view, see `views`) | views |
| `disaster:tornado` | `{ id, x, z, dirX, dirZ }` (a tornado touched down) | disasters |
| `disaster:damage` | `{ id, amount, damage, source? }` (a building took hazard damage; one event per damaged building per frame while in the funnel, or per kaiju blow with `source: 'stomp' \| 'tremor' \| 'tail'`) | disasters |
| `disaster:ended` | `{ id, destroyed, kind }` (a tornado dissipated or a kaiju left, was cleared, or was replaced by a loaded state; `kind: 'tornado' \| 'kaiju'`, `destroyed` = buildings it tore down) | disasters |
| `disaster:kaiju` | `{ id, x, z, heading }` (a kaiju rose; `heading` = atan2(dz, dx)) | disasters |
| `disaster:stomp` | `{ id, x, z, hits }` (a kaiju footfall at (x, z); `hits` = buildings under it) | disasters |
| `disaster:breath` | `{ id, x, z, heading, ignited: [buildingId] }` (a kaiju fire breath from the mouth at (x, z)) | disasters |
| `traffic:transit-invalid` | `{ ids }` (lines whose lane keys vanished after a road change) | traffic |
| `tool:selected` | `{ tool }` | tools |
| `camera:changed` | `{ pos, target }` | camera |
| `module:failed` | `{ id, error }` | registry |
| `showcase:staged` | `{ id, variant }` | showcase runner |

## 5. Debug API (`window.__city`) — used by tools/shot.mjs
```
ready: boolean                       true after all modules init'd (failed ones included) and 2 frames rendered
setCamera(nameOrObj)                 preset name (§6) or { pos:[x,y,z], target:[x,y,z] }; returns true if preset existed
setTime(hours)                       sets clock, pauses time
setWeather(kind, intensity)
setTimeScale(s) / pause() / resume()
stats()                              { fps, frameMs, drawCalls, triangles, programs, geometries, textures, errors:[], warnings:[], modules:{id:status} }
showcase(id, variant)                async; disposes current, stages that module
presets()                            list of preset names
seed                                 active seed
world, ctx, THREE                    for debugging
```
Console errors are captured from page load. `errors` must be `[]` to pass.

## 6. Camera presets (core registers; modules add `id:name` presets)
The core presets are **subject-aware** (LOOP cycle 1): they frame real city subjects using `src/core/composition.js`
(civic lots scored by neighbours + street props, avenues by building frontage, the tall cluster by height, the sun's
azimuth from the clock) instead of fixed offsets. `overview` (oblique ~25° over downtown + the bay), `skyline` (low
3/4 of the tall cluster with the avenue leading in), `street` (2.8 m eye on the busiest avenue, looking slightly
down; `MapControls.maxPolarAngle` 89.1° means a street target must sit below the eye or the controls lift the
camera), `aerial` (~42° from the east over downtown), `closeup` (a civic hero — school/hospital/fire/police —
framed 3/4 around its +z entrance face, sun-side, height-fitted, with a 3D eye→hero raycast so a neighbour wall
can't fill the frame), `night` (= skyline; the tool forces tod 21.5). Empty/showcase worlds fall back to the old
generic framings. Controls: left-drag orbit, right-drag pan, wheel zoom, WASD pan. Camera never goes below
terrain + 1 m.

## 7. Visual standard & materials
- Blox palette (`ctx.materials.palette`): `brightRed, brightBlue, brightYellow, brightGreen, darkGreen, white, black, darkStoneGrey, mediumStoneGrey, lightStoneGrey, tan, brickYellow, reddishBrown, darkOrange, brightOrange, mediumAzur, darkAzur, lime, mediumLilac, sandGreen, sandBlue, darkRed, transClear, transBlue, transYellow, transRed`.
- `ctx.materials.plastic(name, { roughness=0.35, clearcoat=0.6, clearcoatRoughness=0.15 })` returns a cached shared `MeshPhysicalMaterial`. Share materials; never create per-object materials in loops.
- Studs: built Blox surfaces (roofs, road shoulders, decks) carry full studs; ground plates are a tiled lawn (seamed, toned tiles with sparse studs; LOOP c6, `src/terrain/lawn.js`; `?lawn=0` restores the full stud grid, `terrain.api.studKeep(ix, iz)` is the shared keep rule, and sparse lawn studs do not write depth so the post AO cannot darken their walls). Use `ctx.materials.studs()` which returns an `InstancedMesh` helper: `studs.add(x,y,z,colorName)`, `studs.commit()`, `studs.clear()`. Stud pitch in-world **0.8 m** (1 cell = 10 × 10 studs). Stud radius 0.24 m, height 0.17 m. Use LOD: studs fade beyond ~250 m.
- Lighting is owned by `environment`: sun `DirectionalLight` (3-cascade via `three/addons/csm/CSM.js`), sky hemisphere/ambient, HDRI/procedural environment map for reflections, fog. The sky's sun disc radiance/size follows a low-elevation ramp (`sunDiscLow = 1 − smoothstep(2°, 16°)`; ×0.15 radiance and a smaller core near the horizon) so the gold-hour disc stops blowing out while the horizon/zenith/cloud chroma is untouched and noon is an exact no-op (LOOP c4). Other modules must not add lights except local point lights for night (props/buildings; pooled, ≤ 48 real point lights, rest emissive-only).
- Post (`effects`): GTAO, grade, bloom (threshold ≥ 1.0, subtle), OutputPass (ACES + sRGB), optional
  capture-mode **tilt-shift** (`?dof=<0..1>`, focus line `?dofy=<0..1>`; absent/0 = the pass is not constructed,
  and the frame is pixel-identical to the no-flag path; `api.setDOF/getDOF`), then SMAA, then screen. The tilt-shift
  sits after tone mapping so bloom sees today's image and before SMAA so the focus band keeps edge AA (LOOP c4).
  Bloom strength carries a low-sun discipline (`?sunbloom=0` disables it for A/B; `api.setSunBloom/getSunBloom`):
  `× (1 − 0.6·f(elevation))` with f ramping between −1.5° and 0.5° up and fading out by 14°, so sunset bloom
  columns shrink while night/noon are bit-stable. Tone mapping ACES filmic is set by core renderer; exposure is set
  by environment via `ctx.renderer.toneMappingExposure`.
- Roads: dark grey plates, white/yellow lane markings, curbs, stud sidewalks; intersections with proper corner geometry, no z-fighting (use `polygonOffset` or small Y offsets). One-way edges additionally print lane arrows (white, ~12 m apart, on every usable lane) pointing along the permitted flow; two-way roads are unchanged.
- Civic services (`simulation` + `buildings` building kinds, placed via `tools`): `power_plant`, `water_tower`, `fire_department`, `police_station`, `school`, `hospital`. Each stamps a Chebyshev coverage radius (`simulation.getUtilityRadii()`); power/water cap unserved occupancy, fire/police scale emergency response, a school accelerates level-ups and is the reliable route to level 3 (C6: an unschooled building can also reach level 3 through sustained city happiness — ≥ `LEVEL3_WEALTH_HAPPINESS` 0.62 for `LEVEL3_WEALTH_TICKS` 30 consecutive mature ticks, reset below 0.58; see `simulation/model.js`), a hospital raises happiness and housing demand. `simulation` exposes `stats.educationCoverage` / `stats.healthCoverage`; the HUD shows Education/Health rows. `getCoverageGrid('fire')` is the fire departments' coverage footprint (`FIRE_RADIUS` 14 cells, the same as police); fire dispatch itself still has no range cutoff.
- Transit (`transit`): bus stops are click-placed on road sidewalks (cost $400), bus lines are ordered stop loops routed over roads' public lane API (`roads.api.getLanePath/getLaneConnections`; right turns and throughs preferred, U-turns heavily penalized) and handed to `traffic.setTransitLines()` as lane/turn key loops. Route buses reuse traffic's pool, kinematics, signals, gap queues and night lights, plus a stop dwell and transit signal priority (an approaching bus holds its arm green). Transit owns stops/lines/coverage/economy; simulation consumes `setTransitCoverage(0..1)`, `setTransitUpkeep($/tick)` and `setTransitFareRevenue($/tick)` (fare income line, C5) and exposes `stats.transitCoverage`. Stops carry a route-letter face plate (A–H atlas, per-instance UV offset) and a deterministic rider queue that scales with ridership; a stop visited twice on a loop boards at its next pass (monotonic stop projection in `traffic.buildRoute`).
- Data views (`views`): per-cell overlays for Power/Water/Services/Police/School/Health/Transit/Traffic/land value, drawn as two instanced meshes (ground plates + building tint boxes, 2 draw calls) whose colour is unlit-emissive so red never blends to brown over grass. Sources are the public grids: `simulation.getCoverageGrid(layer)` (recomputes stale data first, so it is correct while paused), `transit.getCoverageGrid()`, `traffic.getCongestionGrid()` (read-only per-road-cell speed ratio, 0 = free flow, 1 = stopped; sampled at 2 Hz and lazily when stale, see `traffic.getCongestionAt`), plus `simulation.cellDesirability` for land value. The HUD's Coverage rows toggle views (eye icon), `V` cycles, `Esc` closes; `views` vetoes `zoning`'s plates while active (`zoning.api.setOverlayVisible(false)`; `true` lifts the veto but never forces plates on) and emits `view:changed`. **Zoning overlay rule (owner decision, LOOP c6, 2026-10-03):** `zoning` draws its plates only while a zone tool (`zone:r|c|i`, `zone:none` = Dezone) is selected, or always under `?zones=always` and in `?showcase=zoning`; bulldoze, roads and parks keep them hidden; the minimap tint and the hover ghost show zones at all times. `zoning.api.getOverlayState()` → `{ shown, viewHidden, toolShows, always }`. Perf: the plates are the city's only transmissive surfaces, so hiding them skips three's transmission pre-pass (game batch 1023 → 818 draws, 10.94 → 7.25 ms max). The minimap tints per cell for the active view through the same public grids (one palette lookup, no extra draw calls) and names the view in its footer.
- Policies (`simulation` + `ui`): six catalogue entries (`src/simulation/policies.js`) each cost a flat `$/tick` upkeep and carry effect knobs that `mergePolicyFx()` folds once per `step()` into the model's derived effect object — demand bias (all/commercial/industrial), income/upkeep multipliers, happiness/transit/traffic/fire/crime multipliers. `simulation.setPolicy(id, on)` / `getPolicy()` are the API (ids are stable; `getState().policies` round-trips the active set and unknown ids are skipped on load); the budget line is `budget.expenses.policies` (the Treasury modal shows it and opens the **Policies…** toggle panel). Pure economy — no tool gating.
- City services (`simulation`): `budget.expenses.services` charges `SERVICES_SHARE` of the tax base at the reference 9% rate, phased in above `SERVICES_FREE_POP` residents by `(1 - FREE / population)` (constants and rationale in `model.js`; Treasury row **City services / day**). It is what keeps a grown city's net in the low five figures per day instead of compounding. Construction is debited through `simulation.spend()` by `tools` (roads, zoning, utilities incl. grading) and `transit`. **Free construction** (`simulation.setFreeBuild/getFreeBuild`; Options → Gameplay → Free construction; saved as the simulation state's `freeBuild`, off in older saves) makes `spend()` a free no-op, `tools` treats funds as unlimited, prices read "free" and the HUD's Treasury label says "free build"; taxes, upkeep and debt are unchanged. `settings:changed { freeBuild }` announces a change.
- Disasters (`disasters`, Wave D2): one hazard at a time, a tornado or a kaiju (below). The tornado: `spawnTornado({x, z, dirX?, dirZ?})` drops a funnel that travels along `world.weather.wind` (deterministic fallback when calm) at `SPEED`, damaging every building within `OUTER_R` (quadratic falloff to `CORE_R` core) by writing the shared fire `b.damage` field — capacity loss via `FIRE_DAMAGE_CAP_LOSS`, free repair via `FIRE_REPAIR_RATE`. Damage is billed through `simulation.setDisasterCost($/tick)` → `budget.expenses.disasters` (Treasury **Disaster costs / day** row; `stats.disasterCost`); the module accrues dollars between ticks and bills exactly what was accrued. `getActive()`, `getState()/loadState()` (save file field `disasters`, round-trips the funnel's position/path/age and the damage scars with the building records; capped at one active), `clear()`. Toolbar Hazards gains **Tornado** (`hazard:tornado`); visuals are a Blox funnel + dust (2 draws, hidden while idle); the showcase presets frame the live funnel. Showcase variants `default` / `storm`, presets `overview` / `closeup` / `ground`. **Brick destruction (D3):** inside `CORE_R` the damage is shown. A building is stripped top-down as its damage passes `SHED_START` (0.35, `SHED_CURVE`) and at damage 1 is torn into bricks and removed with `world.removeBuilding` (at most 2 per frame); the outer ring keeps the hidden damage only. Bricks are synthesised from the generated parts' boxes (`disasters/brickify.js`: a hollow 2x4 shell on the 0.8 m stud grid with 0.96 m courses for large parts, one loose piece per window, at most 600 per building, each in its part's colour) and drawn by `disasters/bricks.js` as two instanced meshes (`bricks:2x4`, `bricks:box`; at most 6000 integrated at once, the oldest recycled): they fly in the vortex, fall, lie as rubble for 30 game-s and shrink away; the funnel's own ring of 40 grey bricks is a third small mesh (`bricks:storm`, faintly self-lit like the funnel so it reads at night). A storm with bricks in the air adds 9 draw calls to the frame. Which buildings are stripped is the module's own map, never read off `b.damage` alone (fires write the same field); a stripped building whose damage repairs below `SHED_START` is regenerated whole on `sim:tick`, and one that levels up is re-stripped. A destroyed lot keeps its zoning (`type: 'zone'`); when the storm expires the lots go to `buildings.api.requestRegrowth`, which puts them at the front of the growth queue (the same priority as land the player just zoned), so the city rebuilds 1x1 starters there even though its demand idles below the growth gate. Utilities and civic buildings in the core are destroyed too and, having no zone, do not come back. Props in the core (trees, street furniture, sidewalk figures; not `sp:` set-pieces or junction signals) are thrown as their own pieces and removed from the world in 1 s batches (the street stays bare: furniture is only placed on `road:added`); cars are taken off the road with `traffic.api.pluckVehicles` and return after 20 s. At touchdown the module remembers `world.weather` and sets rain 0.9 with a 7 m/s wind along the path (one environment-map re-render), and gives the old weather back when the storm ends if the sky is still the one it set; each collapse plays the `crash` sfx (3/s) and the `bulldoze` sfx is muted while a tornado is active. Save fields: `disasters.tornadoes`, `shedding: [{ id }]` (stripped buildings: the facade is re-applied on load from the building's saved damage), `prevWeather`, `regrow: [{ i, j }]`. Bricks and rubble are presentation and are not saved. `getStats()` reports destroyed / stripped / pool counters and the brick spawn-set hash; where a brick flies integrates the frame's dt, so only the spawn set is reproducible. The `storm` showcase drops the funnel upwind and runs 150 fixed 1/60 s steps, so a paused frame already has bricks in flight. Regression: `node tools/check-disasters.mjs` (104 checks: tornado, kaiju and drawn building fires). **Kaiju:** the second city-scale hazard, and only one hazard is on the map at a time (`spawnTornado` and `spawnKaiju` both return null while `isActive()`; a save holding both loads the tornado). `spawnKaiju({ x, z, heading? })` raises a 55 m bipedal brick lizard (toolbar Hazards **Kaiju**, `hazard:kaiju`) that walks at 5 m/s to the tallest, densest building ahead of it within 250 m, and wanders when there is none. It has three attacks. A footfall (every 12 m of travel; `disaster:stomp`) tears down up to 3 buildings whose lot is within 5 m of the foot or 4 m of the hips, and shakes the lots within 18 m (hidden damage only, up to 0.25). The tail (four joints, 8 to 26 m behind the hips, swinging with the stride) damages any lot within 4 m at 1.6 / s and strips it visibly. Every 10 s it stops for 2.5 s and breathes fire: up to 3 buildings in a 0.30 rad cone, 8 to 70 m from the mouth, are lit with `simulation.igniteBuilding` (`disaster:breath`), and from there the fire is the simulation's own. A burning building (any cause: random, the Start Fire tool, a breath) is drawn by `buildings` (`buildings/fire.js`): tongues of flame on its roof studs and out of its windows and a column of smoke, two instanced meshes of camera-facing quads for the whole city (`buildings:fire-flames`: a procedural noise-licked flame per quad plus one glow halo per fire, premultiplied so the core is opaque by day and the rim blooms at night; `buildings:fire-smoke`: noise-edged puffs, sky-lit by day and ember-lit from below at night, fogged), 2 draw calls while anything burns and hidden otherwise. The instance matrix carries each quad's world position and size; shape, hue and flicker are the `ShaderMaterial`'s, from the per-instance `aParam` (life, seed, strength, roll / halo flag) and `uTime`. It reads `simulation.getBurningBuildings()` every frame, not on `sim:tick`, so a fire lit while paused shows at once, and scales with `b.fireSeverity` and `b.fireElapsed / b.fireDuration`; buildings showcase variant `fire` stages it without the simulation. Stomp, tremor and tail damage go through the same `b.damage` field, `disaster:damage` event (with `source`) and `setDisasterCost` billing as the tornado; buildings come apart through the same `hideParts` / brick pool path (400 bricks per building, thrown outward from the blow instead of round a funnel: `bricks.update` gets no funnel and flies them ballistically), props and cars near a footfall are thrown too. The rampage is a budget of `K_LIFE_SEC` 75 game-s that runs down at `1 + 0.75·police + 0.75·fire`, read from `simulation.getCoverageGrid('police' | 'fire')` at the cell under its hips (both: 2.5×, about 30 s), with one toast the first time the city's crews are in range. When it is spent the kaiju walks toward the nearest map edge for 10 s (still stomping), sinks, and the lots it emptied go to `requestRegrowth` as after a tornado. It does not touch the weather. Where the feet and tail are is pure math in `disasters/kaijuGait.js`, read by both the simulation and the rig (`disasters/kaiju.js`: two instanced meshes of unit boxes, `kaiju:body` with shadows and the self-lit `kaiju:fire` for the eyes, plus `kaiju:breath`, the flame stream as quads from `buildings.api.createFlameMesh(n, name)` — the building fires' shader, which the caller animates through the instance matrices, `userData.param` and the `uTime` / `uGlow` / `uHalo` uniforms — with a glow halo where it lands; group `disasters:kaiju`); a kaiju with bricks in the air adds 10 draw calls (body 1 + 3 shadow cascades, fire 1, brick pool 5) and one more while it breathes. `getKaiju()` returns a copy of the live record or null, `getActive()` stays tornado-only, `getStats()` adds `footfalls` / `breaths` / `ignited` / `kaiju` (its phase: `rise` → `rampage` → `leave` → `sink`). Save field `disasters.kaiju` (position, heading, age, remaining life, gait, phase, feet, target, breath timers; every field sanitised on load, absent in older saves). Sounds `stomp` and `roar`. Showcase variant `kaiju` (stepped in fixed 1/60 s steps until its second fire breath, deterministic across boots), preset `disasters:kaiju`. Out of scope: other hazards.
- Taking things apart (apis the disasters module uses; available to any effect): `buildings.api.getParts(id)` → `{ gen, baseY, height, kind, cx, cz, parts: [{ index, mat, min, max, liner, hidden }] }` (world-space boxes of the generated parts; `gen` changes on every regeneration and part indices are only valid for it), `hideParts(id, indices | 'all')` (stops drawing them on the same frame: `BuildingBatcher` records each part's vertex range in the merged bucket mesh and squashes it there and in the part's own geometry, so it survives re-merges; a removed building otherwise stays drawn for 16–60 frames while its chunk is re-merged; the removal of a fully hidden building defers that re-merge until the chunk has been quiet for 4 s), `regenerate(id)` (whole again, time-sliced), `requestRegrowth([{ i, j }])`; `props.api.getPropParts(id)` → `[{ role, matrix, color, size, center, rotY }]` and `hideProps(ids)` (zero-scales the instances at once, the LOD pass keeps them hidden, a hidden prop stays hidden through re-layouts until it is removed, and the removal of an already-hidden prop defers the layer re-layout by up to 2 s); `traffic.api.pluckVehicles(x, z, r, holdSec = 20)` → `[{ x, y, z, heading, length, width, height, color, specIdx }]`. `buildings.api.stats()` also reports `dirtyChunks` / `rebuilding` / `lazyChunks`.
- People (`props`, `props/people.js`): every person is the same minifig, built by `figureParts()` in `props/spkinds.js` (hip, legs, torso, head, arms and hands, hair or headgear, printed face and torso, belt): the city's `figure` props, the set-pieces' posed `figure_*` kinds and the riders at bus stops. Nobody is baked still. A `figure` standing on a street or avenue sidewalk paces a beat along that edge's sidewalk (lane 0.8 m outside the carriageway, between the junction trims, pausing and turning round at each end); figures sharing one side of one edge split it into exclusive beats, and a beat stops short of anything standing on the pavement, a building, water or a stop's queue, so walkers never cross a carriageway or meet. A park figure (`park` tag) within 7 m of a `path` edge strolls along the path. Yard and civic-entrance figures, the set-piece figures and riders animate in place (idle sway and head turns with an occasional wave, sitting, bending over work, balancing on a board, queueing). The prop record is a walker's home, never its position: nothing is written to it, so saves, the census and `FIGURE_CAP` are unaffected. Animation time is game time (`dt × timeScale`, stopped by the clock's pause, zeroed when the presentation clock is rewound by `__city.resetPresentation()`); at time 0 every figure is drawn at its record in its baked pose (a walker mid-stride, a set-piece figure exactly as authored), and the drawn pose is a pure function of time, so staged captures repeat. `?peopleanim=0` holds time at 0. The pass rewrites only the figures' instances (they are the first instances of each role's mesh, so only that range is uploaded); limbs stop moving beyond 90 m and figures fade out with the rest of the props at 170–220 m. Api: `getDrawnPosition(id)` (where a figure is drawn now; `getPropParts` returns a figure's pieces there too, and `disasters` picks walkers up there), `setGuestFigures(owner, [{ key, x, y, z, rot, pose: 'queue', look? }], { anchors: [{ x, z, r }] })` / `clearGuestFigures(owner)` (minifigs drawn for another module in the same meshes, no extra draw calls; not world props, so not saved or counted; returns the keys drawn, leaving out any that would stand inside an existing prop; anchors are spots walkers stop short of), `peopleStats()`, `people()`, `peopleSetTime(t)` (tooling). `transit` queues its riders through `setGuestFigures` when `props` is loaded and falls back to its own `transit-riders` blocks without it (the transit showcase). Regression: `node tools/check-people.mjs`.
- Save / load (`menu/serialize.js`): a save holds roads, zones, parks, buildings and every prop record as it stood, plus `simulation` / `transit` / `disasters` state. `applySave()` replays them through World's public mutators inside `props.beginReplay()` … `props.endReplay()`: between the two, `props` generates nothing from road / building / park events (the saved props are restored 1:1), and `endReplay()` adopts the restored world (every edge counts as furnished and walked, every ≥3-arm node as signalled, props are re-attached to their owners by tag; edge/node tags are re-pointed at this session's ids by nearest edge / node). Owner tags on prop records: `edgeId` (street furniture + sidewalk figures), `nodeId` (traffic lights), `yardOf` (a building's yard dressing), `park` (park scatter); a removed road or building takes its tagged props with it (`road:removed` with reason `split`/`merge` is the core re-stitching a live road and removes nothing). `simulation.getState().live` carries the model's running fields (`money`, `tick`, `gameSeconds`, `happiness`, `pressure`); `stats` is only their per-tick snapshot. `World.addBuilding/addProp` push the id counter past any counter-style id they are handed, so ids issued after a load never collide with loaded ones. Regression: `node tools/check-playtest.mjs`.
- Night: windows emissive per-building with per-window random on/off seeded; streetlights on when `isNight`; car headlights/taillights.

Per-module draw call budget (full city): terrain 20, environment 10 (+3 shadow cascades), roads 60, buildings 400, props 300, traffic 40, transit 12, effects 25 (fixed post overhead), others ≤ 10 each.

- **Bloom thresholds on luminance**: red/blue emissives need `emissiveIntensity ≥ 4` to bloom at night; yellow/white read at 2.5–3.
- **The post-processing (composer) path is canonical.** The shipped game always runs `effects`; `environment` tunes sky/exposure against the composer (OutputPass tone-maps everything incl. the Sky). Direct rendering is a fallback only.
- **Showcases load `environment` and `effects` automatically** (when those modules load), so every showcase is judged under real sun/sky/night and post. `?bare=1` disables that for debugging.
- **Perf numbers**: headless fps is vsync-pinned (~144). Use `gpuMs`/`gpuFps` from the shot JSON (GPU timer query, median of 60 frames) as the truth; budget is gpuMs ≤ 20 (≥ 50 fps) for the full city.

## 8. Verification tools
```
node tools/shot.mjs --showcase roads --variant default --preset overview --tod 17.5 --seed 1 --out shots/roads/overview-17.png
  → writes PNG + .json { url, fps, frameMs, gpuMs, gpuFps, drawCalls, triangles, errors, warnings, modules, gpu }
node tools/shot.mjs --preset skyline --tod 21.5 --out shots/game/night.png      # full game (demo city)
node tools/critic.mjs --module roads --round 1     # presets × tod {6.5, 12, 18, 21.5} → shots/roads/r1/ + summary.json
node tools/critic.mjs --game --round 1             # full game, standard presets
node tools/status.mjs set roads score=7.5 round=2 pass=false issues="a;b;c" review=docs/reviews/roads-r2.md
```
The dev server must stay up on http://127.0.0.1:5188 (`npm run dev`). Never kill it. Never change its port.

## 9. Process
1. Builder: read this file + `docs/REFERENCE.md`, implement in your folder, screenshot, look, iterate, then report with paths to screenshots and real numbers. If you need a core change, write `docs/core-requests/<id>.md` (what, why, proposed diff) — do **not** edit core.
2. Critic: no code. Takes own screenshots via `tools/critic.mjs`, scores 0–10 vs reference (10 indistinguishable, 8.5 AAA with nits, 7 good indie, 5 programmer art), lists ranked issues, writes `docs/reviews/<id>-r<N>.md`, updates STATUS.json. Pass = score ≥ 8.5 AND `errors: []` AND within perf budget.
3. Integrator: applies core requests, fixes seams between modules, keeps app loadable.
4. Loop resumes from the weakest module in `docs/STATUS.json`. Max 4 builder rounds per module.
