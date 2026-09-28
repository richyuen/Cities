# Blind set 5 — independent audit (Loop C2)

**Auditor:** independent subagent; no part in producing the renders, pairs, key, or verdicts. **Date:** 2026-09-28.
**Inputs read:** `docs/judge-set5-verdicts.md`, `docs/judge-key-set5.json`, all ten `judge/set5/pair-0{1..5}-{A,B}.png`
(viewed at full size), `tools/pairs.mjs`. Protocol: `--ours shots/beauty/c2c --theirs docs/reference --out judge/set5
--seed 41 --balance`.

## Verdict

**Set 5 is a valid 0/5 (0–15).** All ten pair files are SHA-256 byte-identical to the sources named in the key; the
A/B assignment and the 2/3 split reproduce exactly from `tools/pairs.mjs --seed 41 --balance`; **all 15 reasons
describe content that is actually visible in the pair and on the side each reason names** — no shifted, inverted, or
foreign row, so no pair's verdict is invalidated and no re-judge is required. The leak check is clean (one style
simile, "LEGO-style", below). **No pair has flipped: every one of the 15 votes is for the reference side.**

## 1. Unblinded table check (independent, from the key)

Key `docs/judge-key-set5.json`: ours = `shots/beauty/c2c`, theirs = `docs/reference`, seed 41, balance true,
split `{oursOnA: 2, theirsOnA: 3}`.

| pair | ours on | ours file (key) | all picks | picked side | pick→result | content of the picked side |
|---|---|---|---|---|---|---|
| 01 | **B** | 01-skyline-golden.png | A ×3 | theirs (`ss_08751f…jpg`) | **loss** | close-up brick house, garden, bokeh |
| 02 | **B** | 02-overview-noon.png | A ×3 | theirs (`ss_152213…jpg`) | **loss** | isometric skate-park diorama with minifigures |
| 03 | **A** | 03-street-night.png | B ×3 | theirs (`ss_abbf7c…jpg`) | **loss** | dense daylight downtown, river, bridge, balloon |
| 04 | **B** | 04-closeup-golden.png | A ×3 | theirs (`ss_b3e407…jpg`) | **loss** | autumn farm village with windmill, corn, trucks |
| 05 | **A** | 05-aerial-dawn.png | B ×3 | theirs (`ss_f6daab…jpg`) | **loss** | street-level storefront block, signs, traffic |

Every pick is a vote for the reference side (theirs), i.e. against ours. **Aggregate: 0/5 pairs, 15/15 judge-votes
against ours = 0–15**, matching the published unblinded table row for row (including the per-pair "ours is" column:
01 B, 02 B, 03 A, 04 B, 05 A). Split check: ours on A in pairs 03 and 05 only = **2/3**; keyed split matches. The
judged directory contents are 5 ours + 5 theirs, i.e. a 1:1 pairing with no cycling.

## 2. Reason–image consistency (all 15 reasons)

I checked each reason against both images of the pair it is attached to, side by side. **All 15 match; none
describes the other image, another pair, or a swapped side. The set-3 failure mode is absent.**

| judge | pair | picked-side claim | ours-side claim | check |
|---|---|---|---|---|
| 1 | 01 | A close-up brick house, prop detail, soft DOF, no blowout | B aerial skyline washed out by huge bloom flare, flat tiling | ✅ A = house close-up with bokeh; B = golden aerial with large sun bloom |
| 1 | 02 | A isometric skate park, sharp characters, props, vignetting | B flat low-detail aerial grid, plain green ground, no subject | ✅ both visible; "plain solid-green ground" mildly understates B's field patches — characterization only |
| 1 | 03 | B dense colorful cityscape, water, bridge, balloon, signage, daylight | A dark noisy street, repeated stud geometry, "harsh light bloom" | ✅ content right, but A shows no strong bloom (streetlight glow only) — **see note A** |
| 1 | 04 | A farm: windmill, corn rows, trucks, villagers, hay bales, warm light | B large white hospital block, flat blank walls, no activity | ✅ objects all present; B has a few door figures — "no activity" is rhetorical |
| 1 | 05 | B street-level storefronts, signage, buses, pedestrians, depth | A hazy top-down sprawl of repetitive towers on flat green | ✅ |
| 2 | 01 | A crisp voxel detail, soft DOF, warm lighting | B flatter aerial, blown sun glare, repetitive windows | ✅ |
| 2 | 02 | A sharply lit, detail-dense "street-level" scene, clear DOF | B flat low-detail aerial map, washed greens | ✅ content right; "street-level" is loose for a downward isometric diorama — **see note B** |
| 2 | 03 | B packed colorful panorama, varied architecture, foliage, haze | A dark sparse night street, plain building faces | ✅ |
| 2 | 04 | A textured corn fields, windmill, varied props, warm light | B near-empty white building, "flat untextured walls" | ✅ same single white building; faint wall seams exist — **see note C** |
| 2 | 05 | B detailed storefronts, signage, characters, vehicles, daylight | A hazy low-detail aerial, muted colors | ✅ |
| 3 | 01 | A sharp hero house, soft background bokeh, grounded props | B blown out by bloom and lens flare, rows of near-identical blocks | ✅ |
| 3 | 02 | A crisp shadow-rich skate park, minifigures, props | B flat hazy wide shot, tiny low-detail buildings | ✅ |
| 3 | 03 | B vivid dense downtown, legible signs, greenery, balloon, bridge | A dark frame dominated by empty asphalt, flat lighting | ✅ balloon top-left, cable bridge right, QUILT/VIDEO PLANET signage |
| 3 | 04 | A busy farm vista: windmill, corn rows, trucks, houses | B plain white slab, grainy dithering artifacts, empty street foreground | ✅ the dither/stipple on B's wall shadow is visible |
| 3 | 05 | B lively street, varied storefronts, legible signage, traffic, DOF falloff | A hazy wide city view, washed colors, tiny indistinct buildings | ✅ |

**Note A (judge 1, pair 03).** Pair-03-A is a dark night street with visible stud rows and film-grain-like noise, but
there is no "harsh light bloom" in it — the street lamps glow softly. The named side is correct and the rest of the
sentence is accurate; this is an embellishment, not a shift, so it does not flag or invalidate the verdict.

**Note B (judge 2, pair 02).** Pair-02-A is a high three-quarter/isometric view, not literally street level;
"detail-dense scene with clear depth of field" is accurate. Characterizations, not mismatches.

**Note C (judge 2, pair 04).** Pair-04-B's walls carry faint horizontal band seams, so "untextured" overstates;
judges 1 and 3 describe the same wall as "flat blank walls" / "white slab". Same object, correct side, no flag.

No reason mentions HUD, UI chrome, or framing; the complaints are all content/lighting/scale (no judge asks for
"props" to be added to a specific building, unlike the set-2-style complaints). The orchestrator's "Why" quotes
were checked against the raw rows: "huge bloom flare" (J1/01), "blown out … lens
flare" (J3/01) ✓; "empty asphalt" (J3/03), "plain building faces" (J2/03), "repeated stud geometry" (J1/03) ✓;
"flat blank walls" (J1/04), "grainy dithering artifacts" (J3/04), "empty street foreground" (J3/04) ✓; and DOF/bokeh
is named by all three judges ("soft depth of field" J1/01, "clear depth of field" J2/01–02, "soft background bokeh"
J3/01, "depth-of-field falloff" J3/05) ✓.

## 3. Leak check

- **Reason text (15/15) is clean.** No occurrence of ours/theirs/authorship words, `AI`, engine names, game names
  (`Blox`, `Skylines`, …), filenames, extensions, `pair-` IDs, or source paths in any judge row. Token hits for
  "ours", "theirs", "key", "seed", "c2c" in `judge-set5-verdicts.md` all fall in the orchestrator's protocol,
  unblinding, and analysis sections (lines 1–7 and 41–74), never in a reason.
- **One style simile, not a leak:** judge 3 calls pair-02-**A** "LEGO-style" (and names "minifigures"); judge 1 says
  "character models". These are style nouns for the reference-side diorama; both images in that pair are brick-style
  renders, so the wording does not identify which side is ours. No reason otherwise hints at the source of either
  image, and none echoes a preset/filename (no "golden", "dawn", "overview", "closeup" in any reason; "aerial
  skyline" in J1/01 is the image's content, not the preset name).
- **No cross-judge copying:** the only shared phrasings across the three independent judges are generic
  ("soft depth of field", "flat, low-detail aerial", "hazy … aerial", "while A is a dark"). No shared distinctive
  sentence; the duplicated vocabulary is what the visible quality gap predicts.
- **No key awareness evident:** no reason betrays knowing which side is ours; the 15/15 reference sweep is what the
  visible scale/detail gap predicts.
- **Image metadata:** the five ours-side pair files are genuine PNGs (`89 50 4E 47`); the five reference-side files
  are JPEG bytes stored under a `.png` name (`FF D8 FF E0`, `JFIF` at offset 6) — byte-identical copies; cosmetic,
  same caveat as set 4. No `tEXt`/`iTXt`/`zTXt`/`eXIf` chunk signature exists in any of the ten files. ASCII token
  hits are unaligned strings inside compressed streams: `Lego` @505954 in pair-01-B; `AI ` in pair-01-B @1092472,
  pair-02-B @238106, pair-03-B @210535, pair-04-A @557014, pair-04-B @1843207 — byte coincidences, not metadata.

## 4. Provenance

**(a) SHA-256 of pair files vs keyed sources — 10/10 identical.** Each hash equals the hash of the source path in
the key; all ten pair files are mutually distinct.

| file | SHA-256 | keyed source |
|---|---|---|
| pair-01-A.png | `E7BA17D39E19DA3D06061B365A9619387E4E477301A2F16FE4B438E1457B6E15` | docs/reference/ss_08751f…jpg (theirs) |
| pair-01-B.png | `D95C828E510E233826312785D0D77246FF1C21D78DF897E2C21873F4706D07CB` | shots/beauty/c2c/01-skyline-golden.png (ours) |
| pair-02-A.png | `A2E65D0354FFDB3D843B96A25FE09BB24D1006B8364460306A9B01507C48FDD6` | docs/reference/ss_152213…jpg (theirs) |
| pair-02-B.png | `393C4DAF38CB0731B2ECE5847E89CF1ECDF8879845EC9FB886F5EF9BA654B7D6` | shots/beauty/c2c/02-overview-noon.png (ours) |
| pair-03-A.png | `E086B945E663131AF7EEA0BB36FEDCC679CBC93FEE7B4BC0B4DFCEF48C485E28` | shots/beauty/c2c/03-street-night.png (ours) |
| pair-03-B.png | `9D5C7B759B5E5027B255A9611ECD2AB3787753AD6E425EE6A0FBAB0774CCB2E7` | docs/reference/ss_abbf7c…jpg (theirs) |
| pair-04-A.png | `EE070403C30B3BAE0F909142B9C7F118BD131490052D456E3CE8C4EE877E2454` | docs/reference/ss_b3e407…jpg (theirs) |
| pair-04-B.png | `264E5391C112CFC31C28644568C6D043E52D3FD45B259E85C66433BAADC78FE9` | shots/beauty/c2c/04-closeup-golden.png (ours) |
| pair-05-A.png | `CAE0D830B1ABFA7CBDF28E2CA09991994764735B2B76D3BF55F6B1A98278F8A4` | shots/beauty/c2c/05-aerial-dawn.png (ours) |
| pair-05-B.png | `5FCAA5280F9344CFE5334CDFF9CA8A81F5331AC39CE1CF17698B9DD58901C864` | docs/reference/ss_f6daab…jpg (theirs) |

The five reference hashes are the same reference images used in earlier sets (e.g. `E7BA…`, `9D5C…`, `EE07…`,
`5FCA…` appear in the set-4 audit), so the reference pool is stable across sets — expected, not a defect.

**(b) Shuffle reproduction — exact.** `node C:\Git\Cities\tools\pairs.mjs --ours shots/beauty/c2c --theirs
docs/reference --out set5check --seed 41 --balance`, run with CWD `C:\Users\ryuen\AppData\Local\Temp\opencode\a5`
(so `docs/judge-key-set5check.json` landed in the scratch, not the repo), regenerated 5 pairs whose ten files are
byte-identical (SHA-256 equal) to `judge/set5/`, with the same A/B sides per pair and the same 2/3 split. Pairing is
therefore fully determined by the documented seed and directory contents and matches the key. `docs/judge-key-set5.json`
is untouched: length 1286, mtime 2026-09-28 08:32:19 (predates this audit), SHA-256
`6E5F18A59A48A39CC9DF1C3D5A2F60A9B2281FA2D0FE8CF89382AC68D9626693`; `git status` showed no change under
`judge/` or `docs/` when checked (a concurrent cycle-3 edit to `src/buildings/generator.js` appeared later in the
session and is unrelated to this audit and untouched by it). Pair-file mtimes
exactly equal their sources' mtimes (reference 2026-09-16 10:35, ours 2026-09-28 08:20), consistent with Windows
copy preserving timestamps; the key mtime (08:32) is the `pairs.mjs` run, 12 min after the captures — one build, no
later rebuild. The scratch directory was deleted after the comparison.

**(c) Split.** ours on A: pairs 03, 05 (2). theirs on A: pairs 01, 02, 04 (3). Matches key `{oursOnA:2,
theirsOnA:3}` and the verdicts doc.

## 5. Levers the reasons converge on (ranked, from all 15 reasons)

1. **Aerial/overview scale mismatch (pairs 02/05) — all six reasons.** The wide heroes are called "flat /
   low-detail / hazy / washed / tiny indistinct buildings / no focal subject" versus close-up dioramas. This is the
   single most consistent axis and is structural: a whole-city shot cannot out-detail a diorama at 1920×1080.
2. **Depth of field / subject staging — named by all three judges** (01 ×3, 02, 05). The references read as
   miniatures with bokeh and a hero subject; ours have deep, flat focus and no focal subject.
3. **Lighting discipline** — pair 01's sun bloom is called a liability by all three ("huge bloom flare", "blown-out
   sun glare", "bloom and lens flare"); haze/wash recurs in 02/05.
4. **Night content (pair 03, all three)** — "empty asphalt", "plain building faces", "repeated stud geometry": the
   night street is dark and thin, and close range exposes stud tessellation.
5. **Facade and close-range detail (pair 04, all three)** — "flat blank walls", "flat untextured", "grainy
   dithering artifacts", "empty street foreground": the added dressing is present but small in frame, and the
   close-up exposes dithering/shadow noise.

## 6. What I could not verify

- **Operational blindness** of the three judging sessions (no transcripts/logs in scope). The text artifacts are
  clean and the protocol is described as parallel/no-key, but I cannot prove the judges never saw the key or each
  other's outputs. The unanimous 15/15 reference sweep is consistent with the visible quality gap and shows no
  leakage signature.
- **Prompt fidelity:** that each judge received the identical fixed prompt, and "image paths + fixed prompt only"
  (only the verdicts doc's description; the prompt text itself is not in the repo).
- **Timeline:** that the key was not read until after all three verdicts were recorded (protocol attestation only).
- **Historical "sets 1–4 also 0/5"** — the loop statement is consistent with the records I cross-read (set-4 audit:
  valid 0/5) but I did not re-audit sets 1–3.
- **Reference provenance:** that `docs/reference/` images are shipped-game screenshots (out of scope; not audited).
- Interpretive adjectives ("deliberate vignetting", "warm light", "posed") cannot be falsified against pixels; I
  verified the concrete nouns, objects, and sides in every reason, and the three notes above cover the wording that
  overreaches.
