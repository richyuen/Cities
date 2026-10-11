import * as THREE from 'three';
import { PALETTE } from '../core/materials.js';
import {
  RESI_BODY, RESI_ROOF, RESI_TOWER_BODY, RESI_TOWER_ACCENT,
  COMM_BODY, COMM_ACCENT, COMM_GLASS, IND_BODY_A, IND_BODY_B, IND_ACCENT, pick,
} from './palette.js';

// Procedural Blox-style building generator. Produces a flat list of { mat, geom } pieces already positioned in
// WORLD space (geom.translate baked in) so the batching layer can bucket by material and merge without further
// transforms. Also returns roof-stud points (world space) and the computed overall height.
//
// Triangle budget target: ~1000-1500 tris/building average (level-1 houses far less, level-3 towers more), so
// 1500 buildings stays comfortably under the full-city 3M tri cap once other modules are accounted for.

function quant(v, step = 0.05) { return Math.round(v / step) * step; }

function box(ctx, parts, mat, w, h, d, x, y, z, bevel = 0.05) {
  w = Math.max(0.08, quant(w)); h = Math.max(0.08, quant(h)); d = Math.max(0.08, quant(d));
  const g = ctx.materials.bevelBox(w, h, d, bevel).clone();
  g.translate(x, y, z);
  parts.push({ mat, geom: g });
}

// bevelBox (RoundedBoxGeometry, segments=2) is ~300 tris regardless of size - fine for the handful of "hero"
// structural volumes per building (body, roof cap, pilasters...), ruinous for the dozens-to-hundreds of tiny
// window frame/pane/lit pieces a facade needs. Those use a plain 12-tri box instead; the bevel is imperceptible
// at that scale anyway. Non-indexed to match bevelBox for merge-bucket compatibility (see cylinder()).
// LOOP c6: a house now emits ~430 small boxes, so plainBox clones one cached unit box and scales its positions in
// place instead of building a BoxGeometry + toNonIndexed() per call. Same vertex order, normals and UVs, and the
// positions are bit-identical (±0.5·w == w/2 exactly), so every pre-existing building's geometry is unchanged.
let UNIT_BOX = null;
function unitBoxClone(w, h, d) {
  if (!UNIT_BOX) UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const g = UNIT_BOX.clone();
  const a = g.attributes.position.array;
  for (let i = 0; i < a.length; i += 3) { a[i] *= w; a[i + 1] *= h; a[i + 2] *= d; }
  return g;
}

function plainBox(parts, mat, w, h, d, x, y, z) {
  const g = unitBoxClone(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d));
  g.translate(x, y, z);
  parts.push({ mat, geom: g });
}

// RoundedBoxGeometry (bevelBox) is inherently non-indexed (it duplicates vertices per-face for correct rounded
// normals - see three/addons/geometries/RoundedBoxGeometry.js). CylinderGeometry/ConeGeometry ARE indexed by
// default, and BufferGeometryUtils.mergeGeometries refuses to merge a bucket that mixes indexed and
// non-indexed geometries. Since box() pieces and cylinder/cone pieces regularly share a matKey (e.g. a grey
// chimney next to grey window frames), normalize every non-box primitive to non-indexed too.
function cylinder(parts, mat, rTop, rBot, h, segs, x, y, z) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, segs).toNonIndexed();
  g.translate(x, y + h / 2, z);
  parts.push({ mat, geom: g });
}

// Cheap interior-facing liner: a smaller, inward-winding duplicate of a solid body box. Buildings are single
// solid volumes (not hollow shells), so a camera that ends up inside one (reachable in normal play - see
// docs/core-requests/buildings.md) sees every exterior face as a culled backface, i.e. sky/terrain through the
// window gaps. This liner sits just inside the real wall (small margin, no coplanar z-fight) with reversed
// winding + flipped normals so ITS front face is the one visible from inside, giving a solid-looking interior
// instead. It reuses the exact same material key as the outer wall it's lining, so it merges into the same
// per-chunk-per-colour draw-call bucket at zero extra draw calls - only ~12 extra triangles per shell.
//
// `baseLift` raises the liner's base above the section's own base plane. Needed on an upper tower section:
// the liner's flipped (up-facing) bottom face would otherwise be exactly coplanar with the lower section's
// exposed top face - a z-fighting seam right across the setback terrace.
function interiorLiner(parts, mat, w, h, d, x, y, z, baseLift = 0) {
  const marginXZ = 0.14, marginTop = 0.22;
  const lw = Math.max(0.2, w - marginXZ * 2);
  const ld = Math.max(0.2, d - marginXZ * 2);
  const lh = Math.max(0.2, h - marginTop - baseLift);
  const g = new THREE.BoxGeometry(lw, lh, ld).toNonIndexed();
  const pos = g.attributes.position, norm = g.attributes.normal;
  for (let i = 0; i < pos.count; i += 3) {
    for (const attr of [pos, norm]) {
      const bx = attr.getX(i + 1), by = attr.getY(i + 1), bz = attr.getZ(i + 1);
      attr.setXYZ(i + 1, attr.getX(i + 2), attr.getY(i + 2), attr.getZ(i + 2));
      attr.setXYZ(i + 2, bx, by, bz);
    }
  }
  for (let i = 0; i < norm.count; i++) norm.setXYZ(i, -norm.getX(i), -norm.getY(i), -norm.getZ(i));
  g.translate(x, y + baseLift + lh / 2, z); // base at y + baseLift
  parts.push({ mat, geom: g, liner: true }); // tagged so effects that take a building apart can skip it
}

/** One facade band of windows. axis: 'x' or 'z' is the OUTWARD normal axis; sign: +1 or -1. */
function facade(ctx, parts, rng, cx, cz, groundY, o) {
  const { axis, sign, halfW, halfD, floors, pitch, frameMat, glassMat, litFrac, warmFrac,
    marginFrac = 0.78, minCols = 1, winWFrac = 0.62, winHFrac = 0.58, wide = false, frameBezel = 0.16 } = o;
  const normalOffset = axis === 'x' ? halfW : halfD;
  const tangentHalf = axis === 'x' ? halfD : halfW;
  const { span, cols, colPitch } = columnLayout(tangentHalf, pitch, marginFrac, minCols);
  // Every layer (wall face -> frame -> pane -> lit overlay) sits proud of the wall by a strictly increasing,
  // non-touching amount. Two coplanar quads z-fight (flicker unpredictably depending on which triangle's depth
  // wins), which is what made most window bands invisible before this was fixed: the old recessed offsets put
  // the pane's outer face exactly flush with the wall's outer face. frame spans [0, 0.10] past the wall (its
  // inner face touching the wall is a non-issue - that face points into the wall and is never the one culled
  // toward the camera); pane spans [0.11, 0.14]; lit overlay spans [0.145, 0.165]. Must match the normal-axis
  // half-thicknesses (fdW/fdD, gW/gD, lW/lD) used when building each box a few lines down.
  const frameOut = sign * (normalOffset + 0.05);
  const paneOut = sign * (normalOffset + 0.125);
  const litOut = sign * (normalOffset + 0.155);
  for (const f of floors) {
    if (f.blind) continue;
    const winH = f.h * winHFrac;
    const y0 = groundY + f.y0 + f.h * (1 - winHFrac) * 0.5;
    const winW = wide ? colPitch * 0.9 : colPitch * winWFrac;
    const frameW = winW + frameBezel;
    for (let c = 0; c < cols; c++) {
      const t = -span / 2 + colPitch * (c + 0.5);
      let fx, fz, gx, gz, lx, lz;
      if (axis === 'x') { fx = cx + frameOut; fz = cz + t; gx = cx + paneOut; gz = cz + t; lx = cx + litOut; lz = cz + t; }
      else { fx = cx + t; fz = cz + frameOut; gx = cx + t; gz = cz + paneOut; lx = cx + t; lz = cz + litOut; }
      const fdW = axis === 'x' ? 0.1 : frameW;
      const fdD = axis === 'x' ? frameW : 0.1;
      plainBox(parts, frameMat, fdW, winH + 0.14, fdD, fx, y0 + winH / 2, fz);
      const gW = axis === 'x' ? 0.03 : winW;
      const gD = axis === 'x' ? winW : 0.03;
      plainBox(parts, glassMat, gW, winH * 0.86, gD, gx, y0 + winH / 2, gz);
      if (rng.chance(litFrac)) {
        const warm = rng.chance(warmFrac);
        const lW = axis === 'x' ? 0.02 : winW * 0.72;
        const lD = axis === 'x' ? winW * 0.72 : 0.02;
        plainBox(parts, warm ? 'winWarm' : 'winCool', lW, winH * 0.68, lD, lx, y0 + winH / 2, lz);
      }
    }
  }
}

function allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors, opts) {
  facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: 1, halfW, halfD, floors, ...opts });
  facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: -1, halfW, halfD, floors, ...opts });
  facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: 1, halfW, halfD, floors, ...opts });
  facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: -1, halfW, halfD, floors, ...opts });
}

// ---------------------------------------------------------------------------------------------
// Blox construction helpers. Every exposed horizontal surface gets studs on the world stud grid (0.8 m pitch,
// 0.4 m inset from edges, matching the terrain/roads stud fields so all three line up). Walls get proud course
// and floor bands plus alternating corner bricks so a facade reads as stacked elements, not one flat slab.
//
// Band relief (0.055 m proud for a course, 0.11 m for a floor slab) stays below a window frame's own 0.10 m
// relief, so bands run *behind* the window elements and read as courses interrupted by windows instead of bars
// painted across the glass. Bands are embedded 0.02 m into the wall so no faces are ever coplanar.

const STUD_PITCH = 0.8;
const STUD_INSET = 0.4;
const BAND_EMBED = 0.02;

/** Studs over an axis-aligned world-space rect (centred on cx/cz) on the world stud grid. */
function studGrid(out, cx, cz, halfW, halfD, y, color, { inset = STUD_INSET, max = 900, align = 'world' } = {}) {
  const x0 = cx - halfW + inset, x1 = cx + halfW - inset;
  const z0 = cz - halfD + inset, z1 = cz + halfD - inset;
  if (x1 < x0 - 1e-4 || z1 < z0 - 1e-4) return out;
  const stop = out.length + max; // `max` is per call, not for the whole shared list
  const sx = align === 'center' ? x0 : Math.ceil(x0 / STUD_PITCH) * STUD_PITCH;
  const sz = align === 'center' ? z0 : Math.ceil(z0 / STUD_PITCH) * STUD_PITCH;
  for (let z = sz; z <= z1 + 1e-4; z += STUD_PITCH) {
    for (let x = sx; x <= x1 + 1e-4; x += STUD_PITCH) {
      out.push({ x, y, z, color });
      if (out.length >= stop) return out;
    }
  }
  return out;
}

/** Studs evenly spaced along a rectangle's perimeter (parapet tops, exposed step/setback ledges). A perimeter
 * walk can never place two studs closer than the pitch, which fixed-size rows around a corner can. */
function studPerimeter(out, cx, cz, halfW, halfD, y, color, { pitch = STUD_PITCH, max = 240 } = {}) {
  const w = halfW * 2, d = halfD * 2;
  const perim = 2 * (w + d);
  if (perim < pitch * 2) return out;
  const n = Math.max(4, Math.round(perim / pitch));
  const step = perim / n;
  const pts = [[cx - halfW, cz - halfD], [cx + halfW, cz - halfD], [cx + halfW, cz + halfD], [cx - halfW, cz + halfD]];
  const start = out.length;
  let dist = step * 0.5;
  for (let k = 0; k < n && out.length - start < max; k++, dist += step) {
    let t = dist, s = 0;
    while (s < 4) {
      const a = pts[s], b = pts[(s + 1) % 4];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (t <= L) {
        const f = L > 0 ? t / L : 0;
        out.push({ x: a[0] + (b[0] - a[0]) * f, y, z: a[1] + (b[1] - a[1]) * f, color });
        break;
      }
      t -= L; s++;
    }
  }
  return out;
}

/** One proud band per course line on all four walls. */
function courseBands(parts, mat, cx, cz, halfW, halfD, y0, y1, { pitch = 1.2, proud = 0.07, bandH = 0.12 } = {}) {
  const w = proud + BAND_EMBED;
  for (let y = y0 + pitch; y < y1 - 0.2; y += pitch) {
    const cy = y + bandH / 2;
    plainBox(parts, mat, w, bandH, (halfD + proud) * 2, cx + halfW + (proud - BAND_EMBED) / 2, cy, cz);
    plainBox(parts, mat, w, bandH, (halfD + proud) * 2, cx - halfW - (proud - BAND_EMBED) / 2, cy, cz);
    plainBox(parts, mat, (halfW + proud) * 2, bandH, w, cx, cy, cz + halfD + (proud - BAND_EMBED) / 2);
    plainBox(parts, mat, (halfW + proud) * 2, bandH, w, cx, cy, cz - halfD - (proud - BAND_EMBED) / 2);
  }
}

/** A stronger floor-slab band at every storey line (reads as a plate between stacked brick floors). */
function floorBands(parts, mat, cx, cz, halfW, halfD, floors, groundY, { proud = 0.11, bandH = 0.18 } = {}) {
  const w = proud + BAND_EMBED;
  for (const f of floors) {
    if (f.y0 <= 0.01) continue;
    const cy = groundY + f.y0 + bandH / 2;
    plainBox(parts, mat, w, bandH, (halfD + proud) * 2, cx + halfW + (proud - BAND_EMBED) / 2, cy, cz);
    plainBox(parts, mat, w, bandH, (halfD + proud) * 2, cx - halfW - (proud - BAND_EMBED) / 2, cy, cz);
    plainBox(parts, mat, (halfW + proud) * 2, bandH, w, cx, cy, cz + halfD + (proud - BAND_EMBED) / 2);
    plainBox(parts, mat, (halfW + proud) * 2, bandH, w, cx, cy, cz - halfD - (proud - BAND_EMBED) / 2);
  }
}

/** Alternating corner bricks: each course protrudes along X or Z, giving the classic running-bond corner.
 *  Two coincident-plane traps fixed for cycle 3: the last course stops 3 cm short of `y1` (its top face used
 *  to land exactly in the wall's top plane, z-fighting on every exposed ledge / roofline), and the brick is
 *  pulled 2 cm inside the wall on its non-protruding axis (its end face used to be flush with the wall face,
 *  which speckled at grazing angles — see the cycle-3 report). */
function cornerBricks(parts, mat, cx, cz, halfW, halfD, y0, y1, { pitch = 1.2, len = 1.0, thick = 0.55, proud = 0.07 } = {}) {
  let k = 0;
  for (let y = y0; y < y1 - 0.3; y += pitch, k++) {
    const h = Math.min(pitch * 0.92, y1 - y - 0.03);
    if (h < 0.25) break;
    const cy = y + h / 2;
    const alongX = k % 2 === 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = alongX ? len : thick;
        const d = alongX ? thick : len;
        const x = cx + sx * (halfW + (alongX ? proud - len / 2 : -thick / 2 - 0.02));
        const z = cz + sz * (halfD + (alongX ? -thick / 2 - 0.02 : proud - len / 2));
        plainBox(parts, mat, w, h, d, x, cy, z);
      }
    }
  }
}

/** Flat roof: proud cap plate, brick parapet ring with a stud row on top, and a studded deck inside. */
function flatRoof(ctx, parts, studs, mat, cx, cz, halfW, halfD, y, opts = {}) {
  const { capH = 0.3, over = 0.03, parapetH = 0.35, parapetT = 0.36, out = null } = opts;
  const capHalfW = halfW + over, capHalfD = halfD + over;
  box(ctx, parts, mat, capHalfW * 2, capH, capHalfD * 2, cx, y, cz, 0.03);
  const capTop = y + capH;
  if (parapetH > 0) {
    const o = parapetT / 2;
    plainBox(parts, mat, capHalfW * 2, parapetH, parapetT, cx, capTop + parapetH / 2, cz + capHalfD - o);
    plainBox(parts, mat, capHalfW * 2, parapetH, parapetT, cx, capTop + parapetH / 2, cz - capHalfD + o);
    plainBox(parts, mat, parapetT, parapetH, (capHalfD - parapetT) * 2, cx + capHalfW - o, capTop + parapetH / 2, cz);
    plainBox(parts, mat, parapetT, parapetH, (capHalfD - parapetT) * 2, cx - capHalfW + o, capTop + parapetH / 2, cz);
    const pTop = capTop + parapetH;
    // One even perimeter walk around the parapet centreline (never two studs within the 0.8 m pitch).
    studPerimeter(studs, cx, cz, capHalfW - parapetT / 2, capHalfD - parapetT / 2, pTop, mat, { max: 240 });
    // Deck studs start 0.4 m in from the parapet's inner face (the grid's own inset does that), not another
    // full stud inset on top of it.
    const innerW = Math.max(0, capHalfW - parapetT);
    const innerD = Math.max(0, capHalfD - parapetT);
    if (innerW > 0.1 && innerD > 0.1) studGrid(studs, cx, cz, innerW, innerD, capTop, mat);
  } else {
    studGrid(studs, cx, cz, capHalfW, capHalfD, capTop, mat);
  }
  if (out) {
    out.deckY = capTop;
    out.topY = capTop + parapetH;
    out.capHalfW = capHalfW; out.capHalfD = capHalfD;
    out.parapetH = parapetH; out.parapetT = parapetT;
    out.innerHalfW = Math.max(0, capHalfW - parapetT);
    out.innerHalfD = Math.max(0, capHalfD - parapetT);
  }
  return capTop + parapetH;
}

/** Squared brick chimney/vent stack: courses alternate orientation, one stud on the cap. */
function brickStack(ctx, parts, studs, mat, x, z, w, d, baseY, h, { studTop = true } = {}) {
  const courses = Math.max(2, Math.round(h / 0.45));
  const ch = h / courses;
  for (let k = 0; k < courses; k++) {
    const swap = k % 2 === 1;
    box(ctx, parts, mat, swap ? d : w, ch, swap ? w : d, x, baseY + k * ch, z, 0.03);
  }
  if (studTop) studs.push({ x, y: baseY + h, z, color: mat });
}

/** One-plate plinth around the base of a building (reads as a baseplate edge, never covers doors/storefronts). */
function plinth(ctx, parts, mat, cx, cz, halfW, halfD, groundY, h = 0.35, proud = 0.08) {
  box(ctx, parts, mat, (halfW + proud) * 2, h, (halfD + proud) * 2, cx, groundY, cz, 0.03);
}

function floorList(count, groundH, upperH) {
  const floors = [];
  let y = 0;
  for (let i = 0; i < count; i++) { const h = i === 0 ? groundH : upperH; floors.push({ y0: y, h }); y += h; }
  return { floors, top: y };
}

// ---------------------------------------------------------------------------------------------
// Cycle-3 facade / silhouette variety layer.
//
// All of it is additive and drawn from the per-building rng (`S.rng.fork(seed:id)`), so the same seed
// always produces the same geometry. The generators call these helpers AFTER their existing construction,
// which keeps every pre-existing rng draw at the same position in the stream (the base massing does not
// shift); only the new layers depend on the new draws.
//
// Facade layer offsets are strictly increasing per face and every new plate is embedded into the wall by
// (thickness - proud), so no two visible faces are coplanar and nothing z-fights:
//   window bands (pre-existing facade()): frame 0.10 < pane 0.125 < lit 0.155
//   shopfront bay: sill 0.06 < liner 0.055* < glass 0.075 < lit 0.09 < mullion 0.095 < ring 0.11
//     (* liner sits inside the ring's opening, its own face at 0.055)
//   door: leaf 0.05 < leaf glazing 0.085 < jambs/header 0.115, stoop slab 0.01..0.63
//   awning: tilted bevel slab, wall edge 0.03 -> outer edge 0.93, valance 0.87..0.93
//   sign: board 0.02..0.12, signGlow stripe 0.125..0.155
//   roof clutter / crown: every box sits on the deck plane or on another box's top (no shared solids).

const TRIM_COLORS = ['white', 'lightStoneGrey', 'darkStoneGrey', 'tan'];
const AWNING_COLORS = ['brightRed', 'brightYellow', 'brightOrange', 'lime', 'brightPink', 'mediumLilac', 'brightBlue', 'sandGreen'];
const CROWN_STYLES = ['parapet', 'setback', 'mast', 'pylons', 'pyramid', 'mast'];
const TOWER_CLUTTER = ['ac', 'vent', 'bulkhead', 'tank', 'mast'];
const LOW_CLUTTER = ['ac', 'vent', 'bulkhead', 'tank'];
const BALCONY_RAILS = ['darkStoneGrey', 'white', 'lightStoneGrey', 'black'];
const FACE_LIST = [
  { key: 'x+', axis: 'x', sign: 1 },
  { key: 'x-', axis: 'x', sign: -1 },
  { key: 'z+', axis: 'z', sign: 1 },
  { key: 'z-', axis: 'z', sign: -1 },
];

/** Perceived luminance of a palette colour (0..1) — used to keep frames/trim in contrast with the wall. */
function paletteLum(name) {
  const hex = PALETTE[name];
  if (!hex) return 0.5;
  const n = parseInt(hex.slice(1), 16);
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
}

/** Seeded frame/mullion colour: a real palette colour (white / lightStoneGrey / tan / darkStoneGrey /
 *  black), filtered so it always contrasts the wall it sits on — the old fixed black/darkStoneGrey split
 *  could not vary without washing a window band out. */
function pickFrame(rng, body) {
  const lb = paletteLum(body);
  const cands = ['white', 'lightStoneGrey', 'tan', 'darkStoneGrey', 'black'].filter((c) => Math.abs(paletteLum(c) - lb) > 0.2);
  return cands.length ? rng.pick(cands) : 'darkStoneGrey';
}

/** Which of the four faces look onto a road (used to bias shopfronts toward street fronts). Scans out to
 *  two cells: the carriageway marking covers only the road's own cells, so a building one cell back from
 *  the carriageway (the standard showcase/bookmark layout) still reads as street-facing. */
function roadFaces(ctx, b) {
  const w = ctx.world;
  const isRoad = (i, j) => { const c = w.cellAt(i, j); return !!c && c.type === 'road'; };
  const scan = (di, dj) => {
    const span = di ? b.d : b.w;
    for (let k = 0; k < span; k++) {
      for (let d = 1; d <= 2; d++) {
        const i = di ? b.i + (di > 0 ? b.w + d - 1 : -d) : b.i + k;
        const j = dj ? b.j + (dj > 0 ? b.d + d - 1 : -d) : b.j + k;
        if (isRoad(i, j)) return true;
      }
    }
    return false;
  };
  const res = { 'x+': scan(1, 0), 'x-': scan(-1, 0), 'z+': scan(0, 1), 'z-': scan(0, -1) };
  res.any = res['x+'] || res['x-'] || res['z+'] || res['z-'];
  return res;
}

function faceAxes(face, halfW, halfD) {
  return face.axis === 'x' ? { norm: halfW, tan: halfD } : { norm: halfD, tan: halfW };
}

/** World-space centre for a point on a face: `off` along the outward normal from the building centre,
 *  `t` along the tangent from the building centre. */
function faceCentre(face, cx, cz, off, t) {
  return face.axis === 'x' ? { x: cx + face.sign * off, z: cz + t } : { x: cx + t, z: cz + face.sign * off };
}

/** Flat plate on a face. `off` = normal distance of the box centre; w = tangential size, d = normal
 *  thickness, y = absolute centre height. */
function faceBoxAt(parts, mat, face, cx, cz, { off, t = 0, y, w, h, d }) {
  const p = faceCentre(face, cx, cz, off, t);
  const bw = face.axis === 'x' ? d : w;
  const bd = face.axis === 'x' ? w : d;
  plainBox(parts, mat, bw, h, bd, p.x, y, p.z);
}

/** Plate proud of a face: `proud` = distance from the wall plane to the plate's OUTER face, `t` = plate
 *  thickness. Outer faces are the strictly-increasing layer offsets (see the block comment). */
function facePlate(parts, mat, face, cx, cz, norm, w, h, proud, y, tOff = 0, t = 0.1) {
  faceBoxAt(parts, mat, face, cx, cz, { off: norm + proud - t / 2, t: tOff, y, w, h, d: t });
}

/** Beveled slab on a face (awnings, stoops, balcony slabs), optionally tilted about the face tangent so
 *  its outer edge drops. `w` is always the TANGENT size and `d` the normal thickness — the box dims are
 *  swapped for `axis === 'x'` exactly like faceBoxAt (a missing swap pointed every x-face awning/balcony
 *  slab out of the wall; see the cycle-3 fix round). `off` is the centre distance along the normal. */
function faceSlab(parts, ctx, mat, face, cx, cz, { off, t = 0, y, w, h, d, tilt = 0 }) {
  const bw = Math.max(0.08, quant(face.axis === 'x' ? d : w));
  const bd = Math.max(0.08, quant(face.axis === 'x' ? w : d));
  const g = ctx.materials.bevelBox(bw, Math.max(0.08, quant(h)), bd, 0.03).clone();
  g.translate(0, -h / 2, 0); // bevelBox sits on y=0; centre it so the tilt reads as a hinged awning
  if (tilt > 0) {
    if (face.axis === 'x') g.rotateZ(-face.sign * tilt);
    else g.rotateX(face.sign * tilt);
  }
  const p = faceCentre(face, cx, cz, off, t);
  g.translate(p.x, y, p.z);
  parts.push({ mat, geom: g });
}

/** Column layout used by facade() and the pier strips so both agree on where the gaps between columns are. */
function columnLayout(tanHalf, pitch, marginFrac, minCols) {
  const span = tanHalf * 2 * marginFrac;
  const cols = Math.max(minCols, Math.round(span / pitch));
  return { span, cols, colPitch: span / cols };
}

/** Shopfront band on one face: wide glazed bays (transBlue/transClear) or a recessed door, a canvas
 *  awning over a seeded run of bays and a sign block with a subtle signGlow stripe. Returns false (and
 *  draws nothing) on a face too narrow to hold bays — the caller falls back to the plain ground floor. */
function shopfrontFace(ctx, parts, face, rng, o) {
  const { cx, cz, groundY, halfW, halfD, floorH, frameMat, trimMat } = o;
  const { norm, tan } = faceAxes(face, halfW, halfD);
  const span = tan * 2 * 0.88;
  if (span < 2.4) return false;
  const bays = Math.max(2, Math.round(span / rng.range(2.6, 3.4)));
  const pitch = span / bays;
  const bayW = Math.min(pitch - 0.24, 2.7);
  // glazing height leaves room for the sill below, the frame head above, the awning and the sign board
  // under the floor band: floorH - 1.75 is the largest value that keeps the awning clear of the sign on
  // every ground floor the generator builds (3.2 m apartments through 4.4 m office towers).
  const glassH = Math.max(1.2, floorH - 1.75);
  const glassMat = rng.chance(0.62) ? 'transBlue' : 'transClear';
  const plate = (mat, w, h, proud, y, tOff = 0, t = 0.1) => facePlate(parts, mat, face, cx, cz, norm, w, h, proud, y, tOff, t);

  // one shop bay per column: a stone sill, a frame ring with the glazing inside it and a dark liner
  // behind the glass, or a full-height recessed door with a stoop. Offsets per bay:
  // liner 0.055 < glass 0.075 < lit 0.09 < mullion 0.095 < ring 0.11 (strictly increasing).
  const doorBay = rng.chance(0.8) ? rng.int(0, bays - 1) : -1;
  const gb = groundY + 0.72;
  for (let c = 0; c < bays; c++) {
    const tc = -span / 2 + pitch * (c + 0.5);
    if (c === doorBay) {
      const dw = Math.min(1.3, bayW - 0.2), dh = 2.35;
      const dY = groundY + 0.36; // leaf sits on the body plinth (0.35) so the wall never covers its foot
      faceSlab(parts, ctx, 'lightStoneGrey', face, cx, cz, { off: norm + 0.32, t: tc, y: groundY + 0.09, w: dw + 0.7, h: 0.16, d: 0.62 });
      plate('darkStoneGrey', dw, dh, 0.05, dY + dh / 2, tc, 0.06);
      plate(glassMat, dw - 0.46, 0.72, 0.085, dY + 1.2, tc, 0.03);
      plate(frameMat, 0.26, dh + 0.34, 0.115, dY + (dh + 0.34) / 2 - 0.02, tc - dw / 2 - 0.13, 0.12);
      plate(frameMat, 0.26, dh + 0.34, 0.115, dY + (dh + 0.34) / 2 - 0.02, tc + dw / 2 + 0.13, 0.12);
      plate(frameMat, dw + 0.52, 0.26, 0.115, dY + dh + 0.17, tc, 0.12);
    } else {
      const openW = bayW;
      plate('darkStoneGrey', openW + 0.2, 0.4, 0.06, groundY + 0.55, tc, 0.12);
      plate(frameMat, 0.2, glassH + 0.34, 0.11, gb + glassH / 2, tc - openW / 2 - 0.1, 0.12);
      plate(frameMat, 0.2, glassH + 0.34, 0.11, gb + glassH / 2, tc + openW / 2 + 0.1, 0.12);
      plate(frameMat, openW + 0.4, 0.2, 0.11, gb + glassH + 0.07, tc, 0.12);
      plate('darkStoneGrey', openW, glassH, 0.055, gb + glassH / 2, tc, 0.04);
      plate(glassMat, openW - 0.03, glassH - 0.03, 0.075, gb + glassH / 2, tc, 0.03);
      if (rng.chance(0.45)) plate(rng.chance(0.5) ? 'winWarm' : 'winCool', openW * 0.7, glassH * 0.5, 0.09, gb + glassH * 0.52, tc, 0.02);
      plate(frameMat, 0.09, glassH * 0.9, 0.095, gb + glassH / 2, tc, 0.03);
    }
  }
  // canvas awning over a seeded run of bays (bright palette, beveled slab + valance skirt)
  const runLen = Math.min(bays, rng.int(1, 3));
  const runStart = rng.int(0, Math.max(0, bays - runLen));
  const awnMat = rng.pick(AWNING_COLORS);
  const awnW = pitch * runLen - 0.24;
  const awnT = -span / 2 + pitch * (runStart + runLen / 2);
  const wallY = gb + glassH + 0.24;
  faceSlab(parts, ctx, awnMat, face, cx, cz, { off: norm + 0.46, t: awnT, y: wallY - 0.15, w: awnW, h: 0.13, d: 0.92, tilt: 0.34 });
  plate(awnMat, awnW, 0.26, 0.9, wallY - 0.44, awnT, 0.06);
  // sign block with a subtle signGlow stripe, tucked under the floor band
  const signW = Math.min(span * 0.6, 3.2);
  const signY = groundY + floorH - 0.45;
  plate(trimMat, signW, 0.6, 0.12, signY, 0, 0.1);
  plate('signGlow', signW * 0.78, 0.2, 0.155, signY, 0, 0.03);
  return true;
}

/** Balconies on a seeded subset of a face's upper floors: a proud bevel slab with a studded top and a
 *  4-post railing. The slab sits *below* the storey line and the railing stays under the window panes'
 *  bottom edge, so no balcony ever covers a door or a pane. Returns how many were placed. */
function balconyFace(ctx, parts, studs, rng, face, o) {
  const { cx, cz, groundY, halfW, halfD, floors, firstFloor = 1, chance = 0.5, slabMat = 'lightStoneGrey' } = o;
  const { norm, tan } = faceAxes(face, halfW, halfD);
  if (tan < 1.8) return 0;
  const slabW = Math.min(tan * 2 * 0.5, 3.6);
  const depth = 0.82, railH = 0.45;
  const railMat = rng.pick(BALCONY_RAILS);
  let n = 0;
  for (let i = firstFloor; i < floors.length; i++) {
    if (!rng.chance(chance)) continue;
    n++;
    const y0 = groundY + floors[i].y0;
    faceSlab(parts, ctx, slabMat, face, cx, cz, { off: norm + depth / 2, y: y0 - 0.1, w: slabW, h: 0.16, d: depth });
    const p = faceCentre(face, cx, cz, norm + depth / 2, 0);
    studGrid(studs, p.x, p.z, face.axis === 'x' ? depth / 2 - 0.05 : slabW / 2 - 0.05, face.axis === 'x' ? slabW / 2 - 0.05 : depth / 2 - 0.05,
      y0 - 0.02, slabMat, { inset: 0.28, align: 'center', max: 8 });
    const postOff = norm + depth - 0.06;
    for (const t of [-slabW / 2 + 0.07, -slabW / 6, slabW / 6, slabW / 2 - 0.07]) {
      faceBoxAt(parts, railMat, face, cx, cz, { off: postOff, t, y: y0 - 0.02 + railH / 2, w: 0.09, h: railH, d: 0.09 });
    }
    faceBoxAt(parts, railMat, face, cx, cz, { off: postOff, t: 0, y: y0 - 0.02 + railH, w: slabW, h: 0.1, d: 0.1 });
    for (const s of [-1, 1]) {
      faceBoxAt(parts, railMat, face, cx, cz, { off: norm + depth / 2, t: s * (slabW / 2 - 0.06), y: y0 - 0.02 + railH, w: 0.09, h: 0.09, d: depth - 0.14 });
    }
  }
  return n;
}

/** Vertical pier strips between the window columns of a face (runs behind the window frames at 0.06
 *  proud, so it reads as a pilaster rhythm without ever touching a pane). */
function pierStrips(parts, mat, face, cx, cz, halfW, halfD, y0, y1, o = {}) {
  const { pitch = 1.5, marginFrac = 0.8, minCols = 1, width = 0.3, proud = 0.06 } = o;
  const { norm, tan } = faceAxes(face, halfW, halfD);
  const { span, cols, colPitch } = columnLayout(tan, pitch, marginFrac, minCols);
  const h = y1 - y0;
  if (h < 1.2 || span < 2.4 || cols < 2) return;
  for (let c = 1; c < cols; c++) {
    faceBoxAt(parts, mat, face, cx, cz, { off: norm + proud - 0.06, t: -span / 2 + colPitch * c, y: (y0 + y1) / 2, w: width, h, d: 0.12 });
  }
}

/** Vertical quoin strips down the two edges of a face (call on all four faces for a full corner). */
function quoinStrips(parts, mat, face, cx, cz, halfW, halfD, y0, y1, o = {}) {
  const { width = 0.46, proud = 0.06 } = o;
  const { norm, tan } = faceAxes(face, halfW, halfD);
  const h = y1 - y0;
  if (h < 1) return;
  for (const s of [-1, 1]) {
    faceBoxAt(parts, mat, face, cx, cz, { off: norm + proud - 0.06, t: s * (tan - width / 2 - 0.02), y: (y0 + y1) / 2, w: width, h, d: 0.12 });
  }
}

/** Rooftop clutter: 0-`maxItems` seeded pieces (AC/plant boxes, vent stacks, stair bulkheads, water
 *  tanks, antenna masts) placed inside the parapet, each with studs on its top. Positions avoid the
 *  caller's existing rooftop equipment (`avoid`) and each other, so nothing interpenetrates. Returns
 *  how many masts (beacon-carrying antennae) were placed. */
function roofClutter(ctx, parts, studs, rng, o) {
  const { cx, cz, deckY, halfW, halfD, menu = LOW_CLUTTER, maxItems = 4, avoid = [] } = o;
  if (halfW < 1.3 || halfD < 1.3) return { placed: 0, masts: 0 };
  const n = Math.min(maxItems, rng.int(0, maxItems));
  const placed = [];
  let masts = 0;
  for (let k = 0; k < n; k++) {
    const kind = rng.pick(menu);
    let hw, hd, h, mat;
    if (kind === 'ac') { hw = rng.range(0.42, 0.72); hd = rng.range(0.38, 0.6); h = rng.range(0.5, 0.85); mat = rng.pick(['lightStoneGrey', 'mediumStoneGrey', 'white']); }
    else if (kind === 'vent') { hw = rng.range(0.28, 0.4); hd = rng.range(0.24, 0.34); h = rng.range(0.8, 1.6); mat = rng.pick(['darkStoneGrey', 'mediumStoneGrey']); }
    else if (kind === 'tank') { hw = rng.range(0.36, 0.55); hd = hw; h = rng.range(0.85, 1.3); mat = rng.pick(['lightStoneGrey', 'mediumStoneGrey', 'white']); }
    else if (kind === 'bulkhead') { hw = rng.range(0.62, 0.85); hd = rng.range(0.5, 0.72); h = rng.range(1.15, 1.6); mat = rng.pick(['lightStoneGrey', 'white', 'tan']); }
    else { hw = 0.22; hd = 0.22; h = rng.range(2.4, 4.2); mat = 'lightStoneGrey'; }
    const r = Math.max(hw, hd) + 0.18;
    let px = 0, pz = 0, ok = false;
    const blocks = (list) => list.some((q) => Math.abs(px - q.x) < hw + q.r + 0.1 && Math.abs(pz - q.z) < hd + q.r + 0.1);
    for (let a = 0; a < 5 && !ok; a++) {
      px = cx + rng.range(-1, 1) * Math.max(0.1, halfW - hw - 0.2);
      pz = cz + rng.range(-1, 1) * Math.max(0.1, halfD - hd - 0.2);
      ok = !blocks(avoid) && !blocks(placed);
    }
    if (!ok) continue;
    placed.push({ x: px, z: pz, r });
    if (kind === 'ac') {
      box(ctx, parts, mat, hw * 2, h, hd * 2, px, deckY, pz, 0.03);
      plainBox(parts, 'mediumStoneGrey', hw * 2 + 0.08, 0.07, hd * 2 + 0.08, px, deckY + h + 0.035, pz);
      studGrid(studs, px, pz, hw - 0.14, hd - 0.14, deckY + h + 0.07, mat, { inset: 0.1, align: 'center', max: 4 });
    } else if (kind === 'vent') {
      brickStack(ctx, parts, studs, mat, px, pz, hw * 2, hd * 2, deckY, h);
    } else if (kind === 'tank') {
      cylinder(parts, mat, hw * 0.9, hw, h, 10, px, deckY, pz);
      plainBox(parts, mat, hw * 2.15, 0.12, hd * 2.15, px, deckY + h + 0.06, pz);
      for (const ox of [-hw * 0.55, hw * 0.55]) for (const oz of [-hd * 0.55, hd * 0.55]) studs.push({ x: px + ox, y: deckY + h + 0.12, z: pz + oz, color: mat });
    } else if (kind === 'bulkhead') {
      box(ctx, parts, mat, hw * 2, h, hd * 2, px, deckY, pz, 0.04);
      plainBox(parts, mat, hw * 2 + 0.1, 0.12, hd * 2 + 0.1, px, deckY + h + 0.06, pz);
      plainBox(parts, 'darkStoneGrey', 0.55, 0.95, 0.06, px, deckY + 0.5, pz + hd + 0.02);
      studGrid(studs, px, pz, hw + 0.05, hd + 0.05, deckY + h + 0.12, mat, { inset: 0.2, align: 'center', max: 6 });
    } else {
      plainBox(parts, mat, 0.62, 0.14, 0.62, px, deckY + 0.07, pz);
      cylinder(parts, mat, 0.05, 0.07, h, 6, px, deckY + 0.14, pz);
      plainBox(parts, 'beacon', 0.24, 0.24, 0.24, px, deckY + 0.14 + h + 0.12, pz);
      for (const ox of [-0.18, 0.18]) for (const oz of [-0.18, 0.18]) studs.push({ x: px + ox, y: deckY + 0.14, z: pz + oz, color: mat });
      masts++;
    }
  }
  return { placed: placed.length, masts };
}

/** Tower crown: a per-seed silhouette cap above the parapet — flat coping / stepped setback mass /
 *  central antenna mast with beacon / four corner pylons / small pyramid. Returns the style, whether it
 *  carries a beacon mast, and a keep-out footprint for roofClutter(). */
function towerCrown(ctx, parts, studs, rng, o) {
  const { roof, cx, cz, bodyMat, accentMat, trimMat } = o;
  const style = rng.pick(CROWN_STYLES);
  const hw = roof.capHalfW, hd = roof.capHalfD, deck = roof.deckY;
  const out = { style, mast: false, avoid: [] };
  const ringHalfW = Math.max(1, hw - roof.parapetT / 2), ringHalfD = Math.max(1, hd - roof.parapetT / 2);
  if (style === 'parapet') {
    // coping course over the parapet with a fresh stud row on top
    const h = 0.22, t = roof.parapetT + 0.1;
    for (const sz of [-1, 1]) plainBox(parts, trimMat, ringHalfW * 2 + t, h, t, cx, roof.topY + h / 2, cz + sz * ringHalfD);
    for (const sx of [-1, 1]) plainBox(parts, trimMat, t, h, ringHalfD * 2 - t, cx + sx * ringHalfW, roof.topY + h / 2, cz);
    studPerimeter(studs, cx, cz, ringHalfW, ringHalfD, roof.topY + h, trimMat, { max: 120 });
  } else if (style === 'setback') {
    const b1w = hw * 0.62, b1d = hd * 0.62, b1h = rng.range(1.3, 2.3);
    const b2w = b1w * 0.55, b2d = b1d * 0.55, b2h = rng.range(0.9, 1.6);
    box(ctx, parts, trimMat, b1w * 2, b1h, b1d * 2, cx, deck, cz, 0.04);
    studPerimeter(studs, cx, cz, b1w, b1d, deck + b1h, trimMat, { max: 60 });
    box(ctx, parts, bodyMat, b2w * 2, b2h, b2d * 2, cx, deck + b1h, cz, 0.04);
    studGrid(studs, cx, cz, b2w - 0.3, b2d - 0.3, deck + b1h + b2h, bodyMat, { inset: 0.25, align: 'center', max: 12 });
    out.avoid.push({ x: cx, z: cz, r: Math.max(b1w, b1d) + 0.2 });
  } else if (style === 'mast') {
    const padH = 0.45;
    box(ctx, parts, trimMat, hw * 0.9, padH, hd * 0.9, cx, deck, cz, 0.04);
    const mh = rng.range(3.4, 5.6);
    cylinder(parts, 'lightStoneGrey', 0.08, 0.11, mh, 6, cx, deck + padH, cz);
    cylinder(parts, 'mediumStoneGrey', 0.2, 0.26, 0.3, 8, cx, deck + padH, cz);
    plainBox(parts, 'beacon', 0.28, 0.28, 0.28, cx, deck + padH + mh + 0.14, cz);
    for (const ox of [-hw * 0.3, hw * 0.3]) for (const oz of [-hd * 0.3, hd * 0.3]) studs.push({ x: cx + ox, y: deck + padH, z: cz + oz, color: trimMat });
    out.mast = true;
    out.avoid.push({ x: cx, z: cz, r: Math.max(hw, hd) * 0.55 });
  } else if (style === 'pylons') {
    const py = rng.range(1.3, 2.1);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const px = cx + sx * (hw - 0.6), pz = cz + sz * (hd - 0.6);
      box(ctx, parts, accentMat, 0.5, py, 0.5, px, deck, pz, 0.03);
      plainBox(parts, trimMat, 0.66, 0.12, 0.66, px, deck + py + 0.06, pz);
      for (const ox of [-0.16, 0.16]) for (const oz of [-0.16, 0.16]) studs.push({ x: px + ox, y: deck + py + 0.12, z: pz + oz, color: trimMat });
    }
    out.avoid.push({ x: cx, z: cz, r: Math.max(hw, hd) * 0.4 });
  } else {
    // small pyramid crown (4-sided cone) on a studded plinth plate
    const bw = hw * 0.72, bd = hd * 0.72, bh = 0.3;
    box(ctx, parts, trimMat, bw * 2, bh, bd * 2, cx, deck, cz, 0.04);
    studPerimeter(studs, cx, cz, bw, bd, deck + bh, trimMat, { max: 60 });
    const ph = rng.range(1.3, 2.1);
    cylinder(parts, accentMat, 0.03, Math.min(bw, bd) * 0.72, ph, 4, cx, deck + bh, cz);
    plainBox(parts, 'beacon', 0.24, 0.24, 0.24, cx, deck + bh + ph + 0.12, cz);
    out.avoid.push({ x: cx, z: cz, r: Math.max(bw, bd) + 0.2 });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// LOOP cycle-6 house craft (level-1 `house`). Replaces the stepped-pyramid box house with a gabled cottage
// vocabulary: a gable roof (two tilted slabs, staggered tile courses, ridge cap, white fascia + barge boards,
// stepped-brick gable-end triangles), dormers on the front slope, a +z porch (deck, posts, baluster runs with top
// and bottom rails, tiled porch roof, steps), clapboard siding courses with corner boards and a belt course,
// white window surrounds with muntins, shutters and flower boxes, a framed front door and porch light, a brick
// chimney through the back slope. No AC/vent/tank roof clutter on houses.
//
// rng discipline: every draw of the pre-c6 house branch is replayed first, in its original order and count
// (storeys, roof height, roof colour, the stepped-roof insets, every per-window lit flag, porch light, chimney,
// trim, quoins), so storeys/colours/chimney/lit windows stay what that seed always gave; the c6 draws follow as
// one fixed-size block (same count whatever the outcome) and the old trailing roof-clutter draws are gone.
// The per-building fork (`${seed}:${id}`, index.js) means nothing here can move another building's stream.
//
// `b.landmark === true` (the record flag the demo sets on its hero garden house; it is a plain record field, so
// it survives serialize/applySave) forces two storeys and the full vocabulary (porch, 2 dormers, siding,
// shutters, flower boxes, gable windows, raised beds) whatever the draws say; index.js never levels it up.
// A landmark may also carry `colors: { body, roof }` (palette names) to pin its palette across world seeds.
//
// Footprint: the porch needs ~2.1 m (1.5 m deck + 0.6 m steps), so a porch house's body loses 1.4 m of depth
// and moves 0.7 m back; everything (roof overhangs 0.28-0.32 m, steps, beds) stays inside the cell footprint.
// Layer offsets out of a wall (outer faces, strictly increasing, no coplanar visible faces):
//   siding course 0.045 < window liner 0.055 < door leaf 0.07 / shutter 0.08 < glass 0.08 < lit 0.095
//   < muntin 0.105 < surround 0.12 < header 0.13 < sill 0.15 < corner board 0.17 (corner posts) .

const SHUTTER_COLORS = ['darkGreen', 'darkRed', 'earthBlue', 'black', 'reddishBrown', 'sandBlue', 'darkStoneGrey'];
const DOOR_COLORS = ['brightRed', 'darkGreen', 'earthBlue', 'darkRed', 'reddishBrown', 'brightYellow', 'sandBlue'];
const DECK_COLORS = ['lightStoneGrey', 'tan', 'reddishBrown', 'mediumStoneGrey'];
const PLANTER_COLORS = ['reddishBrown', 'white', 'darkGreen', 'tan'];
const FLOWER_COLORS = ['brightRed', 'brightPink', 'brightYellow', 'mediumLilac', 'white', 'brightOrange', 'brightPurple'];

/** Seeded colour from `list` with a real luminance gap to `body` (falls back to the first that differs). */
function pickContrast(rng, list, body, gap = 0.15) {
  const lb = paletteLum(body);
  const cands = list.filter((c) => c !== body && Math.abs(paletteLum(c) - lb) > gap);
  return rng.pick(cands.length ? cands : list.filter((c) => c !== body));
}

/** Replays the pre-c6 house branch's stepped-roof inset draws and its per-window lit draws (allFacades order:
 *  x+, x-, z+, z-; per floor; per column of the old 1.7 m / 0.6 layout). Returns lit material (or null) per
 *  face key -> floor -> column, reused by the new windows so a house keeps its night pattern's density. */
function legacyHouseLit(rng, floorsN, halfW, halfD) {
  rng.range(0.45, 0.6); rng.range(0.45, 0.6);
  const lit = {};
  for (const face of FACE_LIST) {
    const { cols } = columnLayout(face.axis === 'x' ? halfD : halfW, 1.7, 0.6, 1);
    const rows = [];
    for (let f = 0; f < floorsN; f++) {
      const row = [];
      for (let c = 0; c < cols; c++) row.push(rng.chance(0.42) ? (rng.chance(0.85) ? 'winWarm' : 'winCool') : null);
      rows.push(row);
    }
    lit[face.key] = rows;
  }
  return lit;
}

/** Clapboard siding: thin proud courses at ~0.28 m pitch on all four walls (they wrap the corners like
 *  courseBands); window/door/trim layers all sit further out, so the courses run behind them. */
function clapboard(parts, mat, cx, cz, halfW, halfD, y0, y1, { pitch = 0.28, proud = 0.045, bandH = 0.13 } = {}) {
  const w = proud + BAND_EMBED;
  for (let y = y0; y + bandH <= y1 + 1e-4; y += pitch) {
    const cy = y + bandH / 2;
    plainBox(parts, mat, w, bandH, (halfD + proud) * 2, cx + halfW + (proud - BAND_EMBED) / 2, cy, cz);
    plainBox(parts, mat, w, bandH, (halfD + proud) * 2, cx - halfW - (proud - BAND_EMBED) / 2, cy, cz);
    plainBox(parts, mat, (halfW + proud) * 2, bandH, w, cx, cy, cz + halfD + (proud - BAND_EMBED) / 2);
    plainBox(parts, mat, (halfW + proud) * 2, bandH, w, cx, cy, cz - halfD - (proud - BAND_EMBED) / 2);
  }
}

/** A few brick flowers (stem + head) and a leaf strip on a planter top (world space, along x). */
function flowerRow(parts, frng, x0, x1, z, y, depth) {
  plainBox(parts, 'darkGreen', Math.max(0.1, x1 - x0), 0.08, depth, (x0 + x1) / 2, y + 0.04, z);
  const n = Math.max(2, Math.round((x1 - x0) / 0.3));
  for (let k = 0; k < n; k++) {
    const x = x0 + ((k + 0.5) / n) * (x1 - x0);
    const dz = (k % 2 ? 1 : -1) * depth * 0.18;
    const sh = 0.1 + frng.range(0, 0.12);
    plainBox(parts, 'brightGreen', 0.05, sh, 0.05, x, y + 0.08 + sh / 2, z + dz);
    plainBox(parts, frng.pick(FLOWER_COLORS), 0.15, 0.13, 0.15, x, y + 0.08 + sh + 0.06, z + dz);
  }
}

/** One house window on a face: dark liner, glass, optional lit overlay, a muntin cross, a white surround
 *  (jambs, cornice header, proud sill), optional louvred shutters and a flower box hung under the sill. */
function houseWindow(parts, face, cx, cz, norm, t, y0, w, h, o) {
  const P = (mat, ww, hh, proud, y, tt, th) => facePlate(parts, mat, face, cx, cz, norm, ww, hh, proud, y, tt, th);
  const yc = y0 + h / 2;
  const sw = 0.13;
  P('darkStoneGrey', w, h, 0.055, yc, t, 0.035);
  P(o.glass, w - 0.02, h - 0.02, 0.08, yc, t, 0.02);
  if (o.lit) P(o.lit, w * 0.72, h * 0.7, 0.095, yc, t, 0.01);
  P(o.trim, 0.06, h, 0.105, yc, t, 0.02);
  P(o.trim, w, 0.06, 0.105, yc + h * 0.1, t, 0.02);
  P(o.trim, sw, h + sw * 2, 0.12, yc, t - w / 2 - sw / 2, 0.1);
  P(o.trim, sw, h + sw * 2, 0.12, yc, t + w / 2 + sw / 2, 0.1);
  P(o.trim, w + sw * 2 + 0.14, 0.16, 0.13, y0 + h + sw * 0.6, t, 0.11);
  P(o.trim, w + sw * 2 + 0.06, 0.1, 0.15, y0 - sw * 0.5, t, 0.13);
  if (o.shutter) {
    for (const s of [-1, 1]) {
      const ts = t + s * (w / 2 + sw + 0.17);
      P(o.shutter, 0.3, h + 0.04, 0.08, yc, ts, 0.06);
      for (const dy of [-0.25, 0, 0.25]) P(o.shutter, 0.22, 0.045, 0.095, yc + dy * h, ts, 0.03);
    }
  }
  if (o.planter) {
    const by = y0 - sw * 0.5 - 0.05 - 0.13; // box centre: hung just under the sill
    P(o.planter, w + 0.3, 0.26, 0.34, by, t, 0.3);
    const c = faceCentre(face, cx, cz, norm + 0.19, t);
    const top = by + 0.13;
    if (face.axis === 'z') flowerRow(parts, o.frng, c.x - w / 2 - 0.05, c.x + w / 2 + 0.05, c.z, top, 0.2);
    else {
      // x faces: same planting turned 90 degrees
      plainBox(parts, 'darkGreen', 0.2, 0.08, w + 0.1, c.x, top + 0.04, c.z);
      const n = Math.max(2, Math.round(w / 0.3));
      for (let k = 0; k < n; k++) {
        const z = c.z - w / 2 + ((k + 0.5) / n) * w;
        const sh = 0.1 + o.frng.range(0, 0.12);
        plainBox(parts, 'brightGreen', 0.05, sh, 0.05, c.x, top + 0.08 + sh / 2, z);
        plainBox(parts, o.frng.pick(FLOWER_COLORS), 0.15, 0.13, 0.15, c.x, top + 0.08 + sh + 0.06, z);
      }
    }
  }
}

/** Box in a local frame (u = along a ridge, y = up, v = across it, +v down-slope on the +v side): optional
 *  rotation about u (`rotU` > 0 tilts local +v downward) or about v (`rotV`), then `push` maps it to world. */
function lbox(ctx, push, mat, w, h, d, u, y, v, { rotU = 0, rotV = 0, bevel = 0 } = {}) {
  let g;
  if (bevel > 0) {
    const qh = Math.max(0.08, quant(h));
    g = ctx.materials.bevelBox(Math.max(0.08, quant(w)), qh, Math.max(0.08, quant(d)), bevel).clone();
    g.translate(0, -qh / 2, 0);
  } else {
    g = unitBoxClone(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d));
  }
  if (rotU) g.rotateX(rotU);
  if (rotV) g.rotateZ(rotV);
  g.translate(u, y, v);
  push(mat, g);
}

/** Staggered tile courses on one tilted roof plane (local frame, see lbox). The plane's top surface passes
 *  through (y = yR, v = 0) and descends toward side `s` (+1/-1) at `theta`; courses start `s0` down-slope and
 *  run to `slopeLen`. Each course is tilted `delta` shallower than the plane so its lower (butt) edge stands
 *  proud, giving the stepped shingle line; `tileW` > 0 splits courses into staggered tiles. */
function tileCourses(ctx, push, mat, { W, yR, theta, s, slopeLen, s0 = 0.18, pitch = 0.4, len = 0.44, th = 0.06, delta = 0.08, tileW = 0 }) {
  const phi = theta - delta;
  const sinT = Math.sin(theta), cosT = Math.cos(theta), sinP = Math.sin(phi), cosP = Math.cos(phi);
  let k = 0;
  for (let d0 = s0; d0 + 0.12 < slopeLen; d0 += pitch, k++) {
    const L = Math.min(len, slopeLen - d0);
    const py = yR - d0 * sinT, pv = d0 * cosT;
    const y = py - (L / 2) * sinP + (th / 2) * cosP;
    const v = s * (pv + (L / 2) * cosP + (th / 2) * sinP);
    if (tileW <= 0) { lbox(ctx, push, mat, W, th, L, 0, y, v, { rotU: s * phi }); continue; }
    const gap = 0.05, p = tileW + gap;
    const off = (k % 2) * p * 0.5;
    for (let u0 = -W / 2 - off; u0 < W / 2; u0 += p) {
      const a = Math.max(-W / 2, u0), b2 = Math.min(W / 2, u0 + tileW);
      if (b2 - a < 0.12) continue;
      lbox(ctx, push, mat, b2 - a, th, L, (a + b2) / 2, y, v, { rotU: s * phi });
    }
  }
}

function generateHouse(ctx, b, rng, halfW, halfD, cx, cz, groundY, mats) {
  const { body, frameMat, glassMat, plinthMat, roofOverride = null } = mats;
  const parts = [];
  const studs = [];
  const hero = b.landmark === true;

  // ---- replay of the pre-c6 draws, original order and count ----
  const twoStoryDraw = rng.chance(0.35);
  const roofHDraw = 2.0 + rng.range(-0.3, 0.5);
  const roofDraw = pick(rng, RESI_ROOF);
  const roofMat = roofOverride || roofDraw;
  const lit = legacyHouseLit(rng, twoStoryDraw ? 2 : 1, halfW, halfD);
  const porchLightDraw = rng.chance(0.55);
  let chimney = null;
  if (rng.chance(0.75)) chimney = { mat: rng.chance(0.5) ? 'reddishBrown' : 'darkStoneGrey', fx: rng.range(0.35, 0.6), fz: rng.range(0.3, 0.6), extra: rng.range(0, 0.9) };
  const quoinMat = rng.pick(TRIM_COLORS);
  const quoinDraw = rng.chance(0.55);
  // ---- c6 draws: one fixed-size block, appended ----
  const ridgeXDraw = rng.chance(0.6);
  const porchDraw = rng.chance(0.62);
  const sidingDraw = rng.chance(0.7);
  const shutterDraw = rng.chance(0.55);
  const planterDraw = rng.chance(0.5);
  const dormerDraw = rng.pick([0, 1, 2, 2]);
  const gableWinDraw = rng.chance(0.6);
  const postsDraw = rng.chance(0.5) ? 4 : 2;
  const tilesDraw = rng.chance(0.7);
  const shutterMat = pickContrast(rng, SHUTTER_COLORS, body);
  const doorMat = pickContrast(rng, DOOR_COLORS, body);
  const deckMat = rng.pick(DECK_COLORS);
  const planterMat = rng.pick(PLANTER_COLORS);
  const frng = rng.fork('flowers'); // stateless fork: flower colours never shift the main stream

  const twoStory = hero || twoStoryDraw;
  const ridgeX = hero || ridgeXDraw;
  const porch = hero || porchDraw;
  const siding = hero || sidingDraw;
  const shutters = hero || shutterDraw;
  const planters = hero || planterDraw;
  const gableWin = hero || gableWinDraw;
  const nPosts = hero ? 4 : postsDraw;
  const splitTiles = hero || tilesDraw;
  // White trim reads on every mid/dark body; light bodies keep their contrasting frame colour instead.
  const trim = paletteLum(body) > 0.75 ? frameMat : 'white';

  const groundH = 3.0, upperH = 2.7;
  const floorsN = twoStory ? 2 : 1;
  const { floors, top } = floorList(floorsN, groundH, upperH);
  const porchD = 1.5, stairW = 1.3;
  const hw = halfW;
  const hd = porch ? halfD - 0.7 : halfD;
  const bz = porch ? cz - 0.7 : cz;
  const Y = (y) => groundY + y;

  // ---- body ----
  box(ctx, parts, body, hw * 2, top, hd * 2, cx, groundY, bz);
  interiorLiner(parts, body, hw * 2, top, hd * 2, cx, groundY, bz);
  plinth(ctx, parts, plinthMat, cx, bz, hw, hd, groundY);
  if (siding) {
    clapboard(parts, body, cx, bz, hw, hd, Y(0.42), Y(top - 0.06));
    // corner boards: one square post per corner, proud of both faces so it caps the siding course ends
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) plainBox(parts, trim, 0.26, top - 0.35, 0.26, cx + sx * (hw + 0.04), Y(0.35 + (top - 0.35) / 2), bz + sz * (hd + 0.04));
    if (twoStory) floorBands(parts, trim, cx, bz, hw, hd, floors, groundY, { proud: 0.08, bandH: 0.16 });
  } else {
    courseBands(parts, body, cx, bz, hw, hd, Y(0.35), Y(top), { pitch: 1.2 });
    if (quoinDraw) for (const face of FACE_LIST) quoinStrips(parts, quoinMat, face, cx, bz, hw, hd, Y(0.35), Y(top));
  }

  // ---- windows ----
  const winSpec = [{ y0: 0.85, h: 1.4, w: 0.95 }, { y0: groundH + 0.6, h: 1.25, w: 0.9 }];
  let windows = 0;
  for (const face of FACE_LIST) {
    const { norm, tan } = faceAxes(face, hw, hd);
    for (let f = 0; f < floorsN; f++) {
      let ts;
      if (face.key === 'z+' && f === 0) ts = [-hw * 0.62, hw * 0.62];
      else if (face.axis === 'x' && tan < 2.2) ts = [0];
      else ts = [-tan * 0.5, tan * 0.5];
      const ws = winSpec[f];
      const litRow = (lit[face.key] && (lit[face.key][f] || lit[face.key][0])) || [];
      ts.forEach((t, k) => {
        // the landmark is lived in: its street-front ground floor is always lit at night
        const litMat = hero && face.key === 'z+' && f === 0 ? 'winWarm' : (litRow.length ? litRow[k % litRow.length] : null);
        houseWindow(parts, face, cx, bz, norm, t, Y(ws.y0), ws.w, ws.h, {
          glass: glassMat, trim, lit: litMat,
          shutter: shutters && face.key !== 'z-' ? shutterMat : null,
          planter: planters && face.key !== 'z-' && (f === 0 || (hero && face.key === 'z+')) ? planterMat : null,
          frng,
        });
        windows++;
      });
    }
  }

  // ---- front door (+z) ----
  const front = FACE_LIST[2];
  const zF = bz + hd;
  const dY = porch ? 0.45 : 0.35;
  // a one-storey porch roof meets the wall at 2.86 m, so its door is a little shorter (header stays under it)
  const doorH = porch && !twoStory ? 1.95 : 2.1;
  {
    const P = (mat, ww, hh, proud, y, tt, th) => facePlate(parts, mat, front, cx, bz, hd, ww, hh, proud, y, tt, th);
    P(doorMat, 1.0, doorH, 0.07, Y(dY + doorH / 2), 0, 0.06);
    P(glassMat, 0.5, 0.42, 0.09, Y(dY + doorH - 0.48), 0, 0.02);
    for (const dy of [0.45, 1.05]) P(doorMat, 0.62, 0.36, 0.09, Y(dY + dy), 0, 0.02); // raised panels
    P('brightYellow', 0.08, 0.08, 0.12, Y(dY + 1.0), 0.36, 0.03);
    for (const s of [-1, 1]) P(trim, 0.15, doorH + 0.22, 0.12, Y(dY + (doorH + 0.22) / 2), s * 0.575, 0.1);
    P(trim, 1.46, 0.2, 0.13, Y(dY + doorH + 0.16), 0, 0.11);
    // porch lamp(s): a pair hugging the door jambs under a porch (clear of the inner posts), one beside a stoop door
    if (hero || porchLightDraw) for (const t of porch ? [-0.75, 0.75] : [0.92]) P('porchWarm', 0.2, 0.28, 0.14, Y(dY + 1.62), t, 0.08);
  }

  // ---- porch (+z) or stoop + door hood ----
  let postTop = 0;
  if (porch) {
    const zD = zF + porchD;
    const deckTop = 0.45;
    box(ctx, parts, deckMat, hw * 2, deckTop, porchD + 0.02, cx, groundY, zF + porchD / 2 - 0.01, 0.03);
    plainBox(parts, trim, hw * 2 + 0.06, 0.08, 0.12, cx, Y(deckTop - 0.03), zD - 0.04); // deck nosing
    // steps (two risers, inside the cell: zD + 0.6 = cell edge - 0.05)
    box(ctx, parts, 'lightStoneGrey', stairW, 0.3, 0.33, cx, groundY, zD + 0.15, 0.03);
    box(ctx, parts, 'lightStoneGrey', stairW, 0.15, 0.3, cx, groundY, zD + 0.44, 0.03);
    // porch roof: a shallow shed slab from the wall out past the posts, tiled, with a white fascia
    const yW = twoStory ? 3.22 : 2.86;
    const alpha = 0.2, prT = 0.14;
    const run = porchD + 0.22;
    const Lp = run / Math.cos(alpha);
    const prW = twoStory ? hw * 2 + 0.24 : hw * 2 - 0.06;
    const pushP = (mat, g) => { g.translate(cx, groundY, zF); parts.push({ mat, geom: g }); };
    lbox(ctx, pushP, roofMat, prW, prT, Lp, 0, yW - (Lp / 2) * Math.sin(alpha) - (prT / 2) * Math.cos(alpha),
      (Lp / 2) * Math.cos(alpha) - (prT / 2) * Math.sin(alpha), { rotU: alpha, bevel: 0.03 });
    tileCourses(ctx, pushP, roofMat, { W: prW - 0.08, yR: yW, theta: alpha, s: 1, slopeLen: Lp, s0: 0.05, delta: 0.06, tileW: splitTiles ? 0.8 : 0 });
    const yEdge = yW - run * Math.tan(alpha);
    lbox(ctx, pushP, trim, prW, 0.2, 0.07, 0, yEdge - 0.2, run - 0.1);
    // posts, then baluster runs (top + bottom rail, spindles) between them; the stair opening stays clear
    const zPost = zD - 0.13;
    const under = (z) => yW - (z - zF) * Math.tan(alpha) - prT / Math.cos(alpha);
    postTop = under(zPost) + 0.02;
    const outer = hw - 0.14, inner = stairW / 2 + 0.22;
    const postsU = nPosts === 4 ? [-outer, -inner, inner, outer] : [-outer, outer];
    for (const u of postsU) {
      plainBox(parts, trim, 0.2, postTop - deckTop, 0.2, cx + u, Y(deckTop + (postTop - deckTop) / 2), zPost);
      plainBox(parts, trim, 0.3, 0.12, 0.3, cx + u, Y(deckTop + 0.06), zPost); // plinth block
      plainBox(parts, trim, 0.3, 0.1, 0.3, cx + u, Y(postTop - 0.07), zPost);  // capital
    }
    const yB = deckTop + 0.1, yT = deckTop + 0.66;
    const run1 = (x0, x1, z0, z1) => {
      // one straight baluster run from (x0,z0) to (x1,z1) along x or z
      const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
      const len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
      if (len < 0.3) return;
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      plainBox(parts, trim, alongX ? len : 0.1, 0.09, alongX ? 0.1 : len, mx, Y(yT), mz);
      plainBox(parts, trim, alongX ? len : 0.08, 0.07, alongX ? 0.08 : len, mx, Y(yB), mz);
      const n = Math.max(1, Math.floor(len / 0.2));
      for (let k = 0; k < n; k++) {
        const f = (k + 0.5) / n;
        plainBox(parts, trim, 0.065, yT - yB, 0.065, x0 + (x1 - x0) * f, Y((yT + yB) / 2), z0 + (z1 - z0) * f);
      }
    };
    const xL = cx - outer, xR = cx + outer;
    if (nPosts === 4) {
      run1(xL + 0.1, cx - inner - 0.1, zPost, zPost);
      run1(cx + inner + 0.1, xR - 0.1, zPost, zPost);
    } else {
      const xs = stairW / 2 + 0.12;
      run1(xL + 0.1, cx - xs, zPost, zPost);
      run1(cx + xs, xR - 0.1, zPost, zPost);
      for (const s of [-1, 1]) plainBox(parts, trim, 0.16, yT - deckTop + 0.1, 0.16, cx + s * xs, Y(deckTop + (yT - deckTop + 0.1) / 2), zPost); // newels
    }
    run1(xL, xL, zF + 0.12, zPost - 0.1);
    run1(xR, xR, zF + 0.12, zPost - 0.1);
    // in front of the porch: raised flower beds (hero) or two clipped shrubs
    const bedZ = zD + 0.3, bedD = 0.5;
    const bx0 = stairW / 2 + 0.14, bx1 = hw - 0.05;
    for (const s of [-1, 1]) {
      const bx = cx + s * (bx0 + bx1) / 2, bw = bx1 - bx0;
      if (hero) {
        box(ctx, parts, plinthMat === 'darkStoneGrey' ? 'darkStoneGrey' : 'reddishBrown', bw, 0.42, bedD, bx, groundY, bedZ, 0.03);
        plainBox(parts, 'reddishBrown', bw - 0.12, 0.04, bedD - 0.12, bx, Y(0.42), bedZ);
        flowerRow(parts, frng, bx - bw / 2 + 0.1, bx + bw / 2 - 0.1, bedZ, Y(0.38), bedD - 0.16);
      } else {
        box(ctx, parts, 'darkGreen', Math.min(1.1, bw), 0.6, 0.5, cx + s * (bx0 + 0.6), groundY, bedZ, 0.05);
      }
    }
  } else {
    faceSlab(parts, ctx, 'lightStoneGrey', front, cx, bz, { off: hd + 0.32, y: Y(0.09), w: 1.7, h: 0.16, d: 0.62 });
    faceSlab(parts, ctx, roofMat, front, cx, bz, { off: hd + 0.36, y: Y(dY + 2.6), w: 1.8, h: 0.12, d: 0.72, tilt: 0.3 });
    for (const s of [-1, 1]) faceBoxAt(parts, trim, front, cx, bz, { off: hd + 0.18, t: s * 0.8, y: Y(dY + 2.35), w: 0.1, h: 0.4, d: 0.34 });
    // two clipped shrubs, kept under the window planters (0.45 m) and inside the cell
    for (const s of [-1, 1]) box(ctx, parts, 'darkGreen', 0.8, 0.45, 0.6, cx + s * (hw - 0.5), groundY, zF + 0.42, 0.05);
  }

  // ---- gable roof (local frame: u along the ridge, v across; ridge along x or z) ----
  const ridgeZ = !ridgeX;
  const Lh = ridgeX ? hw : hd, Sh = ridgeX ? hd : hw;
  const tanT = hero ? Math.max(0.95, roofHDraw / Sh) : THREE.MathUtils.clamp(roofHDraw / Sh, 0.62, 1.05);
  const theta = Math.atan(tanT);
  const sinT = Math.sin(theta), cosT = Math.cos(theta);
  const lift = 0.12, slabT = 0.2;
  const yR = top + Sh * tanT + lift; // ridge line of the slabs' top surfaces (relative to ground)
  const ovG = 0.28;
  const ovFor = (s) => (s > 0 && ridgeX && porch && !twoStory ? 0.12 : 0.32);
  const push = (mat, g) => { if (ridgeZ) g.rotateY(Math.PI / 2); g.translate(cx, groundY, bz); parts.push({ mat, geom: g }); };
  const W = 2 * (Lh + ovG);
  for (const s of [1, -1]) {
    const ov = ovFor(s);
    const Ls = (Sh + ov) / cosT;
    const yC = yR - (Ls / 2) * sinT - (slabT / 2) * cosT;
    const vC = s * ((Ls / 2) * cosT - (slabT / 2) * sinT);
    lbox(ctx, push, roofMat, W, slabT, Ls, 0, yC, vC, { rotU: s * theta, bevel: 0.03 });
    tileCourses(ctx, push, roofMat, { W: W - 0.1, yR, theta, s, slopeLen: Ls, tileW: splitTiles ? 0.8 : 0 });
    // fascia along the eave and barge boards up both rakes (trim)
    const yE = yR - (Sh + ov) * tanT;
    lbox(ctx, push, trim, W, 0.22, 0.07, 0, yE - 0.2, s * (Sh + ov - 0.095));
    for (const q of [-1, 1]) {
      lbox(ctx, push, trim, 0.08, 0.26, Ls + 0.02, q * (Lh + ovG + 0.04), yC + 0.03 * cosT, vC + s * 0.03 * sinT, { rotU: s * theta });
    }
  }
  lbox(ctx, push, roofMat, W + 0.06, 0.2, 0.34, 0, yR + 0.02, 0, { bevel: 0.03 }); // ridge cap
  // stepped-brick gable ends (attic infill under the slabs): each course stops inside the slab thickness
  const courseH = 0.24;
  for (let k = 0; ; k++) {
    const y0 = top + k * courseH, y1 = y0 + courseH;
    const half = (yR - slabT / (2 * cosT) - y1) / tanT;
    if (half < 0.12) break;
    lbox(ctx, push, body, 2 * Lh, courseH, 2 * half, 0, y0 + courseH / 2, 0);
  }
  // small framed attic window in each gable end
  if (gableWin) {
    const gy = top + Sh * tanT * 0.3 + 0.35;
    const gw = 0.55, gh = 0.6;
    if ((yR - slabT / cosT - (gy + gh / 2 + 0.15)) / tanT > gw / 2 + 0.15) {
      for (const q of [-1, 1]) {
        const u = q * Lh;
        lbox(ctx, push, 'darkStoneGrey', 0.035, gh, gw, u + q * 0.0375, gy, 0);
        lbox(ctx, push, glassMat, 0.02, gh - 0.02, gw - 0.02, u + q * 0.07, gy, 0);
        lbox(ctx, push, trim, 0.02, gh, 0.06, u + q * 0.095, gy, 0);
        lbox(ctx, push, trim, 0.1, gh + 0.24, 0.12, u + q * 0.07, gy, -(gw / 2 + 0.06));
        lbox(ctx, push, trim, 0.1, gh + 0.24, 0.12, u + q * 0.07, gy, gw / 2 + 0.06);
        lbox(ctx, push, trim, 0.11, 0.12, gw + 0.3, u + q * 0.075, gy + gh / 2 + 0.06, 0);
        lbox(ctx, push, trim, 0.13, 0.1, gw + 0.34, u + q * 0.085, gy - gh / 2 - 0.05, 0);
      }
    }
  }
  // dormers on the +v slope (ridge along x only, so they face the +z front)
  let dormers = 0;
  const nD = ridgeX ? (hero ? 2 : dormerDraw) : 0;
  const phiD = 0.75, tanD = Math.tan(phiD), cosD = Math.cos(phiD), sinD = Math.sin(phiD);
  const dw = 1.2, sp = dw / 2 + 0.14;
  const vf = Sh - 0.55;
  const ys = yR - vf * tanT; // roof top surface at the dormer front
  const dh = Math.min(1.05, vf * tanT - sp * tanD - 0.22);
  if (nD > 0 && dh >= 0.75) {
    const us = nD === 1 ? [0] : [-Lh * 0.45, Lh * 0.45];
    const vb = vf - dh / tanT - 0.15;
    const yDr = ys + dh + sp * tanD + 0.06;
    const vFront = vf + 0.16;
    const vMb = (yR - yDr) / tanT - 0.1;
    const tm = 0.12, Lm = sp / cosD;
    const litD = lit['z+'] && lit['z+'][0] ? lit['z+'][0] : [];
    us.forEach((ud, k) => {
      lbox(ctx, push, body, dw, dh + 0.25, vf - vb, ud, ys - 0.25 + (dh + 0.25) / 2, (vf + vb) / 2, { bevel: 0.03 });
      for (const q of [-1, 1]) {
        const uC = ud + q * ((Lm / 2) * cosD - (tm / 2) * sinD);
        const yC = yDr - (Lm / 2) * sinD - (tm / 2) * cosD;
        lbox(ctx, push, roofMat, Lm, tm, vFront - vMb, uC, yC, (vFront + vMb) / 2, { rotV: -q * phiD });
        lbox(ctx, push, trim, Lm + 0.02, 0.2, 0.07, uC + q * 0.02 * sinD, yC + 0.02 * cosD, vFront + 0.035, { rotV: -q * phiD });
      }
      for (let c = 0; ; c++) {
        const y0 = ys + dh + c * 0.16, y1 = y0 + 0.16;
        const half = (yDr - tm / (2 * cosD) - y1) / tanD;
        if (half < 0.08) break;
        lbox(ctx, push, body, 2 * half, 0.16, vf - vMb, ud, y0 + 0.08, (vf + vMb) / 2);
      }
      // framed window on the dormer front (layers out along +v)
      const ww = 0.62, wh = Math.min(0.72, dh - 0.3), wy = ys + dh * 0.5 + 0.02;
      lbox(ctx, push, 'darkStoneGrey', ww, wh, 0.035, ud, wy, vf + 0.0375);
      lbox(ctx, push, glassMat, ww - 0.02, wh - 0.02, 0.02, ud, wy, vf + 0.07);
      const lm = hero ? (k === 0 ? 'winWarm' : null) : (litD.length ? litD[k % litD.length] : null);
      if (lm) lbox(ctx, push, lm, ww * 0.7, wh * 0.66, 0.01, ud, wy, vf + 0.09);
      lbox(ctx, push, trim, 0.05, wh, 0.02, ud, wy, vf + 0.095);
      for (const q of [-1, 1]) lbox(ctx, push, trim, 0.12, wh + 0.24, 0.1, ud + q * (ww / 2 + 0.06), wy, vf + 0.07);
      lbox(ctx, push, trim, ww + 0.36, 0.12, 0.11, ud, wy + wh / 2 + 0.06, vf + 0.075);
      lbox(ctx, push, trim, ww + 0.3, 0.1, 0.13, ud, wy - wh / 2 - 0.05, vf + 0.085);
      dormers++;
    });
  }
  // brick chimney through the back half of the roof (legacy-drawn position, now measured against the slope)
  let chimTop = 0;
  if (chimney) {
    const x = cx + hw * chimney.fx, z = bz - hd * chimney.fz;
    const lu = ridgeX ? x - cx : -(z - bz), lv = ridgeX ? z - bz : x - cx;
    if (Math.abs(lv) < Sh - 0.6 && Math.abs(lu) < Lh - 0.6) {
      const surf = yR - Math.abs(lv) * tanT;
      const base = surf - 0.3 - 0.55 * tanT; // the downhill face still starts below the slope (stack half-depth 0.5)
      const h = surf - base + 0.75 + chimney.extra;
      brickStack(ctx, parts, studs, chimney.mat, x, z, 1.0, 0.8, Y(base), h, { studTop: false });
      plainBox(parts, 'darkStoneGrey', 1.16, 0.12, 1.16, x, Y(base + h + 0.06), z); // cap
      studs.push({ x, y: Y(base + h + 0.12), z, color: 'darkStoneGrey' });
      chimTop = base + h + 0.12;
    }
  }
  const height = Math.max(yR + 0.12, chimTop);
  return {
    parts, studs, height, kind: 'house',
    features: { landmark: hero, body, roof: roofMat, trim, storeys: floorsN, ridge: ridgeX ? 'x' : 'z', porch, posts: porch ? nPosts : 0, dormers, siding, shutters, planters, gableWin, splitTiles, windows, quoins: !siding && quoinDraw ? 4 : 0, clutter: 0 },
  };
}

// ---------------------------------------------------------------------------------------------
function generateResidential(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const body = pick(rng, RESI_BODY);
  // Frame must contrast the wall regardless of body colour or windows disappear at any distance - the
  // seeded pick only ever chooses a palette colour with a real luminance gap against the wall.
  const frameMat = pickFrame(rng, body);
  const glassMat = rng.chance(0.75) ? 'transClear' : 'transBlue';
  const plinthMat = rng.chance(0.5) ? 'darkStoneGrey' : 'lightStoneGrey';

  // Level-1 house, or a `landmark` residential record at any level (LOOP c6: a landmark is always the hero house
  // and never densifies; see generateHouse and index.js enqueueLevelUps).
  if (b.level <= 1 || b.landmark === true) {
    // Optional authored palette, landmark only: `b.colors = { body, roof }` (palette names; unknown names are
    // ignored). It replaces the drawn colours after the draws, so the rng stream is the same with or without it.
    const want = b.landmark === true && b.colors ? b.colors : null;
    const hBody = want && PALETTE[want.body] ? want.body : body;
    const hFrame = hBody === body ? frameMat : (paletteLum(hBody) > 0.5 ? 'darkStoneGrey' : 'white');
    const hRoof = want && PALETTE[want.roof] ? want.roof : null;
    return generateHouse(ctx, b, rng, halfW, halfD, cx, cz, groundY, { body: hBody, frameMat: hFrame, glassMat, plinthMat, roofOverride: hRoof });
  }

  if (b.level === 2) {
    const groundH = 3.2, upperH = 2.95;
    const floorsN = rng.int(3, 5);
    const { floors, top } = floorList(floorsN, groundH, upperH);
    const trimMat = rng.pick(TRIM_COLORS);
    const rhythm = rng.pick(['piers', 'quoins', 'courses']);
    const pitch = rng.range(1.35, 1.7);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    plinth(ctx, parts, plinthMat, cx, cz, halfW, halfD, groundY);
    const capMat = pick(rng, RESI_ROOF);
    floorBands(parts, capMat, cx, cz, halfW, halfD, floors, groundY);
    courseBands(parts, body, cx, cz, halfW, halfD, groundY + 0.35, groundY + top, { pitch: 1.2 });
    // Ground floor: shopfronts on the street-facing faces (seeded), plain windows elsewhere; upper floors
    // all around. Cycle-3 also puts the apartment's balconies here (a seeded subset of floors/faces).
    const rf = roadFaces(ctx, b);
    let shopFaces = 0;
    for (const face of FACE_LIST) {
      const street = !!rf[face.key];
      const shop = street && rng.chance(0.8)
        && shopfrontFace(ctx, parts, face, rng, { cx, cz, groundY, halfW, halfD, floorH: groundH, frameMat, trimMat });
      if (shop) shopFaces++;
      else facade(ctx, parts, rng, cx, cz, groundY, { ...face, halfW, halfD, floors: [floors[0]], pitch, frameMat, glassMat, litFrac: 0.4, warmFrac: 0.8, marginFrac: 0.75 });
      facade(ctx, parts, rng, cx, cz, groundY, { ...face, halfW, halfD, floors: floors.slice(1), pitch, frameMat, glassMat, litFrac: 0.4, warmFrac: 0.8, marginFrac: 0.75 });
    }
    let balconies = 0;
    if (rng.chance(0.85)) {
      const nFaces = rng.int(1, 2);
      for (let k = 0; k < nFaces; k++) {
        balconies += balconyFace(ctx, parts, studs, rng, rng.pick(FACE_LIST), { cx, cz, groundY, halfW, halfD, floors, firstFloor: 1, chance: 0.5 });
      }
    }
    if (rhythm === 'piers') for (const face of FACE_LIST) pierStrips(parts, trimMat, face, cx, cz, halfW, halfD, groundY + floors[0].h + 0.2, groundY + top, { pitch, marginFrac: 0.75 });
    else if (rhythm === 'quoins') for (const face of FACE_LIST) quoinStrips(parts, trimMat, face, cx, cz, halfW, halfD, groundY + 0.4, groundY + top);
    else courseBands(parts, trimMat, cx, cz, halfW, halfD, groundY + 0.35, groundY + top, { pitch: rng.range(0.8, 1.05), proud: 0.06, bandH: 0.1 });
    const roof = {};
    const roofTop = flatRoof(ctx, parts, studs, capMat, cx, cz, halfW, halfD, groundY + top, { capH: 0.35, out: roof });
    const clutter = roofClutter(ctx, parts, studs, rng, {
      cx, cz, deckY: roof.deckY, halfW: roof.innerHalfW, halfD: roof.innerHalfD, menu: LOW_CLUTTER, maxItems: 4,
    });
    return { parts, studs, height: roofTop - groundY, kind: 'apartment', features: { shopFaces, balconies, clutter: clutter.placed, rhythm } };
  }

  // level 3: apartment tower
  const groundH = 3.4, upperH = 3.0;
  const floorsN = rng.int(9, 16);
  const { floors, top } = floorList(floorsN, groundH, upperH);
  // Massing variety: half the towers step back mid-shaft (~45-60 % up), half near the top (the old look).
  const midSetback = rng.chance(0.5);
  const setbackAt = midSetback ? Math.max(3, Math.round(floorsN * rng.range(0.42, 0.6))) : floorsN - rng.int(2, 4);
  const towerBody = pick(rng, RESI_TOWER_BODY);
  const accent = pick(rng, RESI_TOWER_ACCENT);
  const shrink = rng.range(0.78, 0.88);
  const lowerTop = floors[Math.min(setbackAt, floorsN - 1)].y0;
  box(ctx, parts, towerBody, halfW * 2, lowerTop, halfD * 2, cx, groundY, cz);
  interiorLiner(parts, towerBody, halfW * 2, lowerTop, halfD * 2, cx, groundY, cz);
  box(ctx, parts, towerBody, halfW * 2 * shrink, top - lowerTop, halfD * 2 * shrink, cx, groundY + lowerTop, cz);
  interiorLiner(parts, towerBody, halfW * 2 * shrink, top - lowerTop, halfD * 2 * shrink, cx, groundY + lowerTop, cz, 0.24);
  // accent banding at the setback line
  box(ctx, parts, accent, halfW * 2 * shrink * 1.01, 0.3, halfD * 2 * shrink * 1.01, cx, groundY + lowerTop, cz, 0.02);
  // studs on the exposed setback ledge (a real Blox terrace around the upper tower), walked along the middle
  // of the ledge so they never bunch at the corners
  studPerimeter(studs, cx, cz, halfW * (1 + shrink) / 2, halfD * (1 + shrink) / 2, groundY + lowerTop + 0.3, accent, { max: 120 });
  const pitch = rng.range(1.25, 1.6);
  allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors.filter((f) => f.y0 < lowerTop), {
    pitch, frameMat, glassMat, litFrac: 0.5, warmFrac: 0.75, marginFrac: 0.8,
  });
  allFacades(ctx, parts, rng, cx, cz, groundY, halfW * shrink, halfD * shrink, floors.filter((f) => f.y0 >= lowerTop).map((f) => ({ ...f, y0: f.y0 })), {
    pitch, frameMat, glassMat, litFrac: 0.5, warmFrac: 0.75, marginFrac: 0.8,
  });
  // brick coursing: floor slabs, course lines and alternating corner bricks on both sections
  floorBands(parts, accent, cx, cz, halfW, halfD, floors.filter((f) => f.y0 < lowerTop), groundY);
  floorBands(parts, accent, cx, cz, halfW * shrink, halfD * shrink, floors.filter((f) => f.y0 >= lowerTop), groundY);
  courseBands(parts, towerBody, cx, cz, halfW, halfD, groundY + 0.5, groundY + lowerTop, { pitch: 1.2 });
  courseBands(parts, towerBody, cx, cz, halfW * shrink, halfD * shrink, groundY + lowerTop + 0.4, groundY + top, { pitch: 1.2 });
  cornerBricks(parts, accent, cx, cz, halfW, halfD, groundY + 0.5, groundY + lowerTop);
  cornerBricks(parts, accent, cx, cz, halfW * shrink, halfD * shrink, groundY + lowerTop + 0.5, groundY + top);
  if (rng.chance(0.5)) for (const face of FACE_LIST) pierStrips(parts, accent, face, cx, cz, halfW * shrink, halfD * shrink, groundY + lowerTop + 0.5, groundY + top, { pitch, marginFrac: 0.8 });
  const roofY = groundY + top;
  const roof = {};
  const roofTop = flatRoof(ctx, parts, studs, accent, cx, cz, halfW * shrink, halfD * shrink, roofY, { capH: 0.3, out: roof });
  const crown = towerCrown(ctx, parts, studs, rng, { roof, cx, cz, bodyMat: towerBody, accentMat: accent, trimMat: accent });
  const clutter = roofClutter(ctx, parts, studs, rng, {
    cx, cz, deckY: roof.deckY, halfW: roof.innerHalfW, halfD: roof.innerHalfD, menu: TOWER_CLUTTER, maxItems: 4, avoid: crown.avoid,
  });
  if (!crown.mast && clutter.masts === 0) {
    // every tower keeps an aviation mast + beacon, whatever crown style it drew
    cylinder(parts, 'darkStoneGrey', 0.06, 0.08, 3.2, 6, cx, roof.deckY, cz);
    plainBox(parts, 'beacon', 0.26, 0.26, 0.26, cx, roof.deckY + 3.3, cz);
    clutter.masts = 1;
  }
  return {
    parts, studs, height: roofTop - groundY, kind: 'tower',
    features: { crown: crown.style, clutter: clutter.placed, masts: clutter.masts, setbackAt: midSetback ? 'mid' : 'top', shrink: +shrink.toFixed(2) },
  };
}

function generateCommercial(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const body = pick(rng, COMM_BODY);
  const accent = pick(rng, COMM_ACCENT);
  const glassMat = pick(rng, COMM_GLASS);
  // Seeded frame colour from the trim palette, always contrasting the wall (was a fixed black/grey split).
  const frameMat = pickFrame(rng, body);
  const plinthMat = rng.chance(0.5) ? 'darkStoneGrey' : 'mediumStoneGrey';
  const trimMat = rng.pick(TRIM_COLORS);
  const rhythm = rng.pick(['piers', 'quoins', 'courses']);
  const pitch = rng.range(1.35, 1.75);
  // Which faces get the cycle-3 ground-floor shopfront treatment: street-facing faces very likely, the
  // others occasionally (a corner shop), so the whole block does not repeat the same front.
  const rf = roadFaces(ctx, b);
  const shopFace = {};
  for (const face of FACE_LIST) shopFace[face.key] = rng.chance(rf[face.key] ? 0.92 : 0.4);

  if (b.level <= 1) {
    const floorsN = rng.chance(0.4) ? 2 : 1;
    const groundH = 4.1, upperH = 3.4;
    const { floors, top } = floorList(floorsN, groundH, upperH);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    plinth(ctx, parts, plinthMat, cx, cz, halfW, halfD, groundY);
    floorBands(parts, accent, cx, cz, halfW, halfD, floors, groundY);
    courseBands(parts, body, cx, cz, halfW, halfD, groundY + 0.35, groundY + top, { pitch: 1.2 });
    // Ground floor: seeded shopfront bays / awnings / sign / recessed door on the shop faces, the old wide
    // storefront glazing on the rest. Upper floor (if any) keeps the residential-style window band.
    let shopFaces = 0;
    for (const face of FACE_LIST) {
      const shop = shopFace[face.key]
        && shopfrontFace(ctx, parts, face, rng, { cx, cz, groundY, halfW, halfD, floorH: groundH, frameMat, trimMat });
      if (shop) shopFaces++;
      else facade(ctx, parts, rng, cx, cz, groundY, { ...face, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
      if (floorsN > 1) facade(ctx, parts, rng, cx, cz, groundY, { ...face, halfW, halfD, floors: [floors[1]], pitch, frameMat, glassMat, litFrac: 0.4, warmFrac: 0.6, marginFrac: 0.75 });
    }
    // some shop upper floors get a balcony (3-4 railing posts, proud slab)
    let balconies = 0;
    if (floorsN > 1 && rng.chance(0.5)) balconies = balconyFace(ctx, parts, studs, rng, rng.pick(FACE_LIST), { cx, cz, groundY, halfW, halfD, floors, firstFloor: 1, chance: 0.6 });
    if (rhythm === 'piers') for (const face of FACE_LIST) pierStrips(parts, trimMat, face, cx, cz, halfW, halfD, groundY + groundH + 0.2, groundY + top, { pitch, marginFrac: 0.8 });
    else if (rhythm === 'quoins') for (const face of FACE_LIST) quoinStrips(parts, trimMat, face, cx, cz, halfW, halfD, groundY + 0.4, groundY + top);
    const roof = {};
    const roofTop = flatRoof(ctx, parts, studs, 'lightStoneGrey', cx, cz, halfW, halfD, groundY + top, { capH: 0.3, out: roof });
    const clutter = roofClutter(ctx, parts, studs, rng, { cx, cz, deckY: roof.deckY, halfW: roof.innerHalfW, halfD: roof.innerHalfD, menu: LOW_CLUTTER, maxItems: 4 });
    return { parts, studs, height: roofTop - groundY, kind: 'shop', features: { shopFaces, balconies, clutter: clutter.placed, rhythm } };
  }

  if (b.level === 2) {
    const groundH = 4.2, upperH = 3.5;
    const floorsN = rng.int(4, 7);
    const { floors, top } = floorList(floorsN, groundH, upperH);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    plinth(ctx, parts, plinthMat, cx, cz, halfW, halfD, groundY);
    box(ctx, parts, accent, halfW * 2 * 1.01, 0.25, halfD * 2 * 1.01, cx, groundY + groundH, cz, 0.02);
    floorBands(parts, accent, cx, cz, halfW, halfD, floors.filter((f) => f.y0 > groundH + 0.01), groundY);
    courseBands(parts, body, cx, cz, halfW, halfD, groundY + 0.35, groundY + top, { pitch: 1.2 });
    cornerBricks(parts, accent, cx, cz, halfW, halfD, groundY + 0.7, groundY + top, { pitch: 1.2, proud: 0.08 });
    let shopFaces = 0;
    for (const face of FACE_LIST) {
      const shop = shopFace[face.key]
        && shopfrontFace(ctx, parts, face, rng, { cx, cz, groundY, halfW, halfD, floorH: groundH, frameMat, trimMat });
      if (shop) shopFaces++;
      else facade(ctx, parts, rng, cx, cz, groundY, { ...face, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.35, wide: true, marginFrac: 0.85 });
      facade(ctx, parts, rng, cx, cz, groundY, { ...face, halfW, halfD, floors: floors.slice(1), pitch, frameMat, glassMat, litFrac: 0.5, warmFrac: 0.45, marginFrac: 0.82, winWFrac: 0.78 });
    }
    // some shop upper floors get a balcony
    let balconies = 0;
    if (rng.chance(0.45)) balconies = balconyFace(ctx, parts, studs, rng, rng.pick(FACE_LIST), { cx, cz, groundY, halfW, halfD, floors, firstFloor: 1, chance: 0.45 });
    if (rhythm === 'piers') for (const face of FACE_LIST) pierStrips(parts, trimMat, face, cx, cz, halfW, halfD, groundY + groundH + 0.2, groundY + top, { pitch, marginFrac: 0.82 });
    else if (rhythm === 'quoins') for (const face of FACE_LIST) quoinStrips(parts, trimMat, face, cx, cz, halfW, halfD, groundY + 0.4, groundY + top);
    else courseBands(parts, trimMat, cx, cz, halfW, halfD, groundY + 0.35, groundY + top, { pitch: rng.range(0.8, 1.05), proud: 0.06, bandH: 0.1 });
    const roof = {};
    const roofTop = flatRoof(ctx, parts, studs, 'lightStoneGrey', cx, cz, halfW, halfD, groundY + top, { capH: 0.3, out: roof });
    const clutter = roofClutter(ctx, parts, studs, rng, { cx, cz, deckY: roof.deckY, halfW: roof.innerHalfW, halfD: roof.innerHalfD, menu: LOW_CLUTTER, maxItems: 4 });
    return { parts, studs, height: roofTop - groundY, kind: 'office', features: { shopFaces, balconies, clutter: clutter.placed, rhythm } };
  }

  // level 3: office tower, curtain-wall glass.
  const groundH = 4.4, upperH = 3.6;
  const floorsN = rng.int(12, 22);
  const { floors, top } = floorList(floorsN, groundH, upperH);
  // Massing variety: an optional mid-shaft setback band (~42-60 % up) splits the shaft into two sections
  // with their own dressing, so towers differ at silhouette level instead of being the same extrusion.
  const split = floorsN >= 14 && rng.chance(0.6);
  const splitAt = split ? Math.max(4, Math.min(floorsN - 5, Math.round(floorsN * rng.range(0.42, 0.6)))) : floorsN;
  const shrink = split ? rng.range(0.9, 0.95) : 1;
  const lowerTop = split ? floors[splitAt].y0 : top;
  const sections = split
    ? [{ y0: 0, y1: lowerTop, hw: halfW, hd: halfD, floors: floors.filter((f) => f.y0 < lowerTop) },
       { y0: lowerTop, y1: top, hw: halfW * shrink, hd: halfD * shrink, floors: floors.filter((f) => f.y0 >= lowerTop) }]
    : [{ y0: 0, y1: top, hw: halfW, hd: halfD, floors }];
  for (const s of sections) {
    box(ctx, parts, body, s.hw * 2, s.y1 - s.y0, s.hd * 2, cx, groundY + s.y0, cz);
    interiorLiner(parts, body, s.hw * 2, s.y1 - s.y0, s.hd * 2, cx, groundY + s.y0, cz, s.y0 === 0 ? 0 : 0.24);
  }
  plinth(ctx, parts, plinthMat, cx, cz, halfW, halfD, groundY);
  // corner pilasters - inflated outward (both faces of the corner) by `inflate` past the wall so they read as a
  // proud brick with a real highlight/shadow edge, not a flush painted stripe (round-1 review item 1: the old
  // pilaster's outer face landed exactly on cx+sx*halfW, coincident with the wall itself).
  const pw = 0.55, inflate = 0.07;
  for (const s of sections) for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(ctx, parts, accent, pw, s.y1 - s.y0, pw, cx + sx * (s.hw - pw / 2 + inflate), groundY + s.y0, cz + sz * (s.hd - pw / 2 + inflate), 0.03);
  }
  // Curtain-wall facade brought up to residential's relief/contrast level (round-1 review item 3): a wider
  // frame bezel (frameBezel) and less edge-to-edge glazing (no `wide`, a lower winWFrac/marginFrac) so real wall
  // reveal shows between panes, plus per-floor spandrel bands below for storey-by-storey AO/shadow definition.
  // The ground floor of the street faces is replaced by the shopfront treatment above.
  // Spandrel corners must clear the pilaster's rounded (bevelBox) corner, not just match its flat-face inflate:
  // at exactly `inflate` the spandrel's sharp plainBox corner sits coincident with the pilaster's curved surface
  // (which recedes inward from the AABB corner by the bevel radius), causing a hairline z-fight/self-shadow seam
  // right at the pilaster-spandrel junction (round-2 review item 2). `spandrelPad` pushes the spandrel corner
  // fully past that curvature so it unambiguously wraps the pilaster there - both are the same accent colour, so
  // the few extra millimetres read as continuous trim, not a step.
  const spandrelPad = inflate + 0.06;
  let shopFaces = 0;
  for (const s of sections) {
    const upperFloors = s.y0 === 0 ? s.floors.slice(1) : s.floors;
    for (const face of FACE_LIST) {
      const shop = s.y0 === 0 && shopFace[face.key]
        && shopfrontFace(ctx, parts, face, rng, { cx, cz, groundY, halfW, halfD, floorH: groundH, frameMat, trimMat });
      if (shop) shopFaces++;
      else if (s.y0 === 0) {
        facade(ctx, parts, rng, cx, cz, groundY, { ...face, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
      }
      facade(ctx, parts, rng, cx, cz, groundY, {
        ...face, halfW: s.hw, halfD: s.hd, floors: upperFloors,
        pitch, frameMat, glassMat, litFrac: 0.58, warmFrac: 0.45, marginFrac: 0.84, winWFrac: 0.74, frameBezel: 0.34,
      });
    }
    // Brick coursing between the spandrels: course lines plus alternating corner bricks on the pilasters.
    courseBands(parts, body, cx, cz, s.hw, s.hd, groundY + s.y0 + 0.35, groundY + s.y1, { pitch: 1.2 });
    cornerBricks(parts, accent, cx, cz, s.hw + inflate, s.hd + inflate, groundY + s.y0 + 0.6, groundY + s.y1, { pitch: 1.2, len: 1.1, thick: 0.62, proud: 0.06 });
    // facade rhythm follows each section's own footprint, so a pier or quoin never floats past a setback
    const rY0 = groundY + s.y0 + (s.y0 === 0 ? groundH + 0.2 : 0.4);
    if (rhythm === 'piers') for (const face of FACE_LIST) pierStrips(parts, trimMat, face, cx, cz, s.hw, s.hd, rY0, groundY + s.y1, { pitch, marginFrac: 0.84 });
    else if (rhythm === 'quoins') for (const face of FACE_LIST) quoinStrips(parts, trimMat, face, cx, cz, s.hw, s.hd, rY0, groundY + s.y1);
    for (let i = 1; i < s.floors.length; i++) {
      plainBox(parts, accent, s.hw * 2 + spandrelPad * 2, 0.12, s.hd * 2 + spandrelPad * 2, cx, groundY + s.floors[i].y0, cz);
    }
  }
  if (split) {
    // accent band at the setback + studs on the exposed ledge (same treatment as the residential tower)
    box(ctx, parts, accent, halfW * 2 * shrink * 1.01, 0.3, halfD * 2 * shrink * 1.01, cx, groundY + lowerTop, cz, 0.02);
    studPerimeter(studs, cx, cz, halfW * (1 + shrink) / 2, halfD * (1 + shrink) / 2, groundY + lowerTop + 0.3, accent, { max: 120 });
  }
  const roofY = groundY + top;
  const roof = {};
  const roofTop = flatRoof(ctx, parts, studs, 'lightStoneGrey', cx, cz, halfW * shrink, halfD * shrink, roofY, { capH: 0.3, parapetH: 0.4, out: roof });
  const crown = towerCrown(ctx, parts, studs, rng, { roof, cx, cz, bodyMat: body, accentMat: accent, trimMat });
  const clutter = roofClutter(ctx, parts, studs, rng, {
    cx, cz, deckY: roof.deckY, halfW: roof.innerHalfW, halfD: roof.innerHalfD, menu: TOWER_CLUTTER, maxItems: 4, avoid: crown.avoid,
  });
  if (!crown.mast && clutter.masts === 0) {
    // aviation warning mast + light: every office tower keeps one (round-1 review item 6 sizing)
    cylinder(parts, 'darkStoneGrey', 0.06, 0.08, 3.6, 6, cx, roof.deckY, cz);
    plainBox(parts, 'beacon', 0.26, 0.26, 0.26, cx, roof.deckY + 3.7, cz);
    clutter.masts = 1;
  }
  return {
    parts, studs, height: roofTop - groundY, kind: 'tower-office',
    features: { shopFaces, crown: crown.style, clutter: clutter.placed, masts: clutter.masts, rhythm, setback: split ? +shrink.toFixed(2) : 0 },
  };
}

function generateIndustrial(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const bodyA = pick(rng, IND_BODY_A);
  const bodyB = pick(rng, IND_BODY_B);
  const accent = pick(rng, IND_ACCENT);
  const storyH = b.level === 1 ? 5.4 : b.level === 2 ? 6.2 : 7.2;
  const stripH = storyH / 6;
  const clerPitch = rng.range(1.9, 2.6);
  // corrugated look: alternating horizontal strips
  for (let i = 0; i < 6; i++) {
    box(ctx, parts, i % 2 === 0 ? bodyA : bodyB, halfW * 2, stripH * 1.02, halfD * 2, cx, groundY + i * stripH, cz, 0.02);
  }
  // interior mitigation (round-1 review item 2): the stacked strips together form one solid convex volume, so
  // line it too - reuses bodyA's own bucket, zero extra draw calls.
  interiorLiner(parts, bodyA, halfW * 2, storyH, halfD * 2, cx, groundY, cz);
  plinth(ctx, parts, 'darkStoneGrey', cx, cz, halfW, halfD, groundY, 0.3, 0.06);
  // clerestory windows near the top
  facade(ctx, parts, rng, cx, cz, groundY, {
    axis: 'x', sign: 1, halfW, halfD, floors: [{ y0: storyH - stripH * 1.4, h: stripH * 1.1 }],
    pitch: clerPitch, frameMat: 'darkStoneGrey', glassMat: 'darkAzur', litFrac: b.level >= 2 ? 0.3 : 0.15, warmFrac: 0.3, marginFrac: 0.7,
  });
  facade(ctx, parts, rng, cx, cz, groundY, {
    axis: 'x', sign: -1, halfW, halfD, floors: [{ y0: storyH - stripH * 1.4, h: stripH * 1.1 }],
    pitch: clerPitch, frameMat: 'darkStoneGrey', glassMat: 'darkAzur', litFrac: b.level >= 2 ? 0.3 : 0.15, warmFrac: 0.3, marginFrac: 0.7,
  });
  // loading dock door on the +z facade (front face 2 cm proud of the wall - flush leaves z-fight)
  const dockW = Math.min(halfW * 1.2, 3.2);
  box(ctx, parts, 'darkStoneGrey', dockW, storyH * 0.55, 0.12, cx, groundY + storyH * 0.275, cz + halfD - 0.04, 0.03);
  plainBox(parts, accent, dockW * 1.08, 0.22, 0.16, cx, groundY + storyH * 0.55 + 0.15, cz + halfD - 0.06);
  // roof cap + parapet, fully studded deck
  const parapetH = 0.3;
  const roofInfo = {};
  const roofTop = flatRoof(ctx, parts, studs, accent, cx, cz, halfW, halfD, groundY + storyH, { capH: 0.3, parapetH, out: roofInfo });
  const deckY = roofTop - parapetH;
  const nChimneys = b.level >= 3 ? 2 : 1;
  let lastChimney = null;
  for (let k = 0; k < nChimneys; k++) {
    const px = cx + (k === 0 ? -halfW * 0.45 : halfW * 0.4);
    const pz = cz + (k === 0 ? halfD * 0.4 : -halfD * 0.35);
    const h = 3.4 + rng.range(0, 1.6);
    brickStack(ctx, parts, studs, 'darkStoneGrey', px, pz, 1.3, 1.0, deckY, h);
    if (rng.chance(0.4)) plainBox(parts, 'chimneyGlow', 0.5, 0.22, 0.5, px, deckY + h, pz);
    lastChimney = { x: px, z: pz, h };
  }
  // storage tank (brick base ring + tank + studded cap)
  const tx = cx + halfW * 0.4, tz = cz + halfD * 0.35;
  const tankH = 2.4 + (b.level - 1) * 0.6;
  cylinder(parts, accent === 'brightYellow' ? 'darkOrange' : accent, 1.3, 1.4, tankH, 12, tx, deckY, tz);
  plainBox(parts, 'mediumStoneGrey', 1.5, 0.15, 1.5, tx, deckY + tankH, tz);
  for (const ox of [-0.3, 0.3]) for (const oz of [-0.3, 0.3]) {
    studs.push({ x: tx + ox, y: deckY + tankH + 0.15, z: tz + oz, color: 'mediumStoneGrey' });
  }
  if (b.level >= 2 && lastChimney) {
    // connecting pipe (thin horizontal box) between tank and chimney
    const dx = lastChimney.x - tx, dz = lastChimney.z - tz;
    const len = Math.hypot(dx, dz);
    const midx = (tx + lastChimney.x) / 2, midz = (tz + lastChimney.z) / 2;
    const g = ctx.materials.bevelBox(Math.max(0.3, quant(len)), 0.25, 0.25, 0.03).clone();
    g.rotateY(-Math.atan2(dz, dx));
    g.translate(midx, deckY + 1.0, midz);
    parts.push({ mat: 'darkStoneGrey', geom: g });
  }
  // cycle-3 roof clutter on the free deck (the plant boxes/tanks already placed above are keep-outs)
  const avoid = [{ x: tx, z: tz, r: 1.7 }];
  for (let k = 0; k < nChimneys; k++) avoid.push({ x: cx + (k === 0 ? -halfW * 0.45 : halfW * 0.4), z: cz + (k === 0 ? halfD * 0.4 : -halfD * 0.35), r: 1.0 });
  const clutter = roofClutter(ctx, parts, studs, rng, {
    cx, cz, deckY, halfW: roofInfo.innerHalfW, halfD: roofInfo.innerHalfD,
    menu: LOW_CLUTTER, maxItems: b.level >= 2 ? 3 : 2, avoid,
  });
  return {
    parts, studs,
    height: storyH + 0.3 + tankH, kind: b.level >= 3 ? 'plant' : 'warehouse',
    features: { clutter: clutter.placed },
  };
}

// Civic power plant: a squat industrial hall with two cooling towers, a glowing smokestack, and a small
// transformer yard. Fixed composition (ignores b.level — utility buildings never grow) styled off
// generateIndustrial's corrugated-body look so it reads as "the same city's" architecture.
function generatePowerPlant(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const bodyA = pick(rng, IND_BODY_A);
  const bodyB = pick(rng, IND_BODY_B);
  const accent = pick(rng, IND_ACCENT);
  const storyH = 9.5;
  const stripH = storyH / 7;
  for (let i = 0; i < 7; i++) {
    box(ctx, parts, i % 2 === 0 ? bodyA : bodyB, halfW * 2, stripH * 1.02, halfD * 2, cx, groundY + i * stripH, cz, 0.02);
  }
  interiorLiner(parts, bodyA, halfW * 2, storyH, halfD * 2, cx, groundY, cz);
  plinth(ctx, parts, 'darkStoneGrey', cx, cz, halfW, halfD, groundY, 0.3, 0.06);
  const parapetH = 0.3;
  const roofInfo = {};
  const roofTop = flatRoof(ctx, parts, studs, 'darkStoneGrey', cx, cz, halfW, halfD, groundY + storyH, { capH: 0.35, parapetH, out: roofInfo });
  const deckY = roofTop - parapetH;

  const towerR = Math.min(halfW, halfD) * 0.4;
  const towerH = 9 + rng.range(0, 2);
  const towers = [{ x: cx - halfW * 0.5, z: cz - halfD * 0.5 }, { x: cx + halfW * 0.45, z: cz + halfD * 0.4 }];
  for (const t of towers) {
    cylinder(parts, 'lightStoneGrey', towerR * 0.78, towerR, towerH, 14, t.x, deckY, t.z);
    cylinder(parts, 'mediumStoneGrey', towerR * 0.6, towerR * 0.8, towerH * 0.1, 14, t.x, deckY + towerH, t.z);
    // studded round cap plate (a real Blox element on top of the cooling tower)
    for (const ox of [-0.25, 0.25]) for (const oz of [-0.25, 0.25]) {
      studs.push({ x: t.x + ox, y: deckY + towerH + towerH * 0.1, z: t.z + oz, color: 'mediumStoneGrey' });
    }
  }
  const chimneyH = 7.5 + rng.range(0, 2), chx = cx + halfW * 0.1, chz = cz - halfD * 0.1;
  brickStack(ctx, parts, studs, 'darkStoneGrey', chx, chz, 1.5, 1.2, deckY, chimneyH);
  if (rng.chance(0.7)) plainBox(parts, 'chimneyGlow', 0.7, 0.28, 0.7, chx, deckY + chimneyH, chz);
  plainBox(parts, 'beacon', 0.3, 0.3, 0.3, chx, deckY + chimneyH + 0.35, chz);
  // transformer yard along the +z edge
  for (let k = -1; k <= 1; k += 2) plainBox(parts, accent, 1.1, 1.7, 1.1, cx + k * halfW * 0.7, groundY, cz + halfD - 1.0);
  // cycle-3 roof clutter, kept off the cooling towers and the smokestack
  const clutter = roofClutter(ctx, parts, studs, rng, {
    cx, cz, deckY, halfW: roofInfo.innerHalfW, halfD: roofInfo.innerHalfD, menu: LOW_CLUTTER, maxItems: 2,
    avoid: [{ x: towers[0].x, z: towers[0].z, r: towerR + 0.5 }, { x: towers[1].x, z: towers[1].z, r: towerR + 0.5 }, { x: chx, z: chz, r: 1.3 }],
  });

  return {
    parts, studs,
    height: storyH + 0.35 + towerH, kind: 'power_plant',
    features: { clutter: clutter.placed },
  };
}

// Civic water tower: a tank raised on four lattice legs with cross-bracing. Fixed composition, small footprint.
function generateWaterTower(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const accent = pick(rng, IND_ACCENT);
  const legR = 0.32, legH = 8.5 + rng.range(0, 1.5);
  const inset = Math.min(halfW, halfD) * 0.55;
  const legs = [
    { x: cx - inset, z: cz - inset }, { x: cx + inset, z: cz - inset },
    { x: cx - inset, z: cz + inset }, { x: cx + inset, z: cz + inset },
  ];
  for (const p of legs) cylinder(parts, 'darkStoneGrey', legR, legR * 1.35, legH, 8, p.x, groundY, p.z);
  for (const yFrac of [0.35, 0.72]) {
    const y = groundY + legH * yFrac;
    for (let k = 0; k < 4; k++) {
      const a = legs[k], bp = legs[(k + 1) % 4];
      const dx = bp.x - a.x, dz = bp.z - a.z, len = Math.hypot(dx, dz);
      const g = ctx.materials.bevelBox(Math.max(0.3, quant(len)), 0.15, 0.15, 0.02).clone();
      g.rotateY(-Math.atan2(dz, dx));
      g.translate((a.x + bp.x) / 2, y, (a.z + bp.z) / 2);
      parts.push({ mat: 'darkStoneGrey', geom: g });
    }
  }
  const tankR = Math.min(halfW, halfD) * 0.85, tankH = tankR * 1.3, tankY = groundY + legH;
  cylinder(parts, accent, tankR * 0.3, tankR, tankH * 0.22, 16, cx, tankY, cz);
  cylinder(parts, accent, tankR, tankR, tankH * 0.6, 16, cx, tankY + tankH * 0.22, cz);
  cylinder(parts, 'lightStoneGrey', tankR * 0.05, tankR * 0.92, tankH * 0.18, 16, cx, tankY + tankH * 0.82, cz);
  plainBox(parts, 'lightStoneGrey', 0.5, 0.55, 0.5, cx, tankY + tankH, cz);
  // studded cap plate (2x2 Blox studs) instead of a bare beacon-only cap
  for (const ox of [-0.22, 0.22]) for (const oz of [-0.22, 0.22]) {
    studs.push({ x: cx + ox, y: tankY + tankH + 0.55, z: cz + oz, color: 'lightStoneGrey' });
  }
  plainBox(parts, 'beacon', 0.22, 0.22, 0.22, cx, tankY + tankH + 0.55, cz);

  return {
    parts, studs,
    height: legH + tankH, kind: 'water_tower',
  };
}

// Civic fire department: a low red garage hall with a white door stripe, a small lookout tower, and a beacon.
// Fixed composition (ignores b.level — utility buildings never grow), small 2x2-cell footprint.
function generateFireDepartment(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const storyH = 6.2;
  box(ctx, parts, 'brightRed', halfW * 2, storyH, halfD * 2, cx, groundY, cz, 0.05);
  interiorLiner(parts, 'brightRed', halfW * 2, storyH, halfD * 2, cx, groundY, cz);
  plinth(ctx, parts, 'darkStoneGrey', cx, cz, halfW, halfD, groundY, 0.35, 0.08);
  courseBands(parts, 'white', cx, cz, halfW, halfD, groundY + 0.35, groundY + storyH, { pitch: 1.2 });
  const roofInfo = {};
  const roofTop = flatRoof(ctx, parts, studs, 'darkStoneGrey', cx, cz, halfW, halfD, groundY + storyH, { capH: 0.3, parapetH: 0.35, out: roofInfo });
  // garage door stripe on the +z face (front face 2 cm proud of the wall - flush leaves z-fight)
  plainBox(parts, 'white', halfW * 1.1, storyH * 0.55, 0.12, cx, groundY + storyH * 0.32, cz + halfD - 0.04);
  // lookout tower + beacon, offset toward a back corner
  const towerR = Math.min(halfW, halfD) * 0.42;
  const towerH = 3.5 + rng.range(0, 1);
  const tx = cx - halfW * 0.45, tz = cz - halfD * 0.45;
  cylinder(parts, 'white', towerR, towerR * 1.05, towerH, 10, tx, roofTop, tz);
  cylinder(parts, 'brightRed', towerR * 0.6, towerR * 0.8, 0.35, 10, tx, roofTop + towerH, tz);
  studs.push({ x: tx, y: roofTop + towerH + 0.35, z: tz, color: 'brightRed' });
  plainBox(parts, 'beacon', 0.32, 0.32, 0.32, tx, roofTop + towerH + 0.5, tz);
  // cycle-3 roof clutter on the free deck
  const clutter = roofClutter(ctx, parts, studs, rng, {
    cx, cz, deckY: roofInfo.deckY, halfW: roofInfo.innerHalfW, halfD: roofInfo.innerHalfD,
    menu: LOW_CLUTTER, maxItems: 3, avoid: [{ x: tx, z: tz, r: towerR + 0.4 }],
  });

  return {
    parts, studs,
    height: storyH + 0.65 + towerH + 0.35, kind: 'fire_department',
    features: { clutter: clutter.placed },
  };
}

// Civic police station: a low dark-blue precinct hall with a white band, a glazed front desk bay, a roof sign and
// a blue beacon. Fixed composition (ignores b.level — utility buildings never grow), small 2x2-cell footprint.
function generatePoliceStation(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const storyH = 6.4;
  box(ctx, parts, 'brightBlue', halfW * 2, storyH, halfD * 2, cx, groundY, cz, 0.05);
  interiorLiner(parts, 'brightBlue', halfW * 2, storyH, halfD * 2, cx, groundY, cz);
  plinth(ctx, parts, 'darkStoneGrey', cx, cz, halfW, halfD, groundY, 0.35, 0.08);
  courseBands(parts, 'white', cx, cz, halfW, halfD, groundY + 0.35, groundY + storyH - 0.9, { pitch: 1.2 });
  box(ctx, parts, 'white', halfW * 2 * 1.02, 1.1, halfD * 2 * 1.02, cx, groundY + storyH - 0.9, cz, 0.03);
  const roofInfo = {};
  const roofTop = flatRoof(ctx, parts, studs, 'white', cx, cz, halfW, halfD, groundY + storyH, { capH: 0.3, parapetH: 0.35, out: roofInfo });
  // glazed entrance bay on the +z face, with a white desk stripe behind it (stripe front 2 cm proud of
  // the wall - flush leaves z-fight)
  plainBox(parts, 'white', halfW * 1.15, storyH * 0.5, 0.12, cx, groundY + storyH * 0.3, cz + halfD - 0.04);
  plainBox(parts, 'transBlue', halfW * 1.05, storyH * 0.42, 0.06, cx, groundY + storyH * 0.3, cz + halfD - 0.02);
  // roof sign (white board + blue badge block) and a blue beacon on a short mast, toward a back corner
  const sx = cx + halfW * 0.35, sz = cz - halfD * 0.3;
  plainBox(parts, 'white', 2.2, 1.1, 0.22, sx, roofTop + 0.55, sz);
  plainBox(parts, 'brightBlue', 0.7, 0.7, 0.1, sx, roofTop + 0.55, sz + 0.16);
  const mastH = 1.6 + rng.range(0, 0.6);
  cylinder(parts, 'lightStoneGrey', 0.09, 0.12, mastH, 8, cx - halfW * 0.5, roofTop, cz - halfD * 0.5);
  plainBox(parts, 'beaconBlue', 0.32, 0.32, 0.32, cx - halfW * 0.5, roofTop + mastH + 0.2, cz - halfD * 0.5);
  // cycle-3 roof clutter, kept clear of the sign and the beacon mast
  const clutter = roofClutter(ctx, parts, studs, rng, {
    cx, cz, deckY: roofInfo.deckY, halfW: roofInfo.innerHalfW, halfD: roofInfo.innerHalfD, menu: LOW_CLUTTER, maxItems: 3,
    avoid: [{ x: sx, z: sz, r: 1.5 }, { x: cx - halfW * 0.5, z: cz - halfD * 0.5, r: 0.6 }],
  });

  return {
    parts, studs,
    height: storyH + 0.65 + mastH + 0.4, kind: 'police_station',
    features: { clutter: clutter.placed },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Civic services (school / hospital). Fixed compositions (ignore b.level — civic buildings never grow) on small
// 2x2-cell footprints. Coverage radius / effects live in simulation/model.js.

/** A mullioned grid of inset lit panes (the emissive window overlays). One big overlay reads as a single
 *  emissive slab at close range (civics r1 item 2); a rows×cols grid leaves the dark glazing visible as mullion
 *  gaps between panes. `w`/`h` are the overlay's overall size, `axis` its outward normal ('z' or 'x'). */
function litPaneGrid(parts, mat, w, h, rows, cols, x, y, z, axis = 'z') {
  const gap = 0.16;
  const pw = (w - gap * (cols - 1)) / cols;
  const ph = (h - gap * (rows - 1)) / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ox = -w / 2 + pw / 2 + c * (pw + gap);
      const oy = y - h / 2 + ph / 2 + r * (ph + gap);
      if (axis === 'z') plainBox(parts, mat, pw, ph, 0.02, x + ox, oy, z);
      else plainBox(parts, mat, 0.02, ph, pw, x, oy, z + ox);
    }
  }
}

// Civic school: a low ochre classroom hall with white course bands, glazed bays, a red-canopied entrance and a
// bell tower (brick stack, warm bell, red pyramid cap, flag).
function generateSchool(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const storyH = 6.0;
  box(ctx, parts, 'brightYellow', halfW * 2, storyH, halfD * 2, cx, groundY, cz, 0.05);
  interiorLiner(parts, 'brightYellow', halfW * 2, storyH, halfD * 2, cx, groundY, cz);
  plinth(ctx, parts, 'darkStoneGrey', cx, cz, halfW, halfD, groundY, 0.35, 0.08);
  courseBands(parts, 'white', cx, cz, halfW, halfD, groundY + 0.35, groundY + storyH, { pitch: 1.3 });
  const roofInfo = {};
  const roofTop = flatRoof(ctx, parts, studs, 'darkStoneGrey', cx, cz, halfW, halfD, groundY + storyH, { capH: 0.3, parapetH: 0.35, out: roofInfo });
  // classroom windows on the long (+z / -z) faces: white frame, dark liner (front face 0.01 proud of the frame so
  // it is what the glass shows, not the white slab), trans-blue glazing; about half get a mullioned 2x2 grid of lit
  // panes (winWarm/winCool emissive, dead by day — see buildings/index.js updateNight). The liner keeps unlit bays
  // reading as glass by day (r2 critic item 1: without it ~45 % of bays were blank pale panels, white-on-white).
  for (const sz of [1, -1]) {
    for (const ox of [-1, 1]) {
      const wx = cx + ox * halfW * 0.48, wz = cz + sz * halfD;
      plainBox(parts, 'white', 3.6, 2.5, 0.12, wx, groundY + 3.2, wz + sz * 0.06);
      plainBox(parts, 'darkStoneGrey', 3.1, 2.05, 0.04, wx, groundY + 3.2, wz + sz * 0.11);
      plainBox(parts, 'transBlue', 3.1, 2.05, 0.08, wx, groundY + 3.2, wz + sz * 0.17);
      if (rng.chance(0.55)) litPaneGrid(parts, rng.chance(0.5) ? 'winWarm' : 'winCool', 2.7, 1.75, 2, 2, wx, groundY + 3.2, wz + sz * 0.22);
    }
  }
  // matching bay on each short (±x) face — r1 critic item 1: the school's side walls were entirely windowless
  for (const sx of [1, -1]) {
    const wx = cx + sx * halfW, wz = cz;
    plainBox(parts, 'white', 0.12, 2.5, 3.6, wx + sx * 0.06, groundY + 3.2, wz);
    plainBox(parts, 'darkStoneGrey', 0.04, 2.05, 3.1, wx + sx * 0.11, groundY + 3.2, wz);
    plainBox(parts, 'transBlue', 0.08, 2.05, 3.1, wx + sx * 0.17, groundY + 3.2, wz);
    if (rng.chance(0.55)) litPaneGrid(parts, rng.chance(0.5) ? 'winWarm' : 'winCool', 2.7, 1.75, 2, 2, wx + sx * 0.22, groundY + 3.2, wz, 'x');
  }
  // entrance on the +z face: white portal, tinted double door (dark liner + white frame + centre mullion), red
  // canopy. r1 critic item 3: the old transClear pane read as a flat white panel by day.
  plainBox(parts, 'white', 3.6, 3.4, 0.14, cx, groundY + 1.9, cz + halfD - 0.02);
  plainBox(parts, 'darkStoneGrey', 2.4, 2.7, 0.05, cx, groundY + 1.55, cz + halfD + 0.035);
  plainBox(parts, 'transBlue', 2.4, 2.7, 0.07, cx, groundY + 1.55, cz + halfD + 0.095);
  plainBox(parts, 'white', 0.16, 2.55, 0.09, cx, groundY + 1.5, cz + halfD + 0.155);
  plainBox(parts, 'white', 2.4, 0.16, 0.09, cx, groundY + 2.75, cz + halfD + 0.155);
  plainBox(parts, 'brightRed', 4.2, 0.22, 1.1, cx, groundY + 3.75, cz + halfD + 0.5);
  // bell tower at a back corner: brick stack, warm bell, red pyramid cap, flag
  const tx = cx - halfW * 0.52, tz = cz - halfD * 0.52;
  const towerH = 3.4 + rng.range(0, 0.8);
  brickStack(ctx, parts, studs, 'brightYellow', tx, tz, 2.0, 2.0, roofTop, towerH, { studTop: false });
  plainBox(parts, 'white', 0.9, 0.7, 0.9, tx, roofTop + towerH - 0.55, tz);
  cylinder(parts, 'brightRed', 0.02, 1.65, 1.15, 4, tx, roofTop + towerH, tz);
  const poleH = 1.6;
  cylinder(parts, 'lightStoneGrey', 0.06, 0.07, poleH, 6, tx, roofTop + towerH + 1.15, tz);
  plainBox(parts, 'brightRed', 0.9, 0.55, 0.06, tx + 0.48, roofTop + towerH + 1.15 + poleH - 0.4, tz);
  // cycle-3 roof clutter on the classroom hall roof, kept clear of the bell tower
  const clutter = roofClutter(ctx, parts, studs, rng, {
    cx, cz, deckY: roofInfo.deckY, halfW: roofInfo.innerHalfW, halfD: roofInfo.innerHalfD, menu: LOW_CLUTTER, maxItems: 3,
    avoid: [{ x: tx, z: tz, r: 1.7 }],
  });

  return {
    parts, studs,
    height: storyH + 0.65 + towerH + 1.15 + poleH, kind: 'school',
    features: { clutter: clutter.placed },
  };
}

// Civic hospital: a white ward block with grey courses, a glazed entrance under a big red cross, an ambulance bay
// and a rooftop helipad with a white H plus a red beacon. Fixed composition (ignores b.level), 2x2-cell footprint.
function generateHospital(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const storyH = 7.4;
  box(ctx, parts, 'white', halfW * 2, storyH, halfD * 2, cx, groundY, cz, 0.05);
  interiorLiner(parts, 'white', halfW * 2, storyH, halfD * 2, cx, groundY, cz);
  plinth(ctx, parts, 'lightStoneGrey', cx, cz, halfW, halfD, groundY, 0.35, 0.08);
  courseBands(parts, 'lightStoneGrey', cx, cz, halfW, halfD, groundY + 0.35, groundY + storyH, { pitch: 1.3 });
  const roofInfo = {};
  const roofTop = flatRoof(ctx, parts, studs, 'lightStoneGrey', cx, cz, halfW, halfD, groundY + storyH, { capH: 0.3, parapetH: 0.35, out: roofInfo });
  const deck = roofTop - 0.35;
  // entrance on the +z face: tinted glazed bay over a dark liner with a white frame (r1 item 3 — flat 4.6×3.0
  // transClear read as a white panel by day), white canopy, lit sign board behind a red cross (the cross bars
  // and the board sit at strictly increasing depths so no two faces are coplanar)
  plainBox(parts, 'darkStoneGrey', 4.6, 3.0, 0.05, cx, groundY + 1.7, cz + halfD + 0.035);
  plainBox(parts, 'transBlue', 4.6, 3.0, 0.07, cx, groundY + 1.7, cz + halfD + 0.095);
  plainBox(parts, 'white', 0.18, 3.0, 0.09, cx, groundY + 1.7, cz + halfD + 0.155);
  plainBox(parts, 'white', 4.6, 0.18, 0.09, cx, groundY + 3.11, cz + halfD + 0.155);
  plainBox(parts, 'white', 5.6, 0.22, 1.3, cx, groundY + 3.55, cz + halfD + 0.5);
  plainBox(parts, 'signGlow', 3.2, 3.2, 0.06, cx, groundY + 4.9, cz + halfD + 0.04);
  plainBox(parts, 'crossGlow', 0.85, 2.2, 0.12, cx, groundY + 4.9, cz + halfD + 0.10);
  plainBox(parts, 'crossGlow', 2.2, 0.85, 0.12, cx, groundY + 4.9, cz + halfD + 0.14);
  // ward windows: four framed, glazed bays per ±x face and two on the back (-z) — r1 critic item 1 (the building
  // read as a plain box from three of four sides). Lit overlays are split vertically into two panes (item 2) and
  // sized inside the glazing (r2 critic item 2: a 2.0 m grid over 1.6 m glass spilled onto the frame as black
  // bands by day); a dark liner sits proud of the frame face behind each pane so unlit bays read as glass by day
  // (r2 critic item 1). Depths: frame front 0.11, liner [0.08,0.12], glazing [0.12,0.20], lit overlay [0.20,0.22].
  for (const sx of [1, -1]) {
    for (const oz of [-0.72, -0.27, 0.27, 0.72]) {
      const wx = cx + sx * halfW, wz = cz + oz * halfD;
      plainBox(parts, 'lightStoneGrey', 0.12, 2.0, 2.6, wx + sx * 0.05, groundY + 4.7, wz);
      plainBox(parts, 'darkStoneGrey', 0.04, 1.6, 2.2, wx + sx * 0.10, groundY + 4.7, wz);
      plainBox(parts, 'transBlue', 0.08, 1.6, 2.2, wx + sx * 0.16, groundY + 4.7, wz);
      if (rng.chance(0.6)) litPaneGrid(parts, 'winCool', 1.45, 1.35, 2, 1, wx + sx * 0.21, groundY + 4.7, wz, 'x');
    }
  }
  for (const ox of [-0.45, 0.45]) {
    const wx = cx + ox * halfW, wz = cz - halfD;
    plainBox(parts, 'lightStoneGrey', 2.6, 2.0, 0.12, wx, groundY + 4.7, wz - 0.05);
    plainBox(parts, 'darkStoneGrey', 2.2, 1.6, 0.04, wx, groundY + 4.7, wz - 0.10);
    plainBox(parts, 'transBlue', 2.2, 1.6, 0.08, wx, groundY + 4.7, wz - 0.16);
    if (rng.chance(0.6)) litPaneGrid(parts, 'winCool', 1.45, 1.35, 2, 1, wx, groundY + 4.7, wz - 0.21, 'z');
  }
  // side service door on the -x face at street level (r1 item 1), with a small canopy
  const dx = cx - halfW;
  plainBox(parts, 'lightStoneGrey', 0.14, 2.8, 1.7, dx - 0.03, groundY + 1.4, cz + halfD * 0.35);
  plainBox(parts, 'transBlue', 0.08, 2.3, 1.3, dx - 0.10, groundY + 1.35, cz + halfD * 0.35);
  plainBox(parts, 'white', 0.7, 0.16, 2.0, dx - 0.28, groundY + 2.9, cz + halfD * 0.35);
  // ambulance bay on the -z face
  plainBox(parts, 'brightRed', 3.4, 3.0, 0.14, cx - halfW * 0.4, groundY + 1.55, cz - halfD - 0.05);
  // rooftop helipad + white H, and a red beacon mast at the opposite corner
  const hx = cx + halfW * 0.42, hz = cz + halfD * 0.35;
  cylinder(parts, 'mediumStoneGrey', 3.0, 3.0, 0.26, 16, hx, deck, hz);
  plainBox(parts, 'white', 0.5, 0.1, 3.2, hx - 0.85, deck + 0.31, hz);
  plainBox(parts, 'white', 0.5, 0.1, 3.2, hx + 0.85, deck + 0.31, hz);
  plainBox(parts, 'white', 1.7, 0.1, 0.5, hx, deck + 0.31, hz);
  const mastH = 1.5 + rng.range(0, 0.5);
  cylinder(parts, 'lightStoneGrey', 0.07, 0.09, mastH, 8, cx - halfW * 0.5, deck, cz - halfD * 0.5);
  plainBox(parts, 'beacon', 0.3, 0.3, 0.3, cx - halfW * 0.5, deck + mastH + 0.15, cz - halfD * 0.5);
  // cycle-3 roof clutter on the ward-block deck, kept clear of the helipad and the beacon mast
  const clutter = roofClutter(ctx, parts, studs, rng, {
    cx, cz, deckY: roofInfo.deckY, halfW: roofInfo.innerHalfW, halfD: roofInfo.innerHalfD, menu: LOW_CLUTTER, maxItems: 3,
    avoid: [{ x: hx, z: hz, r: 3.6 }, { x: cx - halfW * 0.5, z: cz - halfD * 0.5, r: 0.6 }],
  });

  return {
    parts, studs,
    height: storyH + 0.65 + mastH + 0.3, kind: 'hospital',
    features: { clutter: clutter.placed },
  };
}

/** Generate a building's world-space geometry parts + roof stud points + computed height/kind. */
export function generateBuilding(ctx, b, rng) {
  const cs = ctx.world.cellSize;
  const marginBase = 0.75;
  const Wx = b.w * cs - marginBase * 2;
  const Dz = b.d * cs - marginBase * 2;
  const halfW = Wx / 2, halfD = Dz / 2;
  const x0 = ctx.world.minX + b.i * cs, z0 = ctx.world.minZ + b.j * cs;
  const cx = x0 + (b.w * cs) / 2, cz = z0 + (b.d * cs) / 2;
  const terr = ctx.modules.get('terrain');
  const groundY = (terr?.status === 'ok' && typeof terr.api?.surfaceHeight === 'function')
    ? terr.api.surfaceHeight(cx, cz) : ctx.world.getHeight(cx, cz);

  let out;
  if (b.kind === 'power_plant') out = generatePowerPlant(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else if (b.kind === 'water_tower') out = generateWaterTower(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else if (b.kind === 'fire_department') out = generateFireDepartment(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else if (b.kind === 'police_station') out = generatePoliceStation(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else if (b.kind === 'school') out = generateSchool(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else if (b.kind === 'hospital') out = generateHospital(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else if (b.zone === 'c') out = generateCommercial(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else if (b.zone === 'i') out = generateIndustrial(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else out = generateResidential(ctx, b, rng, halfW, halfD, cx, cz, groundY);

  // Zone generators emit stud points already in world space (the stud helpers take world cx/cz directly).
  return { parts: out.parts, studs: out.studs, height: out.height, kind: out.kind, baseY: groundY, cx, cz, features: out.features || null };
}
