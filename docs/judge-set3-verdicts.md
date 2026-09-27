# Blind judge set 3 — raw verdicts (V5 beauty-shot pass)

Local-only artifacts (gitignored): `judge/set3/pair-*-{A,B}.png`, `shots/beauty/v5/*.png` (our five HUD-free hero
shots with the recomposed presets), `docs/judge-key-set3.json`. This file is the committed record.

Protocol: `node tools/pairs.mjs --ours shots/beauty/v5 --theirs docs/reference --out judge/set3 --seed 23`.
Three independent judge subagents, images only, no key. Set 1/2 baseline: **0/5 unanimous**.

## Judge 1

| pair | pick | conf | reason |
|---|---|---|---|
| 01 | A | 4 | Warm sunset lighting, shallow depth of field and dense close-up detail (garden, porch, street) far outclass B's flat, repetitive grid of distant towers with empty fields. |
| 02 | A | 5 | Vibrant skate-park diorama full of minifigures, props and dynamic shadows beats B's hazy, top-down grid of tiny uniform buildings. |
| 03 | B | 5 | Bright isometric cityscape packed with landmarks, parks and colorful roofs reads as a lively store hero shot; A is a dark, mostly empty night street. |
| 04 | A | 5 | Golden autumn farm scene with windmill, corn rows, vehicles and villagers is far richer and warmer than B's drab industrial close-up with blank concrete. |
| 05 | A | 5 | Bustling street corner with shops, signage, pedestrians and a picnic in the park shows a living city; B is a sparse top-down grid with few details. |

## Judge 2

| pair | pick | conf | reason |
|---|---|---|---|
| 01 | A | 4 | Rich, well-composed close-up with warm pink-sky lighting, layered foreground foliage and detailed LEGO brickwork vs. a flat, repetitive aerial high-rise sprawl. |
| 02 | A | 5 | Lively close-up skatepark with characters in action, strong shadows and readable props vs. a washed-out straight-down minimap view of city blocks. |
| 03 | B | 3 | Colorful, bustling aerial with hot-air balloon, bridge and dense detail reads better as a store shot than the moody but sparse night road view. |
| 04 | B | 5 | Busy street full of signage, pedestrians, vehicles and picnic life, with much stronger visual interest and sense of a living city than the near-empty intersection shot. |
| 05 | A | 5 | Storybook windmill/harvest farm with tractors, deer and activity beats the flat overhead grid map with little drama or focal point. |

## Judge 3

| pair | pick | conf | reason |
|---|---|---|---|
| 01 | A | 5 | Cinematic close-up with warm sunset light, rich detail and a playful exploding-roof house; B is a flat, distant aerial with dull lighting. |
| 02 | A | 5 | Vivid, sunlit LEGO skate-park scene with minifigures and strong depth; B is a sparse wide aerial with bland green emptiness. |
| 03 | B | 4 | Lively dense townscape with balloon, bridge and varied color; A is atmospheric but dark and visually thinner. |
| 04 | B | 5 | Busy shop-lined street with minifigures, vehicles, awnings and signage; A is a sterile, empty tower close-up. |
| 05 | A | 4 | Angled view with water, hills and depth plus more visual variety; B is a flat, repetitive top-down grid. |

## Unblinding (`docs/judge-key-set3.json`, seed 23)

| pair | A | B | judges' picks | outcome |
|---|---|---|---|---|
| 01 | theirs | ours | A ×3 | loss |
| 02 | theirs | ours | A ×3 | loss |
| 03 | ours | theirs | B ×3 | loss |
| 04 | theirs | ours | A, B, B (see below) | **disputed → re-judged: loss** |
| 05 | theirs | ours | A ×3 | loss |

**Corrected result: 0/5** — the same as sets 1–2. The table above is kept as-is (it is the raw record), but the
pair-04 "win" was a **judging artifact**: judge 2's reasons for pairs 04 and 05 describe each other's references,
and judge 3's pair-04 reason calls the tower "A" (it is B). A fresh blind re-judge of pair 04 alone (two new
independent judges, no other context) both described the images correctly and picked **A = theirs, confidence 5**
("a vibrant, light-filled, richly detailed diorama full of citizens, vehicles and variety" vs "gray, static,
dominated by a single flat tower with little sense of a living city"). Pair 04 is a loss; the earlier two votes
were answer slips. The critic's audit (`docs/reviews/beauty-v5-critic.md`) independently reached the same
conclusion (its own picks: A, A, B, A, A → theirs 5/5).

**What set 3 does prove:** no judge reason mentions the HUD or any UI chrome in any of the 15 verdicts (the
`?hud=0` capture removed it), and the surviving complaints are content/composition, not presentation: the
straight-down `overview`/`aerial` read as maps (pairs 02/05), the night street is dark/thin (03), and our closeup
is a cropped hero tower with no activity vs the references' bustling dioramas (01/04). Next levers, in order:
(1) an oblique aerial with a foreground anchor; (2) a livelier night street (lit windows/streetlights/traffic, a
subject); (3) micro-detail density/props/set dressing (the content lever every loss shares); (4) closeup framing
that fits the hero (the tower crops > 40 % of the frame).
