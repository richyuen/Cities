# demo — LOOP c6 (demo stage E2): requests to other owners

Written by the demo builder when the stage was stopped early (owner paused the loop for GPU contention). Numbers are
marked with the code state they were measured on; "state F" = the demo code before the last four demo edits
(infill cap 14, back-edge ordering, low planting, unstamped footprint-clipped cells). Nothing here blocks the demo files
from parsing or booting.

1. **roads / terrain (owner: roads, terrain): verge cells cannot be dressed or parked.**
   `roads/index.js markFootprint()` turns every cell the rendered footprint touches into a `'road'` cell, park cells
   included (`studdable` = none / zone / park). The strip between a sidewalk and whatever stands next to it is therefore
   never park and renders as terrain studs. In the 04 farm frame that strip is most of what still reads as bare
   baseplate: emptyPlain 14.7 % of the frame, of which 11.5 points are `'road'`-type verge cells (seed 1, state F,
   scratch re-implementation of the check-background classifier). The demo cannot fix this from its folder: a park stamp
   there is undone on roads' first update. Options: (a) roads keeps a cell's `park` type when the footprint covers
   less than half of it, or (b) the terrain sparse-stud lawn (owner-approved A2 trial) covers verge cells too.

2. **props (owner: props): `HERO.farm` and `HERO.skate` cameras.**
   The demo now composes only the garden camera. The farm camera (`dist 37, pitch 0.56`) looks down at 32 degrees, so
   the frame's background is ground, roads and the open approach side of the block, never skyline; the park-stamped
   land of the host block lies mostly behind that camera. Evidence: `shots/beauty/c6demo-s1/04-farm-golden.png`
   (state F) still shows stud baseplate along the left edge and the bottom-right corner. A lower, closer farm camera
   (the treatment the garden got) would put the stamped park and the infill houses behind the subject. Not changed in
   this round, as the brief required.

3. **props (owner: props): `populatePark()` adds a fountain to every cluster of >= 6 cells whose bounding-box centre is
   park.** The leftover-land stamp creates new clusters, so each seed gained fountains (state F: 26 -> 28 on seed 1,
   25 -> 29 on seed 2, 26 -> 29 on seed 23). No pre-existing prop moved (state F: 2900 / 2976 / 2920 plain props
   byte-equal with and without the stamp, 0 changed, 0 missing), but I did not look at the new fountains in pixels.
   A `populatePark(cells, { fountain: false })` option, or a size threshold the caller can pass, would let the demo
   keep leftover lawn free of centrepieces.

4. **buildings (owner: buildings): seat a house on the highest ground inside its cell, or expose the relief.**
   The demo now refuses any lot with more than 0.3 m of relief inside the cell (its own 9x9 `surfaceHeight` sample;
   `terrain.api.isBuildable` accepts a 0.4 m spread, which still put a step in a porch on seed 23). That is a
   workaround: the city's own block-fill houses (`citygen.fillBlock`, isBuildable only) can still have a 0.4 m step
   in the porch. Not measured outside the `demo-sp-*` houses.

5. **tools (owner: orchestrator): `check-background` classifies `'road'`-type verge cells as emptyPlain.** That is
   correct for what the judges see, but it means the park stamp cannot move that part of the number. Reporting the
   verge share separately (cell type `'road'` but outside the footprint) would make the metric attributable.

6. **tools (owner: orchestrator): gates worth adding to `check-detail` block 2d**, all of which held on state F:
   - no `demo-sp-*` house body (cell inset 0.75 m, full +z edge) overlaps a road's rendered footprint
     (state F: minimum clearance 0.78 / 2.55 / 0.67 m for infill, 1.13 / 1.11 / 2.04 m for the hero house; the
     cycle-5 hero house overlapped the sidewalk by 1.98 / 0.94 / 3.58 m, geometric measure, not checked in pixels);
   - `demo:sp-garden` equals `demo.api.setPieces()[garden].cam` and the row's chosen side;
   - `?sppark=0` leaves every pre-existing plain prop byte-equal.

7. **traffic (owner: traffic), already listed in LOOP section 7:** the wall-time debounce. One `?nosp=1` batch in
   this session came out 2/20 over 0.30 against `c6h5-nosp` (closeup-12 0.4291, closeup-6h5 0.3559, maxGpuMs 12.56)
   while the machine was loaded by another project; an immediate re-run of the same code was 0/20 (mean 0.0329, worst
   0.0866). I did not locate the differing pixels, so the attribution to traffic or load is not proven.

8. **simulation (owner: simulation), informational:** the park stamp runs after the 600-tick warm-up, so the warm-up
   economy is unchanged (state F: population and money equal with and without it on all three seeds), but the live
   model then sees more park coverage: parkShare 0.136 -> 0.199 and happiness 0.6861 -> 0.6898 on seed 1 at about
   120 frames after boot.
