// UI module: AAA-style Lego city-builder HUD rendered into ctx.dom (#ui-root). DOM only — zero draw calls in the game.
import { CSS } from './styles.js';
import { Hud, h, fmtMoney } from './hud.js';
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
  if (stats.powerCoverage !== undefined || stats.waterCoverage !== undefined) {
    S.hud.setUtilities(stats.powerCoverage || 0, stats.waterCoverage || 0);
  }
}

function simApi(ctx) { const m = ctx.modules.get('simulation'); return m?.status === 'ok' ? m.api : null; }
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v || 0)) * 100)}%`;
const num = (v) => Math.round(v || 0).toLocaleString('en-US');

function buildTreasuryModal(ctx) {
  const sim = simApi(ctx);
  if (!sim) return h('p', {}, 'Simulation unavailable.');
  const st = sim.getStats(), bud = sim.getBudget(), tax = sim.getTaxRate();
  const body = h('div', {},
    h('div', { class: 'lc-kv' },
      h('span', {}, 'Treasury'), h('span', {}, fmtMoney(st.money)),
      h('span', {}, 'Income / day'), h('span', {}, fmtMoney(bud.perDay.income.total)),
      h('span', {}, 'Expenses / day'), h('span', {}, fmtMoney(bud.perDay.expenses.total)),
      h('span', {}, 'Net / day'), h('span', {}, fmtMoney(bud.perDay.net))),
    h('h4', {}, 'Debt'),
    h('div', { class: 'lc-bar debt' }, h('i', { style: `width:${Math.round(st.debt * 100)}%` })),
    h('h4', {}, 'Tax rates'));
  for (const [zone, label] of [['r', 'Residential'], ['c', 'Commercial'], ['i', 'Industrial']]) {
    const pctLbl = h('span', {}, `${Math.round(tax[zone] * 100)}%`);
    const slider = h('input', { type: 'range', min: '0', max: '0.3', step: '0.01', value: String(tax[zone]) });
    slider.addEventListener('input', () => {
      sim.setTaxRate(zone, parseFloat(slider.value));
      pctLbl.textContent = `${Math.round(parseFloat(slider.value) * 100)}%`;
    });
    body.append(h('div', { class: 'lc-slider-row' }, h('div', { class: 'lc-slider-head' }, h('span', {}, label), pctLbl), slider));
  }
  return body;
}

function buildPopulationModal(ctx) {
  const sim = simApi(ctx);
  if (!sim) return h('p', {}, 'Simulation unavailable.');
  const st = sim.getStats();
  return h('div', {},
    h('div', { class: 'lc-kv' },
      h('span', {}, 'Population'), h('span', {}, num(st.population)),
      h('span', {}, 'Housing capacity'), h('span', {}, num(st.capacity.r)),
      h('span', {}, 'Occupancy'), h('span', {}, pct(st.occupancy.r)),
      h('span', {}, 'Housing demand'), h('span', {}, pct(st.demand.r)),
      h('span', {}, 'Happiness'), h('span', {}, pct(st.happiness)),
      h('span', {}, 'Park access'), h('span', {}, pct(st.parkShare)),
      h('span', {}, 'City level'), h('span', {}, st.cityLevelName)));
}

function buildJobsModal(ctx) {
  const sim = simApi(ctx);
  if (!sim) return h('p', {}, 'Simulation unavailable.');
  const st = sim.getStats();
  return h('div', {},
    h('div', { class: 'lc-kv' },
      h('span', {}, 'Total jobs'), h('span', {}, num(st.jobs)),
      h('span', {}, 'Workforce'), h('span', {}, num(st.workforce)),
      h('span', {}, 'Employment'), h('span', {}, pct(st.employment))),
    h('h4', {}, 'Commercial'),
    h('div', { class: 'lc-kv' },
      h('span', {}, 'Jobs'), h('span', {}, num(st.jobsC)),
      h('span', {}, 'Capacity'), h('span', {}, num(st.capacity.c)),
      h('span', {}, 'Occupancy'), h('span', {}, pct(st.occupancy.c))),
    h('h4', {}, 'Industrial'),
    h('div', { class: 'lc-kv' },
      h('span', {}, 'Jobs'), h('span', {}, num(st.jobsI)),
      h('span', {}, 'Capacity'), h('span', {}, num(st.capacity.i)),
      h('span', {}, 'Occupancy'), h('span', {}, pct(st.occupancy.i))));
}

function openStatModal(key) {
  if (key === 'money') S.hud.openModal('Treasury', buildTreasuryModal(S.ctx));
  else if (key === 'pop') S.hud.openModal('Population', buildPopulationModal(S.ctx));
  else if (key === 'jobs') S.hud.openModal('Jobs', buildJobsModal(S.ctx));
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
  // Escape must close the stat modal even while a tax slider inside it has focus (the INPUT guard below exists so
  // typing in a form field doesn't trigger game shortcuts, but Escape-to-close is the standard form-field
  // convention anyway, and without this carve-out closing the modal by keyboard is impossible right after
  // dragging a slider).
  if (e.code === 'Escape' && S.hud?.isModalOpen()) { S.hud.closeModal(); return; }
  const t = e.target;
  if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (S.ctx.modules.get('menu')?.api?.isOpen?.()) return; // menu (title/pause) owns input while open
  const clock = S.ctx.clock;
  switch (e.code) {
    case 'Escape':
      if (S.hud.isModalOpen()) { S.hud.closeModal(); break; } // stat window takes priority, same as the settings popover
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
  isSettingsOpen: () => S.hud?.isSettingsOpen() ?? false,
  isModalOpen: () => S.hud?.isModalOpen() ?? false,
  isInfoPanelOpen: () => S.hud?.isInfoPanelOpen() ?? false,
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
      statClick: (key) => openStatModal(key),
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
