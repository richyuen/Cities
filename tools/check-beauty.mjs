#!/usr/bin/env node
// Functional check for the beauty-shot path (B4 levers 1+2, LOOP cycle 1 hero framing).
//   node tools/check-beauty.mjs [--out shots/beauty/v5]
// 1) ?hud=0 starts with the HUD hidden (same state as pressing H) and the default boot still shows it.
// 2) Core preset geometry: skyline is a low 3/4 of the tall cluster, overview/aerial are oblique with the city
//    filling the frame, closeup frames a civic hero (entrance face, unoccluded, fit), street has real frontage.
// 3) Captures the five HUD-free hero shots (skyline/overview/street/closeup/aerial) for the blind sets.
import fs from 'node:fs';
import path from 'node:path';
import { openApp, parseArgs } from './shot.mjs';

const a = parseArgs(process.argv.slice(2));
const OUT = a.out || 'shots/beauty/v5';
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

  // preset geometry (applied one at a time; each apply is synchronous). LOOP cycle 1 tightened these:
  // skyline is a low 3/4 of the tall cluster with the avenue leading in, overview/aerial are oblique over
  // downtown + bay, closeup frames a civic hero with its entrance face and street context, street is a
  // busier avenue at eye height.
  const geo = await app.page.evaluate(() => {
    const ctx = window.__city.ctx, THREE = window.__city.THREE, world = ctx.world;
    const out = {};
    const elev = (p, t) => Math.asin((p.y - t.y) / Math.max(1e-6, p.distanceTo(t))) * 180 / Math.PI;
    for (const name of ['skyline', 'overview', 'aerial', 'street', 'closeup']) {
      window.__city.setCamera(name);
      const p = ctx.camera.position, t = ctx.controls.target;
      out[name] = { d: p.distanceTo(t), py: p.y, ty: t.y, elev: elev(p, t), fov: ctx.camera.fov };
    }
    // aerial must contain bay water in the near/middle bands (cycle-1 critic issue 2: the pre-fix aerial had 0).
    window.__city.setCamera('aerial');
    {
      const cam = ctx.camera, v = new THREE.Vector3();
      let nearWater = 0;
      for (const c of world.cells) {
        if (c.type !== 'water') continue;
        const p = world.cellToWorld(c.i, c.j);
        v.set(p.x, 0.3, p.z).project(cam);
        if (v.z <= 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.y < 0.33) nearWater++;
      }
      out.aerialNearWater = nearWater;
    }
    // closeup at its hero tod: subject, fit, unocclusion, near-corner framing, and sun-side check
    window.__city.setTime(17.7);
    window.__city.setCamera('closeup');
    const t = ctx.controls.target, cam = ctx.camera;
    let near = null, best = Infinity;
    for (const b of world.buildings.values()) {
      const c = world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2);
      const d = Math.hypot(c.x - t.x, c.z - t.z);
      if (d < best) { best = d; near = { id: b.id, kind: b.kind, h: b.height || 10, x: c.x, z: c.z, d: best, w: b.w || 1, d2: b.d || 1 }; }
    }
    if (near) {
      const cs = world.cellSize || 8;
      const diag = Math.hypot(near.w * cs, near.d2 * cs);
      const cd = Math.hypot(near.x - cam.position.x, near.z - cam.position.z);
      const half = Math.tan((ctx.camera.fov * Math.PI) / 180 / 2);
      const fit = near.h / (2 * Math.max(0.1, cd) * half);
      near.camDist = +cd.toFixed(2);
      near.fit = Number.isFinite(fit) ? +fit.toFixed(3) : 999;
      const dir = new THREE.Vector3(near.x - cam.position.x, (near.h * 0.45) - (cam.position.y), near.z - cam.position.z).normalize();
      const hit = world.raycastBuildings(new THREE.Ray(cam.position.clone(), dir), near.d + 60);
      near.unoccluded = !!hit && hit.id === near.id;
      // near vertical corner NDC (the crop the centre-distance fit could not see)
      const hdir = new THREE.Vector3(near.x - cam.position.x, 0, near.z - cam.position.z).normalize();
      const nx = near.x + hdir.x * diag / 2, nz = near.z + hdir.z * diag / 2;
      const gy = world.getHeight(near.x, near.z);
      near.cornerTop = +new THREE.Vector3(nx, gy + near.h, nz).project(cam).y.toFixed(3);
      near.cornerBottom = +new THREE.Vector3(nx, gy, nz).project(cam).y.toFixed(3);
      // sun side: horizontal dot of the camera's direction FROM the subject with the sun direction
      const sd = ctx.clock.sunDir;
      const cdir = new THREE.Vector3(cam.position.x - near.x, 0, cam.position.z - near.z).normalize();
      near.sunDot = +(cdir.x * sd.x + cdir.z * sd.z).toFixed(3);
    }
    out.closeupNear = near;
    // street context at night: buildings within 60 m of the eye + eye height above ground
    window.__city.setTime(21.5);
    window.__city.setCamera('street');
    const sp = ctx.camera.position;
    let nearby = 0;
    for (const b of world.buildings.values()) {
      const c = world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2);
      if (Math.hypot(c.x - sp.x, c.z - sp.z) < 60) nearby++;
    }
    out.streetNearby = nearby;
    out.streetEye = sp.y - world.getHeight(sp.x, sp.z);
    return out;
  });
  const inBand = (v, lo, hi) => v > lo && v < hi;
  check(inBand(geo.skyline.d, 300, 520), `skyline distance ${geo.skyline.d.toFixed(0)} m in (300, 520)`);
  check(inBand(geo.skyline.elev, 3, 12), `skyline elevation ${geo.skyline.elev.toFixed(1)} deg in (3, 12)`);
  check(inBand(geo.overview.d, 450, 760), `overview distance ${geo.overview.d.toFixed(0)} m in (450, 760)`);
  check(inBand(geo.overview.elev, 17, 32), `overview elevation ${geo.overview.elev.toFixed(1)} deg in (17, 32)`);
  check(inBand(geo.aerial.d, 600, 950), `aerial distance ${geo.aerial.d.toFixed(0)} m in (600, 950)`);
  check(inBand(geo.aerial.elev, 17, 45), `aerial elevation ${geo.aerial.elev.toFixed(1)} deg in (17, 45)`);
  check(geo.aerialNearWater >= 150, `aerial has bay water in the near/middle bands (${geo.aerialNearWater} cells >= 150)`);
  const cn = geo.closeupNear;
  check(cn && cn.d < 28, `closeup target is on a building (${cn ? cn.d.toFixed(1) : 'none'} m)`);
  check(cn && ['school', 'hospital', 'fire_department', 'police_station'].includes(cn.kind), `closeup frames a civic hero (${cn ? cn.kind : '?'})`);
  check(cn && cn.fit > 0.35 && cn.fit < 1.05, `closeup hero fits the frame (height fraction ${cn ? cn.fit.toFixed(2) : '?'})`);
  check(cn && cn.unoccluded, 'closeup eye→hero ray meets the hero first (not a neighbour wall)');
  check(cn && cn.cornerTop <= 1.06 && cn.cornerBottom >= -1.06, `closeup near corner inside the frame (top ${cn ? cn.cornerTop : '?'}, bottom ${cn ? cn.cornerBottom : '?'})`);
  check(cn && cn.sunDot > 0.1, `closeup ships sun-side at 17.7 (dot ${cn ? cn.sunDot : '?'} > 0.1)`);
  check(geo.streetEye > 1.6 && geo.streetEye < 4.5, `street eye height ${geo.streetEye.toFixed(1)} m in (1.6, 4.5)`);
  check(geo.streetNearby >= 5, `street has ${geo.streetNearby} buildings within 60 m (>= 5)`);

  // the five hero shots (HUD-free, new presets)
  for (const [preset, tod, name] of [['skyline', 17.7, '01-skyline-golden'], ['overview', 12, '02-overview-noon'], ['street', 21.5, '03-street-night'], ['closeup', 17.7, '04-closeup-golden'], ['aerial', 6.3, '05-aerial-dawn']]) {
    await app.page.evaluate(({ preset, tod }) => { window.__city.setCamera(preset); window.__city.setTime(tod); window.__city.resetPresentation?.(); }, { preset, tod });
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

// Empty-world fallbacks (cycle-1 critic issue 5: the roads showcase street fallback was lifted by the
// MapControls polar clamp because its target sat above the authored eye). Every preset must apply finite and
// sane here, and the street fallback must stay at its authored eye height.
const app3 = await openApp({ showcase: 'roads', seed: 1, tod: 12 });
try {
  await app3.page.evaluate(() => window.__city.frames(30));
  const fb = await app3.page.evaluate(() => {
    const ctx = window.__city.ctx, out = {};
    for (const name of window.__city.presets()) {
      const ok = window.__city.setCamera(name);
      const p = ctx.camera.position, t = ctx.controls.target;
      out[name] = { ok, finite: [p.x, p.y, p.z, t.x, t.y, t.z, ctx.camera.fov].every(Number.isFinite), eye: +(p.y - ctx.world.getHeight(p.x, p.z)).toFixed(2) };
    }
    return out;
  });
  const allOk = Object.values(fb).every((v) => v.ok && v.finite);
  check(allOk, `showcase=roads: all ${Object.keys(fb).length} core presets apply finite (${allOk ? 'ok' : JSON.stringify(fb)})`);
  check(fb.street.eye > 1.4 && fb.street.eye < 2.4, `showcase=roads street fallback eye ${fb.street.eye} m in (1.4, 2.4)`);
  check(fb.closeup.ok && fb.closeup.finite, 'showcase=roads closeup fallback applies finite');
} finally {
  await app3.close();
}

// Multi-seed gates (re-verification issues 1/2: the street face-plant and the near-centre lamp were
// seed-dependent). Seeds 2 and 23 must hold the same geometry gates as seed 1.
for (const seed of [2, 23]) {
  const appS = await openApp({ seed, tod: 17.7, hud: 0 });
  try {
    await appS.page.evaluate(() => window.__city.frames(60));
    const g = await appS.page.evaluate(() => {
      const ctx = window.__city.ctx, THREE = window.__city.THREE, world = ctx.world;
      const cs = world.cellSize || 8;
      const clearance = (x, z) => {
        let m = Infinity;
        for (const b of world.buildings.values()) {
          const c0 = world.cellToWorld(b.i, b.j);
          const minX = c0.x - cs / 2, minZ = c0.z - cs / 2, maxX = minX + (b.w || 1) * cs, maxZ = minZ + (b.d || 1) * cs;
          const dx = x < minX ? minX - x : (x > maxX ? x - maxX : 0);
          const dz = z < minZ ? minZ - z : (z > maxZ ? z - maxZ : 0);
          const d = Math.hypot(dx, dz);
          if (d < m) m = d;
        }
        return m;
      };
      const out = {};
      window.__city.setCamera('street');
      const p = ctx.camera.position, t = ctx.controls.target;
      out.street = { eye: +(p.y - world.getHeight(p.x, p.z)).toFixed(2), clear: +clearance(p.x, p.z).toFixed(2), nearestCone: 999 };
      {
        const vx = t.x - p.x, vz = t.z - p.z, vl = Math.hypot(vx, vz) || 1;
        const dx = vx / vl, dz = vz / vl, rx = -dz, rz = dx;
        for (const pr of world.props.values()) {
          const ox = pr.x - p.x, oz = pr.z - p.z, d = Math.hypot(ox, oz);
          if (d > 140 || d < 0.01) continue;
          const lat = Math.abs((ox * rx + oz * rz) / d);
          const along = (ox * dx + oz * dz) / d;
          if (along < 0.3 || lat > 0.25) continue;
          if (d < out.street.nearestCone) out.street.nearestCone = d;
        }
        out.street.nearestCone = +out.street.nearestCone.toFixed(1);
      }
      window.__city.setCamera('closeup');
      const tt = ctx.controls.target, cam = ctx.camera;
      let near = null, bestD = Infinity;
      for (const b of world.buildings.values()) {
        const c = world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2);
        const d = Math.hypot(c.x - tt.x, c.z - tt.z);
        if (d < bestD) { bestD = d; near = { id: b.id, kind: b.kind, x: c.x, z: c.z, h: b.height || 10, w: b.w || 1, d2: b.d || 1 }; }
      }
      const cdir = new THREE.Vector3(cam.position.x - near.x, 0, cam.position.z - near.z).normalize();
      const sd = ctx.clock.sunDir;
      const diag = Math.hypot(near.w * cs, near.d2 * cs);
      const nx = near.x + cdir.x * diag / 2, nz = near.z + cdir.z * diag / 2;
      const gy = world.getHeight(near.x, near.z);
      const rayDir = new THREE.Vector3(near.x - cam.position.x, gy + near.h * 0.42 - cam.position.y, near.z - cam.position.z).normalize();
      const hit = world.raycastBuildings(new THREE.Ray(cam.position.clone(), rayDir), near.h * 4 + 80);
      out.closeup = {
        kind: near.kind,
        sunDot: +(cdir.x * sd.x + cdir.z * sd.z).toFixed(3),
        cornerTop: +new THREE.Vector3(nx, gy + near.h, nz).project(cam).y.toFixed(3),
        cornerBottom: +new THREE.Vector3(nx, gy, nz).project(cam).y.toFixed(3),
        unoccluded: !!hit && hit.id === near.id,
      };
      return out;
    });
    check(g.street.eye > 2.3 && g.street.eye < 3.4, `seed ${seed}: street eye ${g.street.eye} m in (2.3, 3.4)`);
    check(g.street.clear >= 4, `seed ${seed}: street eye clearance ${g.street.clear} m from facades (>= 4)`);
    check(g.street.nearestCone >= 10, `seed ${seed}: nearest cone prop ${g.street.nearestCone} m (>= 10)`);
    check(['school', 'hospital', 'fire_department', 'police_station'].includes(g.closeup.kind), `seed ${seed}: closeup civic (${g.closeup.kind})`);
    check(g.closeup.sunDot > 0.1, `seed ${seed}: closeup sun-side dot ${g.closeup.sunDot} (> 0.1)`);
    check(g.closeup.cornerTop <= 1.1 && g.closeup.cornerBottom >= -1.1, `seed ${seed}: closeup near corner inside (${g.closeup.cornerTop} / ${g.closeup.cornerBottom})`);
    check(g.closeup.unoccluded, `seed ${seed}: closeup unoccluded`);
  } finally {
    await appS.close();
  }
}

fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ ok: failed === 0, failed, checks: results.length, results, captureErrors }, null, 2));
console.log(`\n[check-beauty] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
