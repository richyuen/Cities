// Seeded deterministic RNG (sfc32) + hashing + value noise. No Math.random anywhere in the app.

export function hashString(str) {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mix(a, b) {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= b;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export class Rng {
  constructor(seed = 1, name = 'root') {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this.name = name;
    let s = this.seed;
    this.a = mix(s, 0x1234567);
    this.b = mix(s, 0x89abcdef);
    this.c = mix(s, 0x0badf00d);
    this.d = mix(s, 0xdeadbeef) | 1;
    for (let i = 0; i < 12; i++) this.float();
  }

  /** [0,1) */
  float() {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return (t >>> 0) / 4294967296;
  }

  /** integer in [min, max] inclusive */
  int(min, max) {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** float in [min, max) */
  range(min, max) {
    return min + this.float() * (max - min);
  }

  chance(p) {
    return this.float() < p;
  }

  pick(arr) {
    return arr[Math.floor(this.float() * arr.length)];
  }

  /** weighted pick: weights array parallel to items */
  pickWeighted(items, weights) {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.float() * total;
    for (let i = 0; i < items.length; i++) {
      r -= weights[i];
      if (r <= 0) return items[i];
    }
    return items[items.length - 1];
  }

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  gaussian(mean = 0, std = 1) {
    let u = 0, v = 0;
    while (u === 0) u = this.float();
    while (v === 0) v = this.float();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Independent child stream; same name + same parent seed => same stream. */
  fork(name) {
    return new Rng(mix(this.seed, hashString(String(name))), `${this.name}/${name}`);
  }

  /** Stateless hash of integer coords to [0,1) — for spatially coherent randomness */
  hash2(x, y) {
    return mix(mix(this.seed, x | 0), y | 0) / 4294967296;
  }

  hash3(x, y, z) {
    return mix(mix(mix(this.seed, x | 0), y | 0), z | 0) / 4294967296;
  }

  /** Smooth value noise in [-1, 1] */
  noise2D(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = this.hash2(xi, yi), b = this.hash2(xi + 1, yi);
    const c = this.hash2(xi, yi + 1), d = this.hash2(xi + 1, yi + 1);
    const n = (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
    return n * 2 - 1;
  }

  /** Fractal brownian motion in [-1, 1] */
  fbm(x, y, octaves = 5, lacunarity = 2, gain = 0.5) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise2D(x * freq + i * 17.3, y * freq - i * 11.7);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }
}
