# terrain — round 5 critic review (integrator-led pass, exception to the r4 hard cap)

**Score: 7.4 / 10 — FAIL** (pass needs ≥ 8.5, `errors: []`, within perf budget)

This round is the approved §6.1 exception: after r4's hard-capped 7.3 FAIL, an integrator-led pass changed
`src/terrain/heightgen.js` `stepFor()` so plains/gentle rises step 0.8 m (two plates) instead of 0.4 m (plate) — i.e. the
plains risers, the module's #1 shadow-legibility suspect, got 2× taller. The environment A/B (near-cascade radius / bias)
was left uncommitted and is not in the working tree: `git status` shows only `src/terrain/heightgen.js` modified, and
`src/environment/index.js` still reads `shadowRadius: 1.5`, `normalBias = texel*1.3 + 0.012`. So the only live change this
round is the terrain step height. I verified that change, re-ran r4's four issues with my own captures (including a
controlled cast/receive shadow-toggle isolation that r4 did not have), and checked the new step size for regressions.

## Numbers (all fresh, this round)
| batch | shots | minFps | maxGpuMs | maxDrawCalls | maxTris | errors |
|---|---|---|---|---|---|---|
| `r5-critic` (default variant, 3 presets × 4 tods) | 12 | 143.2 | 4.62 | 58 | 2,727,118 | [] |
| `r5-critic-closeup` (closeup variant) | 12 | 142.9 | 4.13 | 58 | 2,727,118 | [] |
| `r5-critic-water` (water variant) | 12 | 143.0 | 6.08 | 54 | 2,129,262 | [] |
| `r5-critic-shadows` + `r5-critic-low` (my custom rim probes incl. toggle pairs) | 32 | 143.1 | 5.22 | 55 | 2,454,054 | [] |
| **bare terrain-only** `bare=1` (`r5-critic-shadows`) | 2 | — | — | **15 / 18** | **1,098,816 / 1,277,284** | [] |

- **Console errors: 0 across all 68 fresh captures** (36 critic + 32 custom probe/low-sun); `modules: {terrain:"ok", ...}`.
- **Budget: PASS.** Bare terrain: 15 calls (overview) / 18 (closeup) ≤ the 20-call terrain ceiling; the bare overview
  triangle count (1,098,816) is ~17 % *below* r4's 1,320,688 (fewer, taller steps merge into fewer plates; closeup
  1,277,284). Showcase batches max 58 calls including the environment backdrop, as expected. minFps 142.9, maxGpu
  6.08 ms — both far inside budget.
- **No regressions in the integrator's other batches** (re-read, not trusted): `game/waveB1` 54.5 fps / 10.49 ms / 860
  calls / errors 0; `roads/waveB1` 142.7 / 6.28 / 78 / 0; `buildings/waveB1` 143 / 6.62 / 299 / 0. I also eyeballed
  `game/waveB1/overview-6h5.png` and `street-12.png`: city sits on the terrain correctly, and buildings do cast legible
  dawn shadows on the ground at overview distance (the shadow system is healthy for *big external casters*).
- Hygiene unchanged: `src/terrain/` still exactly its six files, no `Math.random`, seeded `ctx.rng` only.
- Process nit: the `heightgen.js` change exists only in the working tree (uncommitted). If it is meant to ship, commit it.

## r4's four issues, re-checked one by one
| # | r4 issue | r5 evidence (mine) | verdict |
|---|---|---|---|
| 1 | **No legible cast shadow anywhere on terrain** | Toggle isolation, terrain `castShadow`/`receiveShadow` off vs on at a fixed camera 20 m from the real 2.8 m plateau rim, side-lit afternoon (`r5-critic-shadows/closerim-16h5-on.png` vs `-off.png`; `iso-castoff.png`, `iso-receiveoff.png`): cast-off mean \|Δ\| = 0.64/255 (2.3 % pixels >8), receive-off = 1.47/255 (4.6 %), and `r5-critic-zoom/diff-iso-castoff-zoom.png` shows only dotted stud-shadow rows + thin crest/acne lines — **no filled shadow band** from any riser onto its tread. Play-distance pair (`eastrim-play-16h5/-7.png`, 100 m+): visually identical, `diff-iso-*` mean ≤1.5/255. At 20 m the ON/OFF pair (`r5-critic-zoom/rim-on-af.png` vs `rim-off-af.png`, `rim-on-zoom.png` vs `rim-off-zoom.png`) is indistinguishable to the eye. | **NOT FIXED.** The 0.8 m steps raised riser height but the terrain still cannot show a *legible* self-shadow — only sub-threshold stud-shadow dots and edge acne. |
| 2 | **Overview / play-cam still flat, map-like** | `r5-critic/terrain_default-12.png`, `-18.png`, crop `r5-critic-zoom/overview-plains.png`: huge uniform plains with faint contour lines; plateau top resolves only as flat green colour patches. Play-distance `eastrim-play-7.png`: a vast stud plain with thin pipe-like lines. The 0.8 m steps added a faint topographic-contour texture — a small improvement — but no sculpted form. | **NOT FIXED** (marginally better contouring on plains). |
| 3 | **Diffuse NdotL real but too subtle at distance** | `closerim-7h-on.png` (riser faces lit, warm) vs `closerim-16h5-on.png` (dim), r4's east-wall test still valid. At normal play/overview distance it is not a legibility factor; the step change does not touch normals or shading. | **UNCHANGED** (real at close/oblique range only). |
| 4 | **Triangle cost buying baked shading** | bare 15–18 calls, 1.10–1.28 M tris vs r4's 18 / 1.32 M — within budget with more headroom. Still baked `riser()`/`treadAO` colour, not real shadow. | **PASS on budget**, unchanged in kind. |

### New checks for the 0.8 m steps (the round's actual question)
- **Banding/moiré:** none. `r5-critic-zoom/closeup-plain.png` is clean at 3 m; `overview-plains.png` shows only thin
  contour lines, no shimmer or z-fighting.
- **Misaligned plate groups:** none observed; chunk boundaries and the stud mask stay aligned in all batches.
- **Shore seams:** clean. `r5-critic-zoom/water-shore-tight.png` (×3) — sand plates step into the water with crisp
  edges, no gaps, no z-fighting; the waterline reads correctly under transparency.
- **New oddity:** at very oblique angles the longer 0.8 m risers foreshorten into thin bright/dark "pipe" bars lying on
  the grass (`r5-critic/terrain_closeup-12.png`, crop `noon-bands.png`; `eastrim-play-7.png`). Not broken, but it reads
  as trim/pipe geometry rather than a rock ledge at mid distance.

## Ranked remaining issues (most damaging first)
1. **No legible cast shadow from terrain onto terrain, now measured as sub-threshold.** With risers 2× taller the
   toggle still shows ≤1.5/255 mean change at 20 m; the module remains unable to give its own terraces a dropped shadow.
   Concrete next step: test the shadow-map side rather than the terrain side — pin the cascade containing the rim (or use
   a single fitted light) and check `shadow.bias`/`normalBias`/`radius` against a 0.8 m riser at ~20 m; r4's stud-shadow
   evidence says the CSM is otherwise healthy, so a near-cascade texel/normalBias mismatch is the leading suspect.
2. **Overview and play-camera compositions still read as a flat map** (`terrain_default-12/-18.png`,
   `overview-plains.png`). The player-facing consequence of #1. Taller plains steps alone do not fix it; consider
   stronger long-wavelength relief (not just fine noise) and/or letting riser shadows actually land.
3. **Diffuse NdotL remains close-range/oblique-only** (`closerim-7h` vs `-16h5`); do not count it as shadow progress.
4. **New "pipe bar" look of long 0.8 m risers at grazing angles** (`noon-bands.png`, `eastrim-play-7.png`); harmless but
   slightly toy-like at mid distance.
5. **Uncommitted working-tree change** — process only; no score impact, but anything shipped must be committed.

## What works well (reconfirmed)
- Zero errors across 68 fresh captures and three regression batches; determinism, hygiene, and the 20-call budget hold
  with triangle headroom improved (~17 % fewer than r4).
- Water: `r5-critic-water` all presets clean at day/dusk/night — islands, stepped beaches, transparent depth, no seams.
- The city integration is intact: buildings cast clearly legible shadows onto terrain at overview distance
  (`game/waveB1/overview-6h5.png`), so the failing point is specifically terrain's self-shadowing, not the CSM system.

**Verdict:** the step-height change is real, is in the right suspect area, causes no regressions and slightly improves
plains contouring and budget — but it does not produce the legible cast shadow or the sculpted overview that r4 failed
the module on. Score moves 7.3 → 7.4 (small credit for the only real movement in two rounds); still comfortably FAIL.
