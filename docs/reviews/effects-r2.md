# effects — round 2 critic review

**Score: 8.6 / 10 — PASS** (pass needs >= 8.5). Every ranked round-1 issue is fixed or resolved at the boundary; what's
left is genuine nits, not damage. The post stack now visibly and correctly elevates the image: real contact AO, clean
AA, bloom that only fires on emissives/night and stays contained, and a tone-mapping path that agrees with itself
whether the composer is on or off.

## Numbers
- `shots/effects/r2c/summary.json` (default variant, 4 presets x tod {6.5,12,18,21.5} = 16 shots): `errors: []`,
  minFps 99.6, maxGpuMs 9.96, maxDrawCalls 76, up from r1's 53 (real `environment` — shadows, sky, PMREM — is now in
  the shot, not the fallback rig; see below).
- `shots/effects/r2c-night/summary.json` (night variant, same matrix): `errors: []`, minFps 123.3, maxGpuMs 7.22,
  maxDrawCalls 85.
- `shots/effects/r2c-extra/*.json` (18 additional shots: on/off pairs at noon/night for two presets, dawn on/off,
  AO debug x2, quality tiers x3, macro 2.5 m, far overview, resize x3, dispose, determinism x2): `errors: []` in
  every file, no warnings.
- **Showcase now runs on real lighting.** `src/main.js:32-34` auto-adds `environment`+`effects` to any showcase's
  module set when they're loaded, regardless of a module's own `deps: []` — this is the integrator fix for r1 issue
  #1. Confirmed: shadows, sky gradient, PMREM reflections and a genuinely dark starry night are present in every r2
  shot (`r2c/effects_default-21h5.png` vs r1's flat fallback-lit night).
- **Draw-call delta**: on/off pairs at noon (closeup 75/55), noon tower (73/53), night (night preset 81/61, tower
  83/63) — a consistent **+20** for the whole post stack, comfortably inside the brief's +25 allowance.
- **GPU cost**: quality tiers at the same closeup camera, noon: low 6.64 ms, medium 6.97 ms, high 8.59 ms (macro
  2.5 m closeup peaks at 9.35 ms). All well under the 20 ms/50 fps full-city budget.
- **Determinism**: re-staging the same showcase/tod twice (`r2c-extra/determinism-a-18.png` vs `-b-18.png`) is
  *not* byte-identical, but a pixel diff shows only 3.3% of pixels differ, by at most 8/255, average 1.2/255 —
  invisible to the eye, almost certainly GPU float/draw-order noise rather than a seeded-RNG leak. `grep Math.random
  src/effects` still only hits comments describing what three's stock GTAO code would have done. Folder still holds
  only `index.js`, `grade.js`, `showcase.js`.
- Resize (1920->960->1920) and dispose (`rec.module.dispose(ctx)`) both clean: no stale buffers, `getRenderFn()
  === null` after dispose, group removed, zero errors (`r2c-extra/resize-960.png`, `after-dispose.png`).

## Round-1 issues, verified

1. **No real lighting in showcase — FIXED (at the integrator level).** `src/effects/index.js` still declares
   `deps: []`, but `src/main.js` now force-includes `environment`+`effects` for every showcase. All 32 r2c(+night)
   shots show correct sun shadows, a real sky gradient and a genuinely dark, starry night.
2. **AO barely there — FIXED.** New `AO_PARAMS` (`radius 0.7, thickness 1.5, distanceFallOff 0.3`, `AO_INTENSITY
   1.0`, `AO_POWER 2.5`) produce real, correctly-placed occlusion: `setDebug('ao')` at closeup and at a custom 2.5 m
   macro camera (`r2c-extra/ao-debug-closeup.png`, `ao-debug-macro.png`) shows strong, clean darkening in the inside
   corner and under the cantilevered orange brick, with no denoiser smear or silhouette halo. In the final composited
   image the contact shadow is intentionally subtle (`ao-macro-shaded.png` — a soft dark line where the white plate
   meets the overhang above it) rather than an obvious dark halo, which reads as correctly tuned rather than
   invisible: a pixel diff between quality-low (AO off) and quality-high (AO on) at the same closeup camera shows 37%
   of pixels differ (avg delta 49/255) — some of that is MSAA toggling on/off between tiers, but cropping directly
   into the AO test corner (`r2c-extra/crop-low.png` vs `crop-high.png`) still shows a visible extra wash on the
   inside corner and white-plate top that low quality lacks.
3. **Sky rendered differently with post on vs off — FIXED.** Dawn on/off pair at the tower preset
   (`r2c-extra/dawn-tower-on.png` / `dawn-tower-off.png`) is pixel-for-pixel the same washed pale sky with post on
   or off. (The dawn sky itself is still weak/pale rather than warm — but that's `environment`'s tone, already
   tracked in `environment-r1.md`; it is not a double-tone-map bug, and effects should not be marked down for it.)
4. **Bloom too heavy / lamps bloom in daylight — FIXED.** Noon on/off pairs at closeup and tower
   (`r2c-extra/noon-tower-on.png` vs `-off.png`) show no lit windows, no lamp glow, no sky lift — bloom only engages
   at night. Night on/off pairs (`night-tower-on/off.png`, `night-night-on/off.png`) show a soft, warm glow that
   hugs the window/lamp silhouette with no halo bleeding into the sky, thanks to the new per-mip `BLOOM_MIP_TINTS`
   taper.
5. **Showcase geometry bugs — FIXED.** No interpenetration visible at the mediumStoneGrey/brightOrange seam in any
   closeup (`r2c/effects_closeup-12.png`, `-21h5.png`, macro shots) — the two bricks now butt cleanly. Tower plate
   bands sit in the gap between every second window row across all 7 floors at both noon and golden hour
   (`r2c/effects_tower-12.png`, `-18.png`) with no frame clipping. Windows are dark at noon everywhere checked.
6. **Night preset/variant not distinct — FIXED.** `effects:night` is now a low, close camera on the main tower with
   the night-variant's second (white) tower and extra lamp posts in frame (`r2c-night/effects_night-21h5.png`), and
   the night variant genuinely differs from default (second tower, ~9 lamps vs 4, higher lit-window chance) —
   confirmed side-by-side against `r2c/effects_default-21h5.png` (single tower, 4 lamps).
7. **Code nits — FIXED.** `setBloom({threshold})` now persists via `S.bloomOverride` and is re-applied inside
   `applyTime()` on every `time:changed`, instead of being silently discarded. `resize()` no longer calls
   `applyQuality()` (only `applySizes()`), so the sample-count compare/dispose in `applyQuality()` only runs when
   quality actually changes. The two `rng.fork()` calls are now intentional and documented (one per showcase
   variant, so re-staging keeps a stable window pattern per variant). Determinism is now effectively solved (see
   Numbers).

## Remaining issues (nits, ranked)

1. **Quality tiers conflate AO and MSAA.** `QUALITY.low` turns off both `gtao` and MSAA (`samples: 0`) at once, so
   the visible low-vs-high difference is dominated by antialiasing, not AO — a viewer comparing tiers casually would
   credit the jump to AA, not to the GPU time GTAO actually costs. Suggest giving `low` its own MSAA sample count (or
   keeping samples:4 across all tiers) so the AO-specific quality delta can be judged in isolation.
2. **Raw GTAO buffer shows grain on grazing-angle flat faces** in `setDebug('ao')` view (`r2c-extra/ao-debug-macro.png`,
   upper-right window band) — invisible in the final composited image because `pow(ao, 2.5)` crushes near-1 values
   back toward white, but it means the denoiser's noise floor isn't fully clean; worth a look before this quality
   tier's cost is trusted for a lower `pd.samples` in future tuning.
3. **Sub-pixel determinism drift.** Re-staging the identical showcase/tod twice produces a ~3.3%-of-pixels,
   ≤8/255 diff (see Numbers). Not visible, not worth blocking on, but if `r1`'s determinism concern needs to be
   fully closed out, worth confirming whether it's instanced-draw order or a GPU timing/precision artifact.
4. **Dawn/golden-hour sky is still pale and low-contrast** in every effects showcase shot at tod 6.5
   (`r2c/effects_default-6h5.png`) — confirmed identical with post on/off, so this is `environment`'s tone, not a
   effects regression; flagging only so it isn't mistaken for a returned effects bug.

## What already works

- **AA is still excellent**: MSAA x4 + SMAA gives crisp stud rims and brick bevels from 2.5 m macro
  (`r2c-extra/macro-2h5m.png`) to full overview, with no jaggies visible anywhere in the 60+ shots reviewed.
- **Night is now a convincing Lego night**: deep blue sky with stars, warm window pools that read individually lit
  (not a single glowing slab), soft contained lamp glow, all correctly absent in every daytime shot.
- **Pipeline plumbing remains correct**: resize and dispose are clean, draw-call overhead is stable at +20 across
  every preset/tod pair tested, and quality tiers switch live with no errors.
