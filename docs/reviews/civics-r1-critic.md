# civics — critic review, round 1

**Score: 8.5 / 10 — PASS** (pass needs ≥ 8.5). Errors: 0. Perf inside budget with headroom.

This is the first independent round for the `civics` feature (school/hospital coverage, level-3 education gate,
happiness/demand effects, upkeep, tools stamps + inspect, HUD/modal rows, demo seeding). The builder's
`docs/reviews/civics-r1.md` is evidence, not a round; everything below was produced by this critic from fresh
sessions, and the contract checks were re-derived from the public APIs rather than trusted.

## Numbers

| run | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| full game, `shots/civics/r1/` (5 presets × 4 tods) | 20 | 54.3 | 11.25 | 860 | `[]` |
| full game re-run, `shots/civics/r1-perfcheck/` (to test the fps floor) | 20 | 55.3 | 11.77 | 860 | `[]` |
| `simulation` showcase, `shots/civics/r1-sim/` (3 presets × 4 tods) | 12 | 143.4 | 5.14 | 103 | `[]` |
| my staged district, `shots/civics/r1-extra/` (16 shots + clips) | 16 | 105.5 | 6.58 | 300 | `[]` |
| my demo/plain closeups, same dir (`demo-*`, `plain-*`) | 21 | — | ≤ 13.02 | ≤ 672 | `[]` |

Budget (full city): minFps ≥ 50 ✓, maxGpuMs ≤ 20 ✓, drawCalls ≤ 1500 ✓. I looked at all **69 unique-view PNGs**
(20 game `r1`, 12 sim, 37 extras) plus 4 spot-checks of the 20 deterministic `r1-perfcheck` re-captures; every
capture reported `errors: 0` (`errors: []` in all 52 critic-batch JSONs and both summary files, `moduleErrors: {}`).
One tracked risk: the fps floor is
reproducibly the **first** shot of a game batch (`overview` at 6.5 h: 54.3 then 55.3 fps across two runs) while
its `gpuMs` is only 7.0 — so it is a main-thread/capture-start dip, not a GPU limit; the margin over the 50 fps
floor on that one shot is thin (4–5 fps), worth watching if the first-capture warm-up is ever touched.

## Contract / behaviour check (independently re-derived)

**Coverage math — exact.** Staged a 54-building district (24 r / 24 c / 6 i) on a flat plain, all level 2, all
powered/watered/road-connected, one school (real tool click, anchor (111,172)) and one hospital (real tool click,
(137,172)). After 900 ticks:
- `getUtilityRadii()` → `school 14`, `hospital 16` cells (112 m / 128 m); inspect card reads **"Coverage radius 112 m"**.
- `getCoverageGrid('school')` has exactly **841 = 29²** set cells and `'hospital'` exactly **1089 = 33²** — the
  Chebyshev square in `_stampRadius`, fully in-bounds, no leak/off-by-one.
- Recomputing capacity-weighted coverage myself from the public per-building API (`CAPACITY[zone][level] × w × d`,
  `getBuildingCoverage(id)`) gives **total 4416 / schooled 3936 / hospitaled 1040 → edu 0.8913043478260869,
  health 0.23550724637681159**, which matches `stats.educationCoverage` / `stats.healthCoverage` to the last digit.
  Per-building `schooled`/`hospitaled` flags vs the grids: **0 mismatches** across all 54.
- HUD Coverage rows read **School 89% / Health 24%**, Population modal reads **Education coverage 89% / Health
  coverage 24%** — honest against `stats` (screenshots `after-hud.png`, `population-modal.png`; before placement
  both read 0%, `before-hud.png`).

**Level-3 gate — real, both directions, in the live game.** After 900 ticks on that district (occupancy
r/c/i = 0.999/0.770/0.736): `getGrowthCandidates()` = **24, all 24 in the schooled block, 0 in the hospital-only
block**. Then I let the shipped full-game growth pass run: schooled block **24/24 level 3**, hospital-only block
**24/24 still level 2** (`after-aerial.png`, `gate-schooled-block.png`). Code confirms the rule:
`(lvl < 2 || s.schooled)` with `MATURE_TICKS_SCHOOLED = 12` vs `MATURE_TICKS = 20`. A school is genuinely required;
a hospital is not.

**Effects and upkeep — wired and exact.** `EDUCATION_HAPPINESS_WEIGHT 0.07`, `HEALTH_HAPPINESS_WEIGHT 0.08`,
`EDUCATION_COMMERCE_BONUS 0.12`, `EDUCATION_INDUSTRY_BONUS 0.06`, `HEALTH_DEMAND_BONUS 0.10` are all consumed in
`step()`; live happiness rose 0.54 → 0.61 as coverage and occupancy filled in. Upkeep: a fresh world with exactly
one school + one hospital reports `expenses.utilities = 2.5/tick` (1.1 + 1.4), and adding a second school moves it
to 3.6 — exact, `UPKEEP_UTILITY`-driven. (The isolated per-service A/B deltas in the builder's self-review are the
builder's evidence; I verified the wiring and the live direction, not a re-run of each coefficient.)

**Tools stamps — real player path, real money.** Clicking the HUD's `utility:school` / `utility:hospital` buttons and
clicking the canvas placed school `b418` and hospital `b419` at exactly the aimed 2×2 anchors; treasury went
**50,003.74 → 37,003.74 = −$13,000** (5,000 + 8,000) with toasts `School built, $5,000` / `Hospital built, $8,000`;
inspect card: `Civic · School #b418 · Level 1 · Height 12.9 m · Footprint 2×2 (4 cells) · Coverage radius 112 m`.
Toolbar fits at 1920×1080 (toolbar right 1671 < minimap left 1688, no overlap).

**Save/load — civic state round-trips exactly.** Using the real `/src/menu/serialize.js`: 60 buildings incl.
1 school + 1 hospital → `clearContent()` (edu 0, 0 schools) → `applySave` → **60 buildings, 1 school + 1 hospital
restored, edu/health recomputed to the identical 0.8913043478260869 / 0.23550724637681159**
(`after-load-aerial.png`). Coverage is correctly derived from the rebuilt world, no special casing needed.

**Demo seeding — exact.** The shipped demo city contains **8 schools + 4 hospitals** (4 districts × [1 fire,
1 police, 2 schools, 1 hospital]), giving **education 34.6% → HUD 35%, health 28.3% → HUD 28%**, matching the
builder's numbers and the r1 game batch.

**Known-planned (not counted as defects):** `?showcase=simulation` really stages **0 schools / 0 hospitals** and
its panel has no Education/Health rows at all (edu/health = 0) — this is Wave C6 staging work, confirmed, not a new
finding. The level-3 hard gate (most of the demo's 35 % coverage city caps at level 2) is also C6's retune target.

## Ranked issues (most damaging first)

1. **School/hospital side and back facades are bare — the civic buildings read as decorated boxes from most
   angles.** The school's classroom windows exist only on the two long (±z) faces; its ±x short faces are entirely
   windowless (a flat yellow panel with white bands — `plain-school-3q-day.png`, right wall; at night that whole
   side is dead, `plain-school-3q-night.png`). The hospital puts just two small ward windows on each side face of a
   14.5 × 7.4 m wall, so from three of four sides it is a plain white box (`plain-hospital-3q-day.png`). Why it
   hurts: the rubric's "living city / nothing reads as programmer art" bar expects glazing to wrap around a civic
   building, and a player orbiting either building sees blank plastic at close range. Fix (buildings
   `generateSchool`/`generateHospital`): add 1–2 framed window bays per short face (school) and a second window
   pair per long/side face (hospital), plus a small side service door on the hospital, reusing the existing
   `plainBox` frame/glaze helper and `winWarm`/`winCool` overlays so night behaviour stays consistent.

2. **Lit window panes blow out into uniform rectangles at close range — no mullion, no inset hot core.** The
   school's 2.7 × 1.75 m lit overlay fills most of a 3.6 × 2.5 m window, so at closeup range the front face is two
   giant yellow slabs (`plain-school-3q-night.png`) and the back face one pure-white pane
   (`plain-school-back-night.png`); the hospital's `winCool` ward windows clip to featureless white blobs
   (`hospital-closeup-night.png`, `demo-hospital-roof-night.png`). Why it hurts: at 15–25 m the glow is the whole
   facade, which reads as an emissive panel rather than a lit room; other building kinds survive this because their
   windows are smaller. Fix: split the school/hospital lit overlays into a 2 × 2 (or 2 × 3) grid of smaller inset
   panes separated by a dark mullion, or add a cross mullion over the glass; optionally drop `winCool` intensity
   for the hospital from 2.6 to ≈2.2 so it stops clipping to white.

3. **The school's glazed entrance does not read as glass by day.** In `plain-school-front-day.png` /
   `plain-school-3q-day.png` the `transClear` double door is the same value as the white portal around it, so the
   entrance reads as a blank white panel; only the red canopy says "door". Fix: tint the door glazing (transBlue or
   a darker `transClear` variant), add a visible frame + centre mullion, and darken the interior liner immediately
   behind the door so the glass has depth instead of reflecting the portal.

4. **The hospital cross goes black at night while its sign board blooms to a hot blob.** Day is crisp
   (`demo-hospital-front-day.png`): red cross on the white board. At night (`plain-hospital-front-night.png`,
   `demo-hospital-front-night.png`) `signGlow` (emissiveIntensity 3.0) clips and blooms over the cross, and the
   `brightRed` bars have no emissive, so the one identifying sign silhouettes dark-olive. Fix: give the cross bars a
   small red emissive (≈0.8–1.2) and/or reduce the board to ≈2.2 so the cross keeps its red against it.

5. *(informational, not civics-owned)* **Coverage decal / data-view overlay are heavy washes.** `inspect-school.png`
   shows the 112 m school coverage square as a ~0.9-opacity yellow glass plate that hides the ground studs beneath
   it; this is `tools`' existing `showCoverageRing` treatment (identical colour/opacity for power), not new civics
   behaviour, so it is not scored here. The `views` school/health layers themselves are excellent and exact
   (`after-school-view.png`, `after-health-view.png`).

6. *(adjacent, out of scope — report to integrator)* **Save/load does not preserve occupancy/population.**
   `after-load-aerial.png` shows Population 1,221 immediately after loading a save whose modal read 2,182; civic
   buildings and coverage do round-trip exactly. The loss is in `simulation.loadState`/`menu` (per-building occupancy
   is never serialized, so the first tick after load recomputes population from `startOccupancy`), not in civics —
   flagged here because this round-trip exposed it, do not score it against this feature.

## What already works

- **The simulation half of the feature is exact and independently verifiable.** 29²/33² Chebyshev grids, capacity-
  weighted percentages that match an independent recomputation from the public API to the last digit, per-building
  flags with 0 mismatches, HUD and Population modal agreeing with `stats`, and a gate that provably blocks level 3
  without a school and passes it with one (24/24 vs 0 candidates, 24×3 vs 24×2 after the real growth pass).
- **The player-facing wiring is clean.** Two toolbar buttons with hand-drawn icons, Coverage rows that double as
  view toggles, Education/Health rows in the Population modal, an inspect card that names the 112 m radius, correct
  $5,000/$8,000 costs and toasts, no toolbar/minimap overlap at 1920×1080, and zero console errors across every
  capture.
- **The buildings are recognisable and alive.** The school's yellow hall, white course bands, red-canopy entrance,
  brick bell tower, red pyramid cap and flag read immediately; the hospital's white ward block, backlit cross sign,
  ambulance bay, rooftop helipad with H and red beacon mast read immediately; both light up at night (warm
  classroom windows, cool ward windows, glowing sign, beacon) with no z-fighting, clipping or floating anywhere I
  looked, including on sloped terrain.

## Verdict

Contract, effects, upkeep, stamping, save/load and demo seeding all verify cleanly, and the simulation side is
above the bar. The building side is good-but-not-flawless: bare side facades and blown-out close-range window glow
are the two things that keep this from being indistinguishable from a shipped AAA brick game. Both are fixable in
`buildings`' two new generators without touching the contract. The known Wave C6 items (soften the level-3 gate,
stage civics in the simulation showcase) are confirmed but not double-counted. **Pass at 8.5.**
