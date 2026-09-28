# LOOP cycle 2 — fix-round verification (props diorama detail layer)

Critic re-run on the current working tree (uncommitted on top of `63527ad`; `src/props/*`, `src/demo/index.js`, `docs/LOOP.md`). Own runs only; `gpuMs` truth; dev server untouched; one headless browser per batch; `nvidia-smi` before each. Scratch evidence: `C:\Users\ryuen\AppData\Local\Temp\opencode\c2v\` (`fix-probe*.json`, `fix-probe*.png`, sheets).

**Overall: fixes 2–6 are confirmed; fix 1 is confirmed only against the builder's own metric and for the two specific floaters I flagged — a broader float/sink class survives (and one verified prop got worse).**

## Per-issue verdicts (my numbers)

### 1. Floaters — PARTIALLY CONFIRMED / REFUTED AS A GENERAL CLAIM
*Claim checked:* `settleDetail()` gives 0.000 m max deviation.

| seed (fresh boot) | `settleDetail` | my metric† max dev | count dev >0.5 m | mesh-truth gap <−0.5 m | mesh-truth gap >0.5 m | max float | max sink |
|---|---|---|---|---|---|---|---|
| 1 | fixed 1144 / removed 0 / 13 ms | **0.190 m** | **0** | 23 | 62 | +1.55 m | −2.42 m |
| 2 | (demo hook ran) | **0.190 m** | **0** | 34 | 76 | +1.64 m | −2.51 m |
| 23 | (demo hook ran) | **0.192 m** | **0** | 21 | 66 | +2.55 m | −2.80 m |

† `p.y − max(roads.api.snapToRoad(x,z,6).y, terrain.api.surfaceHeight(x,z))` — the same definition I used in the cycle review. `detailMs` 16.9/17.8/19.9 ms; `settleDetail` idempotent (second call fixes 0); 0 removed for a non-finite surface on every seed.

- The two floaters I flagged last round are **fixed**: mesh raycast at `figure@(−625.2,−97.8)` and `figure@(−597.4,−231.2)` on seed 1 now returns gap **0.00 m / −0.00 m** (they stand exactly on `roads-sidewalk`).
- The builder's "0.000 m max" is tautological: `settleDetail` sets `p.y = resolveHeight(...)` and `check-detail` compares `p.y` to `resolveHeight(...)`, so it can only ever return 0. Measured against the *visible surface mesh* (raycast down onto terrain/roads/buildings geometry, props group excluded), the world is not clean:
  - **62 / 76 / 66 C2 props** sit **>0.5 m above** the topmost surface under them (3.6 / 4.5 / 3.8 % of C2); p99 gap **+1.15 m** (seed 2), max **+2.55 m** (seed 23, a `fence_picket`).
  - **23 / 34 / 21 C2 props** sit **>0.5 m below** it (buried under sidewalk/terrace meshes); min **−2.80 m** (seed 23, a `figure`).
  - Visual proof (looked at): `float-path-fence.png` — picket fence with both posts ending in mid-air ~0.5 m over the grass; `float-path-figure.png` — figure floating ~0.5 m over the studs; `extreme-fence-s23.png` — a white fence panel floating ~2.5 m up against a building's first floor; `old-floater-fixed.png` — the figure at (−205.2, 25) that my cycle-1 data recorded standing exactly on the sidewalk (gap 0.00, `probe4.json`) is now at y 2.75 **under** that sidewalk mesh (y 5.15), suspended above the terrain: `settleDetail` re-picked a lower nearby path as the "nearest road".
- Root cause (unchanged by the fix): `resolveHeight` snaps to the nearest road *centreline* within 6 m (lane Y + 0.19) even when the prop is nowhere near that road's surface. On embankments/terraces the road deck is 1.2–2.4 m above the local terrain, so props on the low side get lifted to the high side. This is mostly **pre-existing** (the old placer used the same function at placement time); but because `settleDetail` re-evaluates the nearest edge *after* later citygen phases, it demonstrably moved at least one grounded prop 2.4 m down.

### 2. Stable variation — CONFIRMED
- My own non-C2 FNV hash over `(id,kind,x,y,z,rot)` of all 2900 non-C2 props: **`ba5923a2` with C2 and `ba5923a2` with `?noc2=1`** (identical; 2900 props both; C2 1728 → 0; figures 409 → 0; props own draws 61 → 48; errors 0).
- My own in-build pixel diff (same stage, sky phase reset): `?noc2` vs C2 `skyline-12` meanAbs **0.031** — the delta is confined to the ground band (0.08 mean, 0.24 % pixels >8, max 192), sky 0.01 → the dressing is the only difference between the two modes.
- Reproduced the builder's batch proofs from their dirs: `r40-noc2` vs `r37` = **0.0344** (worst `overview-21h5` 0.1236); `r40-noc2` vs `r40` = **0.2148** (worst `closeup-18` 0.849). `r40-noc2/skyline-12.json` URL contains `noc2=1`.
- Caveat on method: my own standalone captures vs `r37` differ by 0.49 because the animated traffic phase (frame count since boot) differs; the frame-synced batch captures are the valid comparison and reproduce the claim.

### 3. Fences — CONFIRMED
All 325 pairs among 363 `fence_picket`: **minimum centre distance 2.031 m, 0 pairs < 2.0 m, 0 pairs < 2.02 m** (my grid scan; check-detail prints the same). No interpenetration remains.

### 4. Boot — CONFIRMED
3 fresh pairs, same session, alternating (my own timing loop mirroring `openApp`):
`?noc2` 11413 / 11351 / 11350 ms vs C2 11420 / 11513 / 11344 ms → +7 / +162 / −6 ms (mean +54 ms, +0.5 %). `detailMs` 16.9 / 17.8 / 19.9 ms; `settleDetail` 11.9–13.1 ms. Pre-fix my fresh boot was 13115 ms; the build is now back at ~11.4 s and the two modes are indistinguishable as claimed.

### 5. Evidence coverage — CONFIRMED (12/16 holds; some of it only just)
`r8` (default variant), C2 props inside the camera frustum per shot (programmatic projection; identical at all 4 tods — same staging):

| preset | shots | C2 in frame | <60 m | <25 m | my eye (full-res / sheets) |
|---|---|---|---|---|---|
| `props:default` | 4 | 21 | 0 | 0 | new lot row + small figures/bikes at 60–120 m — visible but small |
| `props:closeup` | 4 | 12 | 12 | 3 | figures, crates, garden, fences clearly readable |
| `props:park` | 4 | 9 | 4 | 0 | full-res noon shows bin/figure/bike/crates near the shop — readable |
| `props:yards` | 4 | 18 | 11 | 2 | fenced/gardened suburb with figures — clearly readable |

The builder's 12/16 is not refuted (closeup + yards = 8 clearly, park + default = small but present; **all 16 contain C2 props in frame**) — if anything it undercounts. `r8-yards`: `props:yards` frames the staged block (all 4 tods), `props:closeup` has 13 C2 all <60 m, `props:default` 21, but `props:park` keeps only 5 of its 236 C2 props within 60 m (the block is ~200 m away) — park remains the weakest framing in both variants. The old "default/park/night pixel-identical to pre-C2" gap is gone (r8 default scene draws 306–332 vs 188–198 pre-fix; props' own still 61).

### 6. New defects / regression sweep — no new breakage found besides issue 1
- `check-detail`: **35/35 green** (census hash `177984be`, 4628 props / 1728 C2 / 409 figures / 1279 yard / 363 fences); my independent census matches every number.
- `game r41`: minFps **90.1**, maxGpuMs **10.78**, maxDraws **921**, errors **0** (props own 61/300) — all gates pass. `r41` vs `r40` = 0.0382 meanAbs, worst 0.0874 (`closeup-6h5`), broad and small (no hotspot; a post-r40 tweak or cross-session drift).
- Lifecycle: dressed building removed → 7/7 props gone, size −7, 0 orphans, `detailProps` empty; a street paved through a yard → all 2 C2 props on the new carriageway removed, **0** C2 left within the edge reach (an earlier "1 leftover" was my test band extending past the new edge's x-range); `settleDetail` idempotent.
- IDs: content-derived `c2p:<kind>:<x>:<z>` ids are unique (0 duplicate coordinates/kinds), never consume `world._ids.prop`, and the `?noc2=1` boot renders 2900 pre-C2 props with 0 errors.
- Demo one-liner works: `detailSettle` non-null after boot (`fixed:1144, removed:0`), showcase path settles too (`r8*` batches, check-detail yards capture, errors 0).

## Ranked issues (fix round)

1. **Floating/buried props survive the fix (new evidence, mostly pre-existing).** 62–76 floats and 21–34 sinks per seed (>0.5 m off the visible mesh; max +2.55 m float, −2.80 m sink); visible in `float-path-fence.png`, `float-path-figure.png`, `extreme-fence-s23.png`. Cause: `resolveHeight` uses the nearest road **centreline** within 6 m (lane + 0.19) as ground, even across embankments/terraces. One prop my cycle-1 data shows grounded (`old-floater-fixed.png`, (−205.2,25)) is now suspended 2.4 m under the sidewalk because `settleDetail` re-picked a later, lower path. *Fix:* resolve heights against the actual road **surface/footprint** the point lies in (fall back to terrain), or clamp the road lift to the terrain when the nearest centreline is outside the road footprint; make `check-detail`'s floater check raycast the scene mesh (or assert `|roadLift| ≤ 0.5 m`) instead of comparing to `resolveHeight`.
2. **`check-detail`'s "0 floaters" assertion is structurally incapable of failing** (it compares `p.y` to the function that set `p.y`). *Fix:* measure against the rendered surface, as above — otherwise the gate certifies nothing.
3. **(Minor) `props:park` framing remains marginal**, especially in the yards variant (5 of 236 C2 props <60 m). If every preset is meant to show the new layer, re-aim or accept and document.
4. **(Minor) `r41` vs `r40` = 0.038** meanAbs (worst 0.087) — above same-session drift for a supposedly identical build; no hotspot, most likely a small post-r40 edit or cross-session drift. Re-baseline or note.

## What works (verified this round)

- Variation stability: non-C2 hash identical with/without the C2 layer; `?noc2=1` truly renders the pre-C2 world; dressing is the only in-build delta.
- Fence separation fixed (min 2.031 m, 0 violations).
- Boot cost fixed: `detailMs` 790 → 17–20 ms, `readyMs` indistinguishable from `?noc2` (mean +0.5 %), `settleDetail` 12–13 ms.
- `default`/`yards` batches now visibly carry the dressing (figures, crates, fences, garden beds); check-detail 35/35; game budgets green; lifecycle/ids/cleanup intact; demo + showcase settle hooks both run.

## What I did NOT verify

- How many of the float/sink cases are *caused by* `settleDetail` vs pre-existing placement (I cannot run the pre-fix tree); only the one grounded→suspended prop is proven by before/after data.
- Other seeds than 1/2/23, and seeds beyond the demo city.
- Cost of `settleDetail` on a busy interactive road drag (13 ms measured at boot; live-edit frequency untested).
- The r41-vs-r40 residual's cause (no hotspot analysis of sky/session vs edit).
- Blind-judge impact (no new judge set); check-beauty / other module checks were not re-run by me.
- My mesh-raycast ground truth treats terrain+roads+buildings as the only surfaces; props standing on other geometry (e.g. building plinths) would be misclassified — none seen in the sampled/verified cases.
