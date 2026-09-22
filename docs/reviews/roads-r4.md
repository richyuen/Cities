# roads — critic review, round 4

**Score: 8.7 / 10 — PASS.** Round 4's headline change is the core junction model: `World.addRoad` now splits the road a drag
lands on and shares a real junction node, so a player T stops producing a dead-end cul-de-sac bulb on the through road and a
crossing drag produces one shared 4-way node instead of two unconnected overlapping plates; removing the branch heals the
split back into a single edge. I checked that on pixels, not on faith. My own true top-downs and 2–6 m close-ups of a 90° X
node (`n7`), a 45° skew node (`n16`), a 45° bend (`n14`), two 90° street corners (`n8`/`n9`) and the three reconnected
demo-city junctions show junctions as genuinely built corners: a crosswalk on every non-forked arm, stop lines on the
correct half, lane markings and median islands stopping at the crosswalk, rounded studded corner fillets, no bulbs on
through roads, no missing plates and no visible z-fighting at play range. The r3 terrace-fin fix still holds at three nodes
I picked myself, and the builder's mouse-drag T evidence (`r4-tool/before.png` → `after.png`) is a real junction where
round 3 would have left a bulb. This is a genuine capability upgrade on 8.6, held back from higher only by close-range nits
(issues 1–3) and the unresolved angle-dependent noon sheen it inherits.

## Numbers
| set | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `shots/roads/r4/` (mine — default variant, 6 presets × 4 tods) | 24 | 143.0 | 6.59 | 78 | 0 |
| `shots/roads/r4j/` (mine — variant `junction`, 6 presets × 4 tods) | 24 | 143.2 | 6.64 | 72 | 0 |
| `shots/roads/r4x/` (mine — 12 custom: true top-downs of `n7`/`n16`, 45° bend `n14`, 90° corners `n8`/`n9`, 2 m macros, far dusk overview) | 12 | — | ≤ 6.56 | ≤ 73 | 0 |
| builder evidence read, not retaken: `r4-tool/` 2, `r4-game/` 5, `r4-junction/` 4 | 11 | — | — | — | 0 |

- `node tools/road-audit.mjs --seed 1`: **57/57 checks passed**, deterministic (baseline 672 nodes / 427 edges, hash
  `948fe358`). Covers T split + 3 arms + undo heal, X split + 4 arms + undo, diagonal X, near-node snap, route-node join,
  overlap guard, bridge/path non-splitting, bulldoze ownership, save/load replay, and two fresh loads producing identical
  gesture traces — i.e. exactly the topology claims of this round, including "the healed network behaves".
- **Roads' own contribution** (live `scene.getObjectByName('roads').traverse`): **8 meshes** in the `junction` variant
  (`roads-studs[inst]`, `roads-infill-studs[inst]`, `surface`, `curb`, `sidewalk`, `terrace`, `white`, `yellow`) and **10**
  in the default variant (adds `roads-path`, `roads-lots`). §7 budget is 60. Whole-scene calls peak at 78 (terrain +
  environment + effects included), unchanged from r3.
- `gpuMs` ≤ 6.64 ms in every one of my 60 captures — far under the 20 ms full-city budget.
- Live API (junction variant): `audit().ok = true`; `getLaneConnections('n12')` = 6 and `getLaneConnections('n16')` = 14,
  every path finite; no zero-length or lane-less remnant edges (18 edges enumerated, none under 2 m); `snapToRoad(5,40)` →
  `e10` @ dist 5; `heightAt(0,32)` = 2.16; `roadWidth('avenue')` = 16 / `footprintWidth` = 20.
- `api.lastBuildMs()`: 36.1 ms (junction variant, 18 edges) / 53.8 ms (default variant, 50 edges) — r3 measured 51.6 ms on
  the default network, so no regression; still 2–3× round 1's 18 ms baseline. Not perf-budgeted, `gpuMs` is nowhere near
  budget. Breakdown on the junction variant: network 5.5 / geometry 12.2 / footprint 13.6 / upload 4.8 ms.
- `studStats()` on the default variant = `{ total: 57408, terrain: 30006, rejected: 26 }` — byte-identical to r3, so the
  default network's stud placement was not disturbed by the junction rework; overlap rejection still live.
- Console errors: **zero** across all 60 of my captures plus the 11 builder captures read. `Math.random`: zero hits in
  `src/roads/` (5 files: `index.js`, `network.js`, `geometry.js`, `studs.js`, `showcase.js` — folder still contains only
  its own files). `showcaseVariants: ['default','intersection','highway','junction']` and preset `roads:junction` exist and
  the `showcase.js` grid comment is updated and accurate about the new auto-stitching path.

## Issue 1 — thin marking slivers / hairline z-fighting across junction decks (worst of a minor set)
- **What**: a handful of 1-pixel light hairlines lying flat on the junction asphalt, plus one clearly visible ~1 m beige
  sliver sitting in the middle of a junction deck. The hairlines have the broken/stippled look of trace z-fighting, and the
  beige sliver has no studs and no yellow line, so it is not a median island — it reads as leftover marking geometry
  (a degenerate sliver of a white/yellow trim polygon) that was not fully removed where the plates meet the junction box.
- **Where**: `shots/roads/r4x/topdown-n16-tight.png` (11 m top-down of the 45° skew node: several diagonal hairlines +
  a notched one at the lower right), `shots/roads/r4x/macro-n16-deck.png` (2.6 m macro: faint seams and one hairline across
  the grain), `shots/roads/r4x/oblique-n16-skew.png` (see crop `shots/roads/r4-zoom/ob-left-4x.png`), and in the builder's
  own evidence `shots/roads/r4j/roads_deadend-6h5.png` at 4×/8× (`shots/roads/r4-zoom/de-stray2-4x.png`,
  `shots/roads/r4-zoom/sliver2-8x.png`, `shots/roads/r4-zoom/sliver1-8x.png`). Fainter versions exist at the 90° node
  (`shots/roads/r4x/topdown-southX.png`) — so it is systemic, not skew-only, and its root cause predates round 4.
- **Why it hurts**: "no z-fighting/plate overlap" is a §7 line item, and the slivers live exactly on the junction decks
  this round rebuilt, so a close-look reviewer will read them as junction artefacts. Severity is honestly low: at play
  distances (10–40 m, 45° look-down) they are invisible; they show up in top-downs and under 4–8× magnification.
- **Fix**: clip the marking polygons (white/yellow) against the junction box and drop any resulting polygon whose minor
  width is under ~0.15 m; if a sliver is unavoidable, give the `white`/`yellow` materials the same `polygonOffset`
  treatment `surface`/`path` already have in `src/roads/index.js:361-362` so it cannot fight the deck.

## Issue 2 — median island ends are blunt square cuts
- **What**: the avenue's 1.6 m median island terminates at junctions with a square-cut end; the two yellow lines run dead
  straight to the cut and stop. There is no tapered/rounded nose, so at close range the island reads as a strip of
  sidewalk that was simply guillotined and the yellow lines look like they were clipped rather than designed.
- **Where**: `shots/roads/r4x/topdown-southX.png` and `shots/roads/r4x/topdown-southX-golden.png` (top-downs of the 90° X:
  island ends at all four approaches), `shots/roads/r4/roads_junction-6h5.png` / `-18.png`, `shots/roads/r4j/roads_junction-18.png`,
  `shots/roads/r4j/roads_deadend-18.png` (island nose just outside the south crosswalk), and the builder's
  `shots/roads/r4-junction/overview.png` (crop `shots/roads/r4-zoom/ov-jv-ne-arm-4x.png`).
- **Why it hurts**: it is the one place where the new junction work does not look designed — a median nose is one of the
  cheapest ways to make a road look authored, and it is now prominently visible at every avenue approach the junction
  rework rebuilt. Pre-existing, but the round puts it front and centre.
- **Fix**: build a nose segment on each trimmed median end — taper the last ~1.5–2 m of the island (trapezoid or rounded
  cap) and let the two yellow lines converge around the nose instead of terminating square.

## Issue 3 — faint straight-edged shading/UV steps on large flat plates
- **What**: coplanar road plates meet along straight seams that are visible as a slight tone/texture change: the asphalt
  normal-map grain visibly changes across the boundary, so at close range a bend shows a lighter "patch" with a straight
  edge across the whole carriageway.
- **Where**: `shots/roads/r4x/bend-n14-6m.png` (clearest: a lighter rectangle with a straight diagonal edge across the
  45° bend), `shots/roads/r4x/macro-n16-deck.png`, `shots/roads/r4x/topdown-southX.png` (faint deck seam down the middle),
  and `shots/roads/r4x/corner-n9-6m.png` (subtle seam in the curve).
- **Why it hurts**: roads are the flattest, most reflective surface in the game, so any UV/shading discontinuity is more
  visible there than anywhere else; at 5 m it reads as a matte patch rather than a joint. Self-inflicted-looking, though
  very low contrast (a few RGB units).
- **Fix**: unify the asphalt normal-map UVs across merged plates (single world-space projection per edge+junction), or make
  the joint honest — a deliberate 0.02 m bevel/gap between plates — instead of a texture seam.

## Round-3 items re-verified independently
- **Stray terrace fin at bends — CLOSED, holds.** Fresh cameras this round: `shots/roads/r4x/corner-n8-6m.png` (90° street
  corner at (-112,32), true noon), `shots/roads/r4x/corner-n9-6m.png` (corner at (112,32), tod 18),
  `shots/roads/r4x/bend-n14-6m.png` (45° bend at (-24,160), noon). All three show a continuous curb and studded sidewalk
  with no trapezoid, no gap and no fin; the long embankments in `shots/roads/r4j/roads_deadend-6h5.png` are legitimate
  terraces on real height deltas, so the threshold did not overcorrect.
- **Noon plastic sheen — unchanged, nit persists exactly as r3 documented.** The material was not touched in round 4
  (`src/roads/index.js:351`, still `clearcoat 0.55` / `clearcoatRoughness 0.2` / `envMapIntensity 1.35`). I A/B'd the same
  camera and the same 450×220 road patch at `(700,780)` in `roads:closeup` tod 12: r3c mean luma 134.1 vs r4 mean 134.4 —
  i.e. pixel-identical, so the standard closeup at true noon is still the flattest framing. Grazing/close views still show
  a real sheen and grain (`shots/roads/r4x/grazing-noon-2m.png` has an obvious glossy sky reflection;
  `shots/roads/r4x/topdown-southX.png` shows the specular lobe plus normal-map grain across the deck; the sunset specular
  streak down the roadway in `shots/roads/r4j/roads_deadend-18.png` is genuinely handsome). Angle dependence remains a
  nit, not a defect.

## Regression check (round 1–3 fixes, reverified this round)
- Junction correctness at the nodes the round rebuilt: `shots/roads/r4x/topdown-southX.png` (4 crosswalks, 4 stop lines on
  the correct halves, median trimmed outside all four crosswalks, rounded fillets on all four corners, clean deck) and
  `shots/roads/r4j/roads_intersection-18.png` (close 4-way: every marking stops at its crosswalk, no bulbs, no overlap).
- Skew (45°) node `n16`: `shots/roads/r4x/topdown-n16-skew.png` / `oblique-n16-skew.png` — the diagonal street crosses the
  avenue through one shared 4-arm node, crosswalks follow the skew, corner sidewalks miter/curve cleanly; only Issue 1's
  trace slivers spoil it. Lane connections finite (14 at `n16`, r4's audit `badLane` empty).
- Demo-city junctions that previously ended in bulbs now connect:
  `shots/roads/r4-game/junction-suburb.png` (4-way, crop `shots/roads/r4-zoom/suburb-junction-3x.png`),
  `junction-industrial-south.png` (crop `shots/roads/r4-zoom/inds-junction-3x.png` / `inds-T-3x.png`: T with crosswalks
  on all three approaches, smooth corner fillet, traffic-light pole placement sane),
  `junction-industrial-north.png`. No stray bulb at any through junction in any of them.
- Cul-de-sacs remain only at genuine dead ends: `shots/roads/r4/roads_deadend-*.png` and the builder's
  `shots/roads/r4-junction/overview.png` (crop `shots/roads/r4-zoom/ov-culdesac-4x.png` — clean studded bulb ring on a real
  dead end); the T drag in `shots/roads/r4-tool/after.png` ends in its own bulb ~56 m east, which is the stem's own dead
  end, not the through avenue.
- Highway/avenue ends, ramp embankment, gravel lots, studded shoulders: `shots/roads/r4/roads_highway-*.png` (12/18),
  `roads_junction-*.png`, `r4j/roads_highway-18.png` — all unchanged in character from r3.
- API contract live: `getLanePath`, `snapToRoad` (with and without `maxDist`), `heightAt`, `roadWidth`/`footprintWidth`,
  `getIntersections`, `audit`, `rebuild` all present and finite; `api.audit()` returns `ok` with every list empty.

## What already works (carried in and reconfirmed)
- **The junction model and its visuals are real, not cosmetic.** T wraps onto the through road with no bulb, X crossings
  stitch into one node, diagonal 45° crossings resolve into a proper skewed 4-way, undelete heals back to one edge
  (57/57 audit), and the pixels around those nodes are indistinguishable from the hand-placed grid junctions — same
  crosswalks, stop lines, fillets, lane-marking termination and median trimming.
- **Merged geometry is still cheap and stable**: 8–10 own draw calls regardless of network size, ≤ 6.64 ms GPU in 60
  captures, deterministic, zero console errors, zero `Math.random`.
- **Material/look**: the asphalt still reads as glossy ABS (visible sheen and normal-map grain at grazing angles and from
  top-down), markings AA cleanly even edge-on, markings/material are shared and culled, and the terrace/curb/sidewalk
  palette keeps the "everything is bricks" promise.

## Remaining issues (not blocking)
1. Thin marking slivers / hairline z-fighting on decks (Issue 1) — trace-level, under zoom only, but on the round's own
   territory; the cheapest visible win left.
2. Blunt median noses (Issue 2) and straight-edged plate/UV steps (Issue 3).
3. `lastBuildMs` 36–54 ms depending on network size (r3 measured 51.6 ms; round 1 was 18 ms). Not perf-budgeted and GPU
   time is nowhere near the cap, but if the game ever rebuilds the network during a live drag, the 12–14 ms geometry +
   footprint passes are the ones to watch.

---

## Addendum — builder follow-up (issues 1–2 and the showcase bulb)

**Verdict: Issue 1 RESOLVED, Issue 2 RESOLVED, Issue 3 UNCHANGED (as declared). Score 8.7 → 8.8 (pass).**
Everything below was re-shot by me, not taken from the builder's report: 9 fresh captures in `shots/roads/r4v/` plus 4×/3×
crops of the builder's `shots/roads/r4-fix/` evidence (`shots/roads/r4v-zoom/`). `node tools/road-audit.mjs --seed 1` still
**57/57, deterministic**, same baseline 672 nodes / 427 edges, hash `948fe358`. Console errors 0 in every fresh capture
(gpuMs 3.08–6.56, drawCalls 59–72).

**Framing caveat (why my A/B is anchored on a different node):** the fixed showcase network no longer contains the 45° skew
crossing `n16` (0,136) that round 4's Issue 1 was caught on — the bend that used to cross the avenue there now T's into it at
(0,160) (`n14`, 4 arms: west street + avenue N/S + a ~30° bend arm; trims 14.4/7.0/11.0/16.7) and dead-ends at `n15` (56,128).
So I reproduced Issue 1 at the same **magnifications** on the surviving 90° node `n7` (0,96) (11 m true top-down and 2.6 m
deck macro — the exact framings of `r4x/topdown-n16-tight.png` and `r4x/macro-n16-deck.png`), plus a 26 m top-down, a 1.3 m
grazing shot at tod 18, and a 3× crop of the builder's own `r4-fix/deadend-6h5.png` deck.

### Issue 1 — marking slivers / hairlines on junction decks: RESOLVED
- `shots/roads/r4v/topdown-n7-tight.png` (11 m top-down, the old worst-case magnification): clean deck — normal-map grain
  only, one or two steady tone boundaries (that is Issue 3, below). **No 1 px light hairlines, no stipple, no sliver.**
- `shots/roads/r4v/macro-n7-deck.png` (2.6 m deck macro): clean; crosswalk bars, dashes and the median nose are crisp
  rectangles with normal AA.
- `shots/roads/r4v/topdown-southX.png` (26 m top-down) and `shots/roads/r4v/grazing-deck-18.png` (1.3 m grazing, tod 18):
  clean; no shimmer signature.
- `shots/roads/r4v/topdown-t160-fixed.png` (24 m top-down of the rebuilt (0,160) node) and
  `shots/roads/r4v/topdown-n160new.png` / `bulb-n15-new.png` (bulbs): clean decks and bulbs; the only surface features are
  faint steady tone boundaries.
- 3× crop of the builder's own `shots/roads/r4-fix/deadend-6h5.png` (`shots/roads/r4v-zoom/fix-de-deck-3x.png`): the deck at
  the junction mouth is clean — the beige sliver that `r4-zoom/sliver2-8x.png` caught in the old framing is gone.
- Conservative wording: I can only judge stills; I cannot prove absence of temporal shimmer. What I can say is that in every
  framing I re-shot, the alternate-pixel/stipple signature and the floating sliver that defined Issue 1 are not present; what
  remains is the steady tone boundary family, which is Issue 3 and was never part of Issue 1.

### Issue 2 — blunt square-cut median noses: RESOLVED
- `shots/roads/r4v/topdown-southX.png`: both avenue approaches now end the median island in a clear **tapered nose** with the
  twin yellow lines converging around the tip, outside all four crosswalks.
- `shots/roads/r4v/macro-n7-deck.png` and `shots/roads/r4v/grazing-deck-18.png`: the taper reads correctly at 1.3–2.6 m.
- `shots/roads/r4v/default-12.png` (whole-grid aerial): the taper is legible even at mid-distance on every approach.
- Builder evidence, cropped by me: `shots/roads/r4v-zoom/fix-cu-nose-3x.png` (from `r4-fix/closeup-18.png`) and
  `fix-jv-median-3x.png` (from `r4-fix/junction-12.png`) show twin continuous yellow lines with clean stud rows and a
  pointed island tip — no clipped/squared strip left.

### Issue 3 — straight-edged shading/UV steps on large plates: UNCHANGED (untouched, still minor)
Still present exactly as written in the main review: steady, few-RGB-unit tone boundaries where coplanar plates meet, e.g. the
vertical boundaries in `shots/roads/r4v/topdown-n7-tight.png`, the faint diagonals in `shots/roads/r4v/macro-n7-deck.png`
and `grazing-deck-18.png`, and on the bulb in `bulb-n15-new.png`. No stipple, so it remains a texture-continuity nit, not
z-fighting.

### Showcase authoring fix (north-end bulb 8 m from the avenue): VERIFIED
- Topology: `n16` is gone; `n14` at (0,160) is now a 4-arm intersection and the bend continues from that node to `n15`
  (56,128), whose bulb is **56 m** from the avenue (was ~8 m).
- Visuals: `shots/roads/r4v/topdown-t160-fixed.png` shows the 4-way deck with four proper crosswalks, stop lines and clean
  corner fillets; `shots/roads/r4v/bulb-n15-new.png` shows the new bulb with a continuous studded ring and a tapered neck;
  the builder's `shots/roads/r4-fix/overview-12.png` shows the whole variant with tapered medians and no stray bulb near any
  through junction. Side effect to keep in mind: the `junction` variant no longer stages a diagonal 4-way, so skew-crossing
  coverage now rests on the audit's diagonal case and the ~30° bend arm.

### Rescore
8.7 → **8.8**: the two ranked issues were my only real deductions and both are independently verified fixed; the only
close-range nit left is the untouched Issue 3 (plus the inherited angle-dependent noon sheen and non-budgeted build time), so
the module stays "AAA with nits" and does not reach higher.

New screenshots this verify round: `shots/roads/r4v/topdown-n7-tight.png`, `macro-n7-deck.png`, `topdown-southX.png`,
`grazing-deck-18.png`, `topdown-t160-fixed.png`, `topdown-n160new.png`, `bulb-n15-new.png`, `junction-12.png`, `default-12.png`,
`closeup-18.png`; crops in `shots/roads/r4v-zoom/` (`fix-de-deck-3x.png`, `fix-jv-median-3x.png`, `fix-cu-nose-3x.png`,
`fix-de-junction-3x.png`).
