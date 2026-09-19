// demo — Wave 3 final assembly. Seeds a real, deterministic ~2 km² demo city once at init() using only the
// public APIs of the other modules (world.addRoad/addBuilding/setCell, zoning.setZoneRect, terrain.flatten/
// isBuildable). Buildings/props/traffic/simulation all render and react reactively via world events (building:
// spawned, road:added, world:cell) once seeded here — this module owns no scene objects of its own.
//
// order: 5 so it would run first among update()s (it has none that matter), but its hard deps (terrain, roads,
// zoning, buildings, props, traffic, simulation, environment) mean the registry's topological sort always inits it
// LAST among them regardless of `order` — by the time init() runs here, every other district-building module is
// already loaded and its event listeners are live, so a single ctx.world.addRoad/addBuilding/setCell call is
// enough to trigger roads' mesh rebuild, props' lamp/park population, buildings' geometry generation, zoning's
// overlay and simulation's bookkeeping — no direct calls into those modules' populate APIs are needed.
import { buildCity, buildDowntownOnly } from './citygen.js';

let S = null;

export default {
  id: 'demo',
  deps: ['terrain', 'environment', 'roads', 'zoning', 'buildings', 'props', 'traffic', 'simulation'],
  order: 5,
  showcaseVariants: ['default'],
  presets: {
    // Generic 'overview'/'skyline'/'street'/'aerial' (registered by core) already frame downtown-at-origin well;
    // these are small extras for tooling parity with other modules.
    'demo:default': () => ({ pos: [560, 620, 780], target: [0, 20, 0], fov: 50 }),
    'demo:closeup': () => ({ pos: [70, 45, 90], target: [0, 15, 0], fov: 42 }),
    'demo:overview': () => ({ pos: [900, 820, 900], target: [0, 0, -100], fov: 46 }),
  },

  async init(ctx) {
    // Soft-guard the non-hard deps per the usual isolation rules: they should already be loaded in the full game,
    // but a missing one (e.g. running with ?exclude=) must never crash city seeding.
    for (const id of ['ui', 'audio', 'effects', 'tools']) {
      const rec = ctx.modules.get(id);
      if (rec && rec.status !== 'ok') ctx.log(`[demo] optional module "${id}" not ok (${rec.status}) — continuing`);
    }
    const rng = ctx.rng.fork('demo');
    const t0 = performance.now();
    const stats = buildCity(ctx, rng);
    // Perf: the full network already saturates traffic's own MAX_POOL (300 cars); a real city this size reads
    // fine at a lower fraction and it trims real triangle/shadow cost. See the builder report for the full budget.
    ctx.modules.get('traffic')?.api?.setDensity?.(0.55);

    // Polish (optional per the brief): a freshly-seeded city starts at 0 population/jobs — every building is
    // empty until simulation ticks enough times to grow occupancy. Warm the (pure, deterministic) economy model
    // forward a few hundred ticks now, the same way simulation's own showcase() does, so the HUD and building
    // occupancy already read like a lived-in city on the very first frame instead of "day zero".
    const simApi = ctx.modules.get('simulation')?.api;
    if (simApi?.tick) for (let k = 0; k < 600; k++) simApi.tick();

    S = { ctx, stats };
    const ms = (performance.now() - t0).toFixed(1);
    const pop = simApi?.getStats?.()?.population ?? '?';
    ctx.log(`[demo] city seeded in ${ms} ms: ${stats.roadEdges} road edges (incl. ${stats.highwayEdges} highway), `
      + `${stats.totalBuildings} buildings (downtown ${stats.downtown.buildings}, industrial ${stats.industrial.buildings}, `
      + `waterfront ${stats.waterfront.buildings}, suburb ${stats.suburb.buildings}), ${stats.totalParkCells} park cells, `
      + `${stats.utilities.power} power plants + ${stats.utilities.water} water towers, warmed-up population ${pop}`);
  },

  dispose() {
    // demo owns no scene objects and no world data of its own (roads/zoning/buildings/props/simulation each own
    // and clean up their own rendered state and — via world.clearContent() — the shared world data). Nothing to do.
    S = null;
  },

  /** Small representative slice for `?showcase=demo` tooling parity: downtown only (the runner already called
   * world.clearContent() before this, and init() above already ran once, seeding + then wiping the full city). */
  async showcase(ctx, _variant = 'default') {
    const rng = ctx.rng.fork('demo:showcase');
    const stats = buildDowntownOnly(ctx, rng);
    ctx.log(`[demo] showcase: downtown slice, ${stats.buildings} buildings, ${stats.parkCells} park cells`);
  },

  api: {
    stats() { return S ? S.stats : null; },
  },
};
