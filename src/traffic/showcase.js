// Demo road networks for the traffic showcase. Built with world.addRoad directly (traffic has no road-editing
// deps beyond `roads`), staged near the map origin where terrain generates a flat plateau (see terrain/heightgen.js
// P.plateauR), so no manual height flattening is required.

/** 3x3 node grid: a loop of streets with one avenue "main street" through the middle, several intersections
 * (one 4-way, four T-junctions) and four smooth corner joints. Used by 'default' and 'night'. */
export function buildGridDemo(world) {
  const xs = [-56, 0, 56], zs = [-56, 0, 56];
  for (const x of xs) {
    for (let k = 0; k < zs.length - 1; k++) world.addRoad({ x, z: zs[k] }, { x, z: zs[k + 1] }, 'street');
  }
  for (const z of zs) {
    const kind = z === 0 ? 'avenue' : 'street';
    for (let k = 0; k < xs.length - 1; k++) world.addRoad({ x: xs[k], z }, { x: xs[k + 1], z }, kind);
  }
  return { minX: xs[0] - 12, maxX: xs[xs.length - 1] + 12, minZ: zs[0] - 12, maxZ: zs[zs.length - 1] + 12, cx: 0, cz: 0 };
}

/** A single busy 4-way intersection with four ~55 m dead-end arms (cars U-turn at the tips and cycle back). */
export function buildIntersectionDemo(world) {
  const A = 55;
  world.addRoad({ x: -A, z: 0 }, { x: 0, z: 0 }, 'street');
  world.addRoad({ x: 0, z: 0 }, { x: A, z: 0 }, 'street');
  world.addRoad({ x: 0, z: -A }, { x: 0, z: 0 }, 'street');
  world.addRoad({ x: 0, z: 0 }, { x: 0, z: A }, 'street');
  return { minX: -A - 8, maxX: A + 8, minZ: -A - 8, maxZ: A + 8, cx: 0, cz: 0 };
}
