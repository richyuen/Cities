# Whole-game review — round 2

**Score: 5.0 / 10 — FAIL** (fails on look; perf/errors/determinism all clean)

Pass bar is score ≥ 8.5 AND `errors: []` AND perf within budget (fps≥50, gpuMs≤20, drawCalls≤1500; triangle count
not budgeted per ARCHITECTURE.md §0). Errors and perf pass cleanly again this round. The score still fails because
the round-1 critical bug — `overview`/`aerial` rendering the whole city as illegible pale "toothpicks" — is only
**partially** fixed: the specific trigger diagnosed and patched (camera/time-of-day history) is genuinely gone, but
an equally damaging trigger the fix does not touch (rain or fog weather at `overview`/`aerial` distance/pitch,
reproducible on a completely fresh page load with zero camera history) still reproduces the identical failure. A new,
minor visual regression — a brief pale-toothpick flash for a handful of frames right after any camera teleport — was
also found, consistent with the kind of risk the fix's own code comments flag.

## How this was tested (independent of the fix builder's own verification)

- Read the fix itself: `src/environment/index.js` lines 187-234 (`updateCascades`/`kickEffectsRenderTargets`). The
  mitigation forces `effects`' `EffectComposer.setSize()` (even to the same size) whenever the CSM cascade-shape key
  changes, throttled to once per 250 ms, called every frame inside `update()`. This only fires on a real
  distance/pitch/cascade-shape step — it does not depend on weather state at all, which turned out to matter (see
  below). The code's own comments are candid that this is a workaround for a bug that lives in `src/effects/`, not a
  real fix.
- **Repro #1 (round-1's exact trigger, harder than the fix builder's own test).** A custom script built on
  `tools/shot.mjs`'s `openApp`/`stage`/`capture` replayed the full `critic.mjs --game` sequence (5 presets × 4 tods,
  20 captures) in one session, then added extra churn beyond that (weather toggles, rapid preset bouncing, more
  tod jumps) before re-checking `overview`/`aerial` at tod 12/18/21.5 fresh. First pass was accidentally confounded
  by leftover `rain` weather state from an earlier step in the same script (worth noting: this alone reproduced a
  toothpick look, which is what led to repro #2). Re-run with weather explicitly forced back to `clear:0` before the
  recheck: all 6 recheck shots (`clean-recheck-overview-12/18/21h5.png`, `clean-recheck-aerial-12/18/21h5.png` in
  `shots/game/r2c-diag/`) are clean, solid, correctly lit — **this specific bug trigger is fixed**, verified under
  churn heavier than the fix builder's own 20-shot batch.
- **Repro #2 (new finding: weather at distance still breaks it, independent of any camera history).** Isolated,
  single-page-load, single-`stage()`-call shots via `tools/shot.mjs` directly (no session reuse, no prior camera
  calls at all): `node tools/shot.mjs --preset overview --tod 15 --weather rain:0.7 ...` and
  `--preset aerial --tod 15 --weather rain:0.7 ...` and `--preset overview --tod 16 --weather fog:0.7 ...`. All three
  reproduce the exact round-1 toothpick signature (thin vertical slivers, missing wall/roof faces, terrain/water
  washed to flat pale grey) — see `shots/game/r2c-diag/isolated-rain-overview.png`,
  `isolated-rain-aerial.png`, `isolated-fog-overview.png`. Confirmed again inside the official round-2c weather batch
  (`shots/game/r2c/weather-rain-overview.png`, `weather-fog-overview.png`). This is **not** camera-history-dependent
  — it happens on the very first camera command of a brand-new page load — so the environment-module workaround
  (which only reacts to *cascade-shape* changes, not weather changes) never fires for it. `skyline` (also a
  long-range preset, but shallower pitch) stays legible under `overcast` weather
  (`shots/game/r2c/weather-overcast-skyline.png`), consistent with round 1's finding that steep pitch, not raw
  distance, is the differentiator.
- **Regression check (asked for explicitly): does forcing a composer resize on every teleport cause a visible
  flash/pop?** Yes, a minor one. A custom script staged `street`→`overview` (a distance/pitch jump big enough to
  change the cascade key) with weather forced `clear:0` throughout, then captured at settle=1/3/8/20/45 frames.
  Frames 1 and 3 are clean; **frame 8 shows the same pale-toothpick look transiently** before frame 20+ recovers to
  clean (`shots/game/r2c-diag/pop2-frame1.png` through `pop2-frame45.png`). Draw calls spike at the broken frame
  (880 vs. a steady 703-709 baseline before/after), consistent with the composer mid-reallocating its render
  targets. Reproduced identically on a second independent run. At 60 fps this is roughly a 100-250 ms flicker
  immediately after clicking a camera-preset button — self-healing, and short enough that it would never show up in
  `critic.mjs`'s standard 40-frame-settle screenshots (which is presumably why the fix builder's own batch reported
  clean), but a real player would see it as a startle-flash on every camera cut.
- **Full official batch:** `node tools/critic.mjs --game --round 2c --dir shots/game/r2c` → 20 shots, zero errors,
  `minFps=51.1`, `maxGpuMs=18.59`, `maxDrawCalls=774` — all within budget with margin. Plus weather variants
  (`rain`, `fog`, `overcast`) and traffic-focused shots (`traffic-avenue-street.png`, a custom low corridor angle,
  and a custom medium-elevation oblique angle) added per the brief.
- **Determinism:** two independent fresh loads at `overview`/tod 12/seed 1 produced byte-identical
  `drawCalls`/`triangles` (705 / 15,137,236 both times); treasury/population/jobs/happiness identical to round 1's
  values across every shot this session ($96,739 / 8,704 / 5,034 / 73%).
- `grep -rn "Math.random" src/` — same 3 comment-only hits as round 1 (`core/rng.js`, `effects/index.js`,
  `demo/citygen.js`), no real call sites. Clean.

## Ranked issues

### 1. [CRITICAL, cross-module seam, PARTIALLY FIXED] `overview`/`aerial` still render as illegible pale toothpicks — now triggered by weather instead of camera history
**Where:** `shots/game/r2c-diag/isolated-rain-overview.png`, `isolated-rain-aerial.png`, `isolated-fog-overview.png`;
also reproduced in the official batch at `shots/game/r2c/weather-rain-overview.png`, `weather-fog-overview.png`.
**What changed since round 1:** the specific trigger round 1 diagnosed (camera/tod change history within a session)
is genuinely fixed — confirmed independently, under churn heavier than the fix builder's own verification, at
tod 12/18/21.5 with weather forced clear. **What's still broken:** `overview`/`aerial` + `rain` or `fog` weather
reproduces the exact same failure signature (thin toothpick building slivers, terrain/water washed to flat pale
grey), and — critically — this happens on a **completely fresh page load with zero prior camera or time history**,
proving it's a different manifestation of the same underlying `effects`-owned render-target bug that the
environment-module workaround does not cover (the workaround only reacts to CSM cascade-shape changes, which don't
depend on weather state at all).
**Why it's still damaging:** weather is a first-class, player-facing feature (REFERENCE.md explicitly calls for
"weather (rain streaks, wet roads with reflections, fog) when enabled"), and `overview`/`aerial` are still, by
convention, the two shots a player uses to admire their city. Toggle rain on and look at your city from the default
zoomed-out angle — still broken. This is the same category of critical failure as round 1's #1, just narrowed to a
different (and still very reachable) precondition.
**Fix suggestion:** unchanged from round 1 — the actual bug lives in `src/effects/`'s render-target/composer
plumbing and needs a real fix there, not a same-size `composer.setSize()` kick triggered only by cascade-shape
changes. Whatever per-frame state depends on weather intensity/fog density at distance needs the same "always
recompute from current state, never from a value cached across a state change" treatment recommended in round 1.

### 2. [NEW, minor, regression from this round's fix] Brief pale-toothpick flash for a handful of frames immediately after any camera teleport
**Where:** `shots/game/r2c-diag/pop2-frame8.png` (broken) vs. `pop2-frame1.png`/`pop2-frame3.png`/`pop2-frame20.png`/
`pop2-frame45.png` (clean) — same camera pose (`street`→`overview` teleport), weather held `clear:0` throughout,
reproduced twice independently.
**What it looks like:** for roughly frames 5-15 after a preset switch that changes the shadow-cascade shape, the
city transiently shows the exact toothpick look before self-healing; draw calls spike (880 vs. a steady ~705) at the
broken frame, consistent with the composer being mid-reallocation of its render targets at that moment.
**Why it's damaging (but minor):** self-heals within roughly 100-250 ms at 60 fps and won't appear in
`critic.mjs`'s standard 40-frame-settle screenshots — which is why the fix builder's own batch reported clean — but
a real player clicking between camera presets will see a brief flash/pop on every cut. Far less severe than issue
#1, since it's transient rather than persistent, but it is a genuine new regression introduced by resizing the
composer on every cascade-shape-changing teleport.
**Fix suggestion:** if `effects` can expose a way to pre-warm/reallocate render targets without an intermediate
frame rendering into mismatched-size buffers (e.g., reallocate before the next render call rather than letting one
frame render through the old-sized targets), the flash would disappear. Alternatively this reinforces that the real
fix belongs in `effects`, where render targets can be resized atomically with the frame that needs them.

### 3. [environment, unchanged from round 1] Rain streak particles are now present at street level; wet-road specular still unclear; overview-scale rain is still far more broken than "lacks streaks"
**Where:** `shots/game/r2c/weather-rain-street.png` (streaks visible), `weather-rain-overview.png` (still the
toothpick failure from issue #1).
Round 1 reported rain has no streak particles at all, based on an `overview`-framed rain shot that was already
compromised by issue #1. This round's street-level rain shot clearly shows diagonal white rain-streak particles
crossing the frame — that part of round 1's issue #2 appears to already have been present but unobservable through
the wash-out, not actually missing. Wet-road specular/reflection is still hard to confirm from a static screenshot —
the road reads matte-to-slightly-glossy, not clearly puddled/reflective. Low priority relative to #1: the dominant
problem with rain remains that its highest-visibility use (`overview` + rain, i.e. "what does my city look like in
the rain") is still the toothpick failure, not the streak/specular styling.

### 4. [minor, unchanged from round 1] Traffic still reads sparse from wide/elevated framing
**Where:** `shots/game/r2c/traffic-avenue-street.png` (3 cars visible, reasonable), `traffic-custom-elevated.png`
(a handful of cars visible on the downtown grid, better than round 1's "1-2 cars" but still not a "flowing" density
at this distance).
Roughly consistent with round 1's finding, perhaps marginally better by chance of capture timing rather than a real
density change. Still undercuts REFERENCE.md's "traffic flows" bar when viewed from anything but street level. Not
re-tested exhaustively this round since it wasn't the focus of the fix; ranked lower than rounds 1-3 above since
it's cosmetic density, not a broken render.

### 5. [nit, unchanged from round 1] Demand bars (bottom-left R/C/I) read empty/near-empty in every screenshot
**Where:** every shot this session (consistent with round 1). Treasury/population/jobs/happiness are byte-identical
to round 1's values across ~30 fresh loads this session ($96,739 / 8,704 / 5,034 / 73%), confirming this is
deterministic, expected behavior for a balanced, unmodified day-1 city rather than a bug. Still worth a sanity check
since an empty demand HUD in every screenshot reads as "broken" at a glance, but not scored as a defect.

## What already works well

- **The round-1 trigger for the critical bug is genuinely fixed.** Independently verified under camera/tod churn
  heavier than the fix builder's own 20-shot test — `overview`/`aerial` at tod 12/18/21.5 after a long session of
  mixed preset/time changes (clear weather) are all clean, solid, and correctly lit
  (`shots/game/r2c-diag/clean-recheck-*.png`). This is real, verifiable progress, not a claim taken on faith.
- **Close/street-level rendering remains genuinely AAA-with-nits.** `shots/game/r2c/street-18.png`,
  `closeup-21h5.png` show correct Blox stud/bevel styling, glossy clearcoat, believable window emissive lighting
  through dusk→night, a lovely dusk sky gradient, and (new this round) visible rain-streak particles at street
  level during weather.
- **Perf, errors, and determinism are all clean with real margin.** Zero console errors across 100+ shots this
  session; worst case this round 51.1 fps / 18.59 ms GPU / 774 draw calls, all within the ≥50fps/≤20ms/≤1500-call
  budget; two independent fresh loads at the same seed/camera/time produced byte-identical triangle/draw-call
  counts and simulation values.
