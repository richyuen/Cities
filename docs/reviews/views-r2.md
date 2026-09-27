# views — builder report (round 2, Wave C4/F1: traffic layer + minimap integration + r1 polish)

**What shipped:** the missing ninth data view — per-road-cell **Traffic congestion** — sourced from a new read-only
`traffic.getCongestionGrid()`; the HUD gained a Traffic row and a free/slow/congested legend; the minimap now tints
with the active view and names it in its footer; and the four ranked views-r1 polish items landed (land-value ramp
normalised, tint boxes hugging the silhouette, saturated gold source, open-land fade). No new draw calls: the view
still renders two instanced meshes.

> The numbers below were produced by the same agent that wrote the code — evidence, not a pass. The independent
> critic re-measures the batches and the API in `docs/reviews/views-r2-critic.md`.

## What was built

- **`traffic` congestion grid (`src/traffic/index.js`).** `S.congestion` (`Float32Array`, w·h) + a 0.5 s sim-time
  sampler: each active car contributes `1 − speed / freeFlow` (free flow = the lane kind's base speed × the car's
  own spec multiplier, so a slow bus is not "congestion") to the cell under its position, EMA weight `0.35`; cells
  with no car decay `×0.85` per sample. Sampling runs from `update()` at 2 Hz and lazily from `getCongestionGrid()`
  when stale or after a network rebuild (`congestionDirty`), so a layer opened while paused reads current data.
  New API: `getCongestionGrid()` (read-only `Float32Array`, 0 = free flow, 1 = stopped) and `getCongestionAt(i, j)`.
  No new draw calls, no per-frame allocation, deterministic (a pure function of car state + `simTime`).
- **`views` (`index.js`, `overlay.js`).** `{ id: 'traffic', label: 'Traffic', kind: 'congestion' }` (cycle order
  after Transit, so `V` and `Shift+V` cover it and `views:traffic` exists as a showcase variant). The overlay paints
  road cells with a green→amber→red ramp and tints each building by the worst congestion of its access roads; the
  layer re-samples on a 0.5 s cadence while active (cars move every frame, so event-driven would freeze it).
  `deps` gains `traffic` (soft-read, null-safe).
- **`ui` (`hud.js`, `minimap.js`, `index.js`).** Coverage panel row **Traffic** (between Transit and School) showing
  the sim's aggregate `stats.traffic`, legend "Free / Slow / Congested", view name "Traffic congestion". The minimap
  resolves the active view through `views.api.list()` + the same public grids, tints relevant cells with a single
  palette lookup and dims the context (no extra draw calls, still one canvas pass), and shows the view name in the
  footer (`Map` when none); traffic re-tints on the same 2 Hz dirty path.
- **r1 polish (all four ranked items).**
  1. Land value: ramp normalised over the map's own developable min/max with a narrow yellow shoulder
     (`landColor(v, lo, hi)`), high end moved to emerald `#14c38e` so it reads against grass. Measured on the
     overlay's own buffers: the city now shows both low (red) and high (emerald) ends instead of one yellow wash.
  2. Building tint boxes: `BOX_PAD 0.6 → 0.15 m/side`, height `max(1.4, h+1.0) → max(0.6, h+0.15)` — verified
     numerically from `getMatrixAt()` (24.15 m box for a 3×3-cell 20.06 m building).
  3. Source boxes: `#ffe27a → #ffb800` saturated gold — verified nearest-colour-exact against a real power plant.
  4. Covered open land: BFS distance-to-zoned/built field + fade over 12 cells (0.45 + 0.55·falloff), so the
     radius reads around the city instead of a full-strength rectangle on empty grass; no plate beyond 12 cells
     (verified from the instance positions).
- **Carried C3 follow-ups:** statistics chips now set `aria-pressed`; the modal chart drops the `-2:30` tick that
  collided with the strip's `0 %` label.

## Verification

### Scripted functional check — `node tools/check-views.mjs` (new, kept)

**25/25 checks**, two headless sessions (full game + two traffic-showcase boots), clock paused where it matters
(`shots/views/c4/check.json`):

| area | result |
|---|---|
| grid shape + API | 65 536 = 256×256; both methods present |
| queued vs free | max **0.90**, 166 road cells > 0.25, median road cell **0.000** |
| HUD/legend/footer | Traffic row click activates; legend "Traffic congestion / Free / Slow / Congested"; footer "Traffic" |
| opened while paused | 9 692 road plates painted, grid still reports queues (max 0.90), keeps advancing with live traffic |
| minimap | 100 % of pixels change for traffic, differs from base and traffic for land, returns to base within **0.16 %** residual after Esc |
| land ramp | both ends present (low 2, high 836 boxes/plates), mid 77 % |
| box hug | `24.15 × 24.15` for a 3×3 cell building; height `h + 0.15` |
| gold source | colour distance **0.0000** to `#ffb800` |
| open-land fade | no plate farther than **12** cells from zoned/built land |
| determinism | congestion grid FNV-identical across two traffic-showcase boots (`4ba5d5c9`, 77 live cells) |
| errors | 0 in the full-game pass |

Note found while verifying: **traffic keeps driving while the clock is paused** (its `pause()` is api-driven and
nothing calls it on clock pause), so the congestion layer legitimately keeps updating in a paused game; the
"correct while paused" contract is met by the lazy sample on open (`getCongestionGrid` recomputes stale/dirty).
Recorded as a cross-module seam in `_integrator-todo.md`, not changed here.

### Batches (idle GPU checked before each; one browser at a time)

| batch | command | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| traffic r5 | `--module traffic --round 5 --dir shots/traffic/c4-r5` | 143.4 | 6.46 | 109 | 0 |
| views r2 (school) | `--module views --round 2 --dir shots/views/c4-r2` | 143.4 | 6.82 | 413 | 0 |
| views r2 (traffic variant) | `--module views --round 2 --variant traffic --dir shots/views/c4-r2-traffic` | 143.6 | 6.67 | 405 | 0 |
| ui r5 | `--module ui --round 5 --dir shots/ui/c4-r5` | 143.4 | 4.55 | 75 | 0 |
| game r13 | `--game --round 13 --dir shots/game/c4-r13` | 62.0 | 15.63 | 849 | 0 |

All match their pre-C4 baselines (views r1 6.91 ms/413, traffic ~6.5/107, ui r4 4.43/75, game r12 15.48/849):
the grid is a `Float32Array` refreshed at 2 Hz and the view adds no scene work beyond the existing two meshes.
Budgets: fps ≥ 50 ✓, gpuMs ≤ 20 ✓, calls ≤ 1500 ✓.

### Screenshots read at 1:1 and 2×

- `shots/views/c4/`: `traffic-view-day.png`, `traffic-view-night.png` (21:30), `traffic-view-closeup.png`,
  `land-view-day.png`, `power-view-day.png`, `power-view-night.png`, `traffic-showcase.png`;
  crops `crops/minimap-traffic-2x.png`, `crops/coverage-panel-2x.png`.
- Batches: `shots/views/c4-r2/views_closeup-12.png` (boxes now hug facades; no far-field blue pad),
  `shots/views/c4-r2-traffic/views_aerial-12.png` (green network with amber/red queues), `shots/ui/c4-r5/ui_default-12.png`
  (8-row Coverage panel fits, no collision).

### Determinism / rules

- `grep Math.random` on the touched files → none; congestion sampling is a pure function of car state + simTime,
  and the cross-boot hash is byte-identical.
- No serialization added (the grid is derived state, rebuilt after load on the next ticks).
- Dev server stayed up; `errors: []` in every batch and probe.

## Known gaps / honest caveats

- The building tint on the traffic layer reads the **worst adjacent road** congestion; a large building on two
  roads shows its busiest side (deliberate: the view answers "is this address jammed?").
- Congestion is a per-road-cell average speed ratio (owner decision, roadmap §6.3) — no per-lane volume, no flow
  arrows; empty cells decay to 0 within ~2 s.
- Traffic does not pause with the clock (pre-existing); the layer follows the cars. Recorded in the todo.
- Served open land beyond 12 cells of zoning is not tinted at all (fade target); in a sprawling city the fade
  distance may want to scale with growth — left as a polish lever.
