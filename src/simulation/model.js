// Pure, deterministic city economy (RCI model). No THREE, no DOM — runs in Node for benchmarks.
// All numbers derive from world.buildings / world.cells / world.roads and the module's own state; no randomness
// beyond a per-building integer hash (so same seed → same numbers).

export const TICK_DT = 0.5;                  // game seconds per tick (2 Hz)
export const HISTORY_LEN = 300;
export const ZONES = ['r', 'c', 'i'];
/** capacity per cell by zone and level (index = level 1..3) */
export const CAPACITY = { r: [0, 16, 48, 140], c: [0, 6, 20, 60], i: [0, 10, 24, 50] };
export const LEVEL_NAMES = ['Hamlet', 'Village', 'Town', 'City', 'Metropolis', 'Megalopolis'];
export const LEVEL_POP = [0, 400, 2000, 8000, 30000, 100000];
/** money per tick per unit (person / job) at 100% tax */
export const TAX_YIELD = { r: 0.08, c: 0.18, i: 0.15 };
export const UPKEEP = { road: 0.15, building: 0.08 };
export const WORKFORCE_SHARE = 0.55;
export const PARK_RADIUS = 6;                 // cells (Chebyshev)
export const POWER_RADIUS = 18;                // cells (Chebyshev) — one plant covers a real district
export const WATER_RADIUS = 14;                // cells (Chebyshev)
export const UNSERVED_OCC_CAP = 0.22;          // occupancy ceiling for a building missing power or water
export const UPKEEP_UTILITY = { power_plant: 4.5, water_tower: 2 };  // money/tick, each
/** money feedback: debt of DEBT_SCALE = full service degradation; wealth of WEALTH_SCALE = full wealth bonus */
export const DEBT_SCALE = 120000;
export const WEALTH_SCALE = 250000;
/** distress: once debt has been fully saturated (1.0) for this many ticks running, the city is declared bankrupt */
export const BANKRUPT_HOLD_TICKS = 400;             // 200 game-seconds of sustained, total insolvency
/** once bankrupt, an emergency-receivership floor arrests the slide instead of letting money count down forever */
export const BANKRUPT_FLOOR = -DEBT_SCALE * 1.6;
export const BANKRUPT_SPRING = 0.02;                // per-tick pull back toward the floor once below it

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (v) => clamp(v, 0, 1);

/** Deterministic [0,1) hash of an integer. */
function hashInt(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function cityLevelFor(pop) {
  let lvl = 0;
  for (let k = 0; k < LEVEL_POP.length; k++) if (pop >= LEVEL_POP[k]) lvl = k;
  return lvl;
}

const SYL_A = ['Brick', 'Stud', 'Plate', 'Block', 'Tile', 'Lego', 'Peg', 'Knob', 'Clutch', 'Minifig', 'Bevel', 'Baseplate'];
const SYL_B = ['haven', 'port', 'ville', 'burg', 'ford', 'field', 'ton', 'mouth', 'bridge', 'stead', 'wick', 'dale'];
export function cityNameFor(rng) {
  return rng.pick(SYL_A) + rng.pick(SYL_B);
}

export class SimModel {
  constructor({ dayLengthSec = 600, cityName = 'Brickhaven' } = {}) {
    this.dayLengthSec = dayLengthSec;
    this.cityName = cityName;
    this.taxRate = { r: 0.09, c: 0.09, i: 0.09 };
    this.policy = { demandBias: 0, upkeepMul: 1, incomeMul: 1 };
    this.reset();
  }

  reset({ money = 50000, occupancy = 0.35 } = {}) {
    this.tick = 0;
    this.gameSeconds = 0;
    this.day = 1;
    this.startOccupancy = occupancy;
    this.pressure = { r: 0.2, c: 0.1, i: 0.1 };      // smoothed, [-1, 1]
    this.demand = { r: 0.2, c: 0.1, i: 0.1 };        // clamped [0, 1]
    this.happiness = 0.7;
    this.traffic = 0;
    this.money = money;
    this.stats = this._blankStats();
    this.history = new Array(HISTORY_LEN);
    this.histHead = 0; this.histCount = 0;
    this.list = [];                                   // [{ b, occ, rate, level, mature, nearPark, notified }]
    this.byId = new Map();
    this.dirtyStatic = true;
    this.parkCoverage = null;
    this.powerCoverage = null;
    this.waterCoverage = null;
    this.utilities = [];                               // { id, kind: 'power_plant'|'water_tower', i, j, w, d }
    this.roadCells = 0;
    this.growth = [];                                 // building ids that should level up (refreshed per tick)
    this.newCandidates = [];                          // ids that became candidates this tick
    this.budget = { income: { r: 0, c: 0, i: 0, total: 0 }, expenses: { roads: 0, buildings: 0, utilities: 0, total: 0 }, net: 0 };
    this.debt = 0;                                    // 0..1 service degradation from a negative treasury
    this.wealth = 0;                                  // 0..1 bonus from a healthy treasury
    this.bankruptTicks = 0;                            // consecutive ticks with debt saturated at 1.0
    this.bankrupt = false;                             // true once that has held for BANKRUPT_HOLD_TICKS
  }

  _blankStats() {
    return {
      population: 0, jobs: 0, money: this.money, happiness: this.happiness, traffic: 0, employment: 1,
      workforce: 0, capacity: { r: 0, c: 0, i: 0 }, occupancy: { r: 0, c: 0, i: 0 }, jobsC: 0, jobsI: 0,
      demand: { r: 0, c: 0, i: 0 }, parkShare: 0, income: 0, expenses: 0, buildings: 0, roads: 0, net: 0, debt: 0, wealth: 0, services: 1,
      bankrupt: false, bankruptTicks: 0, powerCoverage: 0, waterCoverage: 0,
      day: 1, tick: 0, cityName: this.cityName, cityLevel: 0, cityLevelName: LEVEL_NAMES[0],
    };
  }

  // ---- building bookkeeping ---------------------------------------------------------------------
  _entry(b) {
    // seed from the building's own seed + id (order-independent: removing/adding others never changes a rate)
    let idh = 0; const id = String(b.id ?? '');
    for (let k = 0; k < id.length; k++) idh = (Math.imul(idh, 31) + id.charCodeAt(k)) | 0;
    const seed = ((b.seed | 0) ^ Math.imul(idh, 0x27d4eb2f)) | 0;
    return {
      b, occ: this.startOccupancy, rate: 0.005 + 0.012 * hashInt(seed), level: clamp(b.level | 0, 1, 3),
      mature: 0, nearPark: false, powered: false, watered: false, notified: false, cap: 0,
    };
  }

  _isUtilityKind(kind) { return kind === 'power_plant' || kind === 'water_tower'; }

  syncBuildings(world) {
    this.list.length = 0; this.byId.clear(); this.utilities.length = 0;
    for (const b of world.buildings.values()) {
      if (this._isUtilityKind(b.kind)) { this.utilities.push(b); continue; }
      if (!CAPACITY[b.zone]) continue;
      const s = this._entry(b);
      this.list.push(s); this.byId.set(b.id, s);
    }
    this.dirtyStatic = true;
  }

  addBuilding(b) {
    if (!b || this.byId.has(b.id)) return;
    if (this._isUtilityKind(b.kind)) { this.utilities.push(b); this.markDirty(); return; }
    if (!CAPACITY[b.zone]) return;
    const s = this._entry(b);
    this.list.push(s); this.byId.set(b.id, s);
    if (this.parkCoverage) {
      s.nearPark = this.parkCoverage[b.j * this._w + b.i] === 1;
      s.powered = this.powerCoverage ? this.powerCoverage[b.j * this._w + b.i] === 1 : false;
      s.watered = this.waterCoverage ? this.waterCoverage[b.j * this._w + b.i] === 1 : false;
    } else this.dirtyStatic = true;
  }

  removeBuilding(id) {
    if (this._isUtilityKind(this.utilities.find((u) => u.id === id)?.kind)) {
      this.utilities = this.utilities.filter((u) => u.id !== id);
      this.markDirty();
      return;
    }
    const s = this.byId.get(id);
    if (!s) return;
    this.byId.delete(id);
    const k = this.list.indexOf(s);
    if (k >= 0) this.list.splice(k, 1);
  }

  markDirty() { this.dirtyStatic = true; }

  /** Stamp a 1 within `radius` (Chebyshev cells) of (ci,cj) into `cov` (w×h grid, in-place). */
  static _stampRadius(cov, w, h, ci, cj, radius) {
    const i0 = Math.max(0, ci - radius), i1 = Math.min(w - 1, ci + radius);
    const j0 = Math.max(0, cj - radius), j1 = Math.min(h - 1, cj + radius);
    for (let j = j0; j <= j1; j++) { const row = j * w; for (let i = i0; i <= i1; i++) cov[row + i] = 1; }
  }

  /** Recompute park/power/water coverage (cells within radius of a source) and per-building flags. */
  _recomputeStatic(world) {
    const w = world.size.w, h = world.size.h, n = w * h;
    this._w = w;
    const parkCov = (this.parkCoverage && this.parkCoverage.length === n) ? this.parkCoverage : new Uint8Array(n);
    parkCov.fill(0);
    const cells = world.cells;
    const R = PARK_RADIUS;
    let roadCells = 0;
    for (let k = 0; k < n; k++) {
      const t = cells[k].type;
      if (t === 'road') roadCells++;
      if (t !== 'park') continue;
      const ci = k % w, cj = (k / w) | 0;
      SimModel._stampRadius(parkCov, w, h, ci, cj, R);
    }
    this.parkCoverage = parkCov;
    this.roadCells = roadCells;

    const powerCov = (this.powerCoverage && this.powerCoverage.length === n) ? this.powerCoverage : new Uint8Array(n);
    const waterCov = (this.waterCoverage && this.waterCoverage.length === n) ? this.waterCoverage : new Uint8Array(n);
    powerCov.fill(0); waterCov.fill(0);
    for (const b of this.utilities) {
      const ci = Math.min(w - 1, b.i + ((b.w || 1) >> 1)), cj = Math.min(h - 1, b.j + ((b.d || 1) >> 1));
      if (b.kind === 'power_plant') SimModel._stampRadius(powerCov, w, h, ci, cj, POWER_RADIUS);
      else if (b.kind === 'water_tower') SimModel._stampRadius(waterCov, w, h, ci, cj, WATER_RADIUS);
    }
    this.powerCoverage = powerCov;
    this.waterCoverage = waterCov;

    for (const s of this.list) {
      const idx = s.b.j * w + s.b.i;
      s.nearPark = parkCov[idx] === 1;
      s.powered = powerCov[idx] === 1;
      s.watered = waterCov[idx] === 1;
    }
    this.dirtyStatic = false;
  }

  // ---- the tick --------------------------------------------------------------------------------
  step(world) {
    if (this.dirtyStatic) this._recomputeStatic(world);
    const P = this.pressure, list = this.list;
    let pop = 0, jobsC = 0, jobsI = 0, capR = 0, capC = 0, capI = 0, parkW = 0;
    let poweredCap = 0, wateredCap = 0, totalCap = 0;
    const growth = this.growth; growth.length = 0;
    const fresh = this.newCandidates; fresh.length = 0;
    // neutral demand → ~80% occupied; strong negative demand empties buildings, positive fills them
    const occT = (p) => clamp(0.8 + 0.5 * p, 0.08, 1);
    const tR = occT(P.r), tC = occT(P.c), tI = occT(P.i);

    for (let k = 0, n = list.length; k < n; k++) {
      const s = list[k], b = s.b, zone = b.zone;
      const lvl = b.level < 1 ? 1 : b.level > 3 ? 3 : (b.level | 0);
      if (lvl !== s.level) { s.level = lvl; s.notified = false; s.mature = 0; s.occ *= 0.6; }
      const cap = CAPACITY[zone][lvl] * b.w * b.d;
      s.cap = cap;
      const served = s.powered && s.watered;
      totalCap += cap; if (s.powered) poweredCap += cap; if (s.watered) wateredCap += cap;
      let target = zone === 'r' ? tR : zone === 'c' ? tC : tI;
      if (!served) target = Math.min(target, UNSERVED_OCC_CAP);
      s.occ += (target - s.occ) * s.rate;
      const filled = cap * s.occ;
      if (zone === 'r') { pop += filled; capR += cap; if (s.nearPark) parkW += filled; }
      else if (zone === 'c') { jobsC += filled; capC += cap; }
      else { jobsI += filled; capI += cap; }
      if (s.occ >= 0.9) {
        s.mature++;
        const pz = zone === 'r' ? P.r : zone === 'c' ? P.c : P.i;
        if (served && lvl < 3 && s.mature >= 20 && pz > 0.15) {
          growth.push(b.id);
          if (!s.notified) { s.notified = true; fresh.push(b.id); }
        }
      } else s.mature = 0;
    }

    const jobs = jobsC + jobsI;
    const workforce = pop * WORKFORCE_SHARE;
    const employment = workforce > 1 ? Math.min(1, jobs / workforce) : 1;
    // road units: graph edges; if no graph exists (cells-only roads) ≈ one street segment per 4 road cells
    const roads = world.roads.edges.size || Math.round((this.roadCells || 0) / 4);
    // money feedback: debt starves services (park upkeep, road maintenance → capacity), wealth funds amenities
    const debt = clamp01(-this.money / DEBT_SCALE);
    const wealth = clamp01(this.money / WEALTH_SCALE);
    const services = 1 - 0.6 * debt;
    this.debt = debt; this.wealth = wealth;
    // distress: debt already saturates city services/happiness/demand at debt=1, but the treasury number itself
    // used to slide linearly forever once that happened. Once debt has held at 1.0 for BANKRUPT_HOLD_TICKS running,
    // declare the city bankrupt (a visible, sustained state — see visuals.js' distress banner) and switch the
    // treasury from an unbounded slide to an emergency-receivership floor it settles toward (see money update below).
    this.bankruptTicks = debt >= 1 ? this.bankruptTicks + 1 : 0;
    this.bankrupt = this.bankruptTicks >= BANKRUPT_HOLD_TICKS;
    const roadCap = (roads * 110 + 100) * (1 - 0.35 * debt);   // trips a street edge absorbs before congestion
    const trafficTarget = clamp01((pop * 0.35 + jobs * 0.5) / roadCap);
    this.traffic += (trafficTarget - this.traffic) * 0.1;
    const parkShare = (pop > 1 ? parkW / pop : 0) * services;
    const tax = this.taxRate, pol = this.policy;
    const avgTax = (tax.r + tax.c + tax.i) / 3;
    const taxPain = clamp01((avgTax - 0.09) * 5);
    // a fully employed, park-rich, uncongested, low-tax, solvent city tops out around 0.95
    const hTarget = 0.42 * employment + 0.22 * Math.min(1, parkShare * 1.6) + 0.18 * (1 - this.traffic)
      + 0.1 * (1 - taxPain) + 0.08 * wealth - 0.3 * debt;
    this.happiness += (clamp01(hTarget) - this.happiness) * 0.05;

    // RCI demand pressures (SimCity-style): residential wants a jobs surplus + happiness; commercial follows the
    // workforce; industrial follows the workforce but is crowded out by a commercial glut.
    const wantedPop = jobs / WORKFORCE_SHARE * 1.05 + 150;
    const wantedC = workforce * 0.45 + 20;
    const wantedI = workforce * 0.55 + 30 - 0.5 * Math.max(0, jobsC - wantedC);
    const rel = (want, have) => (want - have) / Math.max(want, have, 1);
    // a bankrupt city (debt → 1) sheds residents and businesses
    const pR = 0.7 * rel(wantedPop, pop) + 0.5 * (this.happiness - 0.5) + 0.15 - (tax.r - 0.09) * 4 + pol.demandBias - 0.5 * debt;
    const pC = rel(wantedC, jobsC) + 0.2 * (this.happiness - 0.5) - (tax.c - 0.09) * 4 + pol.demandBias - 0.4 * debt;
    const pI = rel(wantedI, jobsI) + 0.1 * (this.happiness - 0.5) - (tax.i - 0.09) * 4 + pol.demandBias - 0.4 * debt;
    P.r += (clamp(pR, -1, 1) - P.r) * 0.08;
    P.c += (clamp(pC, -1, 1) - P.c) * 0.08;
    P.i += (clamp(pI, -1, 1) - P.i) * 0.08;
    this.demand.r = clamp01(P.r); this.demand.c = clamp01(P.c); this.demand.i = clamp01(P.i);

    // budget
    const incR = pop * tax.r * TAX_YIELD.r * pol.incomeMul;
    const incC = jobsC * tax.c * TAX_YIELD.c * pol.incomeMul;
    const incI = jobsI * tax.i * TAX_YIELD.i * pol.incomeMul;
    const expRoads = roads * UPKEEP.road * pol.upkeepMul;
    const expBld = list.length * UPKEEP.building * pol.upkeepMul;
    let expUtil = 0;
    for (const u of this.utilities) expUtil += (UPKEEP_UTILITY[u.kind] || 0) * pol.upkeepMul;
    const income = incR + incC + incI, expenses = expRoads + expBld + expUtil;
    this.money += income - expenses;
    if (this.bankrupt && this.money < BANKRUPT_FLOOR) this.money += (BANKRUPT_FLOOR - this.money) * BANKRUPT_SPRING;
    const bg = this.budget;
    bg.income.r = incR; bg.income.c = incC; bg.income.i = incI; bg.income.total = income;
    bg.expenses.roads = expRoads; bg.expenses.buildings = expBld; bg.expenses.utilities = expUtil; bg.expenses.total = expenses;
    bg.net = income - expenses;

    // time
    this.tick++;
    this.gameSeconds += TICK_DT;
    this.day = 1 + Math.floor(this.gameSeconds / this.dayLengthSec);

    const cityLevel = cityLevelFor(pop);
    const st = this.stats;
    st.population = Math.round(pop); st.jobs = Math.round(jobs); st.jobsC = Math.round(jobsC); st.jobsI = Math.round(jobsI);
    st.money = Math.round(this.money); st.happiness = this.happiness; st.traffic = this.traffic;
    st.employment = employment; st.workforce = Math.round(workforce);
    st.capacity.r = capR; st.capacity.c = capC; st.capacity.i = capI;
    st.occupancy.r = capR ? pop / capR : 0; st.occupancy.c = capC ? jobsC / capC : 0; st.occupancy.i = capI ? jobsI / capI : 0;
    st.demand.r = this.demand.r; st.demand.c = this.demand.c; st.demand.i = this.demand.i;
    st.parkShare = parkShare; st.income = income; st.expenses = expenses; st.buildings = list.length; st.roads = roads;
    st.net = income - expenses; st.debt = debt; st.wealth = wealth; st.services = services;
    st.bankrupt = this.bankrupt; st.bankruptTicks = this.bankruptTicks;
    st.powerCoverage = totalCap ? poweredCap / totalCap : 0; st.waterCoverage = totalCap ? wateredCap / totalCap : 0;
    st.day = this.day; st.tick = this.tick; st.cityName = this.cityName; st.cityLevel = cityLevel; st.cityLevelName = LEVEL_NAMES[cityLevel];

    // history ring
    this.history[this.histHead] = {
      tick: this.tick, population: st.population, jobs: st.jobs, money: st.money, happiness: st.happiness,
      traffic: st.traffic, employment, dr: st.demand.r, dc: st.demand.c, di: st.demand.i, net: st.net,
    };
    this.histHead = (this.histHead + 1) % HISTORY_LEN;
    if (this.histCount < HISTORY_LEN) this.histCount++;
    return st;
  }

  getHistory() {
    const out = new Array(this.histCount);
    const start = (this.histHead - this.histCount + HISTORY_LEN) % HISTORY_LEN;
    for (let k = 0; k < this.histCount; k++) out[k] = this.history[(start + k) % HISTORY_LEN];
    return out;
  }

  getBudget() {
    const perDay = this.dayLengthSec / TICK_DT;
    const bg = this.budget;
    return {
      perTick: { income: { ...bg.income }, expenses: { ...bg.expenses }, net: bg.net },
      perDay: {
        income: { r: bg.income.r * perDay, c: bg.income.c * perDay, i: bg.income.i * perDay, total: bg.income.total * perDay },
        expenses: {
          roads: bg.expenses.roads * perDay, buildings: bg.expenses.buildings * perDay,
          utilities: bg.expenses.utilities * perDay, total: bg.expenses.total * perDay,
        },
        net: bg.net * perDay,
      },
      money: this.money, taxRate: { ...this.taxRate },
    };
  }

  setTaxRate(zone, rate) {
    if (!(zone in this.taxRate)) return false;
    this.taxRate[zone] = clamp(Number(rate) || 0, 0, 0.3);
    return true;
  }

  /** One-time capital spend (e.g. placing a utility building): debits the treasury iff affordable. */
  spend(amount) {
    const cost = Number(amount) || 0;
    if (cost <= 0) return true;
    if (this.money < cost) return false;
    this.money -= cost;
    return true;
  }

  /** 0..1 fraction of RCI building capacity currently within power/water coverage. */
  getUtilityCoverage() { return { power: this.stats.powerCoverage || 0, water: this.stats.waterCoverage || 0 }; }

  /** { powered, watered } for any tracked building id; utility buildings themselves always read as served. */
  getBuildingCoverage(id) {
    if (this._isUtilityKind(this.utilities.find((u) => u.id === id)?.kind)) return { powered: true, watered: true };
    const s = this.byId.get(id);
    return s ? { powered: s.powered, watered: s.watered } : null;
  }
}
