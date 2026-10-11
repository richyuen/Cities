// transit — public transport: bus stops, bus lines drawn stop-to-stop along the road network, and buses that
// drive the loop. Transit owns stops/lines/coverage/economy; the actual buses are traffic vehicles (see
// traffic's setTransitLines), so they share lane discipline, signals, gap queuing, night lights and shadows.
//
// Route geometry is computed here from roads' public lane API (route.js) and handed to traffic as an ordered
// lane/turn key loop. Whenever roads change, the router rebuilds and every line is re-routed; a line whose stops
// are no longer connected is removed with a notification rather than left broken.
import * as THREE from 'three';
import { LaneRouter, buildRouteKeys } from './route.js';
import { buildStopKits, buildRibbonGeometry, LETTER_TILE_COUNT } from './models.js';
import { createPanel } from './panel.js';

const STOP_COST = 400;
const LINE_COST = 2000;
const UPKEEP_PER_BUS = 0.35;      // $/tick
const UPKEEP_PER_LINE = 0.25;     // $/tick
// Fares (C5): ridership is riders/day, so the fare is $/rider/day. The design's placeholder (0.004) produced ~$21/day
// next to a ~$2/tick network upkeep — invisible; tuned so fares cover roughly half the network at full coverage.
const FARE_PER_RIDER = 0.35;      // $/rider/day
const RIDERS_PER_BLOCK = 60;      // one queued rider block per this many riders/day at a stop
const RIDER_MAX = 6;              // queued rider blocks per stop (pool size = MAX_STOPS * RIDER_MAX)
const STOP_RADIUS_CELLS = 9;      // Chebyshev cells of walk-up coverage per stop
const MAX_STOPS = 64;
const MIN_STOP_SPACING_M = 14;    // two stops closer than this read as one (and make a pointless route leg)
const ROUTE_RETRY_MS = 60;        // wait past traffic's own 30 ms graph rebuild before recomputing routes
const LINE_COLORS = ['brightRed', 'brightBlue', 'brightYellow', 'brightGreen', 'brightOrange', 'brightPurple', 'mediumAzur', 'lime'];
const LINE_LETTERS = 'ABCDEFGH';
const RIDER_COLORS = ['brightRed', 'brightBlue', 'brightGreen', 'brightOrange', 'mediumAzur', 'lime', 'brightYellow'];

const S = {
  ctx: null, rng: null, group: null, router: null,
  stops: new Map(), lines: new Map(), nextStopId: 1, nextLineId: 1,
  draft: null, hoverStopId: null,
  coverage: 0, ridership: 0, upkeep: 0, fareRevenue: 0, busCount: 0,
  coverageDirty: true, routesDirty: false, lastRoadEvent: 0, lastCoverageAt: 0,
  stopMeshes: null, ribbons: null, draftMesh: null, kits: null,
  riderMesh: null, faceTiles: null,
  panel: null, unsub: [],
};

const simApi = (ctx) => { const m = ctx.modules.get('simulation'); return m?.status === 'ok' ? m.api : null; };
const trafficApi = (ctx) => { const m = ctx.modules.get('traffic'); return m?.status === 'ok' ? m.api : null; };
const roadsApi = (ctx) => { const m = ctx.modules.get('roads'); return m?.status === 'ok' ? m.api : null; };
const uiApi = (ctx) => { const m = ctx.modules.get('ui'); return m?.status === 'ok' ? m.api : null; };
function safe(fn, fallback = null) { try { return fn(); } catch (_) { return fallback; } }
function notify(msg, kind = 'info') { safe(() => uiApi(S.ctx)?.notify?.(msg, kind)); }
function status(msg) { safe(() => uiApi(S.ctx)?.setStatus?.(msg)); }
function colorOf(name) { return S.ctx.materials.palette[name] || '#0D69AB'; }

// ---- stop placement -----------------------------------------------------------------------------------------

/** Snap a click to a bus-stop anchor on the road's sidewalk: { x, y, z, edgeId, side, rot } or a refusal. */
function stopAnchor(x, z) {
  const ctx = S.ctx;
  const roads = roadsApi(ctx);
  if (!roads) return { ok: false, reason: 'Roads unavailable' };
  const snap = safe(() => roads.snapToRoad(x, z, 30));
  if (!snap) return { ok: false, reason: 'No road here — bus stops go on a street' };
  const edge = ctx.world.roads.edges.get(snap.edgeId);
  const a = edge ? ctx.world.roads.nodes.get(edge.a) : null;
  const b = edge ? ctx.world.roads.nodes.get(edge.b) : null;
  if (!edge || !a || !b) return { ok: false, reason: 'No road here — bus stops go on a street' };
  if (edge.kind === 'path') return { ok: false, reason: 'Bus stops need a street, not a path' };
  const dx = b.x - a.x, dz = b.z - a.z;
  const L = Math.hypot(dx, dz) || 1;
  const dirx = dx / L, dirz = dz / L;
  const rightx = -dirz, rightz = dirx; // roads' "right of travel" convention
  const side = ((x - a.x) * rightx + (z - a.z) * rightz) >= 0 ? 1 : -1; // +1 = click is right of a->b
  const off = safe(() => roads.roadWidth(edge.kind), 8) / 2 + 1.05;
  const px = snap.x + rightx * off * side;
  const pz = snap.z + rightz * off * side;
  const y = safe(() => roads.heightAt(px, pz), ctx.world.getHeight(px, pz) + 0.16) + 0.19; // sidewalk top
  const rot = Math.atan2(dirz * side, -dirx * side); // sign faces the carriageway
  return { ok: true, x: px, y, z: pz, edgeId: snap.edgeId, side, rot, kind: edge.kind };
}

function nearestStop(x, z, maxDist) {
  let best = null, bestD = Infinity;
  for (const s of S.stops.values()) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) { bestD = d; best = s; }
  }
  return bestD <= maxDist ? best : null;
}

/** "$400", or "free" under the simulation's free-construction mode (spend() then charges nothing). */
function priceText(sim, cost) { return sim?.getFreeBuild?.() ? 'free' : `$${cost.toLocaleString()}`; }

function placeStop(x, z) {
  const ctx = S.ctx;
  if (S.stops.size >= MAX_STOPS) return { ok: false, reason: `Stop limit reached (${MAX_STOPS})` };
  const a = stopAnchor(x, z);
  if (!a.ok) return a;
  const near = nearestStop(a.x, a.z, MIN_STOP_SPACING_M);
  if (near) return { ok: false, reason: 'Too close to another bus stop', stopId: near.id };
  const sim = simApi(ctx);
  if (sim && typeof sim.spend === 'function' && !sim.spend(STOP_COST)) return { ok: false, reason: `Insufficient funds — need $${STOP_COST.toLocaleString()}` };
  const stop = { id: S.nextStopId++, x: a.x, y: a.y, z: a.z, edgeId: a.edgeId, side: a.side, rot: a.rot, lineIds: [] };
  S.stops.set(stop.id, stop);
  refreshStops();
  refreshLineMembership();
  computeCoverage(); // immediate: the HUD should never show stale coverage after a placement
  S.ctx.events.emit('transit:changed', {});
  notify(`Bus stop built${sim ? `, ${priceText(sim, STOP_COST)}` : ''}`, 'success');
  return { ok: true, id: stop.id };
}

function removeStop(id, { silent = false } = {}) {
  const stop = S.stops.get(id);
  if (!stop) return false;
  S.stops.delete(id);
  for (const line of [...S.lines.values()]) {
    if (line.stopIds.includes(id)) line.stopIds = line.stopIds.filter((s) => s !== id);
    if (line.stopIds.length < 2) removeLine(line.id, { silent: true });
  }
  for (const line of S.lines.values()) recomputeLine(line);
  refreshStops();
  refreshLineMembership();
  refreshRibbons();
  refreshDraft();
  computeCoverage();
  syncTraffic();
  if (!silent) { notify('Bus stop removed', 'info'); S.ctx.events.emit('transit:changed', {}); }
  return true;
}

// ---- lines --------------------------------------------------------------------------------------------------

function lineColorFor(idx) { return colorOf(LINE_COLORS[idx % LINE_COLORS.length]); }
function lineNameFor(idx) { return `Line ${LINE_LETTERS[idx % LINE_LETTERS.length]}`; }

/** Make sure the lane router reflects the current road network before any route query. */
function ensureRouter() {
  if (!S.router.ready || S.routesDirty) { S.router.rebuild(); S.routesDirty = false; }
}

/** Recompute a line's lane-key loop from its stops. Returns true when a valid loop exists. */
function recomputeLine(line) {
  const stops = line.stopIds.map((id) => S.stops.get(id)).filter(Boolean);
  if (stops.length < 2) { line.keys = []; return false; }
  ensureRouter();
  const keys = safe(() => buildRouteKeys(S.router, stops, { close: true }));
  line.keys = keys || [];
  return !!keys;
}

function createLine(stopIds, { silent = false } = {}) {
  const ctx = S.ctx;
  if (stopIds.length < 2) return { ok: false, reason: 'A bus line needs at least 2 stops' };
  const idx = S.lines.size;
  const line = {
    id: S.nextLineId++, name: lineNameFor(idx), color: lineColorFor(idx), letterIdx: idx,
    stopIds: stopIds.slice(), keys: [],
  };
  S.lines.set(line.id, line);
  if (!recomputeLine(line)) {
    S.lines.delete(line.id);
    return { ok: false, reason: 'No drivable loop between those stops' };
  }
  const sim = simApi(ctx);
  if (sim && typeof sim.spend === 'function' && !sim.spend(LINE_COST)) {
    S.lines.delete(line.id);
    return { ok: false, reason: `Insufficient funds — need $${LINE_COST.toLocaleString()}` };
  }
  refreshLineMembership();
  refreshRibbons();
  syncTraffic();
  if (!silent) notify(`${line.name} opened: ${line.stopIds.length} stops${sim ? `, ${priceText(sim, LINE_COST)}` : ''}`, 'success');
  ctx.events.emit('transit:changed', {});
  return { ok: true, id: line.id };
}

function removeLine(id, { silent = false } = {}) {
  const line = S.lines.get(id);
  if (!line) return false;
  S.lines.delete(id);
  refreshLineMembership();
  refreshRibbons();
  refreshDraft();
  syncTraffic();
  if (!silent) notify(`${line.name} closed`, 'info');
  S.ctx.events.emit('transit:changed', {});
  return true;
}

/** Give every stop its serving-line colours (first line wins for the sign colour). Also refreshes the stop
 *  instances: the sign/ring colours are per-instance, so a line membership change (create/remove/reroute) must
 *  repaint the stops that just gained/lost it — without this the demo's boot-time stops stayed grey. */
function refreshLineMembership() {
  for (const s of S.stops.values()) s.lineIds = [];
  for (const line of S.lines.values()) for (const id of line.stopIds) { const s = S.stops.get(id); if (s && !s.lineIds.includes(line.id)) s.lineIds.push(line.id); }
  refreshStops();
}

// ---- draft (the line tool's in-progress loop) ---------------------------------------------------------------

function draftStops() { return S.draft ? S.draft.stopIds.map((id) => S.stops.get(id)).filter(Boolean) : []; }

function beginLine() {
  if (!S.draft) S.draft = { stopIds: [], keys: [] };
  return S.draft;
}

function addLineStop(stopId) {
  if (!S.stops.has(stopId)) return { ok: false, reason: 'No stop there' };
  const draft = beginLine();
  if (draft.stopIds.includes(stopId)) return { ok: false, reason: 'Stop already on this line' };
  const stops = draftStops();
  stops.push(S.stops.get(stopId));
  const keys = stops.length >= 2 ? safe(() => buildRouteKeys(S.router, stops, { close: false })) : null;
  if (stops.length >= 2 && !keys) return { ok: false, reason: 'No road route to that stop' };
  draft.stopIds.push(stopId);
  draft.keys = keys || [];
  refreshDraft();
  status(`Bus line: ${draft.stopIds.length} stop${draft.stopIds.length === 1 ? '' : 's'} — click more stops, or press Enter / click the first stop to finish`);
  S.ctx.events.emit('transit:draft', { stops: draft.stopIds.length });
  return { ok: true, stops: draft.stopIds.length, closed: draft.stopIds.length >= 2 && draft.stopIds[draft.stopIds.length - 1] === draft.stopIds[0] };
}

function finishLine() {
  const draft = S.draft;
  if (!draft || draft.stopIds.length < 2) return { ok: false, reason: 'A bus line needs at least 2 stops' };
  const res = createLine(draft.stopIds);
  S.draft = null;
  refreshDraft();
  status(null);
  S.ctx.events.emit('transit:draft', { stops: 0 });
  if (!res.ok) notify(res.reason, 'error');
  return res;
}

function cancelLine() {
  if (!S.draft) return false;
  S.draft = null;
  refreshDraft();
  status(null);
  S.ctx.events.emit('transit:draft', { stops: 0 });
  return true;
}

// ---- coverage + economy -------------------------------------------------------------------------------------

/** Share of zoned building footprint within STOP_RADIUS_CELLS of any stop. Stamps a cell grid, so it stays
 * cheap (64k cells) even with many stops. */
function computeCoverage() {
  const ctx = S.ctx;
  const world = ctx.world;
  const w = world.size.w, h = world.size.h;
  if (!S.covGrid || S.covGrid.length !== w * h) S.covGrid = new Uint8Array(w * h);
  const cov = S.covGrid;
  cov.fill(0);
  for (const s of S.stops.values()) {
    const c = world.worldToCell(s.x, s.z);
    const i0 = Math.max(0, c.i - STOP_RADIUS_CELLS), i1 = Math.min(w - 1, c.i + STOP_RADIUS_CELLS);
    const j0 = Math.max(0, c.j - STOP_RADIUS_CELLS), j1 = Math.min(h - 1, c.j + STOP_RADIUS_CELLS);
    for (let j = j0; j <= j1; j++) { const row = j * w; for (let i = i0; i <= i1; i++) cov[row + i] = 1; }
  }
  let total = 0, served = 0;
  for (const b of world.buildings.values()) {
    if (b.zone !== 'r' && b.zone !== 'c' && b.zone !== 'i') continue;
    const weight = Math.max(1, (b.w || 1) * (b.d || 1));
    total += weight;
    const ci = b.i + ((b.w || 1) >> 1), cj = b.j + ((b.d || 1) >> 1);
    if (ci >= 0 && ci < w && cj >= 0 && cj < h && cov[cj * w + ci]) served += weight;
  }
  S.coverage = total > 0 ? served / total : 0;
  S.coverageDirty = false;
  pushSim();
}

function pushSim() {
  const sim = simApi(S.ctx);
  if (!sim) return;
  if (typeof sim.setTransitCoverage === 'function') safe(() => sim.setTransitCoverage(S.coverage));
  if (typeof sim.setTransitUpkeep === 'function') safe(() => sim.setTransitUpkeep(S.upkeep));
  if (typeof sim.setTransitFareRevenue === 'function') safe(() => sim.setTransitFareRevenue(S.fareRevenue));
}

/** Fare income for the current ridership (riders/day × $/rider/day → $/tick at 2 ticks/s, like panelData's upkeep). */
function updateFare() {
  const dayLength = S.ctx?.clock?.dayLengthSec || 600;
  S.fareRevenue = S.ridership * FARE_PER_RIDER / (dayLength / 0.5);
}

/** Hand every line to traffic (which builds the loop paths + spawns buses) and refresh upkeep. */
function syncTraffic() {
  const traffic = trafficApi(S.ctx);
  const lines = [];
  for (const l of S.lines.values()) {
    if (!l.keys || l.keys.length < 3) continue;
    const stops = l.stopIds.map((id) => S.stops.get(id)).filter(Boolean).map((s) => ({ x: s.x, z: s.z }));
    lines.push({ id: l.id, color: l.color, keys: l.keys, stops });
  }
  const res = traffic ? safe(() => traffic.setTransitLines(lines)) : null;
  S.busCount = res?.buses || 0;
  S.upkeep = S.busCount * UPKEEP_PER_BUS + S.lines.size * UPKEEP_PER_LINE;
  pushSim();
}

/** Road edits invalidate every cached lane key: rebuild the router and re-route all lines. */
function rebuildRoutes() {
  S.routesDirty = false;
  S.router.rebuild();
  // A stop whose road is gone (bulldozed, or the world was cleared for a showcase) goes with it.
  let stopsDropped = 0;
  for (const stop of [...S.stops.values()]) {
    if (!S.ctx.world.roads.edges.has(stop.edgeId)) { S.stops.delete(stop.id); stopsDropped++; }
  }
  const dropped = [];
  for (const line of [...S.lines.values()]) {
    if (!recomputeLine(line)) {
      if (line.stopIds.length >= 2) dropped.push(line.name);
      S.lines.delete(line.id);
    }
  }
  if (stopsDropped) { refreshStops(); computeCoverage(); }
  if (dropped.length) notify(`${dropped.join(', ')} removed — the roads it used changed`, 'warn');
  refreshLineMembership();
  refreshRibbons();
  syncTraffic();
  S.ctx.events.emit('transit:changed', {});
}

// ---- visuals ------------------------------------------------------------------------------------------------

function buildVisuals(ctx) {
  const kits = buildStopKits(ctx);
  S.kits = kits;
  const group = S.group;
  const mk = (geo, mat, name) => {
    const m = new THREE.InstancedMesh(geo, mat, MAX_STOPS);
    m.count = 0; m.frustumCulled = false; m.name = name;
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    return m;
  };
  S.stopMeshes = {
    pole: mk(kits.poleGeo, kits.poleMat, 'transit-stop-pole'),
    sign: mk(kits.signGeo, kits.signMat, 'transit-stop-sign'),
    face: mk(kits.faceGeo, kits.faceMat, 'transit-stop-face'),
    ring: mk(kits.ringGeo, kits.ringMat, 'transit-stop-ring'),
  };
  S.stopMeshes.ring.castShadow = false;
  // Route-letter tiles (C5): the face geometry carries a per-instance `aUvOffset` (tile / 9); refreshStops()
  // writes each stop's line letter. One material, one draw call — no texture array.
  S.stopMeshes.face.geometry = kits.faceGeo.clone();
  S.faceTiles = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STOPS), 1);
  S.faceTiles.setUsage(THREE.DynamicDrawUsage);
  S.stopMeshes.face.geometry.setAttribute('aUvOffset', S.faceTiles);
  // Queued riders (C5): one pooled instanced mesh, ≤ RIDER_MAX minifig blocks per stop, positions static.
  S.riderMesh = new THREE.InstancedMesh(kits.riderGeo, kits.riderMat, MAX_STOPS * RIDER_MAX);
  S.riderMesh.name = 'transit-riders';
  S.riderMesh.count = 0;
  S.riderMesh.frustumCulled = false;
  S.riderMesh.castShadow = true;
  S.riderMesh.receiveShadow = false;
  group.add(S.riderMesh);
  S.ribbons = new THREE.Group();
  S.ribbons.name = 'transit-lines';
  group.add(S.ribbons);
  S.draftMesh = new THREE.Mesh(new THREE.BufferGeometry(), ctx.materials.glass('white', { emissive: 'white', emissiveIntensity: 0.6, opacity: 0.85 }));
  S.draftMesh.name = 'transit-draft';
  S.draftMesh.visible = false;
  S.draftMesh.frustumCulled = false;
  group.add(S.draftMesh);
}

const _mat4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _scale = new THREE.Vector3();
const _col = new THREE.Color();
const _upAxis = new THREE.Vector3(0, 1, 0);

function refreshStops() {
  if (!S.stopMeshes) return;
  const { pole, sign, face, ring } = S.stopMeshes;
  let n = 0;
  for (const s of S.stops.values()) {
    const line = s.lineIds.length ? S.lines.get(s.lineIds[0]) : null;
    const color = line ? line.color : '#C7C7C7';
    _pos.set(s.x, s.y, s.z);
    _q.setFromAxisAngle(_upAxis, s.rot || 0);
    _mat4.compose(_pos, _q, _one);
    pole.setMatrixAt(n, _mat4);
    sign.setMatrixAt(n, _mat4);
    face.setMatrixAt(n, _mat4);
    if (S.faceTiles) S.faceTiles.setX(n, (line && line.letterIdx !== undefined ? Math.min(LINE_LETTERS.length - 1, line.letterIdx) : LETTER_TILE_COUNT - 1) / LETTER_TILE_COUNT);
    const hovered = S.hoverStopId === s.id;
    _scale.set(hovered ? 1.18 : 1, 1, hovered ? 1.18 : 1);
    _mat4.compose(_pos, _q, _scale);
    ring.setMatrixAt(n, _mat4);
    _col.set(color);
    sign.setColorAt(n, _col);
    ring.setColorAt(n, _col);
    n++;
  }
  for (const m of [pole, sign, face, ring]) {
    m.count = n;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }
  if (S.faceTiles) S.faceTiles.needsUpdate = true;
  refreshRiders();
}

/** Queue visuals (C5): deterministic minifig blocks on the sidewalk behind each stop, count scaling with the stop's
 *  share of ridership (1 block ≈ RIDERS_PER_BLOCK riders/day, cap RIDER_MAX). No agent sim, no rng — colours pick
 *  from the stop id, positions from the stop's rot. */
function refreshRiders() {
  const mesh = S.riderMesh;
  if (!mesh || !S.stopMeshes) return;
  const perLine = S.lines.size ? S.ridership / S.lines.size : 0;
  let n = 0;
  for (const s of S.stops.values()) {
    let share = 0;
    for (const id of s.lineIds) { const line = S.lines.get(id); if (line) share += perLine / Math.max(1, line.stopIds.length); }
    const count = Math.max(0, Math.min(RIDER_MAX, Math.round(share / RIDERS_PER_BLOCK)));
    for (let k = 0; k < count; k++) {
      const a = s.rot || 0;
      // line the queue along the stop's local X (parallel to the carriageway, on the pavement) instead of behind it
      const lx = (0.3 + 0.24 * Math.floor(k / 2)) * (k % 2 ? 1 : -1), lz = -0.12;
      const x = s.x + lx * Math.cos(a) + lz * Math.sin(a);
      const z = s.z - lx * Math.sin(a) + lz * Math.cos(a);
      _pos.set(x, s.y, z);
      _q.setFromAxisAngle(_upAxis, a);
      _mat4.compose(_pos, _q, _one);
      mesh.setMatrixAt(n, _mat4);
      _col.set(colorOf(RIDER_COLORS[(s.id * 7 + k) % RIDER_COLORS.length]));
      mesh.setColorAt(n, _col);
      n++;
    }
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Per-line ribbon meshes (one draw call per line), built from the router's lane/turn geometry. */
function refreshRibbons() {
  if (!S.ribbons) return;
  for (const child of [...S.ribbons.children]) {
    S.ribbons.remove(child);
    child.geometry?.dispose();
    child.material?.dispose?.();
  }
  for (const line of S.lines.values()) {
    const pts = routePolyline(line.keys);
    if (!pts || pts.length < 2) continue;
    const geo = buildRibbonGeometry(pts, 0.56, 0.06);
    if (!geo) continue;
    // Roughness up + clearcoat to near zero + a persistent low emissive tint: at grazing angles a glossy ribbon
    // reflected the sky/washed to mauve instead of reading as the line's colour (transit r1 critic). The emissive
    // keeps the hue stable without crossing the bloom threshold by day (intensity < 1).
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(line.color), roughness: 0.9, metalness: 0, clearcoat: 0.05, clearcoatRoughness: 0.3,
      emissive: new THREE.Color(line.color), emissiveIntensity: 0.35, side: THREE.DoubleSide,
    });
    mat.name = `transit-line-mat-${line.id}`;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `transit-line-${line.id}`;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    S.ribbons.add(mesh);
    line.ribbonMat = mat;
  }
  updateNightLook(true);
}

/** Concatenated world-space points for a key loop, using the router's cached lane/turn geometry. */
function routePolyline(keys) {
  if (!S.router || !keys || keys.length < 2) return null;
  const out = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    let pts = null;
    if (key[0] === 'L') {
      const node = S.router.nodes.get(key);
      pts = node?.pts;
    } else {
      pts = S.router.turnPaths.get(key);
    }
    if (!pts) return null;
    for (let j = i === 0 ? 0 : 1; j < pts.length; j++) out.push(pts[j]);
  }
  return out;
}

function refreshDraft() {
  if (!S.draftMesh) return;
  const pts = S.draft && S.draft.keys.length >= 2 ? routePolyline(S.draft.keys) : null;
  S.draftMesh.geometry.dispose();
  S.draftMesh.geometry = pts && pts.length >= 2 ? (buildRibbonGeometry(pts, 0.5, 0.07) || new THREE.BufferGeometry()) : new THREE.BufferGeometry();
  S.draftMesh.visible = !!(pts && pts.length >= 2);
}

function updateNightLook(force = false) {
  const night = !!S.ctx?.clock?.isNight;
  if (!force && night === S._night) return;
  S._night = night;
  if (S.kits) {
    // Sign/ring emissive is tinted by the per-instance line colour (see models.js); the white face carries the
    // actual glow at night so a stop reads as a lit sign, not a white blob.
    S.kits.signMat.emissiveIntensity = night ? 0.9 : 0;
    S.kits.ringMat.emissiveIntensity = night ? 1.1 : 0;
    if (S.kits.faceMat) S.kits.faceMat.emissiveIntensity = night ? 0.55 : 0;
  }
  for (const line of S.lines.values()) if (line.ribbonMat) line.ribbonMat.emissiveIntensity = night ? 0.85 : 0.35;
}

// ---- panel --------------------------------------------------------------------------------------------------

function panelRows() {
  const status = safe(() => trafficApi(S.ctx)?.getTransitStatus?.(), []) || [];
  const byId = new Map(status.map((s) => [s.id, s]));
  const rows = [];
  for (const line of S.lines.values()) {
    const live = byId.get(line.id);
    const lengthM = live?.length ?? (safe(() => S.router.routeLength(line.keys), 0) || 0);
    rows.push({
      id: line.id, name: line.name, color: line.color, stops: line.stopIds.length,
      buses: live?.buses ?? 0, lengthM,
      ridership: Math.round(S.ridership * (S.lines.size ? 1 / S.lines.size : 0)),
    });
  }
  return rows;
}

function panelData() {
  const dayLength = S.ctx?.clock?.dayLengthSec || 600;
  return {
    lines: panelRows(), coverage: S.coverage, ridership: S.ridership, buses: S.busCount,
    upkeepDay: S.upkeep * (dayLength / 0.5),
    fareDay: S.fareRevenue * (dayLength / 0.5),
  };
}

function openPanel() {
  if (!S.panel) return;
  S.panel.update(panelData());
  S.panel.root.classList.add('open');
}

function closePanel() { S.panel?.root.classList.remove('open'); }

// ---- api ----------------------------------------------------------------------------------------------------

const api = {
  /** Snap-preview a stop placement (for the tool ghost): { ok, x, y, z, reason? }. */
  previewStop(x, z) { return stopAnchor(x, z); },
  placeStop,
  removeStop,
  findStop(x, z, maxDist = 4) {
    const s = nearestStop(x, z, maxDist);
    return s ? { id: s.id, x: s.x, y: s.y, z: s.z } : null;
  },
  setHoverStop(id) {
    if (S.hoverStopId === id) return;
    S.hoverStopId = id;
    refreshStops();
  },
  beginLine,
  addLineStop,
  finishLine,
  cancelLine,
  /** Programmatic line creation (demo city / showcase): stopIds in visiting order. */
  createLine(stopIds) { return createLine(stopIds); },
  removeLine,
  getDraft() { return S.draft ? { stopIds: [...S.draft.stopIds], keys: S.draft.keys.length } : null; },
  getLines() {
    return [...S.lines.values()].map((l) => ({ id: l.id, name: l.name, color: l.color, stopIds: [...l.stopIds], keys: l.keys.length, buses: Math.max(1, Math.min(4, Math.round((safe(() => S.router.routeLength(l.keys), 0) || 0) / 320))) }));
  },
  getStops() { return [...S.stops.values()].map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, edgeId: s.edgeId, lineIds: [...s.lineIds] })); },
  /** The ordered lane/turn key loop of one line (debugging + tooling). */
  getLineKeys(id) { const l = S.lines.get(id); return l ? [...l.keys] : null; },
  getCoverage() { if (S.coverageDirty) computeCoverage(); return S.coverage; },
  /** Read-only per-cell stop walk-up grid (Uint8Array, 1 = within a stop's coverage radius); recomputes stale
   * data first. Do not mutate — the returned array is the transit module's own. */
  getCoverageGrid() { if (S.coverageDirty) computeCoverage(); return S.covGrid; },
  getRidership() { return S.ridership; },
  getBusCount() { return S.busCount; },
  openPanel,
  closePanel,
  /** Full round-trippable state for save/load. */
  getState() {
    return {
      nextStopId: S.nextStopId, nextLineId: S.nextLineId,
      stops: [...S.stops.values()].map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, edgeId: s.edgeId, side: s.side, rot: s.rot })),
      lines: [...S.lines.values()].map((l) => ({ id: l.id, name: l.name, color: l.color, stopIds: [...l.stopIds] })),
    };
  },
  loadState(state) {
    if (!state) return;
    for (const id of [...S.stops.keys()]) S.stops.delete(id);
    for (const id of [...S.lines.keys()]) S.lines.delete(id);
    for (const s of state.stops || []) S.stops.set(s.id, { ...s, lineIds: [] });
    for (const l of state.lines || []) S.lines.set(l.id, { ...l, stopIds: [...(l.stopIds || [])], keys: [] });
    S.nextStopId = state.nextStopId || (Math.max(0, ...S.stops.keys()) + 1);
    S.nextLineId = state.nextLineId || (Math.max(0, ...S.lines.keys()) + 1);
    S.draft = null;
    S.router.rebuild();
    for (const line of S.lines.values()) recomputeLine(line);
    refreshLineMembership();
    refreshStops();
    refreshRibbons();
    refreshDraft();
    computeCoverage();
    syncTraffic();
  },
};

export default {
  id: 'transit',
  // traffic is a hard dep: route buses ARE traffic vehicles, and the module's showcase (stops + lines + buses)
  // is only representative with them loaded. Every traffic call is still guarded (tools-style), so a failed
  // traffic module degrades to stops/lines/coverage without buses instead of taking transit down.
  deps: ['roads', 'traffic'],
  order: 55,
  api,
  showcaseVariants: ['default', 'night'],
  presets: {
    'transit:default': () => ({ pos: [72, 66, 74], target: [-28, 0, -28], fov: 46 }),
    'transit:closeup': () => ({ pos: [3.5, 6.4, -17.5], target: [-5, 3.2, -30], fov: 38 }),
    'transit:aerial': () => ({ pos: [-28, 118, 4], target: [-28, 0, -28], fov: 46 }),
    // 4.6 m macro on the showcase's first stop (anchor measured at (-5.05, sidewalk, -30), sign faces the road):
    // frames the whole stop — pole base + ground ring + sign — at the range a player actually inspects one; the
    // wide presets render stops as specks (transit r1 critic; framing widened in r2 so the base is not cropped).
    'transit:stop': () => ({ pos: [-2.1, 7.4, -26.6], target: [-5.05, 6.5, -30], fov: 40 }),
  },

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('transit');
    S.group = new THREE.Group();
    S.group.name = 'transit';
    ctx.scene.add(S.group);
    S.router = new LaneRouter(ctx);
    S.router.rebuild();
    buildVisuals(ctx);
    S.coverageDirty = true;
    S.routesDirty = false;

    const bump = () => { S.routesDirty = true; S.lastRoadEvent = performance.now(); };
    S.unsub.push(
      ctx.events.on('road:added', bump),
      ctx.events.on('road:removed', bump),
      ctx.events.on('road:changed', bump),
      ctx.events.on('terrain:changed', bump),
      ctx.events.on('traffic:transit-invalid', () => { S.routesDirty = true; S.lastRoadEvent = performance.now(); }),
      ctx.events.on('building:spawned', () => { S.coverageDirty = true; }),
      ctx.events.on('building:removed', () => { S.coverageDirty = true; }),
      ctx.events.on('sim:tick', (p) => {
        const pop = p?.stats?.population || 0;
        S.ridership = Math.round(pop * S.coverage * 0.18);
        updateFare();
        pushSim();
        refreshRiders();
        if (S.panel) S.panel.update(panelData());
      }),
      ctx.events.on('time:changed', () => updateNightLook()),
      ctx.events.on('tool:selected', (p) => {
        const tool = p?.tool || null;
        if (tool === 'transit:lines') openPanel(); else if (tool && !tool.startsWith('transit:')) closePanel();
        if (tool !== 'transit:line') cancelLine();
        if (tool !== 'transit:stop' && tool !== 'transit:line') S.hoverStopId = null, refreshStops();
      }),
    );
    S.panel = createPanel(ctx.dom || document.body, {
      onDelete: (id) => removeLine(id),
      onFocus: (id) => {
        const line = S.lines.get(id);
        const stop = line && S.stops.get(line.stopIds[0]);
        if (stop) safe(() => ctx.cameraApi.apply({ pos: [stop.x + 40, stop.y + 28, stop.z + 40], target: [stop.x, stop.y + 2, stop.z] }));
      },
    });
    ctx.log('[transit] ready');
  },

  update(dt, ctx) {
    if (S.routesDirty && performance.now() - S.lastRoadEvent > ROUTE_RETRY_MS) rebuildRoutes();
    if (S.coverageDirty) {
      S.lastCoverageAt += dt;
      if (S.lastCoverageAt > 0.4) { S.lastCoverageAt = 0; computeCoverage(); }
    }
    // Traffic rebuilds its lane graph lazily, so a line synced during boot can spawn its buses a moment later
    // (traffic re-applies the last setTransitLines on its own graph rebuild). Poll to keep upkeep/panel in step.
    S.busPoll = (S.busPoll || 0) + dt;
    if (S.busPoll > 0.5) {
      S.busPoll = 0;
      const n = safe(() => trafficApi(ctx)?.getTransitBusCount?.(), null);
      if (typeof n === 'number' && (n !== S.busCount || S.busCount === 0)) {
        S.busCount = n;
        S.upkeep = n * UPKEEP_PER_BUS + S.lines.size * UPKEEP_PER_LINE;
        pushSim();
      }
    }
    updateNightLook();
  },

  dispose() {
    for (const off of S.unsub) off();
    S.unsub.length = 0;
    if (S.group) {
      S.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); o.geometry?.dispose?.(); });
      S.ctx.scene.remove(S.group);
    }
    S.kits = null; S.stopMeshes = null; S.ribbons = null; S.draftMesh = null;
    S.riderMesh = null; S.faceTiles = null;
    S.panel?.dispose(); S.panel = null;
    S.stops.clear(); S.lines.clear(); S.draft = null; S.hoverStopId = null;
    S.nextStopId = 1; S.nextLineId = 1; S.coverage = 0; S.ridership = 0; S.upkeep = 0; S.fareRevenue = 0; S.busCount = 0;
    S.coverageDirty = true; S.routesDirty = false;
  },

  async showcase(ctx, variant = 'default') {
    // Staging replaces whatever transit network existed (the runner already cleared the world).
    for (const id of [...S.stops.keys()]) S.stops.delete(id);
    for (const id of [...S.lines.keys()]) S.lines.delete(id);
    S.draft = null;
    S.hoverStopId = null;
    // A compact 3x3 street grid with an avenue through it, same staging ground as traffic's own showcase.
    const xs = [-56, 0, 56], zs = [-56, 0, 56];
    for (const x of xs) for (let k = 0; k < zs.length - 1; k++) ctx.world.addRoad({ x, z: zs[k] }, { x, z: zs[k + 1] }, 'street');
    for (const z of zs) {
      const kind = z === 0 ? 'avenue' : 'street';
      for (let k = 0; k < xs.length - 1; k++) ctx.world.addRoad({ x: xs[k], z }, { x: xs[k + 1], z }, kind);
    }
    // Roads and traffic both rebuild lazily; force them so routing and bus spawn have real lane geometry now.
    safe(() => ctx.modules.get('roads')?.api?.rebuild?.());
    S.router.rebuild();
    safe(() => trafficApi(ctx)?.rebuildNetwork?.());
    // Thin the general traffic for the showcase: the subject is the bus loop, not a gridlock shot.
    safe(() => trafficApi(ctx)?.setDensity?.(0.3));
    const mkStop = (x, z) => { const a = stopAnchor(x, z); if (!a.ok) return null; const s = { id: S.nextStopId++, x: a.x, y: a.y, z: a.z, edgeId: a.edgeId, side: a.side, rot: a.rot, lineIds: [] }; S.stops.set(s.id, s); return s; };
    // A clockwise loop around the central block (x 0..-56, z 0..-56): all four legs are right turns, so lane 0
    // can serve every junction — the same shape a real bus loop takes. Each stop sits on the right of travel.
    const sA = mkStop(-2, -30), sB = mkStop(-30, -2), sC = mkStop(-54, -30), sD = mkStop(-30, -54);
    const ids = [sA, sB, sC, sD].filter(Boolean).map((s) => s.id);
    if (ids.length >= 2) {
      const idx = S.lines.size;
      const line = { id: S.nextLineId++, name: lineNameFor(idx), color: lineColorFor(idx), letterIdx: idx, stopIds: ids, keys: [] };
      S.lines.set(line.id, line);
      recomputeLine(line);
    }
    // Stage a plausible ridership so the queue visuals read in the module showcase (no simulation module here to
    // fill `S.ridership` from sim:tick); the real game always drives it from population × coverage.
    S.ridership = 1200;
    updateFare();
    refreshLineMembership();
    refreshStops();
    refreshRibbons();
    S.coverageDirty = true;
    computeCoverage();
    syncTraffic();
    if (variant === 'night') { ctx.clock.paused = true; ctx.clock.set(21.5); }
    updateNightLook();
    ctx.log(`[transit] showcase '${variant}': ${S.stops.size} stops, ${S.lines.size} lines, ${S.busCount} buses`);
  },
};
