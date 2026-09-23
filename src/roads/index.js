import * as THREE from 'three';
import { buildNetwork, lanePath, lanesPerDirection, laneOffsetsFor, directionAllowed, turnAngle, classifyTurn, turnCurve, arcLanePath, kindSpec, profileAt, Y, PITCH } from './network.js';
import { GeoAcc, buildEdge, buildNode } from './geometry.js';
import { StudField, StudList } from './studs.js';
import { stageTerrain, stageNetwork, stageLots, buildFallbackGround } from './showcase.js';

// roads — renders world.roads as Lego road plates (merged geometry, ≤ 10 draw calls) and exposes lane geometry.
// Depends on terrain when that module exists in the build (Vite resolves the glob at build time); until the terrain
// module lands, roads runs standalone with a flat/showcase height field so it can be screenshotted.
const TERRAIN_PRESENT = Object.keys(import.meta.glob('../terrain/index.js')).length > 0;

// Player endpoint snapping (see api.snapToNode): a node is a snap target over its whole paved plate — the
// carriageway + sidewalk radius of its arms, or a street dead end's cul-de-sac bulb — plus this pad, one full
// 8 m cell. The pad has to cover the grid snap's worst-case rounding of a click aimed at the junction (up to a
// cell diagonal), which is why it is a whole cell rather than half of one: with too small a pad, the 2-cell
// diagonal lattice point (16, 8) lands just outside the radius and a street drawn as a clear continuation
// gets its own square-cut end instead of joining.
const NODE_SNAP_PAD = 8;

const S = {
  ctx: null, group: null, rng: null, net: null, meshes: [], studs: null, mats: null,
  dirty: false, lastEvent: 0, unsub: [], lastBuildMs: 0, fallbackGround: null, netDirty: true, extraStuds: [],
  marked: new Map(), lots: null, studStats: { total: 0, terrain: 0, rejected: 0 },
};

function num(v, fb = 0) { return Number.isFinite(v) ? v : fb; }

/** Rendered terrain surface (stepped 0.4 m plates) when the terrain module is up; bilinear height otherwise. */
function makeGroundFn(ctx) {
  const world = ctx.world;
  const terr = ctx.modules.get('terrain');
  const surf = terr?.status === 'ok' && typeof terr.api?.surfaceHeight === 'function' ? terr.api.surfaceHeight : null;
  return (x, z) => {
    const h = num(world.getHeight(x, z));
    if (!surf) return h;
    const s = surf(x, z);
    return Number.isFinite(s) && s > -13 ? Math.max(h, s) : h;
  };
}

function ensureNetwork() {
  if (!S.netDirty && S.net) return S.net;
  S.net = buildNetwork(S.ctx.world, makeGroundFn(S.ctx));
  S.netDirty = false;
  return S.net;
}

function markDirty() { S.dirty = true; S.netDirty = true; S.lastEvent = performance.now(); }

/** Distance from point (px,pz) to segment (ax,az)-(bx,bz). */
function pointSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  if (!(l2 > 1e-12)) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/**
 * Read-only network invariant audit (driven by tools/road-audit.mjs). Every list must be empty for the road
 * network to be consistent:
 *   crossings  — two at-grade vehicle edges crossing without a shared node (traffic can never turn there)
 *   overlaps   — two non-incident parallel edges whose bands genuinely overlap (duplicated road)
 *   nearNodes  — two distinct nodes closer than 1.5 m (should have merged)
 *   unsplitT   — a degree-1 vehicle node sitting inside another vehicle edge's band (T without a junction)
 *   orphans    — node/edge references pointing at deleted entities
 *   badCells   — a road cell whose owner edge id points at a deleted edge (roadCellsNoOwner is informational)
 *   badLane    — NaN/Inf lane paths or lane connections
 *   bulbOverlaps — a rendered cul-de-sac bulb whose pavement overlaps another road's or node's pavement
 */
function auditNetwork(world) {
  const out = { crossings: [], overlaps: [], nearNodes: [], unsplitT: [], orphans: [], badCells: [], badLane: [], bulbOverlaps: [] };
  const nodes = [...world.roads.nodes.values()];
  const edges = [...world.roads.edges.values()];
  const at = (id) => world.roads.nodes.get(id);
  const isVeh = (e) => e && e.kind !== 'path' && !e.bridge;
  const info = [];
  for (const e of edges) {
    const a = at(e.a), b = at(e.b);
    if (!a || !b) continue;
    const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz);
    if (L > 1e-6) info.push({ e, ax: a.x, az: a.z, dx, dz, L });
  }
  const COS20 = Math.cos((20 * Math.PI) / 180);
  for (let i = 0; i < info.length; i++) {
    for (let j = i + 1; j < info.length; j++) {
      const A = info[i], B = info[j], ea = A.e, eb = B.e;
      if (!isVeh(ea) || !isVeh(eb)) continue;
      if (ea.a === eb.a || ea.a === eb.b || ea.b === eb.a || ea.b === eb.b) continue;
      const den = A.dx * B.dz - A.dz * B.dx;
      const qx = B.ax - A.ax, qz = B.az - A.az;
      if (Math.abs(den) > 1e-9) {
        const t = (qx * B.dz - qz * B.dx) / den, u = (qx * A.dz - qz * A.dx) / den;
        if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) {
          out.crossings.push({ a: ea.id, b: eb.id, x: +(A.ax + A.dx * t).toFixed(2), z: +(A.az + A.dz * t).toFixed(2) });
        }
        continue;
      }
      const cos = Math.abs((A.dx * B.dx + A.dz * B.dz) / (A.L * B.L));
      if (cos < COS20) continue;
      const nx = -A.dz / A.L, nz = A.dx / A.L;
      const d1 = (B.ax - A.ax) * nx + (B.az - A.az) * nz;
      const d2 = (B.ax + B.dx - A.ax) * nx + (B.az + B.dz - A.az) * nz;
      const lat = Math.min(Math.abs(d1), Math.abs(d2));
      if (lat >= (ea.width + eb.width) / 2 - 0.01) continue;
      const dirx = A.dx / A.L, dirz = A.dz / A.L;
      const t1 = (B.ax - A.ax) * dirx + (B.az - A.az) * dirz;
      const t2 = (B.ax + B.dx - A.ax) * dirx + (B.az + B.dz - A.az) * dirz;
      const lo = Math.max(0, Math.min(t1, t2)), hi = Math.min(A.L, Math.max(t1, t2));
      if (hi - lo > 0.5) out.overlaps.push({ a: ea.id, b: eb.id, run: +(hi - lo).toFixed(2), lat: +lat.toFixed(2) });
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
      if (d < 1.5) out.nearNodes.push({ a: nodes[i].id, b: nodes[j].id, d: +d.toFixed(2) });
    }
  }
  const edgeIds = new Set(edges.map((e) => e.id));
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const n of nodes) for (const id of n.edges) if (!edgeIds.has(id)) out.orphans.push(`node ${n.id} -> ${id}`);
  for (const e of edges) {
    if (!nodeIds.has(e.a)) out.orphans.push(`edge ${e.id} -> ${e.a}`);
    if (!nodeIds.has(e.b)) out.orphans.push(`edge ${e.id} -> ${e.b}`);
  }
  for (const n of nodes) {
    if (n.edges.length !== 1) continue;
    const inc = world.roads.edges.get(n.edges[0]);
    if (!isVeh(inc)) continue;
    for (const e of info) {
      if (e.e.id === inc.id || !isVeh(e.e)) continue;
      if (e.e.a === n.id || e.e.b === n.id) continue;
      if (pointSegDist(n.x, n.z, e.ax, e.az, e.ax + e.dx, e.az + e.dz) <= e.e.width / 2 - 0.01) {
        out.unsplitT.push({ node: n.id, edge: e.e.id });
        break;
      }
    }
  }
  const cs = world.cellSize;
  let roadCellsNoOwner = 0;
  for (const c of world.cells) {
    if (c.type !== 'road') continue;
    if (!c.roadId) { roadCellsNoOwner++; continue; }
    const e = world.roads.edges.get(c.roadId);
    const a = e && at(e.a), b = e && at(e.b);
    // Ownership itself is the invariant: a road cell must point at a live edge (any live edge covering the cell
    // is fine — junction plates / fillet corners extend beyond a single edge's own band, so "owner covers" is
    // neither necessary nor sufficient). Holes left by a bad removal surface as road cells disappearing, which
    // the harness's round-trip fingerprints catch.
    if (!e || !a || !b) out.badCells.push({ i: c.i, j: c.j, roadId: c.roadId, why: 'missing owner' });
  }
  out.roadCellsNoOwner = roadCellsNoOwner;
  const net = ensureNetwork();
  for (const f of net.edges.values()) {
    if (!(lanesPerDirection(f) > 0)) continue;
    for (const p of lanePath(f, 0, 'forward')) {
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) { out.badLane.push({ edge: f.id, why: 'non-finite lane point' }); break; }
    }
  }
  for (const n of net.nodes.values()) {
    let conns = [];
    try { conns = api.getLaneConnections(n.id); } catch (err) { out.badLane.push({ node: n.id, why: String(err && err.message || err) }); continue; }
    for (const c of conns) {
      if (!c.path || !c.path.length || c.path.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z))) {
        out.badLane.push({ node: n.id, why: 'non-finite connection path' });
        break;
      }
    }
  }
  // Rendered cul-de-sac bulbs must not overlap any other pavement. buildNetwork demotes a bulb to a square stub
  // when it would (bulbCollides), so this list is empty on a well-formed network; it is the pixel-level guard
  // against a pile of overlapping rings that reads as junctions which do not exist.
  for (const n of net.nodes.values()) {
    if (n.arms.length !== 1 || !(n.arms[0].bulb > 0)) continue;
    const outer = n.arms[0].bulb + n.arms[0].sw;
    for (const m of net.nodes.values()) {
      if (m.id === n.id) continue;
      // the other node's rendered pavement: its plates, plus its own bulb if one is actually rendered
      let paved = 0;
      for (const a of m.arms) {
        paved = Math.max(paved, a.frame.w + a.frame.spec.sidewalk);
        if (a.bulb > 0) paved = Math.max(paved, a.bulb + a.sw);
      }
      if (Math.hypot(m.x - n.x, m.z - n.z) < outer + paved + 0.01) out.bulbOverlaps.push({ node: n.id, other: m.id });
    }
    for (const f of net.edges.values()) {
      if (f.a === n.id || f.b === n.id) continue;
      const reach = f.w + f.spec.sidewalk;
      if (pointSegDist(n.x, n.z, f.ax, f.az, f.bx, f.bz) < outer + reach + 0.01) out.bulbOverlaps.push({ node: n.id, edge: f.id });
    }
  }
  out.ok = !out.crossings.length && !out.overlaps.length && !out.nearNodes.length && !out.unsplitT.length
    && !out.orphans.length && !out.badCells.length && !out.badLane.length && !out.bulbOverlaps.length;
  return out;
}

/**
 * Mark every world cell the road footprint touches as 'road' (terrain then hides its studs there) and put the
 * terrain's own studs back on the part of those cells the footprint does not cover, so there are never studs
 * poking through plates nor bald green margins next to the sidewalks.
 */
function markFootprint(ctx, footprint, studs) {
  const world = ctx.world, cs = world.cellSize, W = world.size.w;
  const terr = ctx.modules.get('terrain');
  const tapi = terr?.status === 'ok' ? terr.api : null;
  const M = 0.3; // stud radius + margin
  const covered = new Set();
  const touched = new Map();
  const lkey = (kx, kz) => (kx + 8192) * 16384 + (kz + 8192);
  let studdable = (c) => c.type === 'none' || c.type === 'zone' || c.type === 'park';
  // scanline rasterisation on the stud lattice: for each lattice row take the polygon's crossings at z-M, z, z+M,
  // expand the inside intervals by M, and mark every lattice point in them (a point within M of the polygon)
  const tA = performance.now();
  const xs = [];
  for (const poly of footprint) {
    const pts = poly.pts, np = pts.length;
    let minz = Infinity, maxz = -Infinity;
    for (const p of pts) { minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); }
    const kz0 = Math.ceil((minz - M) / PITCH), kz1 = Math.floor((maxz + M) / PITCH);
    for (let kz = kz0; kz <= kz1; kz++) {
      const zr = kz * PITCH;
      for (const z of [zr - M, zr, zr + M]) {
        xs.length = 0;
        for (let i = 0, j = np - 1; i < np; j = i++) {
          const a = pts[i], b = pts[j];
          if ((a.z > z) !== (b.z > z)) xs.push(a.x + ((b.x - a.x) * (z - a.z)) / (b.z - a.z));
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p - q);
        for (let q = 0; q + 1 < xs.length; q += 2) {
          const kx0 = Math.ceil((xs[q] - M) / PITCH), kx1 = Math.floor((xs[q + 1] + M) / PITCH);
          for (let kx = kx0; kx <= kx1; kx++) {
            const key = lkey(kx, kz);
            if (covered.has(key)) continue;
            covered.add(key);
            const { i, j } = world.worldToCell(kx * PITCH + 1e-4, zr + 1e-4);
            if (!world.cellAt(i, j)) continue;
            const ck = j * W + i;
            if (!touched.has(ck)) touched.set(ck, poly.edgeId);
          }
        }
      }
    }
  }
  const tB = performance.now();
  // cells
  const marked = new Map();
  for (const [ck, eid] of touched) {
    const i = ck % W, j = (ck - i) / W;
    const c = world.cellAt(i, j);
    if (!c) continue;
    if (studdable(c)) world.setCell(i, j, { type: 'road', roadId: eid, zone: null, density: 0 });
    if (c.type === 'road') marked.set(ck, true);
  }
  for (const ck of S.marked.keys()) {
    if (marked.has(ck)) continue;
    const i = ck % W, j = (ck - i) / W;
    const c = world.cellAt(i, j);
    if (c && c.type === 'road') world.setCell(i, j, { type: 'none', roadId: null });
  }
  S.marked = marked;
  const tC = performance.now();
  // terrain studs on the uncovered lattice of the marked cells (+ their shared boundary points, which terrain drops)
  let added = 0;
  if (tapi && typeof tapi.surfaceHeight === 'function') {
    const E = 0.01;
    const emitted = new Set();
    const colorOf = new Map();
    const cellColor = (oi, oj) => {
      const k = oj * W + oi;
      let c = colorOf.get(k);
      if (c === undefined) { c = typeof tapi.plateColor === 'function' ? tapi.plateColor(oi, oj) : 'brightGreen'; colorOf.set(k, c); }
      return c;
    };
    // flat cells (all four vertices equal) need no per-point surface queries
    const flatH = (oi, oj) => {
      const h = world.getVertexHeight(oi, oj);
      return Math.abs(world.getVertexHeight(oi + 1, oj) - h) < 1e-4 && Math.abs(world.getVertexHeight(oi, oj + 1) - h) < 1e-4
        && Math.abs(world.getVertexHeight(oi + 1, oj + 1) - h) < 1e-4 ? h : null;
    };
    const flatCache = new Map();
    for (const ck of touched.keys()) {
      const i = ck % W, j = (ck - i) / W;
      const x0 = world.minX + i * cs, z0 = world.minZ + j * cs;
      for (let l = 0; l <= 10; l++) {
        for (let k = 0; k <= 10; k++) {
          const x = x0 + k * PITCH, z = z0 + l * PITCH;
          const key = lkey(Math.round(x / PITCH), Math.round(z / PITCH));
          if (covered.has(key) || emitted.has(key)) continue;
          emitted.add(key);
          const oi = i + (k === 10 ? 1 : 0), oj = j + (l === 10 ? 1 : 0);
          const oc = world.cellAt(oi, oj);
          if (!oc || oc.height < -0.01) continue;
          if (!(studdable(oc) || (oc.type === 'road' && marked.has(oj * W + oi)))) continue;
          const ok = oj * W + oi;
          let fh = flatCache.get(ok);
          if (fh === undefined) { fh = flatH(oi, oj); flatCache.set(ok, fh); }
          const interior = k > 0 && k < 10 && l > 0 && l < 10;
          let h;
          if (fh !== null && interior) h = fh;
          else {
            h = tapi.surfaceHeight(x + E, z + E);
            if (!Number.isFinite(h) || h < -13) continue;
            if (Math.abs(tapi.surfaceHeight(x - E, z + E) - h) > 1e-3 || Math.abs(tapi.surfaceHeight(x + E, z - E) - h) > 1e-3 || Math.abs(tapi.surfaceHeight(x - E, z - E) - h) > 1e-3) continue;
          }
          if (studs.push(x, h, z, cellColor(oi, oj), false)) added++; // lattice infill never overlaps plate studs
        }
      }
    }
  }
  S.fpTimes = { raster: tB - tA, cells: tC - tB, infill: performance.now() - tC };
  return { cells: marked.size, studs: added };
}

function rebuild() {
  const ctx = S.ctx;
  const t0 = performance.now();
  S.netDirty = true;
  const net = ensureNetwork();
  const tNet = performance.now() - t0;
  const groundAt = makeGroundFn(ctx);
  const B = {
    surface: new GeoAcc(), path: new GeoAcc(), curb: new GeoAcc(), sidewalk: new GeoAcc(), terrace: new GeoAcc(),
    white: new GeoAcc(), yellow: new GeoAcc(), studs: new StudList(16384), infill: new StudList(32768), footprint: [], groundAt,
  };
  B.verge = B.curb; // same material → same mesh
  for (const f of net.edges.values()) buildEdge(B, f, net.nodes);
  for (const n of net.nodes.values()) buildNode(B, n);
  const tGeo = performance.now() - t0 - tNet;
  const fp = markFootprint(ctx, B.footprint, B.infill);
  const tFp = performance.now() - t0 - tNet - tGeo;

  // swap meshes
  for (const m of S.meshes) { S.group.remove(m); m.geometry.dispose(); }
  S.meshes.length = 0;
  const M = S.mats;
  const specs = [
    ['surface', M.surface, { cast: false, receive: true }],
    ['path', M.path, { cast: false, receive: true }],
    ['curb', M.curb, { cast: true, receive: true }],
    ['sidewalk', M.sidewalk, { cast: true, receive: true }],
    ['terrace', M.terrace, { cast: true, receive: true }],
    ['white', M.white, { cast: false, receive: true }],
    ['yellow', M.yellow, { cast: false, receive: true }],
  ];
  let tris = 0;
  for (const [key, mat, o] of specs) {
    const g = B[key].build();
    if (!g) continue;
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = `roads-${key}`;
    mesh.castShadow = o.cast; mesh.receiveShadow = o.receive;
    mesh.frustumCulled = true;
    S.group.add(mesh);
    S.meshes.push(mesh);
    tris += g.index.count / 3;
  }
  S.studs.clear();
  S.studs.addAll(B.studs);
  if (S.extraStuds?.length) S.studs.addAll(S.extraStuds);
  S.studs.update(ctx.camera, true);
  S.infill.clear();
  S.infill.addAll(B.infill);
  S.infill.update(ctx.camera, true);
  S.studStats = { total: S.studs.total + S.infill.total, terrain: S.infill.total, rejected: B.studs.rejected };
  S.dirty = false;
  S.lastBuildMs = performance.now() - t0;
  S.breakdown = { network: tNet, geometry: tGeo, footprint: tFp, upload: S.lastBuildMs - tNet - tGeo - tFp };
  ctx.log(`[roads] rebuilt ${net.edges.size} edges / ${net.nodes.size} nodes: ${tris | 0} tris, ${S.studs.total} studs (${fp.studs} terrain infill, ${B.studs.rejected} overlaps rejected), ${fp.cells} cells in ${S.lastBuildMs.toFixed(1)} ms`);
}

async function makeMaterials(ctx) {
  let normalMap = null;
  try {
    const pbr = await ctx.assets.pbr('asphalt');
    normalMap = pbr?.normalMap || null;
  } catch (_) { normalMap = null; }
  const mats = {
    // a step darker than darkStoneGrey, glossy ABS: reads as a road plate at noon too. Higher clearcoat + a
    // stronger normal map break-up + a boosted envMapIntensity keep a visible sheen from the sky/PMREM env
    // even when the sun is straight overhead and throws no specular streak into frame (round 2 nit).
    surface: ctx.materials.plastic('#4A4E52', { roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.2, normalMap, normalScale: 0.35, envMapIntensity: 1.35 }),
    path: ctx.materials.plastic('tan', { roughness: 0.5, clearcoat: 0.3 }),
    curb: ctx.materials.plastic('mediumStoneGrey'),
    sidewalk: ctx.materials.plastic('lightStoneGrey'),
    terrace: ctx.materials.plastic('darkStoneGrey'),
    // markings slightly rougher than the plate so they read as print
    white: ctx.materials.plastic('white', { roughness: 0.5, clearcoat: 0.3 }),
    yellow: ctx.materials.plastic('brightYellow', { roughness: 0.5, clearcoat: 0.3 }),
  };
  // surface sits under the markings: push it back a hair so nothing z-fights at grazing angles; the print itself
  // is 2 cm above the surface, which can fall under depth precision at distance, so pull it toward the camera
  // with the opposite offset sign — otherwise lane lines shimmer as 1-pixel hairlines on the deck.
  mats.surface.polygonOffset = true; mats.surface.polygonOffsetFactor = 1; mats.surface.polygonOffsetUnits = 1;
  mats.path.polygonOffset = true; mats.path.polygonOffsetFactor = 1; mats.path.polygonOffsetUnits = 1;
  mats.white.polygonOffset = true; mats.white.polygonOffsetFactor = -1; mats.white.polygonOffsetUnits = -1;
  mats.yellow.polygonOffset = true; mats.yellow.polygonOffsetFactor = -1; mats.yellow.polygonOffsetUnits = -1;
  return mats;
}

/**
 * Instance-level guard for a core bug (see docs/core-requests/roads.md): World.removeRoad deletes orphaned nodes
 * before un-marking cells and throws, which breaks clearContent() → every showcase re-stage. We snapshot node
 * positions, call the original, and finish its job if it throws. No core file is modified.
 */
function guardRemoveRoad(world) {
  if (world.__roadsGuard) return;
  const orig = world.removeRoad;
  world.__roadsGuard = true;
  world.removeRoad = function (edgeId) {
    const edge = this.roads.edges.get(edgeId);
    if (!edge) return false;
    const na = this.roads.nodes.get(edge.a), nb = this.roads.nodes.get(edge.b);
    const snap = na && nb ? { ax: na.x, az: na.z, bx: nb.x, bz: nb.z } : null;
    try { return orig.call(this, edgeId); } catch (e) {
      if (!snap) return false;
      const dx = snap.bx - snap.ax, dz = snap.bz - snap.az;
      const len = Math.hypot(dx, dz) || 1;
      const steps = Math.max(1, Math.ceil(len / (this.cellSize * 0.5)));
      const half = edge.width / 2 - 0.01;
      const nx = -dz / len, nz = dx / len;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const cx = snap.ax + dx * t, cz = snap.az + dz * t;
        for (let o = -half; o <= half; o += this.cellSize * 0.5) {
          const { i, j } = this.worldToCell(cx + nx * o, cz + nz * o);
          const c = this.cellAt(i, j);
          if (c && c.roadId === edge.id) { c.type = 'none'; c.roadId = null; }
        }
      }
      this.events.emit('road:removed', { edgeId, edge });
      return true;
    }
  };
}

// ---- camera presets derived from the current network (variant-aware) --------------------------------

function netNodes() { try { return [...ensureNetwork().nodes.values()]; } catch (_) { return []; } }
function netEdges() { try { return [...ensureNetwork().edges.values()]; } catch (_) { return []; } }
function pickNode(score) {
  let best = null, bs = -Infinity;
  for (const n of netNodes()) { const s = score(n); if (s > bs) { bs = s; best = n; } }
  return best;
}
function fallbackCam(world) { return { pos: [92, world.getHeight(-14, -6) + 100, 128], target: [-14, world.getHeight(-14, -6), -6] }; }

const presets = {
  'roads:default': (world) => {
    const nodes = netNodes();
    if (!nodes.length) return fallbackCam(world);
    const pool = nodes.filter((n) => n.kind === 'intersection');
    const use = pool.length >= 2 ? pool : nodes;
    let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity, y = 0;
    for (const n of use) { minx = Math.min(minx, n.x); maxx = Math.max(maxx, n.x); minz = Math.min(minz, n.z); maxz = Math.max(maxz, n.z); y += n.y; }
    y /= use.length;
    const cx = (minx + maxx) / 2, cz = (minz + maxz) / 2;
    const span = Math.max(200, maxx - minx, maxz - minz);
    return { pos: [cx + span * 0.35, y + span * 0.33, cz + span * 0.45], target: [cx, y, cz] };
  },
  'roads:closeup': (world) => {
    const n = pickNode((n) => (n.arms.length >= 4 ? 10 : n.arms.length >= 3 ? 5 : 0) + (n.arms.some((a) => a.frame.kind === 'street') ? 2 : 0) - Math.hypot(n.x, n.z) / 1000);
    if (!n) return fallbackCam(world);
    const A = n.arms.find((a) => a.frame.kind === 'street') || n.arms[0];
    const d = 36;
    return { pos: [n.x + A.d.x * d + A.right.x * 2.2, n.y + 3.2, n.z + A.d.z * d + A.right.z * 2.2], target: [n.x - A.d.x * 2, n.y + 0.6, n.z - A.d.z * 2], fov: 45 };
  },
  'roads:intersection': (world) => {
    const n = pickNode((n) => (n.arms.length >= 4 ? 10 : n.arms.length >= 3 ? 5 : 0) + (n.arms.some((a) => a.frame.kind === 'avenue') ? 3 : 0) - Math.hypot(n.x, n.z) / 1000);
    if (!n) return fallbackCam(world);
    return { pos: [n.x + 16, n.y + 40, n.z + 24], target: [n.x, n.y, n.z] };
  },
  'roads:highway': (world) => {
    const edges = netEdges();
    if (!edges.length) return fallbackCam(world);
    const hw = edges.filter((f) => f.kind === 'highway');
    const pool = hw.length ? hw : edges;
    let f = pool[0];
    for (const e of pool) if (e.L > f.L) f = e;
    const s = f.L / 2;
    const mx = f.ax + f.d.x * s, mz = f.az + f.d.z * s, my = profileAt(f, s);
    return { pos: [mx - f.d.x * 174 - f.right.x * 47, my + 32, mz - f.d.z * 174 - f.right.z * 47], target: [mx, my + 1, mz], fov: 50 };
  },
  'roads:junction': (world) => {
    // The junction story: a 4-arm node with an avenue arm, framed so the corner fillets and the crosswalks read.
    const n = pickNode((v) => (v.arms.length >= 4 ? 10 : v.arms.length >= 3 ? 6 : 0)
      + (v.arms.some((a) => a.frame.kind === 'avenue') ? 3 : 0) - Math.hypot(v.x, v.z) / 2000);
    if (!n) return fallbackCam(world);
    return { pos: [n.x + 44, n.y + 34, n.z - 52], target: [n.x, n.y, n.z], fov: 46 };
  },
  'roads:oneway': () => ({ pos: [104, 74, 150], target: [0, 2, -6], fov: 46 }),
  'roads:oneway-close': () => ({ pos: [30, 11, -52], target: [-4, 0, -18], fov: 44 }),
  'roads:deadend': (world) => {
    const n = pickNode((n) => (n.kind === 'deadend' ? 10 : 0) + (n.arms[0]?.bulb > 0 ? 5 : 0) - Math.hypot(n.x, n.z) / 1000);
    if (!n) return fallbackCam(world);
    const A = n.arms[0];
    return { pos: [n.x - A.d.x * 30 + A.left.x * 28, n.y + 24, n.z - A.d.z * 30 + A.left.z * 28], target: [n.x + A.d.x * 10, n.y, n.z + A.d.z * 10] };
  },
};

const api = {
  /** Carriageway width in metres for a road kind. */
  roadWidth(kind) { return kindSpec(kind).width; },
  /** Total footprint width (carriageway + curbs + sidewalks/verges). */
  footprintWidth(kind) { const s = kindSpec(kind); return s.width + 2 * s.sidewalk; },
  lanesPerDirection(edgeId) { const f = ensureNetwork().edges.get(edgeId); return f ? lanesPerDirection(f) : 0; },
  edgeLength(edgeId) { const f = ensureNetwork().edges.get(edgeId); return f ? f.L : 0; },
  /** Points {x,y,z} along a lane centreline. laneIndex 0 = rightmost lane in travel direction. */
  getLanePath(edgeId, laneIndex = 0, direction = 'forward') {
    const f = ensureNetwork().edges.get(edgeId);
    if (!f) return [];
    return lanePath(f, laneIndex, direction).map((p) => ({ x: num(p.x), y: num(p.y), z: num(p.z) }));
  },
  getIntersections() {
    const net = ensureNetwork();
    const out = [];
    for (const n of net.nodes.values()) {
      out.push({
        nodeId: n.id, x: n.x, y: n.y + Y.lane, z: n.z, kind: n.kind, bend: n.arc ? { radius: n.arc.R, deflection: n.arc.theta } : null,
        arms: n.arms.map((a) => ({ edgeId: a.edgeId, angle: a.angle, outward: a.outward, trim: a.trim, lanes: lanesPerDirection(a.frame), kind: a.frame.kind, bulb: a.bulb })),
      });
    }
    return out;
  },
  /** Lane-to-lane connections through a node with drivable paths (right-hand traffic). One-way edges only
   * contribute/accept the directions their flow permits; a one-way dead end still gets its forced U-turn. */
  getLaneConnections(nodeId) {
    const net = ensureNetwork();
    const n = net.nodes.get(nodeId);
    if (!n) return [];
    const out = [];
    const y = n.y + Y.lane;
    for (const inArm of n.arms) {
      const fin = inArm.frame;
      const inDir = inArm.outward ? 'backward' : 'forward';
      if (!directionAllowed(fin, inDir)) continue;
      const nIn = lanesPerDirection(fin);
      const travel = { x: -inArm.d.x, z: -inArm.d.z };
      for (const outArm of n.arms) {
        const fout = outArm.frame;
        const outDir = outArm.outward ? 'forward' : 'backward';
        const sameArm = outArm === inArm;
        if (sameArm) { if (n.kind !== 'deadend') continue; }
        else if (!directionAllowed(fout, outDir)) continue;
        const nOut = lanesPerDirection(fout);
        const theta = turnAngle(travel, outArm.d);
        let turn = classifyTurn(theta);
        if (sameArm) turn = 'uturn';
        else if (n.kind === 'joint') turn = 'through';
        const pairs = [];
        if (turn === 'through') for (let k = 0; k < nIn; k++) pairs.push([k, Math.min(k, nOut - 1)]);
        else if (turn === 'right') pairs.push([0, 0]);
        else pairs.push([nIn - 1, nOut - 1]);
        for (const [li, lo] of pairs) {
          const pIn = lanePath(fin, li, inDir);
          const pOut = lanePath(fout, lo, outDir);
          if (!pIn.length || !pOut.length) continue;
          const p0 = pIn[pIn.length - 1], p3 = pOut[0];
          const laneLat = laneOffsetsFor(fin, inDir)[Math.min(li, nIn - 1)];
          const path = n.arc && turn === 'through'
            ? arcLanePath(n, inArm, laneLat, y, 10)
            : turnCurve(p0, travel, p3, outArm.d, y, turn === 'through' ? 4 : 8);
          out.push({
            from: { edgeId: fin.id, lane: li, direction: inDir },
            to: { edgeId: fout.id, lane: lo, direction: outDir },
            turn, angle: theta, path,
          });
        }
      }
    }
    return out;
  },
  /**
   * Nearest existing road NODE (junction, bend or dead end) a player could be aiming at, i.e. the node whose
   * paved plate the click is on or near. The radius is the node's own footprint — the largest arm's
   * carriageway + sidewalk, or a street dead end's cul-de-sac bulb — plus one grid cell of pad. This is what
   * makes a second street drawn toward the same spot join the first junction instead of growing another
   * overlapping dead-end bulb. Returns { nodeId, x, y, z, dist, kind, radius } or null.
   */
  snapToNode(x, z, maxDist = 21) {
    const net = ensureNetwork();
    let best = null;
    for (const n of net.nodes.values()) {
      let paved = 0;
      for (const a of n.arms) {
        paved = Math.max(paved, a.w + a.sw);
        // a demoted bulb (rendered as a square stub because it would overlap a neighbour) is still a street end
        // for snapping: the player aiming near it means "join this end", so use the spec bulb radius regardless.
        const bulb = a.frame.spec.bulb > 0 ? Math.max(a.w + 0.5, a.frame.spec.bulb) : 0;
        if (n.kind === 'deadend' && bulb > 0) paved = Math.max(paved, bulb + a.sw);
      }
      const r = Math.min(maxDist, paved + NODE_SNAP_PAD);
      const d = Math.hypot(n.x - x, n.z - z);
      if (d <= r && (!best || d < best.dist)) best = { nodeId: n.id, x: num(n.x), y: num(n.y) + Y.lane, z: num(n.z), dist: d, kind: n.kind, radius: r };
    }
    return best;
  },
  /** Nearest point on a road centreline, with road-surface height. Null when there are no roads. */
  snapToRoad(x, z, maxDist = Infinity) {
    const net = ensureNetwork();
    let best = null;
    for (const f of net.edges.values()) {
      const dx = f.bx - f.ax, dz = f.bz - f.az;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - f.ax) * dx + (z - f.az) * dz) / l2;
      t = Math.min(1, Math.max(0, t));
      const px = f.ax + dx * t, pz = f.az + dz * t;
      const d = Math.hypot(px - x, pz - z);
      if (d <= maxDist && (!best || d < best.dist)) best = { x: px, z: pz, dist: d, edgeId: f.id, t, s: t * f.L, f };
    }
    if (!best) return null;
    const y = num(profileAt(best.f, best.s)) + Y.lane;
    return { x: num(best.x), y, z: num(best.z), edgeId: best.edgeId, t: best.t, s: best.s, dist: best.dist };
  },
  /** Road-surface height near (x,z) (falls back to terrain + 0.16). */
  heightAt(x, z) {
    const s = api.snapToRoad(x, z, 24);
    if (s) return s.y;
    return num(S.ctx?.world.getHeight(x, z)) + Y.lane;
  },
  getNetwork() { return ensureNetwork(); },
  /** Read-only network invariant audit; every list must be empty (see auditNetwork / tools/road-audit.mjs). */
  audit() { return auditNetwork(S.ctx.world); },
  lastBuildMs() { return S.lastBuildMs; },
  buildBreakdown() { return { ...S.breakdown, ...S.fpTimes }; },
  studStats() { return { ...S.studStats }; },
  rebuild() { rebuild(); },
};

export default {
  id: 'roads',
  deps: TERRAIN_PRESENT ? ['terrain'] : [],
  order: 30,
  api,
  showcaseVariants: ['default', 'intersection', 'highway', 'junction', 'oneway'],
  presets,

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('roads');
    guardRemoveRoad(ctx.world);
    S.group = new THREE.Group();
    S.group.name = 'roads';
    ctx.scene.add(S.group);
    S.mats = await makeMaterials(ctx);
    S.studs = new StudField(ctx.materials, { capacity: 80000, radius: 260 });
    S.group.add(S.studs.mesh);
    // terrain studs put back on the uncovered part of road cells: culled like the terrain's own studs (170 m)
    S.infill = new StudField(ctx.materials, { capacity: 80000, radius: 150 });
    S.infill.mesh.name = 'roads-infill-studs';
    S.group.add(S.infill.mesh);
    const bump = () => markDirty();
    S.unsub.push(ctx.events.on('road:added', bump));
    S.unsub.push(ctx.events.on('road:removed', bump));
    // in-place edits (upgrade/downgrade/one-way conversion) keep the edge id but change its cross-section
    S.unsub.push(ctx.events.on('road:changed', bump));
    S.unsub.push(ctx.events.on('terrain:changed', bump));
    rebuild();
  },

  update(dt, ctx) {
    if (S.dirty && performance.now() - S.lastEvent > 30) rebuild();
    S.studs.update(ctx.camera);
    S.infill.update(ctx.camera);
  },

  async showcase(ctx, variant = 'default') {
    if (S.fallbackGround) { S.group.remove(S.fallbackGround); S.fallbackGround.geometry.dispose(); S.fallbackGround = null; }
    if (S.lots) { S.group.remove(S.lots); S.lots.geometry.dispose(); S.lots = null; }
    S.marked.clear(); // clearContent() already reset every cell
    stageTerrain(ctx);
    stageNetwork(ctx, variant);
    const staged = stageLots(ctx, S.group, variant);
    S.extraStuds = staged.studs;
    S.lots = staged.mesh;
    if (ctx.modules.get('terrain')?.status !== 'ok') {
      S.fallbackGround = buildFallbackGround(ctx);
      S.group.add(S.fallbackGround);
    }
    rebuild();
  },

  dispose(ctx) {
    for (const u of S.unsub) { try { u(); } catch (_) { /* ignore */ } }
    S.unsub.length = 0;
    for (const m of S.meshes) m.geometry.dispose();
    S.meshes.length = 0;
    S.studs?.dispose();
    S.infill?.dispose();
    if (S.fallbackGround) S.fallbackGround.geometry.dispose();
    if (S.lots) S.lots.geometry.dispose();
    if (S.group) ctx.scene.remove(S.group);
    S.group = null; S.net = null; S.fallbackGround = null; S.lots = null; S.marked.clear();
  },
};
