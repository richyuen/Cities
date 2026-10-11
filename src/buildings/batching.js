import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Chunk + material batching: each building contributes a handful of small static geometries tagged by a material
// key (palette colour name, or one of our own dynamic emissive keys). We bucket by (128-cell chunk, matKey) and
// merge into one static Mesh per bucket, so draw calls scale with (chunk count x distinct materials used), not
// with building count. A 256x256-cell world at 128-cell chunks is a fixed 2x2 = 4 chunks, so even a dense city
// that eventually touches most of the ~70-colour palette in every chunk stays at 4 x ~90 = well under the 400
// draw-call budget (a smaller chunk size scales worse: a saturated 16-chunk grid could reach 16 x 90 = 1440).
// Roof/ledge studs are handed to a BuildingStudField (studfield.js): one distance-culled InstancedMesh for the
// whole module, so a fully studded roof costs one instance per stud and far studs are simply not uploaded.
const CHUNK_CELLS = 128;

/** Squash `count` vertices from `start` onto the first of them (zero-area triangles: nothing is rasterised, in the
 * colour pass or the shadow pass). `upload` queues just that range for the GPU. */
function collapseRange(attr, start, count, upload) {
  if (count <= 0) return;
  const a = attr.array, o = start * 3;
  const x = a[o], y = a[o + 1], z = a[o + 2];
  for (let k = 1; k < count; k++) { const q = o + k * 3; a[q] = x; a[q + 1] = y; a[q + 2] = z; }
  if (upload) { attr.addUpdateRange(o, count * 3); attr.needsUpdate = true; }
}

export class BuildingBatcher {
  // Max raw part-geometries merged in a single mergeGeometries() call while time-slicing a rebuild (see
  // _stepChunkRebuild). Tuned empirically against the full demo city (~300 buildings, seed 1): keeps every
  // individual merge call, and so every per-frame flushIncremental() budget check, well clear of a 16ms frame
  // even for the single most-reused palette colour's bucket in the most densely-built chunk.
  static SLICE_GEOMS = 48;
  // How long a chunk whose only pending change is the removal of already-hidden buildings waits for its re-merge.
  static LAZY_MS = 4000;

  constructor(ctx, group, dynMats, studField) {
    this.ctx = ctx;
    this.group = group;
    this.dynMats = dynMats;
    this.studField = studField || null;
    this.chunks = new Map();     // chunkKey -> { group, meshes: Map<matKey, Mesh> }
    this.buildings = new Map();  // id -> { chunkKey, parts, studs, height, kind, cx, cz, baseY }
    this.dirtyChunks = new Set();
    // In-progress incremental rebuild of one chunk, or null. A chunk can contain hundreds of buildings (see
    // CHUNK_CELLS comment above - only 4 chunks total for a 256x256 world), each contributing dozens of
    // material-tagged parts, so mergeGeometries() across every (chunk, material) bucket in one synchronous pass
    // was the source of a 500-600ms main-thread stall every ~3s (full-game auto-growth rebuild - see
    // docs/core-requests/environment.md "## 2." perf note). flushIncremental() below processes one bucket's
    // merge at a time and yields back to the caller once a time budget is spent, so the full-game per-frame
    // update() can spread a big chunk's rebuild across many frames instead of paying it all in one.
    this._rebuild = null; // { key, chunk, entries: [[matKey, { geoms, runs }], ...], idx, seen: Set, cur }
    this._gen = 0;        // bumped on every set(): tells a caller its part indices went stale (level-up, repair)
    // chunkKey -> time of the last removal of a fully hidden building (see remove()): chunks that only need a
    // re-merge to drop triangles nobody can see. Promoted to dirtyChunks once they have been quiet for LAZY_MS.
    this.lazyChunks = new Map();
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
    // `hidden` = part indices collapsed by hide(); it starts empty for every (re)generated record, so a repaired or
    // levelled-up building is whole again. The previous generation's triangles stay in the drawn mesh until the
    // re-merge; their vertex ranges live on the mesh (userData.byId), so hide(id, 'all') still reaches them.
    this.buildings.set(id, { ...data, id, chunkKey, gen: ++this._gen, hidden: new Set(), liveStuds: null });
    this.studField?.set(id, data.studs);
    this._markChunkDirty(chunkKey);
  }

  remove(id) {
    const b = this.buildings.get(id);
    if (!b) return;
    for (const g of b.parts) g.geom.dispose();
    this.buildings.delete(id);
    this.studField?.remove(id);
    if (b.allHidden) {
      // Nothing of it is drawn any more (hide(id, 'all') squashed every triangle, in the drawn mesh and in its own
      // parts, which an in-flight rebuild may still hold: they merge as zero-area triangles). Re-merging a whole
      // chunk for each such removal is what makes a storm stutter, so the chunk is only queued; the dead vertices
      // are dropped by the next re-merge, whenever something visible changes or the chunk has been quiet a while.
      if (!this.dirtyChunks.has(b.chunkKey)) this.lazyChunks.set(b.chunkKey, performance.now());
      return;
    }
    this._markChunkDirty(b.chunkKey);
  }

  /** Move lazily queued chunks (see remove()) into the dirty set: all of them, or those quiet for `olderThanMs`. */
  _promoteLazy(olderThanMs = 0) {
    if (!this.lazyChunks.size) return;
    const now = performance.now();
    for (const [key, at] of this.lazyChunks) {
      if (olderThanMs > 0 && now - at < olderThanMs && !this.dirtyChunks.has(key)) continue;
      this.lazyChunks.delete(key);
      this.dirtyChunks.add(key);
    }
  }

  get(id) { return this.buildings.get(id); }

  /** Cached pre-collapse AABB of one part (hide() squashes the vertices, so the box is taken first and kept). */
  partBox(rec, idx) {
    const g = rec.parts[idx].geom;
    if (!g.boundingBox) g.computeBoundingBox();
    return g.boundingBox;
  }

  /** Instantly stop drawing some parts of a building (`which` = part indices, or 'all') without a re-merge.
   *
   * remove() only marks the chunk dirty; the time-sliced re-merge then takes 16-60 frames in the full game, during
   * which the building is still drawn and disappears one colour at a time. hide() instead squashes the parts'
   * triangles to a point: in the part's own geometry (so any later or in-flight re-merge copies the squashed
   * version, and _stepChunkRebuild re-squashes whatever it merged earlier) and in the drawn bucket mesh, through
   * the vertex ranges recorded when that mesh was merged. It never marks the chunk dirty. A squashed vertex stays
   * inside the part's old box, so the merged geometry's bounds remain valid. Returns the number of parts hidden. */
  hide(id, which = 'all') {
    const rec = this.buildings.get(id);
    if (!rec) return 0;
    const chunk = this.chunks.get(rec.chunkKey);
    const all = which === 'all';
    const list = all ? rec.parts.map((_, k) => k) : which;
    let n = 0;
    const fresh = [];
    const mats = new Set(); // drawn bucket meshes holding the parts hidden by this call
    for (const idx of list) {
      const part = rec.parts[idx];
      if (!part || rec.hidden.has(idx)) continue;
      this.partBox(rec, idx);
      collapseRange(part.geom.attributes.position, 0, part.geom.attributes.position.count, false);
      rec.hidden.add(idx);
      fresh.push(idx);
      n++;
      if (all || !chunk) continue;
      const mesh = chunk.meshes.get(part.mat);
      if (mesh) mats.add(mesh);
    }
    if (!all && fresh.length && mats.size) {
      // one pass over this building's ranges in each drawn bucket it just lost parts from. A bucket that has not
      // merged it yet has no ranges for it: the pending re-merge picks the squashed parts up instead.
      const want = new Set(fresh);
      for (const mesh of mats) {
        const runs = mesh.userData.byId?.get(id);
        if (!runs) continue;
        for (const run of runs) {
          if (run.gen !== rec.gen) continue;
          const it = run.items;
          for (let q = 0; q < it.length; q += 3) if (want.has(it[q])) this._collapseDrawn(mesh, it[q + 1], it[q + 2]);
        }
      }
    }
    if (all) {
      // every range this id owns in the drawn meshes, including a previous generation's (see set())
      if (chunk) for (const mesh of chunk.meshes.values()) {
        const runs = mesh.userData.byId?.get(id);
        if (!runs) continue;
        for (const run of runs) { const it = run.items; for (let q = 0; q < it.length; q += 3) this._collapseDrawn(mesh, it[q + 1], it[q + 2]); }
      }
      this.studField?.remove(id);
      rec.liveStuds = [];
      rec.allHidden = true;
    } else if (fresh.length && this.studField && rec.studs?.length) {
      // studs standing on a part that just went (roof tiles, sills, awning tops) go with it
      let studs = rec.liveStuds || rec.studs;
      const before = studs.length;
      for (const idx of fresh) {
        const bb = this.partBox(rec, idx);
        studs = studs.filter((p) => !(p.x > bb.min.x - 0.1 && p.x < bb.max.x + 0.1 && p.z > bb.min.z - 0.1 && p.z < bb.max.z + 0.1
          && p.y > bb.min.y - 0.1 && p.y < bb.max.y + 0.2));
      }
      if (studs.length !== before) { rec.liveStuds = studs; this.studField.set(id, studs); }
    }
    return n;
  }

  _collapseDrawn(mesh, start, count) {
    const attr = mesh.geometry.attributes.position;
    if (start + count > attr.count) {
      this.ctx.error?.(`[buildings] hide: vertex range ${start}+${count} is outside ${mesh.name} (${attr.count})`);
      return;
    }
    collapseRange(attr, start, count, true);
  }

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
    this._promoteLazy();
    if (!this.dirtyChunks.size) return;
    for (const key of this.dirtyChunks) this._rebuildChunkFully(key);
    this.dirtyChunks.clear();
  }

  /** Time-sliced rebuild: processes dirty chunks' material buckets one mergeGeometries() call at a time,
   * stopping once `timeBudgetMs` has elapsed and resuming on the next call (tracked via this._rebuild). Call
   * this every frame from update(); it's a no-op once nothing is dirty. */
  flushIncremental(timeBudgetMs = 4) {
    this._promoteLazy(BuildingBatcher.LAZY_MS);
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
    let any = false;
    for (const b of this.buildings.values()) {
      if (b.chunkKey !== key) continue;
      any = true;
      for (let k = 0; k < b.parts.length; k++) {
        const p = b.parts[k];
        let bucket = buckets.get(p.mat);
        if (!bucket) { bucket = { geoms: [], runs: [], last: null, verts: 0 }; buckets.set(p.mat, bucket); }
        // mergeGeometries() concatenates in input order, so this part's vertices are [start, start+count) of the
        // bucket's merged position attribute (see hide()).
        const count = p.geom.attributes.position.count;
        bucket.geoms.push(p.geom);
        // One run per (bucket, building): a building's parts of one material are consecutive in the bucket. The
        // ranges are plain numbers (partIdx, start, count triples), so this scan allocates per building, not per part.
        let run = bucket.last;
        if (!run || run.rec !== b) { run = { rec: b, gen: b.gen, items: [] }; bucket.runs.push(run); bucket.last = run; }
        run.items.push(k, bucket.verts, count);
        bucket.verts += count;
      }
    }
    if (!any) {
      if (chunk) {
        for (const m of chunk.meshes.values()) { chunk.group.remove(m); m.geometry.dispose(); }
        this.group.remove(chunk.group);
        this.chunks.delete(key);
      }
      return null;
    }
    if (!chunk) {
      chunk = { group: new THREE.Group(), meshes: new Map() };
      chunk.group.name = `buildings-chunk-${key}`;
      this.group.add(chunk.group);
      this.chunks.set(key, chunk);
    }
    return { key, chunk, entries: [...buckets], idx: 0, seen: new Set() };
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
        const [matKey, bucket] = entries[state.idx];
        state.cur = { matKey, geoms: bucket.geoms, runs: bucket.runs, verts: bucket.verts, subIdx: 0, partials: [] };
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
        // Vertex ranges of the mesh about to be drawn, by building id. Parts hidden since their slice was merged
        // (or before this rebuild began) are squashed again here, so hidden state survives every re-merge.
        const byId = new Map();
        if (merged.attributes.position.count !== cur.verts) {
          // ranges would be wrong: draw the bucket without them, so hide() waits for a re-merge instead of
          // squashing somebody else's triangles
          this.ctx.error?.(`[buildings] merged vertex count ${merged.attributes.position.count} != ${cur.verts} for mat="${cur.matKey}"`);
        } else {
          const pos = merged.attributes.position;
          for (const run of cur.runs) {
            const id = run.rec.id;
            const list = byId.get(id);
            if (list) list.push(run); else byId.set(id, [run]);
            const hidden = run.rec.hidden;
            if (!hidden.size) continue;
            const it = run.items;
            for (let q = 0; q < it.length; q += 3) if (hidden.has(it[q])) collapseRange(pos, it[q + 1], it[q + 2], false);
          }
        }
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
        mesh.userData.byId = byId;
      }
      state.idx++;
      state.cur = null;
      if (performance.now() >= deadline) return false; // yield; resume at the next bucket next call
    }
    for (const [matKey, mesh] of [...chunk.meshes]) {
      if (!seen.has(matKey)) { chunk.group.remove(mesh); mesh.geometry.dispose(); chunk.meshes.delete(matKey); }
    }
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
      draws += chunk.meshes.size;
      for (const m of chunk.meshes.values()) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    }
    if (this.studField && this.studField.count > 0) {
      draws += 1;
      const g = this.studField.geometry;
      tris += ((g.index?.count || 0) / 3) * this.studField.count;
    }
    return { draws, tris: Math.round(tris) };
  }

  dispose() {
    for (const chunk of this.chunks.values()) {
      for (const m of chunk.meshes.values()) { chunk.group.remove(m); m.geometry.dispose(); }
      this.group.remove(chunk.group);
    }
    this.chunks.clear();
    for (const b of this.buildings.values()) for (const g of b.parts) g.geom.dispose();
    this.buildings.clear();
    this.dirtyChunks.clear();
    this.lazyChunks.clear();
    this.studField?.clear();
    this._rebuild = null;
  }
}
