// Procedural Web Audio engine: ambience layers + synthesized SFX. No audio files.
// The AudioContext is created lazily by start() (only after a user gesture); before that every method is a
// silent no-op. All randomness comes from the seeded rng handed in by the module.

export const LAYER_DEFS = [
  { id: 'wind', label: 'wind', color: '#3EC2DD' },
  { id: 'birds', label: 'birds', color: '#F5CD2F' },
  { id: 'crickets', label: 'crickets', color: '#A5CA18' },
  { id: 'traffic', label: 'traffic', color: '#F58624' },
  { id: 'rain', label: 'rain', color: '#1E8EC0' },
  { id: 'rumble', label: 'rumble', color: '#B39DDB' },
];

export const SFX_NAMES = ['click', 'place', 'road', 'bulldoze', 'zone', 'error', 'levelup', 'cash'];

const TC = 0.12; // setTargetAtTime time constant (s) — smooths the 10 Hz updates

export class AudioEngine {
  constructor(rng, log = () => {}) {
    this.rng = rng;
    this.log = log;
    this.ac = null;
    this.master = null; this.ambBus = null; this.sfxBus = null; this.analyser = null; this.comp = null;
    this.volumes = { master: 0.8, ambience: 1.0, sfx: 1.0 };
    this.muted = false;
    this.layers = LAYER_DEFS.map((d) => ({ ...d, target: 0, gain: null, nodes: [] }));
    this.byId = Object.fromEntries(this.layers.map((l) => [l.id, l]));
    this.failed = false;
    this._noise = null;
    this._rainDrop = null; // { gain } for drop transients
    this._dropEnd = 0; // ac time when the last scheduled rain drop ends
    this._birdBusy = 0; // ac time until which a bird burst is in progress
    this._sfxCount = 0;
    this._level = 0; // smoothed RMS of the output (0..1)
    this._timeData = null;
    this._freqData = null;
  }

  get running() { return !!this.ac && this.ac.state === 'running'; }
  get state() { return this.failed ? 'failed' : this.ac ? this.ac.state : 'idle'; }
  get sampleRate() { return this.ac ? this.ac.sampleRate : 0; }

  /** Create (or resume) the context. Must be called from a user gesture. Returns true when running. */
  async start() {
    if (this.failed) return false;
    try {
      if (!this.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.failed = true; return false; }
        this.ac = new AC({ latencyHint: 'interactive' });
        this._buildGraph();
      }
      if (this.ac.state !== 'running') await this.ac.resume();
      return this.ac.state === 'running';
    } catch (e) {
      this.failed = true;
      this.log('[audio] start failed:', e?.message || e);
      return false;
    }
  }

  async close() {
    const ac = this.ac;
    this.ac = null;
    this.analyser = null;
    for (const l of this.layers) { l.gain = null; l.nodes = []; }
    if (ac) { try { await ac.close(); } catch (_) { /* ignore */ } }
  }

  // ---- graph ------------------------------------------------------------------
  _buildGraph() {
    const ac = this.ac;
    this.master = ac.createGain();
    this.comp = ac.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005; this.comp.release.value = 0.2;
    this.analyser = ac.createAnalyser();
    this.analyser.fftSize = 2048; // 23 Hz bins @ 48 kHz — the panel's spectrum label is honest at this size
    this.analyser.smoothingTimeConstant = 0.8;
    this.ambBus = ac.createGain();
    this.sfxBus = ac.createGain();
    this.ambBus.connect(this.master); this.sfxBus.connect(this.master);
    this.master.connect(this.comp); this.comp.connect(this.analyser); this.analyser.connect(ac.destination);
    this._timeData = new Float32Array(this.analyser.fftSize);
    this._freqData = new Uint8Array(this.analyser.frequencyBinCount);
    this._applyVolumes();

    // Shared looping white-noise source (deterministic).
    const seconds = 3;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * seconds), ac.sampleRate);
    const d = buf.getChannelData(0);
    const r = this.rng;
    for (let i = 0; i < d.length; i++) d[i] = r.float() * 2 - 1;
    const noise = ac.createBufferSource();
    noise.buffer = buf; noise.loop = true; noise.start();
    this._noise = noise;

    for (const l of this.layers) {
      l.gain = ac.createGain();
      l.gain.gain.value = 0;
      l.gain.connect(this.ambBus);
    }
    this._buildWind(); this._buildBirds(); this._buildCrickets(); this._buildTraffic(); this._buildRain(); this._buildRumble();
    // Listener defaults
    const L = ac.listener;
    if (L.forwardX) { L.forwardZ.value = -1; L.upY.value = 1; }
  }

  _buildWind() {
    const ac = this.ac, l = this.byId.wind;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.6;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    const trim = ac.createGain(); trim.gain.value = 0.55;
    // slow whistle: second narrow band that gusts up in frequency
    const whistle = ac.createBiquadFilter(); whistle.type = 'bandpass'; whistle.frequency.value = 900; whistle.Q.value = 6;
    const wTrim = ac.createGain(); wTrim.gain.value = 0.12;
    this._noise.connect(bp); bp.connect(lp); lp.connect(trim); trim.connect(l.gain);
    this._noise.connect(whistle); whistle.connect(wTrim); wTrim.connect(l.gain);
    l.nodes = [bp, lp, trim, whistle, wTrim];
    l.ctl = { bp, whistle, trim };
  }

  _buildBirds() {
    const ac = this.ac, l = this.byId.birds;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
    const trim = ac.createGain(); trim.gain.value = 0.5;
    hp.connect(trim); trim.connect(l.gain);
    l.nodes = [hp, trim];
    l.ctl = { input: hp };
  }

  _buildCrickets() {
    const ac = this.ac, l = this.byId.crickets;
    const trim = ac.createGain(); trim.gain.value = 0.16;
    trim.connect(l.gain);
    const nodes = [trim];
    const voices = [[4300, 31, 2.3, -0.5], [4750, 27, 1.7, 0.5], [3900, 36, 2.9, 0.1]];
    for (const [f, pulseHz, trillHz, pan] of voices) {
      const osc = ac.createOscillator(); osc.type = 'sine'; osc.frequency.value = f;
      const vca = ac.createGain(); vca.gain.value = 0.5;
      const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = pulseHz;
      const lfoG = ac.createGain(); lfoG.gain.value = 0.5;
      lfo.connect(lfoG); lfoG.connect(vca.gain);
      const vca2 = ac.createGain(); vca2.gain.value = 0.5;
      const trill = ac.createOscillator(); trill.type = 'square'; trill.frequency.value = trillHz;
      const trillG = ac.createGain(); trillG.gain.value = 0.5;
      trill.connect(trillG); trillG.connect(vca2.gain);
      const p = ac.createStereoPanner(); p.pan.value = pan;
      osc.connect(vca); vca.connect(vca2); vca2.connect(p); p.connect(trim);
      osc.start(); lfo.start(); trill.start();
      nodes.push(osc, vca, lfo, lfoG, vca2, trill, trillG, p);
    }
    l.nodes = nodes;
  }

  _buildTraffic() {
    const ac = this.ac, l = this.byId.traffic;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.5;
    const trim = ac.createGain(); trim.gain.value = 0.7;
    this._noise.connect(lp); lp.connect(trim); trim.connect(l.gain);
    const eng = ac.createBiquadFilter(); eng.type = 'lowpass'; eng.frequency.value = 240;
    const engTrim = ac.createGain(); engTrim.gain.value = 0.12;
    eng.connect(engTrim); engTrim.connect(l.gain);
    const nodes = [lp, trim, eng, engTrim];
    const tones = [[52, 0.07, 40], [79, 0.11, 55], [64, 0.05, -35]];
    for (const [f, lfoHz, depth] of tones) {
      const osc = ac.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;
      const lfo = ac.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = lfoHz;
      const lg = ac.createGain(); lg.gain.value = depth; // cents
      lfo.connect(lg); lg.connect(osc.detune);
      osc.connect(eng); osc.start(); lfo.start();
      nodes.push(osc, lfo, lg);
    }
    l.nodes = nodes;
  }

  _buildRain() {
    const ac = this.ac, l = this.byId.rain;
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
    const trim = ac.createGain(); trim.gain.value = 0.35;
    this._noise.connect(hp); hp.connect(lp); lp.connect(trim); trim.connect(l.gain);
    // drop transients: noise through a resonant band, gated by automated gain
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 4200; bp.Q.value = 3;
    const drop = ac.createGain(); drop.gain.value = 0;
    const dTrim = ac.createGain(); dTrim.gain.value = 0.8;
    this._noise.connect(bp); bp.connect(drop); drop.connect(dTrim); dTrim.connect(l.gain);
    this._rainDrop = { gain: drop, bp };
    l.nodes = [hp, lp, trim, bp, drop, dTrim];
  }

  _buildRumble() {
    const ac = this.ac, l = this.byId.rumble;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90; lp.Q.value = 0.8;
    const trim = ac.createGain(); trim.gain.value = 0.8; // keeps the ambience bus under unity before the compressor
    this._noise.connect(lp); lp.connect(trim); trim.connect(l.gain);
    const sub = ac.createOscillator(); sub.type = 'sine'; sub.frequency.value = 44;
    const subG = ac.createGain(); subG.gain.value = 0.12;
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.05;
    const lg = ac.createGain(); lg.gain.value = 6;
    lfo.connect(lg); lg.connect(sub.frequency);
    sub.connect(subG); subG.connect(l.gain); sub.start(); lfo.start();
    l.nodes = [lp, trim, sub, subG, lfo, lg];
  }

  // ---- volumes ------------------------------------------------------------------
  setVolume(master, { ambience, sfx } = {}) {
    if (typeof master === 'number') this.volumes.master = clamp01(master);
    if (typeof ambience === 'number') this.volumes.ambience = clamp01(ambience);
    if (typeof sfx === 'number') this.volumes.sfx = clamp01(sfx);
    this._applyVolumes();
  }

  mute(on = true) { this.muted = !!on; this._applyVolumes(); }

  _applyVolumes() {
    if (!this.ac) return;
    const t = this.ac.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.03);
    this.ambBus.gain.setTargetAtTime(this.volumes.ambience, t, 0.03);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.03);
  }

  // ---- per-tick (10 Hz) state -> gains -------------------------------------------
  /**
   * @param s { wind (0..1 gust-scaled), birds, crickets, traffic, rain, rumble, rainIntensity, birdDensity, windMag }
   */
  applyState(s) {
    for (const l of this.layers) l.target = clamp01(s[l.id] ?? 0);
    if (!this.running) return;
    const ac = this.ac, t = ac.currentTime;
    for (const l of this.layers) l.gain.gain.setTargetAtTime(l.target, t, TC);
    // wind timbre: stronger wind -> brighter band + whistle up
    const w = this.byId.wind.ctl;
    w.bp.frequency.setTargetAtTime(300 + 500 * clamp01(s.windMag), t, 0.3);
    w.whistle.frequency.setTargetAtTime(700 + 900 * clamp01(s.gust ?? 0.5), t, 0.3);
    // rain drops
    if (s.rain > 0.01 && this._rainDrop) this._scheduleDrops(t, s.rain, s.detail ?? 1);
    // birds
    if (s.birds > 0.02 && s.birdDensity > 0) this._maybeBirdBurst(t, s.birdDensity);
    // output level (for meters)
    const an = this.analyser;
    an.getFloatTimeDomainData(this._timeData);
    let sum = 0;
    const td = this._timeData;
    for (let i = 0; i < td.length; i += 4) sum += td[i] * td[i];
    const rms = Math.sqrt(sum / (td.length / 4));
    this._level += (Math.min(1, rms * 4) - this._level) * 0.5;
  }

  _scheduleDrops(t, intensity, detail) {
    // Automation on one AudioParam must be scheduled in time order and drops must not overlap, otherwise a later
    // setValueAtTime lands inside an earlier ramp and steps the gain (audible clicks). Draw the drops, sort, and
    // clamp each one's tail to the next drop's start.
    const g = this._rainDrop.gain.gain;
    const n = Math.round(this.rng.range(0, 1) + intensity * (2 + 6 * detail));
    if (n <= 0) return;
    const drops = [];
    for (let i = 0; i < n; i++) drops.push({ t0: t + this.rng.range(0.005, 0.1), a: 0.25 + 0.75 * this.rng.float(), d: 0.02 + 0.03 * this.rng.float() });
    drops.sort((x, y) => x.t0 - y.t0);
    let last = this._dropEnd || 0;
    for (let i = 0; i < drops.length; i++) {
      const dr = drops[i];
      if (dr.t0 < last + 0.002) continue; // still inside the previous drop's tail
      const next = i + 1 < drops.length ? drops[i + 1].t0 : Infinity;
      const end = Math.min(dr.t0 + 0.003 + dr.d, next - 0.002);
      if (end <= dr.t0 + 0.004) continue;
      g.setValueAtTime(0.0001, dr.t0);
      g.exponentialRampToValueAtTime(dr.a, dr.t0 + 0.003);
      g.exponentialRampToValueAtTime(0.0001, end);
      last = end;
    }
    this._dropEnd = last;
  }

  _maybeBirdBurst(t, density) {
    if (t < this._birdBusy) return;
    // density 0..1 -> expected bursts per second ≈ 0.15..1.6
    if (this.rng.float() > (0.015 + 0.16 * density)) return;
    const ac = this.ac, input = this.byId.birds.ctl.input;
    const n = this.rng.int(2, 5);
    const base = this.rng.range(2400, 4200);
    const pan = this.rng.range(-0.8, 0.8);
    const gap = this.rng.range(0.09, 0.17);
    let t0 = t + 0.02;
    const pn = ac.createStereoPanner(); pn.pan.value = pan; pn.connect(input);
    for (let i = 0; i < n; i++) {
      const car = ac.createOscillator(); car.type = 'sine';
      const mod = ac.createOscillator(); mod.type = 'sine'; mod.frequency.value = this.rng.range(40, 110);
      const mg = ac.createGain(); mg.gain.value = this.rng.range(150, 500);
      mod.connect(mg); mg.connect(car.frequency);
      const f = base * this.rng.range(0.9, 1.15);
      const dur = this.rng.range(0.06, 0.13);
      car.frequency.setValueAtTime(f, t0);
      car.frequency.exponentialRampToValueAtTime(f * this.rng.range(1.15, 1.5), t0 + dur * 0.35);
      car.frequency.exponentialRampToValueAtTime(f * this.rng.range(0.8, 1.0), t0 + dur);
      const env = ac.createGain(); env.gain.value = 0;
      env.gain.setValueAtTime(0, t0);
      env.gain.linearRampToValueAtTime(0.35 + 0.3 * this.rng.float(), t0 + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0005, t0 + dur);
      car.connect(env); env.connect(pn);
      car.start(t0); mod.start(t0); car.stop(t0 + dur + 0.01); mod.stop(t0 + dur + 0.01);
      t0 += gap * this.rng.range(0.8, 1.2);
    }
    this._birdBusy = t0 + this.rng.range(0.3, 1.2);
  }

  // ---- listener / positional -----------------------------------------------------------
  setListener(pos, fwd, up) {
    if (!this.ac) return;
    const L = this.ac.listener, t = this.ac.currentTime;
    if (L.positionX) {
      L.positionX.setTargetAtTime(pos.x, t, 0.05); L.positionY.setTargetAtTime(pos.y, t, 0.05); L.positionZ.setTargetAtTime(pos.z, t, 0.05);
      L.forwardX.setTargetAtTime(fwd.x, t, 0.05); L.forwardY.setTargetAtTime(fwd.y, t, 0.05); L.forwardZ.setTargetAtTime(fwd.z, t, 0.05);
      L.upX.setTargetAtTime(up.x, t, 0.05); L.upY.setTargetAtTime(up.y, t, 0.05); L.upZ.setTargetAtTime(up.z, t, 0.05);
    } else if (L.setPosition) {
      L.setPosition(pos.x, pos.y, pos.z); L.setOrientation(fwd.x, fwd.y, fwd.z, up.x, up.y, up.z);
    }
  }

  _out(pos) {
    if (!pos) return this.sfxBus;
    const ac = this.ac;
    const p = ac.createPanner();
    p.panningModel = 'equalpower'; p.distanceModel = 'inverse';
    p.refDistance = 40; p.maxDistance = 3000; p.rolloffFactor = 0.6;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y ?? 0; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y ?? 0, pos.z);
    p.connect(this.sfxBus);
    return p;
  }

  // ---- SFX --------------------------------------------------------------------------------
  play(name, pos = null) {
    if (!this.running) return false;
    const fn = this[`_sfx_${name}`];
    if (!fn) return false;
    const ac = this.ac, t = ac.currentTime + 0.005;
    const out = this._out(pos);
    fn.call(this, t, out);
    this._sfxCount++;
    return true;
  }

  _tone(t, out, { type = 'sine', f0, f1 = f0, dur = 0.1, a = 0.004, peak = 0.3, curve = 'exp', detune = 0 }) {
    const ac = this.ac;
    const o = ac.createOscillator(); o.type = type; o.detune.value = detune;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (curve === 'exp') g.gain.exponentialRampToValueAtTime(0.0001, t + dur); else g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.02);
  }

  _burst(t, out, { dur = 0.05, peak = 0.4, type = 'bandpass', f0 = 2000, f1 = f0, q = 1, a = 0.002 }) {
    const ac = this.ac;
    const src = ac.createBufferSource(); src.buffer = this._noise.buffer;
    src.loopStart = 0; src.loop = true;
    const flt = ac.createBiquadFilter(); flt.type = type; flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(out);
    src.start(t, this.rng.range(0, 2)); src.stop(t + dur + 0.02);
  }

  _sfx_click(t, out) {
    this._tone(t, out, { f0: 1900, f1: 1100, dur: 0.045, peak: 0.18 });
    this._burst(t, out, { dur: 0.02, peak: 0.12, f0: 5000, q: 1.5 });
  }

  _sfx_place(t, out) {
    // brick snap: sharp click + two resonant plastic ticks + a small body thump
    this._burst(t, out, { dur: 0.018, peak: 0.5, f0: 3800, q: 0.8 });
    this._tone(t + 0.004, out, { f0: 1350, f1: 1100, dur: 0.07, peak: 0.25 });
    this._tone(t + 0.012, out, { f0: 2100, f1: 1900, dur: 0.05, peak: 0.12 });
    this._tone(t, out, { f0: 190, f1: 120, dur: 0.09, peak: 0.35 });
  }

  _sfx_road(t, out) {
    // asphalt plate laid down: rolling low sweep + a snap at the end
    this._burst(t, out, { dur: 0.16, peak: 0.45, f0: 420, f1: 140, q: 1.2, a: 0.02 });
    this._tone(t, out, { f0: 110, f1: 70, dur: 0.16, peak: 0.3, a: 0.02 });
    this._burst(t + 0.14, out, { dur: 0.02, peak: 0.35, f0: 2600, q: 1 });
  }

  _sfx_bulldoze(t, out) {
    this._burst(t, out, { dur: 0.32, peak: 0.6, type: 'lowpass', f0: 900, f1: 180, q: 0.7, a: 0.01 });
    this._tone(t, out, { type: 'triangle', f0: 90, f1: 38, dur: 0.3, peak: 0.4, a: 0.01 });
    for (let i = 0; i < 5; i++) {
      const dt = 0.03 + this.rng.range(0, 0.22);
      this._burst(t + dt, out, { dur: 0.02, peak: 0.25, f0: this.rng.range(1500, 3500), q: 2 });
    }
  }

  _sfx_zone(t, out) {
    this._tone(t, out, { f0: 620, f1: 660, dur: 0.07, peak: 0.16 });
    this._tone(t + 0.06, out, { f0: 880, f1: 930, dur: 0.09, peak: 0.14 });
  }

  _sfx_error(t, out) {
    for (let i = 0; i < 2; i++) {
      const t0 = t + i * 0.11;
      this._tone(t0, out, { type: 'square', f0: 185, f1: 150, dur: 0.09, peak: 0.12, curve: 'lin' });
      this._tone(t0, out, { type: 'sawtooth', f0: 92, f1: 80, dur: 0.09, peak: 0.1, curve: 'lin' });
    }
  }

  _sfx_levelup(t, out) {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t0 = t + i * 0.085;
      this._tone(t0, out, { type: 'triangle', f0: f, dur: 0.22, peak: 0.22, a: 0.006 });
      this._tone(t0, out, { type: 'sine', f0: f * 2, dur: 0.16, peak: 0.06, a: 0.006 });
    });
    this._tone(t + 0.34, out, { type: 'triangle', f0: 1046.5, dur: 0.5, peak: 0.18, a: 0.01 });
  }

  _sfx_cash(t, out) {
    // coin: two bright partials, second one an octave-ish up, with a fast metallic burst
    this._tone(t, out, { f0: 1568, dur: 0.12, peak: 0.18, a: 0.002 });
    this._tone(t, out, { f0: 2350, dur: 0.1, peak: 0.08, a: 0.002 });
    this._tone(t + 0.08, out, { f0: 2093, dur: 0.28, peak: 0.2, a: 0.002 });
    this._tone(t + 0.08, out, { f0: 3140, dur: 0.22, peak: 0.07, a: 0.002 });
    this._burst(t, out, { dur: 0.015, peak: 0.2, f0: 6000, q: 2 });
  }

  // ---- meters ------------------------------------------------------------------------------
  /** Current per-layer gain values (actual GainNode values when running, else 0). */
  layerLevel(l) { return l.gain ? l.gain.gain.value : 0; }

  get outputLevel() { return this._level; }

  /** Fills `out` (Uint8Array) with frequency data; returns false if no analyser yet. */
  spectrum() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this._freqData);
    return this._freqData;
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
