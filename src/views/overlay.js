// Data-view overlay renderer: two instanced meshes paint the active layer over the map — one flat plate per
// relevant cell of open/zoned land and one translucent box per building. Strictly read-only: every value comes
// from simulation/transit public grids (see index.js), so nothing here owns world data or mutates it.
//
// Draw calls: 2 (ground + buildings) no matter the map size, matching the "others <= 10" per-module budget.
import * as THREE from 'three';

const MARGIN = 0.35;          // plate gap from the cell edge, meters (keeps the cell grid legible)
const PLATE_H = 0.5;          // plate thickness (m)
const PLATE_Y0 = 0.12;        // sits just above the rendered terrain surface (zoning plates use 0.09)
const BOX_PAD = 0.15;         // building tint box overshoot per side, meters (r1 polish: hug the silhouette)
const BOX_Y0 = 0.06;
const BOX_MIN_H = 0.6;
const FADE_CELLS = 12;        // coverage: served open land farther than this from zoning fades out (r1 polish)

// sRGB hex; THREE.Color converts to the renderer's working space. Served=blue and uncovered=red both stay
// legible over green terrain, grey roads and the red/yellow zone plates; the service building itself is gold.
// Land high is a cooler emerald so it cannot be mistaken for untinted grass (r1 polish); traffic uses the usual
// green → amber → red congestion ramp.
const COL = {
  covered: 0x2f8fe0,          // served
  uncovered: 0xe23b2e,        // zoned/built but unserved
  source: 0xffb800,           // the service building itself (saturated gold — r1 polish: creams out on pale walls)
  landLow: 0xd12a1e,
  landMid: 0xf2b21a,
  landHigh: 0x14c38e,
  congFree: 0x22c55e,
  congSlow: 0xf2b21a,
  congCongested: 0xe23b2e,
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
const _cCongFree = new THREE.Color(COL.congFree);
const _cCongSlow = new THREE.Color(COL.congSlow);
const _cCongCongested = new THREE.Color(COL.congCongested);

/** Land ramp normalised over `lo..hi` (the map's own developable range) with a narrow yellow shoulder, so red and
 *  emerald own the ends instead of the whole map sitting in the yellow band (r1 polish). */
function landColor(v, lo, hi, out) {
  const span = hi - lo;
  const u = span > 1e-6 ? (v - lo) / span : 0.5;
  const k = u < 0 ? 0 : u > 1 ? 1 : u;
  if (k < 0.45) out.copy(_cLow).lerp(_cMid, k / 0.45);
  else if (k > 0.55) out.copy(_cMid).lerp(_cHigh, (k - 0.55) / 0.45);
  else out.copy(_cMid);
  return out;
}

/** Traffic congestion ramp: green (free flow) → amber (slowing) → red (stopped). */
function congestionColor(t, out) {
  const v = t < 0 ? 0 : t > 1 ? 1 : t;
  if (v < 0.5) out.copy(_cCongFree).lerp(_cCongSlow, v * 2);
  else out.copy(_cCongSlow).lerp(_cCongCongested, (v - 0.5) * 2);
  return out;
}

/** Worst congestion among the road cells touching a building footprint (its access); 0 when none. */
function buildingCongestion(cells, grid, w, h, b) {
  const bw = Math.max(1, b.w || 1), bd = Math.max(1, b.d || 1);
  let best = 0;
  for (let j = b.j - 1; j <= b.j + bd; j++) {
    for (let i = b.i - 1; i <= b.i + bw; i++) {
      if (i < 0 || j < 0 || i >= w || j >= h) continue;
      if (i >= b.i && i < b.i + bw && j >= b.j && j < b.j + bd) continue; // inside the footprint
      if (cells[j * w + i].type !== 'road') continue;
      const v = grid[j * w + i];
      if (v > best) best = v;
    }
  }
  return best;
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
    this._zoneDist = new Int16Array(Math.max(1, world.size.w * world.size.h));
    this._zdQueue = new Int32Array(Math.max(1, world.size.w * world.size.h));

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

  /** BFS distance (4-neighbour, cells) from every cell to the nearest zoned/built cell; reuses private buffers.
   *  Coverage views use it to fade served open land away from the city (r1 polish #4). */
  _zonedDistance() {
    const { w, h } = this.ctx.world.size;
    const cells = this.ctx.world.cells, n = w * h;
    const dist = this._zoneDist, q = this._zdQueue;
    let head = 0, tail = 0;
    for (let k = 0; k < n; k++) {
      const t = cells[k].type;
      if (t === 'zone' || t === 'building') { dist[k] = 0; q[tail++] = k; }
      else dist[k] = 0x7fff;
    }
    while (head < tail) {
      const k = q[head++], d = dist[k] + 1, i = k % w;
      let m = k - 1;
      if (i > 0 && dist[m] > d) { dist[m] = d; q[tail++] = m; }
      m = k + 1;
      if (i < w - 1 && dist[m] > d) { dist[m] = d; q[tail++] = m; }
      m = k - w;
      if (k >= w && dist[m] > d) { dist[m] = d; q[tail++] = m; }
      m = k + w;
      if (k < n - w && dist[m] > d) { dist[m] = d; q[tail++] = m; }
    }
  }

  /** Rebuild both layers for `view`. sources = { sim, transit, traffic } public APIs (any may be null). */
  update(view, sources) {
    const sim = sources?.sim || null, transit = sources?.transit || null, traffic = sources?.traffic || null;
    const world = this.ctx.world;
    const { w, h } = world.size;
    const cells = world.cells;
    const n = w * h;
    const coverage = view.kind === 'coverage';
    const congestion = view.kind === 'congestion';
    const land = view.kind === 'land';
    const grid = coverage ? this._gridFor(view, sim, transit)
      : congestion ? (traffic?.getCongestionGrid?.() || null) : null;
    if ((coverage || congestion) && (!grid || grid.length !== n)) { this.hide(); return; }
    if (coverage) this._zonedDistance();
    // land value ramp is normalised over the map's own developable range (r1 polish #1)
    let lo = 1, hi = 0;
    if (land) {
      for (let k = 0; k < n; k++) {
        const t = cells[k].type;
        if (t !== 'zone' && t !== 'building') continue;
        const v = sim?.cellDesirability ? sim.cellDesirability(k % w, (k / w) | 0) : 0.5;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (!(hi > lo)) { lo -= 0.05; hi += 0.05; }
    }

    let gn = 0, bn = 0;
    // ---- ground plates: open + zoned land, or the road network for the congestion layer ----
    const ground = this.ground;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const k = j * w + i;
        const t = cells[k].type;
        if (t === 'water') continue;
        if (congestion) {
          if (t !== 'road') continue; // traffic is a road-network read
          congestionColor(grid[k], this._col);
        } else if (coverage) {
          if (t === 'road' || t === 'building') continue;
          if (t === 'zone') {
            if (grid[k] === 1) this._col.set(COL.covered);
            else this._col.set(COL.uncovered);
          } else {
            if (grid[k] !== 1) continue;            // open unserved land: no tint (red stays actionable)
            const d = this._zoneDist[k];
            if (d > FADE_CELLS) continue;           // served land far from the city fades out entirely
            this._col.set(COL.covered).multiplyScalar(0.45 + 0.55 * (1 - d / FADE_CELLS));
          }
        } else {
          if (t !== 'zone') continue;               // land value only matters on developable (zoned) land
          landColor(sim?.cellDesirability ? sim.cellDesirability(i, j) : 0.5, lo, hi, this._col);
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
    const sources_ = coverage ? SOURCE_KINDS[view.id] : null;
    for (const b of buildings.values()) {
      const bw = Math.max(1, b.w || 1), bd = Math.max(1, b.d || 1);
      const p = world.cellToWorld(b.i + (bw - 1) / 2, b.j + (bd - 1) / 2);
      const cx = p.x, cz = p.z;
      if (coverage) {
        if (sources_ && sources_[b.kind]) this._col.set(COL.source);
        else if (grid[b.j * w + b.i] === 1) this._col.set(COL.covered);
        else this._col.set(COL.uncovered);
      } else if (congestion) {
        congestionColor(buildingCongestion(cells, grid, w, h, b), this._col);
      } else {
        landColor(sim?.cellDesirability ? sim.cellDesirability(b.i, b.j) : 0.5, lo, hi, this._col);
      }
      const y = this.groundFn(cx, cz) + BOX_Y0;
      this._p.set(cx, y, cz);
      this._s.set(bw * cs + BOX_PAD, Math.max(BOX_MIN_H, (b.height || 10) + BOX_PAD), bd * cs + BOX_PAD);
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
