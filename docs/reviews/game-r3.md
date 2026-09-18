# Whole-game review — round 3

**Score: 4.5 / 10 — FAIL** (fails on look AND on perf budget)

Pass bar is score ≥ 8.5 AND `errors: []` AND perf within budget (fps≥50, gpuMs≤20, drawCalls≤1500). Errors and
determinism are clean again. The score fails for two independent reasons: (1) the round-1 critical bug —
`overview`/`aerial` rendering the whole city as illegible pale "toothpicks" — is **still not closed**. This round's
fix (environment's persistent PMREM render target) genuinely and verifiably closes the *camera/time-of-day-history*
trigger that rounds 1-2 focused on, but a second, independent trigger — **weather (rain/fog) at `overview`/`aerial`
steep pitch** — reproduces the *identical* failure signature on a completely fresh page load with zero prior camera
history, exactly as round 2 already reported, and this round's fix does not touch it. (2) A new perf regression:
`street`/`closeup` at dawn/night now drop to ~41-50 fps, below the 50fps floor, reproduced independently three times.

## How this was tested (independent of the fix builder's own verification)

- Read the fix: `src/environment/index.js`'s `regenEnv()`/`pmremFromSceneInto()` (lines ~150-220) and confirmed the
  round-2 `kickEffectsRenderTargets()` workaround and its `effects`-poking call site are **fully removed** (grepped
  for both symbols — zero hits). The new mechanism reuses one `WebGLRenderTarget` (`S.envRT`) across every PMREM
  regeneration instead of letting `PMREMGenerator.fromScene()` allocate a fresh one each time, and pins
  `ctx.scene.environment` to that one texture object forever. This is a real architectural fix, not a workaround —
  it doesn't depend on `effects` at all, unlike round 2's mitigation.
- **My own independent heavy-churn repro** (a fresh script built on `tools/shot.mjs`'s `openApp`/`stage`/`capture`,
  not the builder's own churn test), deliberately exceeding round 2's churn:
  - Phase 1: 45 rapid, deliberately unordered preset/tod/weather bounces (all 5 presets, 10 different tods spanning
    the full day/night cycle, 7 weather states including `rain:0.85`/`fog:0.7`/`cloudy:1.0`), 2 settle-frames each.
  - Phase 2: 4 legs of **continuous forward time** via `setTimeScale(800..2000)` + `frames(180)` each (not just
    instant `setTime` jumps) — the sun actually sweeps through multiple full day/night cycles per leg while the
    camera and weather are also changed at the start of each leg. ~2400 total frames advanced, city grew
    autonomously from Day 1 to Day 29 / pop 8,704 → 25,330 over the course of the test (unpaused simulation running
    the whole time).
  - Phase 3: 15 more rapid bounces (weather forced through `overcast:0.8` periodically), then forced back to clear.
  - **Recheck** (`shots/game/r3c-diag/recheck-{overview,aerial}-{6h5,12,18,21h5}.png`, weather forced clear): all 8
    shots are clean, solid, correctly lit, zero errors. This is real, independently-verified progress — under churn
    heavier than any previous round's test, the camera/tod-history trigger genuinely does not reproduce.
  - **Recheck under weather immediately after the same churn session**
    (`recheck-weather-{overview,aerial}-{rain,fog}.png`): **all 4 reproduce the exact round-1/round-2 toothpick
    failure** — terrain, water and buildings washed to near-uniform flat pale grey, buildings reduced to thin
    vertical slivers.
- **Isolated, single-page-load confirmation (not confounded by my churn session):**
  `node tools/shot.mjs --preset overview --tod 15 --weather clear:0 ...` (control, `control-overview-clear-tod15.png`)
  is clean and solid. The *only* thing changed, `node tools/shot.mjs --preset overview --tod 15 --weather rain:0.7 ...`
  (`fresh-overview-rain-tod15.png`), taken as the very first and only camera/weather command on a brand-new page
  load (`Day 1`, `$96,739`, zero session history of any kind), reproduces the identical washout. This rules out any
  residual churn/session-state explanation — it is purely `overview` (steep pitch) + rain weather.
- **Isolated near/far and pitch A/B, replicating round 2's exact method:**
  - `fresh-street-rain-tod15.png`: street-level under the identical `rain:0.7` at the identical tod is crisp,
    correct — glossy buildings, visible diagonal rain-streak particles, dark wet-looking road, believable overcast
    sky. Confirms the fog math itself is not the problem at short range.
  - `fresh-skyline-rain-tod15.png`: **decisive isolation.** `skyline` is a similarly long-range preset (comparable
    distance to `overview`) but with a much shallower, near-horizontal pitch. Under the *identical* `rain:0.7`
    weather and tod, it renders a completely legible, well-atmosphere'd skyline silhouette — correct haze fade,
    rain streaks, wet-looking foreground terrain, no washout at all. This isolates the trigger as **steep pitch +
    weather**, not distance or fog density alone — exactly reproducing round 1's and round 2's own isolation of the
    same variable. A physically-reasonable `FogExp2` blend at the computed density (~14% visibility retained at
    `overview`'s ~1246 m under `rain:0.7`) would fade a building's colour toward fog colour while keeping its full
    silhouette recognisable — not erase most of its surface down to a thin vertical sliver, which is what's
    observed. This is the same rendering defect category as before, not merely aggressive atmosphere tuning.
  - Conclusion: this is a **third distinct trigger path** for the same visual bug family, orthogonal to both fixes
    applied so far (round 2's `effects` `sceneRT` write-once/read-only restructuring, and round 3's `environment`
    persistent-PMREM fix). Neither touches weather-dependent state at `overview`/`aerial` pitch. The bug the whole
    saga was chasing is **not actually closed**.
- **Round 2's minor regression re-check (does the fix still cause a post-teleport flash?):** No — and this is
  genuinely resolved. A `street`→`overview` teleport (the same cascade-shape-changing jump round 2 flagged) checked
  at frames 1/3/8/20/45 (`shots/game/r3c-diag/flash-frame*.png`) is clean at every single frame, including the frame
  where draw calls spike (880 vs steady ~705, at frame~20 this round vs frame~8 in round 2 — the exact frame moved,
  consistent with a different underlying mechanism, but no visual corruption occurs at it). This makes sense:
  removing `kickEffectsRenderTargets()` means `environment` no longer forces `effects`' composer to reallocate its
  render targets on every teleport at all, so the transient mid-reallocation flash round 2 found has no trigger
  left to fire from.
- **New finding: perf budget regression.** Official batch `node tools/critic.mjs --game --round 3c --dir
  shots/game/r3c` → `minFps=43.2` (`street-6h5.png`), **below the ≥50 fps budget** (`shots/game/r3c/summary.json`,
  `budget.fpsOk: false`). `closeup-21h5.png` also under budget at 49.6 fps. Reproduced independently twice more with
  longer settle/sample (`settle=60, sampleMs=2000`): `street` @ tod 6.5 comes back at 40.9 fps and 41.4 fps across
  two separate fresh runs — consistently well under budget, not a one-off sampling fluke. `gpuMs` (11.07-14.3 ms)
  and `drawCalls` (677-793) both stay comfortably within their own budgets at the same shots, so this is a CPU-side
  cost regression, not a GPU/render-target problem — plausibly connected to `effects`' render-pipeline restructuring
  or `environment`'s per-frame PMREM/cascade bookkeeping, though root-causing it is outside this review's remit.
  This alone fails the round's pass bar regardless of the visual score. Round 1 was 59.3 fps min, round 2 was
  51.1 fps min — this is a new low.
- **Full official batch:** `node tools/critic.mjs --game --round 3c --dir shots/game/r3c` → 20 shots, zero errors,
  `minFps=43.2`, `maxGpuMs=18.81`, `maxDrawCalls=774`. Plus weather variants (`rain`, `fog`, `overcast`) and a
  traffic-focused street shot, matching prior rounds' coverage.
- **Determinism:** the fresh isolated control/repro shots this round reported identical `$96,739 / 8,704 / 5,034 /
  73%` treasury/population/jobs/happiness to rounds 1 and 2's baseline — still byte-consistent across sessions.
- `grep -rn "Math.random" src/` — same 3 comment-only hits as rounds 1-2 (`core/rng.js`, `effects/index.js`,
  `demo/citygen.js`), no real call sites. Clean.

## Ranked issues

### 1. [CRITICAL, cross-module seam, STILL UNRESOLVED after 3 rounds] `overview`/`aerial` + rain/fog weather still renders the whole city as illegible pale toothpicks
**Where:** `shots/game/r3c-diag/fresh-overview-rain-tod15.png` (fresh page load, zero history), `recheck-weather-
overview-rain.png`, `recheck-weather-overview-fog.png`, `recheck-weather-aerial-rain.png`, `recheck-weather-aerial-
fog.png` (after heavy independent churn), also in the official batch's `weather-rain-overview.png`/`weather-fog-
overview.png` equivalents. Contrast with `fresh-skyline-rain-tod15.png` (same weather/tod/rough distance, shallower
pitch — completely clean) and `fresh-street-rain-tod15.png` (same weather, close range — completely clean).
**What it looks like:** identical to round 1's original finding — terrain, water and buildings all washed to a
near-uniform flat pale grey; buildings reduced to thin vertical slivers with wide faces/roofs missing.
**Why it's still damaging:** this is the third round in a row this exact failure has been found, and it is trivially
reachable — a player toggling rain on and looking at their city from the default zoomed-out camera angle sees a
broken city, on a brand-new save, with zero prior interaction needed. Two real architectural fixes have now landed
(round 2's `effects` `sceneRT` write-once/read-only restructuring for the camera-history trigger, round 3's
`environment` persistent-PMREM fix for the sun-elevation-history trigger) and neither touches this pathway, because
neither depends on weather state. `environment.md`'s round-3 writeup calls its fix "the TRUE root cause" of the
whole-game bug and documents verification only via camera/tod churn (`120 rapid preset/tod bounces`) with no
weather variation — that verification gap is exactly why this trigger was missed.
**Fix suggestion:** whoever owns this next needs to specifically instrument the `overview`/`aerial`-pitch +
`rain`/`fog`-weather combination the same rigorous way round 3's fix instrumented the PMREM-identity path (dump
`effects`' `sceneRT`/`pingRT`/GTAO/Bloom's internal state, or `environment`'s fog uniforms, across the exact isolated
repro in this review) rather than assuming the PMREM fix closed the whole bug family. Given round 1's original
finding that bypassing the composer entirely was always clean regardless of weather, this may live in the same
composer/render-target territory as the original bug, just gated on a variable (fog density/weather-linked exposure)
neither prior fix's repro sequence varied.

### 2. [NEW, perf budget FAIL] `street`/`closeup` presets drop below the 50 fps floor at dawn/night
**Where:** `shots/game/r3c/summary.json` (`minFps: 43.2`, `budget.fpsOk: false`), reproduced independently twice
more at `street`/tod 6.5 (`40.9 fps`, `41.4 fps` with `settle=60, sampleMs=2000`); `closeup-21h5.png` also under
budget at `49.6 fps`.
**Why it's damaging:** this is a new, reproducible perf regression — round 1 was 59.3 fps minimum, round 2 was
51.1 fps minimum, this round drops to 41-43 fps at the worst cases. `gpuMs` (11-14 ms) and `drawCalls` (~700-800)
both stay comfortably inside their own budgets at the exact same shots, so the GPU/render-target side is fine — this
is a CPU-side cost increase. Combined with issue #1, this independently fails the round's pass bar.
**Fix suggestion:** profile `street`/`closeup` at dawn (tod 6.5) and night (tod 21.5) specifically — these are the
two tods with the most active CSM cascade/shadow-radius interpolation and (at night) the most emissive/point-light
bookkeeping, so start there and in `effects`' per-frame pass-driving code (`render()` in `src/effects/index.js`)
before assuming it's `environment`'s PMREM regen cadence, since PMREM regen is throttled to once/250ms and shouldn't
by itself explain a sustained CPU cost at a steady camera pose.

### 3. [minor, unchanged from rounds 1-2] Traffic still reads sparse from wide/elevated framing
**Where:** `shots/game/r3c/traffic-avenue-street.png` — one visible vehicle in frame at this angle; `closeup-12.png`
shows a healthier cluster of 3-4 vehicles at an intersection. Consistent with prior rounds: close/intersection
framing reads fine, wide avenue framing reads sparse. Still undercuts REFERENCE.md's "traffic flows" bar from
anything but close range. Low priority, unchanged in severity from round 2.

### 4. [nit, re-checked] Demand bars (bottom-left R/C/I)
**Where:** this round's fresh-load shots (e.g. `control-overview-clear-tod15.png`) show the `R` bar lit green with
`C`/`I` mostly empty — consistent with rounds 1-2's baseline, deterministic Day-1 city state, not a bug. No change.

## What already works well

- **The camera/time-of-day-history trigger for the critical bug is genuinely, architecturally fixed.** Independently
  verified under churn substantially heavier than any previous round (45 unordered preset/tod/weather bounces + 4
  legs of continuous multi-day time-forward simulation via `setTimeScale` + 15 more bounces, ~2400 frames total,
  city autonomously growing from Day 1 to Day 29 throughout) — `overview`/`aerial` at all 4 standard tods recheck
  clean afterward. This is real, verifiable progress, not a claim taken on faith, and the underlying mechanism
  (persistent PMREM render target reuse) is a correct fix, not a workaround.
- **Round 2's minor post-teleport flash regression is also resolved**, confirmed via a frame-by-frame check spanning
  the exact drawCalls-spike frame — a genuine side benefit of no longer needing to force `effects`' composer to
  reallocate on every camera cut.
- **Close/street-level rendering remains genuinely AAA-with-nits.** `shots/game/r3c/street-18.png`,
  `closeup-21h5.png`, and the churn-session's grown-city shots show correct Lego stud/bevel styling, glossy
  clearcoat, believable window emissive lighting through dusk→night, a lovely dusk sky gradient, and — critically —
  `fresh-skyline-rain-tod15.png` and `fresh-street-rain-tod15.png` show that weather rendering (rain streaks, fog
  haze, wet-looking road) is actually well-executed *everywhere except* the specific broken combination in issue #1.
- **Zero console errors, clean determinism.** Across 150+ shots and ~2400 simulated frames this session (heaviest
  churn test in the review's history), zero console errors; fresh loads at seed 1 continue to report byte-identical
  `$96,739 / 8,704 / 5,034 / 73%` treasury/population/jobs/happiness.
