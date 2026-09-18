// CPU side of the environment's sky model. `skyParams()` turns sun elevation + weather into the uniform set the
// sky dome shader (sky.js) consumes, and `skySample()` evaluates the same analytic model (minus the cloud noise)
// for a direction so fog / horizon colours match exactly what the dome paints. All colours are linear RGB
// radiance that the composer's OutputPass tone-maps (ACES) — nothing here is display-referred.

export const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (x) => Math.max(0, Math.min(1, x));
export const mix3 = (a, b, t, out = [0, 0, 0]) => { out[0] = lerp(a[0], b[0], t); out[1] = lerp(a[1], b[1], t); out[2] = lerp(a[2], b[2], t); return out; };
export const luminance = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** Piecewise-linear colour ramp: keys = [[x, [r,g,b]], ...] sorted by x. */
export function ramp(keys, x, out = [0, 0, 0]) {
  if (x <= keys[0][0]) { const c = keys[0][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out; }
  for (let i = 1; i < keys.length; i++) {
    if (x <= keys[i][0]) {
      const t = (x - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return mix3(keys[i - 1][1], keys[i][1], t, out);
    }
  }
  const c = keys[keys.length - 1][1]; out[0] = c[0]; out[1] = c[1]; out[2] = c[2]; return out;
}

// ---- colour ramps keyed by sun elevation in degrees (linear RGB) ---------------------------------------------
// clear sky
const ZENITH = [[-18, [0.008, 0.013, 0.040]], [-9, [0.015, 0.026, 0.080]], [-3, [0.035, 0.065, 0.210]], [2, [0.055, 0.120, 0.380]], [10, [0.070, 0.190, 0.600]], [25, [0.080, 0.240, 0.780]], [90, [0.085, 0.255, 0.840]]];
const HORIZON_AWAY = [[-18, [0.014, 0.020, 0.050]], [-9, [0.045, 0.045, 0.100]], [-3, [0.300, 0.200, 0.290]], [2, [0.560, 0.440, 0.470]], [10, [0.500, 0.600, 0.800]], [25, [0.460, 0.600, 0.840]], [90, [0.480, 0.620, 0.860]]];
const HORIZON_SUN = [[-18, [0.014, 0.020, 0.050]], [-9, [0.160, 0.060, 0.090]], [-3, [0.900, 0.300, 0.110]], [0, [1.150, 0.500, 0.180]], [4, [1.100, 0.660, 0.330]], [10, [0.950, 0.780, 0.580]], [25, [0.760, 0.790, 0.880]], [90, [0.660, 0.760, 0.900]]];
const GLOW = [[-9, [0.000, 0.000, 0.000]], [-3, [1.000, 0.300, 0.060]], [0, [1.800, 0.750, 0.200]], [4, [1.700, 0.980, 0.420]], [10, [1.400, 1.100, 0.700]], [25, [1.100, 1.100, 1.000]], [90, [1.000, 1.000, 1.000]]];
const SUN_DISC = [[-3, [6.0, 1.5, 0.3]], [0, [14.0, 5.0, 1.2]], [4, [22.0, 11.0, 4.0]], [12, [30.0, 22.0, 12.0]], [30, [34.0, 31.0, 26.0]], [90, [36.0, 34.0, 30.0]]];
// clouds: ambient (self-lit by sky) and the sun-lit term added on faces toward the sun
const CLOUD_AMB = [[-18, [0.010, 0.014, 0.030]], [-9, [0.028, 0.030, 0.060]], [-3, [0.230, 0.160, 0.220]], [2, [0.420, 0.340, 0.400]], [10, [0.700, 0.700, 0.800]], [25, [0.900, 0.930, 1.020]], [90, [0.960, 0.990, 1.060]]];
const CLOUD_LIT = [[-9, [0.000, 0.000, 0.000]], [-3, [0.450, 0.130, 0.040]], [0, [1.000, 0.420, 0.150]], [4, [1.050, 0.620, 0.320]], [10, [0.800, 0.660, 0.500]], [25, [0.600, 0.580, 0.540]], [90, [0.560, 0.550, 0.520]]];
// overcast deck (uniform grey stratus, brightness tracks elevation)
const DECK = [[-18, [0.006, 0.008, 0.014]], [-9, [0.020, 0.022, 0.034]], [-3, [0.120, 0.105, 0.115]], [2, [0.240, 0.230, 0.245]], [10, [0.400, 0.410, 0.440]], [25, [0.520, 0.540, 0.580]], [90, [0.560, 0.580, 0.620]]];

const _t = [0, 0, 0];

/**
 * Sky model parameters for the dome shader and the CPU sampler.
 * @param {number} e sun elevation, degrees
 * @param {{cloud:number, rain:number, fog:number}} wf weather factors (0..1)
 */
export function skyParams(e, wf, out = {}) {
  const cloud = clamp01(wf.cloud), fog = clamp01(wf.fog), rain = clamp01(wf.rain);
  const overcast = clamp01(smoothstep(0.45, 0.92, cloud) + fog * 1.1);
  const day = smoothstep(-6, 10, e);
  const p = out;
  p.overcast = overcast; p.day = day;
  p.zenith = ramp(ZENITH, e, p.zenith || [0, 0, 0]);
  p.horizonAway = ramp(HORIZON_AWAY, e, p.horizonAway || [0, 0, 0]);
  p.horizonSun = ramp(HORIZON_SUN, e, p.horizonSun || [0, 0, 0]);
  p.glow = ramp(GLOW, e, p.glow || [0, 0, 0]);
  p.sunDisc = ramp(SUN_DISC, e, p.sunDisc || [0, 0, 0]);
  p.cloudAmb = ramp(CLOUD_AMB, e, p.cloudAmb || [0, 0, 0]);
  p.cloudLit = ramp(CLOUD_LIT, e, p.cloudLit || [0, 0, 0]);
  const deck = ramp(DECK, e, _t);
  // overcast: the whole sky collapses toward a grey deck; the sun glow is a diffuse bright patch, no disc
  const deckL = luminance(deck);
  const grey = (c, k, tint) => { const l = luminance(c); c[0] = lerp(c[0], l * tint[0], k); c[1] = lerp(c[1], l * tint[1], k); c[2] = lerp(c[2], l * tint[2], k); };
  const cool = [0.96, 0.98, 1.04];
  grey(p.zenith, overcast * 0.9, cool); grey(p.horizonAway, overcast * 0.85, cool); grey(p.horizonSun, overcast * 0.85, cool);
  for (let i = 0; i < 3; i++) {
    p.zenith[i] = lerp(p.zenith[i], deck[i] * 0.85, overcast);
    p.horizonAway[i] = lerp(p.horizonAway[i], deck[i] * 1.15, overcast);
    p.horizonSun[i] = lerp(p.horizonSun[i], deck[i] * 1.25, overcast);
    p.glow[i] = lerp(p.glow[i], deckL * 0.5 * cool[i], overcast);
    p.sunDisc[i] = p.sunDisc[i] * (1 - smoothstep(0.35, 0.75, cloud)) * (1 - smoothstep(0.1, 0.4, fog));
    p.cloudAmb[i] = lerp(p.cloudAmb[i], deck[i] * cool[i], overcast);
    p.cloudLit[i] = lerp(p.cloudLit[i], deckL * 0.22 * cool[i], overcast);
  }
  // rain darkens the deck a touch and cools it
  if (rain > 0) for (let i = 0; i < 3; i++) { const k = 1 - 0.22 * rain; p.zenith[i] *= k; p.horizonAway[i] *= k; p.horizonSun[i] *= k; p.cloudAmb[i] *= k; p.glow[i] *= k; }
  p.glowG = lerp(0.92, 0.6, overcast);                   // HG anisotropy of the sun halo (tight core + softer lobe)
  p.horK = lerp(lerp(5.5, 3.2, smoothstep(0, 20, e)), 2.2, overcast); // horizon band falloff
  p.glowK = lerp(1.0, 0.35, overcast) * lerp(1.0, 0.6, fog);
  p.coverage = lerp(0.46, 1.0, smoothstep(0.0, 0.9, cloud));
  p.density = lerp(0.85, 1.6, cloud);
  p.cloudSharp = lerp(0.16, 0.10, overcast);            // mask softness: cumulus have crisp edges, stratus none
  p.haze = 0.35 + 0.45 * cloud + 1.2 * fog;             // strength of the horizon haze band
  p.hazeK = lerp(14, 1.8, smoothstep(0.1, 0.8, fog));    // how high the haze band reaches
  return p;
}

const _hor = [0, 0, 0], _sky = [0, 0, 0], _cl = [0, 0, 0];

/**
 * Analytic sky radiance for a direction (mirrors sky.js minus the cloud noise; clouds enter as a coverage-weighted
 * deck so fog under an overcast sky carries the deck colour).
 */
export function skySample(p, dir, sun, out = [0, 0, 0]) {
  const h = dir[1];
  const sh = Math.hypot(sun[0], sun[2]) || 1e-5, dh = Math.hypot(dir[0], dir[2]) || 1e-5;
  const az = clamp01((dir[0] * sun[0] + dir[2] * sun[2]) / (sh * dh) * 0.5 + 0.5);
  const azw = Math.pow(az, 2.2);
  mix3(p.horizonAway, p.horizonSun, azw, _hor);
  const band = Math.exp(-Math.max(h, 0) * p.horK);
  mix3(p.zenith, _hor, band, _sky);
  // sun halo (Henyey-Greenstein) + wide forward lobe
  const cosT = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2];
  const g = p.glowG;
  const hgf = (g) => { const g2 = g * g; return ((1 - g2) / Math.pow(1 + g2 - 2 * g * cosT, 1.5)) * (1 - g) * (1 - g) / (1 + g); }; // peak-normalised
  const halo = (0.55 * hgf(g) + 0.22 * hgf(g * 0.82) + 0.06 * Math.pow(Math.max(cosT, 0), 4)) * p.glowK;
  const horizonBoost = 1 - 0.6 * smoothstep(0.05, 0.6, h);
  for (let i = 0; i < 3; i++) _sky[i] += p.glow[i] * halo * horizonBoost;
  // clouds as a coverage-weighted deck (lit half + ambient)
  const cover = smoothstep(0.0, 1.0, p.coverage) * smoothstep(-0.02, 0.15, h);
  const aerial = smoothstep(0.35, 0.0, Math.max(h, 0));
  for (let i = 0; i < 3; i++) _cl[i] = lerp(p.cloudAmb[i] + 0.45 * p.cloudLit[i], _hor[i], 0.75 * aerial);
  const alpha = cover * 0.85;
  for (let i = 0; i < 3; i++) out[i] = lerp(_sky[i], _cl[i], alpha);
  return out;
}
