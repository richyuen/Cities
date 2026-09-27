// Statistics-modal chart renderer (Wave C3 / F6).
// Adapted from `simulation/panel.js`'s drawChart so `ui` stays inside its own folder (the panel keeps its own copy,
// untouched). Same visual language: dark plate, hairline grid, left people axis, right money axis, a 0–100 % strip and
// a shared x axis. The caller passes the selected series ids; a region collapses when nothing in it is selected.
//
// History entries are the model's own `{ population, jobs, net, happiness, traffic, dr, dc, di }` rows (net is $/tick,
// the renderer multiplies by `perDayTicks` to show $/day, matching the sim panel).

export const STATS_SERIES = [
  { id: 'population', label: 'Population', color: '#5BB55A', axis: 'people', unit: 'int' },
  { id: 'jobs', label: 'Jobs', color: '#2D8BD6', axis: 'people', unit: 'int' },
  { id: 'net', label: 'Net $/day', color: '#F7C948', axis: 'money', unit: 'money' },
  { id: 'happiness', label: 'Happiness', color: '#E4ADC8', axis: 'pct', unit: 'pct' },
  // traffic is red here (not the panel's orange) so it stays distinct from demand's industrial line in the same strip
  { id: 'traffic', label: 'Traffic', color: '#E3342F', axis: 'pct', unit: 'pct' },
  { id: 'demand', label: 'Demand R/C/I', color: '#A5CA18', axis: 'pct', unit: 'demand' },
];
export const DEMAND_LINES = [['dr', '#A5CA18'], ['dc', '#3EC2DD'], ['di', '#F58624']];

const fmtK = (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
const clamp01 = (v) => Math.max(0, Math.min(1, v || 0));

function niceStep(range, ticks) {
  const raw = range / ticks, p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

/** Draw `history` into `canvas`; `selected` is a list of STATS_SERIES ids. Safe to call every sim:tick. */
export function drawStatsChart(canvas, history, {
  selected = STATS_SERIES.map((s) => s.id), perDayTicks = 1200,
  dpr = Math.min(2, typeof devicePixelRatio === 'number' ? devicePixelRatio || 1 : 1),
  width = 344, height = 218,
} = {}) {
  const sel = STATS_SERIES.filter((s) => selected.includes(s.id));
  const tops = sel.filter((s) => s.axis !== 'pct');
  const strips = sel.filter((s) => s.axis === 'pct');
  const hasPeople = tops.some((s) => s.axis === 'people');
  const hasMoney = tops.some((s) => s.axis === 'money');

  const W = width, H = height;
  const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; canvas.style.height = `${H}px`; canvas.style.width = `${W}px`; }
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  c.font = '700 9.5px "Segoe UI", system-ui, sans-serif';

  // layout: value chart on top, 0–100 % strip below, shared x axis at the bottom; either region can collapse
  const L = 34, R = 40, T = 8, xAxisH = 14, gap0 = 14, stripH0 = 46;
  const avail = H - T - xAxisH;
  const gap = tops.length && strips.length ? gap0 : 0;
  const stripH = strips.length ? (tops.length ? stripH0 : avail) : 0;
  const topH = tops.length ? (strips.length ? avail - stripH - gap : avail) : 0;
  const x0 = L, x1 = W - R, topY0 = T, topY1 = T + topH, stripY0 = topY1 + gap, stripY1 = T + avail;
  const n = history.length, max = 300;
  const x = (k) => x0 + ((x1 - x0) * (k + (max - n))) / (max - 1);

  // scales from the visible series only
  let peopleMax = 1, netMin = 0, netMax = 0;
  for (const h of history) {
    peopleMax = Math.max(peopleMax, h.population || 0, h.jobs || 0);
    const nd = (h.net || 0) * perDayTicks;
    netMin = Math.min(netMin, nd); netMax = Math.max(netMax, nd);
  }
  const pStep = niceStep(peopleMax, 3), pTop = Math.ceil(peopleMax / pStep) * pStep;
  const mAbs = Math.max(1000, Math.abs(netMin), Math.abs(netMax));
  const mStep = niceStep(mAbs, 2), mTop = Math.ceil(mAbs / mStep) * mStep;
  const mLo = netMin < 0 ? -mTop : 0, mHi = netMax > 0 ? mTop : 0;
  const yP = (v) => topY1 - ((topY1 - topY0) * v) / (pTop || 1);
  const yM = (v) => topY1 - ((topY1 - topY0) * (v - mLo)) / ((mHi - mLo) || 1);
  const yS = (v) => stripY1 - (stripY1 - stripY0) * clamp01(v);

  // top grid + axes
  c.textBaseline = 'middle'; c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1;
  const gridY = hasPeople ? yP : hasMoney ? yM : null; // fall back to the money scale when people are hidden
  if (gridY) {
    const from = hasPeople ? 0 : mLo, to = hasPeople ? pTop : mHi, step = hasPeople ? pStep : mStep;
    for (let v = from; v <= to + 1e-6; v += step) {
      const y = Math.round(gridY(v)) + 0.5;
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
    }
  }
  if (hasPeople) {
    c.textAlign = 'right'; c.fillStyle = 'rgba(230,236,244,0.7)';
    for (let v = 0; v <= pTop + 1e-6; v += pStep) c.fillText(fmtK(v), x0 - 5, yP(v));
  }
  if (hasMoney) {
    c.textAlign = 'left';
    for (let v = mLo; v <= mHi + 1e-6; v += mStep) {
      c.fillStyle = v < 0 ? '#ff7d76' : '#F7C948';
      c.fillText((v > 0 ? '+' : v < 0 ? '-' : '') + '$' + fmtK(Math.abs(v)), x1 + 5, yM(v));
    }
    if (mLo < 0) { const y = Math.round(yM(0)) + 0.5; c.strokeStyle = 'rgba(247,201,72,0.35)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.setLineDash([]); }
  }
  // strip grid (0 / 50 / 100 %)
  if (strips.length) {
    c.strokeStyle = 'rgba(255,255,255,0.09)'; c.textAlign = 'right'; c.fillStyle = 'rgba(230,236,244,0.7)';
    for (const v of [0, 0.5, 1]) { const y = Math.round(yS(v)) + 0.5; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.fillText(Math.round(v * 100) + '%', x0 - 5, y); }
  }
  // x axis: game minutes before now (300 ticks = 150 game seconds at 2 tps)
  c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = 'rgba(230,236,244,0.7)';
  for (let s = 0; s <= 150; s += 30) {
    if (strips.length && s === 150) continue; // the -2:30 tick would sit directly under the strip's 0 % label
    const k = max - 1 - s * 2, px = x0 + ((x1 - x0) * k) / (max - 1);
    c.fillText(s === 0 ? 'now' : `-${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, px, stripY1 + 3);
    c.strokeStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.moveTo(Math.round(px) + 0.5, stripY1); c.lineTo(Math.round(px) + 0.5, stripY1 + 3); c.stroke();
  }
  if (n < 2) return;

  const line = (color, fn) => {
    c.strokeStyle = color; c.lineWidth = 1.6; c.lineJoin = 'round'; c.beginPath();
    for (let k = 0; k < n; k++) { const px = x(k), py = fn(history[k]); if (k === 0) c.moveTo(px, py); else c.lineTo(px, py); }
    c.stroke();
  };
  for (const s of tops) {
    if (s.axis === 'people') line(s.color, (h) => yP(h[s.id] || 0));
    else line('#F7C948', (h) => yM((h.net || 0) * perDayTicks));
  }
  for (const s of strips) {
    if (s.id === 'demand') for (const [key, color] of DEMAND_LINES) line(color, (h) => yS(h[key]));
    else line(s.color, (h) => yS(h[s.id]));
  }
}
