# transit — critic review, round 3 (Wave C5 / F2: fares, stop plates, queues, figure-eight boarding)

**Score: 8.5 / 10 — PASS (hold)** — pass needs ≥ 8.5 **and** `errors: []` **and** inside perf budget; all met, but the
score does **not** move up from r2. Four of the five shipped claims are independently reproduced and clean (fare income
in budget + Treasury with the exact contract, the letter atlas with per-instance UV offset and no per-stop draw calls,
rider queues that scale with ridership and collapse with the network, and clock-pause freezing traffic end to end).
The figure-eight claim is only **partially** true: the projection collapse is fixed (a repeated stop no longer boards
twice at the same arc point), but a duplicated stop at **both** ends (`A→B→A`) parks the bus in an endless dwell at the
repeated stop — the exact failure mode C5 was meant to kill — and the appended-duplicate shape the builder tested
(`A…A`) dwells its second visit at the loop-closure point instead of a real second pass. Two new player-visible
defects (a new line can duplicate a surviving line's letter/colour after a deletion; queue blocks are sliced by the
lifted ground ring) plus one paused-edit divergence offset the r2 fixes. The r2 close-range nits (studs biting the
ring, pole cap through the sign plate) are genuinely fixed.

## Numbers (my own runs, one headless browser at a time)

| set | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `shots/transit/r3-critic/` (4 presets × 4 tods) | 16 | 143.6 | 6.41 | 125 | 0 |
| `shots/traffic/r6-critic/` (3 presets × 4 tods) | 12 | 142.4 | 6.05 | 108 | 0 |
| `shots/simulation/r5-critic/` (3 × 4) | 12 | 143.2 | 5.46 | 103 | 0 |
| `shots/ui/r6-critic/` (3 × 4) | 12 | 143.6 | 4.33 | 75 | 0 |
| `shots/game/r14-critic/` (5 presets × 4 tods) | 20 | 62.8 | 15.30 | 854 | 0 |

- **Budget**: module batches 4.3–6.4 ms GPU / 75–125 calls; game 15.30 ms / 854 calls / 62.8 fps — all inside
  ≥ 50 fps, ≤ 20 ms, ≤ 1500 calls. Builder numbers reproduce within noise (transit 6.37→6.41, game 15.56→15.30).
- **Functional scripts**: `node tools/check-transit.mjs` (my run) **17/17**; `node tools/check-views.mjs` (my run)
  **25/25**, including the flipped "grid and painted layer are stable while the clock is paused (traffic holds)" —
  the C4 decision is honoured end to end, and the cross-boot grid hash still matches (`4ba5d5c9`).
- `Math.random`: 0 hits in `src/transit/`, `src/traffic/`, `src/simulation/`.
- **Determinism**: cross-boot `transit.getState()` **byte-identical** (693 bytes), and stops/lines/ridership(197)/
  fare/riders(6)/pop all identical. The only cross-boot delta was a live bus at routeS 144.5 vs 145.1 m (0.6 m ≈
  0.075 s of travel) — undefined live frames between boot and my pause, a tooling-pacing artifact, not state drift.
- gpuMs is truth; idle GPU before each batch (13–26 % desktop/overlay load, RTX 4070 Ti, 1876 MiB constant).

## Contract check

- `git diff` touches `traffic/index.js` (nearestOnPath/buildRoute + pause guard), `transit/*`, `simulation/model.js`
  (budget income.transit + `transitFare`), `simulation/index.js` (setter/getter pair only), `ui/index.js`
  (two Treasury rows), `tools/check-views.mjs` (assertion flip), `ARCHITECTURE.md`. **No simulation change beyond the
  fare line** — model diff is `bg.income.transit`, the `income` sum, `perDay.income.transit`, and the field; the
  step/watch behaviour is untouched, so simulation player behaviour is unchanged by construction.
- `id/deps/order/api` unchanged; no new serialized transit state (fares are derived as designed).
- Draw calls: plates reuse the existing face mesh (material splice only); one new instanced rider mesh (+1 call,
  `transit-riders`), no per-stop calls. Module-own cost still ≈7 for the 1-line showcase (budget 12).

## Claim-by-claim verification (my evidence)

| # | claim | independent evidence | verdict |
|---|---|---|---|
| 1 | `nearestOnPath(..., fromS)` + monotonic `fromS` fixes repeated-stop dwelling | Projection maps read live (`getBusDebug().stopS`): demo line 49/149/238.5/312.1/412.1/501.6; `A…A` line adds a **distinct** 557.9 on a 557.90 m loop (the r1 collapse would repeat one value). The bus serves both visits and keeps moving. But see defect 1: the `A→B→A` shape still endless-dwells. | **PARTIAL** |
| 2 | `FARE_PER_RIDER 0.35` $/rider/day (design placeholder 0.004, tuned) | `budget.perTick.income.transit` == `simulation.getTransitFareRevenue()` == `ridership × 0.35 / (600/0.5)` **exactly** after two ticks (0.057750 = 198 × 0.35/1200), and `perDay` = ×1200 (69.30). One-tick lag measured directly: budget 0.057167 → 0.057458 → 0.057750 vs model 0.057458 → 0.057750 → 0.057750 (B_n == M_(n−1)); wiping coverage gives B1 = old fare, B2 = 0. Treasury PNG shows `Transit fares $70/day` next to `Transit upkeep $2,280/day`. The 87.5× deviation from the placeholder is documented in code+report and the design explicitly deferred tuning; defensible, but the report's "≈ half the network at full coverage" is a small-fleet case, not a general balance claim. | **FIXED (tuned)** |
| 3 | 288×32 atlas + per-instance `aUvOffset` + shader splice, no new draw calls | Live: face material map image 288 px wide; every stop has an `aUvOffset`; my probe matched each stop's tile to its line's letter **4/4** (0 mismatched) and check-transit 6/6; `transit_stop-12/-21h5` show a legible **A** day and night. Night: the plate reads as a glowing white lightbox with the letter as a **dark** glyph — readable, but "letters glow in their line colour" overstates it (the white surround dominates). | **FIXED** |
| 4 | rider blocks: instanced, count = `clamp(round(stopShare/60), 0, 6)` | Demo 198 riders/day → 6 blocks; showcase stages 1200 → 5 blocks/stop in `transit_stop` (day/night crops); removing the only line → **0**; re-adding a line → 4; zero coverage → 0 and no NaN. Visual clash with the ring: see defect 2. | **FIXED (with clash)** |
| 5 | traffic freezes when `ctx.clock.paused` (C4 decision; views assertion flipped) | `check-transit`: 244 vehicles frozen across 45 frames, move again on resume. `check-views` flipped check passes; grid hash stable across 90 paused frames while `mx` stays 0.90. Caveat: batch staging pauses the clock via `setTime`, so every module/game shot now captures *frozen* traffic — intended gameplay, worth knowing when reading batch PNGs. | **FIXED** |
| 6 | r2 nits: ring vs studs, cap vs plate, stop-preset framing | `models.js:47` ring 0.55–0.95 at y+0.20 (above the 0.17 studs); day crop shows no stud bites; cap moved to sit on the plate top (`models.js:32`), no grey brick/black notch in day+night images; `transit:stop` now frames pole base + ring. | **FIXED** |

## Ranked defects

### 1. A duplicated stop at both ends infinite-dwells the line (`A→B→A`)
- **What**: with `transit.createLine([A,B,A])`, `buildRouteKeys` appends the closing leg twice (the B→A return lands
  on a different lane key than `firstKey`, so `route.js:228` adds a full second loop): total **1137.66 m** for a
  505 m stop span. `buildRoute` (monotonic `fromS`) then projects the visits to **49 / 149 / 505.6**. When the bus
  serves the repeated stop (505.6) its next stop is index 0 at 49 m, i.e. 681 m ahead cyclically — but `stopAhead`
  (`sim.js:264`) only wraps when `d < −total/2` (−456.1 > −568.8), so `d` stays −456. `targetSpeed` is driven to 0
  (`sim.js:336`) and the arrival test `d <= 1.2` fires on the negative `d` (`sim.js:363`): the bus **dwell-cycles
  nextStop 0→1→2 at the same arc position every 3.2 s and never moves**. My stop-map run caught onsets at the same
  routeS 505.1 with `ns=2` then `ns=1` inside 30 s; a 450 s trace of another bus of the line stayed motionless
  (routeS frozen in 85 % of samples, never advanced past its second stop).
- **Where**: `src/transit/route.js:228-231` (unconditional closing leg), `src/traffic/sim.js:263-271` (half-loop
  wrap heuristic), `src/traffic/sim.js:333-338/361-369` (negative-d stop approach + arrival).
- **Reach**: API/save only — the line tool cannot add a duplicate stop (`addLineStop` refuses; clicking the first
  stop closes the line, `tools/index.js:810-818`), and the demo/showcase use unique stops. It still violates the C5
  acceptance clause taken literally ("duplicated-stop line … no endless dwell") and the same wrap-threshold bug can
  bite any loop whose seam gap exceeds half its length (a "first stop projects late + last stop near the end" shape).
- **Fix**: wrap by the *positive* distance to the next stop (choose the smaller of `d` and `d + total`), and/or in
  `buildRouteKeys` skip a closing leg that merely duplicates the loop when the last stop equals the first.

### 2. Queue blocks stand inside the ground ring and are sliced by it
- **What**: riders are placed at local X ±(0.3 + 0.24·⌊k/2⌋), local Z −0.12 (`transit/index.js:420`), i.e. radial
  distances 0.32 / 0.55 / 0.79 m from the stop — the 0.55–0.79 m ones fall **inside the 0.55–0.95 m annulus** whose
  plane sits 0.20 m up; a 0.45 m block is cut through the shins by the ring. Visible at the module's own hero preset
  whenever a stop has ≥ 4 queued riders: my day crop of `transit_stop-12.png` shows the orange block's lower body
  below the red band and its legs hidden; `transit_stop-21h5.png` (crop) shows the brown/blue queue blocks cut by the
  glowing ring. The showcase (staged 1200 riders → 5/stop) makes this the *normal* case; the demo (198 → 1/stop)
  never shows it.
- **Where**: `src/transit/index.js:408-435` (`refreshRiders`), `src/transit/models.js:44-50` (ring lift).
- **Fix**: keep the queue outside the annulus (|lx| ≥ 1.05) or beyond the ring's outer radius, or draw the ring as a
  thin surface inlay rather than a floating plane (that also removes the stud-vs-ring tradeoff for good).

### 3. A new line can reuse a surviving line's letter, name and colour (player-reachable)
- **What**: `createLine` sets `letterIdx = S.lines.size` (`transit/index.js:148`), so after deleting an earlier line
  the next line's index collides with a surviving one. Live proof: two lines at once — **`Line B` / `#0D69AB` and
  `Line B` / `#0D69AB`** (delete the first of two lines, draw another). The ribbon, panel row, sign plate and letter
  are then identical for two different routes; > 8 lines also cycles A–H (known caveat, now demonstrated).
- **Where**: `src/transit/index.js:126-127, 144-152, 386`.
- **Fix**: allocate the lowest unused `letterIdx`/colour per live line (or a monotonically increasing route number
  with the letter shown as a derived label).

### 4. Paused edits diverge from the screen until resume (minor, shared with traffic)
- **What**: `traffic.update()` returns before `writeInstances` while `ctx.clock.paused` (`traffic/index.js:576-581`),
  but data-side edits still run (road edits mark the graph dirty; `rebuildGraph`/`setDensity` mutate car data).
  Measured: with the clock paused `setDensity(0)` leaves `getVehicleCount() === 0` while **1295 instances are still
  drawn**; a road edit / repath while paused likewise keeps stale vehicle transforms (and cars on a bulldozed road
  stay drawn) until the first resumed frame. Reproduced on the full game (240 → 0 API vs 1295 drawn → 300 after
  resume).
- **Where**: `src/traffic/index.js:576-596`.
- **Fix**: call `writeInstances` once after a rebuild/toggle when paused (or treat pause as "hold simulation, keep
  presentation in sync with data").

### Informational (not scored)
- **Fares accrue without any bus line** (ridership is stop-coverage-driven): removing every line still reported
  $0.0615/tick of fares with stops in place. Inherited from `ridership = pop × coverage × 0.18`; document it or gate
  fares on lines if the economy is meant to be line-driven.
- `panelRows()` computes a per-line `ridership` that `panel.js` never renders (row meta is stops/buses/length).
- Night plate letters are legible but read as dark glyphs on a glowing plate, not "glowing in the line colour".
- Batch shots after `setTime()` now capture frozen traffic (the tool pauses the clock); fine for stills, but do not
  read vehicle counts/positions from batch PNGs as "live".

## What already works

1. **The fare loop is honest and exact.** Budget line, Treasury rows, per-day conversion, one-tick lag and the
   zero-coverage floor all check out numerically; `net`/`money` include it, and the sim diff is only the fare line.
2. **Plates are a genuinely cheap, readable identity layer.** One atlas + one attribute + a shader splice, letters
   matched per stop in live buffers, correct by day, legible at night, no new per-stop draw calls.
3. **Queues read well** at the demo's small scale and at the showcase's 5-per-stop; they scale with ridership and
   vanish with the network.
4. **Pause semantics are now coherent** (game clock owns traffic), verified across two independent scripts and my
   probes; four r2-era nits are gone.
5. **No errors, in budget, deterministic state** across 72 batch shots, two functional scripts (42 checks), and my
   probe sessions.

## Regression verdicts

| module | round | verdict | evidence |
|---|---|---|---|
| traffic | 6 | **8.6 HOLDS** | 142.4 / 6.05 / 108 / errors 0 (builder 143.9/6.14/108); the pause guard is the intended C4 decision and check-views 25/25; defect 4 is a paused-edit presentation seam, not a driving regression |
| simulation | 5 | **8.6 HOLDS** | 143.2 / 5.46 / 103 / errors 0 (builder 143.7/5.33/103); diff is the fare line only; fare/one-tick-lag/zero-coverage verified; no NaN |
| ui | 6 | **8.9 HOLDS** | 143.6 / 4.33 / 75 / errors 0 (builder 143.4/4.39/75); Treasury modal itemises "Transit fares / day" + "Transit upkeep / day" (check-transit + PNG), no layout break |
| game | 14 | **inside budget** | 62.8 / 15.30 / 854 / errors 0 (builder 62.6/15.56/854); overview/street PNGs clean, Transit 9 % in HUD; +1 rider mesh vs pre-C5 within noise |

*Evidence sets: `shots/transit/r3-critic/` (16 + summary + my probe JSON/PNG), `shots/traffic/r6-critic/`,
`shots/simulation/r5-critic/`, `shots/ui/r6-critic/`, `shots/game/r14-critic/`, `shots/transit/c5/` (re-run
check-transit evidence), `shots/views/c4/` (re-run check-views). Probe scripts live under
`C:\Users\ryuen\AppData\Local\Temp\opencode\`; nothing in `src/` or `tools/` was modified. `shots/` is gitignored —
this review and STATUS are the record.*
