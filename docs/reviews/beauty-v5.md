# beauty shots — builder report (V5 follow-up: HUD-free capture + preset composition + blind set 3)

**What shipped:** a `?hud=0` capture mode (HUD *and* the "Show HUD" chip hidden, `--hud` passthrough in
`tools/shot.mjs`), a recomposition of the five core game camera presets around actual subjects (skyline 3/4 hero
framing, closeup picks the tallest building near downtown, overview/aerial tightened ~25 %), and the third blind
judge set — **0/5 again, but with zero HUD complaints** (sets 1–2 also lost 0/5 *with* chrome complaints in the
reasons; set 3's reasons are purely content/composition). Design: `C:\Users\ryuen\.opencode\plan\beauty-shots.md`.

> Evidence, not a pass — the independent critic re-measures in `docs/reviews/beauty-v5-critic.md`.

## What was built

- **`?hud=0` (`src/ui/index.js`, `src/ui/hud.js`, `src/ui/styles.js`).** Boots with the HUD hidden exactly like
  pressing `H`, plus a capture flag that also hides the `.lc-show-ui` chip (`.lc-capture`); `H` still toggles at
  runtime, and boots without the param are unchanged (asserted).
- **`tools/shot.mjs`** passes `hud` through to the URL, so `node tools/shot.mjs --preset skyline --hud 0 --out …`
  captures clean frames.
- **Core presets (`src/core/camera.js`).** `skyline`/`night`: `dc + (230, 55 m, 300)` (~380 m) targeting downtown at
  22 m — the old framing was ~950 m almost level. `overview`: `dc + (W·0.20, W·0.27, D·0.30)` (~923 m, was ~1240).
  `aerial`: `dc + (0, W·0.44, D·0.18)` (~974 m, was ~1230). `closeup`: walks `world.buildings`, takes the tallest
  within 420 m of downtown, and frames it 3/4 with the buildings module's own distance formula
  (`dist = max(diag·1.9+12, height·0.65, 20)`, eye ≤ dist·0.5, fov 45), falling back to the old fixed offset on
  empty worlds. All presets stay functions, so terrain/downtown tracking is unchanged.
- **`tools/check-beauty.mjs`** (new, kept): 11/11 checks (HUD flag on/off, chip hidden, preset geometry bands,
  closeup target within 80 m of a real ≥ 10 m building, five HUD-free captures, `errors: 0`).

## Verification

- `node tools/check-beauty.mjs` **11/11** (`shots/beauty/v5/summary.json`), including `?hud=0` →
  `ui.api.isHudVisible() === false`, `.lc-hud.lc-hidden.lc-capture`, chip `display: none`, and a plain boot still
  visible.
- Preset geometry: skyline 380 m, overview 923 m, aerial 974 m, closeup 30 m from a 49 m tower (0.0 m from its
  centre).
- `node tools/critic.mjs --game --round 28`: **minFps 72.2 / maxGpuMs 13.35 / maxDrawCalls 844, errors 0** — better
  than r26 (62.0 / 15.68 / 847) because the new framings cover less geometry; every budget holds.
- Screenshots read: `shots/beauty/v5/01-skyline-golden.png` (city filling the frame, warm dusk, streets/traffic
  visible), `04-closeup-golden.png` (a hero tower 3/4 with neighbours and a road), `05-aerial-dawn.png` (clean plan
  view), `shots/game/r28/skyline-12.png` (the same framing in the shipped game, HUD on, Tornado tool visible).
- **Blind set 3** (`docs/judge-set3-verdicts.md`, seed 23, three independent judges): raw picks gave one disputed
  pair-04 "win"; a fresh blind re-judge of pair 04 (two new judges, both describing the images correctly) picked
  the reference, so the corrected result is **0/5 — the same as sets 1–2**. The qualitative change is real though:
  **no judge mentioned the HUD/chrome in any of the 15 reasons**, and the losses narrowed to content/composition
  (map-like straight-down aerial/overview, a thin night street, a cropped hero tower with no activity vs the
  references' bustling dioramas). The builder's first write-up claimed a 1/5 win from the slipped votes; corrected
  here and in `docs/judge-set3-verdicts.md` after the critic's audit. Next levers: oblique aerial with a foreground
  anchor; livelier night street; micro-detail density/props; closeup framing that fits the hero.

## Known gaps / honest caveats

- Preset recomposition changes every whole-game batch framing, so pixel comparisons with rounds ≤ 27 are invalid by
  design; the r28 batch is the new baseline.
- The straight-down `aerial` remains a plan/map view — the judge evidence says an oblique aerial with a foreground
  anchor is the next composition lever.
- `closeup` picks the tallest building within 420 m of downtown deterministically; it can still be a plain tower
  (the demo's tallest is one). A curated landmark list would be the next step.
- The five hero shots are curated by us (as in sets 1–2); the batch remains the unedited record.
- Content-level losses (micro-detail density, set dressing) are untouched — the follow-up wave, not this item.
