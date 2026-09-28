# Blind set 5 — raw verdicts, key, and reason audit

**Protocol:** `node tools/pairs.mjs --ours shots/beauty/c2c --theirs docs/reference --out judge/set5 --seed 41 --balance`
(counterbalanced: split ours/theirs on A = **2/3**). Three fresh judges, parallel, image paths + fixed prompt only.

**Provenance (orchestrator + independent audit):** all 10 pair files SHA-256 byte-identical to their sources;
the `--balance` shuffle reproduces from seed 41; the key was not read until the verdicts were recorded.

## Raw verdicts

**Judge 1**

| pair | pick | reason |
|---|---|---|
| 01 | A | A shows a crisp close-up brick-built house with rich prop detail, soft depth of field and no blowout, while B's aerial skyline is washed out by a huge bloom flare and its terrain reads as flat, unfinished tiling. |
| 02 | A | A's isometric skate-park scene has sharp character models, readable props and deliberate vignetting, whereas B is a flat, low-detail aerial grid with plain solid-green ground and no focal subject. |
| 03 | B | B packs a dense, colorful cityscape with water, bridge, balloon and readable signage in clean daylight, while A is a dark, noisy street shot with repeated stud geometry and harsh light bloom. |
| 04 | A | A's farm scene is full of distinct content — windmill, corn rows, trucks, villagers, hay bales — under warm directional light, while B is a large empty white hospital block with flat blank walls and no activity. |
| 05 | B | B is a detailed street-level block of storefronts, signage, buses and pedestrians with clear depth, while A is a hazy top-down sprawl of repetitive towers on flat green with no close-up interest. |

**Judge 2**

| pair | pick | reason |
|---|---|---|
| 01 | A | A has crisp voxel detail, soft depth of field and warm lighting, while B is a flatter aerial with blown-out sun glare and repetitive windows. |
| 02 | A | A is a sharply lit, detail-dense street-level scene with clear depth of field, whereas B is a flat, low-detail aerial map with washed greens. |
| 03 | B | B is a packed, colorful panorama with varied architecture, foliage and soft atmospheric haze, while A is a dark, sparse night street with plain building faces. |
| 04 | A | A fills the frame with textured corn fields, a windmill and varied props under warm light, while B is a near-empty white building with flat untextured walls. |
| 05 | B | B shows richly detailed storefronts with signage, characters and vehicles in crisp daylight, while A is a hazy, low-detail aerial with muted colors. |

**Judge 3**

| pair | pick | reason |
|---|---|---|
| 01 | A | A leans on a sharp, well-lit hero house with soft background bokeh and grounded props, while B is blown out by bloom and lens flare over rows of near-identical washed-out blocks. |
| 02 | A | A packs a crisp, shadow-rich LEGO-style skate park with readable minifigures and props, whereas B is a flat, hazy wide shot of tiny low-detail buildings. |
| 03 | B | B is a vivid, densely detailed downtown with legible storefront signs, greenery, a hot air balloon and a bridge in the distance, while A is a dark frame dominated by empty asphalt and flat lighting. |
| 04 | A | A offers a colorful, busy farm vista with a windmill, corn rows, trucks and houses, while B centers on a plain white slab building with grainy dithering artifacts and an empty street filling the foreground. |
| 05 | B | B is a lively street of varied storefronts with legible signage, traffic, characters and depth-of-field falloff, while A is a hazy wide city view with washed colors and tiny indistinct buildings. |

## Unblinded result (`docs/judge-key-set5.json`)

| pair | A | B | ours is | all picks | result |
|---|---|---|---|---|---|
| 01 | theirs | ours | B (skyline-golden) | A ×3 | loss |
| 02 | theirs | ours | B (overview-noon) | A ×3 | loss |
| 03 | ours | theirs | A (street-night) | B ×3 | loss |
| 04 | theirs | ours | B (closeup-golden) | A ×3 | loss |
| 05 | ours | theirs | A (aerial-dawn) | B ×3 | loss |

**Result: 0/5 unanimous (0–15) — identical to sets 1–4. No pair has flipped yet.**

## Why (the judges converge)

- **The two wide heroes are structurally losing (pairs 02/05).** Every reason calls them "flat / hazy / washed /
  tiny indistinct buildings / no focal subject" next to close-up dioramas. This is a *scale* mismatch, not a
  defect: a whole-city aerial at 1920×1080 cannot out-detail a skate-park close-up.
- **Pair 01 (sunset skyline): the sun bloom is now a liability** ("huge bloom flare", "blown out … lens flare")
  on all three judges, defeating the golden identity it was meant to sell.
- **Pair 03 (night street): still "empty asphalt" + "plain building faces" + "repeated stud geometry".**
- **Pair 04 (civic closeup): "flat blank walls" + "grainy dithering artifacts" + "empty street foreground"** —
  the cycle-2 dressing is present but small in frame; facade detail (cycle 3, in flight) is the lever.

## Loop accounting

- Plateau: sets 4 and 5 are both 0/5 with the same content/scale class of complaints → **2 of 3** no-move sets.
- The remaining cycles must change the *class* of the hero images, not add more dressing:
  1. **Curated beauty-shot list** (cycle 4, with the metric in mind): the hero set should be five
     store-page-grade compositions (close/diorama scale) rather than one-shot-per-shipped-preset, while the
     presets remain the product's camera family (guarded by `check-beauty`'s geometry gates).
  2. **Capture-mode depth of field / tilt-shift** (cycle 4) — every judge names the references' DOF; it is also
     what makes a mid-distance shot read as a miniature diorama.
  3. **Lighting discipline** (cycle 4): clamp the low-sun bloom so the skyline keeps its gold without the flare.
  4. **Buildings facade/rooftop detail** (cycle 3, in flight) for pairs 03/04.
