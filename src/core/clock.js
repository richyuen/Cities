import * as THREE from 'three';

// Time of day. hours in [0,24). Sun path: rises east (+X), sets west (-X), arcs through south (+Z is south here? no:
// we define +X east, -Z north, +Z south). Sun direction points TOWARD the sun.

const MAX_ELEVATION = THREE.MathUtils.degToRad(62); // summer-ish, gives nice long golden-hour shadows

export class Clock {
  constructor(events, { hours = 14, dayLengthSec = 600 } = {}) {
    this.events = events;
    this.hours = hours;
    this.dayLengthSec = dayLengthSec; // real seconds per 24h at timeScale 1
    this.timeScale = 1;
    this.paused = false;
    this.sunDir = new THREE.Vector3();
    this.moonDir = new THREE.Vector3();
    this.sunElevation = 0;
    this.sunAzimuth = 0;
    this.isNight = false;
    this._lastEmitted = -1;
    this.elapsed = 0; // seconds of real time since boot (scaled)
    this._recompute();
  }

  set(h) {
    this.hours = ((h % 24) + 24) % 24;
    this._recompute();
    this._maybeEmit(true);
  }

  update(dt) {
    this.elapsed += dt * this.timeScale;
    if (!this.paused && this.timeScale > 0) {
      this.hours = (this.hours + (dt * this.timeScale * 24) / this.dayLengthSec) % 24;
      this._recompute();
      this._maybeEmit(false);
    }
  }

  /** fraction of daylight: 0 at night, 1 at full sun elevation */
  get daylight() {
    return THREE.MathUtils.clamp(Math.sin(this.sunElevation) / Math.sin(MAX_ELEVATION), 0, 1);
  }

  _recompute() {
    // t: 0 at sunrise (6:00), 1 at sunset (18:00)
    const t = (this.hours - 6) / 12;
    const ang = t * Math.PI; // 0..pi during day, pi..2pi at night
    this.sunElevation = Math.sin(ang) * MAX_ELEVATION;
    // azimuth: east at sunrise, south at noon, west at sunset
    this.sunAzimuth = ang;
    const cosE = Math.cos(this.sunElevation);
    this.sunDir.set(Math.cos(ang) * cosE, Math.sin(this.sunElevation), Math.sin(ang) * cosE * 0.6).normalize();
    // moon roughly opposite
    this.moonDir.set(-this.sunDir.x, Math.max(0.25, -this.sunDir.y), -this.sunDir.z).normalize();
    this.isNight = this.sunElevation < THREE.MathUtils.degToRad(-2);
  }

  _maybeEmit(force) {
    if (!force && Math.abs(this.hours - this._lastEmitted) < 1 / 240) return;
    this._lastEmitted = this.hours;
    this.events.emit('time:changed', {
      hours: this.hours,
      sunDir: [this.sunDir.x, this.sunDir.y, this.sunDir.z],
      sunElevation: this.sunElevation,
      isNight: this.isNight,
      daylight: this.daylight,
    });
  }
}
