// brickify — turns a building's generated parts into Blox bricks. Pure functions: no THREE, no world access.
//
// Buildings have no brick list. The generator emits world-space boxes: a full-height body per section, an interior
// liner copy of it, and hundreds of small window frame / pane / lit-overlay boxes. So the bricks are synthesised
// from the parts' axis-aligned boxes:
//   - small parts (every side <= SMALL_MAX) become one loose box each, sized to the part; the frame / pane / overlay
//     stack of one window shares a centre and collapses to a single piece;
//   - large parts become a hollow shell of 2x4 bricks on the 0.8 m stud grid: 0.96 m courses, running bond, and the
//     top course tiled solid so a roof comes apart as a roof.
// Every brick keeps the colour of the part it came from and that part's index (`src`), so a caller can release a
// building one part at a time.

export const STUD = 0.8;
export const COURSE = 0.96;                 // one brick course (m)
export const BRICK_W = 2 * STUD;            // 2x4 brick: 1.6 m across ...
export const BRICK_L = 4 * STUD;            // ... 3.2 m long
const SMALL_MAX = 1.7;                      // parts no bigger than this on every side stay one piece
const MIN_DIM = 0.05;                       // decals / hairline parts are dropped
const MIN_PIECE = 0.3;                      // smallest drawn side of a loose piece
const DEDUPE = 0.3;                         // window layers within this of each other are one piece

/** Self-lit material keys (window glow overlays, beacons, signs): no brick is made for them. */
export const GLOW_KEYS = new Set(['winWarm', 'winCool', 'porchWarm', 'chimneyGlow', 'beacon', 'beaconBlue', 'signGlow', 'crossGlow']);
/** Transparent colours are drawn as an opaque neighbour (the brick pool has no transparency pass). */
export const OPAQUE_FOR = { transClear: 'lightStoneGrey', transBlue: 'mediumAzur', transYellow: 'brightYellow', transRed: 'brightRed' };

export function opaqueName(mat) {
  if (OPAQUE_FOR[mat]) return OPAQUE_FOR[mat];
  return typeof mat === 'string' && mat.startsWith('trans') ? 'lightStoneGrey' : mat;
}

function dims(p) { return [p.max[0] - p.min[0], p.max[1] - p.min[1], p.max[2] - p.min[2]]; }

export function partVolume(p) { const d = dims(p); return Math.max(0, d[0]) * Math.max(0, d[1]) * Math.max(0, d[2]); }

/** Does this part turn into bricks at all? (liners, glow overlays and hairline parts do not) */
export function isBrickable(p) {
  if (p.liner || GLOW_KEYS.has(p.mat)) return false;
  const d = dims(p);
  return d[0] >= MIN_DIM && d[1] >= MIN_DIM && d[2] >= MIN_DIM;
}

function isSmall(d) { return d[0] <= SMALL_MAX && d[1] <= SMALL_MAX && d[2] <= SMALL_MAX; }

/** Course rows of one large part: [{ y, h, top }]. A slab thinner than a course is a single plate row. */
function courseRows(p) {
  const sy = p.max[1] - p.min[1];
  const n = Math.max(1, Math.round(sy / COURSE));
  const h = sy / n;
  const rows = [];
  for (let c = 0; c < n; c++) rows.push({ c, y: p.min[1] + (c + 0.5) * h, h, top: c === n - 1 });
  return rows;
}

/** Brick slots of one course: a grid along the part's longer horizontal side, shell only unless `solid`. */
function courseSlots(p, row, solid, out, color, src) {
  const sx = p.max[0] - p.min[0], sz = p.max[2] - p.min[2];
  const alongX = sx >= sz;
  const L = alongX ? sx : sz, W = alongX ? sz : sx;
  const nl = Math.max(1, Math.round(L / BRICK_L)), nw = Math.max(1, Math.round(W / BRICK_W));
  const pl = L / nl, pw = W / nw;
  const l0 = alongX ? p.min[0] : p.min[2], w0 = alongX ? p.min[2] : p.min[0];
  // running bond: odd courses start half a brick in (the last brick of the row is pulled back inside the wall)
  const shift = (row.c & 1) && nl > 1 ? pl / 2 : 0;
  const plate = row.h < COURSE * 0.6 || pl < BRICK_L * 0.6 || pw < BRICK_W * 0.6;
  for (let a = 0; a < nl; a++) {
    for (let b = 0; b < nw; b++) {
      if (!solid && a > 0 && a < nl - 1 && b > 0 && b < nw - 1) continue;
      const l = Math.min(l0 + (a + 0.5) * pl + shift, l0 + L - pl / 2);
      const w = w0 + (b + 0.5) * pw;
      const x = alongX ? l : w, z = alongX ? w : l;
      if (plate) {
        // thin slabs and narrow walls keep their own proportions (a 2x4 brick would overhang them)
        out.push({ kind: 'box', x, y: row.y, z, sx: Math.max(MIN_PIECE, alongX ? pl : pw), sy: Math.max(MIN_PIECE, row.h), sz: Math.max(MIN_PIECE, alongX ? pw : pl), rotY: 0, color, src });
      } else {
        out.push({ kind: 'b2x4', x, y: row.y, z, sx: 1, sy: 1, sz: 1, rotY: alongX ? Math.PI / 2 : 0, color, src });
      }
    }
  }
}

function slotCount(p, solid) {
  const sx = p.max[0] - p.min[0], sz = p.max[2] - p.min[2];
  const L = Math.max(sx, sz), W = Math.min(sx, sz);
  const nl = Math.max(1, Math.round(L / BRICK_L)), nw = Math.max(1, Math.round(W / BRICK_W));
  if (solid || nl <= 2 || nw <= 2) return nl * nw;
  return nl * nw - (nl - 2) * (nw - 2);
}

/**
 * parts: [{ index, mat, min:[x,y,z], max:[x,y,z], liner }] (buildings.api.getParts().parts)
 * colorOf(name) -> [r,g,b]   rng: a seeded Rng (only used to pick which courses survive the budget)
 * Returns [{ kind:'b2x4'|'box', x, y, z, sx, sy, sz, rotY, color:[r,g,b], src }] in world space.
 *   b2x4: a 1.6 x 0.96 x 3.2 m brick (long side along z at rotY 0), sx/sy/sz are scale factors (1);
 *   box:  a loose piece, sx/sy/sz are its size in metres.
 */
export function brickify(parts, colorOf, rng, { maxBricks = 600 } = {}) {
  const small = [], large = [];
  for (const p of parts) {
    if (!isBrickable(p)) continue;
    (isSmall(dims(p)) ? small : large).push(p);
  }
  // one piece per window: the frame, pane and overlay boxes share a centre
  const seen = new Set();
  const pieces = [];
  for (const p of small) {
    const cx = (p.min[0] + p.max[0]) / 2, cy = (p.min[1] + p.max[1]) / 2, cz = (p.min[2] + p.max[2]) / 2;
    const key = `${Math.round(cx / DEDUPE)}:${Math.round(cy / DEDUPE)}:${Math.round(cz / DEDUPE)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pieces.push({ p, cx, cy, cz });
  }
  // budget: thin out courses (and loose pieces) evenly rather than cutting the building off at some height
  let est = pieces.length;
  const rowsOf = large.map((p) => courseRows(p));
  for (let k = 0; k < large.length; k++) for (const row of rowsOf[k]) est += slotCount(large[k], row.top && rowsOf[k].length > 1);
  const keep = est > maxBricks ? Math.ceil(est / maxBricks) : 1;
  const phase = keep > 1 ? rng.int(0, keep - 1) : 0;

  const out = [];
  for (let k = 0; k < large.length; k++) {
    const p = large[k];
    const color = colorOf(opaqueName(p.mat));
    const rows = rowsOf[k];
    for (const row of rows) {
      // the top course always survives (it is the roof), so does a part that is a single course
      if (keep > 1 && !row.top && (row.c + phase) % keep !== 0) continue;
      courseSlots(p, row, row.top && rows.length > 1, out, color, p.index);
    }
  }
  for (let k = 0; k < pieces.length; k++) {
    if (keep > 1 && (k + phase) % keep !== 0) continue;
    const { p, cx, cy, cz } = pieces[k];
    const d = dims(p);
    out.push({
      kind: 'box', x: cx, y: cy, z: cz,
      sx: Math.max(MIN_PIECE, d[0]), sy: Math.max(MIN_PIECE, d[1]), sz: Math.max(MIN_PIECE, d[2]),
      rotY: 0, color: colorOf(opaqueName(p.mat)), src: p.index,
    });
  }
  return out;
}

/**
 * Release order for progressive stripping: indices of every part but the liners, highest first (then smallest first),
 * leaving out the body: the largest part of the building and every other part that is both tall and wide enough
 * to be a wall section (those go when the building is destroyed).
 */
export function shedOrder(parts) {
  // glow overlays and hairline parts yield no brick but are released with the rest (a lit pane must not hang in
  // the air where its window used to be)
  const list = parts.filter((p) => !p.liner);
  if (!list.length) return [];
  let maxVol = 0;
  for (const p of list) maxVol = Math.max(maxVol, partVolume(p));
  return list
    .filter((p) => partVolume(p) < maxVol * 0.25 || isSmall(dims(p)))
    .sort((a, b) => (b.min[1] - a.min[1]) || (partVolume(a) - partVolume(b)) || (a.index - b.index))
    .map((p) => p.index);
}
