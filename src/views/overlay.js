// Data-view overlay renderer: two instanced meshes paint the active layer over the map — one flat plate per
// relevant cell of open/zoned land and one translucent box per building. Strictly read-only: every value comes
// from simulation/transit public grids (see index.js), so nothing here owns world data or mutates it.
//
// Draw calls: 2 (ground + buildings) no matter the map size, matching the "others <= 10" per-module budget.
import * as THREE from 'three';

const MARGIN = 0.35;          // plate gap from the cell edge, meters (keeps the cell grid legible)
const PLATE_H = 0.5;          // plate thickness (m)
const PLATE_Y0 = 0.12;        // sits just above the rendered terrain surface (zoning plates use 0.09)
const BOX_PAD = 0.6;          // building tint box overshoot per side, meters
const BOX_Y0 = 0.06;
const BOX_MIN_H = 1.4;

// sRGB hex; THREE.Color converts to the renderer's working space. Served=blue and uncovered=red both stay
// legible over green terrain, grey roads and the red/yellow zone plates; the service building itself is yellow.
const COL = {
  covered: 0x2f8fe0,          // served
  uncovered: 0xe23b2e,        // zoned/built but unserved
  source: 0xffe27a,           // the service building itself (warm yellow)
  landLow: 0xd12a1e,
  landMid: 0xf2b21a,
  landHigh: 0x1f9e44,
};

/** Which utility building kinds count as the "source" of a coverage layer, keyed by view id. */
const SOURCE_KINDS = {
  power: { power_plant: true },
  water: { water_tower: true },
  police: { police_station: true },
  school: { school: true },
  health: { hospital: true },
  services: { power_plant: true, water_tower: true },
};

const _cLow = new THREE.Color(COL.landLow);
const _cMid = new THREE.Color(COL.landMid);
const _cHigh = new THREE.Color(COL.landHigh);

function landColor(t, out) {
  const v = t < 0 ? 0 : t > 1 ? 1 : t;
  if (v < 0.5) out.copy(_cLow).lerp(_cMid, v * 2);
  else out.copy(_cMid).lerp(_cHigh, (v - 0.5) * 2);
  return out;
}

/** Zoning-style trick: make the material's emissive term follow the per-instance colour, so the tint glows in
 *  its own hue at night instead of washing to one flat white. The guard must test the *fragment*-side defines:
 *  three turns instancing colour into USE_COLOR for the fragment shader, so USE_INSTANCING_COLOR alone would
 *  never match here (the same guard zoning's plates use). */
function addInstanceColorEmissive(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
	totalEmissiveRadiance *= vColor.rgb;
#endif`
    );
  };
}

export class ViewOverlay {
  constructor(ctx) {
    this.ctx = ctx;
    const world = ctx.world;
    const cs = world.cellSize;

    this.group = new THREE.Group();
    this.group.name = 'views';
    this.group.visible = false;
    ctx.scene.add(this.group);

    this.plateGeo = new THREE.BoxGeometry(Math.max(1, cs - MARGIN * 2), PLATE_H, Math.max(1, cs - MARGIN * 2));
    this.plateGeo.translate(0, PLATE_H / 2, 0);   // local origin at the bottom face, like zoning's plates
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.boxGeo.translate(0, 0.5, 0);

    this.plateMat = this._makeMaterial('views:ground', 0.8, 0.15);
    this.boxMat = this._makeMaterial('views:building', 0.85, 0.15);

    this.ground = new THREE.InstancedMesh(this.plateGeo, this.plateMat, Math.max(1, world.size.w * world.size.h));
    this.ground.name = 'views-ground';
    this.ground.count = 0;
    this.ground.castShadow = false;
    this.ground.receiveShadow = false;
    this.ground.frustumCulled = false;
    this.ground.renderOrder = 6;
    this.group.add(this.ground);

    this.box = null;
    this._boxCap = 0;
    this._ensureBoxCap(Math.max(512, world.buildings.size + 256));

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._col = new THREE.Color();
    this._services = null;

    const terr = ctx.modules.get('terrain');
    const surf = terr?.status === 'ok' && typeof terr.api?.surfaceHeight === 'function' ? terr.api.surfaceHeight : null;
    this.groundFn = surf || ((x, z) => world.getHeight(x, z));
  }

  _makeMaterial(name, opacity, nightGlow) {
    // Emissive-driven: the plate's own colour must survive blending with grass/asphalt underneath, or "red =
    // unserved" turns brown over green terrain. A lit translucent plate can never do that (red over grass always
    // blends toward brown), so this is an unlit-style physical material whose radiance is its instance colour -
    // the same data-view look city builders use - but still a real MeshPhysicalMaterial (never MeshBasicMaterial),
    // cached in materials.cache like zoning's plates.
    const m = new THREE.MeshPhysicalMaterial({
      color: 0x000000, roughness: 0.6, metalness: 0, clearcoat: 0,
      emissive: 0xffffff, emissiveIntensity: 1,
      transparent: true, opacity, depthWrite: false,
    });
    m.name = name;
    m.userData.baseOpacity = opacity;
    m.userData.nightGlow = nightGlow;
    addInstanceColorEmissive(m);
    this.ctx.materials.cache.set(name, m); // environment.setEnvIntensity() reaches these too (zoning does the same)
    return m;
  }

  _ensureBoxCap(cap) {
    if (this._boxCap >= cap) return;
    const box = new THREE.InstancedMesh(this.boxGeo, this.boxMat, cap);
    box.name = 'views-buildings';
    box.count = 0;
    box.castShadow = false;
    box.receiveShadow = false;
    box.frustumCulled = false;
    box.renderOrder = 7;
    if (this.box) { this.group.remove(this.box); this.box.dispose?.(); }
    this.group.add(box);
    this.box = box;
    this._boxCap = cap;
  }

  /** Per-cell grid for a coverage view: simulation's service layers, transit's stop walk-up layer, or the
   *  combined "services" layer (roads AND power AND water). Null when the source module is missing. */
  _gridFor(view, sim, transit) {
    if (view.kind !== 'coverage') return null;
    if (view.grid === 'transit') return transit?.getCoverageGrid?.() || null;
    if (view.grid === 'services') {
      const road = sim?.getCoverageGrid?.('road');
      const power = sim?.getCoverageGrid?.('power');
      const water = sim?.getCoverageGrid?.('water');
      if (!road || !power || !water) return null;
      const n = road.length;
      if (!this._services || this._services.length !== n) this._services = new Uint8Array(n);
      const g = this._services;
      for (let k = 0; k < n; k++) g[k] = road[k] && power[k] && water[k] ? 1 : 0;
      return g;
    }
    return sim?.getCoverageGrid?.(view.grid) || null;
  }

  /** Rebuild both layers for `view`. sources = { sim, transit } public APIs (either may be null). */
  update(view, sources) {
    const sim = sources?.sim || null, transit = sources?.transit || null;
    const world = this.ctx.world;
    const { w, h } = world.size;
    const cells = world.cells;
    const grid = view.kind === 'coverage' ? this._gridFor(view, sim, transit) : null;
    if (view.kind === 'coverage' && !grid) { this.hide(); return; }

    let gn = 0, bn = 0;
    // ---- ground plates: open + zoned land ------------------------------------------------
    const ground = this.ground;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const t = cells[k].type;
        if (t === 'road' || t === 'water' || t === 'building') continue;
        if (view.kind === 'coverage') {
          if (grid[k] === 1) this._col.set(COL.covered);
          else if (t === 'zone') this._col.set(COL.uncovered);
          else continue; // open unserved land: no tint (keeps the map readable, red stays actionable)
        } else {
          if (t !== 'zone') continue; // land value only matters on developable (zoned) land
          landColor(sim?.cellDesirability ? sim.cellDesirability(i, j) : 0.5, this._col);
        }
        const { x, z } = world.cellToWorld(i, j);
        this._p.set(x, this.groundFn(x, z) + PLATE_Y0, z);
        this._s.set(1, 1, 1);
        this._m.compose(this._p, this._q, this._s);
        ground.setMatrixAt(gn, this._m);
        ground.setColorAt(gn, this._col);
        gn++;
      }
    }
    ground.count = gn;
    ground.instanceMatrix.needsUpdate = true;
    if (ground.instanceColor) ground.instanceColor.needsUpdate = true;

    // ---- building tint boxes --------------------------------------------------------------
    const buildings = world.buildings;
    this._ensureBoxCap(Math.max(512, buildings.size + 256));
    const box = this.box;
    const cs = world.cellSize;
    const sources_ = view.kind === 'coverage' ? SOURCE_KINDS[view.id] : null;
    for (const b of buildings.values()) {
      const bw = Math.max(1, b.w || 1), bd = Math.max(1, b.d || 1);
      const p = world.cellToWorld(b.i + (bw - 1) / 2, b.j + (bd - 1) / 2);
      const cx = p.x, cz = p.z;
      if (view.kind === 'coverage') {
        if (sources_ && sources_[b.kind]) this._col.set(COL.source);
        else if (grid[b.j * w + b.i] === 1) this._col.set(COL.covered);
        else this._col.set(COL.uncovered);
      } else {
        landColor(sim?.cellDesirability ? sim.cellDesirability(b.i, b.j) : 0.5, this._col);
      }
      const y = this.groundFn(cx, cz) + BOX_Y0;
      this._p.set(cx, y, cz);
      this._s.set(bw * cs + BOX_PAD, Math.max(BOX_MIN_H, (b.height || 10) + 1.0), bd * cs + BOX_PAD);
      this._m.compose(this._p, this._q, this._s);
      box.setMatrixAt(bn, this._m);
      box.setColorAt(bn, this._col);
      bn++;
    }
    box.count = bn;
    box.instanceMatrix.needsUpdate = true;
    if (box.instanceColor) box.instanceColor.needsUpdate = true;

    this.group.visible = true;
  }

  /** Night legibility: the tint follows the instance colour (see addInstanceColorEmissive). Kept near 1 — this is
   *  a data layer, it must stay readable without out-glowing the city's own windows and streetlights (< 1 keeps
   *  it under the bloom threshold). */
  setNight(night) {
    const v = night < 0 ? 0 : night > 1 ? 1 : night;
    this.plateMat.opacity = this.plateMat.userData.baseOpacity + v * 0.05;
    this.boxMat.opacity = this.boxMat.userData.baseOpacity + v * 0.05;
    this.plateMat.emissiveIntensity = 1 + v * this.plateMat.userData.nightGlow;
    this.boxMat.emissiveIntensity = 1 + v * this.boxMat.userData.nightGlow;
  }

  hide() { this.group.visible = false; }

  dispose() {
    this.ctx.materials.cache.delete('views:ground');
    this.ctx.materials.cache.delete('views:building');
    this.ground.dispose?.();
    this.box?.dispose?.();
    this.plateMat.dispose();
    this.boxMat.dispose();
    this.plateGeo.dispose();
    this.boxGeo.dispose();
    this.ctx.scene.remove(this.group);
  }
}
