# loop-c5-critic (E3 round 1, props set-pieces)
verdict: FIX   score: 6.5/10 (CRITIC_BRIEF scale; it's the set-piece content rated at hero distance. Real Blox-diorama layering, held back by box-people figures, flat ramp faces and brown wheat)

Integrity: `git status --porcelain -- src tools docs ARCHITECTURE.md index.html package.json` shows the same 7 entries before and after my run (the builder's 6 src/props files plus the untracked recon doc). Every capture I made is under `shots/` (gitignored), from the repo's `tools/shot.mjs` `openApp`/`capture`, `tools/critic.mjs`, `tools/check-*.mjs` and `tools/diff.mjs`. My driver scripts ran from the session scratchpad, outside the repo.
Orchestrator integrity check (LOOP §8): tree state and diff hashes were identical before and after this run, so the review is valid.

## Gates
| gate | measured | command / output |
|---|---|---|
| errors [] | 0 in every capture: 2 game batches, 56 showcase captures, 3 in-game placement sessions, 4 check tools | shots/game/c5crit*/summary.json; shots/props/c5crit/{show,game}/*.json |
| gpuMs ≤ 20 | game batch max 10.05 (c5crit) / 10.1 (c5crit2). With 3 set-pieces placed in the live city: hero max 11.58, and the same-session A/B adds +0.29 to +0.93 ms | `node tools/critic.mjs --game --round c5crit[2]`; shots/props/c5crit/game/cost-report.json |
| drawCalls ≤ 1500 | batch max 934. With 3 set-pieces: max 926 (hero), +61 scene draws at every preset | same |
| props own draws ≤ 300 | game 61 (75 with 3 set-pieces), showcase 41 | check-detail; shots/props/c5crit/show/report.json |
| no Math.random | `grep -rn Math.random src/props` finds nothing (exit 1) | — |
| determinism | Set-piece frames reproduce across sessions: skate-12 0.0688, skate-175 0.0333, farm-175 0.0197 vs the builder's finals. Game c5crit vs c5crit2 mean 0.0722, worst 0.2214 | shots/props/c5crit/show/repro-diff.json; shots/game/c5crit-diffs/ |
| regression vs r49 | c5crit mean 0.0526, worst closeup-12 0.1021, 0/20 over 0.30. c5crit2 mean 0.0627, worst overview-21h5 0.282, 0/20 over | shots/game/c5crit-diffs/r49__c5crit*.json |
| owner scope | `git diff 1876d3b --stat` touches only src/props (4 files) plus 2 new src/props files | — |
| check-detail | 38/38 on the current code. Census e0f35033 == e0f35033, pre-C2 22ed04cd == 22ed04cd, 4339 props, own draws 61 | `node tools/check-detail.mjs` → shots/props/c2/summary.json |
| check-civics / beauty / atmosphere | 38/38, 37/37, 22/22 | shots/civics/r2, shots/beauty/c5crit, shots/atmosphere/b3 |

## Claims
| claim | reproduced? | my number | evidence |
|---|---|---|---|
| 1. 15 roles, 47 kinds, API, ?nosp, `setpieces` variant with 3 presets | yes | 15 sp-* roles in the scene; SP_KIND_NAMES = 47; `?nosp=1` gives setPieces 0, spProps 0, spOff true | show/report.json, show-demolish run |
| 2. showcase own draws 41, scene 227-244, gpuMs 5.79-6.88, counts | yes, with small differences | own 41; scene 229-245; gpuMs 5.61-6.81; skate 78/23/25, garden 90/10/26, farm 123/20/30 | show/report.json |
| 3. live game unchanged; c5p numbers | reproduced from their files | c5p-base vs c5p 0.0365 / worst 0.0983; r49 vs c5p overview-21h5 0.4014; HEAD (c5p-base) vs r49 also over on the same file, 0.3785. My current-code runs are 0/20 over | c5crit-diffs/*.json |
| 4. check-detail 38/38, hashes | yes, on the current code | as in Gates | shots/props/c2/summary.json |
| 5. determinism | yes for set-piece pixels. The showcase house is not stable (see issue 6) | as in Gates | — |
| 6. no Math.random | yes | — | grep |
| 7a. props at deckY+lift | yes, including rotated and resized pieces | max error 0 at rot 0 and at rot 0.9 / -2.3 / 0.5 (skate 28x22, farm 46x34) | show/report.json |
| 7b. building demolishes | yes | farm removed, 0 props left | show/demolish-report.json |
| 7c. road demolishes | yes in the live game; inert in the showcase (road handlers are game-only) | g-skate removed, 0 props left | dbg2 run |
| 7d. foreign prop inside a rect is evicted | yes | — | demolish-report.json |
| 7e. save/load rebuilds the registry | yes | same ids, counts (123/78/90) and deckY after `applySave`; 0 foreign props inside the rects. The total prop count grew 4800→6272, but my in-session applySave skips the page reload the menu's real load does first, so this is not attributed to the set-pieces | game/report.json |
| (c) working tree holds the final code | yes | Vite serves the new symbols in all 6 files. Edit times: tracked files restored 19:31:01, spkinds/setpieces last edited 19:37:46, finals captured 19:38:28. **c5p (19:31-19:33) and close/ (19:34) predate the last edits.** My reruns on the current code replace them | file mtimes |

## Ranked issues
1. **HIGH: `setPieceBlockers` passes zoned land, and the zoning glass plates show through the whole set-piece.**
   - Evidence: shots/props/c5crit/game/skate-hero-12.png and skate-hero-17.5.png show large translucent green cell rectangles over the pavers, ramps and figures. skate-hero-17.5-overlay-off.png, with only the `zoning` group hidden, is clean.
   - The skate rect sat on 80 `zone:r` cells, and blockers returned [] (zone-report.json).
   - Zoned cells will also grow buildings, which then silently demolish the set-piece through `sweepSetPiecesForBuilding`.
   - Why it hurts: any demo siting that trusts the API gives a tinted, "ghostly" hero. Set 6 already penalised "ghostly translucent" in pair 02.
   - Fix: report `zone:i,j` (any `cell.zone`) as a blocker, and have demo de-zone or claim the cells. Optionally raise SP_DECK_RAISE above the plate top.
   - Also: each rect covered 40-76 `road`-type cells (verge/sidewalk) with blockers []. Nothing visible broke in garden-hero-17.5, but the demo should keep a 1-cell margin.
2. **MED: wheat reads as dark rust-brown fuzz at hero distance, not golden** (final/farm-175.png, game/farm-hero-12.png). The reference wheat is bright orange-yellow. Dense self-shadowing makes it darker. Fix: brighten WHEAT, thin it out, or stop wheat from casting onto itself.
3. **MED: triangle cost.**
   - Unique set-piece instance triangles: 1.52M for 3 pieces.
   - Scene triangles (with shadow cascades): +7.25M at overview, aerial and skyline (+21%; 33.98M→41.23M at overview), and +0.29 to +0.93 ms GPU (cost-report.json).
   - Draws are flat: more set-pieces add 0 draws. Triangles scale linearly at about 2.4M scene triangles per piece.
   - Heavy geometry: sp-leaf 1812 tris/instance (216 instances = 391k), sp-corn 1224/instance (280 = 343k), sp-brick 300/instance.
   - Wheat/corn instancing scales on draws, not on triangles. Fix: a cheaper leaf/corn mesh, and no shadow casting for crops.
   - The CPU rebuild() cost of the extra parts is not measured: my probe raced the frame loop.
4. **MED: the tractor driver's straw-hat crown pokes up through the cab roof** (show/rot0-farm-tractor-17.5.png, the tan disc on top of the green canopy). Fix: drop the driver's lift or the hat, or raise the canopy.
5. **MED: the builder's hero frames are 40-55% empty studded plain, with moiré rings in the far stud field** (final/garden-175.png top, final/farm-175.png, show/rot-farm-hero-12.png). They are fine as module evidence but cannot stand in for the blind shots. Demo hero cameras must be re-validated in the city, where my placements show roads, buildings and traffic behind the pieces.
6. **LOW-MED: the garden showcase house depends on stage order.** My repro garden-12 shows a 2-storey green house where the builder's shows a purple single-storey house with blown-out white windows at noon (diff 6.32; garden-175 4.14; farm-12 1.39). The set-piece pixels themselves match. The blown-out windows also weaken the pair-01 frame.
7. **LOW: figures are 3-box people.** They have faces at close range, but no hair, posed arms or rounded heads (show/rot0-skate-bank-17.5.png, rot0-skate-ledge-12.png). The reference minifigs carry character. The ledge sitter reads as standing behind the ledge from the front.
8. **LOW: ramp faces are flat single colours.** The reference slopes have plate seams and two-tone bands.
9. **Process:**
   - The builder deleted a failed batch, which the §2 evidence rules don't allow.
   - Red flag (a): drift scales with the frame offset between batches. Against r49: c5p averaged +159 frames (worst 0.4014); HEAD c5p-base averaged +116 (worst 0.3785); my c5crit averaged +27 (worst 0.1021).
   - So the over-budget overview-21h5 is a harness artifact that HEAD has too, not the new code. With zero set-pieces, every new code path is guarded by `S.setPieces.size`, so the placer and eviction code is inert.
   - The deleted run (mean 0.3516, overview-12 1.79) can't be checked. 1.79 is far beyond what frame offsets produce (about 0.1 at 250 frames for overview-12). It was probably a mid-edit served module. Two clean reruns on the final code don't reproduce it.
   - The §2 statement that captures "depend on (seed, tod, preset, settle) rather than session length" is false for traffic and pedestrian animation. That is a pre-existing harness issue.

FIX list for this cycle:
- (1) zone blockers, or have demo claim the cells
- (2) wheat colour
- (4) hat clip
- Recommended: (3) leaf/corn triangle and shadow trim.

## Metric prediction (showcase frames shots/props/c5/final; city context also checked in my in-game placements)
| pair | reference's deciding advantage (set 6) | prediction | evidence / what still decides it |
|---|---|---|---|
| 01 house (ss_0875) | richly detailed Victorian house with porch, layered landscaping, pergola, planters, city skyline | **narrows** | garden-175/12 now has a pergola with a swing, raised beds, pond, sandbox, arbour and hedges, so the "near-empty green fields / layered landscaping" reason should go. Still deciding: the house is the reference's subject, and ours is a small flat block (blown-out windows in the builder's frame). The backdrop is an empty plain. The city context must add a detailed house (porch, roof variety) filling about 30% of the frame and city blocks behind; no DOF. |
| 02 skate (ss_1522) | packed minifigures, ramps, props, layered surfaces, crisp light | **narrows (strongest)** | skate-12 nearly copies the reference layout (bank + vert + planter ledge + hoops + pallet + 23 figures), so "bare stud field" should go. Still deciding: box figures vs minifigs, flat ramp faces, no street/house/car context. The city must avoid zoned land (issue 1) and put a street and houses at the frame edges as the reference does. A win is plausible but under 50%. |
| 03 skyline | unchanged | **no change** | no set-piece is in the skyline frame. |
| 04 farm (ss_b3e4) | full farm district: golden crops, windmill, barns, trucks, about 25 figures, surrounded by town and roads | **narrows** | the class now matches (windmill, barn, silo, corn, wheat, tractor, pickup, 20 figures), so "blank white wall / few props" should go. Still deciding: the reference is a whole district with roads, houses and traffic around the farm, while the showcase frame is half empty plain. Brown wheat, box figures. game/farm-hero-12.png (city around it) is much closer than the showcase frame. The demo must site it next to roads and houses and frame it like that. |
| 05 street | unchanged | **no change** | — |

## What works
- Gates and isolation are clean: the live game is unchanged at zero set-pieces (2 reruns, 0/20 over vs r49; check-detail census hashes unchanged), and the gate checks are all green.
- The layout code holds up: rotated and resized placements render correctly with deck error 0. Deterministic content ids reproduce the set-piece pixels across sessions. Building and road demolition, eviction, `?nosp` and the registry rebuild all work.
- The content is the right class: dense, layered, sunlit dioramas made from shared instanced roles. 3 placed pieces cost +61 draws total, and more pieces add none.
