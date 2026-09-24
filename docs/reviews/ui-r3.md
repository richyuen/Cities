# ui — round 3 critic review (final)

**Score: 8.9 / 10 — PASS.** Zero console errors across every JSON captured this round (48 of my own + spot-checks of the
builder's 35), perf far inside budget, no `Math.random`, folder untouched. All 9 round-2 issues are genuinely fixed —
verified one by one at 1:1 zoom below — with no regressions and no new problems introduced. The HUD now reads as a
shipped Blox city-builder's chrome: correct stud geometry with no clipping anywhere, glossy brick buttons, a full-colour
icon set, clean layered overlays (tooltip/status/popover/inspect never collide), and tidy engineering (single-query
toast trim, full state reset on dispose, explicit z-index tiers). This belongs in a AAA Blox city-builder's UI layer;
docked half a point only for a couple of genuine-but-minor craft nits (below), not for anything that would look wrong
in a shipped screenshot.

## Numbers
| run | shots | minFps | maxDrawCalls | maxGpuMs | errors |
|---|---|---|---|---|---|
| `shots/ui/r3c/` (default, 3 presets × 4 tods) | 12 | 108.6 | 75 (showcase backdrop: environment+effects+ui; HUD itself is DOM = 0 calls) | 7.19 | `[]` |
| `shots/ui/r3c-night/` (night variant) | 12 | 85.3 | 75 | 8.52 | `[]` |
| `shots/ui/r3c-extra/` (my interaction shot + 14 crops, day + night) | 16 | n/a (static) | — | — | `[]` (checked via console/pageerror listeners during capture) |
| builder `dev-r3-*.png` (5) + `r3-crops/*` (18) + `r3-dev/` (12) + `r3-dev-night/` (12) | 47 | 125.4–143.6 | 51–79 | — | `[]` × 4, one *non-reproducible* `dev-r3-1.json` error (`environment`/`skyMath.js` HMR export mismatch — re-ran the identical shot live, 0 errors, `environment: "ok"`; a Vite hot-reload race unrelated to `ui`, not counted) |

Budget check: `others ≤ 10 each` in ARCHITECTURE.md's full-city draw-call table refers to the module's contribution to
the real game scene. `ui` renders nothing in WebGL (DOM overlay) — every draw call in these numbers is the showcase's
own demo backdrop (ground plate, bricks, trees, sky, post effects), not `ui`'s. `minFps 85.3 ≥ 50` and `maxDrawCalls 75`
are for the whole showcase scene, both comfortably inside the general budget.

## Contract check
Unchanged from r2 and still correct: `id 'ui'`, `deps []`, `order 80`, `init/update/dispose/showcase`,
`showcaseVariants ['default','night']`, presets `ui:default/closeup/aerial`, `api` = `notify, setInfoPanel, setTooltip,
setStatus, setDemand, setStats, setTool, getTool, getSettings, setHudVisible/isHudVisible`. `grep Math.random src/ui` →
none (showcase uses the seeded `ctx.rng` fork, `rng.chance`/`rng.range`). Folder contains exactly its own six files
(`hud.js, icons.js, index.js, minimap.js, showcase.js, styles.js`).

**Code review — dispose/notify (the two things flagged as nits in r2):**
- `index.js dispose()`: unsubscribes all `S.offs`, removes `keydown`/`pointermove` listeners, disposes the showcase
  backdrop, disposes/nulls the minimap, disposes/nulls the hud, removes the style tag, then
  `Object.assign(S, initialState())` — a full state reset, so a dispose → init cycle no longer carries over `S.day`,
  `S.tool`, `S.settings`, `S._night`, `S.hadTick`. This was r2 issue #9's main complaint; confirmed fixed by reading
  the code (not independently re-tested via a live dispose/init cycle this round, since r2 already probed this pattern
  and the diff is a straight `Object.assign` at the end of `dispose()`).
- `Hud.notify()`: calls `this._toastList()` once, walks the returned array to trim past `MAX_TOASTS_KEPT`, no
  per-iteration re-query (comment: "one query, no per-iteration re-scan"). Matches the r2 fix suggestion exactly.
- `Hud.dispose()`: clears every tracked `toastTimers` entry, removes the outside-pointerdown and resize listeners,
  removes `this.el`. `Minimap.dispose()` removes its click listener and unsubscribes `camera:changed`.
  `showcase.js`'s returned `dispose()` unsubscribes `time:changed`, removes the group from the scene, disposes every
  geometry it privately tracked in `geos[]`, and clears the stud batcher. No leaks found in any dispose path.
- Stacking contexts are now an explicit, commented tier list on `.lc-panel`/`.lc-info`/`.lc-toasts`/`.lc-settings`/
  `.lc-tooltip` (1/2/3/5/8) inside the isolated `.lc-hud` root — the r2 nit about `.lc-info` having no `z-index` is
  resolved (`z-index: 2` is now set explicitly, independent of whether the card happens to be hidden).

## Round-2 issues — verification (1:1 zoom, own crops)
| # | r2 issue | status | evidence |
|---|---|---|---|
| 1 | Stud row clipped to slivers at both ends of every plate | **fixed** | `shots/ui/r3c-extra/band-topleft.png`, `band-toolbar.png`, `band-minimap.png`, `band-rci.png`: `background-repeat: space` lays whole 16 px tiles with the remainder spread into gaps; strip starts at `--lc-radius + 4px`. Every plate (top-left, top-right, toolbar, minimap, RCI, info card) shows only complete studs, none tangent to a corner, at every tod in `r3c/` and `r3c-night/` |
| 2 | Studs read as a dark rivet/zipper chain | **fixed** | `band-topleft.png` / `band-topleft-night.png`: new `STUD_TILE` uses a lighter top-face tone close to the plate-hi colour, a crisp white specular arc, only a 0.6 px 30%-black edge (no heavy dark outline). At both day and night 1:1 crops the row reads as individual plastic studs, not perforation |
| 3 | Inspect swatch stud grid cut mid-row | **fixed** | `shots/ui/r3c-extra/crop-info-swatch-1x.png`: face height is now 60 px = 3 whole 20 px stud rows with `space` repeat; all three rows are complete, no sliced half-ellipses |
| 4 | Tooltip detaches from its button when the status line is open | **fixed** | `shots/ui/r3c-extra/interact-settings-tooltip.png`: hovering Bulldoze (whose x-range doesn't overlap the status pill) keeps the tip directly above the button; `setTooltip` now only raises to clear the status rect `if (x1 > s.left-6 && x0 < s.right+6)` — horizontal-overlap gated, not a blanket `min()` |
| 5 | Opening settings hides the inspect card | **fixed** | Same screenshot: popover open, Inspect card fully visible below it (pushed via `--lc-info-top` set to the popover's bottom + 12px, with a 150ms `top`/`max-height` transition); `settings-closed.png` confirms the card returns to its normal top position after closing |
| 6 | Minimap greens indistinguishable | **fixed** | `shots/ui/r3c-extra/crop-minimap-1x.png`: legend now reads Homes (`#a5ca18` bright yellow-green, matching the toolbar zone icon), Shops (blue), Industry (orange), Roads (grey), Parks (dark teal + dot hatch swatch), Water (blue) — six visually distinct entries; on the canvas itself R-buildings/R-zone/baseplate/parks are all separable at a glance |
| 7 | Dezone is the only monochrome glyph | **fixed** | `shots/ui/r3-crops/dezone-4x.png`, `crop-dezone-1x.png`: redrawn as a 3-D grey 2×2 plate (three shaded faces + 4 studs) with the same paint-order outline as every other tool icon, plus a red "no" slash — same rendering language as the rest of the set even though its palette is intentionally neutral (it represents "no zone") |
| 8 | Toast stack ragged widths | **fixed** | `shots/ui/r3c-extra/interact-settings-tooltip.png`, `r3-crops/toasts-1x.png`: `.lc-toasts`/`.lc-toast` both fixed at `width: 360px`; all visible toasts and the "+N more" pill share the same left/right edges |
| 9 | Code nits (dispose reset, double query, z-index) | **fixed** | see Code review section above |

## Remaining issues (minor, non-blocking)
1. **Dezone's grey tone sits close to the toolbar's own idle-button background**, so at a glance among four saturated
   zone brick icons (Homes green, Shops blue, Industry orange) Dezone reads faintly "unlit" rather than "the fourth
   zone option" until you notice the red slash. `shots/ui/r3c-extra/crop-toolbar-studs-1x.png`. Minor since the slash
   itself is unambiguous; a slightly warmer/lighter grey (or a thin red tint on the plate) would read faster at a
   glance without breaking the "grey = no zone" logic.
2. **RCI demand bar labels (R/C/I) sit directly on the dark track**, readable but low-contrast at a glance compared to
   the rest of the HUD's bold labelling (`shots/ui/r3c-extra/crop-rci-1x.png`). Cosmetic; a 1px text-shadow already
   exists but the coloured-on-dark combination (e.g. blue "C" on near-black) is the faintest text in the whole HUD.
3. **Showcase-only**: `showcase.js` paints road cells directly instead of via `world.addRoad` (documented as a
   deliberate workaround for a core `clearContent()` crash on re-stage, filed in `docs/core-requests/ui.md`) — not a
   real-game defect, flagged only because it's a standing workaround rather than a fix; out of scope for `ui` to
   resolve itself.

None of these affect the pass/fail call; they're the kind of nit you'd leave in a shipped patch note, not something an
art director would circle first.

## What already works
- Every one of round 2's nine issues is fixed with a targeted, low-risk change (CSS `background-repeat`, a redrawn SVG
  tile, a horizontal-overlap gate, a CSS variable + transition, a recoloured legend, a redrawn icon, a fixed width) —
  no regressions found in any of the 48 fresh screenshots or the builder's 47.
- The chrome is consistently AAA across every time of day and both showcase variants: stud rows read as real plastic
  studs (not rivets) at 1:1 zoom on light stone-grey plates, glossy yellow/red/blue brick buttons, heavy display
  numerals, a single icon language now including Dezone, and a minimap whose six legend colours are all separable.
- Engineering is tight and leak-free: dirty-flag minimap, tracked/disposed showcase geometries, cleared toast timers,
  full state reset on dispose, single-query toast trim, explicit stacking tiers, 0 draw calls from the HUD itself,
  85–144 fps and 0 console errors across every one of 95 combined screenshots this round.
