# loop-c5-critic-r3
verdict: **PASS** (ready for blind set 7; two non-code conditions listed under issues 1 and 2)   score: 7.5/10 (CRITIC_BRIEF scale, judged on the five c5crit3 frames as a set; round 2 scored 7.0 on set-piece content alone)

**Integrity.** `git status --porcelain | md5sum` = 0ec49003… and `git diff | md5sum` = a7168372…, identical before and after my run. Every capture is under `shots/`, produced either by the repo tools or by driver scripts that import `tools/shot.mjs` `openApp`. The drivers are in the session scratchpad at `scratchpad/r3/` (batch-oldreset, diag-plates, diag-infill, diag-frames, diag-kinds, seeds, diag-intrude, diag-load), outside the repo. No file in the repo was edited.
Orchestrator integrity check (LOOP §8): tree state and diff hashes were identical before and after this run, so the review is valid.

## Gates
| gate | measured | command / output |
|---|---|---|
| errors [] | 0 in every capture: game batch, 3 shot-list runs, 6 seed hero frames, 3 no-infill frames, growth and save/load sessions, 4 check tools | shots/game/c5crit3/summary.json; shots/beauty/c5crit3*/summary.json |
| gpuMs ≤ 20 | batch max **11.08**; shot list max 9.16 | `node tools/critic.mjs --game --round c5crit3 --dir shots/game/c5crit3` |
| draws ≤ 1500 | batch max **1021**; shot list max 961 | same |
| fps ≥ 50 | batch minFps **88.1** | same |
| no Math.random | `grep -rn "Math.random\|Date.now" src/demo src/core/debug.js` finds only a comment. `performance.now` is used only for the stats timer | — |
| determinism (shot list) | second run vs first: 0.013 / 0.108 / 0.032 / 0.0004 / 0.032 (01-05) | shots/beauty/c5crit3-rep, c5crit3-diff-rep.json |
| determinism (batch) | c5crit3 vs the orchestrator's c5o-sp: mean **0.040**, worst closeup-21h5 0.108, **0/20 over 0.30** | shots/game/c5crit3-diff-c5osp.json |
| check-detail | **40/40**; census d38cf5c7; `?nosp=1` hash e0f35033 == e0f35033 | `node tools/check-detail.mjs` → shots/props/c2/summary.json |
| check-civics / beauty / atmosphere | 38/38, 37/37, 22/22 | shots/civics/r2, shots/beauty/c5crit3-beauty, shots/atmosphere/b3 |
| closeup subject kept | closeup preset pos/target identical with set-pieces on and with `?nosp=1` on seeds 1, 2 and 23 | shots/demo/c5crit3/seeds.json |
| set-pieces sited | 3/3 placed on seeds 1, 2 and 23. Occlusion on the final city is 0/15 rays on every chosen camera. Seeds 2 and 23 log one fallback each ("garden@2,1/NE … 0 exact") and use the next site | seeds.json |

## Claims
| claim | reproduced? | my number | evidence |
|---|---|---|---|
| (A) lots reserved in never-zoned park/plaza blocks, corner-flush, civic-clear | yes | blocks 2,1 / 4,1 on all three seeds. After 3 game days at x30, every rect still has 0 zoned cells, 0 built cells and 0 C2 props inside | seeds.json; diag-intrude output |
| (A) hero camera 0/15 occluded | yes | 0 blocked, centre clear, on all 9 cameras (3 seeds × 3 pieces) | seeds.json |
| (A) `?nosp=1` = pre-cycle city | yes | census e0f35033; residential kinds identical (144 L2 apartments, 106+4 L3 towers) | check-detail; diag-kinds |
| (A) live growth: 3/3 survive | yes | 3/3 after 3600 frames at x30 | diag-infill "growth" |
| (A) empty plain: garden 24.3 / skate 12.3 / farm 23.6 % (seed 1) | not reproduced (different classifier) | my 64×36 ray grid, counting sidewalk and verge inside a road footprint as road and counting cells with a prop within 3 m as dressed: garden **13.7**, skate **4.9**, farm **16.9** % (zoned 1.8 / 0.6 / 0.7 of that) | shots/demo/c5crit3/cls-s1.json |
| (A) infill houses behave like normal buildings | yes | 26/26 tracked by the sim, 0 unserved; 26/26 level up within 3 game days; 26→26 survive a serialize→applySave replay | diag-infill |
| (B) only zoning reads `clock.elapsed` | yes | readers are `src/zoning/index.js:322` and `Clock.update`. Audio and indicators use their own `elapsed` fields. Saves do not store it. `resetPresentation` is called only from tools (shot, shot-list, check-beauty, check-dof) | grep |
| (B) same-code repeat 0.004 | plausible | my cross-session repeat is 0.040 / 0/20 | c5crit3-diff-c5osp.json |
| (B) "r49 vs c5o-nosp 10/20 over **purely from that harness change**" | **falsified** | I disabled the new reset lines in-page (override of `__city.resetPresentation`; clock.elapsed reached 68 s, so the override held). The nosp batch is still **8/20 over vs r49, overview-12 1.79**, and is close to c5o-nosp (mean 0.15, 1/20 over: overview-21h5 0.49, pulse phase) | shots/game/c5crit3-nosp-oldreset; c5crit3-diff-r49__nosp-oldreset.json; c5crit3-diff-c5onosp__nosp-oldreset.json |
| (B) the swept plate look is what players get | yes | on an unpaused nosp boot with no tool calls, the zoning materials have no USE_CSM at frame 125 and have USE_CSM by frame 727 (about 12 s) | diag-plates |
| (B) `--param` repeatable | yes | `--param nosp=1 --param spinfill=0 --param foo` → URL `…&nosp=1&spinfill=0&foo=1`. Edge cases: `k=a=b` keeps only `a`; `k=` gives `''` | shots/game/c5crit3-param/twoparams.json |
| (B) check-detail exclusion hides nothing | yes, it hides no demo-sp house | all 26 demo-sp houses carry yard dressing: 2-12 C2 items each, median 7 (the garden house has 2 more from the set-piece) | shots/demo/c5crit3/infill-A.json |
| (B) `--list set6` = set 6 plus harness drift only | **false for 01/02** | 01 meanAbs **44.6**: the finder now picks `demo-sp-infill-garden-7` (yard 16, counting the garden set-piece's props) instead of b352. 02 is 1.12 because the skate plaza is in the background. 03 0.87, 04 0.11, 05 0.41. Compared with `--dof 0.85`, which set 6 used | shots/beauty/c5crit3-set6-d085; c5crit3-diff-set6-d085.json |

## Ranked issues
1. **MED (orchestrator; doc fix before set 7): the cause of the r49 gap is stated wrongly.** Disabling the new lines does not bring the nosp city back to r49 (still 8/20 over, overview-12 1.79). The real cause is the old harness's boot-time race: plates get CSM only when a sweep fires (none at frame 125, present by frame 727), and today's sessions land on the other side of that race from r49. The new reset removes the race, so re-basing on c5o-nosp is correct. Fix: reword LOOP §7 to "pre-existing sweep race, made deterministic by the reset; not reproducible against r49". Separately, the zoning comment "frozen while paused" is false: `Clock.update` advances `elapsed` while paused. It is harmless under `fixeddt`.

2. **MED (demo builder): infill fairness. Ruling: keep, with conditions.**
   - The infill houses are real buildings: tracked by the sim, served, they grow, and they survive save/load. A player who opens the city sees them.
   - But they are **the only `house`-kind buildings in the whole city**. The pre-cycle city has 0 houses (every grown residential building is an L2 apartment or L3 tower).
   - They sit only inside hero frustums (14 garden, 11 farm, 0 skate on seed 1).
   - They densify in play: 26/26 level up within 3 game days. The garden house becomes a 4-storey red apartment (shots/demo/c5crit3/after-load-garden.png).
   - Without infill (`?spinfill=0`), the backgrounds become rows of empty lots under light-green zoning plates (noinfill-garden.png, noinfill-farm.png).
   - Road-facing r lots are 15% built within 140 m of the hero targets and 14% elsewhere, so the frames are not denser overall. Only the building *type* is unrepresentative.
   - Conditions:
     - (a) Before set 7: the cycle report must say plainly that cottage houses exist only around the set-pieces and densify in play.
     - (b) Follow-up (W4): make placement camera-independent, e.g. every road-facing r lot within a radius of each set-piece, and decide whether the garden house should be a non-growing landmark.

3. **LOW-MED (orchestrator): `--list set6` is not a reproduction.** See Claims. Fix: exclude `demo-sp-*` from the house finder in the set6 list, or run it under `nosp=1`. That needs issue 4.

4. **LOW (orchestrator): `tools/shot-list.mjs` drops `--param`.** `extra` is built only from `--dof`. Merge `a.extra` with `dof`.

5. **LOW (core/orchestrator, metric-relevant): zoning plates still show in hero backgrounds.**
   - 01: rows of light-green plates at top right (crop: scratchpad/r3/garden-bg.png).
   - 04: plates beside the houses at the top of the frame.
   - Set 6 judges named "untextured green plots" and "empty green lots".
   - Fix: hide the zoning group in `?hud=0` capture mode, or exclude zoned-empty cells from frames.

6. **LOW (demo): the skate frame has no town context.** Infill is 0 on seed 1, and the steep camera shows only roads and studded corners at the edges. The reference wins its edges with a shopfront, a house and a car. A lower or rotated camera that catches the buildings across the street is the cheapest lever for 02.

7. **LOW (demo): the empty-plain target is met in spirit.** On my classifier, garden (13.7%) and skate (4.9%) are under 15% and farm (16.9%) is close. On the builder's stricter classifier, garden and farm miss. Looking at the pixels: 01 has a studded strip down the left edge and a lawn to the right of the garden (about 10-15%); 04 has studded lawn at the left and right edges. I would not block set 7 on this.

8. **LOW (orchestrator): check-detail coverage gap.** The exclusion hides no undressed set-piece house (all 26 have 2-12 items), but it leaves the pre-existing undressed b392 covered only by stride luck. Add an explicit check that every `demo-sp-*` house has ≥ 1 yard item, and file b392 with props.

9. **LOW (demo): the garden house look is seed-dependent.** On seed 2 it is a one-storey yellow box (s2-garden.png); the "all two-storey" comment holds only for seed 1. Blind captures use seed 1.

10. **LOW (01 framing): edge clutter.** Orange tree crowns are cut at the bottom-left and bottom edges, and half a minifig head sits on the bottom edge (around x 540-600).

11. **Note (pre-existing, props/menu, not cycle 5):** a serialize→applySave replay inflates props by about 45% (nosp: 4339→6274). In the default city it adds 2 C2 props inside the garden deck (yellow crates by the door in after-load-garden.png).

## Metric prediction (c5crit3 frames vs docs/reference)
| pair | reference's deciding advantage (set 6) | prediction | evidence / change vs round 2 |
|---|---|---|---|
| 01 house (ss_0875) | detailed Victorian house with porch, layered landscaping, pergola, planters, soft skyline | **narrows** (stronger than r2) | Round 2 predicted from a house on an empty plain. The frame now has a pergola swing, sandpit, swings and slide, raised beds, pond, umbrella table, chickens, 8+ figures, and a town behind. The landscaping reason class should disappear. Still decided by the house itself: a plain red box with flat window panels, about 12% of the frame, no porch or trim, plus plates in the background. Expect "plain house / flat facade" as the next reason. |
| 02 skate (ss_1522) | packed minifigs, ramps, props, layered surfaces, crisp light | **narrows (strongest; the likeliest win)** | Same class as r2, now delivered: about 22 posed figures, two-tone ramps, rails, a fun box, planters and a mural, all crisp at noon. The remaining gap is context (the reference has a shopfront, house and car at the frame edges; ours has roads and studded corners) and plainer figure detail. |
| 03 skyline (ss_abbf) | dense varied diorama, landmarks, no blur | **no change** (reason shift) | Same composition, DOF off, so the "DOF mush" reason should go. Repetitive towers over empty green lots with plates remain. Still a loss. |
| 04 farm (ss_b3e4) | full farm district: golden crops, windmill, barns, trucks, figures, town | **narrows** (stronger; class now matched) | Round 2 had a farm on a plain with civic-vs-farm unmatched. The frame now has a windmill, red barn, silo, tractor, pickup, golden wheat, a corn plot, vegetable rows, a pergola, about 12 figures, and town houses beyond two streets. The "blank wall / few props" reason disappears. The reference still wins on scale (several fields and roads with traffic) and a foreground row of houses. |
| 05 street (ss_f6da) | signage, awnings, vehicles, figures, sharp detail | **no change** | Same composition, DOF off, so the blur reason goes. The right 40% of the frame is a bare stud field, the road is mostly empty, and there is no signage. |

## What works
- The siting is clean and honest under falsification. 3/3 pieces are placed on three seeds with 0/15 occlusion. Nothing zones, builds or dresses inside a rect after 3 game days. The closeup subject is unchanged on every seed. `?nosp=1` returns the pre-cycle census.
- The 01/02/04 frames now show authored subjects at diorama scale with real context. 02 and 04 are the strongest frames the loop has produced (shots/beauty/c5crit3/02-park-noon.png, 04-farm-golden.png).
- The orchestrator's `resetPresentation` change is safe (zoning is the only reader of `elapsed`; tools are the only callers) and removes a real event-history race. Only its stated attribution is wrong.
