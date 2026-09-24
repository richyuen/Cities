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
                               // buildings 40, props 45, traffic 50, simulation 60, tools 70, ui 80, audio 85, effects 90, menu 95, demo 5
  async init(ctx) {},          // build persistent state, subscribe to events, add objects to ctx.scene
  update(dt, ctx) {},          // per frame; dt seconds (clamped ≤ 0.1). Keep it cheap.
  dispose(ctx) {},             // remove objects, unsubscribe
  async showcase(ctx, variant = 'default') {}, // stage a demo scene of this module; may call ctx.world mutators
  showcaseVariants: ['default', 'night'],       // optional list, for tools/critic.mjs
  presets: { 'roads:intersection': { pos: [40, 30, 60], target: [0, 0, 0] } }, // optional camera presets
  api: {},                     // public functions other modules may call via ctx.modules.get('roads').api
};
```
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
  props: Map<id, { id, x, y, z, rot, kind }>
  weather: { kind: 'clear'|'cloudy'|'rain'|'fog', intensity: 0..1, wind: [x,z] }
  stats: { population, jobs, money, happiness, traffic }
  heightField: Float32Array((w+1)*(h+1))   // vertex heights, meters; terrain owns
}
```
Mutators (all emit events, all deterministic): `setHeight(i,j,h)`, `getHeight(x,z)` (bilinear, meters), `setCell(i,j,patch)`,
`addRoad(a:{x,z}, b:{x,z}, kind, {bridge?, snapNodes?, oneway?})` → edgeId, `removeRoad(edgeId)`,
`planRoadEdit(a, b, kind)` → read-only `{ edges, length, coverage, blocked } | null` (the drag-over upgrade verdict),
`upgradeRoad(a, b, kind, {oneway?})` → `{ edges, length, kindChanged, dirChanged } | null` (in-place kind/width/
direction edit of the existing road the drag follows; emits `road:changed` per edge), `setZone(i,j,zone,density)`, `addBuilding(rec)` → id, `removeBuilding(id)`,
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
| `settings:changed` | `{ quality?: 'low'/'medium'/'high', studs?: boolean }` (only changed key) | ui |
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
`overview` (aerial 45°, whole city), `skyline` (low, wide, looking at downtown), `street` (1.7 m eye height on a road),
`aerial` (top-down-ish 70°), `closeup` (10 m from a building corner), `night` (= skyline; the tool forces tod 21.5).
Controls: left-drag orbit, right-drag pan, wheel zoom, WASD pan. Camera never goes below terrain + 1 m.

## 7. Visual standard & materials
- Blox palette (`ctx.materials.palette`): `brightRed, brightBlue, brightYellow, brightGreen, darkGreen, white, black, darkStoneGrey, mediumStoneGrey, lightStoneGrey, tan, brickYellow, reddishBrown, darkOrange, brightOrange, mediumAzur, darkAzur, lime, mediumLilac, sandGreen, sandBlue, darkRed, transClear, transBlue, transYellow, transRed`.
- `ctx.materials.plastic(name, { roughness=0.35, clearcoat=0.6, clearcoatRoughness=0.15 })` returns a cached shared `MeshPhysicalMaterial`. Share materials; never create per-object materials in loops.
- Studs: everything horizontal that is "Blox" gets studs (ground plates, roofs, road shoulders). Use `ctx.materials.studs()` which returns an `InstancedMesh` helper: `studs.add(x,y,z,colorName)`, `studs.commit()`, `studs.clear()`. Stud pitch in-world **0.8 m** (1 cell = 10 × 10 studs). Stud radius 0.24 m, height 0.17 m. Use LOD: studs fade beyond ~250 m.
- Lighting is owned by `environment`: sun `DirectionalLight` (3-cascade via `three/addons/csm/CSM.js`), sky hemisphere/ambient, HDRI/procedural environment map for reflections, fog. Other modules must not add lights except local point lights for night (props/buildings; pooled, ≤ 48 real point lights, rest emissive-only).
- Post (`effects`): SMAA, GTAO, bloom (threshold ≥ 1.0, subtle), vignette. Tone mapping ACES filmic is set by core renderer; exposure is set by environment via `ctx.renderer.toneMappingExposure`.
- Roads: dark grey plates, white/yellow lane markings, curbs, stud sidewalks; intersections with proper corner geometry, no z-fighting (use `polygonOffset` or small Y offsets). One-way edges additionally print lane arrows (white, ~12 m apart, on every usable lane) pointing along the permitted flow; two-way roads are unchanged.
- Night: windows emissive per-building with per-window random on/off seeded; streetlights on when `isNight`; car headlights/taillights.

Per-module draw call budget (full city): terrain 20, environment 10 (+3 shadow cascades), roads 60, buildings 400, props 300, traffic 40, effects 25 (fixed post overhead), others ≤ 10 each.

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
The dev server must stay up on http://127.0.0.1:5173 (`npm run dev`). Never kill it. Never change its port.

## 9. Process
1. Builder: read this file + `docs/REFERENCE.md`, implement in your folder, screenshot, look, iterate, then report with paths to screenshots and real numbers. If you need a core change, write `docs/core-requests/<id>.md` (what, why, proposed diff) — do **not** edit core.
2. Critic: no code. Takes own screenshots via `tools/critic.mjs`, scores 0–10 vs reference (10 indistinguishable, 8.5 AAA with nits, 7 good indie, 5 programmer art), lists ranked issues, writes `docs/reviews/<id>-r<N>.md`, updates STATUS.json. Pass = score ≥ 8.5 AND `errors: []` AND within perf budget.
3. Integrator: applies core requests, fixes seams between modules, keeps app loadable.
4. Loop resumes from the weakest module in `docs/STATUS.json`. Max 4 builder rounds per module.
