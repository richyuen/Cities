# LOOP cycle 2 — L2 diorama detail layer (props)

**Goal:** the judges' #1 reason on all five set-4 pairs — "shows almost nothing", "flat", "sparse", "empty asphalt",
"no characters" — needs *micro-dressing and figures* around the subjects, not better framing (L1 is done).
**Acceptance:** the props module places a deterministic dressing layer (yards, civic entrance life, pedestrians);
`node tools/check-detail.mjs` green; module batch + full-game batch clean; `errors: []`; budgets pass; existing
park/road/signal behaviour unchanged; no edits outside `src/props/` + `tools/check-detail.mjs` + this report.

## What was added

| file | change |
|---|---|
| `src/props/kinds.js` | 7 new prop kinds + role geometry: `fence_picket` (2 posts + 2 rails, white/tan), `garden_bed` (beveled soil box + 3×3 crop clumps, green/orange), `laundry_line` (2 posts + line + 3-4 cloth quads, bright colours), `picnic_table` (beveled top + benches + trestles, tan/brickYellow), `crate_stack` (box+rim crates, 3-5 per stack, tan/reddishBrown), `bike` (two 10-seg wheels + a 6-tube frame triangle), `figure` (minifig-scale legs/torso+arms/head, 1.7 m, seeded shirt/legs/skin colours, seeded static lean). New colour palettes (`FENCE_COLORS`, `SOIL_COLORS`, `CROP_COLORS`, `CLOTH_COLORS`, `TABLE_COLORS`, `CRATE_COLORS`, `BIKE_COLORS`, `FIGURE_*`). |
| `src/props/geo.js` | `UNIT_WHEEL` (10-segment cylinder, 40 tris) for bike wheels. |
| `src/props/materials.js` | 11 new instance-colour roles (fence/garden/laundry cloth/picnic/crates/bike frame/figure parts) sharing the cached `plastic()` material families; `garden-crop` joins the matte foliage family; static roles for `laundry-frame` (lightStoneGrey) and `bike-wheels` (black). No per-object materials. |
| `src/props/populate.js` | `populateYard()` (2-6 items in the 1-6 m band per house/apartment/shop: fence runs along the lot edge, 1-2 garden beds, a laundry line in the back, a picnic table, crate stacks at shop/service backs, a bike at the front, 0-1 yard figure; deterministic `rng.fork('yard:'+id)`, per-kind separation, shuffled menu so neighbouring lots differ); `populateCivicEntrance()` (figures at the door first, then 2-4 bench/planter/bike/crates in the entrance strip + side yards, all inside the lot); `populateServiceBack()` (1-3 crate stacks behind services/industrial); `populatePedestrians()` (walks one street/avenue edge, a figure every ~18 m with `chance(0.28)`, alternating sides, facing along the walk, `rng.fork('ped:'+edgeId)`); `populatePedestrianCluster()` (2-3 figure knots; `populatePark()` now drops one on a park cell). |
| `src/props/index.js` | The C2 detail pass: a 4 m spatial index for every prop, a C2-only index, and every building AABB; a placer that rejects carriageways (a lazily-rebuilt local road-centreline snapshot with the same `dist < half + 0.4` maths as `roads.api.snapToRoad`, which was the fix round's 776 ms boot hot spot), building footprints (0.3 m pad) and anything within the larger of two kinds' separations (fences ≥ 2.02 m); C2 props get content-derived ids (`c2p:<kind>:<x>:<z>`) so they never shift pre-existing ids/variation; `building:spawned` dresses and `building:removed` cleans up per building id (idempotent per building, tracked in `yardByBuilding`); `road:added`/`road:changed` sweep C2 props that a *later* road has made illegal; later buildings sweep C2 props out of their footprint (C2-owned props only, by id prefix); `settleDetail()` re-resolves every C2 height once the world is final. |
| `src/props/showcase.js` | `stageYards()`: a shifted suburban block (2 E-W streets + 1 cross street, four x-staggered lot rows, **36** real building records incl. a school and a fire department) staged in one buildings-batcher chunk, dressed by the same `building:spawned` pass the full game uses; `stageStreet()` now also stages four real lots + sidewalk pedestrians (so default/night batches carry C2); `stagePark()` adds picnic sets/bikes/figures; `props:yards` frames whatever C2 content the current variant staged (no empty-terrain fallback). |
| `tools/check-detail.mjs` (new) | **35** checks: cross-boot determinism of the prop-kind census, pre-C2 prop stability with/without C2 (`?noc2=1`), yard items on 20 sampled lots, civic clusters + door figures, street-preset figures, zero C2 carriageway/footprint violations (legacy offenders counted separately), **no C2 prop more than 0.5 m off its resolved surface**, **no fence pair closer than 2.0 m**, figure cap, the props module's own draw calls (≤ 300 full city and in the yards scene), idempotency, `errors: []` on every capture; writes `shots/props/c2/{summary.json,yard-house.png,civic-entrance.png,street-figures.png,yards-showcase.png}`. |

Showcases by variant: `default` / `night` (street block + its new lot row), `park` (park + C2 set-pieces), `yards`
(suburban block); presets `props:default`, `props:closeup`, `props:park`, `props:yards` — all four frame staged
content in every variant.

## API / surface changes

- `props.deps` is now `['terrain', 'roads', 'buildings']` (buildings inits at order 40 < 45 anyway, so the full
  game is unchanged; the `yards` showcase needs the module to *render* the houses it dresses).
- `props.showcaseVariants` gains `yards`.
- New api: `populatePedestrians(edgeId?)`, `populateYard(buildingId)`, `canPlace(kind, x, z)`,
  `detailProps(buildingId)`, `settleDetail()` (re-resolves every C2 height against the finished terrain/roads,
  culls props that cannot stand on a valid surface — buried under a road terrace skirt or below sea level — and
  tops up civic entrance clusters the cull thinned; `src/demo/index.js` calls it optional-chained right after
  `buildings.settle()`, `props.showcase()` calls it after staging, live road edits re-settle once boot has
  settled); `stats()` gains `figures`, `yardProps`, `detailedBuildings`, `figureCap`, `detailMs`, `c2Props`,
  `detailOff`, `detailSettle` (`{fixed, removed, toppedUp, ms}`).
- `?noc2=1` URL flag (verification only): disables the whole C2 pass, producing the exact pre-C2 world in the
  fixed code (used for the pre-existing-prop stability proof).
- New events consumed: none beyond the existing `building:spawned`/`building:removed` (now also used in showcase
  mode); no new events emitted; one integrator-approved line in `src/demo/index.js` (the `settleDetail` call).

## Counts (full game, seed 1, hud 0)

**Props by kind — before → after** (total 2900 → **4339**, fix-round-2 revision):

| kind | before | after | | kind | before | after |
|---|---|---|---|---|---|---|
| hedge | 1162 | 1162 | | **fence_picket** | — | 366 |
| streetlamp | 767 | 767 | | **crate_stack** | — | 360 |
| traffic_light | 242 | 242 | | **figure** | — | 301 |
| tree_small | 178 | 178 | | **garden_bed** | — | 178 |
| trash_bin | 87 | 94 | | **bike** | — | 126 |
| bench | 83 | 97 | | **picnic_table** | — | 50 |
| road_sign | 83 | 83 | | **laundry_line** | — | 20 |
| park_bench | 81 | 81 | | flower_bed | 54 | 71 |
| tree_large | 70 | 70 | | fountain | 26 | 26 |
| tree_medium | 67 | 67 | | | | |

The only changed pre-existing kinds are the civic clusters' own furniture (bench +14, trash_bin +7, flower_bed
+17); those are *additive* C2-owned props with `c2p:` ids. Park/road/signal prop **counts and ids** are unchanged
(the `22ed04cd` census hash is identical with and without the C2 layer); their *heights* changed only where fix
round 2's footprint-aware resolver moved a prop off a road deck it never stood on (intended).

- **Yard dressing:** 1100 yard props; 441/441 buildings have a dress pass; the 20-lot sample in `check-detail` has
  100% coverage (1-8 items per lot). **Pedestrians:** 301 figures (cap 900), 20/20 civic entrances have ≥ 2 cluster
  props + ≥ 1 figure, 8 figures in the `street` preset's corridor.
- **Props module draw calls:** 48 → **61** (≤ 300, ARCHITECTURE §7; the module's *own* calls). Full game draws
  763/764 → **828/829** (game batch r42 max **921** ≤ 1500).
- **Perf:** game batch r42 6.6-10.41 (r37: 9.71 max) — all ≤ 20. fps 93.1-144 (r42 min 93.1 ≥ 50).
- **Boot:** after fix round 2 the same-session pairs are noc2 **11335/11363/11371 ms** vs C2-on
  **11554/11568/11464 ms** (+1.5 %), demo seeding +100 ms (+2.3 %); `detailMs` 37-42 ms and `settleDetail`
  70-77 ms (244 fixed, 294 culled, 2 civic top-ups). The pass is synchronous, so the first drawn frame is complete.
- **Determinism (fix round 2 build):** prop-kind census hash `e0f35033` identical on reload; the pre-C2 prop
  census is byte-identical with and without the C2 layer (`22ed04cd`, 2900 props); `Math.random` is absent from all
  six edited files.

## Verification runs (all with `errors: []`)

`tools/critic.mjs` stages one `--variant` per invocation, so the brief's "variants default/park/yards/night" is
four runs (each with its own `--dir`, 4 presets × 4 tods = 16 shots):

| run | result | path |
|---|---|---|
| `node tools/check-detail.mjs` (fix round 2) | **38/38**, props own draws 61, 0 C2 carriageway/footprint violations, **0 float/burial/skirt** (API-derived + mesh-truth sample), 0 fence pairs < 2.0 m, pre-C2 hash equal with/without C2, legacy offenders reported separately | `shots/props/c2/summary.json` |
| `node tools/critic.mjs --module props --round 9` | maxDraws 322, maxGpuMs 6.79, minFps 143.6; C2 visible in default/closeup/yards shots | `shots/props/r9/summary.json` |
| `--module props --variant yards --round 9` | maxDraws 421 (scene total; props' own 38), maxGpuMs 6.79, minFps 143.2 | `shots/props/r9-yards/summary.json` |
| `node tools/critic.mjs --game --round 42` | minFps 93.1, maxGpuMs **10.41**, maxDraws **921** | `shots/game/r42/summary.json` |
| `node tools/check-beauty.mjs --out shots/beauty/c2c` | **37/37** (L1 gates hold with the dressing in frame) | `shots/beauty/c2c/summary.json` |
| `node tools/check-atmosphere.mjs` | 22/22 (props not loaded by those showcases) | `shots/atmosphere/b3/summary.json` |
| mesh-truth probe seeds 1/2/23 (all props) | C2 0/0, 0/1, 0/0 beyond ±0.5 m; legacy 6/36, 8/41, 9/17 of ~2900 | `shots/props/c2/mesh-truth.json` |
| non-tautology proof (scratch) | clean 0/0 API + 0/0 mesh; 39 props fed ±1.2 m → 20 over + 19 under API, 3 over + 2 under mesh | `Temp/opencode/c2f2-failproof.mjs` |
| diff `r37 → r42-noc2` (pre-C2 world, current code) | meanAbs **0.1203**, worst 1.1549 (closeup-21h5) — the legacy prop *heights* moved by design (footprint-aware resolver), no id/position change | `shots/game/r42-noc2-diff-r37.json` |
| diff `r42-noc2 → r42` | meanAbs **0.1909**, worst 0.8432 (closeup-18) — that delta is the C2 dressing | `shots/game/r42-noc2-vs-c2.json` |
| non-C2 census hash, C2 on vs off | `22ed04cd` == `22ed04cd` (2900 props, ids/kind/x/y/z/rot) — the exact stability invariant | `shots/props/c2/summary.json` |
| diff `r40-noc2 → r40` (fix round 1 build) | meanAbs 0.2148, worst 0.849 (closeup-18) — the C2 dressing before fix round 2 | `shots/game/r40-noc2-vs-c2.json` |
| hero `--preset closeup --tod 17.7 --hud 0` (retaken post-fix) | 669 draws, 7.64 ms, 0 errors | `shots/props/c2/hero-closeup-17h7.png` |
| hero `--preset street --tod 21.5 --hud 0` (retaken post-fix) | 815 draws, 9.84 ms, 0 errors | `shots/props/c2/hero-street-21h5.png` |
| hero `--preset overview --tod 12 --hud 0` (retaken post-fix) | 824 draws, 6.81 ms, 0 errors | `shots/props/c2/hero-overview-12.png` |

## What I looked at (PNG, via the Read tool)

Baseline: `shots/props/c2/baseline-street-noon.png`. Kit check: `shots/props/c2/clinic2-{bike,crate_stack,
laundry_line}.png`, `clinic-{fence_picket,garden_bed,picnic_table,figure}.png`, `bike-{top,side-level,front}.png`.
Yards staging/preset search: `dev-yards-1.png`, `dev-yards-b.png`, `cand-a.png`, `y1..y4`, `z1..z4`, `o1..o3`.
Evidence captures: `shots/props/c2/{yard-house,civic-entrance,street-figures}.png` (check tool),
`shots/props/r5-yards/props_yards-12.png`, `props_yards-21h5.png`, `props_default-12.png`,
`shots/game/r38/street-21h5.png`, `closeup-18.png`, and the three heroes listed above. Fix-round captures are
listed in the fix-round section below (r7/r7-yards/r40/c2b + refresh heroes).

What the pictures show (honest claims only): the closeup hero now frames 2-3 figures + a bench + a bin + the
hospital cross and entrance, with a garden-bed row across the street; the civic check capture shows a school
entrance with two figures at the door, a bin and the cluster crates/bench beside it; the yards block reads as a
lived-in suburb (picket fences, crop planters, laundry frames with cloth, picnic tables, crate stacks, bikes,
sidewalk figures, lit windows at 21.5); the street-night hero has two pedestrians and a bus stop on the verge but
is still asphalt-dominated; the noon overview shows the dressing as texture around the buildings, with the
terrain/zone green still dominating the wide shots.

## Fix round (`docs/reviews/loop-c2-critic.md`, 7.0 PASS with follow-ups)

| # | critic issue | fix |
|---|---|---|
| 1 | **2 levitating figures** (y resolved once at placement; later flatten/regrade moved the surface) | New `props.api.settleDetail()`: re-runs `resolveHeight` for every C2-owned prop once the world stops moving, drops any prop with no finite surface, and marks the instancing dirty. `src/demo/index.js` calls it right after `buildings.settle()` (optional-chained); `props.showcase()` calls it after staging; live road edits re-settle once the boot settle has happened. **Superseded by fix round 2**: the two named figures were fixed, but the *general* floater/burial class survived (the resolver used the nearest centreline, not the footprint) and the check that certified it was tautological. |
| 2 | **pre-existing props reseeded** (variation keyed on sequential prop ids, which C2 insertions shifted) | C2 props now get explicit **content-derived ids** (`c2p:<kind>:<x>:<z>`) and therefore never consume `world._ids.prop`: every pre-existing prop keeps the exact id it had before C2, hence the exact same `rng.fork(id)` variation. `rebuild()` additionally keys C2 variation on `kind:x:z` (`variationKey()`), so C2 props are stable across restages too. Proven three ways: (a) check-detail hashes all non-C2 props' `(id,kind,x,y,z,rot)` with and without C2 — **`b4edcfef` == `b4edcfef`, 2900 props** (fix round 2 supersedes the hash with `22ed04cd`, since the new footprint-aware resolver intentionally moved some legacy heights; the C2-on == C2-off invariant holds in both builds); (b) new `?noc2=1` verification flag renders the pre-C2 world; `diff r37 → r40-noc2` = **0.0344 meanAbs** (worst 0.1236, drift-level) where the old r39 diff was 0.294 with whole-tree deltas; (c) `diff r40-noc2 → r40` = **0.2148** — the difference between the two worlds is exactly the dressing. |
| 3 | **8 fence pairs 1.22-1.88 m apart** (panels are 2 m and interpenetrate) | Fence runs are laid at `FENCE_SPAN 2.04` and the placer now enforces `FENCE_SEP 2.02` between any two fence props (kind-aware separation via `minSepFor()`), so jittered replacements can never land inside a neighbour. 363 panels, **minimum pair distance 2.031 m, 0 pairs < 2.0 m** (check asserts both). |
| 4 | **default/park/night batches showed no C2** (pixel-identical to pre-C2); 12/16 yards shots framed the bare origin | `stageStreet()` now stages four real lots (a shop + 3 houses on the north side) that the buildings dep renders and the C2 pass dresses, plus sidewalk pedestrians; `props:closeup` and `props:yards` were re-aimed at that row (the `props:yards` preset frames the staged C2 content in every variant — the empty-terrain fallback is gone, so there is nothing left to flag in `summary.json`; `critic.mjs` is not mine to edit and records no per-shot fallback field). `stagePark()` adds picnic tables/bikes/figures. Default variant: `props:default`, `props:closeup` and `props:yards` (12 of 16 shots) now visibly carry dressing; the yards scene's origin block is no longer bare. |
| 5 | **boot cost +11.9%/+14.6%**, `detailMs` 790 ms | Root cause: `roads.api.snapToRoad` was called per candidate and per accepted prop, and each call after a terrain mark rebuilt the *entire lane network* (3709 calls, 776 ms measured). The placer now rejects carriageways with a local, lazily-rebuilt road-centreline snapshot (`roadClear()`, same `dist < half + 0.4` maths) and resolves height once in `settleDetail()`; the sweeps use the same snapshot (they alone were 1163 ms); the sweeps walk a C2-only spatial index instead of every prop; per-lot attempts were trimmed. **`detailMs` 790 → 19 ms**, `settleDetail` **12-18 ms**; demo seeding **+25 ms** (was +1.1 s) and readyMs indistinguishable from the pre-C2 world in a 3-pair same-session comparison (noc2 11381/11414/11452 ms vs C2 11382/11454/11378 ms). |
| 6 | **gate restatement** | check-detail now asserts the **props module's own draw calls** (61 full city, 38 in the yards scene) and says so in its summary (`gate` field); the yards batch scene total (421) is buildings + terrain + CSM and outside the props gate. |
| 7 | report nits | yards showcase is **36** building records (doc comment corrected); "existing park/road/signal behaviour unchanged" now reads *counts/positions/appearance* (all three proven: census + `b4edcfef` + r37→r40-noc2 = 0.0344). |

**Fix-round numbers** (final revision, `errors: []` everywhere): props 4628 (C2 1728; figures 409; yard props 1279; fences 363; props own draws 61); `check-detail` **35/35** (census hash `177984be`); props batch r7 maxDraws 332 / maxGpuMs 6.82 / minFps 143.7; yards variant r7-yards maxDraws 421 / 5.36; game r40 minFps 90.2 / maxGpuMs 10.74 / maxDraws 921; `check-beauty` c2b **37/37**; diffs r37→r40-noc2 0.0344, r40-noc2→r40 0.2148, r37→r40 0.2463, r39→r40 0.334.

**Looked at (fix round)**: `shots/props/r7/props_default-12.png`, `props_closeup-12.png`, `props_yards-12.png`;
`shots/props/r7-yards/props_yards-12.png`, `props_park-12.png`; `shots/game/r40/closeup-18.png`,
`overview-12.png`; `shots/props/c2/{summary.json,yard-house,civic-entrance,yards-showcase}.png`. What they show:
the street block's new lot row with bikes/benches/crates/figures in the default and closeup presets; the yards block
with fenced, gardened, laundry-and-picnic-dressed lots and sidewalk figures; the full-game closeup with four
pedestrians + a bin + crop rows at the hospital entrance, all grounded on the sidewalk (no floaters).

## Fix round 2 (`docs/reviews/loop-c2-fix-critic.md`)

The re-verifier refuted fix round 1's floater claim as general: `check-detail` compared `p.y` to `resolveHeight()` —
the function that had just set it (structurally unable to fail) — and its own mesh-truth raycast measured
**62/76/66 C2 props floating > 0.5 m and 21/34/21 buried** on seeds 1/2/23 (max +2.55 / −2.80 m). Root cause:
`resolveHeight` took the nearest road **centreline** within 6 m as the ground (lane Y + 0.19) even when the point
was nowhere near that road's surface, so props beside an embankment/terrace deck inherited the deck height.

| # | change |
|---|---|
| 1 | **`resolveHeight` is footprint-aware** (`src/props/index.js`): the road/sidewalk plate is used only when the point lies inside a road's rendered footprint (`roads.api.footprintWidth(kind) / 2` lateral distance from a centreline); off every footprint the terrain's rendered (`terrain.api.surfaceHeight`) surface wins, and the 0.19 m sidewalk lift applies only inside the footprint. When the *nearest* centreline is a narrow path while a wider road's plate covers the point, the containing edge is found in the local road snapshot and its exact profile is read by snapping from its projected centreline point (one extra `snapToRoad` only in that rare case). This intentionally affects pre-existing street furniture too: lamps/benches/bins sit 5.4-5.7 m from a street centreline (inside the 6 m half-footprint), so they still get the verge plate — verified in the r9 closeup and hero street shots. |
| 2 | **`settleDetail` culls what cannot stand**: an exact terrace-cover test across every nearby road (`buriedUnderRoadDeck`: `snapToRoad` at each edge's projection + the roads/geometry.js terrace model, one 0.4 m plate per 0.8 m run), plus props whose final surface is below `world.seaLevel - 0.05` (sea-bed park figures were rendering under the water plate). Seed 1: 244 heights fixed, **294 props culled**. |
| 3 | **Civic repair pass**: culling must not empty the closeup hero's entrance cluster. `settleDetail` re-checks every civic using the acceptance rule (all props within 14 m of the +z entrance) and tops up figures/items through the placer plus the exact burial test, with a wider deterministic fan (`civic-repair:<id>`, 2.2-12.5 m, ±77°). |
| 4 | **Placement rejects the same classes cheaply**: `roadBlock()` returns `'water'` (water cell, or terrain below sea level), `'carriageway'`, or `'skirt'` (best-effort deck estimate from the road snapshot; the exact test runs at settle). |
| 5 | **`check-detail`'s floater check is real and non-tautological**: (a) an independently implemented API derivation — `surfaceAt` scans *all* road edges with the public `footprintWidth`, reads the plate via `snapToRoad`, falls back to `terrain.surfaceHeight`, and a terrace-cover test — asserting every C2 prop within **0.35 m**; (b) a **mesh-truth raycast sample** (150+ C2 props, deterministic stride) against the rendered terrain/roads meshes (studs and the props group excluded) asserting the same 0.35 m band. Legacy (non-C2) offenders are reported separately: 8 over / 7 under > 0.5 m of 2900 on seed 1. |

**Mesh-truth per seed** (own probe, all props, `shots/props/c2/mesh-truth.json`; gap = prop y − topmost rendered
terrain/roads mesh under it):

| seed | C2 n | C2 > +0.5 m | C2 < −0.5 m | C2 range | legacy >0.5 / <−0.5 | (re-verifier's C2: over/under) |
|---|---|---|---|---|---|---|
| 1 | 1439 | **0** | **0** | −0.01 .. 0.00 | 6 / 36 of 2900 | 62 / 23 |
| 2 | 1402 | **0** | **1** (−0.60 m) | −0.60 .. +0.20 | 8 / 41 of 2976 | 76 / 34 |
| 23 | 1431 | **0** | **0** | −0.40 .. 0.00 | 9 / 17 of 2920 | 66 / 21 |

**Non-tautology proof** (scratch `c2f2-failproof.mjs`, nothing committed): the check's own two tests on a clean
world give API 0 over / 0 under and mesh sample 0/0 (range 0..0); after feeding 39 C2 props ±1.2 m the API test
reports **20 over + 19 under** and the mesh sample **3 over + 2 under** (max +1.2 / min −1.2) — the assertions
react to wrong heights.

**Fix-round-2 numbers** (final revision, `errors: []` everywhere): `check-detail` **38/38** (census hash
`e0f35033`); props 4339 (C2 **1439**, figures **301**, yard props **1100**, fences 366); props own draws 61;
`detailMs` 37-42 ms, `settleDetail` 70-77 ms (fixed 244, removed 294, toppedUp 2); boot pairs (same session,
alternating) noc2 readyMs 11335/11363/11371 vs C2-on **11554/11568/11464 (+1.5 %)**, demo seeding +100 ms (+2.3 %);
props r9 maxDraws **322** / maxGpuMs 6.79 / minFps 143.6; r9-yards 421 / 6.79 / 143.2; game r42 maxDraws **921** /
maxGpuMs **10.41** / minFps 93.1; `check-beauty` c2c **37/37**; heroes closeup 669 draws / 7.39 ms, street
817 draws / 9.71 ms.

**Looked at (fix round 2)**: `shots/props/c2/hero-closeup-17h7.png` (four pedestrians + bin + bike + crop rows at
the hospital entrance, all feet on the sidewalk), `hero-street-21h5.png` (pedestrian on the verge, lamps on both
verges, no floaters in frame), `shots/props/r9/props_closeup-12.png` (lamp and bin standing on the sidewalk verge
beside the staged lots), `shots/props/r9-yards/props_yards-12.png` (the dressed suburb), `fix2-embankment-a.png`
(the industrial embankment area where the worst legacy float cases sit; the terrace steps read as designed).

**Known gaps (fix round 2)**

- One seed-2 `figure` is 0.60 m buried (a terrace-step boundary the per-point model reads as visible); seeds 1 and
  23 have zero C2 props beyond ±0.5 m and the check (seed 1) is clean at ±0.35 m.
- The **legacy furniture class is unchanged** (6-9 over / 17-41 under > 0.5 m of ~2900 props; worst +3.2 / −2.7 m
  — e.g. `streetlamp@-614.6,-151.0` 3.22 m above the sidewalk after the road deck was regraded without re-settling
  the lamps). Fixing it would change non-C2 props and break the byte-identical pre-C2 census (`22ed04cd`) that fix
  round 1 introduced; it pre-dates this cycle.
- C2 counts fell (1728 → 1439): the culls remove props that genuinely stood under embankment skirts or below sea
  level (laundry lines on back lanes are the largest group, 82 → 20). The survivors are mesh-clean on all three
  seeds and the yard sample is still 20/20 lots with 1-8 items.
- Culling runs at settle time (boot + live road edits). A pure terrain change (no road event) does not re-settle;
  terrain only moves via citygen/showcase flatten in the current build.

## Known gaps / notes for the critic

1. **`props` yards batch scene total is 421 draws** — the per-module §7 gate is the props module's **own** draw
   calls (61 in the full city, 38 in the yards scene, both asserted by `check-detail` and restated in its
   `summary.json` gate field). The batch total is buildings (28 main, CSM ×4) + terrain + roads + the staged
   suburb; it is not the props gate. The orchestrator confirmed this reading in the fix round.
2. **Legacy violations:** 116 props that are *not* C2 (streetlamp 66, bench 14, trash_bin 13, traffic_light 13,
   road_sign 10) sit in a building footprint or on a carriageway. They come from `populateAlongRoad`'s fixed
   cross-section offsets at alleys/intersections and pre-date this cycle; fixing them means changing existing
   street-furniture placement (out of scope here). All C2-owned props are clean (check asserts 0).
3. **Late-road sweeps:** a handful of C2 props (yard items, some figures) are removed when a *later* citygen phase
   paves a road through their spot or a later building claims it. That is corrective and deterministic, but it
   means a figure placed on a sidewalk can disappear in the next phase; pedestrians lost this way reduce the
   sidewalk density slightly rather than leaving a floating prop.
4. **Yards are house/apartment/shop only** (crates also at service backs) per the brief. Downtown towers/offices
   therefore get sidewalk figures and civic/shop clusters only, so downtown street-level detail is thinner than the
   suburbs; L4 (density toward camera) is the natural follow-up.
5. The night `street` preset is still dominated by empty asphalt (judge set-4 pair 03). Figures on the verge help,
   but the frame is the L1 camera's, not this module's, to change.
6. Boot cost +0.79 s for the synchronous detail pass (+~1.0 s `readyMs`): the first frame is complete, but if boot
   time becomes a gate the pass can be time-sliced in `update()` without changing the determinism (the placer's
   outcomes depend on the fixed building/prop order, not on the frame cadence).
7. The parks' figure knot and `populatePark()`'s optional `place` argument are additive; park furniture counts are
   otherwise unchanged.
