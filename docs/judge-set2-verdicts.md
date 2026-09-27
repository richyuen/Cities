# Blind judge set 2 — raw verdicts (Wave B4)

Local-only artifacts (gitignored): `judge/set2/pair-*-{A,B}.png` (10 PNGs), `judge/ours-b4/*.png` (our five hero
shots), `docs/judge-key-set2.json` (the key). This file is the committed record of the protocol and verdicts.

Protocol: `node tools/pairs.mjs --ours judge/ours-b4 --theirs docs/reference --out judge/set2 --seed 11` (5 pairs,
A/B shuffled with the seed). Three independent judge subagents were given only the ten PNG paths and a one-line
rubric (better store-page screenshot: composition, atmosphere, visual interest, living-city read, production
quality), with instructions not to open any other repo file. They returned in parallel, same session.

## Judge 1

| pair | pick | conf | reason |
|---|---|---|---|
| 01 | A | 5 | Polished close-up diorama of the red-roofed house with tilt-shift bokeh and layered garden/city background vs. a mostly empty grassy plain with a tiny distant skyline. |
| 02 | A | 5 | Bustling skate-park scene full of minifigures mid-action, ramps and plants, with clean lighting and no HUD vs. a distant overhead map view where buildings are tiny and detail is lost. |
| 03 | A | 4 | Vibrant, densely detailed neighborhood with hot-air balloon, parks and varied rooflines beats a dark night street where blank asphalt fills most of the frame. |
| 04 | B | 4 | Colorful farm/windmill diorama with corn fields, trucks, houses and animals vs. an awkward clipped building-facade close-up that reads as a camera clipping bug. |
| 05 | A | 5 | Rich street scene with signage (Joe's, hotel), pedestrians, vehicles, trees and a picnic green — far more "living city" than a flat zoomed-out zoning grid at dawn. |

## Judge 2

| pair | pick | conf | reason |
|---|---|---|---|
| 01 | A | 5 | Detailed miniature cottage as a clear hero subject with warm light and blur-pleasing depth; B is UI-heavy and mostly empty green field with a tiny distant skyline. |
| 02 | A | 5 | Lively skate-park scene full of minifigures, props and color; B is a flat, UI-framed aerial over untextured plains with little visual interest. |
| 03 | A | 5 | Dense, colorful downtown with hot-air balloon, signage and varied architecture selling a bustling living city; B is a dark near-empty street where asphalt dominates. |
| 04 | B | 4 | Windmill/cornfield shot tells a story with farms, trucks and dozens of figures; A is an awkwardly cropped building facade with UI chrome. |
| 05 | A | 5 | Street-level shop row with hotel signs, pedestrians, traffic and picnic detail feels alive; B is a washed-out zoomed-out grid at dawn with sparse tiny blocks. |

## Judge 3

| pair | pick | conf | reason |
|---|---|---|---|
| 01 | A | 5 | Rich close-up diorama of a brick house with warm sunset light, garden detail and a populated skyline; B is a sparse, mostly empty zoned field with distant blobs and heavy UI. |
| 02 | A | 5 | Charming skatepark scene full of posed figures, ramps and plants at an appealing angle; B is a flat grey map overview where buildings read as unreadable specks. |
| 03 | A | 4 | Vibrant sunlit cityscape packed with distinct buildings, playground, hot-air balloon and bridge; B is a dark street-level night shot dominated by empty asphalt. |
| 04 | B | 5 | Warm, busy farm vignette (windmill, corn rows, vehicles, pedestrians) with strong depth and colour; A is an awkward near-wall facade crop that shows almost nothing. |
| 05 | A | 5 | Lively street scene with shop signs, traffic, pedestrians and a park picnic; B is a monotone top-down zone grid with no focal point or atmosphere. |

## Unblinding (`docs/judge-key-set2.json`, seed 11)

| pair | A | B | judges' pick | outcome |
|---|---|---|---|---|
| 01 | theirs | ours | A ×3 | loss |
| 02 | theirs | ours | A ×3 | loss |
| 03 | theirs | ours | A ×3 | loss |
| 04 | ours | theirs | B ×3 | loss |
| 05 | theirs | ours | A ×3 | loss |

**Result: 0/5 unanimous, 0–15 overall — identical to set 1.** Every pick carried confidence 4–5; the reasons are
consistent with the images (verified against both sides after unblinding). The loss themes: our presets do not
crop to a subject, our shots carry the full HUD, and our close-range micro-detail is sparse vs the reference
dioramas. See `docs/reviews/game-r22.md` for the per-pair lever list.
