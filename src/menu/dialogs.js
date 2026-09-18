// Shared modal chrome: a single confirm() promise-dialog stacked above whatever panel is currently open.
import { h } from './dom.js';

export function createConfirmHost() {
  let resolveFn = null;
  const titleEl = h('h3', { class: 'lc-menu-confirm-title' });
  const bodyEl = h('div', { class: 'lc-menu-confirm-body' });
  const okBtn = h('button', { class: 'lc-menu-btn' });
  const cancelBtn = h('button', { class: 'lc-menu-btn' }, 'Cancel');
  const card = h('div', { class: 'lc-menu-panel lc-menu-confirm' }, titleEl, bodyEl,
    h('div', { class: 'lc-menu-actions' }, cancelBtn, okBtn));
  const backdrop = h('div', { class: 'lc-modal-backdrop' }, card);

  function close(result) {
    backdrop.classList.remove('open');
    const r = resolveFn; resolveFn = null;
    if (r) r(result);
  }
  cancelBtn.addEventListener('click', () => close(false));
  okBtn.addEventListener('click', () => close(true));
  backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(false); });

  function confirm({ title, body, okLabel = 'OK', danger = false }) {
    titleEl.textContent = title;
    bodyEl.textContent = body;
    okBtn.textContent = okLabel;
    okBtn.classList.toggle('lc-menu-btn-danger', !!danger);
    okBtn.classList.toggle('lc-menu-btn-primary', !danger);
    backdrop.classList.add('open');
    return new Promise((resolve) => { resolveFn = resolve; });
  }

  return {
    el: backdrop,
    confirm,
    isOpen: () => backdrop.classList.contains('open'),
    closeImmediate: () => close(false),
  };
}
