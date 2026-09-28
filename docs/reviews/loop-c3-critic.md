# LOOP cycle 3 — critic review: buildings facade/silhouette variety

**Cycle:** 3 (buildings facade/silhouette variety; set-4 lever "flat untextured walls / near-identical box towers").
**Build under review:** working tree on top of `867b30d` (`src/buildings/{generator,index,showcase}.js`, uncommitted).
**Critic:** independent, fresh; own runs on the live tree, one browser at a time, all scratch under
`C:\Users\ryuen\AppData\Local\Temp\opencode\c3v\`.

## Score: **4 / 10** — **FAIL**

All of the builder's *stated gates* pass (checks, budgets, errors, day determinism), and the intended
facade variety is visibly there on the faces the generator treats correctly. The cycle fails the goal
clause "**without new defects**": a helper bug (`faceSlab` never swaps w/d for `axis === 'x'` walls)
ships awnings/stoops/balcony slabs rotated 90° on every x-facing wall — in the full game seed-1 city
**492 parts from 172 of 441 buildings (39 %) stick more than 0.5 m outside their footprint**, visible as
tilted "gangplank" awnings (confirmed in `xside-office-b3.png`, `xside-tower-office-b9.png`). On top of
that, the lever the losing blind pair 04 actually named (civic "flat blank walls") is explicitly out of
scope, so the cycle's expected blind-metric impact is limited to pair 03.

## Measured table (own runs)

| item | claim (builder) | my measurement | verdict |
|---|---|---|---|
| `check-civics.mjs` | 38/38 | **38/38**, browser captures errors 0 | pass |
| `check-detail.mjs` | 38/38, props unchanged | **38/38**; props 4339, C2 1439, own draws 61; pre-C2 hash stable | pass |
| `check-beauty.mjs --out shots/beauty/c3v` | 37/37 | **37/37** (skyline d 389 m/elev 7.3°, overview 576/24.7°, aerial 817/21.3°, 333 water cells, closeup hospital fit 0.51 unoccluded, street eye 2.8 m) | pass |
| module r7 (16 shots) | — | minFps **143.7**, maxGpuMs **6.91**, maxDrawCalls **371**, errors **0** | pass |
| module r7-facade (16) | — | minFps **143.2**, maxGpuMs **6.84**, maxDrawCalls **232**, errors **0** | pass |
| module own draws | 122 full game / 91 default / 41 facade / ≤400 | **122** full game, **41** facade showcase (probe) | pass |
| game r44 (20 shots) | (r43: 92.9 / 10.43 / 934) | minFps **93.2**, maxGpuMs **10.29**, maxDrawCalls **934**, errors **0**; r42: 93.1/10.41/921 | pass |
| r44 vs r43 diff | drift-level if frozen revision | meanAbs **0.1214**, worst overview-21h5 **0.3871** (3.76 % px > 8); r42 vs r44 meanAbs **5.8367**, worst closeup-18 8.37 (14.2 %) → r44 is the same build class as r43 (batch stats also match r43's exactly), cycle change visible | pass w/ caveat |
| geometry census, full game seed 1 | hash `82f1dcb3`, 441 b / 80348 studs | **`82f1dcb3` on two fresh boots**, 441 / 80348 | pass |
| two-boot pixel determinism (facade showcase, day) | meanAbs 0.0000 / maxDelta 1 | my own two boots: **meanAbs 0.0008, maxDelta 1, 0 % > 8** | pass |
| full-game fresh-boot vs r44 night (same HUD state) | implied deterministic | meanAbs **0.6377**, 0.66 % px > 16 | caveat (see issue 4) |
| coplanar co-facing detector (10 staged bldgs, same records) | 6914 → 6716 pairs | reproduced exactly: baseline **6914**, current **6716**; exact-area > 1 cm²: 1255 → 949; 51 pairs ≥ 0.25 m² remain | partially refuted (issue 3) |
| containment: parts > 0.5 m outside footprint, full game | not claimed | **492 parts / 172 buildings**: office 220, apartment 272; by material awnings 172, lightStoneGrey 320 (stoops/balconies); roof-clutter violations **0** | **FAIL (issue 1)** |
| `Math.random` in `src/buildings/` | absent | absent (grep; only a comment) | pass |
| demo boot readyMs | 12507 (r43) vs 13505 (r42) | r42 13505, r43 12484, **r44 19459**; my single-shot full-game boots 19193/19459; facade showcase boot 3210. Machine had 28–44 % GPU load from other processes | inconclusive (load-confounded) |
| building generation probe (`gameprobe`) | 1.75–2.03 s for 441 bldgs | my run of the same probe: **genMs 3389 ms** (census hash + counts correct); measured while the machine was under external load | inconclusive (load-confounded) |

## Falsification table

| # | what I did | what I saw | verdict |
|---|---|---|---|
| a | Re-ran the builder's SAT detector (current + baseline) and added an exact triangle-intersection-area classifier + histograms; 10 grazing/nudge capture pairs (5 bldgs × 2 angles, 0.03 m nudge); read PNGs | Numbers reproduce exactly. Remaining X/Z-plane pairs are band **inner** faces embedded 2 cm inside walls and foundation/roof bottoms (invisible); the largest Y pairs are down-facing base/ledge bottoms. One **visible** coplanar class remains: flush house doors (door leaf front face exactly in the wall plane, ~0.89 m² per door) — pre-existing, present in the baseline. No shimmer/patch bands visible on any new layer at grazing angles or in the A/B nudges | new layers **survive**; known-gaps #4 classification **refuted** (not all remaining hits are hidden or < 5 cm²) |
| b | Full-game part-AABB containment scan (441 bldgs, regenerated with the shipped stream), 10 staged buildings analysed part-by-part, roof/x-side/close crops read; identified offending parts by material + 900-vert bevel signature | Awnings, stoops and balcony slabs on **x-facing walls are rotated 90°** (helper builds `bevelBox(w,h,d)` without the `faceBoxAt` axis swap): b3 office awning pokes **3.22 m** past the west footprint edge, b9 tower-office lime awning **4.14 m** (and tilts down to ~1.8 m above the pavement across the entrance bay). Full game: 492 parts, 172/441 buildings. Roof clutter: **0** containment violations; roof-clutter/crown parts sit on decks with studs aligned | **REFUTED** for x-faces; roof clutter + z-face layers attached |
| c | Two fresh boots of the facade showcase (day) diffed myself; census regenerated on two fresh full-game boots; grep for `Math.random` | meanAbs 0.0008 / maxDelta 1 (0 % > 8); census hash `82f1dcb3` both boots; no `Math.random` in `src/buildings/` | **survives** (day/showcase); night full game is only ~0.6 meanAbs reproducible across sessions |
| d | Front crops of shop/apartment/office/tower-office (z-faces), x-side crops, night crops | On z-faces: awning sits above the glazing, door bay recessed with stoop, no pane covered. On x-faces: the misplaced awning slab slopes across the shopfront glazing/entrance bay (b9) — geometrically outside the wall but occupying the doorway volume in the view | z-faces **survive**; x-faces **refuted** (and the "awning over a seeded run of bays" intent is wrong there) |
| e | `check-civics` (38/38) + baseline-vs-current part-stream audit on the staged civics | school: prefix **identical**, only +4 clutter parts appended; hospital: prefix identical, +3 parts. Hospital/school closeups look intact (cross sign, canopy, framing, figures); police/fire not in the staged row but their generators only gained `roofClutter` calls | **survives** |
| f | `check-detail` (38/38), `check-beauty` (37/37), read closeup/street heroes (builder + r44 + r7-facade) | Closeup hero frames the hospital (fit 0.51, unoccluded, near corner in frame, sun-side); street eye 2.8 m; figures/props present; no new prop overlap seen. Caveat: no analytic prop-vs-awning AABB test exists; the x-face awnings cross sidewalk volume (b9) where props/streets live | checks **survive**; new overhang-vs-street risk flagged (issue 1) |
| g | Night crops: `night-shop-b1`, `night-tower-b8`, `r7-facade/buildings_facade-21h5`, builder `hero-street-21h5`, `r44/street-21h5`, heatmaps | signGlow stripe reads bright but not blown; lit bays warm/cool with readable mullions and soft halo; no noise/banding. Beacons visible only as small red specks in wide/aerial views (not isolated in a close crop) | **survives** with the beacon caveat |

## RANKED ISSUES

1. **[HIGH — new defect, must fix] `faceSlab` ignores the face axis: awnings, stoops and balcony slabs are rotated 90° on x-facing walls.**
   *What/where:* `src/buildings/generator.js` `faceSlab()` (~line 415) builds `bevelBox(w, h, d)` with `w` always along X and `d` along Z; `faceBoxAt()` (used for plates/rails) correctly swaps for `axis === 'x'`, `faceSlab` does not. Callers (`shopfrontFace` stoop + awning, `balconyFace` slab) all pass `w` = tangent, `d` = normal, so every x-face slab points its long axis out of the wall.
   *Why it matters:* visible as a tilted plank ramping out of the facade (b3 office: pink slab 3.22 m past the west footprint edge; b9 tower-office: lime slab 4.14 m, crossing the shopfront bays at ~1.8–5 m height). Full game seed 1: **492 parts > 0.5 m outside footprint on 172/441 buildings (39 %)** (office 220 + apartment 272 parts; 172 awning-coloured parts + 320 lightStoneGrey stoop/balcony parts). Also skews the blind-set risk: such a plank is exactly the kind of artefact a judge reads as "broken/unpolished".
   *Fix:* in `faceSlab`, build `bevelBox(face.axis === 'x' ? d : w, h, face.axis === 'x' ? w : d)` (quantise the swapped values); keep the existing `rotateZ/rotateX` tilt logic. Then re-run the two x-side crops (they must show the awning lying along the wall), the containment scan (expect 0 parts > 0.5 m), the r7/r7-facade batches and one game batch.

2. **[MEDIUM — loop-metric scope] Civic facades untouched; blind pair 04's complaint ("flat blank walls", "plain white slab hospital") is not addressed.**
   *Where:* `generateSchool`/`generateHospital`/`generatePoliceStation`/`generateFireDepartment` gained only `roofClutter`. The closeup hero (and set-5 pair 04) is the hospital, whose large white surfaces still read flat in `hero-closeup-17h7.png` / `r44/closeup-18.png`.
   *Why it matters:* the cycle's headline lever is facade detail, but the judged close-up hero is a civic; pair 03 (street-night) is the only pair this cycle plausibly touches.
   *Fix (next cycle):* extend the ground-floor/window-band treatment to civic kinds (glazed bays + canopy already partly exist — add framed windows, course rhythm, sign banding and entrance detail), and/or re-stage the closeup hero in cycle 4's curated shot list.

3. **[LOW — pre-existing, report accuracy] The remaining coplanar pairs are not all "hidden / bedded / sub-5 cm²".**
   *What:* exact-area pass over the same 10 staged buildings: 51 pairs ≥ 0.25 m²; the visible class is the pre-existing flush house door leaf (door front face exactly coplanar with the wall, ~0.89 m² per door, also in the baseline). X/Z-plane pairs are indeed hidden band inner faces 2 cm inside the wall; large Y pairs are down-facing base/ledge bottoms.
   *Why:* known-gaps #4 misclassifies the remainder; at close range a flush door is a real (pre-existing) z-fight candidate.
   *Fix:* pull house/shop door leaves 1–2 cm proud (or 2 cm into the wall) like the new shopfront doors; correct gap #4 wording.

4. **[LOW — evidence hygiene] Full-game/night captures are not pixel-reproducible across sessions; the "meanAbs 0.0000" claim is showcase-day only.**
   *What:* my two-boot facade-day diff is 0.0008 (maxDelta 1) — the claim reproduces there. But a fresh single-shot full-game boot vs `r44/overview-21h5` (same HUD state, same URL parameters) gives meanAbs 0.6377 (0.66 % px > 16), larger than the same-batch r43→r44 worst (0.3871). Differences are concentrated in emissive windows/bloom.
   *Fix:* state the determinism claim with its scope (showcase/day) or add a night tolerance; the r43→r44 "drift-level" statement is still safe because the same-batch diff (0.12 meanAbs) and the r42→r44 change (5.84) bracket it, and the r44 batch stats reproduce r43's numbers.

5. **[LOW — report accuracy] "Everything else is additive" is inaccurate.**
   *What:* industrial clerestory pitch changed from fixed 2.2 to seeded 1.9–2.6 (b5 warehouse first differs at part 10); `pickFrame` changes pre-existing window-frame colours on all residential/commercial; old rooftop greebles were removed and replaced. Beyond the three changes listed in known-gaps #8.
   *Fix:* list these as intended changes in the report.

6. **[LOW — tooling note] `buildings:facade` silently falls back to `buildings:default` in the default variant.**
   *What:* the r7 default-variant batch captured `buildings_facade-12` identical to `buildings_default-12` (my pixel diff: meanAbs 0.0001 / max 1), because `S.facadeRow` is null outside the facade variant (same fallback for every tod by construction). Documented fallback, but it wastes one of the four presets in every default-variant critic batch and could be mistaken for a real pose.
   *Fix:* either return a distinct default for `variant !== 'facade'` or note in the batch that the two files are the same frame.

## What works (verified, not repeated from the report)

- The intended face treatment reads well where the axis is right: glazed shopfront bays with frame rings, recessed door + stoop, tilted canvas awning + valance, sign board with a glow stripe, all attached (front-shop/apartment crops).
- Roof clutter and crowns are genuinely attached and contained: AC/vent/tank/bulkhead/mast parts sit on decks with studs; **0** roof containment violations in 441 buildings; the tower tableau shows visibly different crowns (setback boxes, masts, pylons, pyramids) at `r7-facade`/`r44 overview`/`01-skyline-golden`.
- Budgets/errors: all batches `errors: []`; game 93.2 fps / 10.29 gpuMs / 934 draws; module own draws 122 (full game) and 41 (facade) — well under 400; no `Math.random`.
- Civics and props are not regressed: `check-civics` 38/38, `check-detail` 38/38, civic part streams prefix-identical + clutter only, props census stable.
- Day/showcase determinism: two fresh boots identical to meanAbs 0.0008; census hash `82f1dcb3` on two boots; my own diff of the builder's det-a/b/c PNGs meanAbs 0 / maxDelta 1 (they are byte-different files but pixel-equivalent).

## What I did NOT verify

- No analytic prop/street-furniture vs awning/balcony intersection test (props API exposes no positions); the x-face overhang crossing sidewalk volume is inferred from geometry + the b9 crop.
- Only seed 1 was sampled; other seeds and other city layouts were not scanned for the x-face bug or containment (the code path is seed-independent, so the class is; the counts are not).
- Beacon/night blowout was not isolated in a dedicated close crop; beacons appear as small red specks in wide shots (I did not verify their bloom at close range).
- The readyMs regression question is unresolved: my r44 boot is 19.5 s vs r43 12.5 s, but my single-shot boots are also ~19.3 s under 28–44 % external GPU load, so the delta cannot be attributed to the build; `gpuMs` (the perf truth) is unchanged/within budget.
- I did not inspect `shots/buildings/c3/det-diff*.png` (no such PNGs exist — only JSON), the pre-final `graze*`/`inspect/*` images, or every r7/r44 frame; I read the ones referenced in this review.
- I did not run the blind set / E4 judging (not my role) and did not re-derive the builder's full-game `features` census counts (only the geometry hash and own draws).

## Evidence paths

- Checks: `docs/reviews/loop-c3-critic.md`; summaries at `shots/civics/r2/summary.json`, `shots/props/c2/summary.json`, `shots/beauty/c3v/summary.json`; module batches `shots/buildings/r7/summary.json`, `shots/buildings/r7-facade/summary.json`; game `shots/game/r44/summary.json`.
- Diffs: `Temp/opencode/c3v/diff-r43-r44.json`, `diff-r42-r44.json`, `heat-overview21-r43r44.png`, `heat-night-myshot-r44.png`.
- My crops (facade showcase, day/night/graze/roof/x-side): `Temp/opencode/c3v/shots/` (notably `xside-office-b3.png`, `xside-tower-office-b9.png`, `front-shop-b1.png`, `front-apartment-b2.png`, `door-house.png`, `roof-tower-b8.png`, `night-shop-b1.png`, `graze-*-a/-b.png`, `crops-report.json`).
- Analytic: `Temp/opencode/c3v/fullcheck.json` (containment + census + own draws), `coplanar-hist.mjs` output, `civicaudit.mjs` output, `det-a/same.json` + `det-b/same.json` (my two-boot run), `night-boot-hud/overview-21h5.png`.
