import * as THREE from 'three';
import {
  RESI_BODY, RESI_ROOF, RESI_TOWER_BODY, RESI_TOWER_ACCENT,
  COMM_BODY, COMM_ACCENT, COMM_GLASS, IND_BODY_A, IND_BODY_B, IND_ACCENT, pick,
} from './palette.js';

// Procedural Lego-style building generator. Produces a flat list of { mat, geom } pieces already positioned in
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

function pyramidRoof(parts, mat, spanX, spanZ, h, x, y, z, rot = false) {
  const r = Math.max(spanX, spanZ) * 0.5 * Math.SQRT2;
  const g = new THREE.ConeGeometry(r, h, 4, 1).toNonIndexed();
  g.rotateY(Math.PI / 4 + (rot ? Math.PI / 2 : 0));
  // squash the cone's circular base into the building's rectangular footprint
  g.scale(spanX / (r * Math.SQRT2), 1, spanZ / (r * Math.SQRT2));
  g.translate(x, y + h / 2, z);
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

function roofPerimeterStuds(halfW, halfD, y, color) {
  const studs = [];
  const inset = 0.35;
  const w = halfW * 2 - inset * 2, d = halfD * 2 - inset * 2;
  if (w <= 0.4 || d <= 0.4) return studs;
  const perim = 2 * (w + d);
  const target = THREE.MathUtils.clamp(Math.round(perim / 6), 8, 32);
  const pitch = perim / target;
  let dist = 0;
  const x0 = -halfW + inset, x1 = halfW - inset, z0 = -halfD + inset, z1 = halfD - inset;
  // walk the rectangle perimeter at even arclength steps
  const pts = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  for (let n = 0; n < target; n++) {
    let t = dist;
    let s = 0;
    while (true) {
      const a = pts[s % 4], b = pts[(s + 1) % 4];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (t <= L || s > 8) {
        const f = L > 0 ? t / L : 0;
        studs.push({ lx: a[0] + (b[0] - a[0]) * f, lz: a[1] + (b[1] - a[1]) * f, y, color });
        break;
      }
      t -= L; s++;
    }
    dist += pitch;
  }
  return studs;
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
  const body = pick(rng, RESI_BODY);
  // Frame must contrast the wall regardless of body colour or windows disappear at any distance - keep it dark.
  const frameMat = rng.chance(0.25) ? 'black' : 'darkStoneGrey';
  const glassMat = rng.chance(0.75) ? 'transClear' : 'transBlue';

  if (b.level <= 1) {
    const twoStory = rng.chance(0.35);
    const groundH = 3.0, upperH = 2.7;
    const { floors, top } = floorList(twoStory ? 2 : 1, groundH, upperH);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    const roofH = 2.0 + rng.range(-0.3, 0.5);
    const roofMat = pick(rng, RESI_ROOF);
    pyramidRoof(parts, roofMat, halfW * 2 * 1.08, halfD * 2 * 1.08, roofH, cx, groundY + top, cz, rng.chance(0.5));
    allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors, {
      pitch: 1.7, frameMat, glassMat, litFrac: 0.42, warmFrac: 0.85, minCols: 1, marginFrac: 0.6,
    });
    // door on the +z facade
    plainBox(parts, 'darkStoneGrey', 1.0, 1.9, 0.12, cx, groundY + 0.95, cz + halfD - 0.06);
    if (rng.chance(0.55)) plainBox(parts, 'porchWarm', 0.35, 0.22, 0.06, cx + 0.7, groundY + 1.9, cz + halfD - 0.03);
    // garden hint: a couple of hedge blobs near the door
    if (halfW > 2) {
      plainBox(parts, 'darkGreen', 0.7, 0.55, 0.6, cx - halfW + 0.6, groundY, cz + halfD - 0.5);
      plainBox(parts, 'darkGreen', 0.6, 0.45, 0.5, cx + halfW - 0.55, groundY, cz + halfD - 0.45);
    }
    return { parts, studs: roofPerimeterStuds(halfW, halfD, groundY + top + roofH * 0.15, roofMat), height: top + roofH, kind: 'house' };
  }

  if (b.level === 2) {
    const groundH = 3.2, upperH = 2.95;
    const floorsN = rng.int(3, 5);
    const { floors, top } = floorList(floorsN, groundH, upperH);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    const capMat = pick(rng, RESI_ROOF);
    box(ctx, parts, capMat, halfW * 2 * 1.02, 0.35, halfD * 2 * 1.02, cx, groundY + top, cz, 0.03);
    allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors, {
      pitch: 1.5, frameMat, glassMat, litFrac: 0.4, warmFrac: 0.8, marginFrac: 0.75,
    });
    // balcony ledges on the +z facade every other floor
    for (let i = 1; i < floorsN; i += 2) {
      plainBox(parts, 'lightStoneGrey', halfW * 1.5, 0.14, 0.5, cx, groundY + floors[i].y0 + 0.05, cz + halfD + 0.2);
    }
    return { parts, studs: roofPerimeterStuds(halfW, halfD, groundY + top + 0.35, capMat), height: top + 0.35, kind: 'apartment' };
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
  allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors.filter((f) => f.y0 < lowerTop), {
    pitch: 1.4, frameMat, glassMat, litFrac: 0.5, warmFrac: 0.75, marginFrac: 0.8,
  });
  allFacades(ctx, parts, rng, cx, cz, groundY, halfW * shrink, halfD * shrink, floors.filter((f) => f.y0 >= lowerTop).map((f) => ({ ...f, y0: f.y0 })), {
    pitch: 1.4, frameMat, glassMat, litFrac: 0.5, warmFrac: 0.75, marginFrac: 0.8,
  });
  const roofY = groundY + top;
  cylinder(parts, 'mediumStoneGrey', 0.9, 1.0, 1.6, 10, cx - halfW * shrink * 0.4, roofY, cz + halfD * shrink * 0.3);
  plainBox(parts, 'lightStoneGrey', 1.1, 0.7, 1.1, cx + halfW * shrink * 0.35, roofY, cz - halfD * shrink * 0.3);
  if (floorsN >= 12) {
    cylinder(parts, 'darkStoneGrey', 0.06, 0.08, 3.2, 6, cx, roofY, cz);
    // aviation warning light: emissive block at the antenna tip (sized up from a barely-visible 0.14m cube so
    // its bloom actually registers at showcase distance, per round-1 review item 6)
    plainBox(parts, 'beacon', 0.26, 0.26, 0.26, cx, roofY + 3.2, cz);
  }
  return { parts, studs: roofPerimeterStuds(halfW * shrink, halfD * shrink, roofY + 0.05, accent), height: top, kind: 'tower' };
}

function generateCommercial(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
  const body = pick(rng, COMM_BODY);
  const accent = pick(rng, COMM_ACCENT);
  const glassMat = pick(rng, COMM_GLASS);
  // A bit of frame variation (matches the residential 25/75 split) instead of a flat fixed grey - more contrast.
  const frameMat = rng.chance(0.3) ? 'black' : 'darkStoneGrey';

  if (b.level <= 1) {
    const floorsN = rng.chance(0.4) ? 2 : 1;
    const groundH = 4.1, upperH = 3.4;
    const { floors, top } = floorList(floorsN, groundH, upperH);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    // storefront glass: wide ground-floor windows on all sides
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: 1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: -1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: 1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: -1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.4, wide: true, marginFrac: 0.85 });
    if (floorsN > 1) allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, [floors[1]], { pitch: 1.6, frameMat, glassMat, litFrac: 0.4, warmFrac: 0.6, marginFrac: 0.75 });
    // awning + sign on the +z front
    box(ctx, parts, accent, halfW * 1.7, 0.28, 0.55, cx, groundY + floors[0].h - 0.1, cz + halfD - 0.1, 0.03);
    box(ctx, parts, accent, halfW * 1.3, 0.9, 0.1, cx, groundY + floors[0].h + 0.55, cz + halfD - 0.02, 0.04);
    plainBox(parts, 'signGlow', halfW * 1.1, 0.55, 0.04, cx, groundY + floors[0].h + 0.55, cz + halfD + 0.03);
    box(ctx, parts, 'lightStoneGrey', halfW * 2 * 1.02, 0.3, halfD * 2 * 1.02, cx, groundY + top, cz, 0.03);
    return { parts, studs: roofPerimeterStuds(halfW, halfD, groundY + top + 0.3, 'darkStoneGrey'), height: top + 0.3, kind: 'shop' };
  }

  if (b.level === 2) {
    const groundH = 4.2, upperH = 3.5;
    const floorsN = rng.int(4, 7);
    const { floors, top } = floorList(floorsN, groundH, upperH);
    box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
    box(ctx, parts, accent, halfW * 2 * 1.01, 0.25, halfD * 2 * 1.01, cx, groundY + groundH, cz, 0.02);
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: 1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.35, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'x', sign: -1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.35, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: 1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.35, wide: true, marginFrac: 0.85 });
    facade(ctx, parts, rng, cx, cz, groundY, { axis: 'z', sign: -1, halfW, halfD, floors: [floors[0]], pitch: 2.0, frameMat, glassMat, litFrac: 0.55, warmFrac: 0.35, wide: true, marginFrac: 0.85 });
    allFacades(ctx, parts, rng, cx, cz, groundY, halfW, halfD, floors.slice(1), { pitch: 1.5, frameMat, glassMat, litFrac: 0.5, warmFrac: 0.45, marginFrac: 0.82, winWFrac: 0.78 });
    box(ctx, parts, 'lightStoneGrey', halfW * 2 * 1.02, 0.3, halfD * 2 * 1.02, cx, groundY + top, cz, 0.03);
    cylinder(parts, 'mediumStoneGrey', 0.7, 0.75, 1.1, 8, cx + halfW * 0.4, groundY + top + 0.3, cz - halfD * 0.4);
    return { parts, studs: roofPerimeterStuds(halfW, halfD, groundY + top + 0.3, 'darkStoneGrey'), height: top + 0.3, kind: 'office' };
  }

  // level 3: office tower, curtain-wall glass
  const groundH = 4.4, upperH = 3.6;
  const floorsN = rng.int(12, 22);
  const { floors, top } = floorList(floorsN, groundH, upperH);
  box(ctx, parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
  interiorLiner(parts, body, halfW * 2, top, halfD * 2, cx, groundY, cz);
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
  box(ctx, parts, 'lightStoneGrey', halfW * 2 * 1.01, 0.3, halfD * 2 * 1.01, cx, roofY, cz, 0.03);
  cylinder(parts, 'mediumStoneGrey', 1.0, 1.1, 1.8, 10, cx - halfW * 0.35, roofY + 0.3, cz + halfD * 0.35);
  plainBox(parts, 'darkStoneGrey', 1.3, 0.8, 1.3, cx + halfW * 0.35, roofY + 0.3, cz - halfD * 0.35);
  cylinder(parts, 'darkStoneGrey', 0.06, 0.08, 3.6, 6, cx, roofY + 0.3, cz);
  // aviation warning light: sized up from a barely-visible 0.14m cube (round-1 review item 6)
  plainBox(parts, 'beacon', 0.26, 0.26, 0.26, cx, roofY + 0.3 + 3.55, cz);
  return { parts, studs: roofPerimeterStuds(halfW, halfD, roofY + 0.3, 'lightStoneGrey'), height: top + 0.3, kind: 'tower-office' };
}

function generateIndustrial(ctx, b, rng, halfW, halfD, cx, cz, groundY) {
  const parts = [];
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
  // roof cap
  box(ctx, parts, accent, halfW * 2 * 1.02, 0.3, halfD * 2 * 1.02, cx, groundY + storyH, cz, 0.03);
  const roofY = groundY + storyH + 0.3;
  const nChimneys = b.level >= 3 ? 2 : 1;
  let lastChimney = null;
  for (let k = 0; k < nChimneys; k++) {
    const px = cx + (k === 0 ? -halfW * 0.45 : halfW * 0.4);
    const pz = cz + (k === 0 ? halfD * 0.4 : -halfD * 0.35);
    const h = 3.4 + rng.range(0, 1.6);
    cylinder(parts, 'darkStoneGrey', 0.55, 0.65, h, 10, px, roofY, pz);
    if (rng.chance(0.4)) plainBox(parts, 'chimneyGlow', 0.5, 0.22, 0.5, px, roofY + h, pz);
    lastChimney = { x: px, z: pz, h };
  }
  // storage tank
  const tx = cx + halfW * 0.4, tz = cz + halfD * 0.35;
  const tankH = 2.4 + (b.level - 1) * 0.6;
  cylinder(parts, accent === 'brightYellow' ? 'darkOrange' : accent, 1.3, 1.4, tankH, 12, tx, roofY, tz);
  plainBox(parts, 'mediumStoneGrey', 1.5, 0.15, 1.5, tx, roofY + tankH, tz);
  if (b.level >= 2 && lastChimney) {
    // connecting pipe (thin horizontal box) between tank and chimney
    const dx = lastChimney.x - tx, dz = lastChimney.z - tz;
    const len = Math.hypot(dx, dz);
    const midx = (tx + lastChimney.x) / 2, midz = (tz + lastChimney.z) / 2;
    const g = ctx.materials.bevelBox(Math.max(0.3, quant(len)), 0.25, 0.25, 0.03).clone();
    g.rotateY(-Math.atan2(dz, dx));
    g.translate(midx, roofY + 1.0, midz);
    parts.push({ mat: 'darkStoneGrey', geom: g });
  }
  return {
    parts, studs: roofPerimeterStuds(halfW, halfD, roofY + 0.05, 'darkStoneGrey'),
    height: storyH + 0.3 + tankH, kind: b.level >= 3 ? 'plant' : 'warehouse',
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
  if (b.zone === 'c') out = generateCommercial(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else if (b.zone === 'i') out = generateIndustrial(ctx, b, rng, halfW, halfD, cx, cz, groundY);
  else out = generateResidential(ctx, b, rng, halfW, halfD, cx, cz, groundY);

  // roofPerimeterStuds() is called by each zone generator with an already-world-space y (groundY + offsets).
  const worldStuds = out.studs.map((s) => ({ x: cx + s.lx, y: s.y, z: cz + s.lz, color: s.color }));
  return { parts: out.parts, studs: worldStuds, height: out.height, kind: out.kind, baseY: groundY, cx, cz };
}
