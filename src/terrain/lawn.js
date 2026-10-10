// LOOP c6 lawn: the sparse-stud "tiled lawn" keep rule. Pure (no THREE): a 256x256 periodic pattern of 1x1 / 1x2 /
// 2x2 tiles with at most one stud per tile. The same bytes are uploaded as the ground shader's uLawnTex and read by
// the CPU stud placement, so real studs (near) and shader relief studs (far) agree by construction.
// The pattern is seed-independent (an art asset): the fixed salt gives golden checksums (sparse12 45ffee02 / 5,624
// studs, scatter6 db8ae529 / 10,501).
export const LAWN_N = 256, LAWN_BIAS = 4096;      // period in stud cells (204.8 m); bias is a multiple of N
export const LAWN_DEFAULT = 1;
export const LAWN_VARIANTS = {
  1: { name: 'sparse12', studP: 0.085, seamDark: 0.30, seamHalf: 0.04, tone: 0.30 },
  2: { name: 'scatter6', studP: 0.16, seamDark: 0.30, seamHalf: 0.04, tone: 0.30 },
  3: { name: 'sparse12-flat', studP: 0.085, seamDark: 0, seamHalf: 0.04, tone: 0 },
};
const SALT = 11, P22 = 0.30, PPAIR = 0.80;
const TONES = [128, 128, 128, 104, 104, 168, 168, 92];   // mean 127.5 -> mean tone factor 1.0
export function lawnHash(x, y, s) {
  let h = (Math.imul(x, 0x9E3779B1) + Math.imul(y, 0x85EBCA77) + Math.imul(s, 0xC2B2AE3D)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D);
  h ^= h >>> 15; h = Math.imul(h, 0x846CA68B);
  h ^= h >>> 16;
  return h >>> 0;
}
/** RGBA per cell: R keep (0/255), G tone, B seam bits (1 = -x edge, 2 = +x, 4 = -z, 8 = +z), A 255. */
export function buildLawnPattern(studP) {
  const N = LAWN_N, own = new Int32Array(N * N).fill(-1), out = new Uint8Array(N * N * 4), tiles = [];
  const at = (i, j) => j * N + i;
  const free = (i, j) => i < N && j < N && own[at(i, j)] < 0;       // tiles never cross the period edge
  const put = (i, j, su, sv) => { for (let b = 0; b < sv; b++) for (let a = 0; a < su; a++) own[at(i + a, j + b)] = tiles.length; tiles.push(i, j, su, sv); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {          // pass 1: 2x2 tiles
    if (free(i, j) && (lawnHash(i, j, SALT) & 0xffff) < P22 * 65536 && free(i + 1, j) && free(i, j + 1) && free(i + 1, j + 1)) put(i, j, 2, 2);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {          // pass 2: pairs (orientation by hash bit), then singles
    if (!free(i, j)) continue;
    const h = lawnHash(i, j, SALT + 1), wide = (h >>> 16) & 1;
    let su = 1, sv = 1;
    if ((h & 0xffff) < PPAIR * 65536) {
      if (wide ? free(i + 1, j) : !free(i, j + 1) && free(i + 1, j)) su = 2;
      else if (free(i, j + 1)) sv = 2;
    }
    put(i, j, su, sv);
  }
  for (let t = 0; t < tiles.length; t += 4) {                        // at most one stud per tile, chance grows with area
    const i = tiles[t], j = tiles[t + 1], su = tiles[t + 2], sv = tiles[t + 3];
    const h = lawnHash(i, j, SALT + 2), area = su * sv;
    const stud = ((h >>> 3) & 1023) < Math.min(1024, Math.round(studP * area * 1024)), pick = (h >>> 13) & (area - 1);
    for (let b = 0; b < sv; b++) for (let a = 0; a < su; a++) {
      const o = at(i + a, j + b) * 4;
      out[o] = stud && a + b * su === pick ? 255 : 0;
      out[o + 1] = TONES[h & 7];
      out[o + 2] = (a === 0 ? 1 : 0) | (a === su - 1 ? 2 : 0) | (b === 0 ? 4 : 0) | (b === sv - 1 ? 8 : 0);
      out[o + 3] = 255;
    }
  }
  return out;
}
export const lawnIndex = (ix, iz) => ((((iz + LAWN_BIAS) & 255) << 8) | ((ix + LAWN_BIAS) & 255)) * 4;
// keep(ix, iz) = pattern[lawnIndex(ix, iz)] !== 0;   toneAt(ix, iz) = pattern[lawnIndex(ix, iz) + 1]

function fnv1a(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** mode 1..3 (LAWN_VARIANTS) -> { mode, name, tone, seamDark, seamHalf, pattern, fnv, studs, keep(ix, iz), toneAt(ix, iz) }. */
export function createLawn(mode) {
  const v = LAWN_VARIANTS[mode];
  if (!v) return null;
  const pattern = buildLawnPattern(v.studP);
  let studs = 0;
  for (let o = 0; o < pattern.length; o += 4) if (pattern[o]) studs++;
  return {
    mode, name: v.name, tone: v.tone, seamDark: v.seamDark, seamHalf: v.seamHalf, pattern, fnv: fnv1a(pattern), studs,
    keep: (ix, iz) => pattern[lawnIndex(ix, iz)] !== 0,
    toneAt: (ix, iz) => pattern[lawnIndex(ix, iz) + 1],
  };
}
