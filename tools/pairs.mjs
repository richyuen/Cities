#!/usr/bin/env node
// Blind A/B pairing for judges.
//   node tools/pairs.mjs --ours shots/game/r3 --theirs docs/reference --out judge/set1 --seed 7
//   node tools/pairs.mjs --ours shots/beauty/v6 --theirs docs/reference --out judge/set4 --seed 31 --balance
// Pairs the i-th PNG of --ours with the i-th PNG of --theirs (sorted), shuffles which is A/B with a seeded RNG,
// copies to <out>/pair-<n>-A.png / -B.png and writes the hidden key to docs/judge-key-<basename(out)>.json.
// --balance forces the ours/theirs side split to be as even as possible (ceil/floor), randomly placed — the
// default per-pair coin flip can otherwise land 4/1 (set2/set3 audits flagged it). The key records the split.
// If --theirs has fewer images, it cycles. If --theirs is missing, pairs --ours with --prev (our previous round).
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ') || true]; }));
const ours = args.ours, theirs = args.theirs || args.prev, out = args.out || 'judge/set1', seed = Number(args.seed || 1);
const balance = !!args.balance;
if (!ours || !theirs) { console.error('usage: --ours <dir> --theirs|--prev <dir> [--out dir] [--seed n] [--balance]'); process.exit(1); }
const pngs = (d) => fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => path.join(d, f)) : [];
const A = pngs(ours), B = pngs(theirs);
if (!A.length || !B.length) { console.error(`no images: ours=${A.length} theirs=${B.length}`); process.exit(1); }
let s = seed >>> 0; const rnd = () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) >>> 0); s = (Math.imul(s ^ (s >>> 12), 0x297a2d39) >>> 0); return ((s ^ (s >>> 15)) >>> 0) / 4294967296; };
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true });
// One rnd() per pair, in order — this keeps the un-balanced default path byte-reproducible with the keys of
// sets 1-3 (their audits re-derive the shuffle from the seed). --balance then re-arranges the list with extra
// rnd() draws (only new sets use it, so there is no old key to preserve).
const flips = A.map(() => rnd() < 0.5);
if (balance) {
  const n = flips.length, k = Math.ceil(n / 2);
  const f = Array.from({ length: n }, (_, i) => i < k);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [f[i], f[j]] = [f[j], f[i]]; }
  flips.splice(0, n, ...f);
}
const key = [];
A.forEach((a, i) => {
  const b = B[i % B.length];
  const flip = flips[i];
  const n = String(i + 1).padStart(2, '0');
  fs.copyFileSync(flip ? b : a, path.join(out, `pair-${n}-A.png`));
  fs.copyFileSync(flip ? a : b, path.join(out, `pair-${n}-B.png`));
  key.push({ pair: n, A: flip ? 'theirs' : 'ours', B: flip ? 'ours' : 'theirs', ours: a, theirs: b });
});
fs.mkdirSync('docs', { recursive: true });
const keyFile = `docs/judge-key-${path.basename(out)}.json`;
const split = { oursOnA: key.filter((k) => k.A === 'ours').length, theirsOnA: key.filter((k) => k.A === 'theirs').length };
fs.writeFileSync(keyFile, JSON.stringify({ ours, theirs, seed, balance, split, pairs: key }, null, 2));
console.log(`${key.length} pairs → ${out}; key → ${keyFile} (do not show judges); split ours/theirs on A: ${split.oursOnA}/${split.theirsOnA}`);
