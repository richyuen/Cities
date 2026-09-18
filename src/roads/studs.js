import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Stud field with distance culling. A full city has >100k sidewalk studs; drawing them all would blow the
// triangle budget, so positions are kept on the CPU in 64 m chunks and only chunks within `radius` of the
// camera are uploaded into one InstancedMesh (one draw call). Refreshed when the camera moves > 12 m.

const CHUNK = 64;
const MIN_DIST = 0.5;   // Lego-legal: two studs can never be closer than this (pitch is 0.8)
const HASH = 1 / MIN_DIST;

/** Compact stud accumulator: Float32Array xyz + Uint8Array colour index. Rejects studs overlapping earlier ones. */
export class StudList {
  constructor(capacity = 4096) {
    this.xyz = new Float32Array(capacity * 3); this.ci = new Uint8Array(capacity); this.n = 0;
    this.names = []; this._idx = new Map(); this._grid = new Map(); this.rejected = 0;
  }
  get length() { return this.n * 4; }
  _key(gx, gz) { return gx * 200003 + gz; }
  /** True when a stud within MIN_DIST already exists. */
  collides(x, z) {
    const gx = Math.floor(x * HASH), gz = Math.floor(z * HASH);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const bucket = this._grid.get(this._key(gx + dx, gz + dz));
      if (!bucket) continue;
      for (const i of bucket) {
        const ex = this.xyz[i * 3] - x, ez = this.xyz[i * 3 + 2] - z;
        if (ex * ex + ez * ez < MIN_DIST * MIN_DIST) return true;
      }
    }
    return false;
  }
  push(x, y, z, color, checked = true) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    if (checked && this.collides(x, z)) { this.rejected++; return false; }
    if (this.n >= this.ci.length) {
      const xyz = new Float32Array(this.xyz.length * 2); xyz.set(this.xyz); this.xyz = xyz;
      const ci = new Uint8Array(this.ci.length * 2); ci.set(this.ci); this.ci = ci;
    }
    let c = this._idx.get(color);
    if (c === undefined) { c = this.names.length; this.names.push(color); this._idx.set(color, c); }
    const i = this.n * 3;
    this.xyz[i] = x; this.xyz[i + 1] = y; this.xyz[i + 2] = z; this.ci[this.n] = c;
    if (checked) {
      const k = this._key(Math.floor(x * HASH), Math.floor(z * HASH));
      const b = this._grid.get(k);
      if (b) b.push(this.n); else this._grid.set(k, [this.n]);
    }
    this.n++;
    return true;
  }
}

/** Lighter stud than the core one (10 sides, open bottom: 30 tris) — the field can hold 100k of them. */
function makeStudGeometry(radius = 0.24, height = 0.17) {
  const side = new THREE.CylinderGeometry(radius, radius, height, 10, 1, true);
  side.translate(0, height / 2, 0);
  const cap = new THREE.CircleGeometry(radius, 10);
  cap.rotateX(-Math.PI / 2);
  cap.translate(0, height, 0);
  const g = mergeGeometries([side, cap], false);
  side.dispose(); cap.dispose();
  g.computeBoundingSphere();
  return g;
}

export class StudField {
  constructor(materials, { capacity = 120000, radius = 200 } = {}) {
    this.materials = materials;
    this.capacity = capacity;
    this.radius = radius;
    this.chunks = new Map(); // key → { cx, cz, data: number[] (x,y,z,r,g,b) }
    this.geometry = makeStudGeometry();
    this.mesh = new THREE.InstancedMesh(this.geometry, materials.plastic('white', { instanceColor: true }), capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'roads-studs';
    this._lastCam = new THREE.Vector3(1e9, 1e9, 1e9);
    this._dirty = true;
    this._col = new THREE.Color();
    this._m = new THREE.Matrix4();
    this.total = 0;
  }

  clear() { this.chunks.clear(); this.total = 0; this._dirty = true; }

  /** Accepts a StudList or a flat array [x,y,z,colorName, ...]. */
  addAll(list) {
    const isList = list instanceof StudList;
    const n = isList ? list.n : list.length / 4;
    const cols = isList ? list.names.map((nm) => this.materials.color(nm)) : null;
    let lastKey = null, c = null;
    for (let k = 0; k < n; k++) {
      let x, y, z, col;
      if (isList) { x = list.xyz[k * 3]; y = list.xyz[k * 3 + 1]; z = list.xyz[k * 3 + 2]; col = cols[list.ci[k]]; }
      else { x = list[k * 4]; y = list[k * 4 + 1]; z = list[k * 4 + 2]; col = this.materials.color(list[k * 4 + 3]); }
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
      const key = ix * 100003 + iz;
      if (key !== lastKey) {
        lastKey = key;
        c = this.chunks.get(key);
        if (!c) { c = { cx: (ix + 0.5) * CHUNK, cz: (iz + 0.5) * CHUNK, data: [] }; this.chunks.set(key, c); }
      }
      c.data.push(x, y, z, col.r, col.g, col.b);
      this.total++;
    }
    this._dirty = true;
  }

  /** Upload studs near the camera. Cheap when nothing changed. */
  update(camera, force = false) {
    const cp = camera.position;
    if (!force && !this._dirty && cp.distanceTo(this._lastCam) < 12) return;
    this._lastCam.copy(cp);
    this._dirty = false;
    const mesh = this.mesh, m = this._m, col = this._col;
    const r2 = (this.radius + CHUNK) ** 2;
    let n = 0;
    outer: for (const c of this.chunks.values()) {
      const dx = c.cx - cp.x, dz = c.cz - cp.z;
      if (dx * dx + dz * dz > r2) continue;
      const d = c.data;
      for (let i = 0; i < d.length; i += 6) {
        if (n >= this.capacity) break outer;
        m.makeTranslation(d[i], d[i + 1], d[i + 2]);
        mesh.setMatrixAt(n, m);
        col.setRGB(d[i + 3], d[i + 4], d[i + 5]);
        mesh.setColorAt(n, col);
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  dispose() { this.mesh.dispose(); this.geometry.dispose(); }
}
