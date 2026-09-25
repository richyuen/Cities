// Deterministic staging for ?showcase=views: a compact road grid with three zoned districts, a deliberately
// partial set of utilities (so coverage views show real green/red boundaries) and a few bus stops for the
// transit layer. Uses only public APIs — world mutators and module apis — exactly like demo/citygen does, so the
// scene behaves like player-built content (zoning overlay, buildings, props and simulation all react via events).
const GRID = [-144, -96, -48, 0, 48, 96, 144];              // road line coordinates (m)
const OUTER = 24;                                           // grid lines run this far past the outer blocks
const BLOCK = 3;                                            // building pitch inside a block: 2x2 footprint + 1 gap

/** Nearest w x d rectangle of untouched 'none' land to (x, z), scanning ring by ring. Deterministic. */
function findEmpty(world, x, z, w, d) {
  const start = world.worldToCell(x, z);
  for (let r = 0; r < 20; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue; // ring only
        const i = start.i + di, j = start.j + dj;
        let ok = true;
        for (let jj = j; jj < j + d && ok; jj++) {
          for (let ii = i; ii < i + w && ok; ii++) {
            const c = world.cellAt(ii, jj);
            if (!c || c.type !== 'none' || c.zone) ok = false;
          }
        }
        if (ok) return { i, j };
      }
    }
  }
  return null;
}

function fillBlock(ctx, rng, i0, j0, i1, j1, zone, level) {
  const world = ctx.world;
  const zoningApi = ctx.modules.get('zoning')?.api;
  const buildingsApi = ctx.modules.get('buildings')?.api;
  const terrainApi = ctx.modules.get('terrain')?.api;
  if (!zoningApi || !buildingsApi) return 0;
  zoningApi.setZoneRect(i0, j0, i1, j1, zone, level);
  const fp = buildingsApi.getFootprint(zone, level) || { w: 2, d: 2 };
  let n = 0;
  for (let j = j0; j + fp.d - 1 <= j1; j += Math.max(fp.d + 1, BLOCK)) {
    for (let i = i0; i + fp.w - 1 <= i1; i += Math.max(fp.w + 1, BLOCK)) {
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
      n++;
    }
  }
  return n;
}

/** Stage the scene; returns { x, z, r } focus bounds for this module's camera presets. */
export function stageShowcase(ctx, rng) {
  const world = ctx.world;
  const terrainApi = ctx.modules.get('terrain')?.api;
  const transitApi = ctx.modules.get('transit')?.api;

  // 1. flat build area, a little wider than the grid (roads/buildings need one-level terrain)
  const a = world.worldToCell(GRID[0] - OUTER, GRID[0] - OUTER);
  const b = world.worldToCell(GRID[GRID.length - 1] + OUTER, GRID[GRID.length - 1] + OUTER);
  const height = terrainApi?.flatten?.(a.i, a.j, b.i, b.j);

  // 2. road grid (avenues every 2nd line, streets between)
  const lo = GRID[0] - OUTER, hi = GRID[GRID.length - 1] + OUTER;
  let edges = 0;
  for (const x of GRID) if (world.addRoad({ x, z: lo }, { x, z: hi }, x % 96 === 0 ? 'avenue' : 'street')) edges++;
  for (const z of GRID) if (world.addRoad({ x: lo, z }, { x: hi, z }, z % 96 === 0 ? 'avenue' : 'street')) edges++;

  // 3. utilities first (so zoning + filling skip their footprint cells); coverage is intentionally partial:
  //    two power plants leave the north-east dark, one school leaves most of the south without education.
  const utilities = [
    ['power_plant', -120, -120, 3, 3],
    ['power_plant', 120, 120, 3, 3],
    ['water_tower', 120, -108, 2, 2],
    ['police_station', -24, 72, 2, 2],
    ['school', -72, 24, 3, 2],
    ['hospital', 72, 72, 3, 2],
  ];
  let placed = 0;
  for (const [kind, x, z, w, d] of utilities) {
    const site = findEmpty(world, x, z, w, d);
    if (!site) continue;
    world.addBuilding({ i: site.i, j: site.j, w, d, zone: null, kind, level: 1, seed: rng.int(0, 1e9) });
    placed++;
  }

  // 4. blocks: north industrial, middle residential, south commercial
  let built = 0;
  for (let bi = 0; bi + 1 < GRID.length; bi++) {
    for (let bj = 0; bj + 1 < GRID.length; bj++) {
      const zone = bj < 2 ? 'i' : bj < 5 ? 'r' : 'c';
      const level = (bi > 0 && bi < GRID.length - 2 && bj > 1 && bj < 5) ? 2 : 1;
      const ca = world.worldToCell(GRID[bi], GRID[bj]), cb = world.worldToCell(GRID[bi + 1], GRID[bj + 1]);
      built += fillBlock(ctx, rng, ca.i + 2, ca.j + 2, cb.i - 2, cb.j - 2, zone, level);
    }
  }

  // 5. bus stops: a couple on the central avenue for the transit layer
  let stops = 0;
  for (const [x, z] of [[-2, -40], [2, 8], [30, 2], [-30, 50]]) {
    if (transitApi?.placeStop?.(x, z)?.ok) stops++;
  }

  ctx.log(`[views] showcase staged: ${edges} road edges, ${built} buildings, ${placed} utilities, ${stops} stops`
    + (height !== undefined ? `, plateau ${height.toFixed(1)} m` : ''));
  return { x: 0, z: 0, r: 190 };
}
