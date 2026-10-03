# loop-c6-critic-props-r2
verdict: **PASS**   score: 8.0/10 (CRITIC_BRIEF scale; up from 7.5 in r1. All four FIX items are verified in the pixels and none of them introduced a new defect at hero scale. The figure craft and figure scale gap (r1 issue 7) remains, which is why this is not higher.)

Integrity: `git status --porcelain -- src tools docs ARCHITECTURE.md index.html package.json` showed the same state before and after my run: the builder's 4 modified src/props files plus print.js, the orchestrator's LOOP.md and check-background.mjs, and the two review docs. All my outputs are under `shots/` and came from the repo tools or from `openApp`/`capture` in `tools/shot.mjs`. My driver scripts and crops are in the scratchpad (`…\scratchpad\r2\`). One correction to the brief: the earlier review `shots/props/c6crit*` and the scratchpad `c6/` scripts were made in this same session's scratchpad, and I reused `close.mjs`/`atlas.mjs` as copies.
Orchestrator integrity check (LOOP §8): tree state and diff hashes were identical before and after this run, apart from the orchestrator's own save of the r1 review, so the review is valid.

## Gates
| gate | measured | command / output |
|---|---|---|
| errors | 0 in shot list 5/5 and game batch 20/20. The close-up driver logged Vite HMR `ws … ERR_NO_BUFFER_SPACE` lines: harness noise from the driver's page, not app errors | `node tools/shot-list.mjs --out shots/beauty/c6crit2`; `node tools/critic.mjs --game --round 62 --dir shots/game/c6crit2` |
| gpuMs ≤ 20 | batch max 10.94; shot list max 9.19 | `shots/game/c6crit2/summary.json`, `shots/beauty/c6crit2/summary.json` |
| drawCalls ≤ 1500 | batch max 1023; shot list max 963 | same |
| check-detail | **41/41**, `?nosp=1` census **e0f35033 == e0f35033**, yards props own draws 38 | `node tools/check-detail.mjs` → `shots/props/c2/summary.json` |
| Math.random | only comment hits (indicators.js, citygen.js, effects/index.js) | `grep -rn Math.random src` |
| owner scope | src changes only in src/props (index, materials, setpieces, spkinds, print.js) | `git diff --stat 428fc06 -- src tools` |
| shot list reproduces the builder's r2 | 01 0.0125, 02 0.1077, 03 0.0350, 04 0.0088, 05 0.0279. All 5,977 changed px in 02 sit in one box, x 1712–1920 y 32–208: the top-right road corner (traffic, as in r1) | `shots/beauty/c6crit2-diff-c6crit-r2.json` |
| regression, default | same-code repeat c6p2 vs c6crit2: **0.0033**, max 0.0124, 0/20 over. r1→r2 (c6crit vs c6crit2): 0.0309, max closeup-12 0.0861, **0/20 over 0.30** | `shots/game/c6crit2-diff-c6p2.json`, `…-diff-c6crit.json` |
| regression, nosp | c5o-nosp vs c6p2-nosp: 0.0298, 0/20 (builder number reproduced). r1 nosp (c6crit-nosp) vs r2 nosp (c6p2-nosp): **0.0049**, max 0.013, 0/20 | `shots/game/c6crit2-diff-c5o-nosp-c6p2nosp.json`, `…-diff-nosp-r1-r2.json` |

## Claims
| claim | reproduced? | my number / observation | evidence |
|---|---|---|---|
| 1. Mural strokes level, inside the panel, no overhang | **yes** | Code: strokes span ±((L−0.7)/2 − 0.03) = ±4.42 m, and the panel's half-width is (L−0.5)/2 = 4.55 m. Strokes sit at y 0.32–0.58, below the letters (≥ 0.965). In pixels, both r1 defects are gone: the light-blue bar overhanging the left end (1020–1090, 228–245) and the white bar floating past the tree (1370–1570, 362–378). The strokes are now a level light-blue/white band along the panel's bottom edge, partly behind the bench and planter. It reads as a skirting stripe rather than a "wave", which is neutral, not worse | `scratchpad/r2/mural.png` (r1 left, r2 right) |
| 2. No yellow-merging hair, caps or helmets on yellow skin | **yes** | All 5 r1 yellow-crown heads in 02 now have dark navy, grey or dark-grey crowns: (110,575), (1080,785), (790,245), (510,575), (950,430). The white cap at (450,425) is now green. Across 22 head crops in 02, no yellow-on-yellow crown remains. The same separation shows in 01 (the swing sitter and pergola sitter lost their blond/white crowns) and in 04 (the farmer at 1085,570 lost a white crown) | `scratchpad/r2/heads.png`, `c01a.png`, `c01b.png`, `c04.png` |
| 3. Helmet: octagonal band r 0.19, back/side shell y 1.47–1.57, stepped dome | **yes** | Geometry check: the shell front face is at z −0.07 + 0.13·cos22.5° = **0.050**, and every point of the face print (r 0.1585, θ ±1.2 rad) lies outside the shell, so the shell cannot hide the print. Close-ups of the 2 helmeted skaters (f0, f3; front, 3/4, side, back at 2.5–3 m): the face print is fully visible, the square black plate is gone, and the band is a thin dark octagon line. From the side and back, a red shell wraps the back of the head, so it now reads as a helmet rather than a cake on a plate. No clipping: the helmet branch excludes hair, so nothing can collide with it | `shots/props/c6crit2/close/t12-f0-*`, `t12-f3-*`; sheet `scratchpad/r2/s1.png`; 02 `helm.png`, `helm10.png` |
| 4. Ledge kicker recoloured to grey #9A9F9C / #5F6466, position unchanged | **yes** | In 02 at (445–560, 1035–1080) the teal sliver is gone. The grey kicker merges with the grey pavers, and no stray block reads at the bottom edge | `scratchpad/r2/kick.png` |
| 5. Atlas gutter 3 px, UVs on the inner 122 px, key v2 | **yes** | Live dump: the cache key is `props:sp-print:v2\|csm` and there are 109 instances. Tile border alpha (3 px ring) peaks at r1 255/89/76 on the torso tiles and r2 ≤ 10 (tiles 17: 10, 30: 8, 21: 1; the rest 0). Content is uniformly scaled 122/128 into the gutter-inset area and the drawings are unchanged. Because the UVs map the patch onto the same inner area, the on-model print size is unchanged. In 02, figures whose gear did not change (the "7" fig at 1710,610; 1525,410; 920,205; and others) have **no changed pixels over threshold 8** between r1 and r2: no shrink, crop or misalignment | `shots/props/c6crit2/atlas.png`, `atlas-info.json`; `scratchpad/r2/atlas_cmp.png`; r1→r2 box list for 02 |
| Gates: shot list 5/5 errors 0; check-detail 41/41 e0f35033 | yes | above | above |
| nosp c6p2-nosp vs c5o-nosp 0/20 (0.0298) | yes | 0.0298 | above |
| default c6p2 vs c6crit 0/20 (0.0288), "traffic" | **yes, now proven by pixels, not just by location** | Mine: r1→r2 0.0309. (a) Pixel boxes: closeup-12 (x 1456–1728, y 512–720), street-18 (864–1120, 496–608) and the top 10 boxes of overview-12 and aerial-12 each contain a vehicle on a carriageway displaced by a few px (pink truck, white pickup, orange car, buses, sedans). No box lies on a building, prop or terrain. (b) Controls: same code across runs gives 0.0033, and nosp r1→r2 gives 0.0049. Nothing in the 20 game frames changed except vehicle positions. Caveat: the r1→r2 default batches differ by 0.03 while same-code repeats agree at 0.003, so traffic spawn timing may couple to boot-time cost (the wall-time debounce). That is consistent with LOOP §7 and is not a props pixel change, but "random" is not proven: r1 also saw 0.03 on same-code nosp | `scratchpad/r2/g_close12.png`, `g_st18.png`, `gboxes.png` |

## Ranked issues
1. **LOW: at 02 scale the helmet shell's side reads as a lighter red "ear flap".**
   - Where: on the 02 rider at about (1000–1010, 615–635), the shell (x ±0.19 vs head 0.155, pushed back to z −0.19) shows as a roughly 5 px lighter, semi-blended red patch beside the head (`helm10.png`).
   - At 2.5 m it is an opaque shell side (`s1.png`), so this is coverage and antialiasing at tiny scale, not geometry breaking through.
   - It is unlikely to be named by a judge. Optional fix: shrink the shell to r ≈ 0.175 so its side sits flush with the head silhouette.
2. **LOW: the mural's "wave" is now a low stripe.**
   - It sits along the panel bottom and is half hidden by the bench and planter. The mural now reads as sun + letters + skirting stripe.
   - Not a regression (the r1 defect is gone), just less content. Optional fix: raise the strokes to y ≈ 0.6–0.9, between the panel bottom and the letters.
3. **LOW (unchanged, not props): straw hats on the 04 farmers stay brickYellow, tan or #E8C77A on yellow skin.**
   - This is by design (straw), and the heads are about 12 px at 04, so it does not affect the metric.
4. **LOW (orchestrator, carried from r1 issue 5): traffic spawn timing.**
   - Same-code repeats are 0.003, but code-version-to-version batches are 0.03, with every box a displaced vehicle.
   - Attribution to traffic holds pixel by pixel. The §2 "same seed → same shots" gate is still met only within a session and code version.
5. **LOW (carried, not fixable in props): figure craft and scale gap.** Square heads and slab limbs; heads are about 20–25 px in 02 against the reference's 45–60 px.

No HIGH or MEDIUM issue.

## Metric prediction (set 8; updated for 02 only)
| pair | reference's deciding advantage (set-7 reasons) | prediction | evidence |
|---|---|---|---|
| 01 house | built Victorian house; bare lots; flat-shaded minifigs | **no change** (as r1); the minifig sub-reason narrows slightly | Garden figures now have dark crowns that separate from the faces (`c01b.png`), but heads are about 15 px and the hero house is still the red box |
| 02 skate | brick-textured ramps; printed, expressive figs; no loose debris; tilt-shift; figure scale | **narrows** (unchanged class; still a likely loss). Updated expected residuals: two of r1's predicted new reasons are now removed. The mural "sticks / planks" overhang is gone (`mural.png`), and yellow-block heads are gone (0/22 heads, `heads.png`). Also gone: the teal sliver at the bottom edge and the helmet "plate". Still expected: boxy, small figures; no subject tilt-shift; a grid-like "tiled floor" look on the ramps | `shots/beauty/c6crit2/02-park-noon.png` |
| 03 skyline | landmark variety, signage, parks; empty lots; sun glare | **no change** | 03 vs r1 0.0066, not in frame |
| 04 farm | lush scale, windmill/barn, minifigs; bare blocks | **no change** | Heads about 12 px; the only change is crown colours |
| 05 avenue | signage, café life, traffic; empty road | **no change** | 0.0021 vs r1 |

## What works
- All four r1 FIX items land exactly where the r1 crops placed them, and every other changed pixel in 01, 02 and 04 is a gear re-pick on a figure, the mural or the kicker. Unchanged figures' prints are bit-stable through the atlas change.
- The helmet is now a helmet: the face is clear from the front, and a shell wraps the back. The yellow-skin gear filter visibly separates head from crown at hero scale in 01, 02 and 04.
- Discipline: check-detail 41/41, the nosp census unchanged, nosp r1→r2 at 0.0049, and every default-batch diff pinned to a moving vehicle by pixel box plus a same-code control (0.0033).
