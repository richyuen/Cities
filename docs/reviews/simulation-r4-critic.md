# simulation — critic review, round 4 (Wave C2 / F5 policies)

**Score: 8.6 / 10 — PASS** (pass needs ≥ 8.5). Errors: 0 across every batch. Perf inside budget.

This round turns the dead `policy` triple into a real player system (six catalogue policies, hook sites in the model,
Set-based API, save/load, Treasury→Policies modal). I re-ran the module batch myself, ran my own full-game batch,
and drove the public API in fresh headless sessions to reproduce the A/B, determinism, save/load and the UI wiring
rather than trusting the builder's numbers. Everything functional checks out; the score is held below the previous
round's 8.8 by one real design-contract deviation in Free Transit's traffic hook and two smaller nits (wrap, no
toggle-transition evidence).

## Independent runs (this critique)

| run | command | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| simulation r4 (mine) | `node tools/critic.mjs --module simulation --round 4 --dir shots/simulation/r4-critic` | 143.4 | 5.34 | 103 | [] |
| game r11 (mine) | `node tools/critic.mjs --game --round 11 --dir shots/game/r11-critic` | 12.6* | 15.61 | 849 | [] |
| game first shot re-captured standalone | `node tools/shot.mjs --preset overview --tod 6.5 --out …overview-6h5-rerun.png` | 121.8 | 7.6 | 746 | [] |
| builder simulation r4 (JSON re-checked) | `shots/simulation/r4/` | 125.3 | 5.53 | 103 | [] |
| builder ui r4 regression (JSON re-checked) | `shots/ui/r4/` | 143.7 | 4.49 | 75 | [] |
| builder game r11-idle (20 shots, JSON re-checked) | `shots/game/r11-idle/` | 62.3 | 15.36 | 849 | [] |
| builder game r11 loaded first run (JSON re-checked) | `shots/game/r11/` | 39.6 | 15.61 | 849 | [] |

\* my game batch's **first** shot came back at 12.6 fps with gpuMs **7.49 ms** — a cold-start CPU stall in the
batch's first capture (shader/first-cascade/traffic warm-up), not a GPU cost: the identical standalone re-capture
is 121.8 fps @ 7.6 ms and all 19 later shots in the same batch are 60.9–119.3 fps. The builder's loaded r11 run shows
the same decoupling (39.6 fps @ 11.63 ms where the idle run does 79.8 fps @ 11.88 ms on that shot; 42.9 fps @ 8.03 ms
on aerial-6h5 vs 119.5 fps @ 7.78 ms idle). Per ARCHITECTURE §7, gpuMs is the truth: **max 15.61 ms ≤ 20 ms**, and
**849 draw calls ≤ 1500**. The idle game batch is the clean record; the loaded run's fps floor is CPU contention.

`moduleErrors` is `{}` and `errors` is `[]` in all four summary JSONs; every per-shot JSON I inspected has
`errors: 0`. No `Math.random` anywhere in `src/simulation/` (grep). Visually I checked 11 batch PNGs across the three
batches plus all four C2-surface shots; the diff is model + UI only, and no world-render regression is visible
(skyline/street/night/module showcase all unchanged).

## A/B effects — my probe vs the report

Headless Chrome, seed 1, `simulation.api.reset()` + `setTransitCoverage(0.5)` before each run, clock paused,
registry frozen, fire/burglary state wiped between runs, manual `tick(true)` (3000 ticks, 9000 for fires).

| policy | metric | control | policy | verdict | report |
|---|---|---|---|---|---|
| smoke_detectors | fires ignited / 9000 ticks | 14 | 6 | −57 % | 14 → 6 ✓ exact |
| free_transit | traffic | 0.12714 | 0.09581 | −24.6 % (0.75×) | −25 % ✓ |
| free_transit | happiness | 0.64928 | 0.67508 | +0.0258 | +0.026 ✓ |
| recycling | happiness | 0.64928 | 0.68666 | +0.0374 | +0.037 ✓ |
| neighborhood_watch | crime | 0.64709 | 0.51959 | −19.7 % | −20 % ✓ |
| tourism_campaign | commercial demand | 0.26428 | 0.86590 | +0.602 | +0.60 ✓ |
| tourism_campaign | income/tick | 229.92 | 275.59 | +19.9 % | +20 % ✓ |
| industrial_incentives | industrial demand | 0.41210 | 0.66210 | +0.250 | +0.25 ✓ |
| industrial_incentives | industrial income/job | 0.015300 | 0.013770 | −10.0 % | −10 % ✓ |
| all six | policy upkeep | 0 | 4.8/tick ($5,760/day) | exact sum | 4.8 ✓ |

My control and 9000-tick control numbers match the builder's to the last digit (0.6492750736693316,
0.6491729391189018); their policy runs differ from mine only at ~1e-12, consistent with their in-page runs carrying
a little fire/damage state between runs while mine wipe it. The claimed directions and magnitudes are reproduced.

**Code read-out of the six hook sites** (all as documented in `policies.js`): `fireIgnitionMul` into the per-building
ignition threshold; `crimeTargetMul` into the clamped crime target; `transitHappinessMul` into the `0.09*transit`
happiness term; `happinessBonus` into `hTarget`; `demandBias`/`commercialDemandBias`/`industrialDemandBias` into
pR/pC/pI; `incomeMul`/`industrialIncomeMul` into incR/incC/incI; flat `upkeep` summed into
`budget.expenses.policies` and `stats.policyUpkeep`. `policyFx` is derived once per `step()` and every key is
multiplier/addition only — no rng.

## Determinism, save/load, API

- **Determinism — independently reproduced.** Same boot, control and free_transit repeated after another reset:
  `stats` + budget byte-identical. Cross-boot (second fresh Chrome, same seed): control and free_transit stats and
  per-tick budget also byte-identical to boot 1.
- **Save/load — independently reproduced.** `getState()` now has keys
  `[policy, policies, taxRate, transitUpkeep, stats, occupancy, milestones]`; enable free_transit+recycling, save,
  disable both, load → active set restored and `upkeepPerTick` 1.4 ($1,680/day); `{policies:['free_transit','future_policy']}`
  → only `free_transit` survives; unknown-only → `[]`; legacy `{policy:{incomeMul:2,...}}` is honoured as base knobs
  (next-tick income exactly 2.000× the fresh-reset baseline).
- **API contract — matches the design doc.** `setPolicy(id,on)` → `{ok, reason?, active}`; unknown id →
  `{ok:false, reason:"unknown policy 'ghost_policy'", active:[]}`; enable/disable are idempotent. `getPolicy()` →
  `{active, list, upkeepPerTick, upkeepPerDay}` with rows `{id,label,desc,upkeep,effects,effectText,active}` in
  stable catalogue order; `upkeepPerDay = upkeepPerTick × dayLengthSec/TICK_DT` (1200) and equals
  `budget.perDay.expenses.policies` after a tick. No stale consumers of the old patch-object form exist
  (`src/` grep: UI is the only caller), and `menu/serialize.js` saves/loads `simulation.getState()/loadState()`, so
  the policy set rides the real save path.
- **UI wiring — verified in the live DOM.** Treasury modal shows `Policy upkeep / day` and the `Policies…` button;
  the policy modal has 6 rows/6 switches with $/day and effect text; fresh reset + all six switches ON →
  total `$5,760 / day`, `getPolicy().upkeepPerDay` 5,760, after one tick `budget.perDay.expenses.policies` 5,760
  and `stats.policyUpkeep` 4.8/tick; the reopened Treasury modal shows `Policy upkeep / day $5,760`. Visuals
  (`shots/ui/c2/policy-modal-day.png`, `policy-modal-night.png`, `treasury-modal-night.png`) are consistent:
  2 policies on = $1,320/day, night contrast good, switch affordance clear.

## Ranked issues (most damaging first)

1. **Free Transit's `trafficMul` multiplies the entire traffic target, not the transit reduction the design names
   (`policies.md` §2.2).** `src/simulation/model.js:522` computes
   `… * (1 - 0.3*transit) * fx.trafficMul`, so free rides cut traffic ~25 % even when `transitCoverage` is 0 — my
   A/B at coverage 0.5 reproduces the full ×0.75 (0.12714 → 0.09581). Why it hurts: the policy's payoff is
   disconnected from actually running buses, so the "traffic ×0.75" label acts as a blanket congestion cheat; the
   round's contract explicitly places this knob inside the transit term. The builder disclosed it (report gap #3),
   so it is a contract deviation, not a hidden bug. Fix: apply it to the transit factor,
   `(1 - 0.3 * transit * fx.trafficMul)` (≈−11 % at coverage 0.5), or state the whole-target reading in the design
   and gate the effect on transit coverage.
2. **Tourism Campaign's effect line wraps to two lines and the orphaned fragment right-aligns under the first line**
   (`shots/ui/c2/policy-modal-day.png`, `policy-modal-night.png`; my `shots/ui/c2-critic/policy-modal-all-on.png`).
   "Demand +0.35 · Income ×1.08 · Commercial" / "demand +0.2" makes that row taller than the other five and reads
   like a stray label. Why it hurts: it is the only visible defect on the feature's main surface and the row is the
   densest content in the modal. Fix: shorten the label ("Comm. demand +0.2") or let `.lc-pol-fx` wrap left-aligned
   (`text-align:left; flex:1 1 auto`) / stack cost and effect text.
3. **No toggle-transition capture, and policies never appear in the simulation batch.**
   `policies.md` §2.5.5 asks for "screenshots of the policy modal (day + night), a toggle transition, and the
   Treasury line". Day, night and the Treasury line exist, but both modal PNGs show the same state (free transit +
   smoke detectors ON, $1,320/day) — there is no before/after pair, and `shots/simulation/r4/` (mine and the
   builder's) is unchanged by the feature. Why it hurts: a break in the switch→state→budget wiring would leave every
   artifact looking the same; only my DOM probe would catch it (it passes today). Fix: capture one pre-toggle and one
   post-toggle shot, or add a policy variant to the simulation showcase next round.
4. **Stale crime-floor comment.** `src/simulation/model.js:529` still says the crime target is "never below the
   CRIME_BASE floor", but Neighborhood Watch multiplies the already-floored target by 0.8 (line 536), so a hamlet
   with the policy sits under 0.05 by design. Trivial doc drift; fix the comment ("floor before the policy
   multiplier") or move the multiplier inside the clamp.

## What already works

- **All six policies do what the table says, verifiably.** Directions, magnitudes, upkeep sum and per-day conversion
  reproduce the report; the model read-out matches `policies.js` site-by-site; no rng path was introduced.
- **Determinism and save/load are exact.** Same seed → byte-identical stats/budget within and across boots; the
  active set round-trips through `getState()/loadState()`, unknown ids are skipped, legacy `policy` patches still
  work, and the menu's serializer uses the same call path.
- **The UI is coherent with the rest of the HUD.** Six rows with descriptions, $/day, effect text, real switches,
  green ON-state, running total, and a Treasury row + entry button; no errors, no layout overflow at six policies
  on, and the numbers I read from the DOM match the budget/model exactly.

## Verdict

Functional acceptance is met and independently reproduced: six real policies, correct A/B deltas, exact
determinism, clean save/load, coherent UI, zero console errors, comfortable perf headroom (5.34 ms module /
15.61 ms full city worst case, 849 calls). The deductions are the `trafficMul` hook-site deviation from the design
contract plus two cosmetic/evidence nits. **Pass at 8.6** — AAA-with-nits, marginally below round 3's 8.8 which
carried no contract deviation.
