# loop-c5 recon: W1 authored hero set-pieces (E1)

Read-only Explore pass, 2026-10-02, against base `1876d3b`. Condensed by the orchestrator; the file:line citations are the recon's own.

## Targets (looked-at PNGs)
- **01 house** vs `ss_0875…` (house, porch, sandbox, raised beds, pond, pergola, trees). Ours is apartment b352 at (156,-548).
- **02 park** vs `ss_1522…` (grey plaza, stepped orange/teal ramps, figures with caps and skateboards, planters, rail, pallet). Ours is about 70% green stud field (0.8 m studs at a 4.5 m eye), a fountain, 2 benches and 1 figure.
- **04 civic** vs `ss_b3e4…` (farm: windmill, crop rows, hay, scarecrows, pergola, trucks, about 25 figures, barn). Ours is a white hospital filling about 45% of the frame, 4 figures and 2 bins, with no forecourt (the entrance sits on the sidewalk).
- `tools/pairs.mjs:5,17` pairs the i-th sorted file of ours with the i-th sorted reference, so `04-*` is always judged against the farm.

## Key facts
- **Ownership** (ARCHITECTURE.md:123): `props` owns `world.props`, `buildings` owns `world.buildings`, and `demo` is the only layout author and works only through public APIs.
- **Siting:** `buildCity()` `citygen.js:688-716`, then `seed()` `demo/index.js:170-205`, which calls `props.api.settleDetail()` at `:203` (the hook pattern to copy).
- **Free land:** the suburb `PARK_BLOCKS '1,0'`/`'4,1'` and `PLAZA_BLOCK '2,1'` (`citygen.js:591-606`) leave about 55 m-wide `'none'` land that is never zoned or grown (`buildings/index.js:146-172`). Utilities can land there on some seeds (`findUtilitySite :295-306`), so siting must test for free cells. The suburb is outside the flat plateau (`citygen.js:13-17`), so use a flat sub-rect or the set-piece's own plinth.
- **Props pipeline:** `placer.add` uses content ids `c2p:<kind>:<x>:<z>` (`props/index.js:375-391`). `placementFree` rejects points inside building AABBs (`:147-172`). `settleDetail`/sweeps handle only `c2p:` (`:431-509, 297-373`). `rebuild()` builds one InstancedMesh per role (`:678-730`). The distance fade between 170 and 220 m exempts only bus stops, signals and fountains (`:24,30`). `?noc2=1` is at `:1022`.
- **Vocabulary:** `props/geo.js` unit primitives; 41 roles in `kinds.js:38-268`; the figure is legs/torso/head with a static seeded lean (`:252-266, 332-341`), with no hats, boards, sitting or animation; there are no parked vehicles (traffic kits are private).
- **Budgets:** game r49 is 10.34 ms / 934 draws. Props own draws are 61 of 300, buildings 122 of 400. Each new role is +1 own draw (about +4 scene draws with shadow cascades). 20–25 roles come to about props 85 and game about 1030.
- **Determinism:**
  - Append after `buildFringeBelts` (`citygen.js:696`) with `rng.fork('setpieces')`, which is stateless with respect to the parent (`rng.js:92-94`).
  - Building ids are sequential (`world.js:859`), and inserting mid-build re-dresses the whole city.
  - Set-piece props use content ids with a new prefix `sp:` and never `api.addProp`.
  - `sp:` props need their own settle/sweep that keeps the deck Y.
  - Add `?nosp=1` for A/B attribution.
- **Checks (orchestrator):**
  - `check-detail` 5a containment (`:177-207`), 5b floaters (`:213-310`), mesh-truth raycast (`:316-350`) and census hash rebaseline (`:37-66`);
  - a new `check-setpieces.mjs` (seeds 1/2/23, ≥ 3 set-pieces, density floors, containment, deck floaters, reload hash, own draws ≤ 300);
  - `check-beauty` hero gates for each set-piece frame;
  - `shot-list.mjs:41-121` finders switched to a set-piece registry.

## Approaches (ranked)
- **A (chosen)** — demo-sited, props-authored set-pieces in park-block leftover land: a skate plaza by the plaza fountain (02), a community farm (04), and a pergola garden around a demo-added level-1 house (01). A registry carries authored hero cameras. 2 builders (props, then demo) plus orchestrator tooling; about +25 own / +100 scene draws.
- **B** — building-record lots, with large structures in buildings chunks. Highest ceiling, 3 serialised builders, more seams.
- **C** — a civic forecourt on the hospital. Lower impact (the reference stays a farm).
- **D** — a density bump on current subjects. Cycle 2 showed this class does not move the metric.

## Orchestrator note on pair 04
Switching shot 04 from the hospital closeup to a farm set-piece class-matches the reference, as set 6 already did for 01/02/05. This is allowed by protocol (the shot list is curated). The scoreboard records it so a win on 04 is read as "authored class-matched content", not "civic closeup improved".
