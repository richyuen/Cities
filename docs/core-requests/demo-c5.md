# Core/tools request — demo (LOOP cycle 5 set-piece siting)

Owner: demo builder, cycle 5. Nothing here blocks the demo work; each item has a workaround in use.

## 1. `tools/shot.mjs` / `tools/critic.mjs`: pass extra URL params from the CLI

**What.** Neither CLI forwards arbitrary query params (`buildUrl` supports `extra`, but `shot()` and `critic.mjs` never fill
it). The attribution baseline for cycle 5 is a `?nosp=1` game batch (set-pieces + their lot reservation + frame infill
off = the pre-cycle city), and the critic needs to run it with the repo tools.

**Why.** LOOP §2 asks intended changes to be toggleable and A/B'd *with the repo tools*. Today the only way to run the
`?nosp=1` batch is a driver script that imports `openApp` (what this builder did:
`scratchpad/c5d/critic-extra.mjs`, a line-for-line copy of critic.mjs's loop with `extra: { nosp: 1 }`).

**Minimal diff.**
```diff
--- a/tools/shot.mjs
+++ b/tools/shot.mjs
@@ export function parseArgs(argv) {
-      if (v === undefined || v.startsWith('--')) a[key] = true; else { a[key] = v; i++; }
+      if (v === undefined || v.startsWith('--')) a[key] = true; else { a[key] = v; i++; }
+      if (key === 'param') { (a.extra ||= {}); const [pk, pv = '1'] = String(v).split('='); a.extra[pk] = pv; }
@@ if (isMain) {
-  const opts = { ...a, out, tod: ..., seed: a.seed || 1 };
+  const opts = { ...a, out, tod: ..., seed: a.seed || 1, extra: a.extra || {} };
--- a/tools/critic.mjs
+++ b/tools/critic.mjs
-const app = await openApp({ showcase: ..., variant, seed: a.seed || 1, tod: tods[0], software: !!a.software });
+const app = await openApp({ showcase: ..., variant, seed: a.seed || 1, tod: tods[0], software: !!a.software, extra: a.extra || {} });
```
(`parseArgs` only keeps the last `--param`; for several, collect them as above into `a.extra`.)
Usage: `node tools/critic.mjs --game --round c5d-nosp --dir shots/game/c5d-nosp --param nosp=1`.

## 2. `tools/check-detail.mjs`: a `?nosp=1` census leg

**What.** check-detail's census hash (`e0f35033` before cycle 5) changes in the default city by design (3 set-pieces,
the garden house, the frame infill houses). Add a Part 4 that boots `extra: { nosp: '1' }` and asserts the census hash
equals the recorded pre-cycle value, so "set-pieces off = pre-cycle city" is a standing gate. The builder computed it
with an identical copy of `censusInPage`/`censusHash` (see the cycle report).

## 3. `tools/shot-list.mjs`: read the demo's set-piece registry

**What.** `window.__city.ctx.modules.get('demo').api.setPieces()` returns, per sited piece, `{ type, id, camera:
'hero'|'heroAlt', cam: { pos, target, fov }, occlusion, ... }`, and the demo registers presets `demo:sp-skate`,
`demo:sp-garden`, `demo:sp-farm` that return the chosen, occlusion-checked camera. Shots 01/02/04 can use those
presets directly (`--preset demo:sp-garden` etc.) instead of the finders.

Note for the 01 finder as it stands: set-piece props use kinds `fence_picket`, `bike`, etc., which are in the finder's
`C2` kind set, so the garden house (`demo-sp-garden-house`) may now win the "liveliest house" score on its own.

## 4. `tools/check-detail.mjs`: yard-sample stride exposes a pre-existing undressed lot

**What.** Check 2 samples `lots.filter((_, i) => i % stride === 0)` with `stride = floor(lots / 20)`. Adding the 26
set-piece buildings (garden house + frame infill; seed 1) changes `lots` from 441 to 467, so the stride shifts and the
sample now includes `b392` (apartment at (212, -548), beside the highway). b392 has **0** yard items in the
`?nosp=1` (pre-cycle) city as well (measured: only road_sign/streetlamp/traffic_light within 14 m), so
"every sampled lot has yard dressing" / "minimum yard items >= 1" fail on a lot the cycle never touched.

**Proposed.** Sample a fixed id list (the pre-cycle sample), or exclude lots whose `i % stride` membership changed,
or (better) fix b392's dressing in props (a highway-adjacent lot whose 1-6 m band is all verge/road). Not a demo
change: the demo cannot alter which lots the stride lands on without gaming the check.

## 5. Note for props (not a request to demo): authored picket runs

`setpieces.js` `run(..., 2.0)` splits a 9.8 m picket run into 5 × 1.96 m panels, below check-detail's 2.0 / 2.02 m fence
floor (8 pairs on the 24 m garden). The demo sites the garden at w = 24.8 so the runs come out at 2.04 m; a props-side
fix (`n = Math.floor(len / seg)`) would let any width pass.

## 6. environment/zoning: the zoning plates' look depends on whether a `building:spawned` (or road/prop/terrain) event fires after boot

**Finding (measured, seed 1).** The three `zoning:*` materials have no `USE_CSM` at boot; environment's `sweep()` adds
cascaded shadows to them only when a spawn/road/prop/terrain event (or the 2.5 s `sim:tick` safety net) triggers it.
In the critic batch the safety net always fires before the first capture (both cities show `111` at frame 120), but
the plates still render ~1.8 meanAbs differently on `overview-12` depending on whether the *boot itself* spawned
anything after zoning's first rescan: a nosp city plus one `refreshMaterials()` call reproduces the set-piece city's
plates to 0.098 meanAbs, and the same nosp city plus one added house differs from itself by 1.77. With the pulse phase
pinned and one `refreshMaterials()` before capturing, the full set-piece city differs from the nosp city by 0.1157 mean,
0.2415 worst (closeup-12) — i.e. all 20 shots are under 0.30 once this state is equalised
(`shots/game/c5d-pinned-sweep/`). This dominates the default-batch diff vs r49 / rc5crit-r2 (overview-12 1.88,
aerial-12 0.96, skyline-12 0.68, closeup-12 0.65 …), which are the zone-plate-heavy daytime shots.

**Proposed.** Make the sweep deterministic regardless of event history, e.g. run `sweep()` once at the end of boot
(after every module's init, before `ready`), or have zoning call `environment.api.setupMaterial()` on its materials
at creation. Either makes the attribution baseline independent of whether a module spawned anything late.

## 7. zoning pulse phase is session-dependent

`zoning.update` drives plate opacity from `ctx.clock.elapsed`, which advances every rendered frame (also while paused),
and `resetPresentation()` does not reset it. Two batches of the same build differ by up to 0.40 on night overviews
(`shots/game/c5d-nosp` vs `c5d-nosp-rep` / r49). Proposed: have `__city.resetPresentation()` also set
`ctx.clock.elapsed` to a fixed value (or let zoning read a presentation clock that the reset rewinds).
