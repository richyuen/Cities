import { h } from './dom.js';
import { icons } from './icons.js';

export function renderCredits(ctx, nav) {
  return h('div', { class: 'lc-menu-panel' },
    h('div', { class: 'lc-menu-title-row' },
      h('button', { class: 'lc-menu-back', title: 'Back', html: icons.back, onclick: () => nav.back() }),
      h('div', { class: 'lc-menu-heading' }, 'Credits')),
    h('div', { class: 'lc-menu-credits' },
      h('p', {}, h('b', {}, 'Lego Skylines'), ' — a Three.js Lego-brick city builder.'),
      h('p', {}, 'Built with Three.js, Vite, and a fully seeded, deterministic city simulation.'),
      h('p', {}, 'All assets are CC0 or procedurally generated.'),
      h('p', {}, `Seed ${ctx.seed}`)));
}
