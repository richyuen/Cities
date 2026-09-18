#!/usr/bin/env node
// Blind A/B pairing for judges.
//   node tools/pairs.mjs --ours shots/game/r3 --theirs docs/reference --out judge/set1 --seed 7
// Pairs the i-th PNG of --ours with the i-th PNG of --theirs (sorted), shuffles which is A/B with a seeded RNG,
// copies to <out>/pair-<n>-A.png / -B.png and writes the hidden key to docs/judge-key-<basename(out)>.json.
// If --theirs has fewer images, it cycles. If --theirs is missing, pairs --ours with --prev (our previous round).
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ') || true]; }));
const ours = args.ours, theirs = args.theirs || args.prev, out = args.out || 'judge/set1', seed = Number(args.seed || 1);
if (!ours || !theirs) { console.error('usage: --ours <dir> --theirs|--prev <dir> [--out dir] [--seed n]'); process.exit(1); }
const pngs = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(d, f)) : [];
const A = pngs(ours), B = pngs(theirs);
if (!A.length || !B.length) { console.error(`no images: ours=${A.length} theirs=${B.length}`); process.exit(1); }
let s = seed >>> 0; const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0); s = (Math.imul(s ^ (s >>> 12), 0x297a2d39) >>> 0); return ((s ^ (s >>> 15)) >>> 0) / 4294967296; };
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
const key = [];
A.forEach((a, i) => {
  const b = B[i % B.length];
  const flip = rnd() < 0.5;
  const n = String(i + 1).padStart(2, '0');
  fs.copyFileSync(flip ? b : a, path.join(out, `pair-${n}-A.png`));
  fs.copyFileSync(flip ? a : b, path.join(out, `pair-${n}-B.png`));
  key.push({ pair: n, A: flip ? 'theirs' : 'ours', B: flip ? 'ours' : 'theirs', ours: a, theirs: b });
});
fs.mkdirSync('docs', { recursive: true });
const keyFile = `docs/judge-key-${path.basename(out)}.json`;
fs.writeFileSync(keyFile, JSON.stringify({ ours, theirs, seed, pairs: key }, null, 2));
console.log(`${key.length} pairs → ${out}; key → ${keyFile} (do not show judges)`);
