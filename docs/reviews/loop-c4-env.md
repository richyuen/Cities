# LOOP cycle 4B — environment: low-sun disc discipline (builder report)

**Goal (falsifiable):** keep the gold-hour identity of the judged hero `shots/beauty/set6-smoke/03-skyline-golden.png`
(skyline @ tod 17.7, sun ~4.9° up) but stop the low sun from blowing out the frame: the sun disc's blowout and its
bloom fuel must shrink while the warm sky/dusk chroma measurements do not move.

**Owner scope:** `src/environment/` only. `effects` (composer bloom threshold/strength), `src/core/`, `tools/` untouched.

## 1. What changed (3 files, +21/−2)

`src/environment/skyMath.js` — `skyParams()` gains a soft, monotone low-sun disc extinction and a shared low-sun flag:

```js
p.sunDiscLow = 1 - smoothstep(2, 16, e);        // 0 exactly at/above 16°, 1 at/below 2°
const discExt = lerp(1, 0.15, p.sunDiscLow);    // 1 exactly at/above 16° (noon bit-identical)
for (let i = 0; i < 3; i++) p.sunDisc[i] *= discExt;
```

`src/environment/sky.js` — the dome's disc mask shrinks/softens at low sun, driven by the same `uSunDiscLow`
(0 = the original mask, bit-identical; 1 = tight mask):

```glsl
float discA = mix( 0.99988, 0.999925, uSunDiscLow );
float discB = mix( 0.99995, 0.999975, uSunDiscLow );
float disc = smoothstep( discA, discB, cosT ) * uShowSun * smoothstep( -0.004, 0.006, h );
```

`src/environment/index.js` — one uniform write: `u.uSunDiscLow.value = sp.sunDiscLow;`

Disc geometry (angular radius): full-radiance core 0.573° → 0.405°, fade-out 0.888° → 0.699° (fade-out disc area
×0.62). The **halo/glow** (`uGlow`, `uGlowG`, `uGlowK`, `horizonBoost`) and every horizon/zenith/cloud ramp are
untouched — the warm sky is the identity, the disc was the bloom fuel.

Resulting disc radiance (linear RGB, `[r,g,b]`) by elevation:

| e (deg) | sunDiscLow | k | sunDisc before | sunDisc after |
|---|---|---|---|---|
| −49 (night) | 1 (mask unused) | 0.150 | 6.00, 1.50, 0.30 | 0.90, 0.23, 0.05 *(uShowSun = 0 → not drawn)* |
| 0 (sunset) | 1.000 | 0.150 | 14.0, 5.00, 1.20 | 2.10, 0.75, 0.18 |
| 4.86 (**hero**) | 0.892 | 0.242 | 22.86, 12.19, 4.86 | 5.54, 2.95, 1.18 |
| 6 | 0.802 | 0.319 | 24.0, 13.75, 6.00 | 7.64, 4.38, 1.91 |
| 8 | 0.606 | 0.485 | 26.0, 16.5, 8.00 | 12.60, 8.00, 3.88 |
| 12 | 0.198 | 0.832 | 30.0, 22.0, 12.0 | 24.94, 18.29, 9.98 |
| ≥16 (noon) | 0.000 | 1.000 | raw | raw (bit-identical) |

## 2. A/B evidence (the commanded captures)

Both sides: `node tools/shot.mjs --preset skyline --tod <T> --hud 0` (seed 1, fresh load, settle 45); "pre" =
`src/environment` stashed back to HEAD (e26987f), "post" = this change. Metrics: **clip** = pixels within 2/255 of
white (min channel ≥ 253); **near** = min ≥ 240; **hot** = max ≥ 250; chroma = mean (max−min) over RGB.
Ad-hoc measurement scripts (PNG metrics, clip inventory, diff/region views, crops, capture and sweep drivers) are
in `shots/environment/c4/_tools/` (gitignored scratch, not repo tooling). The canonical pairs are `pre-<tod>` vs
`post-<tod>`; the extra `before-*`/`after*`/`pre2-*`/`post2-*` PNGs are exploratory and repeat sessions used for
the drift floor (the `after-*` set predates the final `uSunDiscLow` gating edit — do not diff it against `post-*`).

| tod 17.7 (hero) | pre `pre-17.7.png` | post `post-17.7.png` |
|---|---|---|
| full frame clip | 0.261 % (5411 px) | 0.212 % (4400 px) |
| full frame near ≥240 | 0.822 % | 0.754 % |
| sky band (top 45 %) clip | 0.220 % | **0.112 % (−49 %)** |
| sky band near ≥240 | 0.554 % | 0.402 % |
| sun crop (300,80,500,500) clip | 1.017 % | 0.612 % |
| sun crop chroma | 37.4 | 37.6 |
| full-frame mean chroma | 34.3 | 34.3 |
| sky-band mean chroma | 33.7 | 33.7 |

The clipped-pixel inventory (`clip-inv.mjs`) makes the attribution exact:

* pre: 5411 clipped px = **1011 in the sun disc (y 200–300)** + 4400 in the sun-column specular (y 426–987).
* post: 4400 clipped px = **0 in the sky** (first clipped row y = 426) + the *same* 4400-px column.
* Within 64 px of the disc centre (505,247): pixels at luma ≥ 250: **1910 → 808**; clipped (min ≥ 253): **1011 → 0**.

So the white sky blob is gone (no clipped sky pixel within 128 px of the disc), the sun column survives unchanged,
and the remaining frame clip is entirely the intentional specular reflection (owned by the composer's bloom
threshold — not edited here).

**Isolation / no-op proof.** Same-staging re-captures of unmodified code in this repo differ by 49–103 isolated
object pixels (drift floor; e.g. `pre-12 vs pre2-12` = 60 px > 2/255, `post-21.5 vs post2-21.5` = 103 px). Against
that floor:

| pair (skyline, hud 0) | px changed >2/255 | of which in sun crop | max delta |
|---|---|---|---|
| pre-17.7 vs post-17.7 | 6104 (0.294 %) | 6014 | 45 |
| pre-12 vs post-12 | 49 (0.0024 %) | 4 | 63 |
| pre-6.3 vs post-6.3 | 87 (0.0042 %) | 0 | 46 |
| pre-21.5 vs post-21.5 | 103 (0.0050 %) | 15 | 77 |
| pre-21.5 vs post2-21.5 (fresh sessions) | **0** | 0 | **0** |

* **Night = bit-identical render**: two fresh `--tod 21.5` sessions (pre vs post code) produce byte-equal PNGs
  (0 px, maxDelta 0). (The 103-px pre/post row above is vehicle drift of that one session; the unmodified-code
  floor is the same 103 px.)
* **Noon**: the module's applied uniforms at `e = 62°` are `uSunDiscLow = 0` exactly and `uSunDisc` equal to the raw
  `SUN_DISC` ramp to 0.0000 (read in-page) → the disc path is bit-identical at noon; the residual 49 px are
  isolated vehicle pixels in the lower half (identical kind/count to the same-code drift floor; 0 px in the sky).
* **6.3 sunrise**: sun out of frame in this preset; diff = drift floor.
* **Draw calls**: identical pre/post (869 @17.7, 928 @6.3, 809 @12, 857 @21.5); gpuMs 8.16→8.14 @17.7
  (7.99–10.39 across tods). No new draws, no new geometry, no new passes.

**Strength choice (same-session sweep, clock paused so the sun stands still, e = 4.864°; crop 380,130,250,250):**

| disc scale k | core mask | crop clip | crop near ≥240 | crop chroma |
|---|---|---|---|---|
| 1.00 (pre-change) | old | 1.626 % | 3.768 % | 34.7 |
| 0.64 | tight | 0.294 % | 1.989 % | 35.2 |
| 0.32 | old | 0.000 % | 2.493 % | 35.2 |
| 0.32 | tight | 0.000 % | 1.506 % | 35.4 |
| 0.20 | tight | 0.000 % | 1.323 % | 35.4 |
| 0.12 | tight | 0.000 % | 1.136 % | 35.5 |

Shipped k = 0.242 / `sunDiscLow` = 0.892 sits below the two k=0.32 rows (clip 0 % there, and the core shrink
removes ~40 % of the ≥240 px at the same k). Going to 0.20–0.12 only shaves the already-warm halo (a further
12–25 % of ≥240 px) while making the sun read as a dimmer dot — not worth the identity risk, so the ramp keeps
`0.15` at the horizon and recovers to 1 at 16°.

## 3. Gates (all re-run after the change, in this order)

| gate | result |
|---|---|
| `node tools/check-atmosphere.mjs` | **22/22** — asserts unchanged; Node chroma ratios 1.436 / 1.500 / 1.500 / 1.342 (targets 1.4/1.45/1.25/1.2), noon + night no-op checks exact, rendered dusk crop chroma **48.8** > 30 (R 133 G 124 B 96), dusk−noon R−B **+37 vs −34** — identical to the pre-change b3 numbers (`docs/reviews/atmosphere-b3.md`) |
| `node tools/critic.mjs --module environment --round 9 --dir shots/environment/r9` | 12 shots, errors **0**, minFps 143, maxGpuMs **5.28**, maxDrawCalls **53**, `budget {fpsOk, gpuOk, drawCallsOk}` all true |
| `node tools/critic.mjs --game --round 47 --dir shots/game/r47` | 20 shots, errors **0**, minFps 91.9, maxGpuMs **10.51** (≤20), maxDrawCalls **934** (≤1500) |
| game baseline diff `r46 → r47` | meanAbs 0.027, worst overview-21h5 0.105 (session drift), skyline-18 0.038 / 0.082 % > 8/255 (the intended low-sun change), all other tods ≤ drift scale |

Determinism: pure function of sun elevation; no `Math.random()` added; no gameplay code touched; the sky/world
state used by the checks is unchanged (fog colour comes from `skySample`, which never contained the disc).

## 4. What I looked at (PNGs, all read)

* `shots/beauty/set6-smoke/03-skyline-golden.png` — the judged hero, to see what "huge bloom flare" means.
* `shots/environment/c4/pre-17.7.png` / `post-17.7.png` — full frames; the disc blob is smaller and warm, the
  avenue's gold column intact, sky chroma visually unchanged.
* `shots/environment/c4/ab-17.7-sun-pre-3x.png` / `-post-3x.png` / `ab-17.7-sun-sbs.png` — 3× sun crops: the flat
  pure-white plateau is replaced by a smaller warm core inside the same halo.
* `shots/environment/c4/ab-17.7-clip-pre.png` / `-post.png` — clip masks: pre has a red disc in the sky, post has
  red only on the column and one ship light.
* `shots/environment/c4/diff-17.7.png` — amplified diff: change concentrated at the sun (6014 of 6104 px).
* `shots/environment/c4/sweep/` — strength curve (pre-change, k064, k032-low1, k032-low0, k020, k012,
  `curve-k032low1-vs-k012-3x.png`).
* `shots/game/r46/skyline-18.png` vs `shots/game/r47/skyline-18.png` — the horizon sunset in the shipped game:
  pre = pale white blob with a soft double lobe; post = small warm ball, sky wash slightly less cream.
* `shots/environment/r9/environment_sky-18.png`, `environment_default-18.png`, `environment_sky-12.png`;
  `shots/environment/c4/after2-6.3.png` — dusk/noon/sunrise module shots, no artifacts.

## 5. Residuals, risks, assumptions

1. **The sun-column specular still clips** (4400 px, 0.212 % of the hero) — it is the golden reflection the shot is
   built around and is deliberately kept; the lever for it is the composer's day bloom threshold (1.6) / strength
   (0.22), owned by `effects`.
2. **The halo is untouched** by design (the golden identity): the near-sun wash (luma 220–245) is the same
   analytic glow as before; only the white core and its bloom fuel shrank.
3. The disc radiance is a shading-only value: `regenEnv()` already renders the PMREM with `uShowSun = 0`, so
   reflections/IBL and the CSM direct light are unaffected by this change (verified: identical draw calls, gpuMs
   within noise, `-12` / `-21.5` pixel-identical/session-floor diffs).
4. At `e ≤ 2°` `sunDiscLow = 1` also dims the disc to 0.15× — a sun on the horizon is a soft warm ball
   (see `r47/skyline-18.png`); if the orchestrator prefers a brighter horizon disc the `lerp(1, 0.15, …)` floor is
   the single number to raise.
5. No `docs/core-requests/` needed (no core/tools edits). ARCHITECTURE §7 not edited (owner scope); the low-sun
   disc extinction could be worth one line there if the orchestrator wants it documented.
