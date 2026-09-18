import { h } from './dom.js';
import { icons } from './icons.js';
import { listSlots } from './storage.js';

export function renderTitleScreen(ctx, nav) {
  const cityName = ctx.params?.get('city') || 'Brickport';
  const hasSaves = listSlots().length > 0;
  const item = (label, icon, onclick, opts = {}) => h('button', { class: `lc-menu-item${opts.primary ? ' primary' : ''}`, disabled: opts.disabled || undefined, onclick },
    h('span', { class: 'lc-menu-item-icon', html: icon }),
    h('span', { class: 'lc-menu-item-label' }, label));

  // Side-anchored hero lockup over the live 3D street, not the boxed `.lc-menu-panel` card the pause/subview
  // screens use — the game itself is meant to carry the visual weight here.
  return h('div', { class: 'lc-menu-title-hero' },
    h('div', { class: 'lc-menu-title-lockup' },
      h('div', { class: 'lc-menu-title-logo', html: icons.logo }),
      h('div', { class: 'lc-menu-title-word' },
        h('div', { class: 'lc-menu-title-tag' }, 'Lego Skylines'),
        h('div', { class: 'lc-menu-title-name' }, cityName))),
    h('div', { class: 'lc-menu-list lc-menu-title-list' },
      item('Continue', icons.play, () => nav.resume(), { primary: true }),
      item('New City', icons.plus, () => nav.push('newCity')),
      item('Load City', icons.folder, () => nav.push('saveLoad'), { disabled: !hasSaves }),
      item('Options', icons.gear, () => nav.push('options')),
      item('Credits', icons.info, () => nav.push('credits'))));
}
