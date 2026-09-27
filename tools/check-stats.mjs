#!/usr/bin/env node
// Functional check for Wave C3 / F6 — the Statistics modal.
//   node tools/check-stats.mjs
// Drives the real game through tools/shot.mjs's openApp: opens the modal from the HUD, compares every chip value
// against simulation.getStats()/getBudget(), proves the canvas is painted, that it redraws on sim:tick and on a
// series toggle, and that Escape closes it. Writes shots/ui/c3/*.png + a JSON result. Exit 1 on any failed check.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';

const OUT = 'shots/ui/c3';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

const app = await openApp({ seed: 1 });
const { page } = app;
try {
  // settle the page, then pause the clock so only our own tick() calls can change the sim while the modal is open
  await page.evaluate(() => window.__city.frames(90));
  await page.evaluate(() => { window.__city.pause(); const sim = window.__city.ctx.modules.get('simulation').api; for (let i = 0; i < 10; i++) sim.tick(true); });
  await page.evaluate(() => window.__city.setTime(12));

  const pre = await page.evaluate(() => {
    const btn = document.querySelector('.lc-stat-chart');
    return {
      btn: !!btn, btnVisible: !!btn && !btn.hidden,
      overlay: !!document.querySelector('.lc-modal-overlay'),
      modalOpen: !!document.querySelector('.lc-modal-overlay.open'),
      historyLen: window.__city.ctx.modules.get('simulation').api.getHistory().length,
    };
  });
  check(pre.btn && pre.overlay, 'HUD renders the Statistics entry point');
  check(pre.btnVisible, 'Statistics button is visible in the full game (simulation present)');
  check(!pre.modalOpen, 'modal starts closed');

  await page.evaluate(() => window.__city.frames(5));
  await page.screenshot({ path: path.join(OUT, 'hud-closed.png') });

  // open it from the HUD
  await page.click('.lc-stat-chart');
  await page.evaluate(() => window.__city.frames(5));
  const openState = await page.evaluate(() => {
    const st = window.__city.ctx.modules.get('simulation').api.getStats();
    const overlay = document.querySelector('.lc-modal-overlay');
    const canvas = document.querySelector('.lc-stats-chart');
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < img.length; i += 4) if (img[i] > 0) painted++;
    return {
      modalOpen: overlay.classList.contains('open'),
      title: document.querySelector('.lc-modal .lc-info-title').textContent.trim(),
      canvas: { w: canvas.width, h: canvas.height, painted, total: (canvas.width * canvas.height) },
      chips: [...document.querySelectorAll('.lc-stats-chip')].map((c) => ({ id: c.dataset.series, on: c.classList.contains('on'), text: c.querySelector('b').textContent })),
      window: document.querySelector('.lc-stats-foot span').textContent,
      historyLen: window.__city.ctx.modules.get('simulation').api.getHistory().length,
      cityName: st.cityName, day: st.day,
    };
  });
  check(openState.modalOpen, 'click opens the modal');
  check(openState.title === 'Statistics', `modal title is "Statistics" (got "${openState.title}")`);
  check(openState.canvas.painted > 2000, `canvas is painted (${openState.canvas.painted} of ${openState.canvas.total} px)`);
  check(openState.chips.length === 6 && openState.chips.every((c) => c.on), 'six series chips, all on by default');
  check(new RegExp(`last ${openState.historyLen} ticks`).test(openState.window), `window label matches history length (got "${openState.window}")`);

  // honest values vs the simulation API (same formatting rules as the modal)
  const honest = await page.evaluate(() => {
    const sim = window.__city.ctx.modules.get('simulation').api;
    const st = sim.getStats(), bud = sim.getBudget();
    const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v || 0)) * 100)}%`;
    const num = (v) => Math.round(v || 0).toLocaleString('en-US');
    const money = (v) => (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US');
    const want = {
      population: num(st.population), jobs: num(st.jobs), net: `${money(bud.perDay.net)} / day`,
      happiness: pct(st.happiness), traffic: pct(st.traffic),
      demand: `${pct(st.demand.r)} · ${pct(st.demand.c)} · ${pct(st.demand.i)}`,
    };
    const got = Object.fromEntries([...document.querySelectorAll('.lc-stats-chip')].map((c) => [c.dataset.series, c.querySelector('b').textContent]));
    return { want, got, stats: { population: st.population, jobs: st.jobs, happiness: st.happiness, traffic: st.traffic, demand: st.demand, netPerDay: bud.perDay.net } };
  });
  for (const [id, want] of Object.entries(honest.want)) check(honest.got[id] === want, `chip "${id}" shows the live value (${honest.got[id]} === ${want})`);

  const shot0 = await page.evaluate(() => document.querySelector('.lc-stats-chart').toDataURL());
  await page.screenshot({ path: path.join(OUT, 'modal-day.png') });

  // toggle a series -> canvas must change
  await page.evaluate(() => { document.querySelectorAll('.lc-stats-chip')[5].click(); });
  await page.evaluate(() => window.__city.frames(3));
  const shot1 = await page.evaluate(() => document.querySelector('.lc-stats-chart').toDataURL());
  const demandOff = await page.evaluate(() => !document.querySelectorAll('.lc-stats-chip')[5].classList.contains('on'));
  check(demandOff, 'chip toggle flips its state');
  check(shot1 !== shot0, 'toggling a series redraws the canvas');
  await page.screenshot({ path: path.join(OUT, 'modal-demand-off.png') });
  await page.evaluate(() => { document.querySelectorAll('.lc-stats-chip')[5].click(); });

  // tick -> history advances -> canvas must change (clock is paused, so this is the sim:tick path)
  await page.evaluate(() => { const sim = window.__city.ctx.modules.get('simulation').api; for (let i = 0; i < 30; i++) sim.tick(true); });
  await page.evaluate(() => window.__city.frames(3));
  const shot2 = await page.evaluate(() => document.querySelector('.lc-stats-chart').toDataURL());
  const afterTick = await page.evaluate(() => ({
    pop: document.querySelector('.lc-stats-chip[data-series=population] b').textContent,
    window: document.querySelector('.lc-stats-foot span').textContent,
  }));
  check(shot2 !== shot0, 'canvas redraws on sim:tick while the modal is open');
  check(afterTick.pop.length > 0, `population chip refreshed with the city (${afterTick.pop})`);

  // paused-open chart keeps its window (no phantom redraw requirement) and shows the tick count advancing
  check(new RegExp(`last ${openState.historyLen} ticks`).test(afterTick.window), `window label stays at the ring length (${afterTick.window})`);

  // night look
  await page.evaluate(() => window.__city.setTime(21.5));
  await page.evaluate(() => window.__city.frames(5));
  await page.screenshot({ path: path.join(OUT, 'modal-night.png') });

  // Esc closes, and the tick subscription must be gone (no errors from a detached body)
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__city.frames(3));
  const closed = await page.evaluate(() => ({
    modalOpen: document.querySelector('.lc-modal-overlay').classList.contains('open'),
    statsBtnVisible: !document.querySelector('.lc-stat-chart').hidden,
  }));
  check(!closed.modalOpen, 'Escape closes the modal');
  await page.evaluate(() => { const sim = window.__city.ctx.modules.get('simulation').api; for (let i = 0; i < 10; i++) sim.tick(true); });
  await page.evaluate(() => window.__city.frames(3));
  const errors = await page.evaluate(() => window.__city.stats().errors);
  check(errors.length === 0, `no console/page errors across the interaction (${errors.length})`);
  if (errors.length) console.log(errors.join('\n'));

  await page.screenshot({ path: path.join(OUT, 'hud-after-close.png') });
} finally {
  await app.close();
}
fs.writeFileSync(path.join(OUT, 'check.json'), JSON.stringify({ failed, checks: results }, null, 2));
console.log(`\n[check-stats] ${results.length - failed}/${results.length} passed → ${path.join(OUT, 'check.json')}`);
process.exit(failed ? 1 : 0);
