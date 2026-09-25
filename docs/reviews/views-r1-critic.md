# views — round 1 critic review

**Score: 8.6 / 10 — PASS.** The coverage views (Power/Water/Services/Police/School/Health/Transit) are genuinely AAA-grade
data overlays — instant red/blue/yellow read at every range and time of day, night included, and the unlit-emissive
solution really does keep red a true red over grass. The contract is implemented exactly and perf has huge headroom.
Docked for one weak view (land value reads as a near-uniform yellow wash) and for the translucent building tint boxes
being visibly oversized "vitrines" at street range rather than hugging the silhouette.

## Numbers

| run | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `shots/views/r1-critic/` (critic.mjs, default variant = School, 3 presets × 4 tods) | 12 | 143.4 | 6.91 | 413 | `[]` |
| `shots/views/r1-critic/variant-*.png` (all 8 showcase variants, `views:default`, tod 12) | 8 | 143.7 | 6.92 | 378 | `[]` |
| full-game functional captures (`func-hud-school/minimap/view-active/post-esc/paused-recompute`) | 5 | 61 | 6.77 | 741 | `[]` |

`summary.json.budget` = fpsOk/gpuOk/drawCallsOk all true; `maxTriangles` 5,774,570. ARCHITECTURE §7 budget is gpuMs ≤ 20
(full city) and "others ≤ 10" draw calls. `views` renders exactly **2 InstancedMesh** (`views-ground`, `views-buildings`,
verified live by scene traversal), so every call count above is the showcase/demo backdrop. At a fixed camera a view
*lowered* draw calls 744 → 572 (turning it off restores zoning's 3 plates and their transmission pass); the module's own
contribution is the documented 2. No `Math.random`; `src/views/` contains only its three own files.

## Contract check — all correct

- `id 'views'`, `deps`, `order 72`, `init/update/dispose/showcase`, presets `views:default/closeup/aerial`,
  `showcaseVariants` = default + all 8 ids, and `api = list/getView/setView/toggle/cycle/refresh` all present.
- `view:changed {view,label}` observed with correct payloads via HUD row click, `V`, `Shift+V`, `Esc`.
- HUD row click → School: 4,911 ground plates / 366 boxes, row highlighted, legend
  "School coverage · Covered / Uncovered / Service"; `V` → Health (row + legend follow); from null `V` → Power and
  `Shift+V` steps back to Land (wrap works both ways).
- `zoning.api.setOverlayVisible` interlock: `zoning-r/c/i` all `visible:false` while a view is active, all `true` again
  after Esc — the two translucent overlays never blend.
- **Recompute while paused**: with `__city.pause()` called, adding a school with no `refresh()` flipped the grid read at
  the new site 0 → 1 and grew the overlay 4,911 → 5,402 plates / 366 → 373 boxes (`func-paused-recompute.png`); the
  debounced event rebuild fires while the clock is stopped.
- Minimap while a view is active: a click recentred the camera 388 m and `camera:changed` fired; base map keeps drawing.
- Esc closes the view first and does **not** open the pause menu (`menu.isOpen=false`, no `lc-menu-open`).

Probe hygiene note: two red flags in my own script were script bugs, not module defects — `null ?? fallback` printed
`__no_api__` for the (correctly `null`) baseline `getView()`, and one proof shot came back black because I fed
`cellToWorld().y` (undefined) into a custom camera. Both re-run/re-confirmed; every module assertion passed.

## Ranked issues

1. **Land value reads as a near-uniform yellow wash; its high green is confusable with grass.** `variant-land.png`
   (whole city one butter-yellow tone), 2× crop `shots/views/r1-critic/crop-land-centre.png`. `cellDesirability` clusters near mid, so a
   red→yellow→green ramp spends the whole map in the yellow band; the buildings get the same yellow shell, and the top
   green (`#1f9e44`) sits in the same family as untinted grass, so high/low cells are only findable by close inspection.
   Of the eight views this is the only one that does not answer its question at a glance. Fix: normalise the ramp over the
   current map's zoned-cell min/max (or fixed quantile bands), compress the yellow shoulder so red/green own the ends,
   and give land plates a faint dark edge so tinted green separates from raw grass.
2. **Building tint boxes are oversized translucent "vitrines" that do not hug the silhouette.** `views_closeup-6h5/12/18/21h5`,
   `func-paused-recompute.png` (2× crops `crop-zoom-school-2x.png`, `crop-zoom-transit-2x.png`, `crop-zoom-source-school.png`). `BOX_PAD`
   0.6 m/side and height `max(1.4, h+1.0)` leave a visibly detached glass shell: at street range you get a double
   silhouette through the box and a lid floating above the roof, which veils the brick facades the rubric prizes. Fix:
   pad 0.1–0.2 m and +0.1 m height (0.6 m is far more than needed — the box faces are not coplanar with the building),
   or drop the box and tint the building mass / add an edge outline.
3. **"Service" yellow washes out to cream on pale utility buildings in Power/Water/Services.** `variant-power.png`,
   `variant-water.png`, `variant-services.png` (2× crop `crop-zoom-source-power.png`). `#ffe27a` at 0.85 opacity over the pale
   concrete plant/tower reads beige, so the one building that anchors the layer does not announce itself at the default
   3/4 camera — schools and hospitals (darker masonry) read well by comparison. Fix: a more saturated gold
   (`brightYellow`-ish) and/or a small source emissive bump, or an opaque top cap on source boxes.
4. **Covered open land gets a full-strength blue pad past the built area.** `variant-power.png` (large blue rectangle on
   empty grass north of the grid), `func-hud-school.png` (NW fringe). Reads at first glance as a rogue oversized plate
   rather than "within the plant's radius", and competes with the actionable zoned cells. Conventional coverage-map
   behaviour and it does communicate the radius, so low severity. Fix: fade the open-land tint with distance from any
   zoned/built cell, or restrict it to cells adjacent to zoned land.

Not counted as defects: no traffic/congestion layer, no spare-capacity display, and the minimap still showing base
zone/road colours — all documented and planned for Wave C4. The HUD panel's seven toggle rows vs eight views (`services`
is V/api-only) matches ARCHITECTURE's "Coverage rows" wording; noted, not scored.

## What already works

- **Coverage legibility is the headline.** `views_aerial-6h5/12/18/21h5` and `views_closeup-*`: blue / red / yellow are
  unmistakable at aerial and street range, at golden hour, noon, dusk and night. The terrain studs read through the
  translucent plates, so the overlay looks like a plastic data layer rather than flat paint, and red over grass stays a
  saturated red — the emissive-coupling trick does exactly what the design claims. At night (`views_aerial-21h5`) the
  overlay stays fully readable without blooming over the city's window lights.
- **The state machine and interlock are exact.** Row highlight ↔ legend ↔ overlay ↔ `view:changed` all agree; Esc defers
  to the view before the tool/menu; zoning plates are hidden while a view is active and restored byte-for-byte after;
  the paused recompute is correct with zero manual refresh calls.
- **Zero errors, far inside budget, honest perf.** 143.4 minFps / 6.91 ms / 413 calls in the showcase batch, 61–138.2 fps
  in the full game captures, `errors: []` in every JSON and in `stats().errors`, and the 2-draw-call claim is real.
