# tools — round 2 critic review

**Score: 8.7 / 10 — PASS** (both round-1 blocking issues are genuinely fixed and independently verified live
against the exact ARCHITECTURE.md §7 numbers, not just eyeballed from screenshots; perf is excellent; zero
errors; only cosmetic nits remain)

## Numbers (from `shots/tools/r2c/summary.json`, my own critic batch — presets × tod {6.5,12,18,21.5}, now 5
presets including the builder's new `tools:vclose`)
- errors: `[]` across all 20 shots, and across my own separate live-interaction + live-material-readout script
  (see below) — zero console/page errors anywhere.
- minFps: 89.4, maxGpuMs: 9.02ms (budget ≤20ms — comfortable), maxDrawCalls: 91 (full-city cap 1500; tools' own
  ghost meshes are still only 3 draw calls), maxTriangles: 3,785,288.
- Perf verdict: **pass** (fpsOk/gpuOk/drawCallsOk all true per `summary.json`'s budget block).

## What I did
1. Re-read `ARCHITECTURE.md` §7 (bloom thresholds: red/blue emissiveIntensity ≥4, yellow/white 2.5–3; bloom pass
   itself is `UnrealBloomPass` with threshold ≥1.0 luminance, deliberately "subtle" per spec — strength 0.22
   (day)/0.3 (night), radius 0.25) and `docs/REFERENCE.md`'s deduction table.
2. Ran `node tools/critic.mjs --module tools --round 2c --dir shots/tools/r2c` (5 presets × 4 tods = 20 shots,
   including the builder's new `tools:vclose` preset).
3. Looked at every one of the 20 `r2c` PNGs, plus the builder's `shots/tools/r2-dev/` shots including the
   diagnostic true-~2.8m `extra_vclose-daylight.png` / `extra_vclose-night.png` / `extra_vclose-canvasdirect.png`
   / `extra_vclose-puppeteer.png` (did not overwrite any of them).
4. **Live material verification** (own Puppeteer script driving `tools/shot.mjs`'s `openApp()`, via `page.evaluate`
   against the real running app, not static analysis): scanned `ctx.materials.cache` for every live `glass:*`
   ghost material at tod 6.5/12/18/21.5, and cross-checked `ctx.clock.isNight` per tod. Confirmed:
   - `ctx.clock.isNight` is `false` at 6.5/12/18 and `true` only at 21.5 (so "night" = the 21.5 sample, as in r1).
   - At night: `glass:transRed` → `emissiveIntensity: 4.5` (spec: ≥4 for red/blue — **met**, verified on a live
     material object, not just read from source). `glass:lime` (the "valid" ghost) → `emissiveIntensity: 2`
     (see nit #1 below). Luminance check on that value: lime's RGB (0.647, 0.792, 0.094) × 2 → weighted luminance
     ≈1.42, comfortably over the bloom pass's night threshold of 1.0, so it still clears the actual bloom
     trigger despite sitting under the yellow/white 2.5–3 number.
   - At day (6.5/12/18): `glass:transRed` → `0.3`, `glass:lime` → `0.15` — both intentionally low, confirmed
     **no overblow/clipping** in any noon (`tod=12`) shot (`tools_default-12.png`, `tools_zone-12.png`,
     `tools_closeup-12.png`, `tools_vclose-12.png`, `tools_bulldoze-12.png`): the red/lime/yellow ghosts render
     as soft pastel plates, never a blown-white or neon-saturated patch. This confirms the builder's claimed
     "day/night gating fix" is real and effective, not just asserted in a comment.
   - Forced fresh hover-ghosts via real `ctx.events.emit('tool:selected', ...)` + real `PointerEvent`
     `pointermove` (not internal function calls) for `bulldoze` at both tods: read `0.3` (day) → `4.5` (night) off
     the actual mesh material in the live scene graph, confirming `refreshGhostEmissiveForTime()`'s
     `time:changed` re-application genuinely works end-to-end.
5. **Re-ran the round-1 real dispatched-PointerEvent interaction pipeline** (own script, `page.mouse`-style
   `PointerEvent`s on the live `<canvas>`, click coordinates computed by projecting known world points through
   the live camera): confirmed no regression —
   - `road:street` drag grew `world.roads.edges` (a `Map`) from size 2 → 3 and deducted real money
     ($42,440 → $36,840).
   - Forcing `world.stats.money = 0` then repeating a road drag was correctly rejected (money stayed exactly 0,
     no new edge implied by the unchanged zero balance).
   - `zone:c` paint drag set 18 real cells to `zone === 'c'` via zoning's real API, with a real cost deduction
     ($36,840 → $35,130).
   - `bulldoze` on the real remaining showcase building removed it for free (`world.buildings.size` 1 → 0).
   - Zero console/page errors across this entire run (no repeat of r1's one-off intermittent zoning shader flake).
6. Code review: `git diff`-equivalent read of `src/tools/index.js` / `src/tools/showcase.js` in full. Confirmed
   `ghostEmissiveIntensity()` is a single shared table (exported from `showcase.js`, imported by `index.js`) used
   by **every** ghost-material call site (`ghostMat()` and `addDecorativeRect()`) — the r1 defect (two independent
   hardcoded `0.35`s) can't recur by construction now. Grepped for `Math.random` (none). Confirmed folder still
   only contains `index.js` + `showcase.js`. Confirmed the new `tools:vclose` preset is honest about
   `MapControls.minDistance = 4` rescaling it away from a true close-up, and that the true ~2.8 m verification
   was done via a separate diagnostic camera override (matches what I independently did too).

## Ranked issues (both minor, neither blocking)

1. **(Minor) `lime`'s night `emissiveIntensity` (2) sits outside the letter of ARCHITECTURE §7's two named
   buckets (red/blue ≥4, yellow/white 2.5–3) — "valid" is a third state the spec doesn't explicitly price.** The
   code comment justifies this (lime's high green channel would clip to a blown-out bar under the day exposure
   at higher values), and I confirmed by luminance math that intensity 2 still clears the night bloom threshold
   (≈1.42 vs. a 1.0 cutoff) and reads clearly as glowing in `tools_vclose-21h5.png`/`extra_vclose-night.png` — so
   this isn't a "no emissive life" defect in practice, just a value that isn't literally one of the two numbers
   §7 names. If a future pass wants to be pedantic about it, nudging night lime to ~2.5 while re-checking for
   clipping would close the letter-of-the-spec gap; not worth blocking on.
2. **(Cosmetic) The boosted `transRed` ghost reads as a warm coral/orange glow rather than a pure "red" glow at
   night** (`tools_bulldoze-21h5.png`, `tools_default-21h5.png`) — an artifact of ACES tone-mapping compressing a
   saturated-but-dim base red once its R channel is pushed to ~3.5 by the ×4.5 multiplier. This is a normal,
   expected look for boosted-red neon under filmic tone mapping (not a bug), and it still unambiguously reads as
   "hot/glowing" against the dark scene, but a purist might want it to stay more clearly red than orange. Not
   worth chasing for this module.

Neither issue reaches the deduction bar in REFERENCE.md's table (no missing studs, no z-fighting, no flat/unlit
materials, no wrong sun direction, no console errors, no perf-budget violation), so I'm not treating them as
blocking — hence PASS at 8.7 rather than a bare 8.5.

## What already works well (round 2 specifically)
- **Both round-1 defects are fixed for real, not just in the screenshots I happened to look at.** I verified the
  exact live `emissiveIntensity` values on real `MeshPhysicalMaterial` instances pulled out of the running app's
  material cache and off live ghost meshes after real synthetic hover events — `transRed`/`transBlue` hit the
  spec's ≥4 floor at night (4.5), and the day values are deliberately low enough that noon shots show zero
  overblow anywhere I looked (all 5 presets at `tod=12`).
- **The "valid" lime ghost is now unambiguously legible at the range that matters.** At true ~2.8 m
  (`extra_vclose-daylight.png`, `extra_vclose-night.png`, `extra_vclose-canvasdirect.png`) it fills the frame as
  a saturated yellow-green with a crisp boundary against both bright and dark grass — nothing like the r1
  "pale colourless wash" complaint.
- **The interaction pipeline and isolation guards are still rock solid after the material changes** — re-verified
  independently with real dispatched `PointerEvent`s rather than trusting the builder's own claim: road build
  (with correct cost + insufficient-funds rejection), zone paint (real zoning API, real cost), and bulldoze (real
  building removal) all work exactly as in r1, zero regressions, zero errors.
- **Perf headroom is enormous and hygiene is clean**: 89.4 min fps / 9.02ms max GPU time against a 20ms budget,
  91 draw calls against a 1500 cap, no `Math.random`, folder contains only its own two files, and the new
  `tools:vclose` preset is honestly documented rather than silently faking a camera constraint violation.
