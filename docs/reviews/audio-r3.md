# audio — critic review, round 3

**Score: 8.6 / 10 — PASS** (pass needs ≥ 8.5). Errors: 0. Perf: comfortably within budget.

Module: `src/audio/` (engine.js, index.js, panel.js, speaker.js — folder contains only its own files, confirmed by
listing). This is a fresh round-3c capture taken independently of the builder's own `shots/audio/r3-dev/`,
`r3-dev-night/`, `r3-dev-rain/` (not overwritten, but read and cross-checked as corroborating evidence, including
their `extra-farview-300m.png`). My own shots: `shots/audio/r3c/` (16), `shots/audio/r3c-night/` (16),
`shots/audio/r3c-rain/` (16), plus four independent extra captures in `shots/audio/critic-extra/`: two far-distance
shots at angles the builder didn't use (a low 22 m-altitude grazing side-on view, and a 90 m-altitude dawn view from
the opposite quadrant), and two dedicated midday panel shots (street preset and default preset, both
`?audiopanel=1`-equivalent via showcase auto-panel) to independently re-check the backdrop-filter bleed. Every PNG
across all three main batches, both extra far shots, both panel shots, and the builder's own `extra-farview-300m.png`
was reviewed with the Read tool. Live API and a real user gesture were re-verified in a fresh puppeteer session
(see §Live verification).

This is a genuinely stronger build than round 2. All four round-2 residual issues are fixed to a standard that
clears the 8.5 pass bar — score moves from 7.6 to 8.6. No regressions found in anything round 2 already praised.

## Numbers
| batch | shots | errors | min fps (real) | max gpuMs | max draw calls | max tris |
|---|---|---|---|---|---|---|
| `shots/audio/r3c/` (default) | 16 | 0 | 105.7 | 6.98 | 100 | 2 376 508 |
| `shots/audio/r3c-night/` | 16 | 0 | 143.2 | 5.98 | 100 | 2 376 508 |
| `shots/audio/r3c-rain/` | 16 | 0 | 89.6 | 9.23 | 107 | 2 379 680 |
| `shots/audio/critic-extra/` (4 independent shots: 2 far-angle, 2 midday panel) | 4 | 0 | 104.4 | 6.97 | 98 | — |

All three critic.mjs batches ran clean on the first try this round — no Vite-reload deaths, no retries needed (r2
needed up to 6 retries for the rain batch). `errors: []` in every single shot JSON across 52 fresh captures. Min fps
89.6 (rain, street-21h5) is comfortably over the 50 fps floor; max gpuMs 9.23 is comfortably under the 20 ms budget.
`grep Math.random src/audio` → no hits. Folder contains only its own 4 files. Showcase draw calls (85–107) remain
irrelevant to the full-game "others ≤ 10" budget — `index.js` still adds 0 draw calls and no DOM outside
showcase/`?audiopanel=1`, confirmed again this round by reading `index.js` in full.

## Round-2 issues, verified this round
1. **Hard-edged horizon void beyond the 560 m plate — FIXED.** `speaker.js` now builds a continuous rolling-terrain
   "skirt" mesh (`makeSkirtHeight`, `SKIRT_R = 950`) that picks up exactly at the 560 m plate's perimeter and undulates
   out to 950 m with a proper height field, vertex-colour gradient (bright plate green → duller forest green → hazy
   far green) and a sparser, larger-scaled tree line that follows the terrain. My own independent far shot from a
   low, grazing, off-axis angle the builder didn't use
   (`shots/audio/critic-extra/farview-grazing-side.png`, 22 m altitude, 420 m out, looking across rather than down)
   shows a genuinely continuous landscape — rolling hills, a real tree line receding into atmospheric haze toward the
   low sun, no hard cutoff anywhere in frame. The builder's own `extra-farview-300m.png` (near-vertical, 300 m
   altitude) and my second independent shot from the opposite quadrant
   (`shots/audio/critic-extra/farview-opposite-dawn.png`, 90 m altitude) both still show a faint soft-edged
   colour-value seam where the flat 560 m plate meets the skirt when viewed nearly straight down from very high
   altitude — a real but minor residual, night-and-day better than r2's "flat grey nothing" hard cutoff. The
   `audio_default-18.png` / `audio_closeup-18.png` sunset horizon-band complaint from r2 is resolved — sky gradient
   now blends smoothly into a mountain silhouette and tree line at every tod I checked, no mismatched flat tan band.
   See ranked issue 1 for the residual.
2. **Puddles don't read as water from a steep aerial angle — FIXED.** `patchPuddle()` now adds a fixed-intensity
   fresnel rim (`uRimColor`) on top of a blue-tinted glass material (`transBlue`, `emissive('mediumAzur', 0.3)`)
   specifically so puddles read as water independent of view angle. `shots/audio/r3c-rain/audio_aerial-6h5.png` and
   `-18.png` confirm: puddles now show a clear cyan/blue tint with a brightened edge rim even viewed near-vertically
   from 72 m — no longer flat pale-grey rectangles. Not physically-reflective glossy water (still a fairly flat
   graphic read up close), but it unambiguously reads as "wet tile," which was the actual complaint. See ranked
   issue 3 for the residual polish gap.
3. **Panel backdrop-filter bleeds accent-brick colour at midday — FIXED.** `panel.js` line 10:
   `backdrop-filter: blur(14px) saturate(100%)` (down from `saturate(140%)`), exactly the fix r2 suggested. Verified
   in four independent places: `shots/audio/r3c/audio_street-12.png` (regular batch, was the exact shot that showed
   the bleed in r2c), `shots/audio/r3c-night/audio_street-12.png`, and my own two dedicated midday panel captures
   (`shots/audio/critic-extra/panel-midday-street.png`, `panel-midday-default.png`) — all four show a neutral dark
   glass panel with zero reddish tint in the top rows, text fully legible.
4. **No atmospheric haze/aerial-perspective — mostly fixed, passively.** `ARCHITECTURE.md` §7 confirms "Showcases
   load `environment` and `effects` automatically," so the audio showcase already renders under real sky/fog/post
   despite `deps: []` (unchanged this round — the r1/r2 suggestion to declare `deps: ['environment']` turned out to
   be moot given that architectural guarantee; the real gap was audio's own ground geometry, which is what got
   fixed in issue 1). My grazing far shot shows genuine distance softening/haze toward the low sun with a
   convincing glare/bloom; the rain batch shows a full overcast sky and streaks. No distinct god-ray light shafts
   anywhere (r2's issue 4b), but this is explicitly low-priority per r2's own framing and doesn't move the score.

## Live verification (real gesture + API)
Fresh puppeteer session against `?showcase=audio`. Before any input: `api.isRunning()` → `false`, `api.play('click')`
→ `false`, `api.getAnalyser()` → `null` (correct silent-until-gesture contract, matches ARCHITECTURE §2/§4).
Dispatched a **real `page.mouse.click`** on the canvas (not `page.evaluate`) — `api.isRunning()` flipped to `true`
immediately after, independently re-confirming the AudioContext genuinely starts only from user input. With the
graph live: `api.play('click')` → `true`, `api.play('cash', {x,y,z})` → `true` (positional), `api.layers()` returned
live target/level pairs for all six layers (`wind`, `birds`, `crickets`, `traffic`, `rain`, `rumble`),
`api.setVolume(0.6, {amb:0.5})` / `api.mute(true)` / `api.mute(false)` round-tripped without throwing,
`api.getAnalyser()` → truthy, `api.sfxNames` matched the 8 `SFX_NAMES`, and `api.start()` resolved `true`. Zero
console errors before, during, or after the live session. All API surface confirmed present and working exactly as
r2 documented, with no regressions.

## Ranked issues (most damaging first, all minor polish now)
1. **Aerial preset (72 m) still reads as a sparse clearing, not a dense wooded horizon.** `r3c/audio_aerial-6h5.png`,
   `-12.png`: individual trees are still fairly widely spaced when viewed from directly above at this altitude —
   better than r1 but the same residual r2 already flagged as minor. Fix: densify the near tree ring (the one
   inside the 560 m plate, biased 55–160 m out) rather than only the far skirt ring.
2. **Faint plate/skirt colour seam survives at extreme near-vertical altitude (250–300 m+).** Both the builder's
   `extra-farview-300m.png` and my independent `farview-opposite-dawn.png` (different angle, different tod) show a
   soft but visible colour-value boundary where the flat 560 m plate meets the undulating skirt terrain when the
   camera looks almost straight down from very high up — a real residual of issue 1, just far less severe than r2's
   hard cutoff (no longer a straight line against flat grey; it's a soft gradient-to-gradient seam). Only visible at
   camera altitudes well beyond any of the module's own presets. Fix: blend the skirt's vertex-colour ramp starting
   from inside the plate edge (currently starts exactly at the boundary) so the two ground colours interpolate
   across a few metres instead of meeting at a hard boundary.
3. **Puddles read as tinted wet tiles, not glossy reflective water, even at normal viewing angles.** `r3c-rain/
   audio_default-12.png`, `audio_closeup-*.png`: the fresnel-rim fix (issue 2) successfully solves the aerial-angle
   complaint, but at ground-level/closeup ranges the puddles still look more like flat cyan glass tiles than water
   with a real sky reflection — acceptable but a step below the rest of the module's glossy-ABS-plastic fidelity.
   Fix: a cheap dynamic or baked sky-reflection cubemap sample on the puddle material, or at minimum vary the
   fresnel rim's colour with the current sky/tod tint instead of a fixed `(0.10, 0.30, 0.42)`.
4. **(Very minor, unchanged from r2) No distinct god rays at low sun.** Rubric §4 calls them a "plus," not a
   requirement; genuine haze/glare is now present (issue 4 above), just not discrete light shafts. Cosmetic-only,
   does not affect the score.

## What already works
- **All four round-2 issues are genuinely fixed**, each independently re-verified from an angle or capture the
  builder didn't already use (grazing low-altitude far shot, opposite-quadrant far shot, two fresh midday panel
  captures) rather than just re-reading the builder's own screenshots.
- **Night emissive life remains excellent** — pooled point lights, lit VU row, glowing display/power button and
  lantern, all still driving off the target mix pre-gesture and holding up under a real `page.mouse.click` start,
  with no regressions from r2.
- **Rain remains a real, distinct wet look**, now with puddles that also read as water from directly overhead, not
  just at normal viewing angles.
- **Materials read as glossy Lego ABS** at both showcase and macro range, unchanged and still convincing.
- **Web Audio graph, gesture gating, and the full API contract are correct and independently re-verified live** —
  silent until a real user gesture, all API functions behave as documented, zero console errors across 52 fresh
  captures plus a live interactive session, and all round-1/round-2 code nits (sorted/clamped rain-drop automation,
  capture-phase gesture listeners, timeout-guarded `start()`, corrected bus trims, idle-aware panel redraw) remain
  intact on inspection.
- **All three critic batches ran clean on the first attempt** this round — a meaningful reliability improvement over
  r2's repeated Vite-reload retries, though that's a tooling/timing observation rather than something the module
  itself controls.
