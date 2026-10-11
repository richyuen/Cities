import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRICK_W, BRICK_L, COURSE } from './brickify.js';

// Brick particles: everything a tornado tears loose is drawn here, as two instanced meshes.
//   bricks:2x4  studded 2x4 bricks (building shells)
//   bricks:box  loose pieces sized per instance (window units, slabs, tree and street-prop parts, cars)
// Two draw calls while anything is in the air or lying as rubble, none otherwise. The storm's own ring of grey
// bricks is a third, small mesh (bricks:storm) with the funnel's faint self-lit tint, so the column still reads at
// night; it is shown only while a tornado is active. A particle is `live` (integrated
// every frame), `rubble` (at rest, not integrated), `fading` (shrinking away) or free. Spawning is deterministic
// (positions and colours come from the caller, the launch jitter from the rng fork it passes); the flight itself
// integrates the frame's game dt, so only the spawn set is reproducible between boots, not where a brick lands.

export const POOL_2X4 = 6000;
export const POOL_BOX = 4000;
export const LIVE_MAX = 6000;          // integrated particles, both meshes together
export const RUBBLE_SEC = 30;          // game seconds a brick lies on the ground
const FADE_SEC = 2;
const GRAVITY = -14;
const VORTEX_TANGENT = 22;             // m/s target swirl speed at full pull
const VORTEX_INWARD = 11;
const VORTEX_UP = 18;
const VORTEX_COUPLING = 2.6;           // 1/s: how hard the air drags a brick toward the field velocity
const DRAG = 0.012;                    // quadratic air drag outside the funnel
const RESTITUTION = 0.3;
const FRICTION = 0.6;
const SETTLE_SPEED = 0.8;
const RELIFT_PULL = 0.45;              // rubble inside this pull is picked up again
const AMBIENT_N = 40;                  // the funnel's own orbiting bricks (bricks:storm)
const FUNNEL_H = 62;
const MAX_STEP = 1 / 30;

const FREE = 0, LIVE = 1, RUBBLE = 2, FADING = 3;

/** 2x4 brick, centred, long side along z: a box and eight 8-sided studs (188 triangles, positions + normals). */
function makeBrickGeometry() {
  const box = new THREE.BoxGeometry(BRICK_W, COURSE, BRICK_L).toNonIndexed();
  box.deleteAttribute('uv');
  const pos = [], nor = [];
  const sides = 8, radius = 0.24, h = 0.17, y0 = COURSE / 2;
  const rot = Math.PI / sides;
  for (let ix = 0; ix < 2; ix++) {
    for (let iz = 0; iz < 4; iz++) {
      const cx = (ix - 0.5) * 0.8, cz = (iz - 1.5) * 0.8;
      const ring = [];
      for (let s = 0; s < sides; s++) {
        const a = rot + (s / sides) * Math.PI * 2 - Math.PI / sides;
        ring.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius]);
      }
      for (let s = 0; s < sides; s++) {
        const p0 = ring[s], p1 = ring[(s + 1) % sides];
        const a = rot + (s / sides) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
        pos.push(p0[0], y0, p0[1], p1[0], y0 + h, p1[1], p1[0], y0, p1[1], p0[0], y0, p0[1], p0[0], y0 + h, p0[1], p1[0], y0 + h, p1[1]);
        for (let k = 0; k < 6; k++) nor.push(nx, 0, nz);
      }
      for (let s = 1; s < sides - 1; s++) {
        pos.push(ring[0][0], y0 + h, ring[0][1], ring[s + 1][0], y0 + h, ring[s + 1][1], ring[s][0], y0 + h, ring[s][1]);
        for (let k = 0; k < 3; k++) nor.push(0, 1, 0);
      }
    }
  }
  const studs = new THREE.BufferGeometry();
  studs.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  studs.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  const g = mergeGeometries([box, studs], false);
  box.dispose(); studs.dispose();
  g.computeBoundingSphere();
  return g;
}

function makePool(name, geometry, material, capacity, reserved, castShadow) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = castShadow;
  mesh.receiveShadow = true;
  mesh.count = 0;
  mesh.visible = false;
  const white = new THREE.Color(1, 1, 1);
  mesh.setColorAt(0, white); // allocates instanceColor
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const n = capacity;
  return {
    name, mesh, capacity, reserved,
    px: new Float32Array(n), py: new Float32Array(n), pz: new Float32Array(n),
    vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n),
    ex: new Float32Array(n), ey: new Float32Array(n), ez: new Float32Array(n),
    wx: new Float32Array(n), wy: new Float32Array(n), wz: new Float32Array(n),
    sx: new Float32Array(n), sy: new Float32Array(n), sz: new Float32Array(n),
    half: new Float32Array(n),            // resting half-height above the ground
    lite: new Float32Array(n),            // how readily the air carries this one (spreads a course of equal bricks)
    timer: new Float32Array(n),
    state: new Uint8Array(n),
    free: [], cursor: reserved, high: reserved,   // free list, recycle cursor, highest index ever used + 1
    live: 0, rubble: 0, fading: 0, dirty: false, colorDirty: false,
  };
}

export function createBrickPool(ctx, rng) {
  const group = new THREE.Group();
  group.name = 'disasters:bricks';
  const material = ctx.materials.plastic('white', { instanceColor: true, roughness: 0.35, clearcoat: 0.6 });
  const env = ctx.modules.get('environment');
  if (env?.status === 'ok') { try { env.api?.setupMaterial?.(material); } catch (_) { /* the scene sweep covers it */ } }
  const brickGeo = makeBrickGeometry();
  const boxGeo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  boxGeo.deleteAttribute('uv');
  const pools = {
    b2x4: makePool('bricks:2x4', brickGeo, material, POOL_2X4, 0, true),
    box: makePool('bricks:box', boxGeo, material, POOL_BOX, 0, false),
  };
  // same faint tint as the funnel boxes (visuals.js): there is no light source on a tornado
  const stormMat = ctx.materials.plastic('white', { instanceColor: true, roughness: 0.75, clearcoat: 0.05, emissive: 'earthBlue', emissiveIntensity: 0.22 });
  const storm = new THREE.InstancedMesh(brickGeo, stormMat, AMBIENT_N);
  storm.name = 'bricks:storm';
  storm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  storm.frustumCulled = false;
  storm.castShadow = false; storm.receiveShadow = true;
  storm.visible = false;
  group.add(pools.b2x4.mesh, pools.box.mesh, storm);

  // the storm's own bricks: a fixed, seeded table (no rng at runtime), animated by time like the funnel
  const ambient = [];
  const ambientColors = ['darkStoneGrey', 'mediumStoneGrey', 'darkStoneGrey', 'lightStoneGrey', 'earthBlue'];
  for (let i = 0; i < AMBIENT_N; i++) {
    const t = i / (AMBIENT_N - 1);
    ambient.push({
      phase: rng.range(0, Math.PI * 2), speed: rng.range(0.8, 1.5), r: 6 + t * 20, y: rng.range(0.8, 9) + t * 10,
      scale: rng.range(0.55, 0.9), color: ambientColors[i % ambientColors.length],
    });
  }
  let ambientShown = false;

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  const _e = new THREE.Euler(), _c = new THREE.Color();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const stats = { spawned: 0, dropped: 0, recycled: 0, hash: 0x811c9dc5 };

  const terrain = () => { const t = ctx.modules.get('terrain'); return t?.status === 'ok' && typeof t.api?.surfaceHeight === 'function' ? t.api : null; };
  function groundAt(x, z) {
    const t = terrain();
    let y = t ? t.surfaceHeight(x, z) : ctx.world.getHeight(x, z);
    if (!Number.isFinite(y)) y = ctx.world.getHeight(x, z);
    const c = ctx.world.cellAtWorld ? ctx.world.cellAtWorld(x, z) : null;
    return c && c.type === 'road' ? y + 0.3 : y; // road and sidewalk plates sit above the terrain plate
  }

  function writeMatrix(P, i, k = 1) {
    _e.set(P.ex[i], P.ey[i], P.ez[i]);
    _q.setFromEuler(_e);
    _p.set(P.px[i], P.py[i], P.pz[i]);
    _s.set(P.sx[i] * k, P.sy[i] * k, P.sz[i] * k);
    P.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
    P.dirty = true;
  }

  function release(P, i) {
    if (P.state[i] === LIVE) P.live--; else if (P.state[i] === RUBBLE) P.rubble--; else if (P.state[i] === FADING) P.fading--;
    P.state[i] = FREE;
    P.mesh.setMatrixAt(i, ZERO);
    P.dirty = true;
  }

  function alloc(P) {
    if (P.free.length) return P.free.pop();
    if (P.high < P.capacity) return P.high++;
    // pool full: take over the slot allocated longest ago (allocation runs round the pool)
    const i = P.cursor;
    P.cursor = P.cursor + 1 >= P.capacity ? P.reserved : P.cursor + 1;
    release(P, i);
    stats.recycled++;
    return i;
  }

  function mixHash(v) { stats.hash = Math.imul(stats.hash ^ (v | 0), 0x01000193); }

  /** Launch one brick. `b`: a brickify() record (or any { kind, x, y, z, sx, sy, sz, rotY, color:[r,g,b] });
   * `v`: launch velocity [vx,vy,vz]; `jitter`: seeded rng for the tumble. Returns false when the live cap is hit. */
  function spawn(b, v, jitter) {
    const P = b.kind === 'b2x4' ? pools.b2x4 : pools.box;
    // the spawn set is what is reproducible: hash it before the cap can drop anything
    mixHash(Math.round(b.x * 100)); mixHash(Math.round(b.y * 100)); mixHash(Math.round(b.z * 100));
    mixHash(Math.round(b.color[0] * 255) | (Math.round(b.color[1] * 255) << 8) | (Math.round(b.color[2] * 255) << 16));
    stats.spawned++;
    let i = -1;
    if (pools.b2x4.live + pools.box.live >= LIVE_MAX) {
      // at the cap the newest brick wins: it marks where something just came apart, the one it replaces has been
      // in the air longest (slots are handed out round the pool, so the cursor points at about the oldest)
      for (let tries = 0; tries < 96 && i < 0; tries++) {
        const c = P.cursor;
        P.cursor = P.cursor + 1 >= Math.max(P.high, P.reserved + 1) ? P.reserved : P.cursor + 1;
        if (c < P.high && P.state[c] === LIVE) i = c;
      }
      if (i < 0) { stats.dropped++; return false; }
      release(P, i);
      stats.recycled++;
    } else i = alloc(P);
    P.px[i] = b.x; P.py[i] = b.y; P.pz[i] = b.z;
    P.vx[i] = v[0]; P.vy[i] = v[1]; P.vz[i] = v[2];
    P.ex[i] = 0; P.ey[i] = b.rotY || 0; P.ez[i] = 0;
    P.wx[i] = jitter.range(-5, 5); P.wy[i] = jitter.range(-4, 4); P.wz[i] = jitter.range(-5, 5);
    P.sx[i] = b.sx; P.sy[i] = b.sy; P.sz[i] = b.sz;
    P.lite[i] = jitter.range(0.45, 1.5);
    P.half[i] = (b.kind === 'b2x4' ? COURSE * b.sy : Math.min(b.sx, b.sy, b.sz)) / 2;
    P.timer[i] = 0;
    P.state[i] = LIVE; P.live++;
    P.mesh.setColorAt(i, _c.setRGB(b.color[0], b.color[1], b.color[2]));
    P.colorDirty = true;
    writeMatrix(P, i);
    return true;
  }

  function settle(P, i) {
    // lie flat: a brick at rest sits on a face, not on an edge
    const q = Math.PI / 2;
    P.ex[i] = Math.round(P.ex[i] / q) * q;
    P.ez[i] = Math.round(P.ez[i] / q) * q;
    P.vx[i] = P.vy[i] = P.vz[i] = 0;
    P.state[i] = RUBBLE; P.live--; P.rubble++;
    P.timer[i] = RUBBLE_SEC;
    writeMatrix(P, i);
  }

  function stepLive(P, dt, f) {
    const n = P.high;
    for (let i = P.reserved; i < n; i++) {
      if (P.state[i] !== LIVE) continue;
      let vx = P.vx[i], vy = P.vy[i], vz = P.vz[i];
      let pull = 0;
      if (f) {
        const dx = P.px[i] - f.x, dz = P.pz[i] - f.z;
        const r = Math.hypot(dx, dz);
        if (r < f.outerR) {
          pull = (1 - r / f.outerR) * f.strength;
          const ir = r > 1e-3 ? 1 / r : 0;
          const rx = dx * ir, rz = dz * ir;
          const h = P.py[i] - f.gy;
          const swirl = VORTEX_TANGENT * pull * Math.min(1, r / 8);
          // bricks are drawn in and up; near the top of the funnel they are thrown outward instead
          const radial = h > 0.8 * FUNNEL_H * f.strength ? 14 * pull : -VORTEX_INWARD * pull;
          const up = VORTEX_UP * pull * P.lite[i] * Math.max(0, 1 - h / FUNNEL_H);
          const k = Math.min(1, VORTEX_COUPLING * P.lite[i] * dt);
          // the field travels with the funnel, so what it holds is carried along instead of being left behind
          const carry = Math.min(1, pull * 1.6);
          vx += (-rz * swirl + rx * radial + f.vx * carry - vx) * k;
          vz += (rx * swirl + rz * radial + f.vz * carry - vz) * k;
          vy += (up - vy) * k * 0.6;
        }
      }
      vy += GRAVITY * dt;
      const sp = Math.hypot(vx, vy, vz);
      const drag = Math.max(0, 1 - DRAG * sp * dt);
      vx *= drag; vy *= drag; vz *= drag;
      let x = P.px[i] + vx * dt, y = P.py[i] + vy * dt, z = P.pz[i] + vz * dt;
      P.ex[i] += P.wx[i] * dt; P.ey[i] += P.wy[i] * dt; P.ez[i] += P.wz[i] * dt;
      // the ground is only looked up on the way down
      if (vy <= 0) {
        const g = groundAt(x, z) + P.half[i];
        if (y <= g) {
          y = g;
          vy = -vy * RESTITUTION;
          vx *= FRICTION; vz *= FRICTION;
          P.wx[i] *= FRICTION; P.wy[i] *= FRICTION; P.wz[i] *= FRICTION;
          if (Math.hypot(vx, vy, vz) < SETTLE_SPEED && pull < RELIFT_PULL) {
            P.px[i] = x; P.py[i] = y; P.pz[i] = z;
            settle(P, i);
            continue;
          }
        }
      }
      P.px[i] = x; P.py[i] = y; P.pz[i] = z;
      P.vx[i] = vx; P.vy[i] = vy; P.vz[i] = vz;
    }
  }

  function stepResting(P, gdt, f, jitterT) {
    const n = P.high;
    for (let i = P.reserved; i < n; i++) {
      const st = P.state[i];
      if (st === RUBBLE) {
        if (f) {
          const r = Math.hypot(P.px[i] - f.x, P.pz[i] - f.z);
          if (r < f.outerR && (1 - r / f.outerR) * f.strength >= RELIFT_PULL && pools.b2x4.live + pools.box.live < LIVE_MAX) {
            // the funnel came back over it: up it goes again (tumble derived from the slot, no rng)
            P.state[i] = LIVE; P.rubble--; P.live++;
            P.vy[i] = 3;
            P.wx[i] = Math.sin(i * 12.9898 + jitterT) * 4; P.wz[i] = Math.cos(i * 78.233 + jitterT) * 4; P.wy[i] = 2;
            continue;
          }
        }
        P.timer[i] -= gdt;
        if (P.timer[i] <= 0) { P.state[i] = FADING; P.rubble--; P.fading++; P.timer[i] = FADE_SEC; }
      } else if (st === FADING) {
        P.timer[i] -= gdt;
        if (P.timer[i] <= 0) { release(P, i); P.free.push(i); } else writeMatrix(P, i, P.timer[i] / FADE_SEC);
      }
    }
  }

  function writeLive(P) {
    const n = P.high;
    for (let i = P.reserved; i < n; i++) if (P.state[i] === LIVE) writeMatrix(P, i);
  }

  function updateAmbient(f, time) {
    if (!f || f.strength <= 0.01) { storm.visible = false; ambientShown = false; return; }
    if (!ambientShown) {
      for (let i = 0; i < AMBIENT_N; i++) storm.setColorAt(i, ctx.materials.color(ambient[i].color));
      storm.instanceColor.needsUpdate = true;
      ambientShown = true;
    }
    storm.visible = true;
    const st = f.strength, spin = time * 2.6;
    for (let i = 0; i < AMBIENT_N; i++) {
      const d = ambient[i];
      const a = spin * 1.6 * d.speed + d.phase;
      const r = d.r * (0.5 + 0.5 * st);
      _p.set(f.x + Math.cos(a) * r, f.gy + 0.6 + d.y * st, f.z + Math.sin(a) * r);
      _e.set(a * 2.2, a, a * 1.7);
      _q.setFromEuler(_e);
      _s.setScalar(d.scale * st);
      storm.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    storm.instanceMatrix.needsUpdate = true;
  }

  /** `f`: the live funnel { x, z, gy, vx, vz, strength, outerR } or null. `gdt` is game time (0 while paused). */
  function update(gdt, f, time) {
    updateAmbient(f, time);
    if (gdt > 0) {
      let left = Math.min(gdt, 0.25), guard = 0;
      while (left > 1e-6 && guard++ < 8) {
        const dt = Math.min(MAX_STEP, left);
        stepLive(pools.b2x4, dt, f); stepLive(pools.box, dt, f);
        left -= dt;
      }
      stepResting(pools.b2x4, gdt, f, time); stepResting(pools.box, gdt, f, time);
      writeLive(pools.b2x4); writeLive(pools.box);
    }
    for (const P of [pools.b2x4, pools.box]) {
      const used = P.live + P.rubble + P.fading;
      P.mesh.count = used > 0 ? P.high : 0;
      P.mesh.visible = used > 0;
      if (P.dirty) { P.mesh.instanceMatrix.needsUpdate = true; P.dirty = false; }
      if (P.colorDirty) { P.mesh.instanceColor.needsUpdate = true; P.colorDirty = false; }
    }
  }

  function clear() {
    for (const P of [pools.b2x4, pools.box]) {
      for (let i = 0; i < P.high; i++) { P.state[i] = FREE; P.mesh.setMatrixAt(i, ZERO); }
      P.free.length = 0; P.cursor = P.reserved; P.high = P.reserved;
      P.live = P.rubble = P.fading = 0;
      P.mesh.count = 0; P.mesh.visible = false; P.mesh.instanceMatrix.needsUpdate = true; P.dirty = false;
    }
    ambientShown = false; storm.visible = false;
    stats.spawned = 0; stats.dropped = 0; stats.recycled = 0; stats.hash = 0x811c9dc5;
  }

  function getStats() {
    const a = pools.b2x4, b = pools.box;
    return {
      live: a.live + b.live, rubble: a.rubble + b.rubble, fading: a.fading + b.fading,
      bricks2x4: a.live + a.rubble + a.fading, boxes: b.live + b.rubble + b.fading,
      spawned: stats.spawned, dropped: stats.dropped, recycled: stats.recycled,
      spawnHash: (stats.hash >>> 0).toString(16), liveMax: LIVE_MAX, capacity: a.capacity + b.capacity,
    };
  }

  function dispose() {
    group.remove(pools.b2x4.mesh, pools.box.mesh, storm);
    pools.b2x4.mesh.dispose(); pools.box.mesh.dispose(); storm.dispose();
    brickGeo.dispose(); boxGeo.dispose();
  }

  return { group, spawn, update, clear, stats: getStats, dispose };
}
