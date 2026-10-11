// disasters — city-scale hazards. One tornado at a time (owner pick, Wave D2), which takes the city apart brick by
// brick (D3).
//
// The funnel travels along the world wind direction and damages every building within OUTER_R using the existing
// fire damage model (b.damage 0..1 -> FIRE_DAMAGE_CAP_LOSS capacity loss, FIRE_REPAIR_RATE repair). Damage is billed
// through simulation.setDisasterCost ($/tick, its own budget expense line).
//
// Inside CORE_R the damage is also made visible:
//   - a building is stripped from the top down as its damage rises (windows, roof pieces, trim: `SHED_CURVE`), each
//     part hidden at once through buildings.api.hideParts and released as bricks in its own colours;
//   - at damage 1 the rest of it is torn into bricks and the building is removed from the world. The lot keeps its
//     zoning, and when the storm has gone it is handed to buildings.api.requestRegrowth, so the city builds a new
//     starter there ahead of its other empty land;
//   - trees, street furniture, sidewalk figures and cars in the core are picked up too.
// Bricks fly in the vortex, rain down and lie as rubble for RUBBLE_SEC (bricks.js). Outside the core nothing is
// shown or removed: those buildings only carry the hidden damage and repair on their own, as before.
//
// Which buildings are stripped is this module's own state (S.shedding), never read off b.damage alone: fires write
// the same field, and a fire scar must not strip a facade.
// No THREE here outside visuals.js / bricks.js; everything that decides what happens is deterministic (module rng
// forks, no runtime rng). The flight of a released brick integrates the frame's dt and is presentation only.
import { createTornadoVisuals } from './visuals.js';
import { createBrickPool } from './bricks.js';
import { brickify, shedOrder } from './brickify.js';
import { stageCity } from '../simulation/citygen.js';

// One commented block of numbers — tune in-browser like every other module's constants.
const MAX_ACTIVE = 1;
export const LIFE_SEC = 60;            // total tornado lifetime (game seconds)
export const SPEED = 11;               // m/s along the wind direction
export const CORE_R = 30;              // m: full damage inside this radius
export const OUTER_R = 70;             // m: damage falls to zero here (quadratic falloff)
export const DAMAGE_PER_SEC = 0.55;    // damage/sec at the core at full strength (1.0 = total capacity loss cap)
export const RAMP_IN_SEC = 2;          // strength fade-in
export const RAMP_OUT_SEC = 4;         // strength fade-out before it dissipates
export const INSURANCE_RATE = 900;     // $ billed per full damage unit applied (insurance + cleanup); a fully wrecked
                                       // building costs $900, so even a 40-building tornado totals ~$25–35k. The
                                       // budget line is a rate ($/tick while the storm is live) — it naturally spikes
                                       // while the core is over dense blocks and returns to 0 with the storm.
const WIND_MIN = 0.15;                 // |wind| below this = calm -> deterministic fallback direction
export const SHED_START = 0.35;        // damage at which a core building starts losing parts
export const DESTROY_AT = 1.0;         // damage at which it is torn down
const MAX_DESTROY_PER_FRAME = 2;       // spreads the brick spawn and the removal events of a dense block
const MAX_BRICKS = 600;                // per building (brickify thins courses above this)
const SWEEP_SEC = 0.25;                // how often props and cars in the core are picked up
const PROP_BATCH_SEC = 1;              // picked-up props leave the world in batches (one props rebuild per batch)
const PROP_PARTS_MAX = 10;             // pieces drawn per prop
const PLUCK_SEC = 20;                  // a picked-up car stays off the road this long
const CRASH_PER_SEC = 3;               // collapse sound rate limit
const STORM_WEATHER = { kind: 'rain', intensity: 0.9 };
const STORM_WIND = 7;                  // |wind| while a storm is live (audio: >= 3 already reads as a gale)
const SHOWCASE_PRESTEP = 150;          // 1/60 s steps run when the storm showcase is staged (bricks already flying)

/** Share of a core building's loose parts gone at damage d. */
export function SHED_CURVE(d) { return d <= SHED_START ? 0 : Math.pow(Math.min(1, (d - SHED_START) / (DESTROY_AT - SHED_START)), 1.4); }

const S = {
  ctx: null, rng: null, visuals: null, bricks: null, active: [], pendingCost: 0, nextId: 1, subs: [], time: 0,
  shedding: new Map(),     // building id -> { gen, order, shown, bySrc, rng } (stripped by a storm, until repaired)
  destroyed: 0,            // buildings torn down by the current (or last) storm
  totalDestroyed: 0,
  prevWeather: null,       // the weather to give back when the storm ends
  stormWeather: null,      // the weather this module set (to tell it from somebody else's)
  sweepAcc: 0, batchAcc: 0, propQueue: [], propTaken: new Set(), propsTaken: 0, carsTaken: 0,
  regrow: [],              // lots of buildings this storm destroyed ({ i, j }), handed to buildings when it ends
  crashAt: -1e9,
};

function uiApi(ctx) { const m = ctx.modules.get('ui'); return m?.status === 'ok' ? m.api : null; }
function modApi(id) { const m = S.ctx?.modules.get(id); return m?.status === 'ok' ? m.api : null; }
function buildingsApi() { const a = modApi('buildings'); return a && typeof a.getParts === 'function' && typeof a.hideParts === 'function' ? a : null; }

function normalize(x, z) { const h = Math.hypot(x, z); return h > 1e-6 ? { x: x / h, z: z / h } : { x: 1, z: 0 }; }

function strengthFor(age, life) {
  const inK = RAMP_IN_SEC > 0 ? Math.min(1, age / RAMP_IN_SEC) : 1;
  const outK = RAMP_OUT_SEC > 0 ? Math.min(1, Math.max(0, (life - age) / RAMP_OUT_SEC)) : 1;
  return Math.max(0, Math.min(inK, outK));
}

// ---- storm weather -------------------------------------------------------------------------------------------
function sameWeather(a, b) {
  return !!a && !!b && a.kind === b.kind && Math.abs((a.intensity || 0) - (b.intensity || 0)) < 1e-6
    && Math.abs((a.wind?.[0] || 0) - (b.wind?.[0] || 0)) < 1e-6 && Math.abs((a.wind?.[1] || 0) - (b.wind?.[1] || 0)) < 1e-6;
}
function copyWeather(w) { return { kind: w.kind, intensity: w.intensity, wind: [w.wind?.[0] || 0, w.wind?.[1] || 0] }; }

/** Storm sky for tornado `t`: remembered once, set once (a weather change re-renders the environment map). */
function beginStormWeather(t) {
  const world = S.ctx.world;
  const storm = { ...STORM_WEATHER, wind: [t.dirX * STORM_WIND, t.dirZ * STORM_WIND] };
  if (!S.prevWeather) S.prevWeather = copyWeather(world.weather);
  S.stormWeather = storm;
  if (!sameWeather(world.weather, storm)) world.setWeather(copyWeather(storm));
}

function endStormWeather() {
  const prev = S.prevWeather, storm = S.stormWeather;
  S.prevWeather = null; S.stormWeather = null;
  if (!prev) return;
  const world = S.ctx.world;
  // only give the old weather back if the sky is still the one this module set (the player may have changed it)
  if (storm && sameWeather(world.weather, storm) && !sameWeather(world.weather, prev)) world.setWeather(copyWeather(prev));
}

function cleanWeather(w) {
  if (!w || typeof w.kind !== 'string' || !['clear', 'cloudy', 'rain', 'fog'].includes(w.kind)) return null;
  const n = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : 0);
  return { kind: w.kind, intensity: n(w.intensity, 0, 1), wind: [n(w.wind?.[0], -20, 20), n(w.wind?.[1], -20, 20)] };
}

// ---- tornado lifecycle ---------------------------------------------------------------------------------------
function spawn({ x = 0, z = 0, dirX, dirZ, age = 0, life = LIFE_SEC } = {}) {
  if (S.active.length >= MAX_ACTIVE) return null;
  const wind = S.ctx.world.weather?.wind || [1, 0];
  let dir = (dirX !== undefined || dirZ !== undefined)
    ? normalize(dirX || 0, dirZ || 0)
    : (Math.hypot(wind[0], wind[1]) >= WIND_MIN ? normalize(wind[0], wind[1]) : normalize(...fallbackDir()));
  // never start at strength 0: a tornado spawned while the clock is paused must be visible immediately
  const a0 = Math.max(age, RAMP_IN_SEC * 0.3);
  const t = { id: S.nextId++, x, z, dirX: dir.x, dirZ: dir.z, age: a0, life, strength: strengthFor(a0, life) };
  S.active.push(t);
  S.destroyed = 0;
  beginStormWeather(t); // after the direction is fixed: the storm's own wind must not steer it
  S.ctx.events.emit('disaster:tornado', { id: t.id, x: t.x, z: t.z, dirX: t.dirX, dirZ: t.dirZ });
  return t;
}

function fallbackDir() {
  const a = S.rng.fork('dir').range(0, Math.PI * 2);
  return [Math.cos(a), Math.sin(a)];
}

/** The one way a tornado ends. `why`: 'expired' | 'clear' | 'load' | 'dispose'. */
function endTornado(t, why) {
  const k = S.active.indexOf(t);
  if (k >= 0) S.active.splice(k, 1);
  flushProps();
  // The city rebuilds once the storm is gone: the destroyed lots (zoning kept) go to the front of the growth queue.
  // Not while it is still on the ground, or a starter house would pop up under the funnel.
  if (S.regrow.length && why === 'expired') modApi('buildings')?.requestRegrowth?.(S.regrow);
  S.regrow.length = 0;
  if (why !== 'load') endStormWeather(); // a load decides the weather itself (see loadState)
  if (why === 'dispose') return;
  if (why === 'expired') {
    const n = S.destroyed;
    uiApi(S.ctx)?.notify?.(`\u{1F32A} Tornado dissipated: ${n} building${n === 1 ? '' : 's'} destroyed`, n ? 'warn' : 'info');
  }
  S.ctx.events.emit('disaster:ended', { id: t.id, destroyed: S.destroyed });
}

function clear(why = 'clear') {
  for (const t of [...S.active]) endTornado(t, why);
  S.active.length = 0;
  S.pendingCost = 0;
  S.sweepAcc = 0; S.batchAcc = 0;
  if (S.visuals) S.visuals.group.visible = false;
  S.bricks?.clear();
  const sim = S.ctx?.modules.get('simulation');
  if (sim?.status === 'ok') sim.api.setDisasterCost(0);
}

// damage application: quadratically falls off between CORE_R and OUTER_R; a burning building takes half
function applyDamage(t, gdt) {
  const world = S.ctx.world;
  const inv = 1 / (OUTER_R - CORE_R);
  const B = buildingsApi();
  for (const b of world.buildings.values()) {
    const c = world.cellToWorld(b.i + (b.w - 1) / 2, b.j + (b.d - 1) / 2);
    const d = Math.hypot(c.x - t.x, c.z - t.z);
    if (d > OUTER_R) continue;
    const q = d <= CORE_R ? 1 : Math.max(0, 1 - (d - CORE_R) * inv);
    const amt = DAMAGE_PER_SEC * q * q * t.strength * gdt * (b.onFire ? 0.5 : 1);
    const before = b.damage || 0;
    const after = Math.min(1, before + amt);
    if (after > before) {
      b.damage = after;
      S.pendingCost += (after - before) * INSURANCE_RATE;
      S.ctx.events.emit('disaster:damage', { id: b.id, amount: after - before, damage: after });
    }
    // only the core takes buildings apart; the outer ring keeps its hidden damage and repairs
    if (B && d <= CORE_R && t.strength > 0 && !S.shedding.has(b.id)) {
      const sh = buildShed(B, b, t.id);
      if (sh) S.shedding.set(b.id, sh);
    }
  }
}

// ---- brick destruction ---------------------------------------------------------------------------------------
function colorOf(name) { const c = S.ctx.materials.color(name); return [c.r, c.g, c.b]; }

function buildShed(B, b, tid) {
  const P = B.getParts(b.id);
  if (!P) return null;
  const rng = S.rng.fork(`${tid}:${b.id}`);
  const bySrc = new Map();
  for (const br of brickify(P.parts, colorOf, rng, { maxBricks: MAX_BRICKS })) {
    let list = bySrc.get(br.src);
    if (!list) { list = []; bySrc.set(br.src, list); }
    list.push(br);
  }
  return { gen: P.gen, order: shedOrder(P.parts), shown: 0, bySrc, rng };
}

const _v = [0, 0, 0];
/** Launch velocity for a brick at (x, z): swept round the funnel and up, plus seeded scatter. */
function kick(x, z, rng, lift = 1) {
  const t = S.active[0];
  let tx = 0, tz = 0;
  if (t) { const dx = x - t.x, dz = z - t.z, r = Math.hypot(dx, dz) || 1; tx = -dz / r; tz = dx / r; }
  const sweep = rng.range(3, 12);
  _v[0] = tx * sweep + rng.range(-5, 5);
  _v[1] = (2 + rng.range(0, 11)) * lift;
  _v[2] = tz * sweep + rng.range(-5, 5);
  return _v;
}

function releaseParts(sh, indices) {
  for (const idx of indices) {
    const list = sh.bySrc.get(idx);
    if (!list) continue;
    sh.bySrc.delete(idx);
    for (const br of list) S.bricks.spawn(br, kick(br.x, br.z, sh.rng), sh.rng);
  }
}

function crashSound(b) {
  const now = performance.now();
  if (now - S.crashAt < 1000 / CRASH_PER_SEC) return;
  S.crashAt = now;
  const audio = modApi('audio');
  if (!audio?.play) return;
  const c = S.ctx.world.cellToWorld(b.i + (b.w - 1) / 2, b.j + (b.d - 1) / 2);
  try { audio.play('crash', { x: c.x, y: S.ctx.world.getHeight(c.x, c.z), z: c.z }); } catch (_) { /* ignore */ }
}

/** Strip, re-strip and tear down. Runs every frame a storm is live or a stripped building still stands. */
function updateShedding() {
  if (!S.shedding.size) return;
  const B = buildingsApi();
  if (!B) return;
  const world = S.ctx.world;
  const doomed = [];
  for (const [id, sh] of S.shedding) {
    const b = world.buildings.get(id);
    if (!b) { S.shedding.delete(id); continue; } // bulldozed by the player
    const gen = B.getGen(id);
    if (gen !== sh.gen) {
      // regenerated under us (a level-up): the part indices are new, strip the same share again, silently
      const fresh = buildShed(B, b, 0);
      if (!fresh) { S.shedding.delete(id); continue; }
      fresh.rng = sh.rng;
      fresh.shown = sh.order.length ? Math.round((sh.shown / sh.order.length) * fresh.order.length) : 0;
      const gone = fresh.order.slice(0, fresh.shown);
      B.hideParts(id, gone);
      for (const idx of gone) fresh.bySrc.delete(idx);
      S.shedding.set(id, fresh);
      continue;
    }
    const want = Math.round(SHED_CURVE(b.damage || 0) * sh.order.length);
    if (want > sh.shown) {
      const idxs = sh.order.slice(sh.shown, want);
      B.hideParts(id, idxs);
      releaseParts(sh, idxs);
      sh.shown = want;
    }
    if ((b.damage || 0) >= DESTROY_AT && S.active.length) doomed.push(id);
  }
  // removals happen here, after the damage loop over world.buildings has finished
  for (const id of doomed.slice(0, MAX_DESTROY_PER_FRAME)) {
    const sh = S.shedding.get(id), b = world.buildings.get(id);
    B.hideParts(id, 'all');
    releaseParts(sh, [...sh.bySrc.keys()]);
    S.shedding.delete(id);
    S.destroyed++; S.totalDestroyed++;
    crashSound(b);
    if (b.zone) for (let j = b.j; j < b.j + b.d; j++) for (let i = b.i; i < b.i + b.w; i++) S.regrow.push({ i, j });
    world.removeBuilding(id);
  }
}

/** sim:tick: a stripped building whose damage has repaired below SHED_START gets its facade back. */
function repairStripped() {
  if (!S.shedding.size) return;
  const B = buildingsApi();
  if (!B) return;
  for (const [id, sh] of S.shedding) {
    const b = S.ctx.world.buildings.get(id);
    if (!b) { S.shedding.delete(id); continue; }
    if ((b.damage || 0) >= SHED_START) continue;
    if (S.active.length && sh.shown === 0) continue; // only just entered the core: nothing to restore yet
    if (sh.shown > 0) B.regenerate(id);
    S.shedding.delete(id);
  }
}

// ---- props and cars ------------------------------------------------------------------------------------------
function sweepLoose(t) {
  const world = S.ctx.world;
  const r = CORE_R * Math.min(1, t.strength * 1.5);
  if (r <= 1) return;
  const r2 = r * r;
  const props = modApi('props');
  if (props && typeof props.getPropParts === 'function' && typeof props.hideProps === 'function') {
    const taken = [];
    for (const p of world.props.values()) {
      const dx = p.x - t.x, dz = p.z - t.z;
      if (dx * dx + dz * dz > r2 || S.propTaken.has(p.id)) continue;
      // authored set-pieces and junction signals stay (a signal-less junction would stop traffic for good)
      if ((typeof p.id === 'string' && p.id.startsWith('sp:')) || p.nodeId != null || p.kind === 'traffic_light') continue;
      taken.push(p.id);
    }
    if (taken.length) {
      const rng = S.rng.fork(`props:${t.id}:${S.propsTaken}`);
      for (const id of taken) {
        const parts = props.getPropParts(id) || [];
        const step = Math.max(1, Math.ceil(parts.length / PROP_PARTS_MAX));
        for (let k = 0; k < parts.length; k += step) {
          const pt = parts[k];
          if (!(pt.size[0] > 0.04 && pt.size[1] > 0.04 && pt.size[2] > 0.04)) continue;
          S.bricks.spawn({
            kind: 'box', x: pt.center[0], y: pt.center[1], z: pt.center[2],
            sx: Math.max(0.25, pt.size[0]), sy: Math.max(0.25, pt.size[1]), sz: Math.max(0.25, pt.size[2]), rotY: pt.rotY, color: pt.color,
          }, kick(pt.center[0], pt.center[2], rng, 1.2), rng);
        }
        S.propTaken.add(id);
        S.propQueue.push(id);
      }
      props.hideProps(taken);
      S.propsTaken += taken.length;
    }
  }
  const traffic = modApi('traffic');
  if (traffic && typeof traffic.pluckVehicles === 'function') {
    const cars = traffic.pluckVehicles(t.x, t.z, r, PLUCK_SEC);
    if (cars.length) {
      const rng = S.rng.fork(`cars:${t.id}:${S.carsTaken}`);
      for (const c of cars) {
        S.bricks.spawn({
          kind: 'box', x: c.x, y: c.y + c.height / 2, z: c.z, sx: c.length, sy: c.height, sz: c.width, rotY: -c.heading, color: c.color,
        }, kick(c.x, c.z, rng, 1.4), rng);
      }
      S.carsTaken += cars.length;
    }
  }
}

/** Picked-up props leave the world here, in one batch (every removal re-lays the whole props layer). */
function flushProps() {
  if (!S.propQueue.length || !S.ctx) return;
  const world = S.ctx.world;
  for (const id of S.propQueue) { if (world.props.has(id)) world.removeProp(id); S.propTaken.delete(id); }
  S.propQueue.length = 0;
}

/** Advance the storm by `gdt` game seconds. */
function stepStorm(gdt) {
  for (let i = S.active.length - 1; i >= 0; i--) {
    const t = S.active[i];
    t.x += t.dirX * SPEED * gdt;
    t.z += t.dirZ * SPEED * gdt;
    t.age += gdt;
    t.strength = strengthFor(t.age, t.life);
    if (gdt > 0) {
      applyDamage(t, gdt);
      S.sweepAcc += gdt;
      if (S.sweepAcc >= SWEEP_SEC) { S.sweepAcc = 0; sweepLoose(t); }
      S.batchAcc += gdt;
      if (S.batchAcc >= PROP_BATCH_SEC) { S.batchAcc = 0; flushProps(); }
    }
    if (t.age >= t.life) endTornado(t, 'expired');
  }
  updateShedding();
}

function funnel() {
  const t = S.active[0];
  if (!t) return null;
  return { x: t.x, z: t.z, gy: S.ctx.world.getHeight(t.x, t.z), vx: t.dirX * SPEED, vz: t.dirZ * SPEED, strength: t.strength, outerR: OUTER_R };
}

const api = {
  /** Drop a tornado at (x,z); direction defaults to the world wind (deterministic fallback when calm). */
  spawnTornado(opts = {}) {
    const t = spawn(opts);
    if (!t) return null;
    uiApi(S.ctx)?.notify?.('\u{1F32A} Tornado on the ground!', 'warn');
    const audio = S.ctx.modules.get('audio');
    if (audio?.status === 'ok') { try { audio.api?.play?.('error', { x: t.x, y: S.ctx.world.getHeight(t.x, t.z), z: t.z }); } catch (_) { /* ignore */ } }
    return t.id;
  },
  /** [{ id, x, z, dirX, dirZ, age, life, strength }] — read-only copies. */
  getActive() { return S.active.map((t) => ({ ...t })); },
  /** Total damage still un-repaired across the city, 0..1 × buildings (a rough "how bad was it" read). */
  getDamageTotal() { let s = 0; for (const b of S.ctx.world.buildings.values()) s += b.damage || 0; return s; },
  /** Counters for the HUD, tools and checks: { destroyed (this storm), totalDestroyed, stripped, hiddenParts,
   * propsTaken, carsTaken, bricks: { live, rubble, fading, spawned, dropped, recycled, spawnHash, ... } }. */
  getStats() {
    let stripped = 0, hiddenParts = 0;
    for (const sh of S.shedding.values()) { if (sh.shown > 0) stripped++; hiddenParts += sh.shown; }
    return {
      destroyed: S.destroyed, totalDestroyed: S.totalDestroyed, stripped, hiddenParts, tracked: S.shedding.size,
      propsTaken: S.propsTaken, carsTaken: S.carsTaken, bricks: S.bricks ? S.bricks.stats() : null,
    };
  },
  /** End the storm now and drop every brick. Stripped buildings stay stripped until their damage repairs. */
  clear() { clear('clear'); },
  getState() {
    const out = { tornadoes: S.active.map((t) => ({ id: t.id, x: t.x, z: t.z, dirX: t.dirX, dirZ: t.dirZ, age: t.age, life: t.life })) };
    const shed = [];
    for (const [id, sh] of S.shedding) if (sh.shown > 0) shed.push({ id });
    out.shedding = shed;
    out.prevWeather = S.prevWeather ? copyWeather(S.prevWeather) : null;
    out.regrow = S.active.length ? S.regrow.map((c) => ({ i: c.i, j: c.j })) : [];
    return out;
  },
  loadState(patch) {
    // Weather: menu/serialize.js has already applied the save's own weather (the storm sky, if it was saved
    // mid-storm) before calling this. So nothing is restored on the way out of the old state, unless the sky is
    // still exactly the one this module set and the incoming state has no storm to keep it for.
    const hadPrev = S.prevWeather, hadStorm = S.stormWeather;
    const state = patch && typeof patch === 'object' ? JSON.parse(JSON.stringify(patch)) : null; // may be our own live arrays
    patch = state;
    clear('load');
    const world = S.ctx.world;
    const cs = world.cellSize || 8;
    const maxX = world.size.w * cs / 2 + cs, maxZ = world.size.h * cs / 2 + cs;
    for (const t of (patch?.tornadoes || []).slice(0, MAX_ACTIVE)) {
      // sanitise a crafted/corrupt save: finite numbers only, inside the map, a real direction, a sane lifetime
      if (![t.x, t.z, t.dirX, t.dirZ].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      const x = t.x, z = t.z;
      const dir = normalize(t.dirX, t.dirZ);
      const age = Math.min(Math.max(Number.isFinite(t.age) ? t.age : 0, 0), LIFE_SEC);
      const life = Math.min(Math.max(Number.isFinite(t.life) ? t.life : LIFE_SEC, 1), LIFE_SEC * 4);
      S.nextId = Math.max(S.nextId, (t.id | 0) + 1);
      S.active.push({
        id: t.id | 0 || S.nextId++, x: Math.min(maxX, Math.max(-maxX, x)), z: Math.min(maxZ, Math.max(-maxZ, z)),
        dirX: dir.x, dirZ: dir.z, age, life, strength: strengthFor(age, life),
      });
    }
    if (S.active.length) {
      // lots the saved storm had already emptied: still to be handed over for regrowth when it ends
      for (const c of (Array.isArray(patch?.regrow) ? patch.regrow : []).slice(0, 4096)) {
        if (c && Number.isInteger(c.i) && Number.isInteger(c.j) && world.inBounds(c.i, c.j)) S.regrow.push({ i: c.i, j: c.j });
      }
      S.prevWeather = cleanWeather(patch?.prevWeather) || hadPrev || null;
      S.stormWeather = hadStorm;
      beginStormWeather(S.active[0]); // a no-op when the sky is already the storm's
    } else {
      S.prevWeather = hadPrev; S.stormWeather = hadStorm;
      endStormWeather();
    }
    // Stripped facades: re-apply them from the buildings' saved damage (the same curve, so nothing reappears).
    // Entries for buildings the incoming state does not list are dropped; if such a building is still the very
    // one that was stripped (a loadState on the live world, not a rebuilt one), it gets its facade back.
    const B = buildingsApi();
    const listed = new Set((Array.isArray(patch?.shedding) ? patch.shedding : []).map((e) => e?.id).filter((id) => id != null));
    for (const [id, sh] of [...S.shedding]) {
      const same = B && world.buildings.has(id) && B.getGen(id) === sh.gen;
      if (same && listed.has(id)) continue;
      if (same && sh.shown > 0) B.regenerate(id);
      S.shedding.delete(id);
    }
    if (B) {
      for (const id of listed) {
        const b = world.buildings.get(id);
        if (!b || S.shedding.has(id) || (b.damage || 0) < SHED_START) continue;
        const sh = buildShed(B, b, S.active[0]?.id ?? 0);
        if (!sh) continue;
        sh.shown = Math.round(SHED_CURVE(b.damage) * sh.order.length);
        const gone = sh.order.slice(0, sh.shown);
        B.hideParts(id, gone);
        for (const idx of gone) sh.bySrc.delete(idx);
        S.shedding.set(id, sh);
      }
    }
    syncVisuals(0);
  },
};

function syncVisuals(time = 0) {
  const t = S.active[0];
  if (!t) { S.visuals.group.visible = false; }
  else S.visuals.update(t, time, S.ctx.world.getHeight(t.x, t.z));
}

/** Where the presets should look: the live tornado, else the district centre (world origin). */
function focusPoint() {
  const t = S.active[0];
  const x = t ? t.x : 0, z = t ? t.z : 0;
  return { x, z, gy: S.ctx?.world ? S.ctx.world.getHeight(x, z) : 0 };
}

export default {
  id: 'disasters',
  // a tornado needs a city to hit: the damage model only needs simulation, but the module's showcase stages a real
  // district and expects terrain/roads/buildings to render it (full game has them anyway).
  deps: ['simulation', 'terrain', 'roads', 'buildings'],
  order: 65,
  showcaseVariants: ['default', 'storm'],
  // presets frame the live tornado when there is one (critic batches pause the clock, so the funnel stays where
  // the storm variant spawned it); without one they frame the district centre.
  presets: {
    'disasters:overview': () => {
      const f = focusPoint();
      return { pos: [f.x + 130, f.gy + 118, f.z + 210], target: [f.x, f.gy + 8, f.z] };
    },
    'disasters:closeup': () => {
      const f = focusPoint();
      return { pos: [f.x - 96, f.gy + 13, f.z + 2], target: [f.x, f.gy + 30, f.z], fov: 46 };
    },
    'disasters:ground': () => {
      const f = focusPoint();
      return { pos: [f.x - 56, f.gy + 5, f.z + 5], target: [f.x, f.gy + 34, f.z], fov: 52 };
    },
  },
  api,

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('disasters');
    S.visuals = createTornadoVisuals(ctx, S.rng.fork('visuals'));
    ctx.scene.add(S.visuals.group);
    S.bricks = createBrickPool(ctx, S.rng.fork('bricks'));
    ctx.scene.add(S.bricks.group);
    S.shedding.clear(); S.propQueue.length = 0; S.propTaken.clear(); S.regrow.length = 0;
    S.destroyed = 0; S.totalDestroyed = 0; S.propsTaken = 0; S.carsTaken = 0; S.prevWeather = null; S.stormWeather = null;
    // push the accrued insurance cost on every simulation tick (same one-tick pattern as transit upkeep)
    S.subs.push(ctx.events.on('sim:tick', () => {
      repairStripped();
      const sim = ctx.modules.get('simulation');
      if (sim?.status !== 'ok') return;
      // pendingCost is everything accrued since the previous tick, i.e. exactly the amount this tick should bill
      // (the model adds `disasterCost` once per step). Dividing by TICK_DT would bill every dollar twice.
      sim.api.setDisasterCost(S.pendingCost);
      S.pendingCost = 0;
    }));
  },

  update(dt, ctx) {
    const gdt = ctx.clock.paused ? 0 : dt * ctx.clock.timeScale;
    if (S.active.length) stepStorm(gdt);
    else updateShedding(); // a stripped building that levels up is re-stripped; a bulldozed one is forgotten
    S.bricks.update(gdt, funnel(), S.time += dt);
    if (S.active.length || S.visuals.group.visible) syncVisuals(S.time);
  },

  async showcase(ctx, variant = 'default') {
    clear();
    S.shedding.clear();
    const rng = S.rng.fork(`showcase:${variant}`);
    const city = stageCity(ctx.world, rng, { blocksPerAxis: 4, variant: 'default' });
    const i0 = city.i0, j0 = city.j0;
    // service the district (2 power plants + 2 water towers on the empty land just outside the street grid) so the
    // unserved-building warning icons do not litter the storm shots
    const mid = Math.floor(city.span / 2);
    for (const [kind, i, j, w, d] of [
      ['power_plant', i0 + mid - 1, j0 - 4, 3, 3],
      ['power_plant', i0 + mid - 1, j0 + city.span + 1, 3, 3],
      ['water_tower', i0 - 4, j0 + mid - 1, 2, 2],
      ['water_tower', i0 + city.span + 1, j0 + mid - 1, 2, 2],
    ]) ctx.world.addBuilding({ i, j, w, d, zone: null, kind, level: 1 });
    if (variant === 'storm') {
      // deterministic mid-district storm ON A STREET INTERSECTION (street grid: i0+4a / j0+4a) so the funnel is not
      // hidden behind the showcase's own tower and the streets give it clean sightlines. Critic batches pause the
      // clock (setTime), so this is where every still frame catches it — heading east along a fixed path.
      // It is dropped a little upwind and stepped forward a fixed number of fixed steps, so the frame it is caught
      // in already has bricks in the air, stripped facades and rubble behind it.
      const c = ctx.world.cellToWorld(i0 + 12, j0 + 8);
      const lead = SHOWCASE_PRESTEP / 60;
      S.time = 0;
      spawn({ x: c.x - SPEED * lead, z: c.z, dirX: 1, dirZ: 0, age: 20 - lead });
      for (let k = 0; k < SHOWCASE_PRESTEP; k++) {
        stepStorm(1 / 60);
        S.bricks.update(1 / 60, funnel(), S.time += 1 / 60);
      }
      syncVisuals(0);
    }
    ctx.log(`[disasters] showcase '${variant}': ${city.buildingIds.length} buildings, ${S.active.length} tornado(es), ${S.destroyed} destroyed, ${S.bricks.stats().spawned} bricks`);
  },

  dispose() {
    for (const off of S.subs) off();
    S.subs.length = 0;
    clear('dispose');
    S.shedding.clear();
    if (S.visuals) { S.ctx?.scene.remove(S.visuals.group); S.visuals.dispose(); S.visuals = null; }
    if (S.bricks) { S.ctx?.scene.remove(S.bricks.group); S.bricks.dispose(); S.bricks = null; }
  },
};
