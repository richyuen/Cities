import * as THREE from 'three';

// Shared world data model. All mutations go through methods here and emit events. Deterministic ids.

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
    this.buildings = new Map();
    this.props = new Map();
    this.weather = { kind: 'clear', intensity: 0, wind: [1, 0] };
    this.stats = { population: 0, jobs: 0, money: 50000, happiness: 0.7, traffic: 0 };
    this._ids = { node: 0, edge: 0, building: 0, prop: 0 };
    this.seaLevel = 0; // meters; terrain may set
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

  /** Ray-march the ray against the height field; returns THREE.Vector3 point or null */
  raycastGround(ray, maxDist = 6000) {
    const p = new THREE.Vector3();
    let t = 0, step = 4;
    let prevAbove = null;
    for (let iter = 0; iter < 4000 && t < maxDist; iter++) {
      ray.at(t, p);
      const h = this.getHeight(p.x, p.z);
      const above = p.y > h;
      if (prevAbove === true && !above) {
        // refine
        let lo = t - step, hi = t;
        for (let k = 0; k < 12; k++) {
          const mid = (lo + hi) / 2;
          ray.at(mid, p);
          if (p.y > this.getHeight(p.x, p.z)) lo = mid; else hi = mid;
        }
        ray.at(hi, p);
        p.y = this.getHeight(p.x, p.z);
        return p.clone();
      }
      prevAbove = above;
      t += step;
      if (p.y - h > 50) step = Math.min(64, step * 1.5); else step = 2;
    }
    return null;
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
  _findOrCreateNode(x, z, tol = 0.5) {
    for (const n of this.roads.nodes.values()) {
      if (Math.abs(n.x - x) <= tol && Math.abs(n.z - z) <= tol) return n;
    }
    const id = `n${this._ids.node++}`;
    const n = { id, x, z, y: this.getHeight(x, z), edges: [] };
    this.roads.nodes.set(id, n);
    return n;
  }

  static ROAD_SPECS = {
    street: { lanes: 2, width: 8 },
    avenue: { lanes: 4, width: 16 },
    highway: { lanes: 4, width: 16 },
    path: { lanes: 0, width: 3 },
  };

  addRoad(a, b, kind = 'street') {
    const spec = World.ROAD_SPECS[kind] || World.ROAD_SPECS.street;
    const na = this._findOrCreateNode(a.x, a.z);
    const nb = this._findOrCreateNode(b.x, b.z);
    if (na === nb) return null;
    for (const eid of na.edges) {
      const e = this.roads.edges.get(eid);
      if (e && ((e.a === na.id && e.b === nb.id) || (e.a === nb.id && e.b === na.id))) return eid;
    }
    const id = `e${this._ids.edge++}`;
    const edge = { id, a: na.id, b: nb.id, kind, lanes: spec.lanes, width: spec.width };
    this.roads.edges.set(id, edge);
    na.edges.push(id); nb.edges.push(id);
    this._markRoadCells(edge, id);
    this.events.emit('road:added', { edgeId: id, edge });
    return id;
  }

  _markRoadCells(edge, roadId) {
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
        if (!c) continue;
        if (roadId) {
          if (c.type !== 'road') { c.type = 'road'; c.zone = null; c.density = 0; c.roadId = roadId; }
        } else if (c.roadId === edge.id) {
          c.type = 'none'; c.roadId = null;
        }
      }
    }
  }

  removeRoad(edgeId) {
    const edge = this.roads.edges.get(edgeId);
    if (!edge) return false;
    this._markRoadCells(edge, null); // before nodes may be deleted
    this.roads.edges.delete(edgeId);
    for (const nid of [edge.a, edge.b]) {
      const n = this.roads.nodes.get(nid);
      if (!n) continue;
      n.edges = n.edges.filter((e) => e !== edgeId);
      if (n.edges.length === 0) this.roads.nodes.delete(nid);
    }
    this.events.emit('road:removed', { edgeId, edge });
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
        if (c) { c.buildingId = id; if (c.type === 'none' || c.type === 'zone') c.type = 'building'; }
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
    for (const id of [...this.roads.edges.keys()]) this.removeRoad(id);
    for (const c of this.cells) { c.zone = null; c.density = 0; if (c.type !== 'water') c.type = 'none'; c.roadId = null; c.buildingId = null; }
  }
}
