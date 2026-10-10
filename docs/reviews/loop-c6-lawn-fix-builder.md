<!-- Saved verbatim by the orchestrator, 2026-10-09. Fix round 1 of the lawn stage. Its verge-studs-off stopgap was superseded by fix round 2 (orchestrator: roads verge studs depth-less, LAWN_VERGE_STUDS = true). -->

# Lawn fix round (LOOP c6, terrain lawn, critic issue 1) — builder report

**Status: the 05 polka dots are gone and every acceptance gate passes on the final code, but the fix includes a design deviation you must rule on: road verges are now tiles only (no studs).** Nothing committed. Only `src/terrain/` was edited, plus the new `docs/core-requests/terrain-c6-lawn.md`. `src/roads/index.js` is still your +3 lines.

## Decisions for you
1. **Verge studs off (`LAWN_VERGE_STUDS = false` in `src/terrain/index.js`).** The design says verges get tiles plus sparse studs. Most of the dark pucks in the near half of 05's field were roads' own verge-infill studs, which terrain cannot make AO-free. I made `terrain.api.studKeep()` return `false` in lawn mode, so roads emits none. The catch: in 05 the near half of the field is now bare mint tiles and the studs only start further out. Flipping the constant to `true` restores sparse verge studs, and they will be dark again. The alternatives are in the core request (effects softens AO on thin features, or roads hands its infill points to terrain).
2. **03 glints are reduced, not removed.** White specks became smaller, dim tan specks (`shots/terrain/c6lawnfix-v2/z-sky.png` vs `c6lawnfix-v1/z-sky.png`).

## Diagnosed cause
It is hypothesis 1: the post-process ambient occlusion. GTAO (`AO_PARAMS.radius 0.7` in `src/effects/index.js`) is composited as `col *= pow(ao, 2.5)` in `src/effects/grade.js`, and a 0.17 m wall on an open plate sits wholly inside that radius.

Proof, one boot, seed 1, `lawn=1`, street preset, tod 12, changing only `effects.api.setAO({ intensity: 0 })`:

| capture (`shots/terrain/c6lawnfix-diag/`) | darkest 1% of box (1250,640,600x200) | far strip (1300,610,300x30) dark |
|---|---|---|
| `A-base.png` (AO on) | (8, 48, 25) | 12.0% |
| `B-ao0.png` (AO off) | (56, 132, 88) | 3.8% |
| plate median | (140, 197, 161) | |

- **Why the critic's tweaks did nothing:** the darkening happens in post, after any material or shadow change.
- **Env intensity:** raising the stud material's `envMapIntensity` to x1/0.35 and x3 gave the same numbers as base (`C-studenv1.png`, `D-studenv3.png`). That is "no observable effect", not an exclusion of hypothesis 2. It also suggests `GROUND_ENV_MUL` in terrain currently does nothing; I did not confirm why.
- **Two populations of studs:** with terrain's stud meshes hidden, dark pucks remain in the near field (`E-hidden.png`, crop `h-E.png`). With terrain studs made depth-less at runtime, the far ones turn light and the near ones stay dark (`F-nodepth.png`, crop `z-F.png`).
- **03 glints:** they are the far shader relief, not real studs. The skyline frame with studs hidden shows the same specks (`c6lawnfix-v1/z-sky.png` vs `z-sky-h.png`).

## What changed (lawn mode only)
- **`src/terrain/studs.js`**
  - The stud material gets `depthWrite = false`, so GTAO never sees the studs; `renderOrder` is 1 (far) and 2 (near).
  - `_rebuild` sorts instances back to front in lawn mode; the non-lawn branch keeps the old loop.
  - The re-sort threshold is 2 m of camera travel in lawn mode (6 m otherwise).
- **`src/terrain/shaders.js`** (v3 lawn function only; v2 strings and key untouched)
  - The stud contact ring now applies at every distance, with strength from `uLawn.w`, so depth-less studs are still grounded.
  - The clearcoat-normal copy is dropped in v3, so a lone relief rim no longer gets the sharp coat highlight.
- **`src/terrain/index.js`**
  - New constants: `LAWN_VERGE_STUDS = false`, `LAWN_RING = 0.18`, `LAWN_RELIEF = 0.5`.
  - `uReliefStrength` is `LAWN_RELIEF` in lawn mode and 0.9 otherwise; `uLawn.w` is `LAWN_RING`.
  - `studKeep` is gated by `LAWN_VERGE_STUDS` in lawn mode and still returns `true` under `lawn=0`.
- **`docs/core-requests/terrain-c6-lawn.md`** (new): the cause with numbers, a request to effects, a request to roads, and the trade-offs of both mitigations.

Stud height stays 0.17. No new draws, no `Math.random`.

## Acceptance (final code)

| # | gate | result | command / output |
|---|---|---|---|
| 1 | 05 far strip dark ≤ 8% | **1.6%** (was 12.0%); hp/L 0.053; right field (1500,720,380x280) 0.5% | `node tools/shot-list.mjs --out shots/beauty/c6lawn1f-s1 --seed 1`, then `metric.mjs` |
| 1 | wall green ≥ 0.5x plate green | **0.75** (dark half of stud pixels (69,147,94) vs plate (141,197,163)); darkest 10% 0.65 | `walls.mjs` on `shots/terrain/c6lawnfix-v2/street.png` vs `street-hidden.png`, box (1500,625,400x90) |
| 2 | 01 and 04 not worse | looked at both pairs; no worse (details below) | `shots/beauty/c6lawn1f-s1` vs `c6lawn1-s1` |
| 3 | `lawn=0` identity ≤ 0.03 per frame | mean 0.0051; 01 = 0, 02 = 0.0102, 03 = 0.0063, 04 = 0.009, 05 = 0.0001 | `shot-list.mjs --out shots/beauty/c6lawn0f-s1 --seed 1 --param lawn=0`, `diff.mjs` vs `c6d2-s1` → `shots/beauty/c6lawn0f-s1/diff-c6d2.json` |
| 4 | game batch | errors [], moduleErrors {}, max gpuMs 7.24, minFps 133.1, max draws 823; 20/20 shots one draw below `c6lawn1`; mean gpuMs change −0.02 | `node tools/critic.mjs --game --round 66 --dir shots/game/c6lawn1f` → `summary.json` |
| 5 | check-detail | 46/46, nosp census e0f35033 == e0f35033 | `node tools/check-detail.mjs` (overwrote `shots/props/c2/summary.json`) |
| 5 | check-background | 4/4 | `shots/background/c6lawn1f/summary.json` |
| 6 | goldens | 45ffee02 / 5,624 (`terrain.api.lawn()`, read on the v1 and v2 boots) | `diag3.mjs` output |

- **Wall ratio caveat:** an earlier run of the same method on the wider box (1250,640,600x200) gave 0.47, with a blue-grey "stud" colour of (74,93,102). That is not a lawn stud; the wide box takes in the kerb and sidewalk. I did not confirm what exactly differed there, so 0.75 on the kerb-free box is the number I stand behind.
- **The missing draw:** every shot is one draw below `c6lawn1`, and the lawn=1 shot-list is one below lawn=0 (742 vs 743 on 05). Probably roads' infill instancer going empty; not verified.

## PNGs I looked at
- **`shots/beauty/c6lawn1f-s1/05-avenue-noon.png`:** no dark pucks. The far part of the field shows small light-green studs with a faint contact ring (3x crop `shots/terrain/c6lawnfix-v2/z-street.png`). The near half is bare seamed tiles. Honest read: a clean tiled lawn with studs in the distance, not "a lawn with studs" up close.
- **`01-house-golden.png` vs `c6lawn1-s1`:** same picture. The few dark studs on the right-hand and across-the-road lawns are gone; the set-piece deck studs are unchanged.
- **`04-farm-golden.png` vs `c6lawn1-s1`:** no difference I could see beyond a few fewer dots on the background lots. The tiles still read as plates.
- **`shots/terrain/c6lawnfix-v2/street-night.png`:** studs are low contrast, nothing odd.
- **`shots/terrain/c6lawnfix-v2/skyline.png` and `z-sky.png`:** specks dimmer; 03 near-field box (640,720,240x60) dark 8.8% → 7.8%, hp/L 0.136 → 0.131.

## Unverified
- **Pan flicker:** overlapping depth-less studs can swap draw order between re-sorts. Stills only.
- **Transparent surfaces:** zone plates, the views overlay, glass and water now draw over a stud instead of being hidden by it. check-background passes, but I did not look at a zone-tool frame.
- **Other render orders:** whether the meshes at `renderOrder` 6, 7, 10 and 50 elsewhere in `src` are transparent was not checked; an opaque one would overdraw the studs.
- **CPU cost** of re-sorting about 2.6k instances every 2 m of camera travel.
- **Coverage:** seeds 2 and 23; `lawn=2` and `lawn=3`; night outside the street preset; check-atmosphere, check-beauty and check-civics; the `lawn=0` game batch.
- **Time:** `date` read 23:08 at start and 23:26 at the end, which is less than the GPU work done. File times run from 23:09:13 (`A-base.png`) to 23:23:15 (`shots/background/c6lawn1f/summary.json`). Treat the 45-minute box as probably met, not proven.

## Would I ship it
Yes for the terrain stud fix (depth-less studs plus contact ring): it removes the defect at zero draw cost and `lawn=0` is untouched. The verge rule is a stopgap; I would send `lawn=1` to the panel with it on, since bare verge tiles beat dark pucks, and reopen it once effects or roads acts on the core request.

Scratch scripts and start-state backups (`*.start`) are in `C:\Users\ryuen\AppData\Local\Temp\claude\C--Git-Cities\c1103a09-e76f-4c0a-884c-6a56fc46130f\scratchpad\lawnfix\`.
