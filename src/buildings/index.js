import * as THREE from 'three';
import { generateBuilding } from './generator.js';
import { BuildingBatcher } from './batching.js';
import { UnservedIndicators, FireIndicators, FireDrones } from './indicators.js';
import { stageDefault, stageLevels, stageNight } from './showcase.js';

// buildings — procedurally generates and renders Lego-style buildings for world.buildings records, and (in the
// full game only) grows the city: spawns starter buildings on zoned+empty+road-adjacent cells when simulation
// reports demand, and levels up buildings simulation flags as growth candidates.
//
// `zoning` isn't required at runtime (we only read cell.zone/density, which are plain World data owned by
// whichever module calls world.setZone — core data, not zoning-module behaviour), but it IS a real dependency
// per the module order in ARCHITECTURE.md. The zoning module hasn't been built yet in this pass (empty
// src/zoning/ folder — see docs/STATUS.json, round 0). Declaring a hard dep on a module with no loader would
// make the registry mark it "failed" and skip buildings entirely (registry.js: missing deps -> status
// 'skipped'), which is exactly the existing `roads` module's problem too — it uses the same guard
// (`TERRAIN_PRESENT` in src/roads/index.js) for the same reason. We mirror that pattern here.
const ZONING_PRESENT = Object.keys(import.meta.glob('../zoning/index.js')).length > 0;

const GROWTH_INTERVAL = 3; // seconds of real/game time between auto-growth passes (full game only)
const GROWTH_SPAWN_CAP = 6; // per zone, per pass — avoids a single-frame population explosion
const REBUILD_DEBOUNCE_MS = 30;
// Full game only: once the debounce window elapses, hand any dirty chunks to BuildingBatcher.flushIncremental()
// instead of the unbounded flush() — a chunk covers up to a quarter of the map (see batching.js CHUNK_CELLS
// comment) and merging every building's geometry in it synchronously could otherwise cost several ms per bucket.
// 2.5ms/frame keeps buildings' own update() share small relative to the ~16ms full-frame budget even before other
// modules' cost is added, while still finishing a multi-chunk rebuild within a handful of frames. (Each unit of
// work checked against this budget is itself capped - see BuildingBatcher.SLICE_GEOMS - so a call can overshoot
// by at most about one slice-merge's cost, not by an unbounded amount.)
const REBUILD_BUDGET_MS = 2.5;
// Full game only: root cause of the 500-600ms stall reported in docs/core-requests/environment.md "## 2." —
// simulation.getGrowthCandidates() legitimately returns every currently-eligible building each poll (its list is
// "refreshed per tick", not a draining queue — see src/simulation/model.js), which after the city's initial
// warm-up (demo module fast-forwards 600 sim ticks at boot) can be 100+ buildings at once. levelUpBuilding() does
// real procedural regeneration (generateBuilding() + a construction-flash mesh) per building - measured at
// roughly 3-4ms each - so processing all of them synchronously in one autoGrowthPass() call was the actual
// spike (NOT the batcher: instrumented separately, flushIncremental() above already held to single-digit ms per
// frame). Candidates a pass doesn't get to simply reappear in S.model.growth next tick (nothing about a building
// changes just because we deferred it), so it's safe to queue them and drain a small time-budget's worth per
// frame instead of processing the whole batch at once.
const LEVEL_UP_BUDGET_MS = 2;

const S = {
  ctx: null, group: null, batcher: null, indicators: null, fireIndicators: null, fireDrones: null, dynMats: null, rng: null, unsub: [],
  pendingDirty: false, lastEvent: 0, growthAcc: 0, growthTick: 0, growthRng: null,
  tweens: [], variant: null, closeupTarget: null,
  levelUpQueue: [], levelUpQueued: null, // null placeholder; set() in init() (needs a real Set instance)
};

function buildingRng(b) { return S.rng.fork(`${b.seed ?? 0}:${b.id}`); }

function regenerateBuilding(ctx, b) {
  const rng = buildingRng(b);
  const gen = generateBuilding(ctx, b, rng);
  b.height = gen.height;
  b.kind = gen.kind;
  S.batcher.set(b.id, b.i, b.j, { parts: gen.parts, studs: gen.studs, height: gen.height, kind: gen.kind, cx: gen.cx, cz: gen.cz, baseY: gen.baseY });
  markDirty();
}

function markDirty() { S.pendingDirty = true; S.lastEvent = performance.now(); }

function spawnConstructionFlash(ctx, b) {
  const info = S.batcher.get(b.id);
  const cx = info?.cx, cz = info?.cz, baseY = info?.baseY ?? 0;
  if (cx === undefined) return;
  const cs = ctx.world.cellSize;
  const h = Math.max(3, b.height || 6);
  const mat = ctx.materials.plastic('brightYellow', { emissive: 'brightYellow', emissiveIntensity: 1.4, roughness: 0.5, clearcoat: 0.2 });
  const geo = new THREE.BoxGeometry(b.w * cs * 0.94, h, b.d * cs * 0.94);
  const mesh = new THREE.Mesh(geo, mat.clone());
  mesh.material.transparent = true;
  mesh.material.opacity = 0.55;
  mesh.position.set(cx, baseY + h / 2, cz);
  mesh.name = 'buildings-construction-flash';
  S.group.add(mesh);
  S.tweens.push({ mesh, t: 0, dur: 0.7 });
}

function updateTweens(dt) {
  if (!S.tweens.length) return;
  for (let k = S.tweens.length - 1; k >= 0; k--) {
    const tw = S.tweens[k];
    tw.t += dt;
    const f = Math.min(1, tw.t / tw.dur);
    tw.mesh.scale.setScalar(1 + 0.06 * Math.sin(f * Math.PI));
    tw.mesh.material.opacity = 0.55 * (1 - f);
    if (f >= 1) {
      S.group.remove(tw.mesh);
      tw.mesh.geometry.dispose();
      tw.mesh.material.dispose();
      S.tweens.splice(k, 1);
    }
  }
}

function levelUpBuilding(ctx, id) {
  const b = ctx.world.buildings.get(id);
  if (!b || b.level >= 3) return;
  b.level += 1;
  regenerateBuilding(ctx, b);
  spawnConstructionFlash(ctx, b);
}

function cellAdjacentToRoad(world, i, j) {
  const n = [world.cellAt(i + 1, j), world.cellAt(i - 1, j), world.cellAt(i, j + 1), world.cellAt(i, j - 1)];
  return n.some((c) => c && c.type === 'road');
}

/** Enqueue newly-seen growth candidates for levelUpDrain() to process a few at a time (see LEVEL_UP_BUDGET_MS) -
 * cheap (Set/array membership + push only), unlike the actual per-building regeneration work it defers. */
function enqueueLevelUps(ctx, ids) {
  for (const id of ids) {
    if (S.levelUpQueued.has(id)) continue;
    const b = ctx.world.buildings.get(id);
    if (!b || b.level >= 3) continue; // already maxed or gone - nothing to do, don't bother queueing
    S.levelUpQueued.add(id);
    S.levelUpQueue.push(id);
  }
}

/** Drains up to `budgetMs` worth of queued level-ups. A candidate this call doesn't reach just stays queued (and
 * would be re-offered by the next autoGrowthPass poll anyway, deduped by S.levelUpQueued) - no work is lost by
 * spreading it across frames instead of doing it all in the poll that found it. */
function drainLevelUps(ctx, budgetMs) {
  if (!S.levelUpQueue.length) return;
  const deadline = performance.now() + budgetMs;
  while (S.levelUpQueue.length && performance.now() < deadline) {
    const id = S.levelUpQueue.shift();
    S.levelUpQueued.delete(id);
    levelUpBuilding(ctx, id);
  }
}

/** Auto-growth: spawn starter (level 1) buildings on zoned, empty, road-adjacent cells where demand is positive,
 * and queue simulation's current level-up candidates for levelUpDrain(). */
function autoGrowthPass(ctx) {
  const sim = ctx.modules.get('simulation');
  if (sim?.status !== 'ok' || typeof sim.api?.getGrowthCandidates !== 'function') return;
  enqueueLevelUps(ctx, sim.api.getGrowthCandidates() || []);

  if (typeof sim.api.getDemand !== 'function') return;
  const demand = sim.api.getDemand();
  const world = ctx.world;
  const byZone = { r: [], c: [], i: [] };
  const W = world.size.w, H = world.size.h;
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const c = world.cells[j * W + i];
      if (!c.zone || c.buildingId || c.type !== 'zone') continue;
      if (!byZone[c.zone]) continue;
      if (!cellAdjacentToRoad(world, i, j)) continue;
      byZone[c.zone].push({ i, j });
    }
  }
  S.growthTick++;
  const rng = S.growthRng.fork(`t${S.growthTick}`);
  for (const zone of ['r', 'c', 'i']) {
    if ((demand[zone] ?? 0) <= 0.3) continue;
    const list = byZone[zone];
    if (!list.length) continue;
    rng.shuffle(list);
    const n = Math.min(GROWTH_SPAWN_CAP, list.length);
    for (let k = 0; k < n; k++) {
      const { i, j } = list[k];
      world.addBuilding({ i, j, w: 1, d: 1, zone, level: 1, seed: rng.int(0, 1e9) });
    }
  }
}

const FOOTPRINTS = {
  r: { 1: [1, 1], 2: [1, 1], 3: [2, 2] },
  c: { 1: [1, 1], 2: [2, 1], 3: [2, 2] },
  i: { 1: [2, 2], 2: [2, 2], 3: [3, 2] },
};

const api = {
  getBuildingMesh(id) {
    const b = S.batcher?.get(id);
    if (!b) return null;
    // Buildings are merged per-chunk-per-material to hit the draw-call budget, so there is no exclusive
    // per-building mesh; this returns the shared chunk group that renders this building's geometry.
    return S.batcher.chunks.get(b.chunkKey)?.group || null;
  },
  getFootprint(zone, level) {
    const fp = (FOOTPRINTS[zone] || FOOTPRINTS.r)[level] || [1, 1];
    return { w: fp[0], d: fp[1] };
  },
  rebuild(id) {
    const b = S.ctx?.world.buildings.get(id);
    if (!b) return false;
    regenerateBuilding(S.ctx, b);
    S.batcher.flush();
    return true;
  },
  stats() {
    const world = S.ctx.world;
    const byZone = { r: 0, c: 0, i: 0 };
    const byLevel = { 1: 0, 2: 0, 3: 0 };
    let count = 0;
    for (const b of world.buildings.values()) {
      count++;
      byZone[b.zone] = (byZone[b.zone] || 0) + 1;
      byLevel[b.level] = (byLevel[b.level] || 0) + 1;
    }
    const bs = S.batcher ? S.batcher.stats() : { draws: 0, tris: 0 };
    return { count, byZone, byLevel, drawCalls: bs.draws, triangles: bs.tris };
  },
};

function makeDynMats(ctx) {
  const m = ctx.materials;
  return {
    // Lit-window overlay: was flat black plastic (emissiveIntensity 0 by day reads as a painted-black square,
    // not glass - round-1 review item 4). Using glass() instead gives it clearcoat + slight opacity/reflection
    // like real dark tinted glass by day, while still lighting up warm/cool at night same as before.
    winWarm: m.glass('black', { emissive: 'brightYellow', emissiveIntensity: 0, roughness: 0.22, opacity: 0.86 }),
    winCool: m.glass('black', { emissive: 'transBlue', emissiveIntensity: 0, roughness: 0.22, opacity: 0.86 }),
    porchWarm: m.plastic('black', { emissive: 'brightYellow', emissiveIntensity: 0, roughness: 0.4, clearcoat: 0.25 }),
    chimneyGlow: m.plastic('darkStoneGrey', { emissive: 'brightOrange', emissiveIntensity: 0, roughness: 0.45 }),
    beacon: m.plastic('black', { emissive: 'brightRed', emissiveIntensity: 0, roughness: 0.3 }),
    signGlow: m.plastic('white', { emissive: 'brightYellow', emissiveIntensity: 0, roughness: 0.4, clearcoat: 0.4 }),
  };
}

function updateNight(ctx, isNight, daylight) {
  const t = THREE.MathUtils.clamp(1 - daylight / 0.35, 0, 1);
  const d = S.dynMats;
  d.winWarm.emissiveIntensity = t * 2.8;
  d.winCool.emissiveIntensity = t * 2.6;
  d.porchWarm.emissiveIntensity = t * 2.0;
  d.chimneyGlow.emissiveIntensity = t * 3.8;
  d.beacon.emissiveIntensity = t * 5.5;
  d.signGlow.emissiveIntensity = t * 3.0;
}

function closeupPreset() {
  const t = S.closeupTarget;
  if (!t) return { pos: [22, 14, 22], target: [0, 8, 0] };
  // Distance must clear the footprint (a wide low building otherwise puts the camera on/inside the roof
  // looking straight down) as well as scale with height for a tall tower; cap the camera's rise so it never
  // climbs above a sane viewing angle even for very tall towers.
  const dist = Math.max(t.footprintDiag * 1.9 + 12, t.height * 0.65, 20);
  const camY = Math.min(t.height * 0.4, dist * 0.5) + 2;
  return {
    pos: [t.x + dist * 0.62, t.baseY + camY, t.z + dist * 0.62],
    target: [t.x, t.baseY + t.height * 0.3, t.z], fov: 42,
  };
}

// Bounds of whatever is currently staged (default/levels/night all differ in spread), so the camera never ends
// up clipped inside a building - a fixed offset from "map center" isn't safe once footprints vary in size.
function computeBounds(placed) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of placed) {
    const info = S.batcher.get(p.id);
    if (!info) continue;
    minX = Math.min(minX, info.cx); maxX = Math.max(maxX, info.cx);
    minZ = Math.min(minZ, info.cz); maxZ = Math.max(maxZ, info.cz);
  }
  if (minX === Infinity) return null;
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, spanX: maxX - minX, spanZ: maxZ - minZ };
}

function defaultPreset() {
  const b = S.stageBounds;
  if (!b) return { pos: [40, 26, 46], target: [0, 6, 0] };
  const dist = Math.max(60, b.spanX * 0.42);
  return { pos: [b.cx - dist * 0.5, dist * 0.4 + 8, b.cz + dist * 0.95], target: [b.cx + dist * 0.15, 8, b.cz - dist * 0.05] };
}

function levelsPreset() {
  const b = S.stageBounds;
  if (!b) return { pos: [0, 40, 70], target: [0, 8, 0] };
  const dist = Math.max(80, b.spanX * 0.62);
  return { pos: [b.cx, dist * 0.46 + 10, b.cz + dist], target: [b.cx, 12, b.cz] };
}

export default {
  id: 'buildings',
  deps: ZONING_PRESENT ? ['terrain', 'roads', 'zoning'] : ['terrain', 'roads'],
  order: 40,
  api,
  showcaseVariants: ['default', 'levels', 'night'],
  presets: {
    'buildings:default': defaultPreset,
    'buildings:closeup': closeupPreset,
    'buildings:levels': levelsPreset,
  },

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('buildings');
    S.growthRng = S.rng.fork('growth');
    S.group = new THREE.Group();
    S.group.name = 'buildings';
    ctx.scene.add(S.group);
    S.dynMats = makeDynMats(ctx);
    S.batcher = new BuildingBatcher(ctx, S.group, S.dynMats);
    S.indicators = new UnservedIndicators();
    S.group.add(S.indicators.group);
    S.fireIndicators = new FireIndicators();
    S.group.add(S.fireIndicators.group);
    S.fireDrones = new FireDrones();
    S.group.add(S.fireDrones.group);
    S.pendingDirty = false; S.growthAcc = 0; S.growthTick = 0; S.tweens.length = 0; S.closeupTarget = null; S.stageBounds = null;
    S.levelUpQueue.length = 0; S.levelUpQueued = new Set();

    S.unsub.push(ctx.events.on('building:spawned', ({ building }) => regenerateBuilding(ctx, building)));
    S.unsub.push(ctx.events.on('building:removed', ({ building }) => { S.batcher.remove(building.id); markDirty(); }));
    S.unsub.push(ctx.events.on('sim:tick', () => {
      const sim = ctx.modules.get('simulation');
      if (sim?.status === 'ok' && typeof sim.api?.getUnservedBuildings === 'function') {
        S.indicators.sync(sim.api.getUnservedBuildings() || [], S.batcher);
      }
      if (sim?.status === 'ok' && typeof sim.api?.getBurningBuildings === 'function') {
        const burning = sim.api.getBurningBuildings() || [];
        S.fireIndicators.sync(burning, S.batcher);
        S.fireDrones.sync(burning, sim.api.getFireDispatch, S.batcher);
      }
    }));
    S.unsub.push(ctx.events.on('time:changed', ({ isNight, daylight }) => updateNight(ctx, isNight, daylight)));
    updateNight(ctx, ctx.clock.isNight, ctx.clock.daylight);

    // pick up any buildings that already exist in the world (e.g. reload mid-game)
    for (const b of ctx.world.buildings.values()) regenerateBuilding(ctx, b);
    S.batcher.flush();
  },

  update(dt, ctx) {
    if (ctx.showcase) {
      // Showcases are short, one-shot screenshot sessions: keep the old coalesce-then-flush-synchronously
      // behaviour so staged buildings are fully built (not mid-rebuild) the moment the critic/shot tool
      // captures a frame.
      if (S.pendingDirty && performance.now() - S.lastEvent > REBUILD_DEBOUNCE_MS) {
        S.batcher.flush();
        S.pendingDirty = false;
      }
    } else {
      // Full game: flushIncremental() is cheap to call every frame (an immediate no-op once nothing's dirty)
      // and internally time-slices whatever merge work IS pending, so there's no need to wait on the showcase
      // debounce first — draining as soon as something's dirty just means a rebuild starts (and finishes)
      // sooner, with no risk of any single frame paying for more than REBUILD_BUDGET_MS of merge work.
      S.batcher.flushIncremental(REBUILD_BUDGET_MS);
      // Likewise drain any level-ups autoGrowthPass queued below, a few at a time (see LEVEL_UP_BUDGET_MS) -
      // this is what actually eliminated the 500-600ms stall (root-caused to this loop, not the batcher - see
      // LEVEL_UP_BUDGET_MS comment above).
      drainLevelUps(ctx, LEVEL_UP_BUDGET_MS);
    }
    updateTweens(dt);
    S.fireIndicators?.update(dt);
    S.fireDrones?.update(dt, ctx);
    if (ctx.showcase) return; // auto-growth only runs in the full game
    S.growthAcc += dt;
    if (S.growthAcc >= GROWTH_INTERVAL) {
      S.growthAcc = 0;
      autoGrowthPass(ctx);
    }
  },

  dispose(ctx) {
    for (const off of S.unsub) { try { off(); } catch (_) { /* ignore */ } }
    S.unsub.length = 0;
    for (const tw of S.tweens) { S.group.remove(tw.mesh); tw.mesh.geometry.dispose(); tw.mesh.material.dispose(); }
    S.tweens.length = 0;
    S.batcher?.dispose();
    S.batcher = null;
    S.indicators?.dispose();
    S.indicators = null;
    S.fireIndicators?.dispose();
    S.fireIndicators = null;
    S.fireDrones?.dispose();
    S.fireDrones = null;
    S.levelUpQueue.length = 0;
    S.levelUpQueued = null;
    if (S.group) ctx.scene.remove(S.group);
    S.group = null;
  },

  async showcase(ctx, variant = 'default') {
    S.variant = variant;
    const rng = S.rng.fork(`showcase:${variant}`);
    let result;
    if (variant === 'levels') result = stageLevels(ctx.world, rng);
    else if (variant === 'night') result = stageNight(ctx.world, rng);
    else result = stageDefault(ctx.world, rng);
    S.batcher.flush();
    // Pick the tallest by actual generated height (not zone `level` - industrial stays low-rise at every
    // level, so a level+footprint-area heuristic here previously chose a wide shed over an actual skyscraper).
    let tallestInfo = null, tallestRec = null;
    for (const p of result.placed) {
      const info = S.batcher.get(p.id);
      if (info && (!tallestInfo || info.height > tallestInfo.height)) { tallestInfo = info; tallestRec = p; }
    }
    if (tallestInfo) {
      const footprintDiag = Math.hypot(tallestRec.w * ctx.world.cellSize, tallestRec.d * ctx.world.cellSize) / 2;
      S.closeupTarget = { x: tallestInfo.cx, z: tallestInfo.cz, baseY: tallestInfo.baseY, height: tallestInfo.height, footprintDiag };
    }
    S.stageBounds = computeBounds(result.placed);
    ctx.log(`[buildings] showcase '${variant}': ${result.placed.length} buildings staged`);
  },
};
