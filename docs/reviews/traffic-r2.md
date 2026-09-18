# traffic — round 2 critic review

**Score: 6.5 / 10 — FAIL** (every individually-named round-1 defect is genuinely fixed, but the flagship
`traffic:closeup` preset — the one thing this round needed to land — is still not a reliable clean shot, and the
fix attempt introduced a real, verified violation of ARCHITECTURE §0's determinism contract)

## Perf & errors
- 36 captures this round: `node tools/critic.mjs --module traffic --round 2c --dir shots/traffic/r2c` (default variant),
  `--variant night --dir shots/traffic/r2c-night`, `--variant intersection --dir shots/traffic/r2c-int` — all 4 tods
  (6.5/12/18/21.5) × 3 presets each.
- **Console errors: 0** across all 36 captures (`summary.json` × 3: `errors: []`). **Math.random: 0 hits** in `src/traffic/`
  (grepped fresh this round). Folder still contains only its own 5 files (`index.js`, `lanegraph.js`, `models.js`,
  `sim.js`, `showcase.js`).
- Perf: minFps **81.8** (one soft dip on `traffic_intersection-21h5` in the default-variant run; gpuMs there was
  still only 9.95ms, so this reads as incidental contention, not a regression), maxGpuMs **9.95ms** (budget ≤20ms —
  comfortably inside), maxDrawCalls **106** (whole showcase scene incl. terrain/environment/roads/effects). All
  other 35 captures ran at 143–144 fps / 3.2–6.6ms gpu. Budgets pass cleanly.

## Determinism investigation (flagged by the builder, verified independently)

The builder disclosed that `traffic:closeup` picks its "hero car" live, from real simulation state, at the moment
the preset is applied — and warned this is non-deterministic even under `?fixeddt=1`. I verified this directly
rather than taking it on trust, because ARCHITECTURE §0 states plainly: "same seed → same city, same screenshot."

**Confirmed: it is genuinely non-deterministic**, and I traced the actual mechanism (it survives `fixeddt=1` for a
subtle reason the builder's note didn't fully spell out):
- `fixeddt=1` (`src/main.js:81`) only fixes *dt per frame* to 1/60s. It does **not** fix the *number of frames* that
  elapse before a screenshot is taken.
- `tools/critic.mjs`'s `capture()` calls `window.__city.frames(40)` (a frame-count-based wait — good, in principle
  deterministic) and *then* does a **real-wall-clock** `setTimeout(sampleMs)` (800ms) before screenshotting. During
  that 800ms, `requestAnimationFrame` keeps firing with dt still pinned to 1/60s each tick, but the *count* of ticks
  that fire in 800ms of real time is not fixed — it depends on actual browser/GPU frame pacing.
- I reproduced this directly: 6 fresh page loads at identical `seed=1, tod=12, preset=traffic:closeup` produced
  **6 different SHA-256 screenshot hashes**, with **zero exceptions**, repeated across further sweeps at tod
  6.5/18/21.5 and the `intersection` variant (also 100% distinct hashes every run). Camera position (which is
  computed once from the picked hero car and then frozen) landed on exactly **two discrete values** ~0.15m apart
  across repeated runs at the same seed/tod, caused by a further, smaller source of the same bug: the `frames(40)`
  wait itself lands on frame 43 or 44 depending on async Node↔browser round-trip timing relative to the RAF clock,
  so even the "deterministic" settle checkpoint isn't quite deterministic in wall-clock terms.
- **Severity, empirically**: in ~20 repeated captures across multiple tods/variants I never saw it pick a visibly
  different car, model, or color — every repeat kept the same hero vehicle with sub-pixel/sub-meter framing jitter
  (see camera deltas above). So in practice, today, at these seeds, it does not look broken. **But** this is not a
  guarantee: `pickHeroCar()`'s own tier 3/4 fallback (`src/traffic/index.js:162-169`) explicitly exists to pick a
  *moving* car with reduced clearance whenever nothing is currently stopped anywhere in the demo — a state that is
  plausible for a few frames right as a queue discharges. Combined with the same real-time-wait bug, a moving hero
  car picked in that window could plausibly drive materially out of the tightly-framed shot before the screenshot
  fires. I did not reproduce that specific failure in the samples I ran, but the code path for it exists and the
  timing bug that would trigger it is proven, not hypothetical.
- **Verdict**: this is a real architecture violation (§0), not just a theoretical nitpick — "same seed → same
  screenshot" is currently false for `traffic:closeup`, full stop. It happens to be low-visual-impact today and is
  arguably *half* a tool/harness bug (the real-time `sampleMs` wait in `shot.mjs`/`critic.mjs`, which every module's
  screenshots rely on, not just traffic's), but the module's own design choice — scoring/picking a "hero" from live,
  continuously-advancing sim state inside a camera preset function, rather than freezing that decision once during
  `showcase()` and re-deriving the camera from a stored car id — is what makes this preset specifically sensitive to
  it where other presets (`traffic:default`, `traffic:intersection`, which only look at fixed bounds) are not.

## Ranked issues

1. **[Architecture violation, confirmed] `traffic:closeup` is non-deterministic run-to-run at the same seed.** See
   investigation above. Fix: pick the hero car once, synchronously, when the preset function first runs after
   `showcase()`/`setCamera()` is called (not scored fresh against whatever frame happens to be current), and cache
   that decision (e.g. by car pool index) so repeated `setCamera('traffic:closeup')` calls at the same sim state
   return the same transform. This doesn't fully fix the underlying tool-level real-time-wait issue but removes the
   module's own contribution to it (a scoring function that reruns against a live, unpinned world every call).

2. **[Partially fixed] `traffic:closeup` composition is inconsistent — clean in some conditions, a cluttered
   overlapping-car pile-up in others.** Where: `shots/traffic/r2c/traffic_closeup-6h5.png`, `-12.png`, `-18.png`
   (default variant) and `shots/traffic/r2c-night/traffic_closeup-6h5.png` through `-18.png` (night-variant grid
   demo at day tods — the "night" variant only changes the default tod when unspecified, so daytime tods there
   render the same grid demo) all show **3-5 cars crammed together in frame simultaneously**, several with bodies
   visually touching/overlapping (e.g. the orange van's nose sits flush against the yellow van's tail in
   `traffic_closeup-6h5.png`, and a translucent cabin box floats oddly over the car behind it) — this reads as a
   traffic-jam screenshot, not a hero product shot. By contrast `shots/traffic/r2c-int/traffic_closeup-6h5.png`,
   `-12.png`, `-18.png` (intersection variant, daytime) **are** genuinely clean, well-composed 3/4 shots of one or
   two cars with visible wheels/glass/pillars — proof the underlying model/geometry work is solid and the framing
   math (`fwdOff`/`sideOff`/`heightOff` in `index.js`) can produce a good shot. Root cause: `scoreCandidates()`'s
   score function (`index.js:147`) is `queueDepth * 40 + min(clearAhead, needed+3) * 2 - distToCenter * 0.5` —
   `queueDepth` counts *every* other stopped car sharing the lane (not just ones behind), weighted at 40, which
   dwarfs every other term and actively rewards picking a car buried in the densest, longest queue available. That
   is precisely the scenario that puts multiple vehicles in frame at extreme close range. Fix: drop or heavily
   discount the `queueDepth` term (it was presumably added to bias toward "reliably stationary," which the
   `requireStopped` tier already guarantees) and instead penalize *nearby* stopped neighbors within some radius of
   the camera's frame, or explicitly check that no other active car's bounding box projects into the shot before
   accepting a candidate.

3. **[Fixed, confirmed]** Wheels are now visible: four real tire cylinders per car (`wheelCylinderGeometry()` in
   `models.js`) plus wheel-arch skirts, merged into the shared `wheel` InstancedMesh at zero extra draw-call cost.
   Confirmed in every closeup capture across all three directories (e.g. `shots/traffic/r2c-int/traffic_closeup-12.png`
   shows clean tire/wheel-arch read on both cars). R1 issue #2 resolved.

4. **[Fixed, confirmed]** Cabin glass now reads as real glazing rather than a flat translucent slab: A/C-pillar and
   beltline trim strips (`cabinPillarGeometry()`) break the box into windshield/side-glass panes, and the glass
   material itself (`transBlue`, roughness 0.028, near-mirror) is visibly glossier than the body plastic. Confirmed
   in the same clean closeups. R1 issue #3 resolved.

5. **[Fixed, confirmed live]** Taillight emissiveIntensity now clears the ARCHITECTURE §7 red-emissive bloom
   threshold (≥4) for both states at night. Read directly from the live `MeshPhysicalMaterial` via `page.evaluate`
   (not just the source file): `headNight` = 3.5, **`tailNormalNight` = 4.2** (was 3.2 in R1, now above threshold),
   **`tailBrakeNight` = 5.2** (correctly brighter, still clearly distinct from normal). R1 issue #5 resolved.

6. **[Fixed, confirmed over time]** Stopped/queued cars now keep the bright brake material continuously, not just
   at the instant of deceleration. Verified by sampling the live `tailBrake`/`tailNormal` InstancedMesh counts every
   ~0.5s over 3.5+ seconds of continued (fixed-dt) simulation at a busy intersection at night: the brake-lit count
   stayed substantial and non-collapsing throughout (12–21 of ~44 active cars lit brake red at every single sample),
   confirming `car.braking = diff < -0.35 || (targetSpeed <= 0.05 && car.speed <= 0.15)` in `sim.js` does hold the
   flag while genuinely parked, matching the code comment's intent. R1's minor note resolved.

7. **[Unchanged, not re-scored against]** Round-robin-by-arm signal design still produces visible one-arm-backs-up
   queuing under load (e.g. `shots/traffic/r2c/traffic_default-18.png`, `shots/traffic/r2c-night/traffic_intersection-21h5.png`).
   Same as R1 issue #4 — a documented design tradeoff, verified conflict-free, not a defect worth re-penalizing this
   round, but still a candidate for a future throughput tune if "flowing city" matters more than strict simplicity.

## What already works well
- **Close-range model detail is now genuinely credible** where the closeup composition itself succeeds: wheels,
  glass with pillar breakup, and clearcoat highlights all read correctly — see `shots/traffic/r2c-int/traffic_closeup-12.png`
  and `-18.png`.
- **Night lighting and brake-light behavior are both correct and convincing**: headlights, normal taillights, and
  brake taillights are all now above/at the intended emissive tiers, verified live rather than just in source, and
  brake state persists correctly for parked cars — see `shots/traffic/r2c-night/traffic_intersection-21h5.png`.
- **Simulation engineering remains rock solid**: 0 console errors across 36 fresh captures, 0 `Math.random` hits,
  fixed draw-call footprint, and perf comfortably inside budget (maxGpuMs 9.95ms vs. 20ms budget) even at the
  busiest tested conditions.
