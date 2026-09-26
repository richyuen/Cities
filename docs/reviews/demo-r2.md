# demo — builder report (round 2, Wave B5/G8 starter-city pass)

**What shipped:** the r1 starter-city defects fixed in `src/demo/*` (plus one boot API in `src/buildings/`):
`ready` now means the city is drawn, the suburb is a neighbourhood instead of vacant lots, utilities are sited
from coverage lattices instead of one pair per block, the highway has a real interchange with traffic on it,
the waterfront reaches the water with a promenade and a pier, and blocks have deterministic per-block variety.
Independent critic round: **`docs/reviews/demo-r2-critic.md` — 8.6 / 10 PASS** (up from 7.3 FAIL).

> The numbers below were produced by the same agent that wrote the code — evidence, not a pass. The independent
> critic re-measured the boot diff, determinism and the paired perf delta itself and reached the same verdict
> with the remaining levers named.

## What was built

- **Boot presentation (r1 issue 1).** `buildings.api.settle()` (new, `src/buildings/index.js`): applies
  simulation's current level-up candidates and flushes the incremental batcher synchronously; construction
  flashes are suppressed while settling. `demo` calls it after its 600-tick warm-up, so the whole city is merged
  inside the boot screen. `?showcase=demo` now seeds the same full city via the same `seed()` path (7 district
  presets) instead of a downtown slice.
- **Suburb density + variety (issues 2/6).** `SUBURB_Z` gains an interior −300 row (150/110/80 m blocks);
  per-block deterministic gap/fill/stagger/level from a dedicated rng fork; two parks + a plaza block;
  `fillChance 0.42–0.62`, `gap 2–3`. Suburb zoned buildings **63 → 151** (target 150–200), total 441.
  Low-density fringe ribbons along the connector roads fill only lots already inside utility coverage.
- **Utility siting (issue 3).** `placeUtilities()` replaces the per-block pair scheme: each district gets
  `ceil(span / 2·radius)` lattice anchors per service (power and water independently — power radius 144 m, water
  112 m), each realised in the nearest free buildable spot; power plants try a near block corner first (≤48 m).
  Utilities **62 → 46** (22 plants + 24 towers, 10.4 % of buildings vs 23 %), coverage stays **100 % power /
  100 % water, 0 unserved**.
- **Highway (issue 4).** x=−480 is a highway node and a continuous **avenue** runs highway → suburb → industrial
  pad; a one-way **diamond ramp pair** `(-600,-560)→(-480,-410)` / `(-480,-410)→(-400,-560)` stitches real
  junctions. The old dead-end stub is gone.
- **Waterfront (issue 5).** `wfLast = clamp(minCoast − 30, 560, minCoast − 20)` (658 here; built edge x≈648 vs
  coast 688–768), coast-hugging promenade, an esplanade park strip, and a **pier** built from three
  bridge-decked `path` edges out over the bay.
- **Belts (issue 6).** Four small greenway squares (park cells + props) between downtown and the waterfront,
  fringe ribbons along the connectors, a plaza with a fountain in the suburb.

## Verification (real numbers)

Showcase batch (`node tools/critic.mjs --module demo --round 2`, 7 presets × 4 tods, 28 shots):

```
minFps=42.5  maxGpuMs=16.02  maxDrawCalls=708  maxTris=21.3M  errors=0
```

Full game (`node tools/critic.mjs --game --round 10`, 20 shots, same load as the baseline batch below):

```
B5:             minFps=39.8  maxGpuMs=24.75  maxDrawCalls=849  errors=0
pre-B5 baseline:minFps=40.2  maxGpuMs=23.85  maxDrawCalls=855  errors=0     (shots/game/r10-base-load)
idle reference: minFps=54.5  maxGpuMs=10.77  maxDrawCalls=855  errors=0     (shots/game/r9, pre-B5)
```

**Load caveat (honest):** every capture above ran while the user had a GPU-heavy game at 85–98 % GPU; the same
pre-B5 code measures 23.85 ms under that load vs 10.77 ms idle in r9. The valid comparison is B5 vs baseline
under identical load: **mean +0.72 ms per shot, worst shot +3.61 ms (`closeup-18`), draw calls −9, minFps −0.4
(noise)** — idle-equivalent worst ≈ 12 ms ≤ 20 ms. All 48 official shots are `errors: []`.

Functional checks (scripted against the live server):

- **Determinism:** two fresh boots, same frame count, byte-identical snapshot — 441 buildings (r 254 / c 80 /
  i 41), 490 road edges (highway 9 / avenue 25 / street 108 / path 348), 2,900 props, population 12,415→12,369
  at the sampled frame, jobs 4,973, money 80,913, 100 %/100 %, 0 unserved. Critic reproduced it independently
  (SHA-256 prefix match).
- **Save/load:** pop 12,653 → 12,322 after `?load=` (previously 8,288 → 1,221); 441 buildings/490 roads
  restored, 0 unserved, no errors.
- **Transit:** 6 stops + 1 line in the shipped game boot.
- **Boot completeness:** at the first drawn frame every scene group (buildings/props/roads/terrain/traffic)
  matches the 5 s-later frame exactly; only the zoning overlay's 3 meshes / 37 k tris arrive ~0.12 s later
  (`shots/demo/waveB5/boot-ready.png` / `boot-steady.png`).
- **Coverage probe:** max Chebyshev distance to the nearest water tower over all zoned buildings is 13 cells
  (≤ 14), to power 13 (≤ 18) — the coverage lattice is tight, not approximately covered.

## Known gaps / honest caveats (next round's levers)

The independent critic's ranked remaining issues (`docs/reviews/demo-r2-critic.md`) are accepted as written:

1. `?showcase=demo` inherits the init session's transit stops (they survive `clearContent()` and block
   re-placement), so the r2 module batch shots have no bus loop — tooling parity, not a shipped-game defect.
2. The fringe belts are thin (5 buildings city-wide; the industrial↔suburb strips' coverage gate rejects
   everything) — the wide downtown↔waterfront belt still reads as lawn.
3. Suburb lot occupancy is ~14 % of zoned area and all 151 buildings are level 2 after the warm-up+settle —
   uniform mid-rise height, still half-green from the air.
4. Boot is +4 s under load from the synchronous `settle()` (covered by the boot screen; ~2× the design's risk
   estimate).
5. Unlit zoning plates dominate the night city now that the zoned area is larger — cross-module, not demo-owned.

Performance attribution for anyone re-testing: re-run both batches (`--game` and the stashed pre-B5 tree) back
to back on an idle GPU; the pre-B5 idle reference is `shots/game/r9` and the B5 idle expectation is ≈12 ms max.
