# LOOP cycle 1 — L1 hero framing system

**Goal:** the core presets must frame real subjects instead of empty fields / data maps / clipped facades
(the top blind-set lever in `docs/reviews/game-r22-critic.md` #1 and `docs/reviews/beauty-v5-critic.md` #2/#3).
**Acceptance:** new preset geometry checks green, no errors, budgets pass, no regression vs baseline r30, and an
honest blind set 4.

## What changed

| file | change |
|---|---|
| `src/core/composition.js` (new) | subject selection over the world model: civic lots scored by neighbouring buildings + street props, avenues scored by building frontage + props + length, tall-cluster centroid, sun azimuth, placement and 2D occlusion helpers. Pure + deterministic (no RNG, stable tie-breaks on id). |
| `src/core/camera.js` | all six presets recomposed and subject-aware with empty-world fallbacks; `closeup`/`street` pick their subject from world data; `night` aliases `skyline` (unchanged). |
| `src/core/context.js` | the clock is passed to `createCamera` so presets can read the sun azimuth. |
| `src/core/debug.js` | `__city.resetPresentation()` hook (forwards to environment; used by capture tools). |
| `src/environment/index.js` | `api.resetPresentation()`: resets the animated sky/cloud phase so same-tod captures don't drift with session frame count (critic issue 4). |
| `src/props/index.js` + `materials.js` | traffic-signal lenses: exactly one aspect is lit (the others go to emissive 0 and a 0.12x base colour), and the lens state is applied at init and on day/night changes, not only on a phase change — paused captures were showing all three aspects lit (critic issue 3b). |
| `tools/shot.mjs` | `stage()` resets the sky phase; capture JSON records the render `frame`. |
| `tools/check-beauty.mjs` | `--out` (never overwrite the judged `shots/beauty/v5`); geometry checks replaced with the cycle-1 intent: distance + elevation bands for skyline/overview/aerial, aerial near/middle water cells, street eye height + frontage, closeup subject kind / fit / unocclusion / near-corner framing / sun-side, and an empty-world fallback boot. |
| `ARCHITECTURE.md` | §1 core file list + §6 preset contract updated. |

## How the compositions were chosen (labs, all in-page, one browser each)

Three labs (`Temp/opencode/c1/lab*.mjs`) captured ~45 candidate framings with per-frame analytics (buildings
in frame / bottom-third count / 12×7 coverage grid). Winners, all verified by eye:

- **skyline/night** — (520, 60, 70) → (150, 14, −40), fov 46: a low 3/4 with the sunset avenue leading in; at
  17.7 the sun sits behind the towers (warm column down the street), at night it is a wall of lit windows.
- **overview** — (−250, 240, 420) → (0, 0, −40), fov 45: oblique ~25° from the south-west; industrial pads and
  the bay give the frame edges content (cover 0.64 vs 0.55 for the old framing, which read as a tinted map).
- **aerial** — (860, 300, 300) → (200, 0, −80), fov 45: ~21° oblique from the east; the bay is in the near /
  middle bands (333 water cells by `check-beauty`'s projection; the first-lab framing looked west-southwest and
  contained **0** — see the fix round below).
- **street** — the busiest avenue by frontage (seed 1: the hedge-plaza avenue at z≈0), eye 2.8 m on the outer
  verge, looking inward along the carriageway; both verge sides and four standoffs are scored so no prop sits in
  the lens and no lamp bisects the frame centre.
- **closeup** — a civic hero: `civicSubjects` scores school/hospital/fire/police by neighbours + props; every
  clear (candidate, +z-face offset) pair is scored by `candidateScore × cos²(offset) × (0.5 + 0.5·sunDot)` — the
  entrance face must read, the sun side is preferred but not at a razor angle — with distance sized so the
  **near corner** stays inside the frame and a 3D eye→hero raycast so no neighbour wall can fill it. Seed 1
  picks the suburb hospital (cross + entrance + crosswalk, sun-side dot 0.46, near corner top 0.43 / bottom −0.28).

Three bugs were found and fixed by live checks: a blank **side wall** frame (2D footprint test → 3D raycast),
the **MapControls polar clamp** silently lifting the street eye to 6.5 m (target must sit below the eye), and a
closeup candidate that fell through to the generic fallback instead of trying the next civic lot.

## Evidence (RTX 4070 Ti, `nvidia-smi` before runs; external compositor load present)

| run | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|
| baseline r30 (pre-cycle-1) | 72.0 | 13.34 | 844 | 0 |
| r31 game batch (`shots/game/r31`, 20 shots) | 73.1 | 13.08 | 856 | 0 |
| r36 game batch (fix round 2, pre-4 m-clearance street tweak) | 99.2 | 9.64 | 856 | 0 |
| r37 game batch (frozen cycle-1 build, GPU idle) | 100.0 | 9.71 | 856 | 0 |
| `check-beauty --out shots/beauty/c1fix3` | — | — | — | **37/37 checks, 0 errors** |

Per-preset gpuMs at 21.5 (r36): closeup 9.64, street 9.62, skyline 9.37, overview 8.43, aerial 8.24 — all inside
the ≤ 20 ms full-city budget. Hero shots read: `shots/beauty/c1fix3/01-skyline-golden.png` (sunset down the
avenue), `03-street-night.png` (urban canyon, one lit signal, streetlamps, no centre pole, eye 4 m+ off facades),
`04-closeup-golden.png` (hospital cross + entrance + crosswalk), `02-overview-noon.png` (dense city + bay +
industrial), `05-aerial-dawn.png` (bay in the near/middle bands, long dawn shadows).

## Fix round (post-critic, `docs/reviews/loop-c1-critic.md`)

| critic issue | fix |
|---|---|
| 1. closeup back-lit + near corner 1.45–1.64x frame height | every clear (candidate, +z offset) pair is scored `candidateScore × cos²(offset) × (0.5 + 0.5·sunDot)`; distance sizes on the near corner; `check-beauty` now asserts sun-side (dot > 0.1) and near-corner NDC in [-1.06, 1.06]. Seed 1 ships the suburb hospital: sunDot 0.46, corner top 0.43 / bottom −0.28, fit 0.51, unoccluded. |
| 2. aerial contained 0 water cells | re-aimed to (860, 300, 300) → (200, 0, −80): 333 water cells in the near/middle bands (check-beauty gate ≥ 150), elevation 21.3°, distance 817 m. |
| 3. street centre pole + all-three-lit signal | both verge sides × 5 standoffs are scored with a graded central cone (near-lens hard reject; building clearance hard-reject < 2.5 m, penalised < 9 m) and the aim is tilted away from the lamp line. See fix round 2: clearance added after the re-verification caught a seeds-2/23 face-plant. The signal fix is in `props` (see the table): exactly one lens lit, applied at init and on day/night changes so paused captures are correct. |
| 4. sky-phase frame drift | `environment.api.resetPresentation()` + `__city.resetPresentation()`; `shot.mjs` calls it on every stage and records the frame count. |
| 5. roads-showcase street fallback lifted to 3.26 m | fallback target now sits below the authored eye; `check-beauty` boots `?showcase=roads` and asserts all presets finite and the street fallback eye in (1.4, 2.4) m — measured 1.7 m. |
| 6. literal `Math.random` gate | restated in `docs/LOOP.md` (sim/render path only; the two menu call sites are whitelisted by name). |

## Fix round 2 (re-verification, `docs/reviews/loop-c1-fix-critic.md`)

The re-verifier (fresh critic) confirmed the closeup, aerial, signal and sky-reset fixes and the whole regression
suite (its 23/23, r35 101.9/9.47/856, atmosphere 22/22, props 198 draws), but scored 7/10 FAIL on:

1. **Street face-plant on seeds 2/23** (new regression: eye 1.0 m from a facade). Fixed: the street score now
   includes building clearance (hard reject < 2.5 m, penalty to 9 m), a graded central-cone prop penalty, and a
   fifth standoff (48 m); `check-beauty` gates seeds 2 and 23 too. Measured after the fix: clearance 15 m / 8.1 m,
   nearest cone prop 39 m / 31 m, eye 2.8 m both.
2. **False "no cone prop nearer than 88 m" claim** — that was seed-1/tod-12-specific; the report now states the
   gate (≥ 10 m in the check, seeds 1–3) and the measured values.
3. **Session-length hole** — the sky-phase reset is confirmed (warm-up + reset + 600 frames = 0.0245 meanAbs),
   but a *cold first* capture still differs (2.5) because the world itself keeps growing for a while after boot
   (441 → 555 buildings over 3600 paused frames: level-ups settle over session time). Protocol: captures are
   compared at the same warm-up/settle (`shot.mjs`/`critic.mjs` warm up first); the claim "session length is
   irrelevant" is withdrawn.
4. **Closeup seeds 2/23 read wide/high** — eye lowered (`gy + max(2.2, 0.38h + 1.0)`, target at `0.42h`);
   near-corner still inside (1.03 / −0.78 school, seeds 2/23; screenshots looked at).
5. **Off lenses still coloured in sun** — off-state base colour darkened to 0.08x (was 0.12x); day/night states
   re-confirmed (green 0.8 day, 3.5 night; red/yellow emissive 0 + dark).

`check-beauty` is now **37/37**: seed-1 details, seeds 2/23 geometry gates, showcase fallbacks, HUD.

## Known gaps

- The skyline sun bloom at 17.7 is a large white blob (ACES + bloom at a 5° sun); keeping the sun in frame is
  what gives the golden identity, and dropping the sun was rejected. A future pass can try a partial occluder.
- Green terrain/zone plates still dominate the wide shots (aerial/overview); that is L2/L4 (detail layer,
  density), not this lever. Terrain riser aliasing at the mountain top-right is L6.
- The closeup subject is data-driven, so different seeds pick different civic lots; re-verification checks
  seeds 2/23 against the same geometry gates, but only seed 1's hero has been looked at.
- The traffic-signal *phase* is props' own decorative cycle, not synced to the traffic module's real signals
  (pre-existing; noted for a traffic pass).
- Set 4 not yet run.

## Next

E3 re-verification of the fix round (fresh critic), then E4 blind set 4 with the balanced pairing, then E6 re-rank.
