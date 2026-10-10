# loop-c6 lawn panels (lawn=0 vs lawn=1, blind)

Template and judge role as LOOP section 3 / `.claude/agents/judge.md`. "ours" = `lawn=1`, "theirs" = `lawn=0`, same seed-1 shot-list, separate boots.
Rule (pre-registered in LOOP.md before panel 2): strict per-vote reading; `lawn=1` stays the default only with >= 8/15; panel 2 is final.

## Panel 1: judge/lawn1, seed 61, split 2/3, sources shots/beauty/c6lawn1f-s1 vs c6lawn0f-s1 (fix round 1: verge studs off)
Key: lawn=1 on B, B, A, A, B. Bytes of all 10 files match their sources (SHA-256).

| pair | J1 | J2 | J3 | votes for lawn=1 |
|---|---|---|---|---|
| 01 house | B | B | A | 2/3 |
| 02 park | A | A | A | 0/3 |
| 03 skyline | A | A | A | 3/3 |
| 04 farm | A | B | A | 2/3 |
| 05 avenue | A | A | A | 0/3 |

Total 7/15. For the lawn: "flat tiled lawn lets the hedges, fences ... read cleanly", "dense studs alias into stripy moire" (03), "calm tiled lawn ... lets the windmill, barn ... stand out". Against: "flat plain green" corners (02), "pale, flat, mostly empty green slab with a few stray studs that looks unfinished", "a few stray cubes that look like debris" (05), "flat, blank green plane that looks unfinished" (01, J3), "large flat teal lawns with a few stray studs look blank" (04, J2).

## Panel 2 (final): judge/lawn2, seed 67, split 2/3, sources shots/beauty/c6lawn1g-s1 vs c6lawn0g-s1 (fix round 2: verge studs back, depth-less)
Key: lawn=1 on A, B, A, B, B. Bytes of all 10 files match their sources (SHA-256).

| pair | J1 | J2 | J3 | votes for lawn=1 |
|---|---|---|---|---|
| 01 house | A | A | A | 3/3 |
| 02 park | A | A | B | 1/3 |
| 03 skyline | A | A | A | 3/3 |
| 04 farm | B | B | B | 3/3 |
| 05 avenue | A | A | A | 0/3 |

Total 10/15 -> lawn kept as the default. For: "calm flat plates with sparse studs, so the house, pergola and orange tree read cleanly" vs "dense stud carpet ... noisy and makes a hard seam against the tiled garden" (01); "smooth with clean long shadows" vs "grainy, shimmering stripes" (03); "lets the windmill, red barn, wheat and corn fields stand out" vs "corduroy-striped" (04). Against: "dense studded baseplate ... frames the grey paved skate plaza with more texture" (02, two judges, both "small difference"); 05 unanimous: "pale, flat green expanse with a few random studs that reads as empty and unfinished", "pale, washed-out mint slab", "looks washed out and empty at this close range" (two judges called 05 a close call).

All 30 reasons describe content present in their pair. No reason cites a vehicle.
