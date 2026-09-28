// Showcase staging: 'default'/'night' build a small one-block street *network* — two parallel through streets
// (front + back of the block) joined by two cross-streets — forming four real T intersections with no dead-end
// cul-de-sac bulbs anywhere near the camera, then furnish it with the module's own auto-population algorithm at
// real density — the same populateAlongRoad()/populateIntersectionNode() the full game uses on every road it
// builds — plus a handful of repeated hand-placed set-pieces (trees, hedge runs, flower beds, hydrant, bus stops)
// so every kind the module renders is on display without the demo reading as a sparse "one of each" strip.
// 'park' builds a small park and populates it via the public API.
// 'yards' (LOOP cycle 2) builds a suburban block: two parallel streets with a cross street, ~19 real lots
// (houses/apartments/shops + a school and a fire department) whose yard dressing, civic clusters and sidewalk
// pedestrians are placed by the module's own C2 pass on building:spawned.
import { dirToRot } from './geo.js';
import { populateIntersectionNode } from './populate.js';

export const ROAD = { half: 84 };          // both through streets span x = -84..84 (168 m)
export const CROSS_X = [-42, 42];          // two cross-streets joining them
export const BLOCK_DEPTH = 56;             // distance between the front (z=0) and back (z=56) through streets
export const PARK = { half: 4 };           // cell radius (8 m cells) -> ~72x72 m park

// 'yards' block geometry (world metres, relative to the block origin below). The whole block sits inside one
// buildings-batcher chunk (CHUNK_CELLS 128 -> the quarter of the map at cells i,j < 128), so the module batch
// pays one chunk's worth of building draw calls, not four. Four lot rows (two per street band, x-staggered so
// the 8 m inter-lot gaps are covered by the next row) fill the block: no empty field in the middle distance.
const YARDS = {
  ox: -150, oz: -180,    // block origin: dry/flat quadrant near the map centre, entirely i,j < 128
  streets: [0, 48],      // E-W streets; lots face +z, so the north band faces z=0 and the south band z=48
  crossX: 0,             // one N-S cross street through both, forming T junctions
  rowsA: [{ z: 34, dx: 0 }, { z: 16, dx: 8 }],   // south band (fronts +z): street-front row + back row
  rowsB: [{ z: -14, dx: 0 }, { z: -32, dx: 8 }], // north band (fronts +z): street-front row + back row
  lotsA: [
    ['house', -76], ['school', -64], ['house', -44], ['apartment', -28], ['house', -12],
    ['shop', 12], ['house', 28], ['shop', 44], ['house', 60], ['house', 76],
  ],
  lotsB: [
    ['house', -76], ['house', -60], ['fire_department', -48], ['house', -28], ['apartment', -12],
    ['shop', 12], ['house', 28], ['house', 44], ['house', 60], ['house', 76],
  ],
  lotsBack: [-68, -52, -36, -20, 20, 36, 52, 68], // staggered back-row lots (houses), clear of the cross street
};

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

/** The module's original street scene (roads + auto density + hand-placed set-pieces). Split out of
 * stageStreet() so stageYards() can keep it staged at the origin alongside the suburban yards block — the
 * `props:*` presets other than `props:yards` then still frame a furnished street instead of empty terrain. */
function buildStreetBlock(ctx, api) {
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

  // Fix round issue 4: a short row of real lots on the north side of the front street, plus the sidewalks'
  // pedestrians, so the default/night batches exercise the C2 layer too (the yards variant stages the full
  // suburb). The lots are real building records — the buildings dep renders them and building:spawned dresses
  // their yards exactly as in the full game.
  const cs = world.cellSize;
  const lot = (kind, x, z) => {
    const zone = kind === 'shop' ? 'c' : 'r';
    const i = Math.round((x - world.minX) / cs - 0.5);
    const j = Math.round((z - world.minZ) / cs - 0.5);
    world.addBuilding({ i, j, w: 1, d: 1, zone, level: 1, kind, seed: 0 });
  };
  lot('shop', 14, -14);
  lot('house', 30, -14);
  lot('house', 46, -14);
  lot('house', 62, -14);
  for (const edgeId of [...throughEdges, ...crossEdges]) api.populatePedestrians(edgeId);
}

export function stageStreet(ctx, api) {
  ctx.world.clearContent();
  stagedScene = 'street';
  buildStreetBlock(ctx, api);
}

/**
 * LOOP cycle 2 'yards' variant: a suburban block — two parallel E-W streets joined by one N-S cross street,
 * with four x-staggered lot rows (10 + 10 menu lots + 8 + 8 back-row houses = 36 real building records, incl. a
 * school and a fire department). Every lot is dressed by the module's own C2 pass (building:spawned), and the
 * streets get the full street furniture + sidewalk pedestrians. Nothing here places yard props itself: the batch
 * therefore shows exactly what the full game produces around real buildings.
 */
export function stageYards(ctx, api) {
  ctx.world.clearContent();
  stagedScene = 'yards';
  const world = ctx.world;
  const cs = world.cellSize;
  const { ox, oz } = YARDS;
  const X = (x) => ox + x, Z = (z) => oz + z;
  const terrainApi = ctx.modules.get('terrain')?.status === 'ok' ? ctx.modules.get('terrain').api : null;
  const flattenRect = (x0, z0, x1, z1) => {
    if (!terrainApi?.flatten) return;
    const i0 = Math.floor((x0 - world.minX) / cs), i1 = Math.ceil((x1 - world.minX) / cs) - 1;
    const j0 = Math.floor((z0 - world.minZ) / cs), j1 = Math.ceil((z1 - world.minZ) / cs) - 1;
    terrainApi.flatten(i0, j0, i1, j1);
  };
  flattenRect(X(-104), Z(-64), X(104), Z(64));

  // Streets: two E-W through streets split at the cross street, plus the cross street itself (both T junction).
  const edges = [];
  for (const z of YARDS.streets) {
    edges.push(world.addRoad({ x: X(-96), z: Z(z) }, { x: X(YARDS.crossX), z: Z(z) }, 'street'));
    edges.push(world.addRoad({ x: X(YARDS.crossX), z: Z(z) }, { x: X(96), z: Z(z) }, 'street'));
  }
  edges.push(world.addRoad({ x: X(YARDS.crossX), z: Z(-48) }, { x: X(YARDS.crossX), z: Z(48) }, 'street'));
  const offset = roadOffset(ctx);

  // Street furniture + sidewalk pedestrians for every edge (the full game's own algorithms).
  for (const edgeId of edges) {
    api.populateAlongRoad(edgeId);
    api.populatePedestrians(edgeId);
  }
  const roadsApi = ctx.modules.get('roads')?.status === 'ok' ? ctx.modules.get('roads').api : null;
  if (roadsApi) {
    const lightRng = ctx.rng.fork('props-showcase-lights');
    for (const node of roadsApi.getIntersections()) {
      if (node.arms.length >= 3) populateIntersectionNode(ctx, api.addProp, lightRng, roadsApi, node);
    }
  }

  // Lots: buildings are real records; the C2 yard/civic pass triggers on building:spawned. Four rows: the two
  // menu rows (kind variety: houses/apartments/shops + a school and a fire department) and two staggered
  // all-house rows backing onto them, so the block is fully built out.
  const lot = (spec, z, dx = 0) => {
    const [kind, x0] = spec;
    const x = x0 + dx;
    const w = kind === 'school' || kind === 'fire_department' ? 2 : 1;
    const d = w;
    const zone = kind === 'shop' ? 'c' : kind === 'apartment' ? 'r' : kind === 'house' ? 'r' : null;
    const level = kind === 'apartment' ? 2 : 1;
    const i = Math.round((X(x) - world.minX) / cs - w / 2);
    const j = Math.round((Z(z) - world.minZ) / cs - d / 2);
    world.addBuilding({ i, j, w, d, zone, level, kind, seed: 0 });
  };
  for (const spec of YARDS.lotsA) lot(spec, YARDS.rowsA[0].z, YARDS.rowsA[0].dx);
  for (const spec of YARDS.lotsB) lot(spec, YARDS.rowsB[0].z, YARDS.rowsB[0].dx);
  for (const x of YARDS.lotsBack) {
    lot(['house', x], YARDS.rowsA[1].z, YARDS.rowsA[1].dx);
    lot(['house', x], YARDS.rowsB[1].z, YARDS.rowsB[1].dx);
  }

  // A few street trees so the block reads as a real suburb from the aerial (the yards pass owns the small stuff).
  const streetProp = (kind, x, side, extra) => api.addProp(kind, X(x), Z(0) + side * (offset + extra), dirToRot(0, -side));
  const trees = [['tree_medium', -60, 1, 3.2], ['tree_small', -20, -1, 3.2], ['tree_large', 20, 1, 4.2], ['tree_medium', 68, -1, 3.2]];
  for (const [kind, x, side, extra] of trees) streetProp(kind, x, side, extra);
  streetProp('bus_stop', -84, -1, 0.9);
  streetProp('bus_stop', 84, 1, 0.9);
  streetProp('hydrant', -36, 1, 0.5);

  // Keep the module's original street scene staged at the origin too: the other `props:*` presets (default/
  // closeup/park) then still frame a furnished street in this variant instead of an empty field.
  buildStreetBlock(ctx, api);
}

export function stagePark(ctx, api) {
  ctx.world.clearContent();
  stagedScene = 'park';
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
  // Fix round issue 4: C2 evidence in the park variant too — picnic sets on the lawn, bikes by the path and a
  // few more people, placed through the C2 placer so they never overlap the park furniture (no lots to dress).
  const spots = [
    ['picnic_table', -16, 9, 0.5], ['picnic_table', -11, 15, 2.1], ['picnic_table', 13, 13, 3.2],
    ['bike', 7, -13, 1.57], ['bike', 10, -10, -1.57], ['bike', -13, -11, 0.2],
    ['figure', -15, 7, 0.4], ['figure', -13, 11, 2.6], ['figure', -12, 16, 1.1],
    ['figure', 8, -12, 1.2], ['figure', 11, -9, -0.6], ['figure', 14, 12, 0.9],
    ['figure', -9, 6, 2.2], ['figure', 2, 13, 3.1],
  ];
  for (const [kind, x, z, rot] of spots) {
    if (api.canPlace(kind, x, z)) api.addProp(kind, x, z, rot);
  }
}

// Camera presets: registered as `ctx.cameraPresets.register(name, fn)` by the module loader and invoked later
// as `fn(world)` (core/camera.js CameraPresets.get) — no ctx access here, so use the cached road offset above.
// `stagedScene` (set by the stage functions) lets `props:yards` frame the C2 dressing the *current* variant
// actually staged; it never falls back to a preset that would show empty terrain (fix round issue 4).
let stagedScene = 'street';

export const PRESETS = {
  'props:default': (world) => {
    const y = world.getHeight(-10, 0);
    return { pos: [-64, y + 9, 34], target: [46, y + 2.4, -6], fov: 52 };
  },
  'props:closeup': (world) => {
    // The street staging's north-side lot row (fix round issue 4): dressed front yards with the avenue in frame.
    const y = world.getHeight(34, -4);
    return { pos: [26, y + 4.5, 2], target: [44, y + 1.4, -10], fov: 44 };
  },
  'props:park': (world) => {
    const y = world.getHeight(0, 0);
    return { pos: [34, y + 26, 42], target: [0, y + 1.5, 0], fov: 48 };
  },
  'props:yards': (world) => {
    if (stagedScene === 'yards') {
      // Oblique over the whole shifted yards block: house rows with fenced yards, gardens, laundry/picnic/crate
      // backs, sidewalk figures and the school + fire entrance clusters, at a distance where the dressing
      // pattern (not one prop) reads.
      const y = world.getHeight(-180, -168);
      return { pos: [-220, y + 16, -150], target: [-152, y + 0.5, -186], fov: 50 };
    }
    if (stagedScene === 'park') {
      // The park's C2 dressing: picnic sets on the lawn, bikes and people by the paths.
      const y = world.getHeight(0, 0);
      return { pos: [24, y + 9, 28], target: [-6, y + 1.4, -4], fov: 50 };
    }
    // Street staging: the front-yard row the street block now carries.
    const y = world.getHeight(20, 0);
    return { pos: [0, y + 9, 12], target: [40, y + 1.4, -14], fov: 48 };
  },
};
