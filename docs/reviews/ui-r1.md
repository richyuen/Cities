# ui — round 1 critic review

**Score: 7.5 / 10 — FAIL** (pass needs ≥ 8.5). Zero console errors, perf trivially within budget; the HUD is complete,
clean and functional, but it is a generic dark-glass dashboard with a handful of layout collisions and sub-11px type,
not yet a shipped Blox-game HUD.

## Numbers
| run | shots | minFps | maxDrawCalls | errors |
|---|---|---|---|---|
| `shots/ui/r1/` (default, 3 presets × 4 tods) | 12 | 143.0 | 34 (showcase backdrop; HUD itself is DOM, 0 calls) | `[]` |
| `shots/ui/r1-night/` (night variant) | 12 | 142.9 | 34 | `[]` |
| `shots/ui/r1/fullgame.png` (full game, overview, tod 15) | 1 | 143.8 | 44 total, all modules `ok` | `[]` |
| extra: `x-close-white.png`, `x-far.png`, `x-interact-stack.png`, `x-night-rain-neg.png` | 4 | 143.6 | 34 | `[]` |
| builder dev shots `dev-1/2/night/hidden/interact/interact2` | 6 | 143.7 | 34 | `[]` |

Per-frame cost measured in-page: `update()` ≈ 0 µs when nothing changes (all setters diff before touching DOM); minimap
rebuild 0.7 ms every 2 s; camera-marker compose < 0.05 ms. One `<style id="lc-ui-style">`, one `.lc-hud` root.
`grep Math.random src/ui` → none. Folder contains only its own files (`index.js, hud.js, styles.js, icons.js, minimap.js, showcase.js`).

## Contract check (ARCHITECTURE §2 + api list)
- `id: 'ui'`, `deps: []`, `order: 80`, `init/update/dispose/showcase`, `showcaseVariants: ['default','night']`, presets `ui:default/closeup/aerial` — all present and work with `--preset`.
- `api`: `notify, setInfoPanel, setTooltip, setStatus, setDemand, setStats, setTool, getTool, getSettings, setHudVisible` all present (+ `isHudVisible`). Verified live: `getTool()` returns `'road:street'` after showcase, `getSettings()` → `{quality:'high', studs:true}`.
- Events: subscribes `sim:tick, tool:selected, weather:changed, time:changed, world:cell, road:added/removed, terrain:changed`; emits `tool:selected`. All unsubscribed in `dispose()`, window key/pointer listeners removed, minimap click/camera listener removed, style tag removed.
- Emits an undocumented `settings:changed` event (not in §4). Needs a line in `docs/core-requests/ui.md` so the integrator can add it to the table; otherwise no consumer will ever listen.
- Spec completeness: top bar (money/pop/jobs/happiness with mood icon) ✓, weather/clock/day/speed/time slider ✓, grouped toolbar ✓, RCI bars ✓ (reads `payload.demand`, core request filed), toasts ✓, inspect panel ✓, tooltip (anchored + mouse-following) ✓, status line ✓, settings popover (quality/studs/HUD) ✓, minimap with click-to-move ✓, hide-HUD pill ✓.

## Ranked issues (most damaging first)
1. **Generic "dark dashboard" art direction — nothing about the chrome says Blox.** Every PNG. Panels are the same flat
   14 px-radius charcoal glass you would find in any web admin template; the only Blox cues are the 30 px logo brick and a
   5 px "studline" dotted stripe that reads as a perforation, not studs. A shipped Blox game HUD uses chunky rounded
   plastic slabs (brick-plate panels with real 2×N stud rows on the top edge, bevelled highlights), Blox-yellow /
   bright-red accent buttons with a glossy top highlight, and a rounder, heavier display face for numbers.
   Fix: make `.lc-panel` a plate — 2-tone plastic (dark-stone-grey body, lighter bevel `inset 0 2px 0 rgba(255,255,255,.18)`, `0 3px 0 rgba(0,0,0,.35)` bottom lip), replace `.lc-studline` with proper 8-px studs (radial gradient with highlight + shadow, pitch 16 px, sitting *on top* of the panel edge, not inside it); give active tool / speed buttons a glossy brick look; consider a rounded display font (e.g. system `"Segoe UI Black"`/`Arial Black` for values). Keep the glass blur, but the plastic must read.
2. **Settings popover collides with the open inspect panel.** `dev-interact.png`, `x-interact-stack.png`: both are
   `right:14px; top:82/86px; width 300/320` — the settings box paints over the inspect card and the card's "Notes" text
   leaks out beneath it (visible at y≈470–490). Fix: `toggleSettings(true)` should close the info panel (or slide it down
   below the popover: `.lc-settings.open ~ .lc-info { top: <settings height + 100px> }`), or anchor settings as a proper
   popover directly under the gear with a caret and give it `z-index` plus a click-outside/Escape close.
3. **Status line runs under the toolbar.** `x-interact-stack.png`, `x-night-rain-neg.png`: `.lc-status` is
   `left:142px; white-space:nowrap` with no `max-width`, so a normal-length message ("Highway: 48 cells, $96,000 – hold
   Shift…") disappears behind the centred toolbar. Same geometry also collides at 1366 px wide. Fix: `max-width:
   calc(50vw - 142px - 500px)` with `text-overflow: ellipsis`, or move the status line to sit *above* the toolbar
   (centre-bottom, y ≈ 900) where tool-context text belongs.
4. **Toast stack grows into the 3D centre.** `x-interact-stack.png`: five toasts reach y = 350 (a third of the screen);
   the long one wraps to two lines and is 420 px wide. Sticky toasts staged by the showcase never leave. Fix: cap the
   visible stack at 3 (collapse older ones into a "+2" pill), cap `min-width` lower and put a 1-line clamp with ellipsis;
   for the showcase, stage non-sticky toasts with a long `ms` so the real behaviour is exercised.
5. **Seven text styles are 10 px — below the 11 px floor.** Measured in-page: `.lc-city-sub`, `.lc-stat-label`, `.lc-day`,
   `.lc-rci-title`, `.lc-group-lbl`, `.lc-minimap-foot`, info-panel `h4`. Uppercase tracking helps but at 1080p on a TV
   they are hairline. `.lc-tool span` labels are 11 px at 85 % opacity. Fix: 11 px minimum for labels (12 px for the
   toolbar group labels), 12 px for the tool button captions at full opacity.
6. **Day counter increments when time is scrubbed backwards.** `index.js update()`: `if (hours < S.lastHours - 12) S.day++`
   — every night-variant PNG shows "Day 2" because the showcase set 21.5 then the tool set 6.5. Dragging the time slider
   from evening to morning will bump the day in the real game. Fix: only advance the day on a wrap driven by the clock
   (`ctx.clock` running, `!paused`, and `hours < lastHours` with `lastHours > 22`), or expose a day counter from core.
7. **Minimap legend and marker are unreadable.** Every PNG: four 8-px unlabeled colour squares next to "MAP" mean nothing;
   the camera dot is drawn at (x,z) even when the camera is outside the auto-fit window, so in `ui_aerial-*.png` it hangs
   on the bottom-right corner of the canvas with a cone that starts off-map. Fix: hover tooltips or tiny R/C/I/Road
   letters for the legend; clamp the camera marker to the canvas edge and draw the cone only when inside; draw the
   cone with a stroked outline so it reads on green.
8. **Icon set is uneven in weight and detail at 28 px.** `ui_default-12.png` toolbar: `Highway` (tiny green sign +
   converging lines) and `Path` (tan squiggle with a blob tree) are mush at size; `Inspect` is a bare white arrow while
   `Homes/Shops/Industry` are full-colour illustrations; `Dezone` is a dashed box. Fix: normalise to one style — solid
   coloured Blox-brick silhouettes with 1.5 px dark outline, no sub-2 px strokes, and give Inspect/Bulldoze the same
   colour treatment (magnifier on a yellow brick, yellow bulldozer already OK).
9. **Panels lose edge definition on the night sky.** `x-far.png`, `ui_*-21h5.png`: charcoal glass on a blue-grey sky at
   ~0.74 alpha; the 14 %-white border almost vanishes and the panels look muddy. Fix: raise border to 22 % and add a
   1 px darker outer ring (`0 0 0 1px rgba(0,0,0,.45)`) so the plate separates from any background; the plastic-plate
   treatment in #1 fixes this for free.
10. **Inspect card swatch is a flat gradient placeholder.** `ui_*.png` right panel: a 72-px red rectangle stands in for a
    building image. Fix: render the inspected building's colour as a 3-stud brick (CSS studs on the swatch) or ask the
    buildings module for a thumbnail; at minimum draw stud circles on the swatch.
11. **Code nits.** `minimap.rebuild()` walks all 65 k cells every 2 s even when nothing is dirty (0.7 ms; make it
    dirty-only, `markDirty()` already exists). `stageBackdrop.dispose()` leaks the 10 per-brick `bevelBox` geometries,
    the dash/window instanced geometries and leaf geometries on every re-stage (only `trunk.geometry` is disposed).
    Toast `setTimeout`s are not cleared in `dispose()` (harmless but sloppy). `setTooltip` does an innerHTML write then
    `offsetWidth`/`getBoundingClientRect` reads — one forced layout per tooltip change, acceptable; `tickTooltip` reads
    `clientWidth/Height` per pointer move — cache them on resize instead.

## What already works
- Zero draw calls, zero per-frame DOM churn: every setter diffs before writing, `update()` measures ≈ 0 µs idle; 143 fps in every shot; `errors: []` in all 35 JSONs.
- Complete feature set in one pass with a sane hierarchy: bold tabular numbers, muted uppercase labels, anchored toolbar tooltips clear of the group labels, pointer-following tooltip with edge avoidance, mood face reacts to happiness, negative treasury turns red, weather icon swaps to moon at night and to rain cloud on `setWeather('rain')`, time slider thumb tracks the clock, hidden-HUD pill.
- Renders correctly over the real world (`fullgame.png`): reads world stats, minimap paints terrain/water for the real 256² map with the camera cone; nothing clipped at 1920×1080; the 3D centre is clear when the toast stack is short.
