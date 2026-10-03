# loop-c5-critic-r2
verdict: PASS (props side ready for demo siting, with the demo conditions in issues 1-2)   score: 7.0/10 (CRITIC_BRIEF scale, set-piece content at hero distance; round 1 was 6.5)

Integrity: `git status --porcelain -- src tools docs ARCHITECTURE.md index.html package.json` showed the same 8 entries before and after my run. `git diff 1876d3b --stat` touches only src/props (4 tracked files plus the untracked spkinds.js and setpieces.js). Every capture is under `shots/`, made with the repo's `tools/shot.mjs` (`openApp`/`capture`), `critic.mjs`, `check-*.mjs` and `diff.mjs`. My driver scripts are in the session scratchpad at `scratchpad/r2/`, outside the repo.
Orchestrator integrity check (LOOP §8): tree state and diff hashes were identical before and after this run, so the review is valid.

## Gates
| gate | measured | command / output |
|---|---|---|
| errors [] | 0 in every capture: game batch, 50 A/B captures, about 90 showcase close-ups, 4 game placement sessions, 4 check tools | shots/game/rc5crit-r2/summary.json; shots/props/c5crit-r2/** |
| gpuMs ≤ 20 | batch max 10.14 (street-21h5) | `node tools/critic.mjs --game --round c5crit-r2` → shots/game/rc5crit-r2 (the tool prefixes "r") |
| drawCalls ≤ 1500 | batch max 934. With 3 set-pieces placed, max 968 (street) | same; shots/props/c5crit-r2/ab/ab.json |
| fps ≥ 50 | batch minFps 96 | same |
| props own draws ≤ 300 | 61 with no set-pieces, 82 with 3 (builder: 81) | ab.json `ownDraws` |
| no Math.random | `grep -rn Math.random src/props` finds nothing (exit 1) | — |
| determinism | my showcase farm hero at 12 vs the builder's c5fix/final/farm-12: meanAbs **0.0**. skate-12: **0.0**. Builder det-a vs det-b: 0.0 | python meanAbs over the PNGs; shots/props/c5fix/det-diff.json |
| regression | vs r49: mean 0.0322, worst overview-21h5 0.1137. vs c5crit: 0.0369 / closeup-12 0.0904. vs c5p2: 0.0288 / overview-21h5 0.1386. **0/20 over 0.30** in all three | shots/game/rc5crit-r2/diff-vs-{r49,c5crit,c5p2}.json |
| check-detail | 38/38. Census e0f35033 == e0f35033, pre-C2 hash 22ed04cd == 22ed04cd. City pedestrians unchanged | `node tools/check-detail.mjs` → shots/props/c2/summary.json |
| check-civics / beauty / atmosphere | 38/38, 37/37, 22/22 (the builder did not run these this round) | shots/civics/r2, shots/beauty/c5crit-r2, shots/atmosphere/b3 |
| owner scope | src/props only | `git diff 1876d3b --stat` |

## Claims
| claim | reproduced? | my number | evidence |
|---|---|---|---|
| 1a. round-1 zoned skate site refused with 16 blockers | **yes** | (24,-24) rot 0: 16 blockers (10 cell:road, 6 zone). rot 0.7: 17. rot π/2: 17. margin 8: 44 | shots/props/c5crit-r2/game/sites-seed1.json `probes` |
| 1b. margin option works on plain and rotated rects | yes | free site (-224,-184): 0 blockers at margin 0/1/2. At rot 0.7, margin 1 gives 3 and margin 2 gives 5. Margin 8 gives 12-14 | same |
| 1c. `zone:changed` over a piece demolishes it | **yes** | `zoning.setZoneRect` on one overlapping edge cell → piece gone, spProps 0. `world.setZone` on the centre cell of a 45° piece → gone | game/zone-demolish.json |
| 1d. `zone:changed` near a piece does NOT demolish | **yes** | 45° piece: the cell inside its AABB corner but outside the rotated rect (SAT) was zoned and the piece stayed. De-zoning (zone null) over a piece leaves it standing. (My first two "near" cells were road cells, so setZone refused them and the test was moot.) | same |
| 1e. free site at margin 2 shows no tint | yes (my own placement) | — | ab/*-with-*.png; game/lively-farm-*.png |
| 2. wheat golden; emissive 0.55 by day, 0 at night | **yes** | emissiveIntensity read live: 0.55 at 6.5/12/17.5/18.0/18.1; 0 at 18.5, 19, 21.5 and at a 21.5 boot. castShadow false | show/figs.json `wheatE`; show/night.json |
| 3. triangle trim / cost | **partly**. Not reproduced exactly: my sites differ | 3 pieces at margin-2 sites add **+2.68 to +2.77M scene tris** (builder: +4.46M at overview) and **+82 to +94 scene draws**. gpuMs A/B (5 alternating reps, medians): overview -1.10, aerial -1.40, skyline -1.44, street +1.17, closeup +1.15 ms. The sign flips and the ranges overlap (e.g. overview with 7.44-8.85 vs without 6.66-9.38), so **no GPU cost is resolvable above ±1.5 ms of noise** | ab/ab.json |
| 4. tractor canopy clears the driver | **yes** | low-front, level-side and top views: the straw hat sits well below the canopy, and the posts end at the roof. The shins are hidden inside the body brick, which reads as sitting in a cab | show/tractor-*.png |
| 5. minifig roles, posed arms, ledge sitter, ramp bands | yes | 24 figures (each kind × set-piece × lift) at 2.0-2.2 m from front, back and side: no arm passes through a torso, no floating head, no stud pokes through hair or caps. Two-tone ramp bands are visible | show/fig-*.png; game/lively-skate-17.5.png |
| 6. fixed house ids, no noon blow-out | **not reproduced**. The house is now stable, but the frame still depends on staging | garden at 12 after any other stage (3 orders) is meanAbs **0.0** vs the builder's final, so the fixed ids work. A shot.mjs restage differs by **1.63**, and the builder's own final shows white blooming corner quoins on the front house | shots/props/c5crit-r2/order/*; show/garden-hero-12.png |
| gates (check-detail, c5p2, determinism) | yes | as in Gates | — |
| c5p2-failed-1 "external load" | **plausible, source not identified** | Per shot, gpuMs stayed within ±0.8 ms of c5p2 (max 10.16 vs 10.19) while fps fell to 40.7-51. Wall time between captures stretched (aerial-12→aerial-18: 14.4 s vs 8.2 s). That is host/CPU pacing, not GPU cost. check-detail finished at 20:22:32, before the slow captures (20:23:18-20:23:50), and no other shots/ output falls in that window | shots/game/c5p2-failed-1/*.json; file mtimes |

## Ranked issues
1. **MED (demo-blocking for the metric, not a props defect): the strict blocker leaves only fringe sites. No seed-1 site with a lively context exists without demolition.**
   - Full scan of the city box on an 8 m grid, rot 0 and π/2 (sites-seed1.json):

     | type | margin | free sites | ≤10 m from a carriageway | ≤20 m | best lots within 50 m |
     |---|---|---|---|---|---|
     | skate | 0 | 4746 | 882 | 2492 | 4-7 (7 sites); 4739 have 0-3 |
     | skate | 1 | 4612 | 760 | — | 4-7 (6 sites) |
     | skate | 2 | 4417 | 600 | — | 4-7 (5 sites) |
     | farm | 0 | 3428 | 787 | — | 4 at most |
     | farm | 1 | 3015 | 438 | — | 3 at most |
     | farm | 2 | 2738 | 254 | — | 3 at most |

   - De-zoning does not rescue it. Sites blocked only by zone cells top out at 5 lots for skate and 3 for farm (dezone-census.json).
   - Allowing road cells too (blocked only by zone and cell:road) tops out at 6 for skate and 4 for farm (lively-census.json).
   - The cause is that `cell:road` marks the whole 8 m cell around every road (9554 road cells vs 640 built cells in the city box). No dense block has a free 3×3-cell patch.
   - My forced placement over road and verge cells after de-zoning rendered cleanly (lively-skate-17.5.png). The cell:road test is stricter than the visuals need; the footprint test `road:<edge>` is the one that matters.
   - The builder's "~4 lots within 50 m" claim is accurate, and it is the ceiling.
   - What the demo builder must do: reserve the lots inside citygen **before zoning and growth** (claim a block's cells as set-piece or park), or demolish 2-4 lots in a dense block and de-zone their cells, then place with `margin: 0`. If placing over verge cells, pass `force` only after checking the `road:` footprint blockers are empty, or relax `cell:road` to footprint-only.
   - Otherwise every hero frame repeats the empty-plain framing. game/lively-farm-12.png has studded plain on about 45% of the frame, which is set-6's "empty fields" reason.
2. **MED (demo): the hero camera has no occlusion test.** In the most urban site available (forced, lively-skate-17.5.png), a neighbouring dark studded roof fills the lower-right third of the frame. Background zoning plates (yellow tinted cells) are also visible at the top. Fix in demo or the shot list: raycast camera→target against buildings and fall back to `heroAlt`, or pull in the fov. Keep zoned cells out of the frame, or hide the zoning group in capture mode.
3. **LOW: wheat glows in the dusk window.** Between tod ~17.8 and the -2° isNight switch (~18.12), emissive stays 0.55 while the scene darkens. At 18.0 the wheat is the most saturated, glowing patch in the frame (show/farm-hero-18.png, show/night-seq-wheat-18.png). It then pops off at 18.12. At 6.5, 12 and 17.5 it reads as sunlit: shaded sides stay darker, it matches the neighbouring hay bales, and with emissive off (`-ei0` shots) it goes khaki-brown. The shot list's golden tod is 17.7 (elevation about 5°), so blind shots are unaffected. Fix: scale the emissive with sun elevation (ramp to 0 between 10° and 0°) instead of the isNight step.
4. **LOW: staging dependence remains.** Claim 6's "no blow-out" does not hold in the builder's own final (white corner quoins bloom at noon). A restaged showcase differs by 1.63 meanAbs from a boot-staged one. This only affects module evidence; demo captures do not use the showcase.
5. **LOW: hairline notch.** The hair front face is tangent to the head cylinder (both at z 0.155), so a small V notch shows at the forehead in close-ups (show/fig-12-…-front.png, fig-16-…-front.png). It reads as a hairline. Fix: push the hair crown forward 0.01 or shrink it.
6. **LOW, unexplained:** at (-216,-60) rot π/2, a site blocked only by zone and cell:road cells reported a new `road:e16` footprint blocker after its 6 zone cells were de-zoned (lively-placed.json). Not investigated further. The demo should re-query blockers after any de-zoning.
7. **Note (cheaper meshes):** no loss of read at hero distance. Corn at 72 tris is indistinguishable from the 1224-tri version in the same frame (corn-ab crop, c5/final vs c5fix/final). Chamfered deck tiles show crisper seams, with no z-fighting seen in about 90 close-ups. The non-casting crops look natural because the soil reads as lit between rows. Corn still reads as thin sprigs rather than leafy plants, but that was already true in round 1.

## Metric prediction (from the new finals vs docs/reference ss_0875 / ss_1522 / ss_b3e4)
| pair | reference advantage (set 6) | prediction | change vs round 1 and why |
|---|---|---|---|
| 01 house | Victorian house with porch, layered landscaping, pergola, planters, city skyline | **narrows** | unchanged. The garden layering is the same, and the fixed seed only fixes which house appears. Still decided by the reference's detailed house filling about 30% of the frame and its skyline. Our house is small and flat on an empty plain (c5fix/final/garden-175.png). |
| 02 skate | packed minifigs, ramps, layered surfaces, crisp light | **narrows (strongest)** | unchanged in class. The margin is slightly better: two-tone ramp bands, posed minifigs with hair and caps, cleaner faces (lively-skate-17.5.png, fig sheets). Still decided by context: the reference has a street, shops and a car at the frame edges. Issues 1 and 2 decide whether the demo can deliver that. |
| 03 skyline | — | no change | — |
| 04 farm | full farm district: golden crops, windmill, barns, trucks, figures, town and roads | **narrows** | unchanged as a verdict, with mixed movement. The "brown wheat" gap closes: the wheat is golden at 12 and 17.5. The context gets harder: round 1 placed the farm inside the city, but the new blocker forces fringe sites (at most 3-4 lots within 50 m), so the frame shows a farm on a plain beside a power plant (lively-farm-17.5.png). The reference's town wrap-around is the deciding gap, and only a demo-reserved block closes it. |
| 05 street | — | no change | — |

## What works
- Every round-1 FIX item landed and holds up under falsification: zoned and road land is refused (including rotated rects and margins); zone painting over a piece demolishes it while nearby zoning, AABB-corner cells and de-zoning do not; wheat reads golden by day and goes dark at night; the tractor hat clears the canopy.
- Clean gates on the final code: 4/4 check tools green (including the three the builder skipped), batch 96 / 10.14 / 934 with 0 errors, 0/20 over 0.30 against r49, c5crit and c5p2. Census hashes unchanged and set-piece frames byte-identical across sessions.
- The new minifigs survive 2 m close-ups from front, back and side in every pose with no clipping, and the meshes cost about a tenth of the triangles with no visible loss.
