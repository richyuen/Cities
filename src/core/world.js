import * as THREE from 'three';

// Shared world data model. All mutations go through methods here and emit events. Deterministic ids.

// Road-overlap guard (see World.roadOverlapFraction): a new road is only blocked when it runs alongside an
// existing one for most of its length — a crossing/T-intersection is nowhere near parallel, so it's let through.
const PARALLEL_COS_TOL = Math.cos((20 * Math.PI) / 180);
const ROAD_OVERLAP_BLOCK_FRACTION = 0.6;

// Junction model (see World.addRoad): vehicle roads are stitched into the network instead of merely overlapping it.
//   NODE_SNAP     — how far a requested endpoint may sit from an existing node and still join it (matches
//                   _findOrCreateNode's historical 0.5 m tolerance for the exact-coordinate callers).
//   JUNCTION_SNAP — a crossing/endpoint this close to an existing node joins that node rather than creating a
//                   second node next to it (no near-duplicate nodes, no sub-4 m stubs at junctions).
//   ENDPOINT_SNAP — a requested endpoint this close to a road centreline splits that edge and joins it (a player
//                   drag ending on a road, i.e. the T-junction gesture).
//   ROUTE_SNAP    — interactive drags (snapNodes) also route through existing nodes this close to the segment.
//   STRAIGHT_COS  — removal healing merges two edges through a degree-2 node only when they are this collinear.
const NODE_SNAP = 0.5;
const JUNCTION_SNAP = 4;
const ENDPOINT_SNAP = 2;
const ROUTE_SNAP = 4;
const STRAIGHT_COS = -Math.cos((2.5 * Math.PI) / 180);

/** Distance from point (px,pz) to segment (ax,az)-(bx,bz). */
function pointSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  if (!(l2 > 1e-12)) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** Proper interior intersection of segments a-b and c-d; null when parallel or touching an endpoint. */
function segIntersect(ax, az, bx, bz, cx, cz, dx, dz) {
  const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = cx - ax, qz = cz - az;
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  if (t <= 1e-6 || t >= 1 - 1e-6 || u <= 1e-6 || u >= 1 - 1e-6) return null;
  return { x: ax + rx * t, z: az + rz * t, t, u };
}

export class World {
  constructor(events, { w = 256, h = 256, cellSize = 8 } = {}) {
    this.events = events;
    this.size = { w, h };
    this.cellSize = cellSize;
    this.cells = new Array(w * h);
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        this.cells[j * w + i] = {
          i, j, height: 0, type: 'none', zone: null, density: 0, roadId: null, buildingId: null, level: 0,
        };
      }
    }
    this.heightField = new Float32Array((w + 1) * (h + 1));
    this.roads = { nodes: new Map(), edges: new Map() };
    this._nodeGrid = new Map(); // spatial hash for _findOrCreateNode — see there for why
    this.buildings = new Map();
    this.props = new Map();
    this.weather = { kind: 'clear', intensity: 0, wind: [1, 0] };
    this.stats = { population: 0, jobs: 0, money: 50000, happiness: 0.7, traffic: 0 };
    this._ids = { node: 0, edge: 0, building: 0, prop: 0 };
    this.seaLevel = 0; // meters; terrain may set
    this.downtownCenter = { x: 0, z: 0 }; // terrain may move this when the plateau isn't pinned to the origin
  }

  // ---- geometry helpers -------------------------------------------------
  get widthMeters() { return this.size.w * this.cellSize; }
  get depthMeters() { return this.size.h * this.cellSize; }
  get minX() { return -this.widthMeters / 2; }
  get minZ() { return -this.depthMeters / 2; }

  inBounds(i, j) { return i >= 0 && j >= 0 && i < this.size.w && j < this.size.h; }

  cellAt(i, j) { return this.inBounds(i, j) ? this.cells[j * this.size.w + i] : null; }

  worldToCell(x, z) {
    return { i: Math.floor((x - this.minX) / this.cellSize), j: Math.floor((z - this.minZ) / this.cellSize) };
  }

  cellToWorld(i, j) {
    return { x: this.minX + (i + 0.5) * this.cellSize, z: this.minZ + (j + 0.5) * this.cellSize };
  }

  cellAtWorld(x, z) {
    const { i, j } = this.worldToCell(x, z);
    return this.cellAt(i, j);
  }

  // ---- terrain -----------------------------------------------------------
  /** vertex height at grid vertex (i,j) in [0..w] x [0..h] */
  getVertexHeight(i, j) {
    const w1 = this.size.w + 1;
    i = THREE.MathUtils.clamp(i, 0, this.size.w);
    j = THREE.MathUtils.clamp(j, 0, this.size.h);
    return this.heightField[j * w1 + i];
  }

  setVertexHeight(i, j, h) {
    const w1 = this.size.w + 1;
    if (i < 0 || j < 0 || i > this.size.w || j > this.size.h) return;
    this.heightField[j * w1 + i] = h;
  }

  /** Mirrors terrain/data.js TerrainData.isWaterCell (same heightField, same -0.01 threshold) — kept here too so
   * road removal can tell water apart from dry land without a core -> terrain module dependency. */
  _isWaterCell(i, j) {
    const w1 = this.size.w + 1, hf = this.heightField, k = j * w1 + i;
    return (hf[k] + hf[k + 1] + hf[k + w1] + hf[k + w1 + 1]) * 0.25 < -0.01;
  }

  /** Bulk set heightField (terrain module), then emits terrain:changed for the whole map. */
  setHeightField(arr) {
    this.heightField.set(arr);
    this._refreshCellHeights();
    this.events.emit('terrain:changed', { region: { i0: 0, j0: 0, i1: this.size.w - 1, j1: this.size.h - 1 } });
  }

  _refreshCellHeights() {
    for (const c of this.cells) {
      c.height = (this.getVertexHeight(c.i, c.j) + this.getVertexHeight(c.i + 1, c.j)
        + this.getVertexHeight(c.i, c.j + 1) + this.getVertexHeight(c.i + 1, c.j + 1)) * 0.25;
    }
  }

  setHeight(i, j, h) {
    const c = this.cellAt(i, j);
    if (!c) return;
    c.height = h;
    this.setVertexHeight(i, j, h); this.setVertexHeight(i + 1, j, h);
    this.setVertexHeight(i, j + 1, h); this.setVertexHeight(i + 1, j + 1, h);
    this.events.emit('terrain:changed', { region: { i0: i, j0: j, i1: i, j1: j } });
  }

  /** bilinear terrain height at world (x,z) in meters */
  getHeight(x, z) {
    const fx = (x - this.minX) / this.cellSize;
    const fz = (z - this.minZ) / this.cellSize;
    const i = Math.floor(fx), j = Math.floor(fz);
    const u = fx - i, v = fz - j;
    const h00 = this.getVertexHeight(i, j), h10 = this.getVertexHeight(i + 1, j);
    const h01 = this.getVertexHeight(i, j + 1), h11 = this.getVertexHeight(i + 1, j + 1);
    return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
  }

  /** Approximate terrain normal at (x,z) */
  getNormal(x, z, out = new THREE.Vector3()) {
    const e = 0.5;
    const hL = this.getHeight(x - e, z), hR = this.getHeight(x + e, z);
    const hD = this.getHeight(x, z - e), hU = this.getHeight(x, z + e);
    return out.set(hL - hR, 2 * e, hD - hU).normalize();
  }

  /** Ray-march the ray against the height field; returns THREE.Vector3 point or null. `heightFn(x,z)` defaults
   * to this.getHeight (smooth bilinear) — pass the terrain module's surfaceHeight (the actual rendered,
   * plate-quantized surface — see terrain/data.js surfaceH) when raycasting for pointer picking, since a ray
   * marched against the smooth field can cross it several tenths of a metre away from where the *rendered*
   * (stepped) surface actually sits, which on a shallow ray angle shifts the resolved (x,z) — and so the
   * selected cell — by a visible amount on screen. */
  raycastGround(ray, maxDist = 6000, heightFn = null) {
    const getH = heightFn || ((x, z) => this.getHeight(x, z));
    const p = new THREE.Vector3();
    const _loP = new THREE.Vector3();
    let t = 0, step = 4, stepToHere = 0;
    let prevAbove = null;
    for (let iter = 0; iter < 4000 && t < maxDist; iter++) {
      ray.at(t, p);
      const h = getH(p.x, p.z);
      const above = p.y > h;
      if (prevAbove === true && !above) {
        // refine. Bracket on stepToHere (the step that actually produced this t from the last confirmed-above
        // sample), not the current `step` variable — by the time a crossing is detected, `step` has usually
        // already been shrunk for the *next* iteration (the clearance check below fires off the sample that
        // just got taken), so `t - step` names a point that was never sampled and may already be back on the
        // wrong side of the ground. That silently handed bisection a bracket whose "lo" end wasn't actually
        // above ground, so it converged on an arbitrary point — off the ray by tens of metres on a steep,
        // fast-growing approach (the coarse step ramps up to 64 m while still high above ground).
        let lo = t - stepToHere, hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2;
          ray.at(mid, p);
          if (p.y > getH(p.x, p.z)) lo = mid; else hi = mid;
        }
        ray.at(hi, p);
        const hHi = getH(p.x, p.z);
        // A plate-quantized "Lego" ground has vertical riser faces between adjacent cells of different height
        // (see terrain/mesher.js flatPiece/edgeRisers) — a pure heightfield march can't represent a vertical
        // face directly (getH is one height per x,z), but the bisection above still converges tightly onto the
        // (x,z) boundary the riser sits on. If the ray's own y there lands between the two plates' heights, it
        // punched through the riser face itself, not the flat plate beyond — keep that y instead of snapping
        // onto the far plate, which can resolve to a cell over from the one the cursor is actually pointing at.
        ray.at(lo, _loP);
        const hLo = getH(_loP.x, _loP.z);
        if (hHi !== hLo && p.y > Math.min(hLo, hHi) && p.y < Math.max(hLo, hHi)) return p.clone();
        p.y = hHi;
        return p.clone();
      }
      prevAbove = above;
      stepToHere = step;
      t += step;
      if (p.y - h > 50) step = Math.min(64, step * 1.5); else step = 2;
    }
    return null;
  }

  /** Ray-vs-building test: approximates each building as its footprint AABB (actual geometry is merged into
   * shared per-chunk meshes for draw-call budget — see buildings/batching.js — so there's no per-building mesh
   * to raycast against). Returns the nearest { id, point } or null. Same `heightFn` as raycastGround, for the
   * same reason — buildings sit on the rendered (plate-quantized) surface, not the smooth interpolated one. */
  raycastBuildings(ray, maxDist = 6000, heightFn = null) {
    const getH = heightFn || ((x, z) => this.getHeight(x, z));
    let bestId = null, bestPoint = null, bestDist = maxDist;
    const box = new THREE.Box3();
    const hit = new THREE.Vector3();
    for (const b of this.buildings.values()) {
      const x0 = this.minX + b.i * this.cellSize, x1 = this.minX + (b.i + b.w) * this.cellSize;
      const z0 = this.minZ + b.j * this.cellSize, z1 = this.minZ + (b.j + b.d) * this.cellSize;
      const baseY = getH((x0 + x1) / 2, (z0 + z1) / 2);
      box.min.set(x0, baseY, z0);
      box.max.set(x1, baseY + Math.max(1, b.height || 6), z1);
      if (!ray.intersectBox(box, hit)) continue;
      const d = ray.origin.distanceTo(hit);
      if (d < bestDist) { bestDist = d; bestId = b.id; bestPoint = hit.clone(); }
    }
    return bestId ? { id: bestId, point: bestPoint } : null;
  }

  /** Combined ray-vs-scene pick for pointer interaction (placement ghost, building-info hover): whichever of
   * the terrain heightfield or a building's footprint box the ray reaches first. raycastGround alone ignores
   * building height, so aiming at a building's facade/roof let the ray sail past it to wherever it next crossed
   * the terrain — often nowhere near the screen pixel under the cursor. */
  raycastScene(ray, maxDist = 6000, heightFn = null) {
    const groundPoint = this.raycastGround(ray, maxDist, heightFn);
    const buildingHit = this.raycastBuildings(ray, maxDist, heightFn);
    if (!buildingHit) return groundPoint ? { point: groundPoint, buildingId: null } : null;
    if (!groundPoint) return { point: buildingHit.point, buildingId: buildingHit.id };
    const groundDist = ray.origin.distanceTo(groundPoint);
    const buildingDist = ray.origin.distanceTo(buildingHit.point);
    return buildingDist < groundDist
      ? { point: buildingHit.point, buildingId: buildingHit.id }
      : { point: groundPoint, buildingId: null };
  }

  // ---- cells ----------------------------------------------------------------
  setCell(i, j, patch) {
    const c = this.cellAt(i, j);
    if (!c) return null;
    Object.assign(c, patch);
    this.events.emit('world:cell', { i, j, cell: c });
    return c;
  }

  setZone(i, j, zone, density = 1) {
    const c = this.cellAt(i, j);
    if (!c) return;
    if (c.type === 'road' || c.type === 'water') return;
    c.zone = zone;
    c.density = zone ? density : 0;
    c.type = zone ? 'zone' : (c.buildingId ? 'building' : 'none');
    this.events.emit('zone:changed', { i, j, zone, density: c.density });
    this.events.emit('world:cell', { i, j, cell: c });
  }

  // ---- roads ----------------------------------------------------------------
  // A linear scan over every existing node here made addRoad-heavy generation (e.g. the demo city's many short
  // interior alley segments) effectively O(edges^2) — fine for a hand-drawn road or two, not for a few hundred
  // procedural ones. `_nodeGrid` buckets nodes by their rounded (x,z); since the only caller uses the default
  // tol=0.5, a match can only ever be in the query point's own 1m bucket or one of its 8 neighbours (a node just
  // past a bucket boundary, e.g. x=4.6 vs a query at x=4.4, still rounds into an adjacent bucket), so checking that
  // fixed 3x3 window is enough — no accuracy is traded away, only the wasted full-map scan.
  _nodeGridKey(x, z) { return `${Math.round(x)},${Math.round(z)}`; }

  _findOrCreateNode(x, z, tol = 0.5) {
    const gx = Math.round(x), gz = Math.round(z);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bucket = this._nodeGrid.get(`${gx + dx},${gz + dz}`);
        if (!bucket) continue;
        for (const n of bucket) {
          if (Math.abs(n.x - x) <= tol && Math.abs(n.z - z) <= tol) return n;
        }
      }
    }
    const id = `n${this._ids.node++}`;
    const n = { id, x, z, y: this.getHeight(x, z), edges: [] };
    this.roads.nodes.set(id, n);
    const key = this._nodeGridKey(x, z);
    let bucket = this._nodeGrid.get(key);
    if (!bucket) { bucket = []; this._nodeGrid.set(key, bucket); }
    bucket.push(n);
    return n;
  }

  /** Nearest existing node within maxDist (Euclidean), or null. Scans the 1 m node-grid buckets that can hold a
   * node that close — unlike _findOrCreateNode's fixed 3x3 window this stays correct for tolerances above 1 m. */
  _nearestNode(x, z, maxDist) {
    const g0x = Math.round(x - maxDist) - 1, g1x = Math.round(x + maxDist) + 1;
    const g0z = Math.round(z - maxDist) - 1, g1z = Math.round(z + maxDist) + 1;
    let best = null, bestD = maxDist + 1e-9;
    for (let gx = g0x; gx <= g1x; gx++) {
      for (let gz = g0z; gz <= g1z; gz++) {
        const bucket = this._nodeGrid.get(`${gx},${gz}`);
        if (!bucket) continue;
        for (const n of bucket) {
          const d = Math.hypot(n.x - x, n.z - z);
          if (d < bestD) { bestD = d; best = n; }
        }
      }
    }
    return best;
  }

  /** Nearest point on a stitchable road edge (vehicle, at-grade) within maxDist: { edge, x, z, dist } or null. */
  _nearestRoadEdgePoint(x, z, maxDist) {
    let best = null;
    for (const e of this.roads.edges.values()) {
      if (e.bridge || e.kind === 'path') continue;
      const na = this.roads.nodes.get(e.a), nb = this.roads.nodes.get(e.b);
      if (!na || !nb) continue;
      const dx = nb.x - na.x, dz = nb.z - na.z, l2 = dx * dx + dz * dz;
      if (!(l2 > 1e-12)) continue;
      let t = ((x - na.x) * dx + (z - na.z) * dz) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = na.x + dx * t, pz = na.z + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d <= maxDist && (!best || d < best.dist)) best = { edge: e, x: px, z: pz, t, dist: d };
    }
    return best;
  }

  /** Resolve one end of a new vehicle road: join a nearby node, else split the nearest road edge, else make a node. */
  _resolveRoadNode(x, z, nodeSnap = NODE_SNAP) {
    const near = this._nearestNode(x, z, nodeSnap);
    if (near) return near;
    const hit = this._nearestRoadEdgePoint(x, z, ENDPOINT_SNAP);
    if (hit) {
      const n = this._splitEdgeAt(hit.edge.id, hit.x, hit.z);
      if (n) return n;
    }
    return this._findOrCreateNode(x, z, 0.01);
  }

  /**
   * Split an edge at (x,z), sharing one node between the two halves. Retires the old edge (cells are re-owned)
   * and inserts the halves with the same cross-section. Returns the junction node, or null for bridges/missing.
   */
  _splitEdgeAt(edgeId, x, z) {
    const e = this.roads.edges.get(edgeId);
    if (!e || e.bridge) return null;
    const na = this.roads.nodes.get(e.a), nb = this.roads.nodes.get(e.b);
    if (!na || !nb) return null;
    const n = this._findOrCreateNode(x, z, 0.05);
    if (n.id === e.a || n.id === e.b) return n;
    const proto = { kind: e.kind, lanes: e.lanes, width: e.width, bridge: !!e.bridge };
    this._retireEdge(e, 'split');
    this._createEdgeBetween(na, n, proto, 'split');
    this._createEdgeBetween(n, nb, proto, 'split');
    return n;
  }

  /** Create the edge between two nodes (reusing an existing one), mark its cells, emit road:added. */
  _createEdgeBetween(na, nb, proto, reason) {
    if (!na || !nb || na === nb) return null;
    for (const eid of na.edges) {
      const e = this.roads.edges.get(eid);
      if (e && ((e.a === na.id && e.b === nb.id) || (e.a === nb.id && e.b === na.id))) return eid;
    }
    const id = `e${this._ids.edge++}`;
    const edge = { id, a: na.id, b: nb.id, kind: proto.kind, lanes: proto.lanes, width: proto.width, bridge: !!proto.bridge };
    this.roads.edges.set(id, edge);
    na.edges.push(id); nb.edges.push(id);
    this._markRoadCells(edge);
    this.events.emit('road:added', { edgeId: id, edge, reason: reason || undefined });
    return id;
  }

  /** Remove an edge from the graph: re-own its cells by the remaining edges (or free them), emit road:removed.
   * Nodes are left alone (callers clean up / heal). `reason` marks programmatic splits/merges for consumers. */
  _retireEdge(edge, reason) {
    this._unmarkRoadCells(edge);
    this.roads.edges.delete(edge.id);
    for (const nid of [edge.a, edge.b]) {
      const n = this.roads.nodes.get(nid);
      if (n) n.edges = n.edges.filter((id) => id !== edge.id);
    }
    this.events.emit('road:removed', { edgeId: edge.id, edge, reason: reason || undefined });
  }

  /**
   * Cell ownership on removal. Cells can be claimed by core marking (carriageway) or by the roads module's own
   * footprint marking (carriageway + sidewalks), so retirement must hand back every cell that points at the
   * retired edge — not just the ones this method's own rasterisation would have marked.
   */
  _unmarkRoadCells(edge) {
    for (const c of this.cells) {
      if (c.roadId !== edge.id) continue;
      const owner = this._cellOwner(c.i, c.j, edge.id);
      if (owner) { c.type = 'road'; c.roadId = owner; }
      else { c.type = this._isWaterCell(c.i, c.j) ? 'water' : 'none'; c.roadId = null; }
    }
  }

  /** Id of the remaining edge whose footprint covers cell (i,j), preferring the closest centreline; null if none. */
  _cellOwner(i, j, excludeId) {
    const p = this.cellToWorld(i, j);
    let best = null, bestD = Infinity;
    for (const e of this.roads.edges.values()) {
      if (e.id === excludeId) continue;
      const na = this.roads.nodes.get(e.a), nb = this.roads.nodes.get(e.b);
      if (!na || !nb) continue;
      const d = pointSegDist(p.x, p.z, na.x, na.z, nb.x, nb.z);
      // generous reach: carriageway + the widest sidewalk/verge (2 m) + half a cell for rasterisation slack
      if (d <= e.width / 2 + 2.5 + this.cellSize * 0.75 && d < bestD) { bestD = d; best = e.id; }
    }
    return best;
  }

  _cleanupNode(nodeId) {
    const n = this.roads.nodes.get(nodeId);
    if (!n || n.edges.length) return;
    this.roads.nodes.delete(nodeId);
    const key = this._nodeGridKey(n.x, n.z);
    const bucket = this._nodeGrid.get(key);
    if (!bucket) return;
    const idx = bucket.indexOf(n);
    if (idx >= 0) bucket.splice(idx, 1);
    if (bucket.length === 0) this._nodeGrid.delete(key);
  }

  /**
   * Removal healing: a degree-2 node whose two edges are the same cross-section and nearly collinear is an
   * artefact of an earlier junction split (the through road's two halves). Merge them back into one edge so
   * editing does not litter the network with micro-edges. Non-collinear degree-2 nodes (real bends) stay.
   */
  _healNode(nodeId) {
    const n = this.roads.nodes.get(nodeId);
    if (!n || n.edges.length !== 2) return;
    const e1 = this.roads.edges.get(n.edges[0]), e2 = this.roads.edges.get(n.edges[1]);
    if (!e1 || !e2) return;
    if (e1.kind !== e2.kind || e1.width !== e2.width || !!e1.bridge !== !!e2.bridge || e1.bridge) return;
    const o1 = this.roads.nodes.get(e1.a === nodeId ? e1.b : e1.a);
    const o2 = this.roads.nodes.get(e2.a === nodeId ? e2.b : e2.a);
    if (!o1 || !o2 || o1 === o2) return;
    const l1 = Math.hypot(n.x - o1.x, n.z - o1.z), l2 = Math.hypot(n.x - o2.x, n.z - o2.z);
    if (!(l1 > 1e-6) || !(l2 > 1e-6)) return;
    const d1x = (o1.x - n.x) / l1, d1z = (o1.z - n.z) / l1;
    const d2x = (o2.x - n.x) / l2, d2z = (o2.z - n.z) / l2;
    if (d1x * d2x + d1z * d2z > STRAIGHT_COS) return; // < ~177.5 deg: a real bend, keep the node
    const proto = { kind: e1.kind, lanes: e1.lanes, width: e1.width, bridge: !!e1.bridge };
    this._retireEdge(e1, 'merge');
    this._retireEdge(e2, 'merge');
    this._createEdgeBetween(o1, o2, proto, 'merge');
    this._cleanupNode(nodeId);
    this._healNode(o1.id);
    this._healNode(o2.id);
  }

  static ROAD_SPECS = {
    street: { lanes: 2, width: 8 },
    avenue: { lanes: 4, width: 16 },
    highway: { lanes: 4, width: 16 },
    path: { lanes: 0, width: 3 },
  };

  /** Fraction (0..1) of segment a->b that runs alongside (not merely crosses) an existing road of the given
   * kind's width. Parallel-ish edges within lateral reach of each other contribute their along-axis overlap
   * length; a crossing edge (near-perpendicular) contributes nothing, however many cells it shares. */
  roadOverlapFraction(a, b, kind = 'street') {
    const spec = World.ROAD_SPECS[kind] || World.ROAD_SPECS.street;
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz);
    if (!(len > 1e-6)) return 0;
    const dirx = dx / len, dirz = dz / len;
    let overlapLen = 0;
    for (const e of this.roads.edges.values()) {
      const na = this.roads.nodes.get(e.a), nb = this.roads.nodes.get(e.b);
      if (!na || !nb) continue;
      const edx = nb.x - na.x, edz = nb.z - na.z, elen = Math.hypot(edx, edz);
      if (!(elen > 1e-6)) continue;
      const edirx = edx / elen, ediz = edz / elen;
      const cosA = Math.abs(dirx * edirx + dirz * ediz);
      if (cosA < PARALLEL_COS_TOL) continue; // crossing, not running alongside — never blocks
      const nx = -ediz, nz = edirx; // unit normal to the existing edge
      const distA = (a.x - na.x) * nx + (a.z - na.z) * nz;
      const distB = (b.x - na.x) * nx + (b.z - na.z) * nz;
      const maxLateral = (spec.width + e.width) / 2 + 1; // +1m slack
      if (Math.min(Math.abs(distA), Math.abs(distB)) > maxLateral) continue;
      const ta = (a.x - na.x) * edirx + (a.z - na.z) * ediz;
      const tb = (b.x - na.x) * edirx + (b.z - na.z) * ediz;
      const lo = Math.max(0, Math.min(ta, tb)), hi = Math.min(elen, Math.max(ta, tb));
      if (hi > lo) overlapLen += hi - lo;
    }
    return Math.min(1, overlapLen / len);
  }

  roadOverlapBlocked(a, b, kind) { return this.roadOverlapFraction(a, b, kind) > ROAD_OVERLAP_BLOCK_FRACTION; }

  /**
   * Add a road. The segment is stitched into the network: an endpoint that lands on a road splits that road and
   * shares the junction node, and interior crossings of other roads become real junctions (both edges are split
   * at the shared node) instead of overlapping plates. Bridges stay at-grade-exempt (no junction on the deck) and
   * pedestrian paths keep the legacy behaviour (an alley ends at the kerb; it never splits a street).
   * `snapNodes` (interactive drags) additionally routes the new road through any existing node it passes over.
   * Returns the id of the first created edge piece (or an existing edge if nothing new was needed).
   */
  addRoad(a, b, kind = 'street', { bridge = false, snapNodes = false } = {}) {
    const spec = World.ROAD_SPECS[kind] || World.ROAD_SPECS.street;
    if (this.roadOverlapBlocked(a, b, kind)) return null;
    if (kind === 'path') return this._addLegacyRoad(a, b, kind, spec, bridge);

    const na = this._resolveRoadNode(a.x, a.z, snapNodes ? JUNCTION_SNAP : NODE_SNAP);
    const nb = this._resolveRoadNode(b.x, b.z, snapNodes ? JUNCTION_SNAP : NODE_SNAP);
    if (!na || !nb || na === nb) return null;

    const junctionT = new Map(); // junction node id -> t along the requested segment
    if (!bridge) {
      const pool = [...this.roads.edges.values()]; // splits below mutate the map; iterate a snapshot
      for (const e of pool) {
        if (e.bridge || e.kind === 'path') continue;
        if (e.a === na.id || e.b === na.id || e.a === nb.id || e.b === nb.id) continue;
        const ea = this.roads.nodes.get(e.a), eb = this.roads.nodes.get(e.b);
        if (!ea || !eb) continue;
        const hit = segIntersect(na.x, na.z, nb.x, nb.z, ea.x, ea.z, eb.x, eb.z);
        if (!hit) continue;
        const node = this._nearestNode(hit.x, hit.z, JUNCTION_SNAP) || this._splitEdgeAt(e.id, hit.x, hit.z);
        if (!node || node === na || node === nb) continue;
        const prev = junctionT.get(node.id);
        if (prev === undefined || hit.t < prev) junctionT.set(node.id, hit.t);
      }
      if (snapNodes) {
        for (const n of this.roads.nodes.values()) {
          if (n === na || n === nb) continue;
          const dx = nb.x - na.x, dz = nb.z - na.z, l2 = dx * dx + dz * dz;
          if (!(l2 > 1e-12)) continue;
          const t = ((n.x - na.x) * dx + (n.z - na.z) * dz) / l2;
          if (t <= 1e-6 || t >= 1 - 1e-6) continue;
          if (pointSegDist(n.x, n.z, na.x, na.z, nb.x, nb.z) > ROUTE_SNAP) continue;
          const prev = junctionT.get(n.id);
          if (prev === undefined || t < prev) junctionT.set(n.id, t);
        }
      }
    }

    const chain = [{ node: na, t: 0 }];
    for (const [nodeId, t] of junctionT) {
      const n = this.roads.nodes.get(nodeId);
      if (n) chain.push({ node: n, t });
    }
    chain.push({ node: nb, t: 1 });
    chain.sort((p, q) => p.t - q.t);
    const proto = { kind, lanes: spec.lanes, width: spec.width, bridge };
    let first = null;
    for (let i = 0; i + 1 < chain.length; i++) {
      const p = chain[i].node, q = chain[i + 1].node;
      if (p === q) continue;
      const id = this._createEdgeBetween(p, q, proto, null);
      if (id && first === null) first = id;
    }
    return first;
  }

  /** Single-edge add with exact-node endpoints only (pedestrian paths, and the pre-junction callers). */
  _addLegacyRoad(a, b, kind, spec, bridge) {
    const na = this._findOrCreateNode(a.x, a.z);
    const nb = this._findOrCreateNode(b.x, b.z);
    if (na === nb) return null;
    return this._createEdgeBetween(na, nb, { kind, lanes: spec.lanes, width: spec.width, bridge }, null);
  }

  /** Mark every cell the new edge's band covers as road, owned by that edge (an existing road cell keeps its
   * owner; _unmarkRoadCells hands ownership over when that owner is retired). */
  _markRoadCells(edge) {
    const na = this.roads.nodes.get(edge.a), nb = this.roads.nodes.get(edge.b);
    const dx = nb.x - na.x, dz = nb.z - na.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (this.cellSize * 0.5)));
    const half = edge.width / 2 - 0.01;
    const nx = -dz / len, nz = dx / len;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = na.x + dx * t, cz = na.z + dz * t;
      for (let o = -half; o <= half; o += this.cellSize * 0.5) {
        const { i, j } = this.worldToCell(cx + nx * o, cz + nz * o);
        const c = this.cellAt(i, j);
        if (c && c.type !== 'road') { c.type = 'road'; c.zone = null; c.density = 0; c.roadId = edge.id; }
        else if (c && !c.roadId) c.roadId = edge.id; // adopt unowned road cells (e.g. showcase-only markings)
      }
    }
  }

  removeRoad(edgeId) {
    const edge = this.roads.edges.get(edgeId);
    if (!edge) return false;
    const a = edge.a, b = edge.b;
    this._retireEdge(edge);
    this._cleanupNode(a);
    this._cleanupNode(b);
    this._healNode(a); // a through road split at an earlier junction merges back once the junction is gone
    this._healNode(b);
    return true;
  }

  /** Nearest road edge to world point; returns { edge, t, dist, point } or null */
  nearestRoad(x, z, maxDist = 30) {
    let best = null;
    for (const e of this.roads.edges.values()) {
      const a = this.roads.nodes.get(e.a), b = this.roads.nodes.get(e.b);
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - a.x) * dx + (z - a.z) * dz) / l2;
      t = THREE.MathUtils.clamp(t, 0, 1);
      const px = a.x + dx * t, pz = a.z + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d <= maxDist && (!best || d < best.dist)) best = { edge: e, t, dist: d, point: { x: px, z: pz } };
    }
    return best;
  }

  // ---- buildings --------------------------------------------------------------
  addBuilding(rec) {
    const id = rec.id || `b${this._ids.building++}`;
    const b = { level: 1, height: 10, seed: 0, kind: 'generic', w: 1, d: 1, ...rec, id };
    this.buildings.set(id, b);
    for (let j = b.j; j < b.j + b.d; j++) {
      for (let i = b.i; i < b.i + b.w; i++) {
        const c = this.cellAt(i, j);
        if (c) {
          c.buildingId = id;
          if (c.type === 'none' || c.type === 'zone') c.type = 'building';
          if (!b.zone && c.zone) { c.zone = null; c.density = 0; } // non-RCI building consumes any prior zoning
        }
      }
    }
    this.events.emit('building:spawned', { building: b });
    return id;
  }

  removeBuilding(id) {
    const b = this.buildings.get(id);
    if (!b) return false;
    this.buildings.delete(id);
    for (let j = b.j; j < b.j + b.d; j++) {
      for (let i = b.i; i < b.i + b.w; i++) {
        const c = this.cellAt(i, j);
        if (c && c.buildingId === id) { c.buildingId = null; c.type = c.zone ? 'zone' : 'none'; }
      }
    }
    this.events.emit('building:removed', { building: b });
    return true;
  }

  // ---- props -----------------------------------------------------------------
  addProp(rec) {
    const id = rec.id || `p${this._ids.prop++}`;
    const p = { x: 0, y: 0, z: 0, rot: 0, kind: 'generic', ...rec, id };
    this.props.set(id, p);
    this.events.emit('prop:added', { prop: p });
    return id;
  }

  removeProp(id) {
    const p = this.props.get(id);
    if (!p) return false;
    this.props.delete(id);
    this.events.emit('prop:removed', { prop: p });
    return true;
  }

  // ---- weather / stats ----------------------------------------------------------
  setWeather(patch) {
    Object.assign(this.weather, patch);
    this.events.emit('weather:changed', { weather: this.weather });
  }

  setStats(patch) {
    Object.assign(this.stats, patch);
  }

  /** Remove all roads/buildings/props/zones (terrain stays). Used between showcases. */
  clearContent() {
    for (const id of [...this.buildings.keys()]) this.removeBuilding(id);
    for (const id of [...this.props.keys()]) this.removeProp(id);
    // Bulk road clear: per-edge removal + healing would be O(edges^2) here and a delete-while-iterating loop
    // could miss edges that healing merges mid-loop. Clear the graph, reset road cells once, then emit the
    // removals so listeners (roads/traffic/sim/ui) rebuild as usual.
    const edges = [...this.roads.edges.values()];
    this.roads.edges.clear();
    this.roads.nodes.clear();
    this._nodeGrid.clear();
    for (const c of this.cells) { c.zone = null; c.density = 0; if (c.type !== 'water') c.type = 'none'; c.roadId = null; c.buildingId = null; }
    for (const e of edges) this.events.emit('road:removed', { edgeId: e.id, edge: e });
  }
}
