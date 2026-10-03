# loop-c6-critic-props
verdict: **FIX**   score: 7.5/10 (CRITIC_BRIEF scale; up from 7.5 at c5 r3 on craft, held back by the four exact fixes below)

Integrity: `git status --porcelain -- src tools docs ARCHITECTURE.md index.html package.json` showed the same state before and after my run (the builder's 5 src/props files, the orchestrator's docs/LOOP.md and tools/check-background.mjs, and the untracked recon doc). All my outputs are under `shots/` and were made through the repo's tools or `openApp`/`capture` from `tools/shot.mjs`. My driver scripts and crops are in the scratchpad (`…\scratchpad\c6\`).
Orchestrator integrity check (LOOP §8): tree state and diff hashes were identical before and after this run, so the review is valid.

## Gates
| gate | measured | command / output |
|---|---|---|
| errors | 0 in every capture: shot list 5/5, game batch 20/20, nosp batch 20/20, close-ups 40, shimmer 4 | `shots/beauty/c6crit/summary.json`, `shots/game/c6crit/summary.json`, `shots/game/c6crit-nosp/summary.json` |
| gpuMs ≤ 20 | max 11.21 (street-21h5); nosp max 9.91; shot list max 9.16 | same |
| drawCalls ≤ 1500 | max 1023 (skyline-6h5); nosp max 934 | same |
| props' own draw calls | 83 in the full city (gate 300); yards showcase 38 | `node tools/check-detail.mjs` → `shots/props/c2/summary.json` |
| check-detail | **41/41**, `?nosp=1` census **e0f35033 == e0f35033**, cross-boot hash 8b3004a1 == 8b3004a1 | same |
| Math.random | no code hits outside the whitelist (only comments in rng.js, citygen.js, effects, indicators.js); no `fillText` in props | `grep -rn Math.random src` |
| owner scope | src changes only in src/props (index, materials, setpieces, spkinds + new print.js) | `git diff --stat 428fc06 -- src tools` |
| regression, default | c5o-sp vs c6crit: mean 0.0296, **0/20 over 0.30**, worst closeup-12 0.0865. c6p vs c6crit: 0.0015 | `node tools/diff.mjs` → `shots/game/c6crit-diff-c5o-sp.json`, `…-c6p.json` |
| regression, nosp | c5o-nosp vs c6crit-nosp: mean **0.0318**, 0/20 over, worst closeup-12 0.0849 (moving traffic, y 512–767 x 1472–1727). The builder's 0.0028 reproduces on its own files (c5o-nosp vs c6p-nosp) but not on a fresh batch | `shots/game/c6crit-diff-c5o-nosp.json` |
| determinism | 4 fresh loads of demo:sp-skate at tod 12 were **byte-equal, meanAbs 0.0000** (frame 181 each). The builder's 0.2251 pair reproduces exactly from its files (see claim B-det) | `shots/beauty/c6crit-det/sk-{1..4}.png` |
| shot list reproduces the builder's | 01 0.0073, 02 0.0000, 03 0.0020, 04 0.0002, 05 0.0024 | `node tools/shot-list.mjs --out shots/beauty/c6crit` vs `shots/props/c6/list` |

## Claims
| claim | reproduced? | my number / observation | evidence |
|---|---|---|---|
| B1: raised cap, brim and hair so the face shows | **yes** | In 02 at 1:1, eyes and a mouth are visible on most front-facing figures at about 20–25 px heads. From near top-down (the nearest figure, bottom centre) a cap still covers the face completely | `shots/beauty/c6crit/02-park-noon.png`; crops `scratchpad/c6/a_heads.png`, `h1–h4.png` |
| B1: backward cap (skaters) | yes | The brim sits at the back and the face is unobstructed | `shots/props/c6crit/close/t12-f10-*` |
| B1: stepped octagonal helmet | **partly**. Built, but it does not read as a helmet | It sits on top of the head like a hat. The "stripe band" is a 0.392 m **square** black box wider than the octagons, so from every angle it reads as a red cake on a mortarboard plate | `close/t12-f5-*`, `t12-f13-*`; shimmer row 2 |
| B1: figures and heads face the front | mostly | 4 of my 6 random skate figures are front-facing with a readable face. In 02, one figure at about (70–190, 535–655) is still seen from the back | `scratchpad/c6/yel.png` panel 1 |
| B1: skin #D9A27A | yes | Reads as a tan face, not white | `close/t12-f2-*` |
| B2: sp-print, +1 draw, no shadow | yes | One InstancedMesh, `props-sp-print`, 109 instances (53 figures × 2 + 3 scarecrows), castShadow false, receiveShadow true, aTile capacity 256 | `shots/props/c6crit/atlas-info.json` |
| B2: atlas 1024×512, path-drawn, premultiplied, mipmapped | yes | Dumped from the live page: 16 faces and 16 torsos; premultiplyAlpha true, anisotropy 8, mips on | `shots/props/c6crit/atlas.png` |
| B2: prints read and do not shimmer | yes at 02 scale | Camera shifts of 0 / 4 / 8 cm give stable eyes, mouths and torso graphics, with no crawl. At night (21.5) the prints are lit like the plastic around them: no glow, no wrong colour | `shots/props/c6crit/shimmer/02-{a,b,c,night}.png`; `scratchpad/c6/shim.png` |
| B2: clipping / see-through (2.5–3 m, front, side, back, 3/4) | **no defect found** | 10 figures × 4 views at tod 12, and 2 at tod 21.5. The face never shows from behind; no z-fighting at the patch edges or the hair side panels; caps sit cleanly | `shots/props/c6crit/close/*` (sheets `scratchpad/c6/sh1–sh4.png`) |
| C: kicker rebuilt and flush | yes | The orange kicker sits flush against the bank wall, has a tiled slope and reads as a launch ramp | `a_heads.png` |
| C: furniture grid-snapped; boards racked or removed | yes | 3 skateboards: 2 racked against the mural (believable: standing on their tails, wheels out) and 1 on the deck (out of frame). The tilted c5 teal fun-box slab is gone from (1130–1280, 700–830) | `a_mural.png`, check-detail census `skateboard:3` |
| C: tiled slopes, stud grids | yes | 3-tone tiles with dark seams on the bank wedge, the quarter, the curved end and the fun-box; stud grids on the bank top, the QP deck and the fun-box | 02 full frame, `b_deck.png` |
| Head metrics (heads-final.json) | **not reproduced** (no tool; not re-measured) | Visual check only: 02 heads about 20–25 px, 04 heads about 12 px (at 04 the prints are 1–2 dark dots and invisible at 1:1) | `scratchpad/c6/f1.png` |
| check-detail 41/41, e0f35033 | yes | 41/41 | above |
| c6p vs c5o-sp 0/20 (0.0293) | yes | my batch 0.0296, 0/20 | above |
| c6p-nosp vs c5o-nosp 0.0028 | yes on the builder's files; **0.0318 on mine** | Still 0/20 over 0.30. The extra difference is traffic | above |
| B-det: 0.2251 is entirely a traffic car | **yes, and the cause is upstream of props** | det-a vs det-b differ only in box x 1543–1784, y 130–265, with 0.0009 outside it. The box holds a lime car offset by a few px, with the **same frame count (181)**. The cause is `src/traffic/index.js:577`: the graph rebuild is debounced on wall time (`performance.now() - S.lastEvent > 30`), so the boot frame at which cars spawn varies from run to run. set7 vs c5crit3 02 (0.2805) is the same thing: every changed pixel is in x 1708–1915, y 27–204 (top-right road). So it pre-dates cycle 6 and is not caused by props. My 4 loads were identical, so it is intermittent | `scratchpad/c6/detab.png`; `dbox.py` output |

## Ranked issues
1. **MEDIUM-HIGH: mural "wave" strokes stick out past the wall and read as loose sticks or planks.** This is acceptance (c).
   - Where: 02 at about (1020–1090, 228–245), a light-blue bar overhanging the mural's left end above the bench sitter. A second, white bar at (1370–1570, 362–378) floats past the tree over the planter and hedge.
   - Cause: `spkinds.js:1270-1273`. Six boxes of width (L−1.2)/5+0.1 = 1.78 m are rotated 0.35 rad. The end strokes extend about 0.25 m beyond the 0.5 m-inset panel and the wall's end.
   - The defect pre-dates this cycle (c5, also visible in set7, `scratchpad/c6/s7_mural.png`), and it is the most likely source of set-7 J2's "loose planks".
   - Fix: clip the strokes to the panel. Drop the rotation, or shorten the end strokes so |x| + 0.5·w·cos(0.35) ≤ (L−0.5)/2.
2. **MEDIUM: yellow-on-yellow heads still read as blank figures.**
   - `HAIR` and `CAPS` both contain `brightYellow`, and `SKIN` is brightYellow 3/4 of the time.
   - In 02, five figures have a yellow crown on a yellow head (about (110,580), (1080,790), (790,255), (510,580), (950,440); `yel.png`). The head and headgear merge into one yellow block, and at 1:1 the small printed features barely separate from it. That is exactly the set-7 "blank / faceless" read.
   - Fix: when skin is brightYellow, exclude brightYellow (and brickYellow/white-ish) from the hair and cap picks.
3. **MEDIUM: the helmet reads as a hat on a square plate.**
   - The stripe band `box(…, 0.392, 0.02, 0.392)` at y 1.585 is square and wider than the octagon tiers, so black corners stick out (`close/t12-f5-front.png`, `f13`). The tiers also sit on top of the head instead of enclosing it.
   - It is visible in 02 on the rider at (930–1010, 600–700).
   - Fix: make the band an `sp-oct` (or a cylinder) at r ≈ 0.195. Optionally drop the bottom tier to about y 1.50 so it covers the head top and sides.
4. **LOW-MEDIUM: a cut-off teal kicker sliver at 02's bottom edge.**
   - (445–560, 1035–1080; `b_bottom.png`). The teal kicker sits at the ledge's left end, but the ledge itself is just out of frame, so a lone teal block shows at the edge. Set-7 judges named a "stray teal slab".
   - Fix: shift that kicker or the ledge about 1 m up (−v), or recolour the kicker to the ledge's grey.
5. **LOW (harness, orchestrator-owned, not props): traffic is not reproducible.**
   - The wall-time debounce at `traffic/index.js:577` makes car positions vary between identical loads (0.22–0.28 meanAbs in the 02 corner; 0.03 batch mean on nosp).
   - Set 8 is **not** affected in any judged way: the cars sit outside the subjects. But the §2 "same seed → same shots" gate is only met intermittently. The orchestrator should either debounce on frames under `fixeddt`, or freeze traffic in `resetPresentation`, and record this in LOOP §7.
6. **LOW: atlas bleed risk and canvas portability (theoretical; nothing seen).**
   - The UV clamp is 0.004 (0.5 texel at mip 0). At mip 2–3 with anisotropy 8, the vertical neighbours can bleed a few percent into a tile's edges. For example, the beard tile 8 (row 1) sits directly above the torso tile 16 (row 2).
   - I saw no seam in any crop at 02 scale. A 2–4 px transparent gutter per tile, or an inset of 2/128, would remove the risk.
   - Canvas path antialiasing can also differ between GPUs and Skia backends. That is fine on the same machine but worth noting for cross-machine reproduction.
7. **LOW: residual craft gap at subject scale (not fixable in props alone).**
   - Our figures are boxy (square heads, flat-slab limbs), and their heads are about 20–25 px against the reference's 45–60 px.
   - The prints make faces exist, but the figures do not yet read as minifigs to the same degree.

Shader / cache (f) checked, no issue:
- The print material is the only map-carrying plastic in the scene other than the transit stop face. Its cache key includes `map.uuid`, so nothing else can be handed it.
- If no canvas is available, `printMaterial` no-ops on the shared non-map material, and the role is `tiled:false`.
- The environment's `setupMaterial` chains correctly: live key `props:sp-print:v1|csm`, defines USE_CSM / CSM_CASCADES 3 / CSM_FADE.
- No other props material was touched; the batches show no CSM change (0/20 over).

## Metric prediction (set 8; this stage's changes only)
| pair | reference's deciding advantage (set-7 reasons) | prediction | evidence |
|---|---|---|---|
| 01 house | built Victorian house (dormers, siding, porch); bare baseplate lots behind; "flat-shaded minifigs" (J3) | **no change** on the decision. The minifig sub-reason narrows | The garden sitters and gardener now show faces at 4× (`g1.png`, `g2.png`), but heads are about 15 px and the hero is still a red box house (`c6crit/01`) |
| 02 skate | brick-textured ramps; printed, expressive figs; no loose debris; tilt-shift; figure scale | **narrows** (the strongest of the five; still a likely loss) | "Smooth / untextured orange ramps" should disappear: tiled 3-tone slopes and stud grids. "Blank / faceless" should weaken: about 15/22 printed faces readable. "Loose skateboards / tilted slab" should disappear. Expected new or residual reasons: boxy, small figures; no tilt-shift; the mural sticks (issue 1) and yellow-block heads (issue 2) if not fixed; a grid-like "tiled floor" look on the ramps compared with the reference's curved slope bricks |
| 03 skyline | landmark variety, signage, parks; empty green lots; sun glare | **no change** | Props changes are not in frame |
| 04 farm | lush scale, built windmill and barn, many minifigs; bare baseplate blocks | **no change** | Farm heads about 12 px; prints are 1–2 px dots and invisible at 1:1 (`f1.png`) |
| 05 avenue | signage, café life, bus / cars; ours: empty road, oversized studs | **no change** | Not touched |

**Later stages must deliver (separate note):**
- **A1 (zoning plates hidden outside zone tools):** removes the translucent plate tint, but leaves the same bare studded terrain. The "empty / baseplate lots" reason (4/5 pairs) will move from "plates" to "bare land" unless A2 (sparse-stud lawn) or real infill lands. I predict A1 alone is worth **no change** on 03/05 and at most narrows 01/04.
- **D (porch / dormers / siding on the hero house):** the only lever aimed at 01's deciding reason. It must read at 01's camera distance (about 30 m), not just exist. Without it, 01 stays a loss.
- **02 conversion** also needs figure scale and focus (W3 subject-aware depth, or a tighter 02 frame). The props work has taken 02 about as far as it can go at the current camera.

## What works
- The print atlas does its job at hero scale. Faces and torso graphics (logo tees, a "7", hoodies, ties, check shirts) read on 02 at 1:1. They are stable under sub-pixel camera moves, correct at night, and invisible from behind. It costs exactly 1 draw and integrates cleanly with CSM.
- The skate plaza reads as built, not scattered. Every c5 debris item the set-7 audit located is gone or racked, and the ramps carry real plate texture: seams, three tones and stud decks.
- Discipline holds: 41/41 checks, the nosp census unchanged, 0/20 regressions in both batches, and the builder's determinism attribution held up under falsification (traffic, upstream of props).

**FIX list (exact, props-only, cheap):**
1. Mural strokes stay inside the panel (issue 1).
2. No yellow hair or caps on yellow skin (issue 2).
3. Helmet band becomes octagonal or round, with r ≤ the bottom tier (issue 3).
4. Move or recolour the ledge kicker so no lone teal block sits at 02's bottom edge (issue 4).

Then re-shoot 02 (`node tools/shot-list.mjs --out shots/beauty/c6crit-r2`), plus check-detail. Issue 5 is for the orchestrator.
