#!/usr/bin/env node
// Functional check for disasters (tornado: Wave D2, brick destruction: D3).
//   node tools/check-disasters.mjs
// Full game via tools/shot.mjs's openApp. Proves, through the real toolbar path and the public APIs:
//   1. the Hazards button spawns exactly one tornado at the clicked spot;
//   2. it travels along the world wind at SPEED (measured against the simulation's own game clock);
//   3. buildings in its path take damage (b.damage > 0) and the damage is billed (stats.disasterCost,
//      budget.expenses.disasters, the Treasury row);
//   4. it dissipates at LIFE_SEC, the cost line returns to zero, and damaged buildings repair over sim ticks;
//   5. save/load round-trips an active tornado (position/age) and the damage scars;
//   6. (D3) a storm aimed at a dense block strips and destroys buildings: no ghost geometry on the frame a building
//      is removed, the lot keeps its zoning and regrows, props and cars are picked up, the brick pool stays bounded,
//      the storm sky is set and given back, stripped facades survive save/load and come back with repair.
// Writes shots/disasters/d3/*.png + summary.json. Exit 1 on any failed check.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';

const OUT = 'shots/disasters/d3';
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^(before|after|storm-|aimed-|summary)/.test(f)) fs.rmSync(path.join(OUT, f), { force: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const TICK_DT = 0.5, SPEED = 11, LIFE_SEC = 60;

const app = await openApp({ seed: 1, tod: 12 });
const { page } = app;
const captureErrors = [];
const disActive = () => page.evaluate(() => window.__city.ctx.modules.get('disasters').api.getActive());
const disDamage = () => page.evaluate(() => window.__city.ctx.modules.get('disasters').api.getDamageTotal());
const disStats = () => page.evaluate(() => window.__city.ctx.modules.get('disasters').api.getStats());
const weather = () => page.evaluate(() => { const w = window.__city.ctx.world.weather; return { kind: w.kind, intensity: w.intensity, wind: [w.wind[0], w.wind[1]] }; });
const sameWeather = (a, b) => a.kind === b.kind && Math.abs(a.intensity - b.intensity) < 1e-6 && Math.abs(a.wind[0] - b.wind[0]) < 1e-6 && Math.abs(a.wind[1] - b.wind[1]) < 1e-6;
const drawCalls = () => page.evaluate(async () => { await window.__city.frames(4); return window.__city.stats().drawCalls; });
void drawCalls;

try {
  await page.evaluate(() => window.__city.frames(90));
  await page.evaluate(() => { window.__city.pause(); window.__city.setCamera('aerial'); });
  await page.evaluate(() => window.__city.frames(10));
  // ledger hooks: sum what the model actually billed vs what the damage events say was applied
  await page.evaluate(() => {
    const ctx = window.__city.ctx;
    window.__ledger = { charged: 0, applied: 0 };
    ctx.events.on('sim:tick', (p) => { window.__ledger.charged += p.stats.disasterCost || 0; });
    ctx.events.on('disaster:damage', (e) => { window.__ledger.applied += e.amount || 0; });
    // D3 hooks. liveTris: non-degenerate triangles of the drawn building meshes whose centroid is inside a lot.
    const cs = ctx.world.cellSize;
    window.__liveTris = (b) => {
      const x0 = ctx.world.minX + b.i * cs + 0.2, x1 = ctx.world.minX + (b.i + b.w) * cs - 0.2;
      const z0 = ctx.world.minZ + b.j * cs + 0.2, z1 = ctx.world.minZ + (b.j + b.d) * cs - 0.2;
      let n = 0;
      ctx.scene.getObjectByName('buildings').traverse((o) => {
        if (!o.isMesh || o.isInstancedMesh || !o.userData.byId) return;
        const a = o.geometry.attributes.position.array;
        for (let i = 0; i < a.length; i += 9) {
          const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
          if (cx < x0 || cx > x1 || cz < z0 || cz > z1) continue;
          const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2];
          const vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
          const ax = uy * vz - uz * vy, ay = uz * vx - ux * vz, az = ux * vy - uy * vx;
          if (ax * ax + ay * ay + az * az > 1e-10) n++;
        }
      });
      return n;
    };
    // every building a storm removes: ghost triangles and lot state at the moment of removal (same frame)
    window.__dz = { armed: false, removed: [] };
    ctx.events.on('building:removed', ({ building: b }) => {
      if (!window.__dz.armed) return;
      const cells = [];
      for (let j = b.j; j < b.j + b.d; j++) for (let i = b.i; i < b.i + b.w; i++) { const c = ctx.world.cellAt(i, j); cells.push({ i, j, type: c.type, zone: c.zone, buildingId: c.buildingId }); }
      window.__dz.removed.push({ id: b.id, zone: b.zone, kind: b.kind, ghost: window.__liveTris(b), cells });
    });
  });
  captureErrors.push(...(await app.capture(path.join(OUT, 'before.png'), { settle: 10, sampleMs: 400 })).errors);
  const weather0 = await weather();

  // 1. spawn through the real toolbar button + a canvas click over the city
  const btnOk = await page.evaluate(() => !!document.querySelector('button[data-tool="hazard:tornado"]'));
  check(btnOk, 'Hazards toolbar has the Tornado button');
  await page.click('button[data-tool="hazard:tornado"]');
  await page.mouse.click(960, 540);
  await page.evaluate(() => window.__city.frames(6));
  const a0 = await disActive();
  check(a0.length === 1, `toolbar click spawns exactly one tornado (got ${a0.length})`);
  check(!!a0[0] && Number.isFinite(a0[0].x) && Number.isFinite(a0[0].z), 'tornado has a world position');
  const pausedVisible = await page.evaluate(() => !!window.__city.ctx.scene.getObjectByName('disasters')?.visible);
  check(pausedVisible, 'a tornado spawned while paused is visible immediately (strength floor at spawn)');
  const weather1 = await weather();
  check(weather1.kind === 'rain' && weather1.intensity >= 0.9 && Math.hypot(...weather1.wind) >= 3,
    `storm sky and gale set at touchdown (${weather1.kind} ${weather1.intensity}, |wind| ${Math.hypot(...weather1.wind).toFixed(1)}; was ${weather0.kind} ${weather0.intensity})`);
  const windAlong = a0[0] ? (weather1.wind[0] * a0[0].dirX + weather1.wind[1] * a0[0].dirZ) / Math.hypot(...weather1.wind) : 0;
  const dir0 = a0[0] ? (weather0.wind[0] * a0[0].dirX + weather0.wind[1] * a0[0].dirZ) / Math.hypot(...weather0.wind) : 0;
  check(dir0 > 0.999 && windAlong > 0.999, `path follows the wind it was dropped in, and the storm wind blows along the path (${dir0.toFixed(4)}, ${windAlong.toFixed(4)})`);

  // second click while one is active must be refused
  await page.mouse.click(1000, 560);
  await page.evaluate(() => window.__city.frames(4));
  check((await disActive()).length === 1, 'a second spawn is refused while one is active (one at a time)');

  // 2. travel: run 6 game-seconds at 4× and compare distance against the game clock
  const t0 = await page.evaluate(() => ({ tick: window.__city.ctx.modules.get('simulation').api.getStats().tick, t: window.__city.ctx.modules.get('disasters').api.getActive()[0] }));
  await page.evaluate(async () => { window.__city.setTimeScale(4); await window.__city.frames(120); });
  await page.evaluate(async () => { await window.__city.frames(60); });
  const t1 = await page.evaluate(() => ({ tick: window.__city.ctx.modules.get('simulation').api.getStats().tick, t: window.__city.ctx.modules.get('disasters').api.getActive()[0] }));
  const dtGame = (t1.tick - t0.tick) * TICK_DT;
  const dist = Math.hypot(t1.t.x - t0.t.x, t1.t.z - t0.t.z);
  check(dtGame > 3, `game clock advanced (${dtGame.toFixed(1)} s)`);
  check(Math.abs(dist - SPEED * dtGame) < 0.15 * SPEED * dtGame + 2, `tornado travels at SPEED along the wind: ${dist.toFixed(1)} m in ${dtGame.toFixed(1)} s (expect ≈ ${(SPEED * dtGame).toFixed(1)} m)`);
  const dirDot = (t1.t.dirX * t0.t.dirX + t1.t.dirZ * t0.t.dirZ);
  check(dirDot > 0.999, 'direction stays constant (straight path)');

  // 3. damage + billing
  await page.evaluate(async () => { window.__city.setTimeScale(8); await window.__city.frames(120); });
  await page.evaluate(async () => { await window.__city.frames(120); });
  const dmg = await page.evaluate(() => {
    const d = window.__city.ctx.modules.get('disasters').api;
    const s = window.__city.ctx.modules.get('simulation').api;
    let hit = 0, max = 0;
    for (const b of window.__city.ctx.world.buildings.values()) { if (b.damage > 0) hit++; max = Math.max(max, b.damage || 0); }
    return { total: d.getDamageTotal(), hit, max, cost: s.getStats().disasterCost, budget: s.getBudget().perTick.expenses.disasters, perDay: s.getBudget().perDay.expenses.disasters, active: d.getActive().length };
  });
  check(dmg.total > 0.05 && dmg.hit > 0, `buildings took damage: ${dmg.hit} hit, total ${dmg.total.toFixed(2)}, worst ${dmg.max.toFixed(2)}`);
  check(dmg.cost > 0 && dmg.budget > 0, `insurance cost is billed: ${dmg.cost.toFixed(1)} $/tick (${dmg.perDay.toFixed(0)} $/day)`);
  check(dmg.active >= 1, 'tornado is still active mid-storm');
  // chase the funnel: a fixed camera relative to its live position, at noon and dusk
  for (const [tod, name] of [[12, 'storm-chase-day'], [17.7, 'storm-chase-dusk']]) {
    await page.evaluate(({ tod }) => {
      const ctx = window.__city.ctx;
      const t = ctx.modules.get('disasters').api.getActive()[0];
      if (!t) return;
      const gy = ctx.world.getHeight(t.x, t.z);
      window.__city.setCamera({ pos: [t.x - 150, gy + 66, t.z + 190], target: [t.x, gy + 26, t.z], fov: 45 });
      window.__city.setTime(tod);
    }, { tod });
    const log = await app.capture(path.join(OUT, `${name}.png`), { settle: 8, sampleMs: 300 });
    captureErrors.push(...log.errors);
    if (name === 'storm-chase-day') check(log.gpuMs <= 20, `full-game storm chase GPU time ${log.gpuMs} ms <= 20 (${log.drawCalls} draws, ${log.triangles} triangles)`);
  }
  await page.evaluate(() => { window.__city.pause(); window.__city.setCamera('aerial'); });
  const treasuryRow = await page.evaluate(() => {
    // the Treasury modal opens from the HUD money plate (`.lc-stat-ico.money` bubbles to the plate's handler)
    document.querySelector('.lc-stat-ico.money')?.closest('.lc-stat')?.click();
    const row = [...document.querySelectorAll('.lc-kv span')].find((s) => /Disaster costs/.test(s.textContent));
    const val = row ? row.nextElementSibling?.textContent : null;
    document.querySelector('.lc-stat-ico.money')?.closest('.lc-stat')?.click();
    return { hasRow: !!row, value: val, open: !!window.__city.ctx.modules.get('ui').api.isModalOpen?.() };
  });
  if (treasuryRow.open) await page.keyboard.press('Escape');
  check(treasuryRow.hasRow, `Treasury modal shows a "Disaster costs / day" row (${treasuryRow.value})`);

  // 4. dissipate, cost back to 0, then repair
  await page.evaluate(async () => { window.__city.setTimeScale(20); await window.__city.frames(60); });
  await page.evaluate(async () => { await window.__city.frames(60); });
  const after = await page.evaluate(() => ({ active: window.__city.ctx.modules.get('disasters').api.getActive().length, tick: window.__city.ctx.modules.get('simulation').api.getStats().tick }));
  check(after.active === 0, `tornado dissipates within its lifetime (active ${after.active} after ${(after.tick * TICK_DT).toFixed(0)} game-s)`);
  const weather2 = await weather();
  check(sameWeather(weather2, weather0), `the weather from before the storm is back (${weather2.kind} ${weather2.intensity}, wind ${weather2.wind.map((v) => v.toFixed(2))})`);
  await page.evaluate(() => { const sim = window.__city.ctx.modules.get('simulation').api; for (let i = 0; i < 20; i++) sim.tick(true); });
  const cost0 = await page.evaluate(() => window.__city.ctx.modules.get('simulation').api.getStats().disasterCost);
  check(cost0 === 0, `disaster cost line returns to 0 after the storm (${cost0})`);
  const dmgBefore = await disDamage();
  await page.evaluate(() => { const sim = window.__city.ctx.modules.get('simulation').api; for (let i = 0; i < 400; i++) sim.tick(true); });
  const dmgAfter = await disDamage();
  check(dmgBefore > 0 && dmgAfter < dmgBefore, `damaged buildings repair over sim ticks (${dmgBefore.toFixed(3)} → ${dmgAfter.toFixed(3)} over 400 ticks)`);
  const ledger = await page.evaluate(() => window.__ledger);
  const expected = ledger.applied * 900;
  check(ledger.applied > 0 && Math.abs(ledger.charged - expected) < Math.max(2, 0.01 * expected),
    `billing is exact: charged $${ledger.charged.toFixed(1)} vs damage applied ${ledger.applied.toFixed(4)} × $900 = $${expected.toFixed(1)}`);
  await page.evaluate(() => window.__city.frames(10));
  captureErrors.push(...(await app.capture(path.join(OUT, 'after-storm.png'), { settle: 10, sampleMs: 300 })).errors);

  // 5. save/load round-trip with an active tornado
  await page.evaluate(() => {
    const d = window.__city.ctx.modules.get('disasters').api;
    d.clear();
    d.spawnTornado({ x: -180, z: 120, dirX: 0.6, dirZ: -0.8 });
  });
  await page.evaluate(async () => { window.__city.setTimeScale(4); await window.__city.frames(60); window.__city.pause(); });
  const pre = await page.evaluate(() => window.__city.ctx.modules.get('disasters').api.getActive()[0]);
  const save = await page.evaluate(async () => {
    const m = await import('/src/menu/serialize.js');
    return m.serializeSave(window.__city.ctx, { name: 'storm-save' });
  });
  await page.evaluate(() => { window.__city.ctx.modules.get('disasters').api.clear(); });
  const cleared = await page.evaluate(() => window.__city.ctx.modules.get('disasters').api.getActive().length);
  check(cleared === 0 && (save.disasters?.tornadoes?.length ?? 0) === 1, `save contains the active tornado (${save.disasters?.tornadoes?.length ?? 0})`);
  await page.evaluate(async (save) => {
    const m = await import('/src/menu/serialize.js');
    m.applySave(window.__city.ctx, save);
  }, save);
  await page.evaluate(() => window.__city.frames(6));
  const post = await page.evaluate(() => window.__city.ctx.modules.get('disasters').api.getActive()[0]);
  check(!!post && Math.abs(post.x - pre.x) < 40 && Math.abs(post.age - pre.age) < 2,
    `load restores the tornado near its saved position/age (x ${pre.x.toFixed(0)} → ${post ? post.x.toFixed(0) : 'none'}, age ${pre.age.toFixed(1)} → ${post ? post.age.toFixed(1) : 'none'})`);
  check(post && Math.abs(post.dirX - pre.dirX) < 1e-6 && Math.abs(post.dirZ - pre.dirZ) < 1e-6, 'load restores the path direction');

  // crafted saves are sanitised: two tornadoes -> one; non-finite fields are dropped instead of freezing
  const crafted = await page.evaluate(() => {
    const d = window.__city.ctx.modules.get('disasters').api;
    d.clear();
    d.loadState({ tornadoes: [
      { id: 1, x: 0, z: 0, dirX: 1, dirZ: 0, age: 3, life: 60 },
      { id: 2, x: 10, z: 10, dirX: 1, dirZ: 0, age: 3, life: 60 },
    ] });
    const capped = d.getActive().length;
    d.loadState({ tornadoes: [{ id: 3, x: null, z: 0, dirX: 1, dirZ: 0, age: 3, life: 60 }] });
    const bogus = d.getActive().length;
    d.loadState({ tornadoes: [{ id: 4, x: 1e9, z: 0, dirX: 0, dirZ: 0, age: -5, life: 1e6 }], prevWeather: { kind: 'lava', intensity: 1e9 }, shedding: [{ id: 'nope' }, null, 7] });
    const t = d.getActive()[0];
    const bounded = !!t && Number.isFinite(t.x) && Math.abs(t.x) < 2000 && Number.isFinite(t.dirX) && t.age >= 0 && t.life <= 240;
    d.clear();
    return { capped, bogus, bounded };
  });
  check(crafted.capped === 1, `a crafted 2-tornado save loads exactly one (got ${crafted.capped})`);
  check(crafted.bogus === 0, `non-finite fields are dropped, not frozen (got ${crafted.bogus})`);
  check(crafted.bounded, 'out-of-range x/life and a zero direction are clamped/normalised on load; bogus weather and shedding entries are ignored');
  const weather3 = await weather();
  check(sameWeather(weather3, weather0), `no storm sky is left behind by cleared and crafted storms (${weather3.kind} ${weather3.intensity})`);

  // ---- 6. D3: a storm aimed at the densest block -------------------------------------------------------------
  // hidden props stay hidden when the camera moves (the props LOD pass rewrites instance matrices)
  const propHide = await page.evaluate(async () => {
    const c = window.__city, ctx = c.ctx, P = ctx.modules.get('props').api;
    const p = [...ctx.world.props.values()].find((q) => q.kind === 'tree' || q.kind === 'streetlamp') || [...ctx.world.props.values()][0];
    const parts = P.getPropParts(p.id);
    P.hideProps([p.id]);
    c.setCamera({ pos: [p.x + 40, p.y + 30, p.z + 40], target: [p.x, p.y, p.z] });
    await c.frames(3);
    c.setCamera({ pos: [p.x - 60, p.y + 25, p.z + 10], target: [p.x, p.y, p.z] });
    await c.frames(3);
    const left = P.getPropParts(p.id).length;
    const scene = ctx.scene.getObjectByName(`props-${parts[0]?.role}`);
    ctx.world.removeProp(p.id);
    await c.frames(12);
    c.setCamera('aerial');
    return { kind: p.kind, parts: parts.length, left, hasMesh: !!scene, finite: parts.every((q) => q.size.every(Number.isFinite) && q.center.every(Number.isFinite)) };
  });
  check(propHide.parts > 0 && propHide.left === 0 && propHide.finite, `a hidden prop (${propHide.kind}, ${propHide.parts} pieces) stays hidden across camera moves`);

  const aim = await page.evaluate(() => {
    const ctx = window.__city.ctx, world = ctx.world;
    const list = [...world.buildings.values()].filter((b) => b.zone).map((b) => ({ b, c: world.cellToWorld(b.i + (b.w - 1) / 2, b.j + (b.d - 1) / 2) }));
    let best = null, bestN = -1;
    for (const p of list) {
      let n = 0;
      for (const q of list) if (Math.abs(q.c.z - p.c.z) < 22 && q.c.x - p.c.x > -10 && q.c.x - p.c.x < 160) n++;
      if (n > bestN) { bestN = n; best = p; }
    }
    return { x: best.c.x - 45, z: best.c.z, lane: bestN, buildings: world.buildings.size, props: world.props.size, cars: ctx.modules.get('traffic').api.getVehicleCount() };
  });
  await page.evaluate((aim) => {
    const d = window.__city.ctx.modules.get('disasters').api;
    d.clear();
    window.__dz.armed = true; window.__dz.removed.length = 0;
    d.spawnTornado({ x: aim.x, z: aim.z, dirX: 1, dirZ: 0 });
    window.__city.setTime(12);
  }, aim);
  // run until it has both stripped and destroyed something (4x, at most ~40 game-seconds)
  let st = null, peak = { live: 0, total: 0 };
  for (let k = 0; k < 40; k++) {
    st = await page.evaluate(async () => { window.__city.setTimeScale(4); await window.__city.frames(15); return window.__city.ctx.modules.get('disasters').api.getStats(); });
    peak = { live: Math.max(peak.live, st.bricks.live), total: Math.max(peak.total, st.bricks.live + st.bricks.rubble + st.bricks.fading) };
    if (st.destroyed >= 2 && st.stripped >= 1 && st.bricks.live > 200) break;
  }
  await page.evaluate(() => window.__city.pause());
  await page.evaluate(() => {
    const ctx = window.__city.ctx;
    const t = ctx.modules.get('disasters').api.getActive()[0];
    if (!t) return;
    const gy = ctx.world.getHeight(t.x, t.z);
    window.__city.setCamera({ pos: [t.x - 70, gy + 38, t.z + 95], target: [t.x + 6, gy + 16, t.z], fov: 45 });
  });
  captureErrors.push(...(await app.capture(path.join(OUT, 'aimed-storm.png'), { settle: 6, sampleMs: 300 })).errors);
  st = await disStats();
  const dz = await page.evaluate(() => window.__dz.removed);
  check(st.destroyed >= 1 && dz.length === st.destroyed, `the core destroys buildings in a dense block: ${st.destroyed} destroyed (lane of ${aim.lane}), ${st.stripped} stripped (${st.hiddenParts} parts hidden)`);
  const ghosts = dz.filter((r) => r.ghost > 0);
  check(dz.length > 0 && ghosts.length === 0, `no ghost: 0 drawn triangles left in the lot on the frame of removal (${dz.length} removals, worst ${Math.max(0, ...dz.map((r) => r.ghost))})`);
  const zoned = dz.filter((r) => r.zone);
  const badCells = zoned.flatMap((r) => r.cells).filter((c) => c.type !== 'zone' || !c.zone || c.buildingId);
  check(zoned.length > 0 && badCells.length === 0, `destroyed lots keep their zoning: ${zoned.flatMap((r) => r.cells).length} cells are type 'zone' with the zone kept (${badCells.length} wrong)`);
  check(st.bricks.spawned > 100 && peak.live > 0, `buildings come apart as bricks: ${st.bricks.spawned} spawned, ${peak.live} in the air at peak, ${st.bricks.rubble} lying as rubble now`);
  check(peak.live <= st.bricks.liveMax && peak.total <= st.bricks.capacity, `brick pool is bounded: peak ${peak.live} live <= ${st.bricks.liveMax}, ${peak.total} drawn <= ${st.bricks.capacity} (${st.bricks.dropped} dropped, ${st.bricks.recycled} recycled)`);
  const colours = await page.evaluate(() => {
    const m = window.__city.ctx.scene.getObjectByName('bricks:2x4');
    const set = new Set(); const a = m.instanceColor.array;
    for (let i = 0; i < m.count * 3; i += 3) set.add(`${a[i].toFixed(2)},${a[i + 1].toFixed(2)},${a[i + 2].toFixed(2)}`);
    return { n: set.size, visible: m.visible, count: m.count };
  });
  check(colours.visible && colours.n >= 3, `bricks keep their buildings' colours (${colours.n} distinct colours on ${colours.count} bricks)`);
  check(st.propsTaken > 0, `street props in the core are picked up (${st.propsTaken} props, ${st.carsTaken} cars)`);

  // save/load mid-storm: one tornado, the same stripped facades
  const mid = await page.evaluate(async () => {
    const ctx = window.__city.ctx, d = ctx.modules.get('disasters').api;
    const m = await import('/src/menu/serialize.js');
    const before = d.getStats();
    const save = m.serializeSave(ctx, { name: 'storm-save-d3' });
    const sid = save.disasters.shedding[0]?.id;
    const b = sid ? ctx.world.buildings.get(sid) : null;
    const trisStripped = b ? window.__liveTris(b) : -1;
    window.__dz.armed = false;
    m.applySave(ctx, JSON.parse(JSON.stringify(save)));
    // from here on, tag the lot cells of every building the storm removes (for the regrowth check)
    ctx.events.on('building:removed', ({ building: q }) => {
      if (!d.getActive().length || !q.zone) return;
      for (let j = q.j; j < q.j + q.d; j++) for (let i = q.i; i < q.i + q.w; i++) ctx.world.cellAt(i, j).regrowProbe = true;
    });
    await window.__city.frames(4);
    const after = d.getStats();
    const b2 = sid ? ctx.world.buildings.get(sid) : null;
    // the reloaded building is whole in its own geometry; what is drawn must be stripped again once merged
    let n = 0;
    while (n++ < 4000) { await window.__city.frames(1); const s = ctx.modules.get('buildings').api.stats(); if (!s.dirtyChunks && !s.rebuilding) break; }
    const trisAfter = b2 ? window.__liveTris(b2) : -2;
    const whole = b2 ? ctx.modules.get('buildings').api.getParts(sid).parts.length : 0;
    return { tornadoes: d.getActive().length, before, after, saved: save.disasters, trisStripped, trisAfter, whole, weather: { ...ctx.world.weather } };
  });
  check(mid.tornadoes === 1 && mid.saved.shedding.length === mid.before.stripped && mid.saved.shedding.length > 0,
    `a mid-storm save holds the tornado and ${mid.saved.shedding.length} stripped buildings, and the weather to give back (${mid.saved.prevWeather?.kind})`);
  check(mid.after.stripped === mid.before.stripped && mid.after.hiddenParts === mid.before.hiddenParts,
    `load re-applies the stripped facades: ${mid.after.stripped} buildings / ${mid.after.hiddenParts} parts hidden (saved ${mid.before.stripped} / ${mid.before.hiddenParts})`);
  check(mid.trisStripped > 0 && mid.trisAfter === mid.trisStripped, `and the drawn facade is the same after the reload (${mid.trisStripped} triangles before, ${mid.trisAfter} after)`);
  check(mid.weather.kind === 'rain', `the loaded storm keeps its sky (${mid.weather.kind})`);

  // repair gives a stripped building its facade back (damage set to what ~1500 ticks of FIRE_REPAIR_RATE leave)
  const repair = await page.evaluate(async () => {
    const ctx = window.__city.ctx, d = ctx.modules.get('disasters').api, sim = ctx.modules.get('simulation').api, B = ctx.modules.get('buildings').api;
    const sid = d.getState().shedding[0]?.id;
    if (!sid) return { sid: null };
    const b = ctx.world.buildings.get(sid);
    const stripped = window.__liveTris(b);
    b.damage = 0.2; // below SHED_START
    sim.tick(true);
    let n = 0;
    while (n++ < 4000) { await window.__city.frames(1); const s = B.stats(); if (!s.dirtyChunks && !s.rebuilding) break; }
    return { sid, stripped, restored: window.__liveTris(b), still: d.getState().shedding.some((e) => e.id === sid) };
  });
  check(repair.sid && !repair.still && repair.restored > repair.stripped, `a repaired building gets its facade back (${repair.stripped} → ${repair.restored} drawn triangles)`);

  // what the storm itself costs in draw calls: the same paused frame with and without it (bricks in the air)
  const cost = await page.evaluate(async () => {
    const c = window.__city, ctx = c.ctx, d = ctx.modules.get('disasters').api;
    c.setCamera('aerial');
    // bring the storm back to a state with bricks flying after the reload (which drops them)
    c.setTimeScale(4); await c.frames(45); c.pause();
    const st = d.getStats();
    await c.frames(6);
    const storm = c.stats().drawCalls;
    const state = d.getState();
    d.clear();
    await c.frames(6);
    const idle = c.stats().drawCalls;
    d.loadState(state);
    await c.frames(2);
    return { storm, idle, live: st.bricks.live, rubble: st.bricks.rubble, back: d.getActive().length, weather: ctx.world.weather.kind };
  });
  check(cost.storm - cost.idle <= 10 && cost.live + cost.rubble > 0, `the storm adds at most 10 draw calls to the whole frame (${cost.idle} without, ${cost.storm} with ${cost.live} bricks flying and ${cost.rubble} lying)`);
  check(cost.back === 1 && cost.weather === 'rain', 'clear() then loadState(getState()) brings the storm and its sky back');

  // let it blow out; the weather comes back, props are gone from the world, the pool drains
  for (let k = 0; k < 30; k++) {
    const n = await page.evaluate(async () => { window.__city.setTimeScale(20); await window.__city.frames(30); return window.__city.ctx.modules.get('disasters').api.getActive().length; });
    if (!n) break;
  }
  await page.evaluate(() => window.__city.pause());
  const endStats = await disStats();
  const end = await page.evaluate(() => ({ active: window.__city.ctx.modules.get('disasters').api.getActive().length, props: window.__city.ctx.world.props.size, buildings: window.__city.ctx.world.buildings.size }));
  const weather4 = await weather();
  check(end.active === 0 && sameWeather(weather4, weather0), `after the loaded storm ends the original weather is restored (${weather4.kind} ${weather4.intensity})`);
  check(end.props < aim.props, `picked-up props left the world (${aim.props} → ${end.props})`);

  // regrowth: the lots this storm emptied are zoned, and the growth pass builds on them first once it has gone
  check(endStats.destroyed > 0, `the reloaded storm went on to destroy ${endStats.destroyed} buildings`);
  const lots = await page.evaluate(() => {
    const world = window.__city.ctx.world, W = world.size.w, H = world.size.h;
    const out = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (world.cells[j * W + i].regrowProbe) out.push(j * W + i);
    return out;
  });
  let regrown = 0, grewAfter = 0;
  for (let k = 0; k < 60 && regrown < Math.min(3, lots.length); k++) {
    regrown = await page.evaluate(async (lots) => {
      window.__city.setTimeScale(8); await window.__city.frames(30);
      const cells = window.__city.ctx.world.cells;
      return lots.filter((k) => cells[k].buildingId).length;
    }, lots);
    grewAfter = (k + 1) * 30 * 8 / 60;
  }
  await page.evaluate(() => window.__city.pause());
  check(regrown > 0, `destroyed lots regrow: ${regrown} of ${lots.length} cells built on again within ${grewAfter.toFixed(0)} game-s`);
  const drained = await disStats();
  check(drained.bricks.live === 0, `no brick is left in the air after the storm (${drained.bricks.live} live, ${drained.bricks.rubble} rubble, ${drained.bricks.fading} fading)`);
  const cars = await page.evaluate(() => window.__city.ctx.modules.get('traffic').api.getVehicleCount());
  check(cars >= aim.cars * 0.9, `picked-up cars are back on the road (${aim.cars} before, ${cars} now)`);

  const runtimeErrors = await page.evaluate(() => window.__city.stats().errors);
  check(runtimeErrors.length === 0, `no runtime errors (${runtimeErrors.length}${runtimeErrors.length ? ': ' + runtimeErrors[0] : ''})`);
  check(captureErrors.length === 0, `all captures report no errors (${captureErrors.length})`);
} finally {
  await app.close();
}

// 7. cross-boot determinism of the storm showcase: the funnel layout at spin-time 0 and the set of bricks the staged
// storm has released (positions and colours at release; where they fly afterwards is wall-clock animation) must hash
// identically on two fresh boots.
let bootHash = null;
for (let k = 0; k < 2; k++) {
  const app2 = await openApp({ showcase: 'disasters', variant: 'storm', seed: 1, tod: 12 });
  try {
    await app2.page.evaluate(async () => { await window.__city.frames(30); });
    const r = await app2.page.evaluate(() => {
      const d = window.__city.ctx.modules.get('disasters');
      const st = d.api.getStats();
      window.__city.pause();
      d.api.loadState(d.api.getState());   // re-lays the visuals out at time 0 (same frame: no rAF can interleave)
      const t = d.api.getActive()[0];
      const funnel = window.__city.ctx.scene.getObjectByName('tornado:funnel');
      let h = 0x811c9dc5;
      const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
      // layout + path only: the live position/age is animation state (wall-clock frames differ between boots)
      mix(`dir:${t.dirX},${t.dirZ},life:${t.life},spawn:${(t.x - t.dirX * 11 * t.age).toFixed(3)},${(t.z - t.dirZ * 11 * t.age).toFixed(3)}`);
      mix(`${funnel.count}`);
      const a = funnel.instanceMatrix.array;
      for (let i = 0; i < a.length; i += 5) mix(a[i].toFixed(4));
      return { hash: (h >>> 0).toString(16), st, debris: !!window.__city.ctx.scene.getObjectByName('tornado:debris') };
    });
    if (k === 0) {
      bootHash = r;
      check(!!r.hash, `storm showcase layout hash ${r.hash}`);
      check(r.st.destroyed > 0 && r.st.stripped > 0 && r.st.bricks.spawned > 300 && !r.debris,
        `the staged storm is already tearing the district up: ${r.st.destroyed} destroyed, ${r.st.stripped} stripped, ${r.st.bricks.spawned} bricks released (grey debris cubes gone: ${!r.debris})`);
    } else {
      check(r.hash === bootHash.hash, `cross-boot determinism: storm layout hash ${bootHash.hash} == ${r.hash}`);
      // the showcase pre-step is fixed; frames after it may release a few more parts, so compare the staged counts
      check(r.st.destroyed >= bootHash.st.destroyed && Math.abs(r.st.destroyed - bootHash.st.destroyed) <= 2,
        `cross-boot: destroyed ${bootHash.st.destroyed} vs ${r.st.destroyed}`);
    }
  } finally {
    await app2.close();
  }
}
// the pre-step itself, hashed with the clock paused from the first frame (nothing but the fixed steps has run)
let stagedHash = null;
for (let k = 0; k < 2; k++) {
  const app3 = await openApp({ showcase: 'disasters', variant: 'default', seed: 1, tod: 12 });
  try {
    const r = await app3.page.evaluate(async () => {
      window.__city.pause();
      await window.__city.showcase('disasters', 'storm');
      const st = window.__city.ctx.modules.get('disasters').api.getStats();
      return { hash: st.bricks.spawnHash, spawned: st.bricks.spawned, destroyed: st.destroyed, hidden: st.hiddenParts };
    });
    if (k === 0) { stagedHash = r; check(r.spawned > 300, `staged storm brick spawn set: ${r.spawned} bricks, hash ${r.hash}, ${r.destroyed} destroyed, ${r.hidden} parts stripped`); }
    else check(r.hash === stagedHash.hash && r.spawned === stagedHash.spawned && r.destroyed === stagedHash.destroyed && r.hidden === stagedHash.hidden,
      `cross-boot determinism: brick spawn set ${stagedHash.hash}/${stagedHash.spawned} == ${r.hash}/${r.spawned}`);
  } finally {
    await app3.close();
  }
}

fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ ok: failed === 0, failed, checks: results.length, results, captureErrors }, null, 2));
console.log(`\n[check-disasters] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
