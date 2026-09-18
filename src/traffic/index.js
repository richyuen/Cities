// traffic — Lego-style cars driving the `roads` lane network. All cars are plain data (no per-car Object3D),
// rendered through a handful of InstancedMesh sets (grouped by car model) rewritten every frame.

import * as THREE from 'three';
import { LaneGraph } from './lanegraph.js';
import { buildCarKits } from './models.js';
import { createPool, spawnCar, stepCar, resolveGaps } from './sim.js';
import { buildGridDemo, buildIntersectionDemo } from './showcase.js';

const MAX_POOL = 300;
const DEFAULT_MAX_CARS = 80; // used only when there is no lane data yet to size against (empty world)
const clamp01 = (v) => Math.max(0, Math.min(1, v));

const S = {
  ctx: null, rng: null, carRng: null, group: null, graph: null, pool: [], kits: null, materials: null,
  meshes: [], // per-model: { body, cabin, wheel, head, tailNormal, tailBrake }
  density: 1, activeCount: 0, maxCars: DEFAULT_MAX_CARS, paused: false, simTime: 0,
  dirty: true, lastEvent: 0, unsub: [], bounds: null, variant: null,
  heroShot: null, // cached {pos,target,fov} for traffic:closeup — decided once, deterministically, in showcase()
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
  const n = Math.min(count, S.pool.length);
  for (let i = 0; i < n; i++) {
    const car = S.pool[i];
    if (!car.active || !S.graph.getPath(car.currentKey)) spawnCar(car, S.graph, S.carRng, S.pool);
  }
  S.activeCount = n;
}

function rebuildGraph() {
  S.graph.rebuild();
  S.maxCars = computeMaxCars(S.ctx, S.graph) || DEFAULT_MAX_CARS;
  const target = Math.round(S.maxCars * S.density);
  ensureActive(S.graph.ready ? target : 0);
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
  for (let i = 0; i < S.activeCount; i++) {
    const car = S.pool[i];
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
  for (let i = 0; i < S.activeCount; i++) {
    const c = S.pool[i];
    if (!c.active || c.phase !== 'lane') continue;
    if (requireStopped && c.speed >= HERO_STOP_SPEED) continue;
    let clearAhead = c.total - c.s; // distance to the physical lane end if nothing else is ahead
    let clearBehind = c.s;          // distance back to the lane start if nothing else is behind
    let nearbyCount = 0;            // other cars inside the shot's rough footprint, any direction/lane
    for (let j = 0; j < S.activeCount; j++) {
      if (j === i) continue;
      const o = S.pool[j];
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
    resolveGaps(S.pool, S.activeCount, S.graph);
    for (let i = 0; i < S.activeCount; i++) stepCar(S.pool[i], WARMUP_DT, S.graph, S.simTime, S.carRng, S.pool);
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

const api = {
  /** fraction (0..1) of the current network's max-car capacity that should be spawned/active. */
  setDensity(frac) {
    S.density = clamp01(Number(frac));
    if (S.graph?.ready) ensureActive(Math.round(S.maxCars * S.density));
  },
  getDensity() { return S.density; },
  getVehicleCount() { return S.activeCount; },
  getMaxCars() { return S.maxCars; },
  /** [{x,y,z,heading}] for every active car (heading: radians, atan2 form, 0 = +X). */
  getVehiclePositions() {
    const out = [];
    for (let i = 0; i < S.activeCount; i++) {
      const c = S.pool[i];
      if (!c.active) continue;
      out.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z, heading: c.heading });
    }
    return out;
  },
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
    S.density = 1; S.activeCount = 0; S.paused = false; S.simTime = 0; S.bounds = null; S.heroShot = null;
    const bump = () => markDirty();
    S.unsub.push(ctx.events.on('road:added', bump));
    S.unsub.push(ctx.events.on('road:removed', bump));
    markDirty();
  },

  update(dt, ctx) {
    if (S.dirty && performance.now() - S.lastEvent > 30) rebuildGraph();
    if (S.paused || !S.graph.ready) return;
    S.simTime += dt;
    resolveGaps(S.pool, S.activeCount, S.graph);
    // The showcase's hero car (if any — see warmUpAndPickHero()) is intentionally never stepped again once
    // frozen: it was picked because it's genuinely stopped at a red light with a clean, isolated frame around it,
    // and the closeup preset's cached camera transform assumes it stays exactly there. Everything else keeps
    // driving normally (resolveGaps above still treats it as a real, solid obstacle other cars queue behind).
    for (let i = 0; i < S.activeCount; i++) {
      const car = S.pool[i];
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
  },
};
