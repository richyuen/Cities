#!/usr/bin/env node
// Headless-Chrome screenshot + log tool.
//   node tools/shot.mjs --showcase roads --variant default --preset overview --tod 17.5 --seed 1 --out shots/roads/a.png
//   node tools/shot.mjs --preset skyline --tod 21.5 --out shots/game/night.png   (full game)
// Writes <out>.png and <out>.json { fps, drawCalls, triangles, errors, warnings, modules, gpu, ... }.
// Exit code 1 if the server is down, the app never becomes ready, or --strict and errors.length > 0.

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

export const BASE_URL = process.env.CITY_URL || `http://127.0.0.1:${process.env.CITY_PORT || 5188}`;

export function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k.startsWith('--')) {
      const key = k.slice(2);
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) a[key] = true; else { a[key] = v; i++; }
      // --param k=v (repeatable) -> extra URL query params, e.g. --param nosp=1
      if (key === 'param' && typeof a.param === 'string') { const [pk, pv = '1'] = a.param.split('='); (a.extra ||= {})[pk] = pv; delete a.param; }
    }
  }
  return a;
}

export function buildUrl({ showcase, variant, seed = 1, tod, preset, weather, hud, extra = {} }) {
  const u = new URL(BASE_URL + '/');
  if (showcase) u.searchParams.set('showcase', showcase);
  if (variant) u.searchParams.set('variant', variant);
  u.searchParams.set('seed', String(seed));
  if (tod !== undefined) u.searchParams.set('tod', String(tod));
  if (preset) u.searchParams.set('preset', preset);
  if (weather) u.searchParams.set('weather', weather);
  if (hud !== undefined) u.searchParams.set('hud', String(hud));
  u.searchParams.set('fixeddt', '1');
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, String(v));
  return u.toString();
}

async function serverUp() {
  try { const r = await fetch(BASE_URL + '/', { method: 'GET' }); return r.ok; } catch { return false; }
}

export async function launchBrowser({ software = false } = {}) {
  const gpuArgs = software
    ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'];
  return puppeteer.launch({
    channel: 'chrome',
    headless: true,
    args: ['--window-size=1920,1080', '--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required',
      '--hide-scrollbars', '--mute-audio', ...gpuArgs],
    defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
    protocolTimeout: 180000,
  });
}

/** Open the app once; returns helpers to re-stage camera/time and capture repeatedly. */
export async function openApp(opts = {}) {
  if (!(await serverUp())) throw new Error(`Dev server not reachable at ${BASE_URL}. Run "npm run dev" first.`);
  const browser = await launchBrowser({ software: !!opts.software });
  const page = await browser.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e?.stack || e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('requestfailed', (r) => { if (!/favicon/.test(r.url())) consoleErrors.push(`requestfailed ${r.url()} ${r.failure()?.errorText}`); });
  const url = buildUrl(opts);
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__city && window.__city.ready === true, { timeout: Number(opts.timeout || 90000), polling: 100 });
  const readyMs = Date.now() - t0;
  // The boot overlay (#lc-boot) fades out for ~0.7 s of wall time after ready. A capture on an exact held frame
  // shortly after ready would include it (LOOP c6 buildings critic issue 1). Remove it now rather than wait for the
  // fade: waiting is wall-time, so the number of frames rendered before staging would vary between loads.
  await page.evaluate(() => { document.getElementById('lc-boot')?.remove(); });
  const gpu = await page.evaluate(() => {
    try {
      const gl = window.__city.ctx.renderer.getContext();
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch (e) { return String(e); }
  });

  async function stage({ preset, tod, weather, variant, showcase }) {
    await page.evaluate(async ({ preset, tod, weather, variant, showcase }) => {
      const c = window.__city;
      if (showcase) await c.showcase(showcase, variant || 'default');
      if (weather) { const [k, i] = String(weather).split(':'); c.setWeather(k, i !== undefined ? Number(i) : 0.6); }
      if (tod !== undefined && tod !== null) c.setTime(Number(tod));
      if (preset) { if (!c.setCamera(preset)) console.warn(`[shot] unknown preset "${preset}"`); }
      // Reset the animated sky/cloud phase so a capture depends only on (seed, tod, preset, settle) — not on
      // how many frames this session already rendered (LOOP cycle-1 critic issue 4).
      if (typeof c.resetPresentation === 'function') c.resetPresentation();
    }, { preset, tod, weather, variant, showcase });
  }

  async function capture(out, { settle = 45, sampleMs = 1000, reset = true } = {}) {
    // Screenshot first, on an exact held frame (settle frames after staging), THEN sample fps/gpu stats. Sampling
    // first let the number of rendered frames scale with fps, which moved the sky/cloud/traffic/signal phase whenever
    // performance changed (LOOP c6 zoning critic issue 2). Falls back to the old order on builds without holdAfter.
    const canHold = await page.evaluate(() => typeof window.__city.holdAfter === 'function');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    let heldFrame = null;
    if (canHold) {
      // a hold left over from a failed capture would make holdAfter/frames wait forever: always start released
      try {
        // One in-page call: release any stale hold, reset the presentation phase, and schedule the hold. Frames keep
        // rendering during tool round-trips, so resetting here (not only at stage time) makes the screenshot exactly
        // `settle` frames after the reset, whatever the latency between stage() and capture().
        await page.evaluate(({ n, reset }) => {
          const c = window.__city;
          c.release();
          if (reset && typeof c.resetPresentation === 'function') c.resetPresentation();
          return c.holdAfter(n);
        }, { n: settle, reset });
        heldFrame = await page.evaluate(() => window.__city.stats().frame);
        await page.screenshot({ path: out, type: 'png' });
      } finally {
        await page.evaluate(() => window.__city.release()).catch(() => {});
      }
      // FrameStats.fps spans the last 90 frame timestamps, so the held gap must roll out before sampling.
      await page.evaluate(() => window.__city.frames(100));
    } else {
      await page.evaluate((n) => window.__city.frames(n), settle);
    }
    const f0 = await page.evaluate(() => window.__city.stats().frame);
    const s0 = Date.now();
    await new Promise((r) => setTimeout(r, sampleMs));
    const stats = await page.evaluate(() => window.__city.stats());
    const wallFps = ((stats.frame - f0) * 1000) / (Date.now() - s0);
    if (!canHold) await page.screenshot({ path: out, type: 'png' });
    if (canHold) stats.frame = heldFrame;
    const errors = [...new Set([...stats.errors, ...pageErrors, ...consoleErrors])];
    const log = {
      out, url: page.url(), capturedAt: new Date().toISOString(), readyMs, gpu,
      fps: Math.round(Math.min(stats.fps || wallFps, wallFps) * 10) / 10, rafFps: Math.round(wallFps * 10) / 10,
      frameMs: stats.frameMs, gpuMs: stats.gpuMs, gpuFps: stats.gpuFps, drawCalls: stats.drawCalls, triangles: stats.triangles, programs: stats.programs,
      geometries: stats.geometries, textures: stats.textures, hours: stats.hours, showcase: stats.showcase, seed: stats.seed, frame: stats.frame,
      modules: stats.modules, moduleErrors: stats.moduleErrors, errors, warnings: stats.warnings.slice(0, 50),
    };
    fs.writeFileSync(out.replace(/\.png$/i, '') + '.json', JSON.stringify(log, null, 2));
    return log;
  }

  return { browser, page, url, gpu, stage, capture, close: async () => {
    // browser.close() occasionally never resolves on this machine (seen by the c6 critic and in the harness test):
    // give it 8 s, then kill the browser process so a batch cannot hang.
    const done = await Promise.race([browser.close().then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 8000))]);
    if (!done) {
      try { browser.process()?.kill(); } catch { /* already gone */ }
      try { browser.disconnect(); } catch { /* already gone */ }
    }
  } };
}

export async function shot(opts) {
  const app = await openApp(opts);
  try {
    await app.stage(opts);
    return await app.capture(opts.out, { settle: Number(opts.settle || 45), sampleMs: Number(opts.sample || 1000) });
  } finally {
    await app.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  const out = a.out || `shots/${a.showcase || 'game'}/${a.preset || 'overview'}-${a.tod ?? 'default'}.png`;
  const opts = { ...a, out, tod: a.tod !== undefined ? Number(a.tod) : undefined, seed: a.seed || 1, extra: a.extra || {} };
  shot(opts).then((log) => {
    const short = { out: log.out, fps: log.fps, gpuMs: log.gpuMs, gpuFps: log.gpuFps, drawCalls: log.drawCalls, triangles: log.triangles, gpu: log.gpu, modules: log.modules, errors: log.errors };
    console.log(JSON.stringify(short, null, 2));
    if (a.strict && log.errors.length) process.exit(1);
    process.exit(0); // a browser.close() that never resolves must not keep the CLI alive
  }).catch((e) => { console.error('[shot] FAILED:', e.message || e); process.exit(1); });
}
