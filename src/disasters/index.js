// disasters — city-scale hazards. v1: one tornado at a time (owner pick, Wave D2).
//
// The funnel travels along the world wind direction and damages every building in its path using the existing fire
// damage model (b.damage 0..1 -> FIRE_DAMAGE_CAP_LOSS capacity loss, FIRE_REPAIR_RATE repair), so a hit city
// recovers on its own. Damage is billed through simulation.setDisasterCost ($/tick, its own budget expense line).
// No THREE here outside visuals.js; all state is deterministic (module rng fork, no runtime rng).
import { createTornadoVisuals } from './visuals.js';
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

const S = { ctx: null, rng: null, visuals: null, active: [], pendingCost: 0, nextId: 1, subs: [], time: 0 };

function uiApi(ctx) { const m = ctx.modules.get('ui'); return m?.status === 'ok' ? m.api : null; }

function normalize(x, z) { const h = Math.hypot(x, z); return h > 1e-6 ? { x: x / h, z: z / h } : { x: 1, z: 0 }; }

function strengthFor(age, life) {
  const inK = RAMP_IN_SEC > 0 ? Math.min(1, age / RAMP_IN_SEC) : 1;
  const outK = RAMP_OUT_SEC > 0 ? Math.min(1, Math.max(0, (life - age) / RAMP_OUT_SEC)) : 1;
  return Math.max(0, Math.min(inK, outK));
}

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
  S.ctx.events.emit('disaster:tornado', { id: t.id, x: t.x, z: t.z, dirX: t.dirX, dirZ: t.dirZ });
  return t;
}

function fallbackDir() {
  const a = S.rng.fork('dir').range(0, Math.PI * 2);
  return [Math.cos(a), Math.sin(a)];
}

function clear() {
  S.active.length = 0;
  S.pendingCost = 0;
  S.visuals.group.visible = false;
  const sim = S.ctx?.modules.get('simulation');
  if (sim?.status === 'ok') sim.api.setDisasterCost(0);
}

// damage application: quadratically falls off between CORE_R and OUTER_R; a burning building takes half
function applyDamage(t, gdt) {
  const world = S.ctx.world;
  const inv = 1 / (OUTER_R - CORE_R);
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
  }
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
  clear,
  getState() { return { tornadoes: S.active.map((t) => ({ id: t.id, x: t.x, z: t.z, dirX: t.dirX, dirZ: t.dirZ, age: t.age, life: t.life })) }; },
  loadState(patch) {
    clear();
    for (const t of (patch?.tornadoes || []).slice(0, MAX_ACTIVE)) {
      S.nextId = Math.max(S.nextId, (t.id | 0) + 1);
      S.active.push({ id: t.id | 0 || S.nextId++, x: t.x, z: t.z, dirX: t.dirX, dirZ: t.dirZ, age: t.age, life: t.life, strength: strengthFor(t.age, t.life) });
    }
    syncVisuals(0);
  },
};

function syncVisuals(time = 0) {
  const t = S.active[0];
  if (!t) { S.visuals.group.visible = false; return; }
  S.visuals.update(t, time, S.ctx.world.getHeight(t.x, t.z));
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
    // push the accrued insurance cost on every simulation tick (same one-tick pattern as transit upkeep)
    S.subs.push(ctx.events.on('sim:tick', () => {
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
    if (!S.active.length) { if (S.visuals.group.visible) syncVisuals(0); return; }
    for (let i = S.active.length - 1; i >= 0; i--) {
      const t = S.active[i];
      t.x += t.dirX * SPEED * gdt;
      t.z += t.dirZ * SPEED * gdt;
      t.age += gdt;
      t.strength = strengthFor(t.age, t.life);
      if (gdt > 0) applyDamage(t, gdt);
      if (t.age >= t.life) {
        ctx.events.emit('disaster:ended', { id: t.id });
        S.active.splice(i, 1);
      }
    }
    syncVisuals(S.time += dt);
  },

  async showcase(ctx, variant = 'default') {
    clear();
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
      const c = ctx.world.cellToWorld(i0 + 12, j0 + 8);
      spawn({ x: c.x, z: c.z, dirX: 1, dirZ: 0, age: 20 });
      syncVisuals(0);
    }
    ctx.log(`[disasters] showcase '${variant}': ${city.buildingIds.length} buildings, ${S.active.length} tornado(es)`);
  },

  dispose() {
    for (const off of S.subs) off();
    S.subs.length = 0;
    clear();
    if (S.visuals) { S.ctx?.scene.remove(S.visuals.group); S.visuals.dispose(); S.visuals = null; }
  },
};
