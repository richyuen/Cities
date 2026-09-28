import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { civicSubjects, streetCandidates, towerCluster, sunAzimuth, buildingDiag, segmentBlocked, DEG } from './composition.js';

export class CameraPresets {
  constructor(world, clock) {
    this.world = world;
    this.clock = clock;
    this.presets = new Map();
    const W = world.widthMeters, D = world.depthMeters;
    const gh = (x, z) => world.getHeight(x, z);
    // downtown/plateau center — (0,0) unless terrain moved it (only happens when the pre-built demo city, whose
    // roads are hardcoded around the origin, isn't loaded — see terrain/index.js generate()).
    const dc = () => world.downtownCenter || { x: 0, z: 0 };
    // A seeded city has hundreds of buildings; showcases/empty worlds fall back to the pre-LOOP generic framings.
    const hasCity = () => world.buildings.size >= 40;

    // ---------------------------------------------------------------------------------------------------------
    // LOOP cycle 1 (L1 hero framing). The shipped framings were recomposed around real subjects from live
    // A/B labs (shots in the cycle report): the tall cluster from the south with the avenue leading in
    // (skyline/night), a low SW oblique over downtown + the bay (overview), a dawn aerial from the east over
    // the waterfront (aerial), the busiest avenue at eye height (street), and a civic hero in a lit 3/4
    // (closeup). Old fixed offsets stay as fallbacks for empty/showcase worlds.
    // ---------------------------------------------------------------------------------------------------------

    // Low 3/4 of downtown from the south-west: dense towers, the avenue leading in, no empty-field foreground.
    this.register('skyline', () => {
      const c = dc();
      if (!hasCity()) return { pos: [c.x + 230, 55 + gh(c.x + 230, c.z + 300), c.z + 300], target: [c.x, 22, c.z] };
      const px = c.x + 520, pz = c.z + 70;
      return { pos: [px, 60 + gh(px, pz), pz], target: [c.x + 150, 14, c.z - 40], fov: 46 };
    });
    this.register('night', () => this.get('skyline'));

    // Oblique aerial from the south-west over downtown: the industrial pads and the bay give the frame edges
    // content, so it reads as a city view instead of a tinted data map (the pre-LOOP complaint).
    this.register('overview', () => {
      const c = dc();
      if (!hasCity()) return { pos: [c.x + W * 0.20, W * 0.27, c.z + D * 0.30], target: [c.x, 0, c.z] };
      const px = c.x - 250, pz = c.z + 420;
      return { pos: [px, 240 + gh(px, pz), pz], target: [c.x, 0, c.z - 40], fov: 45 };
    });

    // Dawn coastal aerial from the east: the bay enters the near/middle bands (the pre-fix framing looked
    // west-southwest and contained ZERO water cells — cycle-1 critic issue 2), long shadows across downtown.
    this.register('aerial', () => {
      const c = dc();
      if (!hasCity()) return { pos: [c.x, W * 0.44, c.z + D * 0.18], target: [c.x, 0, c.z] };
      const px = c.x + 860, pz = c.z + 300;
      return { pos: [px, 300 + gh(px, pz), pz], target: [c.x + 200, 0, c.z - 80], fov: 45 };
    });

    // Eye-height shot down the busiest avenue: lit shopfronts, streetlights, hedges, buses (the pre-LOOP street
    // was a thin dark road on an empty lot). The eye sits on the outer verge just past the downtown-side end of
    // the edge, looking inward; both verge sides and several standoffs are scored so the frame is not bisected
    // by the nearest streetlamp and no prop sits in the lens (cycle-1 critic issue 3).
    this.register('street', () => {
      const c = dc();
      const cands = hasCity() ? streetCandidates(this.world) : [];
      if (cands.length) {
        const s = cands[0];
        const da = Math.hypot(s.a.x - c.x, s.a.z - c.z), db = Math.hypot(s.b.x - c.x, s.b.z - c.z);
        const near = da <= db ? s.a : s.b, far = da <= db ? s.b : s.a;
        const ux = (far.x - near.x) / s.len, uz = (far.z - near.z) / s.len;
        const lx = -uz, lz = ux; // left-hand lateral unit
        let best = null;
        for (const side of [7, -7]) {
          // Aim a few metres AWAY from the near verge (not straight down the axis, not toward the lamp line):
          // the parallel lamp line at lateral 9 m otherwise converges onto the frame centre and a pole bisects
          // it (cycle-1 critic issue 3). Eye at lateral 7 sits between the lane and the lamp line.
          const tx = near.x + ux * 110 + lx * (-side * 0.5), tz = near.z + uz * 110 + lz * (-side * 0.5);
          for (const standoff of [16, 24, 32, 40]) {
            const px = near.x - ux * standoff + lx * side, pz = near.z - uz * standoff + lz * side;
            if (segmentBlocked(this.world, px, pz, px, pz)) continue;
            const eyeY = gh(px, pz) + 2.8;
            // Score obstructions: props close to the lens or near the view axis are what the critic saw (a
            // lamp 6.6 m out at 4 deg off-axis slipped a 0.06 cone, and the eye stood on the lamp line).
            const vx = tx - px, vz = tz - pz, vl = Math.hypot(vx, vz) || 1;
            const dx = vx / vl, dz = vz / vl, rx = -dz, rz = dx;
            let hardProps = 0, centreProps = 0;
            for (const p of this.world.props.values()) {
              const ox = p.x - px, oz = p.z - pz;
              const d = Math.hypot(ox, oz);
              const lat = d > 0.01 ? Math.abs((ox * rx + oz * rz) / d) : 0;
              if (d < 3 || (d < 8 && lat < 0.4)) { hardProps++; continue; }
              if (d > 140) continue;
              const along = (ox * dx + oz * dz) / d;
              if (along < 0.3) continue;
              if (lat < 0.22) centreProps++;
            }
            const score = hardProps * 1000 + centreProps;
            if (!best || score < best.score) best = { px, pz, eyeY, score, hardProps, tx, tz };
          }
        }
        if (best && best.hardProps === 0) {
          // Look slightly DOWN: MapControls.maxPolarAngle (89.1°) lifts any eye that sits below its target,
          // so a target above eye level silently raises the camera off the street (cycle-1 check: 6.5 m eye).
          return { pos: [best.px, best.eyeY, best.pz], target: [best.tx, best.eyeY - 2.5, best.tz], fov: 50 };
        }
      }
      const fy = gh(4, 60);
      // Fallback: target below the authored eye, same polar-clamp reason (cycle-1 critic issue 5).
      return { pos: [4, 1.7 + fy, 60], target: [4, fy + 0.2, -20] };
    });

    // Civic hero 3/4: the busiest school/hospital/fire/police lot (neighbours + street props) framed around
    // its +z entrance face (the generator convention), sun-side so the lit face is toward the camera at the
    // hero tods, at a distance that keeps the NEAR corner inside the frame (the centre-distance fit ignored it
    // and shipped a 1.45-1.64x crop — cycle-1 critic issue 1). Falls back to the tall cluster, then the old offset.
    this.register('closeup', () => {
      const c = dc();
      const FOV = 42, TANH = Math.tan((FOV * Math.PI) / 180 / 2);
      const cands = hasCity() ? civicSubjects(this.world, 12) : [];
      const sunAz = sunAzimuth(this.clock);
      const sunDx = Math.sin(sunAz), sunDz = Math.cos(sunAz);
      // Score every clear (candidate, +z-face offset) pair instead of taking the first sun-side slot: a
      // razor-oblique sun-side view of the best lot loses to a readable 3/4 of the next lot. Score =
      // candidateScore (neighbours + props) x faceVisibility^2 (cos of the offset; the +z entrance must read)
      // x sunSide (0.5 + 0.5 x sunDot; a sun-side slot outweighs an equal anti-sun one, but not by itself).
      let best = null;
      for (const s of cands) {
        const gy = gh(s.x, s.z);
        const h = s.h, diag = buildingDiag(this.world, s.b);
        const dist = Math.max(18, diag * 0.5 + h / (2 * TANH * 0.9));
        for (const off of [65, 40, 25, -25, -40, -65].map((d) => d * DEG)) {
          const px = s.x + Math.sin(off) * dist, pz = s.z + Math.cos(off) * dist;
          if (segmentBlocked(this.world, px, pz, px, pz)) continue;
          const eyeY = gy + Math.max(2.4, h * 0.45 + 1.2);
          // 3D check: the first building the eye→subject ray meets must be the subject itself.
          const ray = new THREE.Ray(new THREE.Vector3(px, eyeY, pz), new THREE.Vector3(s.x - px, gy + h * 0.45 - eyeY, s.z - pz).normalize());
          const hit = this.world.raycastBuildings(ray, dist + 60);
          if (hit && hit.id !== s.b.id) continue;
          const face = Math.cos(off);
          const sunDot = Math.sin(off) * sunDx + Math.cos(off) * sunDz;
          const score = s.score * face * face * (0.5 + 0.5 * sunDot);
          if (!best || score > best.score) best = { score, px, pz, eyeY, h, gy, s };
        }
      }
      if (best) return { pos: [best.px, best.eyeY, best.pz], target: [best.s.x, best.gy + best.h * 0.45, best.s.z], fov: FOV };
      const cluster = hasCity() ? towerCluster(this.world, c) : null;
      if (cluster) {
        const dist = Math.max(24, cluster.h * 1.5);
        const px = cluster.x + dist * 0.62, pz = cluster.z + dist * 0.62;
        return { pos: [px, gh(px, pz) + Math.min(cluster.h * 0.4, dist * 0.5) + 2, pz], target: [cluster.x, gh(cluster.x, cluster.z) + cluster.h * 0.3, cluster.z], fov: 45 };
      }
      return { pos: [c.x + 22, 12 + gh(c.x + 22, c.z + 26), c.z + 26], target: [c.x, 6, c.z] };
    });
  }

  register(name, p) { this.presets.set(name, p); }
  list() { return [...this.presets.keys()]; }
  get(name) {
    const p = this.presets.get(name);
    return typeof p === 'function' ? p(this.world, this.clock) : p || null;
  }
}

export function createCamera(renderer, world, events, clock) {
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

  const presets = new CameraPresets(world, clock);
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
