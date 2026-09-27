// Transit lines panel: a compact Blox-styled card listing every bus line (colour, stops, buses, length,
// ridership) with delete/focus actions, plus the network totals. DOM only — no draw calls.

const CSS = `
.tr-panel { position:absolute; right:16px; bottom:246px; width:296px; max-height:340px; display:none; flex-direction:column;
  z-index:3; box-sizing:border-box; padding:14px 12px 12px; isolation:isolate; color:#f5f7fa; user-select:none;
  font-family:"Segoe UI",system-ui,-apple-system,"Helvetica Neue",Arial,sans-serif; font-size:12.5px; line-height:1.35;
  background:linear-gradient(180deg,rgba(84,91,103,0.95) 0%,rgba(58,64,74,0.95) 42%,rgba(36,41,49,0.96) 100%);
  -webkit-backdrop-filter:blur(14px) saturate(140%); backdrop-filter:blur(14px) saturate(140%);
  border:1px solid rgba(255,255,255,0.24); border-radius:12px;
  box-shadow:0 0 0 1px rgba(0,0,0,0.55),0 3px 0 rgba(0,0,0,0.42),0 4px 0 1px rgba(0,0,0,0.55),0 12px 28px rgba(0,0,0,0.42),
    inset 0 2px 0 rgba(255,255,255,0.2),inset 0 -2px 0 rgba(0,0,0,0.38); }
.tr-panel.open { display:flex; }
.tr-panel::before { content:""; position:absolute; inset:1px; border-radius:10px; pointer-events:none; z-index:-1;
  background:linear-gradient(180deg,rgba(255,255,255,0.13) 0%,rgba(255,255,255,0.05) 34%,rgba(255,255,255,0) 52%); }
.tr-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
.tr-title { font-weight:900; font-size:15px; letter-spacing:0.4px; text-shadow:0 1px 0 rgba(0,0,0,0.6); }
.tr-close { width:24px; height:24px; border-radius:7px; border:1px solid rgba(0,0,0,0.45); color:#e8edf4; cursor:pointer;
  background:linear-gradient(180deg,#6a7280,#3c434e); box-shadow:inset 0 1px 0 rgba(255,255,255,0.25); }
.tr-close:hover { filter:brightness(1.12); }
.tr-sum { display:flex; gap:10px; margin:2px 0 8px; color:rgba(230,236,244,0.75); font-size:11px; flex-wrap:wrap; }
.tr-sum b { color:#fff; font-variant-numeric:tabular-nums; }
.tr-empty { color:rgba(230,236,244,0.7); font-size:11.5px; padding:4px 2px 2px; }
.tr-list { display:flex; flex-direction:column; gap:5px; overflow-y:auto; padding-right:2px; }
.tr-row { display:grid; grid-template-columns:12px 1fr auto auto; align-items:center; gap:7px; padding:6px 7px;
  border-radius:8px; background:rgba(0,0,0,0.24); border:1px solid rgba(255,255,255,0.08); }
.tr-chip { width:12px; height:12px; border-radius:3px; box-shadow:inset 0 1px 0 rgba(255,255,255,0.5),0 1px 0 rgba(0,0,0,0.5); }
.tr-name { font-weight:800; font-size:12px; }
.tr-meta { color:rgba(230,236,244,0.68); font-size:10.5px; }
.tr-btn { border:1px solid rgba(0,0,0,0.45); border-radius:6px; padding:3px 7px; font-size:10.5px; font-weight:800; cursor:pointer;
  color:#eef2f7; background:linear-gradient(180deg,#6a7280,#3c434e); box-shadow:inset 0 1px 0 rgba(255,255,255,0.22); }
.tr-btn:hover { filter:brightness(1.14); }
.tr-btn.del { background:linear-gradient(180deg,#c4584c,#8c2f24); }
.tr-hint { margin-top:8px; padding-top:7px; border-top:1px solid rgba(255,255,255,0.1); color:rgba(230,236,244,0.6); font-size:10.5px; }
`;

export function createPanel(dom, { onDelete, onFocus } = {}) {
  const style = document.createElement('style');
  style.textContent = CSS;
  const root = document.createElement('div');
  root.className = 'tr-panel';
  root.innerHTML = `
    <div class="tr-head"><div class="tr-title">Bus Lines</div><button class="tr-close" title="Close">\u2715</button></div>
    <div class="tr-sum" data-k="sum"></div>
    <div class="tr-list" data-k="list"></div>
    <div class="tr-hint">Place a <b>Bus Stop</b> on a road, then pick <b>Bus Line</b> and click stops in visiting order \u2014 press Enter or click the first stop to close the loop.</div>`;
  const sum = root.querySelector('[data-k="sum"]');
  const list = root.querySelector('[data-k="list"]');
  root.querySelector('.tr-close').addEventListener('click', () => root.classList.remove('open'));
  dom.appendChild(style);
  dom.appendChild(root);

  return {
    root,
    update({ lines = [], coverage = 0, ridership = 0, buses = 0, upkeepDay = 0, fareDay = 0 } = {}) {
      sum.innerHTML = `<span>Coverage <b>${Math.round(coverage * 100)}%</b></span><span>Riders/day <b>${ridership.toLocaleString('en-US')}</b></span>`
        + `<span>Buses <b>${buses}</b></span><span>Upkeep <b>$${Math.round(upkeepDay).toLocaleString('en-US')}/day</b></span>`
        + `<span>Fares <b>$${Math.round(fareDay).toLocaleString('en-US')}/day</b></span>`;
      if (!lines.length) {
        list.innerHTML = '<div class="tr-empty">No bus lines yet.</div>';
        return;
      }
      list.innerHTML = '';
      for (const l of lines) {
        const row = document.createElement('div');
        row.className = 'tr-row';
        row.innerHTML = `<i class="tr-chip" style="background:${l.color}"></i>`
          + `<div><div class="tr-name">${l.name}</div><div class="tr-meta">${l.stops} stops \u00b7 ${l.buses} bus${l.buses === 1 ? '' : 'es'} \u00b7 ${Math.round(l.lengthM)} m</div></div>`;
        const focus = document.createElement('button');
        focus.className = 'tr-btn';
        focus.textContent = 'View';
        focus.addEventListener('click', () => onFocus?.(l.id));
        const del = document.createElement('button');
        del.className = 'tr-btn del';
        del.textContent = 'Delete';
        del.addEventListener('click', () => onDelete?.(l.id));
        row.append(focus, del);
        list.append(row);
      }
    },
    dispose() { root.remove(); style.remove(); },
  };
}
