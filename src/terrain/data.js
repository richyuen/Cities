// Shared constants + per-cell classification of the height field for rendering and stud placement.
import * as THREE from 'three';

export const PLATE = 0.4;          // Blox plate height (m): all terrain heights are multiples of this
export const BRICK = 1.2;          // 3 plates: terrace riser used on moderate rises
export const BRICK2 = 2.0;         // 5 plates: tall riser used on hill crests / plateau rim so terraces read as
                                    // thick rock ledges with a legible cast shadow instead of a hairline step
export const STUD_PITCH = 0.8;     // world stud pitch
export const SKIRT_BOTTOM = -14;   // y of the diorama skirt around the map edge
export const SKIRT_LIP = 2.4;      // horizontal lip of the diorama base (m)
export const WATER_OFFSET = -0.12; // water surface sits this far below seaLevel (avoids coplanar shore plates)
export const EPS = 0.01;

export const quantize = (h, q = PLATE) => Math.round(h / q) * q;
export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const mix = (a, b, t) => a + (b - a) * t;
const isMult = (h, q) => Math.abs(h / q - Math.round(h / q)) < 1e-3;

/** Palette names used for plate colours; vertex colours index into this list. */
export const COLOR_NAMES = ['brightGreen', 'darkGreen', 'lime', 'sandGreen', 'tan', 'brickYellow', 'mediumStoneGrey',
  'darkStoneGrey', 'brightBlue', 'sandBlue', 'darkAzur'];
export const C = Object.fromEntries(COLOR_NAMES.map((n, i) => [n, i]));

const STUDDABLE = new Set(['none', 'zone', 'park']);

/**
 * TerrainData wraps the world height field and answers: how is cell (i,j) rendered, what is the rendered surface
 * height at a world point, what colour is a cell, may it carry studs.
 */
export class TerrainData {
  constructor(world, rng, materials, { mode = 'terrace' } = {}) {
    this.world = world;
    this.rng = rng;
    this.materials = materials;
    this.mode = mode; // terrace = every cell is stepped plates | ramp = single-plate slopes rendered smooth
    const { w, h } = world.size;
    this.w = w; this.h = h; this.w1 = w + 1;
    this.cs = world.cellSize;
    this.colorIdx = new Uint8Array(w * h);
    this.colors = COLOR_NAMES.map((n) => materials.color(n).clone());
    this.skirtColor = new THREE.Color('#0b1119'); // near-black blue diorama base
  }

  get hf() { return this.world.heightField; }

  // ---- cell classification ------------------------------------------------------
  /** 0 = flat, 1 = smooth ramp, 2/4 = stepped with n x n sub-plates */
  cellCode(i, j) {
    const spread = this.spread(i, j);
    if (spread < 1e-4) return 0;
    if (this.mode === 'ramp' && spread <= PLATE + 1e-3) return 1;
    return spread <= 4 * PLATE + 1e-3 ? 2 : 4;
  }

  /** Step height used inside cell (i,j): the tallest riser tier (2.0/1.2/0.8) all four corners agree on, else a plate. */
  cellQuantum(i, j) {
    const hf = this.hf, w1 = this.w1, k = j * w1 + i;
    const h00 = hf[k], h10 = hf[k + 1], h01 = hf[k + w1], h11 = hf[k + w1 + 1];
    if (isMult(h00, BRICK2) && isMult(h10, BRICK2) && isMult(h01, BRICK2) && isMult(h11, BRICK2)) return BRICK2;
    if (isMult(h00, BRICK) && isMult(h10, BRICK) && isMult(h01, BRICK) && isMult(h11, BRICK)) return BRICK;
    if (isMult(h00, 0.8) && isMult(h10, 0.8) && isMult(h01, 0.8) && isMult(h11, 0.8)) return 0.8;
    return PLATE;
  }

  spread(i, j) {
    const hf = this.hf, w1 = this.w1, k = j * w1 + i;
    const h00 = hf[k], h10 = hf[k + 1], h01 = hf[k + w1], h11 = hf[k + w1 + 1];
    return Math.max(h00, h10, h01, h11) - Math.min(h00, h10, h01, h11);
  }

  avg(i, j) {
    const hf = this.hf, w1 = this.w1, k = j * w1 + i;
    return (hf[k] + hf[k + 1] + hf[k + w1] + hf[k + w1 + 1]) * 0.25;
  }

  minCorner(i, j) {
    const hf = this.hf, w1 = this.w1, k = j * w1 + i;
    return Math.min(hf[k], hf[k + 1], hf[k + w1], hf[k + w1 + 1]);
  }

  isWaterCell(i, j) { return this.avg(i, j) < -0.01; }

  /** Height of the stepped sub-plate at fraction (u,v) inside cell (i,j) with sub-division n. */
  subPlateH(i, j, u, v, n) {
    const hf = this.hf, w1 = this.w1, k = j * w1 + i;
    const h00 = hf[k], h10 = hf[k + 1], h01 = hf[k + w1], h11 = hf[k + w1 + 1];
    u = (Math.floor(u * n) + 0.5) / n; v = (Math.floor(v * n) + 0.5) / n;
    return quantize((h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v, this.cellQuantum(i, j));
  }

  /** Height of the rendered surface at world (x, z); SKIRT_BOTTOM outside the map. */
  surfaceH(x, z) {
    const w = this.world;
    const fx = (x - w.minX) / this.cs, fz = (z - w.minZ) / this.cs;
    if (fx < 0 || fz < 0 || fx >= this.w || fz >= this.h) return SKIRT_BOTTOM;
    const i = fx | 0, j = fz | 0;
    const code = this.cellCode(i, j);
    const hf = this.hf, w1 = this.w1, k = j * w1 + i;
    if (code === 0) return hf[k];
    const u = fx - i, v = fz - j;
    if (code === 1) {
      const h00 = hf[k], h10 = hf[k + 1], h01 = hf[k + w1], h11 = hf[k + w1 + 1];
      return (h00 * (1 - u) + h10 * u) * (1 - v) + (h01 * (1 - u) + h11 * u) * v;
    }
    return this.subPlateH(i, j, u, v, code);
  }

  /** Flat, studdable plate height at world (x,z) or null (ramp, water, road, building, out of map). */
  topAt(x, z) {
    const w = this.world;
    const fx = (x - w.minX) / this.cs, fz = (z - w.minZ) / this.cs;
    if (fx < 0 || fz < 0 || fx >= this.w || fz >= this.h) return null;
    const i = fx | 0, j = fz | 0;
    const cell = w.cells[j * this.w + i];
    if (!STUDDABLE.has(cell.type)) return null;
    const code = this.cellCode(i, j);
    if (code === 1) return null;
    if (code === 0) return this.hf[j * this.w1 + i];
    if (this.avg(i, j) < -0.01) return null;
    return this.subPlateH(i, j, fx - i, fz - j, code);
  }

  studdable(i, j) {
    const cell = this.world.cellAt(i, j);
    return !!cell && STUDDABLE.has(cell.type) && !this.isWaterCell(i, j);
  }

  /** Smooth vertex normal from the height field (used for ramp cells). */
  vertexNormal(i, j, out) {
    const w = this.world;
    const hL = w.getVertexHeight(i - 1, j), hR = w.getVertexHeight(i + 1, j);
    const hD = w.getVertexHeight(i, j - 1), hU = w.getVertexHeight(i, j + 1);
    return out.set(hL - hR, 2 * this.cs, hD - hU).normalize();
  }

  // ---- colours ---------------------------------------------------------------------
  /** Per-plate colour: grass greens with patches, sand near water, rock on steep cells, blue seabed. */
  computeColorIndex(i, j) {
    const avg = this.avg(i, j);
    if (avg < -0.01) return avg < -1.4 ? C.brightBlue : (avg < -0.7 ? C.darkAzur : C.tan);
    const spread = this.spread(i, j);
    const rng = this.rng;
    const n = rng.fbm(i / 36 + 0.7, j / 36 - 3.3, 3);     // woods (large, soft patches)
    const n2 = rng.fbm(i / 11 + 50, j / 11 + 20, 2);      // meadows / beach variation
    // distance to water (Chebyshev, cells)
    let dw = 9;
    for (let dj = -3; dj <= 3 && dw > 1; dj++) {
      for (let di = -3; di <= 3; di++) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= this.w || jj >= this.h) continue;
        if (this.avg(ii, jj) < -0.01) dw = Math.min(dw, Math.max(Math.abs(di), Math.abs(dj)));
      }
    }
    // beaches and river banks are sand plates, even where they step down steeply
    if (dw <= 1 && avg < 1.5) return C.tan;
    if (dw <= 2 && avg < 1.5 && n2 > -0.2) return C.tan;
    if (dw <= 3 && avg < 1.0 && n2 > 0.4) return C.brickYellow;
    // steep = exposed rock (3x3 mean steepness so rock forms bands, not speckle)
    let ms = 0, mc = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= this.w || jj >= this.h) continue;
      ms += this.spread(ii, jj); mc++;
    }
    ms /= mc;
    if (avg > 6.5 && ms >= 1.9 && spread >= BRICK - 1e-3) return C.darkStoneGrey;
    if (avg > 6.5 && ms >= 1.1 && spread >= BRICK - 1e-3) return C.mediumStoneGrey;
    // hills: darker greens, grey near the peaks
    if (avg > 17) return n > -0.1 ? C.mediumStoneGrey : C.darkGreen;
    if (avg > 9) return n > -0.3 ? C.darkGreen : C.brightGreen;
    // plains: bright green baseplates with larger dark-green (wooded) patches and a few lime meadows
    if (n > 0.26) return C.darkGreen;
    if (n2 > 0.62 && n > -0.15 && n < 0.15) return C.lime;
    return C.brightGreen;
  }

  computeColors(i0 = 0, j0 = 0, i1 = this.w - 1, j1 = this.h - 1) {
    i0 = Math.max(0, i0); j0 = Math.max(0, j0); i1 = Math.min(this.w - 1, i1); j1 = Math.min(this.h - 1, j1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) this.colorIdx[j * this.w + i] = this.computeColorIndex(i, j);
  }

  colorOf(i, j) { return this.colors[this.colorIdx[j * this.w + i]]; }

  /** Colour for one flat piece at height hs inside cell (i,j): shore/seabed colours follow the piece height. */
  pieceColor(i, j, hs) {
    const ci = this.colorIdx[j * this.w + i];
    if (hs < -1.4) return this.colors[C.brightBlue];
    if (hs < -0.7) return this.colors[C.darkAzur];
    if (hs < -0.01) return this.colors[C.tan];
    if (ci === C.brightBlue || ci === C.darkAzur || ci === C.sandBlue) return this.colors[C.tan];
    return this.colors[ci];
  }
  colorNameOf(i, j) { return COLOR_NAMES[this.colorIdx[j * this.w + i]]; }
}

export { THREE };
