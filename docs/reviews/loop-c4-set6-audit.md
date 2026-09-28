# Blind set 6 — independent audit (Loop C4)

**Auditor:** independent subagent; no part in producing the renders, pairs, key, or verdicts. **Date:** 2026-09-28.
**Inputs read:** `docs/judge-set6-verdicts.md`, `docs/judge-key-set6.json`, all ten `judge/set6/pair-0{1..5}-{A,B}.png`
(viewed at full size, plus scratch 2× detail crops of `01-B` and `02-A`), `tools/shot-list.mjs`, `tools/pairs.mjs`.
Protocol: `--ours shots/beauty/set6 --theirs docs/reference --out judge/set6 --seed 43 --balance`.

## Verdict

**Set 6 is a valid 0/5 (0–15).** All ten pair files are SHA-256 byte-identical to the sources named in the key; the
seed-43 `--balance` A/B assignment reproduces byte-for-byte into scratch, with split 2/3; **all 15 reasons describe
content that is actually visible in the pair and on the side each reason names** — no shifted or inverted row, so no
pair is invalidated and no re-judge is required. One characterization is a stylistic read rather than a defect:
judge 1's pair-01 "broken geometry" (§3) — the balcony and proud windows it names do exist on B (ours), so it is not
a shift, and the loss stands. The leak check is clean. **Every one of the 15 votes is for the reference side: 0/5
pairs, 0–15 judge-votes.** The 0/5 is trustworthy as the loop stop signal: sets 4, 5 and 6 are all valid,
independently audited 0/5 (`docs/reviews/loop-c1-set4-audit.md`, `docs/reviews/loop-c2-set5-audit.md`, this audit),
which is exactly LOOP §6's three-consecutive-no-move trigger (caveats in §6).

## 1. Unblinded table check (independent, from the key)

Key `docs/judge-key-set6.json`: ours = `shots/beauty/set6`, theirs = `docs/reference`, seed 43, balance true,
split `{oursOnA: 2, theirsOnA: 3}`.

| pair | key A | key B | ours file (key) | all picks | picked side | result |
|---|---|---|---|---|---|---|
| 01 | theirs | ours | 01-house-golden.png | A ×3 | theirs (`ss_08751f…jpg`) | loss |
| 02 | ours | theirs | 02-park-noon.png | B ×3 | theirs (`ss_152213…jpg`) | loss |
| 03 | theirs | ours | 03-skyline-golden.png | A ×3 | theirs (`ss_abbf7c…jpg`) | loss |
| 04 | ours | theirs | 04-civic-golden.png | B ×3 | theirs (`ss_b3e407…jpg`) | loss |
| 05 | theirs | ours | 05-avenue-noon.png | A ×3 | theirs (`ss_f6daab…jpg`) | loss |

The verdicts doc's unblinded table matches this row for row: ours-on-B in 01/03/05, ours-on-A in 02/04, and the
"ours is" labels (house-golden / park-noon / skyline-golden / civic-golden / avenue-noon) match keyed files 01..05.
Aggregate: 15/15 votes are for the reference side → **0/5 pairs, 0–15**, as published. `judge/set6` holds exactly
five ours-side files and five reference-side files (no cycling). The doc's "sixth consecutive 0/5 (1–6)" is
consistent with `docs/LOOP.md` (line 94: sets 1–4 all 0/5) plus the audited set 5 and this set 6.

## 2. Reason–image consistency (all 15 reasons)

I checked every reason against both images of its pair, side by side, at full size plus detail crops where the
wording was specific. **All 15 rows name the correct side of the correct pair; no row describes the other image or
another pair. The set-3 shifted-reason failure mode is absent.** Content verified per row:

| judge | pair | checked claims (picked side / ours side) | result |
|---|---|---|---|
| 1 | 01 | A richly dressed house, soft DOF, coherent shadows / B balcony + proud windows, flat light, sparse | ✅ A = reference house+garden with background bokeh; B = purple block, projecting balcony, window panels proud of the facade, green stud fields, road. "Broken" → §3 |
| 1 | 02 | B dense skate park, minifigures, ramps, props, real shadows / A bare stud field, flat fountain, washed sky | ✅ B = reference skate diorama; A = our park: stud lawn, flat disk fountain, pale sky |
| 1 | 03 | A crisp dense skyline, readable signage, varied architecture / B blurry near-duplicate towers, DOF mush, empty green lots | ✅ A shows JOBS / QUILL / VIDEO PLANET signage; B towers repeat, foreground/edges mush, green lots with solar rows |
| 1 | 04 | B colorful farm, crops, vehicles, figures, crisp detail / A large blank white wall, few props, soft contrast | ✅ B = reference farm (corn, windmill, trucks, figures); A = hospital: big white cross wall, few props, flat light |
| 1 | 05 | A lively street, shops, awnings, signage, vehicles, minifigures / B mostly empty road, edge blur, repetitive slabs | ✅ A = reference storefront street with signs/figures/cars; B = boulevard, one car/bus, big blurred top band, repeated towers |
| 2 | 01 | A soft sunlight, DOF haze, layered landscaping, skyline / B flat-lit stud ground, empty road | ✅ same A as above with bokeh garden; B uniform stud lawn, near-empty road (a bus and bike rack only) |
| 2 | 02 | B packed props, shadows, figures, layered surfaces / A monotonous green studs, blurry edges | ✅ |
| 2 | 03 | A varied facades, parks, bridge / B repeating towers, heavy foreground blur | ✅ reference bridge visible top-right; B's foreground fades under tilt-shift |
| 2 | 04 | B crops, windmill, trucks, street life, crisp light / A plain white block, empty corner | ✅ |
| 2 | 05 | A signage, awnings, vehicles, figures, trees, high detail / B repetitive textures, washed light, bare blurry foreground | ✅ |
| 3 | 01 | A house, garden, pergola, planters, soft skyline / B flat purple block, near-empty green fields, smeared road edges | ✅ pergola with striped awning at left of A; B road edge smeared by the DOF band |
| 3 | 02 | B crisp minifigures, ramps, plants, props, clear light / A washed park, "ghostly translucent trees", heavy blur | ✅ side correct; trees are pale/milky and hazed in the blur (no literal transparency at 2×) — impressionistic wording only, see notes |
| 3 | 03 | A bridges, landmarks, hot-air balloon, streets, playground / B repetitive towers over empty lawns, severe DOF | ✅ balloon top-left, playground center of A; B as described |
| 3 | 04 | B windmill, cornfields, houses, vehicles, clean detail / A plain white hospital, washed light, blurry foreground | ✅ blurred crosswalk fills A's foreground |
| 3 | 05 | A storefront signs, cars, minifigures, picnic park / B blurry sparse road, green plots | ✅ picnic table with blanket bottom-left of A; B's green fields do carry studs, "untextured" = bare of detail, see notes |

**Notes (wording, not shifts):** (a) J3/02 "ghostly translucent trees" — the park's trees are opaque; the pale,
hazed, DOF-blurred canopies read ghostly, so the adjective is impressionistic, the side is correct. (b) J3/05
"untextured green plots" — visibly studded; "untextured" means bare of props/detail. (c) J1/02 "muddy fountain" —
the fountain is clean white/grey but flat. (d) J1/05 "repetitive slab towers" — the same facade pattern is
repeated across towers; fair. None of these flip a pick or name the wrong side, so none is a flag.

The verdicts doc's "Why" quotes trace to raw rows: "heavy depth-of-field mush" (J1/03), "blurry edges" (J2/02),
"ghostly translucent trees" (J3/02), "smeared road edges" (J3/01), "heavy edge blur" (J1/05), "blurry foreground"
(J3/04), "layered landscaping" (J2/01); "crammed props" is the summary's paraphrase of J2/02 "packed with readable
props". No new complaint class appears in the summary that is absent from the rows.

## 3. The pair-01 "broken geometry" finding (J1, side B = ours)

Judge 1's words: *"B has broken geometry — a balcony and windows jutting out of the flat facade — plus flat
lighting and sparse surroundings."* I inspected `pair-01-B.png` at full size and in a 2× crop of the upper-left
face and a full-building crop:

- The subject is a three-storey purple block with a flat roof. Its windows are cream/tan panels standing slightly
  proud of the wall, with visible frame and sill thickness — **uniformly, on all floors and both visible faces**,
  not one anomalous panel. This is the game's window-box relief style.
- On the upper-left face there is a grey balcony/utility platform: slab, railing posts and a few small grey boxes
  under the rail, attached to the facade. Nothing floats or detaches; no holes, inverted faces, gaps or z-fighting
  slivers are visible at 2×. The under-slab shadow is coherent lighting depth.
- **The described content exists** — a projecting balcony and proud windows on B's flat facade — so the row is not
  shifted or inverted (B is ours, and the elements are on B).
- **It reads as a stylistic read, not a product defect.** The only arguable oddity is the balconyless-door placement
  (a side balcony with no door behind it, briefly reading as a fire-escape), which is styling, not geometry. This
  matches the context given: the cycle-3 containment scan reported 0 parts >0.5 m outside footprints, so there is
  no geometric basis for "broken"; the judge is penalising the look of brick relief on a flat, undressed facade.

Pair-01's loss therefore stands (the other two judges on that pair cite content/detail, not geometry), and no
re-judge is required. If the owner wants judges to distinguish "brick relief" from "defect", that is a prompt/
standard question, not a set-6 validity question.

## 4. Leak check

- **Raw judge text (all 15 rows): clean.** No occurrence of ours/theirs, `AI`, engine/renderer/WebGL/procedural,
  game names (`Blox`, `Skylines`, `Cities`), filenames/extensions, preset names or paths, seed/key words, or
  authorship. The only token hit in the raw section is "skyline" ×4 as a content noun ("city skyline", "densely
  populated skyline"), never "skyline-golden". "Minifigures", "brick" and "diorama" are generic style nouns used
  for both sides (both sets are toy-brick renders), the same caveat as set 5's "LEGO-style".
- **No cross-judge copying:** the shared phrasings across the three panels are generic quality vocabulary
  ("flat", "blurry", "depth of field", "repetitive"); no distinctive shared sentence. No reason betrays knowing
  which side is ours, and the 15/15 sweep is what the visible close-up-vs-city scale gap predicts.
- **Orchestrator sections** (protocol, unblinding table, "Why", loop accounting) do contain ours/theirs and preset
  names, but they post-date judging and were not judge inputs; judge quote fidelity is spot-checked in §2.
- **Image metadata:** no `tEXt`/`iTXt`/`zTXt`/`eXIf` chunk exists in any of the ten pair files, and the ASCII tokens
  `set6`, `golden`, `noon`, `Blox`, `Skylines` do not occur anywhere in their bytes. The five ours-side files are
  true PNGs (`89 50 4E 47`); the five reference-side files are JPEG bytes under `.png` names (`FF D8 FF E0`, JFIF)
  — byte-identical copies of the keyed `.jpg` sources. Cosmetic, identical to sets 4–5, invisible to an
  image-viewing judge, and no metadata is exposed.
- **Filesystem:** `judge/set6` (checked with `-Force`) contains only the ten pair PNGs; no key, prompt or README
  sits beside them.

## 5. Provenance

**(a) SHA-256 of pair files vs keyed sources — 10/10 identical.** Each pair file equals the hash of the source path
recorded in the key; all ten are mutually distinct.

| file | SHA-256 | keyed source |
|---|---|---|
| pair-01-A.png | `E7BA17D39E19DA3D06061B365A9619387E4E477301A2F16FE4B438E1457B6E15` | docs/reference/ss_08751f…jpg (theirs) |
| pair-01-B.png | `499ADEC078F9841C879A615178C866339BCD928D136609452B839755538CEE17` | shots/beauty/set6/01-house-golden.png (ours) |
| pair-02-A.png | `0967E2A19F841B466265A2047322CF993E7AFCB7493028886E2EBB920BD0EC4B` | shots/beauty/set6/02-park-noon.png (ours) |
| pair-02-B.png | `A2E65D0354FFDB3D843B96A25FE09BB24D1006B8364460306A9B01507C48FDD6` | docs/reference/ss_152213…jpg (theirs) |
| pair-03-A.png | `9D5C7B759B5E5027B255A9611ECD2AB3787753AD6E425EE6A0FBAB0774CCB2E7` | docs/reference/ss_abbf7c…jpg (theirs) |
| pair-03-B.png | `50F7AFB571B73FEBFF06F0B81763B6CFB333102EB972E8291302333D2422A51C` | shots/beauty/set6/03-skyline-golden.png (ours) |
| pair-04-A.png | `FFE801643BDB946E6A7CA08245A985E2BDAE8398F02730435EC566C4F074DBDC` | shots/beauty/set6/04-civic-golden.png (ours) |
| pair-04-B.png | `EE070403C30B3BAE0F909142B9C7F118BD131490052D456E3CE8C4EE877E2454` | docs/reference/ss_b3e407…jpg (theirs) |
| pair-05-A.png | `5FCAA5280F9344CFE5334CDFF9CA8A81F5331AC39CE1CF17698B9DD58901C864` | docs/reference/ss_f6daab…jpg (theirs) |
| pair-05-B.png | `04569CB462F71D0589E9982A07796C66B0044FA46D58787C7B6183F71E489416` | shots/beauty/set6/05-avenue-noon.png (ours) |

The five reference hashes are the same five reference images used in sets 4 and 5; the reference pool is stable
across sets (relevant to §6), not a defect.

**(b) Shuffle reproduction — exact.** `node tools/pairs.mjs --ours shots/beauty/set6 --theirs docs/reference --out
C:\Users\ryuen\AppData\Local\Temp\opencode\a6\scratch6 --seed 43 --balance` (CWD repo root) regenerated 5 pairs whose
ten files are SHA-256 identical to `judge/set6/`, with the same A/B sides per pair; the scratch `pairs` array
equals the key's `pairs` array and the scratch split is 2/3. The run's side-effect key (`pairs.mjs` writes
`docs/judge-key-<basename>.json` relative to CWD) landed at `docs/judge-key-scratch6.json`, was diffed against the
real key and deleted; **`judge/set6` and `docs/judge-key-set6.json` were not rewritten**, and `git status --short`
is clean after the audit. The scratch directory (including crops) was deleted after the comparison.

**(c) Split.** ours on A: pairs 02, 04 (2). theirs on A: pairs 01, 03, 05 (3). Key `{oursOnA:2, theirsOnA:3}`,
verdicts doc and reproduction all agree.

**(d) Timeline / one build.** Ours sources were captured 2026-09-28 15:36:17–22 (`shots/beauty/set6/*.png`, with
per-shot `.json` sidecars and `summary.json`; `pairs.mjs` picks only the five PNGs). Reference sources are
2026-09-16 10:35:30–53. The pair copies preserve source mtimes exactly (ours pair files 15:36:17–22, reference
pair files 10:35:xx), and the key was written 15:36:53 — one capture → pairing build, no later rebuild.
`docs/judge-key-set6.json`: 1,286 bytes, SHA-256 `28319D4AFDAC9D49591956BA0268700D03C447751E7CAB7901606A1ACBDC62E3`.

## 6. Is the 0/5 trustworthy as the stop signal?

Yes, under the rule as written, with stated limits:

- **Counting:** sets 4, 5 and 6 are each valid 0/5 (sets 4–5 audited independently; set 6 above), so LOOP §6's
  "3 consecutive sets with no movement → stop" (`docs/LOOP.md` line 128) fires correctly. No pair has flipped in
  sets 4–6, or in sets 1–3 per `docs/LOOP.md` line 94 and the set-3 record.
- **Mechanism:** set 6's reasons give the cycle-4 read-out a consistent negative verdict — all three judges name
  the tilt-shift blur in our images ("heavy depth-of-field mush", "blurry edges", "ghostly", "smeared road
  edges", "heavy edge blur", "blurry foreground"). The stop is not an artifact of an unmeasured regression; the
  final lever was judged negative at this strength, and the content gap (authored diorama detail) never moved.
- **Independence limit:** the same five reference images were used in sets 4, 5 and 6 (verified from the three
  keys) with the same A/B format. The signal is therefore strong for "this approach class does not move the blind
  bar" but says nothing about absolute quality — it is a plateau/stop signal, not a regression signal.
- **Replication limit:** operational blindness and prompt fidelity are attestations (§7). Nothing in the text
  artifacts suggests a fake result, and the reasons are consistent with the pixels, so I found no reason to doubt
  the three consecutive 0/5s.

## 7. What I could not verify

- **Operational blindness** of the three judging sessions, that they ran in parallel, and that the key was not
  read until verdicts were recorded — protocol attestation only; no transcripts/logs in scope. The text
  artifacts are clean and show no leakage signature.
- **Prompt fidelity:** that each judge received the identical fixed prompt, and the prompt text itself (not in the
  repo). In particular, whether the prompt weighted photographic effects such as DOF, which matters to the
  "all three judges name the blur" finding.
- **Judge identity/channels:** that the three judges were distinct agents with no shared channel; the text shows
  no copying, but that is not proof.
- **The cycle-3 containment scan itself** (0 parts >0.5 m outside footprints) — supplied as context; I did not
  re-run it (audit-only session; no server or code changes). It affects the interpretation of §3, not the set-6
  result.
- **Counterfactual panels / absolute merit:** I verified every recorded reason matches visible content on the
  named side; I cannot verify that no alternative panel would flip a pair.
- **Reference provenance:** that `docs/reference/` images are shipped-game screenshots — out of scope, not
  audited.
