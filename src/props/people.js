// People animation: the rig, the clips and the walking routes for every minifig the props layer draws (the city's
// pedestrians, the set-pieces' posed figures and the guest figures other modules queue at their stops). Pure
// math: a figure's drawn pose is a function of (its rig, its seeded parameters, its route, the animation time),
// with no per-frame state, so a re-layout never moves anybody and a staged screenshot is repeatable.
//
// A figure's parts are baked in figure space by spkinds.js figureParts(), each tagged with the joint it moves
// with. Here every joint gets a matrix D so that a part draws at D[joint] * part.local:
//   root = T(position) * Ry(yaw) (* the clip's whole-body motion)
//   body = root * (rotation about the hip line),  head / arms = body * (rotation about the neck / shoulder),
//   legs = root * (rotation about the hip axis).
// Every in-place clip term is zero at t = 0, so the baked pose is the t = 0 pose.
import * as THREE from 'three';

export const JOINTS = ['root', 'body', 'head', 'armP', 'armN', 'legP', 'legN'];
export const JOINT_INDEX = Object.fromEntries(JOINTS.map((j, i) => [j, i]));
const STRIDE = 0.64;        // metres per step: one leg swing of +-0.55 rad on a 0.61 m leg
const LEG = 0.61;           // hip axis height
const LEG_SWING = 0.55, ARM_SWING = 0.45;
const TURN_SEC = 0.9;       // a walker turns round over the last part of its pause at each end of its beat
const TAU = Math.PI * 2;

const _D = JOINTS.map(() => new THREE.Matrix4());
const _r = new THREE.Matrix4();
const _t = new THREE.Matrix4();
const _e = new THREE.Euler();
const _W = { x: 0, y: 0, z: 0, yaw: 0, env: 0, phi: 0, s: 0, lat: 0, dir: 1, walked: 0, yOff: 0, yawOff: 0 };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => { const u = clamp01(v); return u * u * (3 - 2 * u); };
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
/** A sine that starts at zero: the baked pose is the pose at t = 0. */
const osc = (t, hz, ph) => Math.sin(TAU * hz * t + ph) - Math.sin(ph);
/** 0..1..0 pulse lasting `len` seconds, once every `period`, first at `offset` (never active at t = 0). */
function pulse(t, period, offset, len) {
  const u = (((t - offset) % period) + period) % period;
  return u < len ? Math.sin((Math.PI * u) / len) : 0;
}

/** The clip a rig plays when it has no route: the pose it was baked in decides. */
function clipOf(pose) {
  if (pose === 'sit' || pose === 'sitflat') return 'sit';
  if (pose === 'work') return 'work';
  if (pose === 'skate') return 'skate';
  return 'idle';
}

/** Animation record for one figure. `rig` comes from figureParts(); `prng` is the figure's own animation fork (never
 * the fork its colours were drawn from). `clip` overrides the pose's clip ('queue' for stop riders). */
export function makeFigure(rig, prng, { id, kind, x, y, z, rot, clip }) {
  const inv = (m) => m.clone().invert();
  const waveT = prng.range(9, 17);
  const watchT = prng.range(12, 20);
  const fig = {
    id, kind, x, y, z, rot, parts: [], route: null, hidden: false, far: false,
    clip: clip || clipOf(rig.pose),
    cur: { x, y, z },
    F: {
      body: rig.body, bodyI: inv(rig.body), head: rig.head, headI: inv(rig.head),
      arms: rig.arms, armsI: rig.arms.map(inv), legs: rig.legs, legsI: rig.legs ? rig.legs.map(inv) : null,
    },
    armPitch: rig.armPitch,
    prm: {
      swayHz: prng.range(0.18, 0.3), swayPh: prng.range(-0.6, 0.6),
      lookHz: prng.range(0.07, 0.13), lookPh: prng.range(-0.6, 0.6), lookAmp: prng.range(0.25, 0.45) * (prng.chance(0.5) ? 1 : -1),
      armHz: prng.range(0.12, 0.2), armPh: prng.range(-0.6, 0.6),
      // a third of the standing crowd waves now and then (not the farmer, and not an arm that is already up)
      wave: prng.chance(0.3) && rig.pose !== 'farmer' && rig.armPitch[0] > -2,
      waveT, waveO: prng.range(2, waveT - 2),
      workT: prng.range(5, 8),
      watchT, watchO: prng.range(2, watchT - 2),
      phi0: prng.range(0, TAU), speed: prng.range(1.05, 1.45), dwell: prng.range(2.5, 6), turn: prng.chance(0.5) ? 1 : -1,
    },
  };
  return fig;
}

// ---- walking routes -----------------------------------------------------------------------------------------
/** Road-bed height at along-distance s of an edge frame (roads/network.js profileAt, re-implemented here so props
 * never imports another module). */
function profileY(st, ys, s) {
  if (!st || !st.length) return 0;
  if (s <= st[0]) return ys[0];
  const n = st.length - 1;
  if (s >= st[n]) return ys[n];
  let lo = 0, hi = n;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (st[mid] <= s) lo = mid; else hi = mid; }
  return ys[lo] + (ys[hi] - ys[lo]) * ((s - st[lo]) / Math.max(1e-6, st[hi] - st[lo]));
}

/**
 * A walker's beat on one straight road edge: it paces between sA and sB (metres along the edge frame `f`) on the
 * lane `lane` (lateral metres, signed), pausing and turning round at each end.
 *  - `start` is where and when it joins the beat: { t, s, lat, y, dir, yaw, phi }. Over the first `blend` metres
 *    walked it eases from that lateral / height / yaw onto the lane, so it starts exactly where it was drawn.
 *  - `laneY`: height of the lane above the road bed, or null to keep the start's own offset (a sidewalk figure
 *    already stands on the plate).
 * A beat too short to walk (`still`) just stands at the start.
 */
export function makeRoute(f, { sA, sB, lane, laneY = null }, start, prm) {
  const R = sB - sA;
  const still = !(R >= 2);
  const s0 = Math.min(sB, Math.max(sA, start.s));
  const v = prm.speed, P = prm.dwell;
  const tw = still ? 1 : R / v;
  const dir = start.dir >= 0 ? 1 : -1;
  // cycle: walk A->B (tw), pause at B (P), walk B->A (tw), pause at A (P)
  const tauStart = dir > 0 ? (s0 - sA) / v : tw + P + (sB - s0) / v;
  const T = 2 * tw + 2 * P;
  const yOff0 = start.y - profileY(f.stations, f.ys, s0);
  const dLat = Math.abs(start.lat - lane);
  const route = {
    still, ax: f.ax, az: f.az, dx: f.d.x, dz: f.d.z, rx: f.right.x, rz: f.right.z, st: f.stations, ys: f.ys,
    edgeId: f.id, sA, sB, R, lane, v, P, tw, T, turn: prm.turn,
    tau0: (((tauStart - start.t) % T) + T) % T,
    lat0: start.lat, yOff0, yOff1: laneY === null ? yOff0 : laneY,
    blend: Math.max(1.5, dLat * 1.5),
    walked0: 0, phi0: 0, yawOff0: 0, sStill: s0,
  };
  // distance counter and stride phase continue from the start state
  const c = cycleAt(route, start.t);
  route.walked0 = c.total;
  route.phi0 = start.phi - (Math.PI / STRIDE) * c.c;
  route.yawOff0 = wrapPi(start.yaw - headingOf(route, c));
  return route;
}

/** Where a route is in its cycle at time t: s, dir, c (metres walked this cycle), total (metres ever), turn 0..1. */
const _c = { s: 0, dir: 1, c: 0, total: 0, turn: 0 };
function cycleAt(r, t) {
  if (r.still) { _c.s = r.sStill; _c.dir = 1; _c.c = 0; _c.total = 0; _c.turn = 0; return _c; }
  const u = t + r.tau0;
  const n = Math.floor(u / r.T);
  const tau = u - n * r.T;
  const { tw, P, v, R } = r;
  if (tau < tw) { _c.s = r.sA + v * tau; _c.dir = 1; _c.c = v * tau; _c.turn = 0; }
  else if (tau < tw + P) { _c.s = r.sB; _c.dir = 1; _c.c = R; _c.turn = smooth((tau - tw - (P - TURN_SEC)) / TURN_SEC); }
  else if (tau < 2 * tw + P) { const w = tau - tw - P; _c.s = r.sB - v * w; _c.dir = -1; _c.c = R + v * w; _c.turn = 0; }
  else { _c.s = r.sA; _c.dir = -1; _c.c = 2 * R; _c.turn = smooth((tau - 2 * tw - P - (P - TURN_SEC)) / TURN_SEC); }
  _c.total = _c.c + 2 * R * n;
  return _c;
}
function headingOf(r, c) {
  return Math.atan2(r.dx * c.dir, r.dz * c.dir) + Math.PI * c.turn * r.turn;
}

/** A route's drawn state at time t, written into `out` (x, y, z, yaw, env, phi, s, lat, dir, walked). */
export function walkState(r, t, out = _W) {
  const c = cycleAt(r, t);
  const walked = c.total - r.walked0;
  const b = clamp01(walked / r.blend);
  const lat = r.lane + (r.lat0 - r.lane) * (1 - b);
  out.s = c.s; out.dir = c.dir; out.lat = lat; out.walked = walked;
  out.x = r.ax + r.dx * c.s + r.rx * lat;
  out.z = r.az + r.dz * c.s + r.rz * lat;
  out.y = profileY(r.st, r.ys, c.s) + r.yOff0 + (r.yOff1 - r.yOff0) * b;
  out.yaw = headingOf(r, c) + r.yawOff0 * (1 - clamp01(walked / 1.0));
  // legs only swing while the body travels: the stride fades out over the last half metre before each end
  out.env = r.still ? 0 : clamp01(Math.min(c.s - r.sA, r.sB - c.s) / 0.5);
  out.phi = r.phi0 + (Math.PI / STRIDE) * c.c;
  return out;
}

// ---- pose ---------------------------------------------------------------------------------------------------
/** child = parent * F * R(rx, ry, rz) * F^-1 (a rotation about joint frame F's origin, in F's axes). */
function joint(out, parent, F, FI, rx, ry, rz) {
  if (rx === 0 && ry === 0 && rz === 0) return out.copy(parent);
  _r.makeRotationFromEuler(_e.set(rx, ry, rz, 'XYZ'));
  _t.multiplyMatrices(F, _r).multiply(FI);
  return out.multiplyMatrices(parent, _t);
}

/** Pose `fig` at animation time `t`: fills the joint matrices used by partMatrix() and updates fig.cur. With
 * `limbs` false only the root is computed (far figures: they still travel, but nobody can see a knee). */
export function poseFigure(fig, t, limbs = true) {
  const p = fig.prm;
  let x = fig.x, y = fig.y, z = fig.z, yaw = fig.rot;
  let env = 0, phi = 0;
  if (fig.route) {
    const w = walkState(fig.route, t, _W);
    x = w.x; y = w.y; z = w.z; yaw = w.yaw; env = w.env; phi = w.phi;
  }
  let bodyX = 0, bodyY = 0, bodyZ = 0, headX = 0, headY = 0;
  let arm0 = 0, arm1 = 0, arm0z = 0, arm1z = 0, leg0 = 0, leg1 = 0, rootX = 0, dy = 0;
  if (limbs) {
    const clip = fig.clip;
    const rest = 1 - env; // a walker idles only while it stands at the end of its beat
    if (clip === 'idle' || clip === 'queue') {
      bodyZ += 0.035 * rest * osc(t, p.swayHz, p.swayPh);
      bodyY += 0.05 * rest * osc(t, p.swayHz * 0.6, p.armPh);
      headY += p.lookAmp * (fig.route ? 0.6 : 1) * osc(t, p.lookHz, p.lookPh);
      arm0 += 0.06 * rest * osc(t, p.armHz, p.armPh);
      arm1 -= 0.06 * rest * osc(t, p.armHz, p.swayPh);
      if (clip === 'queue') {
        // every so often a rider checks a watch: one forearm up, a glance down
        const e = pulse(t, p.watchT, p.watchO, 1.6);
        arm1 += e * (-0.95 - fig.armPitch[1]);
        headX += 0.22 * e;
      } else if (p.wave && !fig.route) {
        const e = pulse(t, p.waveT, p.waveO, 1.8);
        if (e > 0) {
          arm0 += e * (-2.75 - fig.armPitch[0]);
          arm0z += 0.28 * e * Math.sin(TAU * 3 * t);
        }
      }
    } else if (clip === 'sit') {
      bodyX += 0.03 * osc(t, p.swayHz * 0.7, p.swayPh);
      headY += p.lookAmp * osc(t, p.lookHz, p.lookPh);
      arm0 += 0.08 * osc(t, p.armHz, p.armPh);
      arm1 += 0.08 * osc(t, p.armHz * 1.3, p.swayPh);
    } else if (clip === 'work') {
      // bent over the work; now and then straightens up, arms dropping, head levelling
      const e = (0.5 - 0.5 * Math.cos((TAU * t) / p.workT)) ** 2;
      bodyX -= 0.38 * e;
      arm0 += 0.55 * e; arm1 += 0.5 * e;
      headX += 0.3 * e;
      headY += p.lookAmp * 0.6 * osc(t, p.lookHz, p.lookPh);
    } else if (clip === 'skate') {
      // balancing: the board and rider rock about the board's long axis, the body counter-leans, the arms steady
      const a = osc(t, 0.5 * (0.8 + p.swayHz), p.swayPh);
      rootX += 0.06 * a;
      bodyX -= 0.09 * a;
      arm0z += 0.16 * a; arm1z += 0.16 * a;
      headY += p.lookAmp * 0.5 * osc(t, p.lookHz, p.lookPh);
    }
    if (env > 0) {
      const sw = env * Math.sin(phi);
      leg0 = LEG_SWING * sw; leg1 = -leg0;
      arm0 -= ARM_SWING * sw; arm1 += ARM_SWING * sw;
      bodyY += 0.07 * sw; headY -= 0.07 * sw;
      dy = -LEG * (1 - Math.cos(leg0)); // the swung legs are shorter than the standing ones: keep the feet down
    }
  }
  fig.cur.x = x; fig.cur.y = y; fig.cur.z = z;
  const root = _D[0];
  root.makeRotationFromEuler(_e.set(rootX, yaw, 0, 'YXZ'));
  root.setPosition(x, y + dy, z);
  if (!limbs) { for (let j = 1; j < _D.length; j++) _D[j].copy(root); return; }
  const F = fig.F;
  joint(_D[1], root, F.body, F.bodyI, bodyX, bodyY, bodyZ);
  joint(_D[2], _D[1], F.head, F.headI, headX, headY, 0);
  joint(_D[3], _D[1], F.arms[0], F.armsI[0], arm0, 0, arm0z);
  joint(_D[4], _D[1], F.arms[1], F.armsI[1], arm1, 0, -arm1z);
  if (F.legs) {
    joint(_D[5], root, F.legs[0], F.legsI[0], leg0, 0, 0);
    joint(_D[6], root, F.legs[1], F.legsI[1], leg1, 0, 0);
  } else { _D[5].copy(root); _D[6].copy(root); }
}

/** World matrix of part `i` of the figure last passed to poseFigure(). */
export function partMatrix(fig, i, out) {
  const part = fig.parts[i];
  return out.multiplyMatrices(_D[part.j], part.local);
}
