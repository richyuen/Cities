// Builds a lightweight driving graph on top of roads' lane API: cached lane polylines, cached intersection
// turn/connector polylines (with arc-length tables for both), and a simple per-intersection traffic-light timer
// keyed by node id (roads/props don't own signals, so traffic keeps its own — brief allows this fallback).

const TURN_WEIGHTS = { through: 6, right: 2, left: 2, uturn: 1 };
export const SPEED_BY_KIND = { street: 8, avenue: 12, highway: 20, path: 4 };
const TURN_SPEED = 5.5;      // through an intersection curve
// Signal timing: round-robin by ARM (not opposite-pairs) — only one incoming arm discharges at a time. Slower
// throughput than a real 2-phase light, but it makes every turn conflict-free (including unprotected lefts across
// oncoming traffic, which a simple 2-phase N/S-E/W split would not protect against) without any yielding logic.
const GREEN_S = 12, ALLRED_S = 2;
// New entries are only allowed in the first (GREEN_S - ENTRY_MARGIN_S) seconds of the green window, not the whole
// window — a car that entered right at the buzzer can still take several seconds to clear a long turn curve, and
// without this margin the next arm's round-robin slot could start admitting cross traffic before it's out.
const ENTRY_MARGIN_S = 5;

function dist3(a, b) { return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z); }

function buildCum(pts) {
  const cum = new Array(pts.length);
  cum[0] = 0;
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + dist3(pts[i - 1], pts[i]);
  return { pts, cum, total: cum[cum.length - 1] || 0 };
}

/** Sample a cached path at arc-length s: returns { x,y,z, tx,ty,tz } (tangent, not normalized to unit length). */
export function sampleAt(pd, s) {
  const { pts, cum, total } = pd;
  const n = pts.length;
  if (n < 2) { const p = pts[0] || { x: 0, y: 0, z: 0 }; return { x: p.x, y: p.y, z: p.z, tx: 1, ty: 0, tz: 0 }; }
  if (s <= 0) {
    const a = pts[0], b = pts[1];
    return { x: a.x, y: a.y, z: a.z, tx: b.x - a.x, ty: b.y - a.y, tz: b.z - a.z };
  }
  if (s >= total) {
    const a = pts[n - 2], b = pts[n - 1];
    return { x: b.x, y: b.y, z: b.z, tx: b.x - a.x, ty: b.y - a.y, tz: b.z - a.z };
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const segLen = Math.max(1e-6, cum[hi] - cum[lo]);
  const u = (s - cum[lo]) / segLen;
  const a = pts[lo], b = pts[hi];
  return {
    x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u,
    tx: b.x - a.x, ty: b.y - a.y, tz: b.z - a.z,
  };
}

export class LaneGraph {
  constructor(ctx, rng) {
    this.ctx = ctx;
    this.rng = rng;
    this.laneKeys = [];          // all "L:edge:lane:dir" keys
    this.laneWeights = [];       // parallel: lane length (spawn weighting)
    this.laneMeta = new Map();   // key -> { kind, terminalNodeId, terminalArm, isIntersection }
    this.pathCache = new Map();  // key -> {pts,cum,total}
    this.nodeConns = new Map();  // nodeId -> connections[] (each has .path)
    this.nodeSignal = new Map(); // nodeId -> { offset, cycle, armOfEdge: Map<edgeId,armIndex>, nArms }
    this.totalLaneLength = 0;
    this.ready = false;
  }

  rebuild() {
    const { ctx } = this;
    const roads = ctx.modules.get('roads');
    this.laneKeys.length = 0; this.laneWeights.length = 0;
    this.laneMeta.clear(); this.pathCache.clear(); this.nodeConns.clear(); this.nodeSignal.clear();
    this.totalLaneLength = 0;
    this.ready = false;
    if (!roads || roads.status !== 'ok') return;
    const api = roads.api;
    const world = ctx.world;

    // intersections: build signal metadata (arm angle -> group) for real intersections (>=3 arms)
    let nodeIdx = 0;
    let intersections = [];
    try { intersections = api.getIntersections() || []; } catch (_) { intersections = []; }
    for (const n of intersections) {
      if (n.kind === 'intersection') {
        const armOfEdge = new Map();
        const arms = [...n.arms].sort((a, b) => a.angle - b.angle);
        arms.forEach((arm, k) => armOfEdge.set(arm.edgeId, k));
        const nArms = arms.length;
        const cycle = nArms * (GREEN_S + ALLRED_S);
        const offset = this.rng.hash2(nodeIdx, 11) * cycle;
        this.nodeSignal.set(n.nodeId, { offset, cycle, armOfEdge, nArms });
      }
      nodeIdx++;
      let conns = [];
      try { conns = api.getLaneConnections(n.nodeId) || []; } catch (_) { conns = []; }
      this.nodeConns.set(n.nodeId, conns);
      for (let i = 0; i < conns.length; i++) {
        const key = `T:${n.nodeId}:${i}`;
        const pts = conns[i].path;
        if (pts && pts.length >= 2) this.pathCache.set(key, buildCum(pts));
      }
    }

    // lanes: every (edge, laneIndex, direction) with a real path
    for (const edge of world.roads.edges.values()) {
      let nLanes = 0;
      try { nLanes = api.lanesPerDirection(edge.id); } catch (_) { nLanes = 0; }
      if (!(nLanes > 0)) continue;
      for (const dir of ['forward', 'backward']) {
        for (let lane = 0; lane < nLanes; lane++) {
          let pts = [];
          try { pts = api.getLanePath(edge.id, lane, dir); } catch (_) { pts = []; }
          if (!pts || pts.length < 2) continue;
          const key = `L:${edge.id}:${lane}:${dir}`;
          const pd = buildCum(pts);
          this.pathCache.set(key, pd);
          const terminalNodeId = dir === 'forward' ? edge.b : edge.a;
          const sig = this.nodeSignal.get(terminalNodeId);
          const terminalArm = sig ? sig.armOfEdge.get(edge.id) ?? 0 : 0;
          this.laneMeta.set(key, {
            kind: edge.kind, edgeId: edge.id, lane, direction: dir,
            terminalNodeId, isIntersection: !!sig, terminalArm, total: pd.total,
          });
          this.laneKeys.push(key);
          this.laneWeights.push(Math.max(1, pd.total));
          this.totalLaneLength += pd.total;
        }
      }
    }
    this.ready = this.laneKeys.length > 0;
  }

  getPath(key) { return this.pathCache.get(key); }

  /** Stable key for "whatever is currently crossing the node from this incoming arm", independent of which lane
   * or specific turn each car picked. Grouping by the whole arm (not just one lane) is deliberately coarser than
   * physically necessary on a multi-lane approach (e.g. avenue): a right turn from the near lane and a left turn
   * from the far lane can geometrically cross paths inside the intersection, so treating every lane of the arm as
   * one shared queue for following purposes is the simple way to guarantee no two cars from the same arm ever
   * overlap, at the cost of being a little more cautious than a real multi-lane light would need to be. */
  approachKeyFor(laneKey) {
    const meta = this.laneMeta.get(laneKey);
    if (!meta) return null;
    return `A:${meta.terminalNodeId}:${meta.edgeId}:${meta.direction}`;
  }

  /** Weighted-random pick of a spawn lane; null if the graph is empty. */
  pickSpawnLane() {
    if (!this.laneKeys.length) return null;
    return this.rng.pickWeighted(this.laneKeys, this.laneWeights);
  }

  /** Given the current segment key, choose (weighted, through-heavy) the next segment key + phase. */
  commitNext(key) {
    if (key[0] === 'L') {
      const meta = this.laneMeta.get(key);
      if (!meta) return null;
      const conns = this.nodeConns.get(meta.terminalNodeId) || [];
      const cands = [];
      for (let i = 0; i < conns.length; i++) {
        const c = conns[i];
        if (c.from.edgeId === meta.edgeId && c.from.lane === meta.lane && c.from.direction === meta.direction) cands.push({ i, c });
      }
      if (!cands.length) return null;
      const items = cands.map((x) => x.i);
      const weights = cands.map((x) => TURN_WEIGHTS[x.c.turn] ?? 1);
      const idx = this.rng.pickWeighted(items, weights);
      const nodeId = meta.terminalNodeId;
      const nextKey = `T:${nodeId}:${idx}`;
      if (!this.pathCache.has(nextKey)) return null;
      return { key: nextKey, phase: 'turn' };
    }
    // key[0] === 'T'
    const [, nodeId, idxStr] = key.split(':');
    const conns = this.nodeConns.get(nodeId);
    const conn = conns && conns[Number(idxStr)];
    if (!conn) return null;
    const nextKey = `L:${conn.to.edgeId}:${conn.to.lane}:${conn.to.direction}`;
    if (!this.pathCache.has(nextKey)) return null;
    return { key: nextKey, phase: 'lane' };
  }

  baseSpeed(key) {
    if (key[0] === 'L') { const meta = this.laneMeta.get(key); return meta ? SPEED_BY_KIND[meta.kind] ?? 8 : 8; }
    return TURN_SPEED;
  }

  /** true if the intersection this lane feeds into is currently green for this lane's arm; true for non-lights.
   * Round-robin by arm: only one arm discharges at a time, so every entry is conflict-free (through, turns and
   * unprotected lefts alike) with zero cross-traffic yielding logic. */
  isGreen(key, simTime) {
    if (key[0] !== 'L') return true;
    const meta = this.laneMeta.get(key);
    if (!meta || !meta.isIntersection) return true;
    const sig = this.nodeSignal.get(meta.terminalNodeId);
    if (!sig) return true;
    const slot = GREEN_S + ALLRED_S;
    const t = (simTime + sig.offset) % sig.cycle;
    const active = Math.floor(t / slot) % sig.nArms;
    if (active !== meta.terminalArm) return false;
    return (t - active * slot) < (GREEN_S - ENTRY_MARGIN_S);
  }
}
