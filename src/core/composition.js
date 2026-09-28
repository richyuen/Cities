// LOOP cycle 1 (L1 hero framing): subject selection + camera-placement helpers for the core presets.
// Pure functions over the world model (same world -> same framing, no RNG, no state) so the presets can frame
// real subjects — a civic hero, the busiest avenue, the tallest tower cluster — instead of fixed offsets that
// aimed at empty fields (the top blind-set loss lever: game-r22-critic #1, beauty-v5-critic #2/#3).
import * as THREE from 'three';

export const CIVIC_KINDS = new Set(['school', 'hospital', 'fire_department', 'police_station']);
export const DEG = Math.PI / 180;

export function buildingCenter(world, b) {
  return world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2);
}

export function buildingDiag(world, b) {
  const cs = world.cellSize || 8;
  return Math.hypot((b.w || 1) * cs, (b.d || 1) * cs);
}

export function propCountNear(world, x, z, r) {
  const r2 = r * r;
  let n = 0;
  for (const p of world.props.values()) {
    const dx = p.x - x, dz = p.z - z;
    if (dx * dx + dz * dz < r2) n++;
  }
  return n;
}

/** Civic buildings scored by surrounding life: neighbouring buildings (a street corner, not a lone lot) plus
 * street props within 34 m. Ties break on height then id for a stable order. */
export function civicSubjects(world, limit = 12) {
  const all = [...world.buildings.values()];
  const out = [];
  for (const b of all) {
    if (!CIVIC_KINDS.has(b.kind)) continue;
    const c = buildingCenter(world, b);
    let neighbours = 0;
    for (const o of all) {
      if (o === b) continue;
      const oc = buildingCenter(world, o);
      if (Math.hypot(oc.x - c.x, oc.z - c.z) < 55) neighbours++;
    }
    const dress = propCountNear(world, c.x, c.z, 34);
    out.push({ b, x: c.x, z: c.z, h: b.height || 10, diag: buildingDiag(world, b), neighbours, dress, score: neighbours * 10 + dress });
  }
  out.sort((p, q) => q.score - p.score || q.h - p.h || (String(p.b.id) < String(q.b.id) ? -1 : 1));
  return out.slice(0, limit);
}

/** Street/avenue edges scored by building frontage (levels, tall buildings weighted) + props near the midpoint.
 * Long edges and avenues are preferred: a hero street needs depth and life. Deterministic tie-break on id. */
export function streetCandidates(world) {
  const bs = [...world.buildings.values()].map((b) => ({ b, c: buildingCenter(world, b), h: b.height || 10 }));
  const out = [];
  for (const e of world.roads.edges.values()) {
    if (e.kind !== 'street' && e.kind !== 'avenue') continue;
    const a = world.roads.nodes.get(e.a), b2 = world.roads.nodes.get(e.b);
    if (!a || !b2) continue;
    const len = Math.hypot(b2.x - a.x, b2.z - a.z);
    if (len < 60) continue;
    let score = 0;
    for (const t of [0.25, 0.5, 0.75]) {
      const sx = a.x + (b2.x - a.x) * t, sz = a.z + (b2.z - a.z) * t;
      for (const { b, c, h } of bs) {
        const d = Math.hypot(c.x - sx, c.z - sz);
        if (d < 26) score += (b.level || 1) * (h > 30 ? 1.5 : 1);
      }
    }
    score += 0.5 * propCountNear(world, (a.x + b2.x) / 2, (a.z + b2.z) / 2, 34);
    score += len * 0.03;
    if (e.kind === 'avenue') score += 8;
    out.push({ e, a, b: b2, len, score });
  }
  out.sort((p, q) => q.score - p.score || (String(p.e.id) < String(q.e.id) ? -1 : 1));
  return out;
}

/** Tallest cluster around a centre: top-N buildings by height within `radius`, centroid + max height. */
export function towerCluster(world, centre, radius = 420, top = 40) {
  const list = [];
  for (const b of world.buildings.values()) {
    const h = b.height || 0;
    if (h <= 0) continue;
    const c = buildingCenter(world, b);
    if (Math.hypot(c.x - centre.x, c.z - centre.z) > radius) continue;
    list.push({ b, x: c.x, z: c.z, h });
  }
  list.sort((p, q) => q.h - p.h || (String(p.b.id) < String(q.b.id) ? -1 : 1));
  const sel = list.slice(0, top);
  if (!sel.length) return null;
  const s = sel.reduce((acc, e) => { acc.x += e.x; acc.z += e.z; acc.h = Math.max(acc.h, e.h); return acc; }, { x: 0, z: 0, h: 0 });
  return { x: s.x / sel.length, z: s.z / sel.length, h: s.h, n: sel.length };
}

export function sunAzimuth(clock) {
  if (!clock?.sunDir) return 0;
  return Math.atan2(clock.sunDir.x, clock.sunDir.z);
}

/** Camera position `dist` metres from (x, z) along azimuth `az` (0 = +z, radians), eye at `eyeY`. */
export function place(x, z, az, dist, eyeY) {
  return { x: x + Math.sin(az) * dist, z: z + Math.cos(az) * dist, y: eyeY };
}

/** 2D segment-vs-building-footprints test (slab method, footprints inflated by `pad`). Buildings are axis-
 * aligned cell rectangles, so this is an exact cheap occlusion proxy for a level-ish camera ray. */
export function segmentBlocked(world, x0, z0, x1, z1, ignoreId, pad = 0.6) {
  const cs = world.cellSize || 8;
  const dx = x1 - x0, dz = z1 - z0;
  for (const b of world.buildings.values()) {
    if (ignoreId !== undefined && b.id === ignoreId) continue;
    const minX = world.minX + b.i * cs - pad, maxX = minX + (b.w || 1) * cs + pad * 2;
    const minZ = world.minZ + b.j * cs - pad, maxZ = minZ + (b.d || 1) * cs + pad * 2;
    let tmin = 0, tmax = 1, ok = true;
    for (const [p, d, lo, hi] of [[x0, dx, minX, maxX], [z0, dz, minZ, maxZ]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { ok = false; break; } continue; }
      let t1 = (lo - p) / d, t2 = (hi - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
      if (tmin > tmax) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/** Nearest building to a point (cell-centre distances), for verifying a preset's subject. */
export function nearestBuilding(world, x, z) {
  let best = null, bestD = Infinity;
  for (const b of world.buildings.values()) {
    const c = buildingCenter(world, b);
    const d = Math.hypot(c.x - x, c.z - z);
    if (d < bestD) { bestD = d; best = { b, x: c.x, z: c.z, h: b.height || 10, d: bestD }; }
  }
  return best;
}

export { THREE };
