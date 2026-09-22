// demo/citygen.js — deterministic layout + procedural seeding for the full-game demo city.
// Pure functions over ctx.world / ctx.modules; no THREE objects, no rendering. Everything here is a function of
// ctx.rng (forked once by index.js) and the terrain the `terrain` module already generated in its own init(), so
// the same seed always produces the same city.

import { WATER_RADIUS } from '../simulation/model.js';

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
 * yard/plaza space between buildings; `fillChance` (0-1) thins the lot out for a less uniform, more organic block.
 *
 * Every row of lots also gets a thin interior 'path' alley immediately on its near side, before the rect is even
 * zoned — without it, only a block's outermost lots would ever end up within the game's road-adjacency rule
 * (SimModel._roadConnectedFor requires a footprint cell to orthogonally touch a 'road' cell); any lot one or more
 * rows deep would be permanently "unserved" for roads no matter its power/water status, regardless of block depth
 * or how the outer margin happens to round against the cell grid. Any cell in that row already claimed by a
 * utility building sited into this same block just before this call (see placeUtilityPair) is left untouched —
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

  for (let j = r.j0; j + fp.d - 1 <= r.j1; j += pitchJ) {
    const nearJ = j - 1, farJ = j + fp.d;
    if (nearJ >= 0) paveAlleyRow(world, r.i0, r.i1, nearJ);
    if (farJ <= r.j1) paveAlleyRow(world, r.i0, r.i1, farJ);
  }

  const zres = zoningApi.setZoneRect(r.i0, r.j0, r.i1, r.j1, zone, level);
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
 * Site a power_plant (3x3) + water_tower (2x2) pair near a block's own centre, called *before* that block's own
 * fillBlock runs — while the block is still untouched 'none' land, so the ring search below succeeds at (or very
 * near) ring 0. Contrast with the old post-hoc pass, which ran after every block was already zoned solid, leaving
 * no open land near the intended anchor at all and dragging the pair off to whatever margin sliver was closest —
 * often far from where it was meant to serve. Returns how many of the pair actually got sited (a block is always
 * comfortably larger than the ~6x3 cells needed, so both should place; the defensive null-checks only matter if a
 * patch of unbuildable terrain happens to sit right at a block's centre). fillBlock's own alley pass (paveAlleyRow)
 * routes around whatever cells end up occupied here — no separate bookkeeping is needed on this end.
 *
 * Power and water are searched from independent, symmetric starting points either side of the block's true centre
 * (rather than chaining water off wherever power's own search actually landed) so their *combined* footprint stays
 * centred on the block — for the largest blocks (e.g. suburb, whose ~200 m pitch is already close to water's 224 m
 * coverage diameter), even a one-sided offset of a couple of cells was enough to push the block's far corner just
 * outside water's reach. Both left/right orderings are tried (findUtilitySite is a pure search, nothing is placed
 * until a winner is picked) and whichever leaves the combined footprint closer to true centre is kept — on its own,
 * a single fixed ordering can still drift lopsided when terrain forces one piece (typically water, the smaller
 * footprint) off its ideal spot while the other stays put, which for suburb's already-tight margin was occasionally
 * enough to leave the block's far edge just outside water's reach.
 */
function placeUtilityPair(ctx, rect) {
  const world = ctx.world;
  const rc = cellRectFromWorld(world, rect.x0, rect.z0, rect.x1, rect.z1);
  const cx = Math.floor((rc.i0 + rc.i1) / 2), cz = Math.floor((rc.j0 + rc.j1) / 2);

  function tryOrder(powerLeft) {
    const pSite = findUtilitySite(ctx, powerLeft ? cx - 3 : cx + 1, cz - 1, 3, 3, 6);
    if (!pSite) return null;
    const wSite = findUtilitySite(ctx, powerLeft ? cx + 1 : cx - 2, cz, 2, 2, 6);
    const pc = pSite.i + 1.5, wc = wSite ? wSite.i + 1 : pc;
    return { pSite, wSite, dev: Math.abs((pc + wc) / 2 - cx) };
  }

  const a = tryOrder(true), b = tryOrder(false);
  const best = !a ? b : !b ? a : (a.dev <= b.dev ? a : b);
  if (!best) return { power: 0, water: 0 };
  world.addBuilding({ i: best.pSite.i, j: best.pSite.j, w: 3, d: 3, zone: null, kind: 'power_plant', level: 1 });
  let water = 0;
  if (best.wSite) {
    world.addBuilding({ i: best.wSite.i, j: best.wSite.j, w: 2, d: 2, zone: null, kind: 'water_tower', level: 1 });
    water = 1;
  }
  return { power: 1, water };
}

/** Largest gap between consecutive grid lines (conservative stand-in for "block pitch" when a district's blocks
 * aren't all the same size, e.g. suburb's jittered/uneven rows). */
function maxGap(lines) {
  let m = 0;
  for (let a = 0; a < lines.length - 1; a++) m = Math.max(m, lines[a + 1] - lines[a]);
  return m;
}

/** Utility anchors are spaced so consecutive utility blocks are never farther apart than the water tower's
 * coverage diameter (the tighter of the two constraints — power's larger radius is automatically satisfied
 * whenever water's is), so their overlapping coverage actually blankets a whole district regardless of its size. */
function utilityStride(pitchMeters, cellSize) {
  const diamM = 2 * WATER_RADIUS * cellSize;
  return Math.max(1, Math.floor(diamM / pitchMeters));
}

/** Block indices (0..lines.length-2) along one axis that should host a utility anchor: every `stride`-th block,
 * always also including the last one so a stride that doesn't evenly divide the block count never leaves the far
 * edge more than one stride's worth of blocks from its nearest anchor. */
function utilityIndices(lines, stride) {
  const n = lines.length - 1;
  const out = new Set();
  for (let a = 0; a < n; a += stride) out.add(a);
  out.add(n - 1);
  return out;
}

/** Cross `utilA` x `utilB` into the set of (a,b) block keys that should host a utility pair, redirecting any
 * anchor that lands on a park/plaza block (isParkFn) to the nearest available in-bounds, non-park, not-yet-chosen
 * neighbour instead of just dropping that anchor's coverage on the floor. `preferB` picks which axis to try
 * shifting along first — always the *sparser*-stride axis (the caller compares its own strideA/strideB): shifting
 * the denser axis just relocates the anchor within a row/column that already has redundant coverage, while the
 * sparse axis has few independent anchors and losing one of its own slots (by shifting perpendicular to it instead
 * of along it) can leave that row/column properly uncovered between its remaining neighbours. */
function resolveUtilityBlocks(nx, nz, utilA, utilB, isParkFn, preferB) {
  const chosen = new Set();
  const order = preferB
    ? [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]]
    : [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const a of utilA) {
    for (const b of utilB) {
      for (const [da, db] of order) {
        const na = a + da, nb = b + db;
        if (na < 0 || na >= nx || nb < 0 || nb >= nz) continue;
        const key = `${na},${nb}`;
        if (isParkFn(na, nb) || chosen.has(key)) continue;
        chosen.add(key);
        break;
      }
    }
  }
  return chosen;
}

/** Per district, pick two non-park blocks to also host the civic services: the blocks whose centres sit closest
 * to the district's block-grid centre (row-major scan, first minimum wins), the second pick excluding the first.
 * This deliberately does NOT look for "free" land: the utility stride above already claims nearly every block in
 * the industrial/waterfront/suburb districts, so the stations are sited into a block that has a power/water pair
 * (see placeServiceBuilding, which is called *after* placeUtilityPair). */
function pickServiceBlocks(nx, nz, isParkFn) {
  const out = [];
  for (let pick = 0; pick < 2; pick++) {
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
  return { fire: new Set(out.slice(0, 1)), police: new Set(out.slice(1, 2)) };
}

/**
 * Site one 2x2 civic service building (fire_department / police_station) into a block whose power/water pair has
 * already been placed. Searched from the block's NW corner, then its SE corner, then the centre — not from the
 * centre first — so a station lands on the block frontage instead of fighting the centred plant/tower for the
 * middle, which keeps the pair's own placement (and therefore the demo city's power/water coverage) byte-identical.
 * The bounded ring keeps a station from drifting into the neighbouring block; returns 1 if placed, 0 if the block
 * genuinely had no free buildable spot (visible in the builder log rather than silently missing).
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

function buildDowntown(ctx, rng) {
  const world = ctx.world;
  buildGrid(world, DOWNTOWN_X, DOWNTOWN_Z, spineKind);
  const MARGIN = 10;
  const nx = DOWNTOWN_X.length - 1, nz = DOWNTOWN_Z.length - 1;
  const isPark = (a, b) => a === 1 && b === 1;
  const strideA = utilityStride(maxGap(DOWNTOWN_X), world.cellSize), strideB = utilityStride(maxGap(DOWNTOWN_Z), world.cellSize);
  const utilA = utilityIndices(DOWNTOWN_X, strideA), utilB = utilityIndices(DOWNTOWN_Z, strideB);
  const utilBlocks = resolveUtilityBlocks(nx, nz, utilA, utilB, isPark, strideB >= strideA);
  // (2,1) is the one signature level-3 tower block below — keep it out of the service picks so a 2x2 station
  // doesn't displace the skyline's single level-3 tower.
  const svc = pickServiceBlocks(nx, nz, (a, b) => isPark(a, b) || (a === 2 && b === 1));
  let buildings = 0, parkCells = 0, power = 0, water = 0, fire = 0, police = 0;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const rect = blockRect(DOWNTOWN_X, DOWNTOWN_Z, a, b, MARGIN);
      if (isPark(a, b)) { // Central Park — right where the two avenues cross
        const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2, S2 = 36;
        parkCells += setParkRect(world, cx - S2, cz - S2, cx + S2, cz + S2).cells;
        addPlusPath(world, cx - S2, cz - S2, cx + S2, cz + S2);
        continue;
      }
      if (utilBlocks.has(`${a},${b}`)) {
        const u = placeUtilityPair(ctx, rect);
        power += u.power; water += u.water;
      }
      if (svc.fire.has(`${a},${b}`)) fire += placeServiceBuilding(ctx, rect, 'fire_department');
      if (svc.police.has(`${a},${b}`)) police += placeServiceBuilding(ctx, rect, 'police_station');
      const zone = (a + b) % 2 === 0 ? 'c' : 'r';
      // One signature tower block (the other inner block besides the park) stays level 3; everything else in
      // downtown is level 2 — keeps a real skyline peak without every block paying a level-3 tower's triangle cost.
      const level = (a === 2 && b === 1) ? 3 : 2;
      buildings += fillBlock(ctx, rng, rect, zone, level, { gap: 3 }).buildings;
    }
  }
  return { buildings, parkCells, power, water, fire, police };
}

function buildIndustrial(ctx, rng) {
  const world = ctx.world, terrainApi = ctx.modules.get('terrain').api;
  // Real industrial land is graded flat — flatten the whole district pad once before zoning/building it (this
  // area sits well off the downtown plateau, in the rolling-plains + hill-noise zone per heightgen.js).
  const r = cellRectFromWorld(world, INDUSTRIAL_X[0], INDUSTRIAL_Z[0], INDUSTRIAL_X[INDUSTRIAL_X.length - 1], INDUSTRIAL_Z[INDUSTRIAL_Z.length - 1]);
  terrainApi.flatten(r.i0, r.j0, r.i1, r.j1);
  buildGrid(world, INDUSTRIAL_X, INDUSTRIAL_Z, spineKind);
  const MARGIN = 10;
  const nx = INDUSTRIAL_X.length - 1, nz = INDUSTRIAL_Z.length - 1;
  const strideA = utilityStride(maxGap(INDUSTRIAL_X), world.cellSize), strideB = utilityStride(maxGap(INDUSTRIAL_Z), world.cellSize);
  const utilA = utilityIndices(INDUSTRIAL_X, strideA), utilB = utilityIndices(INDUSTRIAL_Z, strideB);
  const utilBlocks = resolveUtilityBlocks(nx, nz, utilA, utilB, () => false, strideB >= strideA);
  const svc = pickServiceBlocks(nx, nz, () => false);
  let buildings = 0, power = 0, water = 0, fire = 0, police = 0;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const rect = blockRect(INDUSTRIAL_X, INDUSTRIAL_Z, a, b, MARGIN);
      if (utilBlocks.has(`${a},${b}`)) {
        const u = placeUtilityPair(ctx, rect);
        power += u.power; water += u.water;
      }
      if (svc.fire.has(`${a},${b}`)) fire += placeServiceBuilding(ctx, rect, 'fire_department');
      if (svc.police.has(`${a},${b}`)) police += placeServiceBuilding(ctx, rect, 'police_station');
      const level = (a + b) % 2 === 0 ? 1 : 2;
      buildings += fillBlock(ctx, rng, rect, 'i', level, { gap: 4 }).buildings;
    }
  }
  return { buildings, power, water, fire, police };
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
  const nx = WATERFRONT_X.length - 1, nz = WATERFRONT_Z.length - 1;
  const isPark = (a, b) => a === 0 && b === 0;
  const strideA = utilityStride(maxGap(WATERFRONT_X), world.cellSize), strideB = utilityStride(maxGap(WATERFRONT_Z), world.cellSize);
  const utilA = utilityIndices(WATERFRONT_X, strideA), utilB = utilityIndices(WATERFRONT_Z, strideB);
  const utilBlocks = resolveUtilityBlocks(nx, nz, utilA, utilB, isPark, strideB >= strideA);
  const svc = pickServiceBlocks(nx, nz, isPark);
  let buildings = 0, parkCells = 0, power = 0, water = 0, fire = 0, police = 0;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const rect = blockRect(WATERFRONT_X, WATERFRONT_Z, a, b, MARGIN);
      if (isPark(a, b)) { // Waterfront Park — north end, by the coast
        const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2, S2 = 28;
        parkCells += setParkRect(world, cx - S2, cz - S2, cx + S2, cz + S2).cells;
        addPlusPath(world, cx - S2, cz - S2, cx + S2, cz + S2);
        continue;
      }
      if (utilBlocks.has(`${a},${b}`)) {
        const u = placeUtilityPair(ctx, rect);
        power += u.power; water += u.water;
      }
      if (svc.fire.has(`${a},${b}`)) fire += placeServiceBuilding(ctx, rect, 'fire_department');
      if (svc.police.has(`${a},${b}`)) police += placeServiceBuilding(ctx, rect, 'police_station');
      const zone = (a + b) % 2 === 0 ? 'c' : 'r';
      buildings += fillBlock(ctx, rng, rect, zone, 2, { gap: 3 }).buildings;
    }
  }

  // Promenade path along the actual coastline, one point per row, clamped to stay on the built district.
  const pts = WATERFRONT_Z.map((z, idx) => ({
    x: Math.max(wfLast - 10, Math.min(coastXs[idx] - 20, wfLast + 60)), z,
  }));
  for (let k = 0; k < pts.length - 1; k++) world.addRoad(pts[k], pts[k + 1], 'path');

  return { buildings, parkCells, power, water, fire, police, coastXs, xLines: WATERFRONT_X, zLines: WATERFRONT_Z };
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
  const nx = SUBURB_X.length - 1, nz = SUBURB_Z.length - 1;
  const isPark = (a, b) => PARK_BLOCKS.has(`${a},${b}`);
  const strideA = utilityStride(maxGap(SUBURB_X), world.cellSize), strideB = utilityStride(maxGap(SUBURB_Z), world.cellSize);
  const utilA = utilityIndices(SUBURB_X, strideA), utilB = utilityIndices(SUBURB_Z, strideB);
  const utilBlocks = resolveUtilityBlocks(nx, nz, utilA, utilB, isPark, strideB >= strideA);
  const svc = pickServiceBlocks(nx, nz, isPark);
  let buildings = 0, parkCells = 0, power = 0, water = 0, fire = 0, police = 0;
  for (let a = 0; a < nx; a++) {
    for (let b = 0; b < nz; b++) {
      const rect = blockRect(SUBURB_X, SUBURB_Z, a, b, MARGIN);
      if (isPark(a, b)) {
        const cx = (rect.x0 + rect.x1) / 2, cz = (rect.z0 + rect.z1) / 2;
        const px0 = cx - PARK_SIZE / 2, pz0 = cz - PARK_SIZE / 2, px1 = cx + PARK_SIZE / 2, pz1 = cz + PARK_SIZE / 2;
        parkCells += setParkRect(world, px0, pz0, px1, pz1).cells;
        addPlusPath(world, px0, pz0, px1, pz1);
        continue;
      }
      if (utilBlocks.has(`${a},${b}`)) {
        const u = placeUtilityPair(ctx, rect);
        power += u.power; water += u.water;
      }
      if (svc.fire.has(`${a},${b}`)) fire += placeServiceBuilding(ctx, rect, 'fire_department');
      if (svc.police.has(`${a},${b}`)) police += placeServiceBuilding(ctx, rect, 'police_station');
      const level = rng.chance(0.15) ? 2 : 1;
      buildings += fillBlock(ctx, rng, rect, 'r', level, { gap: 4, fillChance: 0.32 }).buildings;
    }
  }
  return { buildings, parkCells, power, water, fire, police };
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
  const utilities = {
    power: downtown.power + industrial.power + waterfront.power + suburb.power,
    water: downtown.water + industrial.water + waterfront.water + suburb.water,
    fire: downtown.fire + industrial.fire + waterfront.fire + suburb.fire,
    police: downtown.police + industrial.police + waterfront.police + suburb.police,
  };

  return {
    highwayEdges: highway.edges.length,
    downtown, industrial, waterfront, suburb, utilities,
    roadEdges, totalBuildings, totalParkCells,
  };
}

/** A small representative slice for `?showcase=demo` — downtown only (see index.js's showcase()). */
export function buildDowntownOnly(ctx, rng) {
  return buildDowntown(ctx, rng.fork('downtown'));
}
