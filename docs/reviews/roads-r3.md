# roads — critic review, round 3

**Score: 8.6 / 10 — PASS.** Both remaining round-2 issues were worked. The worse one — the stray terrace fin — is not just
fixed at the one bend the round-2 review flagged, it is fixed structurally (a height-delta threshold plus a "demote lone
stubs" rule in `addTerraces`), and it holds up at two independently-chosen bends the builder's own round-3 shots never
targeted. The noon-plastic material got a real, visible upgrade too, though it is angle-dependent rather than uniformly
brighter. Saying it plainly since this module has been close for two rounds: this is AAA-with-nits and it passes.

## Numbers
| set | shots | minFps | maxGpuMs | maxDrawCalls (scene) | errors |
|---|---|---|---|---|---|
| `shots/roads/r3c/` (mine — default, 5 presets × 4 tods) | 20 | 84.4 | 11.61 | 78 | 0 |
| `shots/roads/r3c-int/` (mine — variant intersection) | 20 | 114.5 | 8.53 | 69 | 0 |
| `shots/roads/r3c-hwy/` (mine — variant highway) | 20 | 121.1 | 8.05 | 70 | 0 |
| `shots/roads/r3c-bend/` (mine — 16 custom shots: 2 other 90° bends, 1 highway bend, cul-de-sac, 2 dead ends, ramp slope, 2 true-noon macro closeups) | 16 | — | — | — | 0 |
| `shots/roads/r3-dev/`, `r3-int/`, `r3-hwy/`, `r3-bend/` (builder's own, reviewed not retaken) | 60+17 | ≥61 | ≤13.8 | ≤78 | 0 |

- Two of my automated batch runs died mid-run to a dev-server hot-reload from a concurrent agent (`Execution context was
  destroyed`) — standard for tonight per the brief; both were rerun (r3c needed a third attempt, plus one individual shot
  re-capture for a glitched frame that landed with `drawCalls:0` mid-reload). Final numbers above are all from clean runs.
- **Roads' own contribution** (live `scene.getObjectByName('roads').traverse`, checked via `page.evaluate`): still exactly
  **10 draw calls** — 8 static merged meshes (`roads-lots`, `roads-surface`, `roads-path`, `roads-curb`, `roads-sidewalk`,
  `roads-terrace`, `roads-white`, `roads-yellow`) + 2 `InstancedMesh` stud fields (`roads-studs`, `roads-infill-studs`).
  Well inside the §7 budget of 60.
- `gpuMs` never exceeds 13.8 ms anywhere across all four sets (mine + the builder's) — comfortably under the 20 ms full-city
  budget, and roads is a small fraction of that.
- `api.lastBuildMs()` = **51.6 ms** (live query), down from round 2's 60.1 ms. Still above round 1's 18 ms baseline — not
  perf-budgeted, so not scored, but worth another look if the real game ever rebuilds interactively.
- `api.studStats()` = `{ total: 57408, terrain: 30006, rejected: 26 }` — consistent with round 2, overlap-rejection still live.
- Console errors: **zero** across every shot JSON this round (mine and the builder's, 100+ captures combined).
  `Math.random`: **zero hits** in `src/roads/` (5 files, same as round 2). Folder still contains only its own five files.

## Issue 1 (round 2's worst remaining): stray terrace fin — VERIFIED FIXED, AND GENERALIZES
Read the fix in `src/roads/geometry.js:199-264` (`addTerraces`). It is not a location-specific patch:
- `MIN_DELTA = PLATE` (0.4 m) — a vertex only gets a step if its sidewalk top clears the raw terrain under it by at least
  one plate height (`geometry.js:216-226`).
- A second pass demotes any vertex whose *neighbours* don't also need a step (`geometry.js:228-234`) — "a real embankment
  is always at least two vertices wide" — which is exactly the class of bug that produced the round-2 fin (a lone vertex
  firing a terrace on an otherwise flat run).

Verification, at the reported bend and at two others the builder's round-3 shots never covered:
- **Reported bend (`n25`, the 50° bend at x≈-176,z≈-32)**: builder's own `shots/roads/r3-bend/bend50-10m-outer.png`,
  `bend50-node-6m.png`, `bend50-node-6m-v3.png`, `bend50-topdown.png`, `bend50-wide-topdown.png` — all clean, curb and
  sidewalk sweep continuously, no dark trapezoid anywhere on the outer curve.
- **`n0` (-128,-96), a 90° street corner on the opposite side of the grid from n25**, queried live via `getIntersections()`
  and shot fresh: `shots/roads/r3c-bend/other-bend-n0-grazing.png` (low grazing angle, the exact framing that caught the
  round-2 fin), `other-bend-n0-topdown.png`, `other-bend-n0-golden.png` (tod 18) — all clean.
- **`n27` (176,32), a different 90° street corner**: `shots/roads/r3c-bend/other-bend-n27-grazing.png`,
  `other-bend-n27-topdown.png` — clean.
- **`n30`, a highway bend (R=60 m)**: `shots/roads/r3c-bend/hwy-bend-n30-oblique.png`, `hwy-bend-n30-topdown.png` — shows a
  genuine, evenly-continuous embankment terrace strip following the curve (the highway sits ~0.5-0.9 m above the sloped
  terrain here per live `world.getHeight` samples) — real terraces still render where they should, so the threshold didn't
  overcorrect into deleting legitimate embankments.

This issue is closed. The fix is structural and holds at every bend checked, not just the one round 2 flagged.

## Issue 2 (round 2's remaining): flat noon plastic — SUBSTANTIALLY IMPROVED, one residual nit
Material change since round 2 (`src/roads/index.js:227`): `clearcoat` 0.4→0.55, `clearcoatRoughness` 0.25→0.2, plus
`envMapIntensity: 1.35` added (normal map/scale unchanged).
- **Close, grazing true-noon shots now clearly show a visible sheen**: `shots/roads/r3c-bend/noon-plastic-macro.png` and
  `noon-plastic-macro2.png` (both tod 12, camera 1.2-1.6 m off the deck) show an unambiguous bright specular streak plus
  visible clearcoat micro-grain across the plate — this is a real, obvious improvement over round 2's "faint reflective
  band."
- **The standard `closeup` preset at true noon, looking horizontally down a straight road, still reads close to flat
  pale blue-grey**: `shots/roads/r3c-int/roads_closeup-12.png` looks nearly identical to round 2's
  `r2c-int/roads_closeup-12.png` in this exact framing. This is largely a consequence of specular geometry — an overhead
  sun's highlight lands where the surface normal bisects camera and sun direction, which a flat horizontal road viewed at
  eye height simply won't catch except close up — not obviously a further material bug. But it means the one shot that
  originally illustrated the complaint doesn't look meaningfully different.
- **Net**: the material now demonstrably supports a visible glossy sheen at true noon under favorable viewing geometry,
  which is what the round-2 fix suggestion asked for. The residual gap is angle-dependent and minor — a nit, not a
  structural problem.

## Regression check (round 1 + round 2 fixes, reverified this round)
- Bends/kinks/highway ends/junction crosswalks/stud placement: still correct in every preset × tod combination checked
  (`shots/roads/r3c/`, `r3c-int/`, `r3c-hwy/`).
- Cul-de-sac at `n23` (-40,-176): `shots/roads/r3c-bend/culdesac-n23-5m.png`, `culdesac-n23-topdown.png` — clean bulb,
  continuous curb, no stray polygons.
- Street dead end (square stub) at `n24` (64,148): `shots/roads/r3c-bend/deadend-n24-5m.png` — clean square cut.
- Highway dead ends (squared/tapered, no bulb): `shots/roads/r3c-bend/hwy-west-end-3m.png`,
  `hwy-east-end-3m.png` — both still correctly tapered stubs, no cul-de-sac.
- Ramp/hill embankment along the street-highway link: `shots/roads/r3c-bend/ramp-slope-mid-3m.png`,
  `ramp-slope-topdown.png` — terraces present where terrain diverges, no artefacts.
- API contract, live-verified via `page.evaluate`: `getLanePath('e15',0,'forward')` → 14 finite points;
  `getLaneConnections('n25')` → 2 connections, all finite; `snapToRoad(5,40)`→`e8`@dist 5, `snapToRoad(5,40,2)`→`null`
  (maxDist respected), `snapToRoad(500,500)`→nearest edge end at dist 328; `heightAt(0,32)=2.16`; removing edge `e15` and
  calling `api.rebuild()` completes with no throw. All match round 2 behaviour — no regression.

## What already works (carried over and reconfirmed)
- Bends, kinks, highway ends, junction crosswalks, cul-de-sacs, and stud placement are correct and consistent across every
  time of day, every preset, and every custom camera checked this round — the round-2 headline win still holds, and the
  round-2 regression (the fin) is now closed for good.
- Merged geometry stays at 10 draw calls for the whole roads group regardless of network size; `gpuMs` ≤ 13.8 ms in every
  shot across four independent batches (~130 screenshots) this round; deterministic; zero `Math.random`; zero console
  errors.
- The lane/connection/snap/rebuild API remains complete, finite, and stable under a live edge-removal + rebuild cycle.

## Remaining issues (not blocking)
1. **Noon plastic sheen is angle-dependent.** The standard `closeup` preset at true noon still reads close to flat; close/
   grazing framings show it clearly. If it needs to read glossy from more angles, consider a touch more base reflectivity
   (`envMapIntensity` → ~1.6-1.8) or a slightly rougher clearcoat lobe (`clearcoatRoughness` → ~0.15) to broaden the
   highlight without losing the ABS look. Minor.
2. **`lastBuildMs` still ~3x round 1's baseline** (51.6 ms vs 18 ms). Not perf-budgeted and `gpuMs` is nowhere near budget,
   but flagged again for awareness if the game ever rebuilds the network live while the player edits roads.
