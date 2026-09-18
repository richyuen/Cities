// Showcase scene staging: stages world.buildings/world.roads records; the module's own building() reactively
// renders whatever ends up in world.buildings, so staging here is just "call the same mutators the game would".

function footprintFor(zone, level, rng) {
  if (zone === 'i') return rng.chance(0.5) ? { w: 2, d: 2 } : { w: 3, d: 2 };
  if (zone === 'c') return level === 3 ? { w: 2, d: 2 } : (rng.chance(0.3) ? { w: 2, d: 1 } : { w: 1, d: 1 });
  return level === 3 ? { w: 2, d: 2 } : { w: 1, d: 1 };
}

const ZONE_ORDER = ['r', 'c', 'i'];

/** All 9 (zone, level) combos, cycling without repeating a pair until all 9 are used. */
function zoneLevelAt(n, offset = 0) {
  const pair = (n + offset) % 9;
  return { zone: ZONE_ORDER[Math.floor(pair / 3)], level: (pair % 3) + 1 };
}

function placeRow(world, rng, { iStart, iEnd, j, growSign, offset = 0, gap = 1 }) {
  let i = iStart;
  let n = 0;
  const placed = [];
  while (i < iEnd) {
    const { zone, level } = zoneLevelAt(n, offset);
    const fp = footprintFor(zone, level, rng);
    if (i + fp.w > iEnd) break;
    const jj = growSign > 0 ? j : j - fp.d + 1;
    for (let dj = 0; dj < fp.d; dj++) for (let di = 0; di < fp.w; di++) world.setZone(i + di, jj + dj, zone, level);
    const id = world.addBuilding({ i, j: jj, w: fp.w, d: fp.d, zone, level, seed: rng.int(0, 1e9) });
    placed.push({ id, i, j: jj, w: fp.w, d: fp.d, zone, level });
    i += fp.w + gap;
    n++;
  }
  return placed;
}

/**
 * ~30 buildings, all zones/levels, along a small street. `tallest` is left to the caller (index.js) to pick
 * from the actually-generated heights - `level` doesn't mean "tallest" across zones (industrial stays
 * low-rise at every level), so picking by level+footprint here previously chose a wide industrial shed
 * instead of a skyscraper for the `closeup` preset.
 */
export function stageDefault(world, rng) {
  const j0 = Math.floor(world.size.h / 2);
  const iStart = Math.floor(world.size.w / 2) - 16;
  const a = world.cellToWorld(iStart - 1, j0), b = world.cellToWorld(iStart + 33, j0);
  world.addRoad({ x: a.x, z: a.z }, { x: b.x, z: b.z }, 'street');
  const north = placeRow(world, rng, { iStart, iEnd: iStart + 32, j: j0 - 3, growSign: -1, offset: 0 });
  const south = placeRow(world, rng.fork('south'), { iStart, iEnd: iStart + 32, j: j0 + 3, growSign: 1, offset: 4 });
  return { placed: [...north, ...south] };
}

/** One building of each zone at each level (9 total), spaced out for direct comparison. */
export function stageLevels(world, rng) {
  const j0 = Math.floor(world.size.h / 2);
  const iStart = Math.floor(world.size.w / 2) - 16;
  const a = world.cellToWorld(iStart - 2, j0 + 6), b = world.cellToWorld(iStart + 34, j0 + 6);
  world.addRoad({ x: a.x, z: a.z }, { x: b.x, z: b.z }, 'street');
  const zones = ['r', 'c', 'i'];
  let i = iStart;
  const placed = [];
  for (const zone of zones) {
    for (let level = 1; level <= 3; level++) {
      const fp = footprintFor(zone, level, rng);
      const j = j0;
      for (let dj = 0; dj < fp.d; dj++) for (let di = 0; di < fp.w; di++) world.setZone(i + di, j + dj, zone, level);
      const id = world.addBuilding({ i, j, w: fp.w, d: fp.d, zone, level, seed: rng.int(0, 1e9) });
      placed.push({ id, i, j, w: fp.w, d: fp.d, zone, level });
      i += fp.w + 2;
    }
  }
  return { placed };
}

/** Dense mixed block bounded by two parallel streets + a cross street, for night-window coverage. */
export function stageNight(world, rng) {
  const j0 = Math.floor(world.size.h / 2);
  const iStart = Math.floor(world.size.w / 2) - 18;
  const iEnd = iStart + 36;
  const rowN = j0 - 5, rowS = j0 + 5;
  const a1 = world.cellToWorld(iStart - 1, rowN), b1 = world.cellToWorld(iEnd + 1, rowN);
  world.addRoad({ x: a1.x, z: a1.z }, { x: b1.x, z: b1.z }, 'street');
  const a2 = world.cellToWorld(iStart - 1, rowS), b2 = world.cellToWorld(iEnd + 1, rowS);
  world.addRoad({ x: a2.x, z: a2.z }, { x: b2.x, z: b2.z }, 'street');
  const midI = Math.floor((iStart + iEnd) / 2);
  const c1 = world.cellToWorld(midI, rowN), c2 = world.cellToWorld(midI, rowS);
  world.addRoad({ x: c1.x, z: c1.z }, { x: c2.x, z: c2.z }, 'street');
  const rows = [
    { j: rowN - 2, growSign: -1, offset: 0 },
    { j: rowS + 2, growSign: 1, offset: 3 },
  ];
  const placed = [];
  for (const r of rows) {
    let half = 0;
    for (const range of [[iStart, midI - 1], [midI + 1, iEnd]]) {
      placed.push(...placeRow(world, rng.fork(`n${r.j}:${range[0]}`), { iStart: range[0], iEnd: range[1], j: r.j, growSign: r.growSign, offset: r.offset + half * 6, gap: 0 }));
      half++;
    }
  }
  return { placed };
}
