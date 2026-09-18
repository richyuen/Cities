// UI module: AAA-style Lego city-builder HUD rendered into ctx.dom (#ui-root). DOM only — zero draw calls in the game.
import { CSS } from './styles.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';
import { stageBackdrop, sampleInfoCard } from './showcase.js';

const initialState = () => ({
  ctx: null, hud: null, style: null, minimap: null, offs: [], rng: null,
  tool: null, settings: { quality: 'high', studs: true }, hudVisible: true,
  day: 1, lastHours: null, lastMinute: -1, statsPoll: 0, hadTick: false, _night: undefined,
  pointer: { x: -1, y: -1 }, onKey: null, onPointer: null, backdrop: null,
});
const S = initialState();

function applyStats(stats) {
  if (!stats || !S.hud) return;
  if (stats.money !== undefined) S.hud.setMoney(stats.money);
  if (stats.population !== undefined) S.hud.setPop(stats.population);
  if (stats.jobs !== undefined) S.hud.setJobs(stats.jobs);
  if (stats.happiness !== undefined) S.hud.setHappiness(stats.happiness);
}

function setSpeed(mode) {
  const clock = S.ctx.clock;
  if (mode === 'pause') clock.paused = true;
  else { clock.paused = false; clock.timeScale = Number(mode) || 1; }
}

function selectTool(tool) { S.ctx.events.emit('tool:selected', { tool: tool ?? null }); }

function setHudVisible(v) {
  S.hudVisible = !!v;
  S.hud.setHudVisible(S.hudVisible);
}

function moveCameraTo(x, z) {
  const { camera, controls, world } = S.ctx;
  if (!controls) return;
  const dx = x - controls.target.x, dz = z - controls.target.z;
  const y = world.getHeight(x, z);
  const dy = y - controls.target.y;
  camera.position.x += dx; camera.position.z += dz; camera.position.y += dy;
  controls.target.set(x, y, z);
  controls.update();
}

function onKey(e) {
  const t = e.target;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  const clock = S.ctx.clock;
  switch (e.code) {
    case 'Escape':
      if (S.hud.isSettingsOpen()) { S.hud.toggleSettings(false); break; } // first Esc only closes the popover
      selectTool(null); S.hud.setInfoPanel(null); break;
    case 'Space': clock.paused = !clock.paused; e.preventDefault(); break;
    case 'Digit1': setSpeed(1); break;
    case 'Digit2': setSpeed(2); break;
    case 'Digit3': setSpeed(4); break;
    case 'KeyH': setHudVisible(!S.hudVisible); break;
    case 'KeyB': selectTool(S.tool === 'bulldoze' ? null : 'bulldoze'); break;
    case 'KeyI': selectTool(S.tool === 'select' ? null : 'select'); break;
    default: return;
  }
}

const api = {
  /** Toast at top-centre. kind: 'info' | 'success' | 'warn' | 'error'. opts: { sticky, ms } */
  notify: (text, kind = 'info', opts) => S.hud?.notify(text, kind, opts),
  /** HTML string for the right-side inspect panel, or null to close it. */
  setInfoPanel: (html) => S.hud?.setInfoPanel(html),
  /** Pointer-following tooltip; null/'' hides it. */
  setTooltip: (text) => S.hud?.setTooltip(text),
  /** Bottom-left status line, e.g. "Road: 12 cells, $1,200"; null hides it. */
  setStatus: (text) => S.hud?.setStatus(text),
  /** Directly push { money, population, jobs, happiness } (normally fed by sim:tick). */
  setStats: (stats) => { S.hadTick = true; applyStats(stats); },
  /** Directly push { r, c, i } demand in 0..1 (normally fed by sim:tick). */
  setDemand: (d) => S.hud?.setDemand(d?.r || 0, d?.c || 0, d?.i || 0),
  /** Select a tool (emits tool:selected). */
  setTool: (tool) => selectTool(tool),
  getTool: () => S.tool,
  getSettings: () => ({ ...S.settings }),
  setHudVisible: (v) => setHudVisible(v),
  isHudVisible: () => S.hudVisible,
};

export default {
  id: 'ui',
  deps: [],
  order: 80,
  showcaseVariants: ['default', 'night'],
  presets: {
    'ui:default': { pos: [96, 64, 122], target: [4, 4, 2] },
    'ui:closeup': { pos: [68, 24, 42], target: [12, 6, -8] },
    'ui:aerial': { pos: [0, 175, 70], target: [0, 0, 0] },
  },
  api,

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('ui');
    const dom = ctx.dom || document.body;

    document.getElementById('lc-ui-style')?.remove();
    S.style = document.createElement('style');
    S.style.id = 'lc-ui-style';
    S.style.textContent = CSS;
    document.head.appendChild(S.style);

    S.hud = new Hud(ctx, {
      tool: (tool) => selectTool(S.tool === tool ? null : tool),
      speed: setSpeed,
      tod: (h) => { ctx.clock.paused = true; ctx.clock.set(h); },
      quality: (q) => { S.settings.quality = q; S.hud.setQuality(q); ctx.events.emit('settings:changed', { quality: q }); },
      studs: (on) => { S.settings.studs = !!on; S.hud.setStuds(on); ctx.events.emit('settings:changed', { studs: !!on }); },
      toggleUi: () => setHudVisible(!S.hudVisible),
    });
    dom.appendChild(S.hud.el);
    S.hud.setQuality(S.settings.quality);
    S.hud.setStuds(S.settings.studs);
    S.minimap = new Minimap(ctx, S.hud.minimapCanvas, moveCameraTo);

    // initial state
    applyStats(ctx.world.stats);
    S.hud.setDemand(0, 0, 0);
    S.hud.setTool(null);
    S.hud.setWeather(ctx.world.weather.kind, ctx.clock.isNight);
    S.hud.setSpeed(ctx.clock.paused, ctx.clock.timeScale);
    S.hud.setClock(S.day, ctx.clock.hours);
    S.hud.setSlider(ctx.clock.hours);
    S.lastHours = ctx.clock.hours;

    // events
    S.offs.push(
      ctx.events.on('sim:tick', (p) => {
        S.hadTick = true;
        applyStats(p?.stats);
        const d = p?.demand || {};
        S.hud.setDemand(d.r || 0, d.c || 0, d.i || 0);
      }),
      ctx.events.on('tool:selected', (p) => { S.tool = p?.tool ?? null; S.hud.setTool(S.tool); }),
      ctx.events.on('weather:changed', (p) => S.hud.setWeather(p?.weather?.kind || ctx.world.weather.kind, ctx.clock.isNight)),
      ctx.events.on('time:changed', (p) => { if (p?.isNight !== S._night) { S._night = p?.isNight; S.hud.setWeather(ctx.world.weather.kind, !!p?.isNight); } }),
      ctx.events.on('world:cell', () => S.minimap?.markDirty()),
      ctx.events.on('road:added', () => S.minimap?.markDirty()),
      ctx.events.on('road:removed', () => S.minimap?.markDirty()),
      ctx.events.on('terrain:changed', () => S.minimap?.markDirty()),
      ctx.events.on('zone:changed', () => S.minimap?.markDirty()),
      ctx.events.on('building:spawned', () => S.minimap?.markDirty()),
      ctx.events.on('building:removed', () => S.minimap?.markDirty()),
    );
    S.onKey = onKey;
    window.addEventListener('keydown', S.onKey);
    S.onPointer = (e) => { S.pointer.x = e.clientX; S.pointer.y = e.clientY; };
    window.addEventListener('pointermove', S.onPointer, { passive: true });
  },

  update(dt, ctx) {
    const hud = S.hud;
    if (!hud) return;
    const hours = ctx.clock.hours;
    // Day advances only on a clock-driven midnight wrap (running clock, late evening -> early morning), never when
    // the time slider / setTime() scrubs backwards.
    if (S.lastHours !== null && !ctx.clock.paused && ctx.clock.timeScale > 0 && hours < S.lastHours && S.lastHours > 22 && hours < 2) S.day++;
    S.lastHours = hours;
    const minute = Math.floor(hours * 60);
    if (minute !== S.lastMinute) { S.lastMinute = minute; hud.setClock(S.day, hours); hud.setSlider(hours); }
    hud.setSpeed(ctx.clock.paused, ctx.clock.timeScale);
    if (!S.hadTick) {
      S.statsPoll += dt;
      if (S.statsPoll >= 0.5) { S.statsPoll = 0; applyStats(ctx.world.stats); }
    }
    hud.tickTooltip(S.pointer.x, S.pointer.y);
    S.minimap.update(dt);
  },

  dispose() {
    for (const off of S.offs) off();
    S.offs.length = 0;
    if (S.onKey) window.removeEventListener('keydown', S.onKey);
    if (S.onPointer) window.removeEventListener('pointermove', S.onPointer);
    S.backdrop?.dispose(); S.backdrop = null;
    S.minimap?.dispose(); S.minimap = null;
    S.hud?.dispose(); S.hud = null;
    S.style?.remove(); S.style = null;
    Object.assign(S, initialState()); // full reset so a dispose -> init cycle starts at Day 1 with no tool / stale settings
  },

  async showcase(ctx, variant = 'default') {
    S.backdrop?.dispose();
    S.backdrop = stageBackdrop(ctx, variant, ctx.rng.fork(`ui:showcase:${variant}`));
    if (variant === 'night') { ctx.clock.paused = true; ctx.clock.set(21.5); }
    // fake, plausible HUD data
    api.setStats({ money: 124500, population: 18420, jobs: 9870, happiness: 0.82 });
    api.setDemand({ r: 0.7, c: 0.4, i: 0.2 });
    S.hud.clearToasts();
    // long-lived (not sticky) so the real timer path is exercised
    const long = { ms: 10 * 60 * 1000 };
    if (variant === 'night') {
      api.notify('Streetlights switched on across Brickport', 'info', long);
      api.notify('Night market opened in Old Town (+$1,800)', 'success', long);
    } else {
      api.notify('New residents moved into Maple Street', 'success', long);
      api.notify('Traffic is building up on 2nd Avenue', 'warn', long);
    }
    api.setInfoPanel(sampleInfoCard());
    api.setStatus('Road: 12 cells, $1,200');
    selectTool('road:street');
    S.minimap?.markDirty();
  },
};
