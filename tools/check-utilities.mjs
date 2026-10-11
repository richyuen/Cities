#!/usr/bin/env node
// Structure check + close-up captures for the utility and civic kinds that have no close-up anywhere else:
// power plant (seeds 1 and 2), water tower, fire department, police station.
//   node tools/check-utilities.mjs [--label after] [--baseline]
// Adds the five buildings to the buildings showcase on clear ground through the real world API, asserts what
// each one must be made of (from the generator's own parts), and captures front / 3-4 / rear close-ups at day
// and night. --baseline reports failed checks without exiting 1 (for a "before" run on an older generator).
// Evidence: shots/utilities/<label>/*.png + summary.json.
import fs from 'node:fs';
import path from 'node:path';
import { openApp, parseArgs } from './shot.mjs';

const args = parseArgs(process.argv.slice(2));
const LABEL = typeof args.label === 'string' ? args.label : 'after';
const OUT = `shots/utilities/${LABEL}`;
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

const SITES = [
  { name: 'plant-a', kind: 'power_plant', w: 3, di: -16, seed: 1 },
  { name: 'plant-b', kind: 'power_plant', w: 3, di: -10, seed: 2 },
  { name: 'water', kind: 'water_tower', w: 2, di: -4, seed: 1 },
  { name: 'fire', kind: 'fire_department', w: 2, di: 1, seed: 1 },
  { name: 'police', kind: 'police_station', w: 2, di: 6, seed: 1 },
];

const app = await openApp({ showcase: 'buildings', seed: 1, tod: 12 });
const { page } = app;
const captureErrors = [];
let sites = [];
try {
  await page.evaluate(() => window.__city.frames(30));
  sites = await page.evaluate(async (SITES) => {
    const c = window.__city.ctx, THREE = window.__city.THREE;
    const world = c.world;
    const api = c.modules.get('buildings').api;
    const mod = await import('/src/buildings/generator.js');
    const ci = Math.floor(world.size.w / 2), cj = Math.floor(world.size.h / 2);
    const ids = [];
    for (const s of SITES) {
      const i = ci + s.di, j = cj + 14;
      ids.push(world.addBuilding({ i, j, w: s.w, d: s.w, zone: null, kind: s.kind, level: 1, seed: s.seed }));
    }
    await window.__city.frames(30);
    const out = [];
    for (let k = 0; k < SITES.length; k++) {
      const s = SITES[k], id = ids[k];
      const b = world.buildings.get(id);
      api.rebuild(id);
      const live = api.getParts(id);
      // The same generator on a fixed rng (first pick, every chance true, ranges at their minimum), so the
      // structure checks below see one known layout: the power plant is unmirrored, hall on the -x half.
      const rng = { pick: (a) => a[0], chance: () => true, range: (a) => a, int: (a) => a, fork: () => rng, shuffle: () => {}, pickWeighted: (a) => a[0] };
      const gen = mod.generateBuilding(c, b, rng);
      const box = new THREE.Box3();
      let tris = 0;
      const parts = gen.parts.map((p) => {
        box.setFromBufferAttribute(p.geom.attributes.position);
        tris += p.geom.attributes.position.count / 3;
        return { mat: p.mat, liner: p.liner === true, min: box.min.toArray(), max: box.max.toArray() };
      });
      const half = (s.w * world.cellSize) / 2;
      out.push({
        name: s.name, kind: s.kind, id, half, x: gen.cx, z: gen.cz, baseY: gen.baseY, height: gen.height,
        liveHeight: live?.height ?? null, liveKind: live?.kind ?? null,
        liveParts: live ? live.parts.map((p) => ({ min: p.min, max: p.max })) : [],
        parts, tris, studs: gen.studs.map((q) => q.y),
      });
    }
    return out;
  }, SITES);

  const stats = await page.evaluate(() => window.__city.ctx.modules.get('buildings').api.stats());
  console.log(`[check-utilities] buildings stats: ${JSON.stringify(stats)}`);

  for (const s of sites) {
    const tag = `[${s.name}]`;
    const rel = s.parts.map((p) => ({
      mat: p.mat, liner: p.liner,
      x0: p.min[0] - s.x, x1: p.max[0] - s.x, y0: p.min[1] - s.baseY, y1: p.max[1] - s.baseY, z0: p.min[2] - s.z, z1: p.max[2] - s.z,
    }));
    const isWin = (p) => p.mat.startsWith('win') || p.mat.startsWith('trans');
    const anchors = rel.filter((p) => isWin(p) && (p.y0 + p.y1) / 2 >= 2);
    const count = (f) => rel.filter(f).length;
    const lim = s.half + 0.01;
    const outside = s.liveParts.filter((p) => p.min[0] < s.x - lim || p.max[0] > s.x + lim || p.min[2] < s.z - lim || p.max[2] > s.z + lim).length;
    check(s.liveKind === s.kind, `${tag} rendered as ${s.liveKind}, ${s.parts.length} parts, ${s.tris} triangles, height ${s.height.toFixed(2)} m`);
    check(outside === 0, `${tag} every drawn part stays inside its cells (${outside} outside)`);
    const roofStuds = s.studs.filter((y) => y >= s.baseY + s.height * 0.5).length;

    if (s.kind === 'power_plant') {
      const tower = rel.filter((p) => p.x0 >= 0.3 && p.x1 - p.x0 >= 6 && p.z1 - p.z0 >= 6 && p.y0 <= 1.5 && p.y1 >= 3);
      check(tower.length >= 1, `${tag} a cooling tower stands on the ground beside the hall (${tower.length} ground-standing parts of 6 m or more)`);
      const tall = Math.max(0, ...rel.filter((p) => p.x0 >= 0 && p.x1 - p.x0 >= 4).map((p) => p.y1));
      check(tall >= 15, `${tag} the tower rises to 15 m or more beside the hall (${tall.toFixed(1)} m)`);
      const faces = new Set(anchors.map((p) => (p.x1 - p.x0 < p.z1 - p.z0 ? (p.x0 + p.x1 < -12 ? 'x-' : 'x+') : (p.z0 + p.z1 > 0 ? 'z+' : 'z-'))));
      check(anchors.length >= 20 && faces.size >= 3, `${tag} lit glazing at 2 m or higher on three or more faces (${anchors.length} panes on ${[...faces].join(' ')})`);
      check(roofStuds >= 50, `${tag} roof studs above half height for flames to anchor on (${roofStuds})`);
      const tanks = count((p) => p.mat === 'sandGreen' && p.x0 >= 0 && p.y0 >= -0.05 && p.y1 - p.y0 >= 1);
      check(tanks >= 2, `${tag} transformer tanks stand above ground outside the hall (${tanks})`);
      check(count((p) => p.mat === 'brightRed') >= 2 && count((p) => p.mat === 'beacon') >= 1, `${tag} banded stack with a beacon`);
      check(count((p) => p.mat === 'signGlow') >= 1, `${tag} lit sign on the hall`);
      check(s.parts.length <= 330 && s.tris <= 7000, `${tag} within 330 parts and 7000 triangles (${s.parts.length}, ${s.tris})`);
    } else if (s.kind === 'water_tower') {
      check(s.parts.length >= 60, `${tag} detailed beyond legs and a tank (${s.parts.length} parts)`);
      const pump = count((p) => !p.liner && p.x1 - p.x0 >= 2 && p.z1 - p.z0 >= 2 && p.y0 <= 0.6 && p.y1 >= 2 && p.y1 <= 4);
      check(pump >= 1, `${tag} pump house at ground level (${pump})`);
      check(count((p) => p.mat === 'white' && p.x1 - p.x0 >= 8) >= 1, `${tag} white band around the tank`);
      check(s.tris <= 3000, `${tag} within 3000 triangles (${s.tris})`);
    } else if (s.kind === 'fire_department') {
      const bays = count((p) => p.mat === 'transBlue' && p.z1 > s.half - 1 && p.x1 - p.x0 >= 2);
      check(bays >= 3, `${tag} three bay doors with a window strip each on the front (${bays})`);
      check(count((p) => p.mat === 'signGlow') >= 1, `${tag} lit sign band`);
      check(anchors.length >= 6, `${tag} glazing at 2 m or higher (${anchors.length})`);
      check(roofStuds >= 30, `${tag} roof studs above half height (${roofStuds})`);
      check(s.tris <= 4500, `${tag} within 4500 triangles (${s.tris})`);
    } else if (s.kind === 'police_station') {
      check(count((p) => p.mat === 'transBlue' && p.z1 > s.half - 1) >= 1, `${tag} glazed entrance on the front`);
      check(count((p) => p.mat === 'signGlow') >= 1, `${tag} lit sign board`);
      check(count((p) => p.mat === 'beaconBlue') >= 3, `${tag} blue entrance lamps and roof beacon (${count((p) => p.mat === 'beaconBlue')})`);
      check(anchors.length >= 8, `${tag} glazing at 2 m or higher (${anchors.length})`);
      check(roofStuds >= 30, `${tag} roof studs above half height (${roofStuds})`);
      check(s.tris <= 5000, `${tag} within 5000 triangles (${s.tris})`);
    }
  }

  // close-ups from clear ground: front (+z), front 3/4 from both sides, rear 3/4; a top-down for the plants
  for (const s of sites) {
    const big = s.kind === 'power_plant';
    const fd = Math.max(big ? 38 : 21, s.height * 1.6), k = Math.max(big ? 29 : 16, s.height * 1.15), mid = s.baseY + s.height * 0.42;
    const views = [
      ['front', [s.x, s.baseY + s.height * 0.3, s.z + fd], [s.x, mid, s.z], 55],
      ['34', [s.x + k, s.baseY + k * 0.55, s.z + k], [s.x, mid, s.z], 42],
      ['34b', [s.x - k, s.baseY + k * 0.55, s.z + k], [s.x, mid, s.z], 42],
      ['rear', [s.x - k, s.baseY + k * 0.55, s.z - k], [s.x, mid, s.z], 42],
    ];
    if (big) views.push(['top', [s.x, s.baseY + 62, s.z + 14], [s.x, s.baseY, s.z], 42]);
    for (const [name, pos, target, fov] of views) {
      await page.evaluate(({ pos, target, fov }) => window.__city.setCamera({ pos, target, fov }), { pos, target, fov });
      for (const [todName, tod] of [['day', 12], ['night', 21.5]]) {
        if (todName === 'night' && (name === '34b' || name === 'top')) continue;
        await page.evaluate((t) => window.__city.setTime(t), tod);
        captureErrors.push(...(await app.capture(path.join(OUT, `${s.name}-${name}-${todName}.png`), { settle: 15, sampleMs: 400 })).errors);
      }
    }
  }
  check(captureErrors.length === 0, `browser captures report no errors (${captureErrors.length})`);
} finally {
  await app.close();
}

const summary = {
  ok: failed === 0, failed, checks: results.length, results, captureErrors,
  buildings: sites.map((s) => ({ name: s.name, kind: s.kind, parts: s.parts.length, tris: s.tris, height: s.height })),
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n[check-utilities] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed && !args.baseline ? 1 : 0);
