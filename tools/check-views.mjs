#!/usr/bin/env node
// Functional check for Wave C4 / F1 — traffic congestion layer + minimap view tinting + views r1 polish.
//   node tools/check-views.mjs
// Full game: HUD row → traffic layer, congestion grid sanity (queued vs free), opened-while-paused correctness,
// minimap tint + footer, Esc, and numeric reads of the overlay's own instance buffers (land ramp spread, box hug,
// gold source, open-land fade). traffic-showcase boots: cross-boot congestion-grid determinism.
// Writes shots/views/c4/*.png + check.json. Exit 1 on any failed check.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';

const OUT = 'shots/views/c4';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// Installed once per page: tiny accessors + a stable FNV hash of the congestion grid.
const HELPERS = `window.__c4 = (() => {
  const C = () => window.__city.ctx;
  const T = () => window.__city.THREE;
  const views = () => C().modules.get('views').api;
  const traffic = () => C().modules.get('traffic').api;
  const grp = () => C().scene.getObjectByName('views');
  const ground = () => grp() && grp().getObjectByName('views-ground');
  const boxes = () => grp() && grp().getObjectByName('views-buildings');
  const minimap = () => document.querySelector('.lc-minimap canvas');
  const foot = () => document.querySelector('.lc-minimap-foot span').textContent;
  const gridHash = () => {
    const g = traffic().getCongestionGrid();
    const bytes = new Uint8Array(g.buffer, g.byteOffset, g.byteLength);
    let h = 2166136261;
    for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 16777619); }
    let nz = 0, mx = 0;
    for (let i = 0; i < g.length; i++) { if (g[i] !== 0) nz++; if (g[i] > mx) mx = g[i]; }
    return { hash: (h >>> 0).toString(16), nz, mx: Math.round(mx * 1e6) / 1e6, len: g.length };
  };
  // minimap pixel snapshots (the visible canvas also carries the camera marker, so compare pixels, not dataURLs)
  const snaps = {};
  const snapMap = (name) => {
    const c = minimap(), g = c.getContext('2d');
    snaps[name] = g.getImageData(0, 0, c.width, c.height).data;
    return true;
  };
  const diffMap = (name) => {
    const c = minimap(), g = c.getContext('2d');
    const now = g.getImageData(0, 0, c.width, c.height).data, base = snaps[name];
    let d = 0;
    for (let i = 0; i < now.length; i += 4) if (now[i] !== base[i] || now[i + 1] !== base[i + 1] || now[i + 2] !== base[i + 2]) d++;
    return { diff: d, total: now.length / 4 };
  };
  return { C, T, views, traffic, grp, ground, boxes, minimap, foot, gridHash, snapMap, diffMap };
})();`;

const app = await openApp({ seed: 1 });
const { page } = app;
try {
  await page.evaluate((h) => { (0, eval)(h); }, HELPERS);
  await page.evaluate(() => window.__city.frames(120)); // let traffic populate + signs cycle
  await page.evaluate(() => window.__city.setTime(12));

  check(await page.evaluate(() => typeof window.__c4.traffic().getCongestionGrid === 'function' && typeof window.__c4.traffic().getCongestionAt === 'function'), 'traffic exposes getCongestionGrid/getCongestionAt');
  const grid0 = await page.evaluate(() => { const g = window.__c4.traffic().getCongestionGrid(); const { w, h } = window.__c4.C().world.size; return { len: g.length, n: w * h }; });
  check(grid0.len === grid0.n, `congestion grid covers the map (${grid0.len} = ${grid0.n})`);

  // run the city so queues form at signals, then read the grid
  await page.evaluate(() => window.__city.resume());
  await page.evaluate(() => window.__city.frames(900));
  await page.evaluate(() => window.__city.pause());
  const cong = await page.evaluate(() => {
    const g = window.__c4.traffic().getCongestionGrid(), cells = window.__c4.C().world.cells;
    const vals = [];
    let roads = 0, busy = 0, max = 0;
    for (let k = 0; k < g.length; k++) {
      if (cells[k].type !== 'road') continue;
      roads++; vals.push(g[k]);
      if (g[k] > 0.25) busy++;
      if (g[k] > max) max = g[k];
    }
    vals.sort((a, b) => a - b);
    return { roads, busy, max, median: vals[Math.floor(vals.length / 2)] };
  });
  check(cong.max > 0.3, `congestion peaks where traffic stops (max ${cong.max.toFixed(2)} > 0.3)`);
  check(cong.busy > 0, `some road cells read busy (>0.25): ${cong.busy}`);
  check(cong.median < 0.15, `typical road cell reads free (median ${cong.median.toFixed(3)} < 0.15)`);

  // ---- HUD entry point, layer, legend, minimap, footer (opened while the clock is paused) ----------
  await page.evaluate(() => window.__c4.snapMap('base'));
  check(await page.evaluate(() => !!document.querySelector('.lc-util-row[data-view="traffic"]')), 'HUD lists a Traffic row');
  await page.click('.lc-util-row[data-view="traffic"]');
  await page.evaluate(() => window.__city.frames(60));
  const on = await page.evaluate(() => ({
    active: window.__c4.views().getView(),
    rowOn: document.querySelector('.lc-util-row[data-view="traffic"]').classList.contains('on'),
    legend: document.querySelector('.lc-view-legend').textContent,
    foot: window.__c4.foot(),
    plates: window.__c4.ground()?.count ?? 0,
    mapDiff: window.__c4.diffMap('base'),
  }));
  check(on.active === 'traffic', `HUD click activates the layer (${on.active})`);
  check(on.rowOn, 'Traffic row highlights');
  check(/Traffic congestion/.test(on.legend) && /Congested/.test(on.legend), 'legend names the view and shows the congestion ramp');
  check(on.foot === 'Traffic', `minimap footer names the active view ("${on.foot}")`);
  check(on.plates > 0, `opened while paused, the layer still paints road plates (${on.plates})`);
  check(on.mapDiff.diff / on.mapDiff.total > 0.05, `minimap tints for the traffic view (${Math.round((on.mapDiff.diff / on.mapDiff.total) * 100)}% of pixels changed)`);
  await page.screenshot({ path: path.join(OUT, 'traffic-view-day.png') });

  // transport is clock-aware since C5: with the clock paused the cars hold and the congestion grid is stable
  const pausedA = await page.evaluate(() => window.__c4.gridHash());
  await page.evaluate(() => window.__city.frames(90));
  const pausedB = await page.evaluate(() => window.__c4.gridHash());
  check(pausedA.mx > 0 && pausedB.mx > 0, `grid still reports queues while the clock is paused (max ${pausedB.mx})`);
  check(pausedA.hash === pausedB.hash, 'grid and painted layer are stable while the clock is paused (traffic holds)');

  // land + power polish shots (numeric checks below)
  await page.evaluate(() => window.__c4.snapMap('traffic'));
  await page.evaluate(() => window.__c4.views().setView('land'));
  await page.evaluate(() => window.__city.frames(60));
  await page.screenshot({ path: path.join(OUT, 'land-view-day.png') });
  const landMaps = await page.evaluate(() => ({ vsBase: window.__c4.diffMap('base'), vsTraffic: window.__c4.diffMap('traffic') }));
  check(landMaps.vsBase.diff / landMaps.vsBase.total > 0.05 && landMaps.vsTraffic.diff / landMaps.vsTraffic.total > 0.05, 'minimap tints for the land view (differs from both base and traffic)');
  const land = await page.evaluate(() => {
    const THREE = window.__c4.T();
    const refs = { low: new THREE.Color(0xd12a1e), mid: new THREE.Color(0xf2b21a), high: new THREE.Color(0x14c38e) };
    const near = { low: 0, mid: 0, high: 0 };
    for (const mesh of [window.__c4.ground(), window.__c4.boxes()]) {
      if (!mesh?.instanceColor) continue;
      const a = mesh.instanceColor.array;
      for (let k = 0; k < mesh.count; k++) {
        const r = a[k * 3], gg = a[k * 3 + 1], b = a[k * 3 + 2];
        let best = 'mid', bd = Infinity;
        for (const key of Object.keys(refs)) {
          const c = refs[key], d = (r - c.r) ** 2 + (gg - c.g) ** 2 + (b - c.b) ** 2;
          if (d < bd) { bd = d; best = key; }
        }
        near[best]++;
      }
    }
    return near;
  });
  const landTotal = land ? land.low + land.mid + land.high : 0;
  check(land && land.low > 0 && land.high > 0, `land ramp reaches both ends (low ${land?.low}, high ${land?.high})`);
  check(land && land.mid / landTotal < 0.85, `land ramp is not a uniform yellow wash (mid ${Math.round((land.mid / landTotal) * 100)}%)`);

  // box hug + gold source on the power view
  await page.evaluate(() => window.__c4.views().setView('power'));
  await page.evaluate(() => window.__city.frames(60));
  await page.screenshot({ path: path.join(OUT, 'power-view-day.png') });
  const boxCheck = await page.evaluate(() => {
    const g = window.__c4.boxes(), THREE = window.__c4.T();
    const all = [...window.__c4.C().world.buildings.values()];
    const b = all[0];
    const idx = all.findIndex((x) => x.id === b.id);
    const m = new THREE.Matrix4(); g.getMatrixAt(idx, m);
    const s = new THREE.Vector3(); m.decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
    const plant = all.find((x) => x.kind === 'power_plant');
    let plantDist = null;
    if (plant) {
      const pi = all.findIndex((x) => x.id === plant.id);
      const c = new THREE.Color(); g.getColorAt(pi, c);
      const gold = new THREE.Color(0xffb800);
      plantDist = Math.hypot(c.r - gold.r, c.g - gold.g, c.b - gold.b);
    }
    return { w: b.w, d: b.d, h: b.height, sx: s.x, sy: s.y, sz: s.z, plantDist };
  });
  const cs = 8, pad = 0.15;
  check(Math.abs(boxCheck.sx - (boxCheck.w * cs + pad)) < 0.02 && Math.abs(boxCheck.sz - (boxCheck.d * cs + pad)) < 0.02, `tint boxes hug the footprint (scale ${boxCheck.sx.toFixed(2)}x${boxCheck.sz.toFixed(2)} for ${boxCheck.w}x${boxCheck.d} cells)`);
  check(Math.abs(boxCheck.sy - (boxCheck.h + pad)) < 0.02, `tint boxes hug the roof (height ${boxCheck.sy.toFixed(2)} vs ${boxCheck.h} + ${pad})`);
  check(boxCheck.plantDist !== null && boxCheck.plantDist < 0.05, `power plant source box is saturated gold (colour distance ${boxCheck.plantDist?.toFixed(4)})`);

  // open-land fade: no coverage plate farther than FADE_CELLS (12) from zoned/built land
  const fade = await page.evaluate(() => {
    const world = window.__c4.C().world, THREE = window.__c4.T();
    const { w, h } = world.size, n = w * h, cells = world.cells;
    const dist = new Int16Array(n), q = new Int32Array(n);
    let head = 0, tail = 0;
    for (let k = 0; k < n; k++) { const t = cells[k].type; if (t === 'zone' || t === 'building') { dist[k] = 0; q[tail++] = k; } else dist[k] = 0x7fff; }
    while (head < tail) {
      const k = q[head++], d = dist[k] + 1, i = k % w, m0 = k - 1, m1 = k + 1, m2 = k - w, m3 = k + w;
      if (i > 0 && dist[m0] > d) { dist[m0] = d; q[tail++] = m0; }
      if (i < w - 1 && dist[m1] > d) { dist[m1] = d; q[tail++] = m1; }
      if (k >= w && dist[m2] > d) { dist[m2] = d; q[tail++] = m2; }
      if (k < n - w && dist[m3] > d) { dist[m3] = d; q[tail++] = m3; }
    }
    const g = window.__c4.ground(), m = new THREE.Matrix4(), p = new THREE.Vector3();
    let max = 0;
    for (let k = 0; k < g.count; k++) {
      g.getMatrixAt(k, m); p.setFromMatrixPosition(m);
      const c = world.worldToCell(p.x, p.z);
      const d = c.i >= 0 && c.j >= 0 && c.i < w && c.j < h ? dist[c.j * w + c.i] : 0;
      if (d > max) max = d;
    }
    return max;
  });
  check(fade <= 12, `served open land fades beyond 12 cells from the city (max plate distance ${fade})`);
  await page.evaluate(() => window.__city.setTime(21.5));
  await page.evaluate(() => window.__city.frames(45));
  await page.screenshot({ path: path.join(OUT, 'power-view-night.png') });

  // Esc closes the view; minimap returns to the base map (camera-marker noise allowed for, so pixel-diff it)
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__city.frames(60));
  const off = await page.evaluate(() => ({ view: window.__c4.views().getView(), foot: window.__c4.foot(), vsBase: window.__c4.diffMap('base') }));
  check(off.view === null && off.foot === 'Map', `Esc closes the layer and the footer resets ("${off.foot}")`);
  check(off.vsBase.diff / off.vsBase.total < 0.02, `minimap returns to the base map (${(off.vsBase.diff / off.vsBase.total * 100).toFixed(2)}% residual pixels)`);

  const errors = await page.evaluate(() => window.__city.stats().errors);
  check(errors.length === 0, `no console/page errors in the full-game pass (${errors.length})`);
  if (errors.length) console.log(errors.join('\n'));
} finally {
  await app.close();
}

// ---- cross-boot determinism on the traffic showcase (deterministic warm-up + fixed dt) -------------
const hashes = [];
for (let i = 0; i < 2; i++) {
  const s = await openApp({ showcase: 'traffic', seed: 1 });
  try {
    await s.page.evaluate((h) => { (0, eval)(h); }, HELPERS);
    await s.page.evaluate(() => window.__city.frames(600));
    hashes.push(await s.page.evaluate(() => window.__c4.gridHash()));
    if (i === 0) await s.page.screenshot({ path: path.join(OUT, 'traffic-showcase.png') });
  } finally { await s.close(); }
}
check(hashes[0].hash === hashes[1].hash && hashes[0].nz > 0, `congestion grid is byte-identical across boots (${hashes[0].hash} = ${hashes[1].hash}, ${hashes[0].nz} live cells)`);

fs.writeFileSync(path.join(OUT, 'check.json'), JSON.stringify({ failed, checks: results, hashes }, null, 2));
console.log(`\n[check-views] ${results.length - failed}/${results.length} passed → ${path.join(OUT, 'check.json')}`);
process.exit(failed ? 1 : 0);
