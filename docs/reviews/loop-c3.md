# LOOP cycle 3 — buildings: facade & silhouette variety (set-4 lever "flat untextured walls / near-identical box towers")

**Goal (set-4 judges):** all three judges in set 4 named the buildings — *"flat untextured walls"* (pair 04),
*"near-identical box towers"*, *"repetitive towers"* (pairs 03/05). This cycle adds a deterministic facade +
silhouette layer to the existing generators, merged into the existing per-chunk geometry (**no new material
types, no extra draws per building**; a few new per-chunk material buckets appear — module own draws 122 of
400 in the full game), and a `facade` showcase variant to inspect it.
**Acceptance:** `check-civics` still 38/38, `check-detail` still 38/38, module + game batches clean
(`errors: []`), buildings' own draws ≤ 400, game ≤ 1500 draws / gpuMs ≤ 20 / fps ≥ 50, same seed → same
geometry, all captures looked at.

## What was added (only `src/buildings/`)

| file | change |
|---|---|
| `src/buildings/generator.js` | The cycle-3 variety layer, all rng-driven from the per-building stream (`S.rng.fork(seed:id)`), all merged into the existing per-chunk-per-material buckets. New helpers: `roadFaces()` (2-cell road adjacency → which face is a street front), `pickFrame()`/`paletteLum()` (seeded mullion colour from the palette, filtered to contrast the wall), `facePlate`/`faceSlab`/`faceBoxAt` (per-face proud plates and tilted bevel slabs), `columnLayout` (shared column math), **`shopfrontFace()`**, **`balconyFace()`**, **`pierStrips()`**, **`quoinStrips()`**, **`roofClutter()`**, **`towerCrown()`**. `flatRoof`/`steppedRoof` now report deck/parapet/inner bounds via an `out` struct; `facade()` reuses `columnLayout`; `interiorLiner()` gained `baseLift`; `cornerBricks()` gained two coplanar-plane fixes (below); `generateBuilding` returns a per-building `features` counter object. |
| `src/buildings/showcase.js` | `stageFacade()` — ten buildings, one per kind/level (north row: house/shop/apartment/office/school fronting the street; south row: warehouse/plant/hospital/tower/tower-office), staged along one street with the real generators. Returns a `row` box the preset frames. |
| `src/buildings/index.js` | `facade` added to `showcaseVariants`, `buildings:facade` preset (street-canyon view from the west end of the staged row, `S.facadeRow` + `defaultPreset()` fallback), `stageFacade` wiring. Existing presets/variants and the closeup hero selection are untouched. |

### 1. Ground-floor treatment (`shop`, `office`, `tower-office`, street-facing `apartment`)
Seeded per face (`roadFaces` → street faces p=0.92/0.80, other faces p=0.40; apartment street-only).
Each treated face gets **wide glazed bays** (transBlue/transClear inside a frame ring, dark liner behind the
glass, mullion + lit overlay in front), one **recessed door** bay per face (jambs/header proud 0.115, leaf
0.05, leaf glazing 0.085, bevel stoop slab), a **canvas awning** (bright-palette bevel slab, tilted 19.5°,
+ valance skirt) over 1-3 bays and a **sign block** with a `signGlow` stripe under the floor band. Faces
without the treatment keep the old storefront glazing/curtain wall.

### 2. Balconies (`apartment`, some `shop`/`office` upper floors)
One or two seeded faces, seeded subset of upper floors: proud bevel slab (0.82 m deep, studded top) plus
**4 railing posts** + front/side rails per balcony. The slab tops out 2 cm *below* the storey line and the
railing tops out ~0.55 m above it — below the window pane's bottom edge (0.62 m) — so no balcony ever
covers a door or a pane (checked analytically and in the grazing captures).

### 3. Rooftop clutter (all styles)
`roofClutter()` places 0-4 seeded items per roof **inside the parapet** (positions clamped to
`innerHalfW/D`, 5 attempts, keep-out list of existing rooftop equipment + each other): AC/plant boxes
(+ dark top plate, studs), vent stacks (reusing `brickStack`), stair bulkheads (capped, studded, with a
door panel), small water tanks (cylinder + studded cap plate), antenna masts with a `beacon` tip. Studs on
every top. Civic halls (school/hospital/police/fire/power plant) get the same clutter with their existing
roof equipment as keep-outs; stepped house roofs place clutter on the top plate.

### 4. Tower crown + massing variety
Per-seed crown from `CROWN_STYLES` — **flat coping / stepped setback mass / central mast + beacon /
4 corner pylons / small pyramid** — plus a guaranteed aviation mast + beacon on every tower that drew
neither a mast crown nor a clutter mast. Residential and office towers get an **optional mid-shaft setback**
(residential: 50 % mid vs near-top, shrink 0.78-0.88; office: 60 % chance, split at 42-60 % up, shrink
0.90-0.95) with an accent band and a studded terrace on the exposed ledge. Window pitch is seeded
(1.25-1.6 residential tower, 1.35-1.75 office/commercial) and the mullion/frame colour is a seeded palette
pick (white / lightStoneGrey / tan / darkStoneGrey / black) that always contrasts the wall.

### 5. Facade rhythm
Per building: seeded trim colour and one of **pier strips** (vertical pilasters between the window columns,
0.06 proud so they run behind the window frames), **quoin strips** (vertical corner strips) or **continuous
course bands** (denser, trim-coloured) — on top of the existing floor bands/corner bricks.

### Coplanar-plane (z-fighting) work
Every new layer uses strictly increasing per-face offsets (documented in the generator's block comment) and
is embedded into the wall by (thickness − proud). A scratch exact coplanar co-facing triangle-overlap
detector (2D SAT per shared plane, in `Temp/opencode/c3/coplanar-node.mjs`) was run on the ten staged
buildings against the pre-change generator on the *same* building records: **6914 → 6716** coincident
co-facing overlapping triangle pairs. In the pre-change build the dominant class was the pre-existing
`cornerBricks` convention (brick end faces / top course flush with the wall faces); in the current build the
remaining hits are hidden inner faces (`proud − thickness` landing just inside a wall), bedded slab bottoms
at ground level and sub-5 cm² bevel slivers, none of which render two front faces at one depth. Two real
traps found and fixed:
1. an upper tower section's flipped interior-liner base was exactly coplanar with the lower section's
   exposed setback terrace (`interiorLiner(baseLift)` now lifts it 24 cm on upper sections), and
2. `cornerBricks` — the top course's top face landed exactly in the wall's top plane (z-fight on every
   roofline/setback ledge) and each brick's end face landed exactly in the wall's perpendicular face plane
   (speckle at grazing angles). The top course now stops 3 cm short and each brick is pulled 2 cm inside on
   its non-protruding axis.

## API / surface changes
- `generateBuilding()` return value gains `features` (per-building counters: `shopFaces`, `balconies`,
  `clutter`, `masts`, `crown`, `rhythm`, `setback`, `quoins`). Purely additive; the batcher ignores it. It
  exists so the variety census below is reproducible with a 5-line probe (the probe rebuilds the module's
  own stream with `ctx.rng.fork('buildings').fork(seed:id)`).
- `showcaseVariants` gains `facade`; new preset `buildings:facade`; `S.facadeRow` (module-private).
- No new material types, no per-building draw call, no events, no core/tools edits. `Math.random` absent
  from all three files (grep).

## Counts

**Buildings module's own draw calls (≤ 400 gate, `api.stats()`):** full game **122** (441 buildings);
showcase variants: default 91 (24 buildings), levels 43 (9), night 106 (35), facade 41 (10). Own triangles
3.40 M in the full game.

**Variety census, full game seed 1 (441 buildings, regenerated through the shipped generator):**

| feature | value |
|---|---|
| buildings with ≥1 shopfront face / faces total | 219 / **542** |
| buildings with balconies / balconies total | 143 / **347** |
| buildings with roof clutter / items total | 272 / **589** |
| beacon masts (crowns + clutter + fallback) | **86** |
| crowns | mast 35, pylons 26, parapet 18, setback 18, pyramid 13 (110 towers) |
| tower setbacks | mid-shaft 56, near-top 54 |
| facade rhythm | quoins 82, piers 79, courses 63 |

**Facade showcase (10 staged buildings, one per kind/level)** — `features` per building:
house `{quoins:4, clutter:1}`, shop `{shopFaces:2, clutter:1, rhythm:courses}`,
apartment `{shopFaces:1, balconies:1, clutter:1, rhythm:courses}`,
office `{shopFaces:3, clutter:0, rhythm:quoins}`, school `{clutter:2}`, warehouse `{clutter:0}`,
plant `{clutter:1}`, hospital `{clutter:1}`,
tower `{crown:setback, clutter:3, masts:2, setbackAt:mid, shrink:0.82}`,
tower-office `{shopFaces:2, crown:setback, clutter:0, masts:1, rhythm:courses, setback:0.9}`.

## Verification runs (all on the final build, `errors: []` everywhere)

| run | result | path |
|---|---|---|
| `node tools/check-civics.mjs` | **38/38** | `shots/civics/r2/summary.json` |
| `node tools/check-detail.mjs` | **38/38**, props unchanged (4339 props, 38 own draws in the yards scene) | `shots/props/c2/summary.json` |
| `node tools/check-beauty.mjs --out shots/beauty/c3` | **37/37** (L1 hero framing gates hold with the new buildings; closeup subject/geometry unchanged) | `shots/beauty/c3/summary.json` |
| `node tools/critic.mjs --module buildings --round 6 --dir shots/buildings/r6` | 16 shots, minFps **143**, maxGpuMs **6.76**, maxDrawCalls **371** (scene) | `shots/buildings/r6/summary.json` |
| `node tools/critic.mjs --module buildings --variant facade --dir shots/buildings/r6-facade` | 16 shots, minFps **143**, maxGpuMs **5.16**, maxDrawCalls **232** | `shots/buildings/r6-facade/summary.json` |
| `node tools/critic.mjs --game --round 43 --dir shots/game/r43` | 20 shots, minFps **92.9**, maxGpuMs **10.43**, maxDrawCalls **934** (r42: 93.1 / 10.41 / 921) | `shots/game/r43/summary.json` |
| hero `--preset closeup --tod 17.7 --hud 0` | 679 draws, 7.59 ms, errors 0 | `shots/buildings/c3/hero-closeup-17h7.png` |
| hero `--preset street --tod 21.5 --hud 0` | 829 draws, 10.01 ms, errors 0 | `shots/buildings/c3/hero-street-21h5.png` |
| hero `--preset aerial --tod 6.3 --hud 0` | 859 draws, 6.43 ms, errors 0 | `shots/buildings/c3/hero-aerial-6h3.png` |
| determinism: two fresh boots, same URL/preset/tod (facade showcase, day) | **meanAbs 0.0000**, maxDelta 1 | `shots/buildings/c3/det-diff.json` (a/b PNGs) |
| determinism, full-game generator census, two boots | hash **`82f1dcb3`** both, 441 buildings / 80348 stud points (probe) | scratch `Temp/opencode/c3/gameprobe.mjs` |
| geometry equivalence of the final refactor | `det-a` vs `det-c` **meanAbs 0.0000** | `shots/buildings/c3/det-diff-ac.json` |
| coplanar co-facing overlap detector (baseline vs current, same records) | 6914 → **6716** pairs; all > 0.05 m² hits classified hidden / pre-existing | scratch `Temp/opencode/c3/coplanar-node.mjs`, `detail-node.mjs` |

Boot: game `readyMs` 12507 ms (r43 overview-12) vs 13505 ms (r42) — no measurable regression; full-game
triangles 34.5 M vs 32.4 M (+6.5 %, triangle count is not budgeted). Regenerating all 441 buildings
synchronously costs 1.75-2.03 s in the probe (4.06 s in one run under external GPU load).
**Scope of the determinism claim (cycle-3 critic issue 4):** the `meanAbs 0.0000` / `0.0008` figures are
**facade-showcase, day** (same URL, preset and tod). A *full-game night single-shot* is not pixel-stable
across sessions (the critic measured 0.6377 meanAbs against a stored batch, differences concentrated in
emissive windows/bloom) — that is presentation (animated sky phase reset applies, TAA/bloom sampling does
not) plus the world's own post-boot settling, not geometry. Geometry determinism is covered separately by
the generator census hash above (identical on two boots).

## What I looked at (PNG, via the Read tool)

Final build: `shots/buildings/r6/buildings_default-12.png`, `buildings_default-21h5.png`,
`buildings_levels-12.png`, `shots/buildings/r6-facade/buildings_facade-12.png`, `buildings_facade-18.png`,
`buildings_facade-21h5.png`, `buildings_closeup-12.png`, `shots/game/r43/overview-12.png`,
`skyline-6h5.png`, `street-21h5.png`, `closeup-18.png`, `closeup-21h5.png`,
`shots/beauty/c3/01-skyline-golden.png`, plus the three heroes and the `shots/buildings/c3/graze*` grazing
captures (shopfront/corner z-fight checks at tod 12/9/16 and a 2 cm camera nudge). Pre-final (before the
three coincident-plane fixes, geometry otherwise identical): the
`shots/buildings/c3/inspect/*` per-kind front/ground-floor/3-4/crown captures for all ten staged buildings,
`shots/buildings/c3/dev-facade-*.png` framing iterations.
What the pictures show (claims only from images): shopfronts with frame-ring glazing, a recessed door with
a stoop and a valance awning reading at street level (shop/office/tower-office/apartment); balconies with
railing posts on apartment and shop upper floors; roof clutter (AC boxes, vent stacks, bulkheads, tanks,
antennas) inside parapets on residential/commercial/industrial/civic roofs; towers with visibly different
silhouettes (mid-shaft setback, crown boxes, masts with red beacons at night); lit shopfront glazing and
signGlow stripes at 21.5; no shimmer at grazing angles after the fixes.

## Known gaps / notes for the critic

1. **Civic facades are untouched** (only roof clutter was added) — the brief scoped ground-floor treatment
   to shop/office/tower-office/apartment.
2. **Some street faces still get the plain ground floor**: ~8 % of commercial street faces and 20 % of
   apartment street faces (seeded fraction; non-street faces 40 %); the office curtain-wall glass remains
   transClear/transBlue as before, so a few ground floors still read pale.
3. **Roof clutter can be 0**: 272/441 buildings have ≥1 item; level-1 industrial roofs are often 0 because
   the pre-existing tank/chimneys (keep-outs) fill the deck, and the tower-office's setback crown keep-out
   blocked its item in the facade stage. **0 roof-clutter containment violations** in the 441-building scan.
4. **Coplanar co-facing pairs** (exact-area pass, 10 staged buildings, >0.01 m²): baseline 1255 → cycle-3
   pre-fix 949 → **current 945**; ≥0.25 m²: pre-fix 51 → **current 48**. The remaining ≥0.25 m² pairs are
   26 down-facing surfaces (bedded bottoms at the ground plane, stacked-box undersides at the setback /
   crown planes) plus 22 inward-facing vertical faces 2 cm *inside* the wall (hidden behind the wall face) —
   none renders two front faces at one depth. The visible pre-existing class the critic isolated (flush
   house door leaf) is fixed (see the fix round). No shimmer was visible in the grazing captures.
5. Balconies are not added to level-3 residential towers (brief scope: apartment + shop upper floors).
6. The `facade` preset frames the row from the street axis at the west end; the east end of the row is
   small in frame — `closeup` (hero = tower-office) and `levels` cover the far end.
7. `features.masts` counts clutter masts plus the guaranteed fallback mast; it is a feature census, not a
   draw-call or triangle measure.
8. **Intended changes to pre-existing geometry/materials** (not just additive — cycle-3 critic issue 5):
   `interiorLiner` on upper tower sections (0.24 m base lift, invisible from outside); the top corner-brick
   course (−3 cm) and each corner brick's non-protruding axis (−2 cm); **industrial clerestory window pitch
   changed from a fixed 2.2 to a seeded 1.9-2.6**; **`pickFrame` recolours pre-existing window frames** on
   all residential/commercial buildings (seeded palette pick with a luminance-contrast filter, replacing the
   old fixed `black/darkStoneGrey` split); **old fixed rooftop greebles were removed and replaced** by
   `roofClutter` on apartment/office/shop/tower roofs (level-2 apartment brick stack + optional cylinder,
   level-2 office brick stack + cylinder, tower brick stack + cylinder + the `floorsN >= 12` mast); the
   level-1 shop's fixed awning + sign block was replaced by the shopfront band; and (fix round) the
   `faceSlab` axis swap, the five flush plates pulled 2 cm proud, and the `buildings:facade` fallback pose.

## Fix round (post-critic, `docs/reviews/loop-c3-critic.md` 4/10 FAIL — one new defect)

| # | critic issue | fix | evidence |
|---|---|---|---|
| 1 | **HIGH: `faceSlab` ignored the face axis** — awnings/stoops/balcony slabs on x-facing walls were built with their long axis out of the wall ("gangplank" planks); 492 parts / 172 buildings > 0.5 m outside the footprint | `faceSlab` now swaps the box dims for `axis === 'x'` exactly like `faceBoxAt` (quantised), tilt logic unchanged | containment scan (full game, seed 1, limit 0.5 m beyond the building's cell footprint): **492 → 0** (441 buildings, 164 930 parts); before/after crops: `Temp/opencode/c3v/shots/xside-office-b3.png` (critic's pre-fix plank) vs `shots/buildings/c3-fix/xside/office-b3-wall-low.png` and `tower-office-b9-gf-34.png` (awning + door + stoop lying along the wall over the glazing); batches `shots/buildings/r8`, `r8-facade`, `shots/game/r45` |
| 2 | **LOW: flush door leaves** (pre-existing class, front face exactly in the wall plane) | house door + porch light, industrial dock door, fire garage stripe, police desk stripe pulled 2 cm proud of the wall | exact-area pass: pre-fix b0 shows `2\|1 brightPink/darkStoneGrey 1.84 m²` (door + light), current shows none; ≥0.25 m² pairs 51 → 48, >0.01 m² 949 → 945; remaining classes in known-gap #4 |
| 3a | **LOW: determinism claim scope** | report now states the showcase/day scope and separates geometry determinism (census hash) from night presentation variance | known-gaps note above the fix round |
| 3b | **LOW: "everything else is additive"** | report now lists every intended non-additive change (clerestory pitch, `pickFrame` recolouring, replaced rooftop greebles, level-1 shop awning replacement + the fix-round items) | known-gaps #8 |
| 4 | **LOW: `buildings:facade` fell back to `buildings:default`**, duplicating a frame in default-variant batches | the fallback is now its own documented low 3/4 pose of whatever is staged (derived from `S.stageBounds`), distinct from `buildings:default` | `buildings:facade` vs `buildings:default` in the default variant: **meanAbs 34.26** (89.7 % px > 8) — two different frames, `shots/buildings/c3-fix/fallback-diff.json` |
| 5 | civic facades untouched | kept out of scope by orchestrator decision; the cycle-4 curated shot list re-stages the civic hero | — |

**Fix-round verification (final build, all `errors: []`):** `check-civics` **38/38**; `check-detail`
**38/38**; `critic --module buildings --round 8 --dir shots/buildings/r8` minFps **143.2**, maxGpuMs
**6.84**, maxDrawCalls **370**; `--variant facade --dir shots/buildings/r8-facade` minFps **143.6**,
maxGpuMs **6.83**, maxDrawCalls **232**; `critic --game --round 45` minFps **93.2**, maxGpuMs **10.31**,
maxDrawCalls **934** (r42: 93.1/10.41/921); `check-beauty --out shots/beauty/c3b` **37/37**; heroes re-captured
(`shots/buildings/c3/hero-{closeup-17h7,street-21h5,aerial-6h3}.png`, 679/829/859 draws, 7.63/10.0/6.71 ms);
two-boot facade-showcase day determinism **meanAbs 0.0000**; census hash `82f1dcb3`; buildings' own draws
**122** (full game). `diff r44 → r45` (pre-fix → post-fix full game) meanAbs **0.0803**, worst 0.3067
(closeup-6h5) — small and local, consistent with re-orienting a handful of x-face slabs.
**Looked at (fix round):** `shots/buildings/c3-fix/xside/office-b3-wall-low.png`,
`tower-office-b9-gf-34.png`, `tower-office-b9-wall-low.png`, `shots/buildings/c3-fix/fb-b/frame.png`
(new fallback pose), `shots/buildings/r8/buildings_default-12.png`,
`shots/buildings/r8-facade/buildings_facade-12.png`, `shots/game/r45/closeup-6h5.png`,
`shots/buildings/c3/hero-closeup-17h7.png` (re-captured), and the critic's pre-fix
`Temp/opencode/c3v/shots/xside-office-b3.png` for the before/after pair.
