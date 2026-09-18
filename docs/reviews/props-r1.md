# props — critic review, round 1

**Score: 6.2 / 10 — FAIL** (below the 8.5 pass bar). Perf, API correctness and night lighting are genuinely strong —
close to AAA already — but the module's own showcase reads as an empty field with a lonely road rather than a lived-in
street, and 5 of the 14 kinds (the three tree sizes, hedge, flower_bed) are primitive-shape Lego assemblies (a glossy
ball on a stick; a plain green box) rather than distinct, readable objects. Zero console errors and comfortable perf
margins throughout.

## Numbers
- Errors: **0** across every shot this round — `shots/props/r1/summary.json`, `shots/props/r1-park/summary.json`,
  and all custom `shots/props/r1-extra/*.json` probes. `moduleErrors: {}`, all deps (`terrain`, `roads`, `environment`,
  `effects`) report `"ok"`.
- Perf (gpuMs is the trustworthy number; fps is vsync-pinned near the 144 cap):
  - `r1` (variant default, 3 own presets × 4 tods): minFps 143.4, **maxGpuMs 6.33** (budget ≤20), maxDrawCalls 145 (scene-wide, budget 300).
  - `r1-park` (variant park, `--dir shots/props/r1-park`): minFps 126.6, **maxGpuMs 7.74**, maxDrawCalls 88.
  - Both comfortably inside budget; `budget.fpsOk/gpuOk/drawCallsOk` all `true`.
- **Props' own draw calls, verified live** via `scene.getObjectByName('props').traverse(...)` in the default showcase:
  exactly **22** — one `InstancedMesh` per populated role (lamp-pole/head/bulb, bench-frame/planks, hydrant-body/trim,
  bin-body/lid, busstop-frame/roof/panel/seat, trafficlight-body + 3 lenses, sign-post/face, tree-trunk/leaves,
  hedge-block) — matching the builder's own ~10–22 report and `props.api.stats().drawCalls`. In the park variant this
  drops further (no traffic light/bus stop/hydrant roles in use). Nowhere close to the §7 budget of 300 for the full city.
- No `Math.random` anywhere in `src/props/**` (grepped); folder contains only its own 6 files (`index.js`, `kinds.js`,
  `materials.js`, `geo.js`, `populate.js`, `showcase.js`); `deps: ['terrain','roads']` and `order: 45` match `ARCHITECTURE.md`.

## API contract — verified live via `page.evaluate`, all correct
- `populateAlongRoad(edgeId)` on the showcase's one road edge (`e0`, length 136m): added 8 new props on a second call —
  streetlamps at x = **-59, -35.4, -11.8, 11.8, 35.4, 59** (spacing ≈23.6m, matching `LAMP_SPACING=24` minus the two
  9m end-insets, alternating `z=+5.4/-5.4` sides, `rot` flipping 180° each time) plus occasional extra `bench`/`trash_bin`
  at the correct opposite-side offset. Spacing, offsets and alternation are all plausible and deterministic.
- `populatePark(cells)` on a fresh 5×5 cell cluster: returned 83 new prop ids — 1 `fountain` at the cluster centroid,
  29 `hedge` border segments with gap-skipping, and a `targetTrees≈20` / 3 `park_bench` / 2 `flower_bed` scatter, exactly
  matching `populate.js`'s documented ratios. No errors, no overlap with the pre-existing showcase content.
- `stats()` returns `{count, byKind, drawCalls}` correctly and matches a live scene traversal (see above).
- **Traffic-light night cycling, isolated test**: forced `tod=22`, read `props-trafficlight-lens-{red,yellow,green}`
  material `emissiveIntensity` directly across several phase transitions: `green:3.5→others:0.12`, then
  `red:4.5→others:0.12` — exactly one lens lit at night intensity at a time, the other two held at the dim 0.12 "off"
  value. This is correct and matches the rubric's "single-lit-lens cycling" expectation.
- Robustness gap (not exercised by the showcase, but real): `populateAlongRoad` has **no de-dup/idempotency guard**.
  Calling it twice on the same `edgeId` (as the code comments say both the module's own `road:added` listener *and*
  `tools`, after an interactive placement, may do) silently doubles every lamp/bench/bin on that edge. Worth a guard
  (e.g. tracking populated edge ids) before this ships.

## Ranked issues
1. **The module's own street showcase reads as an empty field with a lonely road, not a lived-in street**
   (`shots/props/dev-1.png`, `shots/props/r1/props_default-*.png`, and especially my own far-overview
   `shots/props/r1-extra/overview-far.png`, camera straight overhead at 90m). `showcase.js:stageStreet()` places each
   of the 12 street-furniture kinds **exactly once**, spread one-per-station across a 136m road, so at any normal
   camera distance you see 2–4 isolated props separated by long stretches of bare sidewalk and a huge empty green
   field beyond it. The underlying auto-population algorithm is *not* the problem — my live `populateAlongRoad` test
   above shows correct ~24m lamp spacing with real furniture density when run twice — this is purely how the showcase
   stages itself. Fix: either shorten the demo road / tighten the camera framing so more of the staged kinds are in
   frame at once, or call `populateAlongRoad`-style repetition (a few real 24m-spaced blocks) instead of one-of-each,
   so the showcase demonstrates the density the module can actually produce.
2. **Trees (all 3 sizes) read as a glossy ball on a stick, not a Lego tree** (`shots/props/r1-extra/k-tree_small.png`,
   `k-tree_medium.png`, `k-tree_large.png`, `shots/props/dev-3.png`). `tree-leaves` is a plain `UNIT_ICO` (icosahedron,
   1 subdivision) with the shared clearcoat/roughness-0.4 instance-colour plastic — up close it is an unmistakable
   smooth plastic balloon with a huge blown specular hot-spot, not "stacked leaf elements" per `REFERENCE.md` §1. Even
   `tree_large`'s 2–3 stacked clusters (visible in `dev-3.png`) still reads as stacked balls rather than foliage. Needs
   either a rougher/less-mirror leaf material tuned specifically for this role, or a less spherical/more faceted leaf
   shape (a shallow cone-stack or a lower-poly "pom-pom" silhouette) so it doesn't read as a balloon.
3. **hedge and flower_bed are unadorned coloured boxes**, not shrubbery/flowers (`k-hedge.png`, `park-hedge.png`,
   `park-bed.png`). `hedge-block` is a single 2×0.7×0.6 bevel box with no surface break — reads as a green crate/plinth
   sitting on the sidewalk. `flowerbed-base` + `flowerStuds` renders as flat coloured cylinder "chips" laid on a green
   tray, not flowers. Both are technically distinct assemblies (correct colour, correct footprint) but neither
   communicates its identity from more than a few metres away; consider breaking the hedge into 2–3 smaller overlapping
   blobs/blocks and raising the flower studs' profile (a small cone/sphere top) so they don't read as flat chips.
4. **bus_stop's glass wall is opaque plastic, not transmissive**, contra `REFERENCE.md` §2 ("transparent elements are
   real transmissive plastic") (`shots/props/r1-extra/k-bus_stop.png`). Every other module that needs "glass" (this
   module's own `fountain-bowl`) correctly uses `ctx.materials.glass(...)`, but `busstop-panel` is assigned the flat
   opaque `M.plastic('mediumAzur', ...)` in `materials.js`. Easy fix: swap it to `M.glass('mediumAzur', ...)` like the
   fountain bowl.
5. *(minor, tooling not module)* `tools/critic.mjs`'s own-preset auto-selection isn't variant-aware: under
   `--variant park` the `props:default`/`props:closeup` camera presets point at the old street coordinates, which
   `stagePark()` has cleared, so those shots are blank grass (`shots/props/r1-park/props_default-12.png`,
   `props_closeup-12.png`); symmetrically, under the default variant the `props:park` preset just shows the street
   scene from a birds-eye angle. Not a props defect, but worth knowing when reading the r1/r1-park folders — the
   correctly-paired shots (`props:default/closeup` × variant default, `props:park` × variant park) are the meaningful
   ones and were judged above.

## What already works
- **Individual hardware kinds are well-made, distinct Lego assemblies at any distance**: streetlamp (base/shaft/tilted
  neck/arm/head/bulb), hydrant (base/body/collar/dome/twin nozzles/bolt), bench/park_bench (legs/seat/backrest, correct
  frame-colour swap), trash_bin (body/domed lid), bus_stop (twin posts/beam/roof/sign/back+side panel/seat) and the
  fountain (stepped base → pedestal → bowl → rim, with an animated spray) all read immediately as their real-world
  object from both the default showcase and my own close-ups (`k-hydrant.png`, `k-trash_bin.png`, `k-bus_stop.png`,
  `park-fountain.png`).
- **Night behaviour is correct and convincing**: lamp bulbs swap from a near-off day emissive (0.05) to a warm glow
  (3.4) exactly on the `time:changed` day/night flip, the 14-light pool re-targets the nearest lamps to the camera
  every 0.4s, and traffic-light lenses cycle with exactly one lens lit at night intensity while the other two sit at
  a dim, definitely-off 0.12 — verified both visually (`dev-night.png`, `dev-night-closeup.png`) and by reading
  material `emissiveIntensity` directly through several phase transitions.
- **Perf and correctness are rock-solid**: 22 draw calls for the module's own content (budget 300), gpuMs never above
  7.74ms anywhere (budget 20), zero console errors across ~50 screenshots and several scripted live-API probes, fully
  deterministic seeded placement (no `Math.random`), and `populateAlongRoad`/`populatePark` both produce exactly the
  spacing/ratios their source code promises when driven live.
