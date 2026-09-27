# simulation — builder report (round 4, Wave C2/F5 policies)

**What shipped:** the dead `policy` triple is now a real player-facing system. Six policies
(`src/simulation/policies.js`) each cost a flat `$/tick` upkeep and carry effect multipliers that the model folds
into one derived effect object per step; the Treasury modal gained a **Policies…** panel with on/off switches,
effect readouts and a running total; `getState()/loadState()` round-trip the active set. Effects, save/load and
determinism were verified with scripted probes; budgets and `errors: []` with three critic batches.

> The numbers below were produced by the same agent that wrote the code — evidence, not a pass. The independent
> critic re-measures the batches and the API contract and scores the round in
> `docs/reviews/simulation-r4-critic.md`.

## What was built

- **Catalogue (`src/simulation/policies.js`, new).** `POLICIES` — Free Transit (`upkeep 0.6`; transit happiness
  ×1.5, traffic ×0.75), Recycling Program (`0.8`; happiness +4 %), Smoke Detectors (`0.5`; fire ignition ×0.55),
  Neighborhood Watch (`0.7`; crime target ×0.8), Tourism Campaign (`1.2`; demand +0.35, income ×1.08, commercial
  demand +0.2), Industrial Incentives (`1.0`; industrial demand +0.25, industrial income ×0.9). `mergePolicyFx()`
  combines the base scenario knobs (showcase boom/bust) with every active policy; `*Mul` keys multiply, all others
  add. `policyEffectText()` is the shared UI label contract.
- **Model hooks (`model.js`).** `this.policies` (Set) + `this.basePolicy` + `policyFx` derived once per `step()`.
  Hook sites: fire ignition chance, crime target, traffic target, `hTarget` (transit term + happiness bonus),
  RCI pressures (demand bias all/commercial/industrial), income (all + industrial) and upkeep multipliers, plus a
  flat `budget.expenses.policies` line and `stats.policyUpkeep`. All effects are multipliers/additions — no rng.
- **API (`index.js`).** `setPolicy(id, on)` → `{ ok, reason?, active }` (unknown ids refused, idempotent),
  `getPolicy()` → `{ active, list: [{ id, label, desc, upkeep, effects, effectText, active }], upkeepPerTick,
  upkeepPerDay }`. `getState()` adds `policies: [ids]`; `loadState()` restores it (unknown ids skipped) and keeps
  honouring the legacy `policy` multiplier patch as base knobs for pre-C2 saves.
- **UI (`ui/index.js`, `ui/styles.js`).** Treasury modal shows a **Policy upkeep / day** row and a `Policies…`
  button; the policy modal lists all six with description, `$/day`, effect summary, switch, per-row state and a
  total that updates in place on toggle. Pure economy — nothing is gated (owner decision, roadmap §6.2).

## Verification (real numbers)

Batches (idle GPU, `nvidia-smi` 9–19 % / 11 W before each; one headless browser at a time):

| batch | command | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| simulation r4 | `node tools/critic.mjs --module simulation --round 4` | 125.3 | 5.53 | 103 | 0 |
| ui r4 (regression) | `node tools/critic.mjs --module ui --round 4` | 143.7 | 4.49 | 75 | 0 |
| game r11-idle | `node tools/critic.mjs --game --round 11 --dir shots/game/r11-idle` | 62.3 | 15.36 | 849 | 0 |
| game r11 (loaded first run) | `node tools/critic.mjs --game --round 11` | 39.6 | 15.61 | 849 | 0 |

The first game r11 run hit transient CPU contention (fps pattern uncorrelated with gpuMs: 42.9 fps at 8.0 ms,
106 fps at 8.6 ms on the same batch); the idle re-run is the clean record and matches B5's r10-idle
(minFps 60.9 → 62.3, maxGpuMs 15.50 → 15.36, calls 849 = 849). All three budgets pass on the idle run.

**A/B effect probe** (full game, paused, `simulation.api.reset()` before each run for a byte-identical start,
transit coverage 0.5, manual `tick(true)`; 3 000 ticks / 9 000 for fire; `shots/ui/c2/ab-runs.json`):

| policy | metric | control | policy | verdict |
|---|---|---|---|---|
| smoke_detectors | fires ignited (9 000 ticks) | 14 | 6 | −57 % |
| free_transit | traffic | 0.1271 | 0.0958 | −25 % |
| free_transit | happiness | 0.6493 | 0.6751 | +0.026 |
| recycling | happiness | 0.6493 | 0.6867 | +0.037 |
| neighborhood_watch | crime | 0.6471 | 0.5196 | −20 % |
| tourism_campaign | commercial demand | 0.264 | 0.866 | +0.60 |
| tourism_campaign | income/tick | 229.9 | 275.6 | +20 % |
| industrial_incentives | industrial demand | 0.412 | 0.662 | +0.25 |
| industrial_incentives | industrial yield/job | 0.01530 | 0.01377 | −10 % |
| all six | policy upkeep | 0 | 4.8/tick | = 0.6+0.8+0.5+0.7+1.2+1.0 |

**Determinism.** Pure-model check (Node, `citygen` 6×6 district + `SimModel`, no DOM/modules): two runs per set
are byte-identical for `[]`, `[free_transit]`, `[smoke_detectors, tourism_campaign]` and all six
(`stats` + `budget` + occupancy); seed 2 differs from seed 1 (pop 1 641 vs 1 382). Cross-boot browser check: two
fresh boots (seed 1) with `reset()` + two policies + 800 ticks → byte-identical stats/budget/policy/occupancy.
An earlier in-page determinism probe mismatched only because module event state (`sim:levelup` → buildings'
time-sliced growth) carried over between in-page runs; isolated fresh boots are identical.

**Save/load.** `getState().policies` → mutate → `loadState` restores the active set and its `1.1/tick` upkeep;
an unknown id (`future_policy`) is skipped, not fatal; a legacy `{ policy: {...} }` patch still loads as base
knobs. Scripted UI probe: modal lists 6 rows/6 switches, toggle flips row + state + running total
(`$0/day → $1,320/day`), `budget.perDay.expenses.policies` = 1 320, `getPolicy().upkeepPerDay` = 1 320.

**Screenshots** (`shots/ui/c2/`): `policy-modal-day.png` (two policies on, total $1,320/day),
`policy-modal-night.png` (21:30), `treasury-modal-night.png` (Policy upkeep / day row + `Policies…` button).

## Known gaps / honest caveats

1. The policy effects are invisible in the `simulation` showcase batch (it never toggles policies; the chart and
   panel are unchanged by design). The feature's visible surface is the UI modal, captured in `shots/ui/c2/`.
2. Tourism Campaign's effect line wraps to two lines in the 380 px modal at its current text length — cosmetic.
3. `trafficMul` multiplies the whole traffic target (free transit lowers traffic even at zero transit coverage),
   the simplest reading of the design table; if per-coverage scaling is wanted later, hook it into the transit
   term instead.
4. `simulation.reset()` (used by a new game) clears the active policy set; only save/load restores a set — by
   design, a fresh city starts with no policies.
