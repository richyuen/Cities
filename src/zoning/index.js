// zoning - renders the zoned-but-unbuilt state of world.cells (type:'zone') as translucent colour-coded plates,
// and owns the zone-painting API that `tools` drives (rect/brush paint, cost preview, hover ghost).
import * as THREE from 'three';
import { buildPlateGeometry, PLATE_H, PLATE_Y0, ZONE_COLOR, ZONE_EDGE_GLOW, DENSITY_SCALE, DENSITY_BRIGHT, clampDensity } from './geometry.js';
import { stageDefault, stageDensity } from './showcase.js';

const ZONES = ['r', 'c', 'i'];
const ZONE_BASE_COST = { r: 60, c: 95, i: 78 }; // $ per cell at density 1, simple linear-in-density formula
// Base opacity/transmission per zone colour, plus the actual colour fed to the material. Industrial's official
// brightOrange (#F58624) desaturated to a muddy yellow-olive in daylight (r1 review): low opacity + transmission
// let the green grass bleed through and pull the blended hue toward yellow-green, and even a firmer glass mix
// alone (opacity 0.5, transmission 0.03) still reads as sandy tan rather than orange next to grass. r/c read
// fine at the original 0.34/0.1 + their official hex, so only 'i' gets both a less-transmissive glass mix AND a
// warmer/redder input hue (still an "orange", just biased off F58624 toward red instead of yellow) so what
// survives the grass blend still reads as orange instead of tan/olive.
const ZONE_OPACITY = { r: 0.34, c: 0.34, i: 0.5 };
const ZONE_TRANSMISSION = { r: 0.1, c: 0.1, i: 0.03 };
const ZONE_MATERIAL_COLOR = { r: ZONE_COLOR.r, c: ZONE_COLOR.c, i: '#F2560A' };
const PULSE_SPEED = 0.55;   // rad/s, driven by ctx.clock.elapsed (freezes when the clock is paused, e.g. for shots)
const PULSE_AMP = 0.045;    // subtle breathing, not a flashing UI marker
// r1 review: at night the flat, per-material emissiveIntensity below washed out the density/rim cue (every cell
// read as one uniform solid-glow pad). NIGHT_GLOW is now multiplied, per-fragment, by the same vColor factor
// that already carries the bright-rim/dim-top vertex shading and the per-instance DENSITY_BRIGHT colour (see the
// onBeforeCompile hook below) - so taller/denser cells and rim faces glow visibly brighter than short/top faces
// at night too, not just in daylight diffuse. Lowered from 0.85 because that multiplier can now push the
// brightest rim faces well above 1x; a touch of extra opacity/transmission at night (below) keeps the "ghost"
// translucency reading instead of a solid poured pad.
const NIGHT_GLOW = 0.55;     // emissiveIntensity at full night (isNight); 0 in daylight
const NIGHT_OPACITY_BOOST = 0.08;
const NIGHT_TRANSMISSION_BOOST = 0.1;
const DIRTY_DEBOUNCE = 0.12; // seconds; batches bursts of world:cell/zone:changed into one rebuild

/** Injected once per zone material: multiplies the emissive term by vColor.rgb, the same combined
 *  vertex-colour x instance-colour factor the standard shader already uses for the diffuse rim/density cue
 *  (color_fragment does `diffuseColor *= vColor` where vColor.rgb = vertex colour * instanceColor, vColor is
 *  always vec4 in this three.js version regardless of vertex alpha). Guarded by the same defines so it's a
 *  no-op (and still compiles) on the non-instanced preview mesh, which has no vertex colour attribute of its
 *  own. */
function addEmissiveDensityCoupling(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	totalEmissiveRadiance *= vColor.rgb;
#endif`
    );
  };
}

let S = null; // module state (single instance)

// ---------------------------------------------------------------------------------------------
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function clampRect(i0, j0, i1, j1) {
  const { w, h } = S.ctx.world.size;
  if (i1 < i0) [i0, i1] = [i1, i0];
  if (j1 < j0) [j0, j1] = [j1, j0];
  return { i0: clamp(i0, 0, w - 1), j0: clamp(j0, 0, h - 1), i1: clamp(i1, 0, w - 1), j1: clamp(j1, 0, h - 1) };
}

/** Only bare land or already-zoned land may be (re)zoned - never road, water, park or a built cell. */
function cellZonable(c) { return !!c && (c.type === 'none' || c.type === 'zone'); }

function makeGroundFn(ctx) {
  const terr = ctx.modules.get('terrain');
  const surf = terr?.status === 'ok' && typeof terr.api?.surfaceHeight === 'function' ? terr.api.surfaceHeight : null;
  return surf || ((x, z) => ctx.world.getHeight(x, z));
}

function markDirty() { if (S) { S.dirty = true; S.dirtyTimer = DIRTY_DEBOUNCE; } }

/** Live { r: {cells, cellsBuilt}, c: {...}, i: {...} } computed straight from world.cells - cheap (one pass over
 *  the whole grid) and never stale, unlike the debounced visual rebuild below. */
function computeStats() {
  const stats = { r: { cells: 0, cellsBuilt: 0 }, c: { cells: 0, cellsBuilt: 0 }, i: { cells: 0, cellsBuilt: 0 } };
  for (const cell of S.ctx.world.cells) {
    const z = cell.zone;
    if (!z || !stats[z]) continue;
    stats[z].cells++;
    if (cell.type === 'building') stats[z].cellsBuilt++;
  }
  return stats;
}

/** Full rescan of world.cells: rebuilds the 3 per-zone InstancedMeshes (debounced - see markDirty/update). */
function rescan() {
  const world = S.ctx.world;
  const buckets = { r: [], c: [], i: [] };
  for (const cell of world.cells) {
    if (cell.zone && cell.type === 'zone') buckets[cell.zone].push(cell);
  }
  for (const zone of ZONES) buildInstancedForZone(zone, buckets[zone]);
}

const _m = new THREE.Matrix4(), _pos = new THREE.Vector3(), _scale = new THREE.Vector3(1, 1, 1), _quat = new THREE.Quaternion();
const _col = new THREE.Color();

function buildInstancedForZone(zone, cells) {
  const world = S.ctx.world;
  const old = S.meshes[zone];
  if (old) S.group.remove(old); // geometry/material are shared - only the InstancedMesh itself goes away
  if (!cells.length) { S.meshes[zone] = null; return; }
  const mesh = new THREE.InstancedMesh(S.plateGeo, S.materials[zone], cells.length);
  mesh.name = `zoning-${zone}`;
  mesh.castShadow = false;   // a translucent UI-ish overlay, not a real shadow-casting object
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  for (let k = 0; k < cells.length; k++) {
    const cell = cells[k];
    const { x, z } = world.cellToWorld(cell.i, cell.j);
    const y = S.groundFn(x, z);
    const dens = clampDensity(cell.density);
    _pos.set(x, y + PLATE_Y0, z);
    _scale.set(1, DENSITY_SCALE[dens], 1);
    _m.compose(_pos, _quat, _scale);
    mesh.setMatrixAt(k, _m);
    const b = DENSITY_BRIGHT[dens];
    mesh.setColorAt(k, _col.setRGB(b, b, b));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  S.group.add(mesh);
  S.meshes[zone] = mesh;
}

function onToolSelected({ tool } = {}) {
  if (!S) return;
  const isZoneTool = typeof tool === 'string' && tool.startsWith('zone:');
  const z = isZoneTool ? tool.slice(5) : null;
  S.activeZoneTool = z && z !== 'none' ? z : null;
  if (!S.activeZoneTool) api.hidePreview();
}

function ensurePreviewMesh() {
  if (S.preview) return S.preview;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0); // bottom at local y=0, like the plate geometry
  const mesh = new THREE.Mesh(geo, S.materials.r);
  mesh.name = 'zoning-preview';
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 10;
  S.group.add(mesh);
  S.preview = mesh;
  return mesh;
}

// ---------------------------------------------------------------------------------------------
const api = {
  /**
   * Bulk-paint a rectangle [i0..i1] x [j0..j1] (corners in any order) to `zone` ('r'|'c'|'i') at `density` (1-3).
   * Skips road/water/park/already-built cells; only bare or already-zoned land is (re)painted.
   * Returns { cells, cost }: number of cells actually changed and the $ cost for the paint (see costFor).
   */
  setZoneRect(i0, j0, i1, j1, zone, density = 1) {
    if (!S) return { cells: 0, cost: 0 };
    const world = S.ctx.world;
    const r = clampRect(i0, j0, i1, j1);
    const perCell = (ZONE_BASE_COST[zone] || 60) * clampDensity(density);
    let cells = 0;
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        if (!cellZonable(world.cellAt(i, j))) continue;
        world.setZone(i, j, zone, density);
        cells++;
      }
    }
    return { cells, cost: cells * perCell };
  },

  /** Freeform paint over an explicit cell list [{i,j}, ...] (e.g. a brush stroke). Same rules as setZoneRect. */
  setZoneBrush(cells, zone, density = 1) {
    if (!S) return { cells: 0, cost: 0 };
    const world = S.ctx.world;
    const perCell = (ZONE_BASE_COST[zone] || 60) * clampDensity(density);
    let n = 0;
    for (const { i, j } of cells) {
      if (!cellZonable(world.cellAt(i, j))) continue;
      world.setZone(i, j, zone, density);
      n++;
    }
    return { cells: n, cost: n * perCell };
  },

  /** Un-zone every currently-zoned-but-unbuilt cell in the rectangle. Built cells are left alone. Returns count. */
  clearZone(i0, j0, i1, j1) {
    if (!S) return 0;
    const world = S.ctx.world;
    const r = clampRect(i0, j0, i1, j1);
    let n = 0;
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const c = world.cellAt(i, j);
        if (!c || c.type !== 'zone') continue;
        world.setZone(i, j, null, 0);
        n++;
      }
    }
    return n;
  },

  /**
   * Preview cost for painting a rectangle with `zone`/`density` WITHOUT committing anything - for the tools/ui
   * cost-preview HUD before the player releases the mouse. { cells, cost }; cells is how many would actually
   * change (road/water/park/built cells are excluded, same as setZoneRect).
   */
  costFor(i0, j0, i1, j1, zone = 'r', density = 1) {
    if (!S) return { cells: 0, cost: 0 };
    const world = S.ctx.world;
    const r = clampRect(i0, j0, i1, j1);
    let cells = 0;
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) if (cellZonable(world.cellAt(i, j))) cells++;
    const perCell = (ZONE_BASE_COST[zone] || 60) * clampDensity(density);
    return { cells, cost: cells * perCell };
  },

  /** { r: {cells, cellsBuilt}, c: {...}, i: {...} } - cells = total zoned cells (built or not) per zone type.
   *  Computed live from world.cells every call (cheap - one pass), so it is never stale even the instant after
   *  a setZoneRect/clearZone/setZoneBrush call, unlike the visual rebuild which is debounced. */
  getZoneStats() { return S ? computeStats() : { r: { cells: 0, cellsBuilt: 0 }, c: { cells: 0, cellsBuilt: 0 }, i: { cells: 0, cellsBuilt: 0 } }; },

  /** Show/move the single hover-ghost plate over an i,j..i+w-1,j+h-1 footprint, tinted by `zone`. `tools` calls
   *  this every frame the cursor is over the map while a zone tool is active; no raycasting happens in here. */
  showPreview(i, j, w = 1, h = 1, zone = 'r') {
    if (!S) return;
    const mesh = ensurePreviewMesh();
    mesh.material = S.materials[zone] || S.materials.r;
    const world = S.ctx.world, cs = world.cellSize;
    w = Math.max(1, w | 0); h = Math.max(1, h | 0);
    const a = world.cellToWorld(i, j), b = world.cellToWorld(i + w - 1, j + h - 1);
    const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
    mesh.position.set(cx, S.groundFn(cx, cz) + PLATE_Y0, cz);
    mesh.scale.set(w * cs - 0.3, PLATE_H * 1.6, h * cs - 0.3);
    mesh.visible = true;
  },

  hidePreview() { if (S?.preview) S.preview.visible = false; },
};

// ---------------------------------------------------------------------------------------------
export default {
  id: 'zoning',
  deps: ['terrain', 'roads'],
  order: 35,
  api,
  showcaseVariants: ['default', 'density'],
  presets: {
    // 3/4 aerial over the whole zoned demo grid
    'zoning:default': () => {
      const f = S?.focus || { x: 0, z: 0, r: 110 };
      const gy = S ? S.groundFn(f.x, f.z) : 0;
      return { pos: [f.x + f.r * 0.55, gy + f.r * 0.62 + 6, f.z + f.r * 0.85], target: [f.x, gy + 3, f.z], fov: 48 };
    },
    // low-ish angle on a high-density industrial block (orange reads clearly against the green grass): plate
    // thickness, breathing opacity and the brighter/taller rim are all visible at this distance
    'zoning:closeup': () => {
      const h = S?.hot || { x: 12, z: 14 };
      const gy = S ? S.groundFn(h.x, h.z) : 0;
      return { pos: [h.x + 15, gy + 9, h.z + 17], target: [h.x, gy + 0.8, h.z], fov: 42 };
    },
  },

  async init(ctx) {
    S = {
      ctx, rng: ctx.rng.fork('zoning'), unsub: [], meshes: { r: null, c: null, i: null },
      dirty: false, dirtyTimer: 0, activeZoneTool: null, preview: null, demoGroup: null, demoMeshes: [],
      focus: { x: 0, z: 0, r: 110 }, hot: { x: 12, z: 14 },
    };
    S.group = new THREE.Group();
    S.group.name = 'zoning';
    ctx.scene.add(S.group);
    S.groundFn = makeGroundFn(ctx);
    S.plateGeo = buildPlateGeometry(ctx.world.cellSize);

    S.materials = {};
    for (const zone of ZONES) {
      const mat = ctx.materials.glass(ZONE_MATERIAL_COLOR[zone], {
        opacity: ZONE_OPACITY[zone], roughness: 0.32, transmission: ZONE_TRANSMISSION[zone],
        emissive: ZONE_EDGE_GLOW[zone], emissiveIntensity: 0,
      }).clone();
      mat.vertexColors = true;   // bakes the bright-rim/dim-top shading from the shared plate geometry
      mat.clearcoat = 0.18;
      mat.clearcoatRoughness = 0.4;
      mat.name = `zoning:${zone}`;
      mat.userData.baseOpacity = ZONE_OPACITY[zone];
      mat.userData.baseTransmission = ZONE_TRANSMISSION[zone];
      addEmissiveDensityCoupling(mat);
      ctx.materials.cache.set(`zoning:${zone}`, mat); // so environment.setEnvIntensity() reaches these too
      S.materials[zone] = mat;
    }

    S.unsub.push(ctx.events.on('zone:changed', markDirty));
    S.unsub.push(ctx.events.on('world:cell', markDirty));
    S.unsub.push(ctx.events.on('building:spawned', markDirty));
    S.unsub.push(ctx.events.on('building:removed', markDirty));
    S.unsub.push(ctx.events.on('tool:selected', onToolSelected));

    rescan();
    const st = computeStats();
    ctx.log(`[zoning] ready: r=${st.r.cells} c=${st.c.cells} i=${st.i.cells} cells zoned`);
  },

  update(dt, ctx) {
    if (!S) return;
    if (S.dirty) {
      S.dirtyTimer -= dt;
      if (S.dirtyTimer <= 0) { rescan(); S.dirty = false; }
    }
    const t = ctx.clock.elapsed; // real seconds, scaled by timeScale, frozen while paused -> deterministic shots
    const night = clamp(1 - ctx.clock.daylight, 0, 1);
    for (let k = 0; k < ZONES.length; k++) {
      const mat = S.materials[ZONES[k]];
      // a touch more opacity/transmission at night keeps the plates reading as translucent "ghost" glass
      // instead of a solid poured pad once the emissive term (below) lights them up.
      mat.opacity = mat.userData.baseOpacity + Math.sin(t * PULSE_SPEED + k * 2.09) * PULSE_AMP + night * NIGHT_OPACITY_BOOST;
      mat.transmission = mat.userData.baseTransmission + night * NIGHT_TRANSMISSION_BOOST;
      mat.emissiveIntensity = night * NIGHT_GLOW;
    }
  },

  dispose(ctx) {
    if (!S) return;
    for (const u of S.unsub) { try { u(); } catch (_) { /* ignore */ } }
    for (const zone of ZONES) {
      if (S.meshes[zone]) S.group.remove(S.meshes[zone]);
      ctx.materials.cache.delete(`zoning:${zone}`);
      S.materials[zone].dispose();
    }
    if (S.preview) { S.group.remove(S.preview); S.preview.geometry.dispose(); }
    // demoMeshes' geometry comes from ctx.materials.bevelBox() - a shared core cache we must not dispose (other
    // modules/showcases reuse the same cached geometry by dims); only the meshes themselves go away with S.group.
    S.plateGeo.dispose();
    ctx.scene.remove(S.group);
    S = null;
  },

  async showcase(ctx, variant = 'default') {
    if (!S) return;
    if (variant === 'density') stageDensity(ctx, S); else stageDefault(ctx, S);
    rescan();
  },
};
