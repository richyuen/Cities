# Blind set 7 — raw verdicts, key, and the result

**Protocol:** `node tools/shot-list.mjs --out shots/beauty/set7` (list c5, seed 1, no DOF), then
`node tools/pairs.mjs --ours shots/beauty/set7 --theirs docs/reference --out judge/set7 --seed 53 --balance`
(split ours/theirs on A = **2/3**). Three fresh judges in parallel, given only the 10 image paths and the fixed template.
The orchestrator did not read the key until the audit (`docs/reviews/loop-c5-set7-audit.md`) had run: VALID,
10/10 byte-identical, shuffle reproduced, 15/15 reasons consistent.

**What is different in set 7:** cycle 5's authored set-pieces. 01 = pergola garden around a hero house, 02 = skate
plaza, 04 = community farm (replacing the hospital closeup; still sorts 4th, so it pairs with the farm reference).
03/05 are the unchanged shipped presets. Tilt-shift is off (set 6 judged it negative).

## Raw verdicts (verbatim)

**Judge 1**
01: A | A's hero Victorian house has detailed brick-built siding, porch balusters, dormers and a raised flower planter, with soft depth-of-field over a dense layered skyline, while B's playground and pond sit on a flat studded baseplate under repetitive box houses and a sparse, empty street grid.
02: A | A's skate park has richly brick-built ramps with checker and stud textures, expressive minifigs (one on a skateboard, one with curly hair) and warm tilt-shift lighting, while B has smooth, untextured orange ramps, stiff blocky figures and loose skateboard pieces scattered across plain grey paving.
03: B | B is a dense, varied city with a hot-air balloon, a suspension bridge, landmark towers, signed storefronts ("QUILT", "VIDEO PLANET") and parks full of trees, while A is a uniform grid of near-identical tall boxes on empty green lots under a washed-out sun bloom.
04: B | B's farm has a detailed brick windmill, a red barn and farmhouse, trucks on the roads, hay bales, deer and a coastline, all in tightly composed natural lighting, while A's windmill and barn are simple low-poly shapes on bare baseplates with flat, repetitive crop fields.
05: A | A is a lively main street with signed facades ("JOE'S", "Hotel", "COMEDY"), café umbrellas, a bus, cars and a picnic in the park, while B is a ground-level view of an empty road with oversized flat studs, plain repeated towers and almost no detail or people.

**Judge 2**
01: A | A has a detailed Victorian house with a dormered roof, clapboard siding, a porch with balusters, and a raised flower bed, framed by depth of field against a soft pastel skyline. B's toy-like blocky houses sit on a flat, repetitive stud-grid of lots that stretches to the horizon. (A also has a cluster of roof pieces floating in the air above the house, but its overall finish still wins.)
02: A | A's skate park has printed minifigs with faces and props, a textured brick-built ramp, and tilt-shift blur with warm lighting. B's minifigs are simplified and blank, its ramps are flat-shaded orange stripes, and it has a stray teal slab and loose planks.
03: B | B is a dense, varied downtown with landmark towers, signed shops ("QUILT", "VIDEO PLANET"), a hot-air balloon, a suspension bridge, and parks. A is a grid of near-identical striped towers on empty green lots with blown-out sun glare.
04: B | B's farm has brick-built crops, hay bales, a detailed barn and farmhouse, deer, trucks on the road, and many minifigs, set into a lush landscape. A's windmill, red barn, and crop rows look clean but sparse, with simple low-detail houses on bare stud lots.
05: A | A's street has richly detailed shopfronts ("JOE'S", "Hotel", "COMEDY"), cafe seating, a picnic in the park, cars and buses, and tilt-shift depth. B is a near-empty street-level road with oversized studs on the curb and grass and plain repeated towers under a flat sky.

**Judge 3**
01: A | A has a detailed brick-built Victorian house with a tiled porch roof, flower boxes and sandbox, warm depth-of-field blur over a detailed downtown skyline, and natural lighting; B's flat-shaded minifigs, blocky low-poly trees and a background of empty green baseplate lots read as a prototype.
02: A | A has intricately brick-built skate ramps with stud detail, expressive minifigs with real faces and hair pieces, a tilt-shift background and soft lighting; B shows plain flat-coloured orange ramps, simplified faceless figures, and loose ramp pieces scattered and floating around the plaza.
03: B | B is a dense, varied city with landmark towers, signed storefronts (QUILT, Video Planet), parks, a suspension bridge and a hot-air balloon under hazy light; A is a grid of near-identical repeated window towers spread over empty green lots, with blown-out sun glare.
04: B | B's brick-built windmill, red barn and farmhouse, hay bales, trucks on the road, deer and many minifigs fill a lush, coherent rural scene; A has a nice windmill and wheat/corn fields, but its simplified figures and bare baseplate city blocks behind make it look unfinished.
05: A | A is a busy, richly detailed street with ornate facades, signs (JOE'S, Hotel, Comedy), a bus, cars, cafe tables and a picnic in the park; B is a near-empty road with oversized flat studs in the foreground, plain repeated window-grid towers and one lone pedestrian.

## Unblinded result (`docs/judge-key-set7.json`)

| pair | ours is | picks | result |
|---|---|---|---|
| 01 house-golden | B | A ×3 | loss |
| 02 park-noon (skate) | B | A ×3 | loss |
| 03 skyline-golden | A | B ×3 | loss |
| 04 farm-golden | A | B ×3 | loss |
| 05 avenue-noon | B | A ×3 | loss |

**Result: 0/5 unanimous (0–15). Seventh consecutive 0/5 set.**

## What moved (reason shift, diagnostic only; see the audit §f–g)
- Every set-6 reason category for the targeted pairs disappeared: "bare stud field", "muddy fountain", "blank white
  wall", "few props", "ghostly / washed-out", "DOF mush".
- The new deciding reasons are craft at subject scale: the reference's built house (balusters, dormers, siding) against
  our box houses; brick-textured ramps and printed minifigs against our flat ramps and blank figures; loose debris
  (authored kickers and boards read as scattered pieces); bare baseplate lots in the background (4/5 pairs); readable
  signage (03/05); and the reference's subject-focused tilt-shift (01/02/05).
- Critic prediction ledger: 5/5 on reason class; missed "likeliest win" on 02.
