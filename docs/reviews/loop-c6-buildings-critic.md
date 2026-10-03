# loop-c6-critic-buildings
verdict: **FIX** (two small orchestrator items; nothing blocking for the buildings builder)   score: **7.5/10** (house craft, CRITIC_BRIEF scale)

The house work holds up: every gate is green, and all but two of the builder's claims reproduce (the two-storey and dormer rates, which change nothing). The FIX is for the capture-order change: it exposes the boot overlay in single-shot captures (1 of 8 cold loads, and `check-atmosphere`'s first PNG).

Tree integrity: `git status --porcelain` is identical before and after (3 modified `src/buildings` files + `docs/core-requests/buildings-c6.md`). My outputs are under `shots/buildings/c6crit*`, `shots/game/c6bcrit*`, `shots/beauty/c6bcrit`, plus the dirs the check tools always write. Driver scripts are in the session scratchpad. One of my drivers hung on `browser.close()` and exited on its own; its captures were complete.
Orchestrator integrity check (LOOP §8): tree state and diff hashes were identical before and after this run, so the review is valid.

## Gates
| gate | measured | command / output |
|---|---|---|
| errors | `[]` in every capture (2 game batches, nosp batch, showcase batch, all drivers) | `shots/game/c6bcrit`, `c6bcrit2`, `c6bcrit-nosp`, `shots/buildings/c6crit-houses` |
| gpuMs ≤ 20 | default batch max 7.34 (repeat 7.31); nosp 6.88 | `node tools/critic.mjs --game --dir shots/game/c6bcrit` |
| draws ≤ 1500 | 823 max (c6h3: 818); nosp 750 | same |
| fps ≥ 50 | min 131.2; nosp 141.9 | same |
| drift vs baseline | c6h3 vs c6bcrit mean 0.0281, worst closeup-18 0.1298, 0/20 over 0.30 | `tools/diff.mjs`, `shots/game/c6bcrit-cap/diff-c6h3__c6bcrit.json` |
| nosp regression | c6b0-nosp vs c6bcrit-nosp mean 0.0052; only closeup-21h5 (0.0744) above 0.02 | `diff-c6b0nosp__c6bcritnosp.json` |
| check-civics | 38/38 | `node tools/check-civics.mjs` |
| check-beauty | 37/37 | `--out shots/beauty/c6bcrit` |
| check-detail | 41/41, nosp census e0f35033 | `node tools/check-detail.mjs` |
| check-background | 4/4 (0 plate rays idle, 250 with zone:r) | `node tools/check-background.mjs` |
| check-atmosphere | 22/22, but its first PNG shows the boot overlay (issue 1) | `shots/atmosphere/b3/sky-noon.png` |
| Math.random | only the two whitelisted menu files | grep |
| owner scope | 3 files, all `src/buildings` | `git diff --stat 32af8d6` |

## Claims
**(A) buildings builder**

| claim | reproduced? | my number | evidence |
|---|---|---|---|
| Non-house buildings bit-identical to HEAD | yes | 441/441 hashes equal (position+normal+uv+material+studs+height) on default and `?nosp=1`; only the 26 houses differ | `hash.mjs`: HEAD generator served by request interception (2 hits per load) |
| plainBox cached clone is safe | yes | 0 shared attribute arrays within a house; after `applyMatrix4` and overwriting normals/uvs on every part, a regenerate hashes identical | `sweep.mjs` alias probe |
| Footprint: 0 parts > 0.5 m outside the cell | yes, stricter | houses: 0 parts outside the cell at all (max excess 0.000 m) over 1000 ordinary + 1000 landmark seeds; city max 0.4 m (hospitals, pre-existing) | `sweep.mjs`, `hash.mjs` |
| Subset rates over 500 seeds | partly | porch 63.6%, ridge-x 63.6%, siding 68.4%, shutters 57.4%, boxes 50.0% match. **Two-storey 32.6% (claimed 41%), dormers 29.4% (claimed 33%)**: not reproduced; 1000 seeds give 33.0% / 27.6%. My sweep ids differ from the builder's, but `chance(0.35)` cannot average 41% | `sweep.mjs` |
| Landmark forces full vocabulary | yes | 1000/1000: 2 storeys, 4 posts, 2 dormers, siding, shutters, boxes, gable windows | same |
| ~9.4k tris per house, landmark ~14k | yes | ordinary mean 9,028 (min 4,716, max 13,752); the demo's 26 average 9,360 (HEAD 3,922); landmark mean 13,940 | same |
| Level-up skip | yes | flagged garden house level 1 after 3.75 game days at x30; all 25 infill houses were level-2 apartments by day 1.25. The sim did list the landmark as a growth candidate once (as the builder's item 5 says) | `levelup.mjs`, `shots/buildings/c6crit/levelup-garden-after.png` |
| Save/load keeps the flag | yes | `landmark: true` in the serialized record and after `applySave`; still level 1 after 1.25 more days | same |
| Draws 818 → 823 | yes | 823 batch max; at the 01 camera 618 vs HEAD 611 (+7) | batch, `perf.mjs` |
| Close-up gpuMs rises to 7.5–8.5 | not reproduced as a house cost | at 9 m: HEAD 6.79, unflagged 6.84, flagged 6.83 (medians of 11). One session stepped to 7.7–7.85 for both unflagged and flagged, so it is session state, not the house. Night 9 m: HEAD 8.03, unflagged 8.04, flagged 8.20. 01 camera: 6.6–7.0 in all three | `perf.mjs`, `perf2.mjs` |
| `colors` field | harmless here | 618 draws with and without `{sandGreen, darkRed}`; unknown names ignored (50 seeds, no errors). A palette name not already in that chunk would add a merge bucket, so keep to names in use | `garden-01-flag-colors-17h7.png` |
| Showcase `houses` + presets | yes | 8 captures, errors 0, max 257 draws, max 4.76 ms | `shots/buildings/c6crit-houses` |

I also staged 400 level-1 houses in the showcase: 14.5–16.9 M tris against 7.0–9.0 M with the HEAD generator, generation 1,691 vs 986 ms. gpuMs was bimodal in both builds (3.5–6.7), so I found no budget problem and no proof of none.

**(B) orchestrator capture order**

| claim / question | result | my number | evidence |
|---|---|---|---|
| Held screenshot is the held frame | yes | screenshot vs in-page `toDataURL` of the same frame: meanAbs 0, maxDelta 0 on 4 frames, including a one-frame camera switch; a second screenshot 1.5 s into the hold is identical; frame counter does not advance (`preserveDrawingBuffer: true`) | `shots/game/c6bcrit-cap/held`, `readback`, `held2` |
| Night skyline identical across loads and with `--sample 3000` (0.0000) | **partly** | 7 cold loads vs the first: five at meanAbs 0 (maxDelta 0–1, so not strictly identical), one at 0.0105 (544 px on roads), **one at 3.9443** with the boot overlay ghosted over the frame. All at frame 51 | `c6bcrit-cap/load-a..h` |
| Batch repeat 0.0047 | yes | c6h3 vs c6h4 recomputed 0.0047; my own repeat 0.0057, worst closeup-21h5 0.0746 | `diff-c6bcrit__c6bcrit2.json` |
| `frames(100)` is enough at low fps | yes, just | CPU-throttled to 49 fps, 3 s hold: `stats.fps` still 18.4 at 89 frames after release, 49.1 at 100 | `captureB.mjs` step 5 |
| Stats bias vs the old order | none found | old vs new order, 4 reps × 3 shots: gpuMs medians 6.94/6.95, 6.83/6.83, 7.11/7.11; fps within 0.5; draws equal | step 4 |
| `app.frozen` in the shipped game | tooling only | sole writers are `__city.holdAfter/release` in `src/core/debug.js` | grep |
| Throw mid-hold | **leaves the page frozen** | while frozen, `frames(1)` and `holdAfter(1)` never resolve (3 s race: HUNG); `capture()` has no try/finally | step 3 |
| Tools that call `capture()` repeatedly | work | critic.mjs, check-civics/beauty/detail/background/atmosphere all ran green | gates |
| Screenshots outside `capture()` | still free-running | check-atmosphere:51 (clip stats), check-stats ×5, check-transit ×4, check-views ×5. None are diffed | grep |
| Traffic is the only residual diff | consistent, not proven | every residual I located is on roads: closeup-21h5 at x35–380, y437–1023 (left street and signal); c6h3→c6bcrit closeup-18 is one cell at the left frame edge; skyline-12 211 px along roads | `grid.mjs` |

## Ranked issues
1. **Boot overlay captured by the new order (orchestrator).**
   - Where: `load-c/skyline.png` shows ghost "Brickport / Ready! / 100%" text and a darkened frame. `shots/atmosphere/b3/sky-noon.png` (frame 82) shows the same ghost. `settle5/skyline.png` (frame 11) is the full overlay; settle 20 is clean.
   - Why: `bootScreen.ready()` waits 260 ms then fades for 450 ms. The old order's 1 s sample hid this; the new order screenshots 45 frames after ready.
   - Impact: any single-shot `tools/shot.mjs` capture, and the first capture of a tool without a warm-up, can carry the overlay. Batches with a 90–120 frame warm-up (critic.mjs, shot-list, check-detail, check-beauty) showed none, so c6h3 and the set captures are unaffected.
   - Fix: in `openApp`, wait until the boot element is gone before returning; then correct the LOOP §7 "identical across loads" line.
2. **No try/finally around the hold (orchestrator).** A throw between `holdAfter` and `release` leaves the page frozen, and the next `frames()` waits until the 180 s protocol timeout. Fix: release in a `finally`, and release before a new `holdAfter`.
3. **The live garden house is still a box (demo stage, as declared).** `garden-01-unflagged-17h7.png`: two storeys and a banded gable roof, no porch, dormers or siding. Acceptance (d) holds only once the demo sets `landmark: true`.
4. **Subject size at the 01 camera (demo stage).** The camera is 31.8 m out; the flagged house is about 375 × 400 px (`garden-01-flag-17h7.png`), where the reference house fills roughly 40% of the frame. Balusters are ~40 px, siding is faint, the gable window barely registers. At 0.55× the distance (`tight-055-17h7.png`) all of it reads.
5. **Two infill houses have the porch half-buried by a 0.8 m terrain step (demo siting, or buildings ground height).** `infill-garden-13-f34l-17h7.png` and `infill-garden-8-f34r-12.png`: grass terrace covers the deck and the railing floats in it. Fix: skip non-flat cells in infill, or take the cell's highest ground.
6. **Rates overstated (buildings builder, report only).** Two-storey 33%, dormers 28–29%.
7. **Night glints on roof and fascia edges (buildings builder, low).** `roof-night-near.png`, `roof-night-back.png`, `garden-flag-close-f34r-21h5.png`: bright hairlines between tile courses and a star-like hotspot at the eave corner. I could not tell specular from leak; invisible at 32 m.
8. **Smaller items (buildings builder, optional).**
   - AO grain on window liners and siding at ≤ 12 m.
   - Unlit porch lamps read as black squares by day (`garden-flag-close-front-12.png`).
   - The 30% of houses without split tiles have a plain banded roof.
   - Ridge-z houses have a blank gable over the porch (`infill-farm-4-f34r-12.png`).
   - Upper planters rest on the porch roof.

No z-fighting, see-through gable ends, floating dormers, post gaps or blocked doors in 30+ close-ups of the landmark and 25 infill houses. Yard props do not collide with the porches.

## Metric prediction
| pair | reference advantage (set 7) | prediction | evidence |
|---|---|---|---|
| 01 house-golden | "Victorian house with siding, porch balusters, dormers" vs our "box houses"; tilt-shift; bare baseplate lots | **narrows**, still a loss (0/3). With the flag, the "box houses" reason should disappear; expected new reasons are subject scale, brick-built texture, depth of field. Without the flag: **no change** for the subject | `garden-01-flag-colors-17h7.png` vs `docs/reference/ss_0875…jpg`; `garden-01-unflagged-17h7.png` |

The demo stage must still: set `landmark: true` (and `colors: {sandGreen, darkRed}`, the closest match to the reference); move the 01 camera in so the house fills the frame; fix or skip the two buried-porch infill lots.

## What works
- The flagged house is a real house at 9 m: tiled gable, two dormers, four-post porch with balusters, clapboard, shutters, flower boxes, raised beds, clean in 30+ close-ups.
- Rng discipline is exact: 441/441 other buildings bit-identical, nosp census unchanged.
- The hold itself is correct: screenshot equals readback, and stats are unbiased against the old order.
