#!/usr/bin/env node
// Functional check for the people layer: every figure is a full minifig, pedestrians walk their sidewalk and
// everybody else animates in place (src/props/people.js), stop riders are minifigs drawn by props for transit.
//   node tools/check-people.mjs
// Full game, seed 1. Animation time is set directly (props.api.peopleSetTime) instead of rendering minutes of
// frames, so the walk is sampled at exact times. Writes shots/people/*.png and shots/people/check.json.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';

const OUT = 'shots/people';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

const app = await openApp({ seed: 1 });
const { page } = app;
try {
  await page.evaluate(() => window.__city.frames(120));
  await page.evaluate(() => { window.__city.pause(); window.__city.resetPresentation(); return window.__city.frames(3); });

  // ---- 1. the model -----------------------------------------------------------------------------------------
  const model = await page.evaluate(() => {
    const C = window.__city.ctx;
    const props = C.modules.get('props').api;
    const need = { 'sp-hip': 1, 'sp-leg': 2, 'sp-torso': 1, 'sp-head': 1, 'sp-arm': 2, 'sp-print': 2 };
    let n = 0, bad = 0, minH = Infinity, maxH = -Infinity;
    const badIds = [];
    for (const p of C.world.props.values()) {
      if (p.kind !== 'figure') continue;
      n++;
      const parts = props.getPropParts(p.id);
      const count = {};
      let top = -Infinity;
      for (const pt of parts) { count[pt.role] = (count[pt.role] || 0) + 1; top = Math.max(top, pt.center[1] + pt.size[1] / 2); }
      const h = top - p.y;
      minH = Math.min(minH, h); maxH = Math.max(maxH, h);
      const ok = Object.entries(need).every(([r, k]) => count[r] === k) && (count['sp-hair'] === 1 || count['sp-cap'] === 1) && h >= 1.5 && h <= 1.85;
      if (!ok) { bad++; if (badIds.length < 5) badIds.push({ id: p.id, count, h }); }
    }
    const old = [];
    C.scene.traverse((o) => { if (o.name && o.name.startsWith('props-figure-')) old.push(o.name); });
    return { n, bad, badIds, minH, maxH, old, stats: props.peopleStats(), propStats: props.stats() };
  });
  check(model.n > 0 && model.bad === 0, `every plain figure is a full minifig: hip, 2 legs, torso, head, 2 arms, face + torso print, hair or cap (${model.n} figures, ${model.bad} short${model.bad ? ' ' + JSON.stringify(model.badIds) : ''})`);
  check(model.minH >= 1.5 && model.maxH <= 1.85, `figures stand ${model.minH.toFixed(2)}-${model.maxH.toFixed(2)} m tall`);
  check(model.old.length === 0, `the 3-box figure meshes are gone (${model.old.join(', ') || 'none left'})`);
  check(model.stats.walkers >= 30, `sidewalk pedestrians have beats to walk (${model.stats.walkers} walkers of ${model.stats.figures} figures)`);

  // ---- 3. time 0 = everybody at their record ----------------------------------------------------------------
  const home = await page.evaluate(() => {
    const C = window.__city.ctx;
    const props = C.modules.get('props').api;
    let worst = 0;
    for (const f of props.people()) {
      if (f.guest) continue;
      const p = C.world.props.get(f.id);
      worst = Math.max(worst, Math.hypot(f.x - p.x, f.y - p.y, f.z - p.z));
    }
    return { worst, time: props.peopleStats().time };
  });
  check(home.time === 0 && home.worst < 1e-3, `after resetPresentation() every figure is drawn at its record (time ${home.time}, worst offset ${home.worst.toExponential(1)} m)`);

  // ---- 8. the authored set-piece figures are untouched at time 0, and alive after it ---------------------------
  const sp = await page.evaluate(async () => {
    const C = window.__city.ctx;
    const props = C.modules.get('props').api;
    const kinds = new Set(['figure_cap', 'figure_std', 'figure_farmer', 'figure_work', 'figure_sit', 'figure_skater']);
    const figs = [...C.world.props.values()].filter((p) => kinds.has(p.kind));
    if (!figs.length) return { n: 0 };
    // look at the first set-piece from close by, so the distance fade is 1 and the buffers hold plain poses
    const f0 = figs[0];
    window.__city.setCamera({ pos: [f0.x + 14, f0.y + 9, f0.z + 14], target: [f0.x, f0.y + 1, f0.z], fov: 45 });
    await window.__city.frames(3);
    const near = figs.filter((p) => Math.hypot(p.x - f0.x, p.z - f0.z) < 60);
    const drawn = (id) => props.getPropInstances(id).map(({ role, k }) => {
      const a = C.scene.getObjectByName(`props-${role}`).instanceMatrix.array;
      return Array.from(a.subarray(k * 16, k * 16 + 16));
    });
    let exact = 0;
    const base = new Map();
    for (const p of near) {
      const parts = props.getPropParts(p.id), d = drawn(p.id);
      // 32-bit instance buffer against the 64-bit baked matrix
      const same = parts.length === d.length && parts.every((pt, i) => pt.matrix.every((v, j) => Math.fround(v) === d[i][j]));
      if (same) exact++;
      base.set(p.id, parts.map((pt) => pt.matrix));
    }
    props.peopleSetTime(7.3);
    let moved = 0, rootsFixed = 0;
    for (const p of near) {
      const parts = props.getPropParts(p.id), b = base.get(p.id);
      if (parts.some((pt, i) => pt.matrix.some((v, j) => Math.abs(v - b[i][j]) > 1e-4))) moved++;
      const at = props.getDrawnPosition(p.id);
      if (Math.hypot(at.x - p.x, at.y - p.y, at.z - p.z) < 1e-6) rootsFixed++;
    }
    props.peopleSetTime(0);
    return { n: figs.length, near: near.length, exact, moved, rootsFixed, kinds: [...new Set(near.map((p) => p.kind))] };
  });
  check(sp.n > 0 && sp.exact === sp.near, `set-piece figures at time 0 are drawn exactly as authored (${sp.exact}/${sp.near} near figures bit-identical to their baked pose)`);
  check(sp.moved === sp.near && sp.rootsFixed === sp.near, `set-piece figures animate in place (${sp.moved}/${sp.near} pose changes at t = 7.3 s, ${sp.rootsFixed}/${sp.near} roots unmoved; kinds: ${sp.kinds?.join(', ')})`);

  // ---- 4 + 5. the walk, sampled ---------------------------------------------------------------------------------
  const walk = await page.evaluate(() => {
    const C = window.__city.ctx, world = C.world;
    const props = C.modules.get('props').api;
    const roads = C.modules.get('roads').api;
    const cs = world.cellSize;
    const edges = [];
    for (const e of world.roads.edges.values()) {
      const a = world.roads.nodes.get(e.a), b = world.roads.nodes.get(e.b);
      if (a && b) edges.push({ kind: e.kind, ax: a.x, az: a.z, bx: b.x, bz: b.z, half: roads.roadWidth(e.kind) / 2 });
    }
    const segDist = (x, z, e) => {
      const dx = e.bx - e.ax, dz = e.bz - e.az, l2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - e.ax) * dx + (z - e.az) * dz) / l2));
      return Math.hypot(e.ax + dx * t - x, e.az + dz * t - z);
    };
    const boxes = [...world.buildings.values()].map((b) => ({
      x0: world.minX + b.i * cs, x1: world.minX + (b.i + b.w) * cs, z0: world.minZ + b.j * cs, z1: world.minZ + (b.j + b.d) * cs,
    }));
    // sidewalk top above the walker's own edge: the edge frame's bed profile + 0.35 (roads/network.js Y.sidewalk)
    const net = roads.getNetwork();
    const sidewalkY = (edgeId, x, z) => {
      const fr = net.edges.get(edgeId);
      const s = (x - fr.ax) * fr.d.x + (z - fr.az) * fr.d.z;
      const st = fr.stations, ys = fr.ys;
      let y = ys[ys.length - 1];
      if (s <= st[0]) y = ys[0];
      else for (let i = 1; i < st.length; i++) if (s <= st[i]) { y = ys[i - 1] + (ys[i] - ys[i - 1]) * ((s - st[i - 1]) / (st[i] - st[i - 1])); break; }
      return y + 0.35;
    };
    const times = [0, 3, 7.5, 14, 22, 31, 40, 48.5, 55, 60, 187.25, 1234.5];
    let onRoad = 0, inBuilding = 0, inWater = 0, offSurface = 0, samples = 0, close = 0, minPair = Infinity, strollers = 0;
    const firstBad = [];
    const start = new Map();
    let travelled = 0;
    for (const t of times) {
      props.peopleSetTime(t);
      const all = props.people().filter((f) => !f.hidden);
      const walkers = all.filter((f) => f.walks);
      for (const f of walkers) {
        samples++;
        if (t === 0) start.set(f.id, f);
        const rec = world.props.get(f.id);
        const stroller = !!rec.park;
        if (stroller && t === 0) strollers++;
        let bad = null;
        for (const e of edges) {
          if (e.kind === 'path') continue; // a path is for walking on
          if (segDist(f.x, f.z, e) < e.half + 0.4) { bad = 'carriageway'; onRoad++; break; }
        }
        if (boxes.some((b) => f.x > b.x0 && f.x < b.x1 && f.z > b.z0 && f.z < b.z1)) { bad = 'building'; inBuilding++; }
        if (world.cellAtWorld(f.x, f.z)?.type === 'water') { bad = 'water'; inWater++; }
        if (!stroller) {
          if (Math.abs(f.y - sidewalkY(f.edge, f.x, f.z)) > 0.35) { bad = 'height'; offSurface++; }
        }
        if (bad && firstBad.length < 6) firstBad.push({ t, id: f.id, bad, x: f.x, y: f.y, z: f.z });
      }
      // nobody walks through anybody: every pair with a walker in it
      for (const a of walkers) {
        for (const b of all) {
          if (a === b || (b.walks && b.id < a.id)) continue;
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (d < minPair) minPair = d;
          if (d < 0.5) { close++; if (firstBad.length < 6) firstBad.push({ t, a: a.id, b: b.id, d }); }
        }
      }
      if (t === 60) for (const f of walkers) { const s = start.get(f.id); if (s) travelled = Math.max(travelled, Math.hypot(f.x - s.x, f.z - s.z)); }
    }
    props.peopleSetTime(0);
    return { samples, onRoad, inBuilding, inWater, offSurface, close, minPair, firstBad, travelled, strollers, times: times.length };
  });
  check(walk.onRoad === 0, `no walker ever stands on a carriageway (${walk.samples} samples over ${walk.times} times, ${walk.onRoad} on a road)`);
  check(walk.inBuilding === 0 && walk.inWater === 0, `no walker ever enters a building footprint or water (${walk.inBuilding} / ${walk.inWater})`);
  check(walk.offSurface === 0, `sidewalk walkers stay on the sidewalk surface (${walk.offSurface} off by more than 0.35 m)`);
  check(walk.close === 0, `walkers never come within 0.5 m of anybody (closest pair ${walk.minPair.toFixed(2)} m, ${walk.close} violations)`);
  check(walk.travelled > 5, `walkers travel (farthest from its record after 60 s: ${walk.travelled.toFixed(1)} m)`);
  if (walk.firstBad.length) console.log(JSON.stringify(walk.firstBad, null, 1));
  console.log(`     park-path strollers in this city: ${walk.strollers}`);

  // ---- 2. pause holds everybody, the running clock moves them ---------------------------------------------------
  const live = await page.evaluate(async () => {
    const C = window.__city.ctx;
    const props = C.modules.get('props').api;
    const snap = () => new Map(props.people().map((f) => [f.id, f]));
    props.peopleSetTime(9);
    window.__city.pause();
    const a = snap();
    const idler = [...a.values()].find((f) => !f.walks && !f.guest && f.kind === 'figure');
    const idleA = props.getPropParts(idler.id).map((pt) => pt.matrix);
    await window.__city.frames(45);
    const b = snap();
    let drift = 0;
    for (const [id, f] of a) { const g = b.get(id); drift = Math.max(drift, Math.hypot(f.x - g.x, f.y - g.y, f.z - g.z)); }
    const tPaused = props.peopleStats().time;
    window.__city.resume();
    await window.__city.frames(420); // 7 s at the fixed 1/60 step
    window.__city.pause();
    const c = snap();
    let walkers = 0, moved = 0, idleMoved = 0;
    for (const [id, f] of b) {
      const g = c.get(id);
      const d = Math.hypot(f.x - g.x, f.z - g.z);
      if (f.walks) { walkers++; if (d > 0.5) moved++; } else if (d > 1e-6) idleMoved++;
    }
    const idleC = props.getPropParts(idler.id).map((pt) => pt.matrix);
    const idlePose = idleA.some((m, i) => m.some((v, j) => Math.abs(v - idleC[i][j]) > 1e-4));
    return { drift, tPaused, tAfter: props.peopleStats().time, walkers, moved, idleMoved, idlePose, scale: C.clock.timeScale };
  });
  check(live.drift === 0 && live.tPaused === 9, `paused: nobody moves over 45 frames (drift ${live.drift} m, time held at ${live.tPaused})`);
  check(Math.abs(live.tAfter - live.tPaused - 7 * live.scale) < 0.2, `running: animation time follows the game clock (+${(live.tAfter - live.tPaused).toFixed(2)} s over 420 frames at speed ${live.scale})`);
  check(live.walkers > 0 && live.moved / live.walkers >= 0.8, `running: walkers walk (${live.moved}/${live.walkers} moved more than 0.5 m in 7 s; the rest are pausing at the end of a beat)`);
  check(live.idleMoved === 0 && live.idlePose, `running: standing figures stay put but their pose changes (${live.idleMoved} roots moved)`);

  // deterministic staging: two resets give the same picture of the same people
  const det = await page.evaluate(async () => {
    const C = window.__city.ctx;
    const hash = () => {
      let h = 2166136261;
      for (const role of ['sp-torso', 'sp-leg', 'sp-arm', 'sp-head']) {
        const m = C.scene.getObjectByName(`props-${role}`);
        const a = new Uint32Array(m.instanceMatrix.array.buffer, 0, m.count * 16);
        for (let i = 0; i < a.length; i++) { h ^= a[i]; h = Math.imul(h, 16777619); }
      }
      return h >>> 0;
    };
    window.__city.pause();
    window.__city.resetPresentation();
    await window.__city.frames(3);
    const h1 = hash();
    window.__city.resume();
    await window.__city.frames(90);
    const hMid = hash();
    window.__city.pause();
    window.__city.resetPresentation();
    await window.__city.frames(3);
    return { h1, hMid, h2: hash() };
  });
  check(det.h1 === det.h2 && det.hMid !== det.h1, `a reset restages the same people exactly (instance buffers ${det.h1.toString(16)} = ${det.h2.toString(16)}, differ while running)`);

  // ---- 6. a walker picked up mid-walk vanishes where it is drawn -----------------------------------------------
  const hide = await page.evaluate(async () => {
    const C = window.__city.ctx;
    const props = C.modules.get('props').api;
    props.peopleSetTime(20);
    let pick = null, far = 0;
    for (const f of props.people()) {
      if (!f.walks) continue;
      const p = C.world.props.get(f.id);
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d > far) { far = d; pick = f; }
    }
    const rec = C.world.props.get(pick.id);
    const parts = props.getPropParts(pick.id);
    let cx = 0, cz = 0;
    for (const pt of parts) { cx += pt.center[0]; cz += pt.center[2]; }
    cx /= parts.length; cz /= parts.length;
    const refs = props.getPropInstances(pick.id);
    props.hideProps([pick.id]);
    const zero = () => refs.every(({ role, k }) => {
      const a = C.scene.getObjectByName(`props-${role}`).instanceMatrix.array;
      return a[k * 16] === 0 && a[k * 16 + 5] === 0 && a[k * 16 + 10] === 0;
    });
    const afterHide = { parts: props.getPropParts(pick.id).length, zero: zero() };
    window.__city.resume();
    window.__city.setCamera({ pos: [pick.x + 20, pick.y + 12, pick.z + 20], target: [pick.x, pick.y, pick.z], fov: 45 });
    await window.__city.frames(20);
    window.__city.setCamera({ pos: [pick.x - 30, pick.y + 20, pick.z + 5], target: [pick.x, pick.y, pick.z], fov: 45 });
    await window.__city.frames(20);
    const afterMoves = { parts: props.getPropParts(pick.id).length, zero: zero() };
    // force a full re-layout with the hidden walker still in the world
    const tmp = props.addProp('hydrant', rec.x + 3, rec.z + 3, 0);
    await window.__city.frames(30);
    const refs2 = props.getPropInstances(pick.id);
    const zero2 = refs2.length > 0 && refs2.every(({ role, k }) => {
      const a = C.scene.getObjectByName(`props-${role}`).instanceMatrix.array;
      return a[k * 16] === 0 && a[k * 16 + 5] === 0 && a[k * 16 + 10] === 0;
    });
    const afterRebuild = { parts: props.getPropParts(pick.id).length, zero: zero2 };
    props.removeProp(tmp);
    C.world.removeProp(pick.id);
    window.__city.pause();
    await window.__city.frames(30);
    return {
      far, atDrawn: Math.hypot(cx - pick.x, cz - pick.z), atRecord: Math.hypot(cx - rec.x, cz - rec.z), nParts: parts.length,
      afterHide, afterMoves, afterRebuild,
    };
  });
  check(hide.nParts >= 12 && hide.atDrawn < 0.6 && hide.atRecord > 2, `a walker's pieces are where it is drawn (${hide.atDrawn.toFixed(2)} m from its drawn spot, ${hide.atRecord.toFixed(1)} m from its record, ${hide.nParts} pieces)`);
  check(hide.afterHide.parts === 0 && hide.afterHide.zero, 'a hidden walker stops being drawn at once');
  check(hide.afterMoves.parts === 0 && hide.afterMoves.zero, 'a hidden walker stays hidden while time runs and the camera moves');
  check(hide.afterRebuild.parts === 0 && hide.afterRebuild.zero, 'a hidden walker stays hidden through a re-layout');

  // ---- park paths: a park figure beside a path strolls along it -----------------------------------------------------
  const stroll = await page.evaluate(async () => {
    const C = window.__city.ctx, world = C.world;
    const props = C.modules.get('props').api, roads = C.modules.get('roads').api;
    const parkFigs = [...world.props.values()].filter((p) => p.kind === 'figure' && p.park);
    let tried = 0;
    for (const p of parkFigs) {
      const snap = roads.snapToRoad(p.x, p.z, 60);
      if (snap && snap.dist < 22) continue; // room for a new path that touches no other road
      tried++;
      const edgeId = world.addRoad({ x: p.x + 3, z: p.z - 14 }, { x: p.x + 3, z: p.z + 14 }, 'path', { snapNodes: false });
      await window.__city.frames(40);
      const me = props.people().find((f) => f.id === p.id);
      if (!me?.walks) { world.removeRoad(edgeId); await window.__city.frames(40); continue; }
      const fr = roads.getNetwork().edges.get(me.edge);
      const at = (t) => {
        props.peopleSetTime(t);
        const f = props.people().find((q) => q.id === p.id);
        return { lat: (f.x - fr.ax) * fr.right.x + (f.z - fr.az) * fr.right.z, s: (f.x - fr.ax) * fr.d.x + (f.z - fr.az) * fr.d.z, y: f.y, x: f.x, z: f.z };
      };
      const a = at(0), b = at(15), c = at(40);
      const surface = roads.snapToRoad(c.x, c.z, 10).y;
      const res = {
        tried, kind: world.roads.edges.get(me.edge)?.kind, startOff: Math.hypot(a.x - p.x, a.z - p.z),
        latStart: Math.abs(a.lat), latLate: Math.max(Math.abs(b.lat), Math.abs(c.lat)), moved: Math.abs(c.s - b.s) + Math.abs(b.s - a.s),
        yGap: Math.abs(c.y - surface),
      };
      props.peopleSetTime(0);
      world.removeRoad(edgeId);
      await window.__city.frames(40);
      res.after = !!props.people().find((f) => f.id === p.id)?.walks;
      return res;
    }
    return { tried, none: true, parkFigs: parkFigs.length };
  });
  check(!stroll.none && stroll.kind === 'path', `a park figure beside a new path strolls along it (${stroll.none ? `no park figure took a path in ${stroll.tried} tries` : `tried ${stroll.tried}`})`);
  if (!stroll.none) {
    check(stroll.startOff < 1e-3 && stroll.latStart > 1.5 && stroll.latLate < 1.5 && stroll.moved > 2, `the stroller starts at its record ${stroll.latStart.toFixed(1)} m off the path, then keeps to it (${stroll.latLate.toFixed(2)} m from the centreline, ${stroll.moved.toFixed(1)} m walked)`);
    check(stroll.yGap < 0.1, `the stroller stands on the path surface (${stroll.yGap.toFixed(3)} m off)`);
    check(!stroll.after, 'removing the path stands the figure again');
  }

  // ---- 7. stop riders ---------------------------------------------------------------------------------------------
  const riders = await page.evaluate(() => {
    const C = window.__city.ctx, world = C.world;
    const props = C.modules.get('props').api;
    const transit = C.modules.get('transit').api;
    const roads = C.modules.get('roads').api;
    const guests = props.people().filter((f) => f.guest);
    const list = typeof transit.getRiders === 'function' ? transit.getRiders() : [];
    let short = 0, onRoad = 0, minPair = Infinity, minH = Infinity;
    for (const g of guests) {
      const parts = props.getGuestParts(g.id);
      const h = Math.max(...parts.map((p) => p.max[1])) - g.y;
      minH = Math.min(minH, h);
      if (h < 1.6) short++;
      const snap = roads.snapToRoad(g.x, g.z, 40);
      const kind = snap ? world.roads.edges.get(snap.edgeId)?.kind : null;
      if (snap && snap.dist < roads.roadWidth(kind) / 2 + 0.3) onRoad++;
      for (const o of guests) if (o !== g) minPair = Math.min(minPair, Math.hypot(o.x - g.x, o.z - g.z));
    }
    return { guests: guests.length, listed: list.length, short, onRoad, minPair, minH, blocks: C.scene.getObjectByName('transit-riders')?.count ?? -1, stats: props.peopleStats() };
  });
  check(riders.guests > 0 && riders.guests === riders.listed, `stop riders are drawn as minifigs (${riders.guests} drawn = ${riders.listed} queued by transit)`);
  check(riders.short === 0 && riders.blocks === 0, `riders are full height (shortest ${Number.isFinite(riders.minH) ? riders.minH.toFixed(2) : '-'} m) and the rider blocks are gone (${riders.blocks})`);
  check(riders.onRoad === 0 && riders.minPair >= 0.6, `riders queue on the pavement, apart (${riders.onRoad} on a carriageway, closest pair ${Number.isFinite(riders.minPair) ? riders.minPair.toFixed(2) : '-'} m)`);

  // ---- 9. cost ------------------------------------------------------------------------------------------------------
  await app.stage({ preset: 'street' });
  const cost = await page.evaluate(async () => {
    const C = window.__city.ctx;
    const props = C.modules.get('props').api;
    window.__city.resume();
    let worst = 0, sum = 0;
    for (let i = 0; i < 60; i++) { await window.__city.frames(1); const ms = props.peopleStats().lastMs; worst = Math.max(worst, ms); sum += ms; }
    window.__city.pause();
    return { worst, mean: sum / 60, draws: props.stats().drawCalls };
  });
  check(cost.mean < 3, `the people pass is cheap at street level (mean ${cost.mean.toFixed(2)} ms, worst ${cost.worst.toFixed(2)} ms per frame)`);
  check(cost.draws <= 300, `props own draw calls stay inside the budget (${cost.draws} <= 300)`);

  // ---- pictures -----------------------------------------------------------------------------------------------------
  const cam = await page.evaluate(() => {
    const C = window.__city.ctx;
    const props = C.modules.get('props').api;
    props.peopleSetTime(0);
    // the walker with the most company within 25 m
    const all = props.people().filter((f) => !f.guest && !f.hidden);
    let best = null, bestN = -1;
    for (const f of all) {
      if (!f.walks) continue;
      const n = all.filter((o) => Math.hypot(o.x - f.x, o.z - f.z) < 25).length;
      if (n > bestN) { bestN = n; best = f; }
    }
    const rec = C.world.props.get(best.id);
    const fx = Math.sin(rec.rot), fz = Math.cos(rec.rot);
    return { pos: [best.x + fx * 7 + fz * 3.5, best.y + 2.4, best.z + fz * 7 - fx * 3.5], target: [best.x, best.y + 1, best.z], fov: 42 };
  });
  for (const t of [0, 0.4, 0.8, 4]) {
    await page.evaluate(({ cam, t }) => { window.__city.setTime(14); window.__city.setCamera(cam); window.__city.ctx.modules.get('props').api.peopleSetTime(t); }, { cam, t });
    await app.capture(path.join(OUT, `walk-t${String(t).replace('.', '_')}.png`), { settle: 20, sampleMs: 200, reset: false });
  }

  const errors = await page.evaluate(() => window.__city.stats().errors);
  check(errors.length === 0, `no console/page errors (${errors.length})`);
  if (errors.length) console.log(errors.join('\n'));
} finally {
  await app.close();
}
fs.writeFileSync(path.join(OUT, 'check.json'), JSON.stringify({ failed, checks: results }, null, 2));
console.log(`\n[check-people] ${results.length - failed}/${results.length} passed → ${path.join(OUT, 'check.json')}`);
process.exit(failed ? 1 : 0);
