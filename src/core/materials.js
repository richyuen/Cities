import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

// Blox palette + shared PBR plastic materials + stud instancer.

export const PALETTE = {
  brightRed: '#C4281C', brightBlue: '#0D69AB', brightYellow: '#F5CD2F', brightGreen: '#4B9F4A', darkGreen: '#287F46',
  white: '#F4F4F4', black: '#1B2A34', darkStoneGrey: '#595D60', mediumStoneGrey: '#9BA19D', lightStoneGrey: '#C7C7C7',
  tan: '#DEC69C', brickYellow: '#E4CD9E', reddishBrown: '#5C2E0F', darkOrange: '#A45C1E', brightOrange: '#F58624',
  mediumAzur: '#3EC2DD', darkAzur: '#1E8EC0', lime: '#A5CA18', mediumLilac: '#3F3691', sandGreen: '#A0BCAC',
  sandBlue: '#6074A1', darkRed: '#7B1C1C', brightPink: '#E4ADC8', brightPurple: '#B31C6E', earthBlue: '#0B2551',
  transClear: '#EEF3F6', transBlue: '#A6D8EC', transYellow: '#F5CD2F', transRed: '#C4281C', transGreen: '#84B68D',
};

export const STUD = { pitch: 0.8, radius: 0.24, height: 0.17 };

const _studGeo = (() => {
  const g = new THREE.CylinderGeometry(STUD.radius, STUD.radius, STUD.height, 14, 1, false);
  g.translate(0, STUD.height / 2, 0);
  return g;
})();

/** Batches studs into one InstancedMesh with per-instance colour. */
export class StudInstancer {
  constructor(materials, { maxCount = 200000, castShadow = false } = {}) {
    this.materials = materials;
    this.maxCount = maxCount;
    this.castShadow = castShadow;
    this.positions = [];
    this.colors = [];
    this.mesh = null;
  }

  add(x, y, z, colorName = 'mediumStoneGrey') {
    if (this.positions.length / 3 >= this.maxCount) return;
    this.positions.push(x, y, z);
    const c = this.materials.color(colorName);
    this.colors.push(c.r, c.g, c.b);
  }

  /** Fill a rectangle [x0,x1)×[z0,z1) at height y with studs on the pitch grid (world-aligned). */
  addRect(x0, z0, x1, z1, y, colorName, inset = 0.4) {
    const p = STUD.pitch;
    const sx = Math.ceil((x0 + inset) / p) * p, sz = Math.ceil((z0 + inset) / p) * p;
    for (let x = sx; x < x1 - inset + 1e-4; x += p) for (let z = sz; z < z1 - inset + 1e-4; z += p) this.add(x, y, z, colorName);
  }

  clear() {
    this.positions.length = 0; this.colors.length = 0;
    if (this.mesh) { this.mesh.parent?.remove(this.mesh); this.mesh.dispose(); this.mesh = null; }
  }

  /** Build the InstancedMesh; returns it (caller adds to its group). */
  commit(parent) {
    if (this.mesh) { this.mesh.parent?.remove(this.mesh); this.mesh.dispose(); }
    const n = this.positions.length / 3;
    const mat = this.materials.plastic('white', { vertexColors: false, instanceColor: true });
    const mesh = new THREE.InstancedMesh(_studGeo, mat, Math.max(1, n));
    const m = new THREE.Matrix4();
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      m.makeTranslation(this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]);
      mesh.setMatrixAt(i, m);
      col.setRGB(this.colors[i * 3], this.colors[i * 3 + 1], this.colors[i * 3 + 2]);
      mesh.setColorAt(i, col);
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = this.castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.name = 'studs';
    this.mesh = mesh;
    if (parent) parent.add(mesh);
    return mesh;
  }
}

export class Materials {
  constructor() {
    this.palette = PALETTE;
    this.cache = new Map();
    this._colors = new Map();
    this._geos = new Map();
  }

  color(name) {
    if (!this._colors.has(name)) {
      const c = new THREE.Color(PALETTE[name] || name);
      this._colors.set(name, c);
    }
    return this._colors.get(name);
  }

  isTrans(name) { return name.startsWith('trans'); }

  /** Shared glossy ABS plastic. Trans* colours return glass. */
  plastic(name = 'mediumStoneGrey', opts = {}) {
    if (this.isTrans(name)) return this.glass(name, opts);
    const { roughness = 0.35, clearcoat = 0.6, clearcoatRoughness = 0.15, metalness = 0, emissive = null,
      emissiveIntensity = 1, instanceColor = false, map = null, normalMap = null, normalScale = 0.3, side = THREE.FrontSide,
      envMapIntensity = 1.0 } = opts;
    const key = `p:${name}:${roughness}:${clearcoat}:${clearcoatRoughness}:${metalness}:${emissive}:${emissiveIntensity}:${instanceColor}:${map?.uuid}:${normalMap?.uuid}:${side}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const params = {
      color: instanceColor ? 0xffffff : this.color(name),
      roughness, clearcoat, clearcoatRoughness, metalness, side, envMapIntensity,
    };
    if (map) params.map = map;
    if (normalMap) { params.normalMap = normalMap; params.normalScale = new THREE.Vector2(normalScale, normalScale); }
    const m = new THREE.MeshPhysicalMaterial(params);
    if (emissive) { m.emissive = this.color(emissive).clone(); m.emissiveIntensity = emissiveIntensity; }
    m.name = `plastic:${name}`;
    this.cache.set(key, m);
    return m;
  }

  /** Transparent plastic (windows, windscreens, lamp glass). */
  glass(name = 'transClear', opts = {}) {
    const { roughness = 0.08, opacity = 0.55, emissive = null, emissiveIntensity = 0, transmission = 0 } = opts;
    const key = `g:${name}:${roughness}:${opacity}:${emissive}:${emissiveIntensity}:${transmission}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const m = new THREE.MeshPhysicalMaterial({
      color: this.color(name), roughness, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05,
      transparent: true, opacity, transmission, thickness: 0.4, ior: 1.5, envMapIntensity: 1.2, depthWrite: false,
    });
    if (emissive) { m.emissive = this.color(emissive).clone(); m.emissiveIntensity = emissiveIntensity; }
    m.name = `glass:${name}`;
    this.cache.set(key, m);
    return m;
  }

  /** Emissive plastic for lit windows / lamps (bloom-friendly: intensity > 1). */
  emissive(name, intensity = 2.5) {
    return this.plastic(name, { emissive: name, emissiveIntensity: intensity, roughness: 0.4, clearcoat: 0.3 });
  }

  /** Shared beveled brick geometry (rounded box). Cached by dims. */
  bevelBox(w, h, d, bevel = 0.06, segments = 2) {
    const key = `bb:${w}:${h}:${d}:${bevel}:${segments}`;
    if (!this._geos.has(key)) {
      const g = new RoundedBoxGeometry(w, h, d, segments, Math.min(bevel, Math.min(w, h, d) * 0.45));
      g.translate(0, h / 2, 0); // sits on y=0
      this._geos.set(key, g);
    }
    return this._geos.get(key);
  }

  studGeometry() { return _studGeo; }

  studs(opts) { return new StudInstancer(this, opts); }

  /** Apply the scene environment intensity to all cached materials (environment module calls this). */
  setEnvIntensity(v) {
    for (const m of this.cache.values()) if ('envMapIntensity' in m) m.envMapIntensity = v;
  }
}
