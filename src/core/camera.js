import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

export class CameraPresets {
  constructor(world) {
    this.world = world;
    this.presets = new Map();
    const W = world.widthMeters, D = world.depthMeters;
    const gh = (x, z) => world.getHeight(x, z);
    // downtown/plateau center — (0,0) unless terrain moved it (only happens when the pre-built demo city, whose
    // roads are hardcoded around the origin, isn't loaded — see terrain/index.js generate()).
    const dc = () => world.downtownCenter || { x: 0, z: 0 };
    // Core presets are functions so they track terrain height (and downtown center) at apply time.
    // V5 beauty-shot pass (B4 levers): skyline is a closer 3/4 hero framing, closeup picks the tallest building near
    // downtown and frames it 3/4 (falling back to the old fixed offset on empty worlds), overview/aerial tightened.
    this.register('overview', () => ({ pos: [dc().x + W * 0.20, W * 0.27, dc().z + D * 0.30], target: [dc().x, 0, dc().z] }));
    this.register('aerial', () => ({ pos: [dc().x, W * 0.44, dc().z + D * 0.18], target: [dc().x, 0, dc().z] }));
    this.register('skyline', () => ({ pos: [dc().x + 230, 55 + gh(dc().x + 230, dc().z + 300), dc().z + 300], target: [dc().x, 22, dc().z] }));
    this.register('night', () => ({ pos: [dc().x + 230, 55 + gh(dc().x + 230, dc().z + 300), dc().z + 300], target: [dc().x, 22, dc().z] }));
    this.register('street', () => ({ pos: [4, 1.7 + gh(4, 60), 60], target: [4, 4, -20] }));
    this.register('closeup', () => {
      const c = dc();
      let hero = null, best = 0;
      for (const b of this.world.buildings.values()) {
        const h = b.height || 10;
        if (h <= best) continue;
        const p = this.world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2);
        if (Math.hypot(p.x - c.x, p.z - c.z) > 420) continue;
        best = h; hero = { b, x: p.x, z: p.z, h };
      }
      if (hero) {
        const cs = this.world.cellSize || 8;
        const diag = Math.hypot((hero.b.w || 1) * cs, (hero.b.d || 1) * cs);
        const dist = Math.max(diag * 1.9 + 12, hero.h * 0.65, 20);
        const gy = gh(hero.x, hero.z);
        const y = Math.min(hero.h * 0.4, dist * 0.5) + 2;
        return { pos: [hero.x + dist * 0.62, gy + y, hero.z + dist * 0.62], target: [hero.x, gy + hero.h * 0.3, hero.z], fov: 45 };
      }
      return { pos: [c.x + 22, 12 + gh(c.x + 22, c.z + 26), c.z + 26], target: [c.x, 6, c.z] };
    });
  }

  register(name, p) { this.presets.set(name, p); }
  list() { return [...this.presets.keys()]; }
  get(name) {
    const p = this.presets.get(name);
    return typeof p === 'function' ? p(this.world) : p || null;
  }
}

export function createCamera(renderer, world, events) {
  const el = renderer.domElement;
  const camera = new THREE.PerspectiveCamera(50, el.clientWidth / el.clientHeight, 0.5, 6000);
  camera.position.set(200, 180, 260);
  const controls = new MapControls(camera, el);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = false;
  controls.minDistance = 2.5; // was 4 — the simulation review asked for sub-4m wall closeups (N5)
  controls.maxDistance = 3500;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.zoomToCursor = true;
  controls.target.set(0, 0, 0);
  controls.keys = { LEFT: 'KeyA', UP: 'KeyW', RIGHT: 'KeyD', BOTTOM: 'KeyS' };
  controls.listenToKeyEvents(window);
  controls.keyPanSpeed = 40;

  const presets = new CameraPresets(world);
  const _last = new THREE.Vector3();

  const api = {
    camera, controls, presets,
    apply(nameOrObj) {
      const p = typeof nameOrObj === 'string' ? presets.get(nameOrObj) : nameOrObj;
      if (!p) return false;
      camera.position.set(p.pos[0], p.pos[1], p.pos[2]);
      controls.target.set(p.target[0], p.target[1], p.target[2]);
      if (p.fov) camera.fov = p.fov; else camera.fov = 50;
      camera.updateProjectionMatrix();
      controls.update();
      api.clampAboveGround();
      api.clampOutsideBuildings();
      camera.updateMatrixWorld();
      events.emit('camera:changed', { pos: camera.position.toArray(), target: controls.target.toArray() });
      return true;
    },
    clampAboveGround() {
      const h = world.getHeight(camera.position.x, camera.position.z) + 1.2;
      if (camera.position.y < h) camera.position.y = h;
    },
    /** Push the camera eye out of any building's footprint (cheap AABB test) so it never renders
     * backface-culled interior walls. Buildings are 1-4 cell axis-aligned footprints; a full city
     * has at most a few thousand, so a per-frame linear scan is negligible. */
    clampOutsideBuildings() {
      const buildings = world.buildings;
      if (!buildings || buildings.size === 0) return;
      const cs = world.cellSize, margin = 0.6;
      const px = camera.position.x, pz = camera.position.z, py = camera.position.y;
      for (const b of buildings.values()) {
        const height = (b.height || 10) + 0.5;
        if (py > height) continue; // above roofline: no interior to leak through
        const c0 = world.cellToWorld(b.i, b.j);
        const minX = c0.x - cs / 2 - margin, minZ = c0.z - cs / 2 - margin;
        const maxX = minX + b.w * cs + margin * 2, maxZ = minZ + b.d * cs + margin * 2;
        if (px <= minX || px >= maxX || pz <= minZ || pz >= maxZ) continue;
        const dLeft = px - minX, dRight = maxX - px, dTop = pz - minZ, dBottom = maxZ - pz;
        const m = Math.min(dLeft, dRight, dTop, dBottom);
        if (m === dLeft) camera.position.x = minX;
        else if (m === dRight) camera.position.x = maxX;
        else if (m === dTop) camera.position.z = minZ;
        else camera.position.z = maxZ;
      }
    },
    update() {
      controls.update();
      api.clampAboveGround();
      api.clampOutsideBuildings();
      if (_last.distanceToSquared(camera.position) > 0.01) {
        _last.copy(camera.position);
        events.emit('camera:changed', { pos: camera.position.toArray(), target: controls.target.toArray() });
      }
    },
    resize(w, h) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
  return api;
}
