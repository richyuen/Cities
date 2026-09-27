# ui — builder report (round 4, Wave C3/F6 statistics modal)

**What shipped:** the model's existing ≤ 300-tick history is now visible in the real game. A new **Statistics** row
in the HUD's top-left stat plate opens a modal that charts six series — Population, Jobs, Net $/day, Happiness,
Traffic, Demand R/C/I — with selectable chips that double as the current-value readout. No new simulation data was
added: the modal reads `simulation.api.getHistory()`, `getStats()` and `getBudget()` only. `errors: []` everywhere;
budgets unchanged.

> The numbers below were produced by the same agent that wrote the code — evidence, not a pass. The independent
> critic re-measures the batches and the interaction in `docs/reviews/ui-r4-critic.md`.

## What was built

- **`src/ui/statsChart.js` (new).** `drawStatsChart(canvas, history, { selected, perDayTicks, dpr, width, height })`
  copied from `simulation/panel.js`'s `drawChart` (~80 lines) so `ui` stays inside its folder; the panel's own copy
  is untouched. Same visual language: dark plate, hairline grid, left people axis (k-suffixed), right money axis
  (`+$100k`…), 0–100 % strip, shared x axis (300 ticks = 150 game-seconds). Regions collapse when nothing in them is
  selected; the x-scale right-aligns short histories (same as the panel). `STATS_SERIES` exports the six definitions;
  Demand draws three lines (R `#A5CA18`, C `#3EC2DD`, I `#F58624`).
- **HUD entry point (`src/ui/hud.js`, `icons.js`, `styles.js`).** Fifth row in the stat plate: a chart icon on a dark
  plate + "Statistics". `setStatsAvailable(on)` keeps it hidden in scenarios with no simulation (the `ui` showcase);
  hover state matches the other stat rows. New `icons.chart` glyph.
- **Modal (`src/ui/index.js`).** `buildStatisticsModal` renders the chips (label + live value + colour swatch),
  the canvas and a footer (`last N ticks · ~M:SS of city time`). Draws once on open (correct while paused) and again
  on every `sim:tick` while open. Chip clicks toggle a series and redraw in place. `Hud.openModal()` gained an
  optional `{ onClose }`; the modal's `sim:tick` subscription is torn down on close/Escape/replace and on `dispose()`
  (`options listed in the review`). Series values are read from `getStats()`/`getBudget()` on every redraw, so the
  chips are honest samples of the same numbers the HUD shows.
- **No API change, no cross-module change.** `simulation` is only read through its public API; `views` untouched.

Deviations from `statistics-modal.md` (recorded in its outcome section): the x-axis "game time" caption was dropped
in the modal (it collided with the −2:30 tick at the left edge; the panel keeps its copy), and the Traffic line is
red `#E3342F` rather than the panel's orange, because Demand's industrial line in the same strip uses orange.

## Verification

### Scripted functional check — `node tools/check-stats.mjs` (new, kept)

21/21 checks pass (`shots/ui/c3/check.json`), one headless browser, seed 1, clock paused so only explicit ticks move
the model:

| check | result |
|---|---|
| button rendered + visible in the full game | ok |
| click opens modal titled "Statistics" | ok |
| canvas painted (alpha > 0 px) | 8 207 / 74 992 px |
| six chips, all on by default | ok |
| window label matches history length | `last 300 ticks · ~2:30 of city time` |
| all six chip values === `getStats()`/`getBudget()` formatting | pop 12 753, jobs 5 009, net $66 502/day, happiness 66 %, traffic 12 %, demand 18·17·31 % |
| chip toggle redraws the canvas (dataURL differs) | ok |
| `sim:tick` redraws while open (dataURL differs, clock paused) | ok |
| Escape closes; no errors after further ticks | ok, `errors: 0` |

### Batches (idle GPU checked with `nvidia-smi` before each; one browser at a time)

| batch | command | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| ui r4 (module showcase) | `node tools/critic.mjs --module ui --round 4 --dir shots/ui/c3-module` | 143.0 | 4.43 | 75 | 0 |
| game r12 (full game, idle) | `node tools/critic.mjs --game --round 12 --dir shots/game/c3-r12` | 61.5 | 15.48 | 849 | 0 |

Both match the pre-C3 baselines (C2's ui r4 regression 143.7/4.49/75; game r11-idle 62.3/15.36/849) — DOM-only change,
no render delta. Budgets: fps ≥ 50 ✓, gpuMs ≤ 20 ✓, calls ≤ 1500 ✓.

### Screenshots read at 1:1 and 2×

- `shots/ui/c3/modal-day.png`, `modal-night.png`, `modal-demand-off.png`, `hud-closed.png`, `hud-after-close.png`.
- `shots/ui/c3/crops/modal-2x.png`, `chart-2x.png`, `chips-2x.png`, `strip-2x.png` (2× device scale).
- `shots/ui/c3-module/ui_default-12.png` — no Statistics row in the showcase (simulation absent), rest of the HUD
  unchanged; `shots/game/c3-r12/overview-12.png` — row present in the real game, plate still aligned.

### Determinism / rules

- `grep Math.random src/ui` → none (new code has no randomness; the chart is a pure function of history).
- No serialized state added, so no save/load round-trip is needed for C3.
- Dev server stayed up; all batches `errors: []` / `moduleErrors` empty.

## Known gaps / honest caveats

- The chart shows the ring only (≤ 300 ticks ≈ 2.5 city minutes at 2 tps) and has no hover readout — per design
  (hover-free axes); a crosshair/tooltip would be a future polish item, not a defect.
- No minimap/statistics cross-link (views v2 / C4 territory).
- The demand chip toggles all three R/C/I lines together (one chip per the design's six-series list).
- History is not serialized, so a loaded save starts the chart from load time (the model's documented behavior;
  C3 deliberately adds no new sim data).
