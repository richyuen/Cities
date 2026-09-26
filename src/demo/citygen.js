// demo/citygen.js — deterministic layout + procedural seeding for the full-game demo city.
// Pure functions over ctx.world / ctx.modules; no THREE objects, no rendering. Everything here is a function of
// ctx.rng (forked once by index.js) and the terrain the `terrain` module already generated in its own init(), so
// the same seed always produces the same city.
//
// Layout philosophy (Wave B5/G8 pass): every district is a real grid, the four districts are stitched into one
// network (highway ↔ avenue interchange included), and utilities are sited from *coverage lattices* instead of
// one pair per block — see placeUtilities(). Density and per-block variety are deterministic rng forks.

import { WATER_RADIUS, POWER_RADIUS } from '../simulation/model.js';

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
// Wave B5: the old -560/-410/-220 rows left 150-190 m deep blocks; an interior -300 row subdivides them so the
// lot pitch is ~100 m (r1 fix 2). Rows 0 and 3 stay fixed because the highway and the district connectors land
// on them; interior nodes still jitter for a looser suburban feel.
export const SUBURB_Z = [-560, -410, -300, -220];

export const HIGHWAY_Z = -560;
// -480 is the interchange node: the industrial avenue crosses the highway there (see buildInterchange).
export const HIGHWAY_X = [-820, -600, -480, -400, -200, 0, 200, 400, 600, 650];

/** Industrial avenue: highway ↔ suburb ↔ industrial pad, all on one continuous spine (r1 fix 4). */
export const INDUSTRIAL_SPINE_X = -480;

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

/** Index of the block (line pair) that contains `v` along one axis. */
function blockIndex(lines, v) {
  for (let k = 0; k < lines.length - 1; k++) if (v >= lines[k] && v <= lines[k + 1]) return k;
  return v < lines[0] ? 0 : lines.length - 2;
}

/** A single thin 'path' alley spanning cells [i0..i1] at row j (see fillBlock). Always non-zero length, even for a
 * single-cell span, since it's built from the outer edges of the end cells rather than their centres. */
function addAlleySegment(world, i0, i1, j) {
  if (i1 < i0) return;
  const cs = world.cellSize;
  const z = world.cellToWorld(0, j).z;
  const xA = world.cellToWorld(i0, j).x - cs / 2;
  const xB = world.cellToWorld(i1, j).x + cs / 2;
  world.addRoad({ x: xA, z }, { x: xB, z }, 'path');
}

/** Pave row j from i0..i1 with alley segments, one per maximal run of still-'none' cells — anything else in that
 * row (most commonly a utility building sited into this same block just before fillBlock ran) is left alone rather
 * than paved over. A naive single segment spanning the utility's bounding box would skip real, still-empty land
 * between two utilities that don't sit flush against each other (e.g. a water tower offset a few cells from its
 * paired power plant), silently leaving whatever building later fills that land without its road alley. */
function paveAlleyRow(world, i0, i1, j) {
  let runStart = -1;
  for (let i = i0; i <= i1; i++) {
    const c = world.cellAt(i, j);
    const free = !!c && c.type === 'none';
    if (free && runStart < 0) runStart = i;
    if (!free && runStart >= 0) { addAlleySegment(world, runStart, i - 1, j); runStart = -1; }
  }
  if (runStart >= 0) addAlleySegment(world, runStart, i1, j);
}

/**
 * Zone a rectangle and tile it with buildings of the given zone/level, skipping any cell the road network already
 * claimed (setZoneRect silently skips non-zonable cells) and any footprint that lands on non-buildable terrain
 * (skipped via terrain.api.isBuildable) or that a previous building/park already covers. `gap` (cells) leaves
 * yard/plaza space between buildings; `fillChance` (0-1) thins the lot out for a less uniform, more organic block;
 * `stagger` (cells) shifts odd lot rows sideways so neighbouring blocks do not line up into long identical rows.
 *
 * Every row of lots also gets a thin interior 'path' alley immediately on its near side, before the rect is even
 * zoned — without it, only a block's outermost lots would ever end up within the game's road-adjacency rule
 * (SimModel._roadConnectedFor requires a footprint cell to orthogonally touch a 'road' cell); any lot one or more
 * rows deep would be permanently "unserved" for roads no matter its power/water status, regardless of block depth
 * or how the outer margin happens to round against the cell grid. Any cell in that row already claimed by a
 * utility building sited into this same block just before this call (see placeUtilities) is left untouched —
 * paveAlleyRow only paves cells still of type 'none'. Each row gets an alley on *both* its near and far side (not
 * just one) so a utility footprint tall enough to blank out one side's alley at that row's exact columns (it can
 * span 2-3 rows, versus a typical 1-row-deep lot) doesn't strand that lot with no road access at all — the other
 * side is a different row and very rarely blocked by the same obstruction.
 */
function fillBlock(ctx, rng, rect, zone, level, opts = {}) {
  const { world, modules } = ctx;
  const zoningApi = modules.get('zoning').api;
  const buildingsApi = modules.get('buildings').api;
  const terrainApi = modules.get('terrain')?.api;
  const r = cellRectFromWorld(world, rect.x0, rect.z0, rect.x1, rect.z1);
  if (r.i1 < r.i0 || r.j1 < r.j0) return { cells: 0, buildings: 0 };
  const fp = buildingsApi.getFootprint(zone, level);
  const gap = opts.gap ?? 1;
  const pitchI = fp.w + gap, pitchJ = fp.d + gap;
  const stagger = opts.stagger ?? 0;

  for (let j = r.j0; j + fp.d - 1 <= r.j1; j += pitchJ) {
    const nearJ = j - 1, farJ = j + fp.d;
    if (nearJ >= 0) paveAlleyRow(world, r.i0, r.i1, nearJ);
    if (farJ <= r.j1) paveAlleyRow(world, r.i0, r.i1, farJ);
  }

  const zres = zoningApi.setZoneRect(r.i0, r.j0, r.i1, r.j1, zone, level);
  const fillChance = opts.fillChance ?? 1;
  let count = 0;
  let row = 0;
  for (let j = r.j0; j + fp.d - 1 <= r.j1; j += pitchJ, row++) {
    const iStart = r.i0 + (stagger && (row & 1) ? stagger : 0);
    for (let i = iStart; i + fp.w - 1 <= r.i1; i += pitchI) {
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

/**
 * Zone a shallow fringe rect and drop sparse level-1 buildings along its long axis (r1 fix 6: low-density fringe
 * along connector roads so districts stop reading as islands). No interior alleys: a fringe strip is 1-2 cells
 * deep and always abuts a connector road, so every lot is road-adjacent by construction. `isCovered(i, j)` (when
 * given) skips lots the placed utilities cannot power *and* water — a ribbon between two districts has no
 * service of its own, and an unserved house would show a warning marker forever.
 */
function fillStrip(ctx, rng, rect, zone, level, opts = {}) {
  const { world, modules } = ctx;
  const zoningApi = modules.get('zoning').api;
  const buildingsApi = modules.get('buildings').api;
  const terrainApi = modules.get('terrain')?.api;
  const r = cellRectFromWorld(world, rect.x0, rect.z0, rect.x1, rect.z1);
  if (r.i1 < r.i0 || r.j1 < r.j0) return 0;
  const fp = buildingsApi.getFootprint(zone, level);
  const pitch = opts.pitch ?? fp.w + 4;
  const fillChance = opts.fillChance ?? 0.8;
  const vertical = opts.vertical ?? ((r.j1 - r.j0) > (r.i1 - r.i0));
  const isCovered = opts.isCovered;
  zoningApi.setZoneRect(r.i0, r.j0, r.i1, r.j1, zone, level);
  let count = 0;
  const tryLot = (i, j) => {
    if (isCovered && !isCovered(i, j)) return;
    if (!rng.chance(fillChance)) return;
    let ok = true;
    for (let jj = j; jj < j + fp.d && ok; jj++) {
      for (let ii = i; ii < i + fp.w && ok; ii++) {
        const c = world.cellAt(ii, jj);
        if (!c || c.type !== 'zone' || c.zone !== zone) ok = false;
        else if (terrainApi && !terrainApi.isBuildable(ii, jj)) ok = false;
      }
    }
    if (!ok) return;
    world.addBuilding({ i, j, w: fp.w, d: fp.d, zone, level, seed: rng.int(0, 1e9) });
    count++;
  };
  if (vertical) {
    for (let j = r.j0; j + fp.d - 1 <= r.j1; j += pitch) {
      for (let i = r.i0; i + fp.w - 1 <= r.i1; i += fp.w + 1) tryLot(i, j);
    }
  } else {
    for (let i = r.i0; i + fp.w - 1 <= r.i1; i += pitch) {
      for (let j = r.j0; j + fp.d - 1 <= r.j1; j += fp.d + 1) tryLot(i, j);
    }
  }
  return count;
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
// Utilities + services

function siteBuildable(ctx, i0, j0, w, d) {
  const world = ctx.world, terrainApi = ctx.modules.get('terrain')?.api;
  for (let j = j0; j < j0 + d; j++) {
    for (let i = i0; i < i0 + w; i++) {
      const c = world.cellAt(i, j);
      if (!c || c.type !== 'none') return false;
      if (terrainApi && !terrainApi.isBuildable(i, j)) return false;
    }
  }
  return true;
}

/** Nearest (Chebyshev-ring outward) empty, buildable w×d footprint to (ci,cj); null if none within maxRing. */
function findUtilitySite(ctx, ci, cj, w, d, maxRing = 8) {
  if (siteBuildable(ctx, ci, cj, w, d)) return { i: ci, j: cj };
  for (let ring = 1; ring <= maxRing; ring++) {
    for (let dj = -ring; dj <= ring; dj++) {
      for (let di = -ring; di <= ring; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue; // only the ring border, not its interior
        if (siteBuildable(ctx, ci + di, cj + dj, w, d)) return { i: ci + di, j: cj + dj };
      }
    }
  }
  return null;
}

/**
 * Coverage-lattice anchors for one axis: ceil(span / (2*radius)) positions centred in equal tiles, so the union
 * of the tiles' ±radius squares covers [lo, hi] exactly (step = span/n ≤ 2*radius by construction). These are the
 * minimum number of sources that can blanket the district at this radius; siting them per *block* (the old
 * one-pair-per-block scheme) is what made the city read as a utility cadence (r1 fix 3).
 */
function coverageAnchors(lo, hi, radiusM) {
  const span = Math.max(1, hi - lo);
  const n = Math.max(1, Math.ceil(span / (2 * radiusM)));
  const out = [];
  for (let k = 0; k < n; k++) out.push(lo + (k + 0.5) * (span / n));
  return out;
}

/**
 * Site a district's power plants and water towers on their own coverage lattices (one lattice per service, since
 * POWER_RADIUS > WATER_RADIUS), decoupled from the block grid: the water tower goes to the nearest free,
 * buildable spot at its anchor; the (larger, industrial-looking) power plant tries the corners of whatever block
 * the anchor lands in first, so plants sit on block frontages/edges instead of block centres (r1 fix 3). Returns
 * counts for the builder log.
 */
function placeUtilities(ctx, spec) {
  const world = ctx.world;
  const cs = world.cellSize;
  const counts = { power: 0, water: 0 };
  const stated = (kind, w, d, x, z, cornerMax = 0) => {
    const a = blockIndex(spec.xLines, x), b = blockIndex(spec.zLines, z);
    const rect = blockRect(spec.xLines, spec.zLines, a, b, 10);
    const br = cellRectFromWorld(world, rect.x0, rect.z0, rect.x1, rect.z1);
    const centre = world.worldToCell(x, z);
    const starts = [[centre.i - (w >> 1), centre.j - (d >> 1)]];
    if (cornerMax > 0) {
      // The (larger, industrial-looking) power plant prefers a block corner over the anchor's exact spot —
      // r1 fix 3, "site power on frontages/edges" — but only when that corner is close enough to keep the
      // coverage lattice honest (a far corner would leave the anchor's own quarter unserved).
      const corners = [
        [br.i0 + 1, br.j0 + 1],
        [br.i1 - w - 1, br.j0 + 1],
        [br.i0 + 1, br.j1 - d - 1],
        [br.i1 - w - 1, br.j1 - d - 1],
      ];
      corners.sort((p, q) => (Math.hypot(p[0] - centre.i, p[1] - centre.j) - Math.hypot(q[0] - centre.i, q[1] - centre.j)) || (p[0] - q[0]) || (p[1] - q[1]));
      for (const [ci, cj] of corners) {
        if (Math.hypot(ci - centre.i, cj - centre.j) * cs <= cornerMax) starts.push([ci, cj]);
      }
    }
    for (const [ci, cj] of starts) {
      const site = findUtilitySite(ctx, ci, cj, w, d, 8);
      if (!site) continue;
      world.addBuilding({ i: site.i, j: site.j, w, d, zone: null, kind, level: 1 });
      return true;
    }
    return false;
  };
  const margin = spec.margin ?? 8;
  for (const z of coverageAnchors(spec.z0 + margin, spec.z1 - margin, POWER_RADIUS * cs)) {
    for (const x of coverageAnchors(spec.x0 + margin, spec.x1 - margin, POWER_RADIUS * cs)) {
      if (stated('power_plant', 3, 3, x, z, 48)) counts.power++;
    }
  }
  for (const z of coverageAnchors(spec.z0 + margin, spec.z1 - margin, WATER_RADIUS * cs)) {
    for (const x of coverageAnchors(spec.x0 + margin, spec.x1 - margin, WATER_RADIUS * cs)) {
      if (stated('water_tower', 2, 2, x, z, 0)) counts.water++;
    }
  }
  return counts;
}

/** Per district, pick five non-park blocks to host the civic services: the blocks whose centres sit closest to
 * the district's block-grid centre (row-major scan, first minimum wins), each next pick excluding the previous
 * ones. Two of the five are schools (education coverage has to blanket a district before level-3 growth opens
 * up) and one is a hospital. */
function pickServiceBlocks(nx, nz, isParkFn) {
  const out = [];
  for (let pick = 0; pick < 5; pick++) {
    let best = null;
    for (let a = 0; a < nx; a++) {
      for (let b = 0; b < nz; b++) {
        const key = `${a},${b}`;
        if (isParkFn(a, b) || out.includes(key)) continue;
        const d = Math.max(Math.abs(a + 0.5 - nx / 2), Math.abs(b + 0.5 - nz / 2));
        if (!best || d < best.d) best = { key, d };
      }
    }
    if (best) out.push(best.key);
  }
  return {
    fire: new Set(out.slice(0, 1)), police: new Set(out.slice(1, 2)),
    school: new Set(out.slice(2, 4)), hospital: new Set(out.slice(4, 5)),
  };
}

/**
 * Site one 2x2 civic service building (fire_department / police_station) into a block. Searched from the block's
 * NW corner, then its SE corner, then the centre, so a station lands on the block frontage instead of fighting
 * the centred utilities for the middle. The bounded ring keeps a station from drifting into the neighbouring
 * block; returns 1 if placed, 0 if the block genuinely had no free buildable spot (visible in the builder log
 * rather than silently missing).
 */
function placeServiceBuilding(ctx, rect, kind, w = 2, d = 2) {
  const world = ctx.world;
  const rc = cellRectFromWorld(world, rect.x0, rect.z0, rect.x1, rect.z1);
  const starts = [
    [rc.i0 + 1, rc.j0 + 1],
    [rc.i1 - 1, rc.j1 - 1],
    [Math.floor((rc.i0 + rc.i1) / 2), Math.floor((rc.j0 + rc.j1) / 2)],
  ];
  for (const [ci, cj] of starts) {
    const site = findUtilitySite(ctx, ci, cj, w, d, 3);
    if (!site) continue;
    world.addBuilding({ i: site.i, j: site.j, w, d, zone: null, kind, level: 1 });
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Districts

function buildHighway(ctx) {
  const { pos, edges } = buildGrid(ctx.world, HIGHWAY_X, [HIGHWAY_Z], () => 'highway');
  return { pos, edges };
}

/**
 * The highway is no longer an edge sticker (r1 fix 4): the industrial avenue (x=-480) runs from the highway
 * south through the suburb to the industrial pad, and a one-way diamond ramp pair connects the two, so the
 * highway visibly feeds the city and traffic can actually use it. Built before the districts so every later
 * grid crossing stitches into real junctions.
 */
function buildInterchange(ctx) {
  const world = ctx.world;
  const avenueEdges = [];
  const rows = [...SUBURB_Z, INDUSTRIAL_Z[0]]; // highway row -> suburb rows -> industrial pad edge
  for (let k = 1; k < rows.length; k++) {
    const id = world.addRoad({ x: INDUSTRIAL_SPINE_X, z: rows[k - 1] }, { x: INDUSTRIAL_SPINE_X, z: rows[k] }, 'avenue');
    if (id) avenueEdges.push(id);
  }
  const offRamp = world.addRoad({ x: -600, z: HIGHWAY_Z }, { x: INDUSTRIAL_SPINE_X, z: SUBURB_Z[1] }, 'street', { oneway: 1 });
  const onRamp = world.addRoad({ x: INDUSTRIAL_SPINE_X, z: SUBURB_Z[1] }, { x: -400, z: HIGHWAY_Z }, 'street', { oneway: 1 });
  return { avenueEdges, ramps: [offRamp, onRamp].filter(Boolean).length };
}

function buildDowntown(ctx, rng) {
  const world = ctx.world;
  buildGrid(world, DOWNTOWN_X, DOWNTOWN_Z, spineKind);
  const MARGIN = 10;
  const nx = DOWNTOWN_X.length - 1, nz = DOWNTOWN_Z.length - 1;
  const isPark = (a, b) => a === 1 && b === 1;
  // (2,1) stays out of the service picks so a 2x2 station doesn't displace the skyline's single level-3 tower.
  const svc = pickServiceBlocks(nx, nz, (a, b) => isPark(a, b) || (a === 2 && b === 1));
  let buildings = 0, parkCells = 0, fire = 0, police = 0, school = 0, hospital = 0;

  // Central Park — right where the two avenues cross.
  {
    const rect = blockRect(DOWNTOWN_X, DOWNTOWN_Z, 1, 1, MARGIN);
    const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2, S2 = 36;
    parkCells += setParkRect(world, cx - S2, cz - S2, cx + S2, cz + S2).cells;
    addPlusPath(world, cx - S2, cz - S2, cx + S2, cz + S2);
  }

  const u = placeUtilities(ctx, { xLines: DOWNTOWN_X, zLines: DOWNTOWN_Z, x0: DOWNTOWN_X[0], x1: DOWNTOWN_X[DOWNTOWN_X.length - 1], z0: DOWNTOWN_Z[0], z1: DOWNTOWN_Z[DOWNTOWN_Z.length - 1] });

  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const rect = blockRect(DOWNTOWN_X, DOWNTOWN_Z, a, b, MARGIN);
      if (isPark(a, b)) continue;
      if (svc.fire.has(`${a},${b}`)) fire += placeServiceBuilding(ctx, rect, 'fire_department');
      if (svc.police.has(`${a},${b}`)) police += placeServiceBuilding(ctx, rect, 'police_station');
      if (svc.school.has(`${a},${b}`)) school += placeServiceBuilding(ctx, rect, 'school');
      if (svc.hospital.has(`${a},${b}`)) hospital += placeServiceBuilding(ctx, rect, 'hospital');
      const zone = (a + b) % 2 === 0 ? 'c' : 'r';
      // One signature tower block (the other inner block besides the park) stays level 3; everything else in
      // downtown is level 2 — keeps a real skyline peak without every block paying a level-3 tower's triangle cost.
      const level = (a === 2 && b === 1) ? 3 : 2;
      buildings += fillBlock(ctx, rng, rect, zone, level, { gap: 3 }).buildings;
    }
  }
  return { buildings, parkCells, ...u, fire, police, school, hospital };
}

function buildIndustrial(ctx, rng) {
  const world = ctx.world, terrainApi = ctx.modules.get('terrain').api;
  // Real industrial land is graded flat — flatten the whole district pad once before zoning/building it (this
  // area sits well off the downtown plateau, in the rolling-plains + hill-noise zone per heightgen.js).
  const r = cellRectFromWorld(world, INDUSTRIAL_X[0], INDUSTRIAL_Z[0], INDUSTRIAL_X[INDUSTRIAL_X.length - 1], INDUSTRIAL_Z[INDUSTRIAL_Z.length - 1]);
  terrainApi.flatten(r.i0, r.j0, r.i1, r.j1);
  // The x=-480 line is the industrial avenue (highway ↔ suburb ↔ pad) — keep it an avenue through the district.
  buildGrid(world, INDUSTRIAL_X, INDUSTRIAL_Z, (v) => (v === INDUSTRIAL_SPINE_X || Math.abs(v) < 0.01 ? 'avenue' : 'street'));
  const MARGIN = 10;
  const nx = INDUSTRIAL_X.length - 1, nz = INDUSTRIAL_Z.length - 1;
  const svc = pickServiceBlocks(nx, nz, () => false);
  let buildings = 0, fire = 0, police = 0, school = 0, hospital = 0;

  const u = placeUtilities(ctx, { xLines: INDUSTRIAL_X, zLines: INDUSTRIAL_Z, x0: INDUSTRIAL_X[0], x1: INDUSTRIAL_X[INDUSTRIAL_X.length - 1], z0: INDUSTRIAL_Z[0], z1: INDUSTRIAL_Z[INDUSTRIAL_Z.length - 1] });

  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const rect = blockRect(INDUSTRIAL_X, INDUSTRIAL_Z, a, b, MARGIN);
      if (svc.fire.has(`${a},${b}`)) fire += placeServiceBuilding(ctx, rect, 'fire_department');
      if (svc.police.has(`${a},${b}`)) police += placeServiceBuilding(ctx, rect, 'police_station');
      if (svc.school.has(`${a},${b}`)) school += placeServiceBuilding(ctx, rect, 'school');
      if (svc.hospital.has(`${a},${b}`)) hospital += placeServiceBuilding(ctx, rect, 'hospital');
      const level = (a + b) % 2 === 0 ? 1 : 2;
      const gap = rng.chance(0.5) ? 4 : 5;
      buildings += fillBlock(ctx, rng, rect, 'i', level, { gap, stagger: rng.chance(0.5) ? gap : 0 }).buildings;
    }
  }
  return { buildings, ...u, fire, police, school, hospital };
}

function buildWaterfront(ctx, rng) {
  const world = ctx.world;
  const coastXs = WATERFRONT_Z.map((z) => findCoastX(world, z, 480, 980, 8) ?? 900);
  const minCoast = Math.min(...coastXs);
  // r1 fix 5: the built edge used to stop 68-148 m short of the water; land it ~30 m off the coast.
  const wfLast = Math.max(560, Math.min(minCoast - 30, minCoast - 20));
  const WATERFRONT_X = [340, 480, wfLast];

  buildGrid(world, WATERFRONT_X, WATERFRONT_Z, spineKind);
  // Connectors into downtown's east edge (x=200) — every downtown z-line has a matching waterfront z-line.
  for (const z of DOWNTOWN_Z) world.addRoad({ x: 200, z }, { x: 340, z }, spineKind(z));

  const MARGIN = 10;
  const nx = WATERFRONT_X.length - 1, nz = WATERFRONT_Z.length - 1;
  const isPark = (a, b) => a === 1 && b === 0;
  const svc = pickServiceBlocks(nx, nz, isPark);
  let buildings = 0, parkCells = 0, fire = 0, police = 0, school = 0, hospital = 0;

  // Waterfront Park — north end, by the coast.
  {
    const rect = blockRect(WATERFRONT_X, WATERFRONT_Z, 1, 0, MARGIN);
    const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2, S2 = 28;
    parkCells += setParkRect(world, cx - S2, cz - S2, cx + S2, cz + S2).cells;
    addPlusPath(world, cx - S2, cz - S2, cx + S2, cz + S2);
  }

  const u = placeUtilities(ctx, { xLines: WATERFRONT_X, zLines: WATERFRONT_Z, x0: WATERFRONT_X[0], x1: wfLast, z0: WATERFRONT_Z[0], z1: WATERFRONT_Z[WATERFRONT_Z.length - 1] });

  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const rect = blockRect(WATERFRONT_X, WATERFRONT_Z, a, b, MARGIN);
      if (isPark(a, b)) continue;
      if (svc.fire.has(`${a},${b}`)) fire += placeServiceBuilding(ctx, rect, 'fire_department');
      if (svc.police.has(`${a},${b}`)) police += placeServiceBuilding(ctx, rect, 'police_station');
      if (svc.school.has(`${a},${b}`)) school += placeServiceBuilding(ctx, rect, 'school');
      if (svc.hospital.has(`${a},${b}`)) hospital += placeServiceBuilding(ctx, rect, 'hospital');
      const zone = (a + b) % 2 === 0 ? 'c' : 'r';
      buildings += fillBlock(ctx, rng, rect, zone, 2, { gap: 3 }).buildings;
    }
  }

  // Esplanade: the land between the last building row and the water becomes a park strip (props populate it
  // with trees/benches/a fountain), and the promenade path runs through it close to the coastline.
  parkCells += setParkRect(world, wfLast + 2, -110, wfLast + 60, 110).cells;
  const pts = WATERFRONT_Z.map((z, idx) => ({
    x: Math.max(wfLast - 10, Math.min(coastXs[idx] - 18, wfLast + 60)), z,
  }));
  for (let k = 0; k < pts.length - 1; k++) world.addRoad(pts[k], pts[k + 1], 'path');

  // Pier: two bridge-decked path rails out over the bay plus a cross rail at the far end (paths never take
  // vehicles, so this is pure waterfront dressing). Anchored on the promenade node at the middle row.
  const pierIdx = Math.max(0, WATERFRONT_Z.indexOf(0));
  const pierBase = pts[pierIdx];
  const pierCoast = coastXs[pierIdx];
  const pierEnd = Math.max(pierCoast + 30, pierBase.x + 44);
  for (const dz of [-4, 4]) {
    world.addRoad({ x: pierBase.x, z: pierBase.z + dz }, { x: pierEnd, z: pierBase.z + dz }, 'path', { bridge: true });
  }
  world.addRoad({ x: pierEnd, z: pierBase.z - 4 }, { x: pierEnd, z: pierBase.z + 4 }, 'path', { bridge: true });

  return { buildings, parkCells, ...u, fire, police, school, hospital, coastXs, xLines: WATERFRONT_X, zLines: WATERFRONT_Z };
}

function buildSuburb(ctx, rng) {
  const world = ctx.world;
  const gridRng = rng.fork('suburbJitter');
  buildGrid(world, SUBURB_X, SUBURB_Z, spineKind, {
    jitter: 22, rng: gridRng, fixedRows: new Set([0, SUBURB_Z.length - 1]), fixedCols: new Set(),
  });

  // Neighbourhood parks (fixed small footprint centred in their block, rest of the block left open) plus one
  // plaza block on the x=0 avenue (r1 fix 6: a landmark the district can be read from).
  const PARK_BLOCKS = new Set(['1,0', '4,1']);
  const PLAZA_BLOCK = '2,1';
  const PARK_SIZE = 56, PLAZA_SIZE = 66;
  const MARGIN = 10;
  const nx = SUBURB_X.length - 1, nz = SUBURB_Z.length - 1;
  const isPark = (a, b) => PARK_BLOCKS.has(`${a},${b}`) || `${a},${b}` === PLAZA_BLOCK;
  let buildings = 0, parkCells = 0, fire = 0, police = 0, school = 0, hospital = 0;

  for (const key of [...PARK_BLOCKS, PLAZA_BLOCK]) {
    const [a, b] = key.split(',').map(Number);
    const rect = blockRect(SUBURB_X, SUBURB_Z, a, b, MARGIN);
    const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
    const size = key === PLAZA_BLOCK ? PLAZA_SIZE : PARK_SIZE;
    parkCells += setParkRect(world, cx - size / 2, cz - size / 2, cx + size / 2, cz + size / 2).cells;
    addPlusPath(world, cx - size / 2, cz - size / 2, cx + size / 2, cz + size / 2);
  }

  const u = placeUtilities(ctx, { xLines: SUBURB_X, zLines: SUBURB_Z, x0: SUBURB_X[0], x1: SUBURB_X[SUBURB_X.length - 1], z0: SUBURB_Z[0], z1: SUBURB_Z[SUBURB_Z.length - 1] });
  const svc = pickServiceBlocks(nx, nz, isPark);

  // Per-block deterministic variety (r1 fix 6): lot gap, fill chance, row stagger and level mix vary per block
  // from one dedicated fork, so no two blocks tile identically while the whole city stays a function of the seed.
  const variety = rng.fork('variety');
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const rect = blockRect(SUBURB_X, SUBURB_Z, a, b, MARGIN);
      if (isPark(a, b)) continue;
      if (svc.fire.has(`${a},${b}`)) fire += placeServiceBuilding(ctx, rect, 'fire_department');
      if (svc.police.has(`${a},${b}`)) police += placeServiceBuilding(ctx, rect, 'police_station');
      if (svc.school.has(`${a},${b}`)) school += placeServiceBuilding(ctx, rect, 'school');
      if (svc.hospital.has(`${a},${b}`)) hospital += placeServiceBuilding(ctx, rect, 'hospital');
      const gap = variety.pick([2, 2, 3]);
      const fillChance = 0.42 + variety.range(0, 0.2);
      const stagger = variety.chance(0.5) ? gap : 0;
      const level = rng.chance(0.12) ? 2 : 1;
      buildings += fillBlock(ctx, rng, rect, 'r', level, { gap, fillChance, stagger }).buildings;
    }
  }
  return { buildings, parkCells, ...u, fire, police, school, hospital };
}

/** World-centre cell of every placed building of `kind` (coverage-aware fringe placement). */
function kindCentres(world, kind) {
  const out = [];
  for (const b of world.buildings.values()) {
    if (b.kind !== kind) continue;
    out.push(world.cellToWorld(
      Math.min(world.size.w - 1, b.i + ((b.w || 1) >> 1)),
      Math.min(world.size.h - 1, b.j + ((b.d || 1) >> 1)),
    ));
  }
  return out;
}

/**
 * Low-density fringe ribbons along connector roads (r1 fix 6): the wide lawns between downtown/waterfront and
 * industrial/suburb get sparse level-1 houses on both sides of the existing connectors instead of reading as
 * vacant land. Strips start ~10 m off the centreline so they sit beside the carriageway, not on it, and only
 * lots already inside the placed utilities' coverage are built (a ribbon has no service of its own).
 */
function buildFringeBelts(ctx, rng) {
  const world = ctx.world;
  const power = kindCentres(world, 'power_plant');
  const water = kindCentres(world, 'water_tower');
  const nearKind = (list, i, j, radius) => list.some((p) => {
    const c = world.worldToCell(p.x, p.z);
    return Math.max(Math.abs(c.i - i), Math.abs(c.j - j)) <= radius;
  });
  const isCovered = (i, j) => nearKind(power, i, j, POWER_RADIUS - 1) && nearKind(water, i, j, WATER_RADIUS - 1);
  let buildings = 0;
  for (const z of WATERFRONT_Z) {
    buildings += fillStrip(ctx, rng, { x0: 214, z0: z - 21, x1: 328, z1: z - 12 }, 'r', 1, { pitch: 5, fillChance: 0.8, isCovered });
    buildings += fillStrip(ctx, rng, { x0: 214, z0: z + 12, x1: 328, z1: z + 21 }, 'r', 1, { pitch: 5, fillChance: 0.8, isCovered });
  }
  buildings += fillStrip(ctx, rng, { x0: -502, z0: -214, x1: -493, z1: -166 }, 'r', 1, { pitch: 5, fillChance: 0.8, vertical: true, isCovered });
  buildings += fillStrip(ctx, rng, { x0: -467, z0: -214, x1: -458, z1: -166 }, 'r', 1, { pitch: 5, fillChance: 0.8, vertical: true, isCovered });
  // Greenway stubs between downtown and the waterfront: one small park square in each lawn band between the
  // connector roads (trees/benches/fountain via props), so the belt reads as parkland rather than vacant lawn.
  // Deliberately small: a long thin band would read as a hedge run and cost real props for little view.
  for (let k = 0; k + 1 < WATERFRONT_Z.length; k++) {
    const cz = (WATERFRONT_Z[k] + WATERFRONT_Z[k + 1]) / 2;
    setParkRect(world, 262, cz - 16, 278, cz + 16);
  }
  return buildings;
}

function connectDistricts(ctx) {
  const world = ctx.world;
  // Downtown <-> suburb: continue the x=0 avenue spine north. (The x=-480 industrial avenue is built by
  // buildInterchange() before the districts, so it is already continuous highway → suburb → industrial pad.)
  world.addRoad({ x: 0, z: -200 }, { x: 0, z: -220 }, 'avenue');
}

// ---------------------------------------------------------------------------------------------------------------
/** Build the whole demo city once. Deterministic: every random choice comes from `rng` (already forked by the
 * caller), and every layout coordinate is a fixed constant or a runtime terrain/coastline query — never Math.random
 * or wall-clock. Returns a stats summary for the builder report. */
export function buildCity(ctx, rng) {
  const highway = buildHighway(ctx);
  const interchange = buildInterchange(ctx);
  const downtown = buildDowntown(ctx, rng.fork('downtown'));
  const industrial = buildIndustrial(ctx, rng.fork('industrial'));
  const waterfront = buildWaterfront(ctx, rng.fork('waterfront'));
  const suburb = buildSuburb(ctx, rng.fork('suburb'));
  connectDistricts(ctx);
  const fringe = buildFringeBelts(ctx, rng.fork('fringe'));

  const roadEdges = ctx.world.roads.edges.size;
  const totalBuildings = ctx.world.buildings.size;
  const totalParkCells = downtown.parkCells + waterfront.parkCells + suburb.parkCells;
  const utilities = {
    power: downtown.power + industrial.power + waterfront.power + suburb.power,
    water: downtown.water + industrial.water + waterfront.water + suburb.water,
    fire: downtown.fire + industrial.fire + waterfront.fire + suburb.fire,
    police: downtown.police + industrial.police + waterfront.police + suburb.police,
    school: downtown.school + industrial.school + waterfront.school + suburb.school,
    hospital: downtown.hospital + industrial.hospital + waterfront.hospital + suburb.hospital,
  };

  return {
    highwayEdges: highway.edges.length,
    interchangeRamps: interchange.ramps,
    downtown, industrial, waterfront, suburb, utilities, fringeBuildings: fringe,
    roadEdges, totalBuildings, totalParkCells,
  };
}

/** A small representative slice for `?showcase=demo&variant=downtown` — the old downtown-only staging. */
export function buildDowntownOnly(ctx, rng) {
  return buildDowntown(ctx, rng.fork('downtown'));
}
