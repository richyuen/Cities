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

**E5 — Bank.** Acceptance passed + all gates green → commit to `main` (local only; no `git push` without
owner approval) + update STATUS + this scoreboard + backlog. Failed → revert to the last green commit or
park the branch state, record the negative result here.

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
| 6 | W5 subject craft + background (set-7 reasons) | (a) background: no bare zoned-empty lots or zoning plates read in the 01/03/04/05 frames (classifier + looked-at PNGs), without hiding real city state in the shipped game view; (b) set-piece minifigs read with printed faces/torso prints at hero distance; (c) ramps/slopes carry plate texture and no authored prop reads as loose debris at hero distance; (d) the 01 hero house has porch/dormer/siding-class detail; (e) gates as cycle 5 + `?nosp=1` census == e0f35033; (f) set 8 (new seed) with critic predictions logged. Win = ≥ 1/5; diagnostic = the set-7 reasons for the touched pairs disappear | set8 | — | in progress. **Owner decisions 2026-10-03:** (1) zoning overlay shown only while a zone tool is active (product change; minimap tint and hover ghost keep zones visible; `?zones=always` = old behaviour); (2) terrain sparse-stud "tiled lawn" on unbuilt land, tried last behind `?lawn=0`, A/B'd, reverted if it hurts. Order: props (B+C) → zoning (A1) → buildings (D) → demo → terrain (A2) |

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
