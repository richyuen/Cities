// menu — title screen, pause menu, options, new city, save/load, credits. Owns ctx.paused. See ARCHITECTURE.md
// module-order table (order 95, after ui/audio/effects) and the plan doc for the full design rationale.
import { CSS } from './styles.js';
import { h } from './dom.js';
import { createConfirmHost } from './dialogs.js';
import { renderTitleScreen } from './titleScreen.js';
import { renderPauseMenu } from './pauseMenu.js';
import { renderOptions } from './options.js';
import { renderNewCity } from './newCity.js';
import { renderSaveLoad } from './saveLoad.js';
import { renderCredits } from './credits.js';
import { readSlot } from './storage.js';
import { applySave } from './serialize.js';

const ROOT_VIEWS = new Set(['title', 'pause']);
const SUB_VIEWS = new Set(['options', 'newCity', 'saveLoad', 'credits']);

const initialState = () => ({
  ctx: null, root: null, style: null, backdrop: null, panelHost: null, confirmHost: null,
  stack: [], wasClockPaused: false, wasHudVisible: true, pendingBoot: false, bootFrames: 0, forcedView: null, onKey: null,
  viewState: { optionsTab: 'Graphics' },
  prefs: { audio: { master: 0.8, ambience: 1.0, sfx: 1.0, muted: false } },
});
const S = initialState();

function modApi(ctx, id) { const m = ctx.modules.get(id); return m?.status === 'ok' ? m.api : null; }

function buildReloadUrl({ seed, city, load, exclude }) {
  const url = new URL(location.pathname, location.origin);
  if (seed != null) url.searchParams.set('seed', String(seed));
  if (city) url.searchParams.set('city', city);
  if (load) url.searchParams.set('load', load);
  if (exclude) url.searchParams.set('exclude', exclude);
  return url;
}

function render() {
  if (!S.panelHost) return;
  S.panelHost.innerHTML = '';
  const view = S.stack[S.stack.length - 1];
  if (!view) return;
  const el =
    view === 'title' ? renderTitleScreen(S.ctx, nav) :
    view === 'pause' ? renderPauseMenu(S.ctx, nav) :
    view === 'options' ? renderOptions(S.ctx, nav) :
    view === 'newCity' ? renderNewCity(S.ctx, nav) :
    view === 'saveLoad' ? renderSaveLoad(S.ctx, nav) :
    renderCredits(S.ctx, nav);
  S.panelHost.append(el);
}

function openMenu(kind) {
  const ctx = S.ctx;
  if (S.stack.length === 0) {
    // Entering any menu view from fully closed: the gameplay HUD (stat bars, build toolbar, minimap) has no
    // business showing behind a menu screen. Remember the player's own H-key preference and restore it on close.
    S.wasHudVisible = modApi(ctx, 'ui')?.isHudVisible?.() ?? true;
    modApi(ctx, 'ui')?.setHudVisible?.(false);
  }
  if (kind === 'pause' && !ctx.paused) {
    S.wasClockPaused = ctx.clock.paused;
    ctx.clock.paused = true;
    ctx.paused = true;
    modApi(ctx, 'traffic')?.pause?.();
    modApi(ctx, 'tools')?.cancel?.();
  } else if (kind === 'title' && ctx.paused) {
    // Returning to the title from a paused game (Quit to Title): the title background is always live, so
    // unfreeze regardless of what the player's clock-pause state was mid-game.
    modApi(ctx, 'traffic')?.resume?.();
    ctx.clock.paused = false;
    ctx.paused = false;
  }
  // The camera never takes player input while any menu view is open (title's background camera is fixed;
  // pause's frozen camera would otherwise silently accumulate a WASD pan via MapControls' own window
  // keydown listener — since controls.update() doesn't run while paused — and jump on resume).
  ctx.controls.enabled = false;
  if (kind === 'title') ctx.cameraApi.apply('menu:title');
  S.backdrop.classList.toggle('lc-menu-backdrop--title', kind === 'title');
  S.stack = [kind];
  S.backdrop.classList.add('open');
  document.body.classList.add('lc-menu-open'); // hides ui's own "Show HUD" pill (see styles.js): that affordance
  render();                                     // is for the player's own H-key toggle, not menu-driven hiding.
}

function closeMenu() {
  const ctx = S.ctx;
  modApi(ctx, 'traffic')?.resume?.();
  ctx.clock.paused = S.wasClockPaused;
  ctx.paused = false;
  ctx.controls.enabled = true;
  modApi(ctx, 'ui')?.setHudVisible?.(S.wasHudVisible);
  S.stack = [];
  S.backdrop.classList.remove('open');
  document.body.classList.remove('lc-menu-open');
}

const nav = {
  get state() { return S.viewState; },
  get prefs() { return S.prefs; },
  push(view) { S.stack.push(view); render(); },
  back() {
    if (S.stack.length > 1) { S.stack.pop(); render(); return; }
    if (S.stack[0] === 'pause') closeMenu();
    // title root: Escape/back has nothing to do
  },
  resume() { closeMenu(); },
  quitToTitle() { openMenu('title'); },
  rootView() { return S.stack[0]; },
  confirm: (opts) => S.confirmHost.confirm(opts),
  notify: (text, kind = 'info') => modApi(S.ctx, 'ui')?.notify?.(text, kind),
  reloadNewCity(seed, name, blank) { location.assign(buildReloadUrl({ seed, city: name, exclude: blank ? 'demo' : null })); },
  reloadLoadCity(slot) { location.assign(buildReloadUrl({ seed: slot.seed, city: slot.name, load: slot.slotId, exclude: slot.demoActive === false ? 'demo' : null })); },
};

function onKey(e) {
  if (e.code !== 'Escape' || e.repeat) return;
  const ctx = S.ctx;
  if (S.stack.length) {
    if (S.confirmHost.isOpen()) { S.confirmHost.closeImmediate(); e.preventDefault(); e.stopPropagation(); return; }
    nav.back();
    e.preventDefault(); e.stopPropagation();
    return;
  }
  const uiApi = modApi(ctx, 'ui');
  const toolsApi = modApi(ctx, 'tools');
  if (uiApi?.isSettingsOpen?.() || uiApi?.isModalOpen?.() || uiApi?.isInfoPanelOpen?.() || uiApi?.getTool?.() || toolsApi?.getGhostState?.()?.dragging) return; // not ours — let it fall through
  openMenu('pause');
  e.preventDefault(); e.stopPropagation();
}

function applyPendingLoad(ctx) {
  const slotId = ctx.params.get('load');
  const save = slotId ? readSlot(slotId) : null;
  if (!save) {
    if (slotId) modApi(ctx, 'ui')?.notify?.('Save not found', 'error');
    openMenu('title');
    return;
  }
  applySave(ctx, save);
}

export default {
  id: 'menu',
  deps: [],
  order: 95,
  showcaseVariants: ['default'],
  presets: {
    // Fixed elevated view down the x=0 avenue for the title screen background, looking south at the downtown
    // intersection from north of downtown. Anchoring on the avenue itself (rather than inside a block, as this
    // preset used to) matters: roads are never buildable, so the view can't be blocked by a later layout change —
    // the previous vantage sat inside the block the demo city's utility pass now fills with a power plant, whose
    // cooling towers ended up right in front of the lens. Passing traffic reads as scale/life in the shot, the
    // crosswalks and Central Park sit either side of the near field, and the tower cluster/skyline close the
    // frame. fov 41 keeps the compression the old preset had.
    'menu:title': (world) => {
      const gh = (x, z) => world.getHeight(x, z);
      return { pos: [0, 20 + gh(0, -105), -105], target: [0, 6, 40], fov: 41 };
    },
  },
  api: {
    isOpen: () => S.stack.length > 0,
    isPaused: () => !!S.ctx?.paused,
    openPause: () => openMenu('pause'),
  },

  async init(ctx) {
    S.ctx = ctx;
    const dom = ctx.dom || document.body;

    document.getElementById('lc-menu-style')?.remove();
    S.style = document.createElement('style');
    S.style.id = 'lc-menu-style';
    S.style.textContent = CSS;
    document.head.appendChild(S.style);

    S.confirmHost = createConfirmHost();
    S.panelHost = h('div', { class: 'lc-menu-panel-host' });
    S.backdrop = h('div', { class: 'lc-menu-backdrop' }, S.panelHost, S.confirmHost.el);
    S.root = h('div', { class: 'lc-menu' }, S.backdrop);
    dom.appendChild(S.root);

    S.onKey = onKey;
    window.addEventListener('keydown', S.onKey, true); // capture phase: claims Escape before ui/tools' bubble handlers

    // `?menu=<view>` forces that view open regardless of fixeddt/showcase (debugging + tools/shot.mjs, which
    // always sets fixeddt=1); `?menu=0` disables the normal title-on-boot entirely.
    const forced = ctx.params.get('menu');
    S.forcedView = forced && forced !== '0' ? forced : null;
    S.pendingBoot = !!S.forcedView || (!ctx.showcase && ctx.params.get('fixeddt') !== '1');
    S.bootFrames = 0;
  },

  update(dt, ctx) {
    if (!S.pendingBoot) return;
    if (++S.bootFrames < 2) return; // let environment/effects settle one normal frame before the menu backdrop opens
    S.pendingBoot = false;
    if (S.forcedView) {
      if (ROOT_VIEWS.has(S.forcedView)) openMenu(S.forcedView);
      else if (SUB_VIEWS.has(S.forcedView)) { openMenu('title'); nav.push(S.forcedView); }
      else openMenu('title');
      return;
    }
    applyPendingLoad(ctx);
  },

  dispose() {
    if (S.onKey) window.removeEventListener('keydown', S.onKey, true);
    S.root?.remove();
    S.style?.remove();
    document.body.classList.remove('lc-menu-open');
    Object.assign(S, initialState());
  },

  async showcase(ctx, variant = 'default') {
    S.ctx = ctx;
    openMenu('title');
  },
};
