import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Chunk + material batching: each building contributes a handful of small static geometries tagged by a material
// key (palette colour name, or one of our own dynamic emissive keys). We bucket by (128-cell chunk, matKey) and
// merge into one static Mesh per bucket, so draw calls scale with (chunk count x distinct materials used), not
// with building count. A 256x256-cell world at 128-cell chunks is a fixed 2x2 = 4 chunks, so even a dense city
// that eventually touches most of the ~70-colour palette in every chunk stays at 4 x ~90 = well under the 400
// draw-call budget (a smaller chunk size scales worse: a saturated 16-chunk grid could reach 16 x 90 = 1440).
// Roof studs use a real per-chunk InstancedMesh (ctx.materials.studs()) so a tower's roof doesn't cost per-stud
// triangles beyond one instance each.
const CHUNK_CELLS = 128;

export class BuildingBatcher {
  // Max raw part-geometries merged in a single mergeGeometries() call while time-slicing a rebuild (see
  // _stepChunkRebuild). Tuned empirically against the full demo city (~300 buildings, seed 1): keeps every
  // individual merge call, and so every per-frame flushIncremental() budget check, well clear of a 16ms frame
  // even for the single most-reused palette colour's bucket in the most densely-built chunk.
  static SLICE_GEOMS = 48;

  constructor(ctx, group, dynMats) {
    this.ctx = ctx;
    this.group = group;
    this.dynMats = dynMats;
    this.chunks = new Map();     // chunkKey -> { group, meshes: Map<matKey, Mesh>, studs }
    this.buildings = new Map();  // id -> { chunkKey, parts, studs, height, kind, cx, cz, baseY }
    this.dirtyChunks = new Set();
    // In-progress incremental rebuild of one chunk, or null. A chunk can contain hundreds of buildings (see
    // CHUNK_CELLS comment above - only 4 chunks total for a 256x256 world), each contributing dozens of
    // material-tagged parts, so mergeGeometries() across every (chunk, material) bucket in one synchronous pass
    // was the source of a 500-600ms main-thread stall every ~3s (full-game auto-growth rebuild - see
    // docs/core-requests/environment.md "## 2." perf note). flushIncremental() below processes one bucket's
    // merge at a time and yields back to the caller once a time budget is spent, so the full-game per-frame
    // update() can spread a big chunk's rebuild across many frames instead of paying it all in one.
    this._rebuild = null; // { key, chunk, entries: [[matKey, geom[]], ...], idx, seen: Set, studPts, cur }
  }

  chunkKeyFor(i, j) { return `${Math.floor(i / CHUNK_CELLS)}_${Math.floor(j / CHUNK_CELLS)}`; }

  resolveMaterial(matKey) {
    if (this.dynMats[matKey]) return this.dynMats[matKey];
    return this.ctx.materials.plastic(matKey);
  }

  set(id, i, j, data) {
    const prev = this.buildings.get(id);
    const chunkKey = this.chunkKeyFor(i, j);
    if (prev) { for (const g of prev.parts) g.geom.dispose(); this._markChunkDirty(prev.chunkKey); }
    this.buildings.set(id, { ...data, chunkKey });
    this._markChunkDirty(chunkKey);
  }

  remove(id) {
    const b = this.buildings.get(id);
    if (!b) return;
    for (const g of b.parts) g.geom.dispose();
    this.buildings.delete(id);
    this._markChunkDirty(b.chunkKey);
  }

  get(id) { return this.buildings.get(id); }

  // If a chunk currently being incrementally rebuilt (see flushIncremental) gets touched again by a building
  // add/level-up/remove mid-rebuild, its snapshotted bucket list is now stale (could reference disposed
  // geometry). Drop the in-progress state - the key stays in dirtyChunks so the next flushIncremental/flush call
  // just restarts that chunk's rebuild from a fresh scan; nothing renders incorrectly, it just redoes a bit of
  // work.
  _markChunkDirty(key) {
    this.dirtyChunks.add(key);
    if (this._rebuild && this._rebuild.key === key) this._rebuild = null;
  }

  /** Synchronous, unbounded rebuild of every currently-dirty chunk. Used where callers need the result
   * immediately (showcases, the explicit rebuild(id) API) - not from the full game's per-frame update loop,
   * which uses flushIncremental() instead to avoid a multi-hundred-millisecond main-thread stall. */
  flush() {
    this._rebuild = null; // discard any partial incremental work; we're about to redo it all synchronously anyway
    if (!this.dirtyChunks.size) return;
    for (const key of this.dirtyChunks) this._rebuildChunkFully(key);
    this.dirtyChunks.clear();
  }

  /** Time-sliced rebuild: processes dirty chunks' material buckets one mergeGeometries() call at a time,
   * stopping once `timeBudgetMs` has elapsed and resuming on the next call (tracked via this._rebuild). Call
   * this every frame from update(); it's a no-op once nothing is dirty. */
  flushIncremental(timeBudgetMs = 4) {
    const deadline = performance.now() + timeBudgetMs;
    while (performance.now() < deadline) {
      if (!this._rebuild) {
        const key = this.dirtyChunks.values().next().value;
        if (key === undefined) return;
        const state = this._beginChunkRebuild(key);
        if (!state) { this.dirtyChunks.delete(key); continue; } // chunk had no buildings; handled synchronously
        this._rebuild = state;
      }
      const done = this._stepChunkRebuild(this._rebuild, deadline);
      if (done) {
        this.dirtyChunks.delete(this._rebuild.key);
        this._rebuild = null;
      }
    }
  }

  /** Scans every building in `key`'s chunk once (cheap: array pushes, no geometry work) and groups their parts
   * into per-material buckets. Shared by the sync and incremental rebuild paths so they can never disagree on
   * what "the chunk's current buildings" are. Returns null (after handling empty-chunk teardown synchronously)
   * when the chunk has no buildings left. */
  _beginChunkRebuild(key) {
    let chunk = this.chunks.get(key);
    const buckets = new Map();
    const studPts = [];
    let any = false;
    for (const b of this.buildings.values()) {
      if (b.chunkKey !== key) continue;
      any = true;
      for (const p of b.parts) {
        if (!buckets.has(p.mat)) buckets.set(p.mat, []);
        buckets.get(p.mat).push(p.geom);
      }
      for (const s of b.studs) studPts.push(s);
    }
    if (!any) {
      if (chunk) {
        for (const m of chunk.meshes.values()) { chunk.group.remove(m); m.geometry.dispose(); }
        chunk.studs?.clear();
        this.group.remove(chunk.group);
        this.chunks.delete(key);
      }
      return null;
    }
    if (!chunk) {
      chunk = { group: new THREE.Group(), meshes: new Map(), studs: this.ctx.materials.studs({ maxCount: 8000, castShadow: false }) };
      chunk.group.name = `buildings-chunk-${key}`;
      this.group.add(chunk.group);
      this.chunks.set(key, chunk);
    }
    return { key, chunk, entries: [...buckets], idx: 0, seen: new Set(), studPts };
  }

  /** Processes a bucket's mergeGeometries() in small slices (the actual expensive work) until `state` is fully
   * consumed or `deadline` (performance.now()) is reached. Returns true when the chunk is fully rebuilt
   * (stale meshes removed, studs committed), false if there's more work left for a later call.
   *
   * A single bucket can itself hold thousands of tiny parts (e.g. every building's window frames sharing one
   * palette colour across a whole 128-cell chunk), and mergeGeometries() over that many pieces in one call was
   * still a multi-hundred-ms spike even after limiting rebuilds to one bucket per time-slice - so buckets are
   * further sliced into SLICE_GEOMS-sized batches, each pre-merged, with a deadline check after every batch.
   * The per-bucket partial merges are combined with one final mergeGeometries() call once the whole bucket's
   * batches are done; since that call runs over `ceil(n/SLICE_GEOMS)` already-merged geometries (not the
   * original n pieces), total work stays O(n) overall rather than the O(n^2) that repeatedly re-merging a
   * growing accumulator one piece at a time would cause. */
  _stepChunkRebuild(state, deadline) {
    const { key, chunk, entries, seen } = state;
    while (state.idx < entries.length) {
      if (!state.cur) {
        const [matKey, geoms] = entries[state.idx];
        state.cur = { matKey, geoms, subIdx: 0, partials: [] };
      }
      const cur = state.cur;
      while (cur.subIdx < cur.geoms.length) {
        const end = Math.min(cur.subIdx + BuildingBatcher.SLICE_GEOMS, cur.geoms.length);
        const slice = mergeGeometries(cur.geoms.slice(cur.subIdx, end), false);
        if (slice) cur.partials.push(slice);
        cur.subIdx = end;
        if (performance.now() >= deadline) return false; // resume mid-bucket next call
      }
      seen.add(cur.matKey);
      let merged;
      if (cur.partials.length === 0) merged = null;
      else if (cur.partials.length === 1) merged = cur.partials[0];
      else {
        merged = mergeGeometries(cur.partials, false);
        for (const p of cur.partials) p.dispose();
      }
      if (!merged) {
        // Defensive: should not happen (all generator geometry is normalized to non-indexed), but a bad merge
        // must never take the whole app down - skip this bucket for this rebuild rather than crash.
        this.ctx.error?.(`[buildings] mergeGeometries failed for mat="${cur.matKey}" (${cur.geoms.length} pieces) - skipped this rebuild`);
      } else {
        let mesh = chunk.meshes.get(cur.matKey);
        if (!mesh) {
          mesh = new THREE.Mesh(merged, this.resolveMaterial(cur.matKey));
          mesh.name = `buildings-${key}-${cur.matKey}`;
          mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = true;
          chunk.group.add(mesh);
          chunk.meshes.set(cur.matKey, mesh);
        } else {
          mesh.geometry.dispose();
          mesh.geometry = merged;
        }
      }
      state.idx++;
      state.cur = null;
      if (performance.now() >= deadline) return false; // yield; resume at the next bucket next call
    }
    for (const [matKey, mesh] of [...chunk.meshes]) {
      if (!seen.has(matKey)) { chunk.group.remove(mesh); mesh.geometry.dispose(); chunk.meshes.delete(matKey); }
    }
    chunk.studs.clear();
    for (const s of state.studPts) chunk.studs.add(s.x, s.y, s.z, s.color);
    chunk.studs.commit(chunk.group);
    return true;
  }

  /** Full unbounded rebuild of one chunk (begin + step-to-completion with an infinite deadline). */
  _rebuildChunkFully(key) {
    const state = this._beginChunkRebuild(key);
    if (!state) return;
    this._stepChunkRebuild(state, Infinity);
  }

  stats() {
    let draws = 0, tris = 0;
    for (const chunk of this.chunks.values()) {
      draws += chunk.meshes.size + (chunk.studs?.mesh ? 1 : 0);
      for (const m of chunk.meshes.values()) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      if (chunk.studs?.mesh) tris += (chunk.studs.mesh.geometry.index?.count || 0) / 3 * chunk.studs.mesh.count;
    }
    return { draws, tris: Math.round(tris) };
  }

  dispose() {
    for (const chunk of this.chunks.values()) {
      for (const m of chunk.meshes.values()) { chunk.group.remove(m); m.geometry.dispose(); }
      chunk.studs?.clear();
      this.group.remove(chunk.group);
    }
    this.chunks.clear();
    for (const b of this.buildings.values()) for (const g of b.parts) g.geom.dispose();
    this.buildings.clear();
    this.dirtyChunks.clear();
    this._rebuild = null;
  }
}
