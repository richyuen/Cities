// audio — procedural Web Audio ambience + SFX. No audio files. Silent and error-free until the first user gesture.
import * as THREE from 'three';
import { AudioEngine, SFX_NAMES } from './engine.js';
import { AudioPanel } from './panel.js';
import { buildSpeakerScene } from './speaker.js';

const TICK = 0.1; // s — gains/state are updated at most 10×/s
const RATE_LIMIT = { place: 4, bulldoze: 4, zone: 6, road: 8, click: 12 }; // max plays per second per name

const S = {
  ctx: null, rng: null, engine: null, panel: null, scene3d: null,
  acc: 0, elapsed: 0, frame: 0, unsub: [], gesture: null,
  lastPlay: {}, sfxLog: [], sfxCounts: {}, demoTimer: 0, demoIdx: 0, showcaseVariant: null,
  info: { hours: 0, daylight: 0, weather: { kind: 'clear', intensity: 0, wind: [1, 0] }, traffic: 0, population: 0, camH: 0, detail: 1, gust: 0.5, birdDensity: 0, listenerPos: [0, 0, 0] },
};

const _fwd = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function smoothstep(a, b, x) { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); }

/** Rate-limited, positional SFX trigger used by event bindings and api.play. */
function play(name, pos = null, { limit = true } = {}) {
  if (!SFX_NAMES.includes(name)) return false;
  const now = performance.now();
  const max = RATE_LIMIT[name];
  if (limit && max) {
    const last = S.lastPlay[name] || -1e9;
    if (now - last < 1000 / max) return false;
  }
  S.lastPlay[name] = now;
  const ok = S.engine.play(name, pos);
  S.sfxLog.push({ name, pos: !!pos, t: now, played: ok });
  if (S.sfxLog.length > 12) S.sfxLog.shift();
  S.sfxCounts[name] = (S.sfxCounts[name] || 0) + 1;
  return ok;
}

function buildingCenter(world, b) {
  const c = world.cellToWorld(b.i, b.j);
  const x = c.x + ((b.w - 1) * world.cellSize) / 2, z = c.z + ((b.d - 1) * world.cellSize) / 2;
  return { x, y: world.getHeight(x, z), z };
}

function edgeCenter(world, edge) {
  const a = world.roads.nodes.get(edge.a), b = world.roads.nodes.get(edge.b);
  if (!a || !b) return null;
  const x = (a.x + b.x) / 2, z = (a.z + b.z) / 2;
  return { x, y: world.getHeight(x, z), z };
}

/** Compute the ambience mix from world/clock/camera state and push it to the engine (10 Hz). */
function tick(ctx) {
  const { world, clock, camera } = ctx;
  const e = S.engine, info = S.info;
  const w = world.weather;
  const rain = w.kind === 'rain' ? 0.3 + 0.7 * clamp01(w.intensity) : 0;
  const overcast = w.kind === 'cloudy' || w.kind === 'fog' ? 0.5 * clamp01(w.intensity || 0.5) : 0;
  const windMag = clamp01(Math.hypot(w.wind[0] || 0, w.wind[1] || 0) / 3); // |wind| ≈ 3 → storm
  const gust = 0.5 + 0.5 * S.rng.noise2D(S.elapsed * 0.22, 7.3);
  const flutter = 0.5 + 0.5 * S.rng.noise2D(S.elapsed * 1.7, 3.1);
  const camH = camera.position.y - world.getHeight(camera.position.x, camera.position.z);
  const detail = 1 - smoothstep(15, 260, camH); // 1 at street level, 0 aerial
  const sunEl = clock.sunElevation;
  const dayF = clamp01((sunEl + 0.03) / 0.12);
  const nightF = clamp01((-sunEl + 0.02) / 0.1);
  const noon = 1 - clamp01(Math.abs(clock.hours - 12.5) / 3);
  const birdDensity = dayF * (1 - 0.65 * noon) * (1 - 0.8 * rain) * (1 - 0.4 * overcast) * (0.15 + 0.85 * detail);
  const traffic = clamp01(world.stats.traffic || 0);
  const popF = Math.sqrt(clamp01((world.stats.population || 0) / 60000));

  const state = {
    wind: (0.1 + 0.6 * windMag) * (0.5 + 0.5 * gust) * (0.85 + 0.15 * flutter) * (0.55 + 0.45 * (1 - detail)) * (1 + 0.5 * rain),
    birds: birdDensity > 0.001 ? dayF * (1 - 0.6 * rain) * (0.3 + 0.7 * detail) : 0,
    crickets: nightF * (1 - 0.85 * rain) * (0.2 + 0.8 * detail) * (1 - 0.5 * windMag),
    traffic: traffic * (0.25 + 0.75 * detail),
    rain,
    rumble: popF * (0.35 + 0.65 * (1 - detail)) * (0.6 + 0.4 * traffic),
    windMag, gust, detail, birdDensity,
  };
  e.applyState(state);

  if (e.ac) {
    camera.getWorldDirection(_fwd);
    e.setListener(camera.position, _fwd, _up);
  }
  Object.assign(info, {
    hours: clock.hours, daylight: clock.daylight, weather: w, traffic, population: world.stats.population || 0,
    camH, detail, gust, birdDensity, listenerPos: [camera.position.x, camera.position.y, camera.position.z],
  });
  if (S.scene3d) {
    // Headless / pre-gesture: drive the VU row from the target mix (with a slow breathing LFO) so captures show a
    // live state. Once the context runs the real output RMS takes over.
    const live = e.running && !e.muted;
    let level = e.outputLevel;
    if (!live) {
      const mix = state.wind + state.birds + state.crickets + state.traffic + state.rain + state.rumble;
      level = clamp01(mix / 2.2) * (0.8 + 0.2 * S.rng.noise2D(S.elapsed * 0.6, 11.7));
    }
    S.scene3d.setLevel(level, live);
    S.scene3d.setNight(clamp01((-sunEl + 0.01) / 0.08));
  }

  // Showcase demo sequencer: cycle the SFX at the speaker so a human with a browser hears them (silent headless).
  if (S.showcaseVariant && e.running) {
    S.demoTimer += TICK;
    if (S.demoTimer >= 2.4) {
      S.demoTimer = 0;
      play(SFX_NAMES[S.demoIdx++ % SFX_NAMES.length], { x: 0, y: 1.5, z: 0 }, { limit: false });
    }
  }
}

function onGesture() {
  const e = S.engine;
  if (!e || e.failed) return;
  if (!e.ac || e.ac.state !== 'running') e.start().then((ok) => { if (ok) S.ctx.log('[audio] context running @', e.sampleRate, 'Hz'); });
}

function ensurePanel(ctx) {
  if (S.panel || !ctx.dom) return;
  try { S.panel = new AudioPanel(ctx.dom, S.engine); } catch (err) { ctx.error('[audio] panel failed:', err); }
}

export default {
  id: 'audio',
  deps: [],
  order: 85,
  showcaseVariants: ['default', 'night', 'rain'],
  presets: {
    'audio:default': { pos: [14, 7.5, 22], target: [0.5, 2.8, 0] },
    'audio:closeup': { pos: [1.8, 3.6, 8.8], target: [-2.6, 2.7, 0.6] },
    'audio:aerial': { pos: [26, 72, 54], target: [0, 0, 4] },
    'audio:street': { pos: [-11, 1.9, 14], target: [1.5, 2.4, 0] },
  },

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('audio');
    S.engine = new AudioEngine(S.rng, ctx.log);
    S.acc = 0; S.elapsed = 0; S.frame = 0; S.sfxLog = []; S.sfxCounts = {}; S.lastPlay = {};
    Object.assign(S.info, { sfxLog: S.sfxLog, sfxCounts: S.sfxCounts, volumes: S.engine.volumes });
    // Autoplay policy: the AudioContext is created + resumed only from a real user gesture.
    S.gesture = onGesture;
    // capture phase so UI elements that stopPropagation() cannot swallow the unlock
    window.addEventListener('pointerdown', S.gesture, { capture: true, passive: true });
    window.addEventListener('keydown', S.gesture, { capture: true, passive: true });
    const ev = ctx.events, world = ctx.world;
    S.unsub = [
      ev.on('tool:selected', () => play('click')),
      ev.on('road:added', ({ edge, reason }) => { if (reason !== 'split' && reason !== 'merge') play('road', edge ? edgeCenter(world, edge) : null); }),
      ev.on('building:spawned', ({ building }) => play('place', building ? buildingCenter(world, building) : null)),
      ev.on('building:removed', ({ building }) => play('bulldoze', building ? buildingCenter(world, building) : null)),
      ev.on('zone:changed', ({ zone }) => { if (zone) play('zone'); }),
    ];
    if (ctx.params.get('audiopanel')) ensurePanel(ctx);
  },

  update(dt, ctx) {
    S.frame++;
    S.elapsed += dt;
    S.acc += dt;
    if (S.acc >= TICK) { S.acc -= TICK; if (S.acc > TICK) S.acc = 0; tick(ctx); }
    if (S.panel && (S.frame & 1) === 0) S.panel.update(S.info, performance.now());
  },

  async showcase(ctx, variant = 'default') {
    S.showcaseVariant = variant;
    if (S.scene3d) { S.scene3d.dispose(); S.scene3d = null; }
    S.scene3d = buildSpeakerScene(ctx, { variant, rng: S.rng.fork('scene') });
    // Only core + audio are loaded here, so we own weather/stats for the demo state.
    if (variant === 'rain') {
      ctx.world.setWeather({ kind: 'rain', intensity: 0.8, wind: [2.4, 0.9] });
      ctx.world.setStats({ population: 26000, traffic: 0.3 });
    } else if (variant === 'night') {
      ctx.world.setWeather({ kind: 'clear', intensity: 0, wind: [0.6, 0.2] });
      ctx.world.setStats({ population: 42000, traffic: 0.15 });
    } else {
      ctx.world.setWeather({ kind: 'clear', intensity: 0, wind: [1.2, 0.4] });
      ctx.world.setStats({ population: 18000, traffic: 0.45 });
    }
    ensurePanel(ctx);
    S.demoTimer = 1.5;
    tick(ctx);
    if (S.panel) S.panel.update(S.info, performance.now());
  },

  dispose(ctx) {
    for (const u of S.unsub) { try { u(); } catch (_) { /* ignore */ } }
    S.unsub = [];
    if (S.gesture) {
      window.removeEventListener('pointerdown', S.gesture, { capture: true });
      window.removeEventListener('keydown', S.gesture, { capture: true });
      S.gesture = null;
    }
    if (S.panel) { S.panel.dispose(); S.panel = null; }
    if (S.scene3d) { S.scene3d.dispose(); S.scene3d = null; }
    if (S.engine) { S.engine.close(); S.engine = null; }
    S.showcaseVariant = null;
    void ctx;
  },

  api: {
    /** Play a synthesized SFX; pos {x,y,z} makes it positional relative to the camera. Returns true if audible. */
    play(name, pos = null) { return S.engine ? play(name, pos, { limit: false }) : false; },
    setVolume(master, sub = {}) { S.engine?.setVolume(master, sub); },
    mute(on = true) { S.engine?.mute(on); },
    isRunning() { return !!S.engine?.running; },
    getAnalyser() { return S.engine?.analyser || null; },
    /** Force-start after a gesture (e.g. from a UI button). Resolves true when the context is running. */
    start() {
      if (!S.engine) return Promise.resolve(false);
      // Outside a gesture Chrome leaves the context suspended and resume() never settles: race it with a timeout.
      const active = navigator.userActivation ? navigator.userActivation.isActive || navigator.userActivation.hasBeenActive : true;
      const p = S.engine.start();
      if (active) return p;
      return Promise.race([p, new Promise((res) => setTimeout(() => res(false), 1500))]);
    },
    /** Read-only snapshot of layer targets/levels for UIs. */
    layers() { return S.engine ? S.engine.layers.map((l) => ({ id: l.id, target: l.target, level: S.engine.layerLevel(l) })) : []; },
    sfxNames: SFX_NAMES,
  },
};
