# Whole-game review — round 4

**Score: 8.8 / 10 — PASS**

Pass bar is score ≥ 8.5 AND `errors: []` AND perf within budget (fps≥50, gpuMs≤20, drawCalls≤1500). All three clear
with real margin. This round closes out a bug family that has taken 4 rounds and 3 genuinely distinct root causes
(round 2: `effects` render-target aliasing; round 3: `environment` PMREM texture-identity churn; round 3-4:
`environment` fog-density distance-saturation) — my own independent, deliberately adversarial testing this round
found **zero reproductions** of the `overview`/`aerial` "toothpick washout" failure across ~85 targeted shots. A
separate perf regression (buildings' auto-growth causing periodic 500-600ms stalls, root-caused in round 4's
`environment` core-request writeup) landed a fix from another agent **mid-review** — I caught it landing live, redid
every test against the settled code, and independently confirmed it via per-module live profiling: the regression is
also genuinely fixed.

## How this was tested (independent of both fix builders' own verification)

**Method note:** a second agent's buildings perf fix landed on disk (`src/buildings/index.js`,
`src/buildings/batching.js`, mtimes 11:28:53/57) while my first pass of testing was already running against the
pre-fix build. I detected this from a transient console error one of my scripts caught (`TypeError: Cannot read
properties of null (reading 'has')` in `enqueueLevelUps`) during the exact window the files changed. Root-caused it
before treating it as a finding: `src/` has zero `import.meta.hot.accept()` handlers anywhere (grepped), so any file
edit triggers Vite's default *full page reload* — the error is `S.levelUpQueued` being nulled by `dispose()` and read
by a still-in-flight `update()` from the pre-reload page instance, a pure HMR-teardown race. `disposeAll()` (the only
caller of module `dispose()`) is defined in `src/core/registry.js` but **never invoked anywhere in the app** (grepped)
— confirmed dead code outside HMR, so this path is unreachable in real play (no build ever ships with a live Vite HMR
socket). It fired once ("1/3" in the registry's own retry counter, which resets on the next successful call) and
never recurred in any of the ~85 shots taken before or after against the settled code. Not scored as a defect, but
disclosed in full per the brief's rigor requirement. Everything below was **re-run from scratch against the settled,
stable post-fix code** (confirmed stable: file mtimes unchanged for the remainder of the session).

- **Fresh-load test (this round's specific mandate).** 6 completely separate `openApp()` browser sessions (no shared
  session, no prior camera/weather history at all), each going straight to `overview`/`aerial` + `rain`/`fog` as the
  *first and only* command: tod 6.5/12/18/21.5 covered, intensities 0.7-0.9. All 6 clean — legible buildings (full
  walls/roofs, not slivers), correctly graded terrain/water, visible rain streaks / fog haze, zero errors, fps
  140.8-144.1 (`shots/game/r4c-fresh/fresh-*.png`, all opened and inspected).
- **Heavy churn test, exceeding round 3's methodology, with weather interleaved throughout (not just a final
  recheck).** One long-lived session: Phase 1 (25 rapid unordered preset/tod/weather bounces) → **checkpoint 1**
  (4 overview/aerial × rain/fog shots) → Phase 2 (450 frames of continuous forward time via `setTimeScale(1200)`,
  weather changed 3× mid-simulation, camera cycling) → **checkpoint 2** → Phase 3 (20 more bounces, weather forced
  through rain/fog/cloudy every step) → **checkpoint 3** → Phase 4 (more forward-time legs, weather cycling every
  leg) → **checkpoint 4**. 16 checkpoint shots total, all opened and inspected: every one is clean at every
  checkpoint (not just the final one), across a city that autonomously grew from Day 1 / pop 8,704 to Day 29 / pop
  26,295 over the session (unpaused simulation running throughout) — zero errors, minFps 77.6
  (`shots/game/r4c-churn/cp{1-4}-*.png`).
- **Extreme-intensity adversarial check (beyond any prior round's testing):** `overview` + `fog:1.0` at tod 18 and
  `aerial` + `rain:1.0` at tod 6.5 — maximum possible weather intensity, the worst case for the fog-density-cap fix.
  Both clean, buildings and terrain fully legible, zero errors (`shots/game/r4c-diag/extreme-*.png`).
- **Official batch:** `node tools/critic.mjs --game --round 4c --dir shots/game/r4c` (re-run against the settled
  post-fix code) → 20 shots, **zero errors, minFps 92.2, maxGpuMs 9.4, maxDrawCalls 792** — comfortable margin on
  every budget axis. (An earlier run against the pre-fix code, superseded, had shown `minFps=48.2` at `closeup-21h5`
  — see perf section below.)
- **Explicit weather-variant batches:** (a) a dedicated `overview`/`aerial` × all 4 tods × {`rain:0.7`, `fog:0.7`}
  sweep, 16 shots, matching and extending round 4's own fix-verification sweep; (b) a broad batch across all 5
  presets × {`rain:0.7`, `fog:0.7`} = 10 shots, plus 5 more at the correct `cloudy:0.8` kind (a naming slip in my
  first pass used `overcast` as the weather kind string — not a real API value; `src/environment/index.js` and
  `src/ui/hud.js`'s `WEATHER_LABEL` both use `cloudy`, confirmed by grep — corrected and redone, 0 errors, HUD
  correctly reads "Cloudy" and shows soft uniform grey sky/no hard shadows). All 31 shots opened, all clean, zero
  errors, minFps 88.3 (`shots/game/r4c-weather/`).
- **Perf: live per-module profiling, not just critic.mjs sampling.** Wrapped every module's `update(dt,ctx)` from
  outside (no source touched) at `street`-tod-6.5 and `closeup`-tod-21.5, the two shots round 3 flagged. Against the
  **pre-fix** code: `buildings.update()` showed 2 spikes of 599-611ms in a 6s window, every other module <3ms total —
  a smoking-gun match for the stall `environment`'s core-request doc diagnosed (100+ growth candidates processed
  synchronously in one `autoGrowthPass()` call). Against the **settled post-fix** code, same methodology but with an
  8s pre-drain (to separate one-time post-boot backlog drain from true steady state) + 8s measurement window: **zero
  spikes over 16.7ms** in either window (1149/909 calls sampled), `buildings.update()` averaging 0.47ms/call, fps
  steady at 108-145 throughout. The fix (`REBUILD_BUDGET_MS=2.5` time-sliced chunk-merge in `batching.js`'s new
  `flushIncremental()`/`_stepChunkRebuild()`, plus `LEVEL_UP_BUDGET_MS=2` queue-and-drain in `index.js`'s
  `drainLevelUps()`) is architecturally sound, not a band-aid — it turns one big synchronous cost into small
  per-frame budgets, confirmed by direct instrumentation, not just by trusting the official batch's aggregate number.
  There *is* a brief (several-second) softer dip right after a fresh page load / new game while the boot-time
  backlog (the demo module's 600-tick fast-forward legitimately surfaces 100+ growth candidates at once) drains —
  fps dipped to 15-50 for a handful of 250ms samples in that specific window before recovering — but this is a
  one-time, bounded, self-resolving cost (not a recurring stall), and the official `critic.mjs` batch — which spends
  ~30-40s of session time working through 20 sequential shots — already reflects this reality and still comes back
  comfortably over budget (`minFps=92.2`).
- **Determinism:** every fresh Day-1 load this round reported the same `$96,739 / 8,704 / 5,034 / 73%`
  treasury/population/jobs/happiness as rounds 1-3's baseline.
- `grep -rn "Math.random" src/` — same 4 comment-only hits as every prior round (`core/rng.js`, `demo/citygen.js`,
  2× `effects/index.js`), no real call sites. Clean.

## Ranked issues

### 1. [minor, unchanged across all 4 rounds] Traffic still reads sparse from wide/elevated framing
**Where:** `shots/game/r4c/aerial-12.png` (essentially no visible vehicles at this distance/angle) vs.
`shots/game/r4c/street-12.png` (a healthy 3-4-vehicle cluster at the same simulated moment, close range). Consistent
with every prior round's finding — close/intersection framing reads fine, wide/elevated framing reads sparse. Still
undercuts REFERENCE.md's "traffic flows" bar from anything but close range. Not re-scored heavily since it is
unchanged in character and severity from rounds 1-3, and is a much smaller gap than the issues that dominated this
saga.

### 2. [nit, re-checked, not a bug] Demand bars (bottom-left R/C/I)
**Where:** every fresh-load shot this round (e.g. `shots/game/r4c-fresh/fresh-overview-rain0.85-6h5.png`) shows the
`R` bar lit, `C`/`I` mostly empty — byte-identical to rounds 1-3's deterministic Day-1 baseline. Confirmed (again)
not a bug: population/jobs/treasury are identical across sessions.

### 3. [informational, disclosed for rigor, not scored] One transient console error from an HMR file-save race
**Where:** two of my own weather-batch shots (`broad-street-overcast0.8.json`, `broad-aerial-overcast0.8.json`)
caught `[registry] module "buildings" threw in update (1/3): TypeError: Cannot read properties of null (reading
'has')` in the exact ~1-second window the other agent's buildings-perf-fix files landed on disk mid-review. Root
cause: `S.levelUpQueued` (a `Set`) is nulled by `dispose()`, and no module anywhere accepts Vite HMR
(`grep import.meta.hot` → zero hits), so any source edit triggers a full-page reload; the error is a stale
pre-reload page instance's `update()` racing the teardown. `disposeAll()` (the only caller of any module's
`dispose()`) is never invoked anywhere in the shipped app (grepped `src/`), so this path cannot occur in real play,
only when Vite's dev-only HMR socket pushes a reload mid-session — which happened here because I was reviewing while
a fix was being saved, not because of anything a player could trigger. Zero reproductions across the ~85 shots taken
against the settled code before and after this window.

## What already works — the headline result

- **The 4-round toothpick-washout bug family is, as far as this round's adversarial testing can determine, genuinely
  closed.** Zero reproductions across: 6 independent fresh-page-load sessions (no shared state) at all 4 tods × both
  rain and fog; a 16-shot dedicated `overview`/`aerial` × 4-tod × {rain,fog} sweep; a 31-shot broad weather batch
  across all 5 presets; a 16-checkpoint heavy-churn session with weather interleaved *throughout* 45 bounces + 900
  simulated frames of real time-forward growth (not just a final recheck) spanning Day 1 → Day 29 / pop 8,704 →
  26,295; and 2 maximum-intensity (`rain:1.0`/`fog:1.0`) extreme checks beyond anything any prior round tested. This
  is roughly 85 shots squarely targeting the exact failure precondition three prior rounds kept finding broken in,
  and every single one is clean, legible, and correctly atmospheric.
- **The perf regression round 3 found and round 4's `environment` core-request precisely root-caused is also fixed**,
  confirmed independently via live per-module instrumentation (not just trusting the aggregate critic.mjs number):
  the 500-600ms buildings stall is gone (zero spikes >16.7ms in an 8s steady-state window, vs. 2 spikes of ~600ms
  before), and the official batch's `minFps` went from a budget-failing 48.2 to a comfortable 92.2.
- **Close/street-level rendering remains genuinely AAA-with-nits**, unchanged in quality from rounds 1-3:
  `shots/game/r4c/street-18.png` (glossy Lego clearcoat, warm window glow, lovely dusk sky gradient),
  `shots/game/r4c/closeup-21h5.png` (crisp night bloom, headlit bus, crosswalk detail) — and now, new this round,
  `overview`/`aerial` are *also* consistently AAA-quality under every weather/tod combination tested, closing the
  gap REFERENCE.md's "atmosphere" and "living city" bars previously exposed at exactly the game's two primary "look
  at your city" angles.
- **Weather identity is correct and distinct**: rain (streaks + darker wet-look ground), fog (heavy atmospheric
  wash that still preserves legibility), and cloudy/overcast (soft uniform grey sky, no hard shadows, correct HUD
  label) all read as visually distinct states matching REFERENCE.md item 4, at every preset tested this round.
- **Zero console errors, clean determinism, clean perf/draw-call/Math.random hygiene** across every batch this round
  bar the one fully-explained dev-tooling HMR artifact above.
