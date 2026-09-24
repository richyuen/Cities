# Whole-game review — round 1

**Score: 4.5 / 10 — FAIL** (fails on look, not on perf/errors/determinism)

Pass bar is score ≥ 8.5 AND `errors: []` AND perf within budget. Errors and perf both pass cleanly. The score fails
because the two most-used "look at your city" camera angles (`overview`, `aerial`) render the entire city as
illegible pale toothpicks in 3 of the 4 standard lighting conditions, and this is 100% reproducible from the
canonical `tools/critic.mjs --game` output itself — not an edge case I had to hunt for.

## How this was tested

- `node tools/critic.mjs --game --round 1 --dir shots/game/r1` → 20 shots (5 presets × 4 tods) + `summary.json`.
- 2 extra custom shots via a scratch script built on `tools/shot.mjs`'s `openApp`: a 3-waypoint flythrough from
  downtown to the waterfront (`fly1/2/3-*.png`) and 2 busy-avenue traffic angles (`traffic-avenue-*.png`).
- `node tools/shot.mjs --preset overview --weather rain:0.7 ...` and `--preset street --weather fog:0.7 ...` to spot-check weather.
- ~20 additional diagnostic screenshots (`shots/game/diag/*.png`) taken with custom camera objects passed straight to
  `window.__city.setCamera(...)` (same code path `tools/shot.mjs` uses — no source touched) to isolate the root
  cause of issue #1 below. Triangle/drawcall/fps numbers were pulled from the JSON sidecar of every shot.
- `grep -rn "Math.random"` across `src/` — 3 hits, all inside comments *about* not using it (`core/rng.js` header
  comment, `effects/index.js` explaining why it replaces three.js's internal `Math.random`-based noise texture,
  `demo/citygen.js` header comment). No actual call sites. Confirmed clean.
- Determinism: every fresh, unmodified page load at `seed=1` (~10+ loads this session) reported identical
  `treasury=$96,739`, `population=8,704`, `jobs=5,034`, `happiness=73%`, and visually identical building placement/
  colors. Only live traffic and (once the tod-change bug below is triggered) rendering artifacts varied — expected.

Perf (from `shots/game/r1/summary.json`): minFps 59.3, maxGpuMs 15.78, maxDrawCalls 774 — all within the ≥50fps /
≤20ms / ≤1500 budget from ARCHITECTURE.md §0 with real margin. Zero console errors across all 20+30 shots taken.

## Ranked issues

### 1. [CRITICAL, cross-module seam] `overview`/`aerial` presets render the whole city as thin pale toothpicks after any time-of-day change — the game's two primary "look at your city" shots are broken 75% of the time
**Where:** `shots/game/r1/overview-12.png`, `overview-18.png`, `overview-21h5.png`, `aerial-6h5.png`, `aerial-12.png`,
`aerial-18.png`, `aerial-21h5.png` (7 of the 8 overview/aerial shots in the official batch — only `overview-6h5.png`,
the very first shot taken in the whole session, is clean). Also `shots/game/diag/seq-overview-12.png` (exact
replay of the critic.mjs call sequence, independently reproduced).

**What it looks like:** every building's wide faces (walls, roof) disappear into the background; only a thin
vertical sliver survives per building, scattered across the whole city like a field of toothpicks. Terrain, roads,
water and the UI are unaffected — this is buildings only. At night the effect is nastier: windows read as
disconnected light specks with no building mass behind them.

**Diagnosis (as a critic, without touching source, using only `tools/shot.mjs`'s `openApp`/`setCamera`/`setTime`):**
- **Not missing/degraded geometry.** Dumped the `buildings` group's merged meshes via `page.evaluate` at the exact
  `overview` camera + `tod=12`: 5 batched meshes, all `visible:true`, `scale:[1,1,1]`, full-size bounding boxes
  (e.g. 590×55×527 m), opacity correct per material. Triangle counts across a `dist-300..1250` sweep at noon stay
  flat at ~17–18.5M regardless of whether the shot looks solid or is toothpicked. So the mesh is genuinely there;
  this is a shading/visibility problem, not a LOD swap or culling bug.
- **Distance-gated.** Same steep pitch as `overview`, scaled to different distances from downtown, at noon:
  300m and 500m (`shots/game/diag/dist-300-tod12.png`, `dist-500-tod12.png`) are perfectly solid. 700m starts
  breaking on the far (suburb) blocks while downtown itself stays solid (`dist-700-tod12.png`). 900m+ breaks
  downtown too (`dist-900-tod12.png`, matches the real `overview`/`aerial` distance of ~1246m almost exactly).
  Pure top-down at 400m (`topdown-12.png`) and a steep-but-close 300m shot (`closein-steep-12.png`) are both clean
  at every tod tested, including noon — so it is not simply "sun near-overhead = flat lighting."
- **Sequence-gated, not tod-value-gated.** A *fresh* page load straight at `tod=12` with `overview` applied as the
  very first camera call renders correctly (`shots/game/diag/fresh-overview-tod12-firstcall.png`,
  `c-order-time-then-cam.png` — both clean, 15.1M tris). But replaying the literal `critic.mjs` sequence — take an
  `overview` shot at `tod=6.5`, then (after any further camera/tod capture at all — tested with `closeup`, `aerial`,
  `street`, and even just a second isolated `overview`@`tod=6.5` capture in between) come back to `overview` at
  `tod=12` — reliably reproduces the break (`shots/game/diag/d1..d4-overview-12-*.png`, `seq-overview-12.png`,
  triangle counts jump to ~18.5M, all visually toothpicked). It is not tied to which preset came in between, only
  to "has a distinct camera/time capture already happened once this session." This points at some distance- or
  CSM-shadow-frustum-dependent state (sun/shadow cascade recompute, aerial-perspective/fog blend, or clearcoat
  env-map term — all owned by `environment`/shared `core/materials.js`) that is computed once, cached, and not
  correctly refreshed on the *next* camera+time change once the city is already large relative to the view.
- **Confirmed as the same underlying mechanism, much worse, with weather.** `overview` + `rain:0.7` at tod 15
  (`shots/game/r1/weather-rain.png`, taken completely fresh — not preceded by any other capture) washes the
  *entire* frame — terrain and water included, not just buildings — to a near-uniform flat pale grey with no
  buildings legible at all and, notably, **no rain streaks and no wet-road specular** anywhere in frame (REFERENCE.md
  explicitly wants "rain streaks, wet roads with reflections"). The equivalent `street` + `fog:0.7` shot
  (`weather-fog.png`) looks *good* — near buildings crisp, only genuinely distant buildings fade into the mist —
  confirming again that the same atmosphere/exposure system is fine up close and breaks specifically at
  overview/aerial-scale distances.
- **Not present on `skyline`, `street`, or `closeup`** at any tod tested, even though `skyline`'s camera distance
  (~940m in one axis) is comparable to `overview`'s — the differentiator is the steep look-down pitch of
  `overview`/`aerial` (camera far above, aimed down at the city) vs. the near-horizontal framing of the other three
  presets, consistent with a shadow-cascade-coverage or ground-footprint-dependent effect rather than pure camera
  distance.

**Why it's damaging:** `overview` and `aerial` are, by name and by convention in every city builder, the two shots
a player and every marketing screenshot will use to show off the city. A fresh page load happens to dodge it
(the very first capture in the session is clean), but the moment a player touches the time-of-day slider — which
sits front and center in the UI and auto-advances by default — and then looks at their city from a normal zoomed-out
angle again, the whole city turns into a field of sticks. This is not a rare edge case; it is the default
experience within the first minute of play.

**Fix suggestion:** whatever per-frame or per-camera-change state `environment` (or shared `core/materials.js`
clearcoat/env-map term) computes for distant, steeply-viewed geometry — CSM cascade split/frustum, fog-exposure
blend, or an aerial-perspective desaturation curve — needs to (a) actually depend on the *current* camera distance/
elevation every frame rather than a value cached from a prior camera pose, and (b) be capped so it never removes
more than a modest fraction of a surface's visibility even at extreme distance/steep pitch. Start by instrumenting
whichever of those three systems recomputes on `time:changed`/`camera:changed` and checking whether it uses a stale
camera reference.

### 2. [environment] Weather rain lacks the reference's signature look, and is far too destructive at distance
**Where:** `shots/game/r1/weather-rain.png`.
Beyond aggravating issue #1, "Rain" as a weather state shows no rain streak particles and no wet-road
specular/reflection anywhere in the frame — REFERENCE.md item 4 calls these out by name as the expected look. Right
now "Rain" just means "fog density and desaturation go up," which reads as a foggy day, not rain. Low priority
relative to #1 but should be fixed by `environment` once #1's distance-scaling problem is sorted, since right now
it's impossible to tell how much of the flatness is "rain" vs. "the same distance bug, worse."

### 3. [minor, props/traffic or cross-module] Traffic reads sparse from any wide/elevated angle
**Where:** `shots/game/r1/traffic-avenue-low.png`, `traffic-avenue-overpass.png`.
Both custom "busy avenue" shots (framed on the downtown-waterfront spine, the highest-traffic road in the demo)
show at most 1–2 visible cars in frame. Close/street-level shots (`street-12.png`, `street-6h5.png`) show 2–4
vehicles and read fine, so this is purely a density-at-a-distance issue: ~165 cars spread across a 1.5 km² city
with dozens of km of road reads as "mostly empty" from any zoomed-out or elevated view, which undercuts
REFERENCE.md's "a living city... traffic flows." Not urgent, but worth a pass once #1 makes overview/aerial usable
again to judge properly (right now it's hard to tell how much of the empty look at distance is also confounded by
issue #1).

### 4. [nit] Demand bars (bottom-left `R/C/I`) read as empty/near-empty in almost every static screenshot
Minor — likely correct behavior for a freshly-seeded, currently-balanced Day 1 city with low demand pressure (one
fresh unpaused load did show a partially filled R bar), not clearly a bug, but worth a builder sanity check since
an empty demand HUD in literally every screenshot of the review reads as "broken" at a glance even if the
underlying number is legitimately near zero.

## What already works well (and it's a lot)

- **Close/street-level rendering is genuinely AAA-with-nits.** `street-6h5/12/18/21h5.png` and `closeup-*.png` show
  correct Blox stud/bevel styling, glossy ABS clearcoat catching highlights, believable per-window emissive
  lighting that switches on convincingly through dusk→night (`closeup-18.png`, `closeup-21h5.png`), warm
  streetlight pools and headlight-lit buses at night, and a lovely dusk sky gradient (`street-18.png`). No
  z-fighting, no shadow acne, no flat/unlit materials anywhere at this range.
- **City composition is exactly the target brief.** The flythrough shots (`fly1-downtown-edge.png`,
  `fly2-midway.png`) show a dense, varied downtown core (mixed building colors and heights, not a repeated
  template), clean grid roads, a real bay/waterfront, and a visible transition to lower-density suburbs and an
  industrial belt — matches REFERENCE.md's "composition of a real city" bar convincingly at any range where issue
  #1 isn't active.
- **No seams found at any range I could actually judge clearly**: no floating/sunken buildings, no road/building
  misalignment, no props clipping into buildings, no zoning-color bleed through completed buildings, no traffic
  driving through obstacles, no UI overlapping the world awkwardly. Perf is comfortably within budget everywhere
  tested (worst case 59.3 fps / 15.78 ms GPU / 774 draw calls, all inside the ≥50fps/≤20ms/≤1500-call budget), and
  every one of the 50+ shots taken this session came back with zero console errors.
