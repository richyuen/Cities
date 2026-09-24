// terrain — the Blox baseplate landscape the city sits on: stepped plate terrain, studs, water.
import * as THREE from 'three';
import { TerrainData, PLATE, WATER_OFFSET, STUD_PITCH, quantize } from './data.js';
import { generateHeightField, variantParams, riverZ } from './heightgen.js';
import { buildChunkGeometry, buildWaterGeometry } from './mesher.js';
import { patchGroundMaterial, patchWaterMaterial, makeMaskTexture, makeHeightTexture } from './shaders.js';
import { StudManager } from './studs.js';

// 4x2 ground meshes: worst case 8 colour + 8 shadow + 2 stud + 1 stud shadow + 1 water = 20 draw calls (budget 20)
const CHUNKS_X = 4, CHUNKS_Z = 2;
const STUD_CHUNK_CELLS = 8;     // 64 m stud chunks: fine-grained radial selection around the camera
const MAX_STUDS = 40000;
const GROUND_ENV_MUL = 0.35;    // ground shows a third of the scene env-map sheen (keeps far greens saturated)
const MAP_VARIANT = { default: 'default', closeup: 'default', water: 'water' };

let S = null; // module state (single instance)

// ---------------------------------------------------------------------------------------------
// helpers
function clampRegion(i0, j0, i1, j1) {
  const { w, h } = S.ctx.world.size;
  if (i1 < i0) [i0, i1] = [i1, i0];
  if (j1 < j0) [j0, j1] = [j1, j0];
  return {
    i0: Math.max(0, Math.min(w - 1, i0)), j0: Math.max(0, Math.min(h - 1, j0)),
    i1: Math.max(0, Math.min(w - 1, i1)), j1: Math.max(0, Math.min(h - 1, j1)),
  };
}

/**
 * Flip cells between 'none' and 'water' to follow the height field. Each changed cell emits exactly one
 * `world:cell` (via world.setCell) so roads/zoning can react; our own listener ignores events while S.bulk is set
 * because the caller rebuilds the whole region afterwards anyway.
 */
function updateWaterTypes(i0, j0, i1, j1) {
  const world = S.ctx.world, data = S.data;
  ({ i0, j0, i1, j1 } = clampRegion(i0, j0, i1, j1));
  S.bulk = true;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const c = world.cells[j * data.w + i];
      const wet = data.avg(i, j) < -0.01;
      if (wet && c.type === 'none') { world.setCell(i, j, { type: 'water' }); S.waterCells.add(j * data.w + i); }
      else if (!wet && c.type === 'water') { world.setCell(i, j, { type: 'none' }); S.waterCells.delete(j * data.w + i); }
    }
  }
  S.bulk = false;
}

function updateStudMask(i0, j0, i1, j1) {
  const data = S.data, img = S.studMaskTex.image.data;
  ({ i0, j0, i1, j1 } = clampRegion(i0, j0, i1, j1));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) img[j * data.w + i] = data.studdable(i, j) ? 255 : 0;
  S.studMaskTex.needsUpdate = true;
}

function markChunksDirty(i0, j0, i1, j1) {
  ({ i0, j0, i1, j1 } = clampRegion(i0, j0, i1, j1));
  for (const ch of S.chunks) {
    if (ch.i1 < i0 || ch.i0 > i1 || ch.j1 < j0 || ch.j0 > j1) continue;
    S.dirty.add(ch);
  }
}

function rebuildChunk(ch) {
  const geo = buildChunkGeometry(S.data, ch.i0, ch.j0, ch.i1, ch.j1);
  if (ch.mesh.geometry) ch.mesh.geometry.dispose();
  ch.mesh.geometry = geo || new THREE.BufferGeometry();
  // every chunk casts shadows unconditionally: risers can be a single vertex-row tall (a shallow beach step still
  // has a wall), and a per-chunk height-range threshold here previously let some riser-bearing chunks silently
  // skip the shadow pass. The shadow-pass cost of a chunk with no risers is negligible (flat depth-only geometry).
  ch.mesh.castShadow = true;
  ch.mesh.visible = !!geo;
}

function rebuildWater() {
  const y = S.ctx.world.seaLevel + WATER_OFFSET;
  S.waterUniforms.uWaterY.value = y;
  const geo = buildWaterGeometry(S.data, y);
  if (S.water.geometry) S.water.geometry.dispose();
  S.water.geometry = geo || new THREE.BufferGeometry();
  S.water.visible = !!geo;
  S.heightTex.needsUpdate = true;
  S.waterDirty = false;
}

function flush() {
  if (!S) return;
  for (const ch of S.dirty) rebuildChunk(ch);
  S.dirty.clear();
  if (S.waterDirty) rebuildWater();
}

function onTerrainChanged({ region }) {
  if (!S || !region) return;
  const { i0, j0, i1, j1 } = region;
  updateWaterTypes(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  S.data.computeColors(i0 - 4, j0 - 4, i1 + 4, j1 + 4);
  updateStudMask(i0 - 4, j0 - 4, i1 + 4, j1 + 4);
  markChunksDirty(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  S.studs.invalidateRegion(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
  S.waterDirty = true;
}

function onCell({ i, j }) {
  if (!S || S.bulk) return;
  updateStudMask(i, j, i, j);
  S.studs.invalidateRegion(i, j, i, j);
  S.studDebounce = 0.25;
}

function generate(variant) {
  const world = S.ctx.world;
  // Pinned (fixed plateau/river/coast position) whenever the pre-built demo city will load — its road network
  // is hardcoded around downtown-at-origin (see demo/citygen.js) and can't follow a seed-varied plateau.
  const pinned = S.ctx.demoActive !== false;
  const { heights, params } = generateHeightField(world, S.rng, variant, pinned);
  world.seaLevel = 0;
  S.variant = variant;
  S.params = params;
  world.downtownCenter = { x: params.cx, z: params.cz };
  world.setHeightField(heights); // emits one terrain:changed -> onTerrainChanged sets water cells (world:cell each)
  flush();
  S.studs.invalidateAll();
}

// ---------------------------------------------------------------------------------------------
// camera preset helpers (evaluated at apply time, after the showcase is staged)
function closeupSpot() {
  const data = S.data;
  const z = 2.4; // on a stud row (multiple of 0.8)
  // stand east of downtown on the low side, looking west (along the stud rows) up the plateau terraces
  let xe = 420;
  for (let x = 640; x > 120; x -= 8) {
    if (data.surfaceH(x - 8, z) > data.surfaceH(x, z) + 1e-3) { xe = x; break; }
  }
  const px = xe + 13, tx = xe - 30;
  return { pos: [px, data.surfaceH(px, z) + 4.2, z], target: [tx, data.surfaceH(tx, z) + 0.6, z], fov: 48 };
}

function waterSpot() {
  const data = S.data, P = S.params || variantParams(S.variant);
  if (S.variant === 'water') {
    const z = -60;
    let xc = P.bayX;
    for (let x = -200; x < 1000; x += 4) if (data.surfaceH(x, z) < -0.01) { xc = x; break; }
    const px = xc - 70, pz = z + 24;
    return { pos: [px, Math.max(0, data.surfaceH(px, pz)) + 7, pz], target: [xc + 320, -2, z - 140], fov: 50 };
  }
  const x = -320;
  const zr = riverZ(S.rng, P, x);
  const px = x - 70, pz = zr + 110;
  return { pos: [px, Math.max(0, data.surfaceH(px, pz)) + 8, pz], target: [x + 180, -1.5, zr - 40], fov: 50 };
}

// ---------------------------------------------------------------------------------------------
export default {
  id: 'terrain',
  deps: [],
  order: 10,
  showcaseVariants: ['default', 'closeup', 'water'],
  presets: {
    // ~830 m out, 31 degrees down: river in the foreground, plateau table on the right, terraced hills behind;
    // the water map looks the other way, over the plateau to the bay and its islands
    'terrain:default': () => (S?.variant === 'water'
      ? { pos: [-250, 430, 720], target: [330, 0, 60], fov: 50 }
      : { pos: [60, 430, 780], target: [-380, 6, 220], fov: 50 }),
    'terrain:closeup': () => closeupSpot(),
    'terrain:water': () => waterSpot(),
  },

  async init(ctx) {
    const world = ctx.world;
    const mode = ctx.params.get('terrain') === 'ramp' ? 'ramp' : 'terrace';
    S = {
      ctx, rng: ctx.rng.fork('terrain'), variant: null, dirty: new Set(), waterDirty: true, time: 0, studDebounce: 0,
      unsub: [], chunks: [], bulk: false, waterCells: new Set(), seaLevel0: world.seaLevel,
    };
    S.data = new TerrainData(world, S.rng, ctx.materials, { mode });
    S.group = new THREE.Group();
    S.group.name = 'terrain';
    ctx.scene.add(S.group);

    // shared fade band (camera distance, m): real studs shrink out / shader relief fades in
    S.studFade = new THREE.Vector2(130, 170);

    // ground material: satin ABS plastic (low clearcoat so mid-distance greens stay saturated), vertex-coloured per
    // plate, with the stud relief shader
    S.studMaskTex = makeMaskTexture(world.size.w, world.size.h);
    S.groundUniforms = {
      uStudMask: { value: S.studMaskTex },
      uMapMin: { value: new THREE.Vector2(world.minX, world.minZ) },
      uMapSize: { value: new THREE.Vector2(world.widthMeters, world.depthMeters) },
      uStudPitch: { value: STUD_PITCH }, uReliefStrength: { value: 0.9 }, uStudFade: { value: S.studFade },
    };
    const base = ctx.materials.plastic('white', { roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.3 });
    S.groundMat = base.clone();
    S.groundMat.vertexColors = true;
    S.groundMat.name = 'terrain:ground';
    // environment.setEnvIntensity() writes envMapIntensity on every cached material; the ground wants a fraction of
    // the scene value, so scale it on the way in
    S.groundMat._envBase = 1.0;
    Object.defineProperty(S.groundMat, 'envMapIntensity', {
      get() { return this._envBase * GROUND_ENV_MUL; }, set(v) { this._envBase = v; }, configurable: true,
    });
    patchGroundMaterial(S.groundMat, S.groundUniforms);
    ctx.materials.cache.set('terrain:ground', S.groundMat);

    // stud material: same satin plastic, per-instance colour, distance shrink
    S.studMat = ctx.materials.plastic('white', { roughness: 0.45, clearcoat: 0.2, clearcoatRoughness: 0.3, instanceColor: true }).clone();
    S.studMat.name = 'terrain:studs';
    S.studMat._envBase = 1.0;
    Object.defineProperty(S.studMat, 'envMapIntensity', {
      get() { return this._envBase * GROUND_ENV_MUL; }, set(v) { this._envBase = v; }, configurable: true,
    });
    ctx.materials.cache.set('terrain:studs', S.studMat);

    // water: translucent glossy trans-blue plastic; depth read from the height field
    const w1 = world.size.w + 1, h1 = world.size.h + 1;
    S.heightTex = makeHeightTexture(world.heightField, w1, h1);
    S.waterUniforms = {
      uTime: { value: 0 }, uWaveStrength: { value: 1.0 },
      uHeightTex: { value: S.heightTex }, uHeightTexSize: { value: new THREE.Vector2(w1, h1) },
      uMapMin: { value: new THREE.Vector2(world.minX, world.minZ) }, uCellSize: { value: world.cellSize },
      uAttenuation: { value: 0.5 }, // 1/m: one plate down 82 % of the seabed shows, the 3.4 m river bed ~18 %
      uWaterY: { value: WATER_OFFSET },
    };
    S.waterMat = new THREE.MeshPhysicalMaterial({
      // roughness a touch above r2's 0.07: spreads the low-sun glint instead of a single blown-out hotspot
      color: '#2f9fe8', roughness: 0.11, metalness: 0, ior: 1.33, specularIntensity: 1.0,
      clearcoat: 0, envMapIntensity: 1.0, transparent: true, depthWrite: false, side: THREE.FrontSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    S.waterMat.name = 'terrain:water';
    patchWaterMaterial(S.waterMat, S.waterUniforms);
    ctx.materials.cache.set('terrain:water', S.waterMat);
    S.water = new THREE.Mesh(new THREE.BufferGeometry(), S.waterMat);
    S.water.name = 'terrain-water';
    S.water.receiveShadow = true;
    S.water.castShadow = false;
    S.water.renderOrder = 5;
    S.group.add(S.water);

    // ground chunks
    const { w, h } = world.size;
    for (let cz = 0; cz < CHUNKS_Z; cz++) {
      for (let cx = 0; cx < CHUNKS_X; cx++) {
        const ch = {
          i0: Math.floor((cx * w) / CHUNKS_X), i1: Math.floor(((cx + 1) * w) / CHUNKS_X) - 1,
          j0: Math.floor((cz * h) / CHUNKS_Z), j1: Math.floor(((cz + 1) * h) / CHUNKS_Z) - 1,
          mesh: new THREE.Mesh(new THREE.BufferGeometry(), S.groundMat),
        };
        ch.mesh.name = `terrain-chunk-${cx}-${cz}`;
        ch.mesh.receiveShadow = true;
        ch.mesh.castShadow = true;
        ch.mesh.frustumCulled = true;
        S.group.add(ch.mesh);
        S.chunks.push(ch);
      }
    }

    // near-camera instanced studs
    S.studs = new StudManager(ctx, S.data, S.group, {
      chunkCells: STUD_CHUNK_CELLS, maxStuds: MAX_STUDS, radius: 170, material: S.studMat, fadeUniform: S.studFade,
    });

    S.unsub.push(ctx.events.on('terrain:changed', onTerrainChanged));
    S.unsub.push(ctx.events.on('world:cell', onCell));
    S.unsub.push(ctx.events.on('settings:changed', (p = {}) => {
      if (p.studs !== undefined) S.studs.setEnabled(p.studs);
    }));

    generate('default');
    S.studs.update(0, ctx.camera, true);
    let hMin = Infinity, hMax = -Infinity;
    for (const v of world.heightField) { if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
    ctx.log(`[terrain] mode=${mode} tris≈${S.chunks.reduce((n, c) => n + (c.mesh.geometry.index?.count || 0) / 3, 0) | 0} studs=${S.studs.count} h=[${hMin.toFixed(1)}, ${hMax.toFixed(1)}]`);
  },

  update(dt, ctx) {
    if (!S) return;
    S.time += dt;
    S.waterUniforms.uTime.value = S.time;
    if (S.dirty.size || S.waterDirty) flush();
    if (S.studDebounce > 0) S.studDebounce -= dt;
    else S.studs.update(dt, ctx.camera);
  },

  dispose(ctx) {
    if (!S) return;
    for (const off of S.unsub) off();
    // give the world back its cells: every cell we flipped to water goes back to 'none'
    const world = ctx.world;
    S.bulk = true;
    for (const k of S.waterCells) {
      const c = world.cells[k];
      if (c && c.type === 'water') world.setCell(c.i, c.j, { type: 'none' });
    }
    S.waterCells.clear();
    world.seaLevel = S.seaLevel0;
    ctx.scene.remove(S.group);
    for (const ch of S.chunks) ch.mesh.geometry?.dispose();
    S.water.geometry?.dispose();
    S.studs.dispose();
    S.studMaskTex.dispose(); S.heightTex.dispose();
    ctx.materials.cache.delete('terrain:ground'); ctx.materials.cache.delete('terrain:water'); ctx.materials.cache.delete('terrain:studs');
    S.groundMat.dispose(); S.waterMat.dispose(); S.studMat.dispose();
    S = null;
  },

  async showcase(ctx, variant = 'default') {
    if (!S) return;
    const mapVariant = MAP_VARIANT[variant] || 'default';
    if (S.variant !== mapVariant) generate(mapVariant);
    S.showcaseVariant = variant;
  },

  api: {
    /** Set a rectangular cell region [i0..i1]x[j0..j1] to one plate height (default: its quantized average). */
    flatten(i0, j0, i1, j1, height) {
      if (!S) return 0;
      const world = S.ctx.world;
      ({ i0, j0, i1, j1 } = clampRegion(i0, j0, i1, j1));
      if (height === undefined) {
        let sum = 0, n = 0;
        for (let j = j0; j <= j1 + 1; j++) for (let i = i0; i <= i1 + 1; i++) { sum += world.getVertexHeight(i, j); n++; }
        height = sum / n;
      }
      height = quantize(height, PLATE);
      for (let j = j0; j <= j1 + 1; j++) for (let i = i0; i <= i1 + 1; i++) world.setVertexHeight(i, j, height);
      const r = clampRegion(i0 - 1, j0 - 1, i1 + 1, j1 + 1);
      for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) world.cells[j * world.size.w + i].height = S.data.avg(i, j);
      world.events.emit('terrain:changed', { region: r });
      return height;
    },
    /**
     * Terrain-wise OK to build on: the cell is dry (not water, not below sea level) and its plate spread is at most
     * maxStep (default one plate = 0.4 m). It does NOT check occupancy: road/building/zone cells return true; callers
     * that care about occupancy check `cell.type` themselves.
     */
    isBuildable(i, j, maxStep = PLATE + 1e-3) {
      if (!S) return false;
      const c = S.ctx.world.cellAt(i, j);
      if (!c || c.type === 'water' || S.data.isWaterCell(i, j)) return false;
      return S.data.spread(i, j) <= maxStep;
    },
    /** Terrain gradient magnitude (rise/run) at world (x,z). */
    slopeAt(x, z) {
      if (!S) return 0;
      const n = S.ctx.world.getNormal(x, z, new THREE.Vector3());
      return Math.hypot(n.x, n.z) / Math.max(1e-4, n.y);
    },
    /** Rebuild ground/water/studs for a cell region now (corner order does not matter). */
    rebuildRegion(i0, j0, i1, j1) {
      if (!S) return;
      onTerrainChanged({ region: clampRegion(i0, j0, i1, j1) });
      flush();
    },
    /** Rendered plate-surface height at world (x,z) (may differ from world.getHeight by <= 0.6 m on terraces). */
    surfaceHeight(x, z) { return S ? S.data.surfaceH(x, z) : 0; },
    /** Y of the water surface. */
    waterY() { return S ? S.ctx.world.seaLevel + WATER_OFFSET : WATER_OFFSET; },
    /** Palette colour name of the plate at cell (i,j). */
    plateColor(i, j) { return S ? S.data.colorNameOf(i, j) : 'brightGreen'; },
  },
};
