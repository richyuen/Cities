#!/usr/bin/env node
// Functional check for Wave C5 / F2 — transit depth.
//   node tools/check-transit.mjs
// Full game: fare income wired into the budget + Treasury, route-letter plates on the stop faces, rider queues
// scaling with ridership, repeated-stop (figure-eight) boarding advancing instead of dwelling, clock-pause freezes
// traffic (the C4 decision), save/load keeps the network and recomputes fares. Writes shots/transit/c5/*.png.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';

const OUT = 'shots/transit/c5';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

const app = await openApp({ seed: 1 });
const { page } = app;
try {
  await page.evaluate(() => window.__city.frames(120));
  const base = await page.evaluate(() => {
    const C = window.__city.ctx;
    const transit = C.modules.get('transit')?.api;
    const traffic = C.modules.get('traffic')?.api;
    const face = C.scene.getObjectByName('transit-stop-face');
    const riders = C.scene.getObjectByName('transit-riders');
    const uvAttr = face?.geometry?.getAttribute?.('aUvOffset');
    const first = transit?.getStops?.()[0] || null;
    const uvValues = [];
    if (uvAttr) for (let k = 0; k < (transit?.getStops?.().length || 0); k++) uvValues.push(uvAttr.getX(k));
    return {
      stops: transit?.getStops?.().length || 0,
      lines: transit?.getLines?.().length || 0,
      ridership: transit?.getRidership?.() || 0,
      faceMap: !!face?.material?.map, faceW: face?.material?.map?.image?.width || 0,
      tileCount: uvValues.length, uvValues,
      riders: riders?.count ?? -1,
      pop: C.world.stats.population || 0,
    };
  });
  check(base.stops > 0 && base.lines > 0, `demo city has a transit network (${base.stops} stops / ${base.lines} lines)`);
  check(base.faceMap && base.faceW === 288, `stop faces carry the 9-tile letter atlas (${base.faceW}px wide)`);
  check(base.tileCount === base.stops, `every stop has a route-letter tile offset (${base.tileCount} = ${base.stops})`);
  check(base.uvValues.some((v) => v < 8 / 9 - 1e-6), 'at least one stop shows an assigned line letter (not the neutral dash)');

  // ---- fares (pause + one tick first, so the fare and ridership are from the same tick) -------------
  const fare = await page.evaluate(() => {
    const C = window.__city.ctx;
    const sim = C.modules.get('simulation').api;
    const transit = C.modules.get('transit').api;
    window.__city.pause();
    sim.tick(true); // pushes the current fare into the model…
    sim.tick(true); // …and the next step writes it into the budget snapshot (one-tick lag, like upkeep)
    const bud = sim.getBudget();
    return { perTick: bud.perTick.income.transit, perDay: bud.perDay.income.transit, ridership: transit.getRidership(), coverage: transit.getCoverage(), budgetPop: sim.getStats().population };
  });
  const expected = fare.ridership * 0.35 / 1200;
  check(fare.ridership > 0, `ridership is live (${fare.ridership}/day at ${Math.round(fare.coverage * 100)}% coverage)`);
  check(fare.perTick > 0 && Math.abs(fare.perTick - expected) < 1e-6, `fare income is in the budget and honest ($${fare.perTick.toFixed(4)}/tick = ${fare.ridership} × $0.35/day)`);
  check(fare.perDay > 0, `fare income shows per day ($${Math.round(fare.perDay)}/day)`);

  // ---- rider queues ------------------------------------------------------------------------------
  check(base.riders > 0, `queued rider blocks are placed from ridership (${base.riders})`);

  // ---- repeated-stop boarding (figure-eight fix) -------------------------------------------------
  const placed = await page.evaluate(() => {
    const transit = window.__city.ctx.modules.get('transit').api;
    // reuse the demo line's valid loop and visit A twice: A→…→F→A (the repeated-stop case the C5 fix covers)
    const ids = transit.getLines()[0].stopIds.slice();
    ids.push(ids[0]);
    return ids;
  });
  const lineId = await page.evaluate((ids) => {
    const transit = window.__city.ctx.modules.get('transit').api;
    const r = transit.createLine(ids);
    return r.ok ? r.id : `refused: ${r.reason}`;
  }, placed);
  check(typeof lineId === 'number', `repeated-stop line created (A→…→F→A, ${placed.length} visits, line ${lineId})`);
  const boarding = await page.evaluate(async (id) => {
    const C = window.__city.ctx;
    const traffic = C.modules.get('traffic').api;
    window.__city.resume();
    const seen = new Set(); let minS = Infinity, maxS = -Infinity, dwellMax = 0;
    for (let i = 0; i < 70; i++) {
      await window.__city.frames(30);
      const bus = (traffic.getBusDebug() || []).find((b) => b.lineId === id);
      if (!bus) continue;
      seen.add(bus.nextStop);
      minS = Math.min(minS, bus.routeS); maxS = Math.max(maxS, bus.routeS);
      dwellMax = Math.max(dwellMax, bus.dwell || 0);
    }
    return { nextStops: [...seen], maxNext: seen.size ? Math.max(...seen) : -1, span: maxS - minS, dwellMax };
  }, lineId);
  check(boarding.maxNext >= 2 && boarding.span > 50, `bus serves the repeated-stop loop instead of dwelling (max next-stop ${boarding.maxNext}, ${Math.round(boarding.span)} m travelled)`);

  // pause the clock, frame the new line's first stop for the plate/rider shot
  await page.evaluate(() => window.__city.pause());
  await page.evaluate((ids) => {
    const C = window.__city.ctx;
    const s = C.modules.get('transit').api.getStops().find((x) => x.id === ids[0]);
    if (s) window.__city.setCamera({ pos: [s.x + 3.4, s.y + 2.6, s.z + 3.4], target: [s.x, s.y + 1.1, s.z] });
  }, placed);
  await page.evaluate(() => window.__city.setTime(12.5));
  await page.evaluate(() => window.__city.frames(20));
  await page.screenshot({ path: path.join(OUT, 'stop-plate-day.png') });
  await page.evaluate(() => window.__city.setTime(21.5));
  await page.evaluate(() => window.__city.frames(20));
  await page.screenshot({ path: path.join(OUT, 'stop-plate-night.png') });

  // ---- clock pause freezes traffic (C4 decision) --------------------------------------------------
  const frozen = await page.evaluate(async () => {
    const traffic = window.__city.ctx.modules.get('traffic').api;
    const a = JSON.stringify(traffic.getVehiclePositions().slice(0, 6));
    await window.__city.frames(45);
    const b = JSON.stringify(traffic.getVehiclePositions().slice(0, 6));
    return { same: a === b, n: traffic.getVehicleCount() };
  });
  check(frozen.same && frozen.n > 0, `clock pause holds the traffic (${frozen.n} vehicles frozen across 45 frames)`);
  const moving = await page.evaluate(async () => {
    const traffic = window.__city.ctx.modules.get('traffic').api;
    const a = JSON.stringify(traffic.getVehiclePositions().slice(0, 6));
    window.__city.resume();
    await window.__city.frames(45);
    return a !== JSON.stringify(traffic.getVehiclePositions().slice(0, 6));
  });
  check(moving, 'resuming the clock moves the traffic again');

  // ---- Treasury + panel read the fares ------------------------------------------------------------
  await page.evaluate(() => window.__city.pause());
  await page.click('.lc-stat.clickable');
  await page.evaluate(() => window.__city.frames(10));
  const treasury = await page.evaluate(() => document.querySelector('.lc-modal').textContent);
  check(/Transit fares \/ day/.test(treasury) && /Transit upkeep \/ day/.test(treasury), 'Treasury modal itemises transit fares and upkeep');
  await page.screenshot({ path: path.join(OUT, 'treasury-fares.png') });
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__city.ctx.events.emit('tool:selected', { tool: 'transit:lines' }); });
  await page.evaluate(() => window.__city.frames(10));
  const panel = await page.evaluate(() => document.querySelector('.tr-panel')?.textContent || '');
  check(/Fares/.test(panel), 'transit panel lists the fare line');
  await page.screenshot({ path: path.join(OUT, 'transit-panel.png') });

  // ---- save/load keeps the network; fares recompute ------------------------------------------------
  const rt = await page.evaluate(() => {
    const C = window.__city.ctx;
    const transit = C.modules.get('transit').api;
    const sim = C.modules.get('simulation').api;
    const stopsBefore = transit.getStops().length, linesBefore = transit.getLines().length;
    const state = transit.getState();
    transit.loadState(state);
    for (let i = 0; i < 5; i++) sim.tick(true);
    return { stopsBefore, stopsAfter: transit.getStops().length, linesBefore, linesAfter: transit.getLines().length, fareAfter: sim.getBudget().perTick.income.transit };
  });
  check(rt.stopsAfter === rt.stopsBefore && rt.linesAfter === rt.linesBefore, `save/load keeps the network (${rt.stopsAfter} stops / ${rt.linesAfter} lines)`);
  check(rt.fareAfter > 0, `fares recompute after a load ($${rt.fareAfter.toFixed(4)}/tick)`);

  const errors = await page.evaluate(() => window.__city.stats().errors);
  check(errors.length === 0, `no console/page errors (${errors.length})`);
  if (errors.length) console.log(errors.join('\n'));
} finally {
  await app.close();
}
fs.writeFileSync(path.join(OUT, 'check.json'), JSON.stringify({ failed, checks: results }, null, 2));
console.log(`\n[check-transit] ${results.length - failed}/${results.length} passed → ${path.join(OUT, 'check.json')}`);
process.exit(failed ? 1 : 0);
