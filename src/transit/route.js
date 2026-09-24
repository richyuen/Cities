// Route computation for bus lines: a drivable lane graph built from the roads module's public lane API, plus
// Dijkstra between stops. Deliberately parallel to traffic's private LaneGraph (which owns signals/vehicle sim),
// but this one only needs *reachability and geometry* — and it must be recomputable whenever roads change.
//
// Key format matches traffic's lane graph exactly (`L:<edgeId>:<lane>:<direction>` for a lane, `T:<nodeId>:<i>`
// for the i-th lane connection through a node), so a route computed here can be handed straight to
// `traffic.setTransitLines()` and its cached paths are the exact same polylines cars drive.

export const laneKey = (edgeId, lane, dir) => `L:${edgeId}:${lane}:${dir}`;

function buildCum(pts) {
  const cum = new Array(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  }
  return { pts, cum, total: cum[cum.length - 1] || 0 };
}

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y, pts[i].z - pts[i - 1].z);
  return d;
}

// Turn cost nudges routes toward natural through/right movements; a U-turn is heavily discouraged (it is still
// legal at a dead end, where it is the only way out).
const TURN_COST = { through: 0, right: 1.5, left: 5, uturn: 16 };

/** Minimal binary heap over (cost, key). Ties break on key order for determinism. */
class MinHeap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  push(cost, key) {
    const a = this.a;
    a.push({ cost, key });
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].cost < a[i].cost || (a[p].cost === a[i].cost && a[p].key <= a[i].key)) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && (a[l].cost < a[m].cost || (a[l].cost === a[m].cost && a[l].key < a[m].key))) m = l;
        if (r < a.length && (a[r].cost < a[m].cost || (a[r].cost === a[m].cost && a[r].key < a[m].key))) m = r;
        if (m === i) break;
        const t = a[m]; a[m] = a[i]; a[i] = t; i = m;
      }
    }
    return top;
  }
}

export class LaneRouter {
  constructor(ctx) {
    this.ctx = ctx;
    this.nodes = new Map();   // laneKey -> { key, edgeId, lane, dir, kind, pts, cum, total, next: [{ to, turnKey, cost, turn }] }
    this.turnPaths = new Map(); // turnKey -> connector polyline (for ribbons/route length)
    this.ready = false;
  }

  /** Rebuild from the current road network. Cheap enough to run on every road edit (a few thousand nodes). */
  rebuild() {
    this.nodes.clear();
    this.turnPaths.clear();
    this.ready = false;
    const roads = this.ctx.modules.get('roads');
    if (!roads || roads.status !== 'ok') return;
    const api = roads.api;
    const world = this.ctx.world;
    try {
      for (const edge of world.roads.edges.values()) {
        const nLanes = api.lanesPerDirection(edge.id);
        if (!(nLanes > 0)) continue;
        const oneway = edge.oneway | 0;
        for (const dir of ['forward', 'backward']) {
          if (oneway && oneway !== (dir === 'forward' ? 1 : -1)) continue;
          for (let lane = 0; lane < nLanes; lane++) {
            const pts = api.getLanePath(edge.id, lane, dir);
            if (!pts || pts.length < 2) continue;
            const pd = buildCum(pts);
            this.nodes.set(laneKey(edge.id, lane, dir), {
              key: laneKey(edge.id, lane, dir), edgeId: edge.id, lane, dir, kind: edge.kind,
              pts: pd.pts, cum: pd.cum, total: pd.total, next: [],
            });
          }
        }
      }
      for (const n of api.getIntersections()) {
        const conns = api.getLaneConnections(n.nodeId) || [];
        for (let i = 0; i < conns.length; i++) {
          const c = conns[i];
          if (!c.path || c.path.length < 2) continue;
          const from = this.nodes.get(laneKey(c.from.edgeId, c.from.lane, c.from.direction));
          const to = this.nodes.get(laneKey(c.to.edgeId, c.to.lane, c.to.direction));
          if (!from || !to) continue;
          const turnKey = `T:${n.nodeId}:${i}`;
          this.turnPaths.set(turnKey, c.path);
          from.next.push({
            to: to.key,
            turnKey,
            cost: pathLength(c.path) + (TURN_COST[c.turn] ?? 2),
            turn: c.turn,
          });
        }
      }
      this.ready = this.nodes.size > 0;
    } catch (e) {
      this.ready = false;
      this.ctx.error('[transit] lane graph build failed:', e);
    }
  }

  /** Up to `k` candidate lanes near (x,z), best first. Curbside lanes (lane 0) get a small bonus: a bus stop
   * belongs at the curb, and lane 0 is the rightmost lane in the travel direction. */
  nearestLanes(x, z, k = 3, { lanePenalty = 2.5, maxDist = 46 } = {}) {
    const out = [];
    for (const node of this.nodes.values()) {
      const pts = node.pts;
      let best = Infinity, bestS = 0;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        const dx = b.x - a.x, dz = b.z - a.z;
        const l2 = dx * dx + dz * dz;
        let u = l2 > 1e-9 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0;
        u = Math.max(0, Math.min(1, u));
        const d = Math.hypot(a.x + dx * u - x, a.z + dz * u - z);
        if (d < best) { best = d; bestS = node.cum[i - 1] + (node.cum[i] - node.cum[i - 1]) * u; }
      }
      const score = best + lanePenalty * node.lane;
      if (best <= maxDist) out.push({ node, s: bestS, dist: best, score });
    }
    out.sort((a, b) => a.score - b.score || (a.node.key < b.node.key ? -1 : 1));
    return out.slice(0, k);
  }

  /** Shortest lane-key route from `fromKey` to any key in `targets` (array/Set). Returns { keys, length } or
   * null. `keys` alternates lane and turn keys, starting and ending on lane keys. */
  route(fromKey, targets) {
    if (!this.nodes.has(fromKey)) return null;
    const targetSet = targets instanceof Set ? targets : new Set(targets);
    if (targetSet.has(fromKey)) return { keys: [fromKey], length: 0 };
    const dist = new Map([[fromKey, 0]]);
    const prev = new Map(); // key -> { fromKey, turnKey }
    const heap = new MinHeap();
    heap.push(0, fromKey);
    const done = new Set();
    while (heap.size) {
      const { cost, key } = heap.pop();
      if (done.has(key)) continue;
      done.add(key);
      if (targetSet.has(key)) {
        const keys = [key];
        let cur = key;
        while (cur !== fromKey) {
          const p = prev.get(cur);
          if (!p) return null;
          keys.unshift(p.fromKey, p.turnKey); // lane first, then the connector that reaches the next lane
          cur = p.fromKey;
        }
        return { keys, length: cost };
      }
      const node = this.nodes.get(key);
      if (!node) continue;
      for (const hop of node.next) {
        const nk = hop.to;
        const nc = cost + this.nodes.get(nk).total + hop.cost;
        const old = dist.get(nk);
        if (old === undefined || nc < old) {
          dist.set(nk, nc);
          prev.set(nk, { fromKey: key, turnKey: hop.turnKey });
          heap.push(nc, nk);
        }
      }
    }
    return null;
  }

  /** Total drivable length of a key sequence (lane paths + turn connectors), 0 if any key is unknown. */
  routeLength(keys) {
    if (!keys) return 0;
    let d = 0;
    for (const key of keys) {
      if (key[0] === 'L') {
        const node = this.nodes.get(key);
        if (!node) return 0;
        d += node.total;
      } else {
        const pts = this.turnPaths.get(key);
        if (!pts) return 0;
        d += pathLength(pts);
      }
    }
    return d;
  }
}

/** Ordered lane/turn keys through `stops` ([{x,z}...], in visiting order). `close` adds the final leg back to
 * the first stop's lane and trims the duplicated joint so the sequence is a true loop (traffic wraps it); an
 * open route is used while the line tool is still collecting stops. Returns null when any leg is unreachable. */
export function buildRouteKeys(router, stops, { close = true } = {}) {
  const n = stops.length;
  if (n < 2) return null;
  const cands = stops.map((s) => router.nearestLanes(s.x, s.z, 3));
  if (cands.some((c) => !c.length)) return null;
  const firstKey = cands[0][0].node.key;
  const legs = [];
  let cur = firstKey;
  const last = close ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const targets = cands[(i + 1) % n].map((c) => c.node.key);
    if (targets.includes(cur)) { legs.push([cur]); continue; } // this and the next stop share one lane
    const r = router.route(cur, targets);
    if (!r) return null;
    legs.push(r.keys);
    cur = r.keys[r.keys.length - 1];
  }
  if (close && cur !== firstKey) {
    const r = router.route(cur, [firstKey]);
    if (!r) return null;
    legs.push(r.keys);
  }
  const keys = [];
  for (const leg of legs) {
    const k0 = keys.length && leg[0] === keys[keys.length - 1] ? 1 : 0;
    for (let k = k0; k < leg.length; k++) keys.push(leg[k]);
  }
  if (close) while (keys.length > 1 && keys[keys.length - 1] === keys[0]) keys.pop();
  const min = close ? 3 : 2;
  return keys.length >= min ? keys : null;
}

/** Closed loop through `stops` — the form traffic's setTransitLines expects. */
export const buildLineKeys = (router, stops) => buildRouteKeys(router, stops, { close: true });
