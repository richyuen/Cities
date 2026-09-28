# Blind set 6 — raw verdicts, key, and the loop stop

**Protocol:** `node tools/pairs.mjs --ours shots/beauty/set6 --theirs docs/reference --out judge/set6 --seed 43 --balance`
(split ours/theirs on A = **2/3**). Three fresh judges, parallel, image paths + fixed prompt only. Provenance:
all 10 pair files SHA-256 byte-identical to their sources; the seed-43 `--balance` shuffle reproduces; the key was
not read until the verdicts were recorded.

**What is different in set 6:** the "ours" set is the cycle-4 **curated diorama shot list**
(`tools/shot-list.mjs --dof 0.85`: dressed house / park / sunset mini-city / hospital / avenue) instead of
one-shot-per-shipped-preset, and every shot carries the capture-mode tilt-shift and the low-sun bloom discipline.
Pairs 01/02/05 are now subject-class matched (house/park/street); 03/04 remain cityscape vs cityscape and
civic vs farm.

## Raw verdicts

**Judge 1**

| pair | pick | reason |
|---|---|---|
| 01 | A | A delivers a richly dressed house with soft depth of field and coherent shadows, while B has broken geometry — a balcony and windows jutting out of the flat facade — plus flat lighting and sparse surroundings. |
| 02 | B | B is a dense, well-lit brick scene packed with minifigures, ramps and props casting real shadows, whereas A is a bare stud-textured field with a flat, muddy fountain and washed-out sky. |
| 03 | A | A is a crisp, densely populated skyline with readable signage and varied architecture, while B is a blurry near-duplicate tower grid with heavy depth-of-field mush and large empty green lots. |
| 04 | B | B fills the frame with a colorful farm-diorama full of crops, vehicles, figures and crisp brick detail, while A centers on a large blank white wall with few props and softer contrast. |
| 05 | A | A shows a lively, sharp street of shops with awnings, signage, vehicles and minifigures, whereas B is a mostly empty road with heavy edge blur and repetitive slab towers. |

**Judge 2**

| pair | pick | reason |
|---|---|---|
| 01 | A | A has soft sunlight, depth-of-field background haze, layered landscaping and a detailed city skyline, while B is flat-lit with repeated stud-textured ground and empty road. |
| 02 | B | B's skate park is packed with readable props, shadows and figures on layered surfaces, whereas A is a monotonous field of green studs with blurry edges. |
| 03 | A | A shows a dense, varied skyline with distinct building facades, parks and a bridge, while B's towers repeat and its foreground fades into heavy blur. |
| 04 | B | B's farm scene is full of crops, windmill, trucks and street life with crisp lighting, while A is a plain white block building on an empty corner. |
| 05 | A | A's street has signage, awnings, vehicles, figures and trees at high detail, while B has repetitive building textures, washed-out light and a bare, blurry foreground. |

**Judge 3**

| pair | pick | reason |
|---|---|---|
| 01 | A | A shows a richly detailed house with a garden, pergola, planters and a soft city skyline behind it, while B is a flat purple block with near-empty green fields and smeared road edges. |
| 02 | B | B's skate park is packed with crisp minifigures, ramps, plants and props under clear lighting, whereas A is a washed-out park scene with ghostly translucent trees and heavy blur. |
| 03 | A | A reads as a full diorama with bridges, landmarks, a hot-air balloon, streets and a playground, while B is a repetitive grid of towers over empty lawns with severe depth-of-field blur. |
| 04 | B | B's farm scene has a windmill, dense cornfields, houses and vehicles with clean detail, whereas A is a plain white hospital block with washed-out lighting and blurry foreground. |
| 05 | A | A's street scene is full of readable detail — storefront signs, cars, minifigures and a picnic park — while B is a blurry, sparsely detailed road flanked by untextured green plots. |

## Unblinded result (`docs/judge-key-set6.json`)

| pair | A | B | ours is | all picks | result |
|---|---|---|---|---|---|
| 01 | theirs | ours | B (house-golden) | A ×3 | loss |
| 02 | ours | theirs | A (park-noon) | B ×3 | loss |
| 03 | theirs | ours | B (skyline-golden) | A ×3 | loss |
| 04 | ours | theirs | A (civic-golden) | B ×3 | loss |
| 05 | theirs | ours | B (avenue-noon) | A ×3 | loss |

**Result: 0/5 unanimous (0–15). Sixth consecutive 0/5 set (1–6).**

**Independent audit (`docs/reviews/loop-c4-set6-audit.md`): valid 0/5, not compromised.** All 15 votes map to the
reference side; 10/10 pair files byte-identical to their keyed sources; the seed-43 shuffle re-creates the pairs
byte-for-byte; no leaks; no flagged reasons. Judge 1's pair-01 "broken geometry" was checked at 2× on our B side:
the balcony/platform and proud window panels exist but nothing floats, clips or detaches — a stylistic read, not a
defect (consistent with cycle-3's containment scan), so the loss stands and no re-judge is required. Caveat from
the audit: the same five reference images were reused across sets 4–6, so this is a **plateau signal**, not an
absolute-quality or regression signal.

## Why — the decisive findings

1. **The fixed-band tilt-shift at 0.85 is a net negative in judging.** Every judge names it: "heavy
   depth-of-field mush", "blurry edges", "ghostly translucent trees", "smeared road edges", "heavy edge blur",
   "blurry foreground". The reference DOF is subject-focused; ours blurs a screen band indiscriminately and, on
   shots whose lower band is a stud field, turns texture into mush. The pass is correct as engineered (off =
   pixel-identical, +1 draw) but the *compositional rule* is wrong for judge appeal at this strength.
2. **The remaining gap is content, not camera/post.** The references are hand-authored close-up dioramas with
   layered art direction: pergolas, planters, crops, laundry, animals, signage with words, distinct silhouettes.
   Ours is a procedural city with generic props; even class-matched pairs (01 house, 02 park, 05 street) lose on
   "layered landscaping / crammed props / readable detail".
3. **The judges reward subject-scale density, not scale.** Where we got closest (civic closeup, dressed house),
   the losses narrowed to "few props / blank wall / repeated studs" — i.e. our best shots need *more authored
   content on the subject*, not better framing.

## Loop accounting (LOOP §6)

- Sets 4, 5 and 6 are all 0/5 → **three consecutive no-move sets: the loop stops here.**
- Cycle cap not reached (4 of 6), but the stop rule governs.
- The plateau rule's second clause (change approach class) was honoured twice (composition → dressing →
  facade/lighting/depth), and the third class (curation + DOF) was tested and judged negative at this strength.
