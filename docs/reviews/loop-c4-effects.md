# LOOP cycle 4A — effects: capture-mode tilt-shift/DOF + low-sun bloom discipline (builder report)

**Goal (falsifiable).** (1) A composer pass, OFF by default, enabled by `?dof=<0..1>` (clamped; 0.55 default),
that gives the miniature-diorama falloff of the reference shots; with `dof` absent/0 the pipeline is
pixel-identical to the pre-cycle code; +1-2 draws; full-city gpuMs ≤ 20. (2) The low-sun bloom factor that
shrinks the sunset skyline's residual sun column while night and noon are untouched.

**Owner scope:** `src/effects/` only, plus the approved new `tools/check-dof.mjs`. `src/core/`, other modules,
`ARCHITECTURE.md`, `index.html`, `package.json` untouched. (Environment's cycle-4B changes are in the working
tree uncommitted and are part of every baseline here.)

## 1. What shipped

### 1a. `src/effects/tiltShift.js` (new) + `src/effects/index.js`

A screen-space focus-band (tilt-shift) pass: distance from a horizontal focus line (`focusY`, mild 0.5-weighted
horizontal bow so the side edges blur too) drives a 16-tap golden-angle disc blur with a centre-weighted kernel,
rotated per pixel by interleaved gradient noise (deterministic function of `gl_FragCoord` — no time, no
`Math.random`, no history). Inside the focus band (`focusRadius` 0.14), or at strength 0, the shader returns the
input texel untouched; the pass is **not constructed at all** unless a strength > 0 is requested.

Chain placement (stated because it is the load-bearing decision):

```
RenderPass -> GTAO -> Grade -> UnrealBloom -> OutputPass(ACES+sRGB) -> TiltShift -> SMAA -> screen
```

DOF sits **after ACES, before SMAA**: bloom and the single tone-mapping step see exactly the image they see
today (the sun column's bloom fuel is a linear-HDR property, not a focus property), SMAA stays last so the sharp
focus band keeps its edge AA, and blurring the tone-mapped LDR image is the cheapest stable placement (no depth
pass, no bokeh pipeline). It ping-pongs across the two existing composer targets; **+1 draw call** when on, 0
when off.

Flags / API:
- `?dof=<0..1>` — clamp; absent/`0`/NaN = off; bare `?dof` = the 0.55 default; `?dof=5` → 1.
- `?dofy=<0..1>` — focus line in vUv (default 0.5), same clamp.
- `effects.api.setDOF(strength[, focusY])`, `getDOF()`, `setSunBloom(on)`, `getSunBloom()` (see 1b).
- Defaults: `focusRadius` 0.14, `falloff` 0.42, `maxRadius` 18 px at 1080p (height-scaled), strength 0.55.

### 1b. Low-sun bloom discipline (`applyTime`)

Measured hero state (skyline @17.7, e = 4.864°): automatic bloom was strength **0.2737** / threshold 1.1976, and
of the frame's ~4400 clipped-white px (min channel ≥ 253) ~2500 exist only because bloom adds on top of the
avenue specular (`probe/str0.png` — same session as an auto capture that clipped 4504 px — holds 1867 clipped
with bloom strength pinned to 0). The discipline multiplies the **automatic strength** by `1 - 0.6 * f(e)` with

```
f(e) = (1 - smoothstep(e, 2°, 14°)) * smoothstep(e, -1.5°, 0.5°)
```

exactly 0 at night (e ≤ -1.5°) and at/above 14°, 1 at low-but-up sun; the threshold and radius are untouched,
and an explicit `api.setBloom({strength})` override bypasses it (documented). `?sunbloom=0` (and
`api.setSunBloom(false)`) disables it for A/B attribution. Elevation comes from `ctx.clock.sunElevation` — the
same value `environment.api.state.elevation` reports (`e = clock.sunElevation / DEG`) but taken at event time:
environment applies its state in `update()` (set `dirty` in the event), so reading the state getter in the
`time:changed` handler would be one frame stale for exactly the paused-`setTime` + capture pattern the tools use.

## 2. Gates

| gate | result |
|---|---|
| `node tools/check-dof.mjs --out shots/effects/r4/check` | **41/41** green (new tool; see §3) |
| `node tools/check-beauty.mjs --out shots/beauty/c4dof` | **37/37** (new dir; `v5`/`set6-smoke`/`c3c` not touched) |
| `node tools/check-atmosphere.mjs` | **22/22** — rendered dusk crop chroma 48.8 > 30, R−B +37 vs −34, all asserts unchanged |
| `node tools/critic.mjs --module effects --round 4 --dir shots/effects/r4` | 16 shots, **errors 0**, minFps 142, maxGpuMs 6.73, maxDrawCalls 76, budget all true |
| `node tools/critic.mjs --game --round 48 --dir shots/game/r48` | 20 shots, **errors 0**, minFps 92.6, maxGpuMs **10.34**, maxDrawCalls **934**, budget all true |
| game baseline diff `r47 → r48` | meanAbs 0.2037; intended changes only at low sun: skyline-18 1.4973, closeup-18 0.98, street-18 0.56, overview-18 0.38; every 6.5/12/21.5 shot ≤ 0.13 (drift scale) |
| beauty `c3c → c4dof` | 01-skyline-golden 0.9075 (intended discipline), 04-closeup-golden 0.28 (intended), 02/03/05 ≤ 0.01 (drift) |

No `errors` and no `warnings` in any capture JSON of this cycle (scanned every `.json` under
`shots/effects/r4`, including `ab/`, `check/`, `identity/` and the perf probes).

## 3. `tools/check-dof.mjs` — what it asserts (41 checks)

(a) **off = strict no-op**: two fresh boots (dof absent vs `?dof=0`) on the static effects showcase are
byte-identical (`meanAbs 0.0000`, `pctOver 0.0000`, maxDelta 0); same-session on→off toggle returns to the exact
frame; `dof on→off` in the full game also returns to the exact frame. (b) **on ≠ off**: showcase meanAbs 4.08 /
30.6 % of px >2/255; full-game sunset meanAbs 2.64 — both far above the 0.30 drift budget; blur falls off
toward the edge (bottom-band gradient 0.615x showcase, 0.547x game) and the focus band stays sharp (0.997x /
0.986x, mid-band meanAbs 0.06). (c) **errors []** at both settings (all captures). (d) **pass presence**:
`getPasses().dof` exists only when enabled, listed directly after OutputPass with SMAA last, `+1 draw call`
exactly (874→875 game, 73→74 showcase). Plus: temporal stability (two frozen on-captures identical), the
factor/strength arithmetic `off === on / (1-0.6·factor)` exactly, the column clip reduction, and the noon/night
frozen-frame identity with the discipline on/off (meanAbs 0.0000). Flag semantics: `?dof=5` clamps to 1,
`?dof=-3` and `?dof=abc` off, bare `?dof` = 0.55, `?dofy=0.3` moves the line.

**Pixel-identity to "today" (pre-cycle code).** `git stash` of `src/effects` → capture 5 presets frozen with
`sunbloom=0` (pre code ignores the unknown flag), unstash → same captures with `dof=0&sunbloom=0`:
`tools/diff.mjs` = **meanAbs 0.0000, pctOver 0.0000, maxDelta 0 on all 5 files**
(`shots/effects/r4/identity/{prefrozen,postfrozen}`, `diff-frozen.json`). The cross-session (unfrozen) version
of the same comparison is 0.031 meanAbs / ≤0.24 % >2/255 — pure vehicle drift floor, since a frozen camera on
unchanged code is bit-exact (0.0000). The shipped sunset differ only if `sunbloom` is on *and* the sun is low —
that is the intended deliverable 2, quantified below.

## 4. A/B numbers

Captures: `shots/effects/r4/ab/` (fresh boots, URL flags, `--preset ... --tod ... --hud 0` staging) and the
frozen pairs in `shots/effects/r4/check/`. "clip" = min(R,G,B) ≥ 253; "near240" = min ≥ 240; all sunset clip
pixels lie in the avenue column band (x 360-760).

| skyline @17.7 | clip px | clip % | near240 | gpuMs | draws |
|---|---|---|---|---|---|
| pre-cycle `pre/skyline-17.7.png` (before this cycle) | 4398 | 0.212 | 15644 | 7.84* | 869* |
| shipped (discipline on, dof off) `ab/skyline-off.png` | **2980** | **0.144** | **11438** | 7.73 | 874 |
| discipline off (same session control) `ab/skyline-sunbloom-off.png` | 4285 | 0.207 | 15549 | 7.94 | 874 |
| discipline on + `?dof=0.55` | 2873 | 0.139 | 11225 | 8.02 | 875 |
| discipline off + `?dof=0.55` | 4127 | 0.199 | 15286 | 8.27 | 875 |

\* pre values from the pre-cycle capture (`shots/effects/r4/pre/skyline-17.7.png`); the same-session control
(4285 vs 4398 = −2.6 %) is the drift floor, so the **column clip share drops ~32 %** (near-white ~27 %) from the
discipline, not from session drift. The r47→r48 sunset game shot confirms it at e≈0°: near-white 4851 → 4387
(−9.6 %), clip 90 → 87.

DOF on/off, same staging (frozen sim in `shots/effects/r4/check`, standard staging in `ab/`):

| preset | meanAbs (on vs off) | gradient ratio 0.88-1.0 band | gradient ratio 0.40-0.60 band | gpuMs off → on | draws |
|---|---|---|---|---|---|
| skyline 17.7 | 2.64 | 0.547 | 0.983 | 7.73 → 8.02 (+0.29) | +1 |
| overview 12 | — (band ratios: 0.51 bottom / 0.98 centre) | 0.510 | 0.982 | 7.06 (on) | +1 |
| aerial 6.3 | — (0.55 / 1.00) | 0.553 | 0.996 | 6.85 (on) | +1 |
| closeup 17.7 | 1.58 | 0.611 | 0.974 | 7.83 → 8.15 (+0.32) | +1 |
| street 21.5 (night) | — (0.74 / 0.98) | 0.737 | 0.982 | 10.32 → 11.13 (+0.81) | +1 |

Max full-city gpuMs with DOF on: **11.13 ms** (≤ 20), draw delta exactly +1 everywhere (≤ +1-2 budget).
The wider table of per-band gradient ratios is in `shots/effects/r4/_tools/wide-grad.mjs`.

## 5. What I looked at (PNGs, all read)

* `shots/effects/r4/pre/skyline-17.7.png` and `ab/skyline-off.png` — the hero before/after the discipline.
* `ab/crop-col-pre.png` / `-shipped.png` (1.3x): pre = two huge white blobs washing out the avenue's
  buildings; shipped = smaller, warmer cores, the buildings behind the column now read through the glare.
* `shots/effects/r4/check/game-sunset-off.png` / `-on.png` / `-sunbloom-off.png` — shipped/dof/discipline-off.
* `ab/crop-sunset-off-bl.png` / `-on-bl.png`: bottom foreground — on is creamy soft (studs and tanks melt
  gently), no banding, no ghosting, window glows spread smoothly.
* `ab/crop-dof4x.png` (4x zoom of a strongly blurred region): smooth, no dither structure, no ringing.
* `shots/effects/r4/check/showcase-on.png` — textbook tilt-shift diorama on the effects showcase.
* `check/game-night-on.png` — night street: foreground soft, mid-frame (storefronts, car) sharp, night window
  glow untouched (the discipline is exactly 0 at night).
* `check/game-closeup-on.png` — hospital closeup: subject legible/sharp, crosswalk + left background fall off.
* `ab/overview-noon-dof55.png`, `ab/aerial-dawn-dof55.png` — wide shots: far-top and near-bottom bands soften
  0.51-0.55x gradient energy, the city core stays at 0.98-1.00x.

## 6. Residuals, risks, assumptions

1. **The sun column keeps its clipped specular core** (2880 px, 0.139 %): the bloom contribution is reduced by
   ~32 %, but the reflection itself still clips. Removing it entirely needs the road specular (roads/
   environment), not the composer — deliberately out of scope; the env review flagged the same lever.
2. **DOF is screen-space by design** (no depth): no occlusion handling, but a pure blur mix cannot ghost or pull
   hidden content into view, and it is temporally exact (two frozen on-captures byte-identical). A depth-based
   bokeh was judged unjustifiable: GTAO's depth is already there but a depth-varying-radius disc blur would
   couple cost to content and risk halos at silhouettes for a *capture-mode* effect.
3. **Showcase perf anomaly (not attributable).** In 2 of 4 perf sessions the effects showcase gpuMs stepped
   from ~4.5 to ~6.7 ms after the first DOF construction and did not revert; the pass was never rendered in one
   of those sessions, `draws`/`programs` were unchanged, and a third interleaved run (including a raw
   `ShaderMaterial` create+dispose control) showed no step; the full game never showed it and the game DOF
   deltas are ≤ 0.3 ms across off/on/on/off repeats (`shots/effects/r4/_tools/perf-*.mjs`). Recorded as noisy
   session/GPU variance, not as a pass cost.
4. **The discipline only scales the automatic strength** — explicit `setBloom({strength})` overrides bypass it
   (intended: pinned debug/A-B values stay pinned).
5. **Tuning knobs** if the orchestrator wants a stronger or weaker capture look without code: `?dof` strength,
   `?dofy` focus line; the band geometry (`focusRadius` 0.14 / `falloff` 0.42 / `maxRadius` 18 px) is
   module-level and one-line tunable. At 0.55 the effect is a measured 0.5x edge-gradient reduction with the
   subject band untouched; 1.0 roughly doubles the radius.
6. ARCHITECTURE §7 not edited (owner scope) — the one-line post list change (add "tilt-shift DOF, capture-mode,
   `?dof`") is left to the integrator.
