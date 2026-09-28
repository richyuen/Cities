# Blind set 4 — independent audit (Loop C1)

**Auditor:** independent subagent; no part in producing the renders, pairs, key, or verdicts. **Date:** 2026-09-28.
**Inputs read:** `docs/judge-set4-verdicts.md`, `docs/judge-key-set4.json`, all ten `judge/set4/pair-0{1..5}-{A,B}.png`
(viewed at full size, plus targeted crops), `tools/pairs.mjs`, prior set-3 audit (`docs/reviews/beauty-v5-critic.md` §4).

## Verdict

**Set 4 is a valid 0/5 (0–15).** All ten pair files are SHA-256 byte-identical to the sources named in the key; the
A/B assignment and the 2/3 split reproduce from `tools/pairs.mjs --seed 31 --balance`; **all 15 reasons describe
content that is actually visible in the pair and on the side each reason names** — no shifted, inverted, or foreign
row; no leakage of authorship, filenames, tool names, or game names in any reason. **No reason is flagged; no pair's
verdict is invalidated; no re-judge is required.** Two minor wording notes (below) are characterizations, not
mismatches. The orchestrator's only open doubt — judge 3's pair-02 "blank gray sky" — is resolved **in the judge's
favor**.

## 1. Unblinded table check (independent, from the key)

Key `docs/judge-key-set4.json`: ours = `shots/beauty/c1fix3`, theirs = `docs/reference`, seed 31, balance true,
split `{oursOnA: 2, theirsOnA: 3}`.

| pair | ours on | ours file (key) | all picks | picked side | pick→result | content of the picked side |
|---|---|---|---|---|---|---|
| 01 | **B** | 01-skyline-golden.png | A ×3 | theirs (`ss_08751f…jpg`) | **loss** | reference dollhouse close-up |
| 02 | **A** | 02-overview-noon.png | B ×3 | theirs (`ss_152213…jpg`) | **loss** | reference skatepark close-up |
| 03 | **A** | 03-street-night.png | B ×3 | theirs (`ss_abbf7c…jpg`) | **loss** | reference isometric day city |
| 04 | **B** | 04-closeup-golden.png | A ×3 | theirs (`ss_b3e407…jpg`) | **loss** | reference autumn farm |
| 05 | **B** | 05-aerial-dawn.png | A ×3 | theirs (`ss_f6daab…jpg`) | **loss** | reference dense street |

Every pick is a vote for the reference side (theirs), i.e. against ours. **Aggregate: 0/5 pairs, 15/15 judge-votes
against ours = 0–15**, matching the published unblinded table row for row (including the per-pair "ours is" column:
01 B, 02 A, 03 A, 04 B, 05 B). Split check: ours on A in pairs 02 and 03 only = **2/3**; keyed split matches.

## 2. Reason–image consistency (all 15 reasons)

I checked each reason against both images it names in the pair it is attached to (viewed directly; crops for the
fine claims). **All 15 match. None describes the other image, another pair, or a swapped side.**

| judge | pair | picked-side claim | ours-side claim | check |
|---|---|---|---|---|
| 1 | 01 | A close-up house, layered gardens, flowers, soft DOF | B flat washed-out aerial skyline, harsh white bloom | ✅ both visible (A = house close-up; B = golden-hour aerial with blown sun bloom) |
| 1 | 02 | B skatepark close-up, crisp detail, characters, props, DOF | A plain flat green map, uniform low-detail blocks | ✅ |
| 1 | 03 | B bright densely packed cityscape, varied architecture, trees, balloon | A dark sparse street dominated by empty asphalt | ✅ balloon present top-left of B |
| 1 | 04 | A autumn farm village, corn fields, characters, props | B plain white building, flat banded textures, empty roads | ✅ |
| 1 | 05 | A dense street of shops, signs, pedestrians, vehicles | B sparse flat aerial map of repetitive towers | ✅ |
| 2 | 01 | A dollhouse home: roof tiling, planter, porch, foliage, bokeh | B hazy aerial, blown sun glare washing out the left half | ✅ glare crop of pair-01-B confirms the left-half blowout |
| 2 | 02 | B populated skater-park, characters, ramps, trees, warm light | A flat evenly lit top-down city grid, no focal subject | ✅ |
| 2 | 03 | B isometric buildings, signage, playgrounds, fountain, balloon, daylight | A dim night street, huge empty roadway, near-identical box towers | ✅ crops confirm fountain with jets, playground, JOE'S/Cafe/Video Planet signage |
| 2 | 04 | A windmill farm, corn rows, trucks, characters, layered depth | B single plain white building, "flat untextured walls", large empty road | ✅🏷 windmill/trucks/figures crop-confirmed; "untextured" is loose (faint band seams) but names the correct building — see note A |
| 2 | 05 | A packed storefronts, awnings, legible signs, vehicles, pedestrians, rich color | B distant washed-out aerial of bare boxes on flat green | ✅ |
| 3 | 01 | A lit house scene, soft DOF, contact shadows, layered garden detail | B washed-out aerial, blobby sun glare, flat repetitive tower blocks | ✅ |
| 3 | 02 | B skate park, posed characters, crisp shadow work, clean material reads | A flat-lit overhead city, "blank gray sky", thin low-detail terrain at the edges | ✅ crop-confirmed — see note B |
| 3 | 03 | B dense colorful cityscape, signage, parks, vehicles, hot air balloon | A dark night street, empty road takes up half the frame | ✅ |
| 3 | 04 | A farm corner, distinct crops, buildings, vehicles, figures, clean lighting | B plain white box building, large empty wall surfaces | ✅ |
| 3 | 05 | A lively street, storefronts, awnings, signage, figures, soft shadows/depth | B distant aerial grid, near-identical towers over flat green | ✅ |

**Note A (judge 2, pair 04).** The pair-04-B walls carry faint horizontal band seams, so "untextured" overstates;
judge 1's "flat banded textures" and judge 3's "large empty wall surfaces" describe the same wall more precisely.
The image named is correct and the content is the same object; this is rhetoric, not a mismatch, so it does **not**
flag or invalidate the verdict.

**Note B (judge 3, pair 02) — orchestrator's doubt resolved.** A 2× crop of the top strip of `pair-02-A.png` shows
a featureless pale gray-blue sky band with no clouds; the map edges carry striated, low-detail terrain bands (also
crop-verified). "Blank gray sky" and "thin, low-detail terrain at the edges" are both accurate descriptions of
pair-02-A. The verdicts doc's line that this phrase "cannot be fully substantiated" is itself not substantiated by
the file; no caveat is needed.

No reason mentions HUD/chrome/framing — consistent with the doc's claim that the complaints moved to L2/L3 content
levers.

## 3. Leak check

- **Reason text (15/15) is clean.** No occurrence of ours/theirs, authorship words, `AI`, `renderer`, `Blender`,
  engine names (Unity/Unreal/Godot), game names (Lego/Blox/Cities/Skylines/Township/…), filenames, extensions
  (`.png`/`.jpg`), `pair-` IDs, or source paths. Every hit for those tokens in `judge-set4-verdicts.md` is in the
  orchestrator's protocol/unblinded/audit sections, not in a judge reason. Judge 1's "reads as a shipped scene"
  echoes the prompt's own "shipped-game screenshot", not authorship knowledge.
- **No quoting of the other side's content:** every reason describes attributes of the image it names.
- **No cross-judge copying:** only three shared 5-grams across all 15 reasons — `while a is a dark`,
  `plain white building with flat`, `depth while b is a` — all generic connective phrasing. No distinctive shared
  sentence; consistent with independently written reasons.
- **No key awareness evident:** reasons never betray knowing which side is ours; the 15/15 reference sweep is what
  the visible quality gap predicts, and no textual artifact suggests key access.
- **Image metadata:** the five ours-side PNGs contain no `tEXt`/`iTXt`/`zTXt`/`eXIf` chunks; the five reference
  files are bare JFIF JPEGs with no EXIF. ASCII token hits are unaligned strings inside compressed streams
  (pair-01-B `Lego` @505836; `AI ` in pair-02-A @238086, pair-03-B @210535/@296035, pair-04-A @557014/@652449),
  i.e. byte coincidences, not metadata. No in-image or side-channel naming leak. (Note: the reference-side pair
  files are JPEG bytes stored under a `.png` name — byte-identical copies; loaders sniff content, judges described
  them fine. Cosmetic only.)

## 4. Provenance

**(a) SHA-256 of pair files vs keyed sources — 10/10 identical.** Full hashes of `judge/set4/*.png` (each equals
the hash of the source path in the key):

| file | SHA-256 | keyed source |
|---|---|---|
| pair-01-A.png | `E7BA17D39E19DA3D06061B365A9619387E4E477301A2F16FE4B438E1457B6E15` | docs/reference/ss_08751f…jpg (theirs) |
| pair-01-B.png | `B33802DD03B19216CDA2433AF9BB6C981CE6C98C384BB7ADCF9108B7DC24851D` | shots/beauty/c1fix3/01-skyline-golden.png (ours) |
| pair-02-A.png | `C9737EAC5348258B2FE078BF3FBDEDB9FEC6EAB0A16764005BA902F9BA332E7A` | shots/beauty/c1fix3/02-overview-noon.png (ours) |
| pair-02-B.png | `A2E65D0354FFDB3D843B96A25FE09BB24D1006B8364460306A9B01507C48FDD6` | docs/reference/ss_152213…jpg (theirs) |
| pair-03-A.png | `582D940EBC56C3669C8DF438BC80A1D73763E961072B1FC4DCFF22C870A24B09` | shots/beauty/c1fix3/03-street-night.png (ours) |
| pair-03-B.png | `9D5C7B759B5E5027B255A9611ECD2AB3787753AD6E425EE6A0FBAB0774CCB2E7` | docs/reference/ss_abbf7c…jpg (theirs) |
| pair-04-A.png | `EE070403C30B3BAE0F909142B9C7F118BD131490052D456E3CE8C4EE877E2454` | docs/reference/ss_b3e407…jpg (theirs) |
| pair-04-B.png | `D91ABC324679D185A336F00C6A57926487D9832AF226742A5F6E17061D05B3F1` | shots/beauty/c1fix3/04-closeup-golden.png (ours) |
| pair-05-A.png | `5FCAA5280F9344CFE5334CDFF9CA8A81F5331AC39CE1CF17698B9DD58901C864` | docs/reference/ss_f6daab…jpg (theirs) |
| pair-05-B.png | `FD6B4BF8B0EBA2671D7973E9165E269BB2E8375F70DF707F557B84B67BF2226B` | shots/beauty/c1fix3/05-aerial-dawn.png (ours) |

All ten pair files are mutually distinct (no duplicated pair).

**(b) Shuffle reproduction.** `node tools/pairs.mjs --ours shots/beauty/c1fix3 --theirs docs/reference
--out <scratch>/set4 --seed 31 --balance` regenerated 5 pairs whose ten files are byte-identical (all ten hashes
equal, verified with `Get-FileHash SHA-256`) to `judge/set4/`, with the same A/B sides per pair and the same 2/3
split. Pairing is therefore fully determined by the documented seed and directory contents and matches the key.
*Operational caveat (disclosed):* `pairs.mjs` writes its key to `docs/judge-key-<basename(out)>.json` relative to
the process CWD, so a run from the repo root also rewrites the repo key even when `--out` points elsewhere. My
reproduction was re-run with the documented relative arguments, and `docs/judge-key-set4.json` is byte-identical to
the file read at the start of this audit (SHA-256 `026408E4A946C15C0772D955C528D3CEB8A74E390DABB0C1D7CE32C5E7E8B0FB`,
1304 bytes); no file in `judge/set4/` was modified. The scratch directory was deleted.

**(c) Split.** ours on A: pairs 02, 03 (2). theirs on A: pairs 01, 04, 05 (3). Matches key `{oursOnA:2,
theirsOnA:3}`.

## 5. Levers the reasons converge on (ranked, from all 15 reasons)

1. **Content density / micro-dressing** — named in every pair by all three judges: characters, props, vehicles,
   pedestrians, signage, crops, flowers, foliage. The single dominant complaint; the solo judges' "lively vs
   sparse" axis.
2. **Subject staging & depth of field** — pairs 01 (all three), 02, 04, 05: dollhouse close-up with bokeh, layered
   depth, "no focal subject" on ours.
3. **Shadow / material quality** — "contact shadows", "crisp shadow work", "clean material reads", vs flat banded
   walls and uniform facades (pairs 01/02/04).
4. **Lighting discipline** — blown-out sun glare/bloom (pair 01), washed-out haze (01/05), flat even light (02).
5. **Our map composition** — empty arterial road dominating the frame (03), plain unadorned facades (04), repeated
   towers over bare terrain (02/05).

Zero HUD/chrome/framing mentions; the set-3→4 shift to L2/L3 content levers is real.

## 6. What I could not verify

- **Operational blindness** of the three judging sessions (no transcripts/logs in scope). The text artifacts are
  clean and the protocol is described as parallel/no-key; but I cannot prove the judges never saw the key or each
  other's outputs. The unanimous 15/15 pick of the reference side is consistent with the visible quality gap and
  shows no leakage signature.
- **Prompt fidelity:** that each judge received the identical fixed prompt (only the verdicts doc's description).
- **Timeline:** that the key was not read until after all three verdicts were recorded (protocol attestation).
- **Reference provenance:** that `docs/reference/` images are shipped-game screenshots (out of scope; not audited).
- Interpretive adjectives ("posed", "cinematic", "clean") cannot be falsified against pixels; I verified the
  concrete nouns/objects in every reason.
