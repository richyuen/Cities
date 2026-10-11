// disasters — city-scale hazards. One hazard on the map at a time: a tornado (owner pick, Wave D2), which takes the
// city apart brick by brick (D3), or a kaiju (see the kaiju block below), which does the same on foot.
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
import { createKaijuVisuals } from './kaiju.js';
import {
  K_STEP_LEN, K_TAIL_SEGS, K_RISE_SEC, K_SINK_SEC, K_BREATH_DUR, sideOf, stepPhase, footPlant, tailPoints, mouthPoint, breathT,
} from './kaijuGait.js';
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

// Kaiju (its body and gait numbers live in kaijuGait.js, shared with the rig).
export const K_SPEED = 5;              // m/s on the rampage
const K_LEAVE_SPEED = 7;               // m/s on the way out
const K_FOOT_R = 5;                    // m: a lot within this of a footfall is under the foot
const K_BODY_R = 4;                    // m: likewise round the hips
const K_STOMP_MAX = 3;                 // buildings destroyed per footfall (nearest first)
const K_STOMP_CELLS = 3;               // footfall scan window, cells each way
const K_TREMOR_R = 18;                 // m: a footfall shakes lots this far out...
const K_TREMOR_DAMAGE = 0.25;          // ...by this much hidden damage at the foot, falling to 0 at K_TREMOR_R
const K_TAIL_R = 4;                    // m: a lot within this of a tail joint is hit
const K_TAIL_DAMAGE_PER_SEC = 1.6;
const K_BREATH_FIRST = 4;              // age of the first fire breath
const K_BREATH_PERIOD = 10;            // s between breaths
const K_BREATH_MIN = 8, K_BREATH_RANGE = 70;   // m from the mouth
const K_BREATH_HALF_ANGLE = 0.30;      // rad
const K_BREATH_MAX = 3;                // buildings set alight per breath
export const K_LIFE_SEC = 75;          // rampage budget, game seconds (rise and leave not counted)
export const K_POLICE_DRAIN = 0.75;    // extra budget drain under police coverage...
export const K_FIRE_DRAIN = 0.75;      // ...and under fire-department coverage (both: 2.5x, a ~30 s rampage)
const K_LEAVE_SEC = 10;                // walks toward the nearest map edge this long (still stomping), then sinks
const K_TARGET_R = 250;                // m: how far it looks for something to walk to
const K_ARRIVE_R = 6;
const K_BEHIND = 12;                   // m: ignores what is further behind it than this
const K_RETARGET_SEC = 1;
const K_TURN_RATE = 0.9;               // rad/s
const K_WANDER_SEC = 6;                // with nothing to walk to: a new heading this often
const K_EDGE_M = 60;                   // and back toward the middle this close to a map edge
const K_MAX_BRICKS = 400;              // per building (a footfall is at most K_STOMP_MAX of them)
const K_STOMP_PER_SEC = 3, K_ROAR_PER_SEC = 0.5;   // sound rate limits
const K_SHOWCASE_PRESTEP = 1500;       // most 1/60 s steps run when the kaiju showcase is staged (25 s)

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
  kaiju: null,             // the live kaiju (see the kaiju block below), or null
  kaijuVis: null, footfalls: 0, breaths: 0, ignited: 0, stompAt: -1e9, roarAt: -1e9,
};

function uiApi(ctx) { const m = ctx.modules.get('ui'); return m?.status === 'ok' ? m.api : null; }
function modApi(id) { const m = S.ctx?.modules.get(id); return m?.status === 'ok' ? m.api : null; }
function buildingsApi() { const a = modApi('buildings'); return a && typeof a.getParts === 'function' && typeof a.hideParts === 'function' ? a : null; }

/** A hazard (tornado or kaiju) is on the map. */
function hazardLive() { return S.active.length > 0 || !!S.kaiju; }

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
  if (S.active.length >= MAX_ACTIVE || S.kaiju) return null;
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
  S.ctx.events.emit('disaster:ended', { id: t.id, destroyed: S.destroyed, kind: 'tornado' });
}

function clear(why = 'clear') {
  for (const t of [...S.active]) endTornado(t, why);
  S.active.length = 0;
  if (S.kaiju) endKaiju(S.kaiju, why);
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

/** `kickOrigin`: null = bricks are swept round the funnel; { x, z, mode: 'radial' } = thrown outward from there. */
function buildShed(B, b, hid, kickOrigin = null, maxBricks = MAX_BRICKS) {
  const P = B.getParts(b.id);
  if (!P) return null;
  const rng = S.rng.fork(`${hid}:${b.id}`);
  const bySrc = new Map();
  for (const br of brickify(P.parts, colorOf, rng, { maxBricks })) {
    let list = bySrc.get(br.src);
    if (!list) { list = []; bySrc.set(br.src, list); }
    list.push(br);
  }
  return { gen: P.gen, order: shedOrder(P.parts), shown: 0, bySrc, rng, kick: kickOrigin, maxBricks };
}

const _v = [0, 0, 0];
/** Launch velocity for a brick at (x, z): swept round the funnel and up, plus seeded scatter. With a radial
 * `origin` (a footfall, a tail blow) it is thrown outward from that point instead. */
function kick(x, z, rng, lift = 1, origin = null) {
  if (origin) {
    const dx = x - origin.x, dz = z - origin.z, r = Math.hypot(dx, dz) || 1;
    const out = rng.range(6, 16);
    _v[0] = (dx / r) * out + rng.range(-3, 3);
    _v[1] = (4 + rng.range(0, 12)) * lift;
    _v[2] = (dz / r) * out + rng.range(-3, 3);
    return _v;
  }
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
    for (const br of list) S.bricks.spawn(br, kick(br.x, br.z, sh.rng, 1, sh.kick), sh.rng);
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
      const fresh = buildShed(B, b, 0, sh.kick, sh.maxBricks);
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
    if ((b.damage || 0) >= DESTROY_AT && hazardLive()) doomed.push(id);
  }
  // removals happen here, after the damage loop over world.buildings has finished
  for (const id of doomed.slice(0, MAX_DESTROY_PER_FRAME)) {
    const sh = S.shedding.get(id), b = world.buildings.get(id);
    B.hideParts(id, 'all');
    releaseParts(sh, [...sh.bySrc.keys()]);
    S.shedding.delete(id);
    S.destroyed++; S.totalDestroyed++;
    crashSound(b);
    // its yard dressing leaves the world with it (props does that on building:removed): throw what is still
    // standing now, so nothing is left behind for a frame and props can put off its re-layout
    const props = modApi('props');
    if (props && typeof props.detailProps === 'function' && typeof props.hideProps === 'function') {
      const yard = props.detailProps(id).map((p) => p.id).filter((pid) => !S.propTaken.has(pid));
      if (yard.length) takeProps(props, yard, sh.rng, sh.kick);
    }
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
    if (hazardLive() && sh.shown === 0) continue; // only just entered the core: nothing to restore yet
    if (sh.shown > 0) B.regenerate(id);
    S.shedding.delete(id);
  }
}

// ---- props and cars ------------------------------------------------------------------------------------------
function sweepLoose(t) {
  const r = CORE_R * Math.min(1, t.strength * 1.5);
  if (r > 1) sweepLooseAt(t.x, t.z, r, t.id);
}

/** Pick up the props and cars within `r` of (x, z). `hid` keys the rng forks; `origin` as in kick(). */
function sweepLooseAt(x, z, r, hid, origin = null) {
  const world = S.ctx.world;
  const r2 = r * r;
  const props = modApi('props');
  if (props && typeof props.getPropParts === 'function' && typeof props.hideProps === 'function') {
    const taken = [];
    for (const p of world.props.values()) {
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz > r2 || S.propTaken.has(p.id)) continue;
      // authored set-pieces and junction signals stay (a signal-less junction would stop traffic for good)
      if ((typeof p.id === 'string' && p.id.startsWith('sp:')) || p.nodeId != null || p.kind === 'traffic_light') continue;
      taken.push(p.id);
    }
    if (taken.length) {
      takeProps(props, taken, S.rng.fork(`props:${hid}:${S.propsTaken}`), origin);
      for (const id of taken) S.propQueue.push(id);
    }
  }
  const traffic = modApi('traffic');
  if (traffic && typeof traffic.pluckVehicles === 'function') {
    const cars = traffic.pluckVehicles(x, z, r, PLUCK_SEC);
    if (cars.length) {
      const rng = S.rng.fork(`cars:${hid}:${S.carsTaken}`);
      for (const c of cars) {
        S.bricks.spawn({
          kind: 'box', x: c.x, y: c.y + c.height / 2, z: c.z, sx: c.length, sy: c.height, sz: c.width, rotY: -c.heading, color: c.color,
        }, kick(c.x, c.z, rng, 1.4, origin), rng);
      }
      S.carsTaken += cars.length;
    }
  }
}

/** Throw these props' pieces into the air and stop drawing them. The caller decides when they leave the world. */
function takeProps(props, ids, rng, origin = null) {
  for (const id of ids) {
    const parts = props.getPropParts(id) || [];
    const step = Math.max(1, Math.ceil(parts.length / PROP_PARTS_MAX));
    for (let k = 0; k < parts.length; k += step) {
      const pt = parts[k];
      if (!(pt.size[0] > 0.04 && pt.size[1] > 0.04 && pt.size[2] > 0.04)) continue;
      S.bricks.spawn({
        kind: 'box', x: pt.center[0], y: pt.center[1], z: pt.center[2],
        sx: Math.max(0.25, pt.size[0]), sy: Math.max(0.25, pt.size[1]), sz: Math.max(0.25, pt.size[2]), rotY: pt.rotY, color: pt.color,
      }, kick(pt.center[0], pt.center[2], rng, 1.2, origin), rng);
    }
    S.propTaken.add(id);
  }
  props.hideProps(ids);
  S.propsTaken += ids.length;
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

// ---- kaiju ---------------------------------------------------------------------------------------------------
// A giant brick lizard that walks from tall block to tall block. It does three things to the city: a footfall
// tears down what is under it (and shakes what is near), the swinging tail knocks down what it passes, and every
// K_BREATH_PERIOD seconds it stops and sets up to K_BREATH_MAX buildings ahead of it on fire (simulation's own fire
// model). Its rampage is a budget of K_LIFE_SEC game seconds that police and fire coverage under it drain faster;
// when it is spent the kaiju walks to the nearest map edge and sinks. Everything it decides integrates game dt and
// uses counter-keyed rng forks; where its feet and tail are comes from kaijuGait.js, shared with the rig.
const _tailPts = [];
const _seen = new Set();

function wrapAngle(a) { a = (a + Math.PI) % (Math.PI * 2); return (a < 0 ? a + Math.PI * 2 : a) - Math.PI; }
function mapHalf() { const w = S.ctx.world, cs = w.cellSize || 8; return { x: w.size.w * cs / 2, z: w.size.h * cs / 2 }; }
function centreOf(b) { return S.ctx.world.cellToWorld(b.i + (b.w - 1) / 2, b.j + (b.d - 1) / 2); }
/** Distance from (x, z) to building `b`'s lot (0 inside it). */
function lotDist(b, x, z) {
  const w = S.ctx.world, cs = w.cellSize || 8;
  const x0 = w.minX + b.i * cs, z0 = w.minZ + b.j * cs;
  const dx = Math.max(x0 - x, 0, x - (x0 + b.w * cs)), dz = Math.max(z0 - z, 0, z - (z0 + b.d * cs));
  return Math.hypot(dx, dz);
}
function groundAt(x, z) {
  const t = modApi('terrain');
  const y = t && typeof t.surfaceHeight === 'function' ? t.surfaceHeight(x, z) : NaN;
  return Number.isFinite(y) ? y : S.ctx.world.getHeight(x, z);
}

function newKaiju(id, x, z, heading) {
  const k = {
    id, x, z, heading, age: 0, life: K_LIFE_SEC, walked: 0, steps: 0, phase: 'rise', sinkT: 0, leaveT: 0, leaveHeading: null,
    footL: null, footR: null, target: null, retargetIn: 0, wanderIn: 0, wanderHeading: heading, turns: 0,
    nextBreath: K_BREATH_FIRST, breathUntil: 0, drain: 1, warned: false,
  };
  setFeet(k);
  return k;
}

/** Both feet where the gait has them for the kaiju's present position: the planted one and the one behind it. */
function setFeet(k) {
  const side = sideOf(k.steps);
  const a = footPlant(k, side, k.steps), b = footPlant(k, -side, k.steps - 1);
  if (side > 0) { k.footR = a; k.footL = b; } else { k.footL = a; k.footR = b; }
}

function spawnKaiju({ x = 0, z = 0, heading } = {}) {
  if (hazardLive()) return null;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  // faces the middle of the map unless told otherwise
  const h = Number.isFinite(heading) ? wrapAngle(heading) : (Math.hypot(x, z) > 1 ? Math.atan2(-z, -x) : 0);
  const k = newKaiju(S.nextId++, x, z, h);
  k.age = K_RISE_SEC * 0.4; // never spawn fully underground: one dropped while the clock is paused must be visible
  S.kaiju = k;
  S.destroyed = 0; S.footfalls = 0; S.breaths = 0; S.ignited = 0;
  S.ctx.events.emit('disaster:kaiju', { id: k.id, x: k.x, z: k.z, heading: k.heading });
  return k;
}

/** The one way a kaiju ends. `why`: 'left' | 'clear' | 'load' | 'dispose'. */
function endKaiju(k, why) {
  if (S.kaiju === k) S.kaiju = null;
  flushProps();
  if (S.regrow.length && why === 'left') modApi('buildings')?.requestRegrowth?.(S.regrow);
  S.regrow.length = 0;
  if (S.kaijuVis) S.kaijuVis.group.visible = false;
  if (why === 'dispose') return;
  if (why === 'left') {
    const n = S.destroyed;
    uiApi(S.ctx)?.notify?.(`\u{1F996} The kaiju has left: ${n} building${n === 1 ? '' : 's'} destroyed`, n ? 'warn' : 'info');
  }
  S.ctx.events.emit('disaster:ended', { id: k.id, destroyed: S.destroyed, kind: 'kaiju' });
}

/** Every kaiju blow goes through here: the damage is billed and announced exactly like the storm's. */
function hurt(b, amt, source) {
  const before = b.damage || 0;
  const after = Math.min(1, before + amt);
  if (!(after > before)) return 0;
  b.damage = after;
  S.pendingCost += (after - before) * INSURANCE_RATE;
  S.ctx.events.emit('disaster:damage', { id: b.id, amount: after - before, damage: after, source });
  return after - before;
}

/** Start taking `b` apart, its bricks thrown outward from (x, z). */
function shedFrom(k, b, x, z) {
  const origin = { x, z, mode: 'radial' };
  const had = S.shedding.get(b.id);
  if (had) { had.kick = origin; return; }
  const B = buildingsApi();
  const sh = B ? buildShed(B, b, k.id, origin, K_MAX_BRICKS) : null;
  if (sh) S.shedding.set(b.id, sh);
}

function hazardSound(name, key, perSec, x, z) {
  const now = performance.now();
  if (now - S[key] < 1000 / perSec) return;
  S[key] = now;
  const audio = modApi('audio');
  if (!audio?.play) return;
  try { audio.play(name, { x, y: S.ctx.world.getHeight(x, z), z }); } catch (_) { /* ignore */ }
}

/** How fast the rampage budget runs down at the kaiju's feet: 1, plus the city's answer. */
function coverageDrain(k) {
  const sim = modApi('simulation'), world = S.ctx.world;
  if (!sim || typeof sim.getCoverageGrid !== 'function') return 1;
  const { i, j } = world.worldToCell(k.x, k.z);
  if (!world.inBounds(i, j)) return 1;
  const idx = j * world.size.w + i;
  const police = sim.getCoverageGrid('police'), fire = sim.getCoverageGrid('fire');
  return 1 + (police && police[idx] ? K_POLICE_DRAIN : 0) + (fire && fire[idx] ? K_FIRE_DRAIN : 0);
}

/** The tallest, densest thing ahead and not too far: where the kaiju walks next. Null when there is nothing. */
function pickTarget(k) {
  const world = S.ctx.world;
  const ch = Math.cos(k.heading), sh = Math.sin(k.heading);
  let best = null, bestScore = 0;
  for (const b of world.buildings.values()) {
    const c = centreOf(b);
    const dx = c.x - k.x, dz = c.z - k.z, d = Math.hypot(dx, dz);
    if (d > K_TARGET_R || dx * ch + dz * sh < -K_BEHIND) continue;
    let near = 0;
    for (let j = b.j - 3; j < b.j + b.d + 3; j++) for (let i = b.i - 3; i < b.i + b.w + 3; i++) {
      const id = world.cellAt(i, j)?.buildingId;
      if (id != null && id !== b.id) near++;
    }
    const score = (b.height || 6) * (1 + 0.1 * near) / (1 + d / 120);
    if (score > bestScore) { bestScore = score; best = { id: b.id, x: c.x, z: c.z }; }
  }
  return best;
}

function steer(k, gdt) {
  const world = S.ctx.world, half = mapHalf();
  let want;
  if (k.phase === 'leave') {
    if (!Number.isFinite(k.leaveHeading)) {
      // the nearest map edge
      const ex = half.x - Math.abs(k.x), ez = half.z - Math.abs(k.z);
      k.leaveHeading = ex <= ez ? (k.x >= 0 ? 0 : Math.PI) : (k.z >= 0 ? Math.PI / 2 : -Math.PI / 2);
    }
    want = k.leaveHeading;
  } else {
    k.retargetIn -= gdt;
    const t = k.target;
    const gone = !!t && !world.buildings.has(t.id);
    const arrived = !!t && !gone && Math.hypot(t.x - k.x, t.z - k.z) < K_ARRIVE_R;
    if (arrived) {
      // standing on it: down it comes, whatever the feet did
      const b = world.buildings.get(t.id);
      shedFrom(k, b, k.x, k.z);
      hurt(b, 1, 'stomp');
    }
    if (k.retargetIn <= 0 || gone || arrived) {
      k.target = pickTarget(k);
      if (arrived && k.target && k.target.id === t.id) k.target = null; // it is coming down; look again in a second
      k.retargetIn = K_RETARGET_SEC;
    }
    if (k.target) { want = Math.atan2(k.target.z - k.z, k.target.x - k.x); k.wanderIn = 0; k.wanderHeading = k.heading; }
    else {
      // nothing to walk to: wander, and turn back toward the middle near a map edge
      k.wanderIn -= gdt;
      if (k.wanderIn <= 0) {
        k.wanderHeading = wrapAngle(k.heading + S.rng.fork(`kaiju:wander:${k.id}:${k.turns++}`).range(-0.6, 0.6));
        k.wanderIn = K_WANDER_SEC;
      }
      if (half.x - Math.abs(k.x) < K_EDGE_M || half.z - Math.abs(k.z) < K_EDGE_M) k.wanderHeading = Math.atan2(-k.z, -k.x);
      want = k.wanderHeading;
    }
  }
  const err = wrapAngle(want - k.heading);
  const turn = K_TURN_RATE * gdt;
  k.heading = wrapAngle(k.heading + Math.max(-turn, Math.min(turn, err)));
  if (k.age < k.breathUntil) return; // it stands still to breathe
  // slows into a turn, so it can always close on what it is walking to
  const v = (k.phase === 'leave' ? K_LEAVE_SPEED : K_SPEED) * Math.max(0.25, Math.cos(err)) * gdt;
  k.x += Math.cos(k.heading) * v;
  k.z += Math.sin(k.heading) * v;
  k.walked += v;
}

/** A foot comes down at (fx, fz): the nearest buildings under it are destroyed, the ones around it are shaken. */
function stomp(k, fx, fz) {
  const world = S.ctx.world;
  const c0 = world.worldToCell(fx, fz);
  const cand = [];
  _seen.clear();
  for (let j = c0.j - K_STOMP_CELLS; j <= c0.j + K_STOMP_CELLS; j++) for (let i = c0.i - K_STOMP_CELLS; i <= c0.i + K_STOMP_CELLS; i++) {
    const id = world.cellAt(i, j)?.buildingId;
    if (id == null || _seen.has(id)) continue;
    _seen.add(id);
    const b = world.buildings.get(id);
    if (!b) continue;
    const d = lotDist(b, fx, fz);
    if (d > K_TREMOR_R) continue;
    cand.push({ b, d, under: d <= K_FOOT_R || lotDist(b, k.x, k.z) <= K_BODY_R });
  }
  cand.sort((p, q) => p.d - q.d); // stable: equal distances keep the scan order
  let hits = 0;
  for (const p of cand) {
    if (p.under && hits < K_STOMP_MAX) {
      shedFrom(k, p.b, fx, fz);
      hurt(p.b, 1, 'stomp');
      hits++;
    } else {
      const q = p.d / K_TREMOR_R;
      hurt(p.b, K_TREMOR_DAMAGE * (1 - q * q), 'tremor');
    }
  }
  S.footfalls++;
  S.ctx.events.emit('disaster:stomp', { id: k.id, x: fx, z: fz, hits });
  hazardSound('stomp', 'stompAt', K_STOMP_PER_SEC, fx, fz);
  sweepLooseAt(fx, fz, K_FOOT_R + 5, k.id, { x: fx, z: fz, mode: 'radial' });
}

/** The tail knocks down what it touches. */
function tailSweep(k, gdt) {
  const world = S.ctx.world;
  tailPoints(k, _tailPts);
  _seen.clear();
  for (let n = 0; n < K_TAIL_SEGS; n++) {
    const x = _tailPts[n * 2], z = _tailPts[n * 2 + 1];
    const c0 = world.worldToCell(x, z);
    for (let j = c0.j - 1; j <= c0.j + 1; j++) for (let i = c0.i - 1; i <= c0.i + 1; i++) {
      const id = world.cellAt(i, j)?.buildingId;
      if (id == null || _seen.has(id)) continue;
      const b = world.buildings.get(id);
      if (!b || lotDist(b, x, z) > K_TAIL_R) continue;
      _seen.add(id);
      if (!S.shedding.has(id)) shedFrom(k, b, x, z);
      hurt(b, K_TAIL_DAMAGE_PER_SEC * gdt, 'tail');
    }
  }
}

/** Buildings in the cone ahead of the mouth, nearest first: [{ b, d }]. */
function breathTargets(k) {
  const m = mouthPoint(k);
  const ch = Math.cos(k.heading), sh = Math.sin(k.heading);
  const out = [];
  for (const b of S.ctx.world.buildings.values()) {
    if (b.onFire) continue;
    const c = centreOf(b);
    const dx = c.x - m[0], dz = c.z - m[2], d = Math.hypot(dx, dz);
    if (d < K_BREATH_MIN || d > K_BREATH_RANGE) continue;
    if (Math.abs(Math.atan2(dz * ch - dx * sh, dx * ch + dz * sh)) > K_BREATH_HALF_ANGLE) continue;
    out.push({ b, d });
  }
  return out.sort((p, q) => p.d - q.d);
}

/** Fire breath: sets the nearest buildings in the cone alight. False when there is nothing to burn. */
function breathe(k) {
  const sim = modApi('simulation');
  const list = breathTargets(k);
  if (!list.length || !sim || typeof sim.igniteBuilding !== 'function') return false;
  const ignited = [];
  for (const p of list) {
    if (ignited.length >= K_BREATH_MAX) break;
    if (sim.igniteBuilding(p.b.id)) ignited.push(p.b.id);
  }
  k.breathUntil = k.age + K_BREATH_DUR;
  S.breaths++; S.ignited += ignited.length;
  const m = mouthPoint(k);
  S.ctx.events.emit('disaster:breath', { id: k.id, x: m[0], z: m[2], heading: k.heading, ignited });
  hazardSound('roar', 'roarAt', K_ROAR_PER_SEC, k.x, k.z);
  return true;
}

/** Advance the kaiju by `gdt` game seconds. */
function stepKaiju(gdt) {
  const k = S.kaiju;
  if (gdt > 0) {
    k.age += gdt;
    if (k.phase === 'rise') { if (k.age >= K_RISE_SEC) k.phase = 'rampage'; }
    else if (k.phase === 'sink') { k.sinkT += gdt / K_SINK_SEC; if (k.sinkT >= 1) endKaiju(k, 'left'); }
    else {
      if (k.phase === 'rampage') {
        k.drain = coverageDrain(k);
        k.life -= gdt * k.drain;
        if (k.drain > 1 && !k.warned) {
          k.warned = true;
          uiApi(S.ctx)?.notify?.('\u{1F692} Police and fire crews are driving the kaiju off', 'info');
        }
        if (k.life <= 0) { k.life = 0; k.phase = 'leave'; k.leaveT = 0; k.leaveHeading = null; k.target = null; }
      } else {
        const half = mapHalf();
        k.leaveT += gdt;
        if (k.leaveT >= K_LEAVE_SEC || Math.abs(k.x) > half.x || Math.abs(k.z) > half.z) { k.phase = 'sink'; k.sinkT = 0; }
      }
      steer(k, gdt);
      while (Math.floor(k.walked / K_STEP_LEN) > k.steps) {
        k.steps++;
        const side = sideOf(k.steps), p = footPlant(k, side, k.steps);
        if (side > 0) k.footR = p; else k.footL = p;
        stomp(k, p[0], p[1]);
      }
      tailSweep(k, gdt);
      // breathes between strides, and only when there is something in front of it to burn
      if (k.phase === 'rampage' && k.age >= k.nextBreath && k.age >= k.breathUntil
        && (stepPhase(k) < 0.25 || k.age >= k.nextBreath + 3)) {
        k.nextBreath = k.age + (breathe(k) ? K_BREATH_PERIOD : 1);
      }
    }
    S.batchAcc += gdt;
    if (S.batchAcc >= PROP_BATCH_SEC) { S.batchAcc = 0; flushProps(); }
  }
  updateShedding();
}

/** A saved kaiju, sanitised (a crafted or corrupt save must not freeze or teleport anything). Null = none. */
function cleanKaiju(p) {
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!p || typeof p !== 'object' || ![p.x, p.z, p.heading].every(fin)) return null;
  const half = mapHalf(), cs = S.ctx.world.cellSize || 8;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const num = (v, d, lo, hi) => clamp(fin(v) ? v : d, lo, hi);
  const id = p.id | 0 || S.nextId;
  S.nextId = Math.max(S.nextId, id + 1);
  const k = newKaiju(id, clamp(p.x, -half.x - cs, half.x + cs), clamp(p.z, -half.z - cs, half.z + cs), wrapAngle(p.heading));
  k.age = num(p.age, 0, 0, K_LIFE_SEC * 4);
  k.life = num(p.life, K_LIFE_SEC, 0, K_LIFE_SEC * 4);
  k.walked = num(p.walked, 0, 0, 1e7);
  k.steps = Math.floor(k.walked / K_STEP_LEN);
  k.phase = ['rise', 'rampage', 'leave', 'sink'].includes(p.phase) ? p.phase : 'rampage';
  if (k.phase === 'rise' && k.age >= K_RISE_SEC) k.phase = 'rampage';
  k.sinkT = num(p.sinkT, 0, 0, 1);
  k.leaveT = num(p.leaveT, 0, 0, K_LEAVE_SEC);
  k.leaveHeading = fin(p.leaveHeading) ? wrapAngle(p.leaveHeading) : null;
  k.turns = clamp(p.turns | 0, 0, 1e6);
  k.nextBreath = num(p.nextBreath, k.age + K_BREATH_PERIOD, k.age, k.age + K_BREATH_PERIOD);
  k.breathUntil = num(p.breathUntil, 0, 0, k.age + K_BREATH_DUR);
  k.warned = p.warned === true;
  const t = p.target;
  k.target = t && typeof t === 'object' && fin(t.x) && fin(t.z) && t.id != null ? { id: t.id, x: t.x, z: t.z } : null;
  setFeet(k);
  // the saved feet, if they are feet this body could be standing on
  const foot = (f) => (Array.isArray(f) && f.length === 2 && fin(f[0]) && fin(f[1]) && Math.hypot(f[0] - k.x, f[1] - k.z) <= K_STEP_LEN * 2 ? [f[0], f[1]] : null);
  const fl = foot(p.footL), fr = foot(p.footR);
  if (fl && fr) { k.footL = fl; k.footR = fr; }
  return k;
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
  /** Raise a kaiju at (x,z), facing `heading` (radians, atan2(dz, dx); default: toward the middle of the map).
   * Returns its id, or null while any hazard is on the map. */
  spawnKaiju(opts = {}) {
    const k = spawnKaiju(opts);
    if (!k) return null;
    uiApi(S.ctx)?.notify?.('\u{1F996} Kaiju! A giant lizard is rising in the city', 'warn');
    hazardSound('roar', 'roarAt', K_ROAR_PER_SEC, k.x, k.z);
    return k.id;
  },
  /** Tornadoes only: [{ id, x, z, dirX, dirZ, age, life, strength }] — read-only copies. */
  getActive() { return S.active.map((t) => ({ ...t })); },
  /** The live kaiju (a copy: { id, x, z, heading, age, life, drain, walked, steps, phase, footL, footR, ... }) or null. */
  getKaiju() { return S.kaiju ? JSON.parse(JSON.stringify(S.kaiju)) : null; },
  /** True while a tornado or a kaiju is on the map. */
  isActive() { return hazardLive(); },
  /** Total damage still un-repaired across the city, 0..1 × buildings (a rough "how bad was it" read). */
  getDamageTotal() { let s = 0; for (const b of S.ctx.world.buildings.values()) s += b.damage || 0; return s; },
  /** Counters for the HUD, tools and checks: { destroyed (this hazard), totalDestroyed, stripped, hiddenParts,
   * propsTaken, carsTaken, footfalls, breaths, ignited (this kaiju), kaiju: its phase | null,
   * bricks: { live, rubble, fading, spawned, dropped, recycled, spawnHash, ... } }. */
  getStats() {
    let stripped = 0, hiddenParts = 0;
    for (const sh of S.shedding.values()) { if (sh.shown > 0) stripped++; hiddenParts += sh.shown; }
    return {
      destroyed: S.destroyed, totalDestroyed: S.totalDestroyed, stripped, hiddenParts, tracked: S.shedding.size,
      propsTaken: S.propsTaken, carsTaken: S.carsTaken,
      footfalls: S.footfalls, breaths: S.breaths, ignited: S.ignited, kaiju: S.kaiju ? S.kaiju.phase : null, bricks: S.bricks ? S.bricks.stats() : null,
    };
  },
  /** End the hazard now and drop every brick. Stripped buildings stay stripped until their damage repairs. */
  clear() { clear('clear'); },
  getState() {
    const out = { tornadoes: S.active.map((t) => ({ id: t.id, x: t.x, z: t.z, dirX: t.dirX, dirZ: t.dirZ, age: t.age, life: t.life })) };
    const shed = [];
    for (const [id, sh] of S.shedding) if (sh.shown > 0) shed.push({ id });
    out.shedding = shed;
    out.prevWeather = S.prevWeather ? copyWeather(S.prevWeather) : null;
    const k = S.kaiju;
    out.kaiju = k ? {
      id: k.id, x: k.x, z: k.z, heading: k.heading, age: k.age, life: k.life, walked: k.walked, steps: k.steps, phase: k.phase,
      sinkT: k.sinkT, leaveT: k.leaveT, leaveHeading: k.leaveHeading, footL: [...k.footL], footR: [...k.footR],
      target: k.target ? { ...k.target } : null, nextBreath: k.nextBreath, breathUntil: k.breathUntil, turns: k.turns, warned: k.warned,
    } : null;
    out.regrow = hazardLive() ? S.regrow.map((c) => ({ i: c.i, j: c.j })) : [];
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
    // one hazard at a time: a save that holds both keeps the tornado
    if (!S.active.length) S.kaiju = cleanKaiju(patch?.kaiju);
    else if (patch?.kaiju) S.ctx.log('[disasters] save holds a tornado and a kaiju: kaiju dropped');
    if (hazardLive()) {
      // lots the saved hazard had already emptied: still to be handed over for regrowth when it ends
      for (const c of (Array.isArray(patch?.regrow) ? patch.regrow : []).slice(0, 4096)) {
        if (c && Number.isInteger(c.i) && Number.isInteger(c.j) && world.inBounds(c.i, c.j)) S.regrow.push({ i: c.i, j: c.j });
      }
    }
    if (S.active.length) {
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
        const kj = S.kaiju;
        const sh = kj ? buildShed(B, b, kj.id, { x: kj.x, z: kj.z, mode: 'radial' }, K_MAX_BRICKS) : buildShed(B, b, S.active[0]?.id ?? 0);
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
  if (!S.kaijuVis) return;
  if (!S.kaiju) S.kaijuVis.group.visible = false;
  else S.kaijuVis.update(S.kaiju, time, groundAt);
}

/** Where the presets should look: the live tornado or kaiju, else the district centre (world origin). */
function focusPoint() {
  const t = S.active[0] || S.kaiju;
  const x = t ? t.x : 0, z = t ? t.z : 0;
  return { x, z, gy: S.ctx?.world ? S.ctx.world.getHeight(x, z) : 0 };
}

export default {
  id: 'disasters',
  // a tornado needs a city to hit: the damage model only needs simulation, but the module's showcase stages a real
  // district and expects terrain/roads/buildings to render it (full game has them anyway).
  deps: ['simulation', 'terrain', 'roads', 'buildings'],
  order: 65,
  showcaseVariants: ['default', 'storm', 'kaiju'],
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
    'disasters:kaiju': () => {
      const f = focusPoint();
      // a front three-quarter view: ahead of it and to its right, so the face and the fire are in the frame
      const h = S.kaiju ? S.kaiju.heading : 0, c = Math.cos(h), s = Math.sin(h);
      return { pos: [f.x + c * 95 - s * 85, f.gy + 42, f.z + s * 95 + c * 85], target: [f.x + c * 12, f.gy + 27, f.z + s * 12], fov: 45 };
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
    S.kaijuVis = createKaijuVisuals(ctx, S.rng.fork('kaiju'));
    ctx.scene.add(S.kaijuVis.group);
    S.kaiju = null; S.footfalls = 0; S.breaths = 0; S.ignited = 0;
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
    else if (S.kaiju) stepKaiju(gdt);
    else updateShedding(); // a stripped building that levels up is re-stripped; a bulldozed one is forgotten
    S.bricks.update(gdt, funnel(), S.time += dt); // no funnel under a kaiju: its bricks fly ballistically
    if (hazardLive() || S.visuals.group.visible || S.kaijuVis.group.visible) syncVisuals(S.time);
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
    if (variant === 'kaiju') {
      // rises on the street west of the district (a row clear of the water tower, which stands at j0 + mid) and
      // walks in. Stepped in fixed steps until it is caught in the middle of its second fire breath (at most
      // K_SHOWCASE_PRESTEP of them), so the frame has it mid-rampage: footfalls behind it, bricks in the air.
      const c = ctx.world.cellToWorld(i0 - 3, j0 + 12);
      S.time = 0;
      spawnKaiju({ x: c.x, z: c.z, heading: 0 });
      for (let n = 0; n < K_SHOWCASE_PRESTEP && S.kaiju; n++) {
        stepKaiju(1 / 60);
        S.bricks.update(1 / 60, null, S.time += 1 / 60);
        if (S.breaths >= 2 && breathT(S.kaiju) >= 0.45) break;
      }
      syncVisuals(0);
    }
    ctx.log(`[disasters] showcase '${variant}': ${city.buildingIds.length} buildings, ${S.active.length} tornado(es), ${S.kaiju ? `kaiju ${S.kaiju.phase}, ${S.footfalls} footfalls, ` : ''}${S.destroyed} destroyed, ${S.bricks.stats().spawned} bricks`);
  },

  dispose() {
    for (const off of S.subs) off();
    S.subs.length = 0;
    clear('dispose');
    S.shedding.clear();
    if (S.visuals) { S.ctx?.scene.remove(S.visuals.group); S.visuals.dispose(); S.visuals = null; }
    if (S.kaijuVis) { S.ctx?.scene.remove(S.kaijuVis.group); S.kaijuVis.dispose(); S.kaijuVis = null; }
    if (S.bricks) { S.ctx?.scene.remove(S.bricks.group); S.bricks.dispose(); S.bricks = null; }
  },
};
