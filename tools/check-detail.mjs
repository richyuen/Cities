#!/usr/bin/env node
// Functional check for LOOP cycle 2 — the props diorama detail layer (yards, civic entrance clusters, pedestrians),
// including the fix-round assertions (floaters, fence interpenetration, pre-C2 prop stability, restated gate).
//   node tools/check-detail.mjs
// Part 1 — full game (seed 1) via tools/shot.mjs's openApp:
//   1. cross-boot determinism — the prop-kind census hashes identically on a fresh reload (same seed);
//   2. yard dressing exists in the 1-6 m band around sampled house/apartment/shop lots;
//   3. every school/hospital/fire/police has >= 2 non-figure props + >= 1 figure within 14 m of its +z entrance;
//   4. figures exist along the core `street` preset's avenue corridor;
//   5. no C2-owned prop sits inside a building footprint or on a carriageway, no C2 prop floats more than 0.5 m
//      above its resolved surface, and no two fence panels are closer than 2.0 m;
//   6. every capture reports errors: []; the props module's own draw-call count is printed and asserted <= 300
//      (the ARCHITECTURE §7 gate is the module's OWN draw calls — full city and the yards scene; a batch's scene
//      total includes buildings/terrain/CSM and is not the props gate).
// Part 2 — `?noc2=1` (C2 pass disabled): the pre-existing (non-C2) prop census must be byte-identical to the
//   C2-on boot's, which proves the detail layer never reseeds existing trees/signs/flower beds (fix round issue 2).
// Part 3 — `?showcase=props&variant=yards`: the props module's own draws stay <= 300 there too, C2 dressing is
//   present, no C2 placement violations, and every capture is error-free.
// Writes shots/props/c2/{summary.json,yard-house.png,civic-entrance.png,street-figures.png,yards-showcase.png}.
// Exit 1 on any failed check.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';

const OUT = path.join('shots', 'props', 'c2');
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// Mirrors populate.js's C2 yard band: a prop counts for a lot when its Chebyshev distance outside the footprint
// is 0.5-7.0 m (the module targets 1-6 m; the band is a little wider on both sides so the check is about intent,
// not exact placement) and it is within 14 m of the footprint centre.
const YARD_KINDS = ['fence_picket', 'garden_bed', 'laundry_line', 'picnic_table', 'crate_stack', 'bike'];
const C2_KINDS = [...YARD_KINDS, 'figure'];
const CIVIC_KINDS = ['school', 'hospital', 'fire_department', 'police_station'];

const censusInPage = () => `(() => {
  const c = window.__city;
  const world = c.world;
  const st = c.ctx.modules.get('props').api.stats();
  const byKind = st.byKind;
  const bKinds = {};
  for (const b of world.buildings.values()) bKinds[b.kind] = (bKinds[b.kind] || 0) + 1;
  const zones = {};
  for (const b of world.buildings.values()) zones[b.zone || ''] = (zones[b.zone || ''] || 0) + 1;
  return {
    propsTotal: st.count, byKind, propsDraws: st.drawCalls, c2Props: st.c2Props, detailMs: st.detailMs,
    detailSettle: st.detailSettle,
    figures: st.figures, yardProps: st.yardProps, detailedBuildings: st.detailedBuildings, figureCap: st.figureCap,
    buildings: world.buildings.size, buildingKinds: bKinds, zones, edges: world.roads.edges.size,
    stats: { draws: c.stats().drawCalls, gpuMs: c.stats().gpuMs, triangles: c.stats().triangles, errors: c.stats().errors },
  };
})()`;

function censusHash(census) {
  let h = 0x811c9dc5;
  const mix = (s) => { for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193); } };
  const kinds = Object.entries(census.byKind).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [k, n] of kinds) mix(`${k}:${n}|`);
  mix(`total:${census.propsTotal}`);
  const bk = Object.entries(census.buildingKinds).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [k, n] of bk) mix(`b:${k}:${n}|`);
  mix(`edges:${census.edges}`);
  return (h >>> 0).toString(16);
}

/** FNV hash of every non-C2 prop's full render-relevant state (id first: ids drive per-instance variation). */
const preC2HashInPage = (withC2) => `(() => {
  const world = window.__city.world;
  let h = 0x811c9dc5;
  const mix = (s) => { for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193); } };
  const rows = [];
  for (const p of world.props.values()) {
    const c2 = typeof p.id === 'string' && p.id.startsWith('c2p:');
    if (c2 !== ${withC2}) continue;
    rows.push(p.id + '|' + p.kind + '|' + p.x.toFixed(3) + '|' + p.y.toFixed(3) + '|' + p.z.toFixed(3) + '|' + (p.rot || 0).toFixed(3));
  }
  rows.sort();
  for (const r of rows) mix(r);
  return { hash: (h >>> 0).toString(16), count: rows.length };
})()`;

const app = await openApp({ seed: 1, tod: 12, hud: 0 });
const { page } = app;
const captureErrors = [];
let bootA = null, bootB = null, preOn = null, preOff = null;
try {
  await page.evaluate(() => window.__city.frames(90));
  bootA = await page.evaluate(censusInPage());
  preOn = await page.evaluate(preC2HashInPage(false));
  check(bootA.propsTotal > 0 && bootA.buildings > 0, `full game booted with content (${bootA.buildings} buildings, ${bootA.propsTotal} props)`);
  check(bootA.c2Props > 0, `C2 dressing present (${bootA.c2Props} C2-owned props of ${bootA.propsTotal})`);

  // ---- 2. yard dressing around sampled lots ---------------------------------------------------------------
  const yard = await page.evaluate((yardKinds) => {
    const c = window.__city;
    const world = c.world;
    const cs = world.cellSize;
    const isYard = new Set(yardKinds);
    const lots = [...world.buildings.values()].filter((b) => b.kind === 'house' || b.kind === 'apartment' || b.kind === 'shop');
    const stride = Math.max(1, Math.floor(lots.length / 20));
    const sample = lots.filter((_, i) => i % stride === 0).slice(0, 20);
    const rows = [];
    for (const b of sample) {
      const cx = world.minX + (b.i + b.w / 2) * cs, cz = world.minZ + (b.j + b.d / 2) * cs;
      const halfW = b.w * cs / 2, halfD = b.d * cs / 2;
      let n = 0;
      const byKind = {};
      for (const p of world.props.values()) {
        if (!isYard.has(p.kind)) continue;
        const dx = Math.max(Math.abs(p.x - cx) - halfW, 0), dz = Math.max(Math.abs(p.z - cz) - halfD, 0);
        const band = Math.max(dx, dz);
        if (band >= 0.5 && band <= 7.0 && Math.hypot(p.x - cx, p.z - cz) < 14) { n++; byKind[p.kind] = (byKind[p.kind] || 0) + 1; }
      }
      rows.push({ id: b.id, kind: b.kind, x: +cx.toFixed(1), z: +cz.toFixed(1), items: n, byKind });
    }
    return { lots: lots.length, sampled: sample.length, withItems: rows.filter((r) => r.items > 0).length, rows };
  }, YARD_KINDS);
  check(yard.lots > 0, `city has house/apartment/shop lots (${yard.lots})`);
  check(yard.sampled >= 10, `sampled ${yard.sampled} lots for yard dressing`);
  check(yard.withItems === yard.sampled, `every sampled lot has yard dressing in its 1-6 m band (${yard.withItems}/${yard.sampled})`);
  const yardMin = Math.min(...yard.rows.map((r) => r.items));
  check(yardMin >= 1, `minimum yard items on a sampled lot: ${yardMin} (per-lot range ${yardMin}-${Math.max(...yard.rows.map((r) => r.items))})`);

  // ---- 3. civic entrance clusters -------------------------------------------------------------------------
  const civic = await page.evaluate((civicKinds) => {
    const c = window.__city;
    const world = c.world;
    const cs = world.cellSize;
    const rows = [];
    for (const b of world.buildings.values()) {
      if (!civicKinds.includes(b.kind)) continue;
      const cx = world.minX + (b.i + b.w / 2) * cs, ez = world.minZ + (b.j + b.d) * cs; // +z entrance face
      let cluster = 0, figures = 0;
      for (const p of world.props.values()) {
        if (Math.hypot(p.x - cx, p.z - ez) >= 14) continue;
        if (p.kind === 'figure') figures++; else cluster++;
      }
      rows.push({ id: b.id, kind: b.kind, x: +cx.toFixed(1), z: +ez.toFixed(1), cluster, figures });
    }
    return rows;
  }, CIVIC_KINDS);
  check(civic.length >= 8, `found civic buildings to check (${civic.length})`);
  const civicBad = civic.filter((r) => r.cluster < 2);
  check(civicBad.length === 0, `every civic has >= 2 entrance props within 14 m (${civic.length - civicBad.length}/${civic.length}; min cluster ${Math.min(...civic.map((r) => r.cluster))})`);
  const civicNoFigs = civic.filter((r) => r.figures < 1);
  check(civicNoFigs.length === 0, `every civic entrance has >= 1 figure (${civic.length - civicNoFigs.length}/${civic.length}; min figures ${Math.min(...civic.map((r) => r.figures))})`);

  // ---- 4. figures along the street preset's avenue --------------------------------------------------------
  await app.stage({ preset: 'street', tod: 12 });
  const street = await page.evaluate(() => {
    const c = window.__city;
    const world = c.world;
    c.setCamera('street');
    const eye = c.ctx.camera.position.clone();
    const tgt = c.ctx.controls.target.clone();
    const dx = tgt.x - eye.x, dz = tgt.z - eye.z;
    const l2 = dx * dx + dz * dz || 1;
    let figs = 0, props = 0, dists = [];
    for (const p of world.props.values()) {
      let t = ((p.x - eye.x) * dx + (p.z - eye.z) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = eye.x + dx * t, pz = eye.z + dz * t;
      const d = Math.hypot(p.x - px, p.z - pz);
      if (d < 45 && Math.hypot(p.x - eye.x, p.z - eye.z) < 130) {
        props++;
        if (p.kind === 'figure') { figs++; dists.push(+Math.hypot(p.x - eye.x, p.z - eye.z).toFixed(1)); }
      }
    }
    return { eye: [+eye.x.toFixed(1), +eye.y.toFixed(1), +eye.z.toFixed(1)], figs, props, dists: dists.sort((a, b) => a - b) };
  });
  check(street.figs >= 4, `figures along the street preset's avenue corridor: ${street.figs} (nearest ${street.dists[0] ?? '-'} m) of ${street.props} props in frame`);
  captureErrors.push(...(await app.capture(path.join(OUT, 'street-figures.png'), { settle: 25, sampleMs: 500 })).errors);

  // ---- 5a. carriageway / footprint violations (all props; C2 must be zero) --------------------------------
  const viol = await page.evaluate((c2Kinds) => {
    const c = window.__city;
    const world = c.world;
    const roads = c.ctx.modules.get('roads').api;
    const cs = world.cellSize;
    const c2 = new Set(c2Kinds);
    const byKind = {}, c2Rows = [];
    const bList = [...world.buildings.values()];
    for (const p of world.props.values()) {
      let bad = null;
      for (const b of bList) {
        const minX = world.minX + b.i * cs, maxX = minX + b.w * cs;
        const minZ = world.minZ + b.j * cs, maxZ = minZ + b.d * cs;
        if (p.x > minX + 0.25 && p.x < maxX - 0.25 && p.z > minZ + 0.25 && p.z < maxZ - 0.25) { bad = `building:${b.kind}`; break; }
      }
      if (!bad) {
        const s = roads.snapToRoad(p.x, p.z, 24);
        if (s) {
          const edge = world.roads.edges.get(s.edgeId);
          if (s.dist < roads.roadWidth(edge?.kind) / 2 - 0.05) bad = `road:${edge?.kind}`;
        }
      }
      if (bad) {
        byKind[p.kind] = (byKind[p.kind] || 0) + 1;
        if (c2.has(p.kind) && c2Rows.length < 20) c2Rows.push(`${p.kind} ${bad} @${p.x.toFixed(1)},${p.z.toFixed(1)}`);
      }
    }
    return { byKind, c2Rows, c2Count: c2Rows.length, total: Object.values(byKind).reduce((a, b) => a + b, 0) };
  }, C2_KINDS);
  check(viol.c2Count === 0, `no C2-owned prop sits in a building footprint or on a carriageway (${viol.c2Count} violations)`);
  check(Object.keys(viol.byKind).every((k) => !C2_KINDS.includes(k)), `C2 kinds absent from the violation census (${JSON.stringify(viol.byKind)})`);

  // ---- 5b. floaters/burials: every C2 prop on the *rendered* surface (fix rounds 1+2, non-tautological) ----
  // The expected surface is re-derived here, independently of the props module's resolveHeight(): the public
  // roads probe + footprintWidth decide whether a road plate exists under the point (scanning every edge, not
  // just the nearest), the public terrain surface is the fallback, and a prop under a raised deck's terrace
  // skirt is a burial. A deterministic mesh-truth raycast sample on top asserts the same thing against the
  // actual rendered terrain/roads meshes.
  const float = await page.evaluate((threshold) => {
    const c = window.__city;
    const world = c.world;
    const roads = c.ctx.modules.get('roads')?.api;
    const terrain = c.ctx.modules.get('terrain')?.api;
    const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    const project = (a, b, x, z) => {
      const dx = b.x - a.x, dz = b.z - a.z;
      const l2 = dx * dx + dz * dz;
      const t = clamp01(l2 > 1e-12 ? ((x - a.x) * dx + (z - a.z) * dz) / l2 : 0);
      const px = a.x + dx * t - x, pz = a.z + dz * t - z;
      return { t, lateral: Math.hypot(px, pz) };
    };
    // Rendered surface at (x,z): a road/sidewalk plate when ANY road footprint covers the point (a narrow path's
    // centreline may be nearer than the wide road whose plate is actually under the point), else the terrain.
    const surfaceAt = (x, z) => {
      const s = roads?.snapToRoad?.(x, z, 24);
      if (s) {
        const fp = roads.footprintWidth(world.roads.edges.get(s.edgeId)?.kind) / 2;
        if (s.dist <= fp) return { y: s.y + 0.19, src: 'road' };
      }
      let best = null;
      for (const e of world.roads.edges.values()) {
        const a = world.roads.nodes.get(e.a), b = world.roads.nodes.get(e.b);
        if (!a || !b) continue;
        const pr = project(a, b, x, z);
        const fp = roads.footprintWidth(e.kind) / 2;
        if (pr.lateral > fp) continue;
        const score = pr.lateral / Math.max(0.1, fp);
        if (!best || score < best.score) best = { a, b, pr };
      }
      if (best) {
        const px = best.a.x + (best.b.x - best.a.x) * best.pr.t;
        const pz = best.a.z + (best.b.z - best.a.z) * best.pr.t;
        const s2 = roads?.snapToRoad?.(px, pz, 3);
        if (s2) return { y: s2.y + 0.19, src: 'road' };
      }
      const h = terrain?.surfaceHeight?.(x, z);
      if (Number.isFinite(h)) return { y: h, src: 'terrain' };
      return { y: world.getHeight(x, z), src: 'heightfield' };
    };
    // Terrace-cover: outside every footprint, terrain below the stepped skirt of a raised deck (0.4 m per 0.8 m).
    const coveredBySkirt = (x, z, ground) => {
      for (const e of world.roads.edges.values()) {
        const a = world.roads.nodes.get(e.a), b = world.roads.nodes.get(e.b);
        if (!a || !b) continue;
        const pr = project(a, b, x, z);
        const fp = roads.footprintWidth(e.kind) / 2;
        if (pr.lateral <= fp) return false;
        const outside = pr.lateral - fp;
        if (outside > 11.2) continue;
        const steps = Math.ceil(outside / 0.8);
        const px = a.x + (b.x - a.x) * pr.t, pz = a.z + (b.z - a.z) * pr.t;
        const s = roads?.snapToRoad?.(px, pz, 3);
        if (!s) continue;
        const plate = s.y + 0.35;
        if (plate - ground <= 0.4) continue;
        if (ground < plate - 0.4 * steps - 0.1) return true;
      }
      return false;
    };
    let n = 0, over = 0, under = 0, worstOver = 0, worstUnder = 0, skirt = 0;
    const legacy = { n: 0, over: 0, under: 0 };
    const rows = [];
    const skirtRows = [];
    for (const p of world.props.values()) {
      const isC2 = typeof p.id === 'string' && p.id.startsWith('c2p:');
      const surf = surfaceAt(p.x, p.z);
      const gap = p.y - surf.y;
      if (!isC2) {
        legacy.n++;
        if (gap > 0.5) legacy.over++;
        if (gap < -0.5) legacy.under++;
        continue;
      }
      n++;
      if (gap > threshold) { over++; if (gap > worstOver) worstOver = gap; }
      if (gap < -threshold) { under++; if (gap < worstUnder) worstUnder = gap; }
      if (skirtCoversSafe(p)) {
        skirt++;
        if (skirtRows.length < 8) skirtRows.push(`${p.kind} @${p.x.toFixed(1)},${p.z.toFixed(1)} y=${p.y.toFixed(2)}`);
      }
      if (Math.abs(gap) > threshold && rows.length < 12) {
        rows.push(`${p.kind} @${p.x.toFixed(1)},${p.z.toFixed(1)} gap ${gap.toFixed(2)} (${surf.src})`);
      }
    }
    function skirtCoversSafe(p) { return coveredBySkirt(p.x, p.z, terrain?.surfaceHeight?.(p.x, p.z) ?? world.getHeight(p.x, p.z)); }
    return {
      n, over, under, skirt, threshold,
      worstOver: +worstOver.toFixed(2), worstUnder: +worstUnder.toFixed(2),
      legacy, rows, skirtRows,
    };
  }, 0.35);
  check(float.over === 0, `no C2 prop sits > 0.35 m above its rendered surface (${float.over} of ${float.n}; worst +${float.worstOver} m)`);
  check(float.under === 0, `no C2 prop sits > 0.35 m below its rendered surface (${float.under} of ${float.n}; worst ${float.worstUnder} m)`);
  check(float.skirt === 0, `no C2 prop is buried under a raised deck's terrace skirt (${float.skirt})`);
  if (float.skirtRows.length) console.log(float.skirtRows.join('\n'));
  console.log(`[check-detail] C2 surface gaps (API-derived): over ${float.over}, under ${float.under}, max +${float.worstOver}/-${float.worstUnder} m of ${float.n}; legacy (non-C2) >0.5 m: ${float.legacy.over} over / ${float.legacy.under} under of ${float.legacy.n}`);
  if (float.rows.length) console.log(float.rows.join('\n'));

  // Mesh-truth sample: raycast down from a deterministic sample of C2 props onto the rendered terrain/roads
  // meshes (studs and the props group excluded) — this is the actual visible surface, not a model of it.
  const meshTruth = await page.evaluate(() => {
    const THREE = window.__city.THREE;
    const c = window.__city;
    const scene = c.ctx.scene;
    const targets = [];
    for (const name of ['terrain', 'roads']) {
      const g = scene.getObjectByName(name);
      if (g) g.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && !/stud/i.test(o.name)) targets.push(o); });
    }
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const origin = new THREE.Vector3();
    const props = [...c.world.props.values()].filter((p) => typeof p.id === 'string' && p.id.startsWith('c2p:'));
    const step = Math.max(1, Math.floor(props.length / 150));
    let n = 0, over = 0, under = 0, maxGap = 0, minGap = 0, miss = 0;
    const rows = [];
    for (let i = 0; i < props.length; i += step) {
      const p = props[i];
      origin.set(p.x, p.y + 60, p.z);
      ray.set(origin, down);
      const hits = ray.intersectObjects(targets, false);
      if (!hits.length) { miss++; continue; }
      const gap = p.y - hits[0].point.y;
      n++;
      if (gap > maxGap) maxGap = gap;
      if (gap < minGap) minGap = gap;
      if (gap > 0.35) over++;
      if (gap < -0.35) under++;
      if (Math.abs(gap) > 0.35 && rows.length < 8) rows.push(`${p.kind} @${p.x.toFixed(1)},${p.z.toFixed(1)} gap ${gap.toFixed(2)} on ${hits[0].object.name}`);
    }
    return { n, over, under, maxGap: +maxGap.toFixed(2), minGap: +minGap.toFixed(2), miss, rows };
  });
  check(meshTruth.over === 0 && meshTruth.under === 0,
    `mesh-truth sample: no sampled C2 prop is > 0.35 m off the rendered mesh (${meshTruth.over} over / ${meshTruth.under} under of ${meshTruth.n}; range ${meshTruth.minGap}..+${meshTruth.maxGap} m)`);
  console.log(`[check-detail] mesh-truth raycast sample: ${meshTruth.n} C2 props, range ${meshTruth.minGap}..+${meshTruth.maxGap} m, ${meshTruth.over} over / ${meshTruth.under} under, ${meshTruth.miss} no-hit`);
  if (meshTruth.rows.length) console.log(meshTruth.rows.join('\n'));

  // ---- 5c. fence panels never interpenetrate (fix round issue 3) ------------------------------------------
  const fence = await page.evaluate(() => {
    const world = window.__city.world;
    const fences = [];
    for (const p of world.props.values()) if (p.kind === 'fence_picket') fences.push(p);
    const cell = 2.5;
    const grid = new Map();
    const key = (ix, iz) => `${ix}:${iz}`;
    for (const p of fences) {
      const k = key(Math.floor(p.x / cell), Math.floor(p.z / cell));
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    }
    let min = Infinity, under2 = 0, under202 = 0;
    const seen = new Set();
    for (const p of fences) {
      const ix = Math.floor(p.x / cell), iz = Math.floor(p.z / cell);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        for (const q of grid.get(key(ix + dx, iz + dz)) || []) {
          const pair = p.id < q.id ? `${p.id}|${q.id}` : `${q.id}|${p.id}`;
          if (p === q || seen.has(pair)) continue;
          seen.add(pair);
          const d = Math.hypot(p.x - q.x, p.z - q.z);
          if (d < min) min = d;
          if (d < 2.0) under2++;
          if (d < 2.02 - 1e-9) under202++;
        }
      }
    }
    return { total: fences.length, min: Math.round(min * 1000) / 1000, under2, under202 };
  });
  check(fence.under2 === 0, `no fence pair closer than 2.0 m (${fence.under2} of ${fence.total}; minimum ${fence.min} m)`);
  check(fence.under202 === 0, `fence separation floor 2.02 m respected (${fence.under202} pairs below it)`);

  // ---- 6. bounds + props draw calls (restated gate) -------------------------------------------------------
  check(bootA.figures <= bootA.figureCap, `figures ${bootA.figures} within the ${bootA.figureCap} cap`);
  check(bootA.figures >= 150, `enough figures across the city (${bootA.figures})`);
  check(bootA.yardProps >= 500, `yard props across the city (${bootA.yardProps})`);
  check(bootA.detailedBuildings >= 100, `yard-dressed buildings (${bootA.detailedBuildings})`);
  check(bootA.propsTotal <= 9000, `total props ${bootA.propsTotal} <= 9000 (no runaway duplication)`);
  check(bootA.propsDraws <= 300, `props module's OWN draw calls ${bootA.propsDraws} <= 300 (ARCHITECTURE §7; the batch scene total includes other modules)`);
  check(bootA.stats.errors.length === 0, `no console errors on the census boot (${bootA.stats.errors.length})`);
  console.log(`[check-detail] props own draw calls = ${bootA.propsDraws} (gate <= 300, full city); props total = ${bootA.propsTotal}; C2 props = ${bootA.c2Props}`);
  console.log(`[check-detail] detailMs = ${bootA.detailMs} ms, settleDetail = ${JSON.stringify(bootA.detailSettle)}; figures = ${bootA.figures}; yard props = ${bootA.yardProps}`);
  console.log(`[check-detail] props by kind: ${JSON.stringify(bootA.byKind)}`);
  console.log(`[check-detail] legacy (non-C2) footprint/carriageway offenders: ${viol.total} ${JSON.stringify(viol.byKind)}`);

  // idempotency: a second populateYard() call for an already-dressed building adds nothing
  const idem = await page.evaluate(() => {
    const c = window.__city;
    const api = c.ctx.modules.get('props').api;
    const b = [...c.world.buildings.values()].find((x) => x.kind === 'house' || x.kind === 'apartment' || x.kind === 'shop');
    const again = api.populateYard(b.id);
    return { id: b.id, kind: b.kind, again: again.length };
  });
  check(idem.again === 0, `populateYard() is idempotent for an already-dressed building (${idem.kind} ${idem.id}: +${idem.again} props)`);

  // ---- captures: yard closeup + civic entrance ------------------------------------------------------------
  const shotAt = async (name, x, z, eyeOff, targetOff) => {
    await page.evaluate(({ x, z, eyeOff, targetOff }) => {
      const c = window.__city;
      const y = c.world.getHeight(x, z);
      c.setCamera({ pos: [x + eyeOff[0], y + eyeOff[1], z + eyeOff[2]], target: [x + targetOff[0], y + targetOff[1], z + targetOff[2]], fov: 45 });
    }, { x, z, eyeOff, targetOff });
    await app.stage({ tod: 12 });
    captureErrors.push(...(await app.capture(path.join(OUT, name), { settle: 20, sampleMs: 400 })).errors);
  };
  const yardPick = yard.rows.reduce((a, r) => (r.items > a.items ? r : a), yard.rows[0]);
  await shotAt('yard-house.png', yardPick.x, yardPick.z, [10, 4.0, 14], [0, 1.3, -1]);
  const civicPick = civic.find((r) => r.kind === 'school') || civic[0];
  await shotAt('civic-entrance.png', civicPick.x, civicPick.z, [10, 5.0, 14], [0, 2.0, 0]);

  // ---- 1. cross-boot determinism --------------------------------------------------------------------------
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__city && window.__city.ready === true, { timeout: 90000, polling: 100 });
  await page.evaluate(() => window.__city.frames(90));
  bootB = await page.evaluate(censusInPage());
  const hashA = censusHash(bootA), hashB = censusHash(bootB);
  check(hashA === hashB, `cross-boot determinism: prop-kind census hash ${hashA} == ${hashB} on reload`);
  check(bootB.propsTotal === bootA.propsTotal && bootB.buildings === bootA.buildings,
    `reload reproduces the same counts (props ${bootB.propsTotal}/${bootA.propsTotal}, buildings ${bootB.buildings}/${bootA.buildings})`);
  check(bootB.stats.errors.length === 0, `no console errors on the reload boot (${bootB.stats.errors.length})`);
  check(captureErrors.length === 0, `browser captures report no errors (${captureErrors.length})`);
  if (captureErrors.length) console.log(captureErrors.join('\n'));
} finally {
  await app.close();
}

// ---- Part 2: pre-existing (non-C2) props are untouched by the C2 layer ------------------------------------
{
  const app2 = await openApp({ seed: 1, tod: 12, hud: 0, extra: { noc2: '1' } });
  try {
    await app2.page.evaluate(() => window.__city.frames(90));
    const censusOff = await app2.page.evaluate(censusInPage());
    preOff = await app2.page.evaluate(preC2HashInPage(false));
    const c2Off = await app2.page.evaluate(preC2HashInPage(true));
    check(c2Off.count === 0, `?noc2=1 disables the C2 pass (${c2Off.count} C2 props)`);
    check(preOff.hash === preOn.hash && preOff.count === preOn.count,
      `pre-C2 props are byte-identical with and without the C2 layer (hash ${preOff.hash} == ${preOn.hash}, ${preOff.count} props)`);
    check(censusOff.byKind.streetlamp === bootA.byKind.streetlamp && censusOff.byKind.traffic_light === bootA.byKind.traffic_light,
      `existing street furniture counts unchanged (streetlamp ${censusOff.byKind.streetlamp}, traffic_light ${censusOff.byKind.traffic_light})`);
    check(censusOff.stats.errors.length === 0, `no console errors on the ?noc2=1 boot (${censusOff.stats.errors.length})`);
  } finally {
    await app2.close();
  }
}

// ---- Part 3: props' own draws in the yards showcase + captured evidence -------------------------------------
{
  const app3 = await openApp({ showcase: 'props', variant: 'yards', seed: 1, tod: 12, hud: 0 });
  try {
    await app3.page.evaluate(() => window.__city.frames(60));
    const ys = await app3.page.evaluate(censusInPage());
    check(ys.propsDraws <= 300, `yards showcase: props module's OWN draw calls ${ys.propsDraws} <= 300 (scene total ${ys.stats.draws} includes buildings/terrain/CSM)`);
    check(ys.c2Props > 100, `yards showcase stages C2 dressing (${ys.c2Props} C2 props of ${ys.propsTotal})`);
    const ysViol = await app3.page.evaluate(() => {
      const world = window.__city.world;
      const roads = window.__city.ctx.modules.get('roads').api;
      let n = 0;
      for (const p of world.props.values()) {
        if (typeof p.id !== 'string' || !p.id.startsWith('c2p:')) continue;
        const s = roads.snapToRoad(p.x, p.z, 24);
        if (!s) continue;
        const edge = world.roads.edges.get(s.edgeId);
        if (s.dist < roads.roadWidth(edge?.kind) / 2 - 0.05) n++;
      }
      return n;
    });
    check(ysViol === 0, `yards showcase: 0 C2 props on a carriageway (${ysViol})`);
    await app3.stage({ preset: 'props:yards', tod: 12 });
    const log = await app3.capture(path.join(OUT, 'yards-showcase.png'), { settle: 20, sampleMs: 400 });
    check(log.errors.length === 0, `yards showcase capture reports no errors (${log.errors.length})`);
    if (log.errors.length) console.log(log.errors.join('\n'));
    console.log(`[check-detail] yards showcase: props own draws = ${ys.propsDraws}, scene draws = ${ys.stats.draws}, C2 props = ${ys.c2Props}`);
  } finally {
    await app3.close();
  }
}

const summary = {
  ok: failed === 0, failed, checks: results.length, results,
  census: bootA, censusReload: bootB, censusHash: bootA ? censusHash(bootA) : null,
  preC2: { withC2: preOn, withoutC2: preOff },
  captureErrors,
  gate: 'props module OWN draw calls <= 300 (full city and yards scene); batch scene totals include other modules',
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n[check-detail] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
