// views — data-view overlays ("info views"): paints the whole map with a translucent colour map for one
// simulation layer at a time, so the player can see *where* power/water/police/school/health/transit coverage
// and land value are missing instead of guessing from the HUD percentages.
//
// Strictly read-only: it owns no world data and never mutates the simulation. Every layer comes from another
// module's public API (simulation.getCoverageGrid / cellDesirability, transit.getCoverageGrid) or straight from
// world.buildings/cells. Rendering is two instanced meshes in one group (see overlay.js), so the module costs 2
// draw calls and allocates nothing per frame; rebuilds are event-driven and debounced.
import { ViewOverlay } from './overlay.js';
import { stageShowcase } from './scene.js';

export const VIEWS = [
  { id: 'power', label: 'Power', kind: 'coverage', grid: 'power' },
  { id: 'water', label: 'Water', kind: 'coverage', grid: 'water' },
  { id: 'services', label: 'Services', kind: 'coverage', grid: 'services' },
  { id: 'police', label: 'Police', kind: 'coverage', grid: 'police' },
  { id: 'school', label: 'School', kind: 'coverage', grid: 'school' },
  { id: 'health', label: 'Health', kind: 'coverage', grid: 'hospital' },
  { id: 'transit', label: 'Transit', kind: 'coverage', grid: 'transit' },
  { id: 'land', label: 'Land value', kind: 'land' },
];
const VIEW_BY_ID = new Map(VIEWS.map((v) => [v.id, v]));
const REBUILD_DEBOUNCE = 0.25;    // seconds; batches a burst of world events into one rebuild

let S = null; // { ctx, overlay, active, dirty, timer, subs, rng, focus }

function simApi(ctx) { const m = ctx.modules.get('simulation'); return m?.status === 'ok' ? m.api : null; }
function transitApi(ctx) { const m = ctx.modules.get('transit'); return m?.status === 'ok' ? m.api : null; }
function zoningApi(ctx) { const m = ctx.modules.get('zoning'); return m?.status === 'ok' ? m.api : null; }

function rebuild() {
  if (!S) return;
  const view = S.active ? VIEW_BY_ID.get(S.active) : null;
  zoningApi(S.ctx)?.setOverlayVisible?.(!view); // don't blend two translucent overlays into each other
  if (!view) { S.overlay.hide(); return; }
  S.overlay.update(view, { sim: simApi(S.ctx), transit: transitApi(S.ctx) });
}

function markDirty() {
  if (!S || !S.active) return;
  S.dirty = true;
  S.timer = REBUILD_DEBOUNCE;
}

const api = {
  /** [{ id, label, kind }] — the available data views, in HUD/cycle order. */
  list() { return VIEWS.map(({ id, label, kind }) => ({ id, label, kind })); },
  /** Active view id, or null. */
  getView() { return S?.active ?? null; },
  /** Activate `id` (or clear with null). Returns the new active id. Emits `view:changed`. */
  setView(id) {
    if (!S) return null;
    const next = id && VIEW_BY_ID.has(id) ? id : null;
    if (next === S.active) return S.active;
    S.active = next;
    S.dirty = false;
    rebuild();
    S.ctx.events.emit('view:changed', { view: next, label: next ? VIEW_BY_ID.get(next).label : null });
    return next;
  },
  /** Toggle a view on if off (or a different one on); clicking the active view turns it off. */
  toggle(id) { return api.setView(S?.active === id ? null : id); },
  /** Cycle to the next (+1) / previous (-1) view. */
  cycle(dir = 1) {
    const idx = VIEWS.findIndex((v) => v.id === S?.active);
    return api.setView(VIEWS[(idx + (dir >= 0 ? 1 : VIEWS.length - 1)) % VIEWS.length].id);
  },
  /** Force an immediate rebuild (tools/tests). */
  refresh() { if (S) { S.dirty = false; rebuild(); } },
};

export default {
  id: 'views',
  deps: ['terrain', 'zoning', 'buildings', 'props', 'simulation', 'transit'],
  order: 72, // after simulation/traffic, before ui (80)
  showcaseVariants: ['default', ...VIEWS.map((v) => v.id)],
  presets: {
    // 3/4 aerial over the staged district
    'views:default': (world) => {
      const f = S?.focus || { x: 0, z: 0, r: 190 };
      const y = world.getHeight(f.x, f.z);
      return { pos: [f.x + f.r * 0.62, y + f.r * 0.72, f.z + f.r * 0.95], target: [f.x, y + 4, f.z], fov: 46 };
    },
    // low angle across a coverage boundary (readable green/red split with the city in the frame)
    'views:closeup': (world) => {
      const f = S?.focus || { x: 0, z: 0, r: 190 };
      const y = world.getHeight(f.x - 40, f.z + 60);
      return { pos: [f.x - 40, y + 14, f.z + 60], target: [f.x + 10, y + 3, f.z + 10], fov: 44 };
    },
    // top-down map read
    'views:aerial': (world) => {
      const f = S?.focus || { x: 0, z: 0, r: 190 };
      return { pos: [f.x, f.r * 1.35, f.z + f.r * 0.35], target: [f.x, 0, f.z], fov: 45 };
    },
  },
  api,

  async init(ctx) {
    S = {
      ctx, active: null, dirty: false, timer: 0, subs: [], focus: { x: 0, z: 0, r: 190 },
      rng: ctx.rng.fork('views'), overlay: null,
    };
    S.overlay = new ViewOverlay(ctx);

    // Any world change that can move coverage / land value / building boxes. Cheap: only marks a debounced
    // rebuild while a view is active, and the grids themselves are recomputed lazily by their owners.
    const watch = [
      'world:cell', 'zone:changed', 'terrain:changed', 'sim:reset', 'transit:changed',
      'building:spawned', 'building:removed', 'road:added', 'road:removed', 'road:changed',
      'prop:added', 'prop:removed',
    ];
    for (const name of watch) S.subs.push(ctx.events.on(name, markDirty));
    ctx.log('[views] ready — overlays:', VIEWS.map((v) => v.id).join(', '));
  },

  update(dt, ctx) {
    if (!S) return;
    S.overlay.setNight(Math.max(0, Math.min(1, 1 - (ctx.clock.daylight ?? 1))));
    if (!S.dirty) return;
    S.timer -= dt;
    if (S.timer <= 0) { S.dirty = false; rebuild(); }
  },

  dispose(ctx) {
    if (!S) return;
    for (const off of S.subs) { try { off(); } catch (_) { /* ignore */ } }
    S.overlay.dispose();
    zoningApi(ctx)?.setOverlayVisible?.(true);
    S = null;
  },

  async showcase(ctx, variant = 'default') {
    if (!S) return;
    S.focus = stageShowcase(ctx, S.rng.fork(`showcase:${variant}`));
    // `default` shows the education layer: the staged utilities leave a clear covered/uncovered boundary.
    api.setView(variant === 'default' ? 'school' : variant);
  },
};
