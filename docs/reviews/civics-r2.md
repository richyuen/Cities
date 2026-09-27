# civics — builder report (round 2, Wave C6/F3: level-3 wealth route, showcase staging, civic facade fixes)

**What shipped:** the level-3 gate now has a second, documented route (sustained city happiness) alongside the
school; every `simulation` showcase variant stages one school + one hospital so education/health read non-zero in
stats, the coverage grids and the showcase panel; and the four civics-r1 building-craft items are fixed (side/back
facades, mullioned lit windows, tinted framed entrances, glowing red hospital cross).

> Evidence, not a pass — the independent critic re-measures in `docs/reviews/civics-r2-critic.md`.

## What was built

- **Level-3 wealth route (`simulation/model.js`).** `LEVEL3_WEALTH_HAPPINESS 0.62`, `LEVEL3_WEALTH_TICKS 30`,
  `LEVEL3_WEALTH_RESET 0.58`, tracked per building as `s.wealthTicks`. The gate is now
  `lvl < 2 || s.schooled || s.wealthTicks >= 30` on top of the existing `mature` requirement, so the school still
  dominates (12 mature ticks vs 20 + 30 wealth ticks) and a well-run city is never permanently walled off by
  coverage geometry. Hysteresis (accrue ≥ 0.62, hold 0.58–0.62, reset < 0.58) prevents flicker. `wealthTicks` is
  transient: `getOccupancyState()`/`applyOccupancyState()` are unchanged, so a load restarts the streak (at most
  30 ticks of delay) and can never *grant* level 3 — documented in the design doc.
- **Showcase staging (`simulation/citygen.js`).** Two fixed service blocks near the district centre
  (`SERVICE_BLOCKS = { '1,2': 'school', '3,2': 'hospital' }`) take precedence over that block's park/RCI lots; they
  consume no rng, so the rest of the layout is unchanged. The staged city now returns `services` (kind + id) for
  tests. Coverage after warm-up: education 90.7–92.3 %, health 100 % in all three variants (school grid 841 cells,
  hospital 1089).
- **Panel rows (`simulation/panel.js`).** `Education` and `Health` rows added after `Park access` (the r1 critic
  found the showcase panel had no education/health rows at all). Reads 92 % / 100 % in `default`/`boom`, 91 % /
  100 % in `bust`.
- **Civic facade fixes (`buildings/generator.js` + `buildings/index.js`, r1 critic items 1–4).**
  - *Item 1 (bare side/back facades):* the school gains a matching framed window bay on each ±x face; the hospital
    goes 2 → 4 framed ward bays per ±x face **plus** two new bays on the back (-z) face **plus** a small side
    service door (light-stone frame, tinted pane, white canopy) on the -x face.
  - *Item 2 (blown-out lit panes):* new `litPaneGrid()` helper splits every civic lit overlay into inset panes with
    a visible mullion (school 2×2, hospital 2×1 vertical). `winCool` night intensity 2.6 → 2.4 to stop the ward
    panes clipping to white.
  - *Item 3 (school entrance reads white-on-white):* the school door is now tinted `transBlue` over a
    `darkStoneGrey` interior liner with a white frame + centre mullion and a header bar. The hospital's big
    entrance bay got the same treatment (deviation: the design only named the school; the hospital's flat
    `transClear` read the same way, so it was fixed for consistency).
  - *Item 4 (cross black at night):* new `crossGlow` material (`brightRed` base, `brightRed` emissive) on both cross
    bars, `emissiveIntensity = t × 4.2` (ARCHITECTURE §7 red bucket ≥ 4); `signGlow` board dropped 3.0 → 2.2 so it
    stops blooming over the cross.
- **ARCHITECTURE §7 contract line updated** (school "required for level 3" → reliable route + wealth fallback).

## Verification

`node tools/check-civics.mjs` (new, kept): **36/36**.
- Node gate proof on a stub world, all four routes: unschooled + happiness 0.65 → candidate at exactly tick 30
  (wealthTicks 30, mature 30); unschooled + happiness 0.4 → no candidate in 120 ticks (gate still real); schooled +
  happiness 0.4 → candidate at exactly tick 12 (`MATURE_TICKS_SCHOOLED`); hysteresis (20 high → 3 below the reset
  threshold → candidate at exactly 23 + 30 = 53); 0.60 band accrues/ resets nothing (0 candidates, wealthTicks 0);
  two identical runs byte-identical (`JSON.stringify(stats)`), constants sanity-checked.
- Simulation showcase, all three variants: exactly 1 school + 1 hospital staged, non-zero education/health in
  `getStats()`, set cells in both coverage grids, and **panel rows read non-zero** (Education 91–92 %, Health 100 %).
- Buildings showcase: school + hospital added via `world.addBuilding`, generator parts asserted (school:
  `winWarm` lit panes + `brightYellow`/`transBlue`; hospital: `crossGlow` + `winCool`; no `transClear`); 12 day/night
  closeups captured (front / 3-4 / rear), `errors: 0`.

Batches (idle GPU, one headless browser at a time): simulation r6 **143.9 / 5.64 / 103**, buildings r4
**143.6 / 6.76 / 299**, game r15 **63.4 / 15.22 / 847** — all `errors: []`, budgets pass (game is within noise of
r14's 62.6 / 15.56 / 854).

Screenshots read (not just counted): `shots/civics/r2/school-front-day.png` (tinted double door with white centre
mullion and frame, red canopy), `school-front-night.png` (2×2 lit panes with a dark cross mullion — the r1 "one
emissive slab" is gone), `school-34-day.png` (side bay present), `hospital-34-day.png` (four ward bays per side),
`hospital-rear-day.png` (back bays + service door, no longer a plain box), `hospital-front-night.png` (cross reads
red against the glowing board), `showcase-default-day.png` + `shots/simulation/r6/simulation_closeup-12.png`
(panel rows Education 92 % / Health 100 %), `shots/game/r15/closeup-21h5.png` (no full-game regression).

## Known gaps / honest caveats

- **The `simulation` showcase renders its own simplified building visuals (`simulation/visuals.js`) and does not
  load the `buildings` module** — staged civic buildings appear as generic brick stacks there. The design doc's
  "No new visuals; the buildings module renders them" holds for the real game, not for this showcase; facade craft
  is therefore evidenced on the buildings showcase + full game (the critic's r1 shots came from the full game).
- `wealthTicks` is not serialized (by design): a save/load restarts the 30-tick streak; a loaded city can lose at
  most 30 ticks of progress toward a wealth-route level-up, and can never gain one.
- The wealth route uses the previous tick's smoothed happiness (deterministic, one tick behind).
- `signGlow` (2.2) and `winCool` (2.4) intensity changes apply to all buildings that use those materials, not only
  civics; verified no regression in the buildings r4 and game r15 batches.
- Design deviation: the design named `--module simulation --round 4` for the showcase batch; round 4 was already
  used by C2, so the showcase batch is **simulation r6**.
