// demo/citygen.js — deterministic layout + procedural seeding for the full-game demo city.
// Pure functions over ctx.world / ctx.modules; no THREE objects, no rendering. Everything here is a function of
// ctx.rng (forked once by index.js) and the terrain the `terrain` module already generated in its own init(), so
// the same seed always produces the same city.

// ---------------------------------------------------------------------------------------------------------------
// District layout (world meters, origin = map centre). The map is 256x256 cells @ 8 m = 2048x2048 m
// (minX/minZ = -1024). Chosen to sit on the terrain generator's known features (src/terrain/heightgen.js,
// 'default' variant): a flat plateau of radius ~260 m at the origin (downtown), a bay east of x~700, and a
// meandering river south of z~380 (worst case, across the x-range we use). Every district here stays north of the
// river and west of the bay/queries the bay at runtime, so no road ever has to bridge water.

export const DOWNTOWN_X = [-200, -100, 0, 100, 200];
export const DOWNTOWN_Z = [-200, -100, 0, 100, 200];

export const INDUSTRIAL_X = [-620, -480, -340, -200];
export const INDUSTRIAL_Z = [-160, 0, 160];

// Reuses DOWNTOWN_Z exactly so every row lines up with a real downtown node (5 connectors, no extra bookkeeping).
export const WATERFRONT_Z = DOWNTOWN_Z;
// WATERFRONT_X's last line is decided at runtime from the real coastline (see buildWaterfront).

export const SUBURB_X = [-600, -400, -200, 0, 200, 400, 600];
export const SUBURB_Z = [-560, -410, -220]; // row0 shared with the highway, row2 fixed for district connectors

export const HIGHWAY_Z = -560;
export const HIGHWAY_X = [-820, ...SUBURB_X, 650];

// ---------------------------------------------------------------------------------------------------------------
// Generic helpers

function clampRect(a, b) { return a <= b ? [a, b] : [b, a]; }

/** World-meter rect -> inclusive cell rect, clamped to the map. */
export function cellRectFromWorld(world, x0, z0, x1, z1) {
  [x0, x1] = clampRect(x0, x1);
  [z0, z1] = clampRect(z0, z1);
  const a = world.worldToCell(x0 + 0.01, z0 + 0.01);
  const b = world.worldToCell(x1 - 0.01, z1 - 0.01);
  const W = world.size.w, H = world.size.h;
  return {
    i0: Math.max(0, Math.min(a.i, b.i)), j0: Math.max(0, Math.min(a.j, b.j)),
    i1: Math.min(W - 1, Math.max(a.i, b.i)), j1: Math.min(H - 1, Math.max(a.j, b.j)),
  };
}

/**
 * Build a full grid of roads from xLines x zLines: vertical roads along each x line connecting consecutive z
 * lines, horizontal roads along each z line connecting consecutive x lines. Every intersection shares one real
 * node (same world coordinate), so the network is properly connected — no crossing-without-a-node bugs.
 * kindFn(lineValue) decides the road kind for both axes (used so a single x=0 / z=0 "spine" rule works for both).
 * `jitter` (metres) randomly offsets interior nodes (via `rng`) for a looser, curvier suburban feel; fixedRows/
 * fixedCols (line indices) are never jittered — used to keep the rows/cols that other districts connect to exact.
 */
export function buildGrid(world, xLines, zLines, kindFn, opts = {}) {
  const { jitter = 0, rng = null, fixedRows = new Set(), fixedCols = new Set() } = opts;
  const nx = xLines.length, nz = zLines.length;
  const pos = [];
  for (let a = 0; a < nx; a++) {
    const col = [];
    for (let b = 0; b < nz; b++) {
      let x = xLines[a], z = zLines[b];
      if (jitter > 0 && rng && !fixedCols.has(a) && !fixedRows.has(b)) {
        x += rng.range(-jitter, jitter);
        z += rng.range(-jitter, jitter);
      }
      col.push({ x, z });
    }
    pos.push(col);
  }
  const edges = [];
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz - 1; b++) {
      const id = world.addRoad(pos[a][b], pos[a][b + 1], kindFn(xLines[a]));
      if (id) edges.push(id);
    }
  }
  for (let b = 0; b < nz; b++) {
    for (let a = 0; a < nx - 1; a++) {
      const id = world.addRoad(pos[a][b], pos[a + 1][b], kindFn(zLines[b]));
      if (id) edges.push(id);
    }
  }
  return { pos, edges };
}

const spineKind = (v) => (Math.abs(v) < 0.01 ? 'avenue' : 'street');

/** Inset [xLines[a]..xLines[a+1]] x [zLines[b]..zLines[b+1]] by `margin` (road+sidewalk clearance). */
function blockRect(xLines, zLines, a, b, margin) {
  return { x0: xLines[a] + margin, z0: zLines[b] + margin, x1: xLines[a + 1] - margin, z1: zLines[b + 1] - margin };
}

/**
 * Zone a rectangle and tile it with buildings of the given zone/level, skipping any cell the road network already
 * claimed (setZoneRect silently skips non-zonable cells) and any footprint that lands on non-buildable terrain
 * (skipped via terrain.api.isBuildable) or that a previous building/park already covers. `gap` (cells) leaves
 * yard/plaza space between buildings; `fillChance` (0-1) thins the lot out for a less uniform, more organic block.
 */
function fillBlock(ctx, rng, rect, zone, level, opts = {}) {
  const { world, modules } = ctx;
  const zoningApi = modules.get('zoning').api;
  const buildingsApi = modules.get('buildings').api;
  const terrainApi = modules.get('terrain')?.api;
  const r = cellRectFromWorld(world, rect.x0, rect.z0, rect.x1, rect.z1);
  if (r.i1 < r.i0 || r.j1 < r.j0) return { cells: 0, buildings: 0 };
  const zres = zoningApi.setZoneRect(r.i0, r.j0, r.i1, r.j1, zone, level);
  const fp = buildingsApi.getFootprint(zone, level);
  const gap = opts.gap ?? 1;
  const pitchI = fp.w + gap, pitchJ = fp.d + gap;
  const fillChance = opts.fillChance ?? 1;
  let count = 0;
  for (let j = r.j0; j + fp.d - 1 <= r.j1; j += pitchJ) {
    for (let i = r.i0; i + fp.w - 1 <= r.i1; i += pitchI) {
      if (fillChance < 1 && !rng.chance(fillChance)) continue;
      let ok = true;
      for (let jj = j; jj < j + fp.d && ok; jj++) {
        for (let ii = i; ii < i + fp.w && ok; ii++) {
          const c = world.cellAt(ii, jj);
          if (!c || c.type !== 'zone' || c.zone !== zone) ok = false;
          else if (terrainApi && !terrainApi.isBuildable(ii, jj)) ok = false;
        }
      }
      if (!ok) continue;
      world.addBuilding({ i, j, w: fp.w, d: fp.d, zone, level, seed: rng.int(0, 1e9) });
      count++;
    }
  }
  return { cells: zres.cells, buildings: count };
}

/** Stamp a park over every 'none' cell in a rect (never overwrites roads/water/zoned/built cells). */
function setParkRect(world, x0, z0, x1, z1) {
  const r = cellRectFromWorld(world, x0, z0, x1, z1);
  let n = 0;
  for (let j = r.j0; j <= r.j1; j++) {
    for (let i = r.i0; i <= r.i1; i++) {
      const c = world.cellAt(i, j);
      if (c && c.type === 'none') { world.setCell(i, j, { type: 'park' }); n++; }
    }
  }
  return { rect: r, cells: n };
}

/** A small plus-shaped pedestrian path crossing at the centre of a rect, for parks. */
function addPlusPath(world, x0, z0, x1, z1) {
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  world.addRoad({ x: x0, z: cz }, { x: cx, z: cz }, 'path');
  world.addRoad({ x: cx, z: cz }, { x: x1, z: cz }, 'path');
  world.addRoad({ x: cx, z: z0 }, { x: cx, z: cz }, 'path');
  world.addRoad({ x: cx, z: cz }, { x: cx, z: z1 }, 'path');
}

/** First x (stepping from xFrom to xTo) at row z whose cell is water; null if none found. */
function findCoastX(world, z, xFrom, xTo, step) {
  for (let x = xFrom; x <= xTo; x += step) {
    const c = world.cellAtWorld(x, z);
    if (c && c.type === 'water') return x;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Districts

function buildHighway(ctx) {
  const { pos, edges } = buildGrid(ctx.world, HIGHWAY_X, [HIGHWAY_Z], () => 'highway');
  return { pos, edges };
}

function buildDowntown(ctx, rng) {
  const world = ctx.world;
  buildGrid(world, DOWNTOWN_X, DOWNTOWN_Z, spineKind);
  const MARGIN = 10;
  let buildings = 0;
  let parkCells = 0;
  for (let a = 0; a < DOWNTOWN_X.length - 1; a++) {
    for (let b = 0; b < DOWNTOWN_Z.length - 1; b++) {
      const rect = blockRect(DOWNTOWN_X, DOWNTOWN_Z, a, b, MARGIN);
      if (a === 1 && b === 1) { // Central Park — right where the two avenues cross
        const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2, S2 = 36;
        parkCells += setParkRect(world, cx - S2, cz - S2, cx + S2, cz + S2).cells;
        addPlusPath(world, cx - S2, cz - S2, cx + S2, cz + S2);
        continue;
      }
      const zone = (a + b) % 2 === 0 ? 'c' : 'r';
      // One signature tower block (the other inner block besides the park) stays level 3; everything else in
      // downtown is level 2 — keeps a real skyline peak without every block paying a level-3 tower's triangle cost.
      const level = (a === 2 && b === 1) ? 3 : 2;
      buildings += fillBlock(ctx, rng, rect, zone, level, { gap: 3 }).buildings;
    }
  }
  return { buildings, parkCells };
}

function buildIndustrial(ctx, rng) {
  const world = ctx.world, terrainApi = ctx.modules.get('terrain').api;
  // Real industrial land is graded flat — flatten the whole district pad once before zoning/building it (this
  // area sits well off the downtown plateau, in the rolling-plains + hill-noise zone per heightgen.js).
  const r = cellRectFromWorld(world, INDUSTRIAL_X[0], INDUSTRIAL_Z[0], INDUSTRIAL_X[INDUSTRIAL_X.length - 1], INDUSTRIAL_Z[INDUSTRIAL_Z.length - 1]);
  terrainApi.flatten(r.i0, r.j0, r.i1, r.j1);
  buildGrid(world, INDUSTRIAL_X, INDUSTRIAL_Z, spineKind);
  const MARGIN = 10;
  let buildings = 0;
  for (let a = 0; a < INDUSTRIAL_X.length - 1; a++) {
    for (let b = 0; b < INDUSTRIAL_Z.length - 1; b++) {
      const rect = blockRect(INDUSTRIAL_X, INDUSTRIAL_Z, a, b, MARGIN);
      const level = (a + b) % 2 === 0 ? 1 : 2;
      buildings += fillBlock(ctx, rng, rect, 'i', level, { gap: 4 }).buildings;
    }
  }
  return { buildings };
}

function buildWaterfront(ctx, rng) {
  const world = ctx.world;
  const coastXs = WATERFRONT_Z.map((z) => findCoastX(world, z, 480, 980, 8) ?? 900);
  const minCoast = Math.min(...coastXs);
  const wfLast = Math.max(560, Math.min(620, minCoast - 40));
  const WATERFRONT_X = [340, 480, wfLast];

  buildGrid(world, WATERFRONT_X, WATERFRONT_Z, spineKind);
  // Connectors into downtown's east edge (x=200) — every downtown z-line has a matching waterfront z-line.
  for (const z of DOWNTOWN_Z) world.addRoad({ x: 200, z }, { x: 340, z }, spineKind(z));

  const MARGIN = 10;
  let buildings = 0, parkCells = 0;
  for (let a = 0; a < WATERFRONT_X.length - 1; a++) {
    for (let b = 0; b < WATERFRONT_Z.length - 1; b++) {
      const rect = blockRect(WATERFRONT_X, WATERFRONT_Z, a, b, MARGIN);
      if (a === 0 && b === 0) { // Waterfront Park — north end, by the coast
        const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2, S2 = 28;
        parkCells += setParkRect(world, cx - S2, cz - S2, cx + S2, cz + S2).cells;
        addPlusPath(world, cx - S2, cz - S2, cx + S2, cz + S2);
        continue;
      }
      const zone = (a + b) % 2 === 0 ? 'c' : 'r';
      buildings += fillBlock(ctx, rng, rect, zone, 2, { gap: 3 }).buildings;
    }
  }

  // Promenade path along the actual coastline, one point per row, clamped to stay on the built district.
  const pts = WATERFRONT_Z.map((z, idx) => ({
    x: Math.max(wfLast - 10, Math.min(coastXs[idx] - 20, wfLast + 60)), z,
  }));
  for (let k = 0; k < pts.length - 1; k++) world.addRoad(pts[k], pts[k + 1], 'path');

  return { buildings, parkCells, coastXs };
}

function buildSuburb(ctx, rng) {
  const world = ctx.world;
  const gridRng = rng.fork('suburbJitter');
  buildGrid(world, SUBURB_X, SUBURB_Z, spineKind, {
    jitter: 22, rng: gridRng, fixedRows: new Set([0, 2]), fixedCols: new Set(),
  });

  // Two neighbourhood parks, spread across the district — a fixed small footprint (not a whole grid block, which
  // at this block size would be several hectares of tree/hedge props) centred inside two chosen blocks; the rest
  // of those blocks is left as open, unzoned green space rather than double-built.
  const PARK_BLOCKS = new Set(['1,0', '4,1']);
  const PARK_SIZE = 56;
  const MARGIN = 10;
  let buildings = 0, parkCells = 0;
  for (let a = 0; a < SUBURB_X.length - 1; a++) {
    for (let b = 0; b < SUBURB_Z.length - 1; b++) {
      const rect = blockRect(SUBURB_X, SUBURB_Z, a, b, MARGIN);
      if (PARK_BLOCKS.has(`${a},${b}`)) {
        const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
        const px0 = cx - PARK_SIZE / 2, pz0 = cz - PARK_SIZE / 2, px1 = cx + PARK_SIZE / 2, pz1 = cz + PARK_SIZE / 2;
        parkCells += setParkRect(world, px0, pz0, px1, pz1).cells;
        addPlusPath(world, px0, pz0, px1, pz1);
        continue;
      }
      const level = rng.chance(0.15) ? 2 : 1;
      buildings += fillBlock(ctx, rng, rect, 'r', level, { gap: 4, fillChance: 0.32 }).buildings;
    }
  }
  return { buildings, parkCells };
}

function connectDistricts(ctx) {
  const world = ctx.world;
  // Downtown <-> suburb: continue the x=0 avenue spine north.
  world.addRoad({ x: 0, z: -200 }, { x: 0, z: -220 }, 'avenue');
  // Industrial <-> suburb.
  world.addRoad({ x: -480, z: -160 }, { x: -480, z: -220 }, 'street');
  // (Industrial <-> downtown and downtown <-> waterfront already share nodes on the z=0 spine / the waterfront
  // connector loop above — see buildIndustrial/buildWaterfront/buildDowntown, all built on the same DOWNTOWN_X /
  // INDUSTRIAL_X / WATERFRONT_X coordinate space.)
}

// ---------------------------------------------------------------------------------------------------------------
/** Build the whole demo city once. Deterministic: every random choice comes from `rng` (already forked by the
 * caller), and every layout coordinate is a fixed constant or a runtime terrain/coastline query — never Math.random
 * or wall-clock. Returns a stats summary for the builder report. */
export function buildCity(ctx, rng) {
  const highway = buildHighway(ctx);
  const downtown = buildDowntown(ctx, rng.fork('downtown'));
  const industrial = buildIndustrial(ctx, rng.fork('industrial'));
  const waterfront = buildWaterfront(ctx, rng.fork('waterfront'));
  const suburb = buildSuburb(ctx, rng.fork('suburb'));
  connectDistricts(ctx);

  const roadEdges = ctx.world.roads.edges.size;
  const totalBuildings = ctx.world.buildings.size;
  const totalParkCells = downtown.parkCells + waterfront.parkCells + suburb.parkCells;

  return {
    highwayEdges: highway.edges.length,
    downtown, industrial, waterfront, suburb,
    roadEdges, totalBuildings, totalParkCells,
  };
}

/** A small representative slice for `?showcase=demo` — downtown only (see index.js's showcase()). */
export function buildDowntownOnly(ctx, rng) {
  return buildDowntown(ctx, rng.fork('downtown'));
}
