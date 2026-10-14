#!/usr/bin/env node
// Functional check for disasters (tornado: Wave D2, brick destruction: D3, kaiju).
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
//      the storm sky is set and given back, stripped facades survive save/load and come back with repair;
//   7. the storm showcase is the same on two fresh boots;
//   8. the Kaiju button raises one kaiju, the next of the variants each time; a click with a hazard's own tool
//      sends it away and a click with the other tool replaces it (the api alone still refuses a second hazard); it walks,
//      stomps, sweeps its tail and breathes fire; what it tears down comes apart as bricks with no funnel, is billed
//      exactly, keeps its zoning and regrows; police and fire coverage shorten its rampage; it survives save/load
//      and crafted saves; it costs at most 10 draw calls; it leaves when its time is up;
//   9. the kaiju showcase is the same on two fresh boots.
// Writes shots/disasters/d3/*.png + summary.json. Exit 1 on any failed check.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';

const OUT = 'shots/disasters/d3';
fs.mkdirSync(OUT, { recursive: true });
for (const f of fs.readdirSync(OUT)) if (/^(before|after|storm-|aimed-|kaiju-|building-|summary)/.test(f)) fs.rmSync(path.join(OUT, f), { force: true });
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

  // a second click with the same tool sends the tornado away, at once, and the sky comes back; the next drops a new one
  const statusLine = () => page.evaluate(() => { const el = document.querySelector('.lc-status'); return el?.classList.contains('open') ? el.textContent : ''; });
  await page.mouse.move(990, 555);
  await page.mouse.move(1000, 560);
  const hint = await statusLine();
  await page.mouse.click(1000, 560);
  const hintAfter = await statusLine();
  check(/send the tornado away/.test(hint) && hintAfter === '', `hovering the map with the live hazard's own tool says what a click will do ("${hint}"), and the line clears once it is gone`);
  const gone = await page.evaluate(() => {
    const ctx = window.__city.ctx, d = ctx.modules.get('disasters').api;
    return { n: d.getActive().length, live: d.isActive(), funnel: !!ctx.scene.getObjectByName('disasters')?.visible };
  });
  const weatherGone = await weather();
  check(gone.n === 0 && !gone.live && !gone.funnel && sameWeather(weatherGone, weather0),
    `a second click with the Tornado tool sends the tornado away: none active, the funnel hidden on that frame, the sky given back (${weatherGone.kind} ${weatherGone.intensity})`);
  await page.mouse.click(960, 540);
  await page.evaluate(() => window.__city.frames(6));
  const a1 = await disActive();
  check(a1.length === 1 && a1[0].id !== a0[0]?.id && sameWeather(await weather(), weather1), `and the click after that drops a new one (id ${a0[0]?.id} → ${a1[0]?.id}) under the storm sky`);

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

  // ---- 8. kaiju ----------------------------------------------------------------------------------------------
  // The second city-scale hazard, through the same toolbar path and public APIs. Sections 1-6 leave tornado
  // residue in the ledger and the removal log: both start from zero here.
  await page.evaluate(() => {
    const c = window.__city, ctx = c.ctx, d = ctx.modules.get('disasters').api;
    d.clear();
    c.pause(); c.setCamera('aerial'); c.setTime(12);
    window.__ledger.charged = 0; window.__ledger.applied = 0;
    window.__dz.removed.length = 0; window.__dz.armed = true;
    const kz = window.__kz = { stomps: [], breaths: [], tail: 0, tremor: 0, ended: [], toasts: [], phases: [], probing: false };
    ctx.events.on('disaster:stomp', (e) => { const k = d.getKaiju(); kz.stomps.push({ hits: e.hits, off: k ? Math.hypot(e.x - k.x, e.z - k.z) : -1 }); });
    ctx.events.on('disaster:breath', (e) => {
      // every building it lit, as seen from the mouth
      const lit = e.ignited.map((id) => {
        const b = ctx.world.buildings.get(id);
        const p = ctx.world.cellToWorld(b.i + (b.w - 1) / 2, b.j + (b.d - 1) / 2);
        const dx = p.x - e.x, dz = p.z - e.z, ch = Math.cos(e.heading), sh = Math.sin(e.heading);
        return { dist: Math.hypot(dx, dz), angle: Math.abs(Math.atan2(dz * ch - dx * sh, dx * ch + dz * sh)), onFire: !!b.onFire };
      });
      kz.breaths.push({ n: e.ignited.length, lit });
    });
    ctx.events.on('disaster:damage', (e) => { if (e.source === 'tail') kz.tail += e.amount; else if (e.source === 'tremor') kz.tremor += e.amount; });
    ctx.events.on('disaster:ended', (e) => kz.ended.push({ ...e }));
    ctx.events.on('sim:tick', () => { const p = d.getStats().kaiju; if (p && !kz.phases.includes(p)) kz.phases.push(p); });
    ctx.events.on('building:removed', ({ building: q }) => {
      if (!kz.probing || !d.getKaiju() || !q.zone) return;
      for (let j = q.j; j < q.j + q.d; j++) for (let i = q.i; i < q.i + q.w; i++) ctx.world.cellAt(i, j).kaijuProbe = true;
    });
    const ui = ctx.modules.get('ui').api, notify = ui.notify;
    ui.notify = (text, ...rest) => { kz.toasts.push(String(text)); return notify(text, ...rest); };
  });
  await page.evaluate(() => window.__city.frames(6));
  const getKaiju = () => page.evaluate(() => window.__city.ctx.modules.get('disasters').api.getKaiju());
  const K_SPEED = 5, K_STEP_LEN = 12;

  check(await page.evaluate(() => !!document.querySelector('button[data-tool="hazard:kaiju"]')), 'Hazards toolbar has the Kaiju button');
  await page.click('button[data-tool="hazard:kaiju"]');
  await page.mouse.click(960, 540);
  await page.evaluate(() => window.__city.frames(6));
  let k0 = await getKaiju();
  check(!!k0 && Number.isFinite(k0.x) && Number.isFinite(k0.z) && (await disActive()).length === 0, `toolbar click raises a kaiju at the click and no tornado (${k0 ? `${k0.x.toFixed(0)}, ${k0.z.toFixed(0)}` : 'none'})`);
  const risen = await page.evaluate(() => {
    const ctx = window.__city.ctx, g = ctx.scene.getObjectByName('disasters:kaiju'), k = ctx.modules.get('disasters').api.getKaiju();
    return { visible: !!g?.visible, above: g ? g.position.y + 59 - ctx.world.getHeight(k.x, k.z) : -1, tornado: !!ctx.scene.getObjectByName('disasters')?.visible };
  });
  check(risen.visible && risen.above > 5 && !risen.tornado, `a kaiju raised while paused is visible at once, already ${risen.above.toFixed(0)} m out of the ground`);
  // the other tool swaps the hazard, the same tool sends it away; each new kaiju is the next of the variants
  const kweather = await weather();
  const hazards = () => page.evaluate(() => {
    const ctx = window.__city.ctx, d = ctx.modules.get('disasters').api, w = ctx.world.weather;
    return { kaiju: d.getKaiju(), tornadoes: d.getActive().length, ended: window.__kz.ended.map((e) => e.kind), toasts: [...window.__kz.toasts],
      rig: !!ctx.scene.getObjectByName('disasters:kaiju')?.visible, funnel: !!ctx.scene.getObjectByName('disasters')?.visible, rain: w.kind === 'rain' && w.intensity >= 0.9 };
  });
  await page.click('button[data-tool="hazard:tornado"]');
  await page.mouse.click(1000, 560);
  const swap1 = await hazards();
  check(swap1.kaiju === null && !swap1.rig && swap1.tornadoes === 1 && swap1.ended.join() === 'kaiju' && swap1.rain,
    `a Tornado click while a kaiju is loose replaces it: the kaiju is gone on that frame (disaster:ended ${swap1.ended.join()}), one tornado under a storm sky`);
  await page.click('button[data-tool="hazard:kaiju"]');
  await page.mouse.click(900, 500);
  const swap2 = await hazards();
  check(!!swap2.kaiju && swap2.kaiju.id !== k0.id && swap2.tornadoes === 0 && !swap2.funnel && swap2.ended.join() === 'kaiju,tornado' && sameWeather(await weather(), kweather),
    `a Kaiju click while a tornado is on the ground replaces it: the funnel is gone (disaster:ended ${swap2.ended.join()}), the sky given back, a new kaiju at the click`);
  await page.mouse.click(900, 500);
  const swap3 = await hazards();
  check(swap3.kaiju === null && !swap3.rig && swap3.tornadoes === 0 && swap3.ended.join() === 'kaiju,tornado,kaiju',
    'a second click with the Kaiju tool sends the kaiju home: nothing on the map');
  await page.mouse.click(960, 540);
  await page.evaluate(() => window.__city.frames(4));
  const swap4 = await hazards();
  const variants = await page.evaluate(() => window.__city.ctx.modules.get('disasters').api.kaijuVariants());
  check(variants.length >= 4 && new Set(variants.map((v) => v.id)).size === variants.length, `there are ${variants.length} different kaiju (${variants.map((v) => v.name).join(', ')})`);
  check(k0.variant === 0 && swap2.kaiju?.variant === 1 && swap4.kaiju?.variant === 2, `each one raised is the next of them, in order (${[k0.variant, swap2.kaiju?.variant, swap4.kaiju?.variant].join(', ')})`);
  const rising = swap4.toasts.filter((t) => /is rising in the city/.test(t));
  check(rising.length === 3 && rising.every((t, i) => t.includes(variants[i].name)), `and is announced by name (${rising.map((t) => t.replace(/^\S+ Kaiju! /, '').replace(/ is rising.*/, '')).join(', ')})`);
  check(swap4.toasts.filter((t) => /Tornado dismissed/.test(t)).length === 1 && swap4.toasts.filter((t) => /kaiju was sent home/.test(t)).length === 2,
    'sending a hazard away says so: one toast for the tornado, one for each kaiju');
  k0 = swap4.kaiju;
  const refused = await page.evaluate(() => {
    const d = window.__city.ctx.modules.get('disasters').api;
    const seq = d.getState().kaijuSeq;
    return { tornado: d.spawnTornado({ x: 0, z: 0 }), kaiju: d.spawnKaiju({ x: 0, z: 0 }), active: d.getActive().length, id: d.getKaiju()?.id, live: d.isActive(), seq, seq1: d.getState().kaijuSeq };
  });
  check(refused.tornado === null && refused.kaiju === null && refused.active === 0 && refused.id === k0?.id && refused.live && refused.seq === 3 && refused.seq1 === 3,
    'the api still refuses a tornado and a second kaiju while one is loose (one hazard at a time), and a refusal does not use up a variant');
  const sfx = await page.evaluate(() => window.__city.ctx.modules.get('audio').api.sfxNames);
  check(sfx.includes('stomp') && sfx.includes('roar'), `the kaiju has its own sounds (${sfx.filter((n) => n === 'stomp' || n === 'roar').join(', ')})`);

  // walking: against its own age (game seconds), never faster than K_SPEED, a footfall every K_STEP_LEN
  await page.evaluate(async () => { window.__city.setTimeScale(4); await window.__city.frames(150); });
  const k1 = await getKaiju();
  const walkT = k1.age - k0.age;
  check(walkT > 5 && k1.walked > 10 && k1.walked <= K_SPEED * walkT + 1e-6 && Math.hypot(k1.x - k0.x, k1.z - k0.z) <= k1.walked + 1e-6,
    `the kaiju walks, at most ${K_SPEED} m/s: ${k1.walked.toFixed(1)} m in ${walkT.toFixed(1)} game-s`);
  check(k1.steps === Math.floor(k1.walked / K_STEP_LEN) && k1.steps >= 1, `a footfall every ${K_STEP_LEN} m of travel (${k1.steps} steps in ${k1.walked.toFixed(1)} m)`);

  // rampage: until it has stomped, swept, breathed fire and torn something down (4x, at most ~40 game-seconds)
  let kst = null, kpeak = 0;
  for (let n = 0; n < 40; n++) {
    kst = await page.evaluate(async () => { window.__city.setTimeScale(4); await window.__city.frames(15); return window.__city.ctx.modules.get('disasters').api.getStats(); });
    kpeak = Math.max(kpeak, kst.bricks.live);
    if (kst.destroyed >= 2 && kst.footfalls >= 3 && kst.breaths >= 1 && kst.bricks.live > 100) break;
  }
  await page.evaluate(() => window.__city.pause());
  const kz1 = await page.evaluate(() => window.__kz);
  const kdz = await page.evaluate(() => window.__dz.removed);
  check(kz1.stomps.length >= 2 && kz1.stomps.every((s) => s.off >= 0 && s.off < K_STEP_LEN),
    `footfalls land at its feet: ${kz1.stomps.length} disaster:stomp events, ${kz1.stomps.reduce((a, s) => a + s.hits, 0)} buildings under them (furthest ${Math.max(...kz1.stomps.map((s) => s.off)).toFixed(1)} m from the hips)`);
  check(kst.destroyed >= 1 && kdz.length === kst.destroyed, `it tears buildings down: ${kst.destroyed} destroyed, ${kdz.length} removed from the world`);
  check(kdz.length > 0 && kdz.every((r) => r.ghost === 0), `no ghost: 0 drawn triangles left in the lot on the frame of removal (${kdz.length} removals, worst ${Math.max(0, ...kdz.map((r) => r.ghost))})`);
  const kzoned = kdz.filter((r) => r.zone);
  const kbad = kzoned.flatMap((r) => r.cells).filter((c) => c.type !== 'zone' || !c.zone || c.buildingId);
  check(kzoned.length > 0 && kbad.length === 0, `stomped lots keep their zoning: ${kzoned.flatMap((r) => r.cells).length} cells (${kbad.length} wrong)`);
  const noFunnel = await page.evaluate(() => {
    const scene = window.__city.ctx.scene;
    return { storm: !!scene.getObjectByName('bricks:storm')?.visible, funnel: !!scene.getObjectByName('disasters')?.visible };
  });
  check(kst.bricks.spawned > 100 && kpeak > 0 && !noFunnel.storm && !noFunnel.funnel, `they come apart as bricks with no funnel to carry them: ${kst.bricks.spawned} spawned, ${kpeak} in the air at peak`);
  check(kz1.tail > 0, `the tail knocks into what it passes (${kz1.tail.toFixed(2)} damage from the tail, ${kz1.tremor.toFixed(2)} from footfall tremors)`);
  const lit = kz1.breaths.flatMap((b) => b.lit);
  check(kz1.breaths.length >= 1 && kz1.breaths.every((b) => b.n >= 1 && b.n <= 3) && lit.every((l) => l.onFire && l.dist >= 8 && l.dist <= 70 && l.angle <= 0.3 + 1e-9) && kst.ignited === lit.length,
    `fire breath sets 1-3 buildings in its cone alight: ${kz1.breaths.map((b) => b.n).join(' + ')} lit (${lit.map((l) => `${l.dist.toFixed(0)} m / ${l.angle.toFixed(2)} rad`).join(', ')})`);

  // billing: every blow (stomp, tremor, tail) is charged; fire damage is the simulation's own and is not
  await page.evaluate(() => { const sim = window.__city.ctx.modules.get('simulation').api; for (let i = 0; i < 2; i++) sim.tick(true); });
  const kledger = await page.evaluate(() => window.__ledger);
  const kexpected = kledger.applied * 900;
  check(kledger.applied > 0 && Math.abs(kledger.charged - kexpected) < Math.max(2, 0.01 * kexpected),
    `billing is exact: charged $${kledger.charged.toFixed(1)} vs damage applied ${kledger.applied.toFixed(4)} × $900 = $${kexpected.toFixed(1)}`);

  // save / load mid-rampage. A half-stripped building is a passing state under a kaiju (a footfall takes a building
  // whole), so one is set up the way a load does it: a damaged building listed as stripped. The same loadState
  // hands the kaiju a full rampage again, so the checks below do not depend on how long the ones above took.
  const kstrip = await page.evaluate(() => {
    const ctx = window.__city.ctx, world = ctx.world, d = ctx.modules.get('disasters').api, B = ctx.modules.get('buildings').api;
    const k = d.getKaiju();
    let pick = null, best = Infinity;
    for (const b of world.buildings.values()) {
      if (!b.zone || b.onFire || (b.damage || 0) >= 0.35 || !B.getParts(b.id)) continue;
      const p = world.cellToWorld(b.i + (b.w - 1) / 2, b.j + (b.d - 1) / 2);
      const far = Math.abs(Math.hypot(p.x - k.x, p.z - k.z) - 90);
      if (far < best) { best = far; pick = b; }
    }
    pick.damage = 0.7;
    const state = d.getState();
    state.shedding.push({ id: pick.id });
    state.kaiju.life = 75; state.kaiju.phase = 'rampage';
    d.loadState(state);
    return { id: pick.id, stats: d.getStats(), phase: d.getKaiju()?.phase };
  });
  check(kstrip.stats.stripped >= 1 && kstrip.phase === 'rampage', `a damaged building listed as stripped is stripped on load (${kstrip.stats.stripped} buildings, ${kstrip.stats.hiddenParts} parts hidden)`);
  const ksave = await page.evaluate(async () => {
    const ctx = window.__city.ctx, d = ctx.modules.get('disasters').api;
    const m = await import('/src/menu/serialize.js');
    const before = d.getStats(), pre = d.getKaiju();
    const save = m.serializeSave(ctx, { name: 'kaiju-save' });
    window.__dz.armed = false;
    d.clear();
    const cleared = d.isActive();
    m.applySave(ctx, JSON.parse(JSON.stringify(save)));
    window.__kz.probing = true;
    await window.__city.frames(4);
    return { saved: save.disasters, pre, post: d.getKaiju(), before, after: d.getStats(), cleared, tornadoes: d.getActive().length };
  });
  check(!!ksave.saved.kaiju && ksave.saved.tornadoes.length === 0 && !ksave.cleared, `a mid-rampage save holds the kaiju and no tornado (${ksave.saved.shedding.length} stripped buildings)`);
  const kp = ksave.pre, kq = ksave.post;
  check(!!kq && ksave.tornadoes === 0 && Math.abs(kq.x - kp.x) < 1e-6 && Math.abs(kq.z - kp.z) < 1e-6 && Math.abs(kq.heading - kp.heading) < 1e-9 && Math.abs(kq.age - kp.age) < 1e-9
    && kq.steps === kp.steps && kq.phase === kp.phase && kq.variant === kp.variant && kp.variant === 2 && ksave.saved.kaijuSeq === 3 && Math.abs(kq.life - kp.life) < 1e-9 && Math.hypot(kq.footL[0] - kp.footL[0], kq.footR[1] - kp.footR[1]) < 1e-6,
    `load restores it where it stood and the kaiju it was: variant ${kp.variant}, position, heading, age ${kp.age.toFixed(1)}, ${kp.steps} steps, phase ${kp.phase}, both feet`);
  check(ksave.before.stripped > 0 && ksave.after.stripped === ksave.before.stripped && ksave.after.hiddenParts === ksave.before.hiddenParts,
    `and re-applies the stripped facades: ${ksave.after.stripped} buildings / ${ksave.after.hiddenParts} parts hidden (saved ${ksave.before.stripped} / ${ksave.before.hiddenParts})`);

  // crafted saves are sanitised
  const kcraft = await page.evaluate(() => {
    const d = window.__city.ctx.modules.get('disasters').api, world = window.__city.ctx.world;
    const keep = d.getState();
    d.loadState({ kaiju: { id: 5, x: null, z: 0, heading: 0, age: 3 } });
    const bogus = d.getKaiju();
    d.loadState({ kaiju: { id: 6, x: 1e9, z: -1e9, heading: 100, age: -5, life: 1e9, walked: 30, steps: 77, phase: 'dance', footL: 'x', footR: [1e9, 0], target: 7, nextBreath: -1e9, breathUntil: 1e9 } });
    const k = d.getKaiju();
    const half = world.size.w * world.cellSize / 2 + world.cellSize;
    const bounded = !!k && Math.abs(k.x) <= half && Math.abs(k.z) <= half && Math.abs(k.heading) <= Math.PI && k.age === 0 && k.life <= 300 && k.steps === 2 && k.phase === 'rampage'
      && Math.hypot(k.footL[0] - k.x, k.footL[1] - k.z) < 30 && Math.hypot(k.footR[0] - k.x, k.footR[1] - k.z) < 30 && k.target === null && k.breathUntil <= 2.5 && k.nextBreath >= 0;
    d.loadState({ tornadoes: [{ id: 7, x: 0, z: 0, dirX: 1, dirZ: 0, age: 3, life: 60 }], kaiju: { id: 8, x: 0, z: 0, heading: 0 } });
    const both = { tornadoes: d.getActive().length, kaiju: d.getKaiju() };
    // an older save: no variant, no place in the order. And one with nonsense in both.
    d.loadState({ kaiju: { id: 9, x: 0, z: 0, heading: 0 } });
    const old = { variant: d.getKaiju()?.variant, seq: d.getState().kaijuSeq };
    d.loadState({ kaiju: { id: 10, x: 0, z: 0, heading: 0, variant: 99 }, kaijuSeq: -4 });
    const wrong = { variant: d.getKaiju()?.variant, seq: d.getState().kaijuSeq };
    d.clear();
    d.loadState({ tornadoes: [], shedding: [] });
    const older = d.isActive();
    keep.kaiju.life = 75; // back with a full rampage ahead of it, for the checks below
    d.loadState(keep);
    return { bogus, bounded, both, older, old, wrong, seq: keep.kaijuSeq, back: !!d.getKaiju(), variant: d.getKaiju()?.variant };
  });
  check(kcraft.bogus === null, 'a kaiju with non-finite fields is dropped, not frozen');
  check(kcraft.old.variant === 0 && kcraft.old.seq === kcraft.seq && kcraft.wrong.variant === 0 && kcraft.wrong.seq === kcraft.seq && kcraft.variant === 2,
    `a save without a variant loads the first kaiju and leaves the order where it was (variant ${kcraft.old.variant}, next still ${kcraft.old.seq}); a bad variant or count is ignored`);
  check(kcraft.bounded, 'out-of-range position, heading, age, life, steps, phase, feet, target and breath timers are clamped or rebuilt on load');
  check(kcraft.both.tornadoes === 1 && kcraft.both.kaiju === null, 'a crafted save with both hazards loads the tornado only');
  check(kcraft.older === false && kcraft.back, 'a save without the kaiju field (older saves) loads no kaiju');
  const weatherK = await weather();
  check(sameWeather(weatherK, weather0), `the kaiju leaves the weather alone, and the crafted tornado gave its sky back (${weatherK.kind} ${weatherK.intensity})`);

  // the fire is drawn only while it breathes
  const flames = await page.evaluate(async () => {
    const c = window.__city, ctx = c.ctx, d = ctx.modules.get('disasters').api;
    const fire = ctx.scene.getObjectByName('kaiju:fire'), breath = ctx.scene.getObjectByName('kaiju:breath');
    c.setTimeScale(2);
    const breathing = () => { const k = d.getKaiju(); return !!k && k.breathUntil > k.age; };
    const drawn = (m) => (m.visible ? m.count : 0);
    let n = 0;
    while (breathing() && n++ < 600) await c.frames(1);
    await c.frames(2);
    const idle = drawn(fire) + drawn(breath), eyes = drawn(fire);
    n = 0;
    while (!breathing() && d.getKaiju() && n++ < 1500) await c.frames(1);
    await c.frames(4);
    const lit = breathing() ? drawn(fire) + drawn(breath) : -1, eyesLit = drawn(fire);
    c.pause();
    await c.frames(2);
    const bf = ctx.scene.getObjectByName('buildings:fire-flames');
    return { idle, lit, eyes, eyesLit, burning: ctx.modules.get('simulation').api.getBurningBuildings().filter((id) => ctx.modules.get('buildings').api.getParts(id)).length, drawn: bf.visible ? bf.count : 0 };
  });
  check(flames.burning > 0 ? flames.drawn > 0 : flames.drawn === 0, `the buildings it set alight are drawn burning (${flames.burning} burning, ${flames.drawn} flame quads)`);
  check(flames.idle === 2 && flames.eyes === 2 && flames.eyesLit === 2 && flames.lit > 2, `kaiju:fire draws the eyes only (${flames.idle} instances) until kaiju:breath streams (${flames.lit} instances)`);

  // chase it: a fixed camera relative to its live position, at noon and dusk
  for (const [tod, name] of [[12, 'kaiju-chase-day'], [17.7, 'kaiju-chase-dusk']]) {
    await page.evaluate(({ tod }) => {
      const ctx = window.__city.ctx;
      const k = ctx.modules.get('disasters').api.getKaiju();
      if (!k) return;
      const gy = ctx.world.getHeight(k.x, k.z);
      window.__city.setCamera({ pos: [k.x - 120, gy + 55, k.z + 110], target: [k.x, gy + 26, k.z], fov: 45 });
      window.__city.setTime(tod);
    }, { tod });
    const log = await app.capture(path.join(OUT, `${name}.png`), { settle: 8, sampleMs: 300 });
    captureErrors.push(...log.errors);
    check(log.gpuMs <= 20, `full-game ${name} GPU time ${log.gpuMs} ms <= 20 (${log.drawCalls} draws, ${log.triangles} triangles)`);
  }
  await page.evaluate(() => { window.__city.pause(); window.__city.setCamera('aerial'); window.__city.setTime(12); });


  // what the kaiju itself costs in draw calls: the same paused frame with and without it (bricks in the air)
  const kcost = await page.evaluate(async () => {
    const c = window.__city, ctx = c.ctx, d = ctx.modules.get('disasters').api;
    c.setCamera('aerial');
    c.setTimeScale(2);
    let n = 0, st = d.getStats();
    while ((st.bricks.live < 50 || st.bricks.rubble < 1) && d.getKaiju() && n++ < 1200) { await c.frames(1); st = d.getStats(); }
    c.pause();
    await c.frames(6);
    const live = c.stats().drawCalls;
    const state = d.getState();
    const meshes = ['kaiju:body', 'kaiju:fire', 'kaiju:breath', 'bricks:2x4', 'bricks:box'].map((name) => { const m = ctx.scene.getObjectByName(name); return `${name}${m?.visible && m.count ? '' : ' (off)'}`; });
    d.clear();
    await c.frames(6);
    const idle = c.stats().drawCalls;
    d.loadState(state);
    await c.frames(2);
    return { live, idle, flying: st.bricks.live, lying: st.bricks.rubble, back: !!d.getKaiju(), meshes };
  });
  check(kcost.live - kcost.idle <= 11 && kcost.flying + kcost.lying > 0, `the kaiju adds at most 11 draw calls to the whole frame (${kcost.idle} without, ${kcost.live} with ${kcost.flying} bricks flying and ${kcost.lying} lying; ${kcost.meshes.join(', ')})`);
  check(kcost.back, 'clear() then loadState(getState()) brings the kaiju back');

  // the city fights back: a police station and a fire department behind it shorten the rampage
  const fight = await page.evaluate(async () => {
    const c = window.__city, ctx = c.ctx, world = ctx.world, d = ctx.modules.get('disasters').api;
    const k = d.getKaiju();
    const drain0 = k.drain;
    // the two free 2x2 lots nearest a point 8 cells behind it (it does not walk to what is behind it), inside the
    // coverage radius of the cell it stands on and well clear of its feet
    const here = world.worldToCell(k.x, k.z);
    const back = world.worldToCell(k.x - Math.cos(k.heading) * 64, k.z - Math.sin(k.heading) * 64);
    const free = (i, j) => { for (let y = j; y < j + 2; y++) for (let x = i; x < i + 2; x++) { const q = world.cellAt(x, y); if (!q || q.buildingId || q.type === 'road' || q.type === 'water' || world.isWaterCell?.(x, y)) return false; } return true; };
    const cand = [];
    for (let j = here.j - 10; j <= here.j + 10; j++) for (let i = here.i - 10; i <= here.i + 10; i++) {
      if (Math.max(Math.abs(i - here.i), Math.abs(j - here.j)) < 5 || !free(i, j)) continue;
      cand.push({ i, j, far: Math.hypot(i - back.i, j - back.j) });
    }
    cand.sort((p, q) => p.far - q.far);
    const spots = [];
    for (const p of cand) { if (spots.length < 2 && !spots.some((s) => Math.abs(s.i - p.i) < 2 && Math.abs(s.j - p.j) < 2)) spots.push(p); }
    if (spots.length < 2) return { drain0, placed: spots.length };
    world.addBuilding({ i: spots[0].i, j: spots[0].j, w: 2, d: 2, zone: null, kind: 'police_station', level: 1 });
    world.addBuilding({ i: spots[1].i, j: spots[1].j, w: 2, d: 2, zone: null, kind: 'fire_department', level: 1 });
    c.setTimeScale(1); await c.frames(3);
    const a = d.getKaiju();
    await c.frames(90);
    const b = d.getKaiju();
    c.pause();
    return { drain0, placed: 2, drain1: a.drain, drain2: b.drain, phase: b.phase, rate: (a.life - b.life) / (b.age - a.age), secs: b.age - a.age };
  });
  check(fight.placed === 2 && fight.drain1 > fight.drain0 && fight.drain1 >= 2.49,
    `police and fire coverage under it drain its time faster: x${fight.drain0} before, x${fight.drain1} with a station and a fire department placed`);
  check(fight.phase !== 'rampage' || (fight.drain2 === fight.drain1 && Math.abs(fight.rate - fight.drain1) < 1e-6),
    `and its time really runs down at that rate (${fight.rate?.toFixed(4)} life-s per game-s over ${fight.secs?.toFixed(1)} s)`);
  const fightToasts = (await page.evaluate(() => window.__kz.toasts)).filter((t) => /driving the kaiju off/.test(t));
  check(fightToasts.length === 1, `the player is told once that the crews are fighting back (${fightToasts.length} toast)`);

  // its time runs out: it walks off, sinks, and the lots it emptied grow back
  for (let n = 0; n < 40; n++) {
    const live = await page.evaluate(async () => { window.__city.setTimeScale(8); await window.__city.frames(30); return window.__city.ctx.modules.get('disasters').api.isActive(); });
    if (!live) break;
  }
  await page.evaluate(() => window.__city.pause());
  const kend = await page.evaluate(() => {
    const ctx = window.__city.ctx, d = ctx.modules.get('disasters').api;
    const burning = ctx.modules.get('simulation').api.getBurningBuildings();
    return { live: d.isActive(), kz: window.__kz, stats: d.getStats(), visible: !!ctx.scene.getObjectByName('disasters:kaiju')?.visible, burning: burning.length, orphans: burning.filter((id) => !ctx.world.buildings.has(id)).length };
  });
  const kended = kend.kz.ended.filter((e) => e.kind === 'kaiju').pop();
  check(!kend.live && !kend.visible && kend.kz.phases.includes('leave') && !!kended && kended.destroyed === kend.stats.destroyed,
    `when its time is up the kaiju walks off and sinks (phases seen: ${kend.kz.phases.join(' → ')}; disaster:ended kind ${kended?.kind}, ${kended?.destroyed} destroyed)`);
  check(kend.kz.toasts.filter((t) => /kaiju has left/.test(t)).length === 1, 'and says so once');
  check(kend.orphans === 0, `no fire is left burning on a building it tore down (${kend.burning} burning, ${kend.orphans} of them gone from the world)`);
  const klots = await page.evaluate(() => {
    const world = window.__city.ctx.world, W = world.size.w, H = world.size.h;
    const out = [];
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (world.cells[j * W + i].kaijuProbe) out.push(j * W + i);
    return out;
  });
  let kregrown = 0, kgrew = 0;
  for (let n = 0; n < 60 && kregrown < Math.min(3, klots.length); n++) {
    kregrown = await page.evaluate(async (lots) => {
      window.__city.setTimeScale(8); await window.__city.frames(30);
      const cells = window.__city.ctx.world.cells;
      return lots.filter((k) => cells[k].buildingId).length;
    }, klots);
    kgrew = (n + 1) * 30 * 8 / 60;
  }
  await page.evaluate(() => window.__city.pause());
  check(kregrown > 0, `stomped lots regrow: ${kregrown} of ${klots.length} cells built on again within ${kgrew.toFixed(0)} game-s`);
  const kdrained = await disStats();
  check(kdrained.bricks.live === 0, `no brick is left in the air after the kaiju (${kdrained.bricks.live} live, ${kdrained.bricks.rubble} rubble, ${kdrained.bricks.fading} fading)`);

  // the variants, through the api: the order cycles, a named variant leaves it alone, each is a different body on
  // the same two-eyed rig
  const vars = await page.evaluate(async () => {
    const c = window.__city, ctx = c.ctx, d = ctx.modules.get('disasters').api;
    const count = d.kaijuVariants().length, seq0 = d.getState().kaijuSeq;
    const body = () => {
      const m = ctx.scene.getObjectByName('kaiju:body'), a = m.instanceColor.array;
      let h = 0;
      for (let i = 0; i < m.count * 3; i++) h = (h * 31 + Math.round(a[i] * 255)) >>> 0;
      return `${m.count}:${h}`;
    };
    const eyeOf = () => { const f = ctx.scene.getObjectByName('kaiju:fire'); return `${f.count}:${f.material.emissive.getHexString()}`; };
    const seen = [], bodies = [], eyes = [];
    for (let n = 0; n <= count; n++) {
      d.spawnKaiju({ x: 0, z: 0 });
      await c.frames(2);
      seen.push(d.getKaiju().variant); bodies.push(body()); eyes.push(eyeOf());
      d.despawn();
    }
    d.spawnKaiju({ x: 0, z: 0, variant: 2 });
    const named = d.getKaiju().variant, sent = d.despawn(), seq1 = d.getState().kaijuSeq;
    return { count, seq0, seq1, seen, bodies, eyes, named, sent, none: d.despawn(), live: d.isActive() };
  });
  check(vars.seen.every((v, n) => v === (vars.seq0 + n) % vars.count) && vars.seq1 === vars.seq0 + vars.count + 1,
    `spawnKaiju cycles through the variants in order and starts over (${vars.seen.join(', ')} from a count of ${vars.seq0})`);
  check(vars.named === 2 && vars.sent?.kind === 'kaiju' && vars.none === null && !vars.live, 'a named variant does not move the order on; despawn() names what it sent away and returns null when the map is clear');
  check(new Set(vars.bodies.slice(0, vars.count)).size === vars.count && vars.bodies[vars.count] === vars.bodies[0] && vars.eyes.every((e) => e.startsWith('2:')) && new Set(vars.eyes).size >= 3,
    `each variant is its own body on the same rig, with two eyes of its own colour (bricks:colour hash ${vars.bodies.slice(0, vars.count).join(', ')}; eyes ${[...new Set(vars.eyes)].join(', ')})`);

  // sent away mid-rampage: what it did stands. The bricks in the air stay there, the damage not yet billed is billed.
  const sent = await page.evaluate(async () => {
    const c = window.__city, ctx = c.ctx, world = ctx.world, d = ctx.modules.get('disasters').api, sim = ctx.modules.get('simulation').api;
    const B = ctx.modules.get('buildings').api;
    for (let i = 0; i < 2; i++) sim.tick(true);
    window.__ledger.charged = 0; window.__ledger.applied = 0;
    let b = null;
    for (const x of world.buildings.values()) { if (x.zone && !x.onFire && !(x.damage > 0) && B.getParts(x.id) && (!b || x.w * x.d > b.w * b.d)) b = x; }
    const p = world.cellToWorld(b.i + (b.w - 1) / 2, b.j + (b.d - 1) / 2);
    d.spawnKaiju({ x: p.x - 30, z: p.z, heading: 0 });
    let billed = 0;
    const off = ctx.events.on('sim:tick', () => { billed = window.__ledger.applied; });
    c.setTimeScale(4);
    let n = 0, st = d.getStats();
    // until there are bricks in the air and damage the last tick has not seen yet
    while (n++ < 2400 && d.getKaiju() && !(st.bricks.live > 20 && st.destroyed >= 1 && window.__ledger.applied > billed + 1e-6)) { await c.frames(1); st = d.getStats(); }
    const owed = window.__ledger.applied - billed, live0 = d.getStats().bricks.live, destroyed = st.destroyed;
    const what = d.despawn();
    const after = { live: d.isActive(), rig: !!ctx.scene.getObjectByName('disasters:kaiju')?.visible, bricks: d.getStats().bricks.live };
    if (typeof off === 'function') off();
    c.pause();
    for (let i = 0; i < 2; i++) sim.tick(true);
    const ledger = { ...window.__ledger };
    await c.frames(2);
    const flying = d.getStats().bricks.live;
    d.clear();
    return { what, owed, live0, destroyed, after, ledger, flying, frames: n };
  });
  const sentExpected = sent.ledger.applied * 900;
  check(sent.what?.kind === 'kaiju' && !sent.after.live && !sent.after.rig && sent.live0 > 20 && sent.after.bricks === sent.live0 && sent.flying > 0,
    `a kaiju sent away mid-rampage leaves its bricks in the air: ${sent.live0} flying before, ${sent.after.bricks} on that frame, ${sent.flying} two frames on (${sent.destroyed} destroyed)`);
  check(sent.owed > 0 && Math.abs(sent.ledger.charged - sentExpected) < Math.max(2, 0.01 * sentExpected),
    `and the damage it had done is still billed: $${sent.ledger.charged.toFixed(1)} charged vs ${sent.ledger.applied.toFixed(4)} × $900 = $${sentExpected.toFixed(1)} (${(sent.owed * 900).toFixed(1)} of it not yet billed when it left)`);

  // exclusivity the other way round
  const other = await page.evaluate(() => {
    const d = window.__city.ctx.modules.get('disasters').api;
    const tornado = d.spawnTornado({ x: 0, z: 0, dirX: 1, dirZ: 0 });
    const kaiju = d.spawnKaiju({ x: 40, z: 40 });
    d.clear();
    return { tornado, kaiju, live: d.isActive() };
  });
  check(!!other.tornado && other.kaiju === null && !other.live, 'spawnKaiju is refused while a tornado is on the ground');
  const weatherEnd = await weather();
  check(sameWeather(weatherEnd, weather0), `and the sky is the one the session started with (${weatherEnd.kind} ${weatherEnd.intensity})`);

  // a burning building is drawn: flame and smoke bricks over it, at once (no simulation tick), and gone with the fire
  const bfire = await page.evaluate(async () => {
    const c = window.__city, ctx = c.ctx, sim = ctx.modules.get('simulation').api, B = ctx.modules.get('buildings').api;
    const world = ctx.world, cs = world.cellSize;
    const flames = ctx.scene.getObjectByName('buildings:fire-flames'), smoke = ctx.scene.getObjectByName('buildings:fire-smoke');
    const drawn = () => ({ flames: flames.visible ? flames.count : 0, smoke: smoke.visible ? smoke.count : 0 });
    const burnOut = async () => {
      for (const id of sim.getBurningBuildings()) { const b = world.buildings.get(id); if (b) b.fireElapsed = b.fireDuration; }
      sim.tick(true);
      await c.frames(2);
    };
    c.pause();
    c.setCamera('aerial'); c.setTime(12);
    await burnOut();
    const idle = drawn(), idleBurning = sim.getBurningBuildings().length;
    await c.frames(4);
    const draws0 = c.stats().drawCalls;
    let b = null;
    for (const x of world.buildings.values()) { if (x.zone && !x.onFire && !(x.damage > 0) && B.getParts(x.id) && (!b || x.w * x.d > b.w * b.d)) b = x; }
    if (!b) return { idle, idleBurning, none: true };
    const damage0 = b.damage || 0;
    const lit = sim.igniteBuilding(b.id);
    await c.frames(40);   // paused: no tick runs
    const now = drawn(), draws1 = c.stats().drawCalls;
    // where the flame bricks are: all within the lot (a little over its edge for window flames), above the ground
    const x0 = world.minX + b.i * cs, x1 = x0 + b.w * cs, z0 = world.minZ + b.j * cs, z1 = z0 + b.d * cs;
    const parts = B.getParts(b.id), m = new c.THREE.Matrix4(), v = new c.THREE.Vector3();
    let inside = 0, above = 0;
    for (let i = 0; i < flames.count; i++) {
      flames.getMatrixAt(i, m); v.setFromMatrixPosition(m);
      if (v.x > x0 - 4 && v.x < x1 + 4 && v.z > z0 - 4 && v.z < z1 + 4) inside++;
      if (v.y > parts.baseY + 1) above++;
    }
    const gy = parts.baseY, r = Math.max(b.w, b.d) * cs;
    c.setCamera({ pos: [parts.cx - 60 - r, gy + parts.height + 70, parts.cz + 70 + r], target: [parts.cx, gy + parts.height * 0.6 + 8, parts.cz], fov: 45 });
    return { idle, idleBurning, lit, elapsed: b.fireElapsed, now, inside, above, draws: draws1 - draws0, id: b.id, damage0, w: b.w, d: b.d };
  });
  check(bfire.idleBurning === 0 && bfire.idle.flames === 0 && bfire.idle.smoke === 0, `with nothing burning no fire is drawn (${bfire.idle.flames} flame and ${bfire.idle.smoke} smoke bricks)`);
  check(!bfire.none && bfire.lit && bfire.elapsed === 0 && bfire.now.flames > 0 && bfire.now.smoke > 0,
    `a building lit while the clock is paused burns at once, before any tick: ${bfire.now?.flames} flame and ${bfire.now?.smoke} smoke bricks on a ${bfire.w}x${bfire.d} lot`);
  check(bfire.now && bfire.inside === bfire.now.flames && bfire.above === bfire.now.flames, `every flame brick is on that building (${bfire.inside} of ${bfire.now?.flames} over its lot, ${bfire.above} above the ground)`);
  check(bfire.draws <= 2, `the fire adds at most 2 draw calls (${bfire.draws})`);
  {
    const log = await app.capture(path.join(OUT, 'building-fire.png'), { settle: 8, sampleMs: 300 });
    captureErrors.push(...log.errors);
    check(log.gpuMs <= 20, `full-game building-fire GPU time ${log.gpuMs} ms <= 20 (${log.drawCalls} draws)`);
  }
  const bout = await page.evaluate(async ({ id, damage0 }) => {
    const c = window.__city, ctx = c.ctx, sim = ctx.modules.get('simulation').api;
    const flames = ctx.scene.getObjectByName('buildings:fire-flames'), smoke = ctx.scene.getObjectByName('buildings:fire-smoke');
    const b = ctx.world.buildings.get(id);
    if (b) b.fireElapsed = b.fireDuration;
    sim.tick(true);
    await c.frames(2);
    if (b) b.damage = damage0;   // leave no scar behind
    c.setCamera('aerial');
    return { burning: sim.getBurningBuildings().length, flames: flames.visible ? flames.count : 0, smoke: smoke.visible ? smoke.count : 0 };
  }, { id: bfire.id, damage0: bfire.damage0 });
  check(bout.burning === 0 && bout.flames === 0 && bout.smoke === 0, `and stops being drawn when the fire is out (${bout.flames} flame, ${bout.smoke} smoke bricks)`);

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
      // the showcase pre-step is fixed; the 30 wall-clock frames after it may tear down a building more on either
      // boot, so the counts are compared with a tolerance (the exact staged counts are compared below)
      check(Math.abs(r.st.destroyed - bootHash.st.destroyed) <= 2,
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

// 9. the kaiju showcase, staged with the clock paused from the first frame: its walk, its footfalls, what it tore
// down and set alight are all decided in fixed steps, so two fresh boots must agree exactly.
let kaijuStaged = null;
for (let k = 0; k < 2; k++) {
  const app4 = await openApp({ showcase: 'disasters', variant: 'default', seed: 1, tod: 12 });
  try {
    const r = await app4.page.evaluate(async () => {
      window.__city.pause();
      await window.__city.showcase('disasters', 'kaiju');
      const ctx = window.__city.ctx, d = ctx.modules.get('disasters').api;
      const st = d.getStats(), q = d.getKaiju();
      const utilities = [...ctx.world.buildings.values()].filter((b) => !b.zone && (b.kind === 'power_plant' || b.kind === 'water_tower')).length;
      return {
        hash: st.bricks.spawnHash, spawned: st.bricks.spawned, destroyed: st.destroyed, hidden: st.hiddenParts, footfalls: st.footfalls, breaths: st.breaths,
        ignited: st.ignited, burning: ctx.modules.get('simulation').api.getBurningBuildings().length, utilities,
        pose: q ? [q.x, q.z, q.heading, q.walked].map((v) => v.toFixed(3)).join(' ') + ` steps ${q.steps} ${q.phase}` : 'none',
        breathing: !!q && q.breathUntil > q.age,
      };
    });
    const key = (s) => [s.hash, s.spawned, s.destroyed, s.hidden, s.footfalls, s.breaths, s.ignited, s.burning, s.pose].join(' | ');
    if (k === 0) {
      kaijuStaged = r;
      check(r.destroyed > 0 && r.footfalls >= 2 && r.breaths >= 1 && r.breathing && r.spawned > 300 && r.utilities === 4,
        `the staged kaiju is mid-rampage and breathing fire: ${r.footfalls} footfalls, ${r.destroyed} destroyed, ${r.ignited} set alight, ${r.spawned} bricks released, the district's ${r.utilities} utilities still standing`);
    } else check(key(r) === key(kaijuStaged), `cross-boot determinism: kaiju showcase ${key(kaijuStaged)} == ${key(r)}`);
  } finally {
    await app4.close();
  }
}

fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ ok: failed === 0, failed, checks: results.length, results, captureErrors }, null, 2));
console.log(`\n[check-disasters] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
