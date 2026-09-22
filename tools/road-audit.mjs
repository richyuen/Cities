#!/usr/bin/env node
// Road-network quality harness (integrator-owned). Opens the full game, fingerprints the road network, then runs
// scripted road gestures — the exact shapes a player draws — and asserts the junction contract after each one:
//
//   1. drawing a road that ends on another road creates a shared junction (no dead-end bulb / cul-de-sac stub);
//   2. drawing a road across another road splits both at a shared node (no unconnected overlap);
//   3. endpoints near an existing node join it instead of creating a near-duplicate node;
//   4. a bridge stays at-grade-exempt (no junction appears on the deck);
//   5. a path stays legacy (a pedestrian alley never splits a street);
//   6. removing the drawn road heals the network back to its exact previous geometry and cell ownership;
//   7. roads.api.audit() stays clean (crossings, band overlaps, near nodes, orphans, stale cells, bad lanes);
//   8. the whole gesture sequence is deterministic across two fresh page loads.
//
// Usage:  node tools/road-audit.mjs [--seed 1] [--verbose]
// Exit code 1 if any check fails. The dev server must be running on http://127.0.0.1:5173.

import { openApp, buildUrl } from './shot.mjs';

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const SEED = arg('seed', '1');
const VERBOSE = argv.includes('--verbose');

/** Runs in the page: snapshots, gestures, invariants. Returns a trace + per-check results. */
async function pageSuite() {
  const ctx = window.__city.ctx;
  const world = ctx.world;
  const R = world.roads;
  const api = ctx.modules.get('roads').api;

  const fnv = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  /** Id-independent fingerprint: positions, connectivity, kinds and cell ownership (owner by geometry). */
  const geomHash = () => {
    const nodes = [...R.nodes.values()].map((n) => `${n.x.toFixed(2)},${n.z.toFixed(2)}`).sort().join('|');
    const edgeSig = (e) => {
      const a = R.nodes.get(e.a), b = R.nodes.get(e.b);
      if (!a || !b) return '?';
      const p = [`${a.x.toFixed(2)},${a.z.toFixed(2)}`, `${b.x.toFixed(2)},${b.z.toFixed(2)}`].sort().join('~');
      return `${p}:${e.kind}:${e.width}:${e.bridge ? 1 : 0}`;
    };
    const edges = [...R.edges.values()].map(edgeSig).sort().join('|');
    // The round-trip fingerprint covers the road network only. Paved cells are deliberately NOT hashed: drawing
    // a road over a building/zone converts that land permanently (the same way it would in-game), so undoing the
    // road cannot and should not restore the original land use.
    return fnv(`${nodes}#${edges}`);
  };
  const counts = () => ({ nodes: R.nodes.size, edges: R.edges.size });
  const roadCellCount = () => { let n = 0; for (const c of world.cells) if (c.type === 'road') n++; return n; };
  /** The roads group rebuilds its geometry on a ~30 ms debounce; wait for that so snapshots see the steady state
   * the player sees a frame later, not the raw core mutations mid-edit. */
  const settle = async () => {
    await new Promise((r) => setTimeout(r, 90));
    try { await window.__city.frames(2); } catch (_) { /* ignore */ }
  };
  const auditCounts = async () => {
    await settle();
    const a = api.audit();
    return {
      ok: a.ok,
      crossings: a.crossings.length, overlaps: a.overlaps.length, nearNodes: a.nearNodes.length,
      unsplitT: a.unsplitT.length, orphans: a.orphans.length, badCells: a.badCells.length, badLane: a.badLane.length,
      bulbOverlaps: a.bulbOverlaps.length,
    };
  };
  const findEdge = (pred) => {
    for (const e of R.edges.values()) {
      const a = R.nodes.get(e.a), b = R.nodes.get(e.b);
      if (!a || !b) continue;
      const L = Math.hypot(b.x - a.x, b.z - a.z);
      if (pred(e, a, b, L)) return { e, a, b, L };
    }
    return null;
  };
  const nodeAt = (x, z, tol = 0.6) => [...R.nodes.values()].find((n) => Math.hypot(n.x - x, n.z - z) <= tol) || null;
  const edgeIds = () => new Set(R.edges.keys());
  const newIds = (before) => [...R.edges.keys()].filter((id) => !before.has(id));
  const endpointEdge = (x, z) => {
    const n = nodeAt(x, z);
    if (!n || !n.edges.length) return null;
    return R.edges.get(n.edges[0]) || null;
  };
  const removeEdgeAt = (x, z) => {
    const e = endpointEdge(x, z);
    if (e) world.removeRoad(e.id);
    return e ? e.id : null;
  };
  /** How many at-grade vehicle edges (other than skipId) the segment A-B crosses in its interior. */
  const crossingCount = (A, B, skipId) => {
    let count = 0;
    const ax = B.x - A.x, az = B.z - A.z;
    for (const e of R.edges.values()) {
      if (e.bridge || e.kind === 'path' || e.id === skipId) continue;
      const p = R.nodes.get(e.a), q = R.nodes.get(e.b);
      if (!p || !q) continue;
      const ex = q.x - p.x, ez = q.z - p.z;
      const den = ax * ez - az * ex;
      if (Math.abs(den) < 1e-9) continue;
      const qx = p.x - A.x, qz = p.z - A.z;
      const t = (qx * ez - qz * ex) / den, u = (qx * az - qz * ax) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) count++;
    }
    return count;
  };
  /** True when an existing node sits within tol of the segment's interior (would become a route-through junction). */
  const nodeNearSegment = (A, B, tol) => {
    const dx = B.x - A.x, dz = B.z - A.z, l2 = dx * dx + dz * dz;
    if (!(l2 > 1e-12)) return false;
    for (const n of R.nodes.values()) {
      const t = ((n.x - A.x) * dx + (n.z - A.z) * dz) / l2;
      if (t <= 1e-6 || t >= 1 - 1e-6) continue;
      if (Math.hypot(A.x + dx * t - n.x, A.z + dz * t - n.z) <= tol) return true;
    }
    return false;
  };

  const checks = [];
  const trace = [];
  const check = (name, pass, detail) => { checks.push({ name, pass: !!pass, detail }); };
  const auditClean = async (label) => {
    const a = await auditCounts();
    check(`${label}: audit clean`, a.ok, a);
    return a;
  };
  await settle();
  const baseline = { hash: geomHash(), counts: counts(), roadCells: roadCellCount(), audit: await auditClean('baseline') };
  trace.push(baseline.hash);

  const roundTrip = async (label) => {
    await settle();
    const after = { hash: geomHash(), counts: counts(), roadCells: roadCellCount(), audit: await auditCounts() };
    check(`${label}: geometry restored`, after.hash === baseline.hash, { baseline: baseline.hash, after: after.hash, counts: after.counts, audit: after.audit });
    check(`${label}: no road cells lost`, after.roadCells >= baseline.roadCells, { baseline: baseline.roadCells, after: after.roadCells });
    trace.push(after.hash);
    return after;
  };

  // ---- 1. T-junction: draw a street into the middle of an existing street -------------------------------
  let t = null;
  {
    const target = findEdge((e, a, b, L) => e.kind === 'street' && L > 120 && Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) > 400);
    if (!target) { check('T: found a target street', false, null); } else {
      const mx = (target.a.x + target.b.x) / 2, mz = (target.a.z + target.b.z) / 2;
      const dx = (target.b.x - target.a.x) / target.L, dz = (target.b.z - target.a.z) / target.L;
      const nx = -dz, nz = dx;
      const far = { x: mx + nx * 56, z: mz + nz * 56 };
      const before = edgeIds();
      const beforeNodes = R.nodes.size;
      const eid = world.addRoad({ x: mx, z: mz }, far, 'street', { snapNodes: true });
      const n = nodeAt(mx, mz);
      const conns = n ? api.getLaneConnections(n.id) : [];
      const added = newIds(before);
      t = { targetId: target.e.id, far };
      check('T: road created', !!eid, { eid, added: added.length });
      check('T: target edge split', !R.edges.has(target.e.id), { target: target.e.id });
      check('T: junction node has 3 arms', n && n.edges.length === 3, { node: n && n.id, degree: n && n.edges.length });
      check('T: lane connections exist', conns.length >= 4, { conns: conns.length, turns: [...new Set(conns.map((c) => c.turn))] });
      check('T: two new nodes (junction + far endpoint)', R.nodes.size === beforeNodes + 2, { added: R.nodes.size - beforeNodes });
      await auditClean('T');
      // undo: remove the stem at its far endpoint; healing merges the two halves
      check('T: undo removed the stem', !!removeEdgeAt(far.x, far.z), null);
      await roundTrip('T');
    }
  }

  // ---- 2. X crossing: draw a street straight across an avenue ------------------------------------------
  {
    const target = findEdge((e, a, b, L) => e.kind === 'avenue' && L > 80);
    let placed = null;
    if (!target) { check('X: found a target avenue', false, null); } else {
      for (let k = 1; k <= 8 && !placed; k++) {
        const tt = k / 9;
        const mx = target.a.x + (target.b.x - target.a.x) * tt, mz = target.a.z + (target.b.z - target.a.z) * tt;
        const dx = (target.b.x - target.a.x) / target.L, dz = (target.b.z - target.a.z) / target.L;
        const nx = -dz, nz = dx;
        const A = { x: mx - nx * 30, z: mz - nz * 30 }, B = { x: mx + nx * 30, z: mz + nz * 30 };
        if (world.roadOverlapBlocked(A, B, 'street')) continue; // runs alongside an alley/branch here — try elsewhere
        if (crossingCount(A, B, target.e.id) !== 0 || nodeNearSegment(A, B, 4)) continue; // single junction only
        placed = { A, B, mx, mz };
      }
      check('X: found an allowed crossing spot', !!placed, null);
    }
    if (placed) {
      const before = edgeIds();
      const beforeNodes = R.nodes.size;
      const { A, B, mx, mz } = placed;
      const eid = world.addRoad(A, B, 'street', { snapNodes: true });
      const n = nodeAt(mx, mz);
      const conns = n ? api.getLaneConnections(n.id) : [];
      check('X: road created', !!eid, { eid });
      check('X: target avenue split', !R.edges.has(target.e.id), { target: target.e.id });
      check('X: junction has 4 arms', n && n.edges.length === 4, { node: n && n.id, degree: n && n.edges.length });
      check('X: lane connections exist', conns.length >= 8, { conns: conns.length });
      check('X: three new nodes (junction + both endpoints)', R.nodes.size === beforeNodes + 3, { added: R.nodes.size - beforeNodes });
      await auditClean('X');
      check('X: undo removed both arms', !!removeEdgeAt(A.x, A.z) && !!removeEdgeAt(B.x, B.z), null);
      await roundTrip('X');
    }
  }

  // ---- 2b. Diagonal crossing: the same contract at a non-90-degree angle -------------------------------
  {
    const target = findEdge((e, a, b, L) => e.kind === 'avenue' && L > 80);
    let placed = null;
    if (target) {
      const dx = (target.b.x - target.a.x) / target.L, dz = (target.b.z - target.a.z) / target.L;
      const ca = Math.cos(0.52), sa = Math.sin(0.52); // ~30 deg off the perpendicular
      const cx = -dz * ca - dx * sa, cz = -dz * sa + dx * ca;
      // Only a spot whose segment crosses the one avenue: an extra crossing would be a second junction
      // (legitimate, but the undo below only removes this road's two end arms).
      for (let k = 1; k <= 8 && !placed; k++) {
        const tt = k / 9;
        const mx = target.a.x + (target.b.x - target.a.x) * tt, mz = target.a.z + (target.b.z - target.a.z) * tt;
        const A = { x: mx - cx * 32, z: mz - cz * 32 }, B = { x: mx + cx * 32, z: mz + cz * 32 };
        if (world.roadOverlapBlocked(A, B, 'street')) continue;
        if (crossingCount(A, B, target.e.id) !== 0) continue;
        if (nodeNearSegment(A, B, 4)) continue;
        placed = { A, B, mx, mz };
      }
    }
    if (!placed) { check('diagonal: found an allowed crossing spot', false, null); } else {
      const beforeNodes = R.nodes.size;
      const eid = world.addRoad(placed.A, placed.B, 'street', { snapNodes: true });
      const n = nodeAt(placed.mx, placed.mz);
      check('diagonal: road created', !!eid, { eid });
      check('diagonal: 4-arm junction', n && n.edges.length === 4, { degree: n && n.edges.length });
      check('diagonal: three new nodes', R.nodes.size === beforeNodes + 3, { added: R.nodes.size - beforeNodes });
      await auditClean('diagonal');
      removeEdgeAt(placed.A.x, placed.A.z); removeEdgeAt(placed.B.x, placed.B.z);
      await roundTrip('diagonal');
    }
  }

  // ---- 3. Endpoint near an existing node joins it (no near-duplicate node) ------------------------------
  {
    const junction = [...R.nodes.values()].find((n) => n.edges.length >= 3 && Math.hypot(n.x, n.z) > 200);
    if (!junction) { check('near-node: found a junction', false, null); } else {
      const beforeNodes = R.nodes.size;
      const degBefore = junction.edges.length;
      const A = { x: junction.x + 2.5, z: junction.z + 2.5 };   // 45 deg off the junction: not parallel to its arms
      const B = { x: junction.x + 44, z: junction.z + 44 };
      const eid = world.addRoad(A, B, 'street', { snapNodes: true });
      const holders = [...R.nodes.values()].filter((nn) => Math.hypot(nn.x - junction.x, nn.z - junction.z) <= 3);
      check('near-node: snap joined the existing node', holders.length === 1 && holders[0].id === junction.id, { junction: junction.id, holders: holders.map((h) => h.id) });
      check('near-node: only the far endpoint is new', R.nodes.size === beforeNodes + 1, { added: R.nodes.size - beforeNodes });
      check('near-node: junction degree grew by 1', junction.edges.length === degBefore + 1, { before: degBefore, after: junction.edges.length });
      await auditClean('near-node');
      if (eid) world.removeRoad(eid);
      await roundTrip('near-node');
    }
  }

  // ---- 4. Route through an existing node (interactive snapNodes) ----------------------------------------
  {
    const junction = [...R.nodes.values()].find((n) => n.edges.length >= 3 && Math.hypot(n.x, n.z) > 250);
    if (!junction) { check('route-node: found a junction', false, null); } else {
      const degBefore = junction.edges.length;
      const a = { x: junction.x + 24, z: junction.z - 24 };
      const b = { x: junction.x - 24, z: junction.z + 24 };
      const eid = world.addRoad(a, b, 'street', { snapNodes: true });
      check('route-node: road created', !!eid, { eid });
      check('route-node: joined the existing node', junction.edges.length === degBefore + 2, { before: degBefore, after: junction.edges.length });
      await auditClean('route-node');
      removeEdgeAt(a.x, a.z); removeEdgeAt(b.x, b.z);
      await roundTrip('route-node');
    }
  }

  // ---- 5. Parallel duplication guard (unchanged contract) -----------------------------------------------
  {
    const target = findEdge((e, a, b, L) => e.kind === 'street' && L > 80);
    if (!target) { check('overlap guard: target found', false, null); } else {
      const dx = (target.b.x - target.a.x) / target.L, dz = (target.b.z - target.a.z) / target.L;
      const nx = -dz, nz = dx;
      const copy = (off) => ({ a: { x: target.a.x + nx * off, z: target.a.z + nz * off }, b: { x: target.b.x + nx * off, z: target.b.z + nz * off } });
      const near = copy(3), far = copy(12);
      const nearBlocked = world.roadOverlapBlocked(near.a, near.b, 'street');
      const farBlocked = world.roadOverlapBlocked(far.a, far.b, 'street');
      const nearAdd = world.addRoad(near.a, near.b, 'street', { snapNodes: true });
      check('overlap guard: 3 m copy blocked', nearBlocked && !nearAdd, { nearBlocked, nearAdd });
      check('overlap guard: 12 m copy allowed', !farBlocked, { farBlocked });
      if (nearAdd) { world.removeRoad(nearAdd); }
      await roundTrip('overlap guard');
    }
  }

  // ---- 5b. Player endpoint snap: a drag starting one grid cell (8 m) past a dead end stitches ---------------
  {
    let anchor = null;
    for (const cand of [[-304, 696], [-304, 656], [304, 696], [-704, 656], [704, 696], [-304, 296], [304, 296], [0, 696]]) {
      if (world.getHeight(cand[0], cand[1]) < 1) continue;
      if (api.snapToRoad(cand[0], cand[1], 80)) continue; // too close to an existing road
      anchor = { x: cand[0], z: cand[1] };
      break;
    }
    if (!anchor) { check('tool snap: found open land', false, null); } else {
      const A0 = { x: anchor.x - 48, z: anchor.z }, A1 = { x: anchor.x, z: anchor.z };
      const aid = world.addRoad(A0, A1, 'street', { snapNodes: true });
      const end = nodeAt(A1.x, A1.z, 0.6);
      const raw = { x: A1.x + 8, z: A1.z }; // exactly one grid cell past the end, where grid snap would land
      const p = api.snapToNode(raw.x, raw.z);
      check('tool snap: a point one cell past a dead end snaps to the end node', !!p && Math.hypot(p.x - A1.x, p.z - A1.z) < 0.01,
        { snap: p && [+p.x.toFixed(2), +p.z.toFixed(2)], radius: p && +p.radius.toFixed(1) });
      const diag = { x: A1.x + 16, z: A1.z + 8 }; // the 2-cell diagonal lattice point (17.9 m), the common miss
      const p2 = api.snapToNode(diag.x, diag.z);
      check('tool snap: the 2-cell diagonal lattice point also snaps to the end node', !!p2 && Math.hypot(p2.x - A1.x, p2.z - A1.z) < 0.01,
        { snap: p2 && [+p2.x.toFixed(2), +p2.z.toFixed(2)], radius: p2 && +p2.radius.toFixed(1) });
      const bid = world.addRoad(p ? { x: p.x, z: p.z } : raw, { x: A1.x + 56, z: A1.z }, 'street', { snapNodes: true });
      check('tool snap: the second street shares the dead end', !!end && end.edges.length === 2, { degree: end && end.edges.length, aid, bid });
      await auditClean('tool snap');
      if (bid) world.removeRoad(bid);
      if (aid) world.removeRoad(aid);
      await roundTrip('tool snap');
    }
  }

  // ---- 6. Bridge stays at-grade-exempt: a bridge crossing a street must not split it --------------------
  {
    const target = findEdge((e, a, b, L) => e.kind === 'street' && L > 120 && Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) > 300);
    if (!target) { check('bridge: target found', false, null); } else {
      const mx = (target.a.x + target.b.x) / 2, mz = (target.a.z + target.b.z) / 2;
      const dx = (target.b.x - target.a.x) / target.L, dz = (target.b.z - target.a.z) / target.L;
      const nx = -dz, nz = dx;
      const A = { x: mx - nx * 40, z: mz - nz * 40 }, B = { x: mx + nx * 40, z: mz + nz * 40 };
      const eid = world.addRoad(A, B, 'street', { bridge: true, snapNodes: true });
      check('bridge: road created', !!eid, { eid });
      check('bridge: target not split', R.edges.has(target.e.id), { target: target.e.id });
      check('bridge: no junction node at the crossing', !nodeAt(mx, mz), null);
      await auditClean('bridge');
      if (eid) world.removeRoad(eid);
      await roundTrip('bridge');
    }
  }

  // ---- 7. Path stays legacy: a pedestrian alley never splits a street -----------------------------------
  {
    const target = findEdge((e, a, b, L) => e.kind === 'street' && L > 100);
    if (!target) { check('path: target found', false, null); } else {
      const mx = (target.a.x + target.b.x) / 2, mz = (target.a.z + target.b.z) / 2;
      const dx = (target.b.x - target.a.x) / target.L, dz = (target.b.z - target.a.z) / target.L;
      const nx = -dz, nz = dx;
      const eid = world.addRoad({ x: mx + nx * 20, z: mz + nz * 20 }, { x: mx + nx * 60, z: mz + nz * 20 }, 'path');
      check('path: target not split', R.edges.has(target.e.id), { target: target.e.id });
      check('path: no junction at the alley end', !nodeAt(mx, mz), null);
      if (eid) world.removeRoad(eid);
      await roundTrip('path');;
    }
  }

  // ---- 8. Bulldozing one arm of a crossing leaves the other road's cells owned and intact ---------------
  {
    const target = findEdge((e, a, b, L) => e.kind === 'street' && L > 100 && Math.hypot((a.x + b.x) / 2, (a.z + b.z) / 2) > 300);
    let placed = null;
    if (target) {
      for (let k = 1; k <= 8 && !placed; k++) {
        const tt = k / 9;
        const mx = target.a.x + (target.b.x - target.a.x) * tt, mz = target.a.z + (target.b.z - target.a.z) * tt;
        const dx = (target.b.x - target.a.x) / target.L, dz = (target.b.z - target.a.z) / target.L;
        const nx = -dz, nz = dx;
        const A = { x: mx - nx * 26, z: mz - nz * 26 }, B = { x: mx + nx * 26, z: mz + nz * 26 };
        if (world.roadOverlapBlocked(A, B, 'street')) continue;
        if (crossingCount(A, B, target.e.id) !== 0 || nodeNearSegment(A, B, 4)) continue;
        placed = { A, B, mx, mz };
      }
    }
    if (!placed) { check('bulldoze: found a crossing spot', false, null); } else {
      const eid = world.addRoad(placed.A, placed.B, 'street', { snapNodes: true });
      const cell = world.cellAtWorld(placed.mx, placed.mz);
      const ownerBefore = cell && cell.roadId;
      removeEdgeAt(placed.A.x, placed.A.z); // one arm of the crossing street
      const c2 = world.cellAtWorld(placed.mx, placed.mz);
      check('bulldoze: crossing cell still owned by a live edge', c2 && c2.type === 'road' && !!c2.roadId && !!R.edges.get(c2.roadId), {
        before: ownerBefore, after: c2 && c2.roadId, type: c2 && c2.type,
      });
      await auditClean('bulldoze');
      removeEdgeAt(placed.B.x, placed.B.z);
      if (eid && R.edges.has(eid)) world.removeRoad(eid);
      await roundTrip('bulldoze');
    }
  }

  // ---- 8b. Player cluster: short streets drawn toward one spot share junctions, never stack bulbs ----------
  {
    const cs = world.cellSize;
    const gridSnap = (p) => ({ x: world.minX + Math.round((p.x - world.minX) / cs) * cs, z: world.minZ + Math.round((p.z - world.minZ) / cs) * cs });
    let anchor = null;
    for (const cand of [[-300, 620], [-300, 660], [300, 620], [-700, 620], [700, 620], [-300, 900], [300, 900]]) {
      if (world.getHeight(cand[0], cand[1]) < 1) continue;
      if (api.snapToRoad(cand[0], cand[1], 90)) continue; // too close to an existing road
      anchor = { x: cand[0], z: cand[1] };
      break;
    }
    if (!anchor) { check('cluster: found open land', false, null); } else {
      const C = anchor;
      // the tool's endpoint snap chain: node first (footprint radius), then centreline, then the 8 m grid
      const snapLikeTool = (x, z) => {
        const n = api.snapToNode(x, z);
        if (n) return { x: n.x, z: n.z };
        const s = api.snapToRoad(x, z, 6);
        return s ? { x: s.x, z: s.z } : gridSnap({ x, z });
      };
      let created = 0;
      for (const [ox, oz] of [[0, 8], [-8, 0], [0, -8], [8, 0], [8, 8]]) {
        const raw = { x: C.x + ox, z: C.z + oz };
        const L = Math.hypot(ox, oz) || 1;
        const start = { x: raw.x + (ox / L) * 56, z: raw.z + (oz / L) * 56 };
        const p = snapLikeTool(raw.x, raw.z);
        if (world.addRoad(p, start, 'street', { snapNodes: true })) created++;
      }
      const near = [...R.nodes.values()].filter((n) => Math.hypot(n.x - C.x, n.z - C.z) < 20);
      const deadEnds = near.filter((n) => n.edges.length === 1);
      // At most one street may still be a dead end near the meeting point; the rest must share junction nodes.
      // (Their bulbs are additionally checked globally by audit.bulbOverlaps, so no fake rings can remain.)
      check('cluster: streets share junctions instead of stacking dead ends', created >= 4 && deadEnds.length <= 1,
        { created, nodes: near.map((n) => [n.id, n.edges.length]) });
      await auditClean('cluster');
    }
  }

  // ---- 9. Save/load replay: the menu load path clears the world and re-adds every edge ---------------
  {
    const serialized = [...R.edges.values()].map((e) => {
      const a = R.nodes.get(e.a), b = R.nodes.get(e.b);
      return { a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, kind: e.kind, bridge: !!e.bridge };
    });
    const beforeHash = geomHash();
    world.clearContent();
    for (const r of serialized) world.addRoad(r.a, r.b, r.kind, { bridge: r.bridge });
    await settle();
    const a = await auditCounts();
    check('save/load: edge replay restores the road network', geomHash() === beforeHash, { before: beforeHash, after: geomHash(), counts: counts() });
    check('save/load: audit clean', a.ok, a);
    trace.push(geomHash());
  }

  return { checks, trace, baseline: { counts: baseline.counts, hash: baseline.hash } };
}

const app = await openApp({ seed: SEED });
let suite;
try {
  suite = await app.page.evaluate(pageSuite);
} finally {
  await app.close();
}

// Determinism: repeat on a fresh load and compare the trace.
const app2 = await openApp({ seed: SEED });
let suite2;
try {
  suite2 = await app2.page.evaluate(pageSuite);
} finally {
  await app2.close();
}

const failed = suite.checks.filter((c) => !c.pass);
const determinism = JSON.stringify(suite.trace) === JSON.stringify(suite2.trace);
for (const c of suite.checks) {
  const mark = c.pass ? 'ok  ' : 'FAIL';
  console.log(`[${mark}] ${c.name}${VERBOSE || !c.pass ? ` ${JSON.stringify(c.detail)}` : ''}`);
}
console.log(`[${determinism ? 'ok  ' : 'FAIL'}] determinism: two fresh loads produced identical gesture traces`);
console.log(`baseline: ${suite.baseline.counts.nodes} nodes / ${suite.baseline.counts.edges} edges, hash ${suite.baseline.hash}`);
console.log(`${suite.checks.length - failed.length}/${suite.checks.length} checks passed${determinism ? '' : ' (+1 determinism failed)'}`);
if (failed.length || !determinism) process.exit(1);
