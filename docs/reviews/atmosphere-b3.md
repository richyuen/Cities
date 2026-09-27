# atmosphere — builder report (Wave B3/V4: dawn sky, god rays, puddles, asphalt sheen, terrain closeup)

**What shipped:** a low-sun chroma boost so dawn/dusk skies stay saturated instead of washing to pale cream; puddles
that reflect the PMREM sky and scene objects instead of reading as tinted tiles; a calmer, less angle-dependent noon
asphalt sheen; and the terrain r6 closeup-framing lever (riser bands legible at play distance). The god-ray nit was
attempted and **dropped with evidence** (the design's §3 escape hatch).

> Evidence, not a pass — the independent critic re-measures in `docs/reviews/atmosphere-b3-critic.md`.

## What was built

- **Dawn/dusk sky (`environment/skyMath.js`).** New `saturate(c, k)` (push a colour away from its own luminance) and
  a `dawn = 1 - smoothstep(6, 22, e)` factor applied to the clear-sky ramps before the overcast collapse:
  sun-side horizon ×1.5 at ≤6°, away-horizon ×1.2, glow ×1.3; exactly 1 above 22° (noon untouched). Expected
  measured ratio 1.45–1.50 at ≤6°, 1.34 at 12°, 1.000 at 45° (see `check-atmosphere`). Rendered effect: the dusk
  sun-side horizon crop is R−B +37 vs noon −34, and `environment:sky` at 18:00 reads as a warm sunset
  (`shots/environment/r6/environment_sky-18.png`, `shots/atmosphere/b3/sky-dusk.png`).
- **Puddles (`audio/speaker.js`).** `envMapIntensity` 1.2 → **2.6**, roughness 0.015 → 0.05, opacity 0.5 → 0.46,
  emissive 0.3 → 0.12; the fresnel rim patch is softened from `0.25 + 0.9·rim` to `0.10 + 0.55·rim` (v2 cache key).
  The PMREM sky reflection now carries the wet read, changes with tod, and reflects scene objects
  (`shots/audio/r4-rain/audio_closeup-12.png` shows the mast reflected in the tile). No new meshes/draw calls.
- **Roads sheen (`roads/index.js`).** Surface constants per the design: roughness 0.38 → 0.44, clearcoat 0.55 →
  0.35, clearcoatRoughness 0.2 → 0.22, envMapIntensity 1.35 → 1.1. Noon and dusk plates read as the same dark
  surface (`shots/atmosphere/b3/roads-noon.png` / `roads-dusk.png`, `shots/roads/r5/*`).
- **Terrain closeup framing (`terrain/index.js` `closeupSpot()`).** Eye 4.2 → **6.5 m**, target 30 → 60 m out at
  +2.2 m, fov 48 → 40 — the r6 critic's "grazing eye foreshortens the 0.8 m risers" lever. A/B'd against five
  candidate framings (`shots/atmosphere/b3/terrain-framing-{A..E}.png`); `terrain_closeup-12.png` in the r7 batch
  now shows two riser bands at play distance.
- **God rays — attempted, dropped.** Built an environment-side camera-child additive fan (`godrays.js`: 8 lobes,
  low-sun/weather/edge fades) and A/B'd it at golden hour in the environment showcase and the full game. At
  strength 0.7 and 1.1 the contribution was ≤ 0.02 % of pixels over 8/255 (mean abs diff 0.065) — ACES compresses
  the additive veil against the already-bright sky, so it never reads as shafts. Code removed; see the review for
  the A/B evidence. The remaining lever is a depth-aware radial-blur post pass, which ARCHITECTURE §7 keeps out of
  scope.
- **Near-cascade split (terrain r6's other lever) — tried, dropped.** Raising the near-split floor 12 → 26 m
  changed under 0.02 % of pixels (mean abs diff 0.054 closeup / 0.000 overview); no evidence, so the old split is
  kept with the result documented in `environment/index.js`.

## Verification

`node tools/check-atmosphere.mjs` (new, kept): **19/19**.
- Model: chroma ratios ×1.452 (−2°), ×1.500 (4°), ×1.500 (6°), ×1.342 (12°); exact no-op at 45° for the horizon and
  glow; night zenith stays dark (luma < 0.05).
- Rendered: dusk sun-side crop chroma 48.8 with R−B +37 (noon −34); god-ray experiment absent; puddle material
  live-reads (2.6 / 0.05 / `audio-puddle-v2|csm`); roads surface live-reads (0.44 / 0.35 / 1.1); terrain closeup
  eye 6.50 m and pitch −2.9°.
- Captures all `errors: 0`.

Batches (idle GPU, one headless browser at a time): environment r6 **143.6 / 6.10 / 53**, effects r3
**143.2 / 5.76 / 76**, roads r5 **143.6 / 6.44 / 78**, audio r4 **143.0 / 5.30 / 100** + rain variant
**143.2 / 5.27 / 107**, terrain r7 **143.7 / 6.10 / 58**, game r19 **61.0 / 15.93 / 847** — all `errors: []`,
budgets pass (game within noise of r18's 61.4 / 15.53 / 847).

Screenshots read: `shots/environment/r6/environment_sky-18.png` (warm sunset), `shots/atmosphere/b3/sky-dusk.png` +
`sky-noon.png`, `shots/audio/r4-rain/audio_closeup-12.png` (mast reflection in a puddle) + `audio_aerial-12.png`,
`shots/roads/r5/roads_closeup-12.png`, `shots/terrain/r7/terrain_closeup-12.png`, `shots/game/r19/overview-18.png`.

## Known gaps / honest caveats

- The sky boost is *sun-side by construction* (horizonSun/away/glow); a dawn sky looked at from the anti-sun side
  stays cool/pale — physically expected, and the batch's fixed tods may land the camera away from the sun.
- The design named `effects` as a possible owner for the dawn grade; no effects change was needed — the finding
  was environment's tone and the fix stayed there (effects r3 is a regression check).
- God rays are not shipped; the report and the design's outcome record why (a real shaft pass is out of §7 scope).
- Puddles exist only in the audio showcase's rain variant (module scene), not the shipped game; the fix is honest
  for what the review judged.
- The audio batch's default variant contains no puddles, so a `--variant rain` batch was run as well
  (`shots/audio/r4-rain/`).
