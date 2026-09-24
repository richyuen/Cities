// Real instanced studs for the stud-chunks nearest the camera (budgeted), with a per-chunk cache.
// Two InstancedMeshes share one material: `near` (8-sided, casts shadows, within NEAR_SHADOW_R) and `far`
// (6-sided). Every instance shrinks to zero across the fade band [effRadius-FADE, effRadius] in the vertex
// shader while the ground's stud relief fades in over the same band, so there is no LOD seam or popping.
import * as THREE from 'three';
import { STUD_PITCH, EPS } from './data.js';
import { patchStudMaterial } from './shaders.js';

const NEAR_SHADOW_R = 30;   // studs closer than this cast shadows (about 4-5 k studs)
const NEAR_CAP = 9000;
const FADE_BAND = 40;

/** Open prism stud: `sides` side quads + a fan-free polygon cap (sides-2 tris). 6 sides = 16 tris, 8 = 22. */
function makeStudGeometry(sides, radius = 0.24, height = 0.17) {
  const pos = [], nor = [], idx = [];
  const rot = Math.PI / sides; // a flat faces +x so axis-aligned rows do not show a hard corner line
  for (let s = 0; s < sides; s++) {
    const a = rot + (s / sides) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
    const a0 = a - Math.PI / sides, a1 = a + Math.PI / sides;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius, x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
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

function makeInstanced(geo, mat, cap, name) {
  const mesh = new THREE.InstancedMesh(geo, mat, cap);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  mesh.name = name;
  mesh.receiveShadow = true;
  mesh.frustumCulled = true;
  return mesh;
}

export class StudManager {
  constructor(ctx, data, group, { chunkCells = 8, maxStuds = 40000, radius = 170, material, fadeUniform } = {}) {
    this.ctx = ctx;
    this.data = data;
    this.group = group;
    this.chunkCells = chunkCells;
    this.maxStuds = maxStuds;
    this.radius = radius;
    this.nx = Math.ceil(data.w / chunkCells);
    this.nz = Math.ceil(data.h / chunkCells);
    this.cache = new Map(); // chunk key -> { pos: Float32Array, col: Uint8Array, count }
    this.fade = fadeUniform; // THREE.Vector2 (near, far) shared with the ground shader
    this.material = material;
    patchStudMaterial(this.material, { uStudFade: { value: this.fade } });
    this.geoNear = makeStudGeometry(8);
    this.geoFar = makeStudGeometry(6);
    this.near = makeInstanced(this.geoNear, this.material, NEAR_CAP, 'terrain-studs-near');
    this.near.castShadow = true;
    this.far = makeInstanced(this.geoFar, this.material, maxStuds, 'terrain-studs-far');
    this.far.castShadow = false;
    group.add(this.near, this.far);
    this.current = '';
    this.currentSet = new Set();
    this.dirty = true;
    this._timer = 0;
    this._lastCam = new THREE.Vector3(Infinity, 0, 0);
    this.count = 0;
    this.effRadius = radius;
    this.enabled = true;
  }

  key(cx, cz) { return cz * this.nx + cx; }

  /** Invalidate cached stud lists for chunks intersecting cell region. */
  invalidateRegion(i0, j0, i1, j1) {
    const c = this.chunkCells;
    const cx0 = Math.max(0, Math.floor(i0 / c)), cx1 = Math.min(this.nx - 1, Math.floor(i1 / c));
    const cz0 = Math.max(0, Math.floor(j0 / c)), cz1 = Math.min(this.nz - 1, Math.floor(j1 / c));
    for (let cz = cz0; cz <= cz1; cz++) for (let cx = cx0; cx <= cx1; cx++) {
      const k = this.key(cx, cz);
      this.cache.delete(k);
      if (this.currentSet.has(k)) this.dirty = true;
    }
  }

  invalidateAll() { this.cache.clear(); this.dirty = true; }

  _build(cx, cz) {
    const data = this.data, world = data.world, cs = data.cs, c = this.chunkCells;
    const i0 = cx * c, j0 = cz * c, i1 = Math.min(data.w, i0 + c), j1 = Math.min(data.h, j0 + c);
    const per = cs / STUD_PITCH; // studs per cell edge (10)
    const pos = [], col = [];
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) {
        if (!data.studdable(i, j)) continue;
        const x0 = world.minX + i * cs, z0 = world.minZ + j * cs;
        const ci = data.colorIdx[j * data.w + i];
        for (let l = 0; l < per; l++) {
          const z = z0 + l * STUD_PITCH;
          for (let k = 0; k < per; k++) {
            const x = x0 + k * STUD_PITCH;
            const h = data.topAt(x + EPS, z + EPS);
            if (h === null) continue;
            const hb = data.topAt(x - EPS, z + EPS), hc = data.topAt(x + EPS, z - EPS), hd = data.topAt(x - EPS, z - EPS);
            if (hb === null || hc === null || hd === null) continue;
            if (Math.abs(hb - h) > 1e-3 || Math.abs(hc - h) > 1e-3 || Math.abs(hd - h) > 1e-3) continue;
            pos.push(x, h, z); col.push(ci);
          }
        }
      }
    }
    const rec = { pos: Float32Array.from(pos), col: Uint8Array.from(col), count: col.length };
    this.cache.set(this.key(cx, cz), rec);
    return rec;
  }

  get(cx, cz) { return this.cache.get(this.key(cx, cz)) || this._build(cx, cz); }

  /** Pick chunks by distance to camera within budget; rebuild the instance buffers when needed. */
  update(dt, camera, force = false) {
    this._timer += dt;
    const moved = this._lastCam.distanceToSquared(camera.position) > 36;
    if (!force && !this.dirty && !moved && this._timer < 0.5) return;
    this._timer = 0;
    const data = this.data, world = data.world, cs = data.cs, c = this.chunkCells, span = c * cs;
    const cands = [];
    for (let cz = 0; cz < this.nz; cz++) {
      for (let cx = 0; cx < this.nx; cx++) {
        const x = world.minX + (cx + 0.5) * span, z = world.minZ + (cz + 0.5) * span;
        // distance from camera to the nearest point of the chunk footprint (at ground height)
        const dx = Math.max(0, Math.abs(camera.position.x - x) - span / 2);
        const dz = Math.max(0, Math.abs(camera.position.z - z) - span / 2);
        const dy = camera.position.y - world.getHeight(x, z);
        const d = Math.sqrt(dx * dx + dz * dz + dy * dy);
        if (d < this.radius) cands.push({ cx, cz, d });
      }
    }
    cands.sort((a, b) => a.d - b.d);
    const chosen = [];
    let total = 0, effRadius = this.radius;
    for (const cd of cands) {
      const rec = this.get(cd.cx, cd.cz);
      // stop at the first chunk that does not fit: every stud closer than its distance is then guaranteed to be
      // drawn, and the fade band ends exactly there
      if (total + rec.count > this.maxStuds) { effRadius = Math.min(effRadius, cd.d); break; }
      total += rec.count;
      chosen.push(cd);
    }
    const keys = chosen.map((cd) => this.key(cd.cx, cd.cz)).sort((a, b) => a - b);
    const sig = keys.join(',');
    const sameSet = sig === this.current && effRadius === this.effRadius;
    if (!force && !this.dirty && sameSet && !moved) return;
    this._lastCam.copy(camera.position);
    this.current = sig;
    this.currentSet = new Set(keys);
    this.dirty = false;
    this.effRadius = effRadius;
    this.fade.set(Math.max(8, effRadius - FADE_BAND), effRadius);
    this._rebuild(chosen, camera);
  }

  _rebuild(chosen, camera) {
    const data = this.data;
    const nearM = this.near.instanceMatrix.array, nearC = this.near.instanceColor.array;
    const farM = this.far.instanceMatrix.array, farC = this.far.instanceColor.array;
    const cp = camera.position;
    const nearR2 = NEAR_SHADOW_R * NEAR_SHADOW_R, fadeFar = this.fade.y;
    let nn = 0, nf = 0;
    const put = (M, Cc, n, x, y, z, col) => {
      const o = n * 16;
      M[o] = 1; M[o + 1] = 0; M[o + 2] = 0; M[o + 3] = 0;
      M[o + 4] = 0; M[o + 5] = 1; M[o + 6] = 0; M[o + 7] = 0;
      M[o + 8] = 0; M[o + 9] = 0; M[o + 10] = 1; M[o + 11] = 0;
      M[o + 12] = x; M[o + 13] = y; M[o + 14] = z; M[o + 15] = 1;
      Cc[n * 3] = col.r; Cc[n * 3 + 1] = col.g; Cc[n * 3 + 2] = col.b;
    };
    for (const cd of chosen) {
      const rec = this.get(cd.cx, cd.cz);
      for (let k = 0; k < rec.count; k++) {
        const x = rec.pos[k * 3], y = rec.pos[k * 3 + 1], z = rec.pos[k * 3 + 2];
        const dx = x - cp.x, dy = y - cp.y, dz = z - cp.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > fadeFar * fadeFar) continue; // fully shrunk anyway
        const col = data.colors[rec.col[k]];
        if (d2 < nearR2 && nn < NEAR_CAP) put(nearM, nearC, nn++, x, y, z, col);
        else if (nf < this.maxStuds) put(farM, farC, nf++, x, y, z, col);
      }
    }
    this.near.count = nn; this.far.count = nf;
    this.near.instanceMatrix.needsUpdate = true; this.near.instanceColor.needsUpdate = true;
    this.far.instanceMatrix.needsUpdate = true; this.far.instanceColor.needsUpdate = true;
    this.near.visible = this.enabled && nn > 0; this.far.visible = this.enabled && nf > 0;
    if (nn > 0) this.near.computeBoundingSphere();
    if (nf > 0) this.far.computeBoundingSphere();
    this.count = nn + nf;
  }

  dispose() {
    this.group.remove(this.near, this.far);
    this.near.dispose(); this.far.dispose();
    this.geoNear.dispose(); this.geoFar.dispose();
    this.cache.clear();
  }

  /** UI "Show studs" toggle: hide both instanced meshes (the ground shader relief keeps the plate look). */
  setEnabled(v) {
    this.enabled = !!v;
    this.near.visible = this.enabled && this.near.count > 0;
    this.far.visible = this.enabled && this.far.count > 0;
  }
}
