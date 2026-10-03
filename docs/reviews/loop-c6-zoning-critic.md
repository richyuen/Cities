# loop-c6-critic-zoning
verdict: **PASS**   score: 7.5/10 (CRITIC_BRIEF scale, judged on how well A1 is executed)
**RAISE-WITH-OWNER (bulldoze): yes**. **Owner ruling, 2026-10-03: zone tools only.** Bulldoze, roads and parks keep the plates hidden. Sent back to the zoning builder as a one-line fix.

I reproduced the change itself. All gates are green. Every interaction edge case behaves correctly, and the warm-up proxy never draws. One builder attribution is false: the night-sky pixels do not come from plate glow (issue 2). One builder choice is outside the owner decision: bulldoze also shows the plates (issue 1).
Orchestrator integrity check (LOOP §8): tree state and diff hashes were identical before and after this run, so the review is valid.

## Gates
| gate | measured | command / output |
|---|---|---|
| errors | 0 in every capture (both batches, shot list ×2, check-background ×2, exp1–6 consoles: no errors or warnings) | `shots/game/c6zcrit/summary.json`, `c6zcrit-always/summary.json` |
| gpuMs ≤ 20 | default max **7.35**, zones=always max **10.94** | `node tools/critic.mjs --game --dir shots/game/c6zcrit` (`--param zones=always` → `c6zcrit-always`) |
| draws ≤ 1500 | default max **818**, always max **1023** | same |
| fps ≥ 50 | default min 129.9, always min 88.9 | same |
| Math.random / wall time in zoning | none (grep `Math.random\|performance.now\|Date.now` on src/zoning/index.js) | — |
| determinism | same code, builder c6z vs my c6zcrit: mean 0.0295, **0/20** over 0.30 (worst closeup-12 0.094). zones=always vs c6crit2: mean 0.0052, **0/20** over (worst street-21h5 0.0234; builder said 0.0037) | `shots/game/c6zcrit-diff-c6z.json`, `node tools/diff.mjs --a shots/game/c6crit2 --b shots/game/c6zcrit-always` |
| owner scope | `git diff --stat 1b460f9`: only `src/zoning/index.js` (+124/−19), plus the untracked `docs/core-requests/zoning-c6.md` | — |
| check-background | **4/4** (0 idle plate rays, 250 with zone:r); zones=always 2/2 with idle plates 46/5/104/38/57 | `shots/background/c6zcrit`, `c6zcrit-always` |
| check-detail | **41/41**, nosp census e0f35033 == e0f35033 | `shots/props/c2/summary.json` |
| check-views | **25/25** | `shots/views/c4/check.json` |

## Claims
| claim | reproduced? | my number | evidence |
|---|---|---|---|
| Visibility = !viewHidden && (always \|\| toolShows); toolShows for zone:r/c/i, zone:none, bulldoze | yes | 28-step sequence (below): plates drawn exactly for zone:r/c/i/none/bulldoze (button and KeyB). Hidden for road:street, park, select, null | scratchpad `critz/exp3.mjs`, `critz/exp3/log.json` |
| setOverlayVisible is only the view veto | yes | zone:r + view → hidden; switching to zone:c inside the view → hidden; tool null then view closed → hidden; view open then zone:i, first Esc closes the view → shown (tool stays), second Esc → hidden; KeyV with no tool → hidden | exp3 steps 16–24; PNG `16-zone-r+view.png` (plates gone under the power layer, preview ghost hidden) |
| Rescans deferred while hidden, caught up on show | yes | 12 bare cells painted via `setZoneBrush` while hidden → meshes unchanged after 30 frames → **1805→1817 instances in the same call** as setTool('zone:r'). At boot no plate mesh exists at all (only the 3 warm-up meshes) until the first show | `critz/exp4.mjs` |
| Old InstancedMesh dispose() (leak fix) | yes | `renderer.info.memory.geometries` 261 → 262 after 8 show/rescan cycles | exp4 |
| Pulse/night skipped while hidden, reapplied on show | yes (code + paused A/B: shown frames correct on the first frame) | — | exp1 |
| First-show stall fixed by the warm-up proxy (7.9 ms) | partly reproduced: no shader compile on first show | Fresh page, title-screen boot: **programs 44 → 44** across the first show, which was a **19.2 ms** tick (it includes the deferred 3.7k-cell rescan). After load: **5.4–6.0 ms**. Re-show: **2.6 ms** | exp3/exp4 |
| Warm-up proxy never renders | yes | renderBufferDirect hook (covers main, shadow and transmission passes): **0** `zoning-warmup-*` draws in every step. Shown plates draw 1×/frame each (no shadow pass, castShadow false) | exp1/exp3 `drawn` fields |
| −205 draws, −3.7 ms | draws yes; −3.7 ms is the batch max-to-max only | In-page ABAB, 18 samples per state, medians hidden→shown: street-12 6.53→9.20 (+2.67), skyline-12 6.80→8.42 (+1.62), overview-12 6.48→7.11 (+0.63), street-21.5 7.34→10.89 (+3.55), skyline-21.5 6.96→10.63 (+3.67), overview-21.5 6.61→9.19 (+2.58). Draws +183…+205 | `critz/../exp2.mjs` |
| The saving is three's transmission pre-pass | yes | Paused overview-21.5: shown = 915 draws vs hidden 712; only 3 of them are plates. With plates hidden, no visible object has transmission > 0 | exp1 `visibleTransmissive` |
| "Plates are the only transmissive surfaces" | yes for seed 1 | `props-busstop-panel` (transmission 0.5) exists with **count 0**. The 6 transit stops (+1 I placed) are pole/sign/face/ring meshes with transmission 0. Street-12 with the added stop: 743 draws / 6.8 ms hidden, 926 / 8.5 ms shown | `critz/exp5.mjs`, `exp6.mjs` |
| Default vs c6crit2: 18/20 over, "all plates only" | **18/20 reproduced; "plates only" is false** | mean 1.5619, 18/20 over. Masks also show stars/cloud edges, a moved car and a traffic signal that changed phase (street-18, street-21h5) | `shots/game/c6zcrit-diff-c6crit2.json`; triptychs I looked at: overview-21h5, street-21h5, street-18, closeup-6h5 |
| Night-sky pixels come from plate glow feeding bloom | **refuted** | Paused in-page toggle at overview 21.5, sky band y 0–120: hidden vs shown meanAbs **0.0000, max 0**. Same with bloom off and with emissive 0. Real cause: issue 2 | `out/exp1/*.png` + `rd.cjs` |
| Esc mid-drag | yes | Esc cancels the drag and deselects the tool; plates and preview hide; mouseup commits nothing (1805 unchanged) | `exp3/12-mid-drag.png`, `13-esc-mid-drag.png` |
| Save/load with a zone tool active | yes (real load path; `?load` is ignored under fixeddt=1) | Slot saved with zone:r active → reload: tool null, plates hidden, probe cell zone `i` loaded. zone:i → plate present at the probe cell, 826 instances | exp4 |
| New city | n/a in-page: the menu calls `location.assign`, a fresh boot (same as boot-idle) | — | src/menu/index.js:111 |
| zones=always with views | yes | check-views 25/25 is on the default build. With zones=always the batch matches the pre-change baseline (0/20) | — |

## Ranked issues
1. **The bulldoze carve-out is outside the owner decision and its rationale is inconsistent (MED, product spec). RAISE-WITH-OWNER.** The owner said "only while a zone tool is active". In the HUD, Bulldoze sits under TOOLS, not ZONES. The builder's reason is that bulldoze erases zoning the player cannot see. Two other tools do the same and still hide the plates:
   - roads: `world.js:823` sets `c.zone = null` when a road is laid over a cell;
   - park/trees/plaza: `tools/index.js:671` sets `zone: null`.

   The rule therefore protects one zone-destroying tool out of three. Fix: either drop `'bulldoze'` from `OVERLAY_TOOLS` (the literal reading, and my default until the owner rules), or have the owner extend it to every zone-destroying tool. No effect on captures, since the shot pipeline selects no tool.
2. **The builder's "plate glow feeding bloom" attribution is false. The real cause is a harness weakness (MED, owner: tools).** `shot.mjs capture()` takes the screenshot after a free-running `sampleMs` window. The number of frames rendered in that window scales with fps (street-21h5 rafFps 89 → 130; overview-21h5 106 → 144). Environment's `S.time` and cloud offset (stars twinkle, clouds drift) and traffic advance per frame even with the clock paused (`environment/index.js:466-469`). So any perf change moves the sky, star, cloud, car and signal phase.
   - The default-vs-baseline diff therefore mixes plate pixels with frame-count pixels.
   - Shot-list and blind-set captures are only reproducible at equal fps.
   - Fix (tools): take the screenshot right after `frames(settle)` with updates frozen during the fps sample, or sample fps after the screenshot. Record this in LOOP §7 and correct the builder report.
3. **ARCHITECTURE still says "`views` hides `zoning`'s plates" (line 196) and does not document `getOverlayState` or the transmission-pass perf note (LOW, integrator).** The fix text is already in `docs/core-requests/zoning-c6.md` #1/#2.
4. **Showcases that load zoning no longer show committed plates (LOW, known).** Affected: tools (sets its tool via `internal.setTool` with no event), ui (`selectTool('road:street')`), buildings. Fix: tools showcase emits `tool:selected {tool:'zone:r'}` (core request #3).
5. **The warm-up compiles only the composer-path variant (LOW, known).** With effects off or failed it compiles against the screen; a runtime `effects.setEnabled(false)` would compile on first show. Not reachable in the shipped default.
6. **First show still costs 19.2 ms on a fresh boot (LOW).** No shader compile is involved (programs 44→44); the cost is the deferred full rescan (~3.7k instances) plus the first transmission-target use. That is one dropped frame, not a stall; acceptable.

## Metric prediction (set 8; frames: `shots/beauty/c6zcrit` vs `c6zcrit-always`, looked at as triptychs)
| pair | reference advantage (set-7 reasons) | prediction | evidence |
|---|---|---|---|
| 01 house | house craft (balusters, dormers, siding); "flat stud baseplate / empty lots to the horizon" | **no change** from A1 | 01 meanAbs 0.77. The pale lime plate rows behind the house (upper third) become uniform dark-green stud lots, still empty. eTotal stays 13.7% (check-background). The plate stripes are gone, the empty lots are not |
| 03 skyline | landmarks/signs; "empty green lots" 3/3; sun glare 3/3 | **no change** (risk slightly worse) | 03 meanAbs 2.22. Cyan/lime plate strips between towers become plain green stud fields, so the city reads sparser. eTotal 17.9% unchanged. Glare: clipped pixels 961 → 820; the glint off building glass at the centre stays |
| 04 farm | scale, windmill/barn craft; "bare baseplate blocks behind" 3/3 | **no change** | 04 meanAbs 0.40. Only the orange plate patches at the top edge go; the blocks behind stay bare |
| 05 avenue | signage, busy road; "oversized studs on curb and grass" 3/3 | **no change** | 05 meanAbs 0.30. The lime plate field at foreground right becomes a raw dark-green stud field, which is the "oversized studs" read in purer form |

The "bare baseplate lots" read stays the same. A1 removes the zoning-overlay look but not the empty lots: eZone+ePlain stays 13–18% in 01/03/04/05. Acceptance (a) needs A2 (terrain lawn) or content on those lots; A1 alone will not move it.

## What works
- The two-flag rule is clean and holds in every edge case I threw at it: direct r→c→i, bulldoze→none, Esc mid-drag, a tool change inside a view, the Esc chain, KeyV, save/load. No stale or resurrected plates.
- The warm-up proxy does its job without side effects: zero draws in any pass, no new program on first show, no console warnings, no leak.
- Real perf win in the default view: −183…−205 draws and +0.6…3.7 ms of gpuMs saved per shot (medians), because the transmission pre-pass is skipped. zones=always is unchanged against the baseline (0/20).

Housekeeping: probe scripts are under the session scratchpad (`critz/`, plus `tri.cjs`, `crop.cjs`, `rd.cjs`, `exp1.mjs`, `exp2.mjs` at the scratchpad root). Writing `crop.cjs` there may have overwritten an earlier file of the same name. Repo writes are only `shots/` outputs from repo tools. `git status --porcelain -- src tools docs ARCHITECTURE.md index.html package.json` is unchanged (only the builder's `M src/zoning/index.js` and `?? docs/core-requests/zoning-c6.md`).
