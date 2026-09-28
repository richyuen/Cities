# LOOP final report — max-effort fidelity loop, cycles 0–4 (STOPPED at the plateau rule)

**Verdict in one line:** the loop ran four improvement cycles with two hostile-verification passes each, fixed
every defect it found, and lifted the shipped product's internal quality substantially — but the blind A/B win
rate against `docs/reference` stayed 0/5 in all six sets, so per `docs/LOOP.md` §6 (three consecutive no-move
sets: 4, 5, 6) the loop **stops and reassesses** here.

## 1. The metric record (all six sets byte- and reason-audited)

| set | ours (build) | pairs | result | audit |
|---|---|---|---|---|
| 1 | game r3 | 5 | 0/5 | protocol hygiene issues only (4/5 side split) |
| 2 | game r22 | 5 | 0/5 | 4/5 side split flagged; reason-consistent |
| 3 | beauty v5 | 5 | 0/5 | corrected after a reason-shift audit |
| 4 | beauty c1fix3 (cycle 1) | 5 | 0/5 | valid (balanced 2/3, bytes+seed proven, 15/15 reasons) |
| 5 | beauty c2c (cycle 2) | 5 | 0/5 | valid (same protocol) |
| 6 | beauty set6 (cycle 4, curated + DOF) | 5 | 0/5 | valid (same protocol; audit `loop-c4-set6-audit.md`) |

The protocol was tightened after set 3: counterbalanced sides (`pairs.mjs --balance`), three fresh judges per set,
SHA-256 byte provenance, seed reproduction, and a per-reason image-consistency audit before banking. The 0/5s are
therefore trustworthy readings, not protocol noise.

## 2. What the loop shipped (product state is much better than at cycle 0)

| cycle | lever | headline result |
|---|---|---|
| 0 | protocol + baseline | `docs/LOOP.md`, `tools/diff.mjs`, `pairs.mjs --balance`, `check-beauty --out`; r30 baseline, drift measured |
| 1 | hero framing | `src/core/composition.js` + subject-aware presets (skyline/overview/aerial/street/closeup); aerial bay; civic hero closeup with 3D unocclusion and near-corner fit; street no-pole/clearance; one-lit traffic signals; sky-phase reset; `check-beauty` 37/37 |
| 2 | diorama detail (props) | 7 new kinds, **1439 C2 objects + 301 pedestrians + civic entrance clusters**; footprint-aware grounding (0 floaters), stable variation keys, fence lattice, boot cost −98% (~19 ms); `check-detail` 38/38 |
| 3 | buildings variety | shopfronts/awnings/signs (542 faces), balconies (347), roof clutter (589), five tower crowns, setbacks, facade rhythm; an in-cycle HIGH defect fixed (`faceSlab` axis: 492 → 0 parts outside footprints); re-verified 9/10 |
| 4 | depth + lighting | capture-mode tilt-shift (`?dof`, off = pixel-identical, +1 draw), low-sun bloom discipline (skyline clipped pixels −32%, night bit-stable), curated diorama shot list (`tools/shot-list.mjs`); `check-dof` 41/41, atmosphere 22/22 |

Performance never regressed out of budget: game r49 = **10.34 ms / 934 draws / 92 fps / 0 errors** (budget 20 ms /
1500 / 50 fps). Every cycle kept all existing checks green (`check-civics` 38/38, `check-detail` 38/38,
`check-beauty` 37/37, `check-atmosphere` 22/22, `check-dof` 41/41).

## 3. Why the metric did not move (the useful finding)

The judges' language evolved across six sets:

- sets 1–3: HUD/chrome complaints, "empty field", "data map" → fixed by cycle 1 (never mentioned again);
- sets 4–5: "flat", "sparse", "plain walls", "no characters" → partly addressed by cycles 2–3;
- set 6: every remaining reason is about **authored content at subject scale**: "layered landscaping",
  "pergolas, planters", "cornfields, windmill, trucks", "readable signage", "parked props, posed minifigures",
  "varied distinct facades". Our shots are procedural city fabric; the references are hand-authored marketing
  dioramas from shipped AAA games.

Three concrete findings:

1. **The fixed-band tilt-shift backfired.** All three judges in set 6 described it as a defect — "heavy
   depth-of-field mush", "ghostly translucent trees", "smeared road edges", "blurry foreground". The pass is
   engineered correctly (off = pixel-identical, +1 draw, deterministic) but a screen-space band blurs
   indiscriminately; a subject-aware focus (or none) is required. `?dof` remains **off by default**.
2. **Our best shots are now close, and lose on authored detail, not on framing or lighting.** The house,
   park, civic and street pairs are class-matched; the losses narrow to "few props / blank wall / repeated
   studs" — i.e. the subject itself needs more hand-authored content.
3. **The reference class is extremely hard by construction**: close-up dioramas with bokeh, props, figures,
   signage readable at 1:1. A procedural city builder can approach it only with set-piece content, not with
   global systems.

## 4. Recommended next steps (beyond this loop's scope, ranked)

1. **Authored hero set-pieces**: a small library of hand-placed (deterministically sited) landmark lots — a
   construction site with crane and scaffolding, a fairground/kiosk row with banners, a pergola garden with
   laundry and animals, a playground with swings/slides, a cafe terrace. These are what the judges call
   "layered landscaping / crammed props".
2. **Signage with words/letters**: decal/letter atlas on shop signs and awnings (the references show legible
   signage; ours are colour blocks).
3. **Subject-aware DOF**: bind focus to the framed subject's screen Y (or a depth-based bokeh), strengths
   0.3–0.5, validated with a judge panel before shipping into the capture path.
4. **Fairer pairing for the metric**: pair our shots against same-scale game screenshots (or a mix), so the
   metric measures achievable fidelity rather than marketing-diorama art direction; keep the reference set as
   the "aspirational" bar.
5. **Content depth in existing systems**: more prop variants per lot (tire swing, sandbox, pets, hanging
   laundry variants), animated pedestrians, facade decals, night streetlight window density (L4/L6 backlog).

## 5. Process learnings (for future loops)

- **Hostile verification earns its cost**: it caught a rotated awning/balcony class on 39% of buildings, two
  floating pedestrians and a tautological floater check, street face-plants on 2/3 seeds, and a stale-report
  claim — each fixed before banking.
- **Counterbalanced, proven, audited blind sets** make a 0/5 usable as a decision (it triggered a principled
  stop rather than more aimless polish).
- **Negative results are first-class**: the DOF finding is now documented as a design constraint, not hidden.
- **The internal bar is much higher than when the loop started**: every hero shot is now a deliberate
  composition with dressing, facades, lighting and depth available; the next wave should be content, not cameras.

## 6. Final state / how to resume

- Commits: cycle 0 `62b3c15`, cycle 1 `92c18bc` + `db33243` + `63527ad` + `1b54bc5`, cycle 2 `dfa211e` +
  `8b7d179` + `867b30d`, cycle 3 `e26987f`, cycle 4 `f1e9b0f` (plus the docs commits).
- Verification entry points: `node tools/check-beauty.mjs --out shots/beauty/<ver>` (preset + hero gates),
  `node tools/check-detail.mjs`, `node tools/check-dof.mjs`, `node tools/check-atmosphere.mjs`,
  `node tools/check-civics.mjs`, `node tools/critic.mjs --game --round N --dir …`.
- Blind-set flow: `node tools/shot-list.mjs --out shots/beauty/<ver> [--dof 0.5]` → `pairs.mjs --balance` →
  3 judges → audit (see `docs/LOOP.md` §3).
- The loop is resumable from `docs/LOOP.md`'s scoreboard; the stop is a plateau stop, not a failure of the
  process — the next wave should change the *content* class per §4.
