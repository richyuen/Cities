#!/usr/bin/env node
// Batch screenshots for critics.
//   node tools/critic.mjs --module roads [--variant default] [--round 1] [--presets a,b] [--tods 6.5,12,18,21.5]
//   node tools/critic.mjs --game [--round 1]
// Output: shots/<module|game>/r<N>/<preset>-<tod>.png + .json, plus summary.json and a printed table.
import fs from 'node:fs';
import path from 'node:path';
import { openApp, parseArgs } from './shot.mjs';

const a = parseArgs(process.argv.slice(2));
const isGame = !!a.game;
const mod = a.module;
if (!isGame && !mod) { console.error('usage: --module <id> | --game'); process.exit(1); }
const round = a.round || 'x';
const tods = String(a.tods || '6.5,12,18,21.5').split(',').map(Number);
const variant = a.variant || 'default';
const dir = a.dir || path.join('shots', isGame ? 'game' : mod, `r${round}`);
fs.mkdirSync(dir, { recursive: true });

const app = await openApp({ showcase: isGame ? undefined : mod, variant, seed: a.seed || 1, tod: tods[0], software: !!a.software });
let presets;
if (a.presets) presets = String(a.presets).split(',');
else {
  const all = await app.page.evaluate(() => window.__city.presets());
  const own = all.filter((p) => p.startsWith(`${mod}:`));
  presets = isGame ? ['overview', 'skyline', 'street', 'aerial', 'closeup'] : (own.length ? own : ['overview', 'closeup', 'street']);
}
console.log(`[critic] ${isGame ? 'game' : mod} r${round} gpu=${app.gpu}\n[critic] presets: ${presets.join(', ')}\n[critic] tods: ${tods.join(', ')}`);

const results = [];
for (const tod of tods) {
  for (const preset of presets) {
    const name = `${preset.replace(/[:/]/g, '_')}-${String(tod).replace('.', 'h')}`;
    const out = path.join(dir, name + '.png');
    await app.stage({ preset, tod });
    const log = await app.capture(out, { settle: 40, sampleMs: 800 });
    results.push({ preset, tod, out, fps: log.fps, gpuMs: log.gpuMs, drawCalls: log.drawCalls, triangles: log.triangles, errors: log.errors.length });
    console.log(`  ${name.padEnd(34)} fps=${String(log.fps).padStart(5)} gpu=${String(log.gpuMs ?? '-').padStart(5)}ms calls=${String(log.drawCalls).padStart(5)} tris=${String(log.triangles).padStart(8)} errors=${log.errors.length}`);
  }
}
const first = JSON.parse(fs.readFileSync(results[0].out.replace(/\.png$/, '.json'), 'utf8'));
const allErrors = [...new Set(results.flatMap((r) => JSON.parse(fs.readFileSync(r.out.replace(/\.png$/, '.json'), 'utf8')).errors))];
const summary = {
  target: isGame ? 'game' : mod, round, variant, gpu: app.gpu, modules: first.modules, moduleErrors: first.moduleErrors,
  minFps: Math.min(...results.map((r) => r.fps)), maxGpuMs: Math.max(...results.map((r) => r.gpuMs ?? 0)), maxDrawCalls: Math.max(...results.map((r) => r.drawCalls)),
  maxTriangles: Math.max(...results.map((r) => r.triangles)), errors: allErrors, shots: results,
  budget: { fpsOk: Math.min(...results.map((r) => r.fps)) >= 50, gpuOk: Math.max(...results.map((r) => r.gpuMs ?? 0)) <= 20, drawCallsOk: Math.max(...results.map((r) => r.drawCalls)) <= 1500 },
};
fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`[critic] minFps=${summary.minFps} maxGpuMs=${summary.maxGpuMs} maxDrawCalls=${summary.maxDrawCalls} errors=${allErrors.length} → ${path.join(dir, 'summary.json')}`);
if (allErrors.length) console.log('[critic] ERRORS:\n  ' + allErrors.join('\n  '));
await app.close();
