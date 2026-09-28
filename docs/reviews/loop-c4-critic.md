# LOOP cycle 4 — independent critic review (environment low-sun disc discipline + effects capture-mode tilt-shift)

**Reviewer:** fresh critic subagent (no code rights; the only file written is this one). **Date:** 2026-09-28.
**Tree reviewed:** uncommitted cycle-4 changes on `e26987f` — `src/environment/{skyMath,sky,index}.js`, `src/effects/{index,tiltShift}.js` (+ approved `tools/check-dof.mjs`). `tools/shot-list.mjs` (orchestrator) and `docs/LOOP.md` changes are outside this review. `shots/**` is gitignored, so every capture below is evidence, not a repo edit.

## Verdict

**Score: 8 / 10 — PASS** (all hard gates green and every builder claim I could falsify held; the deduction is for judge-readiness: the hero's avenue specular column still clips ~2888 px and the DOF pass is not yet wired into the standard hero capture, so the cycle-4 look is not yet what the next blind set will see).

Nothing in the two builder reports was contradicted by my own runs. The two places where the reproduction brief's expectation did **not** hold (batch-level 0.000 diffs vs `r46`; a stable effects-showcase gpuMs) are test-design/framing issues explained below, not builder errors.

## 1. Reproduction (my own runs)

| command | claimed | my result |
|---|---|---|
| `node tools/check-dof.mjs --out shots/effects/r4v/check` | 41/41 | **41/41**, `captureErrors 0` → `shots/effects/r4v/check/summary.json` (17 captures + summary) |
| `node tools/check-atmosphere.mjs` | 22/22 | **22/22** → `shots/atmosphere/b3/summary.json` |
| `node tools/check-beauty.mjs --out shots/beauty/c4v` | 37/37 | **37/37** → `shots/beauty/c4v/summary.json` |
| `node tools/critic.mjs --module effects --round 5 --dir shots/effects/r5v` | budget | 16 shots, errors 0, minFps 143.2, maxGpuMs **6.71**, maxDrawCalls 76, budget all true |
| `node tools/critic.mjs --module environment --round 10 --dir shots/environment/r10v` | budget | 12 shots, errors 0, minFps 143.2, maxGpuMs **5.37**, maxDrawCalls 53, budget all true |
| `node tools/critic.mjs --game --round 49 --dir shots/game/r49` | ≤20 ms / ≤1500 / errors 0 | 20 shots, errors 0, minFps 93.3, maxGpuMs **10.34**, maxDrawCalls **934**, budget all true |
| `node tools/diff.mjs --a shots/game/r47 --b shots/game/r48` | meanAbs 0.204 | **0.2037**; skyline-18 1.4973, closeup-18 0.9786, street-18 0.5635, overview-18 0.3821; every other file ≤ 0.1287 |
| `node tools/diff.mjs --a shots/game/r48 --b shots/game/r49` | drift-level | **0.0205**; worst overview-21h5 0.0736 (pure cross-session drift, same code) |
| `node tools/diff.mjs --a shots/game/r46 --b shots/game/r49` (mine) | — | 0.1861; the only files > 0.11 are the five 18h shots (intended low-sun change: skyline-18 1.5056, closeup-18 0.9778, street-18 0.5536, overview-18 0.3389, aerial-18 0.1062); **all 6.5/12/21.5 shots ≤ 0.0616** |
| `node tools/diff.mjs --a shots/beauty/c3c --b shots/beauty/c4v` (mine) | 01 ≈ 0.9, 04 ≈ 0.28 | 01-skyline-golden **0.9045**, 04-closeup-golden **0.2783**, 02/03/05 ≤ 0.0063 |
| warnings/errors scan of all 69 JSONs in the four new dirs | warnings 0 | **0 warnings, 0 errors** |

Extra controls I measured (not in the builder reports):

| control | number |
|---|---|
| effects fixed post overhead (full game, `?post=0` 794 draws → composer 814) | **20 draws** (≤ 25 budget); `+?dof=0.55` → 815 (**+1**) |
| game gpuMs DOF on/off repeats (frozen), street@21.5 | off 10.24/10.10/10.08 vs on 10.09/10.14 → Δ within noise, +1 draw every toggle |
| skyline@17.7 | off 9.21/9.14/9.17 vs on 9.27/9.15; closeup@17.7 off 9.03/9.04/8.66 vs on 9.11/8.77 |
| white stats r47 vs r48 `skyline-18.png` | clip 90 → 87, near240 4851 → 4387 (**−9.6 %**, claim verified) |
| white stats my check run, sunset 17.7, discipline on/off | clip **2888 vs 4134** (−30.1 %), near240 **11345 vs 15442** (−26.5 %) |

## 2. Falsification

| # | what I did | what I saw | verdict |
|---|---|---|---|
| **a. DOF off = no-op** | fresh-boot game (seed 1, skyline, tod 17.7, frozen) no-flag vs `?dof=0`; `?dof` bare / `5` / `-3` / `abc`; `getPasses()` + `getComposer().passes`; `?post=0` scene control | no-flag vs `?dof=0` **byte-identical** (`meanAbs 0 / pctOver2 0 / maxDelta 0`); bare → 0.55 + pass built; `5` → 1; `-3`/`abc` → 0/off; composer is exactly `RenderPass,GTAOPass,ShaderPass,UnrealBloomPass,OutputPass,SMAAPass` when off and `…,OutputPass,ShaderPass,SMAAPass` when on; **no DOF pass object exists when off** (not constructed — no ShaderPass, no material, no uniform); +1 draw only when on (869→870) | **survives.** The brief's "no-flag vs `r46` = 0.000" holds only for frozen same-staging frames; a live-staged batch diff cannot be 0 (my r48→r49 identical-code drift is 0.0205 mean / 0.0736 worst). `r46→r49` shows the intended low-sun change confined to 18h, everything else at drift level |
| **b. DOF on ≠ off / quality** | frozen skyline 17.7 at dof 0 / 0.35 / 0.55 / 1; meanAbs, band gradient energies (top 0–12 %, focus 40–60 %, bottom 88–100 %); 1:1 crops, 4× zooms, sunset-column crop | meanAbs 1.3968 / 2.6438 / 6.2041; focus band 0.992 / 0.982 / 0.958 **×**; bottom 0.720 / 0.547 / 0.320 **×**; top (sky) 0.970 / 0.914 / 0.767; focus-band meanAbs 0.062 at 0.55; visually: sharp band, smooth monotone falloff, no ghosting, no banding/dither structure at 4× (strength 1, 18 px blur), highlighted column edges clean | **survives** |
| **c. night/noon invariance + disc isolation** | frozen same-session on/off toggles at 12 / 18.5 / 21.5 / 17.7; `?sunbloom=0` URL boot vs toggle; same-session clip control; Node diff of working vs `HEAD:skyMath.js` over e=−50…90 step 0.25 × 3 weathers (1683 cases); strict disc equality for e∈[16,90] step 0.01 | noon (e=62°): diff **0.000/0**; night (e=−49.19°): **0.000/0**; dusk 18.5 (e=−8.09°): **0.000/0**; cross-session frozen flag pair: meanAbs 0, maxDelta 1 (single-channel ±1 pixels); sunset 17.7: diff 0.8833 with clip 2888 vs 4134; factor measured 0.8563 @ e=4.864, 0.0000 @ e=62 / −8.09 / −49.19; environment: **0 unexpected non-disc field changes in 1683 cases**, disc exact no-op for all e ≥ 16° (max abs Δ = 0, `sunDiscLow` max 0), disc table matches the report (5.537/2.951/1.178 @ 4.864°; 2.10/0.75/0.18 @ 0°; raw above 16°), ramp C1-continuous | **survives.** Note: 6.3h dawn has the *same* elevation as 17.7h (4.864°) so the factor is symmetric there by construction; the moon is untouched because the factor is exactly 0 below −1.5° and the night frames are bit-identical |
| **d. chain order / AA** | composer pass list; night street 21.5 dof on/off crops (lane markings, studs, guardrail, storefront/window emissives, street lamps); sunset column crop at 0.55 | Output → TiltShift → SMAA confirmed in the pass list; focus band keeps SMAA; night thin markings and studs stay legible with clean softening (no double edges/ghosting); emissive window/street-lamp glow present and not doubled; blown column blurs smoothly, no ringing | **survives** |
| **e. budgets + residuals** | module/game critic batches; game DOF off/on repeats at the heaviest presets; effects fixed-overhead measurement; residual checks | game max 10.34 ms / 934 draws / 0 errors; DOF ΔgpuMs ≤ ~0.1 ms at street@21.5 (10.1 both) with +1 draw; effects post = 20 draws (+1 DOF) ≤ 25; residual column clip **2888 px reproduced** (matches "~2880"); the showcase gpuMs step: **reproduced with no DOF pass ever constructed** (builder `shots/effects/r4/summary.json` steps 4.11→6.73 at the four 21.5 captures; my `r5v` steps mid-batch 4.67→6.61 and never returns), reproduced after a DOF construction in one session (3.9–4.4 → 6.6–6.8), but absent in a DOF-constructed-first session and in two 20-/40-sample no-DOF traces (stable 3.8–4.7 / 4.0–4.7) | **budgets survive.** The step is real but **not a DOF cost** — it occurs in batches that never construct the pass. `gpuMs` remains within budget everywhere |
| **f. determinism** | two identical frozen dof-on captures (game + showcase), byte compare; grep for `Math.random`/`Date.now`/`performance.now` in the five cycle files | both pairs **byte-equal** (`bytesEqual true`, 0/0/0); no `Math.random` (only comments referring to three's internal use); the shader noise is a pure function of `gl_FragCoord` | **survives** |

## 3. Ranked issues (most damaging first)

1. **The hero's avenue specular column still clips white — 2888 px (0.139 %) at tod 17.7, the exact frame the set-5 judges called "huge bloom flare"/"blown out".** Where: `shots/beauty/c4v/01-skyline-golden.png`, `shots/effects/r4v/check/game-sunset-off.png`; the discipline removed the disc blowout and ~30 % of the column, but a ~2900-px white column remains and is now the frame's only blown region. Why it hurts: the blind judges judge the whole frame; a white streak down the avenue still reads "blown out" next to the reference. Fix: the lever is the road/sun specular (roads or environment roughness/normal/glint clamp) or the day bloom threshold (`BLOOM_THRESHOLD_DAY` 1.6 → ~1.75); if kept deliberately, it must be re-judged rather than assumed fixed.

2. **DOF is not wired into the judged hero path.** Where: `tools/check-beauty.mjs` passes no `?dof`, so `shots/beauty/c4v` (my run) and the builder's `shots/beauty/c4dof` are DOF-free; only `tools/shot-list.mjs --dof` can produce the diorama look. Why it hurts: set-5 accounting named DOF as *the* remaining difference; a cycle-4 hero set captured with the standard beauty path ships no DOF, so the lever reaches no judge. Fix (orchestrator): generate the cycle-4 hero set with `--dof 0.55` (or per-shot strengths) and record it.

3. **The tilt-shift focus is a fixed screen line with no subject awareness (`focusY` 0.5, `focusRadius` 0.14).** Where: `src/effects/tiltShift.js`; at 0.55 the top band is 0.914× and the bottom 0.547×, so wide heroes (`overview` 0.51× bottom / 0.98× centre; `aerial` 0.55/1.00) blur distant city and terrain. Why it hurts: the wide shots were already losing on "flat/hazy/tiny indistinct buildings"; a screen-row blur can amplify that if the subject reaches the top band. Fix: per-shot `?dofy` in the hero list, or bind focusY to the composition subject's projected screen Y; consider less top-band blur on skyline/overview.

4. **The effects-showcase gpuMs step (+~2.3 ms, session-dependent) is still unexplained and is a trap for future pass-cost claims.** Where: `shots/effects/r4/summary.json` (step at the four 21.5 captures), `shots/effects/r5v/summary.json` (step mid-batch at `effects_tower-12`, 4.67→6.61, never returns); my traces in `C:\Users\ryuen\AppData\Local\Temp\opencode\c4v\perfstep.mjs`, `stepC.mjs`, `stepD.mjs`. Why: it is reproducible with **no DOF pass ever constructed**, so it is not DOF cost — but the builder's residual frames it around the DOF construction, and anyone re-measuring the pass on this showcase can double-count it. Fix: use the game steady A/B for pass cost (≤0.1 ms measured); add a one-line caveat to the cycle record; investigating the page-side cause is optional.

5. **Screen-space blur clamps at the frame border** (no outside samples; horizontal bow weighted 0.5 widens side blur). Where: `src/effects/tiltShift.js:53,66`. Why it hurts: mild edge softening/streak on wide shots at strength 1; I did not observe an actual artifact in the crops, so this is a nit. Fix: optional mirrored UV sampling or a slightly lower horizontal weight.

6. **The low-sun factor ramps up from −1.5°, so civil-twilight frames (e ≈ −0.5°) get up to a 15 % whole-frame bloom reduction, which would dim a visible moon glow.** Where: `src/effects/index.js` `lowSunFactor` (lower `smoothstep(-1.5, 0.5)`). Why it hurts: the moon is the night identity; at exactly this elevation the sun is below the horizon. I measured 0.000 diffs at −8° and night, so no current regression; it is a boundary nit. Fix: start the ramp at ≈ −1° if the moon is ever staged at civil twilight.

7. **Flags/API/chain are undocumented outside code comments and the two builder reports.** Where: `ARCHITECTURE.md` §7 (post list still `SMAA, GTAO, bloom, vignette`); `?dof`/`?dofy`/`?sunbloom`, `api.setDOF/getDOF/setSunBloom/getSunBloom`, `OutputPass→TiltShift→SMAA` are invisible to the next agent. Fix: one paragraph by the integrator (both builders flagged this as owner scope; not a builder breach).

Minor note, not an issue: `tools/check-dof.mjs` was written by the effects builder although LOOP gives `tools/` to the orchestrator; the report says it was approved, and it is genuinely useful and green. The orchestrator should record that approval in the cycle log.

## 4. What works

- **DOF off is a genuine byte-level no-op** (fresh boots identical; pass not constructed; composer pass list unchanged; `?post=0` scene draws unaffected) and **DOF on is exactly +1 draw** with no measurable gpuMs cost in the game (±0.1 ms at the heaviest preset).
- **The low-sun discipline is exact where it must be**: frozen on/off frames at noon, dusk and night are 0.000/0 across sessions, the factor is a pure monotone function of elevation with the arithmetic `strength_on = strength_off × (1−0.6·factor)` exact, and the sunset control shows a real −30 % clip / −27 % near-white reduction.
- **The environment change is surgically isolated**: 0 non-disc field changes across 1683 elevation×weather cases, exact disc no-op at/above 16°, the disc table matches the report, PMREM/IBL is untouched by construction (`uShowSun=0` during `regenEnv`) and draw calls/gpuMs are unchanged.
- **Determinism and budgets**: two frozen DOF-on captures are byte-equal in the game and the showcase; no `Math.random`; the game r49 batch is 10.34 ms / 934 draws / 0 errors / 0 warnings, effects post overhead measured at 20 draws (+1 DOF) against a 25 budget.

## 5. What I did NOT verify

- **No blind-judge re-run** and no assessment of how the c4 hero set would score; I did not build pairs or audit a set (E4/E5 are the orchestrator's).
- **No pre/post stash A/B of the environment code** (I cannot edit source); the night "bit-identical" claim is verified structurally (exact no-op math, `uShowSun=0`, frozen on/off frames) rather than by a stashed-code byte comparison.
- **No live/animated subject through DOF** (all my captures are frozen); temporal ghosting is not applicable to a stateless single-frame blur, but I did not measure a moving car through it.
- **No resolution/resize test with DOF on** (only 1920×1080; the `applySizes` resize path is code-read only).
- **No weather variants rendered at low sun** (the Node grid covered cloud/rain/fog, but no rainy sunset capture).
- **`?dofy` is verified only by state reads** (`focusY 0.3`), not by a visual focus-line capture.
- **`setBloom` override + discipline interplay** is verified only by the documented code path and check-dof's arithmetic, not by an override A/B.
- **Not every PNG inspected** — I looked at the 17.7 pair, 3× sun crops, r47/r48 skyline-18, r49 street-21h5, environment sky-18, the 1:1/4× DOF crops, the night thin-edge crops and the two golden heroes; the remaining captures were checked via summary/diff metrics only.
- **The showcase gpuMs step's root cause** — I bounded it to "not DOF, session-dependent" but did not find the trigger.

## 6. Evidence paths

- Reproduction: `shots/effects/r4v/check/summary.json` (+ `game-sunset-*`, `noon-*`, `night-*` PNGs), `shots/atmosphere/b3/summary.json`, `shots/beauty/c4v/summary.json`, `shots/effects/r5v/summary.json`, `shots/environment/r10v/summary.json`, `shots/game/r49/summary.json`.
- Diffs: `shots/game/r47-r48-diff.json`, `shots/game/r48-r49-diff.json`, `shots/game/r46-r49-diff.json`, `shots/beauty/c3c-c4v-diff.json`.
- My scratch probes/crops: `C:\Users\ryuen\AppData\Local\Temp\opencode\c4v\` (`dofprobe.mjs`, `sunchain.mjs`, `perfstep.mjs`, `stepC.mjs`, `stepD.mjs`, `det.mjs`, `skyiso.mjs`, `skystrict.mjs`, `overhead.mjs`, `zoom.mjs`; crops under `dof\`, `sun\`, `det\`).
- Builder reports: `docs/reviews/loop-c4-env.md`, `docs/reviews/loop-c4-effects.md`; blind context: `docs/judge-set5-verdicts.md`.
