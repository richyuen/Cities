# ui — critic review, round 4 (Wave C3 / F6 statistics modal)

**Score: 8.9 / 10 — PASS** (pass needs ≥ 8.5). `errors: []` across every batch and every probe (one headless
browser at a time, `nvidia-smi` checked first). Budgets clear. The feature is a clean, additive surface: the model's existing ≤ 300-tick
ring is charted honestly, the entry point is one click from the HUD and hidden when `simulation` is absent, the
chart is correct while paused and refreshes once per `sim:tick`, and every teardown path (close, Escape,
replacement, `Hud.dispose`) releases its subscription. I found no functional or visual defect in C3 itself; the
score **holds** r3's 8.9 because the round adds a small feature without clearing the module's outstanding
cosmetic nits (r3 issues 1–2 unchanged) and carries two minor nits of its own (below). It does not fall, because
nothing regressed.

## Independent runs (this critique)

| run | command | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| functional check (mine) | `node tools/check-stats.mjs` | — | — | — | `[]` (21/21 checks) |
| ui r4 module (mine) | `node tools/critic.mjs --module ui --round 4 --dir shots/ui/r4-critic` | 143.2 | 4.34 | 75 | `[]` |
| game r12 (mine) | `node tools/critic.mjs --game --round 12 --dir shots/game/r12-critic` | 60.0 | 16.29 | 849 | `[]` |
| my probe A (full game, interaction) | `c3-probe.mjs` (temp) | — | — | — | 55/55 checks |
| my probe B (cross-boot determinism) | `c3-probe.mjs` | — | — | — | history byte-identical |
| my probe C (ui-showcase negative) | `c3-probe.mjs` | — | — | — | hidden + 0 errors |
| edge probe (pure renderer + hidden path) | `c3-edge.mjs` (temp) | — | — | — | 9/9 |
| running-clock probe | `c3-run.mjs` (temp) | ~117.9 fps wall | — | — | 6/6 |
| builder ui r4 JSON re-checked | `shots/ui/c3-module/summary.json` | 143.0 | 4.43 | 75 | `[]` |
| builder game r12 JSON re-checked | `shots/game/c3-r12/summary.json` | 61.5 | 15.48 | 849 | `[]` |
| builder functional JSON re-checked | `shots/ui/c3/check.json` | — | — | — | 21/21, `failed: 0` |

`nvidia-smi` was checked before every batch (desktop idle: 12–27 % util, 10–11 W, P8; no concurrent 3D app) and
only one headless browser ran at a time. `gpuMs` is the truth: worst full-city 16.29 ms ≤ 20 (builder 15.48 ms;
the +0.81 ms is run-to-run desktop noise, no C3 code is on the batch's path — the modal is closed). Draw calls
849 ≤ 1500, minFps 60.0 ≥ 50. My module batch (143.2 / 4.34 / 75) matches the builder's (143.0 / 4.43 / 75)
and C2's ui regression (143.7 / 4.49 / 75) within noise: **no regression**.

## Functional check — run and read

`node tools/check-stats.mjs` reproduced **21/21** with the same numbers as the builder's `check.json`
(seed 1, clock paused, 10 manual ticks): population 12,753, jobs 5,009, net $66,502/day, happiness 66 %,
traffic 12 %, demand 18·17·31 %, label `last 300 ticks · ~2:30 of city time`, canvas painted 8,207/74,992 px,
Esc closes, 0 errors. I read the script line by line; the assertions are honest — the two soft ones
(`painted > 2000` and `dataURL differs`) are exactly the claims I re-tested at pixel level below, and the chip
comparison is against the same formatting rules the modal uses, so the risk it covers (stale/fake values) is
real. Neither soft spot failed independent scrutiny.

## Contract check (design `statistics-modal.md` §2–4)

| intent | result | evidence |
|---|---|---|
| six series from the existing ≤ 300-tick history, no new simulation data | **met** | `git diff --stat` touches only `src/ui/*` (+ new `statsChart.js`); `getHistory()/getStats()/getBudget()` only; no `simulation` file changed |
| entry point one click from the HUD | **met** | fifth row in the stat plate; `.click()` opens; `shots/ui/c3/hud-closed.png`, `modal-day.png` |
| chart correct while paused (drawn once on open) | **met** | canvas identical across 30 frames with no tick; one explicit tick redraws exactly once (`clearRect` delta 1) |
| redraws on `sim:tick` | **met** | explicit tick and running-clock leg both change the canvas; one redraw per tick, not two |
| Esc closes | **met** | Esc closes; first Esc with settings popover also open closes only the modal, second closes settings; `onKey` carve-out for a focused input is documented |
| hidden when simulation absent (ui showcase) | **met** | `shots/ui/r4-critic/ui_default-12.png` has no Statistics row; probe: `hidden`, `offsetParent === null`, module list has no `simulation` |
| series selection parameter | **met** | only-Population canvas has 280 green px / 0 other series; only-Traffic 197 red / 0 others; only-Demand R+C+I colours present |
| live values + window label | **met** | all six chip values matched an independently written formatter (regex thousands separators); label = `last N ticks · ~M:SS` re-derived from `getHistory().length / ticksPerSecond`; `history[last].net × 1200 === budget.perDay.net` exactly (66,502.3850310274) |
| chart draws today's values | **met (pixel-level)** | for all 8 lines (pop/jobs/net/happiness/traffic/R/C/I) the expected right-edge point computed from `getHistory()` + budget had a matching-colour pixel within 0 RGB distance at the computed y (`d=0` for all 8) |
| deterministic with the seed | **met** | two fresh boots, same sequence: `JSON.stringify(getHistory())` byte-identical, pop 12,753 / jobs 5,009 identical; `grep Math.random src/ui` → none |

## Edge cases I added (not in the builder's list)

- **All chips off** → axes-only canvas (673 px vs 8,207 full), no series colours, no crash; toggling back on
  restores a **byte-identical** dataURL (renderer is a pure function of history while paused). `probe-axes-only.png`.
- **Reopen after close** → fresh all-on state, exactly one `sim:tick` listener; one tick redraws exactly once.
  I counted subscribers through the EventBus's own `handlers.get('sim:tick').size`: baseline 4 → open 5 → close 4
  → reopen 5 → replace 4. Closes/replacements also produced **0** redraws on the detached canvas across later
  ticks (no zombie subscription).
- **Replacement contract** → synthetic click on the Treasury stat row while Statistics is open: title becomes
  Treasury, the stats subscription count drops back to baseline, the stats canvas is removed; 4 further ticks
  cause 0 old-canvas redraws; Treasury → Policies… still opens 6 policy rows (C2 path intact).
- **Esc priority** → settings popover + modal open together: Esc closes the modal, settings survives; second Esc
  closes settings.
- **Running clock** → resume for 1.6 s at speed 1: tick 604 → 608, canvas and chips/label update, ~117.9 fps wall
  with the modal open, 0 errors. `probe-running.png`.
- **Renderer robustness (direct call)** → empty history, 1 point, empty selection, unknown id, money-only,
  negative/NaN values, default selection: all draw without throwing (fixed 344×218 canvas).
- **Hidden showcase entry point** → a synthetic `.click()` on the `display:none` button degrades to a
  "Simulation unavailable." modal instead of crashing; unreachable for real users (no hit-testing).

## Builder deviations — verified

1. **Dropped x-axis "game time" caption** (`statsChart.js` has no such text; the panel keeps it): the panel's
   `c.fillText('game time', x0, stripY1 + 3)` would sit exactly under the `-2:30` label centred at `x0` — the
   stated collision is real, the omission is the better call.
2. **Traffic red `#E3342F` instead of the panel's orange**: correct in-rounder so the strip keeps Traffic
   distinct from Demand-Industrial `#F58624`; both readable in `modal-day.png`/`crops/strip-2x.png`.
3. Minor unlisted drifts: the signature is `{ selected, perDayTicks, dpr, width, height }` (design wrote
   `series`), and the label reads `~2:30 of city time` rather than `~2.5 game-minutes` — same meaning, honest.

## Remaining issues (ranked, all minor/non-blocking)

1. **Series chips are toggle buttons without `aria-pressed`.** `src/ui/index.js` `buildStatisticsModal` sets
   only the `on` class (and the swatch opacity) on state changes; the C2 policy switches set `aria-pressed`
   (`buildPolicyModal`), so this is an internal consistency gap for AT users. Evidence: DOM readout in
   `probe-A.json`; fix is one attribute in creation + click handler.
2. **Bottom-left `0%` strip label sits directly above the `-2:30` x-axis label** in the shared corner (they
   nearly touch, no overlap) — inherited from the panel's copy, readable at 1:1 and 2× in
   `shots/ui/c3/crops/strip-2x.png` and `probe-demand-only.png`. Cosmetic; a nudge or dropping the leftmost tick
   would clear it.
3. **When Demand R and C are nearly equal the azure line overdraws the lime one** (draw order lime → azure →
   orange), so only 26 lime px vs 44 azure px were found in my demand-only frame; the line is present, just
   occluded. Same draw order as the panel; a documented consequence of one chip for three series, not a new
   defect.
4. Carried over from r3, untouched by this round: Dezone's grey reads faintly unlit among the saturated zone
   icons, and the RCI R/C/I labels are the lowest-contrast text in the HUD; the showcase road-paint workaround
   remains a documented core-request, not a real-game defect.

## What already works

- **Teardown is genuinely leak-free.** `openModal` fires the previous `onClose` before replacing, `closeModal`
  and `Hud.dispose` both run the callback once, and the `sim:tick` subscriber count returns to baseline on every
  path — measured live, not just read. This is the part of the feature most likely to rot; it is correct today.
- **The chart is honest, not decorative.** Right-edge points land exactly on the values the API reports
  (`net × perDayTicks` matches the budget to the cent at the last tick), the chips use live `getStats()/getBudget()`
  values, and the window label reports the real ring length. Paused output is deterministic; only ticks change it.
- **It looks like it belongs.** Same plate/stud/chip language as the HUD, matches the simulation panel's
  chart grammar (people/money axes, 0–100 % strip, shared x-axis, `now`/`-M:SS` ticks), and reads at both
  day and night (`modal-day.png`, `modal-night.png`, `crops/modal-2x.png`). The showcase HUD is byte-for-byte the
  pre-C3 chrome minus the new row, and the full-game HUD plate is still aligned with the row added.
- **No simulation churn.** Zero source changes outside `src/ui`, no new serialized state, no new data — the
  design's central constraint.

## Honest caveats

- I did not live-test a `ui` module dispose → init cycle with the modal open (`Hud.dispose`'s callback is
  code-read, not driven); the app never disposes modules in normal play, and r3 already verified the dispose
  reset pattern.
- Headless fps is vsync-pinned; the game batch's 60.0 fps floor and the probe's ~118 fps are CPU-bound numbers —
  `gpuMs` (16.29 ms max) is the budget claim.
- The builder's `shots/ui/c3/crops/*` were captured at a different sim moment than `modal-day.png`
  (chips 14,114/5,578/$92,637 vs 12,753/5,009/$66,502). The crops are craft evidence only; both moments are
  internally consistent, and my own pixel probe re-verified the 12,753 moment.
- The chart shows the ring only, no hover readout (per design), one chip for all three demand lines, and history
  is not serialized (C3 deliberately adds no sim data) — all documented, none scored as defects.

## Verdict

**PASS at 8.9.** All C3 acceptance items are met and independently reproduced: six chartable series from real
history, honest values, one-click entry, paused correctness, per-tick redraw, Esc/replace/dispose teardown,
showcase hiding, seed determinism, `errors: []`, budgets clear. The score stays at r3's 8.9 rather than rising
because the module's standing cosmetic nits are unchanged and C3 adds a small a11y nit (missing `aria-pressed`)
plus the panel-inherited corner-label adjacency — none of which would be circled in a shipped screenshot.
