# disasters — critic review, round 2 (Wave D2 / F9: tornado)

**Score: 9.0 / 10 — PASS** (pass needs ≥ 8.5, `errors: []`, inside the perf budget)

Both round-1 blockers are fixed and I re-derived them from fresh sessions with my own scripts. The economy now bills
**exactly** the advertised ledger — over a full storm the treasury is charged `$36,274.4422` for `40.304936` damage
units applied, i.e. `× $900` to a relative error of `6.2e-15`, per-tick bit-consistent to `3e-11` (one-tick push lag),
the Treasury row equals the model's own per-day rate, and everything returns to exactly 0. The funnel is rebuilt and
now **reads from all three shipped presets at all four tods, day and night**: ground-anchored (lowest instance 1.0 m
above the measured ground height, debris 0.72 m, dust 0.45 m), with a visible base cluster and dust collar on the
street, no longer hidden behind the showcase tower. The remaining gap to 10 is the design-parked per-building damage
tell plus the coarse "column of cubes" read — named and ranked below, not blockers.

## Numbers (my runs; `nvidia-smi` checked before every batch; one headless browser at a time)

| batch | shots | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|---|
| `shots/disasters/r3-critic/storm/` (3 presets × 4 tods) | 12 | 143.6 | 6.61 | 499 | [] |
| `shots/disasters/r3-critic/idle/` (default variant) | 12 | 143.7 | 6.73 | 527 | [] |
| `shots/disasters/r3-critic/game/` (5 × 4, game r27) | 20 | 60.9 | 15.86 | 847 | [] |
| `game-rep1` / `game-rep2` (`closeup-21.5` only, isolated) | 1 + 1 | 63.0 / 65.0 | 15.12 / 14.99 | 745 | [] |

- **Budget: PASS.** All sets inside ≥ 50 fps / ≤ 20 ms / ≤ 1500 calls.
- **Game r27 vs record:** 60.9 / 15.86 / 847 vs r22 62.0 / 15.66 / 847, r25 62.0 / 15.54 / 847, r26 62.0 / 15.68 / 847.
  Shot-by-shot against the stored r25 batch the deltas are bidirectional and uncorrelated (e.g. `closeup-12` +15.7 fps,
  `street-6.5` −2.3 fps; `closeup-21.5` −1.1 fps / +0.32 ms), and the slowest shot re-measured in isolation is
  63.0 and 65.0 fps — ambient variance, not a regression. Draw calls are identical (847 max).
- **Showcase cost:** storm 143.6 / 6.61 / ≤499, idle 143.7 / 6.73 / ≤527 — the module costs an idle city nothing and
  the storm shots improved on the r1 numbers (143.7/6.74/551 → 143.6/6.61/499; framing change, not a removal).
- `node tools/check-disasters.mjs`: **22/22**; `Math.random` in `src/disasters/*`: 0 hits (re-checked).
- GPU background read 12–28 % before batches on the RTX 4070 Ti — `gpuMs` deltas are the comparison, same caveat as
  prior rounds.

## 1. Billing — blocker 1 is fixed (my own ledger probe)

`shots/disasters/r3-critic/probe.json` (my script, real toolbar spawn, full 60 s storm at 8×):

| probe | measurement | verdict |
|---|---|---|
| full storm | applied **40.304936** damage over 2,599 `disaster:damage` events; charged **$36,274.4422**; `40.304936 × $900 = $36,274.4422`; relative error **6.2e-15** | **PASS** |
| per-tick | 119 active pairs, `charged_t == delta_{t−1} × 900` to **3.2e-11** (float summation order) and `pushed_t == delta_t × 900` to 3.2e-11; the push is one tick (0.5 game-s) behind the damage window, so totals close exactly | **PASS** |
| Treasury row mid-storm | `"$411,998"` == `getBudget().perDay.expenses.disasters` 411,998.31 == `perTick 343.33 × 1200` exactly | **PASS** |
| back to 0 | after despawn + settle: `stats.disasterCost 0`, `perTick 0`, `perDay 0`, and the **DOM row reads "$0"** in a separate boot | **PASS** |
| check suite | `charged $38528.1 vs applied 42.8090 × $900 = $38528.1` | **PASS** |

The r1 defect was `pendingCost / TICK_DT` in a `$/tick` slot (exactly 2.000×). The revision pushes `pendingCost`, and
my two independent runs (this probe + the kept check) both close to the last digit. The 0.5 game-s billing lag behind
the damage window is inherent to the `sim:tick` push pattern (transit upkeep behaves the same) and player-invisible.

## 2. Funnel — blocker 2 is fixed; verdict per preset/tod

Geometry re-derived in-page (`probe.json`): group at the ground height (4.8 = 4.8); funnel 210 instances, lowest
1.00 m above ground, top ring radius 15.8 m at full strength; debris 54 instances from 0.72 m; dust disc at +0.45 m,
radius 28.8 m. Nothing floats and the module was already disposed-invisible when idle (idle shots unchanged).

| PNG (`shots/disasters/r3-critic/storm/`) | what I see | verdict |
|---|---|---|
| `disasters_overview-6h5.png` / `-12.png` | full plume including the flared top over a street intersection; base cluster on the road with the dust patch; the district's tower no longer covers it | **legible** |
| `disasters_overview-18.png` | dusk: column silhouetted against the ground yet clearly a funnel, dust patch faintly lit | **legible** |
| `disasters_overview-21h5.png` | night: dark blue plume readable against the ground/sky and lit facades, base patch visible — r1's "nearly vanishes" is gone | **legible** |
| `disasters_closeup-6h5.png` | street canyon at dawn; heavy sun glare burns out the left half but the cube column and its street base stay readable | **legible (glare caveat)** |
| `disasters_closeup-12.png` | the clearest shot: dense low rings lead into a base cluster on the zebra crossing, lit dust ellipse behind it | **legible** |
| `disasters_closeup-18.png` / `-21h5.png` | dusk/night between facades; base cluster and debris read, dust faint at night | **legible** |
| `disasters_ground-6h5.png` / `-12.png` | street level: base on the pavement/intersection with debris boxes and the dust collar; foreground low-rises frame rather than hide it | **legible** |
| `disasters_ground-18.png` / `-21h5.png` | same at dusk/night; the night base cluster with the pale dust patch is the clearest evidence the funnel is on the street | **legible** |

Verdict: **ground-anchored, dust-collared, not confetti, not occluded** — fixed. What still limits it: the column is
made of discrete 1.6 m cubes with no fine dust veil or motion streaks (a still always looks coarser than the live
animation), and the dust disc reads as a flat pale ellipse at street level rather than turbulent dust.

## 3. Paused spawn, save/load, crafted saves

- **Paused spawn (r1 defect 3) FIXED.** Toolbar/API spawn while the clock is paused: `age 0.600` (30 % of the 2 s
  ramp-in), `strength 0.300`, `scene.getObjectByName('disasters').visible === true` immediately; **zero** damage and
  **zero** charge while paused; it moves and ages on resume. Evidence still
  `shots/disasters/r3-critic/probe-paused-spawn.png` (funnel drawn with the "🌪 Tornado on the ground!" toast).
- **Save/load mid-storm PASS.** `serializeSave` carries exactly 1 tornado; state exact (`x −153.60 → −153.60`,
  `age 4.60 → 4.60`, direction bit-exact); damage scars `47.681 → 47.681`; **applying the same save twice still
  spawns exactly 1** (no double-spawn), and a crafted 2-tornado save **loads exactly 1** (the first, x unchanged).
- **Remaining hardening nit:** `loadState` slices to `MAX_ACTIVE` (r1 item fixed) but still does not validate finite
  `x/z/dirX/dirZ`. A hand-crafted save with `dirX: null` loads 1 tornado that stands still and logs no errors; a
  string would NaN its position. Player-written saves cannot contain NaN (JSON), so this is secondary.

## Ranked remaining issues

1. **No per-building damage tell (design-parked, `plan` §5 — the design's own first follow-up).** The city never
   visibly shows scars in stills or while the funnel passes; the tell is the funnel + capacity/cost panels. Named
   lever: roof/debris decals scaled by `b.damage` (also the single biggest remaining "read" upgrade).
2. **The column reads as chunky cubes**, not a fine vortex (style-consistent Blox, but the low rings could use a few
   small-scale fill boxes/dust veil; more effective live than in stills).
3. **The dust collar is a flat disc**; at day street level it can read as a bright pale plate rather than debris haze.
4. **`loadState` finite validation** (above) — one line for defensive saves.
5. **`clear()` discards up to one tick of accrued ledger** (`index.js`), player-favourable and documented; it means
   `clear()` and natural despawn are not accounting-equivalent.
6. **Showcase warning icons:** 1–2 ⚠ remain in `idle/disasters_closeup-12.png` (pre-existing `stageCity`
   centre-of-block quirk, visible in other showcases too).
7. **Draw-call delta is +5** (3 meshes + 2 shadow draws), not the design's +3 — now documented in ARCHITECTURE.
8. **One-tick billing lag** (0.5 game-s) between applied damage and the cost line; totals exact (above).

## Verdict

**9.0 / 10 — PASS.** The unit bug that silently doubled the price is gone and proven exact in two independent full
storms; the hero visual now works from the cameras the module actually ships, at every tod, including night; the
paused-spawn and one-at-a-time/save-cap holes are closed. What keeps it from 10 is the design-deferred damage
tell and the coarse cube read — both already named as the next lever, neither a contract failure. No new blocker.

## What I did NOT verify

- Per-building capacity loss read end-to-end from `stats.capacity` — I measured `b.damage` and the ledger, not the
  downstream population curve (same caveat as r1).
- The half-rate on burning buildings (`b.onFire ? 0.5`) — source-read only, no A/B fire+tornado probe.
- Tornado audio (none by design; the spawn uses the existing `error` sfx — not listened to).
- The real menu Load path; I used `serializeSave`/`applySave` directly, as the kept check does.
- Motion/rotation quality over time (I read stills and the source's time-based animation; no video).
- The +5 active draw-call delta itself (kept from the r1 measurement; game r27 calls == record at 847).
- Regression impact beyond whole-game r27 (transit/traffic/props not re-probed individually).
- Earthquake extensibility (out of scope by owner decision).
- GPU on a fully idle desktop: the RTX read 12–28 % background before every batch.

*Evidence: `shots/disasters/r3-critic/{storm,idle,game,game-rep1,game-rep2}/` (PNGs + JSON), `probe.json`,
`probe-row-after.json`, `probe-boot-hash.json`, `debug-ledger.json`, `debug-geo-raw.json`; probe scripts under
`C:\Users\ryuen\AppData\Local\Temp\opencode\disasters-r2-*.mjs`. Nothing in `src/` or `tools/` was modified
(`git status` clean apart from this review / STATUS / the todo line). `shots/` is gitignored — this review and
`docs/STATUS.json` are the record.*
