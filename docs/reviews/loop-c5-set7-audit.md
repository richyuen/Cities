# loop-c5-set7-audit

**verdict: VALID (bank as is).** Set 7 = **0/5, 0–15. All 15 votes went to the reference side.** No pair needs a re-judge.

All five provenance and shuffle checks pass:
- All 10 pair files are byte-identical (SHA-256) to their keyed sources.
- The seed-53 `--balance` shuffle reproduces the key exactly, with a 2/3 split.
- Seed 53 was not used by any earlier set (7, 11, 23, 31, 41, 43).
- None of the 15 reasons names content that is missing from its image. Two reasons overstate an adjective, but the content they name is there (see c).
- No leak through the protocol. The JPEG-under-`.png` naming carries over from sets 4–6 and is cosmetic.

Every number below comes from runs I did this session. My scripts and crops are in the scratchpad (`…\scratchpad\set7\audit.cjs` and the `p0*.png` crops). `git status --porcelain` was empty before and after my run.
Orchestrator integrity check (LOOP §8): tree state and diff hashes were identical before and after this run.

## (a) Provenance (SHA-256, `node scratchpad/set7/audit.cjs`)

| file | keyed source (side) | SHA-256 | match | bytes | format / dims |
|---|---|---|---|---|---|
| pair-01-A | ss_08751f…jpg (theirs) | e7ba17d39e19da3d06061b365a9619387e4e477301a2f16fe4b438e1457b6e15 | MATCH | 555,096 | JPEG/JFIF 1920×1080 |
| pair-01-B | set7/01-house-golden.png (ours) | df5911120d7f95810a9921b433594278624c46cbba0e6b55c7a6fd94ee88e4cf | MATCH | 3,548,610 | PNG 1920×1080 |
| pair-02-A | ss_152213…jpg (theirs) | a2e65d0354ffdb3d843b96a25fe09bb24d1006b8364460306a9b01507c48fdd6 | MATCH | 699,037 | JPEG 1920×1080 |
| pair-02-B | set7/02-park-noon.png (ours) | 3858a9339fb9e5e8f355b7ede9828b594744f6a5869c4ab4d8cee9f94110516b | MATCH | 2,951,381 | PNG 1920×1080 |
| pair-03-A | set7/03-skyline-golden.png (ours) | 4d12ef9c2e9186e834b8b4d7565b0416409c05238d4f88f1e4f5feb1a3c52017 | MATCH | 2,771,259 | PNG 1920×1080 |
| pair-03-B | ss_abbf7c…jpg (theirs) | 9d5c7b759b5e5027b255a9611ecd2ab3787753ad6e425ee6a0fbab0774ccb2e7 | MATCH | 1,046,900 | JPEG 1920×1080 |
| pair-04-A | set7/04-farm-golden.png (ours) | 35f80a8a443ad5fd06b7184805f16e0ae5818c86f0484c23cfed9cec8dc86b12 | MATCH | 3,855,318 | PNG 1920×1080 |
| pair-04-B | ss_b3e407…jpg (theirs) | ee070403c30b3bae0f909142b9c7f118bd131490052d456e3ce8c4ee877e2454 | MATCH | 1,037,396 | JPEG 1920×1080 |
| pair-05-A | ss_f6daab…jpg (theirs) | 5fcaa5280f9344cfe5334cdff9ca8a81f5331ac39ce1cf17698b9dd58901c864 | MATCH | 903,002 | JPEG 1920×1080 |
| pair-05-B | set7/05-avenue-noon.png (ours) | 1dc0e2ad2711aa607a0d8cbdc397fe99c0616ae80f6940142b242ba61ef03d2b | MATCH | 2,504,162 | PNG 1920×1080 |

`pairs.mjs` does **no format conversion**. It uses `fs.copyFileSync`, so each reference-side pair file is the original JPEG byte stream under a `.png` name. Byte-level SHA-256 is therefore the correct check, and all 10 files pass. No pixel comparison was needed. The reference hashes are the same as in the set-6 audit, so the reference files did not change between sets.

Side check against the critic's prediction frames: the set-7 frames differ only slightly from `shots/beauty/c5crit3`. meanAbs is 0.073 / 0.280 / 0.069 / 0.000 / 0.070 for 01–05, and at most 0.52% of pixels differ by more than 16. The E3 predictions were made on effectively the same images.

## (b) Shuffle reproduction (seed 53, `--balance`)

I re-implemented the RNG from `tools/pairs.mjs` line 20 and the balance block from lines 25–31:
- Raw per-pair flips: [F, F, F, T, F]. These are discarded by `--balance`.
- After the balanced Fisher–Yates on [T, T, T, F, F], the flips are: 01 T, 02 T, 03 F, 04 F, 05 T.
- That gives A = theirs, theirs, ours, ours, theirs.
- Sorted `ours` (01-house … 05-avenue) are paired by index with the sorted references (ss_0875, ss_1522, ss_abbf, ss_b3e4, ss_f6da).

**This matches `docs/judge-key-set7.json` exactly. Split: ours on A = 2 (pairs 03, 04), theirs on A = 3. Confirmed.**

## (c) Reason consistency (all 15 checked against both images; flagged claims also zoomed 2–4×)

| pair | judge | named content and the side it is attributed to | present? | note |
|---|---|---|---|---|
| 01 | J1 | A: Victorian house, siding, porch balusters, dormers, raised planter, DOF, layered skyline. B: playground, pond, studded baseplate, box houses, sparse street grid | yes, all | The "siding" is clapboard-style brick; fair. |
| 01 | J2 | A: dormers, clapboard, porch balusters, flower bed, DOF, pastel skyline, **floating roof cluster**. B: blocky houses, stud-grid lots to the horizon | yes, all | See the floating-roof check below. |
| 01 | J3 | A: brick Victorian house, tiled porch roof, flower boxes, sandbox, DOF skyline. B: flat-shaded minifigs, low-poly trees, empty green baseplate lots | yes, all | Ours also has a sandbox. The judge credits only A's, which is a reasonable read of A's richer one. |
| 02 | J1 | A: brick ramps with checker and stud texture, skateboarder, curly-haired fig, tilt-shift. B: smooth orange ramps, stiff blocky figs, **loose skateboard pieces** on grey paving | yes, all | Three skateboards lie loose on B's paving (around 350,530 / 1255,515 / 460,690). |
| 02 | J2 | A: printed faces, textured ramp, tilt-shift. B: **blank minifigs**, flat orange stripe ramps, **stray teal slab**, **loose planks** | yes, all | See the pair-02 check below. |
| 02 | J3 | A: brick ramps, faces, hair pieces, tilt-shift. B: flat orange ramps, **faceless figures**, **loose ramp pieces scattered and floating** | scattered: yes. "floating": overstated | Nothing in B is clearly airborne. The loose wedge, teal box and skateboards all sit on the paving. One adjective overstates; the content exists. Not flagged. |
| 03 | J1 | B: hot-air balloon, suspension bridge, landmark towers, QUILT and VIDEO PLANET signs, parks. A: near-identical towers, empty green lots, sun bloom | yes, all | |
| 03 | J2 | the same as J1, plus A's "striped towers" and "blown-out glare" | yes | |
| 03 | J3 | the same, plus B's "hazy light" | yes | |
| 04 | J1 | B: brick windmill, red barn, farmhouse, trucks, hay bales, deer, coastline. A: simple windmill and barn, bare baseplates, **"flat, repetitive crop fields"** | yes; "flat" is subjective | A's fields are dense 3D stalks, so "flat" is a judgement rather than missing content. Not flagged. |
| 04 | J2 | B: brick crops, hay bales, barn, farmhouse, deer, trucks, many minifigs. A: windmill, red barn, crop rows, simple houses on bare stud lots | yes, all | |
| 04 | J3 | B: windmill, barn, farmhouse, bales, trucks, deer, minifigs. A: windmill, wheat and corn, simplified figures, bare baseplate blocks behind | yes, all | |
| 05 | J1 | A: JOE'S, Hotel and COMEDY signs, café umbrellas, bus, cars, picnic. B: ground-level empty road, oversized studs, repeated towers | yes, all | |
| 05 | J2 | the same, plus B's "flat sky" | yes | |
| 05 | J3 | the same, plus B's "one lone pedestrian" | yes | One figure on the right curb (around 1150,600). |

**Judge 2, pair 01, floating roof cluster on A: present, and on the side J2 names.** A cluster of loose dark-red roof plates, pale green bricks, a window frame and a small planter hangs in the sky above the house ridge (around x 740–1090, y 45–265; 2× crop `p01A_roof.png`). It is the reference's own build-in animation: pieces assembling mid-air. As a still image it reads as a defect, which is how J2 took it. J2 counted it **against the side they picked**, so the reason is consistent and, if anything, conservative. The verdict cannot flip toward ours because of it.

**Pair 02 claims, all present on B (ours):**
- **Stray teal slab:** a teal wedge or box with a grey rail lies tilted on the paving (around 1130–1280, 700–830; crop `p02B_teal.png`). It is probably the authored "fun box" that the critic's r3 report mentions, but in the pixels it reads as a tipped-over slab.
- **Loose planks / skateboard pieces:** a tilted orange board with wheels (around 440–520, 660–740), a light-blue board (around 330–380, 520–540), an orange board (around 1240–1280, 505–525) and a loose orange wedge beside the stairs (around 530–650, 380–440). All are on the ground and none floats.
- **Faceless / blank figures:** at the shot's camera height the heads are plain yellow cubes, mostly covered by caps. At 4× (`p02B_heads.png`) at most a sub-pixel mark is visible. As perceived, "blank" is accurate.

**Flagged reasons: none.** No re-judge is triggered. Even if J3's "floating" were struck out, the pair-02 verdict rests on three reasons that hold up in the pixels: flat ramp surfaces, figure detail, and loose debris. It would not plausibly change.

## (d) Leakage

- **Dimensions:** 1920×1080 on every file. No difference.
- **Format:** theirs are JPEG bytes (`FF D8 FF E0`, JFIF APP0 only, no EXIF/APP1) under `.png` names. Ours are true PNGs with only IHDR, IDAT and IEND chunks: no tEXt, iTXt, zTXt or eXIf.
- **File size:** theirs 0.55–1.05 MB, ours 2.50–3.86 MB, so ours is larger in every pair. File times are also separable: theirs 2026-09-16 (the copy keeps the source time), ours 2026-10-02.
- **File names:** neutral `pair-NN-{A,B}.png`.

These signals are visible only through filesystem inspection. The judges had the Read tool and the image paths, so they saw decoded pixels only. No reason mentions format, compression, size or names. The same structural signature was present in sets 4–6 and was ruled cosmetic there.

Residual risk is low. A cleaner protocol would re-encode both sides to PNG and reset file times, but that needs a change to `pairs.mjs`, which is the orchestrator's decision.

## (e) Unblinded result

| pair | ours | A | B | ours is | J1 | J2 | J3 | picks for ours | result |
|---|---|---|---|---|---|---|---|---|---|
| 01 | 01-house-golden | theirs | ours | B | A | A | A | 0/3 | loss |
| 02 | 02-park-noon | theirs | ours | B | A | A | A | 0/3 | loss |
| 03 | 03-skyline-golden | ours | theirs | A | B | B | B | 0/3 | loss |
| 04 | 04-farm-golden | ours | theirs | A | B | B | B | 0/3 | loss |
| 05 | 05-avenue-noon | theirs | ours | B | A | A | A | 0/3 | loss |

- **Win count:** 0/5. Votes for ours: 0/15. All 15 votes are unanimous for the reference.
- **Side split:** ours on A = 2, theirs on A = 3. Judges picked A 9 times and B 6 times, in every case following the reference side, so there is no side bias.
- **Reason consistency:** 15 of 15 reasons hold.
- This is the seventh consecutive 0/5 set.

## (f) Prediction ledger (critic E3, `docs/reviews/loop-c5-demo-critic.md`)

**All five pairs are still unanimous losses, so no prediction can be scored on vote margin.** By vote margin, nothing narrowed. Under §8 the scoring is therefore on reason class: did the predicted set-6 reason category disappear from the reasons for that pair?

| pair | prediction | predicted reason change | set-6 reasons against ours | set-7 reasons against ours | score |
|---|---|---|---|---|---|
| 01 | narrows | Reference's "layered landscaping" advantage disappears; next reason "plain house / flat facade" | broken geometry; flat lighting; sparse surroundings / empty fields; stud ground; empty road; flat purple block; smeared DOF edges | box / blocky houses (J1, J2); flat stud baseplate and empty lots to the horizon (J1, J2, J3); sparse street grid (J1); flat-shaded minifigs and low-poly trees (J3) | **HIT.** The landscaping advantage no longer decides the pair (A's planter and sandbox get only a passing mention, and B has its own). The predicted next reason, a plain house against a detailed house, is now the main one. Caveat: the empty-lots reason did not go away; it moved to the background. |
| 02 | narrows (strongest, likeliest win) | Gap moves to context and plainer figure detail | bare stud field; flat muddy fountain; washed-out scene; heavy blur; ghostly trees | flat, untextured orange ramps (3/3); blank or stiff figures (3/3); loose skateboards, slab and planks (3/3); plain grey paving (J1) | **HIT on reason class:** every set-6 category disappeared, and the predicted "plainer figure detail" appeared. **MISS on "likeliest win":** 0/3. The critic also missed the new "loose debris" reason, which comes from the authored kickers and fun box, and the flat ramp surfaces. |
| 03 | no change (DOF reason goes) | DOF "mush" disappears; repetitive towers and empty lots remain | near-duplicate towers; empty lots; heavy DOF blur | near-identical towers (3/3); empty green lots (3/3); blown-out sun glare or bloom (3/3) | **HIT.** The blur reason is gone and the loss persists. A new "sun glare" reason, which was not predicted, appeared in all three judges. |
| 04 | narrows | "Blank wall / few props" disappears; reference still wins on scale and foreground houses | plain white block or blank wall (3/3); few props / empty corner; washed-out; blurry foreground | simple low-poly windmill and barn; bare baseplate or stud lots behind (3/3); simple houses; simplified figures; "sparse" (J2); "flat, repetitive" fields (J1) | **HIT.** The blank-wall, washed-out and blur categories are gone, and judges now say "nice windmill" (J3) and "look clean" (J2). Partial: J2's "sparse" keeps a trace of "few props". |
| 05 | no change (blur goes) | Blur reason disappears; empty road, stud field and no signage remain | empty road; heavy edge blur; repetitive towers; untextured green plots | near-empty road (3/3); oversized studs on the curb and grass (3/3); plain repeated towers (3/3); flat sky (J2); one lone pedestrian (J3) | **HIT.** |

**Hit rate on reason class: 5/5 (100%).** Counting the explicit "likeliest win" call on 02 as its own prediction, it is **5/6**. Two other new reasons were not predicted: the sun-glare reason on 03 and the loose-debris reason on 02.

## (g) Reason-shift diagnostic (targeted pairs; diagnostic only, never a win)

| pair | set-6 categories that disappeared | set-6 categories that persisted | new categories in set 7 | moved the reasons? (§8) |
|---|---|---|---|---|
| 01 house | broken geometry; flat lighting; DOF smear; reference's "pergola, planters, layered landscaping" as the deciding advantage | empty / stud baseplate lots, now background; plain subject house, now "repetitive box houses"; sparse streets | flat-shaded minifigs; low-poly trees; "reads as a prototype"; the reference's house craftsmanship (balusters, dormers, siding) is now the deciding advantage | **yes** |
| 02 skate | bare stud field; muddy fountain; washed-out; blur; ghostly trees: **all five** | none | flat or untextured ramps; blank or stiff figures; loose debris (skateboards, teal box, wedge); plain paving; the reference's tilt-shift is cited as an advantage (3/3) | **yes**, the largest shift |
| 04 farm | blank white wall; washed-out / soft contrast; blurry foreground | "sparse" (J2 only) | low-poly windmill and barn; bare baseplate city blocks behind; simplified figures; the reference's scale (deer, coastline, lush landscape) | **yes** |

**Cross-pair finding:**
- "Bare baseplate / stud lots" in the background is now named in 4 of 5 pairs (01, 03, 04, 05).
- "Simplified, flat-shaded or faceless figures" is named in 3 pairs (01, 02, 04).
- The reference's subject-focused tilt-shift is credited in 01, 02 and 05.

These are the reason classes the judges cite most often going into the next cycle.

Evidence crops are in the scratchpad (outside the repo): `p01A_roof.png`, `p02B_teal.png`, `p02B_figs.png`, `p02B_left.png`, `p02B_plank.png`, `p02B_right.png`, `p02B_wedge.png`, `p02B_heads.png`. The audit script is `audit.cjs` in the same folder.
