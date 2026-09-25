# transit — critic review, round 1

**Score: 7.5 / 10 — FAIL** (pass needs ≥ 8.5 **and** `errors: []` **and** inside perf budget). Errors and perf are
clean; the module's routing/dwell/lane engineering is genuinely good; but the visible layer has three independent,
player-reachable defects — stops that stay grey in the shipped game, a night sign/ring that glows the wrong colour
under a dark face plate, and a ground ring that floats over the roadway and slices through sidewalk studs — plus a
route-ribbon hue that does not match the line colour. That is a good system with a rough surface, not AAA-with-nits.

## Numbers

| set | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `shots/transit/r1/` (default variant, 3 presets × 4 tods) | 12 | 143.4 | 6.68 | 121 | 0 |
| `shots/transit/r1-night/` (variant `night`, 3 presets × 4 tods) | 12 | 143.4 | 6.63 | 122 | 0 |
| `shots/transit/r1-extra/` (8 custom showcase cams + 5 full-game cams) | 13 | 37.9 | 11.43 | 798 | 0 |

- **Budget**: transit's own draw calls are 4 instanced stop roles + 1 ribbon per line (+1 hidden draft mesh) = 5 for
  the 1-line showcase, against a §7 budget of 12. The 121–122 whole-scene peaks include the shared backdrop
  (terrain/environment/roads/traffic/effects), stated honestly as the precedent reviews do.
- gpuMs ≤ **6.68 ms** in all 24 module captures (budget 20), ≤ 11.43 ms in my custom full-game close-ups. The
  37.9–43.5 fps rows are custom full-game cameras (whole demo city; one with the DOM panel's backdrop-filter) —
  quoted for honesty, not counted against transit; the module's own batch is 143 fps and the GPU timings stay far
  under cap.
- **Console errors: 0** across all 24 batch captures, all 13 extra captures, and 4 scripted probe sessions.
  `Math.random`: **0 hits** in `src/transit/`. Folder contains only its own 4 files (`index.js`, `route.js`,
  `models.js`, `panel.js`).
- The `--variant night` batch is visually identical to default because `tools/critic.mjs` re-stages the tod per shot
  (the `night` variant's only extra code pauses the clock at staging), so it doubles as a deterministic second pass;
  the real night evidence is the tod 21.5 shots in both batches.
- Caveat: the transit showcase loads no `props`/`buildings`, so at night there are no streetlights and the arena is
  dark by construction (traffic's own showcase has the same staging). That is staging, not a transit defect.

## Contract check

- `id: 'transit'`, `deps: ['roads','traffic']` (ordering 55, after traffic 50 — matches ARCHITECTURE §7's routing
  and `setTransitLines` contract), `showcase`, `update`, `dispose`, `showcaseVariants: ['default','night']` and the
  three `transit:*` presets all present. `api` exposes the documented surface (`placeStop`/`removeStop`/
  `previewStop`/`findStop`/line tool, `createLine`/`removeLine`, coverage/ridership/bus accessors,
  `getLineKeys`, `getCoverageGrid`, panel, `getState`/`loadState`) and every one I exercised behaved plausibly.
- `update()` is cheap (routes dirty-check + 0.5 s bus poll); `dispose()` unsubscribes and disposes instanced meshes,
  ribbons, draft geometry and the panel.

## Functional verification (my own probes against the live page)

- **Dwell**: 160 s of `fixeddt` sampling of `traffic.getBusDebug()` shows one dwelling bus serving its four stops in
  strict order 1→2→3→4, wrapping twice; dwell ≈ 3.2 s per stop (arrival at 3.18, decays to 0) exactly as
  `BUS_DWELL_S` intends. The bus centre settles on the stop's projected lane point (0.5 m standoff along the lane),
  i.e. the *sign* sits ~2.8–3.05 m to the side of the bus centre — that is the sidewalk offset, not an overshoot.
- **Lane discipline**: while running, bus x/z is exactly on the scripted lane centre (e.g. x = −54.0 on the lane at
  −54.0); I found no lane drift. The scripted key loop is authoritative and traffic's gap buckets hold other cars
  clear; an OBB check over 1 200 sampled frames found only 4 frames with an analytical bus/car rectangle overlap,
  worst penetration 0.23 m using a conservative 2.0 m car width (real cars are 1.85–2.0 m wide and beveled), all at
  a turning moment — trace-level, no visible clipping in any PNG.
- **Stop orientation**: all four showcase stops face their serving lane exactly (facing·to-lane dot = 1.000) and sit
  on the right of travel (dot = 1.000), on the sidewalk 1.05 m behind the curb.
- **Ribbon**: one mesh per line, 158 verts for the loop, no NaN, constant 0.05 m lift over `roads.heightAt` for
  every vertex; continuous through all four corners (seen in `r1/transit_aerial-12.png`,
  `r1-extra/ribbon-corner-night.png`), no z-fighting.
- **Economy/UI wiring** (full game, seed 1): coverage 10.5%, ridership 157, 2 buses, upkeep $0.95/tick
  ($1,140/day in the panel); HUD coverage list shows “Transit 11%”; the panel renders Coverage/Riders/Buses/Upkeep
  and “Line A — 6 stops · 2 buses · 558 m”. All readable.
- **Figure-eight probe** (API-created `[A,B,A,C]` line; the tool itself refuses duplicate stops): the bus never
  progresses — it chain-dwells forever at one location while `nextStop` cycles 0→3 (routeS 98→113 over 110 s).
  Root cause is the C5-scoped `nearestOnPath` first-occurrence projection; recorded under “already planned” below,
  not double-counted, but the failure mode is worse than the builder's “boards at the first occurrence” caveat.

## Ranked issues

### 1. Stops never take their line colour in the shipped game (day)
- **What**: after a line is created, the sign plate and ground ring keep the neutral grey `#C7C7C7` default until
  some unrelated `refreshStops()` happens (hover, placing another stop, road edit). `createLine()`/`removeLine()`
  call `refreshLineMembership()` + `refreshRibbons()` + `syncTraffic()` but never `refreshStops()`. Read live with
  `instanceColor`: full-game demo city at boot = six × `#c7c7c7` while all six stops have `lineIds:[1]` and Line A
  is red `#C4281C`; the showcase (which calls `refreshStops()` after membership) = four × `#c4281c`; my later
  `placeStop` call flipped all six demo stops red as a side effect — proving the colour is only ever applied by
  accident.
- **Where**: `shots/transit/r1-extra/demo-stop-12.png`, `demo-stop-topdown-12.png`, `panel-fullgame-12.png` (grey
  ring/sign in the full game; the panel chip beside them is red). The showcase shots (`r1/transit_closeup-12.png`,
  `bus-queue-behind.png`) show the intended red.
- **Why it hurts**: the real game — the thing players see — renders every stop of the demo line grey, so the stop
  marker does not match its ribbon or panel chip. It compounds issue 2 (grey + white emissive = fully anonymous
  stops at night).
- **Fix**: call `refreshStops()` inside `refreshLineMembership()` (one choke point, also covers
  `createLine`/`removeLine`/`rebuildRoutes`/`loadState`), or add it to both line call sites.

### 2. Night stop lights glow white and the sign face reads as a dark hole
- **What**: `signMat`/`ringMat` are white plastics with `emissive:'white'` driven by `emissiveIntensity` at night,
  while `instanceColor` only multiplies *diffuse*. So at night every plate and ring glows white regardless of the
  line colour, and the proud white face plate (which has no emissive) silhouettes as a dark blue-grey slab on the
  glowing plate — the day design (coloured border, white face) is exactly inverted at night.
- **Where**: `shots/transit/r1-extra/stop-macro-night.png` (unmissable: white lightbox, dark inset),
  `r1-night/transit_closeup-21h5.png`, `r1/transit_default-21h5.png` and `r1/transit_aerial-21h5.png` (all four
  rings identical white), `r1-extra/ribbon-corner-night.png` (white ring/sign beside a red ribbon),
  `r1-extra/demo-bus-dwell-night2-21h5.png`.
- **Why it hurts**: night is a quarter of the review tods; here the night emissive is *misplaced* (glow on the
  border element, not the sign face) and colour-blind, so a multi-line network would be unreadable at night and the
  sign reads as broken rather than lit.
- **Fix**: tint emissive per instance — `onBeforeCompile` injecting `totalEmissiveRadiance *= vColor` for
  `signMat`/`ringMat` (instanceColor is bound in the shader whenever an InstancedMesh has colours) — and move the
  night glow to the white face plate (make it the emissive element, ~1.0–1.2, warm white) so the colour border and
  white face keep the day relationship. Reduce the ring's night intensity or leave it diffuse-only; a glowing ground
  ring is the loudest thing in every night frame.

### 3. Ground ring floats over the roadway and intersects sidewalk studs
- **What**: the ring is a 1.05–1.5 m annulus placed at sidewalk-top height + 0.05 (`stop.y = heightAt + 0.19`). On a
  ~2 m sidewalk it overhangs both the grass and the carriageway, so the road-side arc hovers ~0.24 m above the
  asphalt, and the 0.17 m sidewalk studs pierce the ring plane.
- **Where**: `shots/transit/r1-extra/stop-ring-grazing-12.png` (the road-side arc is visibly airborne over the
  kerb line; studs poke through the band), also visible in `r1-extra/demo-stop-topdown-12.png`.
- **Why it hurts**: a “floating/clipping geometry” check that is plainly visible at eye level — the largest single
  element at a stop is the one element that does not sit on the ground.
- **Fix**: shrink the annulus to fit the sidewalk (outer ≈ 0.8 m), and/or drape its vertices per-vertex with
  `roads.heightAt`, or lift it just above stud height (0.22) and clip it to the sidewalk polygon. If it stays
  oversized, at least keep it off the carriageway.

### 4. Route ribbon hue does not match the line colour, and reads as a lane marking
- **What**: the ribbon is a 0.42 m `MeshPhysicalMaterial` strip at the lane centre. Over dark asphalt at grazing
  angles its clearcoat reflects the sky, so the line's `brightRed` washes out to lavender/mauve, while the same
  line's ring stays red in the same frame; from other angles it reads salmon/pink. It looks like a painted stripe
  rather than the transit overlay the panel chip promises.
- **Where**: `shots/transit/r1-extra/demo-stop-topdown-12.png` and `stop-ring-grazing-12.png` (lavender band versus
  red ring), `bus-queue-behind.png` (dull purple-grey strip under the bus), versus
  `r1/transit_aerial-12.png` (salmon) and the correctly matching night glow
  (`r1-extra/ribbon-corner-night.png`).
- **Why it hurts**: line-colour identity is the overlay's whole job; two different reds for one line look like a
  bug, and from a bus the ribbon barely reads as “this is my route”.
- **Fix**: make it an unlit/emissive overlay the way `views` does for its grids (`emissive` = line colour,
  intensity ~0.2 day / ~0.55 night, so red never blends), and consider widening to 0.6–0.8 m; keep the verified
  0.05 m lift.

### 5. Minor — showcase compositions hide the subject
- **What**: `transit:default` frames the loop from ~100 m and `transit:aerial` from 118 m up, so the 1.6–2.6 m stop
  markers are a handful of pixels; only `transit:closeup` actually sells the module. The showcase is also an empty
  green arena (no props/buildings — shared staging), which the very wide `wide-aerial-12.png` makes obvious.
- **Where**: `r1/transit_default-*.png`, `r1/transit_aerial-*.png`, `r1-extra/wide-aerial-12.png`.
- **Why it hurts**: a reviewer (or player) browsing presets sees a thin red loop on an empty field and misses the
  stops/buses entirely.
- **Fix**: add a `transit:stop` preset that frames one stop from 4–6 m with the bus dwelling (stop positions are
  already in the module; no core request needed). Not a blocker on its own.

## Already planned — Wave C item C5 (**not** counted as defects)

- **Fare revenue** (ridership × fare as a `transit` income line) — builder caveat 5, roadmap C5.
- **Stop route-number plates** — builder caveat 1; the macro shots (`stop-macro-day.png`) show a clean but blank
  white face, which C5 will fill.
- **Rider/queue visuals at stops** — builder caveat 2.
- **Figure-eight boarding** — builder caveat 4, roadmap C5. My probe additionally shows that a line with a repeated
  stop can freeze its bus in an endless dwell at one stop, not merely board at the first pass; the C5 fix should
  cover the arrival condition for already-passed projections (`stopAhead` returning a negative d ≤ 1.2), e.g. by
  keying stops to a pass index/previous key instead of nearest-on-path. Not scored this round.
- Not C5-scoped but worth a pass: per-line ridership breakdown / rename in the panel (builder caveat 7).

## What already works

1. **Routing, lane discipline and dwell are real and independently measured** — the scripted key loop drives the
   bus exactly down lane centres, through right-turn connectors, with stop visits in order, ~3.2 s dwells, correct
   signal/queue behaviour, and every stop sign facing its lane exactly (dot 1.000) on the right of travel.
2. **Clean, cheap, deterministic implementation** — 0 errors in every capture and probe, 0 `Math.random`, only its
   own 4 files, 5 own meshes in the showcase (budget 12), gpuMs ≤ 6.68 ms in all 24 module captures, and a
   `getState`/`loadState` + roads-change re-route path that the builder's and my probes both exercised without
   console noise.
3. **The economy/UI loop is wired and readable** — coverage, ridership, buses, upkeep and per-line rows all render
   correctly in the panel and the HUD “Transit 11%” row; the night ribbon glows and stays continuous through every
   turn, which is the one night element that is working exactly as intended.

*Extra evidence: `shots/transit/r1-extra/` (13 shots + JSON sidecars; `probe-obb.json` holds the OBB figure).
Two framing attempts — `bus-dwell-side.png`, `demo-bus-dwell-night-21h5.png` — were discarded as unusable (a
passing van and a building facade occluded the subject); the reframed `bus-dwell-quarter.png`,
`bus-queue-behind.png` and `demo-bus-dwell-night2-21h5.png` are the ones to look at. My probe scripts live under
`C:\Users\ryuen\AppData\Local\Temp\opencode\` and touched nothing in the repo.*
