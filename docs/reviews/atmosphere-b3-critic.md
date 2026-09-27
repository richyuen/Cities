# atmosphere (Wave B3) — critic review

**Scores: environment 8.8 PASS (was 8.7) · audio 8.7 PASS (was 8.6) · roads 8.8 PASS (hold) ·
terrain 8.5 PASS (was 8.2 FAIL) · effects 8.6 HOLDS · game 8.8 HOLDS** — pass needs ≥ 8.5, `errors: []`, inside
perf budget (≥ 50 fps, gpuMs ≤ 20, drawCalls ≤ 1500). All met on my own runs.

This is a fresh, skeptical re-measure of the four atmosphere nits plus the terrain r6 framing lever. I re-derived
every model number in an independent Node probe, re-ran every batch into new dirs, read the PNGs myself, and
isolated the shipped change against the pre-B3 game batch (`shots/game/r18`, commit `f2a7d13`) — the pass is
**substantively honest and the fixes are real**, with four caveats ranked below (the biggest is a wrong
"night untouched" claim, not a visual defect). The god-ray drop is the right call. Terrain's r6 FAIL is closed by
the framing lever, not by hand-waving: the near-cascade split was independently A/B'd in-page and genuinely
produces no visible gain at noon, and the fallback "pixel-identical" wording is the only overstatement.

## Numbers (my own runs — idle GPU checked with `nvidia-smi` before every batch, one headless browser at a time)

| set | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `shots/atmosphere/b3-critic/env/` (environment r7, 3 presets × 4 tods) | 12 | 143.4 | 5.24 | 53 | `[]` |
| `shots/atmosphere/b3-critic/audio-rain/` (audio r5, variant rain, 4 × 4) | 16 | 143.7 | 4.81 | 107 | `[]` |
| `shots/atmosphere/b3-critic/audio/` (audio r5, default, 4 × 4) | 16 | 143.6 | 5.38 | 100 | `[]` |
| `shots/atmosphere/b3-critic/roads/` (roads r6, 8 presets × 4 tods) | 32 | 143.0 | 5.83 | 78 | `[]` |
| `shots/atmosphere/b3-critic/terrain/` (terrain r8, 3 × 4) | 12 | 143.4 | 5.77 | 58 | `[]` |
| `shots/atmosphere/b3-critic/effects/` (effects r3 regression, 4 × 4) | 16 | 143.2 | 6.20 | 76 | `[]` |
| `shots/atmosphere/b3-critic/game/` (game r20, 5 presets × 4 tods) | 20 | **60.1** | **16.25** | **847** | `[]` |
| `node tools/check-atmosphere.mjs` (re-run; builder dir preserved as `shots/atmosphere/b3-builder/`) | 7 captures | — | — | — | 19/19, `captureErrors []` |
| live probes (`shots/atmosphere/b3-critic/probe/`) | 20 captures + 3 cascade A/B sessions (9 captures) | — | — | — | `[]` |

- **Budget: PASS.** Full city 60.1 fps / 16.25 ms / 847 calls vs the r18 pre-B3 61.4 / 15.53 / 847 and the
  builder's r19 61.0 / 15.93 / 847 — all three within run-to-run noise (the min is `closeup-21h5`, the known
  worst shot). Module batches are vsync-pinned at 143–144 fps with 4.8–6.2 ms GPU. `gpuMs` is the truth.
- Builder numbers reproduce within noise everywhere (env 6.10→5.24, effects 5.76→6.20, roads 6.44→5.83,
  audio 5.30→5.38, rain 5.27→4.81, terrain 6.10→5.77, game 15.93→16.25).
- **Zero console errors** across all 124 fresh batch captures + 20 probe captures + 9 cascade-A/B captures + 7
  check captures; no request-failure noise. Hygiene: no `Math.random` in `src/environment`, `src/audio`, `src/roads`, `src/terrain`
  (`git grep` clean); no new draw calls anywhere (audio 107 = r3c 107, roads 78 = r4 78, terrain 58 = r6b 58).

## Per-nit verdicts

### 1. Dawn/dusk sky — FIXED (evidence strong on the dusk side, model-exact on the dawn side)

Independent Node probe (`skyMath.js`, all clear weather): chroma vs the raw ramps is ×1.500 at 2°/4°/6°,
×1.461 at 0°, ×1.452 at −2°, ×1.477 at 8.09°, ×1.342 at 12°, ×1.021 at 20°, and **exactly** ×1.000 at 22°,
22.1°, 25°, 45° (max |boost−raw| = 0 for every clear-sky channel at 22° and 45°). The sub-1.5 ratios below 2°
are the `Math.max(0, …)` clamp in `saturate()` (the blue channel of the orange horizon goes negative), not a
different curve. `saturate()` preserves luminance to 1e-9 and clamps at 0.

- **Rendered dusk (my own fresh capture, `shots/atmosphere/b3-critic/env/environment_sky-18.png`)** vs the
  pre-B3 `shots/environment/r5-critic/environment_sky-18.png`: the sun-side crop at (453,350,400,200) moves from
  mean chroma 33.9 / R−B +17.9 to **48.6 / R−B +37.0** — the builder's "+37 vs noon −34" claim reproduces exactly
  (my noon crop reads R−B −34.0, pixel-equal pre/post). The warmest 160 px block in the upper half moves R−B
  +54.4 → **+87.4**. The image reads as a real sunset band over the ridge, not pale cream.
- **Game-scale isolation vs `shots/game/r18`:** `overview-18` top-band sky diff = 8.9 mean |Δ| with 68.8 % of
  pixels > 8/255, dRGB post-warmer by +4 R / −9 B; `street-18` warm band +2. Meanwhile **`street-12` sky diff is
  0.032 meanAbs** — the noon no-op is real in pixels, not just in the model.
- **Live GPU path**: in-page reads of the sky dome uniforms (`probe/sky-uniforms.json`) match `skyParams()` with
  max error 0.000000 at every tod; live chroma ratios ×1.461 (e=0°), ×1.477 (8.09°), ×1.000 (43.8°, 62°).
- **Caveat A (ranked issue 1):** the source comment and check call the fix "night untouched" — false. The dawn
  factor is 1 for *every* elevation ≤ 6°, including night: at 21.5h (e = −49.2°) the live `horizonSun` is
  [0.0106, 0.0196, 0.0646] (chroma ×1.5 vs raw) and at 19h (e = −16°) ×1.5. Visually benign (deep-blue night
  renders unchanged to the eye; see `environment_sky-21h5.png`), but the claim is wrong and `check-atmosphere`'s
  "night zenith stays dark" only tests the zenith, which was never boosted.
- **Caveat B (ranked issue 2):** the three environment presets all look **away from the sunrise** at 6.5h
  (warmest block at x=1760, R−B −7), so the batch has no rendered dawn sun-side proof; my own sun-facing 6.5h
  capture (`probe/env-sunfac-6h5.png`) shows only modest warmth because the ramp's saturation lives in the last
  few degrees (the same camera at 18h e=0 — `probe/env-sunfac-18.png` — is strongly orange). Honest, but the
  dawn leg rests on model + live-uniform equality, not on a dawn hero crop.

### 2. God rays — attempted and DROPPED, correctly

`src/environment/godrays.js` does not exist; `git grep -i godray` matches only `tools/check-atmosphere.mjs:83`
(the negative assertion) and the builder report. My own diff of the retained A/B evidence:
`shots/atmosphere/b3-builder/rays-game-dusk-off.png` vs `rays-game-dusk-on.png` = 0.115 meanAbs, **0.027 % of
pixels > 8/255** (builder claimed ≤ 0.02 %) — visually identical to my eye; ACES compresses the additive veil
against an already-bright sky, and the existing bloom/road-glare at low sun already reads as a big vertical
streak (visible in the *off* frame). The design's §3 escape hatch allows the drop; the remaining lever (a
depth-aware post pass) is out of ARCHITECTURE §7. **Correct decision** — I would not have spent a builder round
on this nit either. (`rays-sky-17h7.png` vs `rays-sky-18.png` are two different tods, not an A/B pair.)

### 3. Puddles — FIXED at grazing/normal angles; still a flat tinted tile at steep aerial angles

Live material in `?showcase=audio&variant=rain` (8 puddle meshes, one shared material): `audio-puddle-v2|csm`,
`envMapIntensity 2.6`, `roughness 0.05`, `opacity 0.46`, `emissiveIntensity 0.12`, transparent, 0 new meshes and
107 draw calls (= r3c-rain 107). Crops I read:
- `probe/crop-puddle-post-12.png` vs `probe/crop-puddle-pre-12.png` (from `shots/audio/r3c-rain/audio_closeup-12.png`):
  pre is a flat, uniform pale-blue sheet; post shows soft luminance gradients and a dark reflected shape (scene/
  tree) inside the tile, and the rim is a soft edge cue instead of an additive wash. `audio-closeup-17h7.png`
  shows the sky reflection varying with tod.
- `probe/crop-puddle-aerial-post.png` vs `probe/crop-puddle-aerial-pre.png` (from
  `audio_aerial-12.png`): **near-identical flat cyan/teal rectangles** from 72 m. At near-normal incidence
  F0 × 2.6 ≈ 10 % reflects little, so the base tint still dominates — the r3 "tinted tile" read survives at
  steep angles (ranked issue 3). This is the design's chosen cheap lever and it matches the r3 fix suggestion,
  so it is not a pass blocker; a tod-tinted rim would close the last of it.

### 4. Roads sheen — FIXED within what is testable without the old material

Live surface material (`roads-surface`): `roughness 0.44`, `clearcoat 0.35`, `clearcoatRoughness 0.22`,
`envMapIntensity 1.1` — the design's constants, shipped. My causal isolation against the pre-B3 game batch:
`street-12` road region mean RGB [121,134,158] → [116,129,151] (uniform −6 on every channel), `street-18`
[93,83,105] → [87,74,95] (−6..−10). The same noon closeup road patch across rounds r3c (118.9/134.3/164.0) →
r4 (119.2/134.5/164.1) → r5/r6 (114.9/129.3/157.2) is a flat ~4–6 luma darkening, not a shape change.
Post-B3 noon across my r6 batch shows no preset blow-out (`roads_intersection-12.png` — all four arms the same
dark plate, crisp markings; `roads_closeup-12.png`), and low sun did **not** go dull: `roads_deadend-18.png`
and my `probe/crop-road-closeup-post-18.png` still carry a broad sky sheen. The r2/r4 complaint was *variance*
across angles; I can only confirm the post-state is consistent (I cannot render the old clearcoat 0.55 in-page
without editing src). Carried-over Issue 3 (straight-edged plate/UV tone steps) is untouched and still visible
under top-downs — unchanged from r4, not this pass's scope.

### 5. Terrain closeup framing — FIXED; the r6 framing lever is genuinely closed

Live preset geometry (my probe): eye **6.50 m** above ground, pitch **−2.95°**, fov **40**, target 68 m out
(the source is `px = xe + 8`, `tx = xe − 60`) at +2.2 m above ground — all match the report. Judged on pixels:
- `probe/crop-terrain-closeup-post-12.png` (from `terrain_closeup-12.png`) vs the pre-B3
  `probe/crop-terrain-closeup-pre-12.png` (from `shots/terrain/r6b/terrain_closeup-12.png`): the pre framing is
  dominated by foreground studs with the 0.8 m risers squeezed into thin bars high in frame; the post framing
  shows two broad, individually readable riser bands across the mid-ground at play distance.
- `terrain_closeup-18.png` (r8) is the strongest frame the module has produced: a golden-hour terraced plain
  with legible riser faces, band shading and the stud texture intact; `game/overview-18.png` shows the terrace
  contour bands at real city distance with the warm sky wash.
- **Near-cascade floor left at 12 m**: verified in source (`src/environment/index.js:266`,
  `c1 = Math.max(12, …)`) and live (closeup `maxFar = 1700`, `breaks[0] = 0.00706` ⇒ c1 = 12 m).
- **Near-cascade A/B re-derived independently** by temporarily swapping the live `csm.customSplitsCallback`
  in-page (no src edits; `probe/cascade-ab2/`): at the 12h closeup the 12→26 m change moves 0.22 meanAbs /
  0.072 % of pixels > 8/255 — **below** the same-session drift measured by capture→capture (0.30 / 0.31 %);
  at the 18h closeup it moves 0.71 meanAbs / 2.26 % > 8 (drift 0.23 / 0.15 %), i.e. a small but real dusk
  sharpening. At overview the 26 m floor is a structural no-op — `c1 = min(140, 0.06·D + 6) ≈ 81 m` at
  D ≈ 1246 m — which is why the builder's overview diff was exactly 0. **Drop defensible, "pixel-identical"
  overstated** (ranked issue 4); I could not reproduce their exact 0.054 meanAbs at noon (I get 0.22, still
  under noise).
- **Verdict: 8.5 PASS.** The r6 review's two named blockers were composition (closed, visibly) and the
  near-cascade split (A/B'd — not the visible lever at noon; a 2.3 % low-sun delta is available if a future
  pass wants it). What remains is the r6 issue 3 — noon plains are physically sub-pixel, only longer-wavelength
  relief changes it, and that is a B1-scale heightgen change explicitly named as the next lever. The r5-era
  "pipe bars" and sub-4 m NdotL nits are unchanged and cosmetic.

## Re-derived contract checks

- `check-atmosphere.mjs` **19/19** on my run, identical messages to the builder's `b3-builder/summary.json`
  (including the exact dusk crop R−B +37 and terrain eye 6.50 m) — but treated as one data point, not proof:
  I re-derived the model ratios, the live uniforms, the materials and the crops independently (above/below).
- Live reads: puddle `{envMapIntensity 2.6, roughness 0.05, opacity 0.46, emissiveIntensity 0.12,
  key audio-puddle-v2|csm}`; roads `{0.44, 0.35, 0.22, 1.1}`; terrain `{eye 6.5, pitch −2.95, fov 40}`;
  `environment:godrays` absent by scene traverse and by `git grep`.
- Weather interaction (Node): the boost is applied *before* the overcast collapse, so a low-sun sky under
  overcast/rain reads chroma 0.017/0.036 vs 1.23 clear — physically the right behaviour (a grey deck should
  stay grey), documented here so nobody expects a warm overcast dusk.
- Determinism/CC0: no `Math.random` in the four touched folders; the sky change is pure deterministic math;
  nothing serialized changed.
- Scene/perf: no new meshes or draw calls in any module (puddle count 8, material-shared; roads/terrain/sky are
  constant/uniform edits; preset-only terrain change).

## Ranked issues (most damaging first)

1. **"Night untouched" is false — the dawn factor boosts the sun-side horizon all night long.**
   `src/environment/skyMath.js:70` `dawn = 1 - smoothstep(6, 22, e)` is 1 for every e ≤ 6 including −49°;
   live at 21.5h the sky dome's `uHorizonSun` = [0.0106, 0.0196, 0.0646] (×1.5 chroma vs raw), 19h ×1.5,
   −6h twilight [0.53,0.18,0.10] → [0.67,0.15,0.03]. Visually benign (the night render is unchanged to the
   eye, `environment_sky-21h5.png`), but the code comment ("noon and night are untouched") and the check
   ("night zenith stays dark", which only reads the unboosted zenith) overstate the guarantee. **Fix:** either
   gate it (`dawn *= smoothstep(-6, 0, e)`) or reword the comment + change the check to assert the *horizon*
   at night stays within a chroma bound, so the contract is honest either way.
2. **No rendered dawn sun-side proof in the batch.** All three `environment` presets look away from the
   sunrise at 6.5h (`environment_sky-6h5.png`, warmest block R−B −7), and the game's 6.5h presets are
   top-down/high (`game/aerial-6h5.png`); the dawn leg is therefore model + live-uniform evidence, while the
   dusk leg has a rendered +37 crop. **Fix (evidence, not code):** add one dawn-facing shot to
   `tools/check-atmosphere.mjs` (point the camera at `clock.sunDir` like my `probe/env-sunfac-*.png`) or add a
   `environment:dawn`-azimuth preset, so the check measures both ends of the sweep the design named.
3. **Puddles are still flat tinted tiles from steep aerial angles.** `probe/crop-puddle-aerial-*` are near
   identical; the physical reflection is ~10 % at normal incidence and the `transBlue`/emissive base carries
   the read. **Fix:** tint the rim (`uRimColor`) from the current sky/tod like the r3 suggestion, or add a
   cheap view-angle-dependent sky term to `patchPuddle` in `src/audio/speaker.js`; accept-and-document is also
   reasonable since the audio showcase is the only place puddles exist.
4. **The near-split drop is documented as "pixel-identical" but is not.** My in-page A/B: 0.22 meanAbs /
   0.072 % > 8 at the noon closeup (below same-session drift 0.30 / 0.31 %), **0.71 / 2.26 % at the 18h
   closeup** (above drift 0.23 / 0.15 %). The drop is still defensible (small, and a structural no-op at
   overview where `c1 ≈ 81 m`), but the source comment `src/environment/index.js:262-265` and the report
   should say "no visible gain; ≤0.07 % (noon) / 2.3 % (dusk) of pixels moved > 8/255", and a future low-sun
   terrain pass could re-test the 26 m floor at dusk where it does something.
5. **Carry-overs, not this pass's scope:** environment's showcase test-rig terrain (disc/basin from aerial,
   flat near-zone, faceted ridge — rig-only, unchanged since r5); roads Issue 3 UV/tone steps; terrain's noon
   longer-wavelength relief (the named next lever), pipe bars and sub-4 m NdotL; audio's sparse aerial trees
   and plate/skirt seam; rain streaks at overview.

## What works

- **The atmosphere contract is now correct where it matters daytime.** Dusk is genuinely warm and noon is
  provably untouched: the game street-12 sky diff vs the pre-B3 batch is 0.032 meanAbs while overview-18's sky
  moves 68.8 % of pixels > 8/255 toward warm; the environment dusk crop reproduces +37 R−B exactly. The fix is
  9 lines of pure math in `skyMath.js`, live-verified on the GPU uniforms.
- **Terrain's showcase closeup is no longer the module's worst foot.** Two riser bands read at play distance
  at noon and a real terrace hero at 18h; the r6 framing lever is closed, the near-split lever was
  investigated with a real A/B (and my independent reproduction agrees on the no-visible-gain-at-noon
  conclusion), and the remaining gap is named.
- **Puddles finally carry a real reflection at normal/grazing angles** (soft gradients + a dark scene
  reflection instead of a painted cyan wash) with zero new meshes; **roads stay consistent** across noon
  presets and keep their low-sun sheen.
- **Process hygiene is clean:** `errors: []` everywhere (124 batch + 20 probe + 9 cascade-A/B + 7 check captures), budgets pass,
  no randomness, no draw-call growth, the check script is kept and reproducible, and the dropped experiments
  (god rays, near split) have retained evidence rather than silent removal.

## What I did NOT verify

- **No true pre-B3 A/B for the roads material** (would require editing `src/`): the angle-variance reduction
  is inferred from the uniform darkening in the game isolation and post-only consistency, not a same-camera
  old-material render.
- I did not re-run `tools/road-audit.mjs` (a material-constant change cannot affect topology) or any module
  outside the six scored here (`transit`, `civics`, `views`, etc.).
- I did not reproduce the builder's exact near-split diff numbers (0.054/0.000) — method and tod unknown; I
  report my own (0.22 noon / 0.71 dusk, methodology in `probe/cascade-ab2`).
- Cloud drift (`S.time` → `uCloudOffset`) adds sub-0.3 meanAbs noise in sky rows between any two sessions;
  diffs below that in sky-only regions are not attributed to code.
- No blind-judge run and no save/load test (no serialized state touched).

*Evidence: `shots/atmosphere/b3-critic/{env,audio,audio-rain,roads,terrain,effects,game}/`, the probe dir
`shots/atmosphere/b3-critic/probe/` (sky probe, uniforms, live reads, cascade A/B, crops, analysers), the
preserved builder dir `shots/atmosphere/b3-builder/`, and pre-B3 references `shots/game/r18/`,
`shots/environment/r5-critic/`, `shots/audio/r3c-rain/`, `shots/roads/r4/`. `shots/` is gitignored; nothing in
`src/` or `tools/` was modified and nothing was committed.*
