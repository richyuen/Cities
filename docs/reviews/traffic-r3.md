# traffic — round 3 critic review

**Score: 8.6 / 10 — PASS** (both round-2-blocking defects are independently confirmed fixed: the `traffic:closeup`
determinism violation is gone, and the composition/clutter problem is gone; what's left is genuine AAA-with-nits
territory, not a re-fail)

## Perf & errors
- 36 fresh captures this round: `node tools/critic.mjs --module traffic --round 3c --dir shots/traffic/r3c` (default
  variant), `--variant night --dir shots/traffic/r3c-night`, `--variant intersection --dir shots/traffic/r3c-int` —
  all 4 tods (6.5/12/18/21.5) × 3 presets each.
- **Console errors: 0** across all 36 captures. **Math.random: 0 hits** (grepped fresh this round). Folder still
  contains only its own 5 files (`index.js`, `lanegraph.js`, `models.js`, `sim.js`, `showcase.js`).
- Perf: `r3c` minFps 123.3, maxGpuMs **5.28ms**; `r3c-night` minFps 124.4, maxGpuMs **6.91ms**; `r3c-int` minFps
  124.5, maxGpuMs **5.44ms**. Budget is ≤20ms/≥50fps — all three batches pass with wide margin. maxDrawCalls
  104–106 (whole showcase scene incl. terrain/environment/roads/effects, consistent with round 2's reading of the
  §7 budget table).

## Determinism re-investigation (round-2 issue #1 — independently re-verified, not taken on trust)

Built my own verification script (`openApp` from `tools/shot.mjs`, 8 independent fresh browser loads, no shared
state between runs) targeting `showcase=traffic&variant=default&seed=1&tod=12`, staging `traffic:closeup`, and
reading `camera.position` / `controls.target` / `camera.fov` live via `page.evaluate` after each capture:

- **`camera.position` / `controls.target` / `camera.fov` were byte-identical across all 8 fresh loads**
  (`[18.42838000000002, 12.150250190734868, 12.019999999999992]` / `[2, 8.045000190734864, 16.549707160144784]` /
  `40`, exactly, every run). The module's own `presets['traffic:closeup'](world)` pure-function output (read
  directly from the live module record, not just the applied camera) was also byte-identical every run.
- Full-screenshot SHA-256 hashes were **not** all identical (5 distinct hashes across 8 runs) — exactly the
  expected signature of "camera + hero frozen, background traffic still evolves a variable number of real-time
  frames before the shot fires," not a regression of the bug.
- Cross-checked with `pixelmatch`/`pngjs`: diffed the two most-divergent runs (by hash) against a 40–70%-width,
  25–75%-height center crop covering the framed hero. Whole-image diff was 2.8–2.9% of pixels (all of it visibly
  at the frame edges, in the background-traffic cluster near the intersection corner — confirmed by rendering the
  diff mask); the same crop restricted to the hero's own footprint showed only 0.52–0.54% diff pixels, all
  attributable to a background car's leading edge grazing the crop box, not the hero itself. A byte-identical pair
  of runs (matching hash) diffed at exactly 0% everywhere, including the crop.
- Traced this against the source: `showcase()` (`src/traffic/index.js:349-368`) now calls `warmUpAndPickHero()`
  synchronously — a pure fixed-dt/fixed-tick-count simulation fast-forward seeded only by `ctx.rng`/`seed`, with no
  wall-clock or rAF dependency — then freezes the winning car (`_heroFrozen = true`, skipped in `update()`'s
  per-frame `stepCar` loop) and caches `computeHeroShot()`'s output in `S.heroShot`. `presets['traffic:closeup']`
  just replays that cached value instead of re-scoring live. This is exactly the fix round 2 asked for, and it
  holds up under independent re-measurement: **round-2 issue #1 is fixed, confirmed.**

## Composition re-investigation (round-2 issue #2 — independently re-verified)

Looked at all 12 `traffic:closeup` captures (4 tods × 3 variants: default/night/intersection) plus the 8
fresh-load verification screenshots. Every single one shows a cleanly isolated hero (a lime-green bus in the
default/night grid demo, a dark van in the intersection demo) filling a well-composed fraction of frame, at most
one non-touching companion car visible, zero overlapping/touching bodies — a real change from round 2's
`shots/traffic/r2c/traffic_closeup-6h5.png`-style 3-5-car pile-ups. This matches the rewritten `scoreCandidates()`
(`CLUTTER_RADIUS` cross-lane/same-lane neighbor check, `nearbyCount > 1` reject, `MIN_NEIGHBOR_GAP` behind-car
guard) doing exactly what its comments say. **Round-2 issue #2 is fixed, confirmed** — see
`shots/traffic/r3c/traffic_closeup-*.png`, `r3c-night/traffic_closeup-*.png`, `r3c-int/traffic_closeup-*.png`.

One honest caveat, not a fail-worthy defect: the hero framing in the default/night variant is closer to a
rear-3/4 elevation than a true front-3/4 "product shot" angle (we see the bus's tail + a strip of left-side glass,
not a dynamic front corner) — it reads clean and well-lit, just less dynamic than the intersection variant's shot
(which genuinely is a nice front-left 3/4 view with headlights visible). Not something I'm penalizing this round
since "clean, isolated, no clutter" was the explicit bar and it's cleared, but worth a design pass if there's a
round 4.

## Ranked issues (remaining)

1. **[Minor, unchanged from r2, design tradeoff, not re-penalized]** Round-robin-by-arm signal design still
   produces visible one-arm-backs-up queuing under load — e.g. `shots/traffic/r3c/traffic_default-12.png` and
   `-18.png` (top-left arm), `shots/traffic/r3c-night/traffic_intersection-21h5.png`. Verified conflict-free
   (no cars clip or overlap in the queue), same as r1/r2. Candidate for a future throughput tune, not a defect.
2. **[Minor, cosmetic]** `traffic:closeup`'s default/night-variant framing is a rear-3/4 elevation rather than a
   front-3/4 hero angle (see caveat above) — the intersection variant's front-corner framing is the better
   reference to match if this gets revisited. Doesn't hurt the current isolation/no-clutter bar.
3. **[Not re-tested this round]** The underlying tool-level real-time `sampleMs` wait in `shot.mjs`/`critic.mjs`
   (flagged in r2 as "half a tool bug") still exists and still causes background-traffic pose to vary run-to-run —
   this is now provably harmless to `traffic:closeup`'s subject/composition (confirmed above) but is a shared-tool
   characteristic, not something `traffic` itself can or should fix further.

## What already works well
- **`traffic:closeup` determinism is now real and independently verified**, not just claimed: camera transform
  and the module's own preset-function output were byte-identical across 8 fresh page loads at the same seed/tod,
  with only non-hero background traffic differing (confirmed both via live camera-state comparison and pixel-level
  image diffing of the hero's own frame region).
- **Closeup composition is now consistently clean across all three variants and all four tods** — a single
  isolated, well-lit hero car with wheels/glass/pillar detail reading correctly, no overlapping/touching
  neighbors, in every one of the 12 closeup captures this round (compare to round 2's cluttered pile-ups).
- **Everything round 1/2 already fixed stays fixed**: wheels, cabin glass/pillar breakup, night emissive tiers
  (taillight/brake thresholds), and persistent brake-light state for stopped cars are all still correct in this
  round's captures.
- **Simulation engineering remains rock solid**: 0 console errors and 0 `Math.random` hits across 36 fresh
  captures this round, perf comfortably inside budget (maxGpuMs 6.91ms vs. 20ms budget) even at night with full
  post-processing.
