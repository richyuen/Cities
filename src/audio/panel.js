// Showcase-only DOM panel (bottom-left, dark glass, monospace) that visualises the audio graph state:
// per-layer gain meters (actual GainNode values vs. target), the analyser spectrum and the SFX log.
import { LAYER_DEFS } from './engine.js';

const CSS = `
.ap-root { position: absolute; left: 16px; bottom: 16px; width: 392px; padding: 12px 14px 12px; box-sizing: border-box;
  color: #e6edf3; font: 12.75px/1.45 ui-monospace, Consolas, "Cascadia Mono", Menlo, monospace; letter-spacing: 0.01em;
  background: linear-gradient(180deg, rgba(12,17,24,0.90), rgba(7,10,15,0.95)); border: 1px solid rgba(255,255,255,0.14);
  border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.08);
  backdrop-filter: blur(14px) saturate(100%); -webkit-backdrop-filter: blur(14px) saturate(100%); user-select: none; }
.ap-h { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
.ap-title { font-weight: 700; letter-spacing: 0.18em; color: #fff; font-size: 13px; }
.ap-title b { color: #F5CD2F; }
.ap-state { color: #b3c2d0; }
.ap-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #C4281C; margin-right: 6px; vertical-align: middle;
  box-shadow: 0 0 8px rgba(196,40,28,0.8); }
.ap-dot.on { background: #4B9F4A; box-shadow: 0 0 8px rgba(75,159,74,0.9); }
.ap-line { color: #c3d0dc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ap-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 12px; row-gap: 1px; margin: 2px 0 4px; }
.ap-grid .p { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; justify-content: space-between; gap: 8px; }
.ap-line .k, .ap-grid .k { color: #9fb3c6; }
.ap-line .v, .ap-grid .v { color: #f1f5f8; }
.ap-canvas { display: block; width: 364px; height: 224px; margin: 8px 0 6px; }
.ap-hint { color: #F5CD2F; }
.ap-sfx { margin-top: 2px; }
.ap-sfx .n { color: #F58624; }
.ap-foot { color: #9fb3c6; margin-top: 3px; }
`;

export class AudioPanel {
  constructor(dom, engine) {
    this.engine = engine;
    this.root = document.createElement('div');
    this.root.className = 'ap-root';
    this.root.innerHTML = `<style>${CSS}</style>
      <div class="ap-h"><span class="ap-title">AUDIO <b>·</b> GRAPH</span><span class="ap-state"><i class="ap-dot"></i><span class="ap-st">idle</span></span></div>
      <div class="ap-grid ap-env"></div>
      <canvas class="ap-canvas" width="364" height="224"></canvas>
      <div class="ap-line ap-sfx"></div>
      <div class="ap-line ap-foot"></div>`;
    dom.appendChild(this.root);
    this.canvas = this.root.querySelector('canvas');
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = 364 * this.dpr; this.canvas.height = 224 * this.dpr;
    this.g = this.canvas.getContext('2d');
    this.$ = (s) => this.root.querySelector(s);
    this.els = { st: this.$('.ap-st'), dot: this.$('.ap-dot'), env: this.$('.ap-env'), sfx: this.$('.ap-sfx'), foot: this.$('.ap-foot') };
    this._smooth = new Float32Array(64);
    this._lastText = 0;
    this._drawKey = '';
  }

  dispose() { this.root.remove(); }

  /** @param info { hours, daylight, weather, traffic, population, camH, detail, gust, sfxLog, sfxCounts, volumes, muted, listenerPos } */
  update(info, now) {
    const e = this.engine;
    const running = e.running;
    if (now - this._lastText > 120) {
      this._lastText = now;
      const st = e.failed ? 'unavailable' : !e.ac ? 'idle · awaiting gesture' : e.ac.state + (e.muted ? ' · muted' : '');
      this.els.st.textContent = st + (e.ac ? ` · ${(e.sampleRate / 1000).toFixed(1)} kHz` : '');
      this.els.dot.classList.toggle('on', running && !e.muted);
      const w = info.weather;
      const hh = Math.floor(info.hours), mm = Math.floor((info.hours - hh) * 60);
      const pair = (k, v) => `<span class="p"><span class="k">${k}</span><span class="v">${v}</span></span>`;
      this.els.env.innerHTML = pair('tod', `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
        + pair('daylight', info.daylight.toFixed(2))
        + pair('weather', `${w.kind}${w.kind !== 'clear' ? ' ' + w.intensity.toFixed(1) : ''}`)
        + pair('wind', `${Math.hypot(w.wind[0], w.wind[1]).toFixed(1)} · gust ${info.gust.toFixed(2)}`)
        + pair('traffic', info.traffic.toFixed(2))
        + pair('population', fmtK(info.population))
        + pair('camera h', `${info.camH.toFixed(0)} m`)
        + pair('detail', info.detail.toFixed(2))
        + pair('listener', info.listenerPos.map((v) => v.toFixed(0)).join(','))
        + pair('bird bursts', info.birdDensity.toFixed(2));
      const log = info.sfxLog.slice(-4).map((s) => `<span class="n">${s.name}</span>${s.pos ? '@' : ''}`).join(' ');
      const counts = Object.entries(info.sfxCounts).map(([k, v]) => `${k}×${v}`).join(' ');
      this.els.sfx.innerHTML = `<span class="k">sfx</span> ${log || '<span class="k">—</span>'}` + (counts ? `  <span class="k">${counts}</span>` : '');
      const vol = info.volumes;
      this.els.foot.textContent = `master ${vol.master.toFixed(2)} · amb ${vol.ambience.toFixed(2)} · sfx ${vol.sfx.toFixed(2)} · ${e.ac ? 'graph live' : 'no context'} · 10 Hz`;
    }
    // Idle (no context): the meters only show targets, which change at 10 Hz — skip the redraw when nothing moved.
    if (!running) {
      const key = e.layers.map((l) => l.target.toFixed(3)).join(',') + (e.failed ? 'f' : e.ac ? e.ac.state : 'i');
      if (key === this._drawKey) return;
      this._drawKey = key;
    } else this._drawKey = '';
    this._draw(running);
  }

  _draw(running) {
    const g = this.g, e = this.engine, dpr = this.dpr;
    const W = 364, H = 224;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.font = '12px ui-monospace, Consolas, Menlo, monospace';
    g.textBaseline = 'middle';
    // ---- layer meters
    const rowH = 17, x0 = 66, barW = 236, top = 4;
    for (let i = 0; i < e.layers.length; i++) {
      const l = e.layers[i];
      const y = top + i * rowH;
      const actual = e.layerLevel(l), target = l.target;
      g.fillStyle = target > 0.01 ? '#f1f5f8' : '#9fb3c6';
      g.textAlign = 'left';
      g.fillText(l.label, 0, y + 7);
      // track
      g.fillStyle = 'rgba(255,255,255,0.07)';
      roundRect(g, x0, y + 2, barW, 10, 3); g.fill();
      // target ghost
      g.fillStyle = hexA(l.color, running ? 0.28 : 0.45);
      roundRect(g, x0, y + 2, Math.max(0, barW * target), 10, 3); g.fill();
      // actual
      if (actual > 0.002) {
        g.fillStyle = l.color;
        roundRect(g, x0, y + 2, Math.max(2, barW * actual), 10, 3); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x0 + barW * actual - 1, y + 2, 1.5, 10);
      }
      // ticks
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let k = 1; k < 4; k++) g.fillRect(x0 + (barW * k) / 4, y + 1, 1, 12);
      g.textAlign = 'right';
      g.fillStyle = actual > 0.002 ? '#f1f5f8' : '#aebccb';
      g.fillText((running ? actual : target).toFixed(2), W, y + 7);
    }
    // ---- output level + spectrum
    const sy = top + e.layers.length * rowH + 8;
    const sh = H - sy - 14;
    g.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(g, 0, sy, W, sh, 5); g.fill();
    const spec = e.spectrum();
    const n = 64;
    const gap = 1.5, bw = (W - 8 - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (spec) {
        // log-ish bin mapping so lows aren't squashed
        const b0 = Math.floor(Math.pow(i / n, 1.7) * spec.length * 0.5);
        const b1 = Math.max(b0 + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * spec.length * 0.5));
        let m = 0; for (let b = b0; b < b1; b++) m = Math.max(m, spec[b]);
        v = m / 255;
      }
      this._smooth[i] += (v - this._smooth[i]) * 0.5;
      const h = Math.max(1.5, this._smooth[i] * (sh - 8));
      const x = 4 + i * (bw + gap);
      const t = i / n;
      g.fillStyle = spec ? `hsl(${200 - 160 * t} 85% ${55 + 15 * this._smooth[i]}%)` : 'rgba(255,255,255,0.14)';
      g.fillRect(x, sy + sh - 4 - h, bw, h);
    }
    // output level strip
    const lvl = e.outputLevel;
    g.fillStyle = 'rgba(255,255,255,0.08)';
    g.fillRect(0, H - 8, W, 4);
    g.fillStyle = lvl > 0.85 ? '#C4281C' : lvl > 0.6 ? '#F5CD2F' : '#4B9F4A';
    g.fillRect(0, H - 8, W * lvl, 4);
    g.textAlign = 'left'; g.fillStyle = '#9fb3c6';
    const sr = e.sampleRate || 48000, bins = e.analyser ? e.analyser.frequencyBinCount : 1024;
    const binHz = sr / 2 / bins;
    g.fillText(`spectrum · 64 log bands · ${binHz.toFixed(0)} Hz bins · to ${(sr / 4000).toFixed(0)} kHz`, 6, sy + 9);
    g.textAlign = 'right';
    g.fillText('out', W - 2, H - 6 - 8);
    if (!spec) {
      g.textAlign = 'center';
      g.font = 'bold 13px ui-monospace, Consolas, Menlo, monospace';
      g.fillStyle = '#F5CD2F';
      g.fillText(e.failed ? 'Web Audio unavailable' : 'click or press a key to start audio', W / 2, sy + sh / 2 + 2);
    }
  }
}

function roundRect(g, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, Math.max(0, w / 2));
  g.beginPath();
  g.moveTo(x + rr, y); g.lineTo(x + w - rr, y); g.arcTo(x + w, y, x + w, y + rr, rr); g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr); g.lineTo(x + rr, y + h); g.arcTo(x, y + h, x, y + h - rr, rr); g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr); g.closePath();
}

function hexA(hex, a) {
  const r = parseInt(hex.slice(1, 3), 16), gg = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${gg},${b},${a})`;
}

function fmtK(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n | 0); }
