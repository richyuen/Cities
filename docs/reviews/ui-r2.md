# ui — round 2 critic review

**Score: 8.3 / 10 — FAIL** (pass needs ≥ 8.5; short by nits). Zero console errors in all 62 JSONs, perf trivially within
budget. Round 1's 11 issues are all genuinely fixed (10 fully, 1 partially). The HUD now reads as a Lego game HUD: dark
stone-grey plates with a stud row, bevel + dark lip + outer ring, glossy yellow/red brick buttons, heavy display numerals,
a single consistent icon style. What keeps it under the AAA bar is the hero element itself: the stud row is rendered as
a dark, heavily-outlined "zipper" that is clipped to a sliver at both ends of every plate, plus a handful of small craft
nits listed below. All are CSS-only fixes; a round 3 should pass.

## Numbers
| run | shots | minFps | maxDrawCalls | errors |
|---|---|---|---|---|
| `shots/ui/r2c/` (default, 3 presets × 4 tods) | 12 | 142.9 | 34 (showcase backdrop; HUD is DOM = 0 calls) | `[]` |
| `shots/ui/r2c-night/` (night variant) | 12 | 143.0 | 34 | `[]` |
| `shots/ui/r2c/fullgame-18.png` (full game, overview, tod 18, 7 modules `ok`) | 1 | 143.6 | 45 total | `[]` |
| `shots/ui/r2c/x-interact-settings.png`, `x-interact-status-tip.png`, `x-mouse-tip-corner.png`, `x-hidden.png`, `x-night-rain-neg.png` | 5 | 143+ | 34 | `[]` |
| builder `dev-r2-*.png` (4 + 7 crops), `r2-dev/`, `r2-dev-night/` (24) | 35 | 142.9 | 34 | `[]` |

Measured in-page (`scratchpad/probe.mjs`): `ui.update()` ≈ 0.2 µs per call idle; day counter stays at "Day 1" after
scrubbing 23.9 → 1 → 21.5 → 6.5 with a paused clock and advances to "Day 2" only when the running clock crosses midnight
(23.97 → 00:36 at 4×). Re-staging the showcase default → night → default leaves `renderer.info.memory.geometries` at 21
throughout (no leak), one `.lc-hud`, one `#lc-ui-style`. Computed font sizes < 11 px across the whole HUD: **0**.
`grep Math.random src/ui` → none. Folder contains only its own six files.

## Contract check
Unchanged from r1 and still correct: `id 'ui'`, `deps []`, `order 80`, `init/update/dispose/showcase`,
`showcaseVariants ['default','night']`, presets `ui:default/closeup/aerial`, `api` = `notify, setInfoPanel, setTooltip,
setStatus, setDemand, setStats, setTool, getTool, getSettings, setHudVisible (+isHudVisible)`. New listeners for
`zone:changed`, `building:spawned/removed` mark the minimap dirty. `settings:changed` is now filed in
`docs/core-requests/ui.md` §3. `dispose()` unsubscribes everything, removes key/pointer/resize/outside-click listeners,
clears toast timers, disposes backdrop geometries, removes the style tag.

## Round-1 issues — verification
| # | r1 issue | status | evidence |
|---|---|---|---|
| 1 | Generic dark-dashboard chrome | **fixed** (see new #1/#2 for stud quality) | every PNG: 2-tone plate gradient, `inset 0 2px` bevel, `0 3px 0` lip, 1 px ring, stud row on top edge, glossy yellow/red brick buttons, `Arial Rounded/Segoe UI Black` numerals, Show-HUD pill is a yellow brick |
| 2 | Settings popover collides with inspect card | **fixed** | `x-interact-settings.png`: popover anchored under the gear with caret, `.lc-settings-open .lc-info{display:none}`, click-outside + Esc close (Esc closes popover first). Crude but collision-free |
| 3 | Status line runs under toolbar | **fixed** | `x-interact-status-tip.png`: status is bottom-centre above the toolbar, `max-width: min(640px, 100vw-420px)`, ellipsis (long highway message clips at "Ctrl for gri…") |
| 4 | Toast stack grows into 3D centre | **fixed** | `x-interact-settings.png`: 3 visible + yellow "+4 more" pill, one-line ellipsis, 40 px rows, stack ends at y≈265. Showcase now uses `ms: 10 min` instead of sticky |
| 5 | Seven 10 px text styles | **fixed** | in-page scan: 0 elements < 11 px; group labels 12 px, tool captions 12 px full opacity |
| 6 | Day increments on backward scrub | **fixed** | probe: paused scrub keeps Day 1, running wrap → Day 2. (Builder's `dev-r2-aerial.png` shows "Day 2" at 12:00 — from a session that ran through midnight, not a scrub; my 24 critic shots all show Day 1) |
| 7 | Minimap legend / marker | **fixed** | 6 labelled swatches in a 3×2 grid; marker clamped, cone filled + double-stroked, edge chevron when camera is outside (`ui_aerial-*.png`) |
| 8 | Uneven icon set | **fixed** (Dezone still the odd one) | toolbar crop: uniform paint-order outline, Inspect is a magnifier on a yellow brick, Highway/Path legible at 28 px |
| 9 | Panels muddy on night sky | **fixed** | `r2c-night/ui_default-21h5.png`, `x-night-rain-neg.png`: 24 % border + black ring + lip separate cleanly from the slate sky |
| 10 | Flat swatch placeholder | **fixed** (one clipping nit, see #3) | inspect card: red brick with studded top face and darker side face, colour via `--lc-sw` |
| 11 | Code nits | **fixed** | `Minimap.update` rebuilds only when `dirty` (0.5 s cooldown); `stageBackdrop` tracks every geometry in `geos[]` and disposes them; toast timers tracked in a Set and cleared; `tickTooltip` caches `clientWidth/Height` until resize; tooltip layout read only when text changes |

## Ranked remaining issues (most damaging first)
1. **Stud row is clipped to slivers at both ends of every plate.** `c-corner-*` crops of `r2c/ui_default-12.png`:
   `.lc-studs` is `left:12px; right:12px; background: … center top / 18px 12px repeat-x`, so unless the strip width is a
   multiple of 18 px both ends show a 1–5 px partial stud (top-left panel: dark sliver at x≈29; top-right: half stud
   under the gear; toolbar: half stud at the right corner; RCI: two hairline slivers; minimap, inspect card likewise).
   On the signature Lego element, at every corner, this is the first thing an art director circles. Fix:
   `background-repeat: space` (or `round`) with `background-position: left top`, or size the strip to
   `calc(round(down, 100% - 24px, 18px))` and centre it; alternatively render the studs as N inline `<i>` elements.
2. **Studs read as a dark rivet/zipper chain, not plastic studs.** `c-1x.png` (1:1 crop of the top-left bar at night):
   the stud SVG uses a body `#4a5059` darker than the plate top (`rgba(84,91,103)`), a 1.1 px `#15181d` outline on a
   12 px tile, and a 2 px-tall top face — at 1× the outline dominates and the row reads as perforation/rivets, the very
   problem r1 flagged for the old studline, just bigger. Real studs are the plate's own plastic seen from above:
   top face ≈ plate-hi tone with a crisp specular arc, side ≈ plate-lo, no heavy outline (a 0.6 px 30 % black edge is
   enough), cylinder ~10 px wide at 16 px pitch. Also start the strip at `left: var(--lc-radius)` + half a pitch so no
   stud sits on the corner tangent.
3. **Inspect swatch stud grid is cut mid-row.** `c-info.png`: `.lc-swatch::before` is 52 px tall with a 20 px tile at
   4 px offset → the third row is sliced at the top-face/side seam (half-ellipses along y = 52). Fix: face height 44 or
   64 px (offset + n × 20), or `repeat-x` two rows.
4. **Toolbar tooltip detaches from its button whenever the status line is open.** `x-interact-status-tip.png`: hovering
   Bulldoze (x≈1327) puts the "Bulldoze B" tip 45 px above the bar because `setTooltip` uses
   `min(barTop, statusTop)` for every button, even ones whose x-range never overlaps the 640 px status pill. Fix: raise
   only when `anchorRect` overlaps the status rect horizontally; or give the tip a small caret so the jump reads as
   intentional.
5. **Opening settings makes the inspect card vanish** (`display:none`) instead of yielding. Acceptable, but a player
   changing quality mid-inspect loses their selection view. Fix: `.lc-settings-open .lc-info { top: <popover bottom +
   12px> }` (or translate it down with a 150 ms transition) so the card stays visible.
6. **Minimap greens are indistinguishable.** Legend `Homes #3c963c` vs `Parks #287f46` vs baseplate `rgb(62,140,60)` vs
   R-zone `rgb(140,205,140)` — four greens on a 194 px canvas. Fix: parks → dark teal-green with a dot hatch, or homes →
   Lego bright yellow-green (`#a5ca18`) matching the toolbar zone icon.
7. **Dezone is still the only monochrome glyph** (dashed grey box + red slash) in an otherwise full-colour brick set.
   Fix: a grey 2×2 plate with a red "no" slash, drawn with the same outline treatment.
8. **Toast stack is centred with ragged widths** (`dev-r2-crop-toasts.png`): three different widths stepped around the
   centre line look untidy next to the otherwise rigid plates. Fix: fixed 360 px width (or left-align the stack's
   left edge to the widest visible toast) and keep the "+N more" pill flush.
9. **Code nits.** `index.js dispose()` never resets `S.day / S.lastHours / S.tool / S._night / S.hadTick / S.settings`, so
   a dispose → init cycle (module reload) carries the old day count and tool. `Hud.notify` calls `_toastList()`
   (a `querySelectorAll`) twice per iteration of the trim loop. `.lc-settings` has `z-index: 6` but `.lc-info` none; fine
   today only because the info card is hidden — give the popover its own stacking context via the root instead.

## What already works
- The chrome finally says Lego: plate gradient + bevel + lip + ring reads as moulded plastic on day, dusk and night skies
  alike; the yellow brick active-tool button and red pause brick are exactly the accent language a shipped Lego game uses.
- Zero regressions in behaviour: toasts cap at 3 with a working "+N" pill, status line ellipsises above the bar, tooltip
  flips correctly at the screen corner (`x-mouse-tip-corner.png`), negative treasury turns red, sad face at 22 %, rain
  icon, moon at night, edge chevron on the minimap when the camera leaves the fitted window.
- Engineering is tight: dirty-flag minimap, geometry-tracked backdrop with a stable geometry count across re-stages,
  timers cleared on dispose, ≈ 0.2 µs idle update, 0 draw calls, 143 fps in every shot, 62/62 JSONs with `errors: []`.
