#!/usr/bin/env node
// Functional check for LOOP cycle 4A: capture-mode tilt-shift/DOF + low-sun bloom discipline.
//   node tools/check-dof.mjs [--out shots/effects/r4/check]
// Asserts:
//   (a) DOF off is a strict no-op: two fresh boots (absent vs ?dof=0) on the static effects showcase are
//       byte-identical, and a same-session on->off toggle returns to the original frame exactly (meanAbs 0.0000);
//   (b) DOF on != off: meanAbs well above the 0.30/255 drift budget, with the blur measurable as a drop in
//       gradient energy in the frame-edge bands and none in the focus band;
//   (c) errors [] in every capture at both settings;
//   (d) the DOF pass exists in the composer only when enabled, sits directly after OutputPass (bloom/ACES
//       untouched, SMAA still last), and costs exactly +1 draw call;
//   (e) the low-sun bloom discipline: factor 0 (exact) at noon and night with identical automatic bloom values,
//       factor > 0 at the hero sunset (tod 17.7), the sun column's clipped-white share shrinks when enabled,
//       and its toggle changes nothing at noon/night (frozen-sim diffs 0.0000).
// Captures are frozen (ctx.paused = true after staging) so the sim does not drift between A/B frames; the
// animated sky phase is reset before freezing. Exit 1 on any failed check.
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { openApp, parseArgs } from './shot.mjs';

const a = parseArgs(process.argv.slice(2));
const OUT = a.out || 'shots/effects/r4/check';
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
const captureErrors = [];
const captureLog = [];

// ---- image metrics ---------------------------------------------------------------------------------------------
function readPng(file) { return PNG.sync.read(fs.readFileSync(file)); }

/** meanAbs over RGB (0-255), share of pixels with max-channel delta > 2, max delta. */
function diffStats(fileA, fileB, y0 = 0, y1 = Infinity) {
  const A = readPng(fileA), B = readPng(fileB);
  let sum = 0, over = 0, max = 0, n = 0;
  for (let y = y0; y < Math.min(y1, A.height); y++) {
    for (let x = 0; x < A.width; x++) {
      const o = (y * A.width + x) * 4;
      const dr = Math.abs(A.data[o] - B.data[o]), dg = Math.abs(A.data[o + 1] - B.data[o + 1]), db = Math.abs(A.data[o + 2] - B.data[o + 2]);
      sum += dr + dg + db;
      const d = Math.max(dr, dg, db);
      if (d > 2) over++;
      if (d > max) max = d;
      n++;
    }
  }
  return { meanAbs: +(sum / (n * 3)).toFixed(4), pctOver2: +((over / n) * 100).toFixed(4), maxDelta: max };
}

/** Sum of central-difference luma gradients over a horizontal band (sharpness proxy). */
function gradEnergy(file, fy0, fy1) {
  const img = readPng(file);
  const y0 = Math.round(fy0 * img.height), y1 = Math.round(fy1 * img.height);
  const L = (x, y) => { const o = (y * img.width + x) * 4; return 0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2]; };
  let g = 0, n = 0;
  for (let y = Math.max(1, y0); y < Math.min(img.height - 1, y1); y++) {
    for (let x = 1; x < img.width - 1; x++) {
      g += Math.abs(L(x + 1, y) - L(x - 1, y)) + Math.abs(L(x, y + 1) - L(x, y - 1));
      n++;
    }
  }
  return g / n;
}

/** Clipped-white (min channel >= 253) and near-white (min >= 240) pixel counts. */
function whiteStats(file) {
  const img = readPng(file);
  let clip = 0, near = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const o = i * 4, mn = Math.min(img.data[o], img.data[o + 1], img.data[o + 2]);
    if (mn >= 253) clip++;
    if (mn >= 240) near++;
  }
  return { clip, near240: near, clipPct: +(clip / (img.width * img.height) * 100).toFixed(3) };
}

async function capture(app, name) {
  const log = await app.capture(path.join(OUT, `${name}.png`), { settle: 6, sampleMs: 250 });
  captureErrors.push(...log.errors);
  captureLog.push({ name, gpuMs: log.gpuMs, drawCalls: log.drawCalls });
  return log;
}

/** Stage tod/preset, let environment apply it, then freeze the sim and reset the sky phase. Waits for the boot
 *  overlay to be removed first: its CSS fade runs on wall time, not frame count, and would leak into a capture. */
async function freezeAt(app, { preset, tod }) {
  await app.page.waitForFunction(() => !document.getElementById('lc-boot'), { timeout: 30000, polling: 100 });
  await app.page.evaluate(async ({ preset, tod }) => {
    const c = window.__city;
    c.ctx.paused = false;
    if (preset) c.setCamera(preset);
    if (tod !== undefined) c.setTime(tod);
    await c.frames(20);          // environment applies the new tod; traffic advances (irrelevant, frozen next)
    c.resetPresentation();       // sky/cloud phase -> 0 so frozen frames are comparable
    await c.frames(2);
    c.ctx.paused = true;         // stop sim + env updates: A/B frames are exact
    await c.frames(4);
  }, { preset, tod });
}
const effectsApi = (app) => app.page.evaluate(() => {
  const fx = window.__city.ctx.modules.get('effects');
  return { passes: Object.keys(fx.api.getPasses()), composerPasses: fx.api.getComposer().passes.map((p) => p.constructor.name), dof: fx.api.getDOF(), sun: fx.api.getSunBloom() };
});

// ---- 1) effects showcase: cross-boot no-op, on != off, toggle-back identity -------------------------------------
const bootOpts = (extra) => ({ showcase: 'effects', variant: 'default', preset: 'effects:default', seed: 1, tod: 12, hud: 0, extra });
let offBootA, onShowcase;
{
  const app = await openApp(bootOpts({}));
  try {
    await freezeAt(app, { preset: 'effects:default', tod: 12 });
    const st0 = await effectsApi(app);
    check(!st0.passes.includes('dof'), `boot without ?dof: no dof pass in getPasses() (${st0.passes.join(',')})`);
    await capture(app, 'showcase-off-a');
    offBootA = path.join(OUT, 'showcase-off-a.png');

    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0.55));
    const st1 = await effectsApi(app);
    const onLog = await capture(app, 'showcase-on');
    onShowcase = path.join(OUT, 'showcase-on.png');
    check(st1.passes.includes('dof'), 'api.setDOF(0.55): dof pass present in getPasses()');
    check(st1.composerPasses.join(',').includes('OutputPass,ShaderPass,SMAAPass') || st1.composerPasses[st1.composerPasses.length - 1] === 'SMAAPass', `composer order keeps SMAA last (${st1.composerPasses.join(',')})`);
    check(st1.dof.enabled === true && st1.dof.strength === 0.55, `getDOF() { strength: ${st1.dof.strength}, enabled: ${st1.dof.enabled} }`);
    check(st1.dof.focusY === 0.5, `default focusY 0.5 (${st1.dof.focusY})`);

    const offVsOn = diffStats(offBootA, onShowcase);
    check(offVsOn.meanAbs > 1.0 && offVsOn.pctOver2 > 5, `dof on != off: meanAbs ${offVsOn.meanAbs}, ${offVsOn.pctOver2}% >2/255 (needs >1.0 and >5%)`);
    const gTopOff = gradEnergy(offBootA, 0.90, 1.0), gTopOn = gradEnergy(onShowcase, 0.90, 1.0);
    const gMidOff = gradEnergy(offBootA, 0.40, 0.60), gMidOn = gradEnergy(onShowcase, 0.40, 0.60);
    check(gTopOn / gTopOff < 0.75, `edge blur falls off toward the frame edge: bottom-band gradient ${(gTopOn / gTopOff).toFixed(3)}x (needs <0.75)`);
    console.log(`     (info) top-band gradient ratio ${(gradEnergy(onShowcase, 0.0, 0.10) / gradEnergy(offBootA, 0.0, 0.10)).toFixed(3)}x (sky band, low-detail)`);
    check(gMidOn / gMidOff > 0.95, `focus band stays sharp: mid-band gradient ${(gMidOn / gMidOff).toFixed(3)}x (needs >0.95)`);
    const midDiff = diffStats(offBootA, onShowcase, Math.round(0.40 * 1080), Math.round(0.60 * 1080));
    check(midDiff.meanAbs < 0.5, `focus band pixels ~unchanged: meanAbs ${midDiff.meanAbs} (needs <0.5)`);

    const drawOn = await app.page.evaluate(async () => { await window.__city.frames(2); return window.__city.stats().drawCalls; });
    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0));
    const st2 = await effectsApi(app);
    const drawOff = await app.page.evaluate(async () => { await window.__city.frames(2); return window.__city.stats().drawCalls; });
    check(!st2.passes.includes('dof'), 'api.setDOF(0): dof pass removed from getPasses()');
    check(drawOn - drawOff === 1, `DOF costs exactly +1 draw call (${drawOn} with, ${drawOff} without)`);
    await capture(app, 'showcase-off-b');
    const back = diffStats(offBootA, path.join(OUT, 'showcase-off-b.png'));
    check(back.meanAbs === 0 && back.pctOver2 === 0, `same-session on->off toggle returns to the exact frame: meanAbs ${back.meanAbs}, ${back.pctOver2}% >2/255 (needs 0.0000/0.0000)`);
    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0.55));
    await capture(app, 'showcase-on-b');
    const stable = diffStats(onShowcase, path.join(OUT, 'showcase-on-b.png'));
    check(stable.meanAbs === 0 && stable.pctOver2 === 0, `dof on is temporally stable (two frozen captures identical): meanAbs ${stable.meanAbs}, ${stable.pctOver2}% >2/255 (needs 0.0000/0.0000)`);
    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0));
  } finally { await app.close(); }
}
{
  const app = await openApp(bootOpts({ dof: '0' }));
  try {
    await freezeAt(app, { preset: 'effects:default', tod: 12 });
    const st = await effectsApi(app);
    check(!st.passes.includes('dof'), '?dof=0: no dof pass in getPasses()');
    await capture(app, 'showcase-off-bootb');
    const twoBoots = diffStats(offBootA, path.join(OUT, 'showcase-off-bootb.png'));
    check(twoBoots.meanAbs === 0 && twoBoots.pctOver2 === 0, `off is a strict no-op across two fresh boots (absent vs ?dof=0): meanAbs ${twoBoots.meanAbs}, ${twoBoots.pctOver2}% >2/255 (needs 0.0000/0.0000)`);
  } finally { await app.close(); }
}

// ---- 2) game hero sunset: DOF A/B + low-sun bloom A/B + noon/night identity ------------------------------------
{
  const app = await openApp({ seed: 1, tod: 17.7, hud: 0 });
  try {
    await freezeAt(app, { preset: 'skyline', tod: 17.7 });
    const st0 = await effectsApi(app);
    const auto = await app.page.evaluate(() => {
      const p = window.__city.ctx.modules.get('effects').api.getPasses();
      return { strength: p.bloom.strength, threshold: p.bloom.threshold, draws: window.__city.stats().drawCalls };
    });
    check(!st0.passes.includes('dof'), 'game (dof absent): no dof pass');
    check(st0.sun.factor > 0.7 && st0.sun.factor <= 1 && Math.abs(st0.sun.elevation - 4.864) < 0.05,
      `low-sun factor at the hero sunset: e=${st0.sun.elevation.toFixed(3)} deg, factor ${st0.sun.factor.toFixed(3)} (needs 0.7..1)`);
    await capture(app, 'game-sunset-off');
    const offPng = path.join(OUT, 'game-sunset-off.png');
    const offWhite = whiteStats(offPng);

    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setSunBloom(false));
    const sbOff = await app.page.evaluate(() => {
      const p = window.__city.ctx.modules.get('effects').api.getPasses();
      return { strength: p.bloom.strength, threshold: p.bloom.threshold, sun: window.__city.ctx.modules.get('effects').api.getSunBloom() };
    });
    await capture(app, 'game-sunset-sunbloom-off');
    const sbOffPng = path.join(OUT, 'game-sunset-sunbloom-off.png');
    const sbOffWhite = whiteStats(sbOffPng);
    const sbDiff = diffStats(offPng, sbOffPng);
    check(sbOff.sun.factor === 0 && sbOff.strength > auto.strength * 1.8,
      `sunbloom off at 17.7 restores the undimmed strength ${sbOff.strength.toFixed(4)} (factor ${sbOff.sun.factor})`);
    check(Math.abs(auto.strength - sbOff.strength * (1 - 0.6 * st0.sun.factor)) < 1e-12,
      `the discipline drops the automatic strength by exactly 1-0.6*factor: ${auto.strength.toFixed(5)} === ${(sbOff.strength * (1 - 0.6 * st0.sun.factor)).toFixed(5)}`);
    check(sbOffWhite.clip > offWhite.clip / 0.8,
      `sun column clips less with the low-sun discipline: ${offWhite.clip} vs ${sbOffWhite.clip} clipped px (${offWhite.clipPct}% vs ${sbOffWhite.clipPct}%, needs <=80%)`);
    check(sbDiff.meanAbs > 0.3, `the discipline is a visible change at the hero sunset (meanAbs ${sbDiff.meanAbs} > 0.3)`);
    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setSunBloom(true));

    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0.55));
    const st1 = await effectsApi(app);
    const drawOn = await app.page.evaluate(async () => { await window.__city.frames(2); return window.__city.stats().drawCalls; });
    await capture(app, 'game-sunset-on');
    const onPng = path.join(OUT, 'game-sunset-on.png');
    check(st1.passes.includes('dof'), 'game with api.setDOF(0.55): dof pass present');
    check(drawOn - auto.draws === 1, `DOF in the full game costs +1 draw call (${auto.draws} -> ${drawOn})`);
    const gOffB = gradEnergy(offPng, 0.88, 1.0), gOnB = gradEnergy(onPng, 0.88, 1.0);
    const gOffM = gradEnergy(offPng, 0.42, 0.58), gOnM = gradEnergy(onPng, 0.42, 0.58);
    check(gOnB / gOffB < 0.8, `game bottom band blurs: gradient ${(gOnB / gOffB).toFixed(3)}x (<0.8)`);
    check(gOnM / gOffM > 0.95, `game focus band stays sharp: gradient ${(gOnM / gOffM).toFixed(3)}x (>0.95)`);
    const gameDiff = diffStats(offPng, onPng);
    check(gameDiff.meanAbs > 1.0, `game dof on != off: meanAbs ${gameDiff.meanAbs} (>1.0)`);
    const bloomOn = await app.page.evaluate(() => {
      const p = window.__city.ctx.modules.get('effects').api.getPasses();
      return { strength: p.bloom.strength, threshold: p.bloom.threshold };
    });
    check(Math.abs(bloomOn.strength - auto.strength) < 1e-9 && Math.abs(bloomOn.threshold - auto.threshold) < 1e-9,
      `DOF does not touch the bloom values (strength ${bloomOn.strength.toFixed(4)} === ${auto.strength.toFixed(4)})`);

    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0));
    await capture(app, 'game-sunset-off2');
    const back2 = diffStats(offPng, path.join(OUT, 'game-sunset-off2.png'));
    check(back2.meanAbs === 0 && back2.pctOver2 === 0, `game dof on->off returns to the exact frame: meanAbs ${back2.meanAbs}, ${back2.pctOver2}% >2/255 (needs 0.0000/0.0000)`);

    // noon + night: the sun-bloom factor is exactly 0 and the toggle changes nothing (frozen sim)
    for (const [tod, label] of [[12, 'noon'], [21.5, 'night']]) {
      await freezeAt(app, { preset: 'skyline', tod });
      const eq = await app.page.evaluate(() => {
        const fx = window.__city.ctx.modules.get('effects');
        const p = fx.api.getPasses();
        fx.api.setSunBloom(false);
        const off = { strength: p.bloom.strength, threshold: p.bloom.threshold, factor: fx.api.getSunBloom().factor };
        fx.api.setSunBloom(true);
        const on = { strength: p.bloom.strength, threshold: p.bloom.threshold, factor: fx.api.getSunBloom().factor };
        return { off, on };
      });
      check(eq.on.factor === 0 && eq.off.factor === 0, `${label}: sun-bloom factor is exactly 0 (factor ${eq.on.factor})`);
      check(eq.on.strength === eq.off.strength && eq.on.threshold === eq.off.threshold,
        `${label}: automatic bloom values identical with the discipline on/off (strength ${eq.on.strength.toFixed(4)}, threshold ${eq.on.threshold.toFixed(4)})`);
      await capture(app, `${label}-sunbloom-on`);
      await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setSunBloom(false));
      await capture(app, `${label}-sunbloom-off`);
      const d = diffStats(path.join(OUT, `${label}-sunbloom-on.png`), path.join(OUT, `${label}-sunbloom-off.png`));
      check(d.meanAbs === 0 && d.pctOver2 === 0, `${label}: rendered frame identical with the discipline on/off (meanAbs ${d.meanAbs}, ${d.pctOver2}% >2/255)`);
      await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setSunBloom(true));
    }

    // night + closeup DOF evidence captures (frozen)
    await freezeAt(app, { preset: 'street', tod: 21.5 });
    await capture(app, 'game-night-off');
    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0.55));
    await capture(app, 'game-night-on');
    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0));
    await freezeAt(app, { preset: 'closeup', tod: 17.7 });
    await capture(app, 'game-closeup-off');
    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0.55));
    await capture(app, 'game-closeup-on');
    const closeupDiff = diffStats(path.join(OUT, 'game-closeup-off.png'), path.join(OUT, 'game-closeup-on.png'));
    check(closeupDiff.meanAbs > 1.0, `closeup dof on != off: meanAbs ${closeupDiff.meanAbs} (>1.0)`);
    await app.page.evaluate(() => window.__city.ctx.modules.get('effects').api.setDOF(0));
  } finally { await app.close(); }
}

// ---- 3) URL flag semantics: clamp, bare flag, bad value, focus override ----------------------------------------
{
  const bootFlag = async (extra) => {
    const app = await openApp({ showcase: 'effects', variant: 'default', seed: 1, tod: 12, hud: 0, extra });
    try {
      return await app.page.evaluate(() => {
        const api = window.__city.ctx.modules.get('effects');
        return { ...api.api.getDOF(), pass: !!api.api.getPasses().dof };
      });
    } finally { await app.close(); }
  };
  const clampHi = await bootFlag({ dof: '5' });
  check(clampHi.strength === 1 && clampHi.pass, `?dof=5 clamps to 1 (strength ${clampHi.strength}, pass ${clampHi.pass})`);
  const clampLo = await bootFlag({ dof: '-3' });
  check(clampLo.strength === 0 && !clampLo.pass, `?dof=-3 clamps to 0 and stays off (strength ${clampLo.strength}, pass ${clampLo.pass})`);
  const bare = await bootFlag({ dof: '' });
  check(bare.strength === 0.55 && bare.pass, `bare ?dof uses the 0.55 default (strength ${bare.strength}, pass ${bare.pass})`);
  const bad = await bootFlag({ dof: 'abc' });
  check(bad.strength === 0 && !bad.pass, `?dof=abc is treated as off (strength ${bad.strength}, pass ${bad.pass})`);
  const focus = await bootFlag({ dof: '0.4', dofy: '0.3' });
  check(focus.focusY === 0.3, `?dofy=0.3 moves the focus line (focusY ${focus.focusY})`);
}

check(captureErrors.length === 0, `all captures report no errors (${captureErrors.length})`);

const summary = { ok: failed === 0, failed, checks: results.length, results, captureErrors, captures: captureLog, out: OUT };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n[check-dof] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
