# Whole-game review — round 5 (Wave B4/V5+G7: r22 batch + blind set 2 re-verification)

**Score: 8.8 / 10 — PASS**

Pass bar is score ≥ 8.5 AND `errors: []` AND perf within budget (fps ≥ 50, gpuMs ≤ 20, drawCalls ≤ 1500). This was a
**measurement-only round** — I verified the builder changed nothing outside docs (`git show --stat 05d7fa2` → 3 doc
files, working tree clean) — so the review's job is independence: reproduce the batch, re-check the r4 bug family,
audit the blind-judge protocol end to end, and re-score. All four clear. I keep **8.8** and move **no module score**.

## Numbers — my batch vs the builder's and the recent line

My run: `node tools/critic.mjs --game --round 23 --dir shots/game/r23-critic` (RTX 4070 Ti, `nvidia-smi` checked
first — P8/17 % desktop compositing, no headless browser running, one browser at a time), 20 shots / 5 presets × 4 tods.

| metric | mine (r23) | builder (r22) | r21 | r20 | r4c |
|---|---|---|---|---|---|
| minFps | **61.8** (closeup-21h5) | 62.0 | 60.8 | 60.1 | 92.2 |
| maxGpuMs | **15.76** (closeup-21h5) | 15.66 | 15.74 | 16.25 | 9.4 |
| maxDrawCalls | **847** (aerial-12) | 847 | 847 | 847 | 792 |
| maxTriangles | 40,031,566 | 40,031,566 | — | — | — |
| errors | **[]** | [] | [] | [] | [] |
| budget | fps ✓ gpu ✓ calls ✓ | all ✓ | all ✓ | all ✓ | all ✓ |

Reproduction is exact within noise (ΔminFps 0.2, ΔgpuMs 0.1 ms, identical draw calls/triangles). r4c is listed only as
the last pre-B5 city for scale; the city itself changed with the B5 demo rebuild.

**Pixel-level regression check (mine, not the builder's).** The city is deterministic and no source changed, so I
diffed every same-name r22↔r23 pair: **meanAbs ≤ 0.157/255, pixels >8/255 ≤ 0.100 %, max localized deltas (shadows/AA
phase)** — i.e. the two batches are the same render. The builder's "no axis regression vs the 8.8 record" therefore
holds by construction for r22→r23; the r4→r23 comparison is a different city (B5/C-waves), so I reviewed the r23
shots visually on the r4 axes (composition, atmosphere, legibility, night/dawn/dusk grading) instead of by diff:
composition weakness is unchanged in character (see issue 1), dusk/night grading is intact and warmer than r4 under
B3, buildings are fully legible with no washout/toothpick anywhere, and the weather identity reads correctly.

## Fresh-load sanity — the r4 bug family stays closed

I pushed harder on the protocol than the builder did: 3 **completely fresh** `openApp` sessions with **no preset or
weather in the URL** (`urlAtBoot = ?seed=1&fixeddt=1`), then weather → tod → camera preset as the literal first
`__city` commands (the builder booted with `?preset=…&weather=…` in the URL). All three clean; captures in
`shots/game/r23-critic-fresh/`.

| shot | first commands | gpuMs | drawCalls | errors |
|---|---|---|---|---|
| fresh-overview-rain0.8-12 | rain 0.8 → 12 → overview | 7.89 | 764 | [] |
| fresh-aerial-fog0.7-6h5 | fog 0.7 → 6.5 → aerial | 7.53 | 738 | [] |
| fresh-overview-rain0.85-18 | rain 0.85 → 18 → overview | 7.73 | 736 | [] |

Read at 1:1: full walls/roofs at both steep presets, no sliver/toothpick geometry, terrain/water correctly graded,
rain streaks and fog haze visible and distinct, dusk windows warm. Draw calls match the builder's fresh shots exactly
(764/738). fps reads 73–78 here vs the builder's ~127 because these captures land in the one-time post-boot demo
fast-forward drain window; `gpuMs` (~7.5–7.9) is the truth and is far inside budget. My fog shot is near-identical
to the builder's (meanAbs 0.018); the rain shots differ only in animated streak phase (4.0 % of pixels >8) — expected,
not a signal.

## Blind-judge protocol audit (set 2)

**My picks first, then the key.** I read all 10 `judge/set2/pair-*-{A,B}.png`, recorded picks + one-line reasons,
and only then opened `docs/judge-key-set2.json`. Disclosure: the builder report and raw-verdict file (required
context) state the claimed aggregate 0/5, so I was not outcome-blind — but the key and the per-image picks were not
seen before my own; the picks below are from the pixels.

| pair | my independent pick | my reason (short) | all 3 judges | unblinded |
|---|---|---|---|---|
| 01 | A | polished house diorama with DOF/garden vs our distant skyline strip over empty field + HUD | A ×3 | loss |
| 02 | A | bustling skate-park diorama vs our flat grey aerial map with HUD | A ×3 | loss |
| 03 | A | dense colourful downtown with balloon/signage vs our dark night street, asphalt dominates | A ×3 | loss |
| 04 | B | farm/windmill diorama with fields/vehicles/figures vs our clipped facade close-up | B ×3 | loss |
| 05 | A | signage/pedestrian street scene vs our top-down zone grid with sparse blocks | A ×3 | loss |

**Result: 0/5 unanimous, 0–15 overall — identical to set 1. My own picks agree on all five, and the loss side is the
same images on all five.** A 0/5 was reasonable before the audit; after it, it is deserved — the references win on
subject, framing and micro-dressing, and the judges' picks are the ones I would make.

**Leak / tampering checks — none found.**
- **Byte provenance:** every `pair-XX-A/B.png` is byte-identical (SHA-256) to its named source in `judge/ours-b4/` or
  `docs/reference/` — no re-encode, crop or grade between source and what the judges saw.
- **Key/seed:** I re-implemented `pairs.mjs`'s seeded RNG and reproduced the A/B assignment for seed 11 exactly
  (flip on pairs 01–03/05, no-flip on 04) → the key is genuine, not hand-arranged.
- **Sequence:** batch r22 mtimes 10:25:53–10:26:24 → fresh hero captures 10:26:53–10:27:53 → key 10:28:04, all before
  the 10:48 commit. The hero shots are individual fresh `tools/shot.mjs` captures (each with its own JSON, GPU string,
  `errors: []`, full HUD visible, no grading), not copies of batch frames; the batch is untouched and reproducible
  (my r23 is pixel-identical).
- **Reasons vs images:** every judge reason describes the content that is actually in that image (house/bokeh,
  skate-park, balloon downtown, windmill farm, signage street) and never quotes the other side's content, file names,
  authorship or the key. HUD remarks are observations of visible UI, not knowledge of ownership.
- **Position bias:** seed 11 placed *theirs* on side A in 4/5 pairs — a real latent confound (12/32 chance for a 4/5
  split, so not suspicious). It is ruled out as an explanation: on pair 04, the only pair where ours was A, the judges
  still picked B (theirs). Their picks track content, not side.

**Protocol weaknesses I could not close (honest):** the three judges are subagents with no key in their prompt, but
their transcripts are not available to me, so "no leak" rests on process evidence + image-consistent reasons, not
proof; a future set should counterbalance the side split (different seed or an explicit 3/2 swap) because a 4/5
same-side draw is the only uncontrolled variable observed.

## Ranked issues (all presentation/content levers — no defect)

### 1. [same rank as r4/#1, still the top lever] Camera presets do not crop to a subject
**Evidence:** `skyline-18/21h5` (and pair 01) put ~55–70 % of the frame on empty field under a thin skyline strip;
`overview`/`aerial` (`aerial-18/21h5`, pair 05) read as tinted data maps; `closeup-18/21h5` (pair 04) clips a generic
facade so hard it reads as a camera bug. **Lever:** recompose the shipped presets — closer/lower `skyline`, tighten
`overview`/`aerial` to the footprint, and point `closeup` at a C6 civic hero (school/hospital front-3/4) instead of a
facade. This is a ship-level change, not curation: the batch shows the preset family is the problem.

### 2. [cheapest win] HUD-hide / beauty mode
Judges explicitly counted "UI chrome"/"HUD" against us on pairs 01/02/04, and every one of our five hero shots carries
the full plates/coverage/demand/toolbar/minimap. A screenshot mode is one small UI task and would remove the single
most-cited non-content difference.

### 3. Close-range micro-detail density
Pair 04's verdict ("shows almost nothing") is as much about a bare window grid as about the crop; the references are
dioramas (flowers, animals, laundry, vehicles, a house under construction). **Lever:** per-building prop clusters and a
couple of animated set pieces near civic/landmark buildings.

### 4. Scale/population read away from demo hotspots
Pairs 03/05: our night street's lower half is empty asphalt (1–2 vehicles), the aerial grid reads sparse next to the
reference's pedestrians/vehicles/signage. **Lever:** B2-style density bias toward camera-visible arterials; the demo
already proves the machine can afford it (847 calls, 15.8 ms).

### 5. [new, minor] Blind-set side assignment
Seed 11 put the reference on side A in 4/5 pairs. It did not change the outcome (pair 04 controls for it), but future
sets should counterbalance; record it so a later reviewer doesn't have to re-derive it.

### 6. [new, minor, presentation] Transit route ribbon is the most saturated red element at dusk/night
`src/transit/models.js`'s `buildRibbonGeometry` paints the demo bus line's colour along its road (by design, tuned in
transit r2 to emissive 0.35 day → 0.85 night). In `closeup-18/21h5` and `street-18/21h5` it is a hard red curve across
the frame that can read as a debug overlay to a store-page viewer. Not a defect; a per-tod dimming pass is the lever
and it should ride with the HUD-hide/beauty-mode work.

### 7. [new, minor, informational] Dawn batch shots look away from the sunrise
At 6.5h the batch presets read pale/cool because B3's chroma boost is sun-side by construction (already queued as B3
follow-up 2: a dawn-azimuth capture/preset). A dawn hero that faces the sun would strengthen pair 05's side of the
skyline/overview family — another preset-composition item, recorded, not scored.

## What works

- **The shipped game is stable and reproducible:** builder r22 and my r23 are the same render to within 0.16/255 mean;
  perf sits at 61.8 fps / 15.76 ms / 847 calls with ~25 % gpuMs headroom to the budget and 30 % fps headroom.
- **The r4 rain/fog + steep-pitch bug family stays closed** on the strictest version of the test (weather as the true
  first command in a plain-boot session), 3/3, including a dusk rain case — no washout, no toothpicks.
- **Street-level dusk/night quality remains AAA-with-nits** (`street-18`, `street-21h5`, `closeup-12`): warm skies,
  lit facades, clean markings, correct weather/HUD identity — this is where the game looks its best.
- **The loss is legible and actionable.** Three independent judges and my own picks converge on the same four levers
  (composition, HUD, micro-dressing, density), and none of them is a correctness or performance defect — which is
  exactly why the score holds while the store-page fidelity wave is queued.
- **Protocol hygiene is good:** key file separated, bytes verifiable, seed reproducible, batch preserved. The builder's
  per-pair quotes in `docs/judge-set2-verdicts.md` survived my independent image check.

## Verdict

**8.8 / 10 — PASS.** Measurement-only round, numbers reproduced, no regression found, 0/5 loss is genuine and
presentation/content-driven. **No module score moves** (I re-ran no module batch because no source changed; the
atmosphere 8.5 terrain / 8.8 environment / 8.7 civics holds recorded by this round's inputs stand). The next
fidelity wave should take levers 1–4 in the order above; if composition + HUD-hide land together, a set-3 pair run is
the right re-measure.

## What I did NOT verify (explicit)

- Only the `--game` batch and 3 fresh loads — no per-module batches (no source changed this round).
- Set 1 was not re-run; I did not have the three judges' transcripts, so the leak audit is process + reason
  consistency, not proof of isolation.
- Hero-shot authenticity beyond the paired JSON, mtimes, visible HUD and byte-identity of the pair copies — a
  hypothetical editor pass before pairing cannot be excluded from bytes alone; I found no evidence of one.
- Weather intensities above 0.85 in my fresh loads (r4 covered 1.0); rain cross-session pixel diff is streak-phase
  noise, so only fog was compared numerically against the builder's fresh capture.
- I did not compare against the reference images outside the five pairs, and did not inspect `docs/reference/` as a
  whole.
