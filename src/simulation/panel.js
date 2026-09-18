// Showcase-only DOM panel styled like the UI module's plastic plates: dark-stone-grey glossy plate, real stud row on
// the top edge, bevel highlight, brick-coloured accents. Anchored bottom-left (nothing of the skyline sits there).
// Two charts with real axes: people (pop / jobs, left) + net $/day (right), and a 0–100 % strip (happiness, traffic).

const STUD_TILE = encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='16' height='12' viewBox='0 0 16 12'>
<defs><linearGradient id='t' x1='0' y1='0' x2='0' y2='1'><stop offset='0' stop-color='#6e7683'/><stop offset='1' stop-color='#555c68'/></linearGradient>
<linearGradient id='s' x1='0' y1='0' x2='1' y2='0'><stop offset='0' stop-color='#2c313a'/><stop offset='.5' stop-color='#3a404a'/><stop offset='1' stop-color='#262b33'/></linearGradient></defs>
<path d='M3 4.6v4.2a5 2.2 0 0 0 10 0V4.6z' fill='url(#s)'/>
<path d='M3 4.6v4.2a5 2.2 0 0 0 10 0V4.6' fill='none' stroke='rgba(0,0,0,.3)' stroke-width='.6'/>
<ellipse cx='8' cy='4.6' rx='5' ry='2.2' fill='url(#t)' stroke='rgba(0,0,0,.3)' stroke-width='.6'/>
<path d='M4.3 3.9a4.2 1.6 0 0 1 7.4 0' fill='none' stroke='rgba(255,255,255,.75)' stroke-width='.9' stroke-linecap='round'/>
<ellipse cx='6.6' cy='4.4' rx='1.6' ry='.55' fill='rgba(255,255,255,.22)'/>
</svg>`);

const CSS = `
.sim-panel { --r: 12px; --hi: rgba(84,91,103,0.94); --lo: rgba(36,41,49,0.95); --border: rgba(255,255,255,0.24); --ring: rgba(0,0,0,0.55);
  --text: #f5f7fa; --muted: rgba(230,236,244,0.68); --display: "Arial Rounded MT Bold","Segoe UI Black","Arial Black","Segoe UI",system-ui,sans-serif;
  position:absolute; left:16px; bottom:16px; width:352px; box-sizing:border-box; padding:16px 14px 12px; isolation:isolate; z-index:1;
  font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif; font-size:12.5px; line-height:1.3; color:var(--text);
  background:linear-gradient(180deg,var(--hi) 0%,rgba(58,64,74,0.94) 42%,var(--lo) 100%);
  -webkit-backdrop-filter:blur(14px) saturate(140%); backdrop-filter:blur(14px) saturate(140%);
  border:1px solid var(--border); border-radius:var(--r);
  box-shadow:0 0 0 1px var(--ring),0 3px 0 rgba(0,0,0,0.42),0 4px 0 1px var(--ring),0 12px 28px rgba(0,0,0,0.42),0 2px 4px rgba(0,0,0,0.3),inset 0 2px 0 rgba(255,255,255,0.2),inset 0 -2px 0 rgba(0,0,0,0.38);
  -webkit-font-smoothing:antialiased; user-select:none; }
.sim-panel * { box-sizing:border-box; }
.sim-panel::before { content:""; position:absolute; inset:1px; border-radius:calc(var(--r) - 2px); pointer-events:none; z-index:-1;
  background:linear-gradient(180deg,rgba(255,255,255,0.13) 0%,rgba(255,255,255,0.05) 34%,rgba(255,255,255,0) 52%); }
.sim-studs { position:absolute; left:calc(var(--r) + 4px); right:calc(var(--r) + 4px); top:-8px; height:12px; pointer-events:none; z-index:1;
  background:url("data:image/svg+xml,${STUD_TILE}") left top / 16px 12px space no-repeat; filter:drop-shadow(0 1px 0.5px rgba(0,0,0,0.3)); }
.sim-head { display:flex; align-items:baseline; gap:8px; margin-bottom:2px; }
.sim-name { font-family:var(--display); font-weight:900; font-size:17px; letter-spacing:0.3px; text-shadow:0 1px 0 rgba(0,0,0,0.6),0 2px 3px rgba(0,0,0,0.35); }
.sim-level { font-size:10.5px; font-weight:800; letter-spacing:0.6px; text-transform:uppercase; padding:2px 7px; border-radius:6px; color:#3a2800;
  background:linear-gradient(180deg,#ffe37a 0%,#f9cf4f 46%,#e9b224 54%,#f0bd33 100%); border:1px solid rgba(70,45,0,0.75);
  box-shadow:inset 0 1px 0 rgba(255,255,255,0.55),inset 0 -2px 0 rgba(120,75,0,0.35),0 1px 0 rgba(0,0,0,0.45); }
.sim-sub { color:var(--muted); font-size:11px; margin-bottom:8px; }
.sim-grid { display:grid; grid-template-columns:1fr 1fr; gap:3px 14px; margin-bottom:8px; }
.sim-kv { display:flex; justify-content:space-between; align-items:center; gap:6px; padding:2px 0; border-bottom:1px solid rgba(255,255,255,0.07); }
.sim-kv span:first-child { color:var(--muted); }
.sim-kv b { font-family:var(--display); font-weight:900; font-variant-numeric:tabular-nums; font-size:12.5px; text-shadow:0 1px 0 rgba(0,0,0,0.6); }
.sim-kv b.neg { color:#ff7d76; }
.sim-kv b.pos { color:#8be07f; }
.sim-sect { font-size:10.5px; font-weight:800; letter-spacing:0.8px; text-transform:uppercase; color:var(--muted); margin:6px 0 4px; }
.sim-rci { display:grid; grid-template-columns:14px 1fr 38px; gap:4px 8px; align-items:center; margin-bottom:6px; }
.sim-rci span { font-family:var(--display); font-weight:900; }
.sim-rci i { display:block; height:9px; border-radius:5px; background:rgba(0,0,0,0.38); box-shadow:inset 0 1px 2px rgba(0,0,0,0.5); overflow:hidden; }
.sim-rci i > b { display:block; height:100%; width:0; border-radius:5px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.45),inset 0 -2px 0 rgba(0,0,0,0.25); transition:width .2s; }
.sim-rci em { font-style:normal; text-align:right; font-variant-numeric:tabular-nums; font-weight:700; }
.sim-chart { display:block; width:322px; border-radius:8px; background:rgba(0,0,0,0.32); box-shadow:inset 0 1px 3px rgba(0,0,0,0.55),inset 0 -1px 0 rgba(255,255,255,0.06); }
.sim-legend { display:flex; flex-wrap:wrap; gap:4px 12px; margin-top:5px; font-size:11px; font-weight:700; color:var(--muted); }
.sim-legend i { display:inline-block; width:9px; height:9px; border-radius:2px; margin-right:5px; vertical-align:-1px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.4),0 1px 0 rgba(0,0,0,0.4); }
.sim-distress { margin:-2px 0 8px; padding:5px 8px; border-radius:6px; text-align:center; font-weight:900; font-size:11px; letter-spacing:0.4px;
  color:#3a0a06; background:linear-gradient(180deg,#ffe37a 0%,#f9cf4f 46%,#e9b224 54%,#f0bd33 100%);
  border:1px solid rgba(70,10,0,0.6); box-shadow:inset 0 1px 0 rgba(255,255,255,0.55),inset 0 -2px 0 rgba(120,20,0,0.35),0 1px 0 rgba(0,0,0,0.45); }
`;

const SERIES = [
  { key: 'population', label: 'Population', color: '#5BB55A', axis: 'people' },
  { key: 'jobs', label: 'Jobs', color: '#2D8BD6', axis: 'people' },
  { key: 'net', label: 'Net $/day', color: '#F7C948', axis: 'money' },
];
const PCT_SERIES = [
  { key: 'happiness', label: 'Happiness', color: '#E4ADC8' },
  { key: 'traffic', label: 'Traffic', color: '#F58624' },
];

const fmtInt = (n) => Math.round(n).toLocaleString('en-US');
const fmtMoney = (n) => (n < 0 ? '-' : '') + '$' + fmtInt(Math.abs(n));
const fmtK = (n) => (Math.abs(n) >= 1000 ? (n / 1000).toFixed(Math.abs(n) >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(Math.round(n)));
const pct = (v) => Math.round(v * 100) + '%';

function niceStep(range, ticks) {
  const raw = range / ticks, p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

export function createPanel(dom, { perDayTicks = 1200 } = {}) {
  const style = document.createElement('style'); style.textContent = CSS;
  const root = document.createElement('div');
  root.id = 'sim-panel'; root.className = 'sim-panel';
  root.innerHTML = `
    <div class="sim-studs"></div>
    <div class="sim-distress" data-k="distress" hidden>CITY BANKRUPT &middot; TREASURY IN STATE RECEIVERSHIP</div>
    <div class="sim-head"><span class="sim-name" data-k="name"></span><span class="sim-level" data-k="level"></span></div>
    <div class="sim-sub" data-k="sub"></div>
    <div class="sim-grid" data-k="grid"></div>
    <div class="sim-sect">RCI demand</div>
    <div class="sim-rci" data-k="rci"></div>
    <canvas class="sim-chart" data-k="chart"></canvas>
    <div class="sim-legend" data-k="legend"></div>`;
  const q = (k) => root.querySelector(`[data-k="${k}"]`);
  const nameEl = q('name'), levelEl = q('level'), sub = q('sub'), grid = q('grid'), rci = q('rci'), canvas = q('chart'), legend = q('legend'), distressEl = q('distress');
  const ctx2d = canvas.getContext('2d');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const CW = 322, CH = 168;
  canvas.width = CW * DPR; canvas.height = CH * DPR; canvas.style.height = CH + 'px';

  const rows = [
    ['Population', (s) => fmtInt(s.population)],
    ['Jobs', (s) => fmtInt(s.jobs)],
    ['Employment', (s) => pct(s.employment)],
    ['Happiness', (s) => pct(s.happiness)],
    ['Traffic', (s) => pct(s.traffic)],
    ['Park access', (s) => pct(s.parkShare)],
    ['Treasury', (s) => fmtMoney(s.money), (s) => (s.money < 0 ? 'neg' : '')],
    ['Net / day', (s, b) => (b.net >= 0 ? '+' : '') + fmtMoney(b.net), (s, b) => (b.net < 0 ? 'neg' : 'pos')],
    ['Income / day', (s, b) => fmtMoney(b.income.total)],
    ['Upkeep / day', (s, b) => fmtMoney(b.expenses.total)],
    ['Tax r / c / i', (s, b, t) => `${pct(t.r)}·${pct(t.c)}·${pct(t.i)}`],
    ['Services', (s) => pct(s.services ?? 1), (s) => ((s.services ?? 1) < 0.9 ? 'neg' : '')],
  ];
  grid.innerHTML = rows.map(([k]) => `<div class="sim-kv"><span>${k}</span><b></b></div>`).join('');
  const cells = [...grid.querySelectorAll('b')];

  const RCI = [['R', '#A5CA18'], ['C', '#3EC2DD'], ['I', '#F58624']];
  rci.innerHTML = RCI.map(([k, c]) => `<span style="color:${c}">${k}</span><i><b data-bar="${k}" style="background:${c}"></b></i><em data-val="${k}"></em>`).join('');
  const bars = RCI.map(([k]) => rci.querySelector(`[data-bar="${k}"]`)), vals = RCI.map(([k]) => rci.querySelector(`[data-val="${k}"]`));
  legend.innerHTML = [...SERIES, ...PCT_SERIES].map((s) => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  dom.appendChild(style); dom.appendChild(root);

  function drawChart(history) {
    const c = ctx2d, W = CW, H = CH;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, W, H);
    c.font = '700 9.5px "Segoe UI", system-ui, sans-serif';
    // layout: top chart (people + money) and a bottom % strip, shared x axis at the bottom
    const L = 34, R = 40, T = 8, gap = 14;
    const xAxisH = 14, stripH = 34;
    const topY0 = T, topY1 = H - xAxisH - stripH - gap, stripY0 = topY1 + gap, stripY1 = H - xAxisH;
    const x0 = L, x1 = W - R;
    const n = history.length, max = 300;
    const x = (k) => x0 + ((x1 - x0) * (k + (max - n))) / (max - 1);
    // people axis
    let peopleMax = 1, netMin = 0, netMax = 0;
    for (const h of history) { peopleMax = Math.max(peopleMax, h.population, h.jobs); const nd = (h.net || 0) * perDayTicks; netMin = Math.min(netMin, nd); netMax = Math.max(netMax, nd); }
    const pStep = niceStep(peopleMax, 3), pTop = Math.ceil(peopleMax / pStep) * pStep;
    const mAbs = Math.max(1000, Math.abs(netMin), Math.abs(netMax));
    const mStep = niceStep(mAbs, 2), mTop = Math.ceil(mAbs / mStep) * mStep;
    const mLo = netMin < 0 ? -mTop : 0, mHi = netMax > 0 ? mTop : 0;
    const yP = (v) => topY1 - ((topY1 - topY0) * v) / pTop;
    const yM = (v) => topY1 - ((topY1 - topY0) * (v - mLo)) / (mHi - mLo || 1);
    // grid + left ticks
    c.textBaseline = 'middle'; c.strokeStyle = 'rgba(255,255,255,0.09)'; c.lineWidth = 1;
    for (let v = 0; v <= pTop + 1e-6; v += pStep) {
      const y = Math.round(yP(v)) + 0.5;
      c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
      c.fillStyle = 'rgba(230,236,244,0.7)'; c.textAlign = 'right'; c.fillText(fmtK(v), x0 - 5, y);
    }
    // right ticks (money)
    c.textAlign = 'left';
    for (let v = mLo; v <= mHi + 1e-6; v += mStep) {
      const y = Math.round(yM(v)) + 0.5;
      c.fillStyle = v < 0 ? '#ff7d76' : '#F7C948'; c.fillText((v > 0 ? '+' : v < 0 ? '-' : '') + '$' + fmtK(Math.abs(v)), x1 + 5, y);
    }
    if (mLo < 0) { const y = Math.round(yM(0)) + 0.5; c.strokeStyle = 'rgba(247,201,72,0.35)'; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.setLineDash([]); }
    // strip grid (0 / 50 / 100 %)
    const yS = (v) => stripY1 - (stripY1 - stripY0) * v;
    c.strokeStyle = 'rgba(255,255,255,0.09)';
    for (const v of [0, 0.5, 1]) { const y = Math.round(yS(v)) + 0.5; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.fillStyle = 'rgba(230,236,244,0.7)'; c.textAlign = 'right'; c.fillText(Math.round(v * 100) + '%', x0 - 5, y); }
    // x axis: game minutes before now (300 ticks = 150 game seconds)
    c.textAlign = 'center'; c.textBaseline = 'top'; c.fillStyle = 'rgba(230,236,244,0.7)';
    for (let s = 0; s <= 150; s += 30) {
      const k = max - 1 - s * 2, px = x0 + ((x1 - x0) * k) / (max - 1);
      c.fillText(s === 0 ? 'now' : `-${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, px, stripY1 + 3);
      c.strokeStyle = 'rgba(255,255,255,0.14)'; c.beginPath(); c.moveTo(Math.round(px) + 0.5, stripY1); c.lineTo(Math.round(px) + 0.5, stripY1 + 3); c.stroke();
    }
    c.textAlign = 'left'; c.fillStyle = 'rgba(230,236,244,0.45)'; c.fillText('game time', x0, stripY1 + 3);
    if (n < 2) return;
    const line = (color, fn) => {
      c.strokeStyle = color; c.lineWidth = 1.6; c.lineJoin = 'round'; c.beginPath();
      for (let k = 0; k < n; k++) { const px = x(k), py = fn(history[k]); if (k === 0) c.moveTo(px, py); else c.lineTo(px, py); }
      c.stroke();
    };
    for (const s of SERIES) line(s.color, s.axis === 'people' ? (h) => yP(h[s.key]) : (h) => yM((h.net || 0) * perDayTicks));
    for (const s of PCT_SERIES) line(s.color, (h) => yS(Math.max(0, Math.min(1, h[s.key]))));
  }

  return {
    root,
    update(stats, history, budgetPerDay, taxRate) {
      distressEl.hidden = !stats.bankrupt;
      nameEl.textContent = stats.cityName;
      levelEl.textContent = stats.cityLevelName;
      sub.textContent = `Day ${stats.day} · tick ${stats.tick} · ${stats.buildings} buildings · ${stats.roads} streets`;
      for (let k = 0; k < rows.length; k++) {
        const [, fn, cls] = rows[k];
        cells[k].textContent = fn(stats, budgetPerDay, taxRate);
        cells[k].className = cls ? cls(stats, budgetPerDay, taxRate) : '';
      }
      const d = [stats.demand.r, stats.demand.c, stats.demand.i];
      for (let k = 0; k < 3; k++) { bars[k].style.width = `${Math.round(d[k] * 100)}%`; vals[k].textContent = pct(d[k]); }
      drawChart(history);
    },
    dispose() { root.remove(); style.remove(); },
  };
}
