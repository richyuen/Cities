# transit — builder report (round 3, Wave C5/F2: fares, stop plates, queues, figure-eight boarding)

**What shipped:** the four C5 items plus the C4 integrator decision. Fares are now an income line in the budget and
Treasury, stops carry route-letter plates (A–H) on their existing face, queued rider blocks scale with ridership,
and a repeated stop boards at its next pass instead of dwelling forever. Traffic is now clock-aware: pausing
freezes cars (the views congestion layer holds its sample).

> Evidence, not a pass — the independent critic re-measures in `docs/reviews/transit-r3-critic.md`.

## What was built

- **Figure-eight boarding (`traffic/index.js`).** `nearestOnPath(pd, x, z, fromS)` prefers the nearest hit at or
  after `fromS`, falling back to the nearest before it; `buildRoute()` advances `fromS = hit.s + 1e-3` after every
  stop, so a stop visited twice projects to the **second** pass. Projections stay monotonic; the sort is a safety
  net. Verified live: A→…→F→A line, bus reaches max next-stop 3 and travels 139 m in ~35 s (the r1 defect was an
  endless dwell).
- **Fare revenue (`simulation` + `transit`).** `model.transitFare` ($/tick) + `budget.income.transit` (per tick and
  per day) + `simulation.setTransitFareRevenue/getTransitFareRevenue`. Transit computes
  `ridership × FARE_PER_RIDER / ticksPerDay` on every `sim:tick` and pushes it; **tuned** `FARE_PER_RIDER 0.004 →
  0.35` $/rider/day (the design's placeholder produced ~$21/day against ~$2/tick upkeep — invisible; 0.35 ≈
  half the network upkeep at full coverage, $70/day in the 8 %-coverage demo). Treasury shows **Transit fares / day**
  next to **Transit upkeep / day**; the transit panel shows both too.
- **Route-letter plates (`transit/models.js` + `refreshStops`).** 288×32 canvas atlas (A–H in line colours on
  white + a neutral dash), bound as `map`/`emissiveMap` with a shader splice that shifts `vMapUv.x`/`vEmissiveMapUv.x`
  by the per-instance `aUvOffset` attribute — one material, **no new draw calls**, letters glow in their line
  colour at night.
- **Queue visuals.** Pooled `transit-riders` InstancedMesh (MAX_STOPS×6) of merged minifig blocks; count per stop =
  `clamp(round(stopShare / 60), 0, 6)` where the share is the stop's slice of its lines' ridership; positions along
  the pavement (local X), colours picked deterministically from the stop id. Refreshed on `sim:tick` and on any stop
  change; the transit showcase stages `ridership = 1200` so the module batch shows queues (no simulation module
  there). +1 draw call total (module 121→125 incl. backdrop noise; game 849→854).
- **Clock pause (C4 decision).** `traffic.update()` returns before stepping/`writeInstances` when
  `ctx.clock.paused`; a paused game no longer drives. `tools/check-views.mjs` assertions flipped to "stable while
  paused".

## Verification

`node tools/check-transit.mjs` (new, kept): **17/17** — network present; atlas 288 px with an offset per stop and
at least one letter tile; ridership 198/day at 9 %; fare `$0.0577/tick = 198 × $0.35/day` exactly, $69/day;
6 rider blocks; repeated-stop line created and boarded (next-stop 3, 139 m); pause freezes 244 vehicles and resume
moves them; Treasury contains both transit lines; panel lists Fares; save/load keeps 6 stops/2 lines and fares
recompute; `errors: 0`.

Batches (idle GPU, one browser at a time): transit r3 **143.6 / 6.37 / 125**, traffic r6 **143.9 / 6.14 / 108**,
simulation r5 **143.7 / 5.33 / 103**, ui r6 **143.4 / 4.39 / 75**, game r14 **62.6 / 15.56 / 854** — all
`errors: []`, budgets pass; vs pre-C5 (traffic 6.46/109, game 15.63/849) within noise except the expected +1 rider
mesh.

Screenshots read: `shots/transit/c5/stop-plate-day/-night.png` (letter A, rider queue), `treasury-fares.png`
(Transit fares $70/day + upkeep $2,280/day), `transit-panel.png`; `shots/transit/c5-r3/transit_stop-*.png`
(showcase queue of minifigs).

## Known gaps / honest caveats

- The fare line lags one tick in the budget snapshot (pushed on `sim:tick`, written by the next `step()`), same as
  transit upkeep; the panel/Treasury show the currently modelled value.
- Demo scale (8 % coverage) makes fares small vs upkeep; at full coverage the tuned constant covers ≈ half.
- Rider blocks are a static visual cue, not agents; 6 per stop cap.
- The letter atlas uses the line's creation index (A–H, cycling); >8 lines reuse letters.
