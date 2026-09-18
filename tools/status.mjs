#!/usr/bin/env node
// docs/STATUS.json helper.
//   node tools/status.mjs                      print table
//   node tools/status.mjs get roads
//   node tools/status.mjs set roads score=7.5 round=2 pass=false errors=0 fps=58 drawCalls=120 issues="a;b" review=docs/reviews/roads-r2.md
//   node tools/status.mjs set game score=6 pass=false
//   node tools/status.mjs weakest             prints the lowest-scoring non-passing module
import fs from 'node:fs';

const FILE = 'docs/STATUS.json';
const MODULES = ['terrain', 'environment', 'roads', 'simulation', 'ui', 'audio', 'effects', 'zoning', 'buildings', 'props', 'traffic', 'tools', 'demo'];

function load() {
  if (!fs.existsSync(FILE)) {
    const s = { updated: null, modules: {}, game: { score: 0, round: 0, pass: false, issues: [], judges: [] } };
    for (const m of MODULES) s.modules[m] = { score: 0, round: 0, pass: false, errors: 0, fps: 0, drawCalls: 0, issues: [], review: null, wave: 0 };
    return s;
  }
  return JSON.parse(fs.readFileSync(FILE, 'utf8'));
}
function save(s) { s.updated = new Date().toISOString(); fs.writeFileSync(FILE, JSON.stringify(s, null, 2)); }
function coerce(k, v) {
  if (k === 'issues') return v ? v.split(';').map((x) => x.trim()).filter(Boolean) : [];
  if (v === 'true') return true; if (v === 'false') return false;
  if (v !== '' && !isNaN(Number(v))) return Number(v);
  return v;
}

const [cmd, target, ...kv] = process.argv.slice(2);
const s = load();
if (!cmd) {
  console.log('module       score round pass  errs  fps  calls  issues');
  for (const [id, m] of Object.entries(s.modules)) {
    console.log(`${id.padEnd(12)} ${String(m.score).padStart(5)} ${String(m.round).padStart(5)} ${String(m.pass).padEnd(5)} ${String(m.errors).padStart(4)} ${String(m.fps).padStart(5)} ${String(m.drawCalls).padStart(6)}  ${m.issues.length}`);
  }
  console.log(`game         ${String(s.game.score).padStart(5)} ${String(s.game.round).padStart(5)} ${String(s.game.pass).padEnd(5)}  judges=${s.game.judges.length}`);
  if (!fs.existsSync(FILE)) save(s);
} else if (cmd === 'init') {
  save(s); console.log('wrote', FILE);
} else if (cmd === 'get') {
  console.log(JSON.stringify(target === 'game' ? s.game : s.modules[target], null, 2));
} else if (cmd === 'set') {
  const obj = target === 'game' ? s.game : (s.modules[target] ??= { score: 0, round: 0, pass: false, errors: 0, fps: 0, drawCalls: 0, issues: [], review: null });
  for (const pair of kv) { const i = pair.indexOf('='); obj[pair.slice(0, i)] = coerce(pair.slice(0, i), pair.slice(i + 1)); }
  obj.updated = new Date().toISOString();
  save(s); console.log(target, JSON.stringify(obj));
} else if (cmd === 'weakest') {
  const list = Object.entries(s.modules).filter(([, m]) => !m.pass && m.round > 0 && m.round < 4).sort((a, b) => a[1].score - b[1].score);
  console.log(list.length ? `${list[0][0]} ${list[0][1].score}` : 'none');
} else if (cmd === 'json') {
  console.log(JSON.stringify(s, null, 2));
}
