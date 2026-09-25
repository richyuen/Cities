# transit — critic review, round 2

**Score: 8.5 / 10 — PASS** (pass needs ≥ 8.5 **and** `errors: []` **and** inside perf budget — all met).
Round 1's three player-reachable defects are resolved where it mattered: the shipped game's stops now take their
line colour at boot (verified numerically on the live `instanceColor` array), night stop lights are per-line tinted
instead of white blobs, and the route ribbon now reads as the line's red at every angle and tod. One of the five
claims is only **partially** fixed (the ground ring no longer hangs over the carriageway, but it still sinks below
the 0.17 m pavement studs, which bite visible notches out of it), and the new macro preset exposes a pre-existing
geometry interpenetration (the pole cap pokes through the sign plate as a grey brick by day / black notch by night).
Those two close-range nits are why this is 8.5 rather than higher; neither breaks the module's readability or the
shipped-game loop the way r1's defects did.

## Numbers

| set | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `shots/transit/r2-critic/` (default, 4 presets × 4 tods) | 16 | 143.4 | 6.70 | 122 | 0 |
| `shots/transit/r2-critic-night/` (variant `night`, 4 presets × 6.5/21.5) | 8 | 143.0 | 6.39 | 120 | 0 |
| `shots/transit/r2-critic-extra/` (my 20 custom-camera/probe captures) | 20 | — | — | — | 0 |

- **Console errors: 0** in both batch summaries (`["errors": []]`) and in all three probe sessions
  (`window.__city.stats().errors === []`). No page errors, no rejected requests.
- **Budget**: transit's own cost is unchanged from r1 — 4 instanced stop roles + 1 ribbon per line (+1 hidden draft)
  = 6 draw calls for the 1-line showcase, against §7's budget of 12. The 120–122 whole-scene peaks are the shared
  backdrop (terrain/environment/roads/traffic/effects), as in r1.
- gpuMs ≤ **6.70 ms** (budget 20), minFps **143.4** (budget 50), maxTriangles 2.84 M across the module batch.
- `--variant night` is again a deterministic duplicate of the default staging (the variant only pauses the clock at
  staging; `tools/critic.mjs` re-stages the tod), so its 6.5/21.5 rows reproduce batch 1 and serve as a second pass.
- `Math.random`: **0 hits** in `src/transit/`; folder contains only its own 4 files.
- Contract unchanged: `id: 'transit'`, `deps: ['roads','traffic']`, order 55, `showcase`, `update`, `dispose`,
  `showcaseVariants`, all four `transit:*` presets, and the documented `api` surface.

## Fix verification (my own evidence, not the change log)

Probe: full game (seed 1) booted via `openApp`, then the same page switched to `showcase('transit')`; live arrays
read from the page, PNGs under `shots/transit/r2-critic-extra/` (`probe-instancecolor.json` has the raw dumps).

| # | claim | independent evidence | verdict |
|---|---|---|---|
| 1 | `refreshLineMembership()` calls `refreshStops()` so boot stops take line colour | Live full-game read at boot: `transit-stop-sign` and `transit-stop-ring` each `count: 6`, `instanceColor` = `[0.55201, 0.021219, 0.011612]` = linear 0-255 **[141,5,3]** for **all six** stops, `allEqual: true`. Line A is `#C4281C` (linear [141,5,3]); grey `#C7C7C7` would be [146,146,146]. All six stops report `lineIds:[1]`, line 1 `stopIds:[1..6]`, `keys:12`. Visually red in `fullgame-demo-stop-day.png`, `fullgame-demo-stop-quarter-day/-night.png`. Source: `refreshLineMembership()` now ends with `refreshStops()` (index.js:182), covering `createLine`/`removeLine`/`rebuildRoutes`/`loadState`. | **FIXED** |
| 2 | Night sign/ring emissive tinted by per-instance line colour; white face carries the glow | Live night materials: sign `emissiveIntensity: 0.9`, ring `1.1`, face `0.55`, ribbon `0.85` (day: 0/0/0/0.35); sign/ring emissive is white and the fragment splice multiplies `totalEmissiveRadiance` by `vColor` (models.js:67-78). Visually: the night sign is **red** with a lit white face, the rings are **red**, no white blob anywhere — `r2-critic/transit_stop-21h5.png`, `r2-critic/transit_aerial-21h5.png` (four red rings), `r2-critic-night/transit_closeup-21h5.png`, `r2-critic-extra/showcase-sign-quarter-night.png`, `fullgame-demo-stop-night.png`, `fullgame-demo-stop-quarter-night.png`. | **FIXED** |
| 3 | Ring shrunk to radii 0.55–0.95 m so it fits the sidewalk | `models.js:44` is `RingGeometry(0.55, 0.95, 24)`, anchored 1.05 m behind the curb, so the outer edge stays ~0.10 m off the carriageway — confirmed in `showcase-ring-roadside-day.png`, `showcase-ring-alongside-day.png`, `showcase-ring-topdown-day.png`, `fullgame-demo-stop-quarter-day.png`: the band is entirely on the sidewalk, no arc hovers over the road. **But** the ring plane is `stop.y + 0.05` (sidewalk top + 0.05), still below the **0.17 m pavement studs**, so studs occlude/interrupt the annulus: `showcase-ring-close-day.png` and `-night.png` (studs bite through the band), `showcase-ring-topdown-day.png`, `r2-critic/transit_aerial-18.png` and `r2-critic-night/transit_aerial-6h5.png` (each ring shows a white bite), `fullgame-demo-stop-quarter-day.png`. | **PARTIALLY FIXED** (road overhang gone; stud piercing remains) |
| 4 | Ribbon roughness 0.9 / clearcoat 0.05 / persistent emissive 0.35 day, 0.85 night; 0.56 m wide | Live material read (full game and showcase): `color c4281c`, `emissive c4281c`, `roughness 0.9`, `clearcoat 0.05`, `emissiveIntensity 0.35` (day) / `0.85` (night); source width `0.56`. Visually red at every angle I tried: grazing day/night `showcase-ribbon-graze2-day.png` / `-night.png`, top-down `showcase-ribbon-topdown-day.png`, street-level `r2-critic-night/transit_closeup-6h5.png`, loop `r2-critic/transit_aerial-12.png`. No lavender/mauve anywhere. | **FIXED** |
| 5 | New `transit:stop` 3.5 m macro preset | Registered (index.js:562) and exercised as the 4th preset × 4 tods in both summaries (`transit_stop-6h5/-12/-18/-21h5.png`). It frames the sign/face at ~3.7 m, fov 40 — the best stop view the module has. Nit: the comment claims it shows "the ground ring", but the pole base sits below the frame bottom in all four captures, so the ring is not in the shot. | **FIXED** (composition nit) |

## Remaining / new ranked issues

### 1. Ground ring is still sliced by the pavement studs (half of r1 issue 3 was not addressed)
- **What**: the annulus is fine at 0.55–0.95 m, but it sits only 0.05 m above the sidewalk surface while the
  pavement studs are 0.17 m tall, so every stud standing on the band pokes through it and hides its section. From
  above the ring reads as a red "C"/bitten circle rather than a ring; at night the dark studs chop the glowing band.
- **Where**: `r2-critic-extra/showcase-ring-close-day.png`, `showcase-ring-close-night.png`,
  `showcase-ring-topdown-day.png`, `showcase-ring-alongside-day.png`; `r2-critic/transit_aerial-18.png`
  (all four rings show the bite), `r2-critic-night/transit_aerial-6h5.png`,
  `r2-critic-extra/fullgame-demo-stop-quarter-day.png`.
- **Why it hurts**: the ring is the module's ground-contact element and the only stop part visible from an aerial
  preset; "ring with studs punched through it" is exactly the kind of clipping a Blox game must not ship.
- **Fix**: raise the ring's local y from 0.05 to just above stud height (~0.20), or clip/drape it to the sidewalk
  polygon, or offset it away from the stud grid. Keep the new radii; the road-overhang fix works.

### 2. Pole cap interpenetrates the sign plate — grey brick by day, black notch by night
- **What**: `bevelBox` is bottom-origin in y, so the sign plate spans y 2.2–2.76 while the pole cap sits at
  2.6–2.72 and pokes ~0.035 m through the plate's front face. In the new macro framing it reads as a small grey
  brick stuck in the plate's upper face; at night, with the plate glowing line-coloured, it is an unlit black square
  in the lightbox. (The white face plate also sits in the plate's lower half rather than centred, reading as a
  separate white brick stuck on the front rather than an inset panel.)
- **Where**: `r2-critic-extra/showcase-sign-cap-day.png` (unmissable), `showcase-sign-front-night.png`,
  `showcase-sign-quarter-night.png`, `fullgame-demo-stop-night.png`, `r2-critic/transit_stop-21h5.png`,
  also `r2-critic/transit_stop-6h5.png`.
- **Why it hurts**: it is the module's hero prop at the range the new preset invites you to inspect; a black square
  inside a glowing sign reads as a hole/error, not a bracket.
- **Fix**: place the kit in explicit local space — plate centred at ~2.48, cap top ≤ 2.5 or moved behind the plate
  (z ≤ −0.02), face plate centred on the plate; a 10-minute geometry pass in `models.js`.

### 3. Minor — `transit:stop` frames the sign but not the ring it promises
- **Where**: `r2-critic/transit_stop-6h5.png`, `-12`, `-18`, `-21h5.png` — the pole leaves the frame bottom in all
  four; the ring is never visible.
- **Why it hurts**: the preset exists to sell the stop marker; the r1 issue it was meant to evidence (ring/ground
  contact) is the one part missing from the frame.
- **Fix**: aim at the pole base (`target y ≈ stop.y + 0.9`, camera ~3.5–4 m out and ~1.5 m up) or pull back to 5 m.

### Informational, not scored
- `transit:default` / `transit:aerial` still render stops as a few pixels — mitigated by the new macro preset.
- The ribbon still reads as a flat painted overlay by design (it is one); its hue is now correct, which was the
  actual r1 complaint.
- Wave C5 gaps (fares, route-number plates, rider/queue visuals, figure-eight boarding) are not counted, per brief.
  Nothing new was found on those paths this round.

## What already works

1. **The shipped-game colour pipeline is now correct end-to-end.** I re-ran r1's exact repro (full-game boot, no
   interaction) and read the live `instanceColor` array: all six demo stops are [141,5,3] = Line A red, not grey,
   with correct line membership and a 12-key loop. `fullgame-demo-stop-day.png` / `-quarter-night.png` show the
   red sign + ring on the actual demo streets.
2. **Night identity is fixed and colour-coded.** Sign plate and ring glow the line's red (1.1/0.9), the white face
   glows warm white (0.55), the ribbon glows red (0.85); no white stop glow remains in any of the 8 night-batch or
   6 night-probe PNGs. The "multi-line unreadable at night" blocker is gone by construction (per-instance tint).
3. **Ribbon hue stability + clean perf.** Roughness 0.9 / clearcoat 0.05 / persistent emissive keeps the band solid
   red at grazing angles day and night (`showcase-ribbon-graze2-day/-night.png`), matching the ring and sign; and
   the module remains error-free at 143 fps / ≤ 6.70 ms GPU / 6 own draw calls (budget 12) across 24 batch shots and
   21 probe captures.

*Evidence sets: `shots/transit/r2-critic/` (16 + summary), `shots/transit/r2-critic-night/` (8 + summary),
`shots/transit/r2-critic-extra/` (20 PNG + JSON sidecars + `probe-instancecolor.json`). Probe scripts live under
`C:\Users\ryuen\AppData\Local\Temp\opencode\`; nothing in `src/` or `tools/` was modified.*
