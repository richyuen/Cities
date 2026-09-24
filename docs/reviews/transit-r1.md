# transit — builder self-review (round 1, not critic-scored)

**What shipped:** public transit — bus stops placed on road sidewalks, bus lines drawn stop-to-stop, and real
route buses driving the road network, with coverage/upkeep wired into the economy and save/load.

> This document is the builder's own verification record, not an independent critic round. Every number and
> screenshot below was produced by the same agent that wrote the code; treat it as evidence, not as a pass.

## What was built

- **New module `src/transit/`** (`index.js`, `route.js`, `models.js`, `panel.js`).
  - Stops: click-placed on a road's sidewalk (snapped to the nearest road, offset to the curb side the player
    clicked, sign facing the carriageway). Cost $400; min 14 m spacing; 64-stop cap.
  - Lines: pick stops in visiting order; the line is a closed loop routed over the road network. Cost $2000.
    Clicking the first stop again (or Enter) closes it; Esc cancels.
  - Route computation (`route.js`) builds a lane graph from roads' **public** lane API
    (`lanesPerDirection` / `getLanePath` / `getIntersections` / `getLaneConnections`), then runs Dijkstra with
    turn costs (through 0, right 1.5, left 5, U-turn 16) so routes prefer natural right-turn loops. One-way
    edges only contribute their permitted directions. The result is an ordered lane/turn key loop in exactly
    traffic's key format, handed over via `traffic.setTransitLines()`.
  - Bus stops are 4 instanced roles (pole, coloured sign, white face, coloured ground ring); one ribbon mesh
    per line paints the route colour on the lane centre and glows at night. Draw calls: 4 instanced + 1
    per line + a draft ribbon (hidden unless the line tool is active).
  - Panel (toolbar → Transit → Lines): coverage, riders/day, buses, upkeep/day, per-line colour chip with
    View/Delete.
  - Coverage: share of zoned footprint within 9 Chebyshev cells of any stop, pushed to simulation via
    `setTransitCoverage`; upkeep (buses × $0.35 + lines × $0.25 per tick) via `setTransitUpkeep`.
  - Save/load: `getState`/`loadState` round-trip stops + lines (routes recomputed on load); wired into
    `menu/serialize.js`.
- **`traffic`**: route buses are normal pool vehicles with a scripted key loop — they keep lane discipline,
  queue in the same gap buckets as cars, stop at red lights, use headlights/taillights and cast shadows.
  Added transit signal priority (`LaneGraph.requestPriority`): a bus approaching a stop line holds its arm
  green, so it doesn't sit through multi-cycle waits. Buses stop at each stop for 3.2 s (approach controlled to
  settle the bus centre at the stop). New API: `setTransitLines`, `getTransitStatus`, `getTransitBusCount`,
  `getBusPositions`, `getBusDebug`, `rebuildNetwork`.
- **`simulation`**: `transitCoverage` adds up to +0.10 happiness, reduces the traffic stat by up to 30%, adds a
  `transit` expense line to the budget, exposes `stats.transitCoverage`; save state carries transit upkeep.
- **`tools` / `ui` / `demo`**: two new toolbar groups tools (`transit:stop`, `transit:line`, `transit:lines`)
  with hand-drawn icons, HUD "Coverage → Transit", inspect modal row, minimap stop dots, audio cues, and a
  6-stop starter loop in the demo downtown (all right turns, so lane 0 serves every junction).

## Verification (real numbers, from this repo's tools)

Showcases (`node tools/critic.mjs --module transit --round 1b`), 16 shots across 3 presets × 4 tods:

```
minFps=106.4  maxGpuMs=7.17  maxDrawCalls=122  errors=0
```

Full game batch (`node tools/critic.mjs --game --round 5b`, run alone — an earlier parallel run showed
inflated gpuMs from two Chrome instances sharing the GPU):

```
overview-6h5  fps=75.7  gpu=7.24ms  calls=769
street-6h5    fps=65.9  gpu=9.26ms  calls=790
closeup-6h5   fps=112.6 gpu=7.39ms  calls=823
closeup-12    fps=120.4 gpu=8.04ms  calls=740
street-12     fps=113.5 gpu=7.70ms  calls=727
overview-12   fps=106.2 gpu=7.26ms  calls=749
minFps=65.9  maxGpuMs=9.26  maxDrawCalls=823  errors=0   (budget: ≥50 fps, ≤20 ms, ≤1500 calls)
```

Functional checks (scripted against the live dev server, all with `errors: []`):

- **Route correctness:** showcase loop keys are
  `[L:e2:0:forward, T:n4:4, L:e8:0:backward, T:n1:2, L:e0:0:backward, T:n0:1, L:e6:0:forward, T:n3:1]` —
  a proper lane/turn alternating loop with no U-turns.
- **Bus behaviour over 150 s (9000 frames):** every stop is visited (7 dwells, 2 full wraps), approach settles
  the bus at the stop, dwell ≈3.2 s, and the bus resumes. Transit signal priority cut the stuck-at-light share
  from ~75% of frames to ~30% (the remainder is queueing + dwells).
- **Economy wiring:** demo city reports coverage 0.103, ridership 152/day, upkeep $0.95/tick (2 buses + 1 line);
  simulation reports the same coverage and upkeep, and the HUD reads "Transit 10%".
- **Save/load:** serialize → wreck (remove every stop/line) → applySave restores 6 stops, Line A (6 stops),
  2 buses, coverage 0.102, upkeep 0.95, no errors.
- **Road edits:** removing two road edges used by the line re-routes it (12 → 14 keys), prunes the 3 stops whose
  roads vanished, respawns the buses, and recomputes coverage — no errors, one toast.
- **Tool flow (real mouse clicks):** placing stops and drawing a line through them with the Bus Stop/Bus Line
  tools, then Enter, created "Line B" and spawned its bus.

Screenshots (inspected):

- `shots/transit/r1b/transit_aerial-12.png` — loop + 4 stop markers + ribbon from above (best overview).
- `shots/transit/r1b/transit_closeup-12.png`, `transit_default-21h5.png`, `transit_aerial-21h5.png`.
- `shots/transit/bus-at-stop.png`, `bus-at-stop-night.png` — a route bus dwelling at a stop, day and night
  (night shot shows headlights, glowing sign and ribbon).
- `shots/transit/game-overview.png`, `game-street2.png` — full game with the demo loop and the Transit HUD row.

## Known gaps / honest caveats

1. **Stop sign is a plain plate** (coloured border + white face). No bus pictogram/route number; adding text
   geometry was out of scope. A route-number plate would help readability at distance.
2. **No riders/queue visuals or bus interior** — stop population and boarding are statistical (`ridership`
   is `population × coverage × 0.18`), not simulated people.
3. **Coverage is footprint-weighted** (building cells), not population-weighted; it moves with demolition, not
   with occupancy.
4. **A line that passes the same stop twice** projects the stop onto the first pass (traffic's `nearestOnPath`
   picks the closest point); figure-eight loops can therefore board at the first occurrence.
5. **One fare/ridership model:** transit affects happiness and traffic but doesn't earn fares (upkeep-only);
   a fare revenue line would complete the loop.
6. **Buses have no per-line livery details** beyond the body colour (line colour is applied to the bus body;
   a roof sign would be a nice touch).
7. **Panel is English-only, minimal** (no ridership chart, no per-line rename).
8. The transit module is not yet in any independent critic round; the STATUS.json entry is deliberately
   unscored.
