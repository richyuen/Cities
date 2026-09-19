import * as THREE from 'three';
import { TICK_DT } from '../simulation/model.js';

// A small pooled billboard sprite hovering over any building simulation flags as missing road, power, or water
// (see simulation/model.js `unserved`). One shared texture/material for every sprite - they're all identical,
// so there's nothing to gain from per-instance materials (unlike buildings/index.js's spawnConstructionFlash,
// which needs a unique material per flash for its own fade tween).
const ICON_PX = 64;

function buildWarningTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = ICON_PX;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(32, 5);
  g.lineTo(61, 57);
  g.lineTo(3, 57);
  g.closePath();
  g.fillStyle = '#ffcc33';
  g.fill();
  g.lineJoin = 'round';
  g.lineWidth = 4;
  g.strokeStyle = '#3a2400';
  g.stroke();
  g.fillStyle = '#3a2400';
  g.fillRect(29, 21, 6, 19);
  g.beginPath();
  g.arc(32, 47.5, 3.4, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class UnservedIndicators {
  constructor() {
    this.texture = buildWarningTexture();
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.group = new THREE.Group();
    this.group.name = 'buildings-unserved-indicators';
    this.pool = [];
    this.active = new Map(); // building id -> sprite
  }

  _acquire() {
    const sprite = this.pool.pop() || new THREE.Sprite(this.material);
    if (!sprite.parent) this.group.add(sprite);
    sprite.scale.set(3, 3, 1);
    sprite.visible = true;
    return sprite;
  }

  _release(sprite) {
    sprite.visible = false;
    this.pool.push(sprite);
  }

  /** ids: current unserved building ids (from simulation.getUnservedBuildings()); batcher: buildings' BuildingBatcher. */
  sync(ids, batcher) {
    const wanted = new Set(ids);
    for (const [id, sprite] of this.active) {
      if (!wanted.has(id)) { this._release(sprite); this.active.delete(id); }
    }
    for (const id of ids) {
      const info = batcher.get(id);
      if (!info) continue; // not yet batched (or already removed) - picked up on the next sync
      let sprite = this.active.get(id);
      if (!sprite) { sprite = this._acquire(); this.active.set(id, sprite); }
      sprite.position.set(info.cx, info.baseY + info.height + 2, info.cz);
    }
  }

  dispose() {
    for (const sprite of this.group.children.slice()) this.group.remove(sprite);
    this.pool.length = 0;
    this.active.clear();
    this.material.dispose();
    this.texture.dispose();
  }
}

/** Deterministic [0, 2π) phase from a building id — decorrelates flicker/bob without Math.random() (see
 * simulation/model.js's own "no randomness beyond a per-building hash" convention). */
function phaseFromId(id) {
  let h = 0; const s = String(id);
  for (let k = 0; k < s.length; k++) h = (Math.imul(h, 31) + s.charCodeAt(k)) | 0;
  return ((h >>> 0) % 10000 / 10000) * Math.PI * 2;
}

function buildFlameTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = ICON_PX;
  const g = c.getContext('2d');
  g.beginPath();
  g.moveTo(32, 4);
  g.bezierCurveTo(18, 20, 12, 32, 17, 46);
  g.bezierCurveTo(20, 56, 32, 61, 32, 61);
  g.bezierCurveTo(32, 61, 44, 56, 47, 46);
  g.bezierCurveTo(52, 32, 46, 20, 32, 4);
  g.closePath();
  g.fillStyle = '#E3342F';
  g.fill();
  g.beginPath();
  g.moveTo(32, 20);
  g.bezierCurveTo(25, 30, 23, 37, 27, 46);
  g.bezierCurveTo(28.5, 51, 32, 54, 32, 54);
  g.bezierCurveTo(32, 54, 35.5, 51, 37, 46);
  g.bezierCurveTo(41, 37, 39, 30, 32, 20);
  g.closePath();
  g.fillStyle = '#F7C948';
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** A small pooled billboard flame over any building currently on fire (simulation.getBurningBuildings()). */
export class FireIndicators {
  constructor() {
    this.texture = buildFlameTexture();
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true, depthWrite: false });
    this.group = new THREE.Group();
    this.group.name = 'buildings-fire-indicators';
    this.pool = [];
    this.active = new Map(); // building id -> { sprite, phase }
  }

  _acquire() {
    const sprite = this.pool.pop() || new THREE.Sprite(this.material);
    if (!sprite.parent) this.group.add(sprite);
    sprite.visible = true;
    return sprite;
  }

  _release(sprite) {
    sprite.visible = false;
    this.pool.push(sprite);
  }

  /** ids: currently-burning building ids (simulation.getBurningBuildings()); batcher: buildings' BuildingBatcher. */
  sync(ids, batcher) {
    const wanted = new Set(ids);
    for (const [id, entry] of this.active) {
      if (!wanted.has(id)) { this._release(entry.sprite); this.active.delete(id); }
    }
    for (const id of ids) {
      const info = batcher.get(id);
      if (!info) continue;
      let entry = this.active.get(id);
      if (!entry) { entry = { sprite: this._acquire(), phase: phaseFromId(id) }; this.active.set(id, entry); }
      entry.sprite.position.set(info.cx, info.baseY + info.height + 2.5, info.cz);
    }
  }

  update(dt) {
    for (const entry of this.active.values()) {
      entry.phase += dt * 9;
      const flick = 1 + Math.sin(entry.phase) * 0.12 + Math.sin(entry.phase * 2.3) * 0.06;
      entry.sprite.scale.set(2.2 * flick, 2.6 * flick, 1);
    }
  }

  dispose() {
    for (const sprite of this.group.children.slice()) this.group.remove(sprite);
    this.pool.length = 0;
    this.active.clear();
    this.material.dispose();
    this.texture.dispose();
  }
}

const DRONE_SPEED_MPS = 40; // world meters/sec — visual-only, decoupled from the sim's cell-based response math

function buildDroneMats() {
  return {
    body: new THREE.MeshStandardMaterial({ color: 0xe3342f, roughness: 0.4 }),
    accent: new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.5 }),
    arm: new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.6 }),
    rotor: new THREE.MeshStandardMaterial({ color: 0x9ba19d, roughness: 0.3, transparent: true, opacity: 0.55 }),
  };
}

function buildDroneGroup(mats, geoms) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(geoms.body, mats.body));
  const stripe = new THREE.Mesh(geoms.stripe, mats.accent);
  stripe.position.y = 0.05;
  g.add(stripe);
  const armR = 0.75;
  const rotors = [];
  for (let k = 0; k < 4; k++) {
    const ang = Math.PI / 4 + k * Math.PI / 2;
    const ax = Math.cos(ang) * armR, az = Math.sin(ang) * armR;
    const arm = new THREE.Mesh(geoms.arm, mats.arm);
    arm.position.set(ax * 0.5, 0, az * 0.5);
    arm.rotation.y = -ang;
    g.add(arm);
    const rotor = new THREE.Mesh(geoms.rotor, mats.rotor);
    rotor.position.set(ax, 0.05, az);
    g.add(rotor);
    rotors.push(rotor);
  }
  g.userData.rotors = rotors;
  return g;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A small pooled "fire drone" per active fire, flying a straight line from its dispatching fire_department to
 * the burning building (ignores roads entirely — no pathfinding exists in this codebase, see simulation/model.js).
 * "Infinite" drones: every fire gets its own, no dispatch queue/capacity to model. */
export class FireDrones {
  constructor() {
    this.mats = buildDroneMats();
    this.geoms = {
      body: new THREE.BoxGeometry(0.85, 0.35, 0.85),
      stripe: new THREE.BoxGeometry(0.9, 0.1, 0.28),
      arm: new THREE.CylinderGeometry(0.035, 0.035, 1.0, 6).rotateZ(Math.PI / 2),
      rotor: new THREE.CylinderGeometry(0.3, 0.3, 0.02, 12),
    };
    this.group = new THREE.Group();
    this.group.name = 'buildings-fire-drones';
    this.pool = [];
    this.active = new Map(); // building id -> { mesh, station, target, elapsed, age }
  }

  _acquire() {
    const mesh = this.pool.pop() || buildDroneGroup(this.mats, this.geoms);
    if (!mesh.parent) this.group.add(mesh);
    mesh.visible = true;
    return mesh;
  }

  _release(mesh) {
    mesh.visible = false;
    this.pool.push(mesh);
  }

  /** ids: burning building ids; getDispatch(id) -> {stationId, elapsed, duration} | null (simulation.getFireDispatch);
   * batcher: buildings' BuildingBatcher, used to resolve both the station's and the building's world positions. */
  sync(ids, getDispatch, batcher) {
    const wanted = new Map(); // id -> dispatch
    for (const id of ids) {
      const d = getDispatch(id);
      if (d && d.stationId != null) wanted.set(id, d);
    }
    for (const [id, entry] of this.active) {
      if (!wanted.has(id)) { this._release(entry.mesh); this.active.delete(id); }
    }
    for (const [id, d] of wanted) {
      const station = batcher.get(d.stationId), target = batcher.get(id);
      if (!station || !target) continue; // not yet batched - picked up on a later sync
      let entry = this.active.get(id);
      if (!entry) { entry = { mesh: this._acquire(), age: 0 }; this.active.set(id, entry); }
      entry.station = station; entry.target = target; entry.elapsed = d.elapsed;
    }
  }

  // `entry.elapsed` only advances once per sim tick (2 Hz, see simulation/model.js TICK_DT) but update() runs
  // once per render frame (usually ~60 Hz), so using it directly made the drone's position a staircase that
  // visibly jumped every tick instead of gliding. `dispTicks` dead-reckons forward every frame at the same
  // average rate real ticks accumulate (dt * clock.timeScale / TICK_DT — zero while paused), then gently pulls
  // toward the authoritative `entry.elapsed` each frame so it can't drift, snapping only on a large discrepancy
  // (e.g. a pause/resume or a big backlog of ticks landing at once).
  update(dt, ctx) {
    const scale = ctx?.clock && !ctx.clock.paused ? (ctx.clock.timeScale || 0) : 0;
    for (const entry of this.active.values()) {
      const { station, target, mesh } = entry;
      entry.age += dt;
      if (entry.dispTicks == null) entry.dispTicks = entry.elapsed || 0;
      entry.dispTicks += dt * scale / TICK_DT;
      const diff = (entry.elapsed || 0) - entry.dispTicks;
      entry.dispTicks += Math.abs(diff) > 1.5 ? diff : diff * Math.min(1, dt * 4);
      const elapsedSec = entry.dispTicks * TICK_DT;
      const dist = Math.hypot(target.cx - station.cx, target.cz - station.cz);
      const travelTime = Math.max(1, dist / DRONE_SPEED_MPS);
      const travelP = clamp01(elapsedSec / travelTime);
      const x = station.cx + (target.cx - station.cx) * travelP;
      const z = station.cz + (target.cz - station.cz) * travelP;
      const arcH = Math.sin(Math.PI * travelP) * 4;
      const baseY = Math.max(target.baseY + target.height, station.baseY + station.height) + 3;
      const bob = travelP >= 1 ? Math.sin(entry.age * 2.4) * 0.35 : 0;
      mesh.position.set(x, baseY + arcH + bob, z);
      mesh.rotation.y += dt * 1.6;
      for (const r of mesh.userData.rotors) r.rotation.y += dt * 30;
    }
  }

  dispose() {
    for (const mesh of this.group.children.slice()) this.group.remove(mesh);
    this.pool.length = 0;
    this.active.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const g of Object.values(this.geoms)) g.dispose();
  }
}
