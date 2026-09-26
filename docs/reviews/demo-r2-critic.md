# demo — round 2 critic review (B5/G8 starter-city pass)

**Score: 8.6 / 10 — PASS** (pass bar is score ≥ 8.5 AND `errors: []` AND inside the perf budget: all three
clear). r1's five headline defects are closed with visual evidence — the city is complete on the first drawn
frame, the suburb is inhabited, utilities are halved and off block centres, the highway has a real interchange,
and the built edge reaches the water with a pier. What keeps this from 9+ is one new tooling defect (the demo
*showcase* path seeds no bus loop, so the r2 module batch is not quite the shipped city), the fringe/belt half
of r1 issue 6 (5 fringe buildings city-wide; the belts still read as lawn), and a suburb that is uniformly
level 2 with lot occupancy still ~14 %.

## Perf / errors (load caveat applies to every absolute number)

All official captures ran with a GPU-heavy game (Star Wars Zero Company, 85–98 % GPU) alongside, so absolute
`gpuMs`/fps are ≈2× an idle machine (same pre-B5 code: 23.85 ms loaded in `r10-base-load` vs 10.77 ms idle in
`r9`). The only valid budget test is **B5 vs baseline under identical load**:

| batch | shots | minFps | maxGpuMs | maxDrawCalls | maxTris | errors |
|---|---|---|---|---|---|---|
| `shots/demo/r2` (B5 showcase city, loaded) | 28 | 42.5 | 16.02 | 708 | 21.3 M | `[]` |
| `shots/game/r10` (B5 full game, loaded) | 20 | 39.8 | 24.75 | 849 | 37.6 M | `[]` |
| `shots/game/r10-base-load` (pre-B5, same load) | 20 | 40.2 | 23.85 | 855 | 33.3 M | `[]` |
| `shots/game/r9` (pre-B5, idle reference) | 20 | 54.5 | 10.77 | 855 | 33.8 M | `[]` |

Per-shot paired delta (`r10` − `r10-base-load`, all 20 shots): **mean +0.72 ms**; worst +3.61 ms (`closeup-18`);
closeups +2.89/+2.89/+3.61; four shots got *faster* (`street-6.5` −1.92, `street-21.5` −0.80, `skyline-6.5`
−0.37, `skyline-12` −0.36). Triangles +4.3…+8.1 M per shot (mean +5.1 M, **+13 %**); draw calls −1…−20 (mean
−9); minFps −0.4 (noise). Idle-equivalent worst shot ≈ 10.8 + ~1.4 = **≈12 ms ≤ 20 ms**, 849 ≤ 1500 calls,
`errors: []` in all 48 official shots plus my own 3 probe boots — **budget PASS** once the load is normalised.

- Boot got **+4.0 s slower under load**: first game shot `readyMs` 15,599 → 19,622 ms; `[demo] city seeded in
  6132.7 ms` (loaded) vs ~4.2 s in r1. `settle()` now merges the whole city synchronously before `ready`; the
  boot screen covers it, but it is ~2× the design's own risk estimate (§9).
- The dedicated `waveB5` A/B pair (`perf-base-closeup-21h5` 21.09 ms / 27.5 M tris → `perf-closeup-21h5`
  26.27 ms / 35.8 M tris, same shot/tod) looks like +5.2 ms, but its *baseline* capture was taken while the
  pre-B5 city was still filling in (27.5 M tris then, 31.5 M by the time the base-load batch reached that
  shot). It prices B5's "pay all geometry at `ready`" trade, not steady-state cost; the paired batch delta
  above is the honest number.

## Boot: r1 issue 1 independently re-measured (not taken on trust)

`shots/demo/waveB5/boot-ready.png` (first drawn frame after `ready`) now shows **every district with full
geometry** — industrial warehouse rows, downtown towers, waterfront blocks, suburb houses. A pixel diff
against `boot-steady.png` (same camera, 5 s later) changes **16,311 / 2,073,600 px = 0.79 %**
(`waveB5/crit-diff-ready-steady.png`), and the changes are the HUD clock/counters plus the **zoning plates**
arriving (the industrial block floors go green→orange, the suburb lots tint in); no district, block or
silhouette appears or disappears. That is the "half-built for ~6.5 s" defect genuinely closed. The residual
0.12 s plate pop is invisible at ≥60 fps, and the 9,218 → 12,688 population growth is occupancy, not new
geometry (probe: demand r 0.28 sits below the buildings module's 0.3 auto-growth gate).

## Determinism — PASS (independently reproduced)

Two fresh game boots (seed 1, `fixeddt=1`), dumped at the same frame count, produced a **byte-identical
snapshot** (SHA-256 prefix `b5f9f0f10d19fa4f`): 441 buildings (375 zoned: r 254 / c 80 / i 41), 490 road
edges (highway 9 / avenue 25 / street 108 / path 348), 2,900 props, population 12,369, jobs 4,971, money
80,861, 0 unserved. The init log line is identical apart from the timing field:

`[demo] city seeded in 6132.7 ms: 490 road edges (incl. 9 highway, 2 ramps), 441 buildings (downtown 107,
industrial 41, waterfront 71, suburb 151, fringe 5), 508 park cells, 22 power plants + 24 water towers +
4 fire depts + 4 police stations + 8 schools + 4 hospitals, 6 bus stops + 1 bus line, warmed-up population
9218, 180 settled level-ups`

Power/water coverage 100 % with 0 unserved buildings confirmed live, as is the suburb count (151) and the
utility count (22 + 24).

## Contract check — PASS (two nits)

- `id:'demo'`, `deps:[…9 modules…]`, `order:5`, `showcaseVariants:['default','downtown']`, 7 presets (4 new
  district framings), `api.stats()`, `showcase()`, `dispose()`, no `update()` (intentional) — all intact;
  `buildings.api.settle()` documented in `ARCHITECTURE.md`.
- `grep Math.random src/demo/` → one comment-only hit (`citygen.js:686`), no call sites. Folder still exactly
  `index.js` + `citygen.js`. Only `src/demo/*`, `src/buildings/index.js` and `ARCHITECTURE.md` are modified —
  no writes outside the declared touch points.
- Nits: `src/buildings/index.js:202` points at `docs/reviews/demo-r2.md`, which does not exist (the builders'
  report was never written); `ARCHITECTURE.md` calls `settle()` "idempotent" while the implementation's own
  comment admits a second immediate pass over the same stale candidate list can double-level (safe only for
  the single current caller).

## The seven r1 issues, re-checked

| # | r1 issue | verdict | key evidence |
|---|---|---|---|
| 1 | Half-built city for ~6.5 s after `ready` | **FIXED** | `boot-ready` vs `boot-steady` diff 0.79 %, no geometry pop-in |
| 2 | Suburb ~70–85 % empty land | **LARGELY FIXED** | 63 → 151 buildings; `game/r10/aerial-12` vs `r10-base-load` twin |
| 3 | A utility pair in nearly every block | **FIXED (cadence residual)** | 62 (23 %) → 46 (10.4 %); lattice siting; 100 %/0 unserved |
| 4 | Highway is a dead-end edge sticker | **FIXED** | `demo_highway-12`: avenue + 2 one-way ramps, cars using them |
| 5 | Waterfront stops short of the water | **FIXED** | `wfLast 658`, built edge x=648 vs coast 688–768; pier present |
| 6 | Every block identical; featureless belts | **PARTIAL** | variety/plaza delivered; fringe = 5 buildings city-wide |
| 7 | Parks read as empty lawns (props' scope) | **IMPROVED** | 26 fountains, 1,162 hedges, 315 trees, flower beds in park rects |

Notes on the two partials:

- **#2**: 151 buildings meets the design's 150–200 target and the blocks now read inhabited (`demo_suburb-12`,
  `demo_suburb-18`). But the implementation uses `fillChance 0.42–0.62` where the design asked 0.7–0.9 / 0.78:
  the suburb has 1,089 zoned cells for 151 buildings (≈14 % lot occupancy, ~86 % of zoned area still open
  grass), and the probe shows **all 151 are level 2** — the 12 % L2 seed mix is levelled flat by the 600-tick
  warm-up + `settle()`, so the suburb is uniform 2-storey with no level-1/3 variety.
- **#6**: the within-district variety is real (22 m grid jitter, per-block gap/fill/stagger, plaza block with
  fountains and trees, industrial stagger). The fringe half is effectively absent: my probe found **5 fringe
  buildings city-wide** (the industrial↔suburb strips produced 0 — their `isCovered` gate rejects everything;
  the waterfront strips placed 4–5). The downtown↔waterfront belt is still lawn plus four small greenway
  squares (`game/r10/overview-12`, `aerial-12`) — the "districts look like islands" reading survives there.

## New / remaining problems (ranked)

1. **`showcase('demo','default')` is not the shipped city — no bus loop (new).** My probe's showcase log reads
   `0 bus stops + 0 bus line` while the game init log reads `6 bus stops + 1 bus line`: the stops placed in
   `init()` survive `world.clearContent()` and block re-placement via `MIN_STOP_SPACING_M` (14 m), so all 28
   shots of the official `shots/demo/r2` batch lack the demo-seeded transit loop (and inherit the init
   session's money/population). Design §7 claimed exact parity. Fix is small — clear transit stops/reset line
   state on content clear, or make the demo re-seed idempotent. Visually minor; procedurally it means the r2
   module evidence is not quite what ships.
2. **Fringe/belt half of issue 6 barely exists** (5 buildings; see above). The r1 fix text asked for sparse
   houses/sheds along the connectors; the belt reads as lawn at every tod.
3. **Suburb density/uniformity**: lot occupancy ~14 % and 100 % level-2 blocks — the aerial impression is
   still "half-green suburb", and the townhouse silhouettes are all the same height.
4. **Boot +4.0 s under load** (15.6 → 19.6 s) from the synchronous `settle()` + bigger city. Covered by the
   boot screen and not part of the stated budget, but it is the next thing a short attention span will notice.
5. **Doc nits** (dangling `docs/reviews/demo-r2.md`; "idempotent" `settle()` claim).
6. **Cross-module observation, not demo-owned (amplified, not introduced):** the unlit zoning plates are the
   night city's dominant light source, so the enlarged zoned area now glows as a full zone-colour grid
   (`game/r10/overview-21h5` vs `r1-critic-game/overview-21h5` — same look, more area); the empty-lot share in
   item 3 is what makes the night city read sparse.

## What works

- **The boot experience is fixed end-to-end and proven, not asserted**: `settle()` drains the warm-up backlog
  and flushes the batcher inside the boot screen; the boot diff shows no pop-in, construction flashes are
  suppressed for warm-up level-ups, and the module showcase now seeds the whole city (7 district presets, so
  the demo batch finally shows the content the module owns).
- **Districts are all legible at every tod**: downtown with one signature L3 tower block and level-2 street
  walls; orange industrial pad with per-block staging; waterfront rows 40 m off a real beach, promenade and
  pier (the dock gives the water a purpose); a jittered suburb with parks and a plaza; and a highway that now
  visibly feeds the avenue/industrial spine through a diamond interchange with traffic on the ramps.
- **Hygiene is intact**: determinism reproduced independently, contract untouched, no `Math.random`, no writes
  outside the declared files, `errors: []` across 48 official captures + 3 probe boots, and the load-normalised
  cost is +13 % triangles / +0.7–3.6 ms worst-shot for a city that is 22 % larger in buildings and 60 % larger
  in population.

**Verdict:** 7.3 → **8.6**. All five headline defects are closed with image + probe evidence; the remaining
0.9 to a clean AAA pass is the showcase transit gap, the unbuilt fringe belts, and lot-level suburb density —
next round's levers, named rather than absorbed.
