// Deterministic height-field generation for the Lego baseplate landscape.
// All heights in meters, quantized to PLATE (0.4 m) so the ground reads as stacked plates.

import { PLATE, BRICK, BRICK2, quantize, smoothstep, mix } from './data.js';

export const VARIANTS = {
  default: {
    plateauR: 260, plateauH: 4.8, hillHeight: 26, bayX: 700, riverZ: 470, islands: [],
  },
  water: {
    plateauR: 220, plateauH: 3.6, hillHeight: 21, bayX: 250, riverZ: 470,
    islands: [{ x: 640, z: -220, r: 130, h: 5.2 }, { x: 790, z: 420, r: 80, h: 2.4 }, { x: 470, z: 120, r: 45, h: 1.2 }],
  },
};
VARIANTS.closeup = VARIANTS.default;

export function variantParams(variant) {
  return VARIANTS[variant] || VARIANTS.default;
}

/** River centreline z for a given x. */
export function riverZ(rng, P, x) {
  return P.riverZ + 130 * Math.sin(x / 300 + 1.3) + 70 * rng.fbm(x / 260 + 4.2, 7.7, 3);
}
export function riverHalfWidth(rng, x) {
  return 30 + 12 * rng.fbm(x / 220 + 8.8, 2.2, 2);
}
/** Coastline x for a given z (water for x > coast). */
export function coastX(rng, P, z) {
  return P.bayX + 90 * Math.sin(z / 330 + 0.4) + 80 * rng.fbm(z / 260 + 1.5, 5.1, 3);
}

/** Continuous (un-quantized) height at world (x, z). */
export function continuousHeight(rng, P, halfW, x, z) {
  // Rolling plains: mostly within +-4 m, biased above sea level so only a few ponds appear.
  let h = 2.0 + 4.0 * rng.fbm(x / 1100 + 3.1, z / 1100 - 2.2, 4) + 0.9 * rng.fbm(x / 140 + 9.0, z / 140 + 4.0, 2);

  // Hills near the map edges (not on the bay side).
  const edge = Math.max(Math.abs(x), Math.abs(z)) / halfW;
  let hillMask = smoothstep(0.42, 0.78, edge);
  hillMask *= 1 - smoothstep(P.bayX - 420, P.bayX + 40, x);
  if (hillMask > 0) {
    const hn = rng.fbm(x / 330 + 21.7, z / 330 - 13.4, 5, 2, 0.5);
    const ridged = 1 - Math.abs(rng.fbm(x / 220 - 5.5, z / 220 + 8.8, 4));
    const shape = Math.min(1, Math.max(0, hn * 1.7 + 0.25));
    const hills = P.hillHeight * hillMask * Math.pow(shape, 1.25) * (0.55 + 0.45 * ridged);
    h += hills;
  }

  // Broad flat central plateau (rounded square) for downtown: a table with a short, steep edge so the rim reads
  // as one or two tall, unmistakable rock terraces (not a gentle ramp) from the air, standing on a lower apron.
  const r4 = Math.pow(x * x * x * x + z * z * z * z, 0.25);
  const pt = smoothstep(P.plateauR, P.plateauR + 14, r4);
  const apron = 1 - smoothstep(P.plateauR + 40, P.plateauR + 260, r4);
  h = mix(h, Math.min(h, P.plateauH - 3.2), apron);
  h = mix(P.plateauH, h, pt);

  // Meandering river with a low flood plain either side.
  const zr = riverZ(rng, P, x);
  const d = Math.abs(z - zr);
  const W = riverHalfWidth(rng, x);
  const valley = 1 - smoothstep(W, W + 110, d);
  if (valley > 0) h = mix(h, Math.min(h, 0.8), valley);
  if (d < W) {
    const t = d / W;
    const bed = -0.6 - 2.8 * Math.sqrt(Math.max(0, 1 - t * t));
    h = Math.min(h, bed);
  }

  // Bay on the east side with a coastal plain.
  const xc = coastX(rng, P, z);
  const dx = x - xc;
  if (dx > -160) h = mix(h, Math.min(h, 0.8), smoothstep(-160, -30, dx));
  if (dx > 0) h = Math.min(h, -0.6 - 3.0 * smoothstep(0, 90, dx));

  // Islands (water variant).
  for (const isl of P.islands) {
    const di = Math.hypot(x - isl.x, z - isl.z) / isl.r;
    if (di < 1) {
      const bump = isl.h * (1 - di * di) * (1 - di * di) + 0.6 * rng.fbm(x / 60 + 1.1, z / 60 - 0.4, 2);
      h = Math.max(h, bump - 0.4);
    }
  }
  return h;
}

/**
 * Terrace step for a vertex: plains step by single plates, gentle rises by 2 plates, hills by whole bricks
 * (3 plates), and hill crests / the plateau rim by tall 5-plate (2.0 m) risers with a clearly flat tread between
 * them — vertical steps big enough to cast a legible shadow at any sun angle instead of a hairline ledge.
 */
export function stepFor(h, slope) {
  if (h > 10.0 || slope > 0.10) return BRICK2;
  if (h > 7.0 || slope > 0.06) return BRICK;
  if (h > 4.9 || slope > 0.03) return 0.8;
  return PLATE;
}

/** Builds the full (w+1)*(h+1) vertex height field for a variant. */
export function generateHeightField(world, rng, variant = 'default') {
  const P = variantParams(variant);
  const { w, h } = world.size;
  const cs = world.cellSize;
  const w1 = w + 1, h1 = h + 1;
  const raw = new Float32Array(w1 * h1);
  const out = new Float32Array(w1 * h1);
  const minX = world.minX, minZ = world.minZ;
  const halfW = world.widthMeters / 2;
  for (let j = 0; j < h1; j++) {
    const z = minZ + j * cs;
    for (let i = 0; i < w1; i++) raw[j * w1 + i] = continuousHeight(rng, P, halfW, minX + i * cs, z);
  }
  // slope from a 3x3 neighbourhood of the continuous field (rise per metre), smoothed so the step size does not
  // flicker between adjacent vertices
  for (let j = 0; j < h1; j++) {
    for (let i = 0; i < w1; i++) {
      const k = j * w1 + i;
      const iL = Math.max(0, i - 1), iR = Math.min(w, i + 1), jD = Math.max(0, j - 1), jU = Math.min(h, j + 1);
      const gx = (raw[j * w1 + iR] - raw[j * w1 + iL]) / ((iR - iL) * cs);
      const gz = (raw[jU * w1 + i] - raw[jD * w1 + i]) / ((jU - jD) * cs);
      const slope = Math.hypot(gx, gz);
      const hv = raw[k];
      const q = stepFor(hv, slope);
      // shore plates stay fine so beaches slope gently into the water
      out[k] = quantize(hv, hv < 1.4 ? PLATE : q);
    }
  }
  return out;
}
