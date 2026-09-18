import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { installCsmShaderPatch } from './csmPatch.js';
import { skyParams, skySample, smoothstep, lerp, ramp, clamp01, luminance } from './skyMath.js';
import { createSky } from './sky.js';
import { createStars } from './nightSky.js';
import { createRain } from './rain.js';
import { buildShowcase, disposeShowcase } from './showcase.js';

// environment: the one direct light (sun by day, moon by night) through a 3-cascade CSM whose cascades adapt to the
// camera, hemisphere fill, analytic sky dome (gradient + halo + clouds + moon + Milky Way), stars, PMREM environment
// map regenerated as the light moves, exposure, fog that carries the sky/cloud-deck colour, and weather (rain / fog /
// overcast). Everything is tuned against the composer path: shaders emit linear HDR, OutputPass applies ACES.

const DEG = Math.PI / 180;
const ENV_REGEN_MIN_MS = 250;
const ENV_PMREM_SIZE = 512;    // cube size for the sky PMREM (was the implicit default 256 => a 768x1024 atlas,
                                // soft enough to read as a sharp-edged "patch" on glossy reflections instead of a
                                // smooth gradient); doubling it is cheap since regen is throttled, not per-frame
const ENV_INTENSITY = 0.9;      // IBL strength; the sky dome is the environment map, so glossy plastic mirrors it
// FogExp2's factor is exp(-(density*dist)^2): tuned against street-scale distances (tens of metres) under heavy
// rain/fog, the same density is catastrophically stronger at the ~1200-1300m distances the overview/aerial presets
// use (dist going up ~30x squares the exponent ~900x), saturating the fog factor to ~1 across the ENTIRE frame -
// buildings, terrain and water all wash to one flat fog-colour grey with only silhouette edges (thin slivers)
// surviving antialiasing. FOG_CAP_K caps density against the camera's own current reach (D, the same
// camera-to-target distance updateCascades() derives) each frame: cap = FOG_CAP_K / D keeps the fog factor at
// distance D under ~0.55 (still >=45% of the surface colour survives, "hazy but legible" like skyline/street
// already look) while leaving short-range views (D of tens of metres, where the weather formula's natural output
// never gets close to the cap) completely untouched - verified empirically against the exact repro.
const FOG_CAP_K = 0.9;
const SUN_INTENSITY = 4.2;
const MOON_INTENSITY = 0.30;
const MIN_LIGHT_ELEV = 2.5;     // shadow projection floor (degrees); shading colour/intensity still follow the true disc
const SHADOW_MAP_NEAR = 2048, SHADOW_MAP_FAR = 4096;

// colour ramps keyed by sun elevation in degrees (linear RGB)
const SUN_RAMP = [[-6, [1.0, 0.30, 0.08]], [0, [1.0, 0.42, 0.14]], [4, [1.0, 0.56, 0.25]], [10, [1.0, 0.72, 0.45]], [20, [1.0, 0.88, 0.72]], [35, [1.0, 0.96, 0.88]], [90, [1.0, 0.99, 0.96]]];
const HEMI_SKY = [[-12, [0.05, 0.08, 0.20]], [-3, [0.22, 0.18, 0.32]], [2, [0.46, 0.40, 0.52]], [10, [0.50, 0.60, 0.85]], [30, [0.55, 0.72, 1.0]]];
const HEMI_GROUND = [[-12, [0.02, 0.02, 0.03]], [-3, [0.10, 0.06, 0.06]], [2, [0.35, 0.18, 0.10]], [10, [0.40, 0.30, 0.20]], [30, [0.45, 0.38, 0.28]]];
const MOON_COLOR = [0.50, 0.62, 1.0];
const WIND = { clear: [1.2, 0.4], cloudy: [3.0, 1.0], rain: [6.5, 2.2], fog: [0.4, 0.2] };

const S = {
  ctx: null, rng: null, group: null, sky: null, stars: null, hemi: null, csm: null, sun: null,
  fog: null, fogRho0: 0.00025, rain: null, pmrem: null, envScene: null, envRT: null, envHours: -99, envStamp: 0, envElev: 99,
  dirtyTod: true, dirtyEnv: true, sweepAt: -1, sweepStamp: 0, frame: 0, time: 0, subs: [], done: new WeakSet(),
  camKey: '', cascadeKey: '', breaks: [0.035, 0.17, 1], shadowRadius: 1.5,
  lightDir: new THREE.Vector3(0, 1, 0), showcaseGroup: null, params: {}, sp: {},
  _c: new THREE.Color(), _tmp: [0, 0, 0], _acc: [0, 0, 0], _dir: [0, 0, 0], _sun: [0, 0, 0], wind: [1, 0],
  _envOrigin: new THREE.Vector3(0, 0, 0),
};

function weatherFactors(w) {
  const i = clamp01(w.intensity ?? 0.5);
  const kind = w.kind || 'clear';
  return {
    kind, intensity: i,
    cloud: kind === 'cloudy' ? 0.35 + 0.65 * i : kind === 'rain' ? 0.85 + 0.15 * i : kind === 'fog' ? 0.55 + 0.3 * i : 0,
    rain: kind === 'rain' ? Math.max(0.15, i) : 0,
    fog: kind === 'fog' ? Math.max(0.15, i) : 0,
  };
}

function setV3(u, c) { u.value.set(c[0], c[1], c[2]); }

function applyTod() {
  const ctx = S.ctx, clock = ctx.clock;
  const e = clock.sunElevation / DEG;
  const sd = clock.sunDir, md = clock.moonDir;
  const wf = weatherFactors(ctx.world.weather);
  const sp = skyParams(e, wf, S.sp);
  const overcast = sp.overcast;
  const day = smoothstep(-6, 12, e);
  const sunUp = smoothstep(-1.5, 5, e);
  const night = 1 - smoothstep(-16, -3, e);
  const twilight = smoothstep(-14, -3, e) * (1 - smoothstep(2, 14, e));
  const w = WIND[wf.kind] || WIND.clear;
  S.wind[0] = w[0] * (0.5 + wf.intensity); S.wind[1] = w[1] * (0.5 + wf.intensity);

  // --- direct light: sun by day, moon by night, through the same cascaded shadow rig ---------------------------
  const sc = ramp(SUN_RAMP, e, S._tmp);
  const lum = luminance(sc);
  const sunR = lerp(sc[0], lum * 0.96, overcast * 0.85), sunG = lerp(sc[1], lum * 0.98, overcast * 0.85), sunB = lerp(sc[2], lum * 1.03, overcast * 0.85);
  const sunI = SUN_INTENSITY * sunUp * (1 - 0.93 * overcast) * (1 - 0.3 * wf.fog);
  const moonI = MOON_INTENSITY * night * (1 - 0.92 * overcast);
  const useMoon = moonI > sunI;
  const src = useMoon ? md : sd;
  const elev = Math.max(useMoon ? Math.asin(src.y) / DEG : e, MIN_LIGHT_ELEV) * DEG;
  const h = Math.hypot(src.x, src.z) || 1;
  S.lightDir.set((src.x / h) * Math.cos(elev), Math.sin(elev), (src.z / h) * Math.cos(elev));
  const lr = useMoon ? MOON_COLOR[0] : sunR, lg = useMoon ? MOON_COLOR[1] : sunG, lb = useMoon ? MOON_COLOR[2] : sunB;
  const li = useMoon ? moonI : sunI;
  S.shadowRadius = (useMoon ? 3.0 : 1.5) + 5.0 * overcast + 2.0 * (1 - smoothstep(0, 8, e)) * (1 - night);
  if (S.csm) {
    S.csm.lightDirection.copy(S.lightDir).negate();
    for (const l of S.csm.lights) { l.color.setRGB(lr, lg, lb); l.intensity = li; l.shadow.radius = S.shadowRadius; }
  } else if (S.sun) {
    S.sun.color.setRGB(lr, lg, lb); S.sun.intensity = li; S.sun.shadow.radius = S.shadowRadius;
  }

  // --- hemisphere ----------------------------------------------------------------------------------------------
  const hs = ramp(HEMI_SKY, e, S._tmp);
  const hl = luminance(hs);
  // under a deck the fill is the deck: bright, neutral, slightly cool
  const deck = sp.cloudAmb;
  S.hemi.color.setRGB(lerp(hs[0], lerp(hl, deck[0] * 1.5, 0.6), overcast * 0.9), lerp(hs[1], lerp(hl, deck[1] * 1.5, 0.6), overcast * 0.9), lerp(hs[2], lerp(hl * 1.05, deck[2] * 1.5, 0.6), overcast * 0.9));
  const hg = ramp(HEMI_GROUND, e, S._tmp);
  S.hemi.groundColor.setRGB(lerp(hg[0], hg[1] * 0.9, overcast), hg[1], lerp(hg[2], hg[1] * 1.0, overcast));
  S.hemi.intensity = lerp(0.16, 0.30, day) + 0.26 * twilight + 0.42 * overcast * day + 0.05 * night;

  // --- exposure ------------------------------------------------------------------------------------------------
  const exposure = lerp(1.15, 1.0, day) + 0.12 * twilight - 0.15 * wf.rain - 0.04 * wf.fog - 0.06 * overcast * day;
  ctx.renderer.toneMappingExposure = exposure;

  // --- sky dome ------------------------------------------------------------------------------------------------
  const u = S.sky.uniforms;
  u.uSunDir.value.copy(sd);
  u.uMoonDir.value.copy(md);
  setV3(u.uZenith, sp.zenith); setV3(u.uHorizonAway, sp.horizonAway); setV3(u.uHorizonSun, sp.horizonSun);
  setV3(u.uGlow, sp.glow); setV3(u.uSunDisc, sp.sunDisc); setV3(u.uCloudAmb, sp.cloudAmb); setV3(u.uCloudLit, sp.cloudLit);
  u.uGlowG.value = sp.glowG; u.uGlowK.value = sp.glowK; u.uHorK.value = sp.horK; u.uHazeK.value = sp.hazeK;
  u.uShowSun.value = e > -3 ? 1 : 0;
  u.uCoverage.value = sp.coverage; u.uDensity.value = sp.density; u.uCloudSharp.value = sp.cloudSharp; u.uHaze.value = sp.haze;
  u.uNight.value = night * (1 - overcast) * (1 - 0.8 * smoothstep(0.2, 0.6, wf.cloud));
  // cloud dimming is capped (not driven to 0): the sky shader's own per-pixel cloud alpha already occludes the
  // disc spatially, and a soft glow re-bleeds through that occlusion — stacking a second, near-total global
  // dimmer on top of both of those was what made a moderately clouded moon disappear outright instead of veiling.
  u.uMoon.value = (1 - smoothstep(-6, 4, e)) * (1 - 0.55 * smoothstep(0.4, 0.9, wf.cloud)) * (1 - smoothstep(0.1, 0.5, wf.fog));
  const su = S.stars.material.uniforms;
  su.uNight.value = night * (1 - smoothstep(0.15, 0.7, wf.cloud)) * (1 - wf.fog);
  su.uPixelRatio.value = ctx.renderer.getPixelRatio();
  S.stars.visible = su.uNight.value > 0.001;

  // --- IBL + fog -----------------------------------------------------------------------------------------------
  ctx.scene.environmentIntensity = ENV_INTENSITY * (1 - 0.35 * wf.rain) * (1 - 0.2 * wf.fog) * (1 - 0.15 * overcast);
  // weather's *desired* density; update() clamps the live S.fog.density against camera distance every frame (see
  // FOG_CAP_K above) so this can stay a pure function of weather without knowing about the camera at all.
  S.fogRho0 = 0.00025 + 0.0005 * wf.cloud + 0.0012 * wf.rain + (wf.fog > 0 ? 0.003 + 0.013 * wf.fog : 0);
  S.fog.density = S.fogRho0;
  computeFogColor(sp, night);
  u.uFog.value.set(S.fog.color.r, S.fog.color.g, S.fog.color.b);

  // --- rain ----------------------------------------------------------------------------------------------------
  S._c.setRGB(S.hemi.color.r * 0.85 + 0.05, S.hemi.color.g * 0.85 + 0.05, S.hemi.color.b * 0.85 + 0.06);
  S.rain.set(wf.rain, S.wind, S._c);

  S.params = { elevation: e, day, night, twilight, overcast, exposure, sunIntensity: sunI, moonIntensity: moonI, lightIsMoon: useMoon,
    sunColor: [sunR, sunG, sunB], lightDir: S.lightDir.toArray(), fogDensity: S.fog.density, shadowRadius: S.shadowRadius, weather: wf };
}

/** Fog colour = azimuth-averaged sky radiance just above the horizon (linear; fog blends before tone mapping). */
function computeFogColor(sp, nb) {
  const clock = S.ctx.clock;
  const sun = S._sun; sun[0] = clock.sunDir.x; sun[1] = clock.sunDir.y; sun[2] = clock.sunDir.z;
  const acc = S._acc; acc[0] = acc[1] = acc[2] = 0;
  const el = 1.5 * DEG, n = 8;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    S._dir[0] = Math.cos(a) * Math.cos(el); S._dir[1] = Math.sin(el); S._dir[2] = Math.sin(a) * Math.cos(el);
    skySample(sp, S._dir, sun, S._tmp);
    acc[0] += S._tmp[0]; acc[1] += S._tmp[1]; acc[2] += S._tmp[2];
  }
  // moonlit / night fog keeps a touch of the night dome blue so it never goes to black
  S.fog.color.setRGB(acc[0] / n + 0.004 * nb, acc[1] / n + 0.006 * nb, acc[2] / n + 0.014 * nb);
}

// --- PMREM regeneration: reuse one persistent render target instead of one-per-regen -----------------------------
// CONFIRMED (not theorized) root cause of the whole-game "toothpicked" building bug (docs/reviews/game-r1.md,
// game-r2.md): `PMREMGenerator.fromScene()` allocates a BRAND NEW WebGLRenderTarget (and texture object) on every
// call (see three's src/extras/PMREMGenerator.js `_allocateTargets()` - unconditional `new WebGLRenderTarget(...)`,
// unlike `fromEquirectangular`/`fromCubemap` which accept a target to reuse). regenEnv() used to hand that fresh
// texture straight to `ctx.scene.environment` every ~250ms+ as the sun moves, so a long session churns through many
// distinct texture *objects* over time even though their *content* is the same kind of sky PMREM each time.
// Isolated via a 3-way A/B on the exact critic.mjs churn sequence (replay 5 presets x 4 tods, then re-check
// overview/aerial at dusk/night - shots/game/r3-frozenenv, r3-nodispose, r3-keepfirsttex):
//   - Freezing scene.environment after the FIRST regenEnv() (no further regens at all)            -> clean.
//   - Regenerating every cycle but never disposing old targets (leak instead of dispose)           -> BROKEN.
//   - Regenerating every cycle (fromScene() runs identically each time) but discarding the result   -> clean.
//     and always re-pinning scene.environment to the first texture
// The differentiator is purely whether `scene.environment`'s texture *identity* changes over the session, not
// whether PMREM content is regenerated, and not whether old targets are disposed. Disposal/reuse of GL texture
// IDs was the leading theory going in and is specifically ruled out by the second test above.
// Fix: keep `ctx.scene.environment` pinned to ONE texture forever; refresh its *content* in place by reusing the
// same WebGLRenderTarget across regenerations. `PMREMGenerator.fromScene()` doesn't expose that (no `renderTarget`
// param), so `pmremFromSceneInto()` below replicates its body against the underlying (undocumented, but stable
// across three's PMREM rewrites - same pattern already used for the CSM shader splice in csmPatch.js) private
// pipeline methods, passing in our own persistent target instead of letting it allocate a new one.
function pmremFromSceneInto(pmrem, renderer, scene, sigma, near, far, size, position, rt) {
  const oldTarget = renderer.getRenderTarget();
  const oldActiveCubeFace = renderer.getActiveCubeFace();
  const oldActiveMipmapLevel = renderer.getActiveMipmapLevel();
  const oldXrEnabled = renderer.xr.enabled;
  renderer.xr.enabled = false;
  pmrem._setSize(size);
  rt.depthBuffer = true;
  pmrem._sceneToCubeUV(scene, near, far, rt, position);
  if (sigma > 0) pmrem._blur(rt, 0, 0, sigma);
  pmrem._applyPMREM(rt);
  renderer.setRenderTarget(oldTarget, oldActiveCubeFace, oldActiveMipmapLevel);
  renderer.xr.enabled = oldXrEnabled;
  rt.scissorTest = false;
  rt.viewport.set(0, 0, rt.width, rt.height);
  rt.scissor.set(0, 0, rt.width, rt.height);
  return rt;
}

function regenEnv() {
  const ctx = S.ctx, u = S.sky.uniforms;
  const show = u.uShowSun.value;
  u.uShowSun.value = 0; // the CSM light provides the sun highlight; a 30x disc would alias in the PMREM
  S.sky.mesh.position.set(0, 0, 0);
  S.envScene.add(S.sky.mesh);
  let rt = null;
  try {
    if (!S.envRT) {
      // first regen: use the real public API so PMREMGenerator's own lazy setup (ping-pong target, LOD meshes,
      // blur/GGX materials) runs exactly as upstream intends; we only take over target *reuse* from here on.
      rt = S.pmrem.fromScene(S.envScene, 0.02, 0.1, 100, { size: ENV_PMREM_SIZE });
    } else {
      rt = pmremFromSceneInto(S.pmrem, ctx.renderer, S.envScene, 0.02, 0.1, 100, ENV_PMREM_SIZE, S._envOrigin, S.envRT);
    }
  } catch (e) { ctx.error('[environment] PMREM failed:', e); }
  S.group.add(S.sky.mesh);
  u.uShowSun.value = show;
  if (rt) {
    S.envRT = rt;
    if (ctx.scene.environment !== rt.texture) ctx.scene.environment = rt.texture; // same object every regen after the first
  }
  S.envHours = ctx.clock.hours;
  S.envElev = ctx.clock.sunElevation / DEG;
  S.envStamp = performance.now();
  S.dirtyEnv = false;
}

function setCsmShadowParams() {
  if (!S.csm) return;
  for (const l of S.csm.lights) {
    const cam = l.shadow.camera;
    const texel = (cam.right - cam.left) / l.shadow.mapSize.x;
    l.shadow.normalBias = Math.min(texel * 1.3 + 0.012, 0.45);
    l.shadow.bias = -0.00004;
    l.shadow.radius = S.shadowRadius;
  }
}

/** Cascades follow the camera: tight near split for closeups, the far split reaches only as far as the view needs. */
function updateCascades(cam) {
  if (!S.csm) return;
  const t = S.ctx.controls?.target;
  const D = t ? cam.position.distanceTo(t) : 200;
  const dirY = t ? (t.y - cam.position.y) / Math.max(D, 1e-3) : -0.5;
  const pitch = clamp01(-dirY);
  const maxFar = Math.max(320, Math.min(2400, Math.max(2.4 * D + 150, 1700 * (1 - smoothstep(0.25, 0.6, pitch)))));
  const c1 = Math.max(12, Math.min(140, 0.06 * D + 6));
  const c2 = Math.max(120, Math.min(1100, 0.55 * D + 60));
  const key = `${Math.round(maxFar / 40)}|${Math.round(c1 / 4)}|${Math.round(c2 / 30)}`;
  if (key === S.cascadeKey) return;
  S.cascadeKey = key;
  S.breaks[0] = c1 / maxFar; S.breaks[1] = Math.min(0.9, c2 / maxFar); S.breaks[2] = 1;
  S.csm.maxFar = maxFar;
  S.csm.updateFrustums();
  setCsmShadowParams();
}

function setupMaterial(m) {
  if (!S.csm || !m || S.done.has(m)) return;
  if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshToonMaterial)) return;
  if (m.userData && m.userData.noCSM) return;
  S.done.add(m);
  const hasOwnHook = Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile');
  const prevHook = m.onBeforeCompile;
  const hasOwnKey = Object.prototype.hasOwnProperty.call(m, 'customProgramCacheKey');
  const prevKey = hasOwnKey ? m.customProgramCacheKey.bind(m) : null;
  S.csm.setupMaterial(m);
  if (hasOwnHook) {
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = function (shader, renderer) { prevHook.call(this, shader, renderer); csmHook.call(this, shader, renderer); };
    m.customProgramCacheKey = () => (prevKey ? prevKey() : prevHook.toString()) + '|csm';
  }
  m.needsUpdate = true;
}

function sweep() {
  if (!S.csm) return;
  const seen = new Set();
  S.ctx.scene.traverse((o) => {
    const m = o.material;
    if (!m) return;
    if (Array.isArray(m)) { for (const mm of m) { seen.add(mm); setupMaterial(mm); } }
    else { seen.add(m); setupMaterial(m); }
  });
  // forget materials that left the scene; if one comes back it recompiles once and re-registers
  for (const m of [...S.csm.shaders.keys()]) if (!seen.has(m)) S.csm.shaders.delete(m);
  for (const m of seen) if (S.done.has(m) && m.defines && m.defines.USE_CSM && !S.csm.shaders.has(m)) { S.csm.shaders.set(m, null); m.needsUpdate = true; }
  S.sweepStamp = performance.now();
}

const api = {
  /** Enable cascaded shadows on a lit material (done automatically for everything in ctx.scene on spawn events). */
  setupMaterial(m) { setupMaterial(m); },
  /** Re-scan the scene for new materials now. */
  refreshMaterials() { sweep(); },
  setWeather(kind = 'clear', intensity = 0.5) {
    const wind = WIND[kind] || WIND.clear;
    S.ctx.world.setWeather({ kind, intensity: clamp01(intensity), wind: [wind[0] * (0.5 + intensity), wind[1] * (0.5 + intensity)] });
  },
  /** Current lighting state: { elevation, day, night, twilight, overcast, exposure, sunIntensity, moonIntensity, lightIsMoon, sunColor, lightDir, fogDensity, shadowRadius, weather } */
  get state() { return S.params; },
  /** direction toward the active direct light (sun or moon), elevation floored for the shadow projection */
  get sunDirection() { return S.lightDir; },
  get shadowMode() { return S.csm ? 'csm' : 'single'; },
  /** debugging: the CSM instance (null when using the single-light fallback) */
  get csm() { return S.csm; },
  /** the sky dome mesh (ShaderMaterial; uniforms documented in sky.js) */
  get sky() { return S.sky?.mesh; },
  refreshShadowParams() { setCsmShadowParams(); },
};

export default {
  id: 'environment',
  deps: [],
  order: 15,
  showcaseVariants: ['default', 'rain', 'fog', 'overcast'],
  presets: {
    'environment:default': { pos: [60, 24, 40], target: [-30, 4, 0] },
    'environment:closeup': { pos: [13.5, 2.0, 15.5], target: [3, 2.0, 2] },
    'environment:sky': { pos: [4, 4, 30], target: [-96, 34, 4] },
  },
  api,

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('environment');
    S.group = new THREE.Group();
    S.group.name = 'environment';
    ctx.scene.add(S.group);

    // sky + stars
    S.sky = createSky();
    S.group.add(S.sky.mesh);
    S.stars = createStars(S.rng.fork('stars'), 3200);
    S.group.add(S.stars);
    S.envScene = new THREE.Scene();
    S.pmrem = new THREE.PMREMGenerator(ctx.renderer);

    // fill
    S.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a3a, 0.5);
    S.hemi.name = 'hemi';
    S.group.add(S.hemi);

    // direct light: cascaded shadow maps, falling back to a single fitted light
    if (installCsmShaderPatch()) {
      try {
        S.csm = new CSM({
          camera: ctx.camera, parent: S.group, cascades: 3, maxFar: 1600, mode: 'custom',
          customSplitsCallback: (n, near, far, target) => { for (const b of S.breaks) target.push(b); },
          shadowMapSize: SHADOW_MAP_NEAR, shadowBias: -0.00004, lightDirection: new THREE.Vector3(0, -1, 0).normalize(),
          lightIntensity: 3, lightNear: 1, lightFar: 3600, lightMargin: 360,
        });
        S.csm.fade = true;
        S.csm.lights.forEach((l, i) => { l.name = `sun-cascade-${i}`; });
        // far cascade gets a bigger map so building shadows stay attached at the overview camera
        S.csm.lights[2].shadow.mapSize.set(SHADOW_MAP_FAR, SHADOW_MAP_FAR);
        S.csm.updateFrustums();
        setCsmShadowParams();
      } catch (e) {
        ctx.log('[environment] CSM unavailable, using single shadow light:', e);
        S.csm = null;
      }
    } else {
      ctx.log('[environment] CSM shader splice failed, using single shadow light');
    }
    if (!S.csm) {
      S.sun = new THREE.DirectionalLight(0xffffff, 3);
      S.sun.name = 'sun';
      S.sun.castShadow = true;
      S.sun.shadow.mapSize.set(4096, 4096);
      S.sun.shadow.camera.near = 1; S.sun.shadow.camera.far = 2500;
      S.sun.shadow.bias = -0.0002; S.sun.shadow.normalBias = 0.08; S.sun.shadow.radius = 2;
      S.group.add(S.sun, S.sun.target);
    }

    // fog + background (the dome is the background)
    S.fog = new THREE.FogExp2(0xc0d0e0, 0.0003);
    ctx.scene.fog = S.fog;
    ctx.scene.background = null;

    // rain
    S.rain = createRain(S.rng.fork('rain'), 7000);
    S.group.add(S.rain.mesh);

    // events (material setup is event-driven: spawn events + a throttled sim:tick safety net)
    const dirty = () => { S.dirtyTod = true; };
    const sweepSoon = () => { S.sweepAt = S.frame + 1; };
    S.subs = [
      ctx.events.on('time:changed', dirty),
      ctx.events.on('weather:changed', () => { S.dirtyTod = true; S.dirtyEnv = true; }),
      ctx.events.on('resize', () => { S.camKey = ''; }),
      ctx.events.on('showcase:staged', sweepSoon),
      ctx.events.on('building:spawned', sweepSoon),
      ctx.events.on('road:added', sweepSoon),
      ctx.events.on('prop:added', sweepSoon),
      ctx.events.on('terrain:changed', sweepSoon),
      ctx.events.on('sim:tick', () => { if (performance.now() - S.sweepStamp > 2500) sweepSoon(); }),
    ];

    // initial weather from url (?weather=rain:0.7)
    const wp = ctx.params.get('weather');
    if (wp) { const [k, i] = String(wp).split(':'); api.setWeather(k, i !== undefined ? Number(i) : 0.6); }
    else ctx.world.weather.wind = [WIND.clear[0], WIND.clear[1]];

    S.sweepAt = 0;
    S.dirtyTod = true;
    S.dirtyEnv = true;
    S.cascadeKey = '';
    S.envHours = -99;
    applyTod();
    regenEnv();
  },

  update(dt, ctx) {
    S.time += dt;
    S.frame++;
    const cam = ctx.camera;
    if (S.dirtyTod) { S.dirtyTod = false; applyTod(); }

    // cap scene fog density against the camera's own current reach every frame (see FOG_CAP_K above) - cheap, and
    // needs to track the camera continuously (not just on tod/weather changes), since the same weather-driven
    // density is fine at street range and wildly oversaturated at overview/aerial range.
    {
      const t = S.ctx.controls?.target;
      const D = t ? cam.position.distanceTo(t) : 200;
      S.fog.density = Math.min(S.fogRho0, FOG_CAP_K / Math.max(D, 1));
      S.params.fogDensity = S.fog.density;
    }

    S.sky.mesh.position.copy(cam.position);
    S.stars.position.copy(cam.position);
    const u = S.sky.uniforms;
    u.uTime.value = S.time;
    u.uCloudOffset.value.x += S.wind[0] * dt * 0.0012;
    u.uCloudOffset.value.y += S.wind[1] * dt * 0.0012;
    S.stars.material.uniforms.uTime.value = S.time;

    // environment map: regenerate as the light moves (faster around sunrise/sunset where colours change quickly)
    const hrs = ctx.clock.hours;
    let dh = Math.abs(hrs - S.envHours); if (dh > 12) dh = 24 - dh;
    const e = ctx.clock.sunElevation / DEG;
    const step = Math.abs(e) < 14 ? 0.02 : 0.08;
    if (S.dirtyEnv || (dh > step && performance.now() - S.envStamp > ENV_REGEN_MIN_MS)) regenEnv();

    // shadows
    if (S.csm) {
      const key = `${cam.fov}|${cam.aspect}|${cam.near}|${cam.far}`;
      if (key !== S.camKey) { S.camKey = key; S.cascadeKey = ''; }
      updateCascades(cam);
      S.csm.update();
    } else if (S.sun) {
      const t = ctx.controls.target;
      const size = 420, texel = (2 * size) / 4096;
      const sc = S.sun.shadow.camera;
      sc.left = -size; sc.right = size; sc.top = size; sc.bottom = -size; sc.updateProjectionMatrix();
      const tx = Math.round(t.x / texel) * texel, tz = Math.round(t.z / texel) * texel;
      S.sun.target.position.set(tx, 0, tz);
      S.sun.position.copy(S.lightDir).multiplyScalar(900).add(S.sun.target.position);
    }

    if (S.sweepAt >= 0 && S.frame >= S.sweepAt) { S.sweepAt = -1; sweep(); }

    if (S.rain.mesh.visible) S.rain.update(cam, S.time);
  },

  dispose(ctx) {
    for (const off of S.subs) off();
    S.subs = [];
    disposeShowcase(S.showcaseGroup); S.showcaseGroup = null;
    if (S.csm) { S.csm.dispose(); S.csm.remove(); S.csm = null; }
    S.rain?.dispose();
    S.stars?.geometry.dispose(); S.stars?.material.dispose();
    S.sky?.mesh.geometry.dispose(); S.sky?.material.dispose();
    if (S.envRT) { S.envRT.dispose(); S.envRT = null; }
    S.pmrem?.dispose();
    if (S.group) ctx.scene.remove(S.group);
    ctx.scene.fog = null;
    ctx.scene.environment = null;
    ctx.renderer.toneMappingExposure = 1;
    S.done = new WeakSet();
    S.group = null; S.sky = null; S.stars = null; S.sun = null;
    S.envHours = -99; S.camKey = ''; S.cascadeKey = ''; S.sweepAt = -1; S.time = 0; S.frame = 0;
  },

  async showcase(ctx, variant = 'default') {
    disposeShowcase(S.showcaseGroup);
    S.showcaseGroup = buildShowcase(ctx, S.rng.fork('showcase'));
    S.group.add(S.showcaseGroup);
    const w = { default: ['clear', 0], rain: ['rain', 0.85], fog: ['fog', 0.7], overcast: ['cloudy', 1.0] }[variant] || ['clear', 0];
    api.setWeather(w[0], w[1]);
    S.sweepAt = 0;
    sweep();
  },
};
