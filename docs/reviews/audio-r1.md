# audio — critic review, round 1

**Score: 5.5 / 10 — FAIL** (pass needs ≥ 8.5). Errors: 0. Perf: within budget.

Module: `src/audio/` (engine.js, index.js, panel.js, speaker.js — folder contains only its own files). Variants reviewed:
default, night, rain. Presets: `audio:default`, `audio:closeup`, `audio:aerial`, `audio:street`. Extra shots: core `closeup`
(15:00), core `skyline` (rain, 20:00), full game `overview` (15:00).

The score is a Blox-rubric score of what the screenshots show. The code behind it is in much better shape than the
pictures (see "What already works"); the visual showcase is what drags the number down.

## Numbers
| batch | shots | errors | warnings | min fps* | max draw calls | max tris |
|---|---|---|---|---|---|---|
| `shots/audio/r1/` (default) | 16 + 2 extra | 0 | 0 | 142.9 | 31 | 813 436 |
| `shots/audio/r1-night/` | 16 | 0 | 0 | 142.9 | 31 | 813 436 |
| `shots/audio/r1-rain/` | 16 | 0 | 0 | 142.9 | 31 | 813 436 |
| `shots/audio/r1/fullgame.png` (full game, overview, 15:00) | 1 | 0 | 0 | 143.9 | 44 | 1 253 872 |

\* Three samples in the summaries are impossible negatives (-1.2, -703.1, -1147.3 fps). They coincide with Vite full
reloads triggered by other agents editing files during capture (puppeteer "execution context destroyed … navigation";
the rain batch had to be re-run twice for the same reason). Those three frames also show stale panel text and, in
`r1-rain/audio_closeup-12.png`, the wrong camera (default preset). Treat them as tooling noise, not module faults; the
real minimum is 142.9 fps. Draw-call budget for "others" is ≤ 10 in the full city; in the full game audio adds **0** draw
calls and **no DOM panel** (panel only appears in showcase or with `?audiopanel=1`), so the budget is met.

`errors: []` in every shot JSON. `grep Math.random src/audio` → no hits. `moduleErrors: {}`, `modules.audio: "ok"` everywhere.

## Ranked issues (most damaging first)

1. **The showcase is a green plate floating in a flat-colour void.** Every preset: `r1/audio_default-12.png` shows the
   plate edge as the horizon against a solid sky; `r1/audio_aerial-*.png` is a 400 px green square in an empty frame;
   `r1/extra-skyline-rain-20.png` is nothing but sky. No horizon, no fog gradient, no backdrop, no scale reference. Against
   the reference images (dense bricks to the horizon, aerial perspective) this reads as programmer art regardless of how
   nice the hi-fi is. Fix: extend the ground to a 500–600 m sea of 32×32 baseplates (instanced, stud LOD fading beyond
   ~250 m per §7) so the horizon is bricks, and put two or three cheap scale props from core materials around the hi-fi
   (a lamp post, a bench, a tree). Alternatively declare `deps: ['environment']` so the showcase gets the real sky, HDRI,
   fog and CSM — it costs nothing in the full game (audio is order 85 anyway). Reframe `audio:aerial` to ~90 m so the
   plate fills the frame.
2. **No night, no emissive life.** `r1/audio_*-21h5.png` and the whole `r1-night/` batch are lit like noon under a
   grey-blue sky: LED red, five VU bricks unlit, the "always lit" amp display a flat pale-cyan slab. Rubric: night with no
   emissive life −1.5. Root cause is split: core's `fallbackLights.js` keeps a static PMREM `scene.environment` that never
   dims and sets the sky colour in linear space, so single-module showcases never get dark (worth a line in
   `docs/core-requests/audio.md`: scale `scene.environmentIntensity` with sun elevation and set the background in sRGB).
   But the module's own night story is also empty: nothing glows because the AudioContext can never start headlessly.
   Fix: when `!engine.running`, drive `scene3d.setLevel()` from the *target* mix (e.g. `Σ layer.target / 3`) so the VU
   bricks and LED show a plausible live state in captures; push emissives to bloom range (`M.emissive(c, 4)` on the display,
   LED and lit VU bricks); add one pooled `PointLight` (≤ 48 allowed) at the amp so the studs in front of it catch a
   coloured pool at night. Drop the `ctx.clock.set(22)` in the night variant — the tool overrides tod anyway, and the
   variant currently differs from default only in two panel numbers.
3. **Rain variant is visually a no-op.** `r1-rain/*` is pixel-identical to `r1/*` except the panel text. Nothing gets
   wet, nothing darkens, no puddles. As a *visual* variant it does not earn its slot. Fix: for `variant === 'rain'` give
   the plate a wet look with a variant-keyed material (`M.plastic('brightGreen', { roughness: 0.12, clearcoat: 1 })`),
   scatter a few `transClear` 2×2 tile "puddles" on the stud grid, and tint the cabinets' clearcoat; or rely on
   `environment` (issue 1) so `setWeather('rain')` actually renders rain streaks and wet roads.
4. **Materials read flat and un-Blox.** `r1/audio_closeup-12.png`: no clearcoat highlights or sky reflection on the
   cabinets or plate; black cones render navy from hemisphere fill; the dust caps are `mediumStoneGrey` spheres that look
   like ping-pong balls; the amp face is a thin grey slab with two plain cylinders and a red disc; the display has no bezel
   and no glow. Fix: cones/caps as glossy black (`plastic('black', { roughness: 0.25, clearcoat: 1 })`), knobs as 2×2
   round tiles with a stud, power button as a `transRed` 1×1 round tile with emissive at night, display = black 1×4 tile
   bezel + `emissive('mediumAzur', 4)` inset. Keep everything on the 0.8 m stud grid so it still reads as a build.
5. **Panel text wraps mid-pair and is small.** In every shot the env/cam lines split key from value ("traffic" / "0.45
   pop 18k", "bursts" / "0.08") because `.ap-env, .ap-cam { white-space: normal }` lets the browser break anywhere; 11.5 px
   monospace with `#6f8090` keys on dark glass is ~3:1 contrast at 1080p. "spectrum · 20 Hz – 12 kHz" overstates the
   resolution (fftSize 512 @ 48 kHz = 94 Hz bins). Fix: wrap each pair in an `inline-block` span (or a 2-column grid) so
   pairs never split; 12.5–13 px; keys `#8fa3b5`; label the spectrum honestly or use `fftSize = 2048`.
6. **UI overlap / framing.** `r1/audio_street-*.png`: the panel covers the orange 2×4 brick; the street preset also
   clips the red brick at the left edge. Move the accent bricks or shift the preset target slightly right.
7. **Stud moiré at distance.** `r1/audio_aerial-*.png`: 14 400 studs at 230 m shimmer into a texture. §7 says studs fade
   beyond ~250 m; at 230 m they are still fully drawn. Start the fade around 150 m in the showcase or use a coarser stud
   LOD for the far ring.
8. **Code nits (none are failures).** (a) `engine._scheduleDrops` inserts automation events on one `AudioParam` out of
   time order (random `t0` per drop, unsorted); a later `setValueAtTime(0.0001)` landing inside an earlier drop's ramp
   creates step discontinuities — audible clicks in heavy rain. Sort by `t0` or fire each drop as a short `_burst`
   BufferSource instead of gain automation. (b) The gesture unlock uses bubbling `pointerdown`/`keydown` on `window`;
   any UI element calling `stopPropagation()` silently blocks it. Use `{ capture: true, passive: true }` and the caveat in
   `docs/core-requests/audio.md` disappears. (c) `api.start()` outside a gesture creates a suspended context whose
   `resume()` never resolves in Chrome — the returned promise hangs forever; guard with
   `navigator.userActivation?.hasBeenActive` or a timeout. (d) Rumble trim 1.2 on low-passed noise plus the sub can push
   the ambience bus over unity before the compressor; drop to ~0.8 and keep `master` 0.8. (e) The panel canvas redraws
   every other frame even when idle; skip `_draw` when `!running` and nothing changed (cost is trivial, but it is free).

## What already works
- **Web Audio graph and autoplay gating are correct.** No `AudioContext` exists until a real `pointerdown`/`keydown`;
  every engine method is a silent no-op before `start()`; the context is built once, resumed on later gestures, closed on
  dispose. Zero console errors or warnings across all 51 captures. Determinism: the 3 s noise buffer, bird bursts, rain
  drops and bulldoze debris all draw from `ctx.rng.fork('audio')`; no `Math.random`.
- **API and event contract match ARCHITECTURE §2/§4 and the builder's spec.** `api.play/setVolume/mute/isRunning/
  getAnalyser/start` exist and behave as documented, plus `layers()` and `sfxNames`. Bindings: `tool:selected → click`,
  `road:added → road` (positional at the edge midpoint via `roads.nodes`), `building:spawned → place`,
  `building:removed → bulldoze` (positional at the building centre via `cellToWorld` + `getHeight`), `zone:changed → zone`.
  Rate limiting per SFX name; `PannerNode` per positional call with sane rolloff; listener follows the camera at 10 Hz.
- **Per-frame cost is negligible and the full game is untouched.** `update()` does three adds and a 10 Hz `tick`
  (a couple of `noise2D` calls, one `getHeight`); the panel exists only in showcase. Full game: audio adds no draw calls,
  no DOM, no errors (`shots/audio/r1/fullgame.png`, 44 calls, 143.9 fps).
- **The panel is a genuinely useful instrument** (target ghost vs actual gain per layer, spectrum, output level, SFX log
  with positional markers, volumes) and the builder's `shots/audio/gesture-running.png` proves the live path: green LED,
  VU brick lit, spectrum moving, `place@ road@ bulldoze@ zone@ click×2 levelup×1 cash…` in the log.
- The hi-fi prop itself is a reasonable Blox idea: bevelled bricks on the stud grid, studs on every top face, shared
  materials, geometry merged per colour (31 draw calls total including 14 400 instanced studs).
