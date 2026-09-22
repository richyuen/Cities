// HUD DOM: builds every panel once and exposes cheap setters (text/class updates only when a value changes).
import { icons } from './icons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

const setText = (el, s) => { if (el._t !== s) { el._t = s; el.textContent = s; } };
const setClass = (el, cls, on) => { if (el._c?.[cls] !== on) { (el._c ||= {})[cls] = on; el.classList.toggle(cls, on); } };
const fmtInt = (v) => Math.round(Math.abs(v)).toLocaleString('en-US');
export const fmtMoney = (v) => (v < 0 ? '-$' : '$') + fmtInt(v);
const pad2 = (n) => (n < 10 ? '0' : '') + n;

export const TOOL_GROUPS = [
  { label: 'Roads', tools: [['road:street', 'Street'], ['road:avenue', 'Avenue'], ['road:highway', 'Highway'], ['road:path', 'Path']] },
  { label: 'Zones', tools: [['zone:r', 'Homes'], ['zone:c', 'Shops'], ['zone:i', 'Industry'], ['zone:none', 'Dezone']] },
  { label: 'Parks', tools: [['park', 'Park'], ['trees', 'Trees'], ['plaza', 'Plaza']] },
  { label: 'Utilities', tools: [['utility:power', 'Power Plant'], ['utility:water', 'Water Tower'], ['utility:firedept', 'Fire Department'], ['utility:police', 'Police Station']] },
  { label: 'Tools', tools: [['bulldoze', 'Bulldoze', 'B'], ['select', 'Inspect', 'I']] },
  { label: 'Hazards', tools: [['hazard:fire', 'Start Fire'], ['hazard:burglary', 'Start Burglary']] },
];
const DANGER = new Set(['bulldoze', 'zone:none', 'hazard:fire', 'hazard:burglary']);
const MAX_TOASTS_VISIBLE = 3, MAX_TOASTS_KEPT = 8;
const WEATHER_LABEL = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', fog: 'Fog' };
const TOAST_ICON = { info: icons.info, success: icons.check, warn: icons.warn, error: icons.close };
const KEYS = [['Esc', 'Deselect tool / close'], ['Space', 'Pause / resume'], ['1 2 3', 'Speed 1x 2x 4x'], ['B', 'Bulldoze'], ['I', 'Inspect'],
  ['H', 'Hide / show HUD'], ['W A S D', 'Pan camera'], ['Drag / Wheel', 'Orbit / zoom']];

export class Hud {
  constructor(ctx, on) {
    this.ctx = ctx;
    this.on = on;
    this.toolBtns = new Map();
    this.speedBtns = {};
    this.qualityBtns = {};
    this.sliderDragging = false;
    this._tip = { mode: null, x: -1, y: -1, w: 0, hgt: 0 };
    this._mood = -1;
    this._weatherKey = '';
    this._speedMode = '';
    this._vw = 0; this._vh = 0;
    this._onResize = () => { this._vw = 0; this._vh = 0; };
    window.addEventListener('resize', this._onResize);
    this._build();
  }

  _build() {
    const cityName = this.ctx.params?.get('city') || 'Brickport';
    const root = this.el = h('div', { class: 'lc-hud', style: 'pointer-events:none' });

    // ---- top-left: brand + stats ----
    const stat = (key, label, icon, onClick) => {
      const value = h('div', { class: 'lc-stat-value lc-num' }, '—');
      const ico = h('div', { class: `lc-stat-ico ${key}`, html: icon });
      const attrs = { class: `lc-stat${onClick ? ' clickable' : ''}` };
      if (onClick) { attrs.onclick = onClick; attrs.tabIndex = '0'; attrs.title = `${label} details`; }
      const el = h('div', attrs, ico, h('div', { class: 'lc-stat-txt' }, h('div', { class: 'lc-stat-label' }, label), value));
      return { el, value, ico };
    };
    this.money = stat('money', 'Treasury', icons.money, () => this.on.statClick?.('money'));
    this.pop = stat('pop', 'Population', icons.pop, () => this.on.statClick?.('pop'));
    this.jobs = stat('jobs', 'Jobs', icons.jobs, () => this.on.statClick?.('jobs'));
    this.happy = stat('happy', 'Happiness', icons.happy(2));
    root.append(h('div', { class: 'lc-panel lc-top-left' },
      h('div', { class: 'lc-studs' }),
      h('div', { class: 'lc-brand' }, h('div', { html: icons.logo }), h('div', { class: 'lc-city' }, h('div', { class: 'lc-city-name' }, cityName), h('div', { class: 'lc-city-sub' }, 'Lego Skylines'))),
      h('div', { class: 'lc-divider' }),
      this.money.el, this.pop.el, this.jobs.el, this.happy.el));

    // ---- top-right: weather, clock, speed, tod slider, gear ----
    this.weatherIco = h('div', { html: icons.sun });
    this.weatherTxt = h('div', { class: 'lc-weather-txt' }, 'Clear');
    this.dayEl = h('div', { class: 'lc-day' }, 'Day 1');
    this.timeEl = h('div', { class: 'lc-time lc-num' }, '12:00');
    const speed = h('div', { class: 'lc-speed' });
    for (const [mode, icon, title] of [['pause', icons.pause, 'Pause'], [1, icons.play, 'Normal speed'], [2, icons.fast, '2x speed'], [4, icons.faster, '4x speed']]) {
      const b = h('button', { class: `lc-speedbtn ${mode === 'pause' ? 'pause' : ''}`, html: icon, title, onclick: () => this.on.speed(mode) });
      this.speedBtns[mode] = b;
      speed.append(b);
    }
    this.slider = h('input', { type: 'range', min: '0', max: '24', step: '0.05', value: '12', title: 'Time of day' });
    this.slider.addEventListener('input', () => { this.sliderDragging = true; this.on.tod(parseFloat(this.slider.value)); });
    this.slider.addEventListener('change', () => { this.sliderDragging = false; });
    this.slider.addEventListener('pointerup', () => { this.sliderDragging = false; });
    this.gear = h('button', { class: 'lc-gear', html: icons.gear, title: 'Settings', onclick: () => this.toggleSettings() });
    root.append(h('div', { class: 'lc-panel lc-top-right' },
      h('div', { class: 'lc-studs' }),
      h('div', { class: 'lc-weather' }, this.weatherIco, this.weatherTxt),
      h('div', { class: 'lc-divider' }),
      h('div', { class: 'lc-clock' }, this.dayEl, this.timeEl),
      h('div', { class: 'lc-divider' }),
      speed,
      h('div', { class: 'lc-tod' }, h('div', { html: icons.moon }), this.slider, h('div', { html: icons.sun })),
      h('div', { class: 'lc-divider' }),
      this.gear));

    // ---- settings popover ----
    const seg = h('div', { class: 'lc-seg' });
    for (const q of ['low', 'med', 'high']) {
      const b = h('button', { onclick: () => this.on.quality(q) }, q[0].toUpperCase() + q.slice(1));
      this.qualityBtns[q] = b; seg.append(b);
    }
    this.studSwitch = h('button', { class: 'lc-switch on', title: 'Toggle studs', onclick: () => this.on.studs(!this.studSwitch.classList.contains('on')) });
    this.hudSwitch = h('button', { class: 'lc-switch on', title: 'Toggle HUD', onclick: () => this.on.toggleUi() });
    const keys = h('div', { class: 'lc-keys' });
    for (const [k, d] of KEYS) keys.append(h('span', { class: 'lc-key' }, k), h('span', {}, d));
    this.settings = h('div', { class: 'lc-panel lc-settings' },
      h('div', { class: 'lc-caret' }),
      h('h3', {}, 'Settings'),
      h('div', { class: 'lc-row' }, h('span', {}, 'Quality'), seg),
      h('div', { class: 'lc-row' }, h('span', {}, 'Show studs'), this.studSwitch),
      h('div', { class: 'lc-row' }, h('span', {}, 'Show HUD'), this.hudSwitch),
      h('h3', {}, 'Keyboard'), keys);
    root.append(this.settings);

    // ---- toasts / info / tooltip / status ----
    this.toastMore = h('button', { class: 'lc-toast-more', title: 'Dismiss older notifications', onclick: () => this._dismissHiddenToasts() });
    this.toasts = h('div', { class: 'lc-toasts' }, this.toastMore);
    this.toastTimers = new Set();
    this.infoBody = h('div', { class: 'lc-info-body' });
    this.info = h('div', { class: 'lc-panel lc-info' },
      h('div', { class: 'lc-studs' }),
      h('div', { class: 'lc-info-head' }, h('div', { class: 'lc-info-title' }, 'Inspect'),
        h('button', { class: 'lc-close', html: icons.close, title: 'Close', onclick: () => { this.setInfoPanel(null); this.ctx.events.emit('inspect:closed'); } })),
      this.infoBody);
    this.tooltip = h('div', { class: 'lc-tooltip' });
    this.statusTxt = h('span', {});
    this.status = h('div', { class: 'lc-status' }, this.statusTxt);
    root.append(this.toasts, this.info, this.tooltip, this.status);

    // ---- generic modal (Treasury/Population/Jobs status windows) ----
    this.modalTitle = h('div', { class: 'lc-info-title' }, '');
    this.modalBody = h('div', { class: 'lc-info-body' });
    this.modalCard = h('div', { class: 'lc-panel lc-modal' },
      h('div', { class: 'lc-studs' }),
      h('div', { class: 'lc-info-head' }, this.modalTitle,
        h('button', { class: 'lc-close', html: icons.close, title: 'Close', onclick: () => this.closeModal() })),
      this.modalBody);
    this.modalOverlay = h('div', { class: 'lc-modal-overlay', onclick: (e) => { if (e.target === this.modalOverlay) this.closeModal(); } }, this.modalCard);
    root.append(this.modalOverlay);

    // ---- RCI ----
    this.rci = {};
    const bars = h('div', { class: 'lc-rci-bars' });
    for (const [k, lbl] of [['r', 'R'], ['c', 'C'], ['i', 'I']]) {
      const fill = h('div', { class: 'lc-rci-fill' });
      bars.append(h('div', { class: `lc-rci-col ${k}` }, h('div', { class: 'lc-rci-track' }, fill), h('div', { class: 'lc-rci-lbl' }, lbl)));
      this.rci[k] = fill;
    }
    root.append(h('div', { class: 'lc-panel lc-rci' }, h('div', { class: 'lc-studs' }), h('div', { class: 'lc-rci-title' }, 'Demand'), bars));

    // ---- Utilities coverage ----
    const utilRow = (key, label) => {
      const value = h('span', { class: 'lc-util-pct' }, '—');
      return { el: h('div', { class: 'lc-util-row' }, h('span', { class: 'lc-util-lbl' }, label), value), value };
    };
    this.powerCov = utilRow('power', 'Power');
    this.waterCov = utilRow('water', 'Water');
    root.append(h('div', { class: 'lc-panel lc-utilities' }, h('div', { class: 'lc-studs' }),
      h('div', { class: 'lc-rci-title' }, 'Utilities'), this.powerCov.el, this.waterCov.el));

    // ---- toolbar ----
    const bar = h('div', { class: 'lc-panel lc-toolbar' }, h('div', { class: 'lc-studs' }));
    TOOL_GROUPS.forEach((g, gi) => {
      if (gi) bar.append(h('div', { class: 'lc-divider' }));
      const btns = h('div', { class: 'lc-group-btns' });
      for (const [tool, label, key] of g.tools) {
        const b = h('button', { class: `lc-tool${DANGER.has(tool) ? ' danger' : ''}`, html: icons[tool], 'data-tool': tool,
          onclick: () => this.on.tool(tool),
          onpointerenter: () => this.setTooltip(label, { anchor: b, key }),
          onpointerleave: () => { if (this._tip.mode === 'anchor') this.setTooltip(null); } });
        b.append(h('span', {}, label));
        this.toolBtns.set(tool, b);
        btns.append(b);
      }
      bar.append(h('div', { class: 'lc-group' }, h('div', { class: 'lc-group-lbl' }, g.label), btns));
    });
    root.append(bar);

    // ---- minimap ----
    this.minimapCanvas = h('canvas', { width: '388', height: '388', title: 'Click to move the camera' });
    const legend = h('div', { class: 'lc-legend' });
    for (const [c, lbl, cls] of [['#a5ca18', 'Homes'], ['#2878cd', 'Shops'], ['#dc7828', 'Industry'], ['#5d646d', 'Roads'], ['#146e5a', 'Parks', 'hatch'], ['#1e8ec0', 'Water']]) {
      legend.append(h('span', {}, h('i', { class: cls, style: `background:${c}` }), lbl));
    }
    root.append(h('div', { class: 'lc-panel lc-minimap' }, h('div', { class: 'lc-studs' }), this.minimapCanvas,
      h('div', { class: 'lc-minimap-foot' }, h('span', {}, 'Map'), h('span', {}, 'Click to move')), legend));

    // ---- show-ui pill ----
    root.append(h('button', { class: 'lc-show-ui lc-brick', onclick: () => this.on.toggleUi() }, 'Show HUD  (H)'));
  }

  // ---------- stats ----------
  setMoney(v) { setText(this.money.value, fmtMoney(v)); setClass(this.money.value, 'neg', v < 0); }
  setPop(v) { setText(this.pop.value, fmtInt(v)); }
  setJobs(v) { setText(this.jobs.value, fmtInt(v)); }
  setHappiness(f) {
    const pct = Math.round(Math.max(0, Math.min(1, f)) * 100);
    setText(this.happy.value, `${pct}%`);
    const mood = pct >= 66 ? 2 : pct >= 40 ? 1 : 0;
    if (mood !== this._mood) { this._mood = mood; this.happy.ico.innerHTML = icons.happy(mood); }
  }
  setDemand(r, c, i) {
    const set = (el, v) => { const p = `${Math.round(Math.max(0, Math.min(1, v || 0)) * 100)}%`; if (el._h !== p) { el._h = p; el.style.height = p; } };
    set(this.rci.r, r); set(this.rci.c, c); set(this.rci.i, i);
  }
  setUtilities(power, water) {
    setText(this.powerCov.value, `${Math.round(Math.max(0, Math.min(1, power || 0)) * 100)}%`);
    setText(this.waterCov.value, `${Math.round(Math.max(0, Math.min(1, water || 0)) * 100)}%`);
  }

  // ---------- clock / speed / weather ----------
  setClock(day, hours) {
    setText(this.dayEl, `Day ${day}`);
    const hh = Math.floor(hours) % 24, mm = Math.floor((hours - Math.floor(hours)) * 60);
    setText(this.timeEl, `${pad2(hh)}:${pad2(mm)}`);
  }
  setSlider(hours) { if (!this.sliderDragging && Math.abs(parseFloat(this.slider.value) - hours) > 0.02) this.slider.value = hours.toFixed(2); }
  setSpeed(paused, scale) {
    const mode = paused ? 'pause' : scale >= 4 ? 4 : scale >= 2 ? 2 : 1;
    if (mode === this._speedMode) return;
    this._speedMode = mode;
    for (const [k, b] of Object.entries(this.speedBtns)) b.classList.toggle('on', String(k) === String(mode));
  }
  setWeather(kind, isNight) {
    const key = kind === 'clear' || !WEATHER_LABEL[kind] ? (isNight ? 'moon' : 'sun') : kind;
    if (key === this._weatherKey) return;
    this._weatherKey = key;
    this.weatherIco.innerHTML = icons[key] || icons.sun;
    setText(this.weatherTxt, WEATHER_LABEL[kind] || 'Clear');
  }

  // ---------- tools ----------
  setTool(tool) {
    for (const [t, b] of this.toolBtns) setClass(b, 'on', t === tool);
  }

  // ---------- settings ----------
  toggleSettings(force) {
    const open = force ?? !this.settings.classList.contains('open');
    if (open === this.settings.classList.contains('open')) return;
    this.settings.classList.toggle('open', open);
    this.gear.classList.toggle('on', open);
    this.el.classList.toggle('lc-settings-open', open);
    // push the inspect card below the popover (instead of hiding it) so a selection stays visible while changing settings
    if (open) {
      const hudTop = this.el.getBoundingClientRect().top;
      this.el.style.setProperty('--lc-info-top', `${Math.round(this.settings.getBoundingClientRect().bottom - hudTop) + 12}px`);
    } else this.el.style.removeProperty('--lc-info-top');
    if (open) {
      this._outside ||= (e) => { if (!this.settings.contains(e.target) && !this.gear.contains(e.target)) this.toggleSettings(false); };
      window.addEventListener('pointerdown', this._outside, true);
    } else if (this._outside) window.removeEventListener('pointerdown', this._outside, true);
  }
  isSettingsOpen() { return this.settings.classList.contains('open'); }
  setQuality(q) { for (const [k, b] of Object.entries(this.qualityBtns)) b.classList.toggle('on', k === q); }
  setStuds(on) { this.studSwitch.classList.toggle('on', !!on); }
  setHudVisible(v) { this.el.classList.toggle('lc-hidden', !v); this.hudSwitch.classList.toggle('on', !!v); }

  // ---------- notifications / info / tooltip / status ----------
  notify(text, kind = 'info', { sticky = false, ms = 4500 } = {}) {
    if (!TOAST_ICON[kind]) kind = 'info';
    const t = h('div', { class: `lc-toast ${kind}`, title: String(text) }, h('div', { class: 'lc-toast-ico', html: TOAST_ICON[kind] }), h('div', {}, String(text)));
    this.toasts.append(t);
    if (!sticky) this._timer(ms, () => this._removeToast(t, true));
    t.addEventListener('click', () => this._removeToast(t, false));
    const list = this._toastList();
    for (let i = 0; i < list.length - MAX_TOASTS_KEPT; i++) list[i].remove(); // oldest first; one query, no per-iteration re-scan
    this._layoutToasts();
    return t;
  }
  clearToasts() { for (const t of this._toastList()) t.remove(); this._layoutToasts(); }
  _toastList() { return [...this.toasts.querySelectorAll('.lc-toast:not(.out)')]; }
  _removeToast(t, animate) {
    if (!t.isConnected || t.classList.contains('out')) return;
    if (animate && !t.classList.contains('lc-hid')) { t.classList.add('out'); this._timer(260, () => { t.remove(); this._layoutToasts(); }); }
    else t.remove();
    this._layoutToasts();
  }
  /** Newest MAX_TOASTS_VISIBLE stay visible; older ones collapse into a "+N" pill so the stack never grows into the 3D view. */
  _layoutToasts() {
    const list = this._toastList();
    const hidden = Math.max(0, list.length - MAX_TOASTS_VISIBLE);
    list.forEach((t, i) => setClass(t, 'lc-hid', i < hidden));
    setText(this.toastMore, `+${hidden} more`);
    setClass(this.toastMore, 'open', hidden > 0);
  }
  _dismissHiddenToasts() { for (const t of this._toastList()) if (t.classList.contains('lc-hid')) t.remove(); this._layoutToasts(); }
  _timer(ms, fn) {
    const id = setTimeout(() => { this.toastTimers.delete(id); fn(); }, ms);
    this.toastTimers.add(id);
    return id;
  }
  dispose() {
    for (const id of this.toastTimers) clearTimeout(id);
    this.toastTimers.clear();
    if (this._outside) window.removeEventListener('pointerdown', this._outside, true);
    window.removeEventListener('resize', this._onResize);
    this.el.remove();
  }

  setInfoPanel(html) {
    if (html == null || html === '') { this.info.classList.remove('open'); return; }
    if (this.infoBody._html !== html) { this.infoBody._html = html; this.infoBody.innerHTML = html; }
    this.info.classList.add('open');
  }

  openModal(title, bodyNode) {
    setText(this.modalTitle, title);
    this.modalBody.replaceChildren(bodyNode);
    this.modalOverlay.classList.add('open');
  }
  closeModal() { this.modalOverlay.classList.remove('open'); }
  isModalOpen() { return this.modalOverlay.classList.contains('open'); }
  isInfoPanelOpen() { return this.info.classList.contains('open'); }

  setStatus(text) {
    if (!text) { this.status.classList.remove('open'); return; }
    setText(this.statusTxt, String(text));
    if (this.status.title !== text) this.status.title = String(text);
    this.status.classList.add('open');
  }

  /** text: string|null. opts.anchor: element to hang the tip above; otherwise it follows the pointer (index.js feeds positions). */
  setTooltip(text, { anchor = null, key = null } = {}) {
    const tip = this.tooltip;
    if (!text) { if (this._tip.mode) { this._tip.mode = null; tip.classList.remove('open'); } return; }
    const html = key ? `${escapeHtml(text)}<span class="lc-key">${escapeHtml(key)}</span>` : escapeHtml(String(text));
    const changed = tip._html !== html;
    if (changed) { tip._html = html; tip.innerHTML = html; }
    tip.classList.add('open');
    if (changed || !this._tip.w) { this._tip.w = tip.offsetWidth; this._tip.hgt = tip.offsetHeight; } // one layout read, only when the text changed
    if (anchor) {
      this._tip.mode = 'anchor';
      const r = anchor.getBoundingClientRect();
      let top = (anchor.closest('.lc-panel') || anchor).getBoundingClientRect().top; // hang above the whole bar, clear of group labels
      const x0 = r.left + r.width / 2 - this._tip.w / 2, x1 = x0 + this._tip.w;
      if (this.status.classList.contains('open')) {
        const s = this.status.getBoundingClientRect();
        if (x1 > s.left - 6 && x0 < s.right + 6) top = Math.min(top, s.top); // raise above the status pill only when the tip would overlap it
      }
      this._place(x0, top - this._tip.hgt - 8);
    } else {
      this._tip.mode = 'mouse';
      this._tip.x = -1; // force re-place on next tick
    }
  }
  /** Called per frame by index.js with the pointer position; cheap no-op unless the tip follows the mouse and moved. */
  tickTooltip(px, py) {
    if (this._tip.mode !== 'mouse') return;
    if (px === this._tip.x && py === this._tip.y) return;
    this._tip.x = px; this._tip.y = py;
    if (!this._vw) { this._vw = this.el.clientWidth; this._vh = this.el.clientHeight; } // cached; reset on resize
    const vw = this._vw, vh = this._vh;
    let x = px + 16, y = py + 20;
    if (x + this._tip.w > vw - 8) x = px - this._tip.w - 12;
    if (y + this._tip.hgt > vh - 8) y = py - this._tip.hgt - 12;
    this._place(x, y);
  }
  _place(x, y) { this.tooltip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`; }
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
