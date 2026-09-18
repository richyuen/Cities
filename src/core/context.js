import * as THREE from 'three';
import { EventBus } from './eventbus.js';
import { Rng } from './rng.js';
import { Clock } from './clock.js';
import { World } from './world.js';
import { Assets } from './assets.js';
import { Materials } from './materials.js';
import { createRenderer, FrameStats } from './renderer.js';
import { createCamera } from './camera.js';

// Console capture: every console.error / uncaught error / rejection is recorded for the screenshot tool.
export const captured = { errors: [], warnings: [] };
(function hookConsole() {
  const origError = console.error.bind(console);
  const origWarn = console.warn.bind(console);
  const fmt = (args) => args.map((a) => (a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : safeJson(a))).join(' ');
  console.error = (...args) => { captured.errors.push(fmt(args).slice(0, 2000)); origError(...args); };
  console.warn = (...args) => { const t = fmt(args); if (!/X4122|Program Info Log/.test(t)) captured.warnings.push(t.slice(0, 500)); origWarn(...args); };
  window.addEventListener('error', (e) => captured.errors.push(`uncaught: ${e.message} @${e.filename}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => captured.errors.push(`unhandledrejection: ${e.reason?.stack || e.reason}`));
})();

function safeJson(a) { try { return JSON.stringify(a); } catch { return String(a); } }

export async function createContext({ container, dom, params }) {
  const seed = Number(params.get('seed') || 1) || 1;
  const events = new EventBus(console);
  const rng = new Rng(seed);
  const world = new World(events, { w: Number(params.get('w') || 256), h: Number(params.get('h') || 256) });
  const clock = new Clock(events, { hours: Number(params.get('tod') ?? 14) });
  const renderer = createRenderer(container);
  const scene = new THREE.Scene();
  scene.name = 'root';
  const cam = createCamera(renderer, world, events);
  const assets = new Assets(rng, (...a) => console.log(...a));
  await assets.load();
  const materials = new Materials();
  const frameStats = new FrameStats(renderer);
  const showcase = params.get('showcase');

  let renderFn = null;
  const ctx = {
    THREE, seed, events, rng, world, clock, renderer, scene,
    camera: cam.camera, controls: cam.controls, cameraPresets: cam.presets, cameraApi: cam,
    assets, materials, modules: new Map(), dom, container, params,
    showcase: showcase || null,
    stats: { fps: 0, frameMs: 0, drawCalls: 0, triangles: 0 },
    frameStats,
    log: (...a) => console.log(...a),
    error: (...a) => console.error(...a),
    setRenderFn(fn) { renderFn = fn; },
    getRenderFn() { return renderFn; },
    render(dt) {
      if (renderFn) renderFn(dt); else renderer.render(scene, cam.camera);
    },
  };
  return ctx;
}
