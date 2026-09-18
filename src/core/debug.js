import { captured } from './context.js';

// window.__city — the contract used by tools/shot.mjs and by humans in the console.
export function installDebugApi(ctx, registry, app) {
  const api = {
    ready: false,
    seed: ctx.seed,
    ctx, world: ctx.world, THREE: ctx.THREE,
    setCamera(nameOrObj) { return ctx.cameraApi.apply(nameOrObj); },
    presets() { return ctx.cameraPresets.list(); },
    setTime(h) { ctx.clock.paused = true; ctx.clock.set(h); },
    setTimeScale(s) { ctx.clock.timeScale = s; ctx.clock.paused = s === 0; },
    pause() { ctx.clock.paused = true; },
    resume() { ctx.clock.paused = false; },
    setWeather(kind, intensity = 0.5) { ctx.world.setWeather({ kind, intensity }); },
    stats() {
      return {
        ...ctx.frameStats.snapshot(),
        errors: [...captured.errors],
        warnings: [...captured.warnings],
        modules: registry.statusMap(),
        moduleErrors: Object.fromEntries([...ctx.modules.values()].filter((r) => r.error).map((r) => [r.id, r.error])),
        hours: ctx.clock.hours,
        showcase: ctx.showcase,
        seed: ctx.seed,
        frame: app.frame,
      };
    },
    clearErrors() { captured.errors.length = 0; captured.warnings.length = 0; },
    async showcase(id, variant = 'default') { return app.stageShowcase(id, variant); },
    renderOnce() { app.tick(1 / 60, true); },
    /** wait n frames; returns a promise */
    frames(n = 1) { return new Promise((res) => { app.after(n, res); }); },
    modules: registry.records,
  };
  window.__city = api;
  return api;
}
