# LOOP cycle 1 fix round — hostile verification (fresh critic #2)

**Build under test:** `92c18bc` (HEAD, working tree clean). **Score: 7 / 10.**
**Verdict: FAIL (narrow)** — every numeric acceptance gate the fix round lists reproduces green, and the
flagship (seed-1) defects from the first critic really are fixed, but the fix round *regressed the street
preset on seeds 2/23* (eye 1.0 m from a facade → shopfront/awning fills 40–50 % of the frame) and one of its
own measurements is false (street "no cone prop nearer than ~88 m"; measured 12.6–14.7 m). The shipped preset
family is still seed-1-tuned, and the "captures now depend on (seed, tod, preset, settle) rather than session
length" claim is overstated (world keeps growing while the clock is paused; a cold first capture is 2.5 meanAbs
off).

All numbers below are mine, on the same RTX 4070 Ti / ANGLE D3D11, `nvidia-smi` checked before every batch.
Browser sessions were serialized.

## Runs (mine)

| run | result |
|---|---|
| `node tools/check-beauty.mjs --out shots/beauty/c1v` | **23/23 checks, 0 capture errors**; seed-1 numbers: sunDot 0.463, corner top 0.43 / bottom −0.283, aerial 333 near/middle water, roads fallback eye 1.7 m |
| `node tools/diff.mjs --a shots/beauty/c1v --b shots/beauty/c1fix` | meanAbs **0.0035**, worst `02-overview-noon` 0.0082 — same-render drift ≪ 0.3 |
| `node tools/critic.mjs --game --round 35 --dir shots/game/r35` | minFps **101.9**, maxGpuMs **9.47**, maxDrawCalls **856**, errors **0**; budgets all true |
| `diff r35 vs r34` | meanAbs **0.0067**, worst `overview-18` 0.0195 → no file > 0.3 |
| `diff r35 vs r31` (pre-fix composition) | meanAbs 21.18 — the recomposition + pre-reset sky phase; not usable as a regression signal (expected) |
| closeup seeds 1/2/23 @17.7 (`closeup-seeds.json`) | sunDot **0.463 / 0.463 / 0.463** (> 0.1); near-corner NDC top/bottom **0.43/−0.283, 0.487/−0.344, 0.48/−0.336** (inside ±1.06); hero hospital/school/school; eye→hero ray first hit = hero; fit 0.51/0.57/0.56 |
| aerial water @6.3 and @12 (`aerial-water.json`) | 880 water cells in frame, **342 in the near/middle bands** (gate ≥ 150) at both tods; bay bottom-right + river left visible |
| street seeds 1/2/23 @12 and @21.5 (`street-signal.json`) | hard-reject props **0** on all seeds; nearest prop 14.74 / 7.40 / 12.56 m; **nearest building 15 m / 1.0 m / 1.0 m**; cone (lat < 0.22, d ≤ 140, ahead) first entries 14.74 m lamp / 25.15 m bench / 14.74 m lamp |
| lens materials (`lens.mjs`, props crops) | day: green ei 0.8, colour 1.0× base; red/yellow ei 0, colour **0.12×** base. Night paused: green 3.5, others 0 / 0.12×; unchanged after 120 more paused frames |
| sky-phase reset | tool-style warm-up + 600 frames between + reset before both stages: meanAbs **0.0245**, worst 0.057 (PASS). Cold first stage (stage ~30 ms after ready): skyline **2.51–2.59** (FAIL) |
| cold-capture isolation (`cold.mjs`, `regen.mjs`, `pose.mjs`, `world-evolve.mjs`) | camera bit-identical; sky-top rows identical (0.00); forced env regen does not change it; buildings grow while paused **441 → 477 → 555** over 3600 frames; warm-lit pixel share 2.58 → 2.30 % between cold and settled |
| `node tools/check-atmosphere.mjs` | **22/22** |
| `node tools/critic.mjs --module props --round 3 --dir shots/props/r3v` | minFps 143.4, maxGpuMs 6.66, draws 198, errors 0; crops show exactly one lit aspect (amber at noon, green at night) |
| boundary | `git show --stat 92c18bc` = core/tools/docs/environment/props (+`ARCHITECTURE.md`); `git grep Math.random src/` = 2 real call sites (`src/menu/newCity.js:4`, `src/menu/storage.js:56`) + 5 comments only |

## Per-issue verdicts

| # | fix-round claim | my measurement | verdict |
|---|---|---|---|
| 1 | closeup sun-side (dot > 0.1), near corner in [−1.06, 1.06], civic, ray = hero | seeds 1/2/23: dot 0.463; corners inside; hospital/school/school; ray first hit = hero; screenshots show the entrance face lit and the whole near edge in frame | **CONFIRM** (the 1.45–1.64× crop and the back-lit framing are gone) |
| 2 | aerial re-aimed; bay in near/middle bands, gate ≥ 150 | 880 cells in frame; **342** near/middle at 6.3 and again at 12; bay visible bottom-right, river at left edge | **CONFIRM** (water is real but peripheral — corner/edge, not an anchor) |
| 3a | street: no prop in the hard-reject zone (d < 3, or d < 8 & lat < 0.4) | hard props **0** on seeds 1/2/23 | **CONFIRM** |
| 3b | street "the eye now sees no cone prop nearer than ~88 m" | cone (lat < 0.22, d ≤ 140 m, ahead) first entries: seed 1 lamp **14.74 m / lat 0.213**, seed 23 lamp **14.74 m / lat 0.213**, seed 2 bench 25.15 m / lamp 25.48 m; seed 23 also has its nearest prop (12.56 m lamp, lat 0.114) just behind the view axis | **REFUTE** |
| 3c | street composition "no centre pole" across the family | seed 1: no centre pole, decent frame (a bus can sit near the lens — see below). Seeds 2/23: eye **1.0 m** from building `b76`; seed 2's frame is a face-plant behind an awning/facade slab, seed 23's is filled by blown-out shop windows at 1.5–2 m | **REFUTE (new regression)** |
| 3d | traffic signals: exactly one lens lit, applied at init and on day/night change, correct while paused | materials confirm (green 0.8 day / 3.5 night; others ei 0, 0.12× base) and stay correct across 120 paused frames; crops: green (closeup 17.7), amber (props noon), green (props night) — the pre-fix "all three lit" is gone | **CONFIRM** |
| 4 | sky-phase reset + `frame` in capture JSON | `frame` present and equal in c1v/c1fix (154); tools-style same-session test (600 frames, reset before both) = **0.0245** | **CONFIRM for the shipped path**; see issue 3 below for the cold/session-length hole |
| 5 | roads-showcase street fallback target below the eye; eye in (1.4, 2.4) | check-beauty boots `?showcase=roads`, all 24 presets finite, street eye **1.7 m** | **CONFIRM** |
| 6 | literal `Math.random` gate restated | `git grep` at HEAD shows only the two whitelisted menu call sites (5 more hits are comments); LOOP §2 restated | **CONFIRM** |

## New / remaining defects (ranked, most damaging first)

1. **REGRESSION — the street preset face-plants on seeds 2 and 23.** *Where:* `seed2-street-12.png`,
   `seed2-street-21h5.png`, `seed23-street-12.png`, `seed23-street-21h5.png` (mine). *Numbers:* applied eye
   `[16,7.6,7]` / `[24,7.6,7]`, nearest building footprint **1.0 m** away (`b76`, cell 129,129) vs **15 m** for
   seed 1; the placement scoring only rejects an eye *inside* a footprint (`segmentBlocked(p,p)` is a degenerate
   point test), so a point 1 m from a wall passes and the 0.6 m `clampOutsideBuildings` margin never triggers.
   *Why it hurts:* seed 2's frame is an
   awning/facade slab cutting the frame diagonally; seed 23's is three blown-out glowing windows at 1.5–2 m —
   the exact "clipped facade / not a shipped game" tell the lever exists to kill. *Proof it is a fix-round
   regression:* the pre-fix-round cycle-1 captures (`...\c1c\seeds\seed2-street-21h5.png`,
   `seed23-street-21h5.png`) show a clean wide avenue for seed 2 and the known centre-pole (plus the
   all-three-lit signal, now fixed) for seed 23. *Why it wasn't caught:* `check-beauty` only gates seed 1.
   *Fix direction:* reject/penalise candidate eyes whose nearest building footprint distance is < ~4 m (or
   whose first ~10 m of view contains a wall), and gate a second seed in `check-beauty`.

2. **Fix-round measurement is false — "no cone prop nearer than ~88 m".** Measured with the exact cone
   definition in `camera.js` (ahead ≥ 0.3, d ≤ 140 m, lat < 0.22): seed 1 lamp at **14.74 m / lat 0.213**,
   seed 23 lamp at **14.74 m / lat 0.213**, seed 23's *nearest prop
   overall* is a lamp at **12.56 m / lat 0.114** (just behind the view axis), and a signal sits at 35.8 m /
   lat 0.136.
   The hard-reject zone is genuinely clear, so this is a claims-gate failure, not a hard-gate failure; the
   report sentence must be corrected.

3. **Session-length dependence is only masked, not fixed.** A first capture staged ~30 ms after `ready`
   differs from a settled capture by **meanAbs 2.51–2.59** (skyline), while the same test with the tools'
   120-frame warm-up is 0.0245. Isolation: camera pose bit-identical, sky-top rows identical, forcing an
   env-map regen changes nothing; the world **grows while the clock is paused** (441 → 477 → 555 buildings
   over 3600 paused frames) and the warm-lit-pixel share settles 2.58 % → 2.30 % after a few hundred frames.
   Traffic pose (frozen at whatever frame the clock was paused), window lights, the post-reset cloud phase and
   sim growth all still vary with the render-frame count, so "captures depend on (seed, tod, preset, settle)
   rather than session length" is not true in general — it holds only because every shipped tool warms up
   identically.

4. **Closeup seeds 2/23 are high, wide views of one-storey schools over parking plates** (eye 7.2 / 7.8 m above
   ground, camDist 30 m, fit 0.56). Sun-side and uncropped, but the "hero" is a small object in a large cyan
   plot; weaker than seed 1's hospital. Cosmetic, but a blind judge on another seed would see a toy map.

5. **Off lenses still read as coloured discs in direct sun** (crops `crop-signal-tight-day.png`,
   `crop-props-signal-12.png`): emissive is 0 and the base is 0.12×, yet the red/amber lenses stay legible
   under the 5° sun. Strictly correct; visually the day signal still looks "all three present".

## What works (verified, not restated from the builder)

- The seed-1 flagship set is real: closeup is sun-side and uncropped for all three seeds tested; the aerial
  contains 880 water cells (342 near/middle); the roads fallback is 1.7 m; the night closeup now reads
  (glowing cross, lit windows) instead of the earlier near-black hero; the street has no centre pole on seed 1.
- Signals: exactly one lit aspect at boot, after `setTime(21.5)`, and across 120 paused frames; the other two
  are emissive 0 and 0.12× base.
- Reproducibility on the tools' path is excellent: c1v reproduces c1fix at 0.0035 meanAbs and r35 reproduces
  r34 at 0.0067; capture JSONs carry `frame`.
- Perf is comfortable and better than the r30 baseline: r35 101.9 fps / 9.47 ms / 856 draws / 0 errors
  (r30: 72.0 / 13.34 / 844); atmosphere 22/22; props batch 143 fps / 6.66 ms / 198 draws / 0 errors.
- Folder boundary and the `Math.random` whitelist hold exactly as declared.

## What I did NOT verify

- Blind set 4 / judge appeal (not run).
- The exact root cause of the cold-first-capture delta: env-map regen, camera pose and the sky uniforms were
  ruled out, but I could not close it to one system (it tracks a lit-window/sunlit-pixel state change).
- Seeds other than 1/2/23; weather variants; the aerial water *identity* beyond projection + screenshot (I did
  not segment which water body dominates the 342 cells).
- The pre-fix-round source was not checked out (not permitted); the regression comparison uses the previous
  critic's own images from the same file paths.
- The builder's in-page lab metrics (coverage grids) — no scripts in the repo to reproduce.

## Evidence paths

- `shots/beauty/c1v/` (`summary.json`, `diff-vs-c1fix.json`, 5 hero PNGs) and `shots/beauty/c1fix/` (compare)
- `shots/game/r35/` (`summary.json`, `diff-vs-r34.json`, `diff-vs-r31.json`) vs `shots/game/r34`, `r31`
- `C:\Users\ryuen\AppData\Local\Temp\opencode\c1v\` — `closeup-seeds.json`, `aerial-water.json`,
  `street-signal.json`, `street-wall.mjs`, `lens.mjs`, `det\det.json`, `det2\det2.json`, `cold\`, `regen\`,
  `pose.mjs`, `world-evolve.mjs`, `frames\`, `iso\`, `det\diff-*.png`, `crop-signal-*.png`,
  `seed{1,2,23}-{closeup-17h7,street-12,street-21h5}.png`
- Pre-fix-round comparison: `C:\Users\ryuen\AppData\Local\Temp\opencode\c1c\seeds\seed{2,23}-street-21h5.png`
- `shots/atmosphere/b3/summary.json`, `shots/props/r3v/summary.json` + `crop-props-signal-{12,night}.png`
- This review.
