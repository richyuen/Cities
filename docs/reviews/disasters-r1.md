# disasters — builder report (round 1, Wave D2/F9: tornado)

**What shipped:** a new `disasters` module with one city-scale hazard — a tornado that travels along the wind,
damages everything in its path through the shared fire damage model, bills insurance/cleanup to the treasury,
repairs on its own, and round-trips through save/load. Placed from a new Hazards toolbar button
(`hazard:tornado`). Design: `C:\Users\ryuen\.opencode\plan\disasters.md`.

> Evidence, not a pass — the independent critic re-measures in `docs/reviews/disasters-r1-critic.md`.

## What was built

- **Module (`src/disasters/index.js`, order 65, deps `simulation` + `terrain`/`roads`/`buildings` for its showcase).**
  Constants: `LIFE_SEC 60`, `SPEED 11 m/s` along the wind, `CORE_R 30 m` / `OUTER_R 70 m` (quadratic falloff),
  `DAMAGE_PER_SEC 0.55` at the core, `RAMP_IN/OUT 2/4 s`, `INSURANCE_RATE $900` per full damage unit, one active.
  Damage writes the existing `b.damage` (capacity loss via `FIRE_DAMAGE_CAP_LOSS`, free repair via
  `FIRE_REPAIR_RATE`), half-rate on burning buildings. Pause freezes the path (`ctx.clock.paused` → 0 dt); 2×/4×
  speed scales it like the rest of the sim. Emits `disaster:tornado` / `disaster:damage` / `disaster:ended`.
- **Economy (`simulation` + `ui`).** `setDisasterCost($/tick)` pushed on `sim:tick` from the accrued ledger →
  `budget.expenses.disasters` (`perTick` + `perDay`), `stats.disasterCost`, and a Treasury **Disaster costs / day**
  row. A full 42-building storm pays ≈ $25–35k (each fully wrecked building ≈ $900), returning to $0 with the storm.
- **Visuals (`src/disasters/visuals.js`).** 3 visible draw calls (+2 shadow-pass draws = +5 total) while active,
  nothing when idle: a 231-instance Blox funnel (ring-based, dense at the ground, widening with height), a
  54-instance ground debris ring and a translucent dust disc. Layout is seeded (module rng fork); animation is
  time-based. Deterministic cross-boot (see below).
- **Tool (`tools` + `ui`).** Hazards group gains **Tornado** (`hazard:tornado`, danger styling, new funnel-cloud
  icon); clicking the map spawns at that spot with the toast "🌪 Tornado on the ground!" (an audio `error` cue), and
  a second click while one is live is refused. No cost (hazard tool, like fire).
- **Save/load (`menu/serialize.js`).** New `disasters` field (`getState()`: funnel position/path/age/life);
  `loadState()` re-spawns after the world replay. Damage scars already ride on the building records.
- **Showcase.** `?showcase=disasters` stages a 4×4-block district plus 2 power plants + 2 water towers just outside
  the grid (so service warning icons don't litter the shots); variant `storm` spawns the funnel over the district
  centre (batches pause the clock, so stills consistently catch it mid-city). Presets overview/closeup/ground.
- **ARCHITECTURE:** module order list, §4 events, and the §7 disasters contract line.

## Verification

`node tools/check-disasters.mjs` (new, kept): **20/20** in the full game through the real toolbar path:
- Hazards button exists; a canvas click spawns exactly one tornado with a finite world position; a second click is
  refused while one is active.
- Travel: 132.0 m in 12.0 game-seconds at 4× = exactly `SPEED × dt`; direction constant.
- Damage/billing: 42 buildings hit, total damage 31.84 (worst 1.00), `stats.disasterCost` 254.5 $/tick =
  `getBudget().perTick.expenses.disasters`; the Treasury modal shows the row.
- Lifecycle: dissipates within its lifetime, the cost line returns to exactly 0, and damaged buildings repair over
  400 forced sim ticks (38.10 → 32.52).
- Save/load mid-storm: `serializeSave` contains the tornado; a cleared module then `applySave` restores it at the
  same position/age/direction (x −151 → −151, age 4.3 → 4.3).
- Cross-boot determinism: the storm showcase layout (tornado path + funnel/debris instance matrices at spin-time 0)
  hashes identically on two fresh boots (`65291823`).
- Captures: day + dusk chase-camera stills, before/after aerial; all `errors: 0`.

Batches (idle GPU, one browser at a time): disasters r1-storm **143.6 / 6.77 / 551**, disasters r1 (idle)
**143.4 / 6.75 / 503**, game r24 **64.6 / 14.89 / 847** — all `errors: []`; the game is within noise of r22
(62.0 / 15.66 / 847), i.e. the module costs nothing while idle.

Screenshots read: `shots/disasters/d2/storm-chase-day.png` / `storm-chase-dusk.png` (funnel descending between
towers), `shots/disasters/r1-storm/disasters_closeup-12.png` (storm over the serviced district),
`disasters_overview-12.png`, `before.png` / `after-storm.png`.

## Post-review fixes (r1 critic items, disasters r2)

The independent round 1 critic scored **7.5 FAIL** (`docs/reviews/disasters-r1-critic.md`) on two blockers; both
plus the cheap minors are fixed and re-verified in revision 2:

1. **Billing was exactly 2× (`index.js`).** `setDisasterCost(pendingCost / TICK_DT)` pushed `$/game-second` into
   the model's `$/tick` slot, so every dollar was billed twice. Now `setDisasterCost(pendingCost)` — the ledger
   accrues between ticks and each tick bills exactly what was accrued. `tools/check-disasters.mjs` now *proves*
   the ledger (sum of `stats.disasterCost` over `sim:tick` vs Σ `disaster:damage.amount × $900`): **charged
   $38,530.4 = 42.8115 × $900** (was 2.000× in the critic's two storms).
2. **The funnel did not read as a ground tornado.** Rebuilt: stockier column (62 m tall, top radius 14 m, denser
   low rings, bigger base boxes), a faint `earthBlue` emissive so it reads at night, dust opacity raised, and the
   showcase spawn moved to a street intersection. The three presets are now **tornado-aware** (they frame the live
   funnel: street-canyon closeup, street-level ground view, overview plume), which is also what critic batches get.
3. **Paused spawn invisible** (`age 0` → strength 0): `spawn()` now floors the age at 30 % of the ramp-in, so a
   tornado dropped while the clock is paused is visible immediately (asserted in the check).
4. **Minors:** `loadState` caps at `MAX_ACTIVE` (a crafted save cannot spawn a crowd); the draw-call claim is
   +5 (3 meshes + 2 shadow draws), not +3.

Re-verified after the fixes: `tools/check-disasters.mjs` **22/22**, disasters r2-storm **143.9 / 6.72 / 499–551**,
disasters r2-idle **143.7 / 6.75 / 527**, game r26 **62.0 / 15.68 / 847** — all `errors: []`; cross-boot
storm-layout hash `98e27b33` (rebuilt funnel) identical on two boots. Screenshots read:
`shots/disasters/r2-storm/disasters_closeup-12.png` (funnel in the street canyon), `disasters_ground-12.png`
(street-level column), `disasters_overview-12.png` + `-21h5.png` (plume readable day and night), plus the check's
`storm-chase-day/-dusk.png`.

## Known gaps / honest caveats

- **No per-building damage visuals** (collapsed roofs/debris on the tile): the tell is the funnel passing + capacity
  loss + the cost line. The design lists this as the first follow-up lever if the critic wants it.
- **No dedicated tornado audio** (a siren/rumble): the spawn uses the existing `error` sfx.
- The Treasury "Disaster costs / day" figure is a *rate*: it spikes while the funnel is over dense blocks and
  returns to 0 with the storm. Total cost per storm is bounded by ~$900 per fully wrecked building.
- `stageCity` cells in the middle of a block can be road-unconnected, so one warning icon can remain in the
  showcase (pre-existing staging quirk, also visible in the simulation showcase).
- The tornado damages utilities and RCI alike; it cannot be fought (no mitigation building) — out of scope by
  design.
