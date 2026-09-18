import { createContext } from './core/context.js';
import { Registry } from './core/registry.js';
import { loaders, ALL_MODULE_IDS } from './core/modules.js';
import { installDebugApi } from './core/debug.js';
import { installFallbackLights } from './core/fallbackLights.js';

const params = new URLSearchParams(location.search);
const container = document.getElementById('app');
const dom = document.getElementById('ui-root');

const app = {
  frame: 0,
  _afterQueue: [],
  after(n, fn) { this._afterQueue.push({ at: this.frame + n, fn }); },
  tick: null,
  stageShowcase: null,
};

async function boot() {
  const ctx = await createContext({ container, dom, params });
  const registry = new Registry(ctx, loaders);
  const debug = installDebugApi(ctx, registry, app);

  // Which modules to load: full game = all; showcase = that module + transitive deps.
  const showcaseId = params.get('showcase');
  const variant = params.get('variant') || 'default';
  const recs = await registry.loadAll(ALL_MODULE_IDS);
  let ids;
  if (showcaseId) {
    if (!recs.has(showcaseId)) ctx.error(`[boot] unknown showcase module "${showcaseId}". Known: ${ALL_MODULE_IDS.join(', ')}`);
    ids = Registry.closure(recs, [showcaseId]);
    // Showcases are judged under real lighting: always include environment (and effects) when they loaded.
    if (params.get('bare') !== '1') {
      for (const extra of ['environment', 'effects']) if (recs.get(extra)?.status === 'loaded') ids.add(extra);
    }
  } else {
    ids = new Set(ALL_MODULE_IDS);
  }
  const only = params.get('only'); // debugging: ?only=terrain,roads
  if (only) ids = Registry.closure(recs, only.split(','));
  const exclude = (params.get('exclude') || '').split(',').filter(Boolean);
  for (const e of exclude) ids.delete(e);

  if (!ids.has('environment') || recs.get('environment')?.status !== 'loaded') {
    ctx.log('[boot] environment module not loaded: using fallback lights');
    installFallbackLights(ctx);
  }

  await registry.initAll(recs, ids);

  app.stageShowcase = async (id, v = 'default') => {
    ctx.world.clearContent();
    ctx.showcase = id;
    await registry.showcase(id, v);
    ctx.cameraApi.apply(params.get('preset') || `${id}:default`) || ctx.cameraApi.apply('overview');
  };

  if (showcaseId && recs.get(showcaseId)?.status === 'ok') {
    try { await app.stageShowcase(showcaseId, variant); }
    catch (e) { ctx.error(`[boot] showcase "${showcaseId}" failed:`, e); }
  } else {
    ctx.cameraApi.apply(params.get('preset') || 'overview');
  }

  // Resize
  const resize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    ctx.renderer.setSize(w, h, false);
    ctx.cameraApi.resize(w, h);
    ctx.events.emit('resize', { w, h });
  };
  window.addEventListener('resize', resize);
  resize();

  // Main loop
  let last = performance.now();
  app.tick = (forcedDt, once = false) => {
    const now = performance.now();
    let dt = forcedDt ?? Math.min(0.1, (now - last) / 1000);
    last = now;
    if (params.get('fixeddt')) dt = 1 / 60; // deterministic screenshots
    ctx.frameStats.begin();
    ctx.clock.update(dt);
    ctx.cameraApi.update();
    registry.update(dt);
    ctx.render(dt);
    ctx.frameStats.end();
    Object.assign(ctx.stats, ctx.frameStats.snapshot());
    app.frame++;
    for (const q of [...app._afterQueue]) {
      if (app.frame >= q.at) { app._afterQueue.splice(app._afterQueue.indexOf(q), 1); q.fn(); }
    }
    if (!once) requestAnimationFrame(() => app.tick());
  };
  requestAnimationFrame(() => app.tick());
  app.after(2, () => { debug.ready = true; ctx.log('[boot] ready'); });
}

boot().catch((e) => {
  console.error('[boot] fatal:', e);
  window.__city = window.__city || {};
  window.__city.ready = true;
  window.__city.fatal = String(e?.stack || e);
  window.__city.stats = () => ({ errors: [String(e?.stack || e)], warnings: [], fps: 0, drawCalls: 0, modules: {} });
});
