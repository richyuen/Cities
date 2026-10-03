#!/usr/bin/env node
// LOOP cycle 6: background check for the blind-set frames (set-7 reason "bare baseplate / green lots", 4/5 pairs).
//   node tools/check-background.mjs [--seed 1] [--param k=v ...] [--out shots/background/<tag>] [--strict]
// Boots the game and builds the five shot-list cameras the same way tools/shot-list.mjs --list c5 does: the demo's
// set-piece presets for 01/02/04, plus the shipped skyline/street presets for 03/05. It then casts a 64x36 ray grid
// per frame (the c5 r3 critic's classifier) and reports, as % of the frame:
//   sky / building / setpiece / road / park / dressed / emptyZoned / emptyPlain, plus plateRays, which counts
//   rays whose first hit is a VISIBLE zoning plate (scene raycast against the `zoning` group).
// Gates (exit 1 on failure):
//   1. no capture/console errors;
//   2. owner decision 2026-10-03: with no tool selected, plateRays == 0 in every frame (overlay hidden outside zoning);
//   3. the overlay is hidden, not deleted: with tool `zone:r` selected, plateRays > 0 in at least one frame.
//   Gates 2 and 3 are skipped under --param zones=always (the old behaviour, for A/B).
// The empty-land percentages are reported, not gated (the cycle-6 acceptance reads them together with looked-at PNGs).
import fs from 'node:fs';
import path from 'node:path';
import { openApp, parseArgs } from './shot.mjs';

const a = parseArgs(process.argv.slice(2));
const SEED = Number(a.seed || 1);
const EXTRA = { ...(a.extra || {}) };
const OUT = a.out || `shots/background/seed${SEED}${Object.keys(EXTRA).length ? '-' + Object.entries(EXTRA).map(([k, v]) => `${k}${v}`).join('-') : ''}`;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); };

const classify = () => `(async () => {
  const c = window.__city, world = c.world, ctx = c.ctx, THREE = c.THREE;
  const roadsApi = ctx.modules.get('roads').api;
  const propsApi = ctx.modules.get('props')?.api;
  const sps = propsApi?.setPieces ? propsApi.setPieces() : [];
  // the five shot-list cameras (same sources and tods as tools/shot-list.mjs --list c5)
  const cams = {};
  const presetAt = (name, tod) => { ctx.clock.set(tod); try { const p = ctx.cameraPresets.get(name); return p ? { pos: p.pos, target: p.target, fov: p.fov || 45 } : null; } catch { return null; } };
  cams['01-house'] = presetAt('demo:sp-garden', 17.7);
  cams['02-park'] = presetAt('demo:sp-skate', 12);
  cams['03-skyline'] = presetAt('skyline', 17.7);
  cams['04-farm'] = presetAt('demo:sp-farm', 17.7);
  cams['05-avenue'] = presetAt('street', 12);
  const inRect = (x, z) => sps.some((e) => { const s = e.spec || e; const dx = x - s.x, dz = z - s.z, cr = Math.cos(-(s.rot || 0)), sr = Math.sin(-(s.rot || 0));
    const u = dx * cr - dz * sr, v = dx * sr + dz * cr; return Math.abs(u) <= s.w / 2 && Math.abs(v) <= s.d / 2; });
  const props = [...world.props.values()];
  const zoningGroup = ctx.scene.getObjectByName('zoning');
  const visibleChain = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  const plateMeshes = [];
  zoningGroup?.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o.name !== 'zoning-preview' && visibleChain(o)) plateMeshes.push(o); });
  const rc = new THREE.Raycaster();
  const out = {};
  for (const [name, cam] of Object.entries(cams)) {
    if (!cam) { out[name] = null; continue; }
    const pos = new THREE.Vector3(...cam.pos), tgt = new THREE.Vector3(...cam.target);
    const fwd = tgt.clone().sub(pos).normalize(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize(), up = new THREE.Vector3().crossVectors(right, fwd);
    const tv = Math.tan(((cam.fov || 45) * Math.PI) / 360), th = tv * 16 / 9;
    const n = { sky: 0, building: 0, setpiece: 0, road: 0, park: 0, dressed: 0, emptyZoned: 0, emptyPlain: 0, plateRays: 0 };
    let N = 0;
    for (let yi = 0; yi < 36; yi++) for (let xi = 0; xi < 64; xi++) {
      N++;
      const sx = ((xi + 0.5) / 64) * 2 - 1, sy = 1 - ((yi + 0.5) / 36) * 2;
      const dir = fwd.clone().addScaledVector(right, sx * th).addScaledVector(up, sy * tv).normalize();
      const hit = world.raycastScene(new THREE.Ray(pos.clone(), dir), 3000);
      // a plate counts when it is hit before (or without) the scene hit: it is the first thing that ray sees
      if (plateMeshes.length) {
        rc.set(pos, dir); rc.far = hit ? pos.distanceTo(hit.point) + 0.5 : 3000; // world.raycastScene returns no distance
        if (rc.intersectObjects(plateMeshes, false).length) n.plateRays++;
      }
      if (!hit) { n.sky++; continue; }
      if (hit.buildingId) { n.building++; continue; }
      const { x, z } = hit.point;
      if (inRect(x, z)) { n.setpiece++; continue; }
      const nr = world.nearestRoad(x, z, 30);
      if (nr && nr.dist <= roadsApi.footprintWidth(nr.edge.kind) / 2) { n.road++; continue; }
      const cc = world.worldToCell(x, z), cell = world.cellAt(cc.i, cc.j);
      if (cell?.type === 'park') { n.park++; continue; }
      if (cell?.buildingId) { n.dressed++; continue; }
      if (props.some((p) => Math.abs(p.x - x) < 3 && Math.abs(p.z - z) < 3)) { n.dressed++; continue; }
      if (cell?.type === 'zone') n.emptyZoned++; else n.emptyPlain++;
    }
    const plateRays = n.plateRays;
    for (const k of Object.keys(n)) if (k !== 'plateRays') n[k] = +(100 * n[k] / N).toFixed(1);
    n.emptyTotal = +(n.emptyZoned + n.emptyPlain).toFixed(1);
    n.plateRays = plateRays;
    out[name] = n;
  }
  return { frames: out, plateMeshes: plateMeshes.length, errors: c.stats().errors };
})()`;

const app = await openApp({ seed: SEED, tod: 12, hud: 0, extra: EXTRA });
let idle = null, zoning = null;
try {
  await app.page.evaluate(() => window.__city.frames(60));
  // 1) no tool selected (the shipped default at boot)
  await app.page.evaluate(() => { window.__city.ctx.events.emit('tool:selected', { tool: null }); return window.__city.frames(5); });
  idle = await app.page.evaluate(classify());
  // 2) a zone tool selected: the overlay must come back (hidden, not deleted)
  await app.page.evaluate(() => { window.__city.ctx.events.emit('tool:selected', { tool: 'zone:r' }); return window.__city.frames(5); });
  zoning = await app.page.evaluate(classify());
  await app.page.evaluate(() => { window.__city.ctx.events.emit('tool:selected', { tool: null }); return window.__city.frames(2); });
} finally {
  await app.close();
}

console.log('\nframe        sky  bldg  setp  road  park  drsd  eZone ePlain eTotal plates(idle/zone)');
for (const name of Object.keys(idle.frames)) {
  const f = idle.frames[name], z = zoning.frames[name];
  if (!f) { console.log(`${name.padEnd(12)} (no camera)`); continue; }
  const v = (k) => String(f[k]).padStart(5);
  console.log(`${name.padEnd(12)}${v('sky')}${v('building')}${v('setpiece')}${v('road')}${v('park')}${v('dressed')}${v('emptyZoned')} ${v('emptyPlain')}  ${v('emptyTotal')}   ${f.plateRays}/${z?.plateRays}`);
}
console.log('');

const always = String(EXTRA.zones || '') === 'always';
check(idle.errors.length === 0 && zoning.errors.length === 0, `no console errors (${idle.errors.length + zoning.errors.length})`);
check(Object.values(idle.frames).every(Boolean), 'all five shot-list cameras resolved (demo:sp-* presets present)');
if (!always) {
  const idlePlates = Object.values(idle.frames).filter(Boolean).reduce((s, f) => s + f.plateRays, 0);
  const zonePlates = Object.values(zoning.frames).filter(Boolean).reduce((s, f) => s + f.plateRays, 0);
  check(idlePlates === 0, `no zoning plate visible in any frame with no tool selected (${idlePlates} plate rays)`);
  check(zonePlates > 0, `zoning plates return when a zone tool is selected (${zonePlates} plate rays) - hidden, not deleted`);
} else {
  console.log('[check-background] --param zones=always: overlay gates skipped (A/B baseline run)');
}

fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ seed: SEED, extra: EXTRA, ok: failed === 0, results, idle, zoning }, null, 2));
console.log(`\n[check-background] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
