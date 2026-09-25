# demo — round 1 review

**Score: 7.3 / 10 — FAIL** (pass bar is score ≥ 8.5 AND `errors: []` AND inside the perf budget; perf/errors clear,
score does not)

The module contract is clean, the city is deterministic, and the layout reads as four distinct districts — but as a
*product* the seeded starter city has three demo-owned problems: it is visibly half-built for the first ~6.5 seconds
after `ready`, its residential suburb is ~70–85% empty land, and utility pairs are sited in almost every block
(including downtown and the suburb). Plus a highway that is a dead-end edge sticker and a waterfront that stops
~70–150 m short of the water. That is "good indie layout, clearly lower fidelity than a shipped AAA starter city",
not AAA-with-nits.

## Perf / errors (both official batches: `errors: []`)

| batch | shots | minFps | maxGpuMs | maxDrawCalls | maxTris | errors |
|---|---|---|---|---|---|---|
| `shots/demo/r1-critic/summary.json` (showcase, demo:default/closeup/overview × 4 tods) | 12 | 143.4 | 6.83 | 565 | 11.1 M | `[]` |
| `shots/demo/r1-critic-game/summary.json` (full game, 5 presets × 4 tods) | 20 | 55.2 | 11.2 | 860 | 33.5 M | `[]` |

Both inside budget (≥50 fps, ≤20 ms, ≤1500 calls). Note the game batch's minFps 55.2 is the first shot of the batch
(`overview-6h5`) — the same boot window flagged in issue 1; every other game shot is 85–144 fps. Functional session
(2 boots + 7 extra captures) also finished with `stats().errors === []`.

## Determinism — PASS (strong)

Two independent full-game boots, seed 1, custom harness (`demo-functional`, temp): all 13 count groups identical —
roads 447 (highway 8 / avenue 17 / street 96 / path 326), buildings 360 (including 62 power/water + 20 civic),
props 2018, population 8,288, jobs 4,592, money 36,259, plus per-district stats — and the normalized
`[demo] city seeded…` log line identical:

`447 road edges (incl. 8 highway), 360 buildings (downtown 105, industrial 43, waterfront 67, suburb 63), 276 park
cells, 31 power plants + 31 water towers + 4 fire + 4 police + 8 schools + 4 hospitals, 6 bus stops + 1 bus line,
warmed-up population 8288`

(District totals exclude the 82 civic/utility buildings; 278 zoned + 82 = 360.) Seeding time ~4.19 s on both boots.

## Contract check — PASS

- `id:'demo'`, `deps:['terrain','environment','roads','zoning','buildings','props','traffic','simulation','transit']`,
  `order:5`, `showcaseVariants:['default']`, `presets` demo:default/closeup/overview, `api.stats()`, `showcase()`
  and `dispose()` all present and match `ARCHITECTURE.md`. No `update()` — intentional (module owns no per-frame
  work) and tolerated by `registry.js:139`.
- `grep -rn "Math.random" src/demo/` — one comment-only hit (`citygen.js:574`), no call sites.
- Folder contains exactly `index.js` + `citygen.js`. No files written outside `src/demo/` while testing (grep/diff clean).
- Informational: the demo *showcase* deliberately stages downtown only, so the module's own 12 showcase shots never
  show the suburb/industrial/waterfront content that the module actually owns; the full city only appears in
  `--game` shots. Deliberate per the module comment, but weak as "tooling parity".

## Ranked issues (most damaging first)

### 1. Fresh boot renders a half-built city for ~6.5 s (`ready` fires before the city is drawn), and demo's warm-up makes it worse
**Where:** `shots/demo/r1-critic-extra/boot-ready-incomplete.png` (exactly frame 4, the moment `__city.ready` flips
and the HUD appears: downtown/waterfront/suburb blocks are bare zoning plates, only industrial + a few towers exist);
`shots/demo/r1-critic-extra/downtown-park.png` and `suburb-street.png` (captured in the same window — floating stud
lattices and detached red dashed ribbon fragments in the sky); temp `diag-boot-fillin` trace.
**Measured:** at `ready` 10.45 M tris / 206 draw calls / 4.7 fps → frame 68: 20.7 M / 769 / 15.6 fps → frame ~350:
22.3 M / 783 / 142 fps. The city needs ~6.5 s of wall time after the HUD is up to finish appearing (fps 5–16 for the
first ~3.5 s of it). On top of that, `buildCity()` is a 4.19 s synchronous seed before `ready`.
**Why it hurts:** REFERENCE.md item 5 — "Nothing pops in visibly" — is violated on the very first thing a player or
judge sees; early screenshots can also catch non-existent stud/ribbon geometry, poisoning evidence.
**Root cause / ownership:** buildings' time-sliced chunk rebuild (`REBUILD_BUDGET_MS`) is the mechanism, but the
demo's 600-tick warm-up queues 100+ level-ups that trigger a second, post-`ready` regeneration wave — game-r4 already
documents that dip as demo-triggered. So demo is not the only owner, but it is the trigger.
**Fix:** drain the boot backlog before `ready` (let buildings complete its initial build inside the boot screen), or
have demo warm up simulation *before* the buildings are spawned and reduce the 600-tick fast-forward to a smaller
burst; acceptance: tris/draw-calls at `ready` equal the steady-state values.

### 2. The suburb is ~70–85% empty land — density graduation collapses north of the city
**Where:** `shots/demo/r1-critic-game/aerial-12.png` (rows of big green plates with one utility pair each),
`shots/demo/r1-critic-extra/city-oblique-sw.png`, `shots/demo/r1-critic-extra/suburb-street.png`,
`shots/demo/r1-critic-game/overview-18.png`.
**Why it hurts:** 63 zoned buildings across 10 blocks of ~200×170 m (~0.34 km²) is a built footprint of roughly
1.5% — the district reads as surveyed vacant lots with a shed and a water tower, not a starter neighbourhood. The
contrast against downtown (105 buildings in 16×90 m blocks) makes the map look unfinished rather than graduated.
**Fix:** `fillBlock(..., { gap: 4, fillChance: 0.32 })` → `gap: 2, fillChance: 0.75+`, and subdivide the 170 m-deep
blocks (add an interior z-line, e.g. z=-300, or shrink `SUBURB_Z`'s span) so the lot pitch is ~100 m; target
~150–200 suburb buildings with gardens/hedge props.

### 3. Utility over-siting: a power plant + water tower in nearly every block, downtown and suburb included
**Where:** `shots/demo/r1-critic/demo_closeup-21h5.png` (two water towers and a plant in the downtown closeup
foreground), `shots/demo/r1-critic-extra/industrial-spine.png` (a pair per block), `aerial-12.png`,
`city-oblique-sw.png`.
**Measured:** 31 power plants + 31 water towers + 20 civic = 82 non-zoned buildings for 278 zoned lots (23% of all
buildings). By block: suburb 10/10 blocks, industrial 6/6, waterfront 6/8, downtown 9/15 (`utilityStride` = 1 in
the suburb and industrial because `WATER_RADIUS` 14 cells ≈ 112 m cannot bridge a 200 m block pitch).
**Why it hurts:** "generated" tell of the strongest kind — a nuclear-plant cadence of industrial utilities sitting in
residential and prime downtown blocks; the downtown hero closeup is framed around a water tower. A shipped city
would site power/water on the edge of town or in the industrial zone.
**Fix:** drop to one pair per ~2×2 blocks (raise the stride / drop the forced last index), site `power_plant` on
district-edge or industrial land (the ring search already tries corners first for services — do the same for power),
and accept 80–90% HUD water coverage for a starter city (or raise `WATER_RADIUS` if 100% must hold).

### 4. The highway is a dead-end edge sticker, not a highway
**Where:** `shots/demo/r1-critic-extra/highway-west.png` (street level: reads as another 4-lane avenue with a yellow
centre line, ending in nothing), `city-oblique-sw.png` and `aerial-12.png` (a single straight line across the
suburb's north edge).
**Why it hurts:** `HIGHWAY_X` is one line at z=-560 from x=-820 to 650, doubling as the suburb's north boundary;
it has no interchange and no connection to downtown or the industrial zone, so the rubric's "grid + arterials + a
highway" hierarchy is not delivered — the "highway" is decoration.
**Fix:** give it two real connections (upgrade the existing industrial↔suburb connector at x=-480 to an
avenue/interchange; extend it along the west edge down to the industrial pad, or continue the x=0 spine onto it) and
at least one ramp pair so traffic can actually use it.

### 5. The waterfront district stops 68–148 m short of the water
**Where:** `shots/demo/r1-critic-extra/waterfront-connector.png`, `city-oblique-sw.png` (green buffer and beach
between the last building row and the bay), stats: coast at x=688–768, built edge clamped to x=620.
**Why it hurts:** a district labelled "waterfront" that never touches the water reads as a greenbelt; the promenade
path exists but is a thin line, and there are no docks, piers, or beach use.
**Fix:** `wfLast = clamp(minCoast - 30, 560, minCoast - 20)` (i.e. allow ~660–740) and add one pier/dock strip plus a
few beach props at the promenade; keep the park block where it is.

### 6. Every block is treated identically — the city reads generated, not hand-built
**Where:** `city-oblique-sw.png`, `aerial-12.png` (same alley cross in all 40+ blocks), `industrial-spine.png`
(identical tan warehouse rows), all three parks are the same square + plus-path template.
**Why it hurts:** the rubric's composition bar ("plausible grid + arterials + a highway", a real city's variety)
is met structurally but not expressively — no landmark block, no cul-de-sac or curved collector, no low-density
fringe, and the huge empty belts between the four district islands (downtown→waterfront ~140 m, industrial→suburb
60–300 m) are featureless lawn.
**Fix:** per-block deterministic variety (per-block `gap`/`fillChance` from the rng, one plaza/landmark block, one
curved or diagonal collector in the suburb), rotate industrial lots, and add a low-density fringe of houses/sheds
along the connector roads so the districts stop looking like islands.

### 7. [minor, shared ownership] Parks read as empty lawns at street level
**Where:** `shots/demo/r1-critic-extra/downtown-park.png` (plain green plates + path cross; no legible planting).
Park *placement* (whole block at the avenue crossing; waterfront north end; two suburb parks) is good and demo-owned;
the absent planting is props' own scope, noted here only because a park is the one block where the emptiness of
issue 2 is most visible. Not separately scored.

## What already works

- **Determinism is real and end-to-end:** same-seed boots reproduce every count and the full init log line
  byte-for-byte (13 groups checked), including props and warmed-up population — no wall-clock/rng leakage.
- **District identity is instantly legible at every tod:** dense multi-colour downtown, orange-grid industrial
  warehouse rows, green suburb, waterfront rows along the bay, with a 6-stop/1-line bus loop, Central Park on the
  avenue crossing, a coast promenade and interior alleys so 100% of zoned cells are road-served; HUD Power/Water
  100% on frame one.
- **Perf/error hygiene and contract discipline:** both batches `errors: []` with large margin (module 143 fps /
  6.83 ms / 565 calls; game 55.2 fps / 11.2 ms / 860 calls), no `Math.random`, folder and public API intact — and
  the underlying street/night rendering (e.g. `street-18.png`, `demo_closeup-21h5.png`, `industrial-spine.png`) is
  genuinely AAA once you are in among the buildings.
