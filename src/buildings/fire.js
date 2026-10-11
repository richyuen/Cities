import * as THREE from 'three';
import { phaseFromId } from './indicators.js';

// A burning building, drawn: flame bricks on the roof and out of the windows, and a column of smoke bricks above
// it. Two instanced meshes of unit boxes for the whole city, so two draw calls while anything burns and none when
// nothing does (both are hidden):
//   buildings:fire-flames  self-lit, coloured per instance yellow -> orange -> red as a flame rises
//   buildings:fire-smoke   translucent dark grey, the cue that carries by day and from far away
// Which buildings burn, and how hard, is the simulation's (b.onFire, b.fireElapsed / b.fireDuration,
// b.fireSeverity on the world record). Everything here is presentation: it runs on the frame's dt, so a fire lit
// while the clock is paused is drawn at once and keeps flickering.

const MAX_FLAMES = 2400;
const MAX_SMOKE = 900;
const FLAMES_PER_BUILDING = 160;
const SMOKE_PER_BUILDING = 56;
const MIN_FLAMES = 8;            // per building, however many are burning
const MIN_SMOKE = 5;
const TABLE = 256;
const RAMP_SEC = 0.6;            // a new fire takes hold over this long
const WALL_INSET = 0.75;         // m, the generator's body inset per side
const FLAME_GLOW = 4.5;           // red needs >= 4 to bloom at night (ARCHITECTURE §7)
const WINDOW_SHARE = 0.4;        // of a building's flames, when it has windows to burn out of

function hash32(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
const unit = (n) => hash32(n) / 4294967296;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isWindow = (mat) => typeof mat === 'string' && (mat.startsWith('win') || mat.startsWith('trans'));

export class BuildingFires {
  constructor(ctx, rng) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'buildings-fires';

    const geo = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    geo.deleteAttribute('uv');
    this.geo = geo;
    // The glow follows the instance colour (the same patch as the overlay plates in views/overlay.js), so a flame
    // is yellow at its root and red at its tip instead of one flat orange. A clone: the cached material is shared.
    const flameMat = ctx.materials.plastic('white', { instanceColor: true, emissive: 'white', emissiveIntensity: FLAME_GLOW }).clone();
    flameMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA ) || defined( USE_INSTANCING_COLOR )
	totalEmissiveRadiance *= vColor.rgb;
#endif`
      );
    };
    this.flameMat = flameMat;
    const smokeMat = ctx.materials.plastic('white', { instanceColor: true, roughness: 0.9, clearcoat: 0.05 }).clone();
    smokeMat.transparent = true;
    smokeMat.opacity = 0.78;
    smokeMat.depthWrite = false;
    this.smokeMat = smokeMat;
    const env = ctx.modules.get('environment');
    if (env?.status === 'ok') { try { env.api?.setupMaterial?.(flameMat); env.api?.setupMaterial?.(smokeMat); } catch (_) { /* the scene sweep covers it */ } }

    const inst = (mat, n, name) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = name;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = false; mesh.receiveShadow = false;
      mesh.count = 0;
      mesh.visible = false;
      this.group.add(mesh);
      return mesh;
    };
    this.flames = inst(flameMat, MAX_FLAMES, 'buildings:fire-flames');
    this.smoke = inst(smokeMat, MAX_SMOKE, 'buildings:fire-smoke');
    this.smoke.renderOrder = 2;

    // seeded once; the fire itself is animated by time, like the kaiju's flame stream
    this.table = [];
    for (let i = 0; i < TABLE; i++) {
      this.table.push({ phase: rng.range(0, 1), speed: rng.range(0.8, 1.4), size: rng.range(0.7, 1.3), dx: rng.range(-1, 1), dz: rng.range(-1, 1), spin: rng.range(-3, 3) });
    }

    // kept dim at the root: a brighter yellow tone-maps to white by day; the red tip carries the bloom
    this.yellow = new THREE.Color(0.42, 0.13, 0.008);
    this.orange = new THREE.Color(0.55, 0.08, 0.005);
    this.red = new THREE.Color(0.9, 0.04, 0.01);
    this.smokeLow = new THREE.Color(0.015, 0.013, 0.012);
    this.smokeHigh = new THREE.Color(0.13, 0.13, 0.135);

    this.active = new Map();   // building id -> entry
    this.time = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();
  }

  /** Where one building burns: roof points (its studs) and its windows, picked by a hash of the id. */
  _anchors(id, rec, b, batcher) {
    const cs = this.ctx.world.cellSize;
    const hw = Math.max(1, (b.w || 1) * cs / 2 - WALL_INSET), hd = Math.max(1, (b.d || 1) * cs / 2 - WALL_INSET);
    const area = 4 * hw * hd, side = Math.sqrt(area);
    const seed = hash32(Math.round(phaseFromId(id) * 1e6) + 1);
    const want = Math.round(clamp(22 + area * 0.1 + rec.height * 1.1, 28, FLAMES_PER_BUILDING));

    // windows: thin plates on the walls; the flame leans out along the plate's thin axis, away from the centre
    const wins = [];
    for (let k = 0; k < rec.parts.length; k++) {
      if (!isWindow(rec.parts[k].mat) || rec.hidden.has(k)) continue;
      const bb = batcher.partBox(rec, k);
      const sx = bb.max.x - bb.min.x, sz = bb.max.z - bb.min.z;
      const x = (bb.min.x + bb.max.x) / 2, y = (bb.min.y + bb.max.y) / 2, z = (bb.min.z + bb.max.z) / 2;
      if (y < rec.baseY + 2) continue;   // the ground floor is hidden behind the street
      if (sx < sz) wins.push(x, y, z, Math.sign(x - rec.cx) || 1, 0); else wins.push(x, y, z, 0, Math.sign(z - rec.cz) || 1);
    }
    const nWin = Math.min(wins.length / 5, Math.round(want * WINDOW_SHARE));
    const nRoof = want - nWin;

    // x, y, z, outward x, outward z per anchor; roof anchors have no outward direction
    const out = new Float32Array(want * 5);
    const studs = rec.studs || [];
    let roofTop = -Infinity;
    for (const s of studs) if (s.y > roofTop) roofTop = s.y;
    // the upper half of the stud field is the roof; lower studs are ledges and porches
    const roofStuds = studs.filter((s) => s.y >= rec.baseY + rec.height * 0.5);
    for (let k = 0; k < nRoof; k++) {
      const o = k * 5;
      if (roofStuds.length) {
        const s = roofStuds[hash32(seed + k * 7919) % roofStuds.length];
        out[o] = s.x; out[o + 1] = s.y; out[o + 2] = s.z;
      } else {
        out[o] = rec.cx + (unit(seed + k * 31) * 2 - 1) * hw * 0.85;
        out[o + 1] = rec.baseY + rec.height;
        out[o + 2] = rec.cz + (unit(seed + k * 57 + 3) * 2 - 1) * hd * 0.85;
      }
    }
    const nWinAll = wins.length / 5;
    for (let k = 0; k < nWin; k++) {
      const w = (hash32(seed + k * 104729 + 11) % nWinAll) * 5, o = (nRoof + k) * 5;
      for (let c = 0; c < 5; c++) out[o + c] = wins[w + c];
    }
    return {
      anchors: out, count: want, nRoof, cx: rec.cx, cz: rec.cz,
      topY: Number.isFinite(roofTop) ? Math.max(roofTop, rec.baseY + rec.height * 0.8) : rec.baseY + rec.height,
      side,
      flameSize: clamp(1.4 + side * 0.08, 1.9, 3.6),
      flameRise: clamp(5 + side * 0.3, 7, 13),
      smokeCount: Math.round(clamp(18 + side * 1.2, 24, SMOKE_PER_BUILDING)),
      smokeRise: clamp(26 + side * 1.1 + rec.height * 0.3, 30, 60),
      smokeSize: clamp(3 + side * 0.2, 4, 8.5),
    };
  }

  /** ids: buildings on fire (simulation.getBurningBuildings(), or the showcase's staged set). Cheap when nothing
   * changed, so it is called every frame and a fire shows without waiting for a simulation tick. */
  sync(ids, batcher) {
    if (!ids.length && !this.active.size) return;
    const world = this.ctx.world;
    for (const id of this.active.keys()) if (!ids.includes(id)) this.active.delete(id);
    for (const id of ids) {
      const rec = batcher.get(id), b = world.buildings.get(id);
      if (!rec || !b) { this.active.delete(id); continue; }   // not batched yet, or already gone
      let e = this.active.get(id);
      if (!e) {
        // a fire that is already under way (a loaded save) does not flare up again
        e = { id, gen: -1, b, age: (b.fireElapsed || 0) > 1 ? RAMP_SEC : 0, seed: hash32(Math.round(phaseFromId(id) * 1e6) + 7), shape: null };
        this.active.set(id, e);
      }
      e.b = b;
      if (e.gen !== rec.gen) { e.shape = this._anchors(id, rec, b, batcher); e.gen = rec.gen; }
    }
  }

  /** 0..1: how hard a building burns now. It takes hold, burns at its severity, and dies down as it burns out. */
  _strength(e) {
    const b = e.b;
    const progress = b.fireDuration > 0 ? clamp((b.fireElapsed || 0) / b.fireDuration, 0, 1) : 0;
    const severity = Number.isFinite(b.fireSeverity) ? b.fireSeverity : 0.5;
    const build = 0.7 + 0.3 * clamp(progress / 0.25, 0, 1);
    const fade = progress > 0.9 ? 1 - 0.7 * (progress - 0.9) / 0.1 : 1;
    return clamp(e.age / RAMP_SEC, 0, 1) * (0.7 + 0.4 * severity) * build * fade;
  }

  update(dt) {
    const flames = this.flames, smoke = this.smoke;
    if (!this.active.size) {
      if (flames.visible) { flames.count = 0; flames.visible = false; smoke.count = 0; smoke.visible = false; }
      return;
    }
    this.time += dt;
    const time = this.time, table = this.table;
    const { _m: m, _q: q, _e: eu, _p: p, _s: s, _c: c } = this;

    // every burning building is drawn; when a great many burn at once each gets a smaller share
    let wantF = 0, wantS = 0;
    for (const e of this.active.values()) { wantF += e.shape.count; wantS += e.shape.smokeCount; }
    const shareF = Math.min(1, MAX_FLAMES / wantF), shareS = Math.min(1, MAX_SMOKE / wantS);
    const wind = this.ctx.world.weather?.wind;
    const wx = Number.isFinite(wind?.[0]) ? clamp(wind[0], -8, 8) : 0, wz = Number.isFinite(wind?.[1]) ? clamp(wind[1], -8, 8) : 0;

    let nf = 0, ns = 0;
    for (const e of this.active.values()) {
      e.age += dt;
      const sh = e.shape, k = this._strength(e);
      if (k <= 0.01) continue;
      const a = sh.anchors;

      const count = Math.min(Math.max(MIN_FLAMES, Math.floor(sh.count * shareF)), sh.count, MAX_FLAMES - nf);
      // spread a reduced share over roof and windows alike
      const step = sh.count / Math.max(1, count);
      for (let i = 0; i < count; i++) {
        const ai = Math.min(sh.count - 1, Math.floor(i * step)), o = ai * 5;
        const t = table[(e.seed + ai * 13) & (TABLE - 1)];
        const u = (t.phase + time * 1.15 * t.speed) % 1;
        const onWall = ai >= sh.nRoof;
        const rise = sh.flameRise * t.size * k * (onWall ? 0.7 : 1);
        const size = sh.flameSize * t.size * (0.35 + 0.65 * k) * (1 - u * 0.75) * (onWall ? 0.9 : 1);
        const lean = onWall ? 0.5 + u * 1.2 : 0;
        p.set(
          a[o] + a[o + 3] * lean + t.dx * u * 0.9,
          a[o + 1] + size * 0.4 + rise * u,
          a[o + 2] + a[o + 4] * lean + t.dz * u * 0.9,
        );
        q.setFromEuler(eu.set(0, t.spin * time + t.phase * 6.283, 0));
        m.compose(p, q, s.set(size, size * 1.5, size));
        flames.setMatrixAt(nf, m);
        if (u < 0.45) c.copy(this.yellow).lerp(this.orange, u / 0.45); else c.copy(this.orange).lerp(this.red, (u - 0.45) / 0.55);
        flames.setColorAt(nf, c);
        nf++;
      }

      const sc = Math.min(Math.max(MIN_SMOKE, Math.floor(sh.smokeCount * shareS)), sh.smokeCount, MAX_SMOKE - ns);
      for (let i = 0; i < sc; i++) {
        const t = table[(e.seed + 97 + i * 29) & (TABLE - 1)];
        const u = (t.phase + time * 0.11 * t.speed) % 1;
        const h = u * sh.smokeRise * (0.5 + 0.5 * k);
        // a puff swells as it climbs, and thins out at the top instead of popping
        const grow = Math.min(1, u / 0.12), thin = u > 0.8 ? (1 - u) / 0.2 : 1;
        const size = sh.smokeSize * t.size * (0.45 + 1.1 * u) * grow * thin * (0.5 + 0.5 * k);
        const spread = sh.side * 0.2 + h * 0.1;
        p.set(
          sh.cx + t.dx * spread + wx * h * 0.09,
          sh.topY + 1.5 + h,
          sh.cz + t.dz * spread + wz * h * 0.09,
        );
        q.setFromEuler(eu.set(t.spin * 0.2 * time, t.spin * 0.3 * time + t.phase * 6.283, 0));
        m.compose(p, q, s.set(size, size * 0.85, size));
        smoke.setMatrixAt(ns, m);
        smoke.setColorAt(ns, c.copy(this.smokeLow).lerp(this.smokeHigh, u));
        ns++;
      }
    }

    flames.count = nf; smoke.count = ns;
    flames.visible = nf > 0; smoke.visible = ns > 0;
    if (nf) { flames.instanceMatrix.needsUpdate = true; flames.instanceColor.needsUpdate = true; }
    if (ns) { smoke.instanceMatrix.needsUpdate = true; smoke.instanceColor.needsUpdate = true; }
  }

  dispose() {
    this.group.remove(this.flames, this.smoke);
    this.flames.dispose(); this.smoke.dispose();
    this.geo.dispose();
    this.flameMat.dispose(); this.smokeMat.dispose();
    this.active.clear();
  }
}
