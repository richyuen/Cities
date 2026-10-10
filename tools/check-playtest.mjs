#!/usr/bin/env node
// Regression check for the 2026-10-10 playtest fixes (Tier 1, A-F).
//   node tools/check-playtest.mjs
// Needs the dev server (npm run dev). Drives the full game through tools/shot.mjs openApp.
//   A  save -> fresh boot -> load keeps treasury, tick and day (and they survive the next tick)
//   B  load restores the props 1:1 (no regenerated lamps/signals/figures/yard/park props), and the loaded world is
//      adopted: a road drawn afterwards only adds its own props, a bulldozed building takes its yard with it
//   C  bulldozing a road removes its furniture; a crossing street keeps its own; signals follow the junction
//   D  the utility stamp is centred on the cursor and a refusal names its reason
//   E  Options -> Show HUD reads the player's setting and sticks
//   F  one city name (sim stats == HUD), `?city=` propagates
// Tier 2:
//   G  land zoned during play grows in the mature demo city (whose demand idles under the 0.3 gate), other land does not
//   H  a utility on gently uneven ground levels its site (charged), and the neighbours are left alone
//   J  V / Shift+V cycle through "off"; the coverage plate is a faint tint; Continue starts from an overview
// Exit 1 on any failed check.
import { openApp, BASE_URL } from './shot.mjs';

const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// ---- in-page helpers (installed on every boot) ---------------------------------------------------------------
const installHelpers = () => {
  const c = window.__city, w = c.world;
  const api = (id) => c.ctx.modules.get(id)?.api;
  const H = (window.__pt = {});
  H.census = () => {
    const kinds = {}, tags = { edgeId: 0, nodeId: 0, yardOf: 0, park: 0 };
    for (const p of w.props.values()) { kinds[p.kind] = (kinds[p.kind] || 0) + 1; for (const k in tags) if (p[k] != null) tags[k]++; }
    const st = api('simulation').getStats();
    return { props: w.props.size, kinds, tags, money: st.money, day: st.day, tick: st.tick, name: st.cityName,
      buildings: w.buildings.size, edges: w.roads.edges.size };
  };
  H.propsNear = (a, b, r) => {
    const out = [];
    const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1;
    for (const p of w.props.values()) {
      let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2; t = Math.max(0, Math.min(1, t));
      if (Math.hypot(a.x + dx * t - p.x, a.z + dz * t - p.z) <= r) out.push(p.id);
    }
    return out;
  };
  /** Top-left cell of an n x n block of empty, buildable, dry land with `margin` clear cells around it. */
  H.openLand = (n, margin = 3, skip = 0) => {
    const terr = api('terrain');
    const free = (i, j) => { const cc = w.cellAt(i, j); return !!cc && cc.type === 'none' && !cc.buildingId && !cc.zone && terr.isBuildable(i, j); };
    let seen = 0;
    for (let j = margin + 2; j < w.size.h - n - margin - 2; j += 2) {
      for (let i = margin + 2; i < w.size.w - n - margin - 2; i += 2) {
        let ok = true;
        for (let dj = -margin; dj < n + margin && ok; dj++) for (let di = -margin; di < n + margin && ok; di++) ok = free(i + di, j + dj);
        if (!ok) continue;
        const p = w.cellToWorld(i, j), q = w.cellToWorld(i + n - 1, j + n - 1);
        if (H.propsNear(p, q, 24).length) continue; // nothing standing nearby, so the before/after diff is clean
        if (seen++ < skip) continue;
        return { i, j };
      }
    }
    return null;
  };
  H.frames = (k) => c.frames(k);
};

async function boot(extra = {}) {
  const app = await openApp({ seed: 1, extra });
  await app.page.evaluate(installHelpers);
  return app;
}

let save = null;
let before = null;

// ---- page 1: play a little, test C/D/E/F on a fresh city, then save -------------------------------------------
{
  const app = await boot({ city: 'Foo Town' });
  const { page } = app;
  try {
    // F
    const f = await page.evaluate(() => ({
      sim: window.__city.ctx.modules.get('simulation').api.getStats().cityName,
      world: window.__city.world.stats.cityName,
      hud: document.querySelector('.lc-city-name')?.firstChild?.textContent,
    }));
    check(f.sim === 'Foo Town' && f.world === 'Foo Town' && f.hud === 'Foo Town', `F: ?city= reaches sim, world.stats and HUD (${JSON.stringify(f)})`);

    // Signals: every generated junction carries one light per arm (a grid built one road at a time used to leave
    // its four-way crossings with three)
    const sig = await page.evaluate(() => {
      const c = window.__city, w = c.world;
      const lights = new Map();
      for (const p of w.props.values()) if (p.kind === 'traffic_light' && p.nodeId != null) lights.set(p.nodeId, (lights.get(p.nodeId) || 0) + 1);
      let junctions = 0, wrong = 0, fourWay = 0;
      for (const n of c.ctx.modules.get('roads').api.getIntersections()) {
        if (n.arms.length < 3) continue;
        junctions++; if (n.arms.length === 4) fourWay++;
        if ((lights.get(n.nodeId) || 0) !== n.arms.length) wrong++;
      }
      return { junctions, fourWay, wrong };
    });
    check(sig.junctions > 50 && sig.fourWay > 30 && sig.wrong === 0, `signals: all ${sig.junctions} generated junctions (${sig.fourWay} four-way) have one light per arm (${sig.wrong} wrong)`);

    // C1: a street on open land, then bulldoze it
    const c1 = await page.evaluate(async () => {
      const c = window.__city, w = c.world, H = window.__pt;
      const o = H.openLand(14, 3);
      if (!o) return { err: 'no open land' };
      const a = w.cellToWorld(o.i, o.j + 7), b = w.cellToWorld(o.i + 13, o.j + 7);
      const pre = new Set(H.propsNear(a, b, 20));
      const id = w.addRoad({ x: a.x, z: a.z }, { x: b.x, z: b.z }, 'street', { snapNodes: true });
      await H.frames(4);
      const added = H.propsNear(a, b, 20).filter((p) => !pre.has(p));
      const tagged = added.filter((p) => w.props.get(p).edgeId === id).length;
      w.removeRoad(id);
      await H.frames(4);
      const left = H.propsNear(a, b, 20).filter((p) => !pre.has(p));
      return { o, id, added: added.length, tagged, left: left.length, leftKinds: left.map((p) => w.props.get(p).kind) };
    });
    check(!c1.err && c1.added >= 2 && c1.tagged === c1.added, `C: a new street lays tagged props (${JSON.stringify(c1)})`);
    check(!c1.err && c1.left === 0, `C: bulldozing the street leaves no props behind (${c1.left} left)`);

    // C2: a cross. Bulldoze one arm; the other three arms keep their lamps, the junction is re-signalled.
    const c2 = await page.evaluate(async () => {
      const c = window.__city, w = c.world, H = window.__pt;
      const o = H.openLand(16, 3);
      if (!o) return { err: 'no open land' };
      const A = w.cellToWorld(o.i, o.j + 8), B = w.cellToWorld(o.i + 15, o.j + 8);
      const C = w.cellToWorld(o.i + 8, o.j), D = w.cellToWorld(o.i + 8, o.j + 15);
      const X = { x: C.x, z: A.z };
      const kindsNear = (p, q, r) => { const k = {}; for (const id of H.propsNear(p, q, r)) { const pr = w.props.get(id); k[pr.kind] = (k[pr.kind] || 0) + 1; } return k; };
      w.addRoad({ x: A.x, z: A.z }, { x: B.x, z: B.z }, 'street', { snapNodes: true });
      await H.frames(3);
      const lampsEW = kindsNear(A, B, 9).streetlamp || 0;
      w.addRoad({ x: C.x, z: C.z }, { x: D.x, z: D.z }, 'street', { snapNodes: true });
      await H.frames(3);
      const cross = { lampsEW2: kindsNear(A, B, 9).streetlamp || 0, signals: kindsNear(X, X, 25).traffic_light || 0 };
      // west arm: the edge between A's node and the junction
      const west = [...w.roads.edges.values()].find((e) => {
        const na = w.roads.nodes.get(e.a), nb = w.roads.nodes.get(e.b);
        const mx = (na.x + nb.x) / 2, mz = (na.z + nb.z) / 2;
        return Math.abs(mz - A.z) < 1 && mx > Math.min(A.x, X.x) && mx < Math.max(A.x, X.x);
      });
      const mid = { x: (A.x + X.x) / 2, z: A.z };
      const westLamps0 = kindsNear(A, { x: X.x + (A.x - X.x) * 0.25, z: A.z }, 9).streetlamp || 0;
      w.removeRoad(west.id);
      await H.frames(4);
      const westLamps1 = kindsNear(A, { x: X.x + (A.x - X.x) * 0.25, z: A.z }, 9).streetlamp || 0;
      const eastLamps = kindsNear({ x: X.x + (B.x - X.x) * 0.25, z: B.z }, B, 9).streetlamp || 0;
      const nsLamps = kindsNear(C, D, 9).streetlamp || 0;
      const signals3 = kindsNear(X, X, 25).traffic_light || 0;
      // remove the east arm too: the N-S street heals into one edge and the junction loses its signals
      const east = [...w.roads.edges.values()].find((e) => {
        const na = w.roads.nodes.get(e.a), nb = w.roads.nodes.get(e.b);
        const mx = (na.x + nb.x) / 2, mz = (na.z + nb.z) / 2;
        return Math.abs(mz - A.z) < 1 && mx > Math.min(B.x, X.x) && mx < Math.max(B.x, X.x);
      });
      w.removeRoad(east.id);
      await H.frames(4);
      const after2 = { nsLamps: kindsNear(C, D, 9).streetlamp || 0, signals: kindsNear(X, X, 25).traffic_light || 0, edges: [...w.roads.edges.values()].filter((e) => { const na = w.roads.nodes.get(e.a); return Math.abs(na.x - C.x) < 1; }).length };
      // finally the healed N-S street itself: its lamps carry stale (pre-merge) edge tags
      const ns = [...w.roads.edges.values()].find((e) => { const na = w.roads.nodes.get(e.a), nb = w.roads.nodes.get(e.b); return Math.abs(na.x - C.x) < 1 && Math.abs(nb.x - C.x) < 1; });
      w.removeRoad(ns.id);
      await H.frames(4);
      const rest = H.propsNear({ x: A.x, z: C.z }, { x: B.x, z: D.z }, 70).filter((id) => { const p = w.props.get(id); return p.x > Math.min(A.x, B.x) - 12 && p.x < Math.max(A.x, B.x) + 12 && p.z > Math.min(C.z, D.z) - 12 && p.z < Math.max(C.z, D.z) + 12; });
      return { lampsEW, cross, westLamps0, westLamps1, eastLamps, nsLamps, signals3, after2, rest: rest.length, mid };
    });
    check(!c2.err && c2.cross.signals === 4 && c2.cross.lampsEW2 >= c2.lampsEW, `C: a crossing keeps the first street's lamps and signals the junction (${JSON.stringify(c2.cross)}, lamps before ${c2.lampsEW})`);
    check(!c2.err && c2.westLamps0 > 0 && c2.westLamps1 === 0, `C: bulldozing one arm removes that arm's lamps (${c2.westLamps0} -> ${c2.westLamps1})`);
    check(!c2.err && c2.eastLamps > 0 && c2.nsLamps > 0, `C: the other arms keep theirs (east ${c2.eastLamps}, cross street ${c2.nsLamps})`);
    check(!c2.err && c2.signals3 === 3, `C: the junction is re-signalled for 3 arms (${c2.signals3} lights)`);
    check(!c2.err && c2.after2.signals === 0 && c2.after2.nsLamps > 0, `C: with both arms gone the healed street keeps its lamps and no signals (${JSON.stringify(c2.after2)})`);
    check(!c2.err && c2.rest === 0, `C: bulldozing the healed street clears the site (${c2.rest} props left)`);

    // D: stamp centred on the cursor, refusal reason named
    const d = await page.evaluate(async () => {
      const c = window.__city, w = c.world, H = window.__pt;
      const o = H.openLand(12, 2);
      if (!o) return { err: 'no open land' };
      const p = w.cellToWorld(o.i + 6, o.j + 6);
      const y = w.getHeight(p.x, p.z);
      c.ctx.camera.position.set(p.x, y + 90, p.z + 0.5);
      c.ctx.controls.target.set(p.x, y, p.z);
      c.ctx.controls.update();
      // a short street so one placement can be refused by a road
      const a = w.cellToWorld(o.i + 1, o.j + 2), b = w.cellToWorld(o.i + 10, o.j + 2);
      w.addRoad({ x: a.x, z: a.z }, { x: b.x, z: b.z }, 'street', { snapNodes: true });
      await H.frames(6);
      const v = new c.THREE.Vector3(p.x, y, p.z).project(c.ctx.camera);
      const r = c.ctx.renderer.domElement.getBoundingClientRect();
      const v2 = new c.THREE.Vector3(w.cellToWorld(o.i + 5, o.j + 3).x, y, w.cellToWorld(o.i + 5, o.j + 3).z).project(c.ctx.camera);
      return { o, sx: r.left + (v.x + 1) / 2 * r.width, sy: r.top + (1 - v.y) / 2 * r.height,
        rx: r.left + (v2.x + 1) / 2 * r.width, ry: r.top + (1 - v2.y) / 2 * r.height };
    });
    if (d.err) check(false, `D: ${d.err}`);
    else {
      const ghost = async (tool, x, y) => {
        await page.evaluate((t) => window.__city.ctx.modules.get('ui').api.setTool(t), tool);
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.evaluate(() => window.__pt.frames(2));
        const g = await page.evaluate(() => ({ drag: window.__city.ctx.modules.get('tools').api.getGhostState().drag, status: document.querySelector('.lc-status')?.textContent }));
        await page.keyboard.press('Escape');
        await page.mouse.up();
        return g;
      };
      const z = await ghost('zone:r', d.sx, d.sy);          // the cursor's own cell
      const pw = await ghost('utility:power', d.sx, d.sy);  // 3x3
      const wt = await ghost('utility:water', d.sx, d.sy);  // 2x2
      const hit = z.drag ? { i: z.drag.i0, j: z.drag.j0 } : null;
      check(hit && pw.drag && pw.drag.i0 === hit.i - 1 && pw.drag.j0 === hit.j - 1 && pw.drag.i1 === hit.i + 1 && pw.drag.j1 === hit.j + 1,
        `D: the 3x3 stamp is centred on the cursor cell (cursor ${JSON.stringify(hit)}, stamp ${pw.drag?.i0},${pw.drag?.j0}..${pw.drag?.i1},${pw.drag?.j1})`);
      check(hit && wt.drag && wt.drag.i0 === hit.i && wt.drag.j0 === hit.j && wt.drag.i1 === hit.i + 1, `D: the 2x2 stamp covers the cursor cell (${wt.drag?.i0},${wt.drag?.j0}..${wt.drag?.i1},${wt.drag?.j1})`);
      check(/\$8,000/.test(pw.status || ''), `D: a free site shows the price ("${pw.status}")`);
      const blocked = await ghost('utility:power', d.rx, d.ry);
      check(/Blocked — road in the way/.test(blocked.status || ''), `D: a refusal names its reason ("${blocked.status}")`);
      await page.evaluate(() => window.__city.ctx.modules.get('ui').api.setTool(null));
    }

    // E: Options -> Show HUD
    const e = await page.evaluate(async () => {
      const c = window.__city, H = window.__pt;
      const ui = c.ctx.modules.get('ui').api, menu = c.ctx.modules.get('menu').api;
      const openOptions = async () => {
        menu.openPause(); await H.frames(2);
        [...document.querySelectorAll('.lc-menu-item')].find((b) => b.textContent === 'Options').click();
        await H.frames(2);
        const row = [...document.querySelectorAll('.lc-menu-row')].find((r) => r.textContent.includes('Show HUD'));
        return row.querySelector('.lc-menu-switch');
      };
      const close = async () => { document.querySelector('.lc-menu-back').click(); await H.frames(1); [...document.querySelectorAll('.lc-menu-item')].find((b) => /Resume/.test(b.textContent)).click(); await H.frames(2); };
      const out = { start: ui.isHudVisible() };
      let sw = await openOptions();
      out.readsOn = sw.classList.contains('on'); out.hiddenBehindMenu = !ui.isHudVisible();
      sw.click(); out.stillHiddenAfterToggle = !ui.isHudVisible();
      await close(); out.afterOff = ui.isHudVisible();
      sw = await openOptions(); out.readsOff = !sw.classList.contains('on');
      sw.click(); await close(); out.afterOn = ui.isHudVisible();
      return out;
    });
    check(e.start && e.readsOn && e.hiddenBehindMenu, `E: Show HUD reads ON while the menu hides the HUD (${JSON.stringify(e)})`);
    check(e.stillHiddenAfterToggle && e.afterOff === false && e.readsOff && e.afterOn === true, 'E: toggling sticks after the menu closes, both ways');

    // play a little so the save differs from a fresh boot, then save
    // Census and save are taken in one synchronous step (the module is imported first): the game keeps running
    // between two separate evaluates, and a growth pass or a few ticks in the gap made the comparison racy.
    const snap = await page.evaluate(async () => {
      const c = window.__city, H = window.__pt;
      const sim = c.ctx.modules.get('simulation').api;
      const { serializeSave } = await import('/src/menu/serialize.js');
      for (let k = 0; k < 1500; k++) sim.tick(true);
      sim.spend(1234);
      await H.frames(30); // park flush (200 ms) and any deferred prop work
      sim.tick(true);     // stats are a per-tick snapshot: make them current before reading
      return { before: H.census(), save: JSON.stringify(serializeSave(c.ctx, { name: 'check-playtest' })) };
    });
    before = snap.before; save = snap.save;
    check(before.day > 1 && before.tick >= 1500, `setup: the saved city is past day 1 (day ${before.day}, tick ${before.tick}, $${before.money}, ${before.props} props, ${(save.length / 1e6).toFixed(2)} MB)`);
    check(before.tags.edgeId > 500 && before.tags.nodeId > 100 && before.tags.yardOf > 500, `setup: props carry their owner tags (${JSON.stringify(before.tags)})`);
  } finally { await app.close(); }
}

// ---- page 2: fresh boot (as Load does), apply the save --------------------------------------------------------
{
  const app = await boot({});
  const { page } = app;
  try {
    const fresh = await page.evaluate(() => window.__pt.census());
    check(fresh.name === 'Brickport', `F: without ?city= the sim uses the HUD's default name (${fresh.name})`);
    const after = await page.evaluate(async (json) => {
      const c = window.__city, H = window.__pt;
      const { applySave } = await import('/src/menu/serialize.js');
      applySave(c.ctx, JSON.parse(json));
      const r0 = H.census();
      await H.frames(40); // > 200 ms: a park flush would land here
      await new Promise((r) => setTimeout(r, 400));
      await H.frames(10);
      const r1 = H.census();
      c.ctx.modules.get('simulation').api.tick(true);
      const r2 = H.census();
      return { r0, r1, r2 };
    }, save);
    const { r0, r1, r2 } = after;
    check(r0.money === before.money && r0.day === before.day && r0.tick === before.tick, `A: load restores treasury/day/tick ($${before.money}/d${before.day}/t${before.tick} -> $${r0.money}/d${r0.day}/t${r0.tick})`);
    check(Math.abs(r2.money - before.money) < Math.max(5000, Math.abs(before.money) * 0.02) && r2.day === before.day && r2.tick > before.tick && r2.tick <= before.tick + 12, // the game keeps ticking during the waits
      `A: and they survive the next tick ($${r2.money}/d${r2.day}/t${r2.tick})`);
    check(r0.props === before.props, `B: prop count is identical after load (${before.props} -> ${r0.props})`);
    const kindDiff = Object.keys({ ...before.kinds, ...r0.kinds }).filter((k) => before.kinds[k] !== r0.kinds[k]).map((k) => `${k} ${before.kinds[k] || 0}->${r0.kinds[k] || 0}`);
    check(kindDiff.length === 0, `B: per-kind counts are identical (${kindDiff.join(', ') || 'no difference'})`);
    check(r1.props === before.props, `B: nothing is generated in the frames after the load (${r1.props})`);
    check(r0.buildings === before.buildings && r0.edges === before.edges, `B: buildings and road edges match (${r0.buildings}, ${r0.edges})`);

    // the loaded world is adopted: live edits behave as before the save
    const live = await page.evaluate(async () => {
      const c = window.__city, w = c.world, H = window.__pt;
      const out = {};
      const n0 = w.props.size;
      const o = H.openLand(14, 3);
      const a = w.cellToWorld(o.i, o.j + 7), b = w.cellToWorld(o.i + 13, o.j + 7);
      const id = w.addRoad({ x: a.x, z: a.z }, { x: b.x, z: b.z }, 'street', { snapNodes: true });
      await H.frames(4);
      out.roadAdded = w.props.size - n0;                 // only this street's own props
      w.removeRoad(id); await H.frames(4);
      out.roadNet = w.props.size - n0;
      // a loaded building with a yard: bulldozing it takes the yard along
      let pick = null, best = 0;
      const byB = new Map();
      for (const p of w.props.values()) if (p.yardOf != null) byB.set(p.yardOf, (byB.get(p.yardOf) || 0) + 1);
      for (const [bid, k] of byB) if (k > best && w.buildings.has(bid)) { best = k; pick = bid; }
      const n1 = w.props.size;
      w.removeBuilding(pick); await H.frames(2);
      out.yard = best; out.yardRemoved = n1 - w.props.size;
      // a loaded street edge: bulldozing it removes the props tagged to it
      const cnt = new Map();
      for (const p of w.props.values()) if (p.edgeId != null && p.kind === 'streetlamp') cnt.set(p.edgeId, (cnt.get(p.edgeId) || 0) + 1);
      let eid = null, eb = 0;
      for (const [k, v] of cnt) if (v > eb && w.roads.edges.has(k)) { eb = v; eid = k; }
      const tagged = [...w.props.values()].filter((p) => p.edgeId === eid).length;
      const n2 = w.props.size;
      w.removeRoad(eid); await H.frames(4);
      out.edgeTagged = tagged; out.edgeRemoved = n2 - w.props.size;
      out.staleTags = [...w.props.values()].filter((p) => p.edgeId === 'none').length;
      out.errors = c.stats().errors;
      // ids handed out after a load must not collide with loaded ones
      const pid = w.addProp({ kind: 'bench', x: a.x, y: 0, z: a.z });
      out.newPropId = pid; w.removeProp(pid);
      return out;
    });
    check(live.roadAdded > 0 && live.roadAdded < 40 && live.roadNet === 0, `B: a road drawn after the load adds only its own props (${live.roadAdded}) and removes them again (net ${live.roadNet})`);
    check(live.yard > 0 && live.yardRemoved >= live.yard, `B/C: bulldozing a loaded building removes its ${live.yard} yard props (${live.yardRemoved} removed)`);
    check(live.edgeTagged > 0 && live.edgeRemoved >= live.edgeTagged, `C: bulldozing a loaded road removes its ${live.edgeTagged} tagged props (${live.edgeRemoved} removed)`);
    check(live.errors.length === 0, `no console errors (${live.errors.length})`);
    console.log(`     info: props left without a nearby road after the load: ${live.staleTags}; first new prop id after load: ${live.newPropId}`);
  } finally { await app.close(); }
}

// ---- page 3: the real Load path (?load=<slot>, no fixeddt): menu applies the save on boot frame 2 -------------
{
  const app = await boot({});
  const { page } = app;
  try {
    const slotId = await page.evaluate(async (json) => {
      const st = await import('/src/menu/storage.js');
      const id = st.newSlotId();
      const res = st.writeSlot(id, JSON.parse(json));
      return res && res.ok === false ? null : id;
    }, save);
    check(!!slotId, `real load: the save fits a slot (${slotId})`);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${BASE_URL}/?seed=1&city=Foo%20Town&load=${slotId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__city && window.__city.ready === true, { timeout: 90000, polling: 100 });
    await page.evaluate(installHelpers);
    // menu applies the save two frames after boot; wait for it, then let deferred work (park flush) land
    await page.waitForFunction((n) => window.__city.world.buildings.size === n && window.__city.ctx.modules.get('simulation').api.getStats().tick >= 1500, { timeout: 60000, polling: 100 }, before.buildings);
    const r = await page.evaluate(async () => {
      const H = window.__pt;
      const first = H.census();
      await new Promise((res) => setTimeout(res, 600));
      await H.frames(20);
      const c = H.census();
      c.first = { props: first.props, money: first.money, day: first.day, tick: first.tick };
      c.errors = window.__city.stats().errors;
      c.hud = document.querySelector('.lc-city-name')?.firstChild?.textContent;
      return c;
    });
    await page.evaluate(async (id) => { (await import('/src/menu/storage.js')).deleteSlot(id); }, slotId);
    const kd = Object.keys({ ...before.kinds, ...r.kinds }).filter((k) => before.kinds[k] !== r.kinds[k]).map((k) => `${k} ${before.kinds[k] || 0}->${r.kinds[k] || 0}`);
    check(r.props === before.props && kd.length === 0, `real load B: props identical, total and per kind (${before.props} -> ${r.props}; ${kd.join(', ') || 'no difference'})`);
    check(r.first.props === before.props, `real load B: identical on the first frame too (${r.first.props})`);
    check(r.day === before.day && r.tick >= before.tick && r.tick <= before.tick + 40 && Math.abs(r.money - before.money) < Math.max(20000, Math.abs(before.money) * 0.1),
      `real load A: treasury/day/tick carried over ($${before.money}/d${before.day}/t${before.tick} -> $${r.money}/d${r.day}/t${r.tick})`);
    check(r.buildings === before.buildings && r.edges === before.edges, `real load: buildings and road edges match (${r.buildings}, ${r.edges})`);
    check(r.name === 'Foo Town' && r.hud === 'Foo Town', `real load F: one city name (${r.name} / ${r.hud})`);
    check(r.errors.length === 0 && errors.length === 0, `real load: no errors (${r.errors.length + errors.length})`);
  } finally { await app.close(); }
}

// ---- page 4: Tier 2 (G growth, H grading, J views / coverage tint) ---------------------------------------------
{
  const app = await boot({});
  const { page } = app;
  try {
    const boot0 = await page.evaluate(() => { const sim = window.__city.ctx.modules.get('simulation').api; sim.tick(true); const b = sim.getBudget().perDay; return { pop: sim.getStats().population, services: b.expenses.services, income: Math.round(b.income.total), net: Math.round(b.net) }; });
    check(boot0.net > 10000 && boot0.net < 90000, `I: the freshly booted city (pop ${boot0.pop}) nets $${boot0.net}/day ($${Math.round(boot0.services)} city services)`);

    // J: view cycling
    const v = await page.evaluate(() => {
      const views = window.__city.ctx.modules.get('views').api;
      const ids = views.list().map((x) => x.id);
      views.setView(null);
      const back = views.cycle(-1);                 // off -> last
      const off1 = views.cycle(1);                  // last -> off
      const first = views.cycle(1);                 // off -> first
      const off2 = views.cycle(-1);                 // first -> off
      views.setView(null);
      return { ids: ids.length, back: back === ids[ids.length - 1], off1: off1 === null, first: first === ids[0], off2: off2 === null };
    });
    check(v.back && v.off1 && v.first && v.off2, `J: view cycling passes through "off" in both directions (${JSON.stringify(v)})`);

    // H: a 3x3 site that is uneven but gradable
    const h = await page.evaluate(async () => {
      const c = window.__city, w = c.world, H = window.__pt;
      const terr = c.ctx.modules.get('terrain').api;
      const free = (i, j) => { const cc = w.cellAt(i, j); return !!cc && cc.type === 'none' && !cc.buildingId; };
      let site = null;
      for (let j = 6; j < w.size.h - 8 && !site; j++) for (let i = 6; i < w.size.w - 8 && !site; i++) {
        let ok = true, uneven = 0;
        for (let dj = -2; dj <= 4 && ok; dj++) for (let di = -2; di <= 4 && ok; di++) ok = free(i + di, j + dj);
        if (!ok) continue;
        let lo = Infinity, hi = -Infinity;
        for (let dj = 0; dj <= 3; dj++) for (let di = 0; di <= 3; di++) { const y = w.getVertexHeight(i + di, j + dj); lo = Math.min(lo, y); hi = Math.max(hi, y); }
        for (let dj = 0; dj < 3; dj++) for (let di = 0; di < 3; di++) if (!terr.isBuildable(i + di, j + dj)) uneven++;
        if (uneven > 0 && hi - lo > 0.5 && hi - lo <= 1.2 && lo > (w.seaLevel || 0) + 1) site = { i, j, uneven, spread: +(hi - lo).toFixed(2) };
      }
      if (!site) return { err: 'no gradable site' };
      const p = w.cellToWorld(site.i + 1, site.j + 1);
      const y = w.getHeight(p.x, p.z);
      c.ctx.camera.position.set(p.x, y + 90, p.z + 0.5);
      c.ctx.controls.target.set(p.x, y, p.z);
      c.ctx.controls.update();
      await H.frames(6);
      const v3 = new c.THREE.Vector3(p.x, y, p.z).project(c.ctx.camera);
      const r = c.ctx.renderer.domElement.getBoundingClientRect();
      // heights just outside the ring must not move
      const outside = [];
      for (let dj = -2; dj <= 5; dj++) for (let di = -2; di <= 5; di++) if (di < -1 || di > 4 || dj < -1 || dj > 4) outside.push(w.getVertexHeight(site.i + di, site.j + dj));
      window.__h = { site, outside };
      return { site, sx: r.left + (v3.x + 1) / 2 * r.width, sy: r.top + (1 - v3.y) / 2 * r.height, money: c.ctx.modules.get('simulation').api.getStats().money };
    });
    if (h.err) check(false, `H: ${h.err}`);
    else {
      await page.evaluate(() => window.__city.ctx.modules.get('ui').api.setTool('utility:power'));
      await page.mouse.move(h.sx, h.sy);
      await page.mouse.down();
      await page.evaluate(() => window.__pt.frames(2));
      const pre = await page.evaluate(() => ({ drag: window.__city.ctx.modules.get('tools').api.getGhostState().drag, status: document.querySelector('.lc-status')?.textContent }));
      await page.mouse.up();
      await page.evaluate(() => window.__pt.frames(6));
      const post = await page.evaluate(() => {
        window.__city.ctx.modules.get('simulation').api.tick(true); // stats.money is a per-tick snapshot
        const c = window.__city, w = c.world, { site, outside } = window.__h;
        const terr = c.ctx.modules.get('terrain').api;
        let flat = 0, lo = Infinity, hi = -Infinity;
        for (let dj = 0; dj < 3; dj++) for (let di = 0; di < 3; di++) if (terr.isBuildable(site.i + di, site.j + dj)) flat++;
        for (let dj = 0; dj <= 3; dj++) for (let di = 0; di <= 3; di++) { const y = w.getVertexHeight(site.i + di, site.j + dj); lo = Math.min(lo, y); hi = Math.max(hi, y); }
        const now = [];
        for (let dj = -2; dj <= 5; dj++) for (let di = -2; di <= 5; di++) if (di < -1 || di > 4 || dj < -1 || dj > 4) now.push(w.getVertexHeight(site.i + di, site.j + dj));
        const b = w.buildings.get(w.cellAt(site.i + 1, site.j + 1).buildingId);
        // click-inspect the new plant: the coverage plate
        return { flat, spread: +(hi - lo).toFixed(3), moved: now.filter((y, k) => Math.abs(y - outside[k]) > 1e-6).length, kind: b?.kind, at: b ? [b.i, b.j] : null,
          money: c.ctx.modules.get('simulation').api.getStats().money, errors: c.stats().errors };
      });
      check(/\$8,000 \+ \$1,350 grading/.test(pre.status || ''), `H: the status shows the grading cost on a ${h.site.spread} m uneven site ("${pre.status}")`);
      check(post.kind === 'power_plant' && post.at[0] === h.site.i && post.at[1] === h.site.j, `H: the plant is built on the site that used to be refused (${h.site.uneven} uneven cells)`);
      check(post.flat === 9 && post.spread === 0, `H: its pad is level (${post.flat}/9 cells, spread ${post.spread} m)`);
      check(post.moved === 0, `H: no vertex beyond the one-cell ring moved (${post.moved})`);
      check(Math.abs((h.money - post.money) - 9350) < 1500, `H: charged build + grading ($${h.money - post.money})`);
      // J: coverage plate tint
      await page.evaluate(() => window.__city.ctx.modules.get('ui').api.setTool('select'));
      await page.mouse.click(h.sx, h.sy);
      await page.evaluate(() => window.__pt.frames(3));
      const cov = await page.evaluate(() => { const m = window.__city.ctx.scene.getObjectByName('tools-ghost-coverage'); return { visible: m?.visible, opacity: m?.material?.opacity, emissive: m?.material?.emissiveIntensity, depthWrite: m?.material?.depthWrite }; });
      check(cov.visible && cov.opacity <= 0.3 && cov.emissive <= 0.15 && cov.depthWrite === false, `J: the coverage plate is a faint tint (${JSON.stringify(cov)})`);
      await page.evaluate(() => window.__city.setTime(22));
      await page.evaluate(() => window.__pt.frames(3));
      const covN = await page.evaluate(() => { const m = window.__city.ctx.scene.getObjectByName('tools-ghost-coverage'); return { opacity: m?.material?.opacity, emissive: m?.material?.emissiveIntensity }; });
      check(covN.opacity <= 0.3 && covN.emissive <= 0.15, `J: and stays one at night (${JSON.stringify(covN)})`);
      await page.evaluate(() => { window.__city.setTime(14); window.__city.ctx.modules.get('ui').api.setTool(null); });
    }

    // J: cul-de-sac bulbs. A lone segment and a short stub end square; a real dead-end street keeps its bulb.
    const bulbs = await page.evaluate(async () => {
      const c = window.__city, w = c.world, H = window.__pt;
      const roads = c.ctx.modules.get('roads').api;
      const o = H.openLand(20, 3);
      if (!o) return { err: 'no open land' };
      const P = (di, dj) => { const p = w.cellToWorld(o.i + di, o.j + dj); return { x: p.x, z: p.z }; };
      const bulbAt = (p) => { const n = roads.getIntersections().find((m) => Math.hypot(m.x - p.x, m.z - p.z) < 2); return n ? { arms: n.arms.length, bulb: n.arms[0].bulb } : null; };
      const out = {};
      w.addRoad(P(0, 2), P(4, 2), 'street', { snapNodes: true });            // lone 32 m segment
      await H.frames(3);
      out.lone = [bulbAt(P(0, 2)), bulbAt(P(4, 2))];
      w.addRoad(P(0, 10), P(19, 10), 'street', { snapNodes: true });         // a long street...
      w.addRoad(P(10, 10), P(10, 19), 'street', { snapNodes: true });        // ...with a 72 m dead-end branch
      w.addRoad(P(4, 10), P(4, 12), 'street', { snapNodes: true });          // ...and a 16 m stub
      await H.frames(3);
      out.branch = bulbAt(P(10, 19)); out.stub = bulbAt(P(4, 12)); out.throughEnd = bulbAt(P(0, 10));
      out.audit = roads.audit ? roads.audit().ok : null;
      for (const e of [...w.roads.edges.values()]) { const a = w.roads.nodes.get(e.a); if (a.x >= P(0, 0).x - 4 && a.x <= P(19, 0).x + 4 && a.z >= P(0, 0).z - 4 && a.z <= P(0, 19).z + 4) w.removeRoad(e.id); }
      await H.frames(3);
      return out;
    });
    check(!bulbs.err && bulbs.lone.every((n) => n && n.arms === 1 && n.bulb === 0), `J: a lone 32 m street ends square at both ends (${JSON.stringify(bulbs.lone)})`);
    check(!bulbs.err && bulbs.branch?.bulb > 0 && bulbs.throughEnd?.bulb > 0, `J: a real dead-end street keeps its cul-de-sac (branch ${bulbs.branch?.bulb}, street end ${bulbs.throughEnd?.bulb})`);
    check(!bulbs.err && bulbs.stub?.bulb === 0, `J: a 16 m stub ends square (${JSON.stringify(bulbs.stub)})`);

    // I: a road drawn with the tool is paid for
    const rd = await page.evaluate(async () => {
      const c = window.__city, w = c.world, H = window.__pt;
      const sim = c.ctx.modules.get('simulation').api;
      const o = H.openLand(10, 2);
      if (!o) return { err: 'no open land' };
      const A = w.cellToWorld(o.i + 1, o.j + 5), B = w.cellToWorld(o.i + 8, o.j + 5);
      const y = w.getHeight(A.x, A.z);
      c.ctx.camera.position.set((A.x + B.x) / 2, y + 110, A.z + 0.5);
      c.ctx.controls.target.set((A.x + B.x) / 2, y, A.z);
      c.ctx.controls.update();
      await H.frames(6);
      const r = c.ctx.renderer.domElement.getBoundingClientRect();
      const scr = (p) => { const v = new c.THREE.Vector3(p.x, w.getHeight(p.x, p.z), p.z).project(c.ctx.camera); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; };
      sim.tick(true);
      return { a: scr(A), b: scr(B), money: sim.getStats().money, net: sim.getBudget().perTick.net, edges: w.roads.edges.size, services: sim.getBudget().perDay.expenses.services, pop: sim.getStats().population };
    });
    if (rd.err) check(false, `I: ${rd.err}`);
    else {
      await page.evaluate(() => window.__city.ctx.modules.get('ui').api.setTool('road:street'));
      await page.mouse.move(rd.a[0], rd.a[1]);
      await page.mouse.down();
      await page.mouse.move((rd.a[0] + rd.b[0]) / 2, rd.a[1], { steps: 4 });
      await page.mouse.move(rd.b[0], rd.b[1], { steps: 4 });
      await page.evaluate(() => window.__pt.frames(2));
      await page.mouse.up();
      await page.evaluate(() => window.__pt.frames(4));
      const after = await page.evaluate(() => {
        const c = window.__city, sim = c.ctx.modules.get('simulation').api;
        const toast = [...document.querySelectorAll('.lc-toast, [class*="toast"]')].map((t) => t.textContent).filter((t) => /built/.test(t)).pop() || '';
        sim.tick(true);
        c.ctx.modules.get('ui').api.setTool(null);
        return { money: sim.getStats().money, edges: c.world.roads.edges.size, toast };
      });
      const quoted = Number((after.toast.match(/\$([\d,]+)/) || [])[1]?.replace(/,/g, '') || NaN);
      const paid = rd.money - after.money;
      check(after.edges === rd.edges + 1 && Number.isFinite(quoted) && quoted > 1000, `I: the street was built and quoted a price ("${after.toast}")`);
      check(Math.abs(paid - quoted) < Math.abs(rd.net) * 4 + 50, `I: the treasury paid it ($${paid} for a $${quoted} street)`);
    }

    // G: zone 6 road-adjacent cells in the mature city
    const g = await page.evaluate(async () => {
      const c = window.__city, w = c.world, H = window.__pt;
      const sim = c.ctx.modules.get('simulation').api;
      const W = w.size.w;
      const roadAdj = (i, j) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => w.cellAt(i + a, j + b)?.type === 'road');
      const terr = c.ctx.modules.get('terrain').api;
      const cells = [];
      for (let j = 4; j < w.size.h - 4 && cells.length < 6; j++) for (let i = 4; i < W - 4 && cells.length < 6; i++) {
        const cc = w.cellAt(i, j);
        if (cc.type === 'none' && !cc.zone && !cc.buildingId && roadAdj(i, j) && terr.isBuildable(i, j)) cells.push({ i, j });
      }
      const emptyZoned = () => { let n = 0; for (const cc of w.cells) if (cc.zone && !cc.buildingId && cc.type === 'zone') n++; return n; };
      // A mature city's demand idles under the 0.3 gate (0.04-0.25 in the playtest at 38k population). The freshly
      // booted demo is not there yet, so hold demand at 0.1 for the test: the buildings module reads it per pass.
      const realDemand = sim.getDemand;
      sim.getDemand = () => ({ r: 0.1, c: 0.1, i: 0.1 });
      const demand = sim.getDemand();
      const b0 = w.buildings.size, e0 = emptyZoned();
      // control: with nothing zoned by the player, the mature city does not grow on its old empty lots
      c.setTimeScale(4);
      await H.frames(400);
      const control = { buildings: w.buildings.size - b0, emptyZoned: e0 - emptyZoned() };
      for (const p of cells) w.setZone(p.i, p.j, 'r', 1);
      const b1 = w.buildings.size;
      let frames = 0, filled = 0;
      while (frames < 750 && filled < cells.length) { // 750 frames at 4x = 50 game-seconds = 2 game-hours
        await H.frames(30); frames += 30;
        filled = cells.filter((p) => w.cellAt(p.i, p.j).buildingId).length;
      }
      c.setTimeScale(1);
      sim.getDemand = realDemand;
      return { demand, cells: cells.length, filled, frames, control, others: w.buildings.size - b1 - filled, demandAfter: sim.getDemand(), errors: c.stats().errors };
    });
    check(g.demand.r <= 0.3, `G setup: demand held under the old gate, as in a mature city (${g.demand.r})`);
    check(g.control.buildings === 0, `G: untouched, the mature city spawns nothing on its old empty lots (${g.control.buildings} in 400 frames at 4x)`);
    check(g.cells === 6 && g.filled === 6, `G: 6 newly zoned cells fill within 2 game-hours at 4x (${g.filled}/6 after ${g.frames} frames)`);
    check(g.others === 0, `G: nothing else was spawned meanwhile (${g.others})`);
    // I: let the city mature. Income grows several-fold; the net must stay in the low five figures per day.
    const eco = await page.evaluate(async () => {
      const c = window.__city, sim = c.ctx.modules.get('simulation').api;
      c.setTimeScale(4);
      const snap = () => { const st = sim.getStats(), b = sim.getBudget().perDay; return { pop: st.population, income: Math.round(b.income.total), services: Math.round(b.expenses.services), net: Math.round(b.net), money: Math.round(st.money) }; };
      const first = snap();
      const rows = [];
      for (let k = 0; k < 30; k++) { for (let t = 0; t < 80; t++) sim.tick(true); await c.frames(24); if (k % 10 === 9) rows.push(snap()); }
      c.setTimeScale(1);
      return { first, rows, errors: c.stats().errors };
    });
    const last = eco.rows[eco.rows.length - 1];
    check(last.pop > 18000 && last.income > boot0.income * 1.5, `I setup: the city matured (pop ${boot0.pop} -> ${last.pop}, income/day $${boot0.income} -> $${last.income})`);
    check(last.services > 0, `I: city services are charged past 11,000 residents ($${last.services}/day)`);
    check(eco.rows.every((r) => r.net > 10000 && r.net < 90000), `I: net/day stays in the low five figures as the city grows (${eco.rows.map((r) => `$${r.net} @ ${r.pop}`).join(', ')})`);
    check(g.errors.length === 0 && eco.errors.length === 0, `Tier 2 page: no console errors (${g.errors.length + eco.errors.length})`);
  } finally { await app.close(); }
}

// ---- page 5: Continue from the title screen (no fixeddt) --------------------------------------------------------
{
  const app = await boot({});
  const { page } = app;
  try {
    await page.goto(`${BASE_URL}/?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__city && window.__city.ready === true, { timeout: 90000, polling: 100 });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((x) => /Continue/.test(x.textContent)), { timeout: 30000 });
    const cam = await page.evaluate(async () => {
      const c = window.__city.ctx;
      const title = { y: c.camera.position.y, fov: c.camera.fov };
      [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)).click();
      await new Promise((r) => setTimeout(r, 300));
      const play = { y: c.camera.position.y, fov: c.camera.fov };
      // Quit to Title -> Continue keeps the player's own camera
      c.camera.position.set(120, 150, 60); c.controls.target.set(100, 0, 0); c.controls.update();
      const mine = c.camera.position.toArray();
      c.modules.get('menu').api.openPause();
      await new Promise((r) => setTimeout(r, 200));
      [...document.querySelectorAll('.lc-menu-item')].find((b) => /Quit/.test(b.textContent)).click();
      await new Promise((r) => setTimeout(r, 300));
      const dlg = [...document.querySelectorAll('button')].find((b) => /^(Quit|Yes|Confirm|OK)/.test(b.textContent.trim()) && !b.classList.contains('lc-menu-item'));
      if (dlg) { dlg.click(); await new Promise((r) => setTimeout(r, 300)); }
      const atTitle = [...document.querySelectorAll('button')].some((x) => /Continue/.test(x.textContent));
      if (atTitle) { [...document.querySelectorAll('button')].find((x) => /Continue/.test(x.textContent)).click(); await new Promise((r) => setTimeout(r, 300)); }
      const back = c.camera.position.toArray();
      return { title, play, atTitle, restored: Math.hypot(back[0] - mine[0], back[1] - mine[1], back[2] - mine[2]) };
    });
    check(cam.title.y < 60 && cam.play.y > 150 && cam.play.fov >= 45, `J: Continue leaves the low title camera for an overview (y ${cam.title.y.toFixed(0)} -> ${cam.play.y.toFixed(0)}, fov ${cam.title.fov} -> ${cam.play.fov})`);
    check(cam.atTitle && cam.restored < 1, `J: Quit to Title then Continue restores the player's own camera (off by ${cam.restored.toFixed(2)} m)`);
  } finally { await app.close(); }
}

console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
