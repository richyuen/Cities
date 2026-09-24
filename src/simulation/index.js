// simulation — deterministic, cheap city economy (RCI). Owns world.stats. Emits sim:tick at 2 Hz of game time.
// Visuals exist only in showcase mode (Blox bar chart + DOM panel); in the full game this module is data-only.

import { SimModel, TICK_DT, cityNameFor, POWER_RADIUS, WATER_RADIUS, POLICE_RADIUS } from './model.js';
import { DesirabilityGrid } from './desirability.js';
import { stageCity } from './citygen.js';
import { createVisuals } from './visuals.js';
import { createPanel } from './panel.js';

const MAX_TICKS_PER_FRAME = 8;
const SHOWCASE_TIMESCALE = 12;       // 24 ticks/s; the chart visibly moves
// bust warms up far longer than the other variants: live testing (model.js probe) shows debt saturates at 1.0 around
// tick ~2660 and the city is declared `bankrupt` (BANKRUPT_HOLD_TICKS later, ~3060); the treasury then settles onto
// its emergency-receivership floor by ~tick 4400. 4800 puts the bust showcase past that — the distress banner is up
// and the treasury has visibly stopped sliding, not just barely tripped — matching what a "long bust" should show.
const WARMUP_TICKS = { default: 420, boom: 380, bust: 4800 };
const POLICY = {
  default: { demandBias: 0, upkeepMul: 1, incomeMul: 1, tax: 0.09, money: 50000 },
  boom: { demandBias: 0.35, upkeepMul: 1, incomeMul: 1.1, tax: 0.07, money: 60000 },
  bust: { demandBias: -0.8, upkeepMul: 2.5, incomeMul: 0.6, tax: 0.14, money: 9000 },
};

const S = {
  ctx: null, model: null, grid: null, rng: null, acc: 0, frame: 0, subs: [], visuals: null, panel: null, variant: null,
};

function chartZFor(world) {
  // south edge of the showcase district + margin (mirrors citygen's layout math)
  const span = 6 * 4 + 1;
  const j0 = Math.floor(world.size.h / 2 - span / 2);
  return world.cellToWorld(0, j0 + span - 1).z + world.cellSize / 2 + 22;
}

function snapshot(st) {
  return { ...st, capacity: { ...st.capacity }, occupancy: { ...st.occupancy }, demand: { ...st.demand } };
}

function publish(st) {
  const { ctx } = S;
  ctx.world.setStats({
    population: st.population, jobs: st.jobs, money: st.money, happiness: st.happiness, traffic: st.traffic,
    employment: st.employment, demand: { ...st.demand }, day: st.day, tick: st.tick,
    cityName: st.cityName, cityLevel: st.cityLevel, cityLevelName: st.cityLevelName,
  });
}

function runTick() {
  const { ctx, model } = S;
  const st = model.step(ctx.world);
  publish(st);
  for (const id of model.newCandidates) {
    const b = ctx.world.buildings.get(id);
    if (b) ctx.events.emit('sim:levelup', { building: b });
  }
  const stats = snapshot(st);
  ctx.events.emit('sim:tick', { tick: st.tick, stats, demand: { ...model.demand }, day: st.day });
  if (S.visuals) S.visuals.onTick(st);
  if (S.panel) S.panel.update(st, model.getHistory(), model.getBudget().perDay, model.taxRate);
}

function disposeShowcase() {
  S.visuals?.dispose(); S.visuals = null;
  S.panel?.dispose(); S.panel = null;
}

const api = {
  /** RCI demand, each in [0,1] */
  getDemand() { return { ...S.model.demand }; },
  /** raw smoothed pressure in [-1,1] (negative = people/jobs leaving) */
  getPressure() { return { ...S.model.pressure }; },
  getStats() { return snapshot(S.model.stats); },
  getBudget() { return S.model.getBudget(); },
  setTaxRate(zone, rate) { return S.model.setTaxRate(zone, rate); },
  getTaxRate(zone) { return zone ? S.model.taxRate[zone] : { ...S.model.taxRate }; },
  /** Debit the treasury by `amount`; returns false (no-op) if unaffordable. */
  spend(amount) { return S.model.spend(amount); },
  /** 0..1 fraction of RCI capacity within power/water coverage. */
  getUtilityCoverage() { return S.model.getUtilityCoverage(); },
  /** { powered, watered, policed, roadConnected } for a building id, or null if untracked. */
  getBuildingCoverage(id) { return S.model.getBuildingCoverage(id); },
  /** ids of tracked buildings currently missing road, power, or water. */
  getUnservedBuildings() { return S.model.getUnservedBuildings(); },
  /** utility coverage radius in cells (Chebyshev; multiply by ctx.world.cellSize for meters). */
  getUtilityRadii() { return { power: POWER_RADIUS, water: WATER_RADIUS, police: POLICE_RADIUS }; },
  /** police coverage radius in cells (Chebyshev). */
  getPoliceRadii() { return { police: POLICE_RADIUS }; },
  /** { crime, policeCoverage, burglaries } — crime/policeCoverage are 0..1, burglaries is the active count. */
  getCrime() { return S.model.getCrime(); },
  /** Ignite a building by id (any kind). Returns false if not found or already on fire. */
  igniteBuilding(id) { return S.model.igniteBuilding(id); },
  /** ids of buildings currently on fire. */
  getBurningBuildings() { return S.model.getBurningBuildings(); },
  /** { stationId, elapsed, duration } dispatch info for a burning building, or null. */
  getFireDispatch(id) { return S.model.getFireDispatch(id); },
  /** Start a burglary on a building by id (any kind). Returns false if not found, already burgled, or on fire. */
  startBurglary(id) { return S.model.startBurglary(id); },
  /** ids of buildings currently being burgled. */
  getBurglaries() { return S.model.getBurglaries(); },
  /** { stationId, elapsed, duration } dispatch info for a burgled building, or null. */
  getBurglary(id) { return S.model.getBurglary(id); },
  /** 0..1 desirability of cell (i,j) for `zone` ('r'|'c'|'i'; default: the cell's zone, else 'r') */
  cellDesirability(i, j, zone) { S.grid.ensure(S.frame); return S.grid.get(i, j, zone); },
  /** chronological copy of the last ≤300 ticks */
  getHistory() { return S.model.getHistory(); },
  /** ids of buildings that should level up (occupancy ≥ 0.9 for a while and positive demand); buildings module acts */
  getGrowthCandidates() { return [...S.model.growth]; },
  setPolicy(patch) { Object.assign(S.model.policy, patch); return { ...S.model.policy }; },
  getPolicy() { return { ...S.model.policy }; },
  /** force one tick now (tools/tests) */
  tick() { runTick(); return api.getStats(); },
  reset() {
    S.model.reset();
    S.model.syncBuildings(S.ctx.world);
    S.grid.markDirty();
    S.acc = 0;
    publish(S.model.stats);
    S.ctx.events.emit('sim:reset', {});
  },
  /** Full round-trippable state for save/load: policy, tax rates, and the raw stats snapshot. */
  getState() {
    return { policy: { ...S.model.policy }, taxRate: { ...S.model.taxRate }, stats: snapshot(S.model.stats) };
  },
  /** Restore exactly what getState() returned (used by menu's Load) — no synthetic tick warm-up: a loaded save
   * should look exactly as it did when saved, unlike a freshly generated city which has no history to restore. */
  loadState(patch) {
    if (!patch) return;
    if (patch.policy) Object.assign(S.model.policy, patch.policy);
    if (patch.taxRate) S.model.taxRate = { ...patch.taxRate };
    if (patch.stats) {
      Object.assign(S.model.stats, patch.stats);
      // crime is a model field, not just a stat — restore it too, or the loaded city restarts at crime 0 and
      // ramps back up over the next few game-minutes (firePressure is transient and deliberately not restored).
      if (typeof patch.stats.crime === 'number') S.model.crime = patch.stats.crime;
    }
    S.model.syncBuildings(S.ctx.world);
    S.grid.markDirty();
    S.acc = 0;
    publish(S.model.stats);
    S.ctx.events.emit('sim:reset', {});
  },
  ticksPerSecond: 1 / TICK_DT,
};

export default {
  id: 'simulation',
  deps: [],
  order: 60,
  showcaseVariants: ['default', 'boom', 'bust'],
  presets: {
    'simulation:default': (world) => { const z = chartZFor(world); return { pos: [40, 22, z + 44], target: [0, 6, z - 4] }; },
    'simulation:closeup': (world) => { const z = chartZFor(world); return { pos: [-15, 21, z + 40], target: [-7, 6, z - 2] }; },
    'simulation:city': (world) => { const z = chartZFor(world); return { pos: [92, 74, z + 52], target: [-36, 0, -4] }; },
  },
  api,

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('simulation');
    S.model = new SimModel({ dayLengthSec: ctx.clock.dayLengthSec, cityName: cityNameFor(S.rng.fork('name')) });
    S.grid = new DesirabilityGrid(ctx.world);
    S.model.syncBuildings(ctx.world);
    publish(S.model.stats);
    const ev = ctx.events;
    S.subs.push(
      ev.on('building:spawned', ({ building }) => { S.model.addBuilding(building); S.grid.markDirty(); }),
      ev.on('building:removed', ({ building }) => { S.model.removeBuilding(building.id); S.grid.markDirty(); }),
      ev.on('road:added', () => S.grid.markDirty()),
      ev.on('road:removed', () => S.grid.markDirty()),
      ev.on('road:changed', () => { S.grid.markDirty(); S.model.markDirty(); }),
      ev.on('zone:changed', () => S.grid.markDirty()),
      ev.on('world:cell', () => { S.grid.markDirty(); S.model.markDirty(); }),
    );
  },

  update(dt, ctx) {
    S.frame++;
    if (!ctx.clock.paused && ctx.clock.timeScale > 0) S.acc += dt * ctx.clock.timeScale;
    let n = 0;
    while (S.acc >= TICK_DT && n < MAX_TICKS_PER_FRAME) { S.acc -= TICK_DT; runTick(); n++; }
    if (S.acc > TICK_DT * 4) S.acc = TICK_DT * 4; // drop backlog after a stall
    if (S.visuals) S.visuals.update(dt);
  },

  dispose() {
    disposeShowcase();
    for (const off of S.subs) off();
    S.subs.length = 0;
  },

  async showcase(ctx, variant = 'default') {
    disposeShowcase();
    const pol = POLICY[variant] || POLICY.default;
    S.variant = variant;
    const rng = S.rng.fork(`city:${variant}`);
    S.model.reset({ money: pol.money, occupancy: 0.35 });
    S.model.policy = { demandBias: pol.demandBias, upkeepMul: pol.upkeepMul, incomeMul: pol.incomeMul };
    S.model.taxRate = { r: pol.tax, c: pol.tax, i: pol.tax };
    const city = stageCity(ctx.world, rng, { variant });
    S.model.syncBuildings(ctx.world);
    S.grid.markDirty();
    // warm-up so the chart and history are meaningful in a still screenshot (silent: no events)
    const warm = WARMUP_TICKS[variant] ?? WARMUP_TICKS.default;
    for (let k = 0; k < warm; k++) S.model.step(ctx.world);
    publish(S.model.stats);
    S.acc = 0;
    const ts = Number(ctx.params.get('timescale'));
    ctx.clock.timeScale = ts > 0 ? ts : SHOWCASE_TIMESCALE;
    S.visuals = createVisuals(ctx, { model: S.model, city, rng: rng.fork('visuals'), chartZ: chartZFor(ctx.world) });
    S.panel = createPanel(ctx.dom, { perDayTicks: ctx.clock.dayLengthSec / TICK_DT });
    S.panel.update(S.model.stats, S.model.getHistory(), S.model.getBudget().perDay, S.model.taxRate);
    ctx.log(`[simulation] showcase '${variant}': ${city.buildingIds.length} buildings, ${city.roadIds.length} road edges, ${city.parkBlocks.length} park blocks, ${city.emptyLots.length} empty lots, warmed ${warm} ticks → pop ${S.model.stats.population}, money ${S.model.stats.money}`);
  },
};
