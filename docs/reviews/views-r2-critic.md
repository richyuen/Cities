# views — critic review, round 2 (Wave C4 / F1: traffic congestion layer + minimap integration + r1 polish)

**Score: 8.7 / 10 — PASS** (pass needs ≥ 8.5; r1 was 8.6). `errors: 0` in every batch and probe.
Budgets: module worst case gpuMs 6.78 / 413 calls; full game 63.0 fps min / 15.27 ms / 849 calls. No new draw calls.

The ninth data view is real and correct: `traffic.getCongestionGrid()` publishes a deterministic per-road-cell
speed ratio at 2 Hz (lazily when stale/dirty), the overlay paints it with the green→amber→red ramp over the road
network plus worst-adjacent-road building tints, and the HUD row/legend/minimap footer all follow `view:changed`.
All four r1 polish items are materially fixed (one sub-item substituted — see issue 1), and the two carried C3
nits are closed. The independent re-run reproduces the builder's 25/25 functional checks, the batch numbers and
the cross-boot determinism hash to the digit/byte.

## Independent runs (this critique)

| run | command | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| views r2 (mine, default = school) | `node tools/critic.mjs --module views --round 2 --dir shots/views/r2-critic` | 143.7 | 6.78 | 413 | [] |
| views r2 traffic variant (mine) | `node tools/critic.mjs --module views --round 2 --variant traffic --dir shots/views/r2-critic-traffic` | 143.9 | 6.76 | 405 | [] |
| traffic r5 (mine) | `node tools/critic.mjs --module traffic --round 5 --dir shots/traffic/r5-critic` | 140.8 | 5.82 | 109 | [] |
| ui r5 (mine) | `node tools/critic.mjs --module ui --round 5 --dir shots/ui/r5-critic` | 143.6 | 4.4 | 75 | [] |
| game r13 (mine) | `node tools/critic.mjs --game --round 13 --dir shots/game/r13-critic` | 63.0 | 15.27 | 849 | [] |
| builder views r2 (JSON re-checked) | `shots/views/c4-r2/` | 143.4 | 6.82 | 413 | [] |
| builder traffic variant (JSON re-checked) | `shots/views/c4-r2-traffic/` | 143.6 | 6.67 | 405 | [] |
| builder traffic r5 / ui r5 / game r13 (JSON re-checked) | `shots/traffic/c4-r5/`, `shots/ui/c4-r5/`, `shots/game/c4-r13/` | 143.4 / 143.4 / 62.0 | 6.46 / 4.55 / 15.63 | 109 / 75 / 849 | [] |

`nvidia-smi` was checked before every batch (ambient desktop 13–24 % GPU, no game running), one headless browser
at a time; the dev server stayed up. `budget` flags are all true in every summary.json. PNGs read at 1:1:
`shots/views/c4/` traffic-view-day/night/closeup + land/power day/night + both crops;
`shots/views/r2-critic/views_closeup-12`; `shots/views/r2-critic-traffic/views_aerial-12`, `views_default-12/-21h5`;
traffic `intersection-12`; ui `ui_default-12`; game `overview-12`; plus my own `shots/views/c4-critic/*`
(land variant vs the r1 wash, traffic variant, stats crops) and the two edge screenshots.

## Functional check — re-run of `tools/check-views.mjs`: **25/25**, matching the report exactly

Key values reproduced by me: grid 65,536 = 256×256; queue peak **0.90**, **166** road cells > 0.25, road median
**0.000**; HUD row click → `traffic` + highlight; legend "Traffic congestion / Free / Slow / Congested"; footer
"Traffic"; opened while paused **9,692** plates; minimap **100 %** of pixels change for traffic and returns to
base within **0.16 %** residual after Esc; land ramp low **2** / high **836**, mid **77 %**; box **24.15 × 24.15**
for a 3×3-cell building and height `h + 0.15` (20.21 for 20.06); gold distance **0.0000**; max plate distance
**12**; two showcase boots hash-identical **4ba5d5c9** (77 live cells, max 0.89856).

I read the script line by line: the assertions are real (live API reads, instance-buffer reads, pixel diffs,
BFS cross-check of the fade, cross-boot hash) — no vacuous passes. One interpretation choice is worth flagging:
checks 13–14 assert the grid *advances* while the clock is paused, which is true because traffic keeps driving
(pre-existing seam, below); the design's actual requirement — correct when *opened* while paused — is separately
covered by the synchronous-open probe.

## Contract check

- **Read-only trailers, no sim changes.** `git status` touches only `traffic`, `views`, `ui` (+ docs); nothing in
  `src/simulation/`. The overlay reads `world.cells/buildings`, `simulation.getCoverageGrid/cellDesirability`,
  `transit.getCoverageGrid`, `traffic.getCongestionGrid`; the minimap reads the same public grids. No
  `Math.random` in `src/views`, `src/traffic`, `src/ui`; no serialization added.
- **Ordering / legends / payloads.** `view:changed` payloads observed for all nine: `{power,Power}` …
  `{traffic,Traffic}`, `{land,Land value}`. `V` from null walks power → water → services → police → school →
  health → transit → **traffic** → land → power (wrap), `Shift+V` wraps backwards (power → land). The HUD
  Traffic row sits between Transit and School; its legend chips `#22c55e/#f2b21a/#e23b2e` are the overlay's
  `congFree/congSlow/congCongested`; Esc closes to footer "Map".
- **No new draw calls.** Live scene traversal with the traffic view active: the `views` group has exactly
  **2 InstancedMesh** (`views-ground`, `views-buildings`). Module batch calls are identical to r1 (413 / 405);
  the congestion grid is a `Float32Array(w·h)` — zero meshes, zero materials.
- **Determinism.** The check's two traffic-showcase boots are byte-identical on my run (`4ba5d5c9`, 77 cells,
  same max) — same hash the builder reported. Across my own separate sessions the full-game traffic view painted
  the same 9,692 plates and the grid read the same max 0.8259709477424622 at the same staged frame. Probes over
  8 weather/tod/road churn steps found **0 NaN, 0 out-of-range** values (`min 0`, `max ≤ 0.90112`).
- **Grid API shape.** `getCongestionGrid()` returns the module's own `Float32Array(65536)` (`a === b` across
  calls, documented read-only); `getCongestionAt(-1,0)` and `(99999,99999)` → `0`.

## r1 polish — issue-by-issue verification

1. **Land ramp — fixed, one sub-item substituted.** `landColor(v, lo, hi)` normalises over the map's own
   developable min/max with a 45–55 % yellow shoulder; measured low 2 / high 836 / mid 77 % of instances, and the
   `variant-land` re-shoot (`shots/views/c4-critic/variant-land-default-12/-aerial-12.png`) shows red, amber and
   emerald regions where r1 was one butter-yellow wash (`shots/views/r1-critic/variant-land.png`). The design's
   "faint dark edge on land plates" is **not implemented** — the emerald `#14c38e` high-end hue is the
   substitute. Visually the goal is met (cooler mint separates from grass better than the old grass-family green),
   but the specific sub-item is unbuilt; minor.
2. **Box hug — fixed.** `BOX_PAD 0.6 → 0.15`, height `max(BOX_MIN_H, h + 0.15)`; live matrix read 24.15 m for a
   24 m building, roof 20.21 for 20.06. A/B against `shots/views/r1-critic/views_closeup-12.png`: the r1 lid
   floats above the roof and the shell overshoots the walls; the r2 closeup boxes sit on the facades.
3. **Gold source — fixed.** `#ffb800` at colour distance 0.0000 on the first power plant; reads gold (not cream)
   in `power-view-day` and glows at night in `power-view-night`.
4. **Open-land fade — fixed.** BFS distance field + `0.45 + 0.55·(1 − d/12)` colour falloff, no plate beyond
   12 cells (max exactly 12); the power-view blue pad now pulls in around the built area instead of stamping the
   full plant radius on empty grass.

Carried C3 follow-ups: statistics chips now carry **`aria-pressed`** and it tracks state live (all six chips
`true` on open → click → `false`/`off` → click → `true`/`on`); the `-2:30` x-axis tick is dropped
(`statsChart.js` skips `s === 150` when strips exist) and my 2× chart crop shows `-2:00 … now` with the `0 %`
strip label clear.

## Edge probes (my own, puppeteer via `tools/shot.mjs`)

- **No-roads world** (`clearContent()` on a full-game boot): the layer stays visible and paints **0 plates /
  0 boxes**, no throw, footer "Traffic", legend present; the grid decays its stale values (`nz 323 → …`, max
  0.458) because the overlay's 0.5 s re-sample keeps running while it is open. HUD click toggles off → `Map`.
  `errors: 0`. "Stays sane" is the right behaviour for a road-network layer with no roads.
- **Road edit while the view is active and paused.** Removed the busiest avenue (140 m, the cell under the worst
  queue): after 120 frames the layer repainted **9,692 → 9,640** plates, the grid re-sampled (`nz 412 → 542` as
  cars redistributed) with **no NaN**, and the edited cell was healed onto the neighbouring edge — no stale
  painting, no manual `refresh()`. Adding a 32 m street on free land produced exactly **+1 edge** and +37 plates,
  again clean. `errors: 0`.
- **Minimap cadence.** Wrapping `putImageData` on the 256×256 offscreen canvas: **8 rebuilds / 240 frames**
  while the traffic layer is active vs **1** on the base map (the open/close rebuild itself) — it re-tints on
  the dirty path (~2 Hz), it does not recompute per frame. Over ~200 frames the tint changed **99.82 %** of
  pixels; after Esc the base map was pixel-identical after 40 frames (0.00 %).
- **ui showcase without a views module** (`?showcase=ui`): modules = environment/ui/effects only; footer "Map";
  base map drawn (150,544 opaque px); `lc-views-on` absent so the eye affordance is hidden; `V` is a no-op;
  `errors: 0`.
- **Churn.** 8 iterations of weather (rain/cloudy/fog/clear) + tod (6.5/12/18/21.5/3) + road add/remove while
  the traffic view is live: grid always within [0,1], no NaN, no OOR, `errors: 0`.

Probe hygiene note: my first pass called `world.addRoad` with `[x,z]` arrays (the API takes `{x,z}`) and poisoned
that session; the re-run with the correct shape is the evidence above (my bug, not the module's).

## The paused contract (acceptance item)

Traffic is not clock-aware (pre-existing: `traffic.update()` only checks its own api-only `pause()`; the
registry stops all modules only under the menu's `ctx.paused`, not the clock's Space pause), so the check's
"paused" game has the simulation frozen but the cars still driving — the layer legitimately follows them. For C4 the design required the view to be correct when **opened while paused**; I
verified that directly: with the clock paused, `views.setView('traffic')` painted 9,692 plates synchronously
inside the call, reading current queues (grid max 0.826) with no manual refresh, and paused road edits re-sample
lazily (`congestionDirty`) with no stale data. **The acceptance text is met.** The deeper seam — should pause
freeze traffic at all — is cross-module (traffic/clock), pre-existing, disclosed in the builder report and
recorded in `_integrator-todo.md`; it needs an integrator decision, not a C4 fix.

## Ranked issues (most damaging first)

1. **Land polish sub-item "faint dark edge on land plates" is not implemented** (design `views-v2.md` §2.4.1),
   substituted by the emerald high-end. Low severity — the r1 complaint (grass-family green) is addressed by hue
   — but if the edge is wanted it is still unbuilt. Fix: a 1-px-ish darker plate rim, or amend the design line.
2. **The minimap keeps the base-map legend chips while a view is tinted** (`crops/minimap-traffic-2x.png`,
   `edge-ui-showcase.png`): the footer names the layer and the Coverage-panel legend explains the ramp, but the
   minimap's own legend still says Homes/Shops/Industry/Roads/Parks/Water over a green/amber/red map. One-line
   fix: hide or swap `.lc-legend` while `activeView` is set. Cosmetic.
3. **A free-flowing city reads as a green wash at day** (traffic-view-day, views closeup day): the free green is
   in the grass family, so the day signal is carried by the amber/red queues only; at night
   (traffic-view-night, `views_default-21h5`) the layer is excellent. Data-honest and not scored as a defect —
   noted as the layer's known limit and a candidate for the next palette pass.
4. **Pre-existing cross-module: traffic keeps driving while the clock is paused** (recorded in
   `_integrator-todo.md`). It makes the paused congestion layer look alive and makes check 14's "advances while
   paused" a seam assertion rather than a layer property. Decide whether pause should freeze traffic
   (`traffic.pause/resume` wiring) and whether the views cadence should then stop; no C4 change needed.

## Regression verdicts

- **traffic r5 — 8.6 holds.** My batch 140.8 fps / 5.82 ms / 109 calls vs builder 143.4 / 6.46 / 109 and the
  pre-C4 B2 baseline 143.4 / 6.51 / 107; draw calls unchanged (the grid is data only). The new API is additive,
  read-only, deterministic, null-safe before/after `dispose`. One honest caveat: cells that stop being roads keep
  a decaying value (~×0.85 per sample, a few seconds) until sampled — invisible because non-road cells are never
  painted, and consistent with the documented "cells with no traffic decay toward 0". No defects found.
- **ui r5 — 8.9 holds.** My batch 143.6 / 4.4 / 75 vs builder 143.4 / 4.55 / 75 and ui r4 143.0 / 4.43 / 75.
  Both carried nits fixed and verified live (aria-pressed, dropped tick). Only new cosmetic note: in the ui
  *showcase* the Traffic row shows "0 %" while the other sim-fed rows show "—" (showcase-only fake data; the real
  game is consistent).

## What already works

- **The congestion API is a clean trailer.** Pure function of car state + sim time; 2 Hz throttle + lazy
  stale/dirty sample; correct opened-while-paused; no rng, no draws, no per-frame allocation; read-only array
  with documented ownership.
- **The view is honest and legible where it matters.** Queues peak at 0.90 on road cells where cars actually
  stop (166 > 0.25, median 0.000); red is red at every tod; the night read is genuinely good; the HUD row,
  legend, minimap tint + footer and Esc interlock all agree with `view:changed`.
- **The r1 polish is real, not just restated.** Boxes hug (verified numerically and against the r1 PNGs), the
  source is saturated gold, the fade terminates at 12 cells, and the land ramp spans its own min/max with the
  mid band down to 77 %.
- **Zero errors, zero perf regression.** 2 draw calls; views/traffic/ui/game batches all inside budget with
  `errors: []`; byte-identical determinism across boots.

## Verdict

Functional acceptance is met and independently reproduced: a correct, deterministic traffic-congestion layer
reading the right cells; minimap integration with footer naming and no extra draw calls; all four ranked r1
items addressed (one sub-item substituted); the C3 nits closed; `errors: []` everywhere. The deductions are the
unbuilt land-plate edge, the stale minimap legend, and the un-actioned pause seam. **Pass at 8.7**, up from r1's
8.6 — the new layer is additive with no regression and the r1 defects are visibly better, but the remaining
cosmetic gaps keep it short of 8.8+.
