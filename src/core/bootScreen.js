// Boot overlay controller. The overlay markup and CSS live inline in index.html so something paints before
// the app bundle (and every module) has loaded; this file only drives it. Progress reports come from
// main.js (engine/assets phase) and registry.loadAll/initAll (per-module load/init), and ready()/fail()
// end the screen. No-op when the overlay is absent, so the app stays embeddable without it.

// Share of the overall bar per boot phase. Each phase reports its own done/total; the screen turns that
// into one monotonic 0..1 number, so no phase needs to know about the others.
const PHASE_WEIGHTS = { context: 0.03, load: 0.42, init: 0.55 };

// id → [what the loader is fetching, what init is building].
const MODULE_LABELS = {
  terrain: ['terrain', 'Shaping the terrain'],
  environment: ['sky and weather', 'Painting the sky'],
  roads: ['roads', 'Paving the streets'],
  zoning: ['zoning', 'Drawing the zoning map'],
  buildings: ['buildings', 'Stacking the buildings'],
  props: ['street props', 'Placing street props'],
  traffic: ['traffic', 'Sending out the traffic'],
  simulation: ['the simulation', 'Waking up the citizens'],
  tools: ['build tools', 'Handing you the tools'],
  ui: ['the interface', 'Building the interface'],
  audio: ['audio', 'Tuning the city sounds'],
  effects: ['visual effects', 'Polishing the picture'],
  menu: ['the menu', 'Setting the menu'],
  demo: ['the city layout', 'Generating the city'],
};

export function createBootScreen() {
  const el = document.getElementById('lc-boot');
  if (!el) return { setProgress() {}, status() {}, ready() {}, fail() {} };
  const bar = document.getElementById('lc-boot-bar');
  const fill = document.getElementById('lc-boot-fill');
  const status = document.getElementById('lc-boot-status');
  const pct = document.getElementById('lc-boot-pct');
  const err = document.getElementById('lc-boot-error');
  const name = document.getElementById('lc-boot-name');

  // The title screen names the city after ?city=; mirror it while we wait.
  const city = new URLSearchParams(location.search).get('city');
  if (city && name) name.textContent = city;

  let currentPhase = null;
  let phaseBase = 0; // weight of the phases already finished
  let target = 0;    // last reported progress, 0..1
  let shown = 0;     // animated progress, 0..1
  let lastPct = -1;
  let finished = false;
  let raf = 0;

  function apply() {
    const p = Math.round(shown * 100);
    if (p !== lastPct) {
      lastPct = p;
      if (pct) pct.textContent = `${p}%`;
      bar?.setAttribute('aria-valuenow', String(p));
    }
    fill.style.transform = `scaleX(${shown.toFixed(4)})`;
  }

  function frame() {
    raf = 0;
    if (finished) return;
    // Ease toward the reported progress; while a report stalls (a heavy synchronous init like city
    // generation blocks the main thread), creep slowly so the bar still reads as alive. Never creep
    // past 97% before ready() actually lands.
    const cap = Math.min(0.97, target + 0.12);
    const gap = cap - shown;
    if (gap > 0.0002) {
      shown = Math.min(cap, shown + (gap > 0.03 ? gap * 0.12 : 0.0007));
      apply();
    }
    raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);

  function setLabel(text) {
    if (text && status.textContent !== text) status.textContent = text;
  }

  return {
    /** `{ phase: 'context'|'load'|'init', id, done, total, label }` — id names the module in flight. */
    setProgress(p) {
      if (finished || !p) return;
      const phase = p.phase || 'load';
      if (phase !== currentPhase) {
        if (currentPhase) phaseBase += PHASE_WEIGHTS[currentPhase] || 0;
        currentPhase = phase;
      }
      const total = p.total || 0;
      const done = Math.min(1, total ? (p.done || 0) / total : 1);
      target = Math.min(1, phaseBase + (PHASE_WEIGHTS[phase] || 0) * done);
      if (p.id) {
        const entry = MODULE_LABELS[p.id];
        const what = entry ? entry[0] : p.id;
        setLabel(phase === 'init' ? (entry ? entry[1] : `Preparing ${what}…`) : `Loading ${what}…`);
      } else if (p.label) {
        setLabel(p.label);
      }
    },

    /** Set only the status line without moving the bar (e.g. while the first frames compile shaders). */
    status(text) {
      if (!finished) setLabel(text);
    },

    ready() {
      if (finished) return;
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      target = 1; shown = 1; apply();
      setLabel('Ready!');
      el.classList.add('lc-boot--ready');
      setTimeout(() => {
        el.classList.add('lc-boot--done');
        const drop = () => el.remove();
        el.addEventListener('transitionend', drop, { once: true });
        setTimeout(drop, 700); // fallback: transitionend never fires if the tab is hidden
      }, 260);
    },

    fail(error) {
      if (finished) return;
      finished = true;
      if (raf) cancelAnimationFrame(raf);
      el.classList.add('lc-boot--error');
      setLabel('The city failed to load — reload the page to try again.');
      if (err) {
        err.hidden = false;
        err.textContent = String(error?.stack || error?.message || error || 'Unknown error');
      }
    },
  };
}
