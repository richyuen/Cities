<!-- Saved verbatim by the orchestrator, 2026-10-09 (extracted from the critic agent's final message). Integrity check: git status and diff hash over src tools docs ARCHITECTURE.md index.html package.json identical before and after the run. Code reviewed: working tree at c14a8d0 + demo stage, after the orchestrator removed dressApproach() and the footprint-clip rule; before the infill fix for issue 1. -->

# loop-c6-demo-critic
verdict: PASS   score: 7.5/10 (CRITIC_BRIEF scale)

All gates I re-ran are green and I found no HIGH issue. The 01 frame is a real step up; 02, 03 and 05 are unchanged by this stage; 04 is marginally worse in one respect (fewer houses behind the farm, issue 1). I ran out the time box, so several items are marked unmeasured below.

Integrity: `git status --porcelain -- src tools docs ARCHITECTURE.md index.html package.json` was identical at the start and end of my run (the same 4 modified + 3 untracked files). I wrote only under `shots/` (via the repo tools and `openApp().capture`) and in my scratchpad.

Scratchpad: `C:\Users\ryuen\AppData\Local\Temp\claude\C--Git-Cities\ac5f4a89-9f27-4edc-becd-51e343f136f0\scratchpad\demo\` (`probe.mjs`, `probe-s1.json`, `cam.mjs`, `rt.mjs`, `stall.mjs` + `stall.log`, `check-detail.log`, `bg.log`).

## Gates

| gate | measured | command / output path |
|---|---|---|
| errors (default batch) | `[]` | `node tools/critic.mjs --game --round 63 --dir shots/game/c6d2crit` -> `C:\Git\Cities\shots\game\c6d2crit\summary.json` |
| perf (default batch) | minFps 123.7, maxGpuMs 7.78, max draws 824 | same |
| drift vs `c6h5` | 0/20 over 0.30, mean 0.0815, worst aerial-6h5 0.1805 | `tools/diff.mjs` -> `shots\game\c6d2crit\diff-c6h5.json` |
| repeat vs orchestrator's `c6d2` | mean 0.0011, worst closeup-12 0.0082 | scratchpad `diff-crit-vs-c6d2.json` |
| errors / perf (nosp batch) | `[]`, minFps 143, 6.89 ms, 750 draws | `--param nosp=1 --dir shots/game/c6d2crit-nosp` |
| drift nosp vs `c6h5-nosp` | 0/20 over 0.30, mean 0.0305, worst closeup-12 0.0835 | `shots\game\c6d2crit-nosp\diff-c6h5-nosp.json` |
| check-detail | 46/46. Block 2d: landmark true, storeys 2, porch, 2 dormers, siding; hFrac 0.775, width 0.34, 18.3 m; first hit the hero house; 43 demo-sp houses, 0 buried. nosp census e0f35033 == e0f35033 | `node tools/check-detail.mjs`, log in scratchpad `check-detail.log` |
| check-background | 4/4; 0 plate rays idle, 216 with a zone tool | `--out shots/background/c6d2crit` |
| check-civics, check-beauty | **not re-run** (time box); 38/38 and 37/37 are the orchestrator's numbers | none |
| Determinism, capture | my shot-list vs the orchestrator's, separate sessions: meanAbs 0 / 0.0043 / 0.0002 / 0.0011 / 0.0002 (01 maxDelta 0) | `shots\beauty\c6d2crit-s1\diff-c6d2-s1.json` |
| Determinism, state (seed 1, two boots) | props, buildings, park cells and set-piece rows (sites + cameras) hash-equal; 5327 props, 484 buildings, 634 park cells | `probe-s1.json` (`deterministic`: all true) |
| `Math.random` | 0 code hits in `src/demo` or `tools/check-detail.mjs` (one comment in citygen.js:746). `performance.now` only feeds stats | grep |
| Owner scope | `git diff --stat c14a8d0`: `src/demo/index.js`, `src/demo/setpieces.js`, `tools/check-detail.mjs`, plus `docs/LOOP.md` (the orchestrator's scoreboard row, not builder work). `citygen.js` untouched | git |
| `?showcase=demo` | errors `[]`, 4.84 ms, 669 draws | `shots\beauty\c6d2crit-wide\s1-showcase-demo.png` (looked at: whole-map aerial, city present, nothing broken) |

## Claims

| claim | reproduced? | my number | evidence |
|---|---|---|---|
| Boot stall 285 -> 436 ms on seed 1 (builder, state H) | **not reproduced** | Medians of 3 boots, idle GPU, HEAD served by interception (2 hits per boot): seed 1 114.7 -> 193.7; seed 2 93 -> 165; seed 23 110.6 -> 178.2. Delta +79 / +72 / +68 ms. Infill is 170.8 / 137.6 / 152.1 ms of it; park stamp + yard 2.2–2.7 ms | `stall.log` |
| Infill 42 / 38 / 42, cap 14 | yes | HEAD 25 / 22 / 26 -> tree 42 / 38 / 42; buildings 467 -> 484, 457 -> 473, 478 -> 496 | `stall.log` |
| Park cells stamped (builder state J: 241 on seed 1) | not the same state | 289 (seed 1: block 4,1 157 + block 2,1 132), 256 (seed 2), 302 (seed 23). Higher because the clip rule was removed | `probe-s1.json`, `stall.log` |
| `?sppark=0` leaves existing props untouched | yes, seed 1 | 4824 base props: 0 missing, 0 changed in the default city. The stamp adds 503: hedge 272, tree_small 103, tree_medium 61, tree_large 32, park_bench 12, figure 11, flower_bed 10, fountain 2. Buildings hash-equal | `probe-s1.json` (`sppark0Diff`) |
| +2–4 fountains per seed | yes, seed 1 only | 26 -> 28. New: p3181 at (-56, -352) and p3315 at (-148, -340), both in block 2,1. Seeds 2 and 23 not measured | same |
| `?spinfill=0` works | yes | 0 infill houses, 442 buildings, setPieceMs 22.7, yard props still 8, errors 0 | `probe-s1.json` |
| `?nosp=1` is the pre-cycle city | yes | 441 buildings, 4339 props, 391 park cells, setPieceMs 0.1; census e0f35033 | probe + check-detail |
| Yard props: 8 `demo-sp-yard-N` | yes | 4 hedges, 2 tree_medium, 2 flower_bed, all at y 2.4, mirrored at x 224.8–226.8 and 245.2–247.2. In `c6d2-s1/01` the right-hand pair stands on the verge, not on the sidewalk and not floating; the left side is hidden behind the pergola | probe; `C:\Git\Cities\shots\beauty\c6d2-s1\01-house-golden.png` |
| Save/load of stamped cells, yard props, infill, hero house | yes for demo content, in-page replay only | serialize -> JSON -> `applySave` -> 240 frames: park cells 634 -> 634, buildings 484 -> 484 (hash equal), yard 8 -> 8, 0 props missing, 0 moved, fountains 28 -> 28, hero keeps `landmark: true` and its colours, all three pieces still placed with cameras, errors 0. The 01 frame after the load holds (`s1-afterload-01.png`) | `probe-s1.json` |
| Same, the real `?load=` path through `menu/index.js` | **unmeasured** | none | none |
| Hazard (ii) warm-up economy equal | **not reproduced** | my probe read population as null on both boots | none |
| emptyPlain 2.2 / 3.3 / 12.6 / 14.9 / 10.9 (orchestrator) | yes | identical; baseline 11.7 / 4.2 / 12.6 / 16.2 / 10.9 | `shots\background\c6d2crit\summary.json` |
| "Less bare baseplate in 01" | yes, but mostly from the camera | building share 21.7 -> 48, sky 0 -> 12.1. The park stamp contributes 1.1 points of "park" | same |
| "Less bare baseplate in 04" | marginal | emptyPlain 16.2 -> 14.9, but building share **11.1 -> 7.2** and emptyZoned 0.7 -> 1.3 (issue 1) | same |
| Garden re-sited, shares block 4,1 with the farm on seed 1 | yes | garden 4,1/NW at (236, -389.95), farm 4,1/NE at (379.06, -379.17), 143 m apart. Neither hero frame shows the other piece | probe; 01 and 04 PNGs |
| Removed code leaves nothing behind | yes | no `dressApproach`, `demo-sp-lawn` or `infillFrames` anywhere in `src/demo` or the tool. The two grep hits (setpieces.js:509 "clips", :573 "approach side") are live comments | grep |

## Ranked issues

1. **MEDIUM: the 04 farm frame lost houses behind the farm.** `shots\beauty\c6d2-s1\04-farm-golden.png` against `shots\beauty\c6h5\04-farm-golden.png`: the baseline has a beige and a purple house top-right (around x 1470–1900, y 100–280) and an orange house at the left edge (y 150–250). In the new frame the top-right is bare stud lots and a tan path strip. The classifier agrees: building 11.1 -> 7.2. Set-7 judges J2 and J3 cited "simple houses on bare stud lots" and "bare baseplate blocks behind" on this pair, so this moves the wrong way on a judged reason. Cause: the camera-independent infill orders by distance to the piece's back edge with cap 14, which no longer favours the two streets this camera sees. Fix: for the farm, order by distance to the piece's bounds over both street-facing sides, or raise that one piece's cap until the frame's building share is back to at least 11. About 4 ms per extra house.

2. **MEDIUM: in 01 the ground right of the house is still coarse dark stud baseplate.** Seed 1: x 1100–1900, y 560–760, with hedge blocks sitting on it. Seed 2: x 1100–1500, y 580–760, plus empty stud lots across the street at left (x 0–470, y 430–600). The classifier now labels those cells "park/dressed", so the 2.2 emptyPlain understates what a judge sees. This is the pending lawn stage's job, but it is why I predict "narrows", not "closes", for 01.

3. **MEDIUM (game view, outside the judged frames): the stamped park reads thin and a little odd up close.** `shots\beauty\c6d2crit-wide\s1-fountain-new.png`: the new fountain p3315 is a small grey double disc standing on bare studs, with no paving, no path, and no visible water or spray at 25 m. `s1-house-noon-south.png`: a dashed row of six separate hedge blocks on bare studs right of the garden (x 1260–1440, y 630–690) and a lone bench at bottom-right. `s1-wide-skate.png`: six fountains in block 2,1 (two of them new). It matches how existing parks are dressed, so it is not a new defect class, but 272 added hedges mostly show as dotted lines. Fix path: the `populatePark` fountain option already requested in `docs/core-requests/demo-c6.md`; until then cap new clusters at zero fountains or skip the bounding-box hedge for stamped clusters.

4. **LOW: the pergola crowds the hero on every seed.** In all three 01 frames the pergola fills the left third and its near post and vine cross the porch's left balusters (around x 600–700, y 700–800). On seed 2 the vine leaves cover the swing figure's face (around x 170, y 940, `c6d2-s2\01-house-golden.png`). The set-7 judges noticed faceless figures. Fix: move the eye 1–1.5 m further from the pergola side, or lower `lateral`.

5. **LOW: a look-alike neighbour on seed 1.** The house across the street at the left edge of `c6d2-s1\01` (x 0–310, y 260–590) is also sage green with white trim, which dilutes the landmark. Seeds 2 and 23 do not have it. Fix: skip infill seeds that draw a sandGreen body within 80 m of the hero house.

6. **LOW: gate 2d is looser than the frame it guards.** "Unoccluded" is one ray to the house centre against buildings only, so props (pergola, parasol, trees) cannot fail it, and the size threshold is 0.58 against a measured 0.775. Fix: add a small ray fan over the porch against `raycastScene`, and raise the threshold to about 0.70.

7. **LOW: boot cost.** +68 to +79 ms, nearly all in generating 16–17 more houses. Acceptable. `flatLot` takes 81 terrain samples per candidate before the cap; sorting first and testing only until 14 are accepted would trim it.

8. **LOW: log noise.** Every seed-1 boot logs `set-piece site miss: garden@2,1/NE (4 cands, 0 exact)` because the first listed site can no longer pass the road-clearance rule. Reorder `SP_SPECS` sites or downgrade the message.

Outside this diff, for the orchestrator:
- **Save replay duplicates street furniture and yard dressing, with or without set-pieces.** In-page `applySave` grows props 4339 -> 6284 on the `?nosp=1` city and 5327 -> 7309 on the default city (new: streetlamp 768, traffic_light 242, figure 240, garden_bed 156, crate_stack 128 and others). No park kinds and no demo ids are among them, so the stamp is not the cause. Owner: menu/props/roads. The real load path is unmeasured.
- **White bloom patch on gable roofs at noon from high south angles.** `s1-house-noon-far.png` at (960, 470) on the hero house and at (1030, 390) on a second house. From 60 m (`s1-house-noon-south.png`) the roof is fine. Owner: buildings or lighting.

Unmeasured: check-civics and check-beauty; flags, save/load and fountain counts on seeds 2 and 23; my own shot-lists for seeds 2 and 23 (I looked at the orchestrator's 01 and 04 PNGs for both, not their 02); the real `?load=` path; the economy hazard. I did not open the 02, 03 or 05 reference images this session; those predictions rest on the set-7 audit text and the diff numbers.

## Metric prediction

Frames as they are now, before the lawn stage. Diff of `shots\beauty\c6d2-s1` against `c6h5`: 01 67.85, 02 0.41, 03 0.10, 04 5.53, 05 0.07.

| pair | reference advantage (set-7 reasons) | prediction | evidence |
|---|---|---|---|
| 01 house | Victorian house with siding, balusters, dormers; DOF and layered skyline; ours was "box houses, studded baseplate, empty baseplate lots" | **narrows** (no vote flips) | `c6d2-s1\01`: sage clapboard house fills about 3/4 of the height with a tiled red roof, two dormers, a four-post porch with balusters, shutters and flower boxes, so "box house" should disappear. Still theirs: brick-built texture, DOF, a rich skyline (ours is two cooling towers and a flat striped slab at x 100–460), a sunlit porch (ours is in shade), and the stud ground of issue 2. I expect "studded baseplate" or "flat lighting/no depth" to remain as reasons |
| 02 park | printed faces, textured brick ramps, tilt-shift; ours had blank figures, flat ramps, loose pieces | **no change from this stage** | Frame is visually identical to `c6h5\02` (0.41 meanAbs). Any narrowing comes from the already-committed props work (printed figures, tiled ramps are visible), not from the demo |
| 03 skyline | balloon, bridge, landmark towers, signage; ours had repeated towers, empty lots, sun bloom | **no change** | 0.10 meanAbs against baseline; emptyPlain 12.6 unchanged |
| 04 farm | brick windmill, barn, farmhouse, trucks, bales, deer, coastline; ours had bare baseplates and simple houses on stud lots | **no change, with a risk of slightly worse** | Subject unchanged. Bare studs remain at the left edge (x 0–180, y 520–1080) and bottom-right (x 1400–1920, y 780–1080) on all three seeds; three trees added at left; houses top-right removed (issue 1). I expect "bare baseplate" to be cited again |
| 05 avenue | readable signs, café umbrellas, bus, cars; ours had an empty road, oversized studs, repeated towers | **no change** | 0.07 meanAbs against baseline |

Overall: 0/5 again, with the reason shift confined to pair 01.

## What works

- **The 01 hero frame.** Against the baseline's small red box seen from above, the house is now the subject: readable porch, balusters, dormers, siding and window boxes, with garden figures and a parasol table in the foreground and a street of houses behind. It holds on seeds 1, 2 and 23 and survives a save replay.
- **Determinism and isolation.** Two cold boots hash-equal on props, buildings, park cells, sites and cameras; my shot-list matches the orchestrator's to 0–0.0043 across sessions; `?sppark=0`, `?spinfill=0` and `?nosp=1` each isolate exactly what they claim, and the stamp changes none of the 4824 existing props.
- **Cost.** Under 80 ms of extra boot time, no measurable frame cost (7.78 ms, 824 draws against 7.76 / 824 in the orchestrator's run), and the nosp city is still census-identical.
