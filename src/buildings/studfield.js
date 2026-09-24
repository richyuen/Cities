import * as THREE from 'three';

// Distance-culled stud field for building surfaces (roofs, ledges, sills, awning tops).
//
// A full city's roofs carry tens of thousands of studs. Drawing them all would be pure waste: a 0.8 m stud is
// sub-pixel past a couple of hundred metres. Positions are kept on the CPU in 32 m spatial chunks, and only the
// chunks inside `radius` of the camera (nearest first, up to `capacity`) are uploaded into one InstancedMesh.
// The last chunk that does not fit sets the cutoff, and instances fade out over FADE_BAND before it, so the
// stud field never pops as the camera moves (same trick as roads/studs.js and terrain/studs.js).
//
// Buildings own their stud points: BuildingBatcher calls set(id, points) whenever a building is (re)generated and
// remove(id) when it goes away, so the field only ever rebuilds the chunks a change actually touched.

const CHUNK = 32;
const FADE_BAND = 40;
const REFRESH_DIST = 8; // camera movement (m) that triggers an upload

/** Light stud: 8 side quads + a fan-free polygon cap (8-2 tris) = 22 tris. */
function makeStudGeometry(sides = 8, radius = 0.24, height = 0.17) {
  const pos = [], nor = [], idx = [];
  const rot = Math.PI / sides; // a flat faces +x so axis-aligned rows do not show a hard corner line
  for (let s = 0; s < sides; s++) {
    const a = rot + (s / sides) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
    const a0 = a - Math.PI / sides, a1 = a + Math.PI / sides;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
    const b = pos.length / 3;
    pos.push(x0, 0, z0, x1, 0, z1, x1, height, z1, x0, height, z0);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const cb = pos.length / 3;
  for (let s = 0; s < sides; s++) {
    const a = rot + (s / sides) * Math.PI * 2 - Math.PI / sides;
    pos.push(Math.cos(a) * radius, height, Math.sin(a) * radius);
    nor.push(0, 1, 0);
  }
  for (let s = 1; s < sides - 1; s++) idx.push(cb, cb + s + 1, cb + s);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class BuildingStudField {
  constructor(materials, { capacity = 40000, radius = 170 } = {}) {
    this.materials = materials;
    this.capacity = capacity;
    this.radius = radius;
    this.chunks = new Map();     // key -> { cx, cz, byBuilding: Map<id, [{x,y,z,r,g,b}]>, flat, dirty }
    this.geometry = makeStudGeometry();
    this.mesh = new THREE.InstancedMesh(this.geometry, materials.plastic('white', { instanceColor: true }), capacity);
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'buildings-studs';
    this._lastCam = new THREE.Vector3(1e9, 1e9, 1e9);
    this._dirty = true;
    this._m = new THREE.Matrix4();
    this._col = new THREE.Color();
    this.count = 0;
    this.total = 0;
    this.enabled = true;
  }

  _key(x, z) { const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK); return ix * 100003 + iz; }

  _chunk(x, z, create) {
    const key = this._key(x, z);
    let c = this.chunks.get(key);
    if (!c && create) {
      const ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK);
      c = { cx: (ix + 0.5) * CHUNK, cz: (iz + 0.5) * CHUNK, byBuilding: new Map(), flat: null };
      this.chunks.set(key, c);
    }
    return c;
  }

  /** Replace one building's stud points ({x,y,z,color}). */
  set(id, points) {
    this.remove(id, true);
    if (!points || !points.length) return;
    const n = points.length;
    for (let k = 0; k < n; k++) {
      const p = points[k];
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
      const c = this._chunk(p.x, p.z, true);
      let list = c.byBuilding.get(id);
      if (!list) { list = []; c.byBuilding.set(id, list); }
      const col = this.materials.color(p.color);
      list.push(p.x, p.y, p.z, col.r, col.g, col.b);
      c.flat = null;
      this.total++;
    }
    this._dirty = true;
  }

  /** Drop one building's stud points. `silent` skips the dirty flag (used by set() before re-adding). */
  remove(id, silent = false) {
    let removed = 0;
    for (const c of this.chunks.values()) {
      const list = c.byBuilding.get(id);
      if (list === undefined) continue;
      removed += list.length / 6;
      c.byBuilding.delete(id);
      c.flat = null;
    }
    if (removed && !silent) this._dirty = true;
    this.total -= removed;
  }

  clear() {
    this.chunks.clear();
    this.total = 0;
    this.count = 0;
    this.mesh.count = 0;
    this._dirty = true;
  }

  _flatten(c) {
    if (c.flat) return c.flat;
    let n = 0;
    for (const list of c.byBuilding.values()) n += list.length / 6;
    const flat = new Float32Array(n * 6);
    let o = 0;
    for (const list of c.byBuilding.values()) { flat.set(list, o); o += list.length; }
    c.flat = flat;
    return flat;
  }

  /** Upload studs near the camera. Cheap when nothing changed and the camera has not moved. */
  update(camera, force = false) {
    const cp = camera.position;
    if (!force && !this._dirty && cp.distanceToSquared(this._lastCam) < REFRESH_DIST * REFRESH_DIST) return;
    this._lastCam.copy(cp);
    this._dirty = false;

    const cands = [];
    for (const [key, c] of this.chunks) {
      if (!c.byBuilding.size) continue;
      const dx = c.cx - cp.x, dz = c.cz - cp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > (this.radius + CHUNK) * (this.radius + CHUNK)) continue;
      cands.push({ key, c, d: Math.sqrt(d2) });
    }
    cands.sort((a, b) => a.d - b.d);

    let cutoff = this.radius;
    let total = 0;
    for (const cd of cands) {
      const n = this._flatten(cd.c).length / 6;
      if (total + n > this.capacity) { cutoff = Math.min(cutoff, cd.d); break; }
      total += n;
    }

    const mesh = this.mesh, m = this._m, col = this._col;
    const fadeNear = Math.max(0, cutoff - FADE_BAND);
    let n = 0;
    outer: for (const cd of cands) {
      const flat = this._flatten(cd.c);
      for (let i = 0; i < flat.length; i += 6) {
        if (n >= this.capacity) break outer;
        const dx = flat[i] - cp.x, dy = flat[i + 1] - cp.y, dz = flat[i + 2] - cp.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d > cutoff) continue;
        const s = d <= fadeNear ? 1 : Math.max(0, (cutoff - d) / (cutoff - fadeNear));
        if (s <= 0.001) continue;
        m.makeScale(s, s, s);
        m.setPosition(flat[i], flat[i + 1], flat[i + 2]);
        mesh.setMatrixAt(n, m);
        col.setRGB(flat[i + 3], flat[i + 4], flat[i + 5]);
        mesh.setColorAt(n, col);
        n++;
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = this.enabled && n > 0;
    this.count = n;
  }

  /** UI "Show studs" toggle. Kept as a flag (not just mesh.visible) so a later upload cannot re-show them. */
  setEnabled(v) {
    this.enabled = !!v;
    this.mesh.visible = this.enabled && this.count > 0;
  }

  dispose() {
    this.mesh.dispose();
    this.geometry.dispose();
    this.chunks.clear();
  }
}
