import * as THREE from 'three';
import {
  K_HEIGHT, K_HIP_Y, K_BONE, K_FOOT_LATERAL, K_TAIL_BASE, K_TAIL_SEGS, K_MOUTH_FWD, K_MOUTH_Y,
  sideOf, stepPhase, footPlant, tailPoints, emerged, breathT,
} from './kaijuGait.js';
import { KAIJU_VARIANTS, MAX_STATIC } from './kaijuVariants.js';

// Kaiju visuals: a bipedal brick monster, built from unit boxes; which monster is the record's `variant`
// (kaijuVariants.js), rebuilt in place when it changes. Three instanced meshes, so two draw calls plus
// the body's shadow passes while it is on the map (a third while it breathes) and none when idle (the group is
// hidden):
//   kaiju:body    every brick of the body, coloured per instance (casts and receives shadows)
//   kaiju:fire    the two eyes, self-lit boxes (no shadow)
//   kaiju:breath  the fire breath: a stream of flame quads from the mouth to the ground, drawn with the building
//                 fires' shader (buildings.api.createFlameMesh), plus a glow halo where it lands; empty otherwise
// Local space: origin on the ground under the hips, +X forward, +Z right; the group is turned by -heading.
// Where the feet and the tail are comes from kaijuGait.js, the same functions the simulation stomps and sweeps
// with. Everything else here (bob, sway, flame flicker) is presentation.

const FLAMES = 64;
const FLAME_REACH = 52;        // m along the ground from the mouth
const FLAME_SPREAD = 0.3;      // rad, half angle (the simulation's cone)
const LEG_Y = K_HIP_Y - 1.5;   // hip joint
const ANKLE_Y = 2.4;
const FOOT_LIFT = 4;
const TAIL_Y = [21, 15.5, 10, 5.5, 2.4];   // joint heights, body to tip
const TAIL_THICK = [5, 4, 3, 2];

export function createKaijuVisuals(ctx, rng) {
  const group = new THREE.Group();
  group.name = 'disasters:kaiju';
  group.visible = false;

  const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  geo.deleteAttribute('uv');
  const bodyMat = ctx.materials.plastic('white', { instanceColor: true, roughness: 0.35, clearcoat: 0.6 });
  // instance colour tints the diffuse only: the eyes glow the flame colour
  // (a clone: the glow colour is the variant's, and the shared material cache must not see it change)
  const fireMat = ctx.materials.plastic('brightOrange', { instanceColor: true, emissive: 'brightOrange', emissiveIntensity: 2.6 }).clone();
  const env = ctx.modules.get('environment');
  if (env?.status === 'ok') { try { env.api?.setupMaterial?.(bodyMat); env.api?.setupMaterial?.(fireMat); } catch (_) { /* the scene sweep covers it */ } }

  // ---- parts ----
  // Instance layout of kaiju:body: the dynamic bricks first (2 legs: thigh, shin, foot, 3 claws; then the tail: a
  // segment and its plate per joint), then the variant's static bricks. A static part hangs off one of three
  // frames: the body, the head (pitches) or the jaw (opens).
  const parts = [];   // { frame, m: Matrix4 (frame-local), color }
  const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  function part(frame, color, x, y, z, sx, sy, sz, rz = 0) {
    _q.setFromEuler(_e.set(0, 0, rz));
    parts.push({ frame, color, m: new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)) });
  }
  const HEAD_PIVOT = new THREE.Vector3(5.6, 46.4, 0), JAW_HINGE = new THREE.Vector3(8, 47.6, 0);
  const BODY_PIVOT = new THREE.Vector3(0, K_HIP_Y, 0);

  const DYN_LEG = 6, TAIL0 = 2 * DYN_LEG, DYN = TAIL0 + K_TAIL_SEGS * 2;
  const body = new THREE.InstancedMesh(geo, bodyMat, DYN + MAX_STATIC);
  body.name = 'kaiju:body';
  body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  body.frustumCulled = false;
  body.castShadow = true; body.receiveShadow = true;

  const fire = new THREE.InstancedMesh(geo, fireMat, 2);
  fire.name = 'kaiju:fire';
  fire.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fire.frustumCulled = false;
  fire.castShadow = false; fire.receiveShadow = false;
  fire.count = 2;
  group.add(body, fire);

  /** Rebuild the body as variant `index` (kaijuVariants.js): its static bricks, every instance colour, the eyes. */
  let variant = null, built = -1;
  function buildBody(index) {
    built = index;
    variant = KAIJU_VARIANTS[index] || KAIJU_VARIANTS[0];
    parts.length = 0;
    variant.build(part);
    const col = (name) => ctx.materials.color(name);
    for (let l = 0; l < 2; l++) for (let k = 0; k < DYN_LEG; k++) body.setColorAt(l * DYN_LEG + k, col(variant.legs[k]));
    for (let i = 0; i < K_TAIL_SEGS; i++) {
      body.setColorAt(TAIL0 + i * 2, col(i === K_TAIL_SEGS - 1 ? variant.tail.tip : variant.tail.seg));
      body.setColorAt(TAIL0 + i * 2 + 1, col(variant.tail.plate));
    }
    for (let i = 0; i < parts.length; i++) body.setColorAt(DYN + i, col(parts[i].color));
    body.count = DYN + parts.length;
    body.instanceColor.needsUpdate = true;
    const eye = col(variant.eye.color);
    fire.setColorAt(0, eye); fire.setColorAt(1, eye);
    fire.instanceColor.needsUpdate = true;
    fireMat.emissive.copy(col(variant.eye.glow || variant.eye.color));   // instance colour tints the diffuse only
  }
  buildBody(0);
  // the breath is the building fires' flame shader; without the buildings module it is simply not drawn
  const buildings = ctx.modules.get('buildings');
  const breath = buildings?.status === 'ok' && typeof buildings.api?.createFlameMesh === 'function' ? buildings.api.createFlameMesh(FLAMES + 1, 'kaiju:breath') : null;
  if (breath) group.add(breath);
  const breathParam = breath ? breath.userData.param.array : null;

  // the flame table is seeded once; the stream itself is animated by time, like the funnel's spin
  const flames = [];
  for (let i = 0; i < FLAMES; i++) {
    flames.push({ phase: rng.range(0, 1), speed: rng.range(0.9, 1.5), side: rng.range(-1, 1), up: rng.range(-1, 1), size: rng.range(0.7, 1.3), spin: rng.range(-4, 4) });
  }

  const _m = new THREE.Matrix4(), _bodyM = new THREE.Matrix4(), _headM = new THREE.Matrix4(), _jawM = new THREE.Matrix4(), _t = new THREE.Matrix4();
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0), FWD = new THREE.Vector3(1, 0, 0);
  const _tail = [];
  const _qz45 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);

  /** frame = T(pivot) · R · T(-pivot), then parent · frame */
  function pivoted(out, parent, pivot, rx, rz, lift = 0) {
    _q.setFromEuler(_e.set(rx, 0, rz));
    out.compose(_p.set(pivot.x, pivot.y + lift, pivot.z), _q, _s.set(1, 1, 1));
    _t.makeTranslation(-pivot.x, -pivot.y, -pivot.z);
    out.multiply(_t);
    if (parent) out.premultiply(parent);
    return out;
  }

  /** A box from `a` to `b` (its `axis` laid along the bone), `w` x `d` thick. */
  function bone(i, a, b, axis, w, d, extra = 0.6) {
    _d.subVectors(b, a);
    const len = _d.length() || 1e-3;
    _q.setFromUnitVectors(axis, _d.multiplyScalar(1 / len));
    _p.addVectors(a, b).multiplyScalar(0.5);
    if (axis === UP) _s.set(w, len + extra, d); else _s.set(len + extra, w, d);
    body.setMatrixAt(i, _m.compose(_p, _q, _s));
  }

  /** `k`: the kaiju record; `time`: presentation clock; `groundAt(x, z)`: terrain height. */
  function update(k, time, groundAt) {
    if ((k.variant | 0) !== built) buildBody(k.variant | 0);
    const gy = groundAt(k.x, k.z);
    const up = emerged(k);
    group.position.set(k.x, gy - (1 - up) * (K_HEIGHT + 4), k.z);
    group.rotation.y = -k.heading;
    group.visible = true;
    const ch = Math.cos(k.heading), sh = Math.sin(k.heading);
    const ph = stepPhase(k), bt = breathT(k);
    const planted = sideOf(k.steps), swing = -planted;

    // feet in local space: the planted one stays where it landed, the other swings to its next plant
    const feet = [null, null];
    let lowest = Infinity;
    for (const side of [1, -1]) {
      const f = side > 0 ? k.footR : k.footL;
      let wx = f[0], wz = f[1], lift = 0;
      if (side === swing) {
        const to = footPlant(k, side, k.steps + 1);
        const e = ph * ph * (3 - 2 * ph);
        wx += (to[0] - wx) * e; wz += (to[1] - wz) * e;
        lift = Math.sin(Math.PI * ph) * FOOT_LIFT;
      }
      const dx = wx - k.x, dz = wz - k.z;
      const foot = { x: dx * ch + dz * sh, y: groundAt(wx, wz) - gy + lift, z: -dx * sh + dz * ch, lift };
      feet[side > 0 ? 0 : 1] = foot;
      // the hip may not be higher than a straight leg allows
      const horiz = Math.hypot(foot.x, foot.z - side * K_FOOT_LATERAL);
      const reach = 2 * K_BONE - 0.4;
      lowest = Math.min(lowest, foot.y + ANKLE_Y + Math.sqrt(Math.max(1, reach * reach - horiz * horiz)));
    }
    const bob = -0.8 * Math.cos(2 * Math.PI * ph) + Math.sin(time * 1.3) * 0.15;
    const drop = Math.min(0, lowest - (LEG_Y + bob));
    const lean = -0.04 - 0.1 * (bt > 0 ? Math.min(1, bt * 5) : 0);
    const roll = 0.05 * planted * Math.sin(Math.PI * ph) + Math.sin(time * 0.7) * 0.012;
    pivoted(_bodyM, null, BODY_PIVOT, roll, lean, bob + drop);
    const breathing = bt > 0 ? Math.min(1, bt * 5, (1 - bt) * 8) : 0;
    pivoted(_headM, _bodyM, HEAD_PIVOT, 0, Math.sin(time * 0.9) * 0.04 - 0.3 * breathing);
    _jawM.copy(_headM).multiply(_t.makeTranslation(JAW_HINGE.x, JAW_HINGE.y, JAW_HINGE.z))
      .multiply(_t.makeRotationZ(-0.08 - 0.5 * breathing - Math.max(0, Math.sin(time * 0.6)) * 0.05));
    for (let i = 0; i < parts.length; i++) {
      const pt = parts[i];
      body.setMatrixAt(DYN + i, _m.multiplyMatrices(pt.frame === 'body' ? _bodyM : pt.frame === 'head' ? _headM : _jawM, pt.m));
    }

    // legs: two-bone IK from the hip joint to the ankle, knee forward
    for (let l = 0; l < 2; l++) {
      const side = l === 0 ? 1 : -1, foot = feet[l], o = l * DYN_LEG;
      _a.set(0, LEG_Y, side * K_FOOT_LATERAL).applyMatrix4(_bodyM);
      _b.set(foot.x, foot.y + ANKLE_Y, foot.z);
      _d.subVectors(_b, _a);
      const dist = Math.min(2 * K_BONE - 0.1, Math.max(4, _d.length()));
      _d.normalize();
      _b.copy(_a).addScaledVector(_d, dist); // the ankle the leg can actually reach
      _n.copy(FWD).addScaledVector(_d, -FWD.dot(_d));
      if (_n.lengthSq() < 1e-6) _n.set(0, 0, 1); else _n.normalize();
      const knee = _n.multiplyScalar(Math.sqrt(Math.max(0, K_BONE * K_BONE - dist * dist / 4))).addScaledVector(_d, dist / 2).add(_a);
      bone(o, _a, knee, UP, 5.4, 5.8, 1.6);
      bone(o + 1, knee, _b, UP, 4.2, 4.6, 1.2);
      const pitch = foot.lift > 0 ? -0.35 * Math.sin(Math.PI * ph) : 0;
      _q.setFromEuler(_e.set(0, 0, pitch));
      body.setMatrixAt(o + 2, _m.compose(_p.set(foot.x + 1.6, foot.y + 1.3, foot.z), _q, _s.set(9, 2.6, 6.4)));
      for (let c = 0; c < 3; c++) {
        body.setMatrixAt(o + 3 + c, _m.compose(_p.set(foot.x + 6.6, foot.y + 0.7 + pitch * 5, foot.z + (c - 1) * 2.1), _q, _s.set(2, 1.4, 1.4)));
      }
    }

    // tail: the simulation's sample points are its joints
    tailPoints(k, _tail);
    _a.set(-K_TAIL_BASE - 3, TAIL_Y[0], 0).applyMatrix4(_bodyM);
    for (let i = 0; i < K_TAIL_SEGS; i++) {
      const dx = _tail[i * 2] - k.x, dz = _tail[i * 2 + 1] - k.z;
      _b.set(dx * ch + dz * sh, TAIL_Y[i + 1] + Math.sin(time * 1.1 - i * 0.7) * 0.25 * (i + 1), -dx * sh + dz * ch);
      const th = TAIL_THICK[i];
      bone(TAIL0 + i * 2, _a, _b, FWD, th, th * 1.1, 1.4);
      // its back plate: the same orientation, stood on a corner
      const ps = variant.tail.plateSize(i, K_TAIL_SEGS), pt = variant.tail.plateThick(i, K_TAIL_SEGS);
      _n.set(0, 1, 0).applyQuaternion(_q);
      _p.addVectors(_a, _b).multiplyScalar(0.5).addScaledVector(_n, th / 2);
      _q.multiply(_qz45);
      body.setMatrixAt(TAIL0 + i * 2 + 1, _m.compose(_p, _q, _s.set(ps, ps, pt)));
      _a.copy(_b);
    }
    body.instanceMatrix.needsUpdate = true;

    // eyes
    for (let e = 0; e < 2; e++) {
      _m.compose(_p.set(11.8, 51.5, (e ? 1 : -1) * 3.55), _q.identity(), _s.set(variant.eye.w, variant.eye.h, 0.35)).premultiply(_headM);
      fire.setMatrixAt(e, _m);
    }
    fire.instanceMatrix.needsUpdate = true;

    // fire breath: tongues of flame streaming from the mouth down to the ground ahead, a glow where they land
    if (breath && bt > 0) {
      const front = Math.min(1, bt * 3.5), back = Math.max(0, (bt - 0.8) / 0.2);
      const m0 = _a.set(K_MOUTH_FWD + 1, K_MOUTH_Y - 0.5, 0).applyMatrix4(_headM);
      const env = ctx.modules.get('environment');
      const night = env?.status === 'ok' && Number.isFinite(env.api?.state?.night) ? Math.max(0, Math.min(1, env.api.state.night)) : 0;
      const u0 = breath.material.uniforms;
      u0.uTime.value = time; u0.uGlow.value = 2.6 + 0.8 * night; u0.uHalo.value = 0.25 + 0.75 * night;
      _q.identity();
      let n = 0;
      for (let i = 0; i < FLAMES; i++) {
        const f = flames[i];
        const u = (f.phase + time * 1.1 * f.speed) % 1;
        if (u > front || u < back) continue;
        const reach = u * FLAME_REACH, wide = reach * Math.tan(FLAME_SPREAD);
        const fall = Math.pow(u, 0.85);
        const size = (3.5 + 6.5 * u) * f.size;
        _p.set(m0.x + reach, m0.y * (1 - fall) + 1.5 + size * 0.3 + f.up * wide * 0.25 * (1 - u), m0.z + f.side * wide);
        breath.setMatrixAt(n, _m.compose(_p, _q, _s.set(size, size * 1.5, 1)));
        // a tongue reddens as it leaves the mouth; the jet stays dense right to where it lands
        const o = n * 4;
        breathParam[o] = u * 0.7; breathParam[o + 1] = f.phase; breathParam[o + 2] = 1; breathParam[o + 3] = 0;
        n++;
      }
      // the glow on the ground where the jet lands
      if (front > 0.6) {
        const hs = 28 * Math.min(1, (front - 0.6) / 0.4) * (1 - back);
        breath.setMatrixAt(n, _m.compose(_p.set(m0.x + FLAME_REACH * 0.9, 4, m0.z), _q, _s.set(hs, hs, 1)));
        const o = n * 4;
        breathParam[o] = 0; breathParam[o + 1] = 0.5; breathParam[o + 2] = 1; breathParam[o + 3] = 1;
        n++;
      }
      breath.count = n; breath.visible = n > 0;
      breath.instanceMatrix.needsUpdate = true; breath.userData.param.needsUpdate = true;
    } else if (breath) { breath.count = 0; breath.visible = false; }
  }

  function dispose() {
    group.remove(body, fire);
    body.dispose(); fire.dispose(); fireMat.dispose();
    if (breath) { group.remove(breath); breath.dispose(); }
    geo.dispose();
  }

  return { group, update, dispose };
}
