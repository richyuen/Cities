#!/usr/bin/env node
// Functional check for the V5 beauty-shot pass (B4 levers 1+2).
//   node tools/check-beauty.mjs
// 1) ?hud=0 starts with the HUD hidden (same state as pressing H) and the default boot still shows it.
// 2) Core preset geometry: skyline is a ~250-500 m 3/4 framing, overview/aerial are tightened to their bands, and
//    closeup frames the tallest building near downtown from a sane 3/4 distance (fallback on empty worlds).
// 3) Captures the five HUD-free hero shots (sk eyline/overview/street/closeup/aerial) with the new presets for the
//    blind set-3 reference, all `errors: []`.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';

const OUT = 'shots/beauty/v5';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const captureErrors = [];

const app = await openApp({ seed: 1, tod: 12, hud: 0 });
try {
  await app.page.evaluate(async () => { await window.__city.frames(90); });
  const hud = await app.page.evaluate(() => {
    const ui = window.__city.ctx.modules.get('ui');
    const root = document.querySelector('.lc-hud');
    return { visible: ui.api.isHudVisible(), cls: root ? root.className : null };
  });
  check(hud.visible === false, '?hud=0 boots with the HUD hidden (ui.api.isHudVisible() === false)');
  check(/\blc-hidden\b/.test(hud.cls || ''), `HUD root carries lc-hidden (${hud.cls})`);
  const chip = await app.page.evaluate(() => {
    const el = document.querySelector('.lc-show-ui');
    return el ? getComputedStyle(el).display : 'missing';
  });
  check(chip === 'none', `capture mode also hides the "Show HUD" chip (display: ${chip})`);

  // preset geometry (applied one at a time; each apply is synchronous)
  const geo = await app.page.evaluate(() => {
    const ctx = window.__city.ctx;
    const out = {};
    for (const name of ['skyline', 'overview', 'aerial', 'closeup']) {
      window.__city.setCamera(name);
      const p = ctx.camera.position, t = ctx.controls.target;
      out[name] = { d: p.distanceTo(t), py: p.y, ty: t.y };
    }
    // closeup sanity: nearest building to the closeup target + its height/centre distance
    window.__city.setCamera('closeup');
    const t = ctx.controls.target, world = ctx.world;
    let near = null, best = Infinity;
    for (const b of world.buildings.values()) {
      const c = world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2);
      const d = Math.hypot(c.x - t.x, c.z - t.z);
      if (d < best) { best = d; near = { d, h: b.height || 10, x: c.x, z: c.z }; }
    }
    out.closeupNear = near;
    return out;
  });
  check(geo.skyline.d > 250 && geo.skyline.d < 500, `skyline distance ${geo.skyline.d.toFixed(0)} m in [250, 500]`);
  check(geo.overview.d > 800 && geo.overview.d < 1150, `overview distance ${geo.overview.d.toFixed(0)} m in (800, 1150]`);
  check(geo.aerial.d > 900 && geo.aerial.d < 1350, `aerial distance ${geo.aerial.d.toFixed(0)} m in (900, 1350]`);
  check(geo.closeupNear && geo.closeupNear.d < 80, `closeup target is within 80 m of a building centre (${geo.closeupNear ? geo.closeupNear.d.toFixed(1) : 'none'} m)`);
  check(geo.closeupNear && geo.closeupNear.h >= 10, `closeup frames a real building (height ${geo.closeupNear ? geo.closeupNear.h : '?'} m)`);
  check(geo.closeup.d > 18 && geo.closeup.d < 130, `closeup camera distance ${geo.closeup.d.toFixed(0)} m in (18, 130)`);

  // the five hero shots (HUD-free, new presets)
  for (const [preset, tod, name] of [['skyline', 17.7, '01-skyline-golden'], ['overview', 12, '02-overview-noon'], ['street', 21.5, '03-street-night'], ['closeup', 17.7, '04-closeup-golden'], ['aerial', 6.3, '05-aerial-dawn']]) {
    await app.page.evaluate(({ preset, tod }) => { window.__city.setCamera(preset); window.__city.setTime(tod); }, { preset, tod });
    captureErrors.push(...(await app.capture(path.join(OUT, `${name}.png`), { settle: 12, sampleMs: 400 })).errors);
  }
  check(captureErrors.length === 0, `all HUD-free captures report no errors (${captureErrors.length})`);
} finally {
  await app.close();
}

const app2 = await openApp({ seed: 1, tod: 12 });
try {
  await app2.page.evaluate(async () => { await window.__city.frames(30); });
  const visible = await app2.page.evaluate(() => window.__city.ctx.modules.get('ui').api.isHudVisible());
  check(visible === true, 'without ?hud the HUD boots visible (unchanged)');
} finally {
  await app2.close();
}

fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ ok: failed === 0, failed, checks: results.length, results, captureErrors }, null, 2));
console.log(`\n[check-beauty] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
