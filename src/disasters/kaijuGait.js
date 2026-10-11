// Kaiju gait: the pure math both the simulation (index.js) and the rig (kaiju.js) read, so the feet that are drawn
// are the feet that stomp. No THREE, no state of its own.
//
// Conventions: `heading` is atan2(dz, dx); forward = (cos h, sin h); a side is +1 (right, local +Z) or -1 (left).
// The rig's local space has +X forward, so its group is rotated by -heading about Y.
// A kaiju record `k` carries { x, z, heading, age, walked, steps, footL, footR, ... } (index.js).
//
// The walk has no double support: a foot lands every K_STEP_LEN of hip travel, half a step ahead of the hip, stays
// planted for one step (until the hip is half a step past it), then swings over the next one.

export const K_HEIGHT = 55;          // m, top of the back plates on the head
export const K_HIP_Y = 24;           // m, hip joint above the ground when standing
export const K_BONE = 12;            // m, thigh and shin (24 m reach)
export const K_STEP_LEN = 12;        // m of hip travel per footfall
export const K_FOOT_LATERAL = 4.5;   // m, feet land this far either side of the path
export const K_TAIL_BASE = 2;        // m behind the hip where the tail starts
export const K_TAIL_SEG = 6;         // m per tail segment
export const K_TAIL_SEGS = 4;        // sample points 8, 14, 20, 26 m along the tail
export const K_TAIL_LEN = K_TAIL_BASE + K_TAIL_SEG * K_TAIL_SEGS;
export const K_TAIL_SWING = 0.55;    // rad, peak yaw of the tail against the body
export const K_MOUTH_FWD = 15;       // m ahead of the hip
export const K_MOUTH_Y = 48;         // m above the ground
export const K_RISE_SEC = 1.5;       // climbs out of the ground
export const K_SINK_SEC = 1.5;       // sinks back into it
export const K_BREATH_DUR = 2.5;     // s of fire per breath

/** +1 / -1: the side whose foot lands on footfall `n`. */
export function sideOf(n) { return (n & 1) === 0 ? 1 : -1; }

/** 0..1: progress from the last footfall to the next. */
export function stepPhase(k) {
  const p = k.walked / K_STEP_LEN - k.steps;
  return p < 0 ? 0 : p > 1 ? 1 : p;
}

/** Where the `side` foot lands on footfall `stepIndex`, on the kaiju's present heading: [x, z]. */
export function footPlant(k, side, stepIndex) {
  const c = Math.cos(k.heading), s = Math.sin(k.heading);
  const ahead = stepIndex * K_STEP_LEN - k.walked + K_STEP_LEN / 2;
  return [k.x + c * ahead - s * side * K_FOOT_LATERAL, k.z + s * ahead + c * side * K_FOOT_LATERAL];
}

/** World yaw of tail segment `i` (0 = at the body). The swing follows the stride and travels down the tail; a
 * slow sway on the kaiju's own age keeps it alive while it stands. */
export function tailYaw(k, i = 0) {
  const stride = Math.sin(Math.PI * k.walked / K_STEP_LEN - i * 0.55);
  const sway = Math.sin(k.age * 0.9 - i * 0.4) * 0.12;
  return k.heading + Math.PI + (K_TAIL_SWING * stride + sway) * (0.45 + 0.25 * i);
}

/** The ends of the tail segments, flat [x0, z0, x1, z1, ...] (K_TAIL_SEGS pairs), written into `out`. */
export function tailPoints(k, out = []) {
  let x = k.x - Math.cos(k.heading) * K_TAIL_BASE, z = k.z - Math.sin(k.heading) * K_TAIL_BASE;
  for (let i = 0; i < K_TAIL_SEGS; i++) {
    const a = tailYaw(k, i);
    x += Math.cos(a) * K_TAIL_SEG; z += Math.sin(a) * K_TAIL_SEG;
    out[i * 2] = x; out[i * 2 + 1] = z;
  }
  return out;
}

/** The mouth, where the fire comes from: [x, y above the ground, z]. */
export function mouthPoint(k) {
  return [k.x + Math.cos(k.heading) * K_MOUTH_FWD, K_MOUTH_Y, k.z + Math.sin(k.heading) * K_MOUTH_FWD];
}

/** 0 (fully underground) .. 1 (standing): the rise at spawn and the sink at the end. */
export function emerged(k) {
  if (k.phase === 'rise') { const t = Math.min(1, Math.max(0, k.age / K_RISE_SEC)); return t * t * (3 - 2 * t); }
  if (k.phase === 'sink') { const t = Math.min(1, Math.max(0, k.sinkT || 0)); return 1 - t * t; }
  return 1;
}

/** 0 outside a breath, else 0..1 through it. */
export function breathT(k) {
  if (!(k.breathUntil > k.age)) return 0;
  return Math.min(1, Math.max(1e-3, 1 - (k.breathUntil - k.age) / K_BREATH_DUR));
}
