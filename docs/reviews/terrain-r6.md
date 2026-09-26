# terrain — round 6 critic review (B6/G11 root-cause pass)

**Score: 8.2 / 10 — FAIL** (pass needs ≥ 8.5, `errors: []`, within perf budget)

This round closes the B6/G11 lever opened by Wave B1/r5: round 5 proved terrain chunks contribute **no depth** to
any CSM cascade; this pass found **why**, fixed it, retuned the receiver bias it exposed, and re-verified with the
module + whole-game + roads/buildings batches. The change is two edits:

- `src/terrain/index.js`: `S.groundMat.shadowSide = THREE.FrontSide` on the ground material.
- `src/environment/index.js`: per-cascade `normalBias` (near keeps the old formula capped at 0.12; mid
  `min(texel*0.55+0.012, 0.22)`; far `min(texel*0.45+0.012, 0.42)`).

## Root cause (proven, not inferred)

Three.js renders shadow-map depth with the **opposite** side by default: `WebGLShadowMap.getDepthMaterial()` sets
`result.side = material.shadowSide ?? shadowSide[material.side]` with
`shadowSide = { FrontSide: BackSide, BackSide: FrontSide, DoubleSide: DoubleSide }`
(`node_modules/three/src/renderers/webgl/WebGLShadowMap.js` L51, L488). That back-face trick is safe for **closed**
solids; the terrain ground is an **open heightfield**, so from the sun every top face is a front face and the whole
mesh was culled out of the depth pass — no bias, radius or step height could ever matter.

Four independent pieces of evidence (all captures `errors: 0`, in `shots/terrain/waveB6/`):

| # | probe | result |
|---|---|---|
| 1 | depth dump through the live cascade cameras with an isolated terrain group (`probe-dump-quads-16h5.png`) | near cascade geometry coverage **BackSide 1.8 % vs FrontSide 100 %**; mid **1.1 % vs 97.2 %** |
| 2 | `renderer.renderBufferDirect` hook, terrain chunks only | `shadowSide=null` → every chunk drawn with `side=1` (BackSide) in all 3 cascades; `FrontSide` → `side=0` |
| 3 | live shadow-map readback (`readRenderTargetPixels` on `light.shadow.map`'s packed-depth colour attachment) | cascade-1 non-white coverage **1.9 % → 26 %** with the fix; A/B/A deterministic |
| 4 | r5's own cast/receive toggle isolation, now at a 12.9° sun terrace view | **14.3 % of pixels change** with terrain `castShadow` on/off (mean \|Δ\| 16.4/255, 42 % of pixels > 8/255) — r5 measured ≤ 1.5/255 as "sub-threshold" |

Not the cause (all already healthy per r5 and untouched): the CSM shader splice, the terrain `onBeforeCompile` /
`customProgramCacheKey`, `USE_CSM` defines, cascade frustum coverage, `depthWrite`, and the terrain geometry.

Secondary lever the fix exposed: with depth present, the old mid/far `normalBias` cap (0.45 m) **erased most of a
0.8 m riser's shadow band** (a zero-bias A/B moved 2.8 % of pixels vs 0.26 % for the side fix alone) — hence the
per-cascade retune above. All other shadow settings (`bias -0.00004`, radius, splits, maps) are unchanged.

## Numbers (this round, final code)

| batch | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `terrain` r6b (final code) | 12 | 143.6 | 4.17 | 58 | [] |
| `terrain` r6 (side fix only, old bias — A/B) | 12 | 143.2 | 6.13 | 58 | [] |
| **game** r9 (final code) | 20 | 54.5 | **10.77** | 855 | [] |
| `roads` r6 | 12 | 143.0 | 6.13 | 78 | [] |
| `buildings` r5 | 12 | 143.2 | 6.47 | 299 | [] |

- **Budget: PASS.** The shadow pass now renders the heightfield into all three cascades (8 chunks × 3, ~1.2 M tris
  each) and the whole game budget is unchanged within noise: game r9 `maxGpuMs 10.77` vs the pre-fix r7 `10.66`
  (r8, same fix at old bias, read 11.74 — run-to-run spread). No draw-call or triangle change in the game (855 calls).
- **Console errors: 0** across 68 fresh captures this pass. `modules: {terrain:"ok"}`.
- The bias retune is visibly conservative: r6 vs r6b differs only on the noon overview (mean \|Δ\| 0.5/255 on
  `terrain_default-12`, ~0 at 6.5/18/21.5 and in the closeup) — it deepens the existing terrace contour bands
  without inventing new structure or acne.

## r5's issues, re-checked

| # | r5 issue | r6 evidence | verdict |
|---|---|---|---|
| 1 | **No legible cast shadow from terrain onto terrain at any distance** | Root cause found and fixed; depth present in all cascades; toggle isolation 14.3 % of pixels (was sub-threshold); dawn overview now shows sculpted valley banks, hill flanks and a plateau shadow (`terrain_default-6h5`); game `overview-6h5`/`aerial-12`/`street-12` differ from pre-fix by 1.9–2.5 % of pixels in coherent shadow shapes | **FIXED** |
| 2 | **Overview/play-cam still flat, map-like** | Improved at overview (contour shadows + slope shadows at low sun; `terrain_default-6h5` vs r5 is clearly more three-dimensional). The play-cam **closeup is still flat** — a grazing 4.2 m eye over a 0.8 m-stepped plain, where riser shadows foreshorten to a few pixels | **PARTIAL** |
| 3 | **Diffuse NdotL real but close-range/oblique-only** | Unchanged (not this round's lever) | unchanged |
| 4 | "Pipe bar" look of long 0.8 m risers at grazing angles | Unchanged | unchanged |
| 5 | Process nit: uncommitted `heightgen` change | Committed in `0f0ea2d`; this round's edits ship in the B6 commit | **FIXED** |

### New checks

- **Acne:** none found. The ground now writes its own depth, so flat treads are the classic acne case; the near
  cascade keeps its acne margin (cap 0.12) and the mid/far retune is only −0.23/−0.03 m. The noon aerial
  (`shots/game/r9/aerial-12.png`) is clean; a night crop is pixel-identical to r5 (`crop-21h5-pre/post.png`);
  the `street-12` foreground asphalt region is unchanged (mean \|Δ\| 0.01/255 vs pre-fix).
- **Peter-panning/attachment:** building shadows on terrain are unchanged in the game batch (the terrain being a
  caster does not alter other casters).
- **Regression modules:** roads r6 and buildings r5 sit on terrain in their showcases and are clean; the whole-game
  batch covers props/traffic/zoning/simulation composites.
- **Hygiene:** no new randomness (`Math.random` still comment-only), `src/terrain/` still exactly its six files,
  no new per-frame allocations in the fix (a material flag + one bias formula).

## Ranked remaining issues (most damaging first)

1. **Play-distance cascade coverage.** `updateCascades()` gives the near cascade `c1 = max(12, min(140, 0.06D+6))`
   — at every play distance (D 30–200 m) that is a **12 m** depth slice, so terraces beyond 12 m are shaded from the
   mid cascade at 0.48 m texels with a 0.22 m normalBias. The r5-era P3 figure ("near 2048 @ ±53 m, texel ~5 cm at
   play distance") only ever applied to the first 12 m of the view. Next lever: raise/bias the near split (needs its
   own environment round; it touches every module's shadow sharpness) and/or give the mid cascade a 4096 map (A/B'd
   this pass: no *visible* gain at the closeup, so not landed).
2. **The play-cam composition itself.** `terrain:closeup` stands at +4.2 m over a nearly flat plain; at 12–18h the
   0.8 m risers project to thin bars with their shadow bands edge-on. A closeup framed on the plateau-rim terraces
   (2.0 m steps) or a slightly higher eye would read the new capability far better. This is a preset/composition
   change, not a shading one.
3. **Noon plains are physically sub-pixel.** At the 62° noon sun a 0.8 m riser casts a 0.4 m band — nothing will
   read at overview distance. Only longer-wavelength relief (1.2 m steps or a low rolling undulation) changes that
   picture, and heightgen grouping/roads pads make it a B1-scale change.
4. **Pipe bars** (r5 #4) unchanged; cosmetic.
5. **Sub-4 m closeup NdotL** (r5 #3) unchanged.

## What works well (reconfirmed)

- The module's headline defect is genuinely closed: terrain now participates in its own shadowing at every distance,
  with three independent instrumentation paths plus a toggle isolation proving it (not just "looks softer").
- The fix is one material flag plus a conservative bias retune; the whole-game cost is inside noise and `errors: []`
  holds everywhere (68 captures).
- Water, shores, stud LOD, chamfered plate look and the 20-call budget are unchanged; no regressions in the other
  modules' batches.

**Verdict:** score 7.4 → **8.2**. The root cause is fixed and independently proven, which was the frontier blocker
for two rounds; the remaining 0.3 to a pass is composition (closeup framing) and coverage (near-cascade split /
longer-wavelength relief), both named as the next levers. Per the B6 acceptance this is a documented best-effort
close — the item is not silently absorbed.
