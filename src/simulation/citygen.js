// Synthetic showcase city: a 6×6-block district on a street grid near the origin, mixed R/C/I zones, a few parks.
// Pure world mutations (addRoad / addBuilding / setCell) — no THREE, so Node benchmarks can use it too.

export const BLOCK = 3;           // cells per block side
export const PERIOD = BLOCK + 1;  // block + 1-cell street
export const BLOCKS = 6;          // blocks per axis
export const HEIGHTS = { r: [0, 3.5, 8, 16], c: [0, 4.5, 11, 26], i: [0, 4, 7, 10] };
export const KINDS = { r: 'house', c: 'shop', i: 'factory' };
/** Use world.addRoad for the streets (core's World.removeRoad re-stage bug is fixed; cells-only fallback kept). */
export const USE_WORLD_ROADS = true;

/**
 * Stage the district into `world`. Returns { i0, j0, span, parks: [{i,j}], parkBlocks, emptyLots: [{i,j,zone}], intersections: [{i,j}],
 * buildingIds, roadIds, roadCells:[{i,j,dir}] }.
 * `blocksPerAxis` lets benchmarks build much larger cities.
 */
export function stageCity(world, rng, { blocksPerAxis = BLOCKS, variant = 'default' } = {}) {
  const span = blocksPerAxis * PERIOD + 1;                 // cells incl. closing street
  const i0 = Math.floor(world.size.w / 2 - span / 2), j0 = Math.floor(world.size.h / 2 - span / 2);
  const roadIds = [];
  // streets: every PERIOD cells, both axes, split at every intersection so the road graph has proper nodes
  if (USE_WORLD_ROADS) {
    for (let a = 0; a <= blocksPerAxis; a++) {
      const cx = world.cellToWorld(i0 + a * PERIOD, j0).x;
      const cz = world.cellToWorld(i0, j0 + a * PERIOD).z;
      for (let b = 0; b < blocksPerAxis; b++) {
        const za = world.cellToWorld(i0, j0 + b * PERIOD).z, zb = world.cellToWorld(i0, j0 + (b + 1) * PERIOD).z;
        const id1 = world.addRoad({ x: cx, z: za }, { x: cx, z: zb }, 'street'); if (id1) roadIds.push(id1);
        const xa = world.cellToWorld(i0 + b * PERIOD, j0).x, xb = world.cellToWorld(i0 + (b + 1) * PERIOD, j0).x;
        const id2 = world.addRoad({ x: xa, z: cz }, { x: xb, z: cz }, 'street'); if (id2) roadIds.push(id2);
      }
    }
  } else {
    // road cells only (same footprint a 1-cell 'street' edge would mark)
    for (let j = 0; j < span; j++) for (let i = 0; i < span; i++) {
      if (i % PERIOD !== 0 && j % PERIOD !== 0) continue;
      world.setCell(i0 + i, j0 + j, { type: 'road', zone: null, density: 0, roadId: null });
    }
  }

  const parks = [];
  const parkBlocks = [];
  const emptyLots = [];
  const buildingIds = [];
  const half = blocksPerAxis / 2;
  // park quota counts BLOCKS (not cells): ~10% of blocks, at least 2, and two are fixed so every variant has a
  // residential-side park and a central one.
  const parkQuota = Math.max(2, Math.round(blocksPerAxis * blocksPerAxis * 0.1));
  const fixedParks = new Set([`${Math.floor(half) - 1},${Math.floor(half)}`, `${Math.max(0, Math.floor(half) - 3)},${Math.max(0, Math.floor(half) - 2)}`]);
  for (let bz = 0; bz < blocksPerAxis; bz++) {
    for (let bx = 0; bx < blocksPerAxis; bx++) {
      const bi = i0 + 1 + bx * PERIOD, bj = j0 + 1 + bz * PERIOD;
      // zone by longitude with some noise: west residential, middle commercial, east industrial
      const t = (bx + 0.5) / blocksPerAxis + rng.range(-0.12, 0.12);
      let zone = t < 0.42 ? 'r' : t < 0.7 ? 'c' : 'i';
      if (rng.chance(0.12)) zone = rng.pick(['r', 'r', 'c']);
      const isPark = fixedParks.has(`${bx},${bz}`) || rng.chance(0.09);
      if (isPark && parkBlocks.length < parkQuota) {
        parkBlocks.push({ bx, bz, i: bi, j: bj });
        for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) {
          world.setCell(bi + i, bj + j, { type: 'park', zone: null, density: 0 });
          parks.push({ i: bi + i, j: bj + j });
        }
        continue;
      }
      // distance to district centre → denser in the middle
      const dc = Math.hypot(bx + 0.5 - half, bz + 0.5 - half) / half;
      const lvlWeights = zone === 'i' ? [3, 1.5, 0.3] : dc < 0.4 ? [1, 2.5, 1.5] : dc < 0.75 ? [3, 2, 0.5] : [5, 1.5, 0.15];
      const used = new Set();
      const mark = (ci, cj, w, d) => { for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) used.add(`${ci + i},${cj + j}`); };
      const free = (ci, cj, w, d) => { for (let j = 0; j < d; j++) for (let i = 0; i < w; i++) if (used.has(`${ci + i},${cj + j}`)) return false; return true; };
      // maybe one 2×2 in a corner
      if (BLOCK >= 3 && rng.chance(zone === 'c' ? 0.5 : 0.3)) {
        const ci = rng.int(0, 1), cj = rng.int(0, 1);
        addB(bi + ci, bj + cj, 2, 2, zone, rng.pickWeighted([1, 2, 3], lvlWeights));
        mark(ci, cj, 2, 2);
      }
      // a couple of 1×2 / 2×1 footprints (row houses, halls, long sheds) where they fit
      for (let n = rng.int(1, 2); n > 0; n--) {
        const along = rng.chance(0.5);
        const w = along ? 2 : 1, d = along ? 1 : 2;
        const ci = rng.int(0, BLOCK - w), cj = rng.int(0, BLOCK - d);
        if (!free(ci, cj, w, d)) continue;
        addB(bi + ci, bj + cj, w, d, zone, rng.pickWeighted([1, 2], lvlWeights.slice(0, 2)));
        mark(ci, cj, w, d);
      }
      for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) {
        if (used.has(`${i},${j}`)) continue;
        if (rng.chance(0.14)) { world.setZone(bi + i, bj + j, zone, 1); emptyLots.push({ i: bi + i, j: bj + j, zone }); continue; } // empty zoned lot
        const level = rng.pickWeighted([1, 2, 3], lvlWeights);
        addB(bi + i, bj + j, 1, 1, zone, level);
      }
    }
  }

  function addB(i, j, w, d, zone, level) {
    const h = HEIGHTS[zone][level] * rng.range(0.85, 1.2);
    const id = world.addBuilding({ i, j, w, d, zone, level, height: Math.round(h * 10) / 10, seed: rng.int(0, 0x7fffffff), kind: KINDS[zone] });
    buildingIds.push(id);
  }

  // road cell directions for the visual: 'x' | 'z' | 'x' (intersection → 'xz')
  const roadCells = [];
  for (let j = j0; j < j0 + span; j++) for (let i = i0; i < i0 + span; i++) {
    const c = world.cellAt(i, j);
    if (!c || c.type !== 'road') continue;
    const li = (i - i0) % PERIOD === 0, lj = (j - j0) % PERIOD === 0;
    roadCells.push({ i, j, dir: li && lj ? 'xz' : li ? 'z' : 'x' });
  }
  // street-grid intersections (cell coords) for lamp posts
  const intersections = [];
  for (let a = 0; a <= blocksPerAxis; a++) for (let b = 0; b <= blocksPerAxis; b++) intersections.push({ i: i0 + a * PERIOD, j: j0 + b * PERIOD });
  void variant;
  return { i0, j0, span, parks, parkBlocks, emptyLots, intersections, buildingIds, roadIds, roadCells };
}
