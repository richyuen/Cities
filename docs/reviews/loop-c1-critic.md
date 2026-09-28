# LOOP cycle 1 critic — L1 hero framing system (hostile verification)

**Verdict: FAIL — claims/record gate.** Every numeric acceptance gate the builder listed passes and
reproduces (17/17 checks, budgets, `errors: []`, no regression, showcase fallbacks finite, seed variation
real), but two *shipped-composition* claims in `docs/reviews/loop-c1.md` are refuted by my runs:

1. "closeup … the camera is a **sun-side 3/4** … front-lit at the hero tods" — the shipped closeup is on the
   **anti-sun side** for all three seeds I tested (1, 2, 23); the sun-side option is rejected as blocked by a
   neighbour for the ranked #1 hero every time.
2. "aerial … **bay in the near third**" — projecting all 12,224 water cells: **0** are in the aerial frame.

Plus one measurable crop problem the geometry check cannot see (hero near corner 1.45–1.64× frame height) and
one incomplete fix (the showcase `street` fallback still gets lifted by the MapControls polar clamp that the
cycle report says was "found and fixed"). Fixes are small; a fix round is warranted before burning blind set 4.

**Score: 7.5 / 10** (subject-aware system is real and reproducible; the flagship closeup is cropped and never
front-lit at its hero tod, the aerial's identity claim is false, and the street can put a lamp pole through the
frame centre — a blind judge still sees amateur composition tells).

Repo boundary check (`git status --short`, `git diff --name-only HEAD`, `git log --oneline -3`): HEAD is
`62b3c15`; changes are exactly `ARCHITECTURE.md`, `src/core/camera.js`, `src/core/context.js`,
`tools/check-beauty.mjs`, plus new `src/core/composition.js` and `docs/reviews/loop-c1.md`. Nothing else in
`src/` changed. `src/core/context.js` diff is only `createCamera(renderer, world, events, clock)`.

## My runs (all numbers below are mine, on RTX 4070 Ti / ANGLE D3D11; `nvidia-smi` checked before each batch)

| run | result |
|---|---|
| `node tools/check-beauty.mjs --out shots/beauty/c1c` | **17/17 checks, 0 errors** (see `shots/beauty/c1c/summary.json`); captures reproduced the builder's set: c1 vs c1c meanAbs **0.0045**, worst 0.0097 (`shots/beauty/c1c/diff-vs-c1.json`) |
| `node tools/critic.mjs --game --round 32 --dir shots/game/r32` | minFps **72.6**, maxGpuMs **13.16**, maxDrawCalls **856**, errors **0**, all budget flags true |
| `node tools/diff.mjs --a shots/game/r31 --b shots/game/r32` | meanAbs **0.0183**, worst `overview-18` 0.0367 → **≤ 0.30, no unexplained change** (`shots/game/r32/diff-vs-r31.json`) |
| per-preset r32 @21.5 (maxGpuMs / draws) | street **13.16 / 733**, skyline 12.78 / 789, closeup 12.65 / 675, aerial 10.78 / 805, overview 10.01 / 756 — **all ≤ 20 ms / ≤ 1500 calls** |
| showcase fallbacks (scratch `fallbacks.mjs`) | `?showcase=terrain` and `?showcase=roads`, all 6 core presets (`skyline, night, overview, aerial, street, closeup`): `setCamera` returns true, pos/target/fov finite, no NaN/∞, 0 errors, screenshots sane |
| seeds 2 & 23 (scratch `seeds.mjs`, `hud=0`) | closeup+street @17.7 and @21.5 captured; subject/eye/ray audited (below) |
| crop probe (scratch `crop.mjs` via `crop.json`) | hero AABB corners projected to NDC for seeds 1/2/23 |
| water probe (scratch `watercivic.mjs`) | all 12,224 water cells projected per preset |
| controls probe (scratch `controls.mjs`) | street→skyline→street eye/height/polar over 60-frame windows |
| determinism (scratch `samesession.mjs`, `repro.mjs`, `drift.mjs`, `stability.mjs`; `tools/shot.mjs` ×2) | cross-session shot.mjs pair meanAbs **0.0408**; frame-count drift measured (below) |
| `grep Math.random src/` | **not empty** — 2 real calls, both pre-existing at HEAD, none in this cycle's diff (below) |

## Falsification table

| # | builder claim / thing checked | what I did | what I saw | verdict |
|---|---|---|---|---|
| a1 | "Empty/showcase worlds fall back to the old generic framings" — no NaN/errors/sane framing | boot `?showcase=terrain` + `?showcase=roads`, call all 6 core presets, read pos/target/fov + capture | 0 buildings in both; every preset `ok=true`, finite, eye above ground, 0 errors; terrain/roads screenshots show terrain/roads (contentless but sane). **Refinement:** the roads `street` fallback eye is **3.26 m** above ground, not the authored 1.7 m (see issue 5) | **survives (with defect)** |
| a2 | Night alias | `night` == `skyline` numbers identical in both showcases | exact alias confirmed | survives |
| b1 | "seeds 2/23 pick different civic lots and the closeup/street framings move with them" | boot seed 2, 23; closeup+street @17.7/21.5, screenshots + subject audit | closeup moves (seed 23 → school b15 at (−176,−80); seed 2 → fire b194 at cell 172,117). **But seed 1's hero is the same cell 172,117 (fire b192)** — the "different lot" holds for 23, not for 2. Street moves (poles/framing differ) at eye **2.8 m** in both | **partially refuted** (seed 2 = same lot as seed 1) |
| b2 | closeup subject = civic, entrance face visible, no neighbour wall | screenshots + raycast + NDC projection | civic ✓, ray first-hit = subject ✓ (all seeds), +z entrance face on screen ✓ — **but the near corner is cropped** (issue 1) | survives weakly / issue 1 |
| b3 | street at eye level near the avenue | screenshots at 17.7/21.5 | eye 2.8 m, lit frontage, crosswalks, buses ✓; seed 1 has a pole through frame centre + a clipped truck (issue 3) | survives (with issue 3) |
| c1 | closeup eye→hero raycast: first hit is the hero | replicate the preset's own ray via page debug API + `import('/src/core/composition.js')` | seeds 1/2/23: first hit = hero (`rayFirstHitIsSubject=true`), 0 errors | survives |
| c2 | adversarial dense-corner civic rejected by the preset's own selection | ranked all 12 civic candidates per seed through the exact stretch/offset walk; recorded first blocked hit and acceptance | no candidate was rejected outright; **11/12 seed-1 candidates have their sun-side (−40°) option blocked by a neighbour and fall through to the anti-sun side**; seed 1/2/23 ranked #1 heroes all ship anti-sun (+40°). No neighbour wall fills the frame | **refutes "sun-side … front-lit"** |
| d1 | street eye stays 2.8 m; no polar-clamp lift; no damping drift | apply street; sample eye height/polar every frame ×60; skyline; street again ×60 | eye above ground **2.8 ± 3e-15 m**, polar **88.85° < 89.1°**, **zero** horizontal/height drift in both windows; after skyline→street identical position | survives |
| d2 | same, empty-world fallback | probe `?showcase=roads` | authored preset `pos=[4,3.7,60] target=[4,4,−20]` → authored polar **90.21°** > maxPolar 89.1° → clamp lifts eye to y=5.2566 = **3.26 m above ground** (terrain showcase happens to be fine at 1.70 m) | **refuted (fallback only)** |
| e1 | "no `Math.random` in `src/`" | `git grep` working tree + HEAD | 7 hits: 5 are comments; 2 real calls — `src/menu/newCity.js:4` (New City random seed) and `src/menu/storage.js:56` (save UUID), **identical at HEAD**, not in the cycle diff; `composition.js`/`camera.js` genuinely RNG-free | **literal gate fails, pre-existing/by design** |
| e2 | folder ownership | `git status`, untracked list | exactly the 6 declared paths | survives |
| e3 | "same seed → same shots" within budget | `shot.mjs --preset skyline --tod 17.7` ×2 (separate sessions) + same-session re-stages | cross-session **0.0408**; identical re-stage ~25 frames apart **0.2026**; **no re-stage, +600 frames: 2.766**; tod round-trip+600: 3.12; closeup +600 frames 0.659; street@21.5 +600 0.124 | **budget fails over session time** (issue 4; environment animation, not the cycle's files, but the new framing maximises it) |
| f1 | perf at the new framings | r32 per-preset table | max **13.16 ms / 856 calls** at 21.5, minFps 72.6, errors 0 | survives |

## Ranked issues (most damaging first)

1. **Closeup hero ships back-lit and cropped — the flagship preset does not produce its stated framing.**
   *What:* at 17.7 (sun az −87.3°) the shipped closeup camera sits at **+40°** (anti-sun side) for seeds
   1/2/23; and the hero's near vertical corner projects far outside the frame. *Where:*
   `shots/beauty/c1/04-closeup-golden.png`, `shots/game/r31/closeup-*.png`, my
   `...\c1c\seeds\seed2-closeup-17h7.png`, `seed23-closeup-17h7.png`; numbers in
   `...\c1c\crop.json`, `...\c1c\water-civic.json`. *Evidence:* the candidate walk accepts the anti-sun
   offset because the sun-side (−40°) is blocked by a neighbour for 11/12 seed-1 civic candidates
   (`b192` blocked by `b196`; seed 2 `b194`←`b198`; seed 23 `b15`←`b19`); NDC corners for the hero:
   near corner y from **−1.35/−1.42/−1.57** (below frame) to **+1.39/+1.48/+1.70** (above frame) — a near
   edge **1.45–1.64× the frame height**; the entrance-face centre sits at NDC x −0.489 (26% of frame width from the left);
   the check's "fit 0.69" measures the *centre* distance and cannot see any of this. *Why it hurts:* this is
   the shot that most resembles the blind-set "clipped facade" complaint; at golden hour the lit faces are
   the ones off-camera, so the cycle's own "hero" loses the golden identity. *Fix:* prefer the **sun-side
   framing across all candidates** before falling back to the anti-sun side for one of them; widen the
   azimuth search (±40° → ±40°/±65°) and allow one extra `stretch` when the near-corner height fraction of
   the frame exceeds ~1.05; add a check: near-corner top/bottom NDC in [−1, 1] and the +z face centre in
   the middle 60% of the frame.

2. **Aerial contains no water — the "bay in the near third" claim is false, and the frame reads as a
   zone-plate map.** *Where:* `shots/beauty/c1/05-aerial-dawn.png`, `shots/game/r3{1,2}/aerial-*`. *Evidence:*
   projecting all **12,224** water cells: `aerial inFrame=0` (bottom/middle/top all 0); `overview` 5,411 all
   in the **top** third; `skyline` 710 middle band; `street` 717; `closeup` 123. The dawn aerial is a green
   plate grid with an orange industrial pad at top-left, cyan parking plates, an empty left third, and
   stepped/aliased terrain risers at top-right. *Why:* the camera (573, 468, 136)→(120, 0, −120) looks
   west-southwest; the bay is behind/left of the frustum. *Fix:* re-aim the aerial (e.g. target the
   waterfront/bay centre so water lands in the near or middle band), re-run the water projection as a gate,
   and correct the report claim. The stepped terrain/mountain aliasing is L6/L2 territory.

3. **Street framing can put a lamp pole through the frame centre and a vehicle inside the near plane.**
   *Where:* `shots/beauty/c1/03-street-night.png` (pole at x≈960 running the full frame; white truck clipped
   at bottom-left with a wheel at the lens), `shots/game/r31/street-*.png`; seed 23 reproduces the pole
   (thin variant at seed 2). *Evidence:* the standoff loop only rejects an eye point that is inside a
   building footprint — nothing tests props/lamps near the eye or inside the view cone; the traffic-signal
   head in the same shots renders **all three aspects emissive at once** (crop `...\c1c\crop-signal-seed23.png`
   at 21.5 shows red+yellow+green all glowing with bloom; `crop-signal-seed1-day.png` shows all three lit at
   noon — a traffic-module defect, out of this cycle's file scope). *Why:* the street preset is one of the
   five hero shots; a pole bisecting the frame and a signal showing a green + red + yellow simultaneous state
   are instant "not a shipped game" tells. *Fix (this cycle):* score both verge sides by obstruction count
   (props/lamps within ~6 m of the eye and inside the first ~120 m of the view cone) and choose the clear
   side; increase standoff until no prop is within ~4 m. *Fix (traffic module):* drive the lens emissives
   from the signal state.

4. **The golden-hour hero shot is not reproducible over session time (frame-count drift).**
   *Where:* measured with the same camera + tod 17.7 with no re-stage: `skyline` **s1 vs s2 = meanAbs 2.766**
   after 600 frames (sky band 2.32, ground 3.13; amplified diff `...\c1c\drift\diff-s1-s2.png` shows edges +
   window lights + sun column). `closeup`@17.7 +600 frames 0.659; `street`@21.5 0.124; cross-session
   `shot.mjs` pair 0.0408; batch diffs pass (r31/r32 0.018, c1/c1c 0.0045). *Root cause:* `src/environment/index.js`
   `update()` advances `S.time` / `uTime` / `uCloudOffset` every rendered frame (plus per-frame animations),
   so the sky + 5° sun bloom are a function of total frames rendered; the new skyline framing aims straight
   at the sun, maximising the visible delta. *Why it matters:* LOOP §2's drift gate ("same seed → same shots,
   meanAbs ≤ 0.30") only holds when both runs render the same number of frames per shot (scripted batches do);
   any cross-time hero comparison (e.g. a fix round vs this batch) can be off by ~3/255 and be mis-attributed
   to code. *Fix:* make the sky phase a pure function of the (paused) clock for captures — expose a debug
   `resetSkyPhase()` and call it in `shot.mjs`'s `stage()`; also record `stats.frame` in the capture JSON and
   assert frame alignment in `diff.mjs`.

5. **Showcase `street` fallback is still lifted by the polar clamp the cycle claims to have fixed.**
   *Where:* `src/core/camera.js` closeup/street fallbacks; reproduces on `?showcase=roads`. *Evidence:*
   authored `pos=[4,3.7,60] target=[4,4,−20]` → authored polar **90.21°** > `maxPolarAngle` 89.1° →
   `controls.update()` lifts the eye to y=5.2566 = **3.26 m above ground** (authored 1.7 m); terrain showcase
   gives 1.70 m. `check-beauty`'s eye band (1.6–4.5 m) passes either way. *Why:* ARCHITECTURE §6 now states
   the rule ("a street target must sit below the eye or the controls lift the camera"), and the fallback
   violates it; an empty world is exactly where the acceptance test never looks. *Fix:* set the fallback
   target below the authored eye (e.g. `target: [4, gh(4,60)+0.5, −20]`), and run the eye-height check on
   the showcase fallbacks too.

6. **The literal determinism grep gate cannot pass at HEAD; restate it.** *Where:* `src/menu/newCity.js:4`
   `Math.floor(Math.random()*1e9)` (the New City menu's seed — the seed *is* the deterministic input, so
   this is by design) and `src/menu/storage.js:56` (save UUID fallback). Both are byte-identical at HEAD
   `62b3c15`, none in this cycle's diff, and `src/core/composition.js` is genuinely RNG-free (stable
   tie-breaks on id). *Why:* LOOP §2 says "no `Math.random()` in src/"; taken literally, cycle 0 already
   failed it and a future critic may mis-score a cycle. *Fix:* restate as "no `Math.random()` in the
   sim/render path" and whitelist the two menu call sites in the protocol.

7. **Cosmetic list (already partly acknowledged, fix opportunistically):** skyline@17.7's sun bloom is a
   blown white blob that erases the mid-left towers (keep only if the report stops calling it a strength);
   closeup@21.5 in the batch renders the hero nearly black (`shots/game/r31/closeup-21h5.png`) — the batch
   shoots closeup at night though the hero path doesn't; wide shots still read green/zone-plate with
   terrain riser aliasing at the mountain top-right; aerial@21.5's industrial pads glow lemon-yellow. These
   are L2/L4/L6 levers, not cycle-1 blockers.

## What already works (verified, not repeated from the report)

- Subject awareness is real: skyline frames the tall cluster with the avenue and the sunset column
  (`skyline-18`/c1/01), overview frames the city + industrial pads + a big bay in the top third (5,411 water
  cells), street is genuinely at 2.8 m on a frontage-rich avenue, closeup lands on a civic building, and the
  aerial is a proper 42° high oblique with long dawn shadows. No preset is aimed at an empty field/plate in
  the seeded city (the empties that remain are within-frame terrain, issue 7).
- The eye→hero raycast fix works: first hit is the hero for seeds 1/2/23, and all 12 ranked civic
  candidates per seed find a valid unoccluded framing (no blank neighbour wall). The earlier "2D footprint
  test → 3D raycast" bug is genuinely dead.
- Street eye height is exact (2.8 m ± 3e-15) and survives `street → skyline → street` with zero drift;
  polar 88.85° < 89.1° so no clamp lift in the seeded city.
- Determinism of the batch/hero evidence: my independent r32 reproduces the builder's r31 (0.0183) and my
  c1c reproduces c1 (0.0045) — the shipped images really are what the current code renders.
- Perf is comfortable: r32 minFps 72.6, maxGpuMs 13.16, maxDrawCalls 856, errors 0; per-preset @21.5 all
  ≤ 13.16 ms and ≤ 789 draws, well inside 20 ms / 1500.
- HUD-free hero path, folder ownership, `createCamera` clock plumbing and the ARCHITECTURE §6 amendment all
  match the declared change set.

## What I did NOT verify

- Blind set 4 (E4) — not run; no judgements about judge appeal.
- The builder's lab metrics ("cover 0.64/0.70", 12×7 coverage grid) — their scripts are not in the repo; I
  did not reproduce those numbers. (The one concrete consequence of them I could test, the aerial bay, is
  refuted.)
- Seeds other than 1/2/23; weather variants; the `night` alias in the live game (only in the showcase probe
  and by code); mouse-drag/WASD interaction (only preset-to-preset application); the `?hud=0` state beyond
  `check-beauty`; module-level checks outside `src/core` (the traffic-signal lens state I report is
  observation-only, not a traffic-module audit).
- The exact cause of the residual 0.659 drift in `closeup@17.7` over 600 frames (attributed to continuous
  frame animations; not bisected to a single system).
- One capture artifact: a fresh-boot first screenshot can catch the loading overlay mid-fade if the capture
  is taken very early (my scratch script, settle 12 + 300 ms); the cycle's tools warm up first and were clean.

## Evidence paths (mine)

- Hero/falsification images: `C:\Users\ryuen\AppData\Local\Temp\opencode\c1c\` (`fallbacks\`, `seeds\`,
  `stability\`, `drift\`, `repro\`, `samesession\`, `crop-signal-*.png`, `crop.json`, `water-civic.json`,
  `controls.json`, `drift\diff-s1-s2.png`, `samesession\diff-x2.png`)
- check-beauty: `shots/beauty/c1c/summary.json` (+ `diff-vs-c1.json`)
- game batch: `shots/game/r32/summary.json` (+ `diff-vs-r31.json`)
- per-preset numbers: `shots/game/r32/summary.json` `shots[]`
- review: this file
