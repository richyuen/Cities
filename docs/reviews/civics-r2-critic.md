# civics — critic review, round 2 (Wave C6/F3: level-3 wealth route, showcase staging, civic facade fixes)

**Score: 8.7 / 10 — PASS (up from r1's 8.5)** — pass needs ≥ 8.5 **and** `errors: []` **and** inside perf budget;
all met. Every claim in `docs/reviews/civics-r2.md` is independently reproduced from fresh sessions, my own Node
probes and my own PNGs: the level-3 gate has a second route with the exact designed numbers (30 wealth ticks at
≥ 0.62, reset strictly below 0.58, `mature` still enforced, save/load can never grant it), the `simulation`
showcase stages exactly one school + one hospital in all three variants (panel/stats/grids honest), and all four
r1 building-craft items are genuinely fixed in the **full game** as well as the buildings showcase. The score
moves up because the four r1 issues are closed and the two planned C6 items land without regression; it is not
higher because two minor craft nits remain (below) and the wealth route is broad enough that level 3 is nearly
universal in a healthy city — a balance observation, not a defect against the design.

## Numbers (my own runs, idle GPU checked before every batch, one headless browser at a time)

| set | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| full game, `shots/civics/r2-critic/game/` (5 presets × 4 tods) | 20 | 63.4 | 15.42 | 847 | `[]` |
| `simulation` showcase, `shots/civics/r2-critic/sim/` (3 presets × 4 tods) | 12 | 143.4 | 5.61 | 103 | `[]` |
| `buildings` showcase, `shots/civics/r2-critic/buildings/` (3 × 4) | 12 | 143.6 | 6.86 | 299 | `[]` |
| civic craft, `shots/civics/r2-critic/craft/` (school/hospital, day+night) | 14 | 142.2 | 6.34 | 291 | 0 |
| full-game civic closeups, `shots/civics/r2-critic/game-craft/` | 10 | 65.4 | 13.88 | — | 0 |
| `node tools/check-civics.mjs` (re-run; rewrote `shots/civics/r2/`) | 13 | 141.6 | 6.45 | 292 | 0 |

- Budget (full city): minFps ≥ 50 ✓, maxGpuMs ≤ 20 ✓, drawCalls ≤ 1500 ✓; module budgets 103 / 299 calls ✓.
  Builder numbers reproduce within noise (game r15 63.4/15.22/847 → my r16 63.4/15.42/847; sim r6 143.9/5.64/103
  → my r7 143.4/5.61/103; buildings r4 143.6/6.76/299 → my r5 143.6/6.86/299). `nvidia-smi` read 9–27 %
  (desktop/overlay idle band) before each batch; `git status` clean before and after.
- `check-civics.mjs` **38/38** on my run (the builder report's Verification line and the integrator C6 entry say
  "36/36" — a typo; `summary.json` has always had 38 checks). Its gate runs: A=30, C=12, B=53, D=blocked,
  B2 band, two-run byte-identical; cross-boot staged-city hash **`4f8a0ec5`** and content hash **`513fc5e1`** —
  byte-identical to the builder's own run, i.e. the staged city is deterministic across independent launches.
- `errors: []`/0 in every one of the 44 batch shots, 24 craft captures and all probe sessions; `moduleErrors: {}`.

## Contract / behaviour checks (independently re-derived, not trusted)

**Level-3 gate — my own probe, 28/28.** `C:\Users\ryuen\AppData\Local\Temp\opencode\civics-critic-gate-probe.mjs`
drives `SimModel` on its own stub world (no `tools/check-civics.mjs` code) with a level-2 unschooled building,
occupancy ≥ 0.9, forced happiness trajectories:

| scenario | result |
|---|---|
| unschooled, happiness 0.65 held | candidate at **exactly tick 30** (wealthTicks 30, mature 30); no candidate at tick 12 or 29 |
| unschooled, happiness 0.4, 130 ticks | **no candidate**, wealthTicks 0 — the gate is still real |
| schooled (real school coverage), happiness 0.4 | candidate at **exactly tick 12**, wealthTicks 0 |
| occ dip below 0.9 after 33 accrue ticks | wealthTicks kept (33), mature reset to 0; next candidate only when mature reaches **20** — the `mature` requirement is still enforced on the wealth route |
| 0.58 exactly, then 0.65 | **holds** (candidate 10+5+20=35); 0.575 (< reset) clears the streak (46); 0.585 holds (35) |
| 0.60 constant; 0.619 constant; 0.619 after 10 high ticks | 0.60 never accrues (wealthTicks 0); 0.619 never accrues (0); after 10 high ticks 0.619 holds the 10 — no accrual, no reset (candidate 35) |
| 0.62 exactly | accrues (candidate 30) |
| two identical runs | `JSON.stringify(stats)` (723 B) and occupancy state (64 B) **byte-identical** |

Note on the boundary: the design says "reset when happiness drops below 0.58" and the code is `happiness < 0.58`,
so **0.58 exactly holds**; "0.58 exactly must reset" would contradict the documented hysteresis (0.58–0.62 is the
hold band, and the builder report/design both say so). Not a defect.

**Save/load — the wealth route can never be granted instantly.** `getOccupancyState()` rows carry only
`{id, occ, mature, notified}` (no `wealthTicks` key); restoring them into a fresh model leaves wealthTicks 0 and
the first post-load tick produces **0 candidates** even with mature 31 restored; the wealth route then needs 30
fresh ticks (candidate at post-load tick 30). In-page with the real `src/menu/serialize.js` on the full game:
449 buildings / 9 schools / 5 hospitals / edu `0.3077845907757931` / health `0.3473740335910424` / pop 15,322 /
money 68,405 — **identical before and after** `applySave` (A9's occupancy fix holds); `occHasWealth: false`;
`getGrowthCandidates()` 0 before and after. A load cannot add a level-3 candidate.

**Showcase staging / panel / grids — exact.** `?showcase=simulation` `default`/`boom`/`bust`, my own reads:
exactly **1 school + 1 hospital** in each variant, at the fixed blocks `SERVICE_BLOCKS` names — school at cell
(121,125), hospital at (129,125) for `i0=j0=115` (block `1,2` / `3,2`, both 2×2) — radii 14/16 cells. Education
92.3 / 91.7 / 90.7 %, health **100 %** in all three; `getCoverageGrid('school')` **841 = 29²**,
`('hospital')` **1089 = 33²** (the full Chebyshev squares). Panel `.sim-kv` rows read exactly the rounded stats
(`Education 92 %`, `Health 100 %`; bust `91 %`), captured in `sim-panel-default-day.png` /
`sim-civics-night.png`. Bust survives its 4,800-tick warm-up with money −130,593 and happiness 52 %: the civic
buildings are still staged and coverage still reads (they are buildings, not budget lines). Cross-boot: fresh
reload of the same URL re-hashes **identical** (`full` and id-free `content`), reloaded education/health equal.

**Facade items 1–4 — verified by eye on both showcases and the full game** (PNG names I actually opened):
1. *Bare side/back facades:* school ±x bay present (`craft/school-side-day.png`, `craft/school-side-night.png`,
   `game-craft/school-34-day.png` — right wall shows the 2×2 bay); hospital **4 ward bays per ±x face**
   (`craft/hospital-side-day.png`, `game-craft/hospital-34-day.png`), **2 back (-z) bays** and the side service
   door (`craft/hospital-rear-day.png`, `craft/hospital-service-door-day.png`). The r1 "decorated box" read is
   gone from three of four sides.
2. *Blown-out lit panes:* school night front shows a **2×2 lit grid with a visible dark cross mullion**
   (`game-craft/school-front-night.png`, `craft/school-front-night.png`) — the r1 "one emissive slab" is gone;
   hospital ward panes are a **2×1 vertical grid with a mullion** (`game-craft/hospital-34-night.png`,
   `craft/hospital-side-night.png`). Still bright at the hottest core, but structured.
3. *Entrance glass:* school double door is tinted `transBlue` with a `darkStoneGrey` liner, white frame, centre
   mullion and red canopy (`game-craft/school-front-day.png`); the hospital's big bay got the same treatment
   (`game-craft/hospital-front-day.png`) — both read as glass by day, not white-on-white.
4. *Hospital cross:* reads red against the glowing board at night (`game-craft/hospital-front-night.png`,
   `craft/hospital-front-night.png`); `crossGlow` emissive is `t × 4.2` (≥ 4 per ARCHITECTURE §7) and `signGlow`
   is 2.2 (was 3.0) in `src/buildings/index.js`. The hottest part reads coral-red under ACES — the known accepted
   red drift, identity unmistakable.

**The wealth route fires in the shipped demo.** At boot the demo has **110 level-3 RCI buildings, 74 of them
unschooled** (pre-C6 impossible — level 3 required school coverage at level-up time, and the demo never removes a
school). Happiness 0.72, so the 600-tick boot warm-up lets unschooled buildings accrue 30 ticks and `settle()`
applies them. This is the retune working end to end in the real game, not just in a probe.

**Demo seeding / HUD honesty / real toolbar.** Demo has **8 schools + 4 hospitals** (unchanged from r1); HUD
Coverage reads **School 29 % / Health 33 %**, matching `getStats()` `0.2911223673687017 / 0.32937883231138365`
to the displayed digit. Real toolbar path (HUD `utility:school` / `utility:hospital` button + canvas click, via
the tools pointer handlers): toasts `School built, $5,000` and `Hospital built, $8,000`; treasury deltas are
**exactly** `net/tick − 5,000` (81,178 + 75.9588 − 5,000 = 76,254) and `net/tick − 8,000`
(76,254 + 75.2536 − 8,000 = 68,329). Upkeep/effects spot check (Node, stub city): utilities expense is exactly
2.25 / 3.35 / 3.65 / 4.75 per tick for none / +school / +hospital / +both (= `UPKEEP_UTILITY` sums); health
raises happiness and demand.r, education raises happiness and demand.c/i, hospital does not lift demand.c.

**Determinism / no new randomness.** No `Math.random` in any C6-touched file (the only real calls in `src/` are
the two out-of-scope menu uses); cross-boot staged-city hashes identical (my own mixing, and byte-identical to
the builder's `4f8a0ec5`/`513fc5e1`); Node two-run stats byte-compare identical.

**Global material tweaks (`winCool` 2.4, `signGlow` 2.2) — no regression seen.** Spot-read night shots of
non-civic buildings: `game/closeup-21h5.png`, `game/street-21h5.png` (HUD shows the honest 29 %/33 %),
`buildings/buildings_closeup-21h5.png`, `buildings/buildings_levels-21h5.png` — warm/cool windows and shop signs
still read; the batches are inside budget with 0 errors. (I did not pixel-A/B every building kind.)

## Ranked issues (most damaging first)

1. **School window bays without a lit overlay still read as blank pale panels by day.** `src/buildings/generator.js`
   `generateSchool` (~l.760–774): each bay is a solid white frame box + `transBlue` glazing with nothing dark
   behind it, unlike the entrance, which got a `darkStoneGrey` liner. With `rng.chance(0.55)` false (~45 % of
   bays) there is no lit overlay and the bay reads white-on-white — the r1 item-3 symptom surviving on the window
   bays; within one facade the two bays read differently (`game-craft/school-front-day.png`: right bay = 2×2 grey
   mullioned panes, left bay = blank pale panel). Why it hurts: at street range it reads as a blank plaque, not
   glass, on the feature's most-seen civic building. **Fix:** add the same dark liner behind each bay glazing
   (one `plainBox(parts,'darkStoneGrey', …, z ± 0.10)`) or always emit the lit overlay.
2. **Hospital lit overlay is oversized relative to its glazing.** `litPaneGrid(parts,'winCool', 1.45, 2.0, 2, 1, …)`
   over a 1.6 m-tall × 2.2 m-wide `transBlue` glazing: the 2.0 m pane grid spills 0.2 m above and below the glass
   onto the light-stone frame. By day the spill reads as black bands above/below the blue pane, visibly different
   from the bays without the overlay (`craft/hospital-side-day.png` bays 3–4, `craft/hospital-rear-day.png`); at
   night the lit area covers the frame's top/bottom edge. **Fix:** size the grid inside the glazing (e.g.
   `1.45 × 1.35`), matching the school's inset logic (school: 2.7×1.75 inside 3.1×2.05 — correct).
3. **`citygen.js` comment / builder claim "do not consume rng, so the rest of the layout is unchanged" is
   inaccurate.** `SERVICE_BLOCKS` itself adds no rng call, but the branch `continue`s before that block's park/lot
   draws, so every later block re-rolls. My probe (real `SERVICE_BLOCKS` vs a text-patched empty copy, same
   `seed 1` rng): 190 vs 207 non-service buildings, first divergence at non-service building #78, and the rng
   stream tail differs. Determinism is unaffected (cross-boot hashes identical, no `Math.random`), and the design
   never promised pre-C6 layout stability — this is a comment/claim accuracy fix only. **Fix:** reword to
   "consumes no *new* rng; blocks after a service block re-roll because that block's draws are skipped".
4. **Doc typo: `check-civics.mjs` is 38/38, not 36/36.** `docs/reviews/civics-r2.md` (Verification section) and
   the integrator C6 entry both say 36/36; the tool and its `summary.json` have 38 checks (my run: 38/38). One-line
   correction.
5. **Balance observation (design-sanctioned, owner call):** with 30 ticks at ≥ 0.62 and a 600-tick boot warm-up,
   74 of the demo's 110 level-3 residential buildings are unschooled — in a healthy city level 3 is nearly
   universal and the school is a *speed* route rather than a gate. The design explicitly wanted the fallback, so
   this is not scored; flag only if level-3 scarcity is meant to matter.
6. *(informational)* **The demo's coverage percentages moved (35 %/28 % in r1 → 29 %/33 % now)** and are not
   comparable to r1: Wave B5 rebuilt the demo city after that round, and the wealth route changed the level mix
   (more level-3 capacity outside school coverage). The durable claims hold: 8/4 seeding and HUD == stats to the
   displayed digit.

## What already works

- **The gate is exact, deterministic and documented.** Both routes, the hysteresis band, the `mature` requirement
  after an occupancy dip, and the "load restarts the streak, never grants it" property all reproduce on my own
  probe; the constants live in one commented block; ARCHITECTURE §7's contract line matches the code.
- **The showcase staging is minimal and honest.** Two fixed 2×2 buildings, no new rng source, exactly one of each
  in every variant (including the bankrupt bust), full Chebyshev grids (29²/33²), and the panel's new
  `Education`/`Health` rows read the rounded stats exactly.
- **All four r1 building items are genuinely fixed**, in the buildings showcase *and* the full game: side/back
  bays, mullioned lit grids, tinted framed entrances with liners, and the glowing red cross against a calmer board.
- **Player-facing wiring is clean:** $5,000/$8,000 with exact toasts, upkeep exact, effects in the right
  direction, save/load round-trips (population/levels/coverage/money), no new `Math.random`, zero console errors
  across 68 captured frames + probes.
- **Perf holds with headroom:** 63.4 fps / 15.42 ms / 847 calls worst case; module batches ~5.6–6.9 ms / 103–299
  calls; the global `winCool`/`signGlow` tweaks cost nothing and show no night-read regression in the batches.

## Verdict

The C6 work is exactly what the design asked for and the r1 defects are closed: the gate is reachable through
sustained happiness with the documented numbers and cannot be cheated by a load, the `simulation` showcase finally
reads non-zero education/health in stats, grids and the panel, and the civic buildings hold up at close range from
every side in the real game. The two remaining nits are cosmetic (a blank unlit school bay by day, an oversized
hospital lit overlay) and the rest is documentation/balance commentary. **8.7 / 10 — PASS.**

**Explicitly NOT verified here:** I did not re-run the builder's exact `shots/simulation/r6`, `shots/buildings/r4`
or `shots/game/r15` dirs (my r7/r5/r16 re-runs reproduce them within noise); no live full-game A/B isolation of
each effect coefficient (Node stub A/B + code read only); the hospital's rear bays were verified on the buildings
showcase and in source, not in a clean full-game rear framing (my game rear shot framed the roof); the global
`signGlow`/`winCool` changes were spot-checked, not pixel-diffed, on every non-civic kind; the wealth route was not
driven end-to-end in the browser with a controlled happiness trajectory (Node probe + the demo's 74 unschooled
level-3 buildings + the save/load round trip are the browser-side evidence).

*Evidence sets: `shots/civics/r2-critic/` (game 20 + sim 12 + buildings 12 + craft 14 + game-craft 10 +
`probe.json`), `shots/civics/r2-builder/` (the builder's untouched copy), `shots/civics/r2/` (my check-civics
re-run); probe scripts under `C:\Users\ryuen\AppData\Local\Temp\opencode\`. Nothing in `src/` or `tools/` was
modified; `shots/` is gitignored — this review and STATUS are the record.*
