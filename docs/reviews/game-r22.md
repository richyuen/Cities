# whole game — builder report (Wave B4/V5+G7: whole-game re-measure + blind-judge set 2)

**What happened:** re-ran the shipped game batch after the B/C waves (B5 demo, C2–C6 features, B3 atmosphere),
re-checked the r4 rain/fog bug family on fresh loads, and repeated the blind pair test against the five
`docs/reference/` stills with three independent judges. Result: the game still holds **8.8** on the batch axes, and
the blind set is **0/5 for the second time** — but this round produced the *reason* per pair, which is the point of
B4 (V5's "no single owner; camera presets, density, grade").

> Evidence, not a pass — the independent critic re-measures in `docs/reviews/game-r22-critic.md`.

## Whole-game batch (idle GPU, one browser)

`node tools/critic.mjs --game --round 22` → `shots/game/r22/`: **minFps 62.0, maxGpuMs 15.66, maxDrawCalls 847,
errors 0** (20 shots, 5 presets × 4 tods). Vs r4 (92.2 fps / 9.4 gpuMs / 792 calls) the game is heavier (the demo
city and features grew) but still inside every budget with headroom; vs r21 (60.8 / 15.74 / 847) within noise.

Fresh-load sanity (r4's last trigger: weather + steep pitch as the *first* command):
`shots/game/r22-fresh/fresh-overview-rain.png` (rain 0.8, tod 12, 127.4 fps) and `fresh-aerial-fog.png`
(fog 0.7, tod 6.5, 126.6 fps) — buildings legible, no washout/toothpicks, `errors: []`. The bug family stays closed.

## Blind set 2 (`judge/set2/`, seed 11, key `docs/judge-key-set2.json`)

Five curated hero shots (`judge/ours-b4/`): 01 skyline-golden (17.7), 02 overview-noon (12), 03 street-night (21.5),
04 closeup-golden (17.7), 05 aerial-dawn (6.3). Three independent judge subagents saw only the ten pair PNGs and
picked per pair with a reason. All three agreed on every pair:

| pair | our shot | judges' pick | unblinded result | judge reason (short) |
|---|---|---|---|---|
| 01 | skyline-golden | A → **theirs** | loss | "mostly empty grassy plain with a tiny distant skyline"; "sparse, mostly empty zoned field"; ours shows HUD chrome |
| 02 | overview-noon | A → **theirs** | loss | "flat grey map overview where buildings read as unreadable specks"; theirs "bustling skate-park scene full of minifigures" |
| 03 | street-night | A → **theirs** | loss | ours "a dark near-empty street where asphalt dominates"; theirs "vibrant, densely detailed neighborhood with hot-air balloon" |
| 04 | closeup-golden | B → **theirs** | loss | ours "an awkwardly cropped building facade ... reads as a camera clipping bug"; theirs "colorful farm/windmill diorama" |
| 05 | aerial-dawn | A → **theirs** | loss | ours "monotone top-down zone grid with no focal point or atmosphere"; theirs "street scene with signage, pedestrians, picnickers" |

**Score: 0/5 again (each judge 0–5 → 0–15 overall, identical to set 1).** Ties would count as losses; none were
needed — the picks were unanimous and high-confidence (4–5) on every pair.

## Per-pair losses → the named levers (why we lose)

1. **Composition: the camera presets do not crop to a subject.** `skyline` frames a thin skyline strip over ~70 %
   empty field; `overview`/`aerial` read as data maps, not beauty shots; `closeup` clips a facade instead of
   framing a hero building. The references are all *close, subject-filled* frames with a foreground anchor.
   **Lever: recompose the game presets** (`skyline` closer + lower, `closeup` to a real hero-building 3/4 like the
   buildings module's own closeup target, `overview`/`aerial` tightened to the city footprint).
2. **Presentation: our shots carry the full HUD** (top plates, coverage, demand, toolbar, minimap). Judges
   explicitly counted "UI chrome"/"UI-heavy" against us on two pairs. The references are clean renders.
   **Lever: a screenshot/beauty mode that hides the HUD** (URL flag or key; one small UI task) — cheapest single
   perceived-quality win available.
3. **Micro-detail density at close range.** The references are dioramas (flowers, animals, birds, laundry, DOF
   bokeh, a house *under construction*). Our closeups are repetitive window grids and bare facades; our props are
   sparse at 1–2 m. **Lever: props/landmark micro-dressing** (per-building clusters, more prop kinds near civic
   buildings, a couple of animated set pieces like the reference's build-in-progress house).
4. **Atmosphere/grade is no longer the main gap.** The dusk/dawn skies now read warm (B3), the golden-hour batch
   shots are graded correctly; the loss is content and framing, not colour. The references' shallow depth of field
   is a *presentation* effect we do not have (a DOF pass is a new renderer feature — out of ARCHITECTURE §7 scope;
   a cheaper stand-in would be nfov compression + close framing).
5. **Scale/population read.** The reference street scene is dense with pedestrians, vehicles, signage; our
   `street`/`aerial` shots read emptier because traffic density and prop coverage thin out away from the demo
   hotspots. **Lever: B2-style density bias toward camera-visible arterials / hero streets.**

These five levers are recorded in `_integrator-todo.md` for the next fidelity wave (V5/B4 is explicitly a
measurement round, not an owner-assigned feature); none is a correctness bug and the game keeps its 8.8 batch score.

## Known gaps / honest caveats

- Hero-shot curation is ours (mirrors set-1's filenames); the batch (`shots/game/r22/`) is the unedited record and
  no hero shot was graded/edited — all five carry the shipped HUD.
- The judges are subagents in this repo; they were instructed not to open the key or reviews, but a leak cannot be
  *proven* absent — the critic is asked to audit the protocol (unanimity + reasons consistent with the images is
  the best available check).
- The reference set is marketing-grade (DOF, dense set dressing); a 0/5 loss is expected and is not itself a
  product bug.
- No source changes were made in this round (measurement only), so no module batches beyond `--game` were re-run.
