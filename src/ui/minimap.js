// Minimap: paints world.cells (type/zone/height) + road edges into an offscreen canvas whenever the world is marked
// dirty (throttled to 2 Hz), then composites it with the camera marker on the visible canvas. Click recentres the camera.
// Four things could read as "green" on a 194 px map, so they are pulled apart: baseplate = mid grass green, homes =
// Lego bright yellow-green (matches the toolbar zone icon), parks = dark teal with a checker dot hatch.
const COL = {
  water: [30, 142, 192], road: [63, 69, 76], park: [20, 110, 90], parkDot: [42, 148, 120],
  zoneR: [205, 228, 110], zoneC: [130, 185, 240], zoneI: [250, 190, 120],
  bldR: [165, 202, 24], bldC: [40, 120, 205], bldI: [220, 120, 40], bldX: [190, 190, 185],
};

export class Minimap {
  constructor(ctx, canvas, onClick) {
    this.ctx = ctx;
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    const { w, h } = ctx.world.size;
    this.off = document.createElement('canvas');
    this.off.width = w; this.off.height = h;
    this.og = this.off.getContext('2d');
    this.img = this.og.createImageData(w, h);
    this.dirty = true; // rebuild on first update, then only when the world changes (markDirty), throttled to 2 Hz
    this.cooldown = 0;
    this.camDirty = true;
    this.view = { i0: 0, j0: 0, span: w }; // visible window (cells); auto-fits the built area
    this._cam = { x: NaN, z: NaN, tx: NaN, tz: NaN };
    this._onClick = (e) => {
      const r = canvas.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
      const world = ctx.world, { i0, j0, span } = this.view;
      onClick(world.minX + (i0 + u * span) * world.cellSize, world.minZ + (j0 + v * span) * world.cellSize);
    };
    canvas.addEventListener('click', this._onClick);
    this._offCam = ctx.events.on('camera:changed', () => { this.camDirty = true; });
  }

  dispose() { this.canvas.removeEventListener('click', this._onClick); this._offCam?.(); }

  markDirty() { this.dirty = true; }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.dirty && this.cooldown <= 0) { this.dirty = false; this.cooldown = 0.5; this.rebuild(); this.compose(); }
    else if (this.camDirty) this.compose();
  }

  rebuild() {
    const world = this.ctx.world;
    const { w, h } = world.size;
    const d = this.img.data;
    const cells = world.cells;
    let minI = w, maxI = -1, minJ = h, maxJ = -1;
    for (let idx = 0, p = 0; idx < w * h; idx++, p += 4) {
      const c = cells[idx];
      if (c.type !== 'none' && c.type !== 'water') {
        if (c.i < minI) minI = c.i; if (c.i > maxI) maxI = c.i; if (c.j < minJ) minJ = c.j; if (c.j > maxJ) maxJ = c.j;
      }
      let r, g, b;
      if (c.type === 'water' || c.height < world.seaLevel - 0.01) { [r, g, b] = COL.water; }
      else if (c.type === 'road') { [r, g, b] = COL.road; }
      else if (c.type === 'park') { [r, g, b] = ((c.i + c.j) & 1) ? COL.parkDot : COL.park; }
      else if (c.type === 'building' || c.buildingId) { [r, g, b] = c.zone === 'r' ? COL.bldR : c.zone === 'c' ? COL.bldC : c.zone === 'i' ? COL.bldI : COL.bldX; }
      else if (c.zone) { [r, g, b] = c.zone === 'r' ? COL.zoneR : c.zone === 'c' ? COL.zoneC : COL.zoneI; }
      else {
        // baseplate green shaded by height
        const t = Math.max(0, Math.min(1, (c.height - world.seaLevel) / 60));
        r = 62 + 70 * t; g = 140 + 50 * t; b = 60 + 50 * t;
      }
      d[p] = r; d[p + 1] = g; d[p + 2] = b; d[p + 3] = 255;
    }
    this.og.putImageData(this.img, 0, 0);
    // auto-fit: square window around the built area (padded), min 48 cells; whole map if nothing is built
    if (maxI >= 0) {
      const pad = 6;
      const span = Math.min(Math.max(w, h), Math.max(36, maxI - minI + 1 + pad * 2, maxJ - minJ + 1 + pad * 2));
      const ci = (minI + maxI + 1) / 2, cj = (minJ + maxJ + 1) / 2;
      const i0 = Math.max(0, Math.min(w - span, Math.round(ci - span / 2)));
      const j0 = Math.max(0, Math.min(h - span, Math.round(cj - span / 2)));
      this.view = { i0, j0, span };
    } else this.view = { i0: 0, j0: 0, span: Math.max(w, h) };
    // roads as lines (cells already carry road type, but thin paths and diagonals read better as strokes)
    const og = this.og;
    const cs = world.cellSize;
    og.lineCap = 'round';
    for (const e of world.roads.edges.values()) {
      const a = world.roads.nodes.get(e.a), b = world.roads.nodes.get(e.b);
      if (!a || !b) continue;
      og.strokeStyle = e.kind === 'path' ? 'rgb(222,198,156)' : e.kind === 'highway' ? 'rgb(40,44,50)' : 'rgb(63,69,76)';
      og.lineWidth = Math.max(0.6, e.width / cs);
      og.beginPath();
      og.moveTo((a.x - world.minX) / cs, (a.z - world.minZ) / cs);
      og.lineTo((b.x - world.minX) / cs, (b.z - world.minZ) / cs);
      og.stroke();
    }
  }

  compose() {
    this.camDirty = false;
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    const world = this.ctx.world;
    const { i0, j0, span } = this.view;
    g.imageSmoothingEnabled = span >= 96; // crisp blocks when zoomed in, smooth when showing the whole map
    g.clearRect(0, 0, W, H);
    g.drawImage(this.off, i0, j0, span, span, 0, 0, W, H);
    // camera marker: dot at camera ground position + view cone toward the orbit target
    const cam = this.ctx.camera, tgt = this.ctx.controls?.target;
    if (!cam) return;
    const cs = world.cellSize, k = W / span;
    const toX = (x) => ((x - world.minX) / cs - i0) * k, toZ = (z) => ((z - world.minZ) / cs - j0) * k;
    const rawX = toX(cam.position.x), rawZ = toZ(cam.position.z);
    const m = 9, clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const inside = rawX >= 0 && rawX <= W && rawZ >= 0 && rawZ <= H;
    const cx = clamp(rawX, m, W - m), cz = clamp(rawZ, m, H - m); // marker never leaves the fitted window
    g.lineJoin = 'round';
    if (tgt) {
      const tx = clamp(toX(tgt.x), m, W - m), tz = clamp(toZ(tgt.z), m, H - m);
      if (inside) {
        // view cone from the camera toward the orbit target, filled + outlined so it reads on green
        const dx = tx - cx, dz = tz - cz, len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len, nz = dx / len, spread = Math.min(len, 60) * 0.45;
        g.beginPath(); g.moveTo(cx, cz); g.lineTo(tx + nx * spread, tz + nz * spread); g.lineTo(tx - nx * spread, tz - nz * spread); g.closePath();
        g.fillStyle = 'rgba(255,255,255,0.26)'; g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 3; g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.5; g.stroke();
      }
      g.fillStyle = '#F7C948'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 2;
      g.beginPath(); g.arc(tx, tz, 5, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    // camera: white dot (inside) or a white chevron pinned to the edge, pointing off-map (outside)
    g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 2;
    if (inside) { g.beginPath(); g.arc(cx, cz, 6, 0, Math.PI * 2); g.fill(); g.stroke(); }
    else {
      const ax = rawX - cx, az = rawZ - cz, al = Math.hypot(ax, az) || 1, ux = ax / al, uz = az / al, px = -uz, pz = ux;
      g.beginPath(); g.moveTo(cx + ux * 8, cz + uz * 8); g.lineTo(cx - ux * 4 + px * 7, cz - uz * 4 + pz * 7); g.lineTo(cx - ux * 4 - px * 7, cz - uz * 4 - pz * 7); g.closePath();
      g.fill(); g.stroke();
    }
  }
}
