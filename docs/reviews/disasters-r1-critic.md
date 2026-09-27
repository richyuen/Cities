# disasters — critic review, round 1 (Wave D2 / F9: tornado)

**Score: 7.5 / 10 — FAIL** (pass needs ≥ 8.5, `errors: []`, inside the perf budget)

The module is mechanically complete and I reproduced every functional claim from fresh sessions with my own
script: the real toolbar spawns one tornado at a time, it travels at exactly `SPEED × game-time`, damage rises
inside `CORE_R` and is zero beyond `OUTER_R`, pause freezes it, 4× scales it, the storm despawns at `LIFE_SEC`,
the cost line returns to exactly 0, buildings repair at `FIRE_REPAIR_RATE`, save/load round-trips the funnel and
every damage scar, the layout is deterministic across boots, and the game batch is unchanged from r22. Two defects
keep it from a first-round pass:

1. **The treasury is billed twice the advertised ledger.** `src/disasters/index.js:138` pushes
   `S.pendingCost / TICK_DT` — which is `$/game-second` — into a slot the simulation defines as `$/tick`. Measured
   over two independent full storms: charged/intended = **2.000** both times ($35,288 paid vs $17,644 accrued in
   the clean run). The Treasury row is 2× too, so the design's "$900 per fully wrecked building" is actually
   **$1,800**, silently.
2. **The funnel does not read as a tornado on the ground at any shipped camera.** In the overview presets it is a
   small dark blob behind/above the showcase's own tower; at ground/closeup the base, debris ring and dust disc are
   occluded or sub-pixel and the visible part is a sparse column of separated cubes; at night it nearly vanishes;
   and nothing in the city reads as *being hit* (the design-deferred per-building damage visuals). I opened all 12
   batch PNGs plus dawn/night and the builder's chase stills.

The remaining levers are named below: the one-token unit fix, then a ground-seated funnel + damage tell
(the design's own next-lever list), then a paused-spawn visibility fix.

## Numbers (my own runs, one headless browser at a time, `nvidia-smi` checked before each)

| batch | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `shots/disasters/r2-critic/storm/` (3 presets × 4 tods) | 12 | 143.7 | 6.74 | 551 | [] |
| `shots/disasters/r2-critic/idle/` (default variant) | 12 | 142.9 | 6.77 | 503 | [] |
| `shots/disasters/r2-critic/game/` (5 × 4, r25) | 20 | 62.0 | **15.54** | 847 | [] |

- **Budget: PASS.** All three sets inside ≥ 50 fps / ≤ 20 ms / ≤ 1500 calls; the game r25 numbers are the r22
  record within noise (62.0/15.66/847 → 62.0/15.54/847), i.e. the module costs an idle city nothing. Builder
  batch numbers reproduce exactly (storm 143.6/6.77/551, idle 143.4/6.75/503, game r24 64.6/14.89/847) — the
  showcase is deterministic shot-for-shot.
- **Functional probes** (my scripts, `C:\Users\ryuen\AppData\Local\Temp\opencode\disasters-*-probe.mjs`; evidence
  `shots/disasters/r2-critic/probe.json` + `probe-clean.json`): the two probe "fails" are the intentional billing
  ratio (E4) and one probe-design artifact (E7 — every core building was already at cap from the previous storm;
  the clean-city re-run measures 12/12).
- `Math.random` in `src/disasters/*`: **0 hits**. Cross-boot storm-layout hash (funnel + debris instance matrices
  at spin-time 0) `4b2ad6f3` on two fresh boots — identical (different mixing from the builder's `65291823`, same
  conclusion). `window.__city.stats().errors` empty at the end of every probe; captures all `errors: 0`.
- gpuMs is truth; idle desktop GPU read 22–30 % before each batch on an RTX 4070 Ti.

## Re-derived behaviour (exact numbers from my sessions)

| check | measurement | verdict |
|---|---|---|
| toolbar spawn + one at a time | `button[data-tool="hazard:tornado"]` exists; canvas click spawns exactly 1 at (0.0, 2.0); a second click while live is refused | **PASS** |
| travel = SPEED × dt | per-tick step median **5.500 m** at 1× (min=max=5.500); end-to-end **49.5 m in 4.5 game-s** = exactly `11 × dt`; direction constant (0.9487, 0.3162) | **PASS** |
| 4× scales | game-seconds per wall second 1.41 → 6.18 = **4.40×** | **PASS** |
| damage in the core | clean city: **12/12** undamaged buildings that the funnel passed within 30 m gained damage; a controlled storm applied **20.31** damage units over 42 ticks with `b.damage` capped ≤ 1 (max 0.9637 in the clean run) | **PASS** |
| zero damage past OUTER_R | **0 of 411** buildings whose minimum funnel distance exceeded 70 m gained any damage (two independent runs: 0/451, 0/411) | **PASS** |
| billing | a tick with **0.12285** damage applied pushed **203.70** — that is `× 900 / 0.5` (per game-second, 221.13 expected, 8 % boundary), not `× 900` per tick (110.57); over full storms charged/intended = **2.000** and **2.000** | **FAIL — 2×** |
| Treasury row | present ("Disaster costs / day"): $244,440/day at the dense-block peak, $2,812/day two game-seconds later once the funnel left the block — a live *rate*, honest as a rate but 2× the intended ledger | **PASS (row), FAIL (rate)** |
| pause | x/z/age bit-identical over 90 paused frames; zero damage accrued while paused | **PASS** |
| lifecycle | one `disaster:ended`, gone within `LIFE_SEC`; `stats.disasterCost` and `budget.perTick.expenses.disasters` return to **exactly 0**; `perDay` 0 | **PASS** |
| repair | 36.985 → 28.001 total damage over 600 forced ticks (49 damaged; the 8.985 drop vs 9.8 nominal is buildings hitting 0 and stopping) | **PASS** |
| storm cost bound | clean full storm: **19.60** damage units → **$17,644** at $900/unit ($35,288 actually charged); first controlled storm 20.31 units ($36,179 charged); no run exceeded $36k — bounded, but at 2× the advertised price | **PASS with the 2× caveat** |
| save/load | `serializeSave` carries 1 tornado; `clear()` empties; **loading twice still spawns exactly one**; x 768.89→768.89, age 34.2→34.2, direction exact; **51/51** damage scars restored within 0.02 | **PASS** |
| idle cost | full game draw calls 747 → 752 while a tornado is active → 747 after `clear()` (+5, not the documented +3; three meshes + shadow-pass draws); game batch 847 calls == r22 | **PASS** |

## The funnel from the PNGs I actually opened

(`shots/disasters/r2-critic/storm/*.png`, `.../idle/disasters_overview-12.png`, plus the builder's
`r1-storm` night set and `d2/storm-chase-*`.)

- **Overview (6.5/12/18/21.5)**: the funnel is a **small dark cluster at the top of the district's tallest tower** —
  the showcase spawns it at the district centre, where a level-3 tower stands, so the tower eats most of the column
  and only the wide top rings poke out above the roof. It is not legible as a tornado at the shipped overview
  camera; the city around it looks completely normal.
- **Closeup**: the best of the three — a column of dark boxes descends between the towers — but the boxes read as
  **separated falling cubes**, not a vortex, and the column's visible bottom ends around a mid-rise roofline. I
  could not find the debris ring or the dust disc in the frame; the streets around the base are clean.
- **Ground**: boxes from the top of the frame down to about tower mid-height, ending in mid-air; foreground
  low-rises occlude the base. No z-fighting and no camera clipping (the closeup crops the funnel top, a framing
  choice), but the ground story is absent.
- **Night (21.5)**: the funnel disappears into the dark; only a few dark cubes against lit facades remain. The
  chase stills (dusk/day) show the same sparse-cube read with the base hidden behind buildings.
- **"City being hit"**: no. No damage tell on any building (the design defers per-building damage visuals; batch
  staging also pauses the clock, so showcase scars would not show anyway), and warning-icon litter is not fully
  solved: I count **1 ⚠ in closeup-12 and 2 ⚠ in ground-12** despite the serviced showcase (the builder reported
  "one can remain").
- Idle shots are clean and unchanged — nothing of the module is visible without a storm.

## Ranked defects (file + fix)

### 1. Cleanup/insurance bills 2× the ledger (player-visible economy)
- **What**: `src/disasters/index.js:138` — `sim.api.setDisasterCost(S.pendingCost / TICK_DT)`. `pendingCost`
  accrues `damageApplied × $900` between two `sim:tick`s, i.e. it *is* already the `$/tick` value the simulation
  documents (`simulation/index.js:108-111`, `model.js:187`). Dividing by `TICK_DT 0.5` converts it to
  `$/game-second`, which the budget then charges once per tick and multiplies by 1200 for "per day". Measured:
  a tick that applied 0.12285 damage pushed 203.70 instead of 110.57; two full storms charged exactly 2.000× the
  accrued ledger ($35,288 vs $17,644); the Treasury row reads 2× the honest rate.
- **Fix**: push `S.pendingCost` (delete `/ TICK_DT`). Then a fully wrecked building costs $900 end-to-end and the
  Treasury row halves. `tools/check-disasters.mjs` should also assert `Σ charges ≈ damage × 900` (its current
  `cost > 0 && cost == budget` passes at 2×), or the fix can regress silently.
- **Reach**: every player who uses the hazard; the design and builder report both state $900/unit, so the shipped
  behaviour contradicts its own contract.

### 2. The funnel is not a convincing ground tornado; the city never reads as hit
- **What**: from the showcase's own presets, the funnel's visible part is a sparse airborne cube column; base,
  debris ring and dust disc are occluded or sub-pixel in all three cameras; the funnel is hidden behind the
  showcase's tower from overview; at night it is nearly invisible; no building shows damage.
- **Where**: `src/disasters/visuals.js` (funnel radius/box density/ground contact, debris ring placement hidden
  inside buildings), `src/disasters/index.js:122-126` + `showcase()` (spawn point under the tallest tower, presets
  framed to look at it), and the design's deferred per-building damage visuals.
- **Fix (next lever, in order)**: (a) ground the funnel — wider/steadier low rings, a visible skirt of debris with
  clear ground contact and a dust collar that reads from the provided cameras; (b) move the showcase spawn off the
  tower footprint and recompose `overview`/`ground` so the base is in frame; (c) per-building damage tell
  (the design's first named follow-up: collapsed roofs/debris decals on the tile), so the still and the live city
  both read as *being hit*. This is a visuals/showcase pass, not a redesign.

### 3. A tornado spawned while the clock is paused is invisible
- **What**: `update()` gives `gdt = 0` while paused, so `age` stays 0 and `strengthFor(0) = 0`; `visuals.update`
  clamps `st` to `0.001` and then sets `group.visible = st > 0.01` → false. A player who pauses, selects Tornado
  and clicks gets the toast "🌪 Tornado on the ground!" and **nothing on screen** until they unpause (then it
  fades in over ~2 frames). Unpaused play is unaffected.
- **Where**: `src/disasters/visuals.js:76-80` (`st = Math.max(0.001, …)`, `visible = st > 0.01`).
- **Fix**: enforce a small minimum visual strength (`st = Math.max(0.12, …)` or `visible = !!active`) so the
  funnel is drawn from the first frame regardless of clock state.

### 4. Showcase warning icons (minor)
- **What**: `ground-12` shows 2 ⚠ unserved icons, `closeup-12` 1, despite the 4 servicing buildings — `stageCity`
  centre-of-block lots can be road-unconnected (pre-existing), and the "one can remain" caveat in the report
  under-counts it.
- **Fix**: leave the staging quirk alone; optionally spawn the district with the funnel over a road-connected block
  (also helps defect 2).

### 5. Process/minor (informational)
- `clear()` zeroes `pendingCost` (`index.js:57`), discarding up to one tick of accrued damage on a manual clear —
  player-favourable, but it means `clear()` and despawn are not equivalent; note it if the ledger must balance.
- `loadState` accepts any number of tornadoes from a crafted save (`index.js:99-106`) and does not validate
  finite `dirX/dirZ`; the game itself never writes >1 (`MAX_ACTIVE 1` enforced in `spawn` only). A one-line
  `slice(0, MAX_ACTIVE)` + finite check closes it.
- The design claims "+3 draw calls while active"; the full game measures **+5**. Still trivial, but the number in
  the design/ARCHITECTURE is the low one.

## What already works

1. **The hazard loop is real and complete**: toolbar → click → travel on the wind → capacity damage → treasury
   line → free repair → despawn → cost exactly 0, with one-at-a-time enforced and the tool refusing a second
   spawn. All re-derived independently.
2. **Movement is exact**: `SPEED × game-time` to the metre at 1×, constant direction, pause freezes it bit-perfect,
   4× scales the clock (4.40× measured), and it rides the existing `b.damage`/`FIRE_*` model so no new capacity
   machinery was invented.
3. **Save/load is the cleanest part**: funnel state + 51/51 scars round-trip, and applying a save twice cannot
   double-spawn (`loadState` clears first).
4. **Determinism and cost hygiene**: no `Math.random`, cross-boot layout hash identical, zero idle cost
   (747→747 calls, game r25 == r22 within noise), every batch and probe `errors: []`.

## Verdict

**7.5 / 10 — FAIL.** The functional contract is met and the module is honestly built on existing systems, but a
first-round pass cannot stand on an economy that silently bills double its stated price, with a hero visual that
is unreadable from two of its three shipped cameras and invisible at night. Both have named, cheap levers (one
token for the unit fix; a ground-anchored funnel + per-building damage decals + showcase reframe for the visual),
and the round must not be silently absorbed — re-run after the fix and re-score.

## What I did NOT verify

- Per-building capacity loss read from `stats.capacity` end-to-end; I read the model formula
  (`CAPACITY × (1 − 0.8 × damage)`, `model.js:483`) and measured `b.damage` directly, not the downstream population.
- The half-rate on burning buildings (`b.onFire ? 0.5`) — source-read only, no A/B fire+tornado probe.
- Dedicated tornado audio (there is none by design; the spawn uses the existing `error` sfx — not listened to).
- The real menu Load path; I called `serializeSave`/`applySave` directly, as the builder's check does.
- Regression impact on modules beyond the whole-game batch r25 (transit/traffic/props etc. were not re-probed).
- Earthquake extensibility of the API (out of scope by owner decision).
- GPU numbers under a fully idle desktop: the RTX 4070 Ti read 22–30 % background utilisation before every batch
  (same caveat as prior rounds); `gpuMs` deltas are the comparison and r25 vs r22 is within 0.12 ms.

*Evidence: `shots/disasters/r2-critic/{storm,idle,game}/`, `probe.json`, `probe-clean.json`; probe scripts under
`C:\Users\ryuen\AppData\Local\Temp\opencode\`. Nothing in `src/` or `tools/` was modified. `shots/` is gitignored —
this review and `docs/STATUS.json` are the record.*
