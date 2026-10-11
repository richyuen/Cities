// simulation — deterministic, cheap city economy (RCI). Owns world.stats. Emits sim:tick at 2 Hz of game time.
// Visuals exist only in showcase mode (Blox bar chart + DOM panel); in the full game this module is data-only.

import { SimModel, TICK_DT, cityNameFor, POWER_RADIUS, WATER_RADIUS, POLICE_RADIUS, SCHOOL_RADIUS, HOSPITAL_RADIUS } from './model.js';
import { POLICIES, POLICY_BY_ID, policyEffectText } from './policies.js';
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
    powerCoverage: st.powerCoverage, waterCoverage: st.waterCoverage, transitCoverage: st.transitCoverage,
    educationCoverage: st.educationCoverage, healthCoverage: st.healthCoverage, policeCoverage: st.policeCoverage,
  });
}

function runTick(silent = false) {
  const { ctx, model } = S;
  const st = model.step(ctx.world);
  publish(st);
  for (const id of model.newCandidates) {
    const b = ctx.world.buildings.get(id);
    if (b) ctx.events.emit('sim:levelup', { building: b });
  }
  // One-time milestone rewards (cash + cosmetic badge; no tool gating). `silent` is used by warm-up ticks
  // (demo's boot warm-up) so already-earned levels do not toast before the player sees the city.
  if (!silent) for (const m of model.newMilestones) ctx.events.emit('sim:milestone', m);
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
  /** Debit the treasury by `amount`; returns false (no-op) if unaffordable (always true under free build). */
  spend(amount) { return S.model.spend(amount); },
  /** Free construction mode: `spend()` charges nothing and `tools` treats funds as unlimited; the rest of the
   *  economy runs as usual. Saved with the simulation state. Emits settings:changed { freeBuild }. */
  setFreeBuild(on) {
    const v = !!on;
    if (S.model.freeBuild === v) return;
    S.model.freeBuild = v;
    S.ctx.events.emit('settings:changed', { freeBuild: v });
  },
  getFreeBuild() { return !!S.model.freeBuild; },
  /** 0..1 fraction of RCI capacity within power/water/education/health coverage. */
  getUtilityCoverage() { return S.model.getUtilityCoverage(); },
  /** { powered, watered, policed, schooled, hospitaled, roadConnected } for a building id, or null if untracked. */
  getBuildingCoverage(id) { return S.model.getBuildingCoverage(id); },
  /** ids of tracked buildings currently missing road, power, or water. */
  getUnservedBuildings() { return S.model.getUnservedBuildings(); },
  /** Read-only per-cell coverage grid (Uint8Array, 1 = covered) for 'power'|'water'|'police'|'fire'|
   * 'school'|'hospital'|'park'|'road'; recomputes stale grids first, so it is correct even while the game is paused.
   * Do not mutate — the returned array is the model's own. */
  getCoverageGrid(layer) { S.model.ensureStatic(S.ctx.world); return S.model.coverageGrid(layer); },
  /** utility coverage radius in cells (Chebyshev; multiply by ctx.world.cellSize for meters). */
  getUtilityRadii() { return { power: POWER_RADIUS, water: WATER_RADIUS, police: POLICE_RADIUS, school: SCHOOL_RADIUS, hospital: HOSPITAL_RADIUS }; },
  /** police coverage radius in cells (Chebyshev). */
  getPoliceRadii() { return { police: POLICE_RADIUS }; },
  /** { crime, policeCoverage, burglaries } — crime/policeCoverage are 0..1, burglaries is the active count. */
  getCrime() { return S.model.getCrime(); },
  /** Transit coverage (0..1) pushed by the transit module; feeds happiness, traffic relief, and demand. */
  setTransitCoverage(v) { S.model.transitCoverage = Math.max(0, Math.min(1, Number(v) || 0)); },
  getTransitCoverage() { return S.model.transitCoverage; },
  /** Bus network upkeep in $/tick, pushed by transit; shows up as its own budget expense line. */
  setTransitUpkeep(v) { S.model.transitUpkeep = Math.max(0, Number(v) || 0); },
  getTransitUpkeep() { return S.model.transitUpkeep; },
  /** Rider fare income in $/tick, pushed by transit; shows up as its own budget income line (C5). */
  setTransitFareRevenue(v) { S.model.transitFare = Math.max(0, Number(v) || 0); },
  getTransitFareRevenue() { return S.model.transitFare; },
  /** Active-disaster insurance/cleanup cost in $/tick, pushed by the `disasters` module while a hazard is live;
   *  shows up as its own budget expense line (D2). */
  setDisasterCost(v) { S.model.disasterCost = Math.max(0, Number(v) || 0); },
  getDisasterCost() { return S.model.disasterCost; },
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
  /** Toggle a policy by id (see policies.js): { ok, reason?, active: [ids] }. Effects apply on the next tick. */
  setPolicy(id, on) {
    const r = S.model.setPolicy(String(id ?? ''), !!on);
    return { ...r, active: S.model.getActivePolicies() };
  },
  /** { active: [ids], list: [{ id, label, desc, upkeep, effects, effectText, active }], upkeepPerTick, upkeepPerDay } —
   *  the UI renders straight from this. */
  getPolicy() {
    const active = S.model.getActivePolicies();
    const list = POLICIES.map((p) => ({
      id: p.id, label: p.label, desc: p.desc, upkeep: p.upkeep, effects: { ...p.effects },
      effectText: policyEffectText(p.effects), active: active.includes(p.id),
    }));
    const upkeepPerTick = list.reduce((s, p) => s + (p.active ? p.upkeep : 0), 0);
    return { active, list, upkeepPerTick, upkeepPerDay: upkeepPerTick * (S.model.dayLengthSec / TICK_DT) };
  },
  /** force one tick now (tools/tests); `silent` skips the milestone toast (used by warm-up loops) */
  tick(silent = false) { runTick(!!silent); return api.getStats(); },
  /** [{ level, name, pop, reward: { cash, badge }, claimed }] — the city milestone table. */
  getMilestones() { return S.model.getMilestones(); },
  getClaimedMilestones() { return S.model.getClaimedMilestones(); },
  reset() {
    S.model.reset();
    S.model.syncBuildings(S.ctx.world);
    S.grid.markDirty();
    S.acc = 0;
    publish(S.model.stats);
    S.ctx.events.emit('sim:reset', {});
  },
  /** Full round-trippable state for save/load: base policy knobs, active policy ids, tax rates, the raw stats
   *  snapshot, per-building occupancy/maturity (the world replay rebuilds the buildings; the model needs its
   *  progression restored) and the claimed milestone set. */
  getState() {
    const m = S.model;
    // `live`: the model's own running fields (stats only mirrors them once per tick, rounded).
    const live = { money: m.money, tick: m.tick, gameSeconds: m.gameSeconds, happiness: m.happiness, pressure: { ...m.pressure } };
    return { policy: { ...m.basePolicy }, policies: m.getActivePolicies(), taxRate: { ...m.taxRate }, transitUpkeep: m.transitUpkeep, freeBuild: !!m.freeBuild, stats: snapshot(m.stats), live, occupancy: m.getOccupancyState(), milestones: m.getClaimedMilestones() };
  },
  /** Restore exactly what getState() returned (used by menu's Load) — no synthetic tick warm-up: a loaded save
   * should look exactly as it did when saved, unlike a freshly generated city which has no history to restore. */
  loadState(patch) {
    if (!patch) return;
    // C2: the active policy set (unknown ids from a future save are skipped). `patch.policy` is the legacy
    // pre-C2 scenario multiplier patch — old saves stored it instead, so keep honouring it as the base knobs.
    if (Array.isArray(patch.policies)) S.model.policies = new Set(patch.policies.filter((id) => POLICY_BY_ID.has(id)));
    if (patch.policy) Object.assign(S.model.basePolicy, patch.policy);
    if (patch.taxRate) S.model.taxRate = { ...patch.taxRate };
    if (typeof patch.transitUpkeep === 'number') S.model.transitUpkeep = patch.transitUpkeep;
    // Free construction is a per-save mode (saves from before it existed load with it off).
    api.setFreeBuild(patch.freeBuild === true);
    if (patch.stats) {
      Object.assign(S.model.stats, patch.stats);
      // crime is a model field, not just a stat — restore it too, or the loaded city restarts at crime 0 and
      // ramps back up over the next few game-minutes (firePressure is transient and deliberately not restored).
      if (typeof patch.stats.crime === 'number') S.model.crime = patch.stats.crime;
    }
    // Treasury, tick and day live on the model, not in stats: without this the next tick overwrites the loaded
    // stats with the freshly booted model's values (the save "lost" its money and restarted at day 1). Saves
    // from before `live` existed fall back to the stats snapshot.
    const ps = patch.stats || {};
    S.model.restoreLive(patch.live || { money: ps.money, tick: ps.tick, happiness: ps.happiness, demand: ps.demand });
    // Claimed milestones must be restored before the next tick: an old save without the field claims everything
    // up to its current level silently, so the load never re-grants cash the player already earned.
    S.model.applyMilestones(patch.milestones, patch.stats?.cityLevel ?? S.model.stats.cityLevel ?? 0);
    S.model.syncBuildings(S.ctx.world);
    // Restore per-building progression after the world replay rebuilt the building list — otherwise every loaded
    // building restarts at the initial occupancy and the city's population collapses on the first tick.
    S.model.applyOccupancyState(patch.occupancy);
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
    // One city name everywhere: the player's (`?city=`, set by New City / Load) wins. Without it the game uses the
    // same default the HUD and menus show; only the showcase keeps its seeded name for the in-world sign.
    const seededName = cityNameFor(S.rng.fork('name'));
    S.model = new SimModel({ dayLengthSec: ctx.clock.dayLengthSec, cityName: ctx.params?.get('city') || (ctx.showcase ? seededName : 'Brickport') });
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
    S.model.basePolicy = { demandBias: pol.demandBias, upkeepMul: pol.upkeepMul, incomeMul: pol.incomeMul };
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
