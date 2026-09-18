// Showcase staging: 'default'/'night' build a small one-block street *network* — two parallel through streets
// (front + back of the block) joined by two cross-streets — forming four real T intersections with no dead-end
// cul-de-sac bulbs anywhere near the camera, then furnish it with the module's own auto-population algorithm at
// real density — the same populateAlongRoad()/populateIntersectionNode() the full game uses on every road it
// builds — plus a handful of repeated hand-placed set-pieces (trees, hedge runs, flower beds, hydrant, bus stops)
// so every kind the module renders is on display without the demo reading as a sparse "one of each" strip.
// 'park' builds a small park and populates it via the public API.
import { dirToRot } from './geo.js';
import { populateIntersectionNode } from './populate.js';

export const ROAD = { half: 84 };          // both through streets span x = -84..84 (168 m)
export const CROSS_X = [-42, 42];          // two cross-streets joining them
export const BLOCK_DEPTH = 56;             // distance between the front (z=0) and back (z=56) through streets
export const PARK = { half: 4 };           // cell radius (8 m cells) -> ~72x72 m park

// Camera presets are registered on ctx.cameraPresets and later invoked with just `world` (see registry.js /
// camera.js), so they cannot query ctx.modules themselves. stageStreet() recomputes this from the live roads
// api (falling back to the same numbers if roads ever failed to init) and caches it here for the presets.
let cachedOffset = 5.4;

function roadOffset(ctx) {
  const roadsApi = ctx.modules.get('roads')?.status === 'ok' ? ctx.modules.get('roads').api : null;
  const width = roadsApi ? roadsApi.roadWidth('street') : 8;
  const footprint = roadsApi ? roadsApi.footprintWidth('street') : 12;
  cachedOffset = width / 2 + Math.max(1.4, (footprint - width) / 2 * 0.6);
  return cachedOffset;
}

/** Place `kind` at (x, side*offsetExtra) on the sidewalk of the E-W through road (side>0 = +z), facing the road. */
function onSide(api, offset, kind, x, side, extra = 0) {
  const z = side * (offset + extra);
  const rot = dirToRot(0, -side);
  return api.addProp(kind, x, z, rot);
}

/** Place `kind` at (crossX + side*offsetExtra, z) on the sidewalk of a N-S cross-street (side>0 = +x). */
function onCrossSide(api, offset, kind, crossX, z, side, extra = 0) {
  const x = crossX + side * (offset + extra);
  const rot = dirToRot(-side, 0);
  return api.addProp(kind, x, z, rot);
}

export function stageStreet(ctx, api) {
  ctx.world.clearContent();
  const world = ctx.world;

  // Front through street (z=0) and back through street (z=BLOCK_DEPTH), each split into 3 segments at the two
  // cross-streets, plus the cross-streets themselves running front-to-back — world.addRoad's node-sharing turns
  // every cross-street junction into a real 3-arm T intersection (through street continues + branch), with the
  // only dead ends way out at the block's far x = ±84 corners, clear of the camera.
  const xs = [-ROAD.half, ...CROSS_X, ROAD.half];
  const throughEdges = [];
  for (const z of [0, BLOCK_DEPTH]) {
    for (let k = 0; k < xs.length - 1; k++) {
      throughEdges.push(world.addRoad({ x: xs[k], z }, { x: xs[k + 1], z }, 'street'));
    }
  }
  const crossEdges = CROSS_X.map((cx) => world.addRoad({ x: cx, z: 0 }, { x: cx, z: BLOCK_DEPTH }, 'street'));
  const offset = roadOffset(ctx);

  // Real density: the same lamp/bin/bench/sign spacing algorithm the full game runs on every road it builds,
  // applied to every segment of this little network (idempotent — see populate.js's edge de-dup guard).
  for (const edgeId of [...throughEdges, ...crossEdges]) api.populateAlongRoad(edgeId);

  // Traffic lights on every arm of all four real T intersections.
  const roadsApi = ctx.modules.get('roads')?.status === 'ok' ? ctx.modules.get('roads').api : null;
  if (roadsApi) {
    const lightRng = ctx.rng.fork('props-showcase-lights');
    for (const node of roadsApi.getIntersections()) {
      if (node.arms.length >= 3) populateIntersectionNode(ctx, api.addProp, lightRng, roadsApi, node);
    }
  }

  // Hand-placed set-pieces layered on top of the auto density, repeated a few times each (never one-of-a-kind)
  // so trees/hedges/flower beds/hydrants/bus stops read as real streetscape dressing rather than museum exhibits.
  const trees = [
    ['tree_small', -80, -1, 3.1], ['tree_medium', -36, 1, 3.5], ['tree_small', -6, -1, 3.1],
    ['tree_large', 16, 1, 4.3], ['tree_medium', 38, -1, 3.5], ['tree_small', 58, 1, 3.1], ['tree_large', 78, -1, 4.3],
  ];
  for (const [kind, x, side, extra] of trees) onSide(api, offset, kind, x, side, extra);

  // Two short hedge rows (property-boundary look): 4 abutted 2 m blocks each.
  for (let k = 0; k < 4; k++) onSide(api, offset, 'hedge', -10 + k * 2, 1, 2.5);
  for (let k = 0; k < 4; k++) onSide(api, offset, 'hedge', 62 + k * 2, -1, 2.5);

  onSide(api, offset, 'flower_bed', -66, 1, 1.7);
  onSide(api, offset, 'flower_bed', 26, -1, 1.7);
  onSide(api, offset, 'flower_bed', 70, 1, 1.7);

  onSide(api, offset, 'hydrant', -22, 1, 0.5);
  onSide(api, offset, 'hydrant', 22, -1, 0.5);

  onSide(api, offset, 'bus_stop', -62, -1, 0.9);
  onSide(api, offset, 'bus_stop', 62, 1, 0.9);

  // A little dressing on the cross-streets and the back street too, so the whole block reads as furnished,
  // not just the front street.
  onCrossSide(api, offset, 'tree_medium', -42, 20, -1, 3.4);
  onCrossSide(api, offset, 'flower_bed', 42, 36, 1, 1.7);
  for (let k = 0; k < 3; k++) onCrossSide(api, offset, 'hedge', 42, 14 + k * 2, -1, 2.4);

  const back = (kind, x, side, extra) => {
    const z = BLOCK_DEPTH + side * (offset + extra);
    api.addProp(kind, x, z, dirToRot(0, side));
  };
  back('tree_small', -66, 1, 3.1);
  back('tree_large', -10, -1, 4.3);
  back('tree_medium', 30, 1, 3.5);
  back('tree_small', 70, -1, 3.1);
  for (let k = 0; k < 3; k++) back('hedge', -34 + k * 2, 1, 2.5);
}

export function stagePark(ctx, api) {
  ctx.world.clearContent();
  const world = ctx.world;
  const { i: ic, j: jc } = world.worldToCell(0, 0);
  const half = PARK.half;
  const terrainApi = ctx.modules.get('terrain')?.status === 'ok' ? ctx.modules.get('terrain').api : null;
  if (terrainApi?.flatten) terrainApi.flatten(ic - half, jc - half, ic + half, jc + half);
  const cells = [];
  for (let j = jc - half; j <= jc + half; j++) {
    for (let i = ic - half; i <= ic + half; i++) {
      if (Math.hypot(i - ic, j - jc) > half + 0.3) continue;
      const c = world.cellAt(i, j);
      if (!c) continue;
      world.setCell(i, j, { type: 'park' });
      cells.push({ i, j });
    }
  }
  api.populatePark(cells);
}

// Camera presets: registered as `ctx.cameraPresets.register(name, fn)` by the module loader and invoked later
// as `fn(world)` (core/camera.js CameraPresets.get) — no ctx access here, so use the cached road offset above.
export const PRESETS = {
  'props:default': (world) => {
    const y = world.getHeight(-10, 0);
    return { pos: [-64, y + 9, 34], target: [46, y + 2.4, -6], fov: 52 };
  },
  'props:closeup': (world) => {
    const y = world.getHeight(42, 8);
    return { pos: [24, y + 3.4, 22], target: [44, y + 3.4, 4], fov: 40 };
  },
  'props:park': (world) => {
    const y = world.getHeight(0, 0);
    return { pos: [34, y + 26, 42], target: [0, y + 1.5, 0], fov: 48 };
  },
};
