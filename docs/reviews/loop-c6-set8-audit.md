<!-- Saved verbatim by the orchestrator, 2026-10-09 (extracted from the critic agent's final message). Integrity check: git status identical before and after the run; verdicts and key hashes unchanged. -->

# loop-c6-set8-audit

verdict: VALID (pairs to re-judge: none)
result: 0/5 (votes 0/15)

All 15 votes went to the reference, unanimous in every pair. This is the eighth consecutive 0/5 set. Bytes, shuffle and seed all check out, and none of the 15 reasons names content missing from its image.

Every number below is from this session. The script is `C:\Users\ryuen\AppData\Local\Temp\claude\C--Git-Cities\ac5f4a89-9f27-4edc-becd-51e343f136f0\scratchpad\audit.cjs` (run as `node <scratchpad>/audit.cjs` from `C:\Git\Cities`). `git status --porcelain` showed only `?? docs/reviews/loop-c6-set8-verdicts.md` before and after my run; HEAD is 1637803. I wrote nothing inside the repo.

## (a) Bytes (SHA-256 of each pair file against its keyed source)

| file | keyed source (side) | SHA-256 | match | bytes | magic / format |
|---|---|---|---|---|---|
| pair-01-A | set8/01-house-golden.png (ours) | 6543a4da0f6802545597e6125991e7121232a049cf8bd3a9a70b3d10523fc74e | MATCH | 2,616,565 | `89504e47` PNG 1920x1080 |
| pair-01-B | ss_08751f…jpg (theirs) | e7ba17d39e19da3d06061b365a9619387e4e477301a2f16fe4b438e1457b6e15 | MATCH | 555,096 | `ffd8ffe0` JPEG 1920x1080 |
| pair-02-A | ss_152213…jpg (theirs) | a2e65d0354ffdb3d843b96a25fe09bb24d1006b8364460306a9b01507c48fdd6 | MATCH | 699,037 | `ffd8ffe0` JPEG 1920x1080 |
| pair-02-B | set8/02-park-noon.png (ours) | 23f765a11cbea3072d2532a70a363fd81933494bb13c72b59b8b05029b5f2063 | MATCH | 2,990,409 | `89504e47` PNG 1920x1080 |
| pair-03-A | set8/03-skyline-golden.png (ours) | 1abbd38a5a787d4e4bea83e995f81883b4b377ae1a75f3aa10ac18dc21b1293d | MATCH | 2,598,562 | `89504e47` PNG 1920x1080 |
| pair-03-B | ss_abbf7c…jpg (theirs) | 9d5c7b759b5e5027b255a9611ecd2ab3787753ad6e425ee6a0fbab0774ccb2e7 | MATCH | 1,046,900 | `ffd8ffe0` JPEG 1920x1080 |
| pair-04-A | ss_b3e407…jpg (theirs) | ee070403c30b3bae0f909142b9c7f118bd131490052d456e3ce8c4ee877e2454 | MATCH | 1,037,396 | `ffd8ffe0` JPEG 1920x1080 |
| pair-04-B | set8/04-farm-golden.png (ours) | b4b9428158f12528d967a33f86f72e8fa60985ec1beaf15f4b16510bb28b8807 | MATCH | 3,526,649 | `89504e47` PNG 1920x1080 |
| pair-05-A | ss_f6daab…jpg (theirs) | 5fcaa5280f9344cfe5334cdff9ca8a81f5331ac39ce1cf17698b9dd58901c864 | MATCH | 903,002 | `ffd8ffe0` JPEG 1920x1080 |
| pair-05-B | set8/05-avenue-noon.png (ours) | 69580ab61fa60ecfcc9cf9582f317cb48a1c857a92a183bbf46137f51761c361 | MATCH | 2,195,177 | `89504e47` PNG 1920x1080 |

- **JPG under a `.png` name:** the five reference-side pair files are the original JPEG byte streams, not conversions. `tools/pairs.mjs` copies with `fs.copyFileSync` and hard-codes the `.png` name, so byte SHA-256 is the right test and all 10 pass.
- **Same as set 7:** set 7 handled it identically. The five reference hashes equal the set-7 audit table, so the reference files have not changed.
- **File contents:** ours are PNGs with IHDR/IDAT/IEND only. Theirs have JFIF APP0 only (segments e0, db, db, c0, c4×4, da), no EXIF.
- **Leak signature, unchanged from sets 4–7:** ours are larger in every pair (2.2–3.5 MB against 0.55–1.05 MB) and file times differ (ours Oct 9 23:41, theirs Sep 16). This is visible only through the filesystem; no reason mentions format, compression, size or names. Cosmetic, and still unfixed in `pairs.mjs`.
- **Capture metadata:** all five `shots/beauty/set8/*.json` have `errors: []`. The 05 URL is `?seed=1&tod=12&hud=0&fixeddt=1` (no `dof`), at 6.84 ms GPU and 743 draws.
- **Commit provenance not proven:** the 05 capture is stamped 23:41:37 local and the 1637803 commit 23:41:01. With a clean tree this is consistent with "captured on 1637803 code", but nothing proves it beyond that.

## (b) Shuffle (seed 71, `--balance`)

I re-implemented the RNG (pairs.mjs line 20) and the balance block (lines 25–31) in the scratch script; nothing was written to `judge/` or `docs/`.

- Raw per-pair flips are [F, F, F, F, T]; `--balance` discards them.
- The balanced Fisher–Yates on [T, T, T, F, F] gives [F, T, F, T, T], so A = ours, theirs, ours, theirs, theirs.
- That equals `docs/judge-key-set8.json` exactly. Split: ours on A = 2 (pairs 01, 03), theirs on A = 3.
- Sorted ours (01-house … 05-avenue) pair by index with sorted references (ss_0875, ss_1522, ss_abbf, ss_b3e4, ss_f6da), as keyed.
- Seeds read from every `docs/judge-key-*.json`: 7, 11, 23, 31, 41, 43, 53 (sets 1–7), 61, 67 (lawn1, lawn2), 71 (set 8). Seed 71 was not used before.

## (c) Reasons (all 10 images opened with Read; 15 reasons checked)

| pair | judge | named content and side | present? | note |
|---|---|---|---|---|
| 01 | J1 | B: brick house with studs, DOF, blurred skyline, sandbox, pond, layered trees. A: flatter house, blobby orange tree, cooling-tower backdrop, pergola cropped in foreground | yes, all | A's pergola is cut by the left and bottom edges (x 0–700, y 650–1080); orange tree at x 1450–1780 |
| 01 | J2 | B: sandbox, pond, DOF skyline, loose roof pieces above the ridge. A: blobby trees, cooling towers, simple box apartments behind | yes, all | Roof cluster on B at about x 740–1090, y 45–265; apartment blocks on A at x 1240–1920, y 190–350 |
| 01 | J3 | B: studs, DOF brick skyline, loose roof pieces. A: smooth-shaded house, flat tile lawn, cooling towers | yes, all | |
| 02 | J1 | A: glossy curved orange ramps, printed figures, contact shadows, tilt-shift. B: "flat checker-tinted quads", stiff near-identical figures, noisy grey tiles | content yes; "flat" overstated | see below |
| 02 | J2 | A: curved ramps, glossy highlights, long shadows, blurred background. B: flat evenly lit paving, stiff identical figures, dark blob shadows, pillow trees | yes, all | |
| 02 | J3 | as J1, plus B's "even, flat lighting" | content yes; "flat … quads" overstated | |
| 03 | J1 | B: landmark towers, signage, parks, suspension bridge, balloon, haze. A: repeated towers, empty green lots, sun glare | yes, all | |
| 03 | J2 | as J1, plus B's playground; A's "window-grid towers", "empty green lawns" | yes, all | |
| 03 | J3 | as J1, plus QUILT and VIDEO PLANET; A's "bare storage tanks" | yes, all | Tanks on A at x 250–560, y 820–1080 |
| 04 | J1 | A: wheat rows, haystacks, windmill, red barns, trucks, minifigs, coastline. B: windmill, barn, corn on flat green plates, bare surrounding lots | yes, all | |
| 04 | J2 | A: as J1, plus deer. B: "noisy stalk masses", large flat green tiles, simpler buildings, "empty surrounding neighbourhood" | yes | The neighbourhood has six or seven houses at the top; the lots between them are empty lawn. Fair. |
| 04 | J3 | A: scarecrows, deer, fenced fields, brick houses in front. B: noisy uniform wheat and corn, large empty tiled green, simpler barn and houses | yes, all | |
| 05 | J1 | A: Joe's, Hotel, Comedy, awnings, café tables, cars, picnic. B: low-angle empty road, oversized stud curbs, bare pale-green plate, repetitive towers | yes; "empty" overstated | B has three or four vehicles at mid-distance (x 850–1040, y 520–620); the near 60% of the road is empty |
| 05 | J2 | as J1; B: "near-empty road", "studded lawn" | yes, all | The most accurate wording of the three |
| 05 | J3 | as J1; B: "empty avenue", "blank pale-green field" | yes; adjectives overstated | The field has sparse studs and tile seams, so "blank" is loose |

- **Pair 02, "flat checker-tinted/tiled quads" (J1, J3):** B has one flat bank and one flat kicker (x 620–940, y 390–600). Its two quarter-pipes (x 1000–1210, y 400–620 and x 1280–1650, y 540–840) are visibly curved, built from flat-shaded checker quads.
- **Why it is not flagged:** the named content (checker-tiled ramps with no gloss) is in the image; only the geometry adjective overstates. That is the same standard set 7 applied to "floating".
- **Flagged reasons:** none. 15 of 15 are consistent.

## (d) Score

| pair | ours | ours is | J1 | J2 | J3 | picks for ours | result |
|---|---|---|---|---|---|---|---|
| 01 | 01-house-golden | A | B | B | B | 0/3 | loss |
| 02 | 02-park-noon | B | A | A | A | 0/3 | loss |
| 03 | 03-skyline-golden | A | B | B | B | 0/3 | loss |
| 04 | 04-farm-golden | B | A | A | A | 0/3 | loss |
| 05 | 05-avenue-noon | B | A | A | A | 0/3 | loss |

- **Total:** 0/5; own-picks 0/15.
- **Side split:** ours on A = 2, theirs on A = 3. Judges picked A 9 times and B 6 times, always the reference side, so there is no side bias.

## (e) Reason shift against set 7 (diagnostic only)

| pair | set-7 categories gone | persist | new in set 8 |
|---|---|---|---|
| 01 house | "box / blocky houses" for the subject; "stud-grid lots", "empty baseplate lots to the horizon"; "sparse street grid"; "flat-shaded minifigs" | reference DOF and skyline (3/3); reference "brick-built … studs" (3/3); trees ("low-poly" becomes "blobby", J1, J2) | "plain cooling-tower backdrop" (3/3); "flatter / smooth-shaded" (3/3); "pergola cropped awkwardly" (J1); "simple box apartments behind" (J2); "flat tile lawn" (J3) |
| 02 park | "blank / faceless figures" (was 3/3); "loose pieces / debris" (was 3/3); "untextured" ramps | "flat" ramps, now "checker-tinted quads" (J1, J3); "stiff" figures (3/3); paving ("noisy grey tiles" J1, "flat evenly lit" J2); reference tilt-shift (3/3) | figures "near-identical / identical" (3/3); reference "glossy … reflections / specular" (3/3); "dark blob shadows", "pillow-shaped trees" (J2); "even, flat lighting" (J2, J3) |
| 03 skyline | none | "repeated towers" (3/3); "empty green lots / lawns / plain" (3/3); "blown-out sun glare" (3/3) | "bare storage tanks" (J3); "sparse" (J2, J3) |
| 04 farm | "stud" and "baseplate" wording; "simplified figures"; "low-poly windmill" (the windmill is not criticised now) | bare or empty surround (3/3); simpler buildings (J2, J3) | "noisy stalk masses / noisy uniform masses" (J2, J3); "simpler shading" (J1) |
| 05 avenue | "flat sky"; "one lone pedestrian"; "oversized studs" on the grass | "empty road" (3/3); "oversized … curb studs" (3/3); "repetitive plain towers" (3/3) | "bare / blank pale-green" plate, lawn or field (3/3); "low-angle / ground level" (J1, J2) |

The categories you asked about:

| category | set 8 status |
|---|---|
| box houses / house craft | Gone for the subject house (01: "cleaner but flatter"). Residual: J2's "simple box apartments behind". The reference still wins 3/3 on "brick-built … studs". |
| stud-grid lots / studded baseplate | Gone in 01 and 04. One residual in 05: J2's "studded lawn". |
| bare baseplate | The word "baseplate" appears 0 times. "Bare / empty lots" persists in 03, 04 and 05 (3/3 each); gone from 01. That is 3 of 5 pairs, down from 4 of 5. |
| blank or faceless figures | Gone, 0/15. Replaced in 02 by "stiff, (near-)identical" (3/3). Figures are cited against ours in 1 pair, down from 3. |
| flat ramps | Persists in 02 (J1, J3). The texture is now noticed ("checker"), but the gloss and curvature gap remains. |
| loose pieces | Gone on ours, 0/15. Cited only against the reference (01, J2 and J3). |
| oversized studs | Persists in 05, 3/3, now only the kerb rows. |
| empty road | Persists in 05, 3/3. |
| repeated towers | Persists in 03 (3/3) and 05 (3/3). |
| sun glare | Persists in 03, 3/3. |
| no depth of field | Reference DOF or tilt-shift credited in 01 (3/3), 02 (3/3) and 05 (J3 only); 03 credits "atmospheric haze" (3/3). |

The lawn is now in the blind metric as a named negative: "flat tile lawn" (01, J3), "large flat green plates / tiles" (04, 3/3) and "pale-green" (05, 3/3). It removed the stud wording but did not produce a single positive mention.

## (f) Prediction ledger

With 0/15, no "no change" call can be tested by vote margin; scoring is by reason class, as in set 7. Only the three "narrows" calls carry real information, and all three hit. I did not diff the lawn critic's prediction frames (`shots/beauty/c6lawncrit1-s1`) against set 8, so drift from the two fix rounds is unmeasured.

**Lawn critic (`docs/reviews/loop-c6-lawn-critic.md`, table (b))**

| pair | prediction | outcome | score |
|---|---|---|---|
| 01 | narrows: stud-grid reason goes, "empty lots" may persist, no flip | Stud-grid gone 3/3, empty lots also gone, 0/3 votes | HIT |
| 02 | no change | Votes unchanged, but two of three set-7 classes vanished (blank figures, loose pieces) and gloss / identical figures appeared | MISS on reason class (hit on votes only) |
| 03 | no change: lots still empty, now smoother | All three reasons persist; J2 now says "lawns" | HIT |
| 04 | narrows: "stud lots" wording goes, "bare lots" may remain | Exactly that: no stud wording, "bare surrounding lots" 3/3 | HIT |
| 05 | no change, risk of worse: kerb studs untouched, field adds a new reason (washed-out lawn with dark dots) | Kerb studs 3/3; new "pale-green" reason 3/3; "dark dots" not cited | HIT (risk half realised) |

Hit rate: **4/5** on reason class, 5/5 on votes. Its "0/5 votes moved by the lawn" expectation also held.

**Demo critic (`docs/reviews/loop-c6-demo-critic.md`)**

| pair | prediction | outcome | score |
|---|---|---|---|
| 01 | narrows: "box house" goes; brick texture, DOF, skyline (cooling towers) and "studded baseplate or flat lighting" remain | "Box house" gone; cooling towers 3/3, DOF 3/3, brick-built 3/3, "flatter" 3/3; the baseplate alternative did not occur | HIT, the most accurate call in either table |
| 02 | no change from this stage; any narrowing comes from the committed props work | Reasons narrowed (blank figures, loose pieces gone) | HIT only on its hedged scope; the stage attribution cannot be tested in this set. As a bare "no change" it is a MISS. |
| 03 | no change | Identical reasons | HIT |
| 04 | no change, risk of slightly worse; "bare baseplate" cited again | Bare surround 3/3, with "empty surrounding neighbourhood" (J2) matching its issue 1; the word "baseplate" is gone | HIT on substance, miss on wording |
| 05 | no change | Three reasons persist | HIT |

Hit rate: **5/5** lenient, **4/5** strict (pair 02). Its "0/5, reason shift confined to pair 01" call is half right: 0/5 yes, but 02 and 04 also shifted.

Neither critic predicted these: the 02 loose-debris reason vanishing, "glossy / specular" as the new 02 reference advantage, "identical figures", "noisy stalk masses" in 04, or blobby and pillow trees in 01 and 02. Neither is below the 50% threshold in LOOP §8.

## (g) Three levers for the next cycle, ranked strictly from the 15 reasons

1. **Background buildings and backdrop (9 of 15 reasons, pairs 01, 03, 05).**
   - 03: "repeated same-shaped towers" / "repeated window-grid towers" / "repeated box towers", "scattered across large empty green lots" (3/3).
   - 05: "repetitive featureless / plain towers" (3/3).
   - 01: "plain cooling-tower backdrop" (3/3) plus "simple box apartments behind" (J2).
   - The reference is credited with "distinct landmark towers, signage" and a "detailed blurred skyline". This is the only class that decides three pairs, and cycle 6 did not touch it.

2. **Surface shading and material: flat against glossy plastic, with subject depth of field (pairs 01, 02, 04; 10 of 15 reasons).**
   - 01: "flatter-shaded" / "flatter" / "smooth-shaded" (3/3), against "real stud/plate geometry" and "soft depth-of-field" (3/3).
   - 02: "glossy … believable plastic reflections" / "real specular highlights" (3/3), "crisp contact shadows", against "flat checker-tinted quads" and "even, flat lighting"; tilt-shift credited 3/3.
   - 04: "simpler shading" (J1).
   - Geometry craft stopped being the reason in 01; what replaced it is shading and material response.

3. **The 05 near field (3/3 for each of three reasons, all in one pair).**
   - "empty road" / "near-empty road".
   - "oversized stud curbs / kerbs".
   - "bare / blank pale-green plate / field".
   - The reference wins on "packed … storefronts, readable signs, awnings, cafe tables, cars". This is the pair furthest from a flip; the ground-level camera is itself named (J1, J2), so the cheapest change is the shot or kerb scale rather than content.

Smaller, cheap items: trees ("blobby orange tree foliage", "pillow-shaped trees": 01 J1/J2, 02 J2); figure variety in 02 ("stiff identical", 3/3); crop readability in 04 ("noisy stalk masses", J2, J3); the 01 pergola crop (J1); the 03 sun glare (3/3, unchanged for two sets).

Files:
- `C:\Git\Cities\docs\judge-key-set8.json`
- `C:\Git\Cities\docs\reviews\loop-c6-set8-verdicts.md`
- `C:\Git\Cities\judge\set8\pair-0{1..5}-{A,B}.png`
- `C:\Git\Cities\shots\beauty\set8\`
- `C:\Git\Cities\tools\pairs.mjs`
- `C:\Users\ryuen\AppData\Local\Temp\claude\C--Git-Cities\ac5f4a89-9f27-4edc-becd-51e343f136f0\scratchpad\audit.cjs`
