// traffic — Blox-style cars driving the `roads` lane network. All cars are plain data (no per-car Object3D),
// rendered through a handful of InstancedMesh sets (grouped by car model) rewritten every frame.

import * as THREE from 'three';
import { LaneGraph } from './lanegraph.js';
import { buildCarKits, CAR_SPECS } from './models.js';
import { Car, createPool, spawnCar, spawnRouteBus, stepCar, resolveGaps, placeOnPath } from './sim.js';
import { buildGridDemo, buildIntersectionDemo } from './showcase.js';

const MAX_POOL = 300;
const MAX_BUSES = 24;       // dedicated transit slots appended after the car slots (see setTransitLines)
const MAX_BUSES_PER_LINE = 4;
const BUS_MIN_LOOP_M = 320; // one bus per this much route length, rounded, clamped to [1, MAX_BUSES_PER_LINE]
const DEFAULT_MAX_CARS = 80; // used only when there is no lane data yet to size against (empty world)
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const S = {
  ctx: null, rng: null, carRng: null, group: null, graph: null, pool: [], kits: null, materials: null,
  meshes: [], // per-model: { body, cabin, wheel, head, tailNormal, tailBrake }
  density: 1, activeCount: 0, maxCars: DEFAULT_MAX_CARS, paused: false, simTime: 0,
  dirty: true, lastEvent: 0, unsub: [], bounds: null, variant: null,
  heroShot: null, // cached {pos,target,fov} for traffic:closeup — decided once, deterministically, in showcase()
  carActive: 0, busSlots: [], activeList: [], busActive: 0,
  transitDefs: [], routes: [], // transit lines: raw defs (re-applied after a graph rebuild) + built routes
};

function computeMaxCars(ctx, graph) {
  if (!graph.ready) return 0;
  let cap = graph.totalLaneLength / 12; // ~1 car per 12 m of drivable lane
  const sim = ctx.modules.get('simulation');
  if (sim?.status === 'ok') {
    const traffic = clamp01(ctx.world.stats.traffic ?? 0.3);
    cap *= 0.5 + traffic * 1.5; // busier city -> more cars, up to 2x
  }
  return Math.round(Math.max(0, Math.min(MAX_POOL, cap)));
}

function ensureActive(count) {
  const n = Math.min(count, MAX_POOL);
  for (let i = 0; i < n; i++) {
    const car = S.pool[i];
    if (!car.active || !S.graph.getPath(car.currentKey)) spawnCar(car, S.graph, S.carRng, S.pool);
  }
  S.carActive = n;
  syncActive();
}

/** Rebuild this frame's active list: active cars first, then active route buses. Bus slots live after the car
 * slots in the pool, so a single prefix count can no longer describe the active set (a bus must never be
 * mistaken for an active car at index >= carActive). */
function syncActive() {
  const list = S.activeList;
  list.length = 0;
  for (let i = 0; i < S.carActive; i++) { const c = S.pool[i]; if (c.active) list.push(c); }
  let buses = 0;
  for (const b of S.busSlots) if (b.active && b.route) { list.push(b); buses++; }
  S.busActive = buses;
  S.activeCount = list.length;
}

/** Re-point every active car at the rebuilt graph's cached paths (see rebuildGraph). A car whose current segment
 * no longer exists — or whose lane's direction just became forbidden (one-way conversion/reversal) — is left
 * inactive; ensureActive() respawns it on a fresh lane. */
function repathCars() {
  const allowed = S.graph.laneKeys.length ? new Set(S.graph.laneKeys) : null;
  for (let i = 0; i < S.pool.length; i++) {
    const car = S.pool[i];
    if (!car.active || car.route) continue; // route buses are rebuilt by applyTransitLines() after the rebuild
    if (car.phase === 'lane' && allowed && !allowed.has(car.currentKey)) { car.active = false; continue; }
    const pd = S.graph.getPath(car.currentKey);
    if (!pd) continue;
    car.pathData = pd;
    car.total = pd.total;
    if (car.s > pd.total) car.s = pd.total; // shorter segment: advance() carries the remainder next tick
    // The next hop is cached too; a split can leave it pointing at a path that no longer exists (advance() would
    // respawn the car mid-road). Re-commit only when it is actually gone, so live routes are otherwise untouched.
    if (car.nextKey && !S.graph.getPath(car.nextKey)) {
      const next = S.graph.commitNext(car.currentKey);
      car.nextKey = next ? next.key : null;
    }
    placeOnPath(car); // correct height/yaw in the same frame, even for the frozen showcase hero
  }
}

function rebuildGraph() {
  S.graph.rebuild();
  S.maxCars = computeMaxCars(S.ctx, S.graph) || DEFAULT_MAX_CARS;
  // The road network can change *in place* without any lane key changing: an upgrade/downgrade rewrites an edge's
  // kind/width (same id, new lane centres and — because the wider footprint samples higher terrain — a new bed
  // height), and any new road joining an existing node moves that node's trims/heights. Cars cache their lane
  // polyline, so without this they keep driving the old one: sunk below the new road surface and offset to the old
  // lane centre until they happen to reach the end of the segment.
  repathCars();
  const target = Math.round(S.maxCars * S.density);
  ensureActive(S.graph.ready ? target : 0);
  // Buses ride the freshly cached lane geometry too; a line whose keys no longer exist is reported so `transit`
  // can recompute its route against the new network.
  const failed = applyTransitLines();
  if (failed.length) S.ctx.events.emit('traffic:transit-invalid', { ids: failed });
  S.dirty = false;
}

function markDirty() { S.dirty = true; S.lastEvent = performance.now(); }

function buildMeshes(ctx) {
  const { kits, materials } = buildCarKits(ctx);
  S.kits = kits; S.materials = materials;
  const meshes = kits.map((kit, i) => {
    const mk = (geo, mat, cast) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_POOL);
      m.count = 0; m.castShadow = cast; m.receiveShadow = cast; m.frustumCulled = false;
      m.name = `traffic-${kit.spec.id}-${mat.name || 'part'}`;
      S.group.add(m);
      return m;
    };
    return {
      body: mk(kit.bodyGeo, materials.body, true),
      cabin: mk(kit.cabinGeo, materials.cabin, false),
      wheel: mk(kit.wheelGeo, materials.wheel, true),
      head: mk(kit.headGeo, materials.headDay, false),
      tailNormal: mk(kit.tailGeo, materials.tailNormalDay, false),
      tailBrake: mk(kit.tailGeo, materials.tailBrakeDay, false),
    };
  });
  S.meshes = meshes;
}

const _m = new THREE.Matrix4();
const _scale1 = new THREE.Vector3(1, 1, 1);

function writeInstances(ctx) {
  const night = ctx.clock.isNight;
  const n = S.kits.length;
  const bodyCount = new Array(n).fill(0);
  const normalCount = new Array(n).fill(0);
  const brakeCount = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    S.meshes[i].head.material = night ? S.materials.headNight : S.materials.headDay;
    S.meshes[i].tailNormal.material = night ? S.materials.tailNormalNight : S.materials.tailNormalDay;
    S.meshes[i].tailBrake.material = night ? S.materials.tailBrakeNight : S.materials.tailBrakeDay;
  }
  for (const car of S.activeList) {
    if (!car.active) continue;
    const mi = car.specIdx;
    const mesh = S.meshes[mi];
    _m.compose(car.pos, car.quat, _scale1);
    const b = bodyCount[mi]++;
    mesh.body.setMatrixAt(b, _m); mesh.body.setColorAt(b, car.color);
    mesh.cabin.setMatrixAt(b, _m);
    mesh.wheel.setMatrixAt(b, _m);
    mesh.head.setMatrixAt(b, _m);
    if (car.braking) { const k = brakeCount[mi]++; mesh.tailBrake.setMatrixAt(k, _m); }
    else { const k = normalCount[mi]++; mesh.tailNormal.setMatrixAt(k, _m); }
  }
  for (let i = 0; i < n; i++) {
    const mesh = S.meshes[i];
    mesh.body.count = mesh.cabin.count = mesh.wheel.count = mesh.head.count = bodyCount[i];
    mesh.tailNormal.count = normalCount[i];
    mesh.tailBrake.count = brakeCount[i];
    mesh.body.instanceMatrix.needsUpdate = true; if (mesh.body.instanceColor) mesh.body.instanceColor.needsUpdate = true;
    mesh.cabin.instanceMatrix.needsUpdate = true;
    mesh.wheel.instanceMatrix.needsUpdate = true;
    mesh.head.instanceMatrix.needsUpdate = true;
    mesh.tailNormal.instanceMatrix.needsUpdate = true;
    mesh.tailBrake.instanceMatrix.needsUpdate = true;
  }
}

function fallbackCam(world) { const y = world.getHeight(0, 0); return { pos: [90, y + 90, 110], target: [0, y + 2, 0] }; }

const HERO_FWD_MARGIN = 3.2; // extra clearance the closeup camera wants beyond a car's own forward-offset need
const HERO_STOP_SPEED = 0.05; // m/s — "genuinely at rest", not just "under some threshold" (keeps car.braking lit too)
const MIN_NEIGHBOR_GAP = 4.5; // m, bumper-to-bumper — below this two bodies read as touching/overlapping in a tight 3/4 shot
const CLUTTER_RADIUS = 13;    // m, world-space — roughly the depth/width a closeup frame actually covers around the hero
const SCORE_CLEAR_CAP = 20;   // m — fixed reward cap for the clearAhead/clearBehind score terms, deliberately NOT
                               // derived from the candidate's own length (see scoreCandidates(): a length-derived
                               // cap systematically out-scored small cars with a bus every time, since a bus's own
                               // "needed" clearance ceiling is simply bigger — nothing to do with actual isolation)

/** One pass of hero-car scoring; shared by the tiers below. Always computes the real clearAhead (distance to the
 * next same-lane car ahead, or the lane end) so the caller — even in a relaxed tier — can clamp the camera's
 * forward offset to it and never overshoot onto a neighbour. `requireStopped` is the more important guard: the
 * hero car gets frozen the instant it's picked (see warmUpAndPickHero()), so "stopped" here means genuinely at
 * rest (HERO_STOP_SPEED), not just slow — freezing a car that's still mid-deceleration would visibly snap it to
 * a stop a few pixels short of where physics was taking it.
 *
 * Composition (round-2 fix): candidates with another car crammed close behind them (a nose-to-tail queue) or with
 * 2+ other cars anywhere inside the shot's rough world-space footprint (CLUTTER_RADIUS, checked both along the
 * same lane and across lanes for intersection corners) are rejected outright — a single clean companion car is
 * still allowed ("queue of 2"), a pile-up is not. This replaces the old `queueDepth * 40` term, which actively
 * rewarded picking a car buried in the longest available queue (exactly backwards). */
function scoreCandidates(requireClearance, requireStopped) {
  const b = S.bounds || { cx: 0, cz: 0 };
  let best = null, bestClear = 0, bestScore = -Infinity;
  for (const c of S.activeList) {
    if (!c.active || c.phase !== 'lane') continue;
    if (requireStopped && c.speed >= HERO_STOP_SPEED) continue;
    let clearAhead = c.total - c.s; // distance to the physical lane end if nothing else is ahead
    let clearBehind = c.s;          // distance back to the lane start if nothing else is behind
    let nearbyCount = 0;            // other cars inside the shot's rough footprint, any direction/lane
    for (const o of S.activeList) {
      if (o === c) continue;
      if (!o.active) continue;
      if (o.currentKey === c.currentKey) {
        const gap = Math.abs(o.s - c.s) - (o.spec.length + c.spec.length) / 2;
        if (o.s > c.s) clearAhead = Math.min(clearAhead, gap); else clearBehind = Math.min(clearBehind, gap);
        if (Math.abs(o.s - c.s) < CLUTTER_RADIUS) nearbyCount++;
      } else if (c.pos.distanceTo(o.pos) < CLUTTER_RADIUS * 0.6) {
        nearbyCount++; // cross-lane clutter guard (e.g. a perpendicular arm queued right at the same corner)
      }
    }
    const needed = c.spec.length * 0.62 + HERO_FWD_MARGIN; // the closeup camera's own forward offset
    if (requireClearance && clearAhead < needed + 3) continue;
    if (clearBehind < MIN_NEIGHBOR_GAP) continue; // never anchor on a car with another flush against its tail
    if (nearbyCount > 1) continue; // a single clean companion reads fine; 2+ others reads as a traffic-jam shot
    const distToCenter = Math.hypot(c.pos.x - b.cx, c.pos.z - b.cz);
    // Fixed caps (SCORE_CLEAR_CAP), not `needed`-derived ones: `needed` scales with the candidate's own length, so
    // capping the reward at it would hand every long vehicle (bus) a structurally higher ceiling than a sedan/van
    // regardless of actual isolation — exactly the kind of length bias this rewrite is meant to remove.
    const score = Math.min(clearBehind, SCORE_CLEAR_CAP) * 2 + Math.min(clearAhead, SCORE_CLEAR_CAP) * 2
      - distToCenter * 0.5 - nearbyCount * 8;
    if (score > bestScore) { bestScore = score; best = c; bestClear = clearAhead; }
  }
  return best ? { car: best, clearAhead: bestClear } : null;
}

/** Tiered hero-car pick, strictest first — used only as the final fallback once warmUpAndPickHero()'s deterministic
 * search budget is exhausted (see below), so this itself stays deterministic: it's evaluated against whatever sim
 * state the warm-up loop landed on after a fixed tick count, never against "whatever frame happens to be current".
 *
 *  1. stopped + clear ahead + isolated — ideal, ~always available given the warm-up budget.
 *  2. stopped, relaxed clearance — still safe to anchor on (it won't move), the closeup preset just clamps its
 *     forward offset to the real clearAhead so it can't overshoot onto a neighbour.
 *  3. moving + clear ahead — only if nothing suitable is stopped anywhere; not actually reachable once frozen
 *     (a moving car can't be frozen mid-flight cleanly), kept only as a defensive last resort.
 *  4. moving, relaxed clearance — last-resort real car.
 *  5. null — generic fallback cam (only when the active pool has no lane-phase car at all). */
function pickHeroCar() {
  return scoreCandidates(true, true) || scoreCandidates(false, true)
    || scoreCandidates(true, false) || scoreCandidates(false, false);
}

const WARMUP_DT = 1 / 60;
const WARMUP_CHECK_EVERY = 30; // re-score twice per simulated second
const WARMUP_MAX_TICKS = 1800; // hard cap: 30s of simulated time — always enough for a round-robin queue to form

/** Deterministically fast-forwards the simulation (fixed dt, fixed tick budget, driven straight from sim.js —
 * no rAF, no wall-clock) from showcase()'s fresh spawn state until a clean, isolated stopped car appears, then
 * returns it. Every input here (dt, tick count, and the rng draws consumed along the way) is a pure function of
 * the seed, so for a given seed/variant this always lands on exactly the same car at exactly the same pose.
 *
 * This replaces the round-2 design, which scored candidates live, inside the `traffic:closeup` preset function,
 * every time setCamera() fired — which sounds deterministic under `?fixeddt=1` but isn't: fixeddt only pins
 * *dt per frame*, not the *number* of frames that have elapsed by the time the preset function actually runs
 * (that depends on real browser/GPU frame pacing and async round-trip timing between showcase() and setCamera()).
 * Verified independently in round 2: 6 fresh page loads at the same seed/tod/preset produced 6 different SHA-256
 * screenshot hashes. Moving hero-selection here — a synchronous loop inside showcase() itself, with no real-time
 * dependency at all — removes that sensitivity entirely: the camera transform is computed once and cached
 * (S.heroShot), and the picked car is frozen (see update()) so it can't drift before the real screenshot fires
 * however many extra real-time frames later that happens to be. */
function warmUpAndPickHero() {
  for (let tick = 0; tick < WARMUP_MAX_TICKS; tick++) {
    resolveGaps(S.activeList, S.graph);
    for (const car of S.activeList) stepCar(car, WARMUP_DT, S.graph, S.simTime, S.carRng, S.pool);
    S.simTime += WARMUP_DT;
    if ((tick + 1) % WARMUP_CHECK_EVERY === 0) {
      const hero = scoreCandidates(true, true);
      if (hero) return hero;
    }
  }
  return pickHeroCar(); // budget exhausted (rare): fall back through the relaxed tiers on whatever state we ended at
}

// Purely proportional (no flat additive term) camera-distance ratios for computeHeroShot(), derived once from the
// sedan proportions round 2 verified as a genuinely clean 3/4 shot (sideOff=length*1.05+3.0, fwdOff cap=
// length*0.62+3.2 at length=4.3 -> side/fwd ratios below) and then applied uniformly to every car model. The old
// formula's flat "+3.0"/"+3.2" terms are a shrinking fraction of the total offset as length grows, so a bus (9.4m)
// landed noticeably *closer*, relative to its own size, than a sedan — filling ~83% of the closeup FOV edge-to-edge
// instead of ~64%, which read as an ugly too-tight crop rather than a hero shot. Pure proportional scaling keeps
// the subtended angle (and therefore how much of frame the car fills) the same for every model.
const HERO_SIDE_RATIO = 1.7477;
const HERO_FWD_RATIO = 1.3642;
const HERO_HEIGHT_RATIO = 2.8761;

/** The `traffic:closeup` camera transform for a picked hero — front-3/4 corner view scaled to that car model's
 * own length/height, offset toward the space scoreCandidates() verified is clear. Pulled out of the preset
 * function so warmUpAndPickHero()'s caller can compute it once and cache it (see showcase()). */
function computeHeroShot(hero) {
  const spec = hero.car.spec;
  const h = hero.car.heading;
  const fx = Math.cos(h), fz = Math.sin(h); // forward (the car's own direction of travel)
  const lx = -Math.sin(h), lz = Math.cos(h); // left
  const fwdOff = Math.min(spec.length * HERO_FWD_RATIO, Math.max(2.5, hero.clearAhead - 1));
  const sideOff = spec.length * HERO_SIDE_RATIO;
  const heightOff = spec.height * HERO_HEIGHT_RATIO;
  const hp = hero.car.pos;
  const px = hp.x + fx * fwdOff + lx * sideOff;
  const pz = hp.z + fz * fwdOff + lz * sideOff;
  const py = hp.y + heightOff;
  const tx = hp.x + fx * (spec.length * 0.05);
  const tz = hp.z + fz * (spec.length * 0.05);
  const ty = hp.y + spec.height + spec.cabin.h * 0.45;
  return { pos: [px, py, pz], target: [tx, ty, tz], fov: 40 };
}

const presets = {
  'traffic:default': (world) => {
    const b = S.bounds;
    if (!b) return fallbackCam(world);
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
    const y = world.getHeight(b.cx, b.cz);
    return { pos: [b.cx + span * 0.5, y + span * 0.5, b.cz + span * 0.62], target: [b.cx, y + 2, b.cz], fov: 48 };
  },
  'traffic:closeup': (world) => {
    // Product-shot 3/4 corner view of a real, isolated car — scaled to that car model's own length/height so it
    // fills a similar, well-composed fraction of frame regardless of sedan/van/bus. The subject and the exact
    // transform were both decided ONCE, deterministically, in showcase() (see warmUpAndPickHero() /
    // computeHeroShot()) and are just replayed here — this function does no live scoring of its own, so repeated
    // calls (and repeated fresh page loads at the same seed) always return the identical transform.
    if (S.heroShot) return S.heroShot;
    const b = S.bounds || { cx: 0, cz: 0 };
    const y = world.getHeight(b.cx - 20, b.cz + 16);
    return { pos: [b.cx - 20, y + 9, b.cz + 16], target: [b.cx, y + 1.5, b.cz], fov: 42 };
  },
  'traffic:intersection': (world) => {
    const b = S.bounds || { cx: 0, cz: 0 };
    const y = world.getHeight(b.cx, b.cz);
    return { pos: [b.cx + 32, y + 58, b.cz + 32], target: [b.cx, y, b.cz], fov: 42 };
  },
};

// ---- transit routes (bus lines) ------------------------------------------------------------------------------
// A transit line arrives as an ordered list of lane/turn keys (built by the `transit` module from the roads
// lane API) plus its stop world positions. Traffic turns that into one concatenated loop path, projects each
// stop onto it, and spawns route buses (see sim.js spawnRouteBus/advanceRoute/stepCar). Route buses are normal
// pool vehicles: they queue in the same lane buckets as cars, stop at the same lights, and cast the same
// shadows — only their turn choice and stop dwell are scripted.

/** Nearest point on a polyline ({pts,cum}) to (x,z) → { s, x, y, z, dist } or null. */
function nearestOnPath(pd, x, z) {
  let best = null;
  const pts = pd.pts, cum = pd.cum;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz;
    let u = l2 > 1e-9 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
    u = Math.max(0, Math.min(1, u));
    const px = a.x + dx * u, pz = a.z + dz * u;
    const d = Math.hypot(px - x, pz - z);
    if (!best || d < best.dist) {
      best = { s: cum[i - 1] + (cum[i] - cum[i - 1]) * u, x: px, y: a.y + (b.y - a.y) * u, z: pz, dist: d };
    }
  }
  return best;
}

/** Build one route from a raw def: concat every key's cached path into a single loop, then project the stops.
 * Returns null if any key has no cached geometry (the road network changed under the line). */
function buildRoute(def) {
  const keys = def.keys;
  if (!keys || keys.length < 2) return null;
  const pts = [], cum = [], keyStart = [];
  let total = 0;
  for (let i = 0; i < keys.length; i++) {
    const pd = S.graph.getPath(keys[i]);
    if (!pd || !pd.pts.length) return null;
    keyStart[i] = total;
    const startJ = i === 0 ? 0 : 1; // adjacent keys share their joint point (lane end == turn start)
    for (let j = startJ; j < pd.pts.length; j++) {
      const p = pd.pts[j];
      pts.push({ x: p.x, y: p.y, z: p.z });
      cum.push(total + pd.cum[j]);
    }
    total += pd.total;
  }
  if (pts.length < 2) return null;
  const routePd = { pts, cum, total };
  const stops = [];
  for (const s of def.stops || []) {
    const hit = nearestOnPath(routePd, s.x, s.z);
    if (hit) stops.push({ s: hit.s, x: hit.x, y: hit.y, z: hit.z });
  }
  stops.sort((a, b) => a.s - b.s);
  return { id: def.id, color: def.color, colorObj: new THREE.Color(def.color || '#0D69AB'), keys: keys.slice(), keyStart, total, stops, busCount: 0 };
}

/** (Re)build every route from S.transitDefs and respawn the bus slots. Returns ids that failed to build. */
function applyTransitLines() {
  const failed = [];
  for (const b of S.busSlots) { b.active = false; b.route = null; }
  S.routes = [];
  for (const def of S.transitDefs) {
    const route = buildRoute(def);
    if (route) S.routes.push(route); else failed.push(def.id);
  }
  let slot = 0;
  for (const route of S.routes) {
    const n = Math.max(1, Math.min(MAX_BUSES_PER_LINE, Math.round(route.total / BUS_MIN_LOOP_M)));
    for (let k = 0; k < n && slot < S.busSlots.length; k++) {
      const bus = S.busSlots[slot++];
      bus.color.copy(route.colorObj);
      const s0 = (route.total * (k + 0.5)) / n;
      if (spawnRouteBus(bus, S.graph, route, s0)) route.busCount++;
    }
  }
  syncActive();
  return failed;
}

const api = {
  /** fraction (0..1) of the current network's max-car capacity that should be spawned/active. */
  setDensity(frac) {
    S.density = clamp01(Number(frac));
    if (S.graph?.ready) ensureActive(Math.round(S.maxCars * S.density));
  },
  getDensity() { return S.density; },
  getVehicleCount() { return S.activeCount; },
  getMaxCars() { return S.maxCars; },
  /** [{x,y,z,heading,length}] for every active car (heading: radians, atan2 form, 0 = +X; length: metres — the
   * body the car occupies, so callers can check that it clears the profile it spans). */
  getVehiclePositions() {
    const out = [];
    for (const c of S.activeList) {
      if (!c.active) continue;
      out.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z, heading: c.heading, length: c.spec.length });
    }
    return out;
  },
  /** Replace the whole transit network. `lines`: [{ id, color, keys: [laneKey|turnKey...], stops: [{x,z}] }].
   * Returns { routes, buses, failed } — failed holds line ids whose keys no longer exist. */
  setTransitLines(lines) {
    S.transitDefs = (Array.isArray(lines) ? lines : []).map((l) => ({
      id: l.id,
      color: l.color || '#0D69AB',
      keys: Array.isArray(l.keys) ? l.keys.slice() : [],
      stops: (l.stops || []).map((s) => ({ x: s.x, z: s.z })),
    }));
    const failed = applyTransitLines();
    return { routes: S.routes.length, buses: S.busActive, failed };
  },
  /** Live per-line status for the transit UI: [{ id, buses, length, stops }]. */
  getTransitStatus() {
    return S.routes.map((r) => ({ id: r.id, buses: r.busCount, length: r.total, stops: r.stops.length }));
  },
  /** Number of route buses currently on the road (transit polls this to keep upkeep in step). */
  getTransitBusCount() { return S.busActive; },
  /** [{ x, y, z, heading, lineId }] for every route bus (transit coverage/inspection helpers). */
  getBusPositions() {
    const out = [];
    for (const b of S.busSlots) {
      if (!b.active || !b.route) continue;
      out.push({ x: b.pos.x, y: b.pos.y, z: b.pos.z, heading: b.heading, lineId: b.route.lineId });
    }
    return out;
  },
  /** Live route-bus telemetry (debugging/verification): arc position, dwell timer, next stop, speed. */
  getBusDebug() {
    const out = [];
    for (const b of S.busSlots) {
      if (!b.active || !b.route) continue;
      const r = b.route;
      const stop = r.stops[r.nextStop];
      let ahead = stop ? stop.s - b.routeS : Infinity;
      if (Number.isFinite(ahead) && ahead < -r.total * 0.5) ahead += r.total;
      out.push({
        lineId: r.lineId, routeS: b.routeS, total: r.total, dwell: r.dwell,
        nextStop: r.nextStop, stopS: stop ? stop.s : null, ahead, gap: b._aheadGap,
        speed: b.speed, s: b.s, key: b.currentKey, x: b.pos.x, z: b.pos.z,
      });
    }
    return out;
  },
  /** Force an immediate lane-graph rebuild. Transit's showcase stages roads + a bus line in the same frame, before
   * traffic's own 30 ms lazy rebuild would have run, so it needs the fresh paths synchronously. */
  rebuildNetwork() { if (S.graph) rebuildGraph(); },
  pause() { S.paused = true; },
  resume() { S.paused = false; },
  isPaused() { return S.paused; },
};

export default {
  id: 'traffic',
  deps: ['roads'],
  order: 50,
  api,
  showcaseVariants: ['default', 'intersection', 'night'],
  presets,

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('traffic');
    S.carRng = S.rng.fork('cars');
    S.group = new THREE.Group();
    S.group.name = 'traffic';
    ctx.scene.add(S.group);
    buildMeshes(ctx);
    S.graph = new LaneGraph(ctx, S.rng.fork('graph'));
    S.pool = createPool(MAX_POOL, S.rng.fork('pool'), ctx.materials);
    // Dedicated bus slots, appended after the car slots. They stay inactive until setTransitLines() gives them a
    // route, and they draw no rng, so the car pool's deterministic draw order (and every existing showcase shot)
    // is untouched.
    S.busSlots = [];
    const busSpecIdx = Math.max(0, CAR_SPECS.findIndex((s) => s.id === 'bus'));
    for (let i = 0; i < MAX_BUSES; i++) {
      const bus = new Car(MAX_POOL + i);
      bus.specIdx = busSpecIdx;
      bus.spec = CAR_SPECS[busSpecIdx];
      bus.route = null;
      bus.active = false;
      S.busSlots.push(bus);
      S.pool.push(bus);
    }
    S.density = 1; S.activeCount = 0; S.carActive = 0; S.busActive = 0; S.activeList = [];
    S.transitDefs = []; S.routes = [];
    S.paused = false; S.simTime = 0; S.bounds = null; S.heroShot = null;
    const bump = () => markDirty();
    S.unsub.push(ctx.events.on('road:added', bump));
    S.unsub.push(ctx.events.on('road:removed', bump));
    S.unsub.push(ctx.events.on('road:changed', bump));
    // roads rebuilds its network off terrain:changed too; without this the lane heights would never refresh after
    // a heightfield edit under an existing road (flatten/rebuildRegion), leaving every car at a stale y.
    S.unsub.push(ctx.events.on('terrain:changed', bump));
    markDirty();
  },

  update(dt, ctx) {
    if (S.dirty && performance.now() - S.lastEvent > 30) rebuildGraph();
    if (S.paused || !S.graph.ready) return;
    S.simTime += dt;
    resolveGaps(S.activeList, S.graph);
    // Transit priority: a route bus within a stop-line's reach holds its arm green (see LaneGraph.requestPriority).
    for (const car of S.activeList) {
      if (car.route && car.phase === 'lane' && car.total - car.s < 26) S.graph.requestPriority(car.currentKey, S.simTime);
    }
    // The showcase's hero car (if any — see warmUpAndPickHero()) is intentionally never stepped again once
    // frozen: it was picked because it's genuinely stopped at a red light with a clean, isolated frame around it,
    // and the closeup preset's cached camera transform assumes it stays exactly there. Everything else keeps
    // driving normally (resolveGaps above still treats it as a real, solid obstacle other cars queue behind).
    for (const car of S.activeList) {
      if (!car._heroFrozen) stepCar(car, dt, S.graph, S.simTime, S.carRng, S.pool);
    }
    writeInstances(ctx);
  },

  async showcase(ctx, variant = 'default') {
    S.variant = variant;
    S.simTime = 0; // showcase() always rebuilds the demo network from scratch, so restart its clock too — the
                    // warm-up fast-forward below and the signal offsets it reads both need a known starting point
                    // for the hero pick to be reproducible run to run (not dependent on how long a previous
                    // variant happened to run for in this same page).
    S.bounds = variant === 'intersection' ? buildIntersectionDemo(ctx.world) : buildGridDemo(ctx.world);
    // A showcase is a clean staging of traffic alone: drop any transit lines the full game had (their roads were
    // just cleared by the showcase runner, so they could not survive anyway).
    S.transitDefs = [];
    rebuildGraph();
    const target = variant === 'intersection' ? 16 : 42;
    const density = S.maxCars > 0 ? Math.max(0.05, Math.min(1, target / S.maxCars)) : 0;
    api.setDensity(density);
    S.paused = false;
    // Pick + freeze the traffic:closeup hero car now, synchronously, via a deterministic fast-forward — not later,
    // live, inside the camera preset (see warmUpAndPickHero() for why that was the round-2 non-determinism bug).
    for (const c of S.pool) c._heroFrozen = false;
    S.heroShot = null;
    if (S.graph.ready && S.activeCount > 0) {
      const hero = warmUpAndPickHero();
      if (hero) { hero.car._heroFrozen = true; S.heroShot = computeHeroShot(hero); }
    }
    ctx.log(`[traffic] showcase '${variant}': ${S.graph.laneKeys.length} lanes, ${Math.round(S.graph.totalLaneLength)} m total, ${S.graph.nodeSignal.size} signalled intersections, maxCars=${S.maxCars}, active=${S.activeCount}, hero=${S.heroShot ? 'locked' : 'none'}, simTime=${S.simTime.toFixed(1)}s`);
  },

  dispose(ctx) {
    for (const u of S.unsub) { try { u(); } catch (_) { /* ignore */ } }
    S.unsub.length = 0;
    if (S.group) {
      S.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      ctx.scene.remove(S.group);
    }
    if (S.kits) for (const k of S.kits) { k.bodyGeo.dispose(); k.cabinGeo.dispose(); k.wheelGeo.dispose(); k.headGeo.dispose(); k.tailGeo.dispose(); }
    S.group = null; S.graph = null; S.pool = []; S.kits = null; S.meshes = []; S.bounds = null; S.heroShot = null;
    S.busSlots = []; S.activeList = []; S.transitDefs = []; S.routes = []; S.busActive = 0; S.carActive = 0; S.activeCount = 0;
  },
};
