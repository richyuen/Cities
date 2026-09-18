# props — critic review, round 2

**Score: 8.7 / 10 — PASS** (≥ 8.5 bar). All 5 round-1 issues are genuinely fixed, not just cosmetically patched —
each was independently re-verified this round with my own screenshots at locations/angles the builder hadn't
already shot, plus live `page.evaluate` probes of the actual material and de-dup-guard state. Zero console errors,
comfortable perf margin, no `Math.random`, API contract unchanged and correct. This is now genuinely AAA-with-nits:
the remaining gaps are minor polish, not structural defects.

## Numbers
- Errors: **0** across every shot — `shots/props/r2c/summary.json`, `shots/props/r2c-park/summary.json`, and all
  12 of my own custom `shots/props/r2c-extra/*.json` probes. `moduleErrors: {}` throughout.
- Perf (gpuMs is the trustworthy number; fps is vsync-pinned near the 144 cap):
  - `r2c` (variant default, 3 own presets × 4 tods): minFps 116.5, **maxGpuMs 8.21** (budget ≤20), maxDrawCalls 188
    (scene-wide, budget 1500 per the tool's own check).
  - `r2c-park` (variant park): minFps 119.5, **maxGpuMs 8.34**, maxDrawCalls 91.
  - Both comfortably inside budget; `budget.fpsOk/gpuOk/drawCallsOk` all `true`. (One transient puppeteer
    "execution context destroyed" crash occurred on my first `--variant park` critic.mjs run and separately on one
    custom night shot — a flaky navigation/tooling hiccup, not a props error; both re-ran clean immediately after.)
- **Props' own draw calls, verified live**: exactly **22** (one `InstancedMesh` per populated role), unchanged
  from r1 — well inside the §7 budget of 300. What changed is density: the default showcase now places **71
  props** (`stats().byKind`: 22 streetlamp, 14 hedge, 12 traffic_light, 12 trees across 3 sizes, 4 flower_bed, 2
  bus_stop, 2 hydrant, 2 trash_bin, 1 road_sign) versus r1's 12 (exactly one of each kind) — a genuine ~6×
  density increase at the same 22-draw-call cost, confirming the fix is real population, not padding.
- No `Math.random` anywhere in `src/props/**` (grepped, 0 hits); folder still contains only its own 6 files
  (`index.js`, `kinds.js`, `materials.js`, `geo.js`, `populate.js`, `showcase.js`); `deps: ['terrain','roads']`
  and `order: 45` still match `ARCHITECTURE.md`.

## Issue-by-issue verification (round 1 → round 2)

1. **Sparse/empty street showcase → FIXED.** `showcase.js:stageStreet()` now builds a real one-block road
   *network* (two through streets + two cross streets, 4 genuine 3-arm T intersections), runs the module's own
   `populateAlongRoad` on every segment (real ~24 m lamp spacing, alternating sides, occasional bin/bench/sign),
   `populateIntersectionNode` on every intersection (traffic lights on every arm), plus repeated hand-placed set
   pieces (7 trees, 2× 4-block hedge rows, 3 flower beds, 2 hydrants, 2 bus stops, plus cross-street and
   back-street dressing) — never one-of-a-kind. Verified independently, not just by re-reading the builder's own
   shots: my own top-down `shots/props/r2c-extra/overhead-wide.png` (true overhead, custom camera) shows lamps at
   regular intervals down all four road segments, hedge patches, trees, a bus stop and a hydrant all in frame at
   once; my `eyelevel-wide.png` (pedestrian-height, 60° fov down the front street) shows 6+ lamps, 3 tree sizes,
   a traffic light and a bus-stop roof all readable in one frame. `props_default-12.png`/`props_closeup-*.png`
   (my own `--round 2c` batch) confirm the same at the registered presets. Quantitatively: 71 props vs r1's 12 in
   the same showcase. This reads as a genuinely furnished street now, not a museum strip. (The block *interior* is
   bare grass in every shot — expected, since props' showcase never spawns buildings; not a defect.)
2. **Trees read as a balloon-on-a-stick → FIXED.** `tree-leaves` is now a merged 4-lobe geometry (overlapping
   low-poly icosahedra, offset off-centre) rather than a single icosahedron, and `buildTree()` stacks 2–4
   independently-sized/rotated/jittered instances of that blob per tree (even `tree_small` gets a minimum of 2).
   The foliage material was also retuned specifically for this role: `roughness: 0.88, clearcoat: 0.04,
   clearcoatRoughness: 0.7`, `flatShading: true` — a matte, faceted look distinct from the glossy hardware plastic.
   Verified independently at an extreme close-up the builder hadn't shot (`tree-large-alt2.png`, a different kind
   and location than the builder's `tree-medium.png`): unmistakably a cluster of separate lumpy, flat-shaded
   facets — genuinely reads as stacked Lego foliage, not a smooth plastic sphere. The autumn colour variant
   (visible in several shots) adds welcome variety.
3. **hedge/flower_bed unadorned boxes → FIXED.** `hedge-block` is now a low base plus 3 overlapping rounded
   bevel-box lumps (`lumpL/lumpM/lumpR`, different heights/offsets) instead of one flat box — my own
   `hedge-alt2.png`, shot on the back-street hedge run (a different row than the builder's), clearly shows a
   lumpy, individually-bulging top silhouette, not a crate. `flower_bed` now gets 5–9 real per-instance
   stem+bloom flower props (`addFlowerHeads`, `flowerbed-flower` role: cylinder stem + icosahedron bloom, 6
   colours) scattered across the planter instead of flat coloured cylinder chips — my `flowerbed-alt2.png`, shot
   at a different bed (x=70) than the builder's (x=-66), shows clearly raised, colourful stem-and-bloom flowers.
   Both fixes read correctly from a normal viewing distance too (`props_default-12.png`, `overhead-wide.png`).
4. **bus_stop glass opaque → FIXED.** `busstop-panel`'s material is now `M.glass('mediumAzur', { roughness: 0.12,
   opacity: 0.42, transmission: 0.5 })` instead of flat opaque plastic. Verified live, not just visually: I read
   the actual `THREE.MeshPhysicalMaterial` instance straight off the running scene via
   `scene.getObjectByName('props').traverse(...)` and got `{ type: 'MeshPhysicalMaterial', transparent: true,
   opacity: 0.42, transmission: 0.5, roughness: 0.12 }` — genuinely transmissive, not a cosmetic transparent
   flag. Visually, the builder's own `bus-stop-glass2.png` and `bus-stop-glass2-night.png` show a correctly
   blue-tinted, semi-see-through panel with the field/sky visible through it, consistent with those numbers. (My
   own two alternate-angle bus-stop shots approached from the shelter's open side and mostly missed the panel
   face — a framing miss on my part, not a rendering defect; the live material readout plus the builder's own
   shots already settle this conclusively.)
5. **No de-dup guard on `populateAlongRoad` → FIXED.** `populate.js` now keeps a module-level `populatedEdges`
   `Set`; the function returns `[]` immediately if `edgeId` is already in it. Verified live end-to-end: I added a
   brand-new road edge at runtime (`world.addRoad`, well clear of the showcase content, so no `road:added`
   auto-listener interference since it's disabled in showcase mode) and called `props.api.populateAlongRoad`
   three times in a row — first call created 6 props (`world.props.size` 71→77), second and third calls were
   exact no-ops (77→77→77, `created.length === 0` both times). The guard works exactly as documented.

## What already works (carried over / reconfirmed)
- **Individual hardware kinds remain well-made, distinct Lego assemblies**: streetlamp, hydrant, bench/park_bench,
  trash_bin, traffic light, road sign and the fountain (with its animated spray) all still read immediately as
  their real-world object at any distance — unchanged and still solid.
- **Night behaviour remains correct**: lamp bulbs and traffic-light lenses still cycle correctly (visually
  confirmed in `props_default-21h5.png`/`props_park-21h5.png` and the builder's `bus-stop-glass2-night.png`); the
  pooled light system still lights the nearest lamps.
- **Perf and correctness remain rock-solid**: still 22 draw calls for props' own content at 6× the prop count,
  gpuMs never above 8.34 ms anywhere (budget 20), zero console errors across ~40 screenshots and several scripted
  live-API probes this round, fully deterministic seeded placement.

## Remaining nits (do not block pass, worth a look next round)
1. **Overhead/plan-view density is still noticeably thinner than an eye-level view suggests** (`overhead-wide.png`):
   real-world 24 m lamp spacing is honest and correct, but from directly above the four road segments still read
   as widely-dotted rather than dense. Not a defect — this is what the documented spacing produces — but if a
   denser "AAA downtown street" look is wanted later, either tighten `LAMP_SPACING` for higher-density road kinds
   or increase the extra-furniture roll chance (`prng.chance(0.55)` in `populate.js`).
2. **Flower blooms are still simple icosahedra** (`flowerbed-alt2.png`): a big improvement over flat chips and
   reads fine as "flowers" from normal distance, but at extreme close range they're still one primitive shape per
   bloom rather than distinct petals. Minor — would only matter for a hero close-up shot.
