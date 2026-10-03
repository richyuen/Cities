# loop-c6 recon: set-7 reasons → levers A–D (E1)

Read-only Explore pass at `428fc06`, 2026-10-02. Condensed by the orchestrator; the file:line citations are the recon's own.

## Mechanisms behind the set-7 reasons
- **01 "box houses":** the garden house is the level-1 `house` branch, `buildings/generator.js:676-717`, with a stepped pyramid roof (`steppedRoof :233-258`). There is no gable, porch, dormers or siding. Its look depends on the seed (`buildings/index.js:52,351`), and it levels up into an apartment within 3 game days (`simulation/model.js:499-513`, `buildings.enqueueLevelUps :116-124`).
- **"Blank figures":**
  - The face is 5 black `sp-box` instances (`props/spkinds.js:295-299`). Cap brims (y 1.565, reaching z 0.31; `:173`) hide the eyes from the skate hero pitch of 0.72 rad (`setpieces.js:24`): the brim hides everything above y ≈ 1.434, and the eyes sit at 1.47–1.53.
  - 13 of the ~22 skate figures wear caps. About 7 are authored facing away from the camera (`setpieces.js:122-160`).
  - Heads are 11–22 px on screen against 45–60 px in the reference.
- **"Flat orange ramps":** full-width glossy bands 0.04 m apart over the same orange (`spkinds.js:409-429, 449, 488-497, 529-532`).
- **"Loose debris" (02 audit pixel coordinates):**
  - kickers at `setpieces.js:117-118` (rot −0.35 and 2.6);
  - **a kicker coping bug**: the bar sits over the toe, floating 0.46 m above the paving (`spkinds.js:1153-1154`);
  - lone skateboards with a kicked tail (`setpieces.js:129,143,144`; `spkinds.js:342`);
  - off-grid rotations at `setpieces.js:96-100`.
- **Background lots (4/5 pairs):**
  - **(i) Zoning plates.** These are translucent glass InstancedMeshes, always on (`zoning/index.js:16-18, 279, 288-303`). Only data views hide them (`views/index.js:37,137`). `?hud=0` does not hide them (`ui/index.js:385-387`). The zone-tool state is tracked (`zoning/index.js:129-135`) but drives only the hover ghost.
  - **(ii) Zoned-but-unbuilt lots look like bare land.** Terrain colour ignores cell type (`terrain/data.js:24,138-176`). About 85% of road-facing residential lots are empty: the layout `fillChance` is 0.42–0.62 (`citygen.js:682-686`), and the warm-up never runs auto-growth (`demo/index.js:63-66`).
  - **(iii) Leftover 'none' land** in the set-piece blocks (`citygen.js:644-659`).
  - 05's near-right stud field is zoned-empty r cells of tower block (2,1).

## Levers (honest product changes only; capture-only tricks are excluded by acceptance (a))
- **A1 (zoning):** draw plates only while a `zone:*` tool is active, plus `?zones=always` and the showcase. The minimap and hover ghost keep showing zones. Visibility = !viewHidden && (always || toolActive). −3 draws, no census change. **Product change: owner decision.**
- **A2 (terrain, optional):** a sparse-stud "tiled lawn" on unbuilt land through `uStudMask` (`terrain/index.js:50-54,193-199`, `terrain/studs.js:~101-120`, `terrain/shaders.js:36-72`). Needs an integer-coordinate keep rule shared by CPU and GPU, and `?lawn=0` for A/B. It changes every ground pixel and needs an ARCHITECTURE §7:183 amendment. **Product art change: owner decision.**
- **A3 (demo, spOn only):** stamp the leftover set-piece block land as park (`setParkRect citygen.js:274-284`). Hazards: park re-clustering moves the plaza fountain; nearPark happiness; closeup invariance.
- **A4 (demo):** camera-independent radius infill (critic W4 follow-up), replacing the frustum-gated `infillFrames` (`demo/setpieces.js:315-372`).
- **A5 (warm-up growth):** breaks the nosp census gate. Not this cycle.
- **B (props): minifigs.**
  - (1) 0-draw fixes: smaller, raised brims; backward caps on skaters; hair or helmets; bigger features; figures and heads facing the hero camera; torso panels.
  - (2) An `sp-print` atlas role (+1 draw): a path-drawn CanvasTexture atlas (no `fillText`), with a per-instance `aTile` attribute following the transit route-letter pattern (`transit/models.js:80-134`).
  - (3) Scale is a composition lever.
- **C (props): skate tidy-up.**
  - Fix the kicker coping.
  - Snap furniture to the deck grid.
  - Use kickers as launch pads; rack or remove the lone boards.
  - Tile the slopes in two orange shades plus checker over a darker underlay, and add stud grids on the bank top and quarter deck. About +100 instances, 0 draws.
- **D (buildings): house craft.**
  - New vocabulary: gable roof with tile courses and trim, dormers, a +z porch (deck, posts, balusters, roof, steps) inside the 8 m cell (shrink body depth by about 1.2 m), clapboard siding courses, window surrounds, shutters and flower boxes, and no roof clutter on houses.
  - A `b.style:'hero'` / landmark record flag that forces the full look and skips level-ups.
  - Ordinary level-1 houses get seeded subsets of the vocabulary, so it is honest content.
  - Cost: about 3–5k tris per house and ≤ +16 scene draws. Census unchanged.

## Plan (sequential, one module folder each)
zoning (A1, if approved) → props (B+C) → buildings (D) → demo (hero flag on the garden house, A3, optional A4; re-verify seeds 1/2/23 and closeup invariance) → terrain (A2, optional, if approved).
Orchestrator: `tools/check-background.mjs` (critic's 64×36 classifier + plate-ray count; plates 0 with no tool, > 0 with `zone:r`), a check-detail hero-flag check, `?zones`/`?lawn` A/B against c5o-nosp, ARCHITECTURE §7 notes, a possible 05 reframe in the shot list, and set 8 on a new seed.
Expected: 02 strongest (all three set-7 reasons targeted; the reference's tilt-shift remains); 01/04 narrow; 03 partial; 05 no change without A2 or a reframe.
Hard constraint: `?nosp=1` census stays e0f35033.
