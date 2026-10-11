import * as THREE from 'three';
import { phaseFromId } from './indicators.js';

// A burning building, drawn: tongues of flame on the roof and out of the windows, and a column of smoke above
// it. Two instanced meshes of camera-facing quads for the whole city, so two draw calls while anything burns and
// none when nothing does (both are hidden):
//   buildings:fire-flames  a procedural flame per quad (a noise-licked teardrop, pale core to red rim), drawn
//                          premultiplied so the core is opaque against a noon sky while the rim adds its glow to
//                          whatever is behind it, and radiant enough (> 1.0) for the post bloom to catch at night
//   buildings:fire-smoke   soft noise-edged puffs, lit by the sky by day and by the fire underneath at night
// The instance matrix carries each quad's world position and size (tools read the positions off it); the shape,
// hue and flicker are the shader's, from the per-instance aParam (life, seed, strength, roll) and uTime.
// Which buildings burn, and how hard, is the simulation's (b.onFire, b.fireElapsed / b.fireDuration,
// b.fireSeverity on the world record). Everything here is presentation: it runs on the frame's dt, so a fire lit
// while the clock is paused is drawn at once and keeps flickering.

const MAX_FLAMES = 1400;
const MAX_SMOKE = 900;
const FLAMES_PER_BUILDING = 72;
const SMOKE_PER_BUILDING = 56;
const MIN_FLAMES = 6;            // per building, however many are burning
const MIN_SMOKE = 5;
const TABLE = 256;
const RAMP_SEC = 0.6;            // a new fire takes hold over this long
const WALL_INSET = 0.75;         // m, the generator's body inset per side
const WINDOW_SHARE = 0.4;        // of a building's flames, when it has windows to burn out of

function hash32(n) {
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  n = Math.imul(n ^ (n >>> 16), 0x45d9f3b);
  return (n ^ (n >>> 16)) >>> 0;
}
const unit = (n) => hash32(n) / 4294967296;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const isWindow = (mat) => typeof mat === 'string' && (mat.startsWith('win') || mat.startsWith('trans'));

// Shared by both materials: a quad billboarded in view space around the instance's world position, scaled by the
// instance matrix's columns and rolled by aParam.w, with the fog depth three's fog chunks expect.
const VERT = /* glsl */`
  attribute vec4 aParam;
  varying vec2 vUv;
  varying vec4 vParam;
  #include <fog_pars_vertex>
  void main() {
    vec4 world = modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
    float sx = length( instanceMatrix[ 0 ].xyz ), sy = length( instanceMatrix[ 1 ].xyz );
    vec4 mvPosition = viewMatrix * world;
    float cr = cos( aParam.w ), sr = sin( aParam.w );
    vec2 p = vec2( position.x * sx, position.y * sy );
    mvPosition.xy += vec2( p.x * cr - p.y * sr, p.x * sr + p.y * cr );
    gl_Position = projectionMatrix * mvPosition;
    vUv = uv;
    vParam = aParam;
    #include <fog_vertex>
  }`;

const NOISE = /* glsl */`
  float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
  float vnoise( vec2 p ) {
    vec2 i = floor( p ), f = fract( p );
    f = f * f * ( 3.0 - 2.0 * f );
    return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), f.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
  }
  float fbm( vec2 p ) { return vnoise( p ) * 0.55 + vnoise( p * 2.1 + 7.3 ) * 0.3 + vnoise( p * 4.3 + 19.1 ) * 0.15; }
  float fogAmount( float depth ) {
    #ifdef USE_FOG
      #ifdef FOG_EXP2
        return 1.0 - exp( - fogDensity * fogDensity * depth * depth );
      #else
        return smoothstep( fogNear, fogFar, depth );
      #endif
    #else
      return 0.0;
    #endif
  }`;

// A tongue of flame: a teardrop (wide at the base, tapering up) whose edge is licked by noise scrolling downward,
// so the flame appears to stream upward. The core is pale yellow, the body orange, the rim deep red; a tongue
// that has risen (aParam.x -> 1) is redder, thinner and fainter until it is gone.
const FLAME_FRAG = /* glsl */`
  uniform float uTime, uGlow, uHalo;
  varying vec2 vUv;
  varying vec4 vParam;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float life = vParam.x, seed = vParam.y, k = vParam.z;
    if ( vParam.w > 0.5 ) {
      // a halo: the fire's light on the roof, the smoke and the air around it, pure glow with no body
      float g = 1.0 - smoothstep( 0.0, 1.0, length( p ) );
      g *= g * ( 0.85 + 0.15 * sin( uTime * 7.0 + seed * 40.0 ) );
      float fog = fogAmount( vFogDepth );
      gl_FragColor = vec4( vec3( 1.0, 0.42, 0.08 ) * ( uHalo * g * k * ( 1.0 - fog ) ), 0.0 );
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      return;
    }
    float t = uTime * ( 1.3 + seed * 0.6 ) + seed * 41.0;
    float n = fbm( vec2( p.x * 1.9 + seed * 13.0, p.y * 1.6 - t ) );
    float h = p.y * 0.5 + 0.5;                       // 0 base .. 1 tip
    float w = 0.95 - 0.6 * h;                        // the tongue narrows toward its tip
    float d = length( vec2( p.x / w, ( p.y + 0.2 ) / 1.1 ) );
    d += ( n - 0.5 ) * ( 0.7 + 0.6 * h );            // the tip is torn more than the base
    float body = 1.0 - smoothstep( 0.3, 1.0, d );
    if ( body <= 0.003 ) discard;
    float heat = body * ( 1.0 - h * 0.35 );          // the base is the hottest part
    vec3 rim = vec3( 0.85, 0.07, 0.01 ), mid = vec3( 1.0, 0.42, 0.04 ), core = vec3( 1.0, 0.93, 0.6 );
    vec3 col = mix( rim, mid, smoothstep( 0.05, 0.5, heat ) );
    col = mix( col, core, smoothstep( 0.5, 0.95, heat ) );
    col = mix( col, rim, life * 0.55 );
    float fade = ( 1.0 - life * 0.75 ) * ( 0.6 + 0.4 * k );
    float alpha = smoothstep( 0.0, 0.85, body ) * fade;
    float radiance = uGlow * body * fade;
    float fog = fogAmount( vFogDepth );
    // premultiplied: an opaque core, a rim that only adds its glow
    gl_FragColor = vec4( col * radiance * ( 1.0 - fog ), alpha * ( 1.0 - fog ) );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// A puff of smoke: a noise-torn disc, darker underneath and lighter on top where the sky lights it, with the
// fire's own glow on the puffs nearest the roof (the cue that carries at night).
const SMOKE_FRAG = /* glsl */`
  uniform float uTime, uLight, uEmber;
  uniform vec3 uDark, uLit;
  varying vec2 vUv;
  varying vec4 vParam;
  #include <fog_pars_fragment>
  ${NOISE}
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float life = vParam.x, seed = vParam.y, k = vParam.z;
    float n = fbm( vec2( p.x * 1.5 + seed * 17.0, p.y * 1.5 + seed * 5.0 - uTime * 0.25 ) );
    float d = length( p ) + ( n - 0.5 ) * 0.8;
    float body = 1.0 - smoothstep( 0.25, 1.0, d );
    if ( body <= 0.003 ) discard;
    float top = smoothstep( -0.6, 0.9, p.y + ( n - 0.5 ) * 0.6 );
    vec3 col = mix( uDark, uLit, top * ( 0.35 + 0.65 * life ) ) * uLight;
    float ember = uEmber * ( 1.0 - life ) * ( 1.0 - life ) * ( 1.0 - top * 0.7 ) * k;
    col += vec3( 1.0, 0.38, 0.06 ) * ember;
    float alpha = smoothstep( 0.0, 0.7, body ) * ( 0.95 - life * 0.45 ) * ( 0.65 + 0.35 * k );
    float fog = fogAmount( vFogDepth );
    #ifdef USE_FOG
      col = mix( col, fogColor, fog );
    #endif
    gl_FragColor = vec4( col * alpha, alpha );
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const material = (frag, uniforms, name) => new THREE.ShaderMaterial({
  name,
  uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, uniforms]),
  vertexShader: VERT,
  fragmentShader: frag,
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.CustomBlending,
  blendSrc: THREE.OneFactor,
  blendDst: THREE.OneMinusSrcAlphaFactor,
  blendSrcAlpha: THREE.OneFactor,
  blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  side: THREE.DoubleSide,
  fog: true,
});

// one quad per instance; the per-instance aParam (life, seed, strength, roll / halo flag) rides on the mesh's own
// geometry as mesh.userData.param
function instancedQuads(mat, n, name) {
  const geo = new THREE.PlaneGeometry(1, 1);
  const param = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  param.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aParam', param);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.name = name;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.count = 0;
  mesh.visible = false;
  mesh.userData.param = param;
  return mesh;
}

/** A mesh of up to `n` flame quads for another effect (the kaiju's breath): the same shader as the building
 * fires, with its own material. Per instance: setMatrixAt(i, position + size) and userData.param (life 0..1,
 * seed 0..1, strength 0..1, 0 for a tongue or 1 for a glow halo); the caller sets mesh.count, mesh.visible,
 * the needsUpdate flags, and material.uniforms.uTime / uGlow / uHalo every frame. dispose() frees it. */
export function createFlameMesh(n, name) {
  const mat = material(FLAME_FRAG, { uTime: { value: 0 }, uGlow: { value: 2.4 }, uHalo: { value: 0.1 } }, name);
  const mesh = instancedQuads(mat, n, name);
  mesh.renderOrder = 1;
  const dispose = mesh.dispose.bind(mesh);
  mesh.dispose = () => { dispose(); mesh.geometry.dispose(); mat.dispose(); };
  return mesh;
}

export class BuildingFires {
  constructor(ctx, rng) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'buildings-fires';

    this.flameMat = material(FLAME_FRAG, { uTime: { value: 0 }, uGlow: { value: 2.4 }, uHalo: { value: 0.1 } }, 'BuildingFlames');
    this.smokeMat = material(SMOKE_FRAG, {
      uTime: { value: 0 }, uLight: { value: 1 }, uEmber: { value: 0.35 },
      uDark: { value: new THREE.Color(0.035, 0.032, 0.032) }, uLit: { value: new THREE.Color(0.3, 0.3, 0.32) },
    }, 'BuildingSmoke');
    this.flames = instancedQuads(this.flameMat, MAX_FLAMES, 'buildings:fire-flames');
    this.smoke = instancedQuads(this.smokeMat, MAX_SMOKE, 'buildings:fire-smoke');
    this.flames.renderOrder = 1;
    this.smoke.renderOrder = 2;
    this.group.add(this.flames, this.smoke);

    // seeded once; the fire itself is animated by time, like the kaiju's flame stream
    this.table = [];
    for (let i = 0; i < TABLE; i++) {
      this.table.push({ phase: rng.range(0, 1), speed: rng.range(0.8, 1.4), size: rng.range(0.7, 1.3), dx: rng.range(-1, 1), dz: rng.range(-1, 1), spin: rng.range(-3, 3) });
    }

    this.active = new Map();   // building id -> entry
    this.time = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
  }

  /** Where one building burns: roof points (its studs) and its windows, picked by a hash of the id. */
  _anchors(id, rec, b, batcher) {
    const cs = this.ctx.world.cellSize;
    const hw = Math.max(1, (b.w || 1) * cs / 2 - WALL_INSET), hd = Math.max(1, (b.d || 1) * cs / 2 - WALL_INSET);
    const area = 4 * hw * hd, side = Math.sqrt(area);
    const seed = hash32(Math.round(phaseFromId(id) * 1e6) + 1);
    const want = Math.round(clamp(16 + area * 0.08 + rec.height * 0.6, 20, FLAMES_PER_BUILDING));

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
      flameSize: clamp(3 + side * 0.2, 3.6, 7),
      flameRise: clamp(2.5 + side * 0.2, 3.5, 7),
      haloSize: clamp(side * 1.6 + 8, 14, 40),
      smokeCount: Math.round(clamp(20 + side * 1.2, 26, SMOKE_PER_BUILDING)),
      smokeRise: clamp(26 + side * 1.1 + rec.height * 0.3, 30, 60),
      smokeSize: clamp(5 + side * 0.35, 7, 14),
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
    const { _m: m, _q: q, _p: p, _s: s } = this;
    const fp = flames.userData.param.array, sp = smoke.userData.param.array;
    this.flameMat.uniforms.uTime.value = time;
    this.smokeMat.uniforms.uTime.value = time;
    // the smoke is unlit geometry: it takes the sky's brightness from the environment, and the fire lights it
    // from below, which is most of what one sees of it at night
    const env = this.ctx.modules.get('environment');
    const night = env?.status === 'ok' && Number.isFinite(env.api?.state?.night) ? clamp(env.api.state.night, 0, 1) : 0;
    this.smokeMat.uniforms.uLight.value = 1 - 0.93 * night;
    this.smokeMat.uniforms.uEmber.value = 0.3 + 0.9 * night;
    // by night the fire is the brightest thing in the frame and lights what is near it; by day its glow is faint
    this.flameMat.uniforms.uGlow.value = 2.4 + 0.8 * night;
    this.flameMat.uniforms.uHalo.value = 0.08 + 0.7 * night;

    // every burning building is drawn; when a great many burn at once each gets a smaller share
    let wantF = 0, wantS = 0;
    for (const e of this.active.values()) { wantF += e.shape.count; wantS += e.shape.smokeCount; }
    const shareF = Math.min(1, MAX_FLAMES / wantF), shareS = Math.min(1, MAX_SMOKE / wantS);
    const wind = this.ctx.world.weather?.wind;
    const wx = Number.isFinite(wind?.[0]) ? clamp(wind[0], -8, 8) : 0, wz = Number.isFinite(wind?.[1]) ? clamp(wind[1], -8, 8) : 0;
    q.identity();

    let nf = 0, ns = 0;
    for (const e of this.active.values()) {
      e.age += dt;
      const sh = e.shape, k = this._strength(e);
      if (k <= 0.01) continue;
      const a = sh.anchors;

      // the halo first: one glow over the roof, drawn as a flame instance with no body
      if (nf < MAX_FLAMES) {
        const hs = sh.haloSize * (0.8 + 0.2 * k);
        m.compose(p.set(sh.cx, sh.topY + hs * 0.15, sh.cz), q, s.set(hs, hs, 1));
        flames.setMatrixAt(nf, m);
        const fo = nf * 4;
        fp[fo] = 0; fp[fo + 1] = unit(e.seed); fp[fo + 2] = k; fp[fo + 3] = 1;
        nf++;
      }
      const count = Math.min(Math.max(MIN_FLAMES, Math.floor(sh.count * shareF)), sh.count, MAX_FLAMES - nf);
      // spread a reduced share over roof and windows alike
      const step = sh.count / Math.max(1, count);
      for (let i = 0; i < count; i++) {
        const ai = Math.min(sh.count - 1, Math.floor(i * step)), o = ai * 5;
        const t = table[(e.seed + ai * 13) & (TABLE - 1)];
        // a tongue rises from its anchor, shrinking and reddening, and is reborn at the base
        const u = (t.phase + time * 0.9 * t.speed) % 1;
        const onWall = ai >= sh.nRoof;
        const rise = sh.flameRise * t.size * k * (onWall ? 0.7 : 1);
        const flicker = 0.88 + 0.12 * Math.sin(time * 9 * t.speed + t.phase * 6.283);
        const size = sh.flameSize * t.size * (0.45 + 0.55 * k) * (1 - u * 0.55) * (onWall ? 0.85 : 1) * flicker;
        const lean = onWall ? 0.8 + u * 1.4 : 0;
        p.set(
          a[o] + a[o + 3] * lean + t.dx * u * 0.9,
          a[o + 1] + size * 0.45 + rise * u,
          a[o + 2] + a[o + 4] * lean + t.dz * u * 0.9,
        );
        m.compose(p, q, s.set(size, size * 1.7, 1));
        flames.setMatrixAt(nf, m);
        const fo = nf * 4;
        fp[fo] = u; fp[fo + 1] = t.phase; fp[fo + 2] = k; fp[fo + 3] = 0;
        nf++;
      }

      const sc = Math.min(Math.max(MIN_SMOKE, Math.floor(sh.smokeCount * shareS)), sh.smokeCount, MAX_SMOKE - ns);
      for (let i = 0; i < sc; i++) {
        const t = table[(e.seed + 97 + i * 29) & (TABLE - 1)];
        const u = (t.phase + time * 0.11 * t.speed) % 1;
        const h = u * sh.smokeRise * (0.5 + 0.5 * k);
        // a puff swells as it climbs, and thins out at the top instead of popping
        const grow = Math.min(1, u / 0.12);
        const size = sh.smokeSize * t.size * (0.4 + 1.3 * u) * grow * (0.5 + 0.5 * k);
        const spread = sh.side * 0.2 + h * 0.1;
        p.set(
          sh.cx + t.dx * spread + wx * h * 0.09,
          sh.topY + 1.5 + h,
          sh.cz + t.dz * spread + wz * h * 0.09,
        );
        m.compose(p, q, s.set(size, size, 1));
        smoke.setMatrixAt(ns, m);
        const so = ns * 4;
        sp[so] = u; sp[so + 1] = t.phase; sp[so + 2] = k; sp[so + 3] = t.spin * 0.25 * time + t.phase * 6.283;
        ns++;
      }
    }

    flames.count = nf; smoke.count = ns;
    flames.visible = nf > 0; smoke.visible = ns > 0;
    if (nf) { flames.instanceMatrix.needsUpdate = true; flames.userData.param.needsUpdate = true; }
    if (ns) { smoke.instanceMatrix.needsUpdate = true; smoke.userData.param.needsUpdate = true; }
  }

  dispose() {
    this.group.remove(this.flames, this.smoke);
    this.flames.geometry.dispose(); this.smoke.geometry.dispose();
    this.flames.dispose(); this.smoke.dispose();
    this.flameMat.dispose(); this.smokeMat.dispose();
    this.active.clear();
  }
}
