import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

// Asset loader. Reads /assets/manifest.json ({ name: { files: {map, normalMap, ...} | file, source, license } }).
// Every accessor falls back to a procedural stand-in so modules keep working without downloads.

export class Assets {
  constructor(rng, log) {
    this.rng = rng.fork('assets');
    this.log = log;
    this.manifest = {};
    this.cache = new Map();
    this.texLoader = new THREE.TextureLoader();
    this.hdrLoader = new HDRLoader();
    this.missing = new Set();
  }

  async load() {
    try {
      const r = await fetch(this.resolve('/assets/manifest.json'), { cache: 'no-cache' });
      if (r.ok) this.manifest = await r.json();
    } catch (e) {
      this.log('[assets] no manifest, using procedural fallbacks');
    }
  }

  has(name) { return !!this.manifest[name]; }

  /** Manifest URLs are recorded as absolute ('/assets/...'); resolve them against the app's base path
   * (e.g. '/Cities/' on GitHub Pages) instead of the domain root. Leaves already-relative/absolute-http
   * URLs untouched. */
  resolve(url) {
    if (!url || !url.startsWith('/')) return url;
    const base = import.meta.env.BASE_URL || '/';
    return base.replace(/\/$/, '') + url;
  }

  _load(url, { srgb = false, repeat = 1, anisotropy = 8 } = {}) {
    return new Promise((resolve, reject) => {
      this.texLoader.load(url, (t) => {
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(repeat, repeat);
        t.anisotropy = anisotropy;
        resolve(t);
      }, undefined, reject);
    });
  }

  /** Single texture by manifest name (or direct url). */
  async texture(name, opts = {}) {
    const key = `tex:${name}:${JSON.stringify(opts)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const entry = this.manifest[name];
    const url = this.resolve(entry?.file) || (name.includes('/') ? name : null);
    let tex = null;
    if (url) {
      try { tex = await this._load(url, opts); } catch (e) { this.log(`[assets] failed ${url}, falling back`); }
    }
    if (!tex) { this.missing.add(name); tex = this.proceduralNoise(name, opts); }
    this.cache.set(key, tex);
    return tex;
  }

  /** PBR set: { map, normalMap, roughnessMap, aoMap } — any missing slot is null/procedural. */
  async pbr(name, { repeat = 1 } = {}) {
    const key = `pbr:${name}:${repeat}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const entry = this.manifest[name];
    const out = { map: null, normalMap: null, roughnessMap: null, aoMap: null, displacementMap: null };
    if (entry?.files) {
      for (const slot of Object.keys(out)) {
        const url = this.resolve(entry.files[slot]);
        if (!url) continue;
        try { out[slot] = await this._load(url, { srgb: slot === 'map', repeat }); }
        catch (e) { this.log(`[assets] failed ${url}`); }
      }
    }
    if (!out.map) { this.missing.add(name); out.map = this.proceduralNoise(name, { repeat, srgb: true }); }
    if (!out.normalMap) out.normalMap = this.proceduralNormal(name, { repeat });
    this.cache.set(key, out);
    return out;
  }

  /** Equirect HDR texture, or null if unavailable (environment falls back to procedural sky). */
  async hdri(name) {
    const key = `hdri:${name}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const entry = this.manifest[name];
    let tex = null;
    if (entry?.file) {
      try {
        tex = await new Promise((res, rej) => this.hdrLoader.load(this.resolve(entry.file), res, undefined, rej));
        tex.mapping = THREE.EquirectangularReflectionMapping;
      } catch (e) { this.log(`[assets] hdri ${name} failed, procedural sky will be used`); }
    }
    if (!tex) this.missing.add(name);
    this.cache.set(key, tex);
    return tex;
  }

  // ---- procedural fallbacks ------------------------------------------------------
  proceduralNoise(name, { repeat = 1, srgb = true, size = 256, base = 0.7, amp = 0.12 } = {}) {
    const rng = this.rng.fork(name);
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = 0.5 + 0.5 * rng.fbm(x / 32, y / 32, 4);
        const v = Math.max(0, Math.min(1, base + (n - 0.5) * amp * 2)) * 255;
        const i = (y * size + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, size, size);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  proceduralNormal(name, { repeat = 1, size = 256, strength = 0.35 } = {}) {
    const rng = this.rng.fork(name + ':n');
    const h = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = rng.fbm(x / 24, y / 24, 4);
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
        const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
        const n = new THREE.Vector3((l - r) * strength, (d - u) * strength, 1).normalize();
        const i = (y * size + x) * 4;
        data[i] = (n.x * 0.5 + 0.5) * 255; data[i + 1] = (n.y * 0.5 + 0.5) * 255; data[i + 2] = (n.z * 0.5 + 0.5) * 255; data[i + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, size, size);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }
}
