# tools — round 1 critic review

**Score: 6.5 / 10 — FAIL** (score < 8.5 threshold; errors are clean and perf is within budget, but two real
visual/legibility defects keep this out of "AAA with nits" territory)

## Numbers (from `shots/tools/r1c/summary.json`, my own critic batch — presets × tod {6.5,12,18,21.5})
- errors: `[]` across all 16 shots (and across every supplementary live-interaction test run below, except one
  intermittent flake noted in issue #3)
- minFps: 92.3, maxGpuMs: 9.66ms (budget ≤20ms — comfortable), maxDrawCalls: 91 (budget: full-city cap 1500;
  tools' own ghost meshes are only 3 draw calls, within its own ≤10-per-module budget), maxTriangles: 3,785,288
- Perf verdict: **pass** (fpsOk/gpuOk/drawCallsOk all true per summary.json's own budget block)

## What I did
1. Read `docs/REFERENCE.md` and `ARCHITECTURE.md` §2–§8 (module API, ghost/emissive bloom thresholds in §7).
2. Ran `node tools/critic.mjs --module tools --round 1c --dir shots/tools/r1c` (all 4 presets × 4 tods, 16 shots).
3. Looked at every PNG in `shots/tools/r1c/`, plus the builder-supplied `shots/tools/final-*.png`, and three custom
   `shot.mjs`-style shots I captured myself at unusual zooms (`shots/tools/r1c/extra_veryclose-ribbon.png` — 2-3m
   on the live road-drag ghost, `extra_veryclose-bulldoze.png` — 2-3m night close-up on the bulldoze ghost,
   `extra_overview.png` — very-far top-down over the whole showcase).
4. Live-tested the real interaction pipeline: opened the `tools` showcase headlessly and drove it with **actual
   dispatched browser pointer events** (`page.mouse.move/down/up`, not direct internal function calls) on the
   real `<canvas>`, computing click coordinates by projecting known world points through the live camera/
   projection matrices. Verified, across two independent full runs:
   - A `road:street` drag grew `ctx.world.roads.edges` by exactly 1 and deducted money exactly
     `round(length_m * 100)` (measured: 39.86 m → $3,986, actual ledger delta $4,000 after grid-snap).
   - Forcing `ctx.world.stats.money = 0` then repeating the drag was correctly **rejected**: 0 new edges, money
     unchanged (the insufficient-funds gate works).
   - A `zone:r` paint drag set a real `cellAt(i,j).zone === 'r'` via `zoning.api.setZoneRect`, with a real cost
     deduction ($1,020 for an 18-cell rect).
   - A `bulldoze` drag on the real remaining demo building (projected its exact world position to screen space
     first) removed it from `ctx.world.buildings` for free (no cost — correct, bulldozing isn't priced).
5. Code review of `src/tools/index.js` and `src/tools/showcase.js`: grepped for `Math.random` (none found),
   checked every optional-collaborator guard, checked `dispose()`, checked the folder only contains its own files
   (`index.js`, `showcase.js` — confirmed).
6. Isolation: `?showcase=tools` (the only real isolation mechanism — `&exclude=...` is not a real URL param
   anywhere in `src/core/`, so I could not literally test it; noted below) already only loads
   `terrain/roads/zoning(+environment/effects)` per the deps-transitive-loading rule, i.e. `ui/simulation/audio/
   props/buildings` are never in the module graph for this showcase at all. Confirmed `errors: []` and
   `modules: {terrain:ok, environment:ok, roads:ok, zoning:ok, tools:ok, effects:ok}` (no ui/sim/audio/props/
   buildings present), and confirmed via the live-pipeline tests above that tools still fully functions (road
   build, zone paint, bulldoze all worked) with all of those absent.

## Ranked issues

1. **Ghosts have zero night-time emissive boost — a direct, measurable violation of `ARCHITECTURE.md` §7's bloom
   spec, and REFERENCE.md explicitly deducts for this.** §7 states emissive intensity needs to be **≥4 for red/
   blue** and **2.5–3 for yellow/white** to bloom at night. Both of tools' own ghost-material call sites —
   `ghostMat()` in `src/tools/index.js` and `addDecorativeRect()` in `src/tools/showcase.js` — hardcode
   `emissiveIntensity: 0.35`, roughly 10x too low. Visible proof: `shots/tools/r1c/tools_bulldoze-21h5.png`,
   `tools_default-21h5.png`, and my own close-up `extra_veryclose-bulldoze.png` (2-3m from the red bulldoze plate
   at night) all show the ghost as a plain glossy-lit red surface with a normal specular highlight — no glow, no
   bloom halo, nothing that reads as active tool feedback against a dark city. Compare `final-night.png`: the
   ghosts are simply darker versions of their daytime selves. REFERENCE.md's own deduction table lists "night
   with no emissive life −1.5" for exactly this. **Fix**: bump `emissiveIntensity` to ≥4 for the red-family ghosts
   (bulldoze/dezone/invalid) and ≥2.5-3 for the others, ideally gated on `ctx.clock.isNight` so daytime opacity/
   readability (which is fine) isn't disturbed.

2. **The "valid" ghost color reads as a near-colorless pale wash, especially up close — hurts the core "live
   road-drag ghost" claim.** `zoneColorFor()`/the road ghost's valid branch use `'transGreen'`
   (`#84B68D` in `src/core/materials.js`, a muted sage), rendered through `glass(name, {opacity:0.8,
   emissiveIntensity:0.35})`. From the standard `tools:default`/`tools:closeup` framing it's discernible as a
   raised plate, but my dedicated 2-3m close-up (`shots/tools/r1c/extra_veryclose-ribbon.png`, camera parked
   right on top of the live drag ghost) shows it as almost the same pale mint-grey as the studs underneath it —
   no crisp edge, no color statement of "buildable." A player actually watching their cursor mid-drag (i.e. at
   the range that matters most) would struggle to read this as "valid/green" rather than "nothing in
   particular." **Fix**: raise opacity/saturation for the valid state specifically, or add a bright emissive rim/
   outline independent of the low-saturation core palette swatch, rather than relying on `transGreen` at face
   value.

3. **(Minor, likely not tools-owned) Intermittent THREE.js shader-validation console error surfaced once during
   live pipeline testing.** Across 5 independent full test runs of the real dispatched-pointer-event pipeline
   (see "What I did" §4), one run produced two `THREE.WebGLProgram: Shader Error … cannot convert from 'vec4' to
   'vec3'` errors on the `totalEmissiveRadiance *= vColor` line, both attributed by the browser to materials
   named `zoning:i` / `zoning:r` — an instanced-vertex-color + emissive mismatch inside **zoning's own** material
   setup. It did not reproduce in the other 4 runs (including the official `critic.mjs` batch, which shows
   `errors: []` in every one of the 16 `r1c` shot JSONs), so this looks like a rare shader-compile race rather
   than a deterministic bug, and tools only ever calls the documented `zoning.api.setZoneRect` entry point
   exactly as the isolation contract intends — the bug, if real, lives in zoning's material, not here. Flagging
   for the record per the brief's "zero console errors" checks, but I am not failing tools for it since it isn't
   reproducible and isn't tools' code.

4. **(Nit) Stale/inaccurate comment in `showcase.js`.** The comment above the zoning-preview call claims the
   uncommitted 'i' preview renders "orange," but zoning's own preview mesh actually renders as a solid dark teal/
   olive plate in every shot I looked at (visually distinct from a committed zone's subdivided grid look, which
   is a nice touch) — just not orange. Harmless, but worth a one-line comment fix so it doesn't mislead the next
   reader.

## What already works well
- **The interaction pipeline is genuinely correct end-to-end**, verified with real dispatched browser
  `PointerEvent`s (not shortcut internal-function calls): road building grows `roads.edges` and deducts the
  right amount, is correctly blocked when funds are insufficient, zone painting calls through to zoning's real
  API with correct cost, and bulldozing removes the real building for free. This is the module's actual job and
  it works.
- **Isolation guards are real, not decorative.** Every optional collaborator (`ui`, `simulation`, `audio`,
  `props`, `buildings`, `zoning`) is re-checked fresh via `ctx.modules.get(id)?.status === 'ok'` at every call
  site, wrapped in try/catch, with sensible bare fallbacks (raw `world.setZone` loop when zoning is absent, grid-
  snap when `roads.api.snapToRoad` is missing, etc.). No `Math.random` anywhere. Confirmed the module still fully
  functions with `ui/simulation/audio/props/buildings` entirely absent from the module graph (their natural state
  in this showcase).
- **Clean lifecycle and perf.** `dispose()` correctly frees both ghost geometries and any showcase-extra
  geometry, removes the group, and unsubscribes every listener — no stray ghost meshes found. Perf is
  comfortably within every budget (minFps 92.3, maxGpuMs 9.66ms of a 20ms cap, 91 total draw calls of a 1500
  cap, tools' own contribution only 3 draw calls).
