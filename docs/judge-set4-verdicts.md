# Blind set 4 — raw verdicts, key, and reason audit

**Protocol:** `node tools/pairs.mjs --ours shots/beauty/c1fix3 --theirs docs/reference --out judge/set4 --seed 31 --balance`
(counterbalanced: split ours/theirs on A = **2/3**). Three fresh general-purpose judges, each given only the ten
image paths and a fixed prompt (pick the more polished shipped-game screenshot per pair + one sentence naming the
deciding details; no context, no key). Judges ran in parallel and could not see each other or the key.

**Provenance (audited):** all 10 `pair-XX-{A,B}.png` are SHA-256 byte-identical to their named sources; the
`--balance` shuffle reproduces from seed 31; the key was not read until all three verdicts were recorded.

## Raw verdicts

**Judge 1**

| pair | pick | reason |
|---|---|---|
| 01 | A | A's close-up house with layered gardens, flowers, and soft depth of field looks finished, while B is a flat, washed-out aerial skyline with harsh white bloom. |
| 02 | B | B's skatepark close-up has crisp detail, characters, props, and depth of field, while A is a plain flat green map with uniform low-detail blocks. |
| 03 | B | B's bright, densely packed cityscape with varied architecture, trees, and a balloon reads as a shipped scene, while A is a dark, sparse street dominated by empty asphalt. |
| 04 | A | A's autumn farm village is packed with corn fields, characters, and props, while B is a plain white building with flat banded textures and empty roads. |
| 05 | A | A's dense street of shops, signs, pedestrians, and vehicles is far more detailed than B's sparse, flat aerial map of repetitive towers. |

**Judge 2**

| pair | pick | reason |
|---|---|---|
| 01 | A | The tight framing on the dollhouse-style home shows crisp roof tiling, planter, porch and foliage detail with soft depth-of-field bokeh, while B is a hazy aerial whose blown-out sun glare washes out the left half of the frame. |
| 02 | B | B is a densely populated skater-park scene with characters, ramps, trees and warm cinematic lighting, whereas A is a flat, evenly lit top-down city grid with no focal subject. |
| 03 | B | B fills the frame with varied isometric buildings, signage, playgrounds, a fountain and a hot-air balloon under clean daylight, while A is a dim night street dominated by a huge empty roadway and near-identical box towers. |
| 04 | A | A presents a lively windmill farm with corn rows, trucks, characters and layered depth, while B is a single plain white building with flat untextured walls and a large empty road. |
| 05 | A | A's street is packed with storefronts, awnings, legible shop signs, vehicles and pedestrians in rich color, whereas B is a distant washed-out aerial of bare boxes on flat green. |

**Judge 3**

| pair | pick | reason |
|---|---|---|
| 01 | A | A's lit house scene has soft depth-of-field, contact shadows and layered garden detail, while B is a washed-out aerial view dominated by blobby sun glare and flat, repetitive tower blocks. |
| 02 | B | B's skate park is packed with posed characters, crisp shadow work and clean material reads, whereas A is a flat-lit overhead city with a blank gray sky and thin, low-detail terrain at the edges. |
| 03 | B | B is a dense, colorful cityscape full of signage, parks, vehicles and a hot air balloon, while A is a dark night street where the empty road takes up half the frame. |
| 04 | A | A's farm corner is full of distinct crops, buildings, vehicles and figures with clean lighting, while B centers a plain white box building with large empty wall surfaces. |
| 05 | A | A shows a lively street of storefronts, awnings, signage and figures with soft shadows and depth, while B is a distant aerial grid of near-identical towers over flat green terrain. |

## Unblinded result (`docs/judge-key-set4.json`)

| pair | A | B | ours is | all picks | result |
|---|---|---|---|---|---|
| 01 | theirs | ours | B (skyline-golden) | A ×3 | loss |
| 02 | ours | theirs | A (overview-noon) | B ×3 | loss |
| 03 | ours | theirs | A (street-night) | B ×3 | loss |
| 04 | theirs | ours | B (closeup-golden) | A ×3 | loss |
| 05 | theirs | ours | B (aerial-dawn) | A ×3 | loss |

**Result: 0/5 unanimous (0–15) — same as sets 1–3.** The cycle-1 composition work did not flip any pair, but the
complaints changed character: no judge mentions HUD/chrome, "empty field" is gone, and every reason now names
*content density, surface detail, depth of field or subject staging* — i.e. the L2/L3 levers, not framing.

**Independent audit (`docs/reviews/loop-c1-set4-audit.md`): valid 0/5.** All ten files byte-identical to their
sources, the keyed assignment and 2/3 split reproduce from seed 31, every pick maps to the reference side, all 15
reasons describe content actually visible in the pair/side they name (no shifted or inverted rows), no
authorship/filename/engine leakage, and only generic cross-judge n-gram overlap. The auditor also magnified pair
02 and confirmed the "blank gray sky / striated terrain edges" reason. Lever ranking from the audit: (1) content
density/micro-dressing, (2) subject staging & depth of field, (3) shadow/material quality, (4) lighting discipline,
(5) map composition (empty arterials, plain facades, repeated towers).

## Reason audit (orchestrator pass; independent auditor to confirm)

- Judge 3's pair-02 "blank gray sky" is the only phrase I cannot fully substantiate: `shots/beauty/c1fix3/02-overview-noon.png`
  has a blue clouded sky band (small). Otherwise every reason describes content present in the pair it names
  (sun glare and repetitive towers in 01/05, empty roadway in 03, plain white building in 04, characters/props
  in the references). No reason quotes the other side's content, filenames, or authorship.
- Levers named by ≥2 judges: **micro-dressing/figures** (all five pairs), **depth of field** (01/05), **sun glare**
  (01), **empty asphalt** (03), **flat walls** (04), **repetitive towers / bare terrain** (02/05).
