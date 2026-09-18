// tools — interactive glue between pointer/keyboard input and world mutations. Listens to `ui`'s `tool:selected`
// events, raycasts the canvas, and drives other modules' public APIs (roads.addRoad via ctx.world, zoning,
// props, simulation, audio) to place/remove content. Renders only a handful of translucent ghost meshes.
//
// Isolation: every optional collaborator (`ui`, `simulation`, `audio`, `props`, `buildings`, `zoning`) is looked
// up fresh via `ctx.modules.get(id)` and guarded with `?.status === 'ok'` before use — this module must keep
// working (placing roads/zones, bulldozing) even when any of them is missing/failed. That is exactly the
// situation its own showcase runs under: `?showcase=tools` only loads terrain/roads(/zoning)+environment+effects,
// so ui/simulation/audio/props/buildings are all absent there even though they exist in the full game.
import * as THREE from 'three';
import { stageShowcase, ghostEmissiveIntensity } from './showcase.js';

// `zoning` has shipped in this build, but mirror the TERRAIN_PRESENT pattern roads/index.js uses anyway: declare
// the dep only when a loader for it actually exists (import.meta.glob sees its src/zoning/index.js). This way,
// if zoning is ever reverted/missing again (e.g. mid-development on another agent's branch), the registry never
// marks `tools` "skipped: deps not ok: zoning" for a module this one merely *uses optionally* everywhere else.
const ZONING_PRESENT = Object.keys(import.meta.glob('../zoning/index.js')).length > 0;

const PRICE_PER_M = { street: 100, avenue: 200, highway: 400, path: 20 };
const FALLBACK_WIDTH = { street: 8, avenue: 16, highway: 16, path: 3 };
const ROAD_LABEL = { street: 'Street', avenue: 'Avenue', highway: 'Highway', path: 'Path' };
const ZONE_LABEL = { r: 'Residential', c: 'Commercial', i: 'Industrial' };
const AREA_LABEL = { park: 'Park', trees: 'Trees', plaza: 'Plaza' };
const MIN_ROAD_LEN = 4; // meters — shorter drags are treated as a no-op tap, not an error

const S = {
  ctx: null, rng: null, group: null, raycaster: null, ghosts: null,
  tool: null, drag: null, pointerId: null, clickStart: null,
  pointer: { over: false, lastClient: null },
  showcaseExtra: null,
  unsub: [], onPointerDown: null, onPointerMove: null, onPointerUp: null, onPointerLeave: null, onKeyDown: null,
};

// ---- small pure-ish helpers (no DOM/event access) --------------------------------------------------------

function uiApi(ctx) { const m = ctx.modules.get('ui'); return m?.status === 'ok' ? m.api : null; }
function zoningApi(ctx) { const m = ctx.modules.get('zoning'); return m?.status === 'ok' ? m.api : null; }
function notify(msg, kind = 'info') { uiApi(S.ctx)?.notify?.(msg, kind); }
function safeCall(fn, fallback = null) { try { return fn(); } catch (_) { return fallback; } }

function fail(msg, worldPos) {
  const ctx = S.ctx;
  uiApi(ctx)?.notify?.(msg, 'error');
  const audio = ctx.modules.get('audio');
  if (audio?.status === 'ok') {
    try {
      const p = worldPos ? { x: worldPos.x, y: (worldPos.y ?? ctx.world.getHeight(worldPos.x, worldPos.z)) + 1, z: worldPos.z } : null;
      audio.api?.play?.('error', p);
    } catch (_) { /* isolation: never let a missing/broken audio api break tools */ }
  }
}

function toolKindOf(tool) {
  if (!tool) return null;
  if (tool.startsWith('road:')) return { group: 'road', kind: tool.slice(5) };
  if (tool.startsWith('zone:')) { const z = tool.slice(5); return { group: 'zone', zone: z === 'none' ? null : z }; }
  if (tool === 'park' || tool === 'trees' || tool === 'plaza') return { group: 'area', areaKind: tool };
  if (tool === 'bulldoze') return { group: 'bulldoze' };
  if (tool === 'select') return { group: 'select' };
  return null;
}

// 'r' uses 'lime' rather than the palette's 'transGreen' (a near-colourless sage, #84B68D) — r1 review: up close,
// mid-drag (the range that matters most), transGreen read as almost the same pale mint-grey as the ground studs
// underneath it, no crisp "buildable" statement. 'lime' (#A5CA18) is a saturated yellow-green with real punch
// through the glass() tint, unmistakable as a positive/valid signal at any range. See ghostMat() below for the
// matching emissive boost that makes it glow, not just sit flat, at night.
function zoneColorFor(zone) { return zone === 'r' ? 'lime' : zone === 'c' ? 'transBlue' : zone === 'i' ? 'transYellow' : 'transRed'; }

function gridSnap(world, x, z) {
  const cs = world.cellSize;
  return { x: world.minX + Math.round((x - world.minX) / cs) * cs, z: world.minZ + Math.round((z - world.minZ) / cs) * cs };
}

/** Snap a road endpoint to a nearby existing road (for junctions) else the 8 m cell grid. */
function snapRoadPoint(ctx, x, z) {
  const roads = ctx.modules.get('roads');
  if (roads?.status === 'ok' && typeof roads.api?.snapToRoad === 'function') {
    try { const s = roads.api.snapToRoad(x, z, 6); if (s) return { x: s.x, z: s.z }; } catch (_) { /* fall through to grid snap */ }
  }
  return gridSnap(ctx.world, x, z);
}

function roadPathBuildable(ctx, a, b) {
  const world = ctx.world;
  const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
  const steps = Math.max(1, Math.ceil(len / 8));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const c = world.cellAtWorld(a.x + dx * t, a.z + dz * t);
    if (!c || c.type === 'water') return false;
  }
  return true;
}

function roadGhostGeom(ctx, kind, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz);
  const roads = ctx.modules.get('roads');
  let width = FALLBACK_WIDTH[kind] || 8;
  if (roads?.status === 'ok' && typeof roads.api?.footprintWidth === 'function') { try { width = roads.api.footprintWidth(kind); } catch (_) { /* keep fallback */ } }
  const midx = (a.x + b.x) / 2, midz = (a.z + b.z) / 2;
  let midy;
  if (roads?.status === 'ok' && typeof roads.api?.heightAt === 'function') { try { midy = roads.api.heightAt(midx, midz); } catch (_) { midy = ctx.world.getHeight(midx, midz); } }
  else midy = ctx.world.getHeight(midx, midz);
  const valid = length >= MIN_ROAD_LEN && roadPathBuildable(ctx, a, b);
  const cost = Math.round(length * (PRICE_PER_M[kind] ?? 100));
  return { length, width, mid: { x: midx, y: midy + 0.25, z: midz }, angle: Math.atan2(dz, dx), valid, cost };
}

function normRect(d) { return { i0: Math.min(d.i0, d.i1), i1: Math.max(d.i0, d.i1), j0: Math.min(d.j0, d.j1), j1: Math.max(d.j0, d.j1) }; }

function rectCellCount(world, i0, j0, i1, j1) {
  let n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (world.cellAt(i, j)) n++;
  return n;
}

/** `ctx.world.cells[].height` is averaged straight off the smooth heightField (see World._refreshCellHeights),
 * not the terrain module's rendered plate-quantized surface — so a ghost positioned from it can hover visibly
 * off the ground it's meant to be flush with. Prefer the same terrain.surfaceHeight groundHeightFn() uses for
 * raycasting, so every ghost's Y matches what's actually on screen; fall back to the cell-height average when
 * terrain isn't loaded. */
function rectBounds(ctx, i0, j0, i1, j1) {
  const world = ctx.world;
  const cs = world.cellSize;
  const x0 = world.minX + i0 * cs, x1 = world.minX + (i1 + 1) * cs;
  const z0 = world.minZ + j0 * cs, z1 = world.minZ + (j1 + 1) * cs;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const groundFn = groundHeightFn(ctx);
  let y;
  if (groundFn) {
    y = groundFn(cx, cz);
  } else {
    let sum = 0, n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = world.cellAt(i, j); if (c) { sum += c.height; n++; } }
    y = n ? sum / n : world.getHeight(cx, cz);
  }
  return { i0, j0, i1, j1, x0, x1, z0, z1, cx, cz, w: x1 - x0, d: z1 - z0, y };
}

function cellBuildable(ctx, i, j) {
  const terr = ctx.modules.get('terrain');
  if (terr?.status === 'ok' && typeof terr.api?.isBuildable === 'function') { try { return terr.api.isBuildable(i, j); } catch (_) { /* fall through */ } }
  const c = ctx.world.cellAt(i, j);
  return !!c && c.type !== 'water';
}

/** The terrain module renders a plate-quantized (stepped, "Lego brick") surface, not the smooth bilinear one
 * world.getHeight() interpolates from — see terrain/data.js surfaceH(). Pointer raycasting must march against
 * whichever surface is actually on screen, or the resolved ground point (and so the selected cell) can drift
 * off from the pixel under the cursor wherever the two diverge. Falls back to world's own smooth height when
 * terrain isn't loaded (matches the cellBuildable guard above). */
function groundHeightFn(ctx) {
  const terr = ctx.modules.get('terrain');
  return terr?.status === 'ok' && typeof terr.api?.surfaceHeight === 'function' ? terr.api.surfaceHeight : null;
}

function currentMoney(ctx) {
  const sim = ctx.modules.get('simulation');
  if (sim?.status === 'ok' && typeof sim.api?.getStats === 'function') {
    try { const m = sim.api.getStats()?.money; if (Number.isFinite(m)) return m; } catch (_) { /* fall through */ }
  }
  const m2 = ctx.world.stats?.money;
  return Number.isFinite(m2) ? m2 : Infinity;
}

/** Best-effort deduction: only when no `simulation` is running its own money model (else our write would be
 * clobbered by the next sim:tick, since simulation republishes world.stats.money from its own ledger). */
function spendMoney(ctx, cost) {
  const sim = ctx.modules.get('simulation');
  if (sim?.status === 'ok') return;
  const cur = Number.isFinite(ctx.world.stats?.money) ? ctx.world.stats.money : 0;
  ctx.world.setStats({ money: Math.max(0, cur - cost) });
}

function pickBuildingId(ctx, x, z, i, j) {
  const buildings = ctx.modules.get('buildings');
  if (buildings?.status === 'ok' && typeof buildings.api?.pickAt === 'function') {
    try { const id = buildings.api.pickAt(x, z); if (id) return id; } catch (_) { /* fall through */ }
  }
  return ctx.world.cellAt(i, j)?.buildingId || null;
}

function buildingInfoHtml(b) {
  const zone = b.zone || null;
  const tag = zone ? `<span class="lc-tag ${zone}">${ZONE_LABEL[zone] || zone}</span>` : `<span class="lc-tag" style="background:#666">Unzoned</span>`;
  const cells = (b.w || 1) * (b.d || 1);
  const kind = b.kind ? b.kind[0].toUpperCase() + b.kind.slice(1) : 'Building';
  return `${tag}<h2>${kind} #${b.id}</h2>
    <div class="lc-kv">
      <span>Level</span><span>${b.level ?? 1}</span>
      <span>Height</span><span>${Number.isFinite(b.height) ? b.height.toFixed(1) : b.height} m</span>
      <span>Footprint</span><span>${b.w}&times;${b.d} (${cells} cell${cells === 1 ? '' : 's'})</span>
    </div>`;
}

// ---- ghost mesh application (mutate the 3 reusable meshes; never allocate geometry per call) ---------------

// A brighter/less-transparent variant of the shared glass cache (still cached-by-key, still reused across every
// ghost instance and every frame — never a one-off material) so ghosts read clearly over grass or other
// low-contrast ground instead of nearly disappearing at the standard glass() opacity (0.55). The valid/"lime"
// ghost gets a touch more opacity still (r1 review: even the boosted 0.8 read as a pale wash up close for the
// old transGreen — the colour swap above does most of the work, this pushes it further). emissiveIntensity comes
// from the shared ghostEmissiveIntensity() table in showcase.js (ARCHITECTURE.md §7: red/blue need >=4 to bloom
// at night, yellow/white 2.5-3) — r1 review found this hardcoded at 0.35 here, ~10x too low to bloom at all.
function ghostMat(ctx, colorName) {
  return ctx.materials.glass(colorName, {
    opacity: colorName === 'lime' ? 0.9 : 0.8,
    emissive: colorName,
    emissiveIntensity: ghostEmissiveIntensity(colorName, !!ctx.clock?.isNight),
  });
}

// Ghost/decorative materials are cached-by-key (see ghostMat/addDecorativeRect), so day<->night just means
// picking a different cached material — cheap, no allocation. But a mesh only gets a *fresh* material when
// something re-applies one of those functions to it; an in-progress drag (or the showcase's deliberately-frozen
// one, see showcase.js) doesn't touch its ghost mesh every frame, so without this it would stay locked to
// whichever isNight was true when the gesture started. Subscribed to `time:changed` (cheap, event-driven, not
// per-frame) so every glass ghost/decorative mesh in this module's own group (including the showcase's static
// decorative rects, which live under S.group too) picks up the right intensity for the *current* clock state —
// this is what actually makes the day-vs-night gating in ghostEmissiveIntensity() correct rather than a
// build-time snapshot.
function refreshGhostEmissiveForTime() {
  if (!S.group || !S.ctx) return;
  S.group.traverse((obj) => {
    const mat = obj.material;
    if (!mat || !mat.name || !mat.name.startsWith('glass:')) return;
    obj.material = ghostMat(S.ctx, mat.name.slice(6));
  });
}

function applyRibbon(g) {
  const mesh = S.ghosts.ribbon;
  mesh.position.set(g.mid.x, g.mid.y, g.mid.z);
  mesh.rotation.set(0, g.angle, 0);
  mesh.scale.set(Math.max(g.length, 0.05), 0.6, Math.max(g.width, 0.5));
  mesh.material = ghostMat(S.ctx, g.valid ? 'lime' : 'transRed');
  mesh.visible = true;
  S.ghosts.rect.visible = false; S.ghosts.point.visible = false;
}

function applyRect(bounds, colorName) {
  const mesh = S.ghosts.rect;
  mesh.position.set(bounds.cx, bounds.y + 0.35, bounds.cz);
  mesh.scale.set(Math.max(bounds.w, 0.3), 0.5, Math.max(bounds.d, 0.3));
  mesh.material = ghostMat(S.ctx, colorName);
  mesh.visible = true;
  S.ghosts.ribbon.visible = false; S.ghosts.point.visible = false;
}

function applyPoint(p, colorName) {
  const mesh = S.ghosts.point;
  const y = (p.y ?? S.ctx.world.getHeight(p.x, p.z)) + 0.3;
  mesh.position.set(p.x, y, p.z);
  mesh.scale.set(1.2, 0.6, 1.2);
  mesh.material = ghostMat(S.ctx, colorName);
  mesh.visible = true;
  S.ghosts.ribbon.visible = false; S.ghosts.rect.visible = false;
}

function hideGhosts() {
  if (S.ghosts) { S.ghosts.ribbon.visible = false; S.ghosts.rect.visible = false; S.ghosts.point.visible = false; }
  if (S.ctx) { safeCall(() => zoningApi(S.ctx)?.hidePreview?.()); uiApi(S.ctx)?.setStatus?.(null); }
}

// ---- gesture state machine --------------------------------------------------------------------------------

function startDrag(hit) {
  const info = toolKindOf(S.tool);
  if (!info || info.group === 'select') return;
  if (info.group === 'road') {
    const p = snapRoadPoint(S.ctx, hit.x, hit.z);
    S.drag = { group: 'road', kind: info.kind, a: p, b: p };
  } else {
    S.drag = { group: info.group, zone: info.zone, areaKind: info.areaKind, i0: hit.i, j0: hit.j, i1: hit.i, j1: hit.j };
  }
  updateGhostsForDrag();
}

function updateDrag(hit) {
  if (!S.drag) return;
  if (S.drag.group === 'road') S.drag.b = snapRoadPoint(S.ctx, hit.x, hit.z);
  else { S.drag.i1 = hit.i; S.drag.j1 = hit.j; }
  updateGhostsForDrag();
}

/** True if the zoning module's own (nicer, pulsing) preview plate was used, so the caller should keep our
 * generic rect ghost hidden instead of drawing a redundant second overlay on top of it. */
function tryZoningPreview(ctx, i0, j0, i1, j1, zone) {
  const z = zoningApi(ctx);
  if (!z?.showPreview) return false;
  const ok = safeCall(() => { z.showPreview(i0, j0, i1 - i0 + 1, j1 - j0 + 1, zone); return true; }, false);
  if (ok) { S.ghosts.ribbon.visible = false; S.ghosts.rect.visible = false; S.ghosts.point.visible = false; }
  return ok;
}

function updateGhostsForDrag() {
  const ctx = S.ctx, d = S.drag;
  if (!d) return;
  if (d.group === 'road') {
    const g = roadGhostGeom(ctx, d.kind, d.a, d.b);
    applyRibbon(g);
    uiApi(ctx)?.setStatus?.(`${ROAD_LABEL[d.kind] || d.kind}: ${Math.round(g.length)} m, $${g.cost.toLocaleString()}`);
    return;
  }
  const { i0, j0, i1, j1 } = normRect(d);
  const count = rectCellCount(ctx.world, i0, j0, i1, j1);
  if (d.group === 'zone' && d.zone) {
    if (!tryZoningPreview(ctx, i0, j0, i1, j1, d.zone)) applyRect(rectBounds(ctx, i0, j0, i1, j1), zoneColorFor(d.zone));
    const preview = safeCall(() => zoningApi(ctx)?.costFor?.(i0, j0, i1, j1, d.zone, 1));
    const costTxt = preview ? `, $${preview.cost.toLocaleString()}` : '';
    uiApi(ctx)?.setStatus?.(`${ZONE_LABEL[d.zone]}: ${count} cell${count === 1 ? '' : 's'}${costTxt}`);
    return;
  }
  const color = d.group === 'bulldoze' ? 'transRed' : d.group === 'zone' ? 'transRed' /* dezone */ : 'lime';
  applyRect(rectBounds(ctx, i0, j0, i1, j1), color);
  const label = d.group === 'zone' ? 'Dezone' : d.group === 'area' ? AREA_LABEL[d.areaKind] : 'Bulldoze';
  uiApi(ctx)?.setStatus?.(`${label}: ${count} cell${count === 1 ? '' : 's'}`);
}

function updateHoverGhost(hit) {
  const ctx = S.ctx;
  const info = toolKindOf(S.tool);
  if (!info || info.group === 'select') { hideGhosts(); return; }
  if (info.group === 'road') {
    const p = snapRoadPoint(ctx, hit.x, hit.z);
    applyPoint({ x: p.x, z: p.z }, 'lime');
    return;
  }
  if (info.group === 'zone' && info.zone) {
    if (!tryZoningPreview(ctx, hit.i, hit.j, hit.i, hit.j, info.zone)) applyRect(rectBounds(ctx, hit.i, hit.j, hit.i, hit.j), zoneColorFor(info.zone));
    return;
  }
  const color = info.group === 'bulldoze' ? 'transRed' : info.group === 'zone' ? 'transRed' : 'lime';
  applyRect(rectBounds(ctx, hit.i, hit.j, hit.i, hit.j), color);
}

function cancelDrag() {
  if (!S.drag) return;
  S.drag = null;
  hideGhosts();
  if (S.ctx.controls) S.ctx.controls.enabled = true;
  releasePointerCapture();
}

function releasePointerCapture() {
  if (S.pointerId != null) { try { S.ctx.renderer.domElement.releasePointerCapture?.(S.pointerId); } catch (_) { /* ignore */ } S.pointerId = null; }
}

function finishDrag() {
  const d = S.drag;
  S.drag = null;
  hideGhosts();
  if (!d) return;
  if (d.group === 'road') finishRoad(d);
  else if (d.group === 'zone') finishZone(d);
  else if (d.group === 'area') finishArea(d);
  else if (d.group === 'bulldoze') finishBulldoze(d);
}

function finishRoad(d) {
  const ctx = S.ctx;
  const { a, b, kind } = d;
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  if (length < MIN_ROAD_LEN) return; // a tap, not a drag: silent no-op
  if (!roadPathBuildable(ctx, a, b)) { fail('Cannot build there — blocked by water', a); return; }
  const cost = Math.round(length * (PRICE_PER_M[kind] ?? 100));
  if (currentMoney(ctx) < cost) { fail(`Insufficient funds — need $${cost.toLocaleString()}`, a); return; }
  let edgeId;
  try { edgeId = ctx.world.addRoad({ x: a.x, z: a.z }, { x: b.x, z: b.z }, kind); }
  catch (e) { ctx.error('[tools] addRoad failed:', e); fail('Road placement failed', a); return; }
  if (!edgeId) { fail('Road placement failed', a); return; }
  spendMoney(ctx, cost);
  const props = ctx.modules.get('props');
  if (props?.status === 'ok') { try { props.api?.populateAlongRoad?.(edgeId); } catch (e) { ctx.error('[tools] props.populateAlongRoad failed:', e); } }
  notify(`${ROAD_LABEL[kind] || kind} built: ${Math.round(length)} m, $${cost.toLocaleString()}`, 'success');
  // world.addRoad emits 'road:added', which the audio module already listens to and plays 'road' for — no
  // explicit ctx.modules.get('audio').api.play('road', ...) here, to avoid an audible double-trigger.
}

function finishZone(d) {
  const ctx = S.ctx;
  const { i0, j0, i1, j1 } = normRect(d);
  const zoning = zoningApi(ctx);

  if (!d.zone) { // dezone: no cost, no funds check
    let cells = 0;
    if (zoning?.clearZone) cells = safeCall(() => zoning.clearZone(i0, j0, i1, j1), 0) ?? 0;
    else for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const c = ctx.world.cellAt(i, j); if (c?.zone) { ctx.world.setZone(i, j, null); cells++; } }
    if (cells > 0) {
      notify(`Dezoned: ${cells} cell${cells === 1 ? '' : 's'}`, 'success');
      // world.setZone(...,null) emits zone:changed with a falsy zone, which audio's own listener ignores
      // (`if (zone) play('zone')`) — play it ourselves so dezoning still gets feedback.
      const audio = ctx.modules.get('audio');
      if (audio?.status === 'ok') { try { audio.api?.play?.('zone'); } catch (_) { /* ignore */ } }
    } else fail('Nothing to zone here');
    return;
  }

  if (zoning?.setZoneRect) {
    const preview = safeCall(() => zoning.costFor?.(i0, j0, i1, j1, d.zone, 1)) || { cost: 0 };
    if (currentMoney(ctx) < preview.cost) { fail(`Insufficient funds — need $${preview.cost.toLocaleString()}`); return; }
    const res = safeCall(() => zoning.setZoneRect(i0, j0, i1, j1, d.zone, 1)) || { cells: 0, cost: 0 };
    if (res.cells > 0) {
      spendMoney(ctx, res.cost);
      notify(`${ZONE_LABEL[d.zone]}: ${res.cells} cell${res.cells === 1 ? '' : 's'}, $${res.cost.toLocaleString()}`, 'success');
    } else fail('Nothing to zone here');
    return;
  }
  // zoning module absent: bare fallback straight on world.setZone, no cost model
  let count = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = ctx.world.cellAt(i, j);
    if (!c || c.type === 'road' || c.type === 'water') continue;
    ctx.world.setZone(i, j, d.zone, 1);
    count++;
  }
  if (count > 0) notify(`${ZONE_LABEL[d.zone]}: ${count} cell${count === 1 ? '' : 's'}`, 'success');
  else fail('Nothing to zone here');
}

function finishArea(d) {
  const ctx = S.ctx;
  const { i0, j0, i1, j1 } = normRect(d);
  const cells = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = ctx.world.cellAt(i, j);
    if (!c || c.type === 'road' || c.type === 'building' || !cellBuildable(ctx, i, j)) continue;
    ctx.world.setCell(i, j, { type: 'park', zone: null, density: 0, parkKind: d.areaKind });
    cells.push({ i, j });
  }
  if (cells.length) {
    notify(`${AREA_LABEL[d.areaKind]}: ${cells.length} cell${cells.length === 1 ? '' : 's'}`, 'success');
    const props = ctx.modules.get('props');
    if (props?.status === 'ok') { try { props.api?.populatePark?.(cells, { kind: d.areaKind }); } catch (e) { ctx.error('[tools] props.populatePark failed:', e); } }
    const audio = ctx.modules.get('audio');
    if (audio?.status === 'ok') { try { audio.api?.play?.('zone'); } catch (_) { /* ignore */ } }
  } else fail('Nothing to place here');
}

function finishBulldoze(d) {
  const ctx = S.ctx, world = ctx.world;
  const { i0, j0, i1, j1 } = normRect(d);
  const buildingIds = new Set(), roadIds = new Set();
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = world.cellAt(i, j);
    if (!c) continue;
    if (c.buildingId) buildingIds.add(c.buildingId);
    else if (c.roadId) roadIds.add(c.roadId);
  }
  let removed = 0;
  for (const id of buildingIds) { try { if (world.removeBuilding(id)) removed++; } catch (e) { ctx.error('[tools] removeBuilding failed:', e); } }
  // world.removeRoad on an edge whose nodes vanish is patched defensively by roads/index.js's guardRemoveRoad
  // (a hard dep of this module, so it is always installed before tools can run) — see docs/core-requests/roads.md.
  for (const id of roadIds) { try { if (world.removeRoad(id)) removed++; } catch (e) { ctx.error('[tools] removeRoad failed:', e); } }
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = world.cellAt(i, j);
    if (!c) continue;
    if (c.zone) { world.setZone(i, j, null); removed++; }
    else if (c.type === 'park') { world.setCell(i, j, { type: 'none', parkKind: null }); removed++; }
  }
  if (removed > 0) {
    const parts = [];
    if (buildingIds.size) parts.push(`${buildingIds.size} building${buildingIds.size === 1 ? '' : 's'}`);
    if (roadIds.size) parts.push(`${roadIds.size} road${roadIds.size === 1 ? '' : 's'}`);
    notify(`Bulldozed: ${parts.length ? parts.join(', ') : `${removed} cell${removed === 1 ? '' : 's'}`}`, 'success');
    if (buildingIds.size === 0) {
      // 'building:removed' already auto-plays 'bulldoze' via audio's own listener; only cover road/zone/park-only
      // clears explicitly here (no other event fires for those).
      const audio = ctx.modules.get('audio');
      if (audio?.status === 'ok') { try { audio.api?.play?.('bulldoze'); } catch (_) { /* ignore */ } }
    }
  } else fail('Nothing to bulldoze here');
}

// ---- select/inspect ------------------------------------------------------------------------------------

function handleClick(e) {
  if (S.tool !== 'select') return;
  const ctx = S.ctx;
  const hit = screenToHit(ctx, e.clientX, e.clientY);
  const api = uiApi(ctx);
  if (!hit) { api?.setInfoPanel?.(null); return; }
  const buildingId = hit.buildingId || pickBuildingId(ctx, hit.x, hit.z, hit.i, hit.j);
  const b = buildingId ? ctx.world.buildings.get(buildingId) : null;
  api?.setInfoPanel?.(b ? buildingInfoHtml(b) : null);
}

// ---- pointer plumbing ------------------------------------------------------------------------------------

function screenToHit(ctx, clientX, clientY) {
  const rect = ctx.renderer.domElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
  const ny = -(((clientY - rect.top) / rect.height) * 2 - 1);
  S.raycaster.setFromCamera({ x: nx, y: ny }, ctx.camera);
  const hit = ctx.world.raycastScene(S.raycaster.ray, 6000, groundHeightFn(ctx));
  if (!hit) return null;
  const { i, j } = ctx.world.worldToCell(hit.point.x, hit.point.z);
  return { x: hit.point.x, y: hit.point.y, z: hit.point.z, i, j, buildingId: hit.buildingId };
}

function onPointerDown(e) {
  const ctx = S.ctx;
  S.pointer.lastClient = { x: e.clientX, y: e.clientY };
  if (e.button === 2) { if (S.drag) cancelDrag(); return; } // right click: cancel in-progress gesture only
  if (e.button !== 0) return;
  const info = toolKindOf(S.tool);
  if (!info || info.group === 'select') { S.clickStart = { x: e.clientX, y: e.clientY }; return; }
  const hit = screenToHit(ctx, e.clientX, e.clientY);
  if (!hit) return;
  if (ctx.controls) ctx.controls.enabled = false; // suspend MapControls' left-drag pan while paint-dragging
  S.pointerId = e.pointerId;
  try { ctx.renderer.domElement.setPointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
  startDrag(hit);
}

function onPointerMove(e) {
  const ctx = S.ctx;
  S.pointer.lastClient = { x: e.clientX, y: e.clientY };
  S.pointer.over = true;
  if (S.drag) { const hit = screenToHit(ctx, e.clientX, e.clientY); if (hit) updateDrag(hit); return; }
  if (!S.tool) { hideGhosts(); return; }
  const hit = screenToHit(ctx, e.clientX, e.clientY);
  if (hit) updateHoverGhost(hit); else hideGhosts();
}

function onPointerUp(e) {
  if (e.button === 2) return;
  const ctx = S.ctx;
  if (S.drag) {
    finishDrag();
    if (ctx.controls) ctx.controls.enabled = true;
    releasePointerCapture();
    return;
  }
  if (S.clickStart) {
    const dx = e.clientX - S.clickStart.x, dy = e.clientY - S.clickStart.y;
    S.clickStart = null;
    if (Math.hypot(dx, dy) < 6) handleClick(e);
  }
}

function onPointerLeave() { S.pointer.over = false; if (!S.drag) hideGhosts(); }

function onToolSelected(p) {
  const next = p?.tool ?? null;
  if (S.tool === next) return;
  if (S.drag) cancelDrag();
  S.tool = next;
  hideGhosts();
}

function onKeyDown(e) {
  if (e.code === 'Escape' && S.drag) cancelDrag(); // own listener: works even if `ui` failed to load
}

// ---- ghost mesh construction (a handful of reused meshes; recolour via cached ctx.materials.glass(...)) ----

function buildGhosts(ctx) {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
  const mk = (geo, name) => { const m = new THREE.Mesh(geo, ctx.materials.glass('lime')); m.name = name; m.visible = false; m.renderOrder = 10; m.castShadow = false; m.receiveShadow = false; return m; };
  return { ribbon: mk(boxGeo, 'tools-ghost-road'), rect: mk(boxGeo, 'tools-ghost-rect'), point: mk(cylGeo, 'tools-ghost-point'), boxGeo, cylGeo };
}

// ---- public api -------------------------------------------------------------------------------------------

const api = {
  getActiveTool: () => S.tool,
  cancel: () => cancelDrag(),
  getGhostState: () => ({
    tool: S.tool,
    dragging: !!S.drag,
    drag: S.drag ? { ...S.drag } : null,
    ribbonVisible: !!S.ghosts?.ribbon.visible,
    rectVisible: !!S.ghosts?.rect.visible,
    pointVisible: !!S.ghosts?.point.visible,
  }),
};

// Internal handles the showcase needs to drive the same state machine with synthetic input.
const internal = { startDrag, updateDrag, finishDrag, cancelDrag, rectBounds, setTool: (t) => { S.tool = t; } };

export default {
  id: 'tools',
  deps: ['terrain', 'roads', ...(ZONING_PRESENT ? ['zoning'] : [])],
  order: 70,
  api,
  showcaseVariants: ['default'],
  presets: {
    // 3/4 overview of the whole demo scene; the frozen live gesture (an uncommitted road drag, green ribbon) is
    // the dominant ghost visible from here alongside the two decorative ghosts and the bulldozed gap.
    'tools:default': (world) => ({ pos: [170, 130 + world.getHeight(20, 20), 190], target: [20, 10 + world.getHeight(20, 20), 30] }),
    'tools:closeup': (world) => ({ pos: [37, 22 + world.getHeight(37, 40), 88], target: [37, 3 + world.getHeight(37, 40), 40], fov: 42 }),
    // the live zoning-preview plate (a direct, uncommitted zoning.api.showPreview call — "mid zone-paint drag").
    'tools:zone': (world) => ({ pos: [110, 46 + world.getHeight(56, 71), 130], target: [56, 3 + world.getHeight(56, 71), 71] }),
    // the decorative red hover-to-bulldoze ghost ringing the still-standing demo building's base.
    'tools:bulldoze': (world) => ({ pos: [70, 16 + world.getHeight(70, -70), -22], target: [70, 4 + world.getHeight(70, -70), -70], fov: 44 }),
    // r2 verification preset: framed on the live road-drag ghost ribbon's near edge against bare grass, at the
    // range a player is actually watching mid-drag (r1 review flagged the old transGreen as reading
    // near-colourless at this exact range). core's MapControls has a hard minDistance=4 (src/core/camera.js,
    // not ours to change) that rescales any closer request up to ~4m along the same line of sight, so this
    // lands a touch further out than the true 2-3m verification (done separately, bypassing controls, for the
    // r2 report) but keeps the same steep, non-grazing angle so the ribbon-vs-grass edge is still legible rather
    // than lost behind foreground studs. Not part of the standard 4; confirms the 'lime' swap reads as a crisp
    // "buildable" signal up close, not the near-colourless wash r1 flagged.
    'tools:vclose': (world) => {
      const y = world.getHeight(15, 34); // ribbon's near (grass-side) edge — z=34, x=15 sit just inside it
      return { pos: [15, y + 2.84, 35.14], target: [15, y + 0.3, 34], fov: 42 };
    },
  },

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('tools');
    S.raycaster = new THREE.Raycaster();
    S.group = new THREE.Group();
    S.group.name = 'tools';
    ctx.scene.add(S.group);
    S.ghosts = buildGhosts(ctx);
    S.group.add(S.ghosts.ribbon, S.ghosts.rect, S.ghosts.point);

    const el = ctx.renderer.domElement;
    S.onPointerDown = onPointerDown; S.onPointerMove = onPointerMove; S.onPointerUp = onPointerUp; S.onPointerLeave = onPointerLeave; S.onKeyDown = onKeyDown;
    el.addEventListener('pointerdown', S.onPointerDown);
    el.addEventListener('pointermove', S.onPointerMove);
    window.addEventListener('pointerup', S.onPointerUp);
    el.addEventListener('pointerleave', S.onPointerLeave);
    window.addEventListener('keydown', S.onKeyDown);
    S.unsub.push(ctx.events.on('tool:selected', onToolSelected));
    S.unsub.push(ctx.events.on('time:changed', refreshGhostEmissiveForTime));
  },

  update(dt, ctx) {
    if (S.drag) return; // ghost already tracks pointermove/synthetic updateDrag() calls
    if (S.pointer.over && S.tool && S.pointer.lastClient) {
      const hit = screenToHit(ctx, S.pointer.lastClient.x, S.pointer.lastClient.y);
      if (hit) updateHoverGhost(hit); else hideGhosts();
    }
  },

  async showcase(ctx, variant = 'default') {
    S.showcaseExtra = stageShowcase(ctx, internal, S.showcaseExtra, S.group);
  },

  dispose(ctx) {
    const el = ctx.renderer.domElement;
    if (S.onPointerDown) el.removeEventListener('pointerdown', S.onPointerDown);
    if (S.onPointerMove) el.removeEventListener('pointermove', S.onPointerMove);
    if (S.onPointerUp) window.removeEventListener('pointerup', S.onPointerUp);
    if (S.onPointerLeave) el.removeEventListener('pointerleave', S.onPointerLeave);
    if (S.onKeyDown) window.removeEventListener('keydown', S.onKeyDown);
    for (const u of S.unsub) { try { u(); } catch (_) { /* ignore */ } }
    S.unsub.length = 0;
    if (S.showcaseExtra) { for (const g of S.showcaseExtra.geos) g.dispose(); if (S.showcaseExtra.group) S.group?.remove(S.showcaseExtra.group); S.showcaseExtra = null; }
    if (S.ghosts) { S.ghosts.boxGeo.dispose(); S.ghosts.cylGeo.dispose(); }
    if (S.group) ctx.scene.remove(S.group);
    Object.assign(S, {
      ctx: null, group: null, ghosts: null, tool: null, drag: null, pointerId: null, clickStart: null,
      pointer: { over: false, lastClient: null }, showcaseExtra: null, unsub: [],
      onPointerDown: null, onPointerMove: null, onPointerUp: null, onPointerLeave: null, onKeyDown: null,
    });
  },
};
