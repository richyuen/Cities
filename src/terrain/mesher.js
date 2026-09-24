// Geometry builder: every cell becomes flat Blox plates (with vertical risers between levels), or a smooth ramp
// in 'ramp' mode. Flat runs of equal plates are merged along rows; risers are emitted once, from the higher side
// only, and skipped where they would sit well under water. The map edge gets a dark diorama base with a lip.
import * as THREE from 'three';
import { SKIRT_BOTTOM, SKIRT_LIP, EPS, WATER_OFFSET, BRICK2 } from './data.js';

const UP = [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0];
const _tmp = new THREE.Vector3();
const RISER_SEG = 2;                 // metres: finest riser segment (= 4x4 sub-plate size)
const RISER_HIDE_DEPTH = 0.8;        // risers whose top is this far under the water surface are never visible
const GROUT_H = 0.06;                 // metres: thin dark band right at the tread/riser seam (grout line)
const GROUT_DARK = 0.55;              // brightness of that band, independent of any real-time shadow
const AO_W = 0.35;                    // metres: inward width of the faint AO strip painted on the tread beside a riser
const AO_DARK = 0.88;                 // ~12% darker at the seam, matching the brief's baked-AO backstop
const AO_LIFT = 0.015;                // lifts the AO strip a hair above the tread to avoid z-fighting
// The grout band + tread AO strip only add geometry for genuinely terrace-height risers (0.8 m tier and up:
// hills, the plateau rim); single-plate (0.4 m) plate steps in the rolling plains keep one plain quad each so
// the extra draw cost lands where it reads as a terrace, not spread thin over every gentle ripple in the grass.
const GROUT_MIN_DROP = 0.7;

class GeoBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.idx = []; this.n = 0; }

  /** p: 12 numbers (4 verts), nrm: 12 numbers, color: THREE.Color, f: 4 brightness factors. Winding fixed to nrm. */
  quad(p, nrm, color, f) {
    const b = this.n;
    const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
    const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const flip = (cx * nrm[0] + cy * nrm[1] + cz * nrm[2]) < 0;
    for (let k = 0; k < 4; k++) {
      this.pos.push(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
      this.nor.push(nrm[k * 3], nrm[k * 3 + 1], nrm[k * 3 + 2]);
      const fk = f ? f[k] : 1;
      this.col.push(color.r * fk, color.g * fk, color.b * fk);
    }
    if (flip) this.idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
    else this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }

  /** Horizontal rectangle at height y. */
  top(x0, z0, x1, z1, y, color) {
    this.quad([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], UP, color, null);
  }

  toGeometry(withColor = true) {
    if (this.n === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    if (withColor) g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Vertical riser quad from hTop down to hBot along segment a->b, facing (ox, oz). Riser faces are baked
 * noticeably darker than the flat tread colour (roughly a full stop by the base of a tall riser) so terraces
 * read as physically-lit steps even where the real-time shadow map is thin or absent; a thin near-black
 * "grout" band right under the tread edge reads as a seam line at any sun angle.
 */
function riser(g, ax, az, bx, bz, hTop, hBot, ox, oz, color) {
  const drop = hTop - hBot;
  const tall = Math.min(1, Math.max(0, (drop - 0.4) / (BRICK2 - 0.4)));
  const fTop = 0.74 - 0.14 * tall;   // shallow riser ~0.74x tread, tall riser ~0.60x
  const fBot = 0.52 - 0.22 * tall;   // shallow ~0.52x, tall ~0.30x -> tread reads a full stop brighter
  const nrm = [ox, 0, oz, ox, 0, oz, ox, 0, oz, ox, 0, oz];
  if (drop >= GROUT_MIN_DROP) {
    const gy = hTop - GROUT_H;
    g.quad([ax, hTop, az, bx, hTop, bz, bx, gy, bz, ax, gy, az], nrm, color, [GROUT_DARK, GROUT_DARK, fTop, fTop]);
    g.quad([ax, gy, az, bx, gy, bz, bx, hBot, bz, ax, hBot, az], nrm, color, [fTop, fTop, fBot, fBot]);
  } else {
    g.quad([ax, hTop, az, bx, hTop, bz, bx, hBot, bz, ax, hBot, az], nrm, color, [fTop, fTop, fBot, fBot]);
  }
}

/**
 * Faint AO strip painted on the tread just inside a riser's top edge (baked vertex-colour darkening, ~12%):
 * a backstop terrace cue that reads even at sun angles where the real shadow from the riser above is thin.
 */
function treadAO(g, ax, az, bx, bz, h, ox, oz, color) {
  const ix = ax - ox * AO_W, iz = az - oz * AO_W;
  const jx = bx - ox * AO_W, jz = bz - oz * AO_W;
  const y = h + AO_LIFT;
  g.quad([ax, y, az, bx, y, bz, jx, y, jz, ix, y, iz], UP, color, [AO_DARK, AO_DARK, 1, 1]);
}

/** Diorama base along one map-edge segment: short dark wall, outward lip ledge, deep outer wall. */
function skirt(g, data, ax, az, bx, bz, hTop, ox, oz) {
  const c = data.skirtColor;
  const lipY = hTop - 0.8;
  const lx = ox * SKIRT_LIP, lz = oz * SKIRT_LIP;
  // extend along the edge at map corners so the two lips meet
  const tx = Math.sign(bx - ax), tz = Math.sign(bz - az);
  const w = data.world;
  const onX = (x) => Math.abs(x - w.minX) < 1e-3 || Math.abs(x - (w.minX + w.widthMeters)) < 1e-3;
  const onZ = (z) => Math.abs(z - w.minZ) < 1e-3 || Math.abs(z - (w.minZ + w.depthMeters)) < 1e-3;
  const eA = onX(ax) && onZ(az) ? SKIRT_LIP : 0;
  const eB = onX(bx) && onZ(bz) ? SKIRT_LIP : 0;
  const a2x = ax - tx * eA, a2z = az - tz * eA, b2x = bx + tx * eB, b2z = bz + tz * eB;
  const nrm = [ox, 0, oz, ox, 0, oz, ox, 0, oz, ox, 0, oz];
  const f = [1, 1, 1, 1];
  g.quad([ax, hTop, az, bx, hTop, bz, bx, lipY, bz, ax, lipY, az], nrm, c, f);                       // inner wall
  g.quad([a2x, lipY, a2z, b2x, lipY, b2z, b2x + lx, lipY, b2z + lz, a2x + lx, lipY, a2z + lz], UP, c, f); // lip
  g.quad([a2x + lx, lipY, a2z + lz, b2x + lx, lipY, b2z + lz, b2x + lx, SKIRT_BOTTOM, b2z + lz, a2x + lx, SKIRT_BOTTOM, a2z + lz],
    nrm, c, [1, 1, 0.6, 0.6]);                                                                          // outer wall
}

/**
 * Walk one edge of a flat piece at height h and emit risers wherever the neighbouring surface is lower.
 * Segments with identical top/bottom are merged into one quad.
 */
function edgeRisers(g, data, ax, az, bx, bz, h, ox, oz, color, waterY) {
  if (h < waterY - RISER_HIDE_DEPTH) return;
  const world = data.world;
  const len = Math.hypot(bx - ax, bz - az);
  const tx = (bx - ax) / len, tz = (bz - az) / len;
  // a piece edge on the map boundary becomes diorama base instead of a riser
  const cx = (ax + bx) * 0.5 + ox * EPS, cz = (az + bz) * 0.5 + oz * EPS;
  if (cx < world.minX || cz < world.minZ || cx >= world.minX + world.widthMeters || cz >= world.minZ + world.depthMeters) {
    skirt(g, data, ax, az, bx, bz, h, ox, oz);
    return;
  }
  const segs = Math.max(1, Math.round(len / RISER_SEG));
  let runStart = -1, runBot = 0;
  const flushRun = (sEnd) => {
    if (runStart < 0) return;
    const s0 = (runStart / segs) * len, s1 = (sEnd / segs) * len;
    const a0x = ax + tx * s0, a0z = az + tz * s0, a1x = ax + tx * s1, a1z = az + tz * s1;
    riser(g, a0x, a0z, a1x, a1z, h, runBot, ox, oz, color);
    if (h - runBot >= GROUT_MIN_DROP) treadAO(g, a0x, a0z, a1x, a1z, h, ox, oz, color);
    runStart = -1;
  };
  for (let s = 0; s < segs; s++) {
    const sm = ((s + 0.5) / segs) * len;
    const mx = ax + tx * sm + ox * EPS, mz = az + tz * sm + oz * EPS;
    const hb = data.surfaceH(mx, mz);
    const bot = Math.min(hb, h);
    if (h - bot < 2e-3) { flushRun(s); continue; }
    if (runStart >= 0 && Math.abs(bot - runBot) > 1e-4) flushRun(s);
    if (runStart < 0) { runStart = s; runBot = bot; }
  }
  flushRun(segs);
}

/** Flat piece: top + risers on its 4 edges. */
function flatPiece(g, data, x0, z0, x1, z1, h, color, waterY) {
  g.top(x0, z0, x1, z1, h, color);
  edgeRisers(g, data, x0, z0, x1, z0, h, 0, -1, color, waterY);  // south (z = z0)
  edgeRisers(g, data, x1, z0, x1, z1, h, 1, 0, color, waterY);   // east
  edgeRisers(g, data, x1, z1, x0, z1, h, 0, 1, color, waterY);   // north
  edgeRisers(g, data, x0, z1, x0, z0, h, -1, 0, color, waterY);  // west
}

/** Build the ground geometry for cells [i0..i1] x [j0..j1] (inclusive). */
export function buildChunkGeometry(data, i0, j0, i1, j1) {
  const g = new GeoBuilder();
  const world = data.world, cs = data.cs, minX = world.minX, minZ = world.minZ;
  const hf = data.hf, w1 = data.w1;
  const waterY = world.seaLevel + WATER_OFFSET;
  const nrm = new Array(12);
  for (let j = j0; j <= j1; j++) {
    const z0 = minZ + j * cs;
    let i = i0;
    while (i <= i1) {
      const code = data.cellCode(i, j);
      const k = j * w1 + i;
      const x0 = minX + i * cs;
      if (code === 0) {
        // merge the run of flat cells with the same height and colour along this row
        const h = hf[k], color = data.pieceColor(i, j, h);
        let ie = i;
        while (ie + 1 <= i1 && data.cellCode(ie + 1, j) === 0 && hf[j * w1 + ie + 1] === h
          && data.pieceColor(ie + 1, j, h) === color) ie++;
        flatPiece(g, data, x0, z0, minX + (ie + 1) * cs, z0 + cs, h, color, waterY);
        i = ie + 1;
        continue;
      }
      const h00 = hf[k], h10 = hf[k + 1], h01 = hf[k + w1], h11 = hf[k + w1 + 1];
      if (code === 1) {
        const color = data.pieceColor(i, j, (h00 + h10 + h01 + h11) * 0.25);
        data.vertexNormal(i, j, _tmp); nrm[0] = _tmp.x; nrm[1] = _tmp.y; nrm[2] = _tmp.z;
        data.vertexNormal(i + 1, j, _tmp); nrm[3] = _tmp.x; nrm[4] = _tmp.y; nrm[5] = _tmp.z;
        data.vertexNormal(i + 1, j + 1, _tmp); nrm[6] = _tmp.x; nrm[7] = _tmp.y; nrm[8] = _tmp.z;
        data.vertexNormal(i, j + 1, _tmp); nrm[9] = _tmp.x; nrm[10] = _tmp.y; nrm[11] = _tmp.z;
        g.quad([x0, h00, z0, x0 + cs, h10, z0, x0 + cs, h11, z0 + cs, x0, h01, z0 + cs], nrm, color, null);
        // ramps only ever step down to neighbours by risers emitted from the higher neighbour
      } else {
        const n = code, s = cs / n;
        for (let sj = 0; sj < n; sj++) {
          const v = (sj + 0.5) / n;
          let si = 0;
          while (si < n) {
            const hs = data.subPlateH(i, j, (si + 0.5) / n, v, n);
            let se = si;
            while (se + 1 < n && Math.abs(data.subPlateH(i, j, (se + 1.5) / n, v, n) - hs) < 1e-4) se++;
            flatPiece(g, data, x0 + si * s, z0 + sj * s, x0 + (se + 1) * s, z0 + (sj + 1) * s, hs,
              data.pieceColor(i, j, hs), waterY);
            si = se + 1;
          }
        }
      }
      i++;
    }
  }
  return g.toGeometry(true);
}

/** Water surface: one quad per row-run of cells that have any corner below sea level. */
export function buildWaterGeometry(data, y) {
  const g = new GeoBuilder();
  const world = data.world, cs = data.cs, minX = world.minX, minZ = world.minZ;
  const white = new THREE.Color(1, 1, 1);
  for (let j = 0; j < data.h; j++) {
    let i = 0;
    while (i < data.w) {
      if (data.minCorner(i, j) >= 0) { i++; continue; }
      let ie = i;
      while (ie + 1 < data.w && data.minCorner(ie + 1, j) < 0) ie++;
      const x0 = minX + i * cs, z0 = minZ + j * cs;
      g.quad([x0, y, z0, minX + (ie + 1) * cs, y, z0, minX + (ie + 1) * cs, y, z0 + cs, x0, y, z0 + cs], UP, white, null);
      i = ie + 1;
    }
  }
  return g.toGeometry(false);
}
