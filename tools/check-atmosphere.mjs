#!/usr/bin/env node
// Functional check for Wave B3 — atmosphere pass (V4).
//   node tools/check-atmosphere.mjs
// 1) Sky model (Node, pure skyMath): the low-sun chroma boost lifts the sun-side horizon chroma by the designed
//    ≥ 30 % at dawn/dusk and is an exact no-op at noon; also measures the rendered sun-side crop chroma at dusk vs
//    noon (screenshot decoded through a canvas in-page).
// 2) Puddles (audio showcase, rain variant): live material reads (envMapIntensity/roughness/opacity + the v2 rim
//    patch) and day/dusk closeups.
// 3) Roads sheen (roads showcase): the live surface material constants + noon/low-sun captures (the r2 nit was
//    angle variance, so both tods must read as the same dark plate).
// 4) Terrain closeup framing: the preset eye is ≥ 5 m above local ground and looks downward (the old framing was
//    a 4.2 m grazing eye that foreshortened 0.8 m risers).
// Exit 1 on any failed check. Evidence: shots/atmosphere/b3/*.png + summary.json.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';
import { skyParams, ramp, luminance, SKY_RAMPS } from '../src/environment/skyMath.js';

const OUT = 'shots/atmosphere/b3';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const chroma = (c) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);

// --- 1) sky model (Node) -----------------------------------------------------------------------------------------
const clear = { cloud: 0, rain: 0, fog: 0 };
for (const [e, minRatio, label] of [[-2, 1.45, 'dawn (sun -2°)'], [4, 1.45, 'sunrise (4°)'], [6, 1.25, 'early (6°)'], [12, 1.2, 'morning (12°)']]) {
  const p = skyParams(e, clear, {});
  const raw = ramp(SKY_RAMPS.HORIZON_SUN, e, [0, 0, 0]);
  const ratio = chroma(p.horizonSun) / chroma(raw);
  check(ratio >= minRatio, `sky chroma ${label}: sun-side horizon chroma ×${ratio.toFixed(3)} (raw ${chroma(raw).toFixed(3)} → ${chroma(p.horizonSun).toFixed(3)}), target ≥ ${minRatio}`);
}
{
  const e = 45, p = skyParams(e, clear, {});
  const raw = ramp(SKY_RAMPS.HORIZON_SUN, e, [0, 0, 0]);
  check(Math.abs(chroma(p.horizonSun) - chroma(raw)) < 1e-9, `sky chroma noon no-op (45°): chroma ${chroma(p.horizonSun).toFixed(4)} === raw ${chroma(raw).toFixed(4)}`);
  const g = skyParams(e, clear, {}).glow, gr = ramp(SKY_RAMPS.GLOW, e, [0, 0, 0]);
  check(Math.abs(chroma(g) - chroma(gr)) < 1e-9, 'sky chroma noon no-op (glow)');
  check(luminance(skyParams(-9, clear, {}).zenith) < 0.05, 'sky night zenith stays dark');
}

// --- browser helpers --------------------------------------------------------------------------------------------
async function cropStats(page, clip) {
  const buf = await page.screenshot({ clip });
  const b64 = buf.toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, img.width, img.height).data;
    let n = 0, sr = 0, sg = 0, sb = 0, chroma = 0;
    for (let i = 0; i < d.length; i += 4) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; chroma += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]); n++; }
    return { r: sr / n, g: sg / n, b: sb / n, chroma: chroma / n };
  }, b64);
}

const captureErrors = [];
const run = async (opts, fn) => {
  const app = await openApp(opts);
  try { await fn(app); } finally { await app.close(); }
};

// --- 2) environment: rendered dusk vs noon crop -----------------------------------------------------------------
await run({ showcase: 'environment', variant: 'default', seed: 1, tod: 12 }, async (app) => {
  await app.page.evaluate(() => window.__city.frames(60));
  const crops = {};
  for (const tod of [12, 18]) {
    await app.page.evaluate(({ tod }) => { window.__city.setCamera('environment:sky'); window.__city.setTime(tod); }, { tod });
    await app.page.evaluate(() => window.__city.frames(12));
    const log = await app.capture(path.join(OUT, `sky-${tod === 12 ? 'noon' : 'dusk'}.png`), { settle: 8, sampleMs: 300 });
    captureErrors.push(...log.errors);
    // sun-side horizon crop (the sky preset centres the sun near uv (0.34, 0.52) at dusk) + top-of-frame crop
    crops[tod] = {
      horizon: await cropStats(app.page, { x: 453, y: 350, width: 400, height: 200 }),
      top: await cropStats(app.page, { x: 760, y: 40, width: 400, height: 200 }),
    };
  }
  const c = crops[18].horizon, n = crops[12].horizon;
  const warmD = c.r - c.b, warmN = n.r - n.b;
  check(c.chroma > 30, `rendered dusk sun-side crop stays saturated: mean chroma ${c.chroma.toFixed(1)} > 30 (R ${c.r.toFixed(0)} G ${c.g.toFixed(0)} B ${c.b.toFixed(0)})`);
  check(warmD > warmN + 10, `rendered dusk horizon is distinctly warmer than noon: R-B ${warmD.toFixed(0)} (dusk) vs ${warmN.toFixed(0)} (noon)`);
  const noRays = await app.page.evaluate(() => !window.__city.ctx.camera.getObjectByName('environment:godrays'));
  check(noRays, 'god-ray experiment is not shipped (dropped per design §3, see review)');
});

// --- 3) audio puddles -------------------------------------------------------------------------------------------
await run({ showcase: 'audio', variant: 'rain', seed: 1, tod: 12 }, async (app) => {
  await app.page.evaluate(() => window.__city.frames(60));
  const info = await app.page.evaluate(() => {
    let found = null;
    window.__city.ctx.scene.traverse((o) => {
      if (!found && o.name === 'audio:puddle' && o.material) {
        const m = o.material;
        found = { envMapIntensity: m.envMapIntensity, roughness: m.roughness, opacity: m.opacity, emissiveIntensity: m.emissiveIntensity, cacheKey: m.customProgramCacheKey ? m.customProgramCacheKey() : null };
      }
    });
    return found;
  });
  check(!!info, 'audio rain showcase stages puddle tiles');
  if (info) {
    check(info.envMapIntensity >= 2.2, `puddle envMapIntensity boosted ${info.envMapIntensity} (≥ 2.2; was 1.2)`);
    check(info.roughness <= 0.1, `puddle roughness ${info.roughness} ≤ 0.1 (was 0.015, near-mirror over the PMREM)`);
    check(String(info.cacheKey).startsWith('audio-puddle-v2'), `puddle rim patch is the softened v2 (${info.cacheKey})`);
  }
  for (const [preset, tod, name] of [['audio:closeup', 12, 'puddles-noon'], ['audio:closeup', 17.7, 'puddles-dusk']]) {
    await app.page.evaluate(({ preset, tod }) => { window.__city.setCamera(preset); window.__city.setTime(tod); }, { preset, tod });
    captureErrors.push(...(await app.capture(path.join(OUT, `${name}.png`), { settle: 12, sampleMs: 300 })).errors);
  }
});

// --- 4) roads sheen ---------------------------------------------------------------------------------------------
await run({ showcase: 'roads', variant: 'default', seed: 1, tod: 12 }, async (app) => {
  await app.page.evaluate(() => window.__city.frames(60));
  const info = await app.page.evaluate(() => {
    let found = null;
    window.__city.ctx.scene.traverse((o) => {
      if (!found && o.material && o.material.name === 'plastic:#4A4E52') {
        const m = o.material;
        found = { roughness: m.roughness, clearcoat: m.clearcoat, envMapIntensity: m.envMapIntensity };
      }
    });
    return found;
  });
  check(!!info, 'roads showcase stages the asphalt surface material');
  if (info) {
    check(info.roughness === 0.44 && info.clearcoat === 0.35 && info.envMapIntensity === 1.1,
      `roads sheen constants ${JSON.stringify(info)} === { roughness: 0.44, clearcoat: 0.35, envMapIntensity: 1.1 }`);
  }
  for (const [preset, tod, name] of [['roads:default', 12, 'roads-noon'], ['roads:default', 17.7, 'roads-dusk']]) {
    await app.page.evaluate(({ preset, tod }) => { window.__city.setCamera(preset); window.__city.setTime(tod); }, { preset, tod });
    captureErrors.push(...(await app.capture(path.join(OUT, `${name}.png`), { settle: 12, sampleMs: 300 })).errors);
  }
});

// --- 5) terrain closeup framing ---------------------------------------------------------------------------------
await run({ showcase: 'terrain', variant: 'default', seed: 1, tod: 12 }, async (app) => {
  await app.page.evaluate(() => window.__city.frames(60));
  await app.page.evaluate(() => window.__city.setCamera('terrain:closeup'));
  await app.page.evaluate(() => window.__city.frames(12));
  const info = await app.page.evaluate(() => {
    const ctx = window.__city.ctx;
    const cam = ctx.camera, t = ctx.controls.target;
    const terr = ctx.modules.get('terrain').api;
    const ground = terr.surfaceHeight(cam.position.x, cam.position.z);
    const horiz = Math.hypot(t.x - cam.position.x, t.z - cam.position.z);
    return { eye: cam.position.y - ground, pitchDeg: Math.atan2(t.y - cam.position.y, horiz) * 180 / Math.PI, fov: cam.fov };
  });
  check(info.eye >= 5, `terrain closeup eye height ${info.eye.toFixed(2)} m ≥ 5 (was 4.2 m grazing)`);
  check(info.pitchDeg < -2, `terrain closeup looks below the horizon: pitch ${info.pitchDeg.toFixed(1)}° < -2°`);
  captureErrors.push(...(await app.capture(path.join(OUT, 'terrain-closeup.png'), { settle: 12, sampleMs: 300 })).errors);
});

check(captureErrors.length === 0, `all captures report no errors (${captureErrors.length})`);

const summary = { ok: failed === 0, failed, checks: results.length, results, captureErrors };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n[check-atmosphere] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
