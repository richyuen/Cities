import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

export class CameraPresets {
  constructor(world) {
    this.world = world;
    this.presets = new Map();
    const W = world.widthMeters, D = world.depthMeters;
    const gh = (x, z) => world.getHeight(x, z);
    // Core presets are functions so they track terrain height at apply time.
    this.register('overview', () => ({ pos: [W * 0.28, W * 0.34, D * 0.42], target: [0, 0, 0] }));
    this.register('aerial', () => ({ pos: [0, W * 0.6, D * 0.25], target: [0, 0, 0] }));
    this.register('skyline', () => ({ pos: [W * 0.05, 45 + gh(W * 0.05, D * 0.46), D * 0.46], target: [0, 25, 0] }));
    this.register('night', () => ({ pos: [W * 0.05, 45 + gh(W * 0.05, D * 0.46), D * 0.46], target: [0, 25, 0] }));
    this.register('street', () => ({ pos: [4, 1.7 + gh(4, 60), 60], target: [4, 4, -20] }));
    this.register('closeup', () => ({ pos: [22, 12 + gh(22, 26), 26], target: [0, 6, 0] }));
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
  controls.minDistance = 4;
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
