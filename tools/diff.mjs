#!/usr/bin/env node
// Pixel regression diff for the loop: same-named PNGs in two directories.
//   node tools/diff.mjs --a shots/game/r29-critic --b shots/game/r30 [--out diff.json] [--threshold 8]
// Per file: meanAbs (0-255, mean over RGB channels), pct>threshold (pixels whose max channel delta exceeds
// the threshold), maxDelta. The same-session drift budget from the B3 measurements is meanAbs <= 0.30/255;
// anything above that needs an explanation (intended change A/B'd by the critic).
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { parseArgs } from './shot.mjs';

const a = parseArgs(process.argv.slice(2));
const dirA = a.a, dirB = a.b, threshold = Number(a.threshold ?? 8);
if (!dirA || !dirB) { console.error('usage: --a <dir> --b <dir> [--out file] [--threshold 8]'); process.exit(1); }
const names = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.png$/i.test(f)).sort() : []);
const listA = names(dirA);
const results = [];
for (const f of listA) {
  const pa = path.join(dirA, f), pb = path.join(dirB, f);
  if (!fs.existsSync(pb)) { results.push({ file: f, missing: true }); continue; }
  const A = PNG.sync.read(fs.readFileSync(pa)), B = PNG.sync.read(fs.readFileSync(pb));
  if (A.width !== B.width || A.height !== B.height) { results.push({ file: f, sizeMismatch: `${A.width}x${A.height} vs ${B.width}x${B.height}` }); continue; }
  let sum = 0, over = 0, max = 0;
  const n = A.width * A.height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const dr = Math.abs(A.data[o] - B.data[o]), dg = Math.abs(A.data[o + 1] - B.data[o + 1]), db = Math.abs(A.data[o + 2] - B.data[o + 2]);
    sum += dr + dg + db;
    const d = Math.max(dr, dg, db);
    if (d > threshold) over++;
    if (d > max) max = d;
  }
  results.push({ file: f, meanAbs: +(sum / (n * 3)).toFixed(4), pctOver: +((over / n) * 100).toFixed(4), maxDelta: max, width: A.width, height: A.height });
}
const files = results.filter((r) => r.meanAbs !== undefined);
const summary = {
  a: dirA, b: dirB, threshold, pairs: files.length, missing: results.filter((r) => r.missing).map((r) => r.file), sizeMismatch: results.filter((r) => r.sizeMismatch),
  meanAbs: files.length ? +(files.reduce((s, r) => s + r.meanAbs, 0) / files.length).toFixed(4) : null,
  worst: files.slice().sort((x, y) => y.meanAbs - x.meanAbs)[0] || null,
  files: results,
};
if (a.out) fs.writeFileSync(a.out, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ a: dirA, b: dirB, pairs: summary.pairs, meanAbs: summary.meanAbs, worst: summary.worst, missing: summary.missing }, null, 2));
