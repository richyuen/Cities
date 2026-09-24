import * as THREE from 'three';
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
function plainBox(parts, mat, w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d)).toNonIndexed();
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
function interiorLiner(parts, mat, w, h, d, x, y, z) {
  const marginXZ = 0.14, marginTop = 0.22;
  const lw = Math.max(0.2, w - marginXZ * 2);
  const ld = Math.max(0.2, d - marginXZ * 2);
  const lh = Math.max(0.2, h - marginTop);
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
  g.translate(x, y + lh / 2, z); // base at y, same as the outer box's own base
  parts.push({ mat, geom: g });
}

/** One facade band of windows. axis: 'x' or 'z' is the OUTWARD normal axis; sign: +1 or -1. */
function facade(ctx, parts, rng, cx, cz, groundY, o) {
  const { axis, sign, halfW, halfD, floors, pitch, frameMat, glassMat, litFrac, warmFrac,
    marginFrac = 0.78, minCols = 1, winWFrac = 0.62, winHFrac = 0.58, wide = false, frameBezel = 0.16 } = o;
  const normalOffset = axis === 'x' ? halfW : halfD;
  const tangentHalf = axis === 'x' ? halfD : halfW;
  const span = tangentHalf * 2 * marginFrac;
  const cols = Math.max(minCols, Math.round(span / pitch));
  const colPitch = span / cols;
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

/** Alternating corner bricks: each course protrudes along X or Z, giving the classic running-bond corner. */
function cornerBricks(parts, mat, cx, cz, halfW, halfD, y0, y1, { pitch = 1.2, len = 1.0, thick = 0.55, proud = 0.07 } = {}) {
  let k = 0;
  for (let y = y0; y < y1 - 0.3; y += pitch, k++) {
    const h = Math.min(pitch * 0.92, y1 - y);
    if (h < 0.25) break;
    const cy = y + h / 2;
    const alongX = k % 2 === 0;
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const w = alongX ? len : thick;
        const d = alongX ? thick : len;
        const x = cx + sx * (halfW + (alongX ? proud - len / 2 : -thick / 2));
        const z = cz + sz * (halfD + (alongX ? -thick / 2 : proud - len / 2));
        plainBox(parts, mat, w, h, d, x, cy, z);
      }
    }
  }
}

/** Stepped brick roof: stacked plate courses with studs on each exposed step. Returns the ridge height. */
function steppedRoof(ctx, parts, studs, mat, cx, cz, spanX, spanZ, baseY, roofH, rng) {
  const steps = THREE.MathUtils.clamp(Math.round(roofH / 0.5), 3, 5);
  const stepH = roofH / steps;
  const insetX = (spanX * rng.range(0.45, 0.6)) / 2 / steps;
  const insetZ = (spanZ * rng.range(0.45, 0.6)) / 2 / steps;
  let w = spanX, d = spanZ, y = baseY;
  for (let k = 0; k < steps; k++) {
    const g = ctx.materials.bevelBox(quant(w), quant(stepH * 1.03), quant(d), 0.05).clone();
    g.translate(cx, y, cz);
    parts.push({ mat, geom: g });
    y += stepH;
    const last = k === steps - 1;
    const nw = last ? 0 : Math.max(0.8, w - insetX * 2);
    const nd = last ? 0 : Math.max(0.8, d - insetZ * 2);
    if (last) {
      studGrid(studs, cx, cz, w / 2, d / 2, y, mat, { max: 120 });
    } else {
      // The exposed step is only as wide as the next step's inset, so a 0.4 m world-grid inset would leave no
      // room for a stud at all: run one centred row of studs along the middle of the ledge instead.
      studPerimeter(studs, cx, cz, (w + nw) / 4, (d + nd) / 4, y, mat, { max: 60 });
    }
    w = nw; d = nd;
  }
  return y;
}

/** Flat roof: proud cap plate, brick parapet ring with a stud row on top, and a studded deck inside. */
function flatRoof(ctx, parts, studs, mat, cx, cz, halfW, halfD, y, opts = {}) {
  const { capH = 0.3, over = 0.03, parapetH = 0.35, parapetT = 0.36 } = opts;
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
function generateResidential(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const body = pick(rng, RESI_BODY);
  // Frame must contrast the wall regardless of body colour or windows disappear at any distance - keep it dark.
  const frameMat = rng.chance(0.25) ? 'black' : 'darkStoneGrey';
  const glassMat = rng.chance(0.75) ? 'transClear' : 'transBlue';
  const plinthMat = rng.chance(0.5) ? 'darkStoneGrey' : 'lightStoneGrey';

  if (b.level <= 1) {
    const twoStory = rng.chance(0.35);
    const groundH = 3.0, upperH = 2.7;
    const { floors, top } = floorList(twoStory ? 2 : 1, groundH, upperH);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    plinth(ctx, parts, plinthMat, cx, cz, halfW, halfD, groundY);
    courseBands(parts, body, cx, cz, halfW, halfD, groundY + 0.35, groundY + top, { pitch: 1.2 });
    const roofH = 2.0 + rng.range(-0.3, 0.5);
    const roofMat = pick(rng, RESI_ROOF);
    steppedRoof(ctx, parts, studs, roofMat, cx, cz, halfW * 2 * 1.08, halfD * 2 * 1.08, groundY + top, roofH, rng);
    allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors, {
      pitch: 1.7, frameMat, glassMat, litFrac: 0.42, warmFrac: 0.85, minCols: 1, marginFrac: 0.6,
    });
    // door on the +z facade
    plainBox(parts, 'darkStoneGrey', 1.0, 1.9, 0.12, cx, groundY + 0.95, cz + halfD - 0.06);
    if (rng.chance(0.55)) plainBox(parts, 'porchWarm', 0.35, 0.22, 0.06, cx + 0.7, groundY + 1.9, cz + halfD - 0.03);
    // squared brick chimney stack (stud on the cap) instead of a smooth cylinder
    if (rng.chance(0.75)) {
      brickStack(ctx, parts, studs, rng.chance(0.5) ? 'reddishBrown' : 'darkStoneGrey',
        cx + halfW * rng.range(0.35, 0.6), cz - halfD * rng.range(0.3, 0.6), 1.15, 0.85,
        groundY + top + roofH * 0.28, 1.5 + rng.range(0, 0.9));
    }
    // garden hint: a couple of hedge blobs near the door
    if (halfW > 2) {
      plainBox(parts, 'darkGreen', 0.7, 0.55, 0.6, cx - halfW + 0.6, groundY, cz + halfD - 0.5);
      plainBox(parts, 'darkGreen', 0.6, 0.45, 0.5, cx + halfW - 0.55, groundY, cz + halfD - 0.45);
    }
    return { parts, studs, height: top + roofH, kind: 'house' };
  }

  if (b.level === 2) {
    const groundH = 3.2, upperH = 2.95;
    const floorsN = rng.int(3, 5);
    const { floors, top } = floorList(floorsN, groundH, upperH);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    plinth(ctx, parts, plinthMat, cx, cz, halfW, halfD, groundY);
    const capMat = pick(rng, RESI_ROOF);
    floorBands(parts, capMat, cx, cz, halfW, halfD, floors, groundY);
    courseBands(parts, body, cx, cz, halfW, halfD, groundY + 0.35, groundY + top, { pitch: 1.2 });
    allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors, {
      pitch: 1.5, frameMat, glassMat, litFrac: 0.4, warmFrac: 0.8, marginFrac: 0.75,
    });
    // balcony ledges on the +z facade every other floor, studded on top
    for (let i = 1; i < floorsN; i += 2) {
      const by = groundY + floors[i].y0;
      plainBox(parts, 'lightStoneGrey', halfW * 1.5, 0.14, 0.9, cx, by + 0.07, cz + halfD + 0.3);
      studGrid(studs, cx, cz + halfD + 0.3, halfW * 0.75, 0.45, by + 0.14, 'lightStoneGrey', { inset: 0.18, align: 'center', max: 24 });
    }
    const roofTop = flatRoof(ctx, parts, studs, capMat, cx, cz, halfW, halfD, groundY + top, { capH: 0.35 });
    // roof greebles: vent stack + water tank
    brickStack(ctx, parts, studs, 'mediumStoneGrey', cx - halfW * 0.45, cz + halfD * 0.4, 0.9, 0.7, roofTop, 0.7);
    if (rng.chance(0.6)) {
      cylinder(parts, 'lightStoneGrey', 0.55, 0.6, 1.0, 10, cx + halfW * 0.4, roofTop, cz - halfD * 0.4);
      studs.push({ x: cx + halfW * 0.4, y: roofTop + 1.0, z: cz - halfD * 0.4, color: 'lightStoneGrey' });
    }
    return { parts, studs, height: roofTop - groundY, kind: 'apartment' };
  }

  // level 3: apartment tower
  const groundH = 3.4, upperH = 3.0;
  const floorsN = rng.int(9, 16);
  const { floors, top } = floorList(floorsN, groundH, upperH);
  const setbackAt = floorsN - rng.int(2, 4);
  const towerBody = pick(rng, RESI_TOWER_BODY);
  const accent = pick(rng, RESI_TOWER_ACCENT);
  const lowerTop = floors[Math.min(setbackAt, floorsN - 1)].y0;
  box(ctx, parts, towerBody, halfW * 2, lowerTop, halfD * 2, cx, groundY, cz);
  interiorLiner(parts, towerBody, halfW * 2, lowerTop, halfD * 2, cx, groundY, cz);
  const shrink = 0.82;
  box(ctx, parts, towerBody, halfW * 2 * shrink, top - lowerTop, halfD * 2 * shrink, cx, groundY + lowerTop, cz);
  interiorLiner(parts, towerBody, halfW * 2 * shrink, top - lowerTop, halfD * 2 * shrink, cx, groundY + lowerTop, cz);
  // accent banding at the setback line
  box(ctx, parts, accent, halfW * 2 * shrink * 1.01, 0.3, halfD * 2 * shrink * 1.01, cx, groundY + lowerTop, cz, 0.02);
  // studs on the exposed setback ledge (a real Blox terrace around the upper tower), walked along the middle
  // of the ledge so they never bunch at the corners
  studPerimeter(studs, cx, cz, halfW * (1 + shrink) / 2, halfD * (1 + shrink) / 2, groundY + lowerTop + 0.3, accent, { max: 120 });
  allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors.filter((f) => f.y0 < lowerTop), {
    pitch: 1.4, frameMat, glassMat, litFrac: 0.5, warmFrac: 0.75, marginFrac: 0.8,
  });
  allFacades(ctx, parts, rng, cx, cz, groundY, halfW * shrink, halfD * shrink, floors.filter((f) => f.y0 >= lowerTop).map((f) => ({ ...f, y0: f.y0 })), {
    pitch: 1.4, frameMat, glassMat, litFrac: 0.5, warmFrac: 0.75, marginFrac: 0.8,
  });
  // brick coursing: floor slabs, course lines and alternating corner bricks on both sections
  floorBands(parts, accent, cx, cz, halfW, halfD, floors.filter((f) => f.y0 < lowerTop), groundY);
  floorBands(parts, accent, cx, cz, halfW * shrink, halfD * shrink, floors.filter((f) => f.y0 >= lowerTop), groundY);
  courseBands(parts, towerBody, cx, cz, halfW, halfD, groundY + 0.5, groundY + lowerTop, { pitch: 1.2 });
  courseBands(parts, towerBody, cx, cz, halfW * shrink, halfD * shrink, groundY + lowerTop + 0.4, groundY + top, { pitch: 1.2 });
  cornerBricks(parts, accent, cx, cz, halfW, halfD, groundY + 0.5, groundY + lowerTop);
  cornerBricks(parts, accent, cx, cz, halfW * shrink, halfD * shrink, groundY + lowerTop + 0.5, groundY + top);
  const roofY = groundY + top;
  const roofTop = flatRoof(ctx, parts, studs, accent, cx, cz, halfW * shrink, halfD * shrink, roofY, { capH: 0.3 });
  brickStack(ctx, parts, studs, 'lightStoneGrey', cx + halfW * shrink * 0.4, cz - halfD * shrink * 0.35, 1.3, 1.0, roofTop, 0.9);
  cylinder(parts, 'mediumStoneGrey', 0.9, 1.0, 1.6, 10, cx - halfW * shrink * 0.4, roofTop, cz + halfD * shrink * 0.3);
  studs.push({ x: cx - halfW * shrink * 0.4, y: roofTop + 1.6, z: cz + halfD * shrink * 0.3, color: 'mediumStoneGrey' });
  if (floorsN >= 12) {
    cylinder(parts, 'darkStoneGrey', 0.06, 0.08, 3.2, 6, cx, roofTop, cz);
    // aviation warning light: emissive block at the antenna tip (sized up from a barely-visible 0.14m cube so
    // its bloom actually registers at showcase distance, per round-1 review item 6)
    plainBox(parts, 'beacon', 0.26, 0.26, 0.26, cx, roofTop + 3.2, cz);
  }
  return { parts, studs, height: roofTop - groundY, kind: 'tower' };
}

function generateCommercial(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const body = pick(rng, COMM_BODY);
  const accent = pick(rng, COMM_ACCENT);
  const glassMat = pick(rng, COMM_GLASS);
  // A bit of frame variation (matches the residential 25/75 split) instead of a flat fixed grey - more contrast.
  const frameMat = rng.chance(0.3) ? 'black' : 'darkStoneGrey';
  const plinthMat = rng.chance(0.5) ? 'darkStoneGrey' : 'mediumStoneGrey';

  if (b.level <= 1) {
    const floorsN = rng.chance(0.4) ? 2 : 1;
    const groundH = 4.1, upperH = 3.4;
    const { floors, top } = floorList(floorsN, groundH, upperH);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    plinth(ctx, parts, plinthMat, cx, cz, halfW, halfD, groundY);
    floorBands(parts, accent, cx, cz, halfW, halfD, floors, groundY);
    courseBands(parts, body, cx, cz, halfW, halfD, groundY + 0.35, groundY + top, { pitch: 1.2 });
    // storefront glass: wide ground-floor windows on all sides
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: 1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: -1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: 1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: -1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
    if (floorsN > 1) allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, [floors[1]], { pitch: 1.6, frameMat, glassMat, litFrac: 0.4, warmFrac: 0.6, marginFrac: 0.75 });
    // awning + sign on the +z front
    box(ctx, parts, accent, halfW * 1.7, 0.28, 0.55, cx, groundY + floors[0].h - 0.1, cz + halfD - 0.1, 0.03);
    // studs on the awning top (a real plate canopy)
    studGrid(studs, cx, cz + halfD - 0.1, halfW * 0.85, 0.275, groundY + floors[0].h + 0.18, accent, { inset: 0.14, align: 'center', max: 24 });
    box(ctx, parts, accent, halfW * 1.3, 0.9, 0.1, cx, groundY + floors[0].h + 0.55, cz + halfD - 0.02, 0.04);
    plainBox(parts, 'signGlow', halfW * 1.1, 0.55, 0.04, cx, groundY + floors[0].h + 0.55, cz + halfD + 0.03);
    const roofTop = flatRoof(ctx, parts, studs, 'lightStoneGrey', cx, cz, halfW, halfD, groundY + top, { capH: 0.3 });
    return { parts, studs, height: roofTop - groundY, kind: 'shop' };
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
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: 1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.35, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: -1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.35, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: 1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.35, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: -1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.35, wide: true, marginFrac: 0.85 });
    allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors.slice(1), { pitch: 1.5, frameMat, glassMat, litFrac: 0.5, warmFrac: 0.45, marginFrac: 0.82, winWFrac: 0.78 });
    const roofTop = flatRoof(ctx, parts, studs, 'lightStoneGrey', cx, cz, halfW, halfD, groundY + top, { capH: 0.3 });
    brickStack(ctx, parts, studs, 'mediumStoneGrey', cx - halfW * 0.45, cz + halfD * 0.35, 1.2, 0.9, roofTop, 0.8);
    cylinder(parts, 'mediumStoneGrey', 0.7, 0.75, 1.1, 8, cx + halfW * 0.4, roofTop, cz - halfD * 0.4);
    studs.push({ x: cx + halfW * 0.4, y: roofTop + 1.1, z: cz - halfD * 0.4, color: 'mediumStoneGrey' });
    return { parts, studs, height: roofTop - groundY, kind: 'office' };
  }

  // level 3: office tower, curtain-wall glass
  const groundH = 4.4, upperH = 3.6;
  const floorsN = rng.int(12, 22);
  const { floors, top } = floorList(floorsN, groundH, upperH);
  box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
  interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
  plinth(ctx, parts, plinthMat, cx, cz, halfW, halfD, groundY);
  // corner pilasters - inflated outward (both faces of the corner) by `inflate` past the wall so they read as a
  // proud brick with a real highlight/shadow edge, not a flush painted stripe (round-1 review item 1: the old
  // pilaster's outer face landed exactly on cx+sx*halfW, coincident with the wall itself).
  const pw = 0.55, inflate = 0.07;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    box(ctx, parts, accent, pw, top, pw, cx + sx * (halfW - pw / 2 + inflate), groundY, cz + sz * (halfD - pw / 2 + inflate), 0.03);
  }
  // Curtain-wall facade brought up to residential's relief/contrast level (round-1 review item 3): a wider
  // frame bezel (frameBezel) and less edge-to-edge glazing (no `wide`, a lower winWFrac/marginFrac) so real wall
  // reveal shows between panes, plus per-floor spandrel bands below for storey-by-storey AO/shadow definition.
  allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors, {
    pitch: 1.5, frameMat, glassMat, litFrac: 0.58, warmFrac: 0.45, marginFrac: 0.84, winWFrac: 0.74, frameBezel: 0.34,
  });
  // Brick coursing between the spandrels: course lines plus alternating corner bricks on the pilasters.
  courseBands(parts, body, cx, cz, halfW, halfD, groundY + 0.35, groundY + top, { pitch: 1.2 });
  cornerBricks(parts, accent, cx, cz, halfW + inflate, halfD + inflate, groundY + 0.6, groundY + top, { pitch: 1.2, len: 1.1, thick: 0.62, proud: 0.06 });
  // Spandrel corners must clear the pilaster's rounded (bevelBox) corner, not just match its flat-face inflate:
  // at exactly `inflate` the spandrel's sharp plainBox corner sits coincident with the pilaster's curved surface
  // (which recedes inward from the AABB corner by the bevel radius), causing a hairline z-fight/self-shadow seam
  // right at the pilaster-spandrel junction (round-2 review item 2). `spandrelPad` pushes the spandrel corner
  // fully past that curvature so it unambiguously wraps the pilaster there - both are the same accent colour, so
  // the few extra millimetres read as continuous trim, not a step.
  const spandrelPad = inflate + 0.06;
  for (let i = 1; i < floorsN; i++) {
    plainBox(parts, accent, halfW * 2 + spandrelPad * 2, 0.12, halfD * 2 + spandrelPad * 2, cx, groundY + floors[i].y0, cz);
  }
  const roofY = groundY + top;
  const roofTop = flatRoof(ctx, parts, studs, 'lightStoneGrey', cx, cz, halfW, halfD, roofY, { capH: 0.3, parapetH: 0.4 });
  brickStack(ctx, parts, studs, 'mediumStoneGrey', cx + halfW * 0.35, cz - halfD * 0.35, 1.4, 1.0, roofTop, 1.0);
  cylinder(parts, 'mediumStoneGrey', 1.0, 1.1, 1.8, 10, cx - halfW * 0.35, roofTop, cz + halfD * 0.35);
  studs.push({ x: cx - halfW * 0.35, y: roofTop + 1.8, z: cz + halfD * 0.35, color: 'mediumStoneGrey' });
  cylinder(parts, 'darkStoneGrey', 0.06, 0.08, 3.6, 6, cx, roofTop, cz);
  // aviation warning light: sized up from a barely-visible 0.14m cube (round-1 review item 6)
  plainBox(parts, 'beacon', 0.26, 0.26, 0.26, cx, roofTop + 3.55, cz);
  return { parts, studs, height: roofTop - groundY, kind: 'tower-office' };
}

function generateIndustrial(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const studs = [];
  const bodyA = pick(rng, IND_BODY_A);
  const bodyB = pick(rng, IND_BODY_B);
  const accent = pick(rng, IND_ACCENT);
  const storyH = b.level === 1 ? 5.4 : b.level === 2 ? 6.2 : 7.2;
  const stripH = storyH / 6;
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
    pitch: 2.2, frameMat: 'darkStoneGrey', glassMat: 'darkAzur', litFrac: b.level >= 2 ? 0.3 : 0.15, warmFrac: 0.3, marginFrac: 0.7,
  });
  facade(ctx, parts, rng, cx, cz, groundY, {
    axis: 'x', sign: -1, halfW, halfD, floors: [{ y0: storyH - stripH * 1.4, h: stripH * 1.1 }],
    pitch: 2.2, frameMat: 'darkStoneGrey', glassMat: 'darkAzur', litFrac: b.level >= 2 ? 0.3 : 0.15, warmFrac: 0.3, marginFrac: 0.7,
  });
  // loading dock door on the +z facade
  const dockW = Math.min(halfW * 1.2, 3.2);
  box(ctx, parts, 'darkStoneGrey', dockW, storyH * 0.55, 0.12, cx, groundY + storyH * 0.275, cz + halfD - 0.06, 0.03);
  plainBox(parts, accent, dockW * 1.08, 0.22, 0.16, cx, groundY + storyH * 0.55 + 0.15, cz + halfD - 0.06);
  // roof cap + parapet, fully studded deck
  const parapetH = 0.3;
  const roofTop = flatRoof(ctx, parts, studs, accent, cx, cz, halfW, halfD, groundY + storyH, { capH: 0.3, parapetH });
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
  return {
    parts, studs,
    height: storyH + 0.3 + tankH, kind: b.level >= 3 ? 'plant' : 'warehouse',
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
  const roofTop = flatRoof(ctx, parts, studs, 'darkStoneGrey', cx, cz, halfW, halfD, groundY + storyH, { capH: 0.35, parapetH });
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

  return {
    parts, studs,
    height: storyH + 0.35 + towerH, kind: 'power_plant',
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
  const roofTop = flatRoof(ctx, parts, studs, 'darkStoneGrey', cx, cz, halfW, halfD, groundY + storyH, { capH: 0.3, parapetH: 0.35 });
  // garage door stripe on the +z face
  plainBox(parts, 'white', halfW * 1.1, storyH * 0.55, 0.12, cx, groundY + storyH * 0.32, cz + halfD - 0.06);
  // lookout tower + beacon, offset toward a back corner
  const towerR = Math.min(halfW, halfD) * 0.42;
  const towerH = 3.5 + rng.range(0, 1);
  const tx = cx - halfW * 0.45, tz = cz - halfD * 0.45;
  cylinder(parts, 'white', towerR, towerR * 1.05, towerH, 10, tx, roofTop, tz);
  cylinder(parts, 'brightRed', towerR * 0.6, towerR * 0.8, 0.35, 10, tx, roofTop + towerH, tz);
  studs.push({ x: tx, y: roofTop + towerH + 0.35, z: tz, color: 'brightRed' });
  plainBox(parts, 'beacon', 0.32, 0.32, 0.32, tx, roofTop + towerH + 0.5, tz);

  return {
    parts, studs,
    height: storyH + 0.65 + towerH + 0.35, kind: 'fire_department',
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
  const roofTop = flatRoof(ctx, parts, studs, 'white', cx, cz, halfW, halfD, groundY + storyH, { capH: 0.3, parapetH: 0.35 });
  // glazed entrance bay on the +z face, with a white desk stripe behind it
  plainBox(parts, 'white', halfW * 1.15, storyH * 0.5, 0.12, cx, groundY + storyH * 0.3, cz + halfD - 0.06);
  plainBox(parts, 'transBlue', halfW * 1.05, storyH * 0.42, 0.06, cx, groundY + storyH * 0.3, cz + halfD - 0.02);
  // roof sign (white board + blue badge block) and a blue beacon on a short mast, toward a back corner
  const sx = cx + halfW * 0.35, sz = cz - halfD * 0.3;
  plainBox(parts, 'white', 2.2, 1.1, 0.22, sx, roofTop + 0.55, sz);
  plainBox(parts, 'brightBlue', 0.7, 0.7, 0.1, sx, roofTop + 0.55, sz + 0.16);
  const mastH = 1.6 + rng.range(0, 0.6);
  cylinder(parts, 'lightStoneGrey', 0.09, 0.12, mastH, 8, cx - halfW * 0.5, roofTop, cz - halfD * 0.5);
  plainBox(parts, 'beaconBlue', 0.32, 0.32, 0.32, cx - halfW * 0.5, roofTop + mastH + 0.2, cz - halfD * 0.5);

  return {
    parts, studs,
    height: storyH + 0.65 + mastH + 0.4, kind: 'police_station',
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
  else if (b.zone === 'c') out = generateCommercial(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else if (b.zone === 'i') out = generateIndustrial(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else out = generateResidential(ctx, b, rng, halfW, halfD, cx, cz, groundY);

  // Zone generators emit stud points already in world space (the stud helpers take world cx/cz directly).
  return { parts: out.parts, studs: out.studs, height: out.height, kind: out.kind, baseY: groundY, cx, cz };
}
