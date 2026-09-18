# Builder brief (read fully before writing code)

You are one builder agent in a multi-agent pipeline building an AAA-looking, Lego-brick-styled city builder
("Lego Skylines") in Three.js 0.186 + Vite 8, plain ES modules. Project root: `C:\Git\Cities`.

## Read first
1. `ARCHITECTURE.md` — the contract (module API, ctx, world model, events, budgets, visual standard).
2. `docs/REFERENCE.md` — the visual rubric the critic scores against.
3. `src/core/*.js` — the actual core (materials.js, world.js, clock.js, assets.js, camera.js, context.js are the ones you'll use).
4. `shots/core/sanity.png` — what core materials/studs/shadows look like through the real pipeline.
5. `public/assets/manifest.json` — the CC0 assets already downloaded (HDRIs: sky_day, sky_noon, sky_sunset, sky_dawn, sky_overcast, sky_night; PBR sets: asphalt, concrete, pavers, grass, rock, sand, soil).

## Hard rules
- You own **only** `src/<your-module>/`. Never edit `src/core/`, any other module folder, `ARCHITECTURE.md`, `tools/`, `index.html`, `package.json`. If you need a core change, write `docs/core-requests/<your-module>.md` (what, why, minimal proposed diff) and work around it meanwhile.
- The dev server is already running at http://127.0.0.1:5173 with HMR. **Never start, stop, or restart it. Never change its port.** Other agents are screenshotting it concurrently.
- No `Math.random()`. Use `ctx.rng.fork('<module>')` (keep the fork in module state) or `rng.hash2/hash3/noise2D/fbm`.
- CC0 assets only (already in manifest) or procedural. Do not download anything else.
- No programmer art: no `MeshBasicMaterial` on world geometry, no unlit surfaces, no default cubes. Use `ctx.materials.plastic()/glass()/emissive()/bevelBox()/studs()`. Share materials; never create a material per object in a loop.
- Zero console errors and warnings you cause. `errors: []` in the shot JSON is a hard requirement.
- Stay within your draw-call budget (ARCHITECTURE.md §7). Use InstancedMesh / merged geometry.
- Do not ask questions. Make routine decisions, state assumptions in your report, keep going.
- Never claim something works that you haven't screenshotted and looked at (use the Read tool on the PNG).

## Workflow
1. Implement `src/<id>/index.js` (+ private helpers in the same folder) per the module API. Include `showcase(ctx, variant)`, `showcaseVariants`, and camera `presets` named `<id>:default`, `<id>:closeup`, and at least one more.
2. Screenshot:
   ```
   node tools/shot.mjs --showcase <id> --preset <id>:default --tod 15 --out shots/<id>/dev-1.png
   node tools/shot.mjs --showcase <id> --preset <id>:closeup --tod 18 --out shots/<id>/dev-2.png
   node tools/critic.mjs --module <id> --round 0        # all presets × tod 6.5/12/18/21.5 → shots/<id>/r0/
   ```
   Read every PNG. Fix what looks wrong. Iterate until it looks AAA to you. Check the `.json` next to each PNG for `errors`, `fps`, `drawCalls`.
3. Showcases automatically load `environment` (sun/sky/shadows/night) and `effects` (post) alongside your module, so what you screenshot is what the critic judges. Don't add directional/hemisphere lights yourself (unless you are `environment`). Time of day matters: check 6.5, 12, 18 and 21.5.
4. Final report (plain text, honest): what you built, the public `api`, events consumed/emitted, final screenshot paths (at least 3 including a night shot), real fps/drawCalls/triangles from the JSON, known gaps, and any `docs/core-requests/<id>.md` you wrote.

## Tips
- `three/addons/...` imports work (e.g. `three/addons/utils/BufferGeometryUtils.js`, `three/addons/csm/CSM.js`, `three/addons/objects/Sky.js`, `three/addons/postprocessing/*`).
- Terrain height at any point: `ctx.world.getHeight(x, z)`; cells: `ctx.world.cellAt(i, j)`, `cellToWorld`, `worldToCell`. Cell size 8 m, stud pitch 0.8 m.
- Shadows are on (PCFSoft). Set `castShadow/receiveShadow` on your meshes.
- `ctx.clock.sunDir` (unit vector toward the sun), `ctx.clock.isNight`, `ctx.clock.daylight` (0..1); subscribe to `time:changed` for cheap per-change updates.
- Put everything in one `THREE.Group` named after your module; remove it in `dispose()`.
- Headless Chrome runs on the real GPU (RTX 4070 Ti). `fps` in the JSON is vsync-pinned at ~144 and meaningless; use `gpuMs` (GPU time per frame, median) — the full-city budget is ≤ 20 ms total, so keep your module's share small. Vite HMR full-reloads when any agent saves a file; if a batch dies with "Execution context was destroyed", just rerun it.
