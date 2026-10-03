# buildings — LOOP c6 (D: house craft, landmark flag)

Nothing here blocks the buildings change. Item 1 is what the demo builder needs; the rest are follow-ups for the orchestrator
and other owners.

1. **demo (`src/demo/setpieces.js:271`, owner: demo): set the flag on the garden house.**
   Add `landmark: true` to the `world.addBuilding({ id: p.house.id, ... })` record. Without it the house is an ordinary seeded
   level-1 house (on seed 1 / house seed 6: gable roof and door hood, but no porch, dormers or siding).
   - `landmark: true` (strict boolean) on a residential record forces two storeys and the full house vocabulary (porch with 4 posts
     and baluster runs, 2 dormers, clapboard siding with corner boards and belt course, shutters, flower boxes, gable windows, split
     roof tiles, raised flower beds, lit street-front ground floor at night) whatever the rng drew, and `buildings` never levels it up.
   - Optional, landmark only: `colors: { body, roof }` (palette names; unknown names are ignored) pins the palette, so the house looks
     the same on every world seed. Without it the colours still come from the seed (world seed 1 + house seed 6 = brightRed body,
     earthBlue roof; world seed 2 = brightYellow; seed 23 = brightPink / darkGreen). `{ body: 'sandGreen', roof: 'darkRed' }` is the
     closest match to the reference house (captures: `shots/buildings/c6b/hero-s1-colors`, `hero-s2-colors`).
   - `HOUSE_SEEDS` no longer has to be a list of "two-storey" seeds: the flag forces the storeys.
   - Geometry the garden layout may care about: a porch house's body is 5.1 m deep and sits 0.7 m back (body front at cell centre
     z + 1.85 m, porch deck to + 3.35 m, steps to + 3.95 m, cell edge at + 4.0 m). The door and the steps stay on the cell's centre
     line, so the garden path still meets the steps. Nothing is outside the cell footprint.
   - The house is taller now (seed 1: 8.07 m → 8.60 m), in case the hero camera's occlusion fan or framing should be re-checked.
2. **ARCHITECTURE.md §3 (world model).** `buildings` records may carry two optional fields owned by whoever creates the record:
   `landmark: true` (never levels up; residential = hero house) and, with it, `colors: { body, roof }`. Both are plain record
   fields, so `menu/serialize.js`'s spread copy and `world.addBuilding`'s spread carry them through save/load (verified).
3. **ARCHITECTURE.md / showcase list.** `buildings` has a fifth showcase variant `houses` (a street of eleven level-1 houses, the
   centre one a landmark) and two presets, `buildings:houses` and `buildings:hero`. `generateBuilding(...).features` for a house now
   reports `{ landmark, body, roof, trim, storeys, ridge, porch, posts, dormers, siding, shutters, planters, gableWin, splitTiles,
   windows, quoins, clutter }`, which a check can assert on.
4. **tools (`check-detail`, owner: orchestrator): a hero-flag check.** Suggested assertions, all of which hold today:
   the garden house record has `landmark === true`; regenerating it reports `storeys 2, porch true, dormers 2, siding true`;
   after N game days at x30 it is still level 1 while unflagged `demo-sp-infill-*` houses reach level 2; a
   `serializeSave → JSON → applySave` replay keeps the flag. A part-AABB containment scan (0 parts > 0.5 m outside the cell) is a
   cheap extra. My driver scripts for all of these are in the session scratchpad (`c6b/levelup.mjs`, `control.mjs`, `contain.mjs`).
5. **simulation (`src/simulation/model.js:499-513`, owner: simulation), optional.** The model still lists a landmark as a growth
   candidate (it does not know the flag); `buildings` drops it in `enqueueLevelUps`/`levelUpBuilding`. That is harmless, but
   `sim:levelup` can still fire once for it. Skipping `b.landmark === true` where `growth.push(b.id)` happens would make it exact.
6. **LOOP §7 note.** The traffic wall-time debounce (already listed) showed up again: two same-code `?nosp=1` batches differed by
   mean 0.0305 (worst 0.087) while a third matched the HEAD batch at mean 0.0015. Compare more than one run before blaming a module.
