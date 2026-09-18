// Showcase staging for `tools`: a small demo scene plus a scripted sequence of real tool actions, driven through
// the exact same internal drag-start/drag-move/drag-end handlers the live pointer code uses (just fed synthetic
// world positions instead of DOM events). See the "Showcase freeze state" note at the bottom for what each of
// the four camera presets (tools:default/closeup/zone/bulldoze) actually looks at.
import * as THREE from 'three';

function flattenPatch(world) {
  const w = world.size.w, h = world.size.h, w1 = w + 1;
  const arr = new Float32Array(w1 * (h + 1));
  const R1 = 170, R2 = 220;
  for (let j = 0; j <= h; j++) {
    for (let i = 0; i <= w; i++) {
      const x = world.minX + i * world.cellSize, z = world.minZ + j * world.cellSize;
      const r = Math.hypot(x, z);
      const t = r <= R1 ? 1 : r >= R2 ? 0 : 1 - (r - R1) / (R2 - R1);
      const base = world.getVertexHeight(i, j);
      arr[j * w1 + i] = Math.round((1.6 * t + base * (1 - t)) / 0.4) * 0.4;
    }
  }
  world.setHeightField(arr);
}

function zoneRectDirect(world, x0, z0, x1, z1, zone) {
  const a = world.worldToCell(x0, z0), b = world.worldToCell(x1 - 0.01, z1 - 0.01);
  for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) { const c = world.cellAt(i, j); if (c && c.type !== 'road' && c.type !== 'water') world.setZone(i, j, zone, 1); }
}

/** Places a real logical building (world.addBuilding) plus a simple Lego-box placeholder mesh, since the
 * `buildings` module (which would normally render it) doesn't exist yet in this build. */
function placeDemoBuilding(ctx, extra, cx, cz, zone, color, level, height) {
  const world = ctx.world;
  const w = 2, d = 2, cs = world.cellSize;
  const corner = world.worldToCell(cx - (w * cs) / 2 + 0.01, cz - (d * cs) / 2 + 0.01);
  const id = world.addBuilding({ i: corner.i, j: corner.j, w, d, zone, level, height, kind: 'demo' });
  const geo = ctx.materials.bevelBox(w * cs - 1, height, d * cs - 1, 0.3).clone(); // clone: bevelBox() is a shared cache, .translate() below must not mutate it
  const y = world.getHeight(cx, cz);
  geo.translate(cx, y, cz);
  const mesh = new THREE.Mesh(geo, ctx.materials.plastic(color));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'tools-showcase-building';
  extra.group.add(mesh);
  extra.geos.push(geo);
  return { id, i: corner.i, j: corner.j, w, d, mesh, geo };
}

/** world.removeBuilding() only touches World data (cells/buildings map) — it has no idea this placeholder mesh
 * exists (nothing does; `buildings` isn't built yet), so bulldozing B1 needs an explicit visual removal too. */
function removeDemoBuildingMesh(extra, entry) {
  extra.group.remove(entry.mesh);
  entry.geo.dispose();
  const idx = extra.geos.indexOf(entry.geo);
  if (idx >= 0) extra.geos.splice(idx, 1);
}

// ARCHITECTURE.md §7: red/blue emissives need emissiveIntensity >= 4 to actually bloom at night; yellow/white
// read at 2.5-3 (measured r2: even 3 clips 'lime' — high R+G, low B, so its luminance-weighted contribution
// saturates much earlier than red's — to a blown-out white bar at midday, so it gets its own lower night value
// and a near-zero day value rather than sharing yellow/white's number). Exported so index.js's ghostMat() uses
// the exact same table (r1 review: both ghost-material call sites had hardcoded 0.35, ~10x too low to bloom at
// all).
// Day values are intentionally low/near-zero (r1 suggested gating on isNight): the r2 fix pushed daytime
// intensity up along with night's and every colour with a strong G channel (lime, transYellow) clipped straight
// to a blown-out white/yellow bar under midday sun + bloom, which is worse than the original "no glow" bug this
// exists to fix. At night the base scene is dark, so the same emissive reads as a clean glow instead.
export function ghostEmissiveIntensity(colorName, isNight) {
  if (!isNight) return colorName === 'lime' ? 0.15 : 0.3;
  if (colorName === 'transRed' || colorName === 'transBlue') return 4.5;
  if (colorName === 'lime') return 2;
  return 3; // transYellow, white
}

function addDecorativeRect(ctx, extra, bounds, colorName, name) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  // brighter/less-transparent than the plain glass() default so it reads clearly over grass, matching the live
  // ghost meshes in index.js's ghostMat(); emissiveIntensity from the shared table above so these decorative
  // ghosts bloom at night exactly like the live ones do.
  const mesh = new THREE.Mesh(geo, ctx.materials.glass(colorName, { opacity: 0.8, emissive: colorName, emissiveIntensity: ghostEmissiveIntensity(colorName, !!ctx.clock?.isNight) }));
  mesh.position.set(bounds.cx, bounds.y + 0.35, bounds.cz);
  mesh.scale.set(Math.max(bounds.w, 0.3), 0.5, Math.max(bounds.d, 0.3));
  mesh.name = name; mesh.renderOrder = 10;
  extra.group.add(mesh);
  extra.geos.push(geo);
}

/**
 * Stage the demo scene and run the scripted sequence. `handlers` is the real module's internal state-machine
 * ({ startDrag, updateDrag, finishDrag, setTool, rectBounds }) — the showcase drives it directly rather than
 * synthesizing DOM events, per the module brief.
 *
 * Showcase freeze state (variant 'default', the only variant):
 *   1. A ~340 m flat demo pad is stamped over whatever terrain generated, with a context road cross (a real
 *      avenue + street placed via ctx.world.addRoad — safe to call directly here because `roads` is a hard dep
 *      and its guardRemoveRoad patch on world.removeRoad is already installed) and a small context industrial
 *      zone patch.
 *   2. Two demo buildings are placed (B1 at (-70,-70), B2 at (70,-70)) as real World.buildings records with a
 *      hand-built Lego-box placeholder mesh each (the `buildings` module isn't built yet, so nothing else would
 *      render them).
 *   3. A real zone:r paint (startDrag→updateDrag→finishDrag, driving finishZone -> zoning.api.setZoneRect) is
 *      committed over a rectangle near (-67,75) — since `zoning` renders committed cells itself as translucent
 *      colour plates, that cluster in the wide shot is a real, live-rendered result, not a decoration. A second,
 *      separate site near (56,71) gets a genuine *uncommitted* preview via a direct zoning.api.showPreview(...)
 *      call (zone 'i', which zoning's own single-plate preview mesh renders as a dark teal/olive, not the
 *      orange its committed cells use — 'r' renders as the same brightGreen as the grass and would be nearly
 *      invisible)
 *      — zoning owns and persists that plate mesh itself, independently of this module's single-active-drag
 *      state, so it stays "mid zone-paint drag" without needing a second live gesture — this is the tools:zone
 *      preset's target. (Falls back to our own generic amber rect ghost if `zoning` isn't loaded.)
 *   4. B1 is really bulldozed (startDrag→finishDrag on the bulldoze path — a genuine world.removeBuilding call,
 *      leaving a visible empty lot). B2 is left standing with a translucent red ghost box padded a cell beyond
 *      its footprint, representing what hovering the bulldoze tool over it would show — the tools:bulldoze
 *      preset's target.
 *   5. The module is left with a LIVE, uncommitted road:street drag (from (0,40) to (75,40), clear of the zoning
 *      preview rectangle so both read independently in the wide shot): S.tool is 'road:street' and S.drag is
 *      active, so the real green/red ghost ribbon mesh (the same one driven by onPointerMove in normal play) is
 *      what's on screen — the tools:default / tools:closeup presets' target.
 * Only one gesture can be "live" in this module's own single-active-tool state machine at once (by design —
 * matching actual gameplay), so the bulldoze-hover box is a static decoration built with the same rect math as
 * the live ghost, not the live ghost mesh itself, and the zone-preview trick above only works because `zoning`
 * happens to own its own persistent preview mesh; the road drag left at the end **is** this module's real live
 * gesture, exercised through the exact same handlers a mouse drag would call.
 */
export function stageShowcase(ctx, handlers, prevExtra, group) {
  if (prevExtra) { for (const g of prevExtra.geos) g.dispose(); if (prevExtra.group) group.remove(prevExtra.group); }
  const extra = { group: new THREE.Group(), geos: [] };
  extra.group.name = 'tools-showcase';
  group.add(extra.group);

  const world = ctx.world;
  flattenPatch(world);

  world.addRoad({ x: -150, z: 0 }, { x: 150, z: 0 }, 'street');
  world.addRoad({ x: 0, z: -150 }, { x: 0, z: 150 }, 'avenue');
  zoneRectDirect(world, 110, 110, 140, 140, 'i');

  const b1 = placeDemoBuilding(ctx, extra, -70, -70, 'r', 'brightRed', 2, 12);
  const b2 = placeDemoBuilding(ctx, extra, 70, -70, 'c', 'mediumAzur', 3, 18);

  // 3) real zone-paint commit at site Z (drives finishZone -> zoning.api.setZoneRect for real): the `zoning`
  // module now exists and renders committed zone cells itself as translucent colour plates, so no decoration
  // is needed here — the plate cluster you see at this site in the wide shot IS the real result.
  const z0 = world.worldToCell(-90, 55), z1 = world.worldToCell(-45, 95);
  handlers.setTool('zone:r');
  handlers.startDrag({ i: z0.i, j: z0.j });
  handlers.updateDrag({ i: z1.i, j: z1.j });
  handlers.finishDrag();

  // 4) real bulldoze of B1; B2 kept standing with a decorative red hover-ghost
  handlers.setTool('bulldoze');
  handlers.startDrag({ i: b1.i, j: b1.j });
  handlers.finishDrag();
  removeDemoBuildingMesh(extra, b1);
  // padded 1 cell beyond B2's footprint on every side so the red ring reads clearly around its base instead of
  // hiding under it.
  addDecorativeRect(ctx, extra, handlers.rectBounds(world, b2.i - 1, b2.j - 1, b2.i + b2.w, b2.j + b2.d), 'transRed', 'tools-showcase-bulldoze-ghost');

  // A second, separate site gets a genuine *uncommitted* zoning preview: call the real zoning.api.showPreview
  // directly (it owns and persists its own preview mesh independently of this module's single-active-drag
  // state) so the tools:zone preset shows the authentic "mid zone-paint drag" plate, not a fake stand-in box.
  // Falls back to our own generic blue rect ghost if `zoning` isn't loaded. Deliberately done LAST, after every
  // finishDrag() above: finishDrag()/cancelDrag() route through this module's own hideGhosts(), which also calls
  // zoning.api.hidePreview() as a safety net in real play (so a stray preview never lingers after a tool
  // switch) — calling showPreview() any earlier here would just get hidden again by the next finishDrag().
  // 'i' (zoning's preview plate renders it dark teal/olive — its own colour, distinct from committed cells'
  // orange), not 'r' (which zoning renders as the same brightGreen as the grass it sits on, and would be
  // nearly invisible here) — the real zone:r proof-of-pipeline commit above already covers residential.
  const z2 = world.worldToCell(40, 55);
  const zoning = ctx.modules.get('zoning');
  let zonedPreview = false;
  if (zoning?.status === 'ok' && typeof zoning.api?.showPreview === 'function') {
    try { zoning.api.showPreview(z2.i, z2.j, 4, 4, 'i'); zonedPreview = true; } catch (_) { /* fall through */ }
  }
  if (!zonedPreview) addDecorativeRect(ctx, extra, handlers.rectBounds(world, z2.i, z2.j, z2.i + 3, z2.j + 3), 'transYellow', 'tools-showcase-zone-ghost');

  // 5) final live, uncommitted gesture: a road:street drag left mid-air (z=40, clear of the zoning preview
  // rectangle above so both read independently in the wide tools:default shot)
  handlers.setTool('road:street');
  handlers.startDrag({ x: 0, z: 40, i: world.worldToCell(0, 40).i, j: world.worldToCell(0, 40).j });
  handlers.updateDrag({ x: 75, z: 40, i: world.worldToCell(75, 40).i, j: world.worldToCell(75, 40).j });
  // deliberately not calling finishDrag(): this is the frozen state the screenshot captures.

  if (ctx.controls) ctx.controls.enabled = true;
  return extra;
}
