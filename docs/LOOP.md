# LOOP — max-effort fidelity loop (Blox Skylines)

This is the protocol for the improvement loop that targets the one metric the project has not moved:
the **blind A/B win rate against `docs/reference`** (0/5 in sets 1–4). Internal scores, checks and perf
budgets are regression guards, not the target. The loop is resumable: all state lives in this file's
scoreboard, `docs/STATUS.json`, `docs/reviews/` and git history.

## 0. Roles

| role | who | owns |
|---|---|---|
| orchestrator+integrator | the driving agent | sequencing, gates, `src/core/` + `tools/` edits, commits, STATUS/backlog/scoreboard |
| recon | `explore` subagent | file/line grounding, candidate approaches, cost/risk |
| builder | `general` subagent | one module folder per cycle (BUILDER_BRIEF.md rules apply) |
| critic | `general` subagent (fresh) | independent verification (CRITIC_BRIEF.md rules apply) |
| judges ×3 | `general` subagents (fresh, no key) | blind A/B verdicts |

Builders/critics read `docs/BUILDER_BRIEF.md` / `docs/CRITIC_BRIEF.md` first. The orchestrator is the only
one who may touch `src/core/`, `tools/`, `ARCHITECTURE.md`, `index.html`, `package.json`, and is the only one
who commits.

## 1. Cycle stages

**E0 — Scoreboard & pick.** Confirm main is at the last green commit. Pick the top backlog lever and write
the cycle goal as a falsifiable acceptance test (what changes, what evidence, what must not regress).
Refresh the baseline only if the previous cycle moved source.

**E1 — Recon & design.** One explore subagent. Deliverable: exact files/lines/values, 2–4 candidate
approaches ranked by expected blind-metric impact, cost, risk, and cross-module dependencies. The
orchestrator turns it into a builder brief.

**E2 — Build (max effort).** One builder subagent at a time (GPU batches are serialized). Owner-scoped
edits only; core/tools changes are orchestrator work. Evidence required: module check + module batch + a
fresh-load shot + at least one looked-at PNG per claim; `errors: []`; budgets within limits.

**E3 — Hostile verification.** Fresh critic subagent. Re-derives every number from its own runs, diffs
against the baseline, tries to falsify the builder's claims, writes `docs/reviews/<cycle>-critic.md` with a
ranked issue list. Up to 2 in-cycle fix rounds; otherwise the cycle is parked with evidence.

**E4 — Blind judge.** Build a new pair set (counterbalanced, below), run 3 fresh judges in parallel, each
with only the images and the structured template. The critic audits reason-image consistency and byte/seed
provenance **before** verdicts are banked. Inconsistent reasons → that pair is re-judged by fresh judges.

**E5 — Bank.** Acceptance passed + all gates green → commit to `main` and push (`git push origin main`; every
push deploys to GitHub Pages, see `CLAUDE.md`) + update STATUS + this scoreboard + backlog. Failed → revert to
the last green commit or park the uncommitted state (stash or a `docs/reviews` note), record the negative result
here.

**E6 — Replan.** Re-rank the backlog from the new evidence. Apply plateau rules (§6).

## 2. Hard gates (every cycle)

- `errors: []` in every captured JSON; dev server stays up on 5188; one GPU batch at a time (`nvidia-smi`
  before each batch; external load skews fps, not gpuMs — use `gpuMs`).
- Perf: `gpuMs ≤ 20`, drawCalls ≤ 1500, fps ≥ 50 for the full city. A per-module draw budget counts the
  module's **own** draw calls (e.g. `props` 61 of its 300), not the scene total of a showcase that deliberately
  loads other modules (cycle-2 yards variant: 384 = props 38 + buildings + scene).
- Determinism: no `Math.random()` in the sim/render path. Whitelisted: `src/menu/newCity.js` (the New City seed —
  the seed *is* the deterministic input) and `src/menu/storage.js` (save-id UUID fallback); both are pre-existing
  and outside the simulation. Same seed → same city and same shots.
- Drift budget: same-session meanAbs ≤ 0.30/255 on identical re-stages. `tools/shot.mjs` resets the animated sky
  phase (`__city.resetPresentation()`) on every stage and records the render `frame` in the capture JSON, so
  captures depend on (seed, tod, preset, settle) rather than session length; compare captures taken with the
  same settle counts.
- Regression: every cycle's batch diffed against the baseline batch; intended changes must be isolated
  (toggleable or A/B'd) so the critic can attribute them.
- Claims must match measurements exactly. No "pixel-identical", no rounding up, negative results recorded.

## 3. Blind protocol

- `node tools/pairs.mjs --ours shots/beauty/<ver> --theirs docs/reference --out judge/set<N> --seed <s> --balance`
  — `--balance` guarantees the ours/theirs side split is as even as possible (⌈n/2⌉/⌊n/2⌋) and randomized;
  the key records the split. Never reuse a seed from a previous set.
- Judges get: the 2n images, this template, and nothing else (no key, no repo context, no prior verdicts):
  > For each pair (01..N): say which image (A or B) looks like the more polished, shipped game screenshot,
  > then one sentence naming the specific things in the images that decided it. If you cannot tell, pick
  > the one you would put on a store page. Do not speculate about who made them.
- Bank only after the critic's audit: (a) every pair file is byte-identical (SHA-256) to its source, (b) the
  shuffle reproduces from `tools/pairs.mjs` + seed, (c) every judge reason describes content present in
  that pair's images. Any failure → that pair is re-judged with fresh judges.
- Record per set: win count, own-picks, reason consistency, side split. A win is real only when the criteria
  above hold.

## 4. Scoreboard

| cycle | lever | acceptance | blind set | wins | notes |
|---|---|---|---|---|---|
| 0 | protocol + baseline | LOOP.md committed, r30 baseline reproduced, drift measured, STATUS re-based | — | — | r30 72.0/13.34/844 errors 0; drift vs r29 meanAbs 0.0726; hero drift 0.0050; `pairs.mjs --balance` reproduces set1's old shuffle |
| 1 | L1 hero framing system | check-beauty gates + budgets + no regression + honest blind set | set4 | 0/5 | subject-aware presets (composition.js), aerial bay, civic closeup, street clearance, one-lit signals, sky-phase reset; 2 hostile verification rounds + 2 fix rounds; r37 100.0/9.71/856 errors 0; reasons narrowed to L2/L3 content/depth/detail |
| 2 | L2 diorama detail layer (props) | check-detail green + module/game budgets + no regression + honest blind set | set5 | 0/5 | 7 new prop kinds, 1439 C2 props, 301 pedestrians, civic clusters; 2 fix rounds (footprint-aware heights, stable variation keys, fence spacing, boot cost -98%); r42 921/10.41/93.1 errors 0; wide heroes still lose on scale, sun bloom and flat faces remain |
| 3 | L2b buildings facade + silhouette variety | check-civics/detail/beauty green + budgets + no regression; read-out combined into set 6 | (set6) | — | shopfronts/awnings/balconies/roof clutter/crowns/setbacks; HIGH defect fixed in-cycle (faceSlab axis: 492 -> 0 parts outside footprints); re-verified 9/10; r46 92.5/10.38/934 errors 0 |
| 4 | L3 depth + lighting discipline | check-dof + check-atmosphere green + budgets + A/B evidence; read-out combined into set 6 | set6 | 0/5 | capture-mode tilt-shift (?dof, off = pixel-identical, +1 draw, gpuMs +0.3-0.8) + low-sun bloom discipline (skyline clip -32%); r48 92.6/10.34/934 errors 0; curated diorama shot list replaced the wide heroes |
| — | **STOP (plateau)** | sets 4, 5, 6 all 0/5 unanimous → §6 stop rule | — | — | DOF at 0.85 judged negative ("mush/ghostly/smeared"); final state committed through cycle 4; reassessment in `docs/reviews/loop-final.md` |
| 5 | W1 authored hero set-pieces (wave 2, §8) | (a) ≥ 3 authored set-piece lots, deterministically sited in the demo city (seed 1 and 2 more seeds), each the framed subject of a shot-list entry; at least one aimed at each lost class: set-6 pair 01 (house: "layered landscaping, pergola, planters"), 02 (park: "packed minifigures, ramps, props"), 04 (civic vs farm: "blank wall, few props"); (b) gates: check-civics/detail/beauty/atmosphere green, game batch `errors: []`, gpuMs ≤ 20, draws ≤ 1500, same seed reproduces the same capture within the drift budget; (c) critic predicts ≥ "narrows" for 01/02/04 with pixel evidence; (d) set 7 (new seed, `?dof` off because set 6 judged 0.85 negative). Win = ≥ 1/5; diagnostic = the targeted pairs' "few props / bare field / blank wall" reasons disappear | set7 | **0/5** | 3 set-pieces built and sited (props 60d008b, demo+harness d21870c); critic r1 FIX 6.5 → r2 PASS 7.0 → r3 PASS 7.5 (one orchestrator claim falsified and corrected); set 7 audited VALID (0–15, 15/15 reasons consistent); every targeted set-6 reason category disappeared, and the new reasons are subject craft (house detail, printed minifigs, textured ramps), loose-looking authored props, bare background lots (4/5), signage, subject tilt-shift; critic ledger 5/5 on reason class, missed the 02 "likeliest win"; **infill disclosure:** cottage houses exist only around the set-pieces (the rest of the city has none) and densify into apartments in play |
| — | **STOP (§6, owner reassessment)** | sets 5, 6, 7 all 0/5 → §6 "3 consecutive sets with no movement overall"; owner reassessed 2026-10-02: **resume cycle 6** (keep the metric; attack the set-7 reasons) | — | — | the reason shift is real but no vote moved; levers for cycle 6 if resumed: background lots / zoning plates in frame, minifig printing, textured slopes, hero-house craft, subject-aware DOF (W3), signage (W2) |
| 6 | W5 subject craft + background (set-7 reasons) | (a) background: no bare zoned-empty lots or zoning plates read in the 01/03/04/05 frames (classifier + looked-at PNGs), without hiding real city state in the shipped game view; (b) set-piece minifigs read with printed faces/torso prints at hero distance; (c) ramps/slopes carry plate texture and no authored prop reads as loose debris at hero distance; (d) the 01 hero house has porch/dormer/siding-class detail; (e) gates as cycle 5 + `?nosp=1` census == e0f35033; (f) set 8 (new seed) with critic predictions logged. Win = ≥ 1/5; diagnostic = the set-7 reasons for the touched pairs disappear | set8 | **0/5** | **Owner decisions 2026-10-03:** (1) zoning overlay shown only while a zone tool is active (product change; minimap tint and hover ghost keep zones visible; `?zones=always` = old behaviour); (2) terrain sparse-stud "tiled lawn" on unbuilt land, tried last behind `?lawn=0`, A/B'd, reverted if it hurts. Order: props (B+C) → zoning (A1) → buildings (D) → demo → terrain (A2). Committed before the demo stage: props (1b460f9, critic PASS 8.0), zoning (291f161, PASS 7.5, zone tools only), capture harness (32af8d6 + c14a8d0), buildings house craft (c14a8d0, critic 7.5, nothing blocking for buildings). Paused by the owner 2026-10-04 mid demo stage (GPU contention with another project), **resumed 2026-10-09** on an idle GPU. **Demo stage done:** orchestrator decision before the critic: `dressApproach()` and the footprint-clip rule in `stampParkLand()` removed (the final-code 04 frame showed two or three isolated hedge blocks on bare studs = the set-7 "loose debris" look); the hero-house road-clearance rule and `dressHouseYard()` kept. Shipped: landmark hero house (sandGreen/darkRed), demo-owned garden hero camera (`heroCameras()`), flat-lot rule, park stamp (`?sppark=0`), camera-independent radius infill (cap 14), `check-detail` block 2d (frame-height gate raised 0.58 -> 0.70 after the review; measured 0.775). Acceptance on the final code: check-detail 46/46 (nosp census e0f35033, 43 demo-sp houses, 0 buried), civics 38/38, beauty 37/37, background 4/4 (emptyPlain 01 11.7 -> 2.2, 02 4.2 -> 3.3, 03 12.6, 04 16.2 -> 14.9, 05 10.9); game `shots/game/c6d2` errors 0, minFps 124.3, 7.76 ms, 824 draws, 0/20 over 0.30 vs c6h5 (mean 0.0825); nosp `c6d2-nosp` 0/20 vs c6h5-nosp (mean 0.0485; the builder's 2/20 run did not recur on an idle GPU); shot-lists `shots/beauty/c6d2-s1/-s2/-s23` clean; s1 repeat <= 0.014. **Critic PASS 7.5** (`docs/reviews/loop-c6-demo-critic.md`, integrity clean): boot stall +68 to +79 ms (builder's 285 -> 436 not reproduced: 114.7 -> 193.7 on seed 1), two boots hash-equal, flags isolate, save replay keeps the stamped cells / yard props / infill, `?showcase=demo` errors []. **Negative results:** (1) 04 farm frame building share fell 11.1 -> 7.2 (critic issue 1). The critic blamed the infill order; falsified by the orchestrator: cap 24/40, radius 110 and nearest-first order all read 7.1-7.5 (`shots/background/c6d2x-*`), so the lost houses stood on lots the new flat-lot / sidewalk-clearance rules correctly refuse. Carried, not fixed. (2) 04 bare baseplate barely moved (verge cells; lawn stage + props farm camera). Open, not fixed: pergola crowds the 01 porch and hides a figure's face on seed 2 (issue 4), sage look-alike neighbour on seed 1 (5), 2d occlusion is one ray against buildings only (6), `site miss: garden@2,1/NE` log noise (8); outside the diff: an in-page `applySave` replay duplicates street furniture and yard dressing with or without set-pieces (4339 -> 6284 props on nosp; real `?load=` path unmeasured; owner menu/props/roads), white bloom patch on gable roofs at noon from high south angles. Critic prediction for set 8 as the frames stand: 01 narrows, 02/03/05 no change, 04 no change with a risk of worse; 0/5. **Lawn panel pre-registration (written before panel 2 was built):** panel 1 (`judge/lawn1`, seed 61, fix-round-1 code with verge studs off) = 7/15 votes for `lawn=1` (frames 01 2/3, 03 3/3, 04 2/3, 02 0/3, 05 0/3): not a preference under the strict per-vote reading the orchestrator adopts. Fix round 2 (verge studs back, depth-less) gets ONE more panel, `judge/lawn2`, seed 67, fresh judges; it is final: `lawn=1` stays the default only with >= 8/15 votes, otherwise `LAWN_DEFAULT = 0` and the negative result is recorded. **Lawn stage done (kept as the default):** builder (`docs/reviews/loop-c6-lawn-builder.md`) implemented the design; the owner stopped the loop before its critic and resumed it the same day. Critic FIX 7.0 (`docs/reviews/loop-c6-lawn-critic.md`, integrity clean): gates green, `lawn=0` a sound control, one issue: sparse studs read as dark polka dots in 05, cause not found. Fix round 1 (`docs/reviews/loop-c6-lawn-fix-builder.md`): cause = the post AO (GTAO radius 0.7 + the grade's power curve) darkening the 0.17 m wall of an isolated stud about 10x (AO off: darkest 1% (8,48,25) -> (56,132,88)); terrain's lawn studs no longer write depth (sorted back to front), contact ring in the ground shader, relief rim softened; stopgap: verge studs off. **Orchestrator miss:** that stopgap went to panel 1 without a ruling, and all 8 votes against the lawn named the empty near field it left. Fix round 2 (orchestrator, `src/roads/studs.js` `depthless` + `LAWN_VERGE_STUDS = true`): roads' verge infill studs drawn depth-less in lawn mode. **Panel 2 (final, `judge/lawn2`, seed 67, fresh judges, bytes verified, reasons consistent; record in `docs/reviews/loop-c6-lawn-panel.md`): 10/15 for `lawn=1`** (01 3/3, 02 1/3, 03 3/3, 04 3/3, 05 0/3) -> kept. 05 still loses 3/3 ("pale, washed-out mint expanse, empty at close range"): an open defect, not solved. Panels compare separate boots (vehicle positions differ); no reason cites a vehicle. Critic ledger for panel 1: predicted 4/5 frames as-is and 5/5 with 05 fixed; got 3/5 (missed 02 and 05). Gates on the final code: game `shots/game/c6lawn1g` errors 0, minFps 130.5, 7.38 ms, 824 draws, no shot above `lawn=0`'s draws; `lawn=0` batch `c6lawn0g` vs c6d2 0/20 over 0.30 (mean 0.0675, worst closeup-6h5 0.2436 and street-12 0.2013, both localised to vehicle-sized blobs); `lawn=0` shot-list vs c6d2-s1 <= 0.0102; detail 46/46 (first run with the 0.70 2d gate; nosp census e0f35033), atmosphere 22/22, beauty 37/37, civics 38/38, background 4/4. ARCHITECTURE section 7 and REFERENCE.md amended. **Not verified:** no critic has reviewed fix rounds 1-2 (depth-less studs: pan flicker between re-sorts, transparent surfaces over studs, re-sort CPU cost, seeds 2/23, `lawn=2`/`3`); the roads-side sort is new code seen only through the gates above. Requests to effects/roads: `docs/core-requests/terrain-c6-lawn.md`. **Set 8 (`judge/set8`, seed 71, balanced 2/3, ours = seed-1 shot-list on 1637803, `?dof` off): 0/5, 0/15 votes, unanimous; audit VALID** (`docs/reviews/loop-c6-set8-audit.md`: 10/10 bytes, shuffle reproduced, 15/15 reasons consistent; raw verdicts in `loop-c6-set8-verdicts.md`). **Reason shift vs set 7 (diagnostic, not a win):** gone on ours: "box / blocky houses" for the subject (01), "stud-grid lots" (01, 04), "blank / faceless figures" and "loose pieces" (02; the latter is now cited only against the reference), the word "baseplate" (0 of 15). Persist: repeated towers (03, 05: 3/3 each), empty lots (03, 04, 05), sun glare (03), flat ramps and stiff figures (02), empty road and oversized kerb studs (05), reference DOF / tilt-shift (01, 02). New against ours: "flatter / smooth-shaded" house and "plain cooling-tower backdrop" (01, 3/3 each), "identical" figures and no gloss (02), "noisy stalk masses" (04), and the lawn as a named negative ("flat tile lawn" 01 J3, "large flat green plates" 04, "pale-green" field 05 3/3) with no positive mention. Acceptance (a)-(d) met in the reason-class sense for 01/02/04; the win condition (>= 1/5) is not. Prediction ledger: lawn critic 4/5 on reason class, demo critic 4/5 strict (both missed the 02 reasons moving); neither under 50%. Audit's ranked levers from the 15 reasons: (1) background buildings / backdrop variety (9 of 15 reasons, pairs 01, 03, 05; untouched by cycle 6), (2) shading and material response plus subject DOF (01, 02, 04), (3) the 05 near field (empty road, kerb stud scale, pale lawn; the ground-level camera is itself named) |
| — | **STOP (§6, owner reassessment)** | sets 5, 6, 7, 8 all 0/5 → §6 "3 consecutive sets with no movement overall"; cycle 6 banked 2026-10-09 (demo 7b85d48, lawn 1637803) | — | — | reasons moved on three pairs for the second cycle running and no vote moved (0/15 in sets 7 and 8). Open at the stop: 05 pale near-field lawn (lost 3/3 in both lawn panels and is named in set 8), the lawn fix rounds are not critic-reviewed, 04 lost background houses (11.1 -> 7.2 building share), pergola crop in 01, save-replay prop duplication (outside the cycle). Still blocked on owner input: the same-scale secondary metric (`docs/reference-ingame/`) and a larger reference pool |

Blind-set history: set1 (seed 7) 0/5; set2 (seed 11) 0/5; set3 (seed 23) 0/5 after correction; set4 (seed 31,
balanced 2/3, audited) 0/5 — no chrome/empty-field mentions left, levers narrowed to content/depth/detail.

**Backlog status:** L1 done (cycle 1), L2 built + fix rounds (cycle 2, pending set 5), L3 + lighting next
(cycle 4 draft), L4 partially served by cycle 2 (figures/props), L5 mostly open, L6 untouched.

## 5. Backlog (ranked; re-rank at E6)

**L1 — Hero framing system (composition).** Presets must frame crafted subjects, not empty fields/data maps.
Sources: game-r22-critic #1, beauty-v5-critic #2/#3, set 1–3 reasons. Work: designate hero subjects in the
demo city (civic 3/4, townhouse street, waterfront pier, downtown tower), rebuild the preset family as a
shot list (oblique aerial with foreground anchor, closeup that fits the hero, night street with a lit
subject, dawn-azimuth), add an automated hero-frame scorer to `check-beauty`.

**L2 — Diorama detail layer (micro-dressing).** Garden plots, fences, laundry, picnic sets, crates, bikes,
figures around hero blocks and civic/landmark buildings; deterministic, budgeted. Every loss shares this
complaint.

**L3 — Cinematic depth.** Tilt-shift/DOF post pass, capture/quality-gated, A/B'd with gpuMs and a
gameplay-legibility check; ARCHITECTURE §7 amendment via integrator.

**L4 — Density toward camera.** Traffic/prop bias to arterials; pedestrians; construction/crane set pieces.

**L5 — Hygiene & open defects.** STATUS re-base (done in cycle 0); demo showcase transit stops; transit
`A→B→A` dwell; line letter reuse; paused-edit divergence; C2/C4/C5/C6 follow-ups; demo r2 follow-ups.

**L6 — Module ≥9 pushes.** Terrain noon relief; zoning industrial top face; audio aerial trees; props
flower blooms; roads UV steps; environment rig terrain; terrain closeup framing.

## 6. Stop / plateau rules

- Stop when blind set ≥ 3/5 wins with zero chrome/HUD mentions AND all gates green.
- 2 consecutive cycles with no blind-set movement on the same lever → change approach class (e.g. tuning →
  scene-system restructure), not another pass.
- 3 consecutive sets with no movement overall → stop and reassess with the owner.
- Cycle cap: 6 (or the owner's call).

## 7. Tooling notes

- **Baseline re-based in cycle 5:** `shots/game/c5o-nosp` (`--param nosp=1`, census-identical to the pre-cycle city)
  replaces r49. `resetPresentation()` now also rewinds the zoning pulse and runs environment's CSM material sweep,
  so captures no longer depend on boot event history or session length: same-code repeat 0.004 mean (was ~0.07);
  r49 vs c5o-nosp is 10/20 over 0.30. **Correction (critic r3 falsified the first attribution):** this is NOT caused by
  the reset change. With the new lines disabled in-page the nosp city is still 8/20 over r49 (overview-12 1.79). The
  cause is a pre-existing boot-time race in the old harness: zoning plates get CSM only when environment's sweep fires
  (absent at frame 125, present by frame 727 in an unpaused boot), and r49 landed on the other side of it. The reset
  makes it deterministic (always swept = the look players get within ~12 s of play); the r49 state is not
  reproducible. Compare pre-c5 batches only against pre-c5 batches.
- **Known nondeterminism (c6 props critic, issue 5):** `src/traffic/index.js:577` debounces the lane-graph rebuild on
  wall time (`performance.now() - S.lastEvent > 30`), so the boot frame at which cars spawn varies between identical
  loads. That explains intermittent 0.2–0.3 meanAbs in road corners of shot-list frames (e.g. set7 vs c5crit3 02) and
  about 0.03 batch means. Cars are outside the judged subjects. Owner: traffic (debounce on frames under `fixeddt`);
  until it is fixed, attribute road-corner-only diffs to this, never to the module under test.
- **Capture order fixed (c6, zoning critic issue 2):** `capture()` now holds the render loop on the exact settle
  frame (`__city.holdAfter(n)` / `release()`, an `app.frozen` flag in src/main.js), screenshots it, then lets 100 frames
  roll the held gap out of FrameStats' 90-frame window before sampling fps/gpuMs. Previously the free-running sample
  window rendered a number of frames proportional to fps before the screenshot, so any perf change moved the sky,
  cloud, traffic and signal phase. Verified: night skyline, two loads plus a 3x sample window → identical (frame 51,
  0.0000). Game batch repeat 0.0047 (c6h3 vs c6h4), minFps 121–126. **New baseline: `shots/game/c6h3`** (default, plates hidden).
  Pre-c6h batches are not pixel-comparable (different captured frame).
- **Capture follow-up (c6 buildings critic, issues 1–2), fixed in tools/shot.mjs:** (1) `openApp` removes the boot
  overlay (`#lc-boot`) as soon as the app is ready. The new order could screenshot it mid-fade (1 of 8 cold single-shot
  loads, 3.94 meanAbs). Waiting for the fade was tried and rejected: it is wall time, and the held frame then varied
  69–87. (2) `capture()` releases the hold in a `finally`, and releases, resets the presentation and schedules the
  hold in ONE in-page call, so the screenshot is exactly `settle` frames after the reset whatever the round-trip
  latency. (3) `close()` gives `browser.close()` 8 s, then kills and disconnects (it sometimes never resolves on
  this machine); the shot CLI exits explicitly. **Verified:** 8 cold loads of night skyline all exit 0; loads 2–8
  match each other (l2 vs l3: 22 px differ) and differ from load 1 by 0.0115 (about 617 px, the size of the traffic
  case; location not checked); settle 5 is clean (0.07 vs settle 45, no overlay). **Not yet verified:** a full
  game batch and the check-* tools on this final version (the run was cut short when the session ran low on memory).
  Re-run `critic.mjs --game` vs c6h3 and one check tool before trusting new batches. Still free-running (not
  diffed): the direct `page.screenshot` calls in check-atmosphere, check-stats, check-transit and check-views.
- **Shared machine (c6 demo stage):** another project may be running its own Playwright/Chromium and node processes
  here. Never kill `chrome`/`node` by name (kill only the PID tree of your own hung run). Under that load fps is not
  usable (a batch read minFps 19.7 with gpuMs 8.72) and a batch can exceed the drift budget once (nosp run 1: 2/20
  over 0.30, run 2: 0/20); rerun before attributing a diff to the code, and say which run a number came from.
- `--param k=v` (repeatable) on `tools/shot.mjs`/`tools/critic.mjs` forwards URL flags (e.g. `--param nosp=1`).
- Baseline: `shots/game/r30` (game batch) + `shots/beauty/<ver>` (hero shots). Pre-r28 whole-game batches
  are pixel-incomparable after the V5 preset change.
- `node tools/critic.mjs --game --round N --dir shots/game/rN` — 20 shots.
- `node tools/diff.mjs --a shots/game/r29-critic --b shots/game/r30` — same-name PNG regression diff
  (meanAbs / pctOver / maxDelta); drift budget 0.30 meanAbs same-session.
- `node tools/check-beauty.mjs --out shots/beauty/r30` — HUD flag + preset geometry + hero capture; extend,
  don't fork. Never overwrite `shots/beauty/v5` (the judged set-3 source).
- `node tools/shot.mjs --preset X --tod T --hud 0 --out …` — single hero capture.
- Vite can serve a stale transform after an edit (B6 note): verify the served module before trusting a
  batch; only if stale, restart vite (`Stop-Process` the node process, `npm run dev`) — never change the port.

## 8. v2 rules (wave 2, from cycle 5; owner restart 2026-10-02 after the §6 plateau stop)

The owner reviewed `docs/reviews/loop-final.md` and restarted the loop. The §6 reassessment's outcome is to change
the **content class**: wave 2 levers come from loop-final §4, not the L1–L6 backlog (those stay as hygiene).

**Wave-2 backlog (ranked):**
- **W1 — Authored hero set-pieces.** Hand-designed, deterministically sited landmark lots built from the
  existing brick vocabulary: construction site (crane, scaffolding, materials), cafe terrace, playground,
  pergola garden (laundry, animals), fairground/kiosk row with banners. Each must be frameable by the shot list
  at diorama scale. Targets the set-6 reasons "layered landscaping", "crammed props", "posed minifigures".
- **W2 — Legible signage.** A letter/decal atlas on shop signs, awnings and civic fronts (set-6: "readable
  signage"; ours are colour blocks).
- **W3 — Subject-aware depth.** Focus bound to the framed subject (depth-based, strength 0.3–0.5); a judge
  panel A/B is required before it may enter the capture path (set-6 found the fixed band to be a defect).
- **W4 — Content depth in existing systems.** More prop variants per lot, animated pedestrians, facade decals,
  night window density.

**Enforced roles (`.claude/agents/`):**
- `critic`: tools Bash/Read/Glob/Grep only (no Edit/Write). It returns its review as its final message; the
  orchestrator saves it verbatim to `docs/reviews/<cycle>-critic.md`. **Integrity check:** the orchestrator
  runs `git status --porcelain -- src tools docs ARCHITECTURE.md index.html package.json` before and after every
  critic run. Any change by the critic voids the review and gets reverted, and a fresh critic reruns.
- `judge`: Read tool only, the images and the fixed template, nothing else. The audit checks that every reason
  matches its pair.
- (If the agent definitions are not loaded in a session, use `general-purpose` subagents with the full text of
  `.claude/agents/<role>.md` pasted in as the prompt preamble; the integrity check still applies.)

**Prediction ledger (makes the critic falsifiable).** At E3 the critic predicts, per blind pair, whether the cycle
`closes / narrows / no change / worse` the reference's deciding advantage. After E4 the orchestrator scores each
prediction against the judges' reasons and records the critic's hit rate in the scoreboard notes. Two
consecutive cycles with a hit rate < 50% → the critic brief is revised before the next cycle.

**Metric additions:**
- **Primary (unchanged):** blind A/B vs `docs/reference` (5 marketing dioramas), `pairs.mjs --balance`,
  3 fresh judges, audited.
- **Secondary (needs owner input):** a same-scale panel, meaning ours vs in-game (not marketing) screenshots of
  shipped city builders at a matching camera distance, so the metric can register achievable progress. **Blocked
  until the owner supplies the images** in `docs/reference-ingame/` (the loop never downloads or fabricates
  reference images). Until then, only the primary metric is reported.
- **Reference freshness:** sets 4–6 reused the same five references. When the owner adds references, new sets
  draw from the larger pool, and the key records which were used.
- **Reason-shift tracking:** even at 0/N, the audit lists each set's deciding reasons. A cycle counts as
  "moved the reasons" when a reason category from the previous set disappears for the pair the cycle targeted.
  This is a diagnostic only, never a win.

**Wave-2 stop rules:** §6 applies, with the cycle cap reset to cycles 5–8. A stop now ends with an owner reassessment again.
