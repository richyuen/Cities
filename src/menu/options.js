import { h } from './dom.js';
import { icons } from './icons.js';

const TABS = ['Graphics', 'Audio', 'Gameplay', 'Camera', 'Controls'];
const QUALITY = [['low', 'Low'], ['med', 'Medium'], ['high', 'High']];
const WEATHER = [['clear', 'Clear'], ['cloudy', 'Cloudy'], ['rain', 'Rain'], ['fog', 'Fog']];
const KEYS = [['Esc', 'Menu / close'], ['Space', 'Pause / resume'], ['1 2 3', 'Speed 1x 2x 4x'], ['B', 'Bulldoze'], ['I', 'Inspect'],
  ['H', 'Hide / show HUD'], ['W A S D', 'Pan camera'], ['Drag / Wheel', 'Orbit / zoom']];

function mod(ctx, id) { const m = ctx.modules.get(id); return m?.status === 'ok' ? m.api : null; }
const row = (label, control) => h('div', { class: 'lc-menu-row' }, h('span', {}, label), control);
const seg = (options, current, onPick) => {
  const btns = {};
  const el = h('div', { class: 'lc-menu-seg' });
  for (const [key, label] of options) {
    const b = h('button', { class: key === current ? 'on' : '', onclick: () => { onPick(key); for (const [k2, b2] of Object.entries(btns)) b2.classList.toggle('on', k2 === key); } }, label);
    btns[key] = b; el.append(b);
  }
  return el;
};
const switchBtn = (on, onToggle) => {
  const b = h('button', { class: `lc-menu-switch ${on ? 'on' : ''}` });
  b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); onToggle(v); });
  return b;
};
const slider = (min, max, step, value, onInput) => {
  const s = h('input', { type: 'range', class: 'lc-menu-slider', min, max, step, value });
  s.addEventListener('input', () => onInput(parseFloat(s.value)));
  return s;
};

function buildGraphics(ctx) {
  const ui = mod(ctx, 'ui');
  const settings = ui?.getSettings?.() ?? { quality: 'high', studs: true };
  const hudOn = ui?.isHudVisible?.() ?? true;
  return h('div', { class: 'lc-menu-tab-body' },
    row('Quality', seg(QUALITY, settings.quality, (q) => ctx.events.emit('settings:changed', { quality: q }))),
    row('Show studs', switchBtn(settings.studs, (v) => ctx.events.emit('settings:changed', { studs: v }))),
    row('Show HUD', switchBtn(hudOn, (v) => ui?.setHudVisible?.(v))),
    h('div', { class: 'lc-menu-hint' }, ui ? '' : 'HUD module not loaded — graphics settings limited.'));
}

function buildAudio(ctx, nav) {
  const audio = mod(ctx, 'audio');
  const prefs = nav.prefs.audio;
  const body = h('div', { class: 'lc-menu-tab-body' });
  if (!audio) { body.append(h('div', { class: 'lc-menu-hint' }, 'Audio module not loaded.')); return body; }
  const pct = (v) => `${Math.round(v * 100)}%`;
  const volRow = (label, key) => {
    const val = h('span', { class: 'lc-menu-hint' }, pct(prefs[key]));
    const s = slider(0, 1, 0.01, prefs[key], (v) => { prefs[key] = v; val.textContent = pct(v); audio.setVolume(prefs.master, { ambience: prefs.ambience, sfx: prefs.sfx }); });
    return row(label, h('div', { style: 'display:flex;align-items:center;gap:10px' }, s, val));
  };
  const enableBtn = h('button', { class: 'lc-menu-btn lc-menu-btn-primary', onclick: async () => {
    await audio.start?.();
    enableBtn.textContent = audio.isRunning?.() ? 'Sound enabled' : 'Enable Sound';
    enableBtn.disabled = !!audio.isRunning?.();
  } }, audio.isRunning?.() ? 'Sound enabled' : 'Enable Sound');
  enableBtn.disabled = !!audio.isRunning?.();
  body.append(
    row('Enable audio', enableBtn),
    volRow('Master volume', 'master'),
    volRow('Ambience', 'ambience'),
    volRow('Sound effects', 'sfx'),
    row('Mute', switchBtn(prefs.muted, (v) => { prefs.muted = v; audio.mute(v); })));
  return body;
}

function buildGameplay(ctx) {
  const traffic = mod(ctx, 'traffic');
  const simulation = mod(ctx, 'simulation');
  const environment = mod(ctx, 'environment');
  const body = h('div', { class: 'lc-menu-tab-body' });
  if (traffic) {
    const density = traffic.getDensity?.() ?? 0.55;
    const val = h('span', { class: 'lc-menu-hint' }, `${Math.round(density * 100)}%`);
    const s = slider(0, 1, 0.05, density, (v) => { traffic.setDensity(v); val.textContent = `${Math.round(v * 100)}%`; });
    body.append(row('Traffic density', h('div', { style: 'display:flex;align-items:center;gap:10px' }, s, val)));
  }
  if (simulation) {
    for (const [zone, label] of [['r', 'Residential tax'], ['c', 'Commercial tax'], ['i', 'Industrial tax']]) {
      const rate = simulation.getTaxRate(zone) ?? 0.09;
      const val = h('span', { class: 'lc-menu-hint' }, `${Math.round(rate * 100)}%`);
      const s = slider(0, 0.3, 0.01, rate, (v) => { simulation.setTaxRate(zone, v); val.textContent = `${Math.round(v * 100)}%`; });
      body.append(row(label, h('div', { style: 'display:flex;align-items:center;gap:10px' }, s, val)));
    }
  }
  if (environment) {
    const current = environment.state?.weather?.kind || 'clear';
    const select = h('select', { class: 'lc-menu-select' });
    for (const [k, label] of WEATHER) select.append(h('option', { value: k, selected: k === current || undefined }, label));
    select.addEventListener('change', () => environment.setWeather(select.value, 0.6));
    body.append(row('Weather', select));
  }
  if (!traffic && !simulation && !environment) body.append(h('div', { class: 'lc-menu-hint' }, 'No gameplay modules loaded.'));
  return body;
}

function buildCamera(ctx) {
  const body = h('div', { class: 'lc-menu-list' });
  for (const name of ctx.cameraPresets.list()) {
    body.append(h('button', { class: 'lc-menu-item', onclick: () => ctx.cameraApi.apply(name) }, name));
  }
  return body;
}

function buildControls() {
  const keys = h('div', { class: 'lc-menu-keys' });
  for (const [k, d] of KEYS) keys.append(h('span', { class: 'lc-menu-key' }, k), h('span', {}, d));
  return h('div', { class: 'lc-menu-tab-body' }, keys);
}

export function renderOptions(ctx, nav) {
  const body = h('div', { class: 'lc-menu-tab-body' });
  const tabBtns = {};
  const tabs = h('div', { class: 'lc-menu-tabs' });
  function selectTab(name) {
    nav.state.optionsTab = name;
    for (const [k, b] of Object.entries(tabBtns)) b.classList.toggle('on', k === name);
    body.innerHTML = '';
    body.append(
      name === 'Graphics' ? buildGraphics(ctx) :
      name === 'Audio' ? buildAudio(ctx, nav) :
      name === 'Gameplay' ? buildGameplay(ctx) :
      name === 'Camera' ? buildCamera(ctx) : buildControls());
  }
  for (const t of TABS) {
    const b = h('button', { class: 'lc-menu-tab', onclick: () => selectTab(t) }, t);
    tabBtns[t] = b; tabs.append(b);
  }
  const initial = nav.state.optionsTab || 'Graphics';
  const panel = h('div', { class: 'lc-menu-panel lc-menu-wide' },
    h('div', { class: 'lc-menu-title-row' },
      h('button', { class: 'lc-menu-back', title: 'Back', html: icons.back, onclick: () => nav.back() }),
      h('div', { class: 'lc-menu-heading' }, 'Options')),
    tabs, body);
  selectTab(initial);
  return panel;
}
