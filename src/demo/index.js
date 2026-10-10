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
//
// Wave B5/G8: after the 600-tick warm-up this calls buildings.api.settle() so the city's level-up backlog is
// applied and merged *before* the boot screen lifts — `ready` means the complete city is on screen, not a
// half-built one that fills in over the next ~6 s (r1 review item 1).
import { buildCity, buildDowntownOnly } from './citygen.js';
import { placeSetPieces, stampParkLand, dressHouseYard, infillAround, chooseCameras, heroCameras, occlusion } from './setpieces.js';

let S = null;
const WARM_TICKS = 600;

/** Live hero camera of the sited set-piece of `type` (the chosen side of setpieces.js heroCameras(): the garden's is
 * composed around its hero house, skate / farm are the props registry cameras), or the suburb framing. */
function setPieceCamera(type) {
  const row = S?.stats?.setPieces?.find((r) => r.type === type && r.placed);
  const e = row && S.ctx.modules.get('props')?.api?.setPieces?.().find((p) => p.id === row.id);
  const cam = e && heroCameras(S.ctx, e, row.house)[row.camera || 'hero'];
  return cam || { pos: [250, 200, -120], target: [-60, 0, -430], fov: 46 };
}

/** Seed everything both the full game and the showcase need: city, traffic density, transit loop, warm-up and
 * the synchronous settle that makes the first drawn frame complete. One function so `?showcase=demo` shows the
 * exact shipped city (r1 review: the old downtown-only showcase never exercised suburb/industrial/waterfront). */
function seed(ctx, rng) {
  // LOOP cycle 5: ?nosp=1 (the A/B attribution flag props also honours) disables the set-piece lot reservation here
  // as well, so that city is the pre-cycle city exactly.
  const spOn = ctx.params?.get?.('nosp') !== '1';
  const stats = buildCity(ctx, rng, { setPieces: spOn });
  // Perf: the full network already saturates traffic's own MAX_POOL (300 cars); a real city this size reads
  // fine at a lower fraction and it trims real triangle/shadow cost. See the builder report for the full budget.
  // Wave B2: 0.55 → 0.8 — the whole-game critic read traffic as sparse from wide framing for 4 rounds; 240 cars
  // (still under the pool cap) reads populated from the air without jamming the street shots.
  ctx.modules.get('traffic')?.api?.setDensity?.(0.8);

  // Public transport: a starter bus loop around downtown, placed through the transit module's own api (so it
  // costs money and behaves exactly like a player-built line). The six stops trace a clockwise block loop whose
  // every turn is a right turn, so lane 0 serves the whole route.
  const transitApi = ctx.modules.get('transit')?.api;
  let busStops = 0, busLine = false;
  if (transitApi) {
    const stopPts = [[-2, 60], [-2, 160], [-60, 198], [-98, 160], [-98, 60], [-60, 2]];
    const stopIds = [];
    for (const [x, z] of stopPts) { const r = transitApi.placeStop(x, z); if (r?.ok) stopIds.push(r.id); }
    busStops = stopIds.length;
    if (stopIds.length >= 2) busLine = !!transitApi.createLine(stopIds)?.ok;
  }

  // Polish (optional per the brief): a freshly-seeded city starts at 0 population/jobs — every building is
  // empty until simulation ticks enough times to grow occupancy. Warm the (pure, deterministic) economy model
  // forward a few hundred ticks now, the same way simulation's own showcase() does, so the HUD and building
  // occupancy already read like a lived-in city on the very first frame instead of "day zero".
  let levelUps = 0;
  const simApi = ctx.modules.get('simulation')?.api;
  if (simApi?.tick) for (let k = 0; k < WARM_TICKS; k++) simApi.tick(true); // silent: milestone rewards apply without boot toasts
  // The warm-up leaves simulation holding a level-up candidate list for the whole city; apply it and merge the
  // geometry now (boot screen still up), otherwise buildings pop in for ~6.5 s after `ready` (r1 item 1).
  levelUps = ctx.modules.get('buildings')?.api?.settle?.() ?? 0;
  // LOOP cycle 5: the reserved lots are still bare (never zoned, never grown through the warm-up); add the garden's
  // house (explicit id, so no other building id shifts) and author the set-pieces now, before settleDetail() below
  // re-resolves dressing + set-piece deck heights on the finished terrain.
  let setPieces = [];
  const tSp0 = performance.now();
  if (spOn && stats.setPiecePlan) {
    setPieces = placeSetPieces(ctx, stats.setPiecePlan);
    for (const m of stats.setPiecePlan.misses || []) ctx.log(`[demo] set-piece site miss: ${m}`);
  }
  // LOOP c6: the leftover never-zoned land of the blocks that host a piece becomes park (props dresses it on its next
  // park flush). After the warm-up, like the infill, so the warm-up economy is the pre-cycle one. `?sppark=0`: A/B flag.
  // Same flag: the hero house's side yards get a hedge row, a tree and a flower bed each.
  const tSpA = performance.now();
  const parkOn = setPieces.length && ctx.params?.get?.('sppark') !== '0';
  const park = parkOn ? stampParkLand(ctx, setPieces) : { cells: 0, blocks: {} };
  park.yardProps = parkOn ? dressHouseYard(ctx, setPieces) : 0;
  const tSpB = performance.now();
  // Town infill around each piece (camera-independent since LOOP c6), then the hero camera per piece on that final
  // city - both BEFORE settleDetail() below, so the infill houses' C2 yard dressing is settled with the rest of the
  // city (the deck heights it re-resolves do not move: the terrain is final here, so the cameras chosen now are the
  // final ones). `?spinfill=0`: A/B flag for the infill alone (set-pieces + garden house stay).
  const infill = setPieces.length && ctx.params?.get?.('spinfill') !== '0' ? infillAround(ctx, setPieces, rng.fork('setpieces').fork('infill')) : 0;
  const tSpC = performance.now();
  chooseCameras(ctx, setPieces);
  const placeMs = performance.now() - tSp0;
  // LOOP cycle 2 fix round: the terrain/road surface has stopped moving now, so re-resolve the props module's
  // C2 dressing heights once (its own optional hook, same contract as buildings.settle()).
  const detailSettled = ctx.modules.get('props')?.api?.settleDetail?.() ?? 0;
  const tSp1 = performance.now();
  // Re-test the chosen camera after the settle (report only): same heroCameras() the presets return, same fan.
  const reg = new Map((ctx.modules.get('props')?.api?.setPieces?.() || []).map((e) => [e.id, e]));
  for (const r of setPieces) {
    if (!r.placed || !r.camera) continue;
    const houseId = r.house ? r.house.id : null;
    r.occlusionFinal = occlusion(ctx, heroCameras(ctx, reg.get(r.id), houseId)[r.camera], houseId);
  }
  stats.setPieces = setPieces.map((r) => ({
    type: r.type, id: r.id, x: r.x, z: r.z, rot: r.rot, w: r.w, d: r.d, block: r.block, corner: r.corner,
    placed: !!r.placed, verge: r.verge ?? 0, blockers: r.blockers, house: r.house ? r.house.id : null,
    camera: r.camera || null, occlusion: r.occlusion || null, occlusionFinal: r.occlusionFinal || null, infill: r.infill ?? 0,
  }));
  stats.setPieceInfill = infill;
  stats.setPiecePark = park;
  // house + placement + park stamp + infill + camera choice + final occlusion (the reservation runs inside buildCity;
  // settleDetail is timed by props)
  stats.setPieceMs = Math.round((placeMs + performance.now() - tSp1) * 10) / 10;
  // where that boot stall goes (ms): house + placement / park stamp + yard / infill houses / camera choice + final fan
  const r1 = (n) => Math.round(n * 10) / 10;
  stats.setPieceTimes = { place: r1(tSpA - tSp0), park: r1(tSpB - tSpA), infill: r1(tSpC - tSpB), cameras: r1(placeMs - (tSpC - tSp0) + performance.now() - tSp1) };
  return { stats, busStops, busLine, levelUps, detailSettled };
}

export default {
  id: 'demo',
  deps: ['terrain', 'environment', 'roads', 'zoning', 'buildings', 'props', 'traffic', 'simulation', 'transit'],
  order: 5,
  showcaseVariants: ['default', 'downtown'],
  presets: {
    // Generic 'overview'/'skyline'/'street'/'aerial' (registered by core) already frame downtown-at-origin well;
    // these are the demo's own district framings for tooling parity with other modules.
    'demo:default': () => ({ pos: [560, 620, 780], target: [0, 20, 0], fov: 50 }),
    'demo:overview': () => ({ pos: [900, 820, 900], target: [0, 0, -100], fov: 46 }),
    'demo:closeup': () => ({ pos: [140, 44, 42], target: [40, 14, -60], fov: 42 }),
    'demo:suburb': () => ({ pos: [250, 200, -120], target: [-60, 0, -430], fov: 46 }),
    'demo:industrial': () => ({ pos: [-30, 170, 400], target: [-430, 0, 0], fov: 46 }),
    'demo:waterfront': () => ({ pos: [150, 150, 430], target: [530, 0, 0], fov: 46 }),
    'demo:highway': () => ({ pos: [-380, 130, -330], target: [-540, 0, -560], fov: 46 }),
    // LOOP cycle 5: the occlusion-checked hero camera of each sited set-piece (falls back to demo:suburb).
    // LOOP cycle 6: sp-garden is the demo's own composition around the hero house (setpieces.js gardenHero).
    'demo:sp-skate': () => setPieceCamera('skate'),
    'demo:sp-garden': () => setPieceCamera('garden'),
    'demo:sp-farm': () => setPieceCamera('farm'),
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
    const { stats, busStops, busLine, levelUps, detailSettled } = seed(ctx, rng);
    S = { ctx, stats };
    const ms = (performance.now() - t0).toFixed(1);
    const pop = ctx.modules.get('simulation')?.api?.getStats?.()?.population ?? '?';
    ctx.log(`[demo] city seeded in ${ms} ms: ${stats.roadEdges} road edges (incl. ${stats.highwayEdges} highway, `
      + `${stats.interchangeRamps} ramps), `
      + `${stats.totalBuildings} buildings (downtown ${stats.downtown.buildings}, industrial ${stats.industrial.buildings}, `
      + `waterfront ${stats.waterfront.buildings}, suburb ${stats.suburb.buildings}, fringe ${stats.fringeBuildings}), `
      + `${stats.totalParkCells} park cells, `
      + `${stats.utilities.power} power plants + ${stats.utilities.water} water towers + `
      + `${stats.utilities.fire} fire depts + ${stats.utilities.police} police stations + `
      + `${stats.utilities.school} schools + ${stats.utilities.hospital} hospitals, `
      + `${busStops} bus stops + ${busLine ? 1 : 0} bus line, warmed-up population ${pop}, ${levelUps} settled level-ups, `
      + `${detailSettled} C2 heights settled, `
      + `${(stats.setPieces || []).filter((r) => r.placed).length} set-pieces (${(stats.setPieces || []).map((r) => `${r.id}${r.placed ? '@' + r.block + '/' + r.corner + ':' + r.camera : ':skipped'}`).join(' ') || 'off'})`);
  },

  dispose() {
    // demo owns no scene objects and no world data of its own (roads/zoning/buildings/props/simulation each own
    // and clean up their own rendered state and — via world.clearContent() — the shared world data). Nothing to do.
    S = null;
  },

  /** `?showcase=demo` stages the exact shipped city (same seed, warm-up and settle) so the module batch exercises
   * what the module actually owns; `variant=downtown` keeps the old small downtown slice for tooling closeups. */
  async showcase(ctx, variant = 'default') {
    const rng = ctx.rng.fork('demo');
    if (variant === 'downtown') {
      const stats = buildDowntownOnly(ctx, rng);
      ctx.log(`[demo] showcase 'downtown': ${stats.buildings} buildings, ${stats.parkCells} park cells`);
      return;
    }
    const { stats, busStops, busLine, levelUps } = seed(ctx, rng);
    S = { ctx, stats };
    ctx.log(`[demo] showcase 'default': full city, ${stats.totalBuildings} buildings `
      + `(suburb ${stats.suburb.buildings}, fringe ${stats.fringeBuildings}), ${busStops} bus stops + ${busLine ? 1 : 0} bus line, `
      + `${levelUps} settled level-ups`);
  },

  api: {
    stats() { return S ? S.stats : null; },
    /** LOOP cycle 5: the sited set-pieces with the live registry entry and the chosen hero camera:
     * [{ type, id, x, z, rot, w, d, block, corner, placed, house, camera: 'hero'|'heroAlt', cam: {pos,target,fov},
     *    hero, heroAlt, occlusion }]. `hero` / `heroAlt` / `cam` are setpieces.js heroCameras() - exactly what the
     * 'demo:sp-*' presets return. Empty with ?nosp=1. */
    setPieces() {
      if (!S?.stats?.setPieces) return [];
      const reg = new Map((S.ctx.modules.get('props')?.api?.setPieces?.() || []).map((e) => [e.id, e]));
      return S.stats.setPieces.map((r) => {
        const e = reg.get(r.id);
        const cams = heroCameras(S.ctx, e, r.house);
        return { ...r, placed: r.placed && !!e, hero: cams.hero || null, heroAlt: cams.heroAlt || null, cam: cams[r.camera || 'hero'] || null, deckY: e?.deckY ?? null };
      });
    },
  },
};
