// Car pool + kinematics. Plain data objects (no per-car Object3D) driven along cached lane/turn polylines from
// lanegraph.js. Car-ahead gaps are resolved via per-frame "lane bucket" sorting instead of O(n^2) pairwise checks.

import * as THREE from 'three';
import { sampleAt } from './lanegraph.js';
import { CAR_SPECS, BODY_COLORS } from './models.js';

const MIN_GAP = 2.8;      // m, bumper-to-bumper clearance when stopped (generous so a screenshot reads as clearly not touching)
const DECEL = 4.5;        // m/s^2, actual max braking rate (rate-limits how fast car.speed can fall)
const DECEL_PLAN = 2.6;   // m/s^2, more conservative rate assumed by the safe-speed formula below — the gap between
                           // this and DECEL is margin against the rate-limiter lagging a shrinking target and overshooting
const ACCEL = 2.3;        // m/s^2
const STOP_SETBACK = 3.2; // m, extra clearance behind the lane's physical end when stopping for a red light
const MAX_HOPS = 4;       // guard against pathological zero-length segments in one frame

export class Car {
  constructor(id) {
    this.id = id;
    this.spec = CAR_SPECS[0];
    this.specIdx = 0;
    this.color = new THREE.Color(0xffffff);
    this.active = false;
    this.phase = 'lane';
    this.currentKey = null;
    this.pathData = null;
    this.total = 0;
    this.s = 0;
    this.speed = 0;
    this.braking = false;
    this.nextKey = null;
    this.approachKey = null; // set when phase='turn': the shared incoming-lane key this turn departed from
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.heading = 0;
    this._aheadGap = Infinity;
    this._frontOfBucket = false;
    this._heroFrozen = false; // true only for the showcase's traffic:closeup subject — see index.js update()
  }
}

export function createPool(count, rng, materials) {
  const pool = [];
  const specWeights = CAR_SPECS.map((s) => s.weight);
  for (let i = 0; i < count; i++) {
    const car = new Car(i);
    car.specIdx = CAR_SPECS.indexOf(rng.pickWeighted(CAR_SPECS, specWeights));
    car.spec = CAR_SPECS[car.specIdx];
    car.color.copy(materials.color(rng.pick(BODY_COLORS)));
    pool.push(car);
  }
  return pool;
}

/** Pick a spawn position on `key` that keeps clearance from any other active car already on that exact lane.
 * Deterministic, not random-retry: scans every other car on this key once, finds the single largest free
 * interval between them (and the lane ends), and drops the new car in the middle of it — a few random tries can
 * still miss a perfectly good slot (or worse, "succeed" on a mediocre one) when a lane already has several long
 * vehicles on it, which is exactly the case (buses) this most needed to be robust against. Falls back to a small
 * random jitter within that interval so repeated spawns on an empty lane don't all land dead-center. */
function pickSafeS(pool, key, total, rng, myLen) {
  const hi = Math.max(0.01, total);
  const occ = [];
  if (pool) for (const c of pool) if (c.active && c.currentKey === key) occ.push({ s: c.s, half: c.spec.length / 2 });
  if (!occ.length) return rng.range(0, hi * 0.98);
  occ.sort((a, b) => a.s - b.s);
  let bestLo = 0, bestHi = 0, bestSize = -Infinity, prevEnd = 0;
  for (const o of occ) {
    const freeEnd = o.s - o.half;
    if (freeEnd - prevEnd > bestSize) { bestSize = freeEnd - prevEnd; bestLo = prevEnd; bestHi = freeEnd; }
    prevEnd = Math.max(prevEnd, o.s + o.half);
  }
  if (hi - prevEnd > bestSize) { bestSize = hi - prevEnd; bestLo = prevEnd; bestHi = hi; }
  const mid = (bestLo + bestHi) / 2;
  const slack = Math.max(0, (bestHi - bestLo) / 2 - myLen / 2);
  return THREE.MathUtils.clamp(mid + rng.range(-slack, slack), 0, hi);
}

const _tan = new THREE.Vector3();
const _upWorld = new THREE.Vector3(0, 1, 0);
const _up = new THREE.Vector3();
const _left = new THREE.Vector3();
const _basis = new THREE.Matrix4();

/** Write car.pos/quat/heading from its current pathData+s. Called right after every spawn/respawn so a car has a
 * correct world position and orientation immediately — not just from the next stepCar() tick — since camera
 * presets (e.g. traffic:closeup) can read live car state via the public module before any simulation frame has
 * run (right after showcase() returns), and a car left at its (0,0,0) constructor default for that one moment
 * would otherwise throw off any camera built around "the nearest/best car right now". Also used by index.js after
 * a graph rebuild to re-place cars on the freshly cached geometry in the same frame.
 *
 * The vehicle is a rigid body on a profile that is not smooth: lane profiles follow the terrain's 0.4 m plates,
 * so they are ramps with kinks. Placing the body at its centre height and pitching it to the local tangent leaves
 * a long vehicle (bus/van) buried inside the step it straddles. Instead the body rides its own chord — pitched to
 * the secant between the profile points under its front and rear — lifted by half the crest deviation it spans:
 * a rigid body cannot fit a kink, so the error is split evenly between the road poking through the floor and the
 * wheels leaving the road (minimax). On a smooth slope this is exactly the old placement (chord mid == centre
 * height, secant == local tangent, no deviation); only kinks and dips change. */
export function placeOnPath(car) {
  const pd = car.pathData;
  const p = sampleAt(pd, car.s);
  const half = (car.spec?.length ?? 4.3) * 0.5;
  const sB = Math.max(0, car.s - half), sF = Math.min(pd.total, car.s + half);
  let y = p.y;
  _tan.set(p.tx, p.ty, p.tz);
  if (sF - sB > 0.4) {
    const f = sampleAt(pd, sF), b = sampleAt(pd, sB);
    const span = sF - sB;
    const chordY = (s) => b.y + (f.y - b.y) * ((s - sB) / span);
    // Every profile station the body spans (kinks live exactly at stations, so this catches every step). The body
    // rides its chord lifted by the *balanced* offset — half the crest deviation — so a step under it is shared
    // between "road pokes through the floor" and "wheels leave the road": minimax for a rigid body on a kinked
    // profile, and a no-op on a smooth slope (no stations deviate from the chord there).
    let maxDev = 0, minDev = 0;
    const pts = pd.pts, cum = pd.cum;
    for (let i = 0; i < pts.length; i++) {
      const s = cum[i];
      if (s < sB || s > sF) continue;
      const d = pts[i].y - chordY(s);
      if (d > maxDev) maxDev = d;
      else if (d < minDev) minDev = d;
    }
    y = (b.y + f.y) * 0.5 + Math.max(0, (maxDev + minDev) * 0.5);
    const fh = Math.hypot(f.x - b.x, f.z - b.z);
    const hl = Math.hypot(p.tx, p.tz);
    if (fh > 0.2 && hl > 1e-6) _tan.set(p.tx / hl, (f.y - b.y) / fh, p.tz / hl); // heading stays local, pitch is the secant
  }
  car.pos.set(p.x, y, p.z);
  if (_tan.lengthSq() > 1e-8) {
    _tan.normalize();
    // Orientation from an explicit basis (local +X along travel, local +Y as close to world up as possible).
    // Quaternion.setFromUnitVectors(+X, tan) cannot be used here: it is degenerate for a tangent pointing along
    // -X, where any tiny grade (every lane has one, following the terrain) makes it return a 180 deg *roll*
    // instead of a yaw — a westbound car renders upside down, which reads as "the car is buried in the road".
    _left.copy(_tan).cross(_upWorld);           // local +Z (car's left), perpendicular to travel
    if (_left.lengthSq() < 1e-6) _left.set(0, 0, 1); // travel ~vertical: any perpendicular reference will do
    _left.normalize();
    _up.copy(_left).cross(_tan).normalize();    // local +Y = Z x X (no roll)
    _basis.makeBasis(_tan, _up, _left);
    car.quat.setFromRotationMatrix(_basis);
    car.heading = Math.atan2(_tan.z, _tan.x);
  }
}

function spawnOn(car, graph, rng, key, pool) {
  const pd = graph.getPath(key);
  if (!pd) return false;
  car._heroFrozen = false; // a forced respawn (e.g. graph rebuild invalidating its lane) forfeits hero status —
                            // whatever clean-frame guarantee earned it that status no longer holds
  car.currentKey = key;
  car.phase = key[0] === 'L' ? 'lane' : 'turn';
  car.pathData = pd;
  car.total = pd.total;
  car.s = rng ? pickSafeS(pool, key, pd.total, rng, car.spec.length) : 0;
  car.speed = graph.baseSpeed(key) * car.spec.speedMul * (rng ? rng.range(0.85, 1.0) : 0.9);
  car.approachKey = null;
  const next = graph.commitNext(key);
  car.nextKey = next ? next.key : null;
  car.active = true;
  placeOnPath(car);
  return true;
}

/** (Re)spawn a car on a fresh random lane (used at pool creation, on graph rebuild, and dead-end fallback). */
export function spawnCar(car, graph, rng, pool) {
  const key = graph.pickSpawnLane();
  if (!key) { car.active = false; return false; }
  return spawnOn(car, graph, rng, key, pool);
}

function advance(car, carry, graph, rng, pool) {
  let hops = 0;
  let prevKey = car.currentKey;
  let key = car.nextKey;
  while (hops++ < MAX_HOPS) {
    if (!key || !graph.getPath(key)) { spawnCar(car, graph, rng, pool); return; }
    const pd = graph.getPath(key);
    const enteringTurn = key[0] === 'T' && prevKey && prevKey[0] === 'L';
    if (enteringTurn) car.approachKey = graph.approachKeyFor(prevKey);
    car.currentKey = key;
    car.phase = key[0] === 'L' ? 'lane' : 'turn';
    car.pathData = pd;
    car.total = pd.total;
    car.s = Math.max(0, carry);
    const next = graph.commitNext(key);
    car.nextKey = next ? next.key : null;
    if (car.s < car.total) return;
    carry = car.s - car.total;
    prevKey = key;
    key = car.nextKey;
  }
}

/** Build per-segment-key buckets of active cars sorted by arc-length position; writes car._aheadGap for each car.
 * Turn-phase cars bucket by their shared *approach* (the incoming lane they turned off of), not by the specific
 * connection they chose — otherwise two cars leaving the same stop line on different turns would never see each
 * other and could clip through one another right at the shared throat. */
export function resolveGaps(pool, activeCount, graph) {
  const buckets = new Map();
  const push = (key, car) => {
    if (!key) return;
    let arr = buckets.get(key);
    if (!arr) { arr = []; buckets.set(key, arr); }
    arr.push(car);
  };
  for (let i = 0; i < activeCount; i++) {
    const c = pool[i];
    if (!c.active) continue;
    push(c.phase === 'turn' ? c.approachKey : c.currentKey, c);
  }
  for (const arr of buckets.values()) {
    arr.sort((a, b) => a.s - b.s);
    for (let i = 0; i < arr.length; i++) {
      const car = arr[i];
      if (i < arr.length - 1) {
        const ahead = arr[i + 1];
        car._aheadGap = (ahead.s - car.s) - (ahead.spec.length + car.spec.length) / 2;
      } else {
        car._aheadGap = Infinity; // resolved below once every bucket exists
        car._frontOfBucket = true;
      }
    }
  }
  for (let i = 0; i < activeCount; i++) {
    const car = pool[i];
    if (!car.active || !car._frontOfBucket) continue;
    car._frontOfBucket = false;
    const downKey = car.phase === 'lane' ? graph.approachKeyFor(car.currentKey) : car.nextKey;
    const nb = downKey ? buckets.get(downKey) : null;
    if (nb && nb.length) {
      const ahead = nb[0];
      car._aheadGap = (car.total - car.s) + ahead.s - (ahead.spec.length + car.spec.length) / 2;
    }
  }
}

export function stepCar(car, dt, graph, simTime, rng, pool) {
  if (!car.active) return;
  let gap = car._aheadGap;
  if (car.phase === 'lane' && !graph.isGreen(car.currentKey, simTime)) {
    // stop a bit short of the lane's physical end: at a small intersection with long models (the bus) the raw
    // trim point can sit close enough to an adjacent (perpendicular, non-conflicting) arm's stop line that two
    // queued vehicles read as touching from some camera angles even though their paths never cross.
    const stopGap = car.total - car.s - STOP_SETBACK;
    if (stopGap < gap) gap = stopGap;
  }
  const baseSpeed = graph.baseSpeed(car.currentKey) * car.spec.speedMul;
  let targetSpeed;
  if (gap <= MIN_GAP) targetSpeed = 0;
  else if (!Number.isFinite(gap)) targetSpeed = baseSpeed;
  else targetSpeed = Math.min(baseSpeed, Math.sqrt(Math.max(0, 2 * DECEL_PLAN * (gap - MIN_GAP))));
  const diff = targetSpeed - car.speed;
  const rate = diff > 0 ? ACCEL : DECEL;
  const maxDelta = rate * dt;
  car.speed = Math.max(0, car.speed + Math.max(-maxDelta, Math.min(maxDelta, diff)));
  // Keep the bright brake/stopped taillight while actually decelerating hard, AND while held at a standstill
  // (queued at a red light or behind another stopped car) — real brake lights stay lit the whole time a car is
  // stopped, not just during the moment of deceleration, so a queue doesn't flicker back to the dim running light
  // the instant it settles to speed 0.
  car.braking = diff < -0.35 || (targetSpeed <= 0.05 && car.speed <= 0.15);

  let dist = car.speed * dt;
  if (Number.isFinite(gap)) dist = Math.min(dist, Math.max(0, gap - 0.05));
  car.s += dist;
  if (car.s >= car.total - 1e-4) advance(car, car.s - car.total, graph, rng, pool);

  placeOnPath(car);
}
