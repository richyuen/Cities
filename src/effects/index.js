import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GradeShader } from './grade.js';
import { buildShowcase } from './showcase.js';

// effects — the post-processing finishing pass.
//
// Pipeline (all in linear HDR until OutputPass):
//   RenderPass (MSAA x4 target + depth texture)
//   -> GTAOPass  (AO only, normals reconstructed from depth: no second scene render, output kept in its own RT)
//   -> Grade     (custom ShaderPass: AO multiply with contrast curve, vignette, chromatic aberration, night lift)
//   -> UnrealBloomPass (threshold >= 1.0 so only emissives / sun glints bloom)
//   -> OutputPass (ACES filmic + sRGB for EVERYTHING, sky included — the composer path is canonical)
//   -> SMAAPass  (runs last, on the LDR image, where its luma edge detection works best)
//
// sceneRT (the MSAA target carrying depthTexture) is written exactly once per frame, by RenderPass, and read
// twice — by GTAO (depthTexture) and by Grade (resolved color) — then never touched again this frame. render()
// drives each pass by hand instead of calling EffectComposer.render(), threading the rest of the chain through
// two plain (non-MSAA, no depth attachment) ping targets. This used to be a generic EffectComposer swap chain
// with sceneRT standing in for renderTarget2, which meant OutputPass (default depthTest/depthWrite=true) wrote
// its LDR quad *into* sceneRT every frame, and SMAA then read its final color back out of sceneRT too — see
// docs/core-requests/environment.md: routing through a live-depthTexture MSAA target that also gets reused as a
// generic post-FX ping buffer is what produced the pale/"toothpicked" clearcoat buildings after a camera
// teleport, reliably cleared only by forcing sceneRT/pingRT to reallocate (composer.setSize() at the same
// dims). Restructuring so sceneRT is write-once/read-only-after removes that reuse entirely: nothing but
// RenderPass ever calls renderer.setRenderTarget(sceneRT), so there's no longer a path for a post-FX pass's
// depth state (or a stale resolve of it) to leak into the next frame's beauty/depth target.

// gtaoSamples = horizon samples per pixel; pd = Poisson-denoise taps (each tap reconstructs a normal from depth, so
// this is the bigger cost: 16/3 rings costs ~2x what 8/2 does at 1080p for a barely visible difference).
const QUALITY = {
  low:    { gtao: false, gtaoScale: 0.5, gtaoSamples: 8,  pd: { samples: 8,  rings: 2 }, bloomScale: 0.5, samples: 0, smaa: true },
  medium: { gtao: true,  gtaoScale: 0.5, gtaoSamples: 12, pd: { samples: 8,  rings: 2 }, bloomScale: 1.0, samples: 4, smaa: true },
  high:   { gtao: true,  gtaoScale: 1.0, gtaoSamples: 16, pd: { samples: 10, rings: 2 }, bloomScale: 1.0, samples: 4, smaa: true },
};
const BLOOM_DAY = 0.22, BLOOM_NIGHT = 0.3, BLOOM_RADIUS = 0.25;
// UnrealBloomPass composites 5 mips; even at radius 0.25 the 1/16 and 1/32 mips keep weights of 0.5 / 0.4, which is
// the wide haze that lifted the sky around the tower in r1. The per-mip tints taper them so the glow hugs the source.
const BLOOM_MIP_TINTS = [1.0, 0.6, 0.28, 0.08, 0.0];
// Threshold is in linear HDR before tone mapping. Sunlit white plastic at noon sits around 1.2-1.4, so the daytime
// threshold is 1.6 (only emissives / sun glints bloom); at night it drops to 1.0 for the window glow. Never < 1.0.
const BLOOM_THRESHOLD_DAY = 1.6, BLOOM_THRESHOLD_NIGHT = 1.0, BLOOM_THRESHOLD_MIN = 1.0;
const AO_INTENSITY = 1.0;
const AO_POWER = 2.5;   // contrast curve applied to the AO term in the grade pass (pow(ao, AO_POWER))
// GTAO in metres (bricks are 0.96 m tall, studs 0.8 m apart, 0.17 m high): a short radius so the term concentrates
// in creases, under overhangs and around stud bases instead of averaging out over open ground. `thickness` is the
// max view-depth delta a sample may have and still count as an occluder: it must exceed the radius or samples that
// land on the wall of an inside corner are rejected (that, not the radius, is what made r1's AO invisible).
const AO_PARAMS = { radius: 0.7, distanceExponent: 1.5, thickness: 1.5, distanceFallOff: 0.3, scale: 1.0, screenSpaceRadius: false };
// Poisson denoise: 4 px radius (the GTAO rotation noise has a 5 px period; anything smaller leaves a wavy pattern on
// flat faces), strict depth / normal weights so AO never smears across silhouettes. Tap count comes from QUALITY.
const PD_PARAMS = { lumaPhi: 10, depthPhi: 0.25, normalPhi: 8.0, radius: 4.0, radiusExponent: 1.0 };

const S = {
  ctx: null,
  rng: null,
  group: null,
  composer: null,
  sceneRT: null,
  pingRT: null,
  pingRT2: null,
  depthTexture: null,
  passes: {},
  quality: 'high',
  enabled: true,
  unsubs: [],
  showcaseBits: null,
  size: { w: 1, h: 1 },
  debug: null,
  bloomOverride: { strength: undefined, radius: undefined, threshold: undefined }, // api.setBloom persists across time:changed
};

function drawingSize(renderer) {
  const v = renderer.getDrawingBufferSize(new THREE.Vector2());
  return { w: Math.max(1, v.x), h: Math.max(1, v.y) };
}

/** Deterministic replacement for GTAOPass' Poisson-denoise noise texture (three builds it with Math.random). */
function makeNoiseTexture(rng, size = 64) {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size * 4; i++) data[i] = Math.floor(rng.float() * 256) & 255;
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  t.name = 'effects.pdNoise';
  return t;
}

function buildComposer(ctx) {
  const { renderer, scene, camera } = ctx;
  const { w, h } = drawingSize(renderer);
  const q = QUALITY[S.quality];

  const depthTexture = new THREE.DepthTexture(w, h);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.type = THREE.UnsignedIntType;
  const sceneRT = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, samples: q.samples, depthTexture, depthBuffer: true, stencilBuffer: false,
    resolveDepthBuffer: true, resolveStencilBuffer: false,
  });
  sceneRT.texture.name = 'effects.sceneRT';
  const pingRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, stencilBuffer: false });
  pingRT.texture.name = 'effects.pingRT';

  // EffectComposer's own renderTarget1/renderTarget2 (both clones of pingRT: plain HalfFloat, no depth
  // attachment) are the only buffers the post-beauty chain ping-pongs across — see render() below. sceneRT
  // is deliberately kept outside that pair.
  const composer = new EffectComposer(renderer, pingRT);
  const pingRT2 = composer.renderTarget2;
  pingRT2.texture.name = 'effects.pingRT2';

  const renderPass = new RenderPass(scene, camera);

  const gtao = new GTAOPass(scene, camera, w, h);
  gtao.setGBuffer(depthTexture, undefined);      // depth from the scene target; normals reconstructed from depth
  gtao.output = GTAOPass.OUTPUT.Off;             // we composite AO ourselves in the grade pass
  gtao.needsSwap = false;
  gtao.blendIntensity = AO_INTENSITY;
  gtao.updateGtaoMaterial({ ...AO_PARAMS, samples: q.gtaoSamples });
  gtao.updatePdMaterial({ ...PD_PARAMS, ...q.pd });
  // deterministic denoise noise (three's default uses Math.random via SimplexNoise)
  gtao.pdNoiseTexture.dispose();
  gtao.pdNoiseTexture = makeNoiseTexture(S.rng);
  gtao.pdMaterial.uniforms.tNoise.value = gtao.pdNoiseTexture;

  const grade = new ShaderPass(GradeShader);
  grade.material.depthTest = false;
  grade.material.depthWrite = false;
  grade.uniforms.resolution.value = new THREE.Vector2(w, h);
  grade.uniforms.tAO.value = gtao.pdRenderTarget.texture;
  grade.uniforms.aoIntensity.value = q.gtao ? AO_INTENSITY : 0;
  grade.uniforms.aoPower.value = AO_POWER;

  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), BLOOM_DAY, BLOOM_RADIUS, BLOOM_THRESHOLD_DAY);
  bloom.bloomTintColors = BLOOM_MIP_TINTS.map((t) => new THREE.Vector3(t, t, t));
  bloom.compositeMaterial.uniforms.bloomTintColors.value = bloom.bloomTintColors;

  const output = new OutputPass();
  const smaa = new SMAAPass();

  composer.addPass(renderPass);
  composer.addPass(gtao);
  composer.addPass(grade);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(smaa);

  S.composer = composer;
  S.sceneRT = sceneRT;
  S.pingRT = pingRT;
  S.pingRT2 = pingRT2;
  S.depthTexture = depthTexture;
  S.passes = { renderPass, gtao, grade, bloom, output, smaa };
  S.size = { w, h };
  applySizes();
  applyQuality();
  applyTime(ctx.clock);
}

/** Per-pass resolutions derived from the current drawing-buffer size and quality tier. */
function applySizes() {
  const q = QUALITY[S.quality];
  const { gtao, bloom, grade } = S.passes;
  const { w, h } = S.size;
  grade.uniforms.resolution.value.set(w, h);
  gtao.setSize(Math.max(1, Math.round(w * q.gtaoScale)), Math.max(1, Math.round(h * q.gtaoScale)));
  bloom.setSize(Math.max(1, Math.round(w * q.bloomScale)), Math.max(1, Math.round(h * q.bloomScale)));
}

/** Quality-tier switches. Only re-creates the MSAA scene target when the sample count actually changes. */
function applyQuality() {
  const q = QUALITY[S.quality];
  const { gtao, grade, smaa } = S.passes;
  gtao.enabled = q.gtao;
  grade.uniforms.aoIntensity.value = q.gtao ? AO_INTENSITY : 0;
  gtao.updateGtaoMaterial({ samples: q.gtaoSamples });
  gtao.updatePdMaterial(q.pd);
  smaa.enabled = q.smaa;
  if (S.sceneRT.samples !== q.samples) {
    S.sceneRT.samples = q.samples;
    S.sceneRT.dispose(); // GL objects are re-created lazily with the new sample count
  }
}

function resize(w, h) {
  if (!S.composer) return;
  const pr = S.ctx.renderer.getPixelRatio();
  S.composer.setPixelRatio(pr);
  S.composer.setSize(w, h); // resizes pingRT/pingRT2, SMAA's internal RTs, and re-inits every pass
  const ew = Math.max(1, Math.round(w * pr)), eh = Math.max(1, Math.round(h * pr));
  S.sceneRT.setSize(ew, eh); // sceneRT sits outside the composer's renderTarget1/2 pair now; resize it ourselves
  S.size = { w: ew, h: eh };
  applySizes();
}

function applyTime(clock) {
  const { bloom, grade } = S.passes;
  if (!bloom) return;
  const daylight = THREE.MathUtils.clamp(clock.daylight ?? 1, 0, 1);
  const night = 1 - THREE.MathUtils.smoothstep(daylight, 0.0, 0.25);
  const o = S.bloomOverride;
  bloom.strength = o.strength ?? (BLOOM_DAY + (BLOOM_NIGHT - BLOOM_DAY) * night);
  bloom.radius = o.radius ?? BLOOM_RADIUS;
  bloom.threshold = Math.max(BLOOM_THRESHOLD_MIN, o.threshold ?? (BLOOM_THRESHOLD_DAY + (BLOOM_THRESHOLD_NIGHT - BLOOM_THRESHOLD_DAY) * night));
  grade.uniforms.nightLift.value = night;
  S.showcaseBits?.setNight(!!clock.isNight);
}

// Drives each pass by hand rather than calling EffectComposer.render(): its generic swapBuffers() ping-pongs
// between whatever two targets currently sit in readBuffer/writeBuffer, and since RenderPass necessarily reads
// out of sceneRT, a naive swap chain eventually hands sceneRT back out as a *write* target for a later pass
// (OutputPass, in the old code) — see the pipeline comment up top for why that corrupted buildings after a
// camera teleport. Here sceneRT is only ever the readBuffer argument (RenderPass's beauty write, GTAO's depth
// read, Grade's color read); everything from Grade on ping-pongs across pingRT/pingRT2 instead.
function render(dt) {
  const { renderer, scene, camera } = S.ctx;
  if (!S.enabled || !S.composer) { renderer.render(scene, camera); return; }
  const { renderPass, gtao, grade, bloom, output, smaa } = S.passes;
  const pingA = S.pingRT, pingB = S.pingRT2;

  renderPass.render(renderer, pingA, S.sceneRT, dt, false); // RenderPass writes into its readBuffer arg, not writeBuffer
  if (gtao.enabled) gtao.render(renderer, null, null, dt, false); // output=Off: never touches its writeBuffer/readBuffer args

  let readBuf = S.sceneRT, writeBuf = pingA;
  grade.renderToScreen = false;
  grade.render(renderer, writeBuf, readBuf, dt, false); // last read of sceneRT this frame
  readBuf = writeBuf; writeBuf = (readBuf === pingA) ? pingB : pingA;

  if (bloom.enabled) bloom.render(renderer, writeBuf, readBuf, dt, false); // additive-composites back into readBuf in place

  if (output.enabled) {
    output.renderToScreen = false;
    output.render(renderer, writeBuf, readBuf, dt, false);
    readBuf = writeBuf; writeBuf = (readBuf === pingA) ? pingB : pingA;
  }

  if (smaa.enabled) {
    smaa.renderToScreen = true;
    smaa.render(renderer, null, readBuf, dt, false);
  } else {
    // SMAA is always last in QUALITY today, but stay correct if it's ever toggled off.
    S.composer.copyPass.renderToScreen = true;
    S.composer.copyPass.render(renderer, null, readBuf, dt, false);
  }
}

function disposeComposer() {
  if (!S.composer) return;
  for (const p of Object.values(S.passes)) p.dispose?.();
  S.composer.dispose(); // disposes pingRT + pingRT2 (its renderTarget1/renderTarget2) and its internal copyPass
  S.sceneRT.dispose();
  S.depthTexture.dispose();
  S.composer = null;
  S.passes = {};
}

function clearShowcase() {
  if (!S.group) return;
  for (const c of [...S.group.children]) S.group.remove(c);
  S.showcaseBits?.studs.clear();
  S.showcaseBits = null;
}

const api = {
  setQuality(q) {
    if (!QUALITY[q]) { S.ctx?.log(`[effects] unknown quality "${q}"`); return; }
    S.quality = q;
    if (S.composer) { applySizes(); applyQuality(); }
  },
  getQuality() { return S.quality; },
  setEnabled(v) { S.enabled = !!v; },
  isEnabled() { return S.enabled; },
  getComposer() { return S.composer; },
  getPasses() { return S.passes; },
  /** debug: 'ao' shows the denoised AO term (after the contrast curve) as plain sRGB grey — bloom and the
   *  ACES OutputPass are skipped so 1.0 is white and 0.5 is mid grey; null restores the image */
  setDebug(mode) {
    S.debug = mode === 'ao' ? 'ao' : null;
    const { grade, bloom, output } = S.passes; if (!grade) return;
    grade.uniforms.debugAO.value = S.debug ? 1 : 0;
    bloom.enabled = !S.debug;
    output.enabled = !S.debug;
  },
  /** Overrides persist across time:changed; pass `null` for a field to return it to the automatic day/night value. */
  setBloom({ strength, radius, threshold } = {}) {
    const o = S.bloomOverride;
    if (strength !== undefined) o.strength = strength ?? undefined;
    if (radius !== undefined) o.radius = radius ?? undefined;
    if (threshold !== undefined) o.threshold = threshold === null ? undefined : Math.max(BLOOM_THRESHOLD_MIN, threshold);
    if (S.ctx) applyTime(S.ctx.clock);
  },
  /** `gtao` / `pd` accept raw GTAOPass parameter objects (radius, thickness, samples... / radius, rings, depthPhi...). */
  setAO({ intensity, radius, power, gtao, pd } = {}) {
    const g = S.passes.gtao; if (!g) return;
    if (intensity !== undefined) S.passes.grade.uniforms.aoIntensity.value = intensity;
    if (power !== undefined) S.passes.grade.uniforms.aoPower.value = power;
    if (radius !== undefined) g.updateGtaoMaterial({ radius });
    if (gtao) g.updateGtaoMaterial(gtao);
    if (pd) g.updatePdMaterial(pd);
  },
  setGrade({ vignette, chromatic } = {}) {
    const u = S.passes.grade?.uniforms; if (!u) return;
    if (vignette !== undefined) u.vignetteAmount.value = vignette;
    if (chromatic !== undefined) u.caAmount.value = chromatic;
  },
};

export default {
  id: 'effects',
  deps: [],
  order: 90,
  showcaseVariants: ['default', 'night'],
  presets: {
    'effects:default': { pos: [30, 17, 32], target: [-2, 6, -1] },
    'effects:closeup': { pos: [12.0, 4.2, 11.5], target: [5.0, 1.4, 4.0] },
    // low angle up the tower, a lamp post in the foreground, the second (night-variant) tower on the right
    'effects:night':   { pos: [6.0, 2.0, 11.0], target: [-9.6, 9.0, -8.0] },
    'effects:tower':   { pos: [8, 5, 14], target: [-9, 11, -8] },
  },
  api,

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('effects'); // forked once; showcase() re-derives its own child from this
    S.group = new THREE.Group();
    S.group.name = 'effects';
    ctx.scene.add(S.group);

    const q = ctx.params.get('quality');
    if (q && QUALITY[q]) S.quality = q;
    if (ctx.params.get('post') === '0') S.enabled = false;

    buildComposer(ctx);
    ctx.setRenderFn(render);

    S.unsubs.push(ctx.events.on('resize', ({ w, h }) => resize(w, h)));
    S.unsubs.push(ctx.events.on('time:changed', () => applyTime(ctx.clock)));
    S.unsubs.push(ctx.events.on('settings:changed', (p = {}) => {
      if (p.quality) api.setQuality(p.quality);
      if (p.effects !== undefined) api.setEnabled(p.effects);
    }));
  },

  update() {},

  dispose(ctx) {
    for (const u of S.unsubs) { try { u?.(); } catch { /* ignore */ } }
    S.unsubs = [];
    ctx.setRenderFn(null);
    disposeComposer();
    clearShowcase();
    if (S.group) { ctx.scene.remove(S.group); S.group = null; }
  },

  async showcase(ctx, variant = 'default') {
    clearShowcase();
    // a child stream per variant so re-staging always produces the same window pattern
    S.showcaseBits = buildShowcase(ctx, S.group, S.rng.fork(`showcase:${variant}`), variant);
    S.showcaseBits.setNight(!!ctx.clock.isNight);
    if (variant === 'night') ctx.clock.set(21.5); // the shot tool's --tod overrides this; the staged content differs anyway
  },
};
