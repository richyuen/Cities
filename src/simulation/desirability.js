// Lazily recomputed desirability grid: multi-source BFS distances (cells) to roads, industry, residential and parks.
// Recompute is triggered by markDirty() and happens at most once per frame, on the first query after a change.

const MAXD = 255;

export class DesirabilityGrid {
  constructor(world) {
    this.world = world;
    const n = world.size.w * world.size.h;
    this.dRoad = new Uint8Array(n);
    this.dInd = new Uint8Array(n);
    this.dRes = new Uint8Array(n);
    this.dPark = new Uint8Array(n);
    this._queue = new Int32Array(n);
    this.dirty = true;
    this.lastFrame = -1;
    this.recomputes = 0;
  }

  markDirty() { this.dirty = true; }

  /** Recompute if dirty; throttled to once per frame id. */
  ensure(frame = 0) {
    if (!this.dirty || frame === this.lastFrame) return;
    this.lastFrame = frame;
    this.dirty = false;
    this._recompute();
  }

  _bfs(dist, isSource) {
    const { w, h } = this.world.size, n = w * h, cells = this.world.cells, q = this._queue;
    dist.fill(MAXD);
    let head = 0, tail = 0;
    for (let k = 0; k < n; k++) if (isSource(cells[k])) { dist[k] = 0; q[tail++] = k; }
    while (head < tail) {
      const k = q[head++], d = dist[k] + 1;
      if (d >= 32) continue; // cap search radius
      const i = k % w, j = (k - i) / w;
      if (i > 0 && dist[k - 1] > d) { dist[k - 1] = d; q[tail++] = k - 1; }
      if (i < w - 1 && dist[k + 1] > d) { dist[k + 1] = d; q[tail++] = k + 1; }
      if (j > 0 && dist[k - w] > d) { dist[k - w] = d; q[tail++] = k - w; }
      if (j < h - 1 && dist[k + w] > d) { dist[k + w] = d; q[tail++] = k + w; }
    }
  }

  _recompute() {
    const world = this.world, bld = world.buildings;
    const zoneOf = (c) => c.zone || (c.buildingId ? bld.get(c.buildingId)?.zone : null) || null;
    this._bfs(this.dRoad, (c) => c.type === 'road');
    this._bfs(this.dInd, (c) => zoneOf(c) === 'i');
    this._bfs(this.dRes, (c) => zoneOf(c) === 'r');
    this._bfs(this.dPark, (c) => c.type === 'park');
    this.recomputes++;
  }

  /** 0..1 desirability of cell (i,j) for a zone ('r' | 'c' | 'i'); defaults to the cell's zone, else 'r'. */
  get(i, j, zone) {
    const c = this.world.cellAt(i, j);
    if (!c || c.type === 'road' || c.type === 'water') return 0;
    const k = j * this.world.size.w + i;
    const dr = this.dRoad[k], di = this.dInd[k], dre = this.dRes[k], dp = this.dPark[k];
    const road = dr <= 1 ? 1 : Math.max(0, 1 - (dr - 1) / 5);
    if (road <= 0) return 0;
    const z = zone || c.zone || 'r';
    const c01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    let v;
    if (z === 'r') v = road * (0.5 + 0.5 * c01(di / 6)) * (0.75 + 0.25 * c01(1 - (dp - 1) / 5));
    else if (z === 'c') v = road * (0.45 + 0.55 * c01(1 - (dre - 1) / 5));
    else v = road * (0.55 + 0.45 * c01(dre / 6));
    return c01(v);
  }
}
