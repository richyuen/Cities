import { h } from './dom.js';
import { icons } from './icons.js';

export function renderPauseMenu(ctx, nav) {
  const cityName = ctx.params?.get('city') || 'Brickport';
  const item = (label, onclick, opts = {}) => h('button', { class: `lc-menu-item${opts.primary ? ' primary' : ''}` , onclick }, label);

  return h('div', { class: 'lc-menu-panel' },
    h('button', { class: 'lc-menu-close', title: 'Resume', html: icons.close, onclick: () => nav.resume() }),
    h('div', { class: 'lc-menu-title-row' }, h('div', { html: icons.logo }),
      h('div', {}, h('div', { class: 'lc-menu-heading' }, 'Paused'), h('div', { class: 'lc-menu-sub' }, cityName))),
    h('div', { class: 'lc-menu-list' },
      item('Resume', () => nav.resume(), { primary: true }),
      item('Save City', () => nav.push('saveLoad')),
      item('Load City', () => nav.push('saveLoad')),
      item('Options', () => nav.push('options')),
      item('New City', () => nav.push('newCity')),
      item('Quit to Title', () => nav.quitToTitle()),
      item('Credits', () => nav.push('credits'))));
}
