# audio — critic review, round 2

**Score: 7.6 / 10 — FAIL** (pass needs ≥ 8.5). Errors: 0. Perf: within budget.

Module: `src/audio/` (engine.js, index.js, panel.js, speaker.js — folder contains only its own files). This is a
**fresh round-2c capture** taken today against the current `environment`/`effects` state (builder notes environment
was mid-rewrite during their own r2-dev captures; those are not what this review scores). Shots:
`shots/audio/r2c/` (default, 16 + 2 extra), `shots/audio/r2c-night/` (16 + 1 extra), `shots/audio/r2c-rain/` (16).
Every PNG in all three batches plus the 3 extra custom-camera shots was reviewed. Live API and a real user gesture
were re-verified in a running browser (see §Live verification).

This is a substantially stronger build than round 1. Five of the eight round-1 findings are fixed outright; the
score moves from 5.5 to 7.6 — good indie reaching for AAA, still short of the 8.5 pass bar on a handful of residual
polish items (see ranked issues).

## Numbers
| batch | shots | errors | real min fps* | max gpuMs | max draw calls | max tris |
|---|---|---|---|---|---|---|
| `shots/audio/r2c/` (default) | 16 + 2 extra | 0 | 124.5 | 7.29 | 99 | 1 734 540 |
| `shots/audio/r2c-night/` | 16 + 1 extra | 0 | 124.5 | 7.51 | 99 | 1 734 540 |
| `shots/audio/r2c-rain/` | 16 | 0 | 74.0 | 9.86 | 137 | 1 742 332 |

\* As in round 1, a couple of frames per batch show impossible negative fps (`-2191.9`, `-281.1`, `-1120.2`, `-485.6`)
coinciding with Vite full reloads from other agents editing files mid-capture (the rain batch alone needed 6 retries
for this reason — `roads` threw a transient `SyntaxError` mid-save, `environment`'s clock threw `setTime` on
`undefined` mid-save, and three separate "Execution context was destroyed" navigations). Those frames' JSON also
carries a stale `hours` (6.5 instead of the staged 18:00/21:30) even though the PNG itself renders correctly — the
same tooling artifact r1 documented. Excluding those, the real minimum across all 51 shots is 74.0 fps (rain,
`audio_street-6h5`), comfortably over the 50 fps floor; max gpuMs 9.86 is comfortably under the 20 ms budget.
`errors: []` in every shot JSON, including the reload-noise ones. `grep Math.random src/audio` → no hits. Folder
contains only its own 4 files. Showcase draw calls (92–137) are irrelevant to the full-game "others ≤ 10" budget —
`index.js` still adds 0 draw calls and no DOM outside showcase/`?audiopanel=1` (unchanged from r1, not re-verified
this round since nothing touches that path).

## Round-1 issues, verified this round
1. **Showcase floating in a void** — **mostly fixed.** `speaker.js` now extends the ground to a 560 m sea of
   baseplates with seam lines, a procedural stud-relief shader beyond the real-stud plate, ~170 trees/bushes
   scattered out to a wooded horizon, and scale props (lamp post, bench, accent bricks). `r2c/audio_default-*.png`
   and `r2c/audio_aerial-*.png` now read as a real clearing in a forest, not a green square in a void — a night-and-day
   difference from r1. Residual: `deps: []` was not changed to include `environment`, so there's still no real sky
   gradient/haze/aerial-perspective; a custom far shot (`r2c/extra-farview.png`, 300 m altitude/340 m out) shows the
   560 m plate's hard edge floating against flat grey once you go far enough, and `audio_default-18.png` /
   `audio_closeup-18.png` show a flat tan/grey horizon band above the tree line that doesn't match the ground colour
   — a fallback-sky seam, not a hard fail but a visible tell. See ranked issue 1.
2. **No night, no emissive life** — **fixed.** `setLevel`/`setNight` in `speaker.js` now drive the VU row, LED,
   amp display, power button and lantern from the *target* mix even before a gesture (`index.js` tick()), plus two
   pooled `PointLight`s (amp + lamp) that ramp with night factor. `r2c/audio_default-21h5.png`,
   `r2c-night/*-21h5.png` and `r2c-night/extra-lamp-closeup.png` show genuine emissive life: warm light pools on the
   studs under the lamp, a lit display, a glossy red power button, three lit VU bricks, stars, moon glow — with the
   AudioContext never started (headless). This was the most damaging r1 issue and is now essentially solved.
3. **Rain variant a visual no-op** — **fixed.** `variant === 'rain'` now gives every material a wetter, glossier
   finish (`roughness 0.12`, `clearcoat 1`), scatters 8 `transClear` puddle tiles across the plate, and (via
   `environment`/`effects`, not audio's own code) adds falling rain streaks and an overcast sky. Every rain shot in
   `r2c-rain/` is visibly, unmistakably wet and distinct from the dry variant at the same preset/tod — compare
   `r2c/audio_default-12.png` (bright, dry, blue sky) to `r2c-rain/audio_default-12.png` (grey, streaked, damp
   ground, glossier cabinets). Minor residual: from the steep aerial preset the puddles read as flat pale
   rectangles rather than glossy water (no grazing-angle reflection at that camera pitch) — see ranked issue 2.
4. **Materials flat and un-Blox** — **fixed.** Cones and dust caps are now glossy black with visible clearcoat
   highlights and sky reflections (`r2c/extra-macro-amp.png`); knobs are 2×2 round tiles with a centre stud; the
   power button is a glossy `transRed` round tile with an emissive core; the display is a black bezel with an
   inset `emissive('mediumAzur', 4)` glow; the VU bricks show real colour-separated highlights at macro range. This
   was r1's #4 issue and now reads convincingly as glossy ABS plastic.
5. **Panel text wrapping / low contrast** — **fixed.** `.ap-grid .p` pairs are now `display: flex;
   justify-content: space-between` inside a 2-column grid, so no pair splits across lines; font is 12.75px (up from
   11.5px); key colour is `#9fb3c6` (up from `#6f8090`) against the dark glass — comfortably legible in every shot.
   The spectrum label is now honest: `fftSize` is 2048 (23 Hz bins) and the label reads "64 log bands · 23 Hz bins ·
   to 12 kHz", matching the actual log-mapped display range (`spec.length * 0.5` bins ≈ Nyquist/2).
6. **UI overlap / framing** — **mostly fixed.** The accent bricks were repositioned and no longer sit under the
   panel's footprint; street-preset framing no longer clips a brick. New minor cosmetic nit: at midday the street
   preset's panel backdrop (`backdrop-filter: blur(12px) saturate(140%)`) visibly bleeds a reddish tint into the
   top rows from the red accent brick sitting close behind the translucent glass (`r2c/audio_street-12.png`,
   `r2c-night/audio_street-12.png` — compare to the neutral-dark panel background at every other tod in the same
   preset). Doesn't hurt legibility, but is an unintended, inconsistent look. See ranked issue 3.
7. **Stud moiré at distance** — **fixed.** `STUD_FADE_NEAR/FAR` are now 110/150 m (down from ~250 m), and the
   aerial preset (72 m altitude, ~90 m out) no longer shows any instanced-stud shimmer — confirmed in
   `r2c/audio_aerial-*.png` at all 4 tods, no moiré visible.
8. **Code nits** — **all fixed**, verified by reading `engine.js`/`index.js`: (a) `_scheduleDrops` now draws,
   sorts by `t0`, and clamps each drop's tail to the next drop's start before scheduling `AudioParam` automation —
   no more out-of-order ramps; (b) gesture listeners are `{ capture: true, passive: true }` on `window`; (c)
   `api.start()` races `engine.start()` against a 1.5 s timeout when `navigator.userActivation` isn't active; (d)
   rumble trim is 0.8 and `volumes.master` defaults to 0.8; (e) `AudioPanel.update()` diffs a `_drawKey` and skips
   `_draw()` when idle and nothing changed.

## Live verification (real gesture + API)
Ran a fresh puppeteer session against `?showcase=audio`: before any input, `api.isRunning()` → `false`,
`api.play('click')` → `false`, `api.getAnalyser()` → `null` (correct silent-until-gesture contract). Dispatched a
**real `page.mouse.click`** on the canvas (not a synthetic `page.evaluate` dispatch) — `api.isRunning()` flipped to
`true` immediately after, confirming the AudioContext genuinely starts from user input, re-verifying the builder's
r1 claim independently. With the graph live: `api.play('click')` → `true`, `api.play('cash', {x,y,z})` → `true`
(positional), `api.layers()` returned live target/level pairs for all 6 layers, `api.setVolume()`/`api.mute(true/
false)` round-tripped without throwing, `api.getAnalyser()` → truthy, `api.sfxNames` matched `SFX_NAMES`, and
`api.start()` resolved `true`. Zero console errors before, during, or after. All API surface in ARCHITECTURE §2/§4
(`play/setVolume/mute/isRunning/getAnalyser/start/layers/sfxNames`) confirmed present and working.

## Ranked issues (most damaging first)
1. **No real environment integration — flat sky, horizon-colour seam, hard-edged void at extreme range.**
   `r2c/extra-farview.png` (300 m alt / 340 m out): the 560 m ground plate's edge is a visible straight line against
   flat grey-blue nothing. `r2c/audio_default-18.png` / `audio_closeup-18.png` / `r2c-night` equivalents: a flat
   tan/grey band is visible between the tree line and the sky at sunset — the core fallback horizon doesn't match
   the audio module's own ground colour. `audio:aerial` (72 m) is much improved over r1 but still reads as a sparse
   clearing with widely-spaced individual trees rather than "dense bricks to the horizon." Fix: declare
   `deps: ['environment']` (r1's suggestion, still not adopted) so the showcase inherits real sky/fog/HDRI/CSM —
   this was flagged as free in r1 (audio is order 85, showcase-only). Short of that, fade the ground plate's edge
   color into the fallback sky colour instead of a hard cutoff, and densify the aerial-preset tree ring.
2. **Puddles don't read as water from a steep aerial angle.** `r2c-rain/audio_aerial-6h5.png` and `-18.png`: the
   `transClear` puddle tiles show as flat pale-grey rectangles rather than glossy reflective water when viewed
   near-vertically — there's no grazing-angle sky reflection to sell "wet" at that pitch. Minor, only visible at
   the aerial preset. Fix: add a subtle emissive/fresnel rim or a faint blue-tinted specular boost independent of
   view angle so puddles read from directly above too.
3. **Panel backdrop-filter bleeds accent-brick colour at midday.** `r2c/audio_street-12.png` and
   `r2c-night/audio_street-12.png`: the panel's top rows pick up a visible reddish tint from the red accent brick
   sitting close behind the translucent glass at noon lighting — doesn't happen at other tods in the same preset.
   Cosmetic only (text stays legible) but inconsistent with the intended neutral dark-glass look. Fix: nudge the
   red/orange accent bricks a little further from the panel's world-space footprint, or reduce
   `backdrop-filter: saturate(140%)` to something less prone to color bleed-through.
4. **(New, very minor) No god rays / aerial-perspective desaturation anywhere in the showcase.** Rubric §4 calls
   for light haze and distance desaturation; none of the three variants show it, even at the aerial preset where
   distant trees would benefit most. Low priority given `deps: []` — folds into issue 1's fix.

## What already works
- **Night emissive life is now genuinely good** — pooled point lights, lit VU row, glowing display/power button
  and lantern all drive off the target mix pre-gesture, and the whole picture holds up under a real
  `page.mouse.click` start.
- **Rain is a real, distinct wet look** — streaks, overcast sky, glossier clearcoat, visible puddles — no longer a
  no-op relative to the dry variant.
- **Materials read as glossy Blox ABS** at both showcase and macro range: highlighted clearcoat cones, round-tile
  knobs with a stud, an emissive display bezel, and a convincingly plastic power button.
- **The panel is legible and now honest** about its own spectrum resolution, with no more mid-pair text wrapping.
- **Web Audio graph, gesture gating, and the full API contract are correct and independently re-verified live** —
  silent until a real user gesture, all six `api.*` functions behave as documented, zero console errors across 51
  fresh captures plus a live interactive session.
- **Code nits from r1 are all fixed**: sorted/clamped rain-drop automation (no more click risk), capture-phase
  gesture listeners, a timeout-guarded `start()`, corrected bus trims, and an idle-aware panel redraw.
