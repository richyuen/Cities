# LOOP cycle 0 — protocol, baseline, hygiene

**Goal:** make the loop runnable and re-base the measurement floor. **Visual changes: none.** Commit touches
docs + tools only.

## What was done

- `docs/LOOP.md` — the max-effort fidelity loop protocol: roles, E0–E6 stages, hard gates, blind-judge
  protocol with counterbalanced sides and a reason-consistency audit, ranked backlog (L1–L6), stop/plateau
  rules, scoreboard.
- `tools/pairs.mjs` gained `--balance`: exact ⌈n/2⌉/⌊n/2⌋ side split, randomly placed, split recorded in the
  key. The default per-pair coin flip is preserved byte-for-byte — re-deriving set 1's seed-7 shuffle with the
  new code reproduces `docs/judge-key-set1.json` exactly (verified). Motivation: set 2 put *theirs* on A in
  4/5 pairs and set 3 in 3/5; the audit flagged it as the one uncontrolled variable.
- `tools/diff.mjs` (new) — same-name PNG regression diff: `meanAbs`, `pctOver` (max-channel > threshold),
  `maxDelta`; JSON output. Used by every cycle to keep regressions honest.
- `tools/check-beauty.mjs` — `--out <dir>` so hero captures stop overwriting the judged `shots/beauty/v5`
  set (its pair files in `judge/set3` stay byte-verifiable).
- `docs/STATUS.json` — game entry re-based from r23 to the r28/r29/r30 line; judges string updated with the
  corrected set-3 history.

## Baseline evidence (RTX 4070 Ti, light external compositor load ~19 %, no browser running)

| batch | minFps | maxGpuMs | maxDrawCalls | errors |
|---|---|---|---|---|
| r30 game (`shots/game/r30`, this cycle) | **72.0** | **13.34** | **844** | **0** |
| r28 builder (kept) | 72.2 | 13.35 | 844 | 0 |
| r29 critic (kept) | 70.9 | 13.46 | 844 | 0 |

- Drift r30 ↔ r29-critic: 20/20 pairs, **meanAbs 0.0726**, worst file `aerial-21h5` 0.3332 (0.22 % pixels
  > 8/255) — at the B3 same-session drift scale, so r30 is the same render as the kept baseline.
- Hero captures r30 ↔ v5: 5/5 pairs, **meanAbs 0.0050**, worst `05-aerial-dawn` 0.0134 — the hero set is
  reproducible; `check-beauty` 11/11 on the re-run.

**Baseline for all future cycles:** `shots/game/r30` (20 shots) + `shots/beauty/r30` (5 hero shots), both
local-only (gitignored). Whole-game batches ≤ r27 are pixel-incomparable after the V5 preset change.

## Open caveats

- fps numbers here run under an external compositor load; `gpuMs` is the binding metric (13.34 vs the 20 ms
  budget).
- `shots/beauty/v5` remains the set-3 judged source and is untouched.

## Next: cycle 1 (L1 hero framing)

Recompose the shipped preset family around real subjects (no more empty-field skyline / data-map
overview-aerial / clipped-facade closeup), add the hero-frame geometry checks, then hostile verification and
blind set 4 with the balanced pairing.
