# LOOP — max-effort fidelity loop (Blox Skylines)

This is the protocol for the improvement loop that targets the one metric the project has not moved:
the **blind A/B win rate against `docs/reference`** (0/5 in sets 1–3). Internal scores, checks and perf
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

- `errors: []` in every captured JSON; dev server stays up on 5173; one GPU batch at a time (`nvidia-smi`
  before each batch; external load skews fps, not gpuMs — use `gpuMs`).
- Perf: `gpuMs ≤ 20`, drawCalls ≤ 1500, fps ≥ 50 for the full city.
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

Blind-set history: set1 (seed 7) 0/5; set2 (seed 11) 0/5; set3 (seed 23) 0/5 after correction.

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
