# V5 beauty-shot pass — independent critic report (B4 levers 1+2)

Commit `e3184ac` (`?hud=0` capture mode + core preset recomposition + blind set 3). I re-ran the HUD flag, the
preset geometry, the game batch and check-beauty on my own protocol and audited the set-3 files byte-for-byte
without opening `docs/judge-key-set3.json`.

**Verdict: PASS for the two levers (HUD-free capture + preset composition are real, verified and budget-clean) —
but the "first round win (1/5)" headline is NOT supported by the judge record and must be corrected before it is
repeated. The game keeps 8.8; no module score moves. Pair 04 needs a fresh blind re-judge.**

## Numbers (one browser at a time, nvidia-smi before each batch)

External GPU load was present throughout my session (WindowsTerminal pinned ~21–27 % 3D engine, 1918 MiB — its own
compositor, not the test browser); it affects fps, not gpuMs, and gpuMs is the binding metric.

| batch | minFps | maxGpuMs | maxDrawCalls | errors | budget |
|---|---|---|---|---|---|
| r26 (pre-V5, disasters-era reference) | 62.0 | 15.68 | 847 | 0 | pass |
| r27 | 60.9 | 15.86 | 847 | 0 | pass |
| builder r28 | 72.2 | 13.35 | 844 | 0 | pass |
| **my r29** (`shots/game/r29-critic/`, 20 shots) | **70.9** | **13.46** | **844** | **0** | **pass (50 / 20 / 1500)** |

- My r29 vs the kept r28 shots: **meanAbs ≤ 0.079** per channel (aerial-21h5 worst; most ≤ 0.05) — same baseline,
  no regression, difference is float/order noise. Every one of the 20 JSON error arrays is `[]`.
- `node tools/check-beauty.mjs` **11/11** on my run; re-capturing the five hero shots is reproducible: skyline is
  byte-identical to the judged set and the other four differ by meanAbs ≤ 0.011.

## 1. HUD flag (my own boots, not the builder's checks)

| boot / action | `isHudVisible()` | `.lc-hud` class | `.lc-show-ui` | panels |
|---|---|---|---|---|
| `?hud=0` fresh | false | `lc-hidden lc-capture` | `display:none` | all `none` |
| `?hud=0` + `H` | true | `lc-hud` (capture cleared) | `none` | all `flex`/visible |
| `?hud=0` + `H`,`H` | false | `lc-hidden` (no capture) | `block` (chip returns) | all `none` |
| no param, fresh | true | `lc-hud` | `none` | all visible |
| no param + `H` | false | `lc-hidden` | `block` | all `none` |
| no param + `H`,`H` | true | `lc-hud` | `none` | all visible |

- Capture boot → press `H` → click the Treasury stat: modal opens (`isModalOpen()` true, card `display:flex`,
  real budget text), Escape closes it; HUD visible again. All boots `errors: []`.
- Runtime keys unaffected in a capture boot: `Space` pauses, `Digit3` → timeScale 4, `B` toggles bulldoze.
- No gameplay/menu regression found. Two deliberate consequences, both acceptable for a tooling flag: while the
  HUD is hidden there is no mouse affordance to open anything (panels are `display:none`), and the capture class
  also suppresses toasts/info/status. A human who boots `?hud=0` gets the HUD back with `H` only.

## 2. Preset geometry (fresh full-game boot, demo city 441 buildings, dc = (0,0), W = D = 2048, cell 8)

| preset | measured position | target | distance | design check |
|---|---|---|---|---|
| skyline = night | (230, 56.6, 300), eye **55.0 m** above ground | (0, 22, 0) | **379.6 m** | formula exact; 250–500 band |
| overview | (409.6, 552.96, 614.4) | (0, 0, 0) | **922.5 m** | formula exact; 800–1100 band |
| aerial | (0, 901.12, 368.64) | (0, 0, 0) | **973.6 m** | formula exact; 900–1300 band |
| closeup | (-103.232, 23.548, -71.232) | (-124, 19.515, -92) | **29.65 m**, fov 45 | hero b18, h 49.05 m, **0.0 m** from target |

- Closeup hero (independent scan): tallest within 420 m of downtown, b18 at (-124, -92), diag 11.31 → dist formula
  `max(11.314·1.9+12, 49.05·0.65, 20) = 33.50`; raw camera position equals the applied one (no clamp needed);
  eye 18.75 m above ground; camera outside every footprint; camera→target ray's first hit is the hero itself
  (23.9 m) → no occlusion; terrain clearance worst −14.9 m (clear). After 120 further sim frames the pick is stable.
- Seeds 2 and 23: different 49.05 m towers, same clear line of sight, no footprint containment.
- Empty world (`?showcase=terrain`, 0 buildings, dc moved to (-233.74, 12.63)): closeup falls back **exactly** to the
  old fixed offset `[dc.x+22, 12+gh, dc.z+26]` / target `(dc, 6, dc)`; skyline/overview/aerial recompute against the
  moved dc exactly. `errors: []`.
- **Adversarial case (crafted, not observed in the demo):** with a 40 m blocker added exactly on the raw closeup
  spot, the clamp pushes the eye 0.6 m out of its footprint (raw z 36.18 → applied 40.6), but the ray to the hero
  then hits the blocker at 0.79 m — i.e. the clamp prevents interior leakage, it does not guarantee the hero is
  unoccluded. Demo seeds 1/2/23 are all clear, so this is a "would need a clear-LOS candidate check" edge, not a
  present defect.

## 3. Screenshots read

- Batch r29 (20 PNGs, HUD on): new framings are consistent across all 4 tods. Skyline now fills the frame with the
  city (big improvement vs the pre-V5 empty field), golden/night grades read warm; closeup is a clean 3/4 of the
  blue tower with a road/neighbour context, no interior leak, no terrain clipping; overview/aerial are legible.
  Remaining reads: closeup crops the 49 m tower (roughly the lower half is in frame), overview/aerial still read as
  plan/data-map shots (the acknowledged lever), street-night is still a thin dark road (preset untouched).
- `shots/beauty/v5/*.png` (HUD-free): clean frames, no HUD, no chip. Skyline-golden and closeup-golden are the two
  visibly improved frames; overview-noon/aerial-dawn remain map-like; street-night remains sparse.

## 4. Blind set-3 audit

Protocol checks (no key opened): all 10 pair files are byte-identical to their sources (`judge/set3/pair-04-B.png`
== `shots/beauty/v5/04-closeup-golden.png`, etc.), and my independent re-implementation of `pairs.mjs` with seed 23
reproduces the documented A/B assignment exactly (01/02/04/05 A = theirs, B = ours; 03 A = ours, B = theirs).

My own picks (formed with the unblinding table already known from the required reading — **not** blind):
**A, A, B, A, A** → the reference wins every pair. Pair 01/02/03/05 match all three judges; pair 04 I would call for
the reference farm over our tower close-up.

Reason consistency, all 15 reasons:

- Judges 1 is image-consistent on all five pairs (its pair-04 reason describes the farm correctly).
- Judge 2 pairs 04/05 are **inconsistent**: the pair-04 reason ("busy street full of signage, pedestrians, vehicles
  and picnic life") describes pair **05**'s reference image, and the pair-05 reason ("storybook windmill/harvest farm
  with tractors, deer") describes pair **04**'s reference. It reads as a one-row shift in transcription.
- Judge 3's pair 04 is **inverted**: it picks B and says "…; **A** is a sterile, empty tower close-up" — but in pair
  04 the tower close-up *is* B (ours) and A is the autumn farm. Its pair-05 reason is loosely image-consistent.
- Therefore the doc's line "**Every judge reason is image-consistent**" is false. Both of the votes that create the
  1/5 "win" are exactly the two votes whose reasons do not match the images; pair 04's win is **not proven by the
  record**. Two readings remain — (a) pick letters right, reasons garbled: a real but weakly-evidenced 2–1; or
  (b) rows shifted: the true result is 0/5 again. The record cannot distinguish them, so the win must be treated as
  provisional until pair 04 (or the set) is re-judged by fresh judges on the same bytes.
- The "zero HUD mentions across all 15 reasons" claim **holds**: no reason mentions HUD/UI/chrome/plates/minimap as
  a complaint (judge 2's "minimap view" is a simile for our aerial, not chrome). Our pair images visibly have no HUD,
  so the lever itself is proven even though the win is not.
- Leak/curation: no byte or seed leak evidence; the problem is judge-reason fidelity, not the pairing. Re-judging
  pair 04 is cheap and sufficient.

## 5. Score

- **`game` keeps 8.8.** No regression: r29 (70.9 / 13.46 / 844, errors 0) is within noise of the builder's r28
  (72.2 / 13.35 / 844) and the batches are pixel-equivalent (meanAbs ≤ 0.079); the two levers are verified; every
  budget holds.
- **No module score moves.** The core presets are whole-game only: all 14 showcase modules define their own preset
  namespaces (roads/traffic/props included), and `critic.mjs --module` never falls back to a core preset — module
  batches are untouched. The ui change is a CSS class + one init-time param read; normal boots verified unchanged.
- `docs/STATUS.json` game entry is **stale** (still r23/set1–2) but I leave it as-is per the critic contract: the
  score is unchanged, and the set-3 record should be corrected/re-judged before it is written to STATUS.

## 6. Ranked remaining issues / next levers

1. **Set-3 evidence correction (top, docs/protocol).** Re-judge pair 04 (same pair bytes, fresh judges) or run the
   set again; correct `docs/judge-set3-verdicts.md` ("every reason image-consistent" is false; mark the win
   provisional), the builder report's "first round win" wording, and the integrator-todo V5 entry. Also fix judge 2's
   shifted rows 04/05 and judge 3's inverted pair-04 reason.
2. **Overview/aerial still read as map views** (judges 02/05, acknowledged by the builder). Next: an oblique aerial
   with a foreground anchor — lower the eye, put a hero block/landmark in the near third instead of straight-down.
3. **Closeup framing fit.** 49 m hero at 29.65 m / fov 45 crops > 40 % of the tower (top out of frame; base behind
   the batch toolbar). Fit the height (`dist ≈ height/(2·tan(fov/2))` with margin) or intentionally frame the lower
   third with a street anchor; optionally add a clear-LOS check (see §2 adversarial case).
4. **Night street is dark/thin** (pair 03, unchanged preset): lit-window/streetlight density and a subject in frame —
   content lever, not this pass.
5. **Batch-baseline note spread.** The preset change invalidates whole-game pixel comparison with rounds ≤ 27. This
   is buried in `beauty-v5.md` "Known gaps"; the game STATUS entry (`r23`) and `_integrator-todo` B4 follow-up line
   still cite r22/r23 numbers as comparable, and module reviews cite "game rN" cross-checks. Say plainly: **r28/r29
   is the whole-game baseline; re-base pre-r28 cross-references before reusing them.** (Module batches unaffected.)
6. Minor/informational: `?hud=0` deliberately removes the only mouse affordance for the HUD (tools-only flag, fine);
   fps in my runs is ~1–2 % below the builder's under external GPU load (gpuMs within 0.8 %).

## 7. What I did NOT verify

- No ui (or other module) batch re-run — ui 8.9 holds on code inspection + live normal-boot checks, not on fresh
  module screenshots.
- The judges' raw transcripts (only the committed reasons exist here); I could not distinguish a reason-shift from a
  pick-shift in judge 2/3's rows 04/05 — hence the re-judge recommendation.
- I did not open `docs/judge-key-set3.json`; I reproduced the shuffle from `pairs.mjs` + seed 23 instead.
- Occlusion was checked on demo seeds 1/2/23 and one crafted blocker; not exhaustively over seeds/heros, and not for
  the aerial/overview presets.
- HUD behaviour under window resize, dispose→init cycles, and touch input (capture mode is desktop-tooling only).
- I did not commit anything or modify `src/`/`tools/`; scratch scripts and downscaled copies live under
  `C:\Users\ryuen\AppData\Local\Temp\opencode\v5c\`.
