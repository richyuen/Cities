# LOOP cycle 3 — fix-round critic review (post-`loop-c3-critic.md`, 4/10 FAIL)

**Build under test:** current working tree (uncommitted) on top of `867b30d`; fix round per
`docs/reviews/loop-c3.md` §Fix round. Same rules: no source edits, dev server untouched, one browser at a
time, scratch under `C:\Users\ryuen\AppData\Local\Temp\opencode\c3v\`.

## Verdict: **PASS — 9 / 10**

The HIGH defect is completely and correctly fixed (containment 492 parts / 172 buildings → **0 parts /
0 buildings**), the flush-door class is gone, the facade fallback is a real distinct pose, and no new
breakage appeared in checks/batches/heroes. The only residual is the consciously out-of-scope civic-facade
gap (cycle-4 curated shot list) and one inherited doc mislabel (see issues). No new product defects found.

## Per-item confirm/refute (own runs)

### 1. faceSlab x-axis fix — **CONFIRMED**

| what I did | result |
|---|---|
| Re-ran my containment scan (identical definition: part AABB > 0.5 m outside the building's cell footprint; full-game seed 1, 441 buildings, 164 930 parts, generator regenerated in-page with the shipped stream) | **outsideCount 0, affectedBuildings 0** (was 492 / 172) |
| Same scan side data | census hash **`82f1dcb3`** (unchanged), own draws **122**, parts 164 930, studs 80 348 — the fix changed slab dims, not the rng stream or part counts |
| Re-captured + looked at my own x-side crops of the two exact pre-fix offenders | `c3v/shots/xside-office-b3.png`: pink awning now lies **along** the wall over the shopfront glazing, door recess + stoop at the base, no plank. `c3v/shots/xside-tower-office-b9.png`: lime awning along the wall + valance, door + stoop lying along the base; the diagonal gangplank is gone |
| Front (z) faces unchanged/improved | `front-shop-b1.png` / `front-apartment-b2.png` unchanged (the fix only alters the `axis === 'x'` branch by construction); my z-face nudge grazing pairs unchanged to 3 decimals (e.g. graze-shop-b1 meanAbs 7.404 → 7.403, max 200) |
| Code check | `faceSlab` now swaps `bw/bd` for `axis === 'x'` and keeps the tilt rotation (`src/buildings/generator.js` ~line 417); matches the recommended fix |

### 2. Flush doors / coplanar classes — **CONFIRMED (doors gone), count label corrected**

My exact-area pass (same 10 staged buildings, same clip method):

| metric | pre-fix | now |
|---|---|---|
| exact coplanar co-facing pairs with intersection area **> 0.01 m²** (the figure the reports call "≥1 cm²" — see issue 1) | 949 | **945** |
| pairs **≥ 0.25 m²** | 51 | **48** |
| total pairs **> 1 cm²** (all keys, my histogram sum) | — | **3764** = 841 down-facing + 1647 outward-of-wall + 1241 inside-volume + 35 wall-inner |

- The pre-fix **b0 house door** pairs (`Z|1|-8.75`, 0.39 + 0.56 + 0.89 m²) are **gone**; no pairs exist at that
  plane anymore, and the b5 warehouse dock plane (31.25) is empty too.
- The 48 pairs ≥ 0.25 m² break down as **26 down-facing** (Y|−1: ground-plane bedded bottoms, stacked-box
  undersides at setback/crown planes) and **22 vertical faces 2 cm inside the walls** (inward-facing band /
  trim inner faces on b2/b3/b8 — e.g. X|1|-87.23 is `-88+0.75+0.02`, i.e. inside the b8 wall whose outer face
  is at −87.25). **None is two outward faces at one depth.**
- Largest *outward* coincident pair in the whole scan is 0.172 m² (b1 shop, `black`/`black` shopfront frame-ring
  segments — identical material, imperceptible even if the depth test ties); largest *different-material* outward pair is
  0.149 m² (b7 hospital `signGlow` board vs `lightStoneGrey` course band at wall + 0.07 — pre-existing civic
  geometry, present before this cycle). No outward pair ≥ 0.25 m² exists.
- Builder's gap #4 says "44 down-facing + 4 vertical"; my classification says 26 + 22 (all hidden). The
  conclusion (no visible front-face coincidence at ≥ 0.25 m²) holds; the split in the report is inaccurate.

### 3. Report corrections + facade fallback — **CONFIRMED**

- `docs/reviews/loop-c3.md` now scopes the determinism claim to facade-showcase/day and separates it from the
  geometry census (lines ~129–134), and known-gap #8 lists the non-additive changes (industrial clerestory
  pitch, `pickFrame` recolouring, replaced rooftop greebles, level-1 shop awning, fix-round items). ✓
- `node tools/critic.mjs --module buildings --round 9 --dir shots/buildings/r9` (default variant): 16 shots,
  minFps **143.4**, maxGpuMs **6.86**, maxDrawCalls **370**, errors **0**.
- `buildings:facade` is now a **distinct pose** from `buildings:default` in the default variant: my own pixel
  diff of `r9/buildings_facade-12.png` vs `r9/buildings_default-12.png` = **meanAbs 17.53, 89.99 % px > 8,
  maxDelta 230** (and the per-tod draw/triangle counts differ, e.g. 6.5h: 355/3.44 M vs 337/3.18 M). Looked at
  `buildings_facade-12.png`: a sensible low 3/4 view of the staged block, nothing broken.

### 4. No new breakage — **CONFIRMED**

| run | result |
|---|---|
| `check-civics.mjs` | **38/38**, browser captures errors 0 |
| `check-beauty.mjs --out shots/beauty/c3c` | **37/37** |
| `critic --game --round 46 --dir shots/game/r46` | minFps **92.5**, maxGpuMs **10.38**, maxDrawCalls **934**, errors **0** — budgets hold (fps ≥ 50, gpuMs ≤ 20, draws ≤ 1500) |
| `diff r45 → r46` (both post-fix) | meanAbs **0.0091**, worst 0.0448 (overview-21h5) — drift-level |
| `diff r44 → r46` (pre-fix → post-fix) | meanAbs **0.0881**, worst closeup-6h5 0.3085 (1.0 % px > 8) — small and local, matches the builder's 0.0803 |
| heroes (looked at) | `beauty/c3c/04-closeup-golden` (hospital intact, framing/cross sign fine), `03-street-night` (bus/figures/lit windows, red beacons, no rogue geometry), `05-aerial-dawn` (varied crowns + roof clutter, no planks), `game/r46/closeup-21h5` (night hospital, cross-sign bloom controlled) |
| x-side/balcony crops (looked at) | b3 office / b9 tower-office as above; b2 balcony (`balc-z-`, the apartment's only slab, z− face) slab + rail sit below the window sills; `front-house-b0` shows the 2 cm-proud door, no shimmer |

## New ranked issues

1. **[LOW — doc accuracy] The coplanar threshold label is wrong by 100×.** The "≥1 cm²" figures
   (baseline 1255 → pre-fix 949 → current 945) are actually pairs with intersection area **> 0.01 m²
   (100 cm²)**; the > 1 cm² total is 3764. This label originated in my cycle-3 review and was copied into
   `loop-c3.md` known-gap #4. Fix the wording (and, if a cheap gate is wanted, keep the > 0.01 m² threshold
   but name it).
2. **[LOW — pre-existing, note only] A few small different-material outward coincidences remain** below the
   ≥ 0.25 m² bar: b7 hospital sign board vs course band (0.12–0.15 m² at wall + 0.07, pre-existing) and
   same-material window-frame ties (b1 black/black, 0.17 m²). No shimmer was visible in the grazing/nudge
   captures; these are pre-existing, not introduced by cycle 3. Fix only if a close-up ever shows banding.
3. **[INFO — scope, unchanged] Civic facades are still untouched** by orchestrator decision; the set-5
   pair-04 "flat blank walls" lever is deferred to cycle 4's curated shot list. Not a regression, but the
   blind-metric expectation for this cycle remains concentrated in pair 03.

## What I did NOT verify

- Did not re-run `check-detail.mjs` this round (no props/check-detail-relevant source changed; the builder
  reports 38/38) — props census/intersection rules were last verified by me pre-fix.
- Did not re-run my own two-boot determinism pixel diff this round; the fix consumes no rng (census hash
  `82f1dcb3` unchanged) and z-face slabs are untouched by construction, so day/showcase determinism carries
  over from my cycle-3 reproduction (meanAbs 0.0008) and the builder's fix-round claim.
- Did not visually verify the fire/police/school flush plates the builder pulled 2 cm proud (those civic
  kinds are not in the staged facade set); the general flush class was verified gone on the staged buildings
  (house door, warehouse dock).
- Balcony-on-x-face was verified analytically (containment 0; the fix path is shared with stoops/awnings) and
  visually for the b2 z-face balcony only — the staged apartment's single balcony is not on an x-face.
- No new blind set / E4 judging (not my role); no other seeds sampled.
- Did not inspect every r9/r46 frame; read the ones listed above plus the fallback pose.

## Evidence paths

- Runs: `shots/buildings/r9/summary.json`, `shots/game/r46/summary.json`, `shots/beauty/c3c/summary.json`,
  `shots/civics/r2/summary.json`.
- Diffs: `Temp/opencode/c3v/diff-r45-r46.json`, `diff-r44-r46.json`; facade-vs-default inline diff (meanAbs
  17.53).
- My crops: `Temp/opencode/c3v/shots/{xside-office-b3.png,xside-tower-office-b9.png,front-shop-b1.png,front-apartment-b2.png,front-house-b0.png,balc-z-.png,balc-x-.png,balc-x+.png,crops-report.json}`.
- Analytic: `Temp/opencode/c3v/fullcheck.json` (containment 0), `coplanar-hist.mjs` + `frontcheck.mjs`
  outputs (945 / 48 / 3764 classes), `pairid.mjs` (b0 door plane absent).
