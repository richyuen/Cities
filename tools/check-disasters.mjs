#!/usr/bin/env node
// Functional check for Wave D2 — disasters (tornado).
//   node tools/check-disasters.mjs
// Full game via tools/shot.mjs's openApp. Proves, through the real toolbar path and the public APIs:
//   1. the Hazards button spawns exactly one tornado at the clicked spot;
//   2. it travels along the world wind at SPEED (measured against the simulation's own game clock);
//   3. buildings in its path take damage (b.damage > 0) and the damage is billed (stats.disasterCost,
//      budget.expenses.disasters, the Treasury row);
//   4. it dissipates at LIFE_SEC, the cost line returns to zero, and damaged buildings repair over sim ticks;
//   5. save/load round-trips an active tornado (position/age) and the damage scars.
// Writes shots/disasters/d2/*.png + summary.json. Exit 1 on any failed check.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';

const OUT = 'shots/disasters/d2';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const TICK_DT = 0.5, SPEED = 11, LIFE_SEC = 60;

const app = await openApp({ seed: 1, tod: 12 });
const { page } = app;
const captureErrors = [];
const disActive = () => page.evaluate(() => window.__city.ctx.modules.get('disasters').api.getActive());
const disDamage = () => page.evaluate(() => window.__city.ctx.modules.get('disasters').api.getDamageTotal());
const disClear = () => page.evaluate(() => window.__city.ctx.modules.get('disasters').api.clear());
const disSpawn = (o) => page.evaluate((o) => window.__city.ctx.modules.get('disasters').api.spawnTornado(o), o);

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
  });
  captureErrors.push(...(await app.capture(path.join(OUT, 'before.png'), { settle: 10, sampleMs: 400 })).errors);

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
    captureErrors.push(...(await app.capture(path.join(OUT, `${name}.png`), { settle: 8, sampleMs: 300 })).errors);
  }
  await page.evaluate(() => { window.__city.pause(); window.__city.setCamera('aerial'); });
  const treasuryRow = await page.evaluate(() => {
    // the Treasury modal opens from the HUD money plate (`.lc-stat-ico.money` bubbles to the plate's handler)
    document.querySelector('.lc-stat-ico.money')?.closest('.lc-stat')?.click();
    const row = [...document.querySelectorAll('.lc-kv span')].find((s) => /Disaster costs/.test(s.textContent));
    const val = row ? row.nextElementSibling?.textContent : null;
    return { hasRow: !!row, value: val };
  });
  check(treasuryRow.hasRow, `Treasury modal shows a "Disaster costs / day" row (${treasuryRow.value})`);

  // 4. dissipate, cost back to 0, then repair
  await page.evaluate(async () => { window.__city.setTimeScale(20); await window.__city.frames(60); });
  await page.evaluate(async () => { await window.__city.frames(60); });
  const after = await page.evaluate(() => ({ active: window.__city.ctx.modules.get('disasters').api.getActive().length, tick: window.__city.ctx.modules.get('simulation').api.getStats().tick }));
  check(after.active === 0, `tornado dissipates within its lifetime (active ${after.active} after ${(after.tick * TICK_DT).toFixed(0)} game-s)`);
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

  check(captureErrors.length === 0, `all captures report no errors (${captureErrors.length})`);
} finally {
  await app.close();
}

// 6. cross-boot determinism of the storm showcase: the funnel layout at spin-time 0 must hash identically on two
// fresh boots (the animation itself is time-based, so the check re-syncs visuals through loadState before hashing)
let bootHash = null;
for (let k = 0; k < 2; k++) {
  const app2 = await openApp({ showcase: 'disasters', variant: 'storm', seed: 1, tod: 12 });
  try {
    await app2.page.evaluate(async () => { await window.__city.frames(30); });
    const hash = await app2.page.evaluate(() => {
      const d = window.__city.ctx.modules.get('disasters');
      d.api.loadState(d.api.getState());   // re-lays the visuals out at time 0 (same frame: no rAF can interleave)
      const t = d.api.getActive()[0];
      const funnel = window.__city.ctx.scene.getObjectByName('tornado:funnel');
      const debris = window.__city.ctx.scene.getObjectByName('tornado:debris');
      let h = 0x811c9dc5;
      const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } };
      // layout + path only: the live position/age is animation state (wall-clock frames differ between boots)
      mix(`dir:${t.dirX},${t.dirZ},life:${t.life},spawn:${(t.x - t.dirX * 11 * t.age).toFixed(3)},${(t.z - t.dirZ * 11 * t.age).toFixed(3)}`);
      for (const m of [funnel, debris]) {
        mix(`${m.count}`);
        const a = m.instanceMatrix.array;
        for (let i = 0; i < a.length; i += 5) mix(a[i].toFixed(4));
      }
      return (h >>> 0).toString(16);
    });
    if (k === 0) { bootHash = hash; check(!!hash, `storm showcase layout hash ${hash}`); }
    else check(hash === bootHash, `cross-boot determinism: storm layout hash ${bootHash} == ${hash}`);
  } finally {
    await app2.close();
  }
}

fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ ok: failed === 0, failed, checks: results.length, results, captureErrors }, null, 2));
console.log(`\n[check-disasters] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
