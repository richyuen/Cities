import { h } from './dom.js';
import { icons } from './icons.js';

function randomSeed() { return Math.floor(Math.random() * 1e9); }

const row = (label, control) => h('div', { class: 'lc-menu-row' }, h('span', {}, label), control);
const switchBtn = (on, onToggle) => {
  const b = h('button', { class: `lc-menu-switch ${on ? 'on' : ''}` });
  b.addEventListener('click', () => { const v = !b.classList.contains('on'); b.classList.toggle('on', v); onToggle(v); });
  return b;
};

export function renderNewCity(ctx, nav) {
  const seedInput = h('input', { class: 'lc-menu-input', type: 'number', min: '1', step: '1', value: String(randomSeed()) });
  const nameInput = h('input', { class: 'lc-menu-input', type: 'text', maxlength: '40', placeholder: 'City name', value: ctx.params?.get('city') || 'Brickport' });
  const diceBtn = h('button', { class: 'lc-menu-btn lc-menu-btn-ico', title: 'Randomize seed', html: icons.dice, onclick: () => { seedInput.value = String(randomSeed()); } });
  let includeDemo = false;

  const confirmBtn = h('button', { class: 'lc-menu-btn lc-menu-btn-primary', onclick: async () => {
    if (nav.rootView() === 'pause') {
      const ok = await nav.confirm({ title: 'Start a new city?', body: 'Your current, unsaved progress will be lost unless you save it first.', okLabel: 'Discard & start new', danger: true });
      if (!ok) return;
    }
    const seed = Math.max(1, Math.floor(Number(seedInput.value) || 1));
    nav.reloadNewCity(seed, nameInput.value.trim() || 'Brickport', !includeDemo);
  } }, 'Start City');

  return h('div', { class: 'lc-menu-panel' },
    h('div', { class: 'lc-menu-title-row' },
      h('button', { class: 'lc-menu-back', title: 'Back', html: icons.back, onclick: () => nav.back() }),
      h('div', { class: 'lc-menu-heading' }, 'New City')),
    h('div', { class: 'lc-menu-col' }, h('span', { class: 'lc-menu-hint' }, 'City name'), nameInput),
    h('div', { class: 'lc-menu-col' }, h('span', { class: 'lc-menu-hint' }, 'Seed'),
      h('div', { style: 'display:flex;gap:8px' }, seedInput, diceBtn)),
    h('div', { class: 'lc-menu-hint' }, 'The seed shapes the empty map (hills, river, coast) — the same seed always generates the same terrain.'),
    row('Pre-built demo city', switchBtn(includeDemo, (v) => { includeDemo = v; })),
    h('div', { class: 'lc-menu-hint' }, 'Adds a starter downtown, roads and zoning on a fixed layout that does not move with the seed. Off by default — you start on an empty map shaped by the seed.'),
    h('div', { class: 'lc-menu-actions' }, confirmBtn));
}
