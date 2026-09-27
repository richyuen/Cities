#!/usr/bin/env node
// Functional check for Wave C6 / F3 — civics retune.
//   node tools/check-civics.mjs
// Part 1 (Node, pure model — no browser): drives SimModel directly on a stub world and A/B-proves the level-3
//   gate. Four routes: (A) unschooled + sustained happiness 0.65 reaches level 3 at exactly LEVEL3_WEALTH_TICKS,
//   (B) happiness dropping below LEVEL3_WEALTH_RESET resets the streak and delays it, (C) a schooled building
//   still reaches level 3 at MATURE_TICKS_SCHOOLED with happiness held low, (D) unschooled + low happiness is
//   still blocked (the gate is real, not decorative). Plus a two-run determinism hash.
// Part 2 (browser via tools/shot.mjs openApp): proves every simulation showcase variant (default/boom/bust)
//   stages exactly 1 school + 1 hospital, that education/health read non-zero in the stats, grids and the
//   showcase panel rows, and captures day/night closeups of both buildings (front + rear 3/4) for the review.
// Exit 1 on any failed check. Evidence: shots/civics/r2/*.png + summary.json.
import fs from 'node:fs';
import path from 'node:path';
import { openApp } from './shot.mjs';
import {
  SimModel, MATURE_TICKS, MATURE_TICKS_SCHOOLED,
  LEVEL3_WEALTH_TICKS, LEVEL3_WEALTH_HAPPINESS, LEVEL3_WEALTH_RESET,
} from '../src/simulation/model.js';

const OUT = 'shots/civics/r2';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const results = [];
let failed = 0;
const check = (ok, msg) => { results.push({ ok: !!ok, msg }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// ---------------------------------------------------------------------------------------------------------------
// Part 1 — model gate (Node)

function stubWorld({ w = 64, h = 40, rci = [], utilities = [] } = {}) {
  const cells = new Array(w * h);
  for (let k = 0; k < cells.length; k++) cells[k] = { type: 'empty', zone: null };
  for (let i = 0; i < w; i++) cells[6 * w + i] = { type: 'road', zone: null, roadId: `road:${i}` };
  const buildings = new Map();
  const add = (b) => {
    const rec = { w: 1, d: 1, level: 1, seed: 7, ...b };
    buildings.set(rec.id, rec);
    for (let j = 0; j < rec.d; j++) for (let i = 0; i < rec.w; i++) {
      const c = cells[(rec.j + j) * w + (rec.i + i)];
      c.type = 'building'; c.buildingId = rec.id;
    }
  };
  for (const b of [...utilities, ...rci]) add(b);
  return {
    size: { w, h }, cells, cellSize: 8, minX: 0, minZ: 0, buildings,
    roads: { edges: new Map([['e0', {}], ['e1', {}]]) },
    cellAt: (i, j) => cells[j * w + i],
  };
}

const POWER = { id: 'u-power', i: 2, j: 2, w: 3, d: 3, kind: 'power_plant' };
const WATER = { id: 'u-water', i: 12, j: 2, w: 2, d: 2, kind: 'water_tower' };
const SCHOOL = { id: 'u-school', i: 15, j: 2, w: 2, d: 2, kind: 'school' };

/** Run the RCI test building (id 'x1', level 2, so the first growth candidate is the level-3 gate itself) for
 *  `ticks`, forcing city happiness each tick, and report the first candidate. Occupancy is pre-set to 0.95 so
 *  maturity/wealth ticks start at tick 1. */
function gateRun({ utilities, happinessAt, ticks = 120, rciAt = { i: 8, j: 7 } }) {
  const world = stubWorld({ utilities, rci: [{ id: 'x1', i: rciAt.i, j: rciAt.j, zone: 'r', level: 2 }] });
  const model = new SimModel({ cityName: 'Checktown' });
  model.reset({ occupancy: 0.35 });
  model.syncBuildings(world);
  const entry = model.byId.get('x1');
  entry.occ = 0.95;
  const log = { candidateTick: -1, wealthAtCandidate: -1, matureAtCandidate: -1, schooled: false, wealthAtEnd: entry.wealthTicks };
  for (let t = 1; t <= ticks; t++) {
    model.happiness = happinessAt(t);
    model.step(world);
    if (model.growth.length && log.candidateTick < 0) {
      log.candidateTick = t;
      log.wealthAtCandidate = entry.wealthTicks;
      log.matureAtCandidate = entry.mature;
      log.schooled = entry.schooled;
      log.levelAtCandidate = entry.level;
    }
    log.wealthAtEnd = entry.wealthTicks;
  }
  log.stats = JSON.stringify(model.stats);
  log.coverage = model.getBuildingCoverage('x1');
  return log;
}

const hi = () => 0.65, lo = () => 0.4;

// (A) unschooled + sustained happiness → level 3 at exactly LEVEL3_WEALTH_TICKS
const a = gateRun({ utilities: [POWER, WATER], happinessAt: hi, ticks: 60 });
check(a.candidateTick === LEVEL3_WEALTH_TICKS, `A wealth route: candidate at tick ${a.candidateTick} (expected exactly ${LEVEL3_WEALTH_TICKS})`);
check(!a.schooled && !a.coverage.schooled, 'A wealth route: building is genuinely unschooled (no school coverage)');
check(a.wealthAtCandidate >= LEVEL3_WEALTH_TICKS && a.matureAtCandidate >= MATURE_TICKS,
  `A wealth route: wealthTicks ${a.wealthAtCandidate} >= ${LEVEL3_WEALTH_TICKS}, mature ${a.matureAtCandidate} >= ${MATURE_TICKS}`);

// (D) unschooled + low happiness → still blocked
const d = gateRun({ utilities: [POWER, WATER], happinessAt: lo, ticks: 120 });
check(d.candidateTick < 0, `D gate holds: no level-3 candidate in 120 ticks at happiness 0.4 (got ${d.candidateTick})`);

// (C) schooled + low happiness → level 3 at MATURE_TICKS_SCHOOLED
const c = gateRun({ utilities: [POWER, WATER, SCHOOL], happinessAt: lo, ticks: 60 });
check(c.candidateTick === MATURE_TICKS_SCHOOLED, `C school route: candidate at tick ${c.candidateTick} (expected exactly ${MATURE_TICKS_SCHOOLED})`);
check(c.schooled, 'C school route: building has school coverage');

// (B) hysteresis: 20 ticks high → 3 ticks below the reset threshold → streak restarts, candidate at 23 + 30
const b = gateRun({
  utilities: [POWER, WATER], ticks: 80,
  happinessAt: (t) => (t <= 20 ? 0.65 : t <= 23 ? 0.5 : 0.65),
});
check(b.candidateTick === 23 + LEVEL3_WEALTH_TICKS, `B hysteresis: candidate at tick ${b.candidateTick} (expected exactly ${23 + LEVEL3_WEALTH_TICKS} = reset tick 23 + ${LEVEL3_WEALTH_TICKS})`);
check(b.wealthAtCandidate >= LEVEL3_WEALTH_TICKS, `B hysteresis: streak restarted (wealthTicks ${b.wealthAtCandidate})`);

// (B2) band edge: hovering at 0.60 (inside 0.58–0.62) neither accrues nor resets
const b2 = gateRun({ utilities: [POWER, WATER], ticks: 60, happinessAt: () => 0.6 });
check(b2.candidateTick < 0 && b2.wealthAtEnd === 0, `B2 hysteresis band: 0.60 accrues nothing and resets nothing (candidate ${b2.candidateTick}, wealthTicks ${b2.wealthAtEnd})`);

// determinism: identical runs → identical stats + candidate
const a2 = gateRun({ utilities: [POWER, WATER], happinessAt: hi, ticks: 60 });
check(a2.candidateTick === a.candidateTick && a2.stats === a.stats, 'determinism: two identical runs give identical stats + candidate tick');

// sanity: constants stay in the designed relationship
check(LEVEL3_WEALTH_RESET < LEVEL3_WEALTH_HAPPINESS && LEVEL3_WEALTH_TICKS > MATURE_TICKS_SCHOOLED,
  `constants: reset ${LEVEL3_WEALTH_RESET} < happiness ${LEVEL3_WEALTH_HAPPINESS}; wealth ticks ${LEVEL3_WEALTH_TICKS} > school ticks ${MATURE_TICKS_SCHOOLED}`);

// Part 2: simulation showcase — staging + panel + coverage (its own simplified visuals render every kind as a
// brick stack, so civic *facades* are verified in Part 3 on the buildings showcase, which loads the real
// generators). Part 3: buildings showcase — add a school + hospital via the real world API on clear ground and
// capture front / 3-4 / rear at day + night, plus a generator-parts check for the new facade pieces.

const app = await openApp({ showcase: 'simulation', variant: 'default', seed: 1, tod: 12 });
const { page } = app;
const captureErrors = [];
try {
  await page.evaluate(() => window.__city.frames(60));
  // staged-city hashes: `full` includes building ids (session-counter based), `content` is ids-free so a same-variant
  // re-stage can be compared against a fresh boot.
  const cityHashes = () => page.evaluate(() => {
    const world = window.__city.world;
    let full = 0x811c9dc5, content = 0x811c9dc5;
    const mix = (h0, s) => { let h = h0; for (let k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 0x01000193); } return h; };
    for (const b of world.buildings.values()) {
      const desc = `${b.kind || b.zone}|${b.i},${b.j},${b.w},${b.d}|${b.level}|${b.seed}`;
      content = mix(content, desc);
      full = mix(full, `${b.id}|${desc}`);
    }
    const roads = `roads:${world.roads?.edges?.size ?? 0}`;
    return { full: (mix(full, roads) >>> 0).toString(16), content: (mix(content, roads) >>> 0).toString(16) };
  });
  const bootHashes = await cityHashes();
  for (const variant of ['default', 'boom', 'bust']) {
    await page.evaluate(async (v) => { await window.__city.showcase('simulation', v); }, variant);
    await page.evaluate(() => window.__city.frames(10));
    const info = await page.evaluate(() => {
      const world = window.__city.world;
      const sim = window.__city.ctx.modules.get('simulation').api;
      const kinds = {};
      for (const b of world.buildings.values()) kinds[b.kind] = (kinds[b.kind] || 0) + 1;
      const setCells = (layer) => { const g = sim.getCoverageGrid(layer); let n = 0; for (const v of g) if (v) n++; return n; };
      const kv = Object.fromEntries([...document.querySelectorAll('.sim-kv')].map((r) => [r.querySelector('span').textContent, r.querySelector('b').textContent]));
      const st = sim.getStats();
      return { kinds, education: st.educationCoverage, health: st.healthCoverage, schoolCells: setCells('school'), hospitalCells: setCells('hospital'), kv };
    });
    check((info.kinds.school || 0) === 1, `[${variant}] showcase stages exactly 1 school (got ${info.kinds.school || 0})`);
    check((info.kinds.hospital || 0) === 1, `[${variant}] showcase stages exactly 1 hospital (got ${info.kinds.hospital || 0})`);
    check(info.education > 0 && info.health > 0, `[${variant}] stats read non-zero education ${(info.education * 100).toFixed(1)}% / health ${(info.health * 100).toFixed(1)}%`);
    check(info.schoolCells > 0 && info.hospitalCells > 0, `[${variant}] coverage grids have set cells (school ${info.schoolCells}, hospital ${info.hospitalCells})`);
    check(info.kv.Education !== undefined && parseFloat(info.kv.Education) > 0, `[${variant}] showcase panel Education row reads ${info.kv.Education}`);
    check(info.kv.Health !== undefined && parseFloat(info.kv.Health) > 0, `[${variant}] showcase panel Health row reads ${info.kv.Health}`);
  }
  await page.evaluate(async () => { await window.__city.showcase('simulation', 'default'); });
  await page.evaluate(() => window.__city.frames(10));
  await app.stage({ preset: 'simulation:default', tod: 12 });
  captureErrors.push(...(await app.capture(path.join(OUT, 'showcase-default-day.png'), { settle: 20, sampleMs: 600 })).errors);

  // cross-boot determinism: the staged city must hash identically on a fresh boot of the same URL — the service
  // blocks must not have introduced a nondeterministic draw. A same-variant re-stage is content-identical; its
  // building ids differ because the session id counter keeps counting through clearContent() (pre-existing).
  const restagedHashes = await cityHashes();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__city && window.__city.ready === true, { timeout: 90000, polling: 100 });
  await page.evaluate(() => window.__city.frames(10));
  const reloadHashes = await cityHashes();
  check(bootHashes.full === reloadHashes.full, `cross-boot determinism: full staged-city hash ${bootHashes.full} == ${reloadHashes.full}`);
  check(restagedHashes.content === bootHashes.content, `re-stage determinism: same-variant content hash ${restagedHashes.content} == ${bootHashes.content} (ids advance with the session counter)`);
} finally {
  await app.close();
}

// Part 3 — civic facade craft on the buildings showcase (real generators)
const app2 = await openApp({ showcase: 'buildings', seed: 1, tod: 12 });
const { page: page2 } = app2;
try {
  await page2.evaluate(() => window.__city.frames(30));
  const sites = await page2.evaluate(async () => {
    const c = window.__city.ctx;
    const world = c.world;
    const ci = Math.floor(world.size.w / 2), cj = Math.floor(world.size.h / 2);
    const placed = [];
    for (const [kind, ox] of [['school', 8], ['hospital', 15]]) {
      const i = ci + ox, j = cj + 9;
      const id = world.addBuilding({ i, j, w: 2, d: 2, zone: null, kind, level: 1 });
      // generator-parts assertions: prove the right generator ran and the new facade pieces exist
      const mod = await import('/src/buildings/generator.js');
      const rng = { pick: (a) => a[0], chance: () => true, range: (a) => a, int: (a) => a, fork: () => rng, shuffle: () => {}, pickWeighted: (a) => a[0] };
      const out = mod.generateBuilding(c, world.buildings.get(id), rng);
      const mats = {};
      for (const p of out.parts) mats[p.mat] = (mats[p.mat] || 0) + 1;
      const centre = world.cellToWorld(i + 0.5, j + 0.5);
      placed.push({ kind, id, x: centre.x, z: centre.z, groundY: world.getHeight(centre.x, centre.z), parts: out.parts.length, mats });
    }
    return placed;
  });
  check(sites.length === 2, `buildings showcase: school + hospital added via world.addBuilding (got ${sites.length})`);
  const school = sites.find((s) => s.kind === 'school'), hospital = sites.find((s) => s.kind === 'hospital');
  check(school && school.mats.winWarm !== undefined, 'school generator ran: winWarm lit panes present');
  check(school && school.mats.brightYellow !== undefined && school.mats.transBlue !== undefined, 'school generator ran: brightYellow body + transBlue glazing present');
  check(hospital && hospital.mats.crossGlow !== undefined, 'hospital generator ran: crossGlow cross bars present (new material)');
  check(hospital && hospital.mats.transBlue !== undefined && (hospital.mats.winCool || 0) > 0, 'hospital generator ran: glazing + ward lit panes present');
  check(!school?.mats.transClear && !hospital?.mats.transClear, 'civic entrances no longer use flat transClear (r1 items 2–3)');

  // frame them from clear ground: building centre → street-distance views (front +z, 3/4, rear 3/4)
  for (const s of sites) {
    const views = [
      ['front', [s.x, s.groundY + 4.2, s.z + 18], [s.x, s.groundY + 3.2, s.z - 4], 55],
      ['34', [s.x + 16, s.groundY + 9, s.z + 16], [s.x, s.groundY + 3.5, s.z], 42],
      ['rear', [s.x - 16, s.groundY + 9, s.z - 16], [s.x, s.groundY + 3.5, s.z], 42],
    ];
    for (const [name, pos, target, fov] of views) {
      await page2.evaluate(({ pos, target, fov }) => window.__city.setCamera({ pos, target, fov }), { pos, target, fov });
      await page2.evaluate(() => window.__city.setTime(12));
      captureErrors.push(...(await app2.capture(path.join(OUT, `${s.kind}-${name}-day.png`), { settle: 15, sampleMs: 500 })).errors);
      await page2.evaluate(() => window.__city.setTime(21.5));
      captureErrors.push(...(await app2.capture(path.join(OUT, `${s.kind}-${name}-night.png`), { settle: 15, sampleMs: 500 })).errors);
    }
  }
  check(captureErrors.length === 0, `browser captures report no errors (${captureErrors.length})`);
} finally {
  await app2.close();
}

const summary = {
  ok: failed === 0, failed, checks: results.length, results,
  constants: { LEVEL3_WEALTH_TICKS, LEVEL3_WEALTH_HAPPINESS, LEVEL3_WEALTH_RESET, MATURE_TICKS, MATURE_TICKS_SCHOOLED },
  gateRuns: { a, b, b2, c, d },
  captureErrors,
};
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(`\n[check-civics] ${results.length - failed}/${results.length} checks passed → ${path.join(OUT, 'summary.json')}`);
process.exit(failed ? 1 : 0);
