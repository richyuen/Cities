// LOOP cycle 5 (W1 authored hero set-pieces): the brick vocabulary for the skate plaza, the pergola garden and the
// community farm. Same contract as kinds.js — every kind is a list of { role, local, color } parts in prop-local
// space (origin = ground contact, forward = +Z) — but the set-piece kinds are built almost entirely from a handful
// of *generic* instance-coloured roles (a box, a beveled brick, a paver tile, a stud, a cylinder, a wedge, a
// quarter-pipe profile, three plant shapes, water, glass and two hats) scaled per instance. That keeps the draw
// budget flat (15 new roles cover ~40 kinds) while the composition stays dense: a windmill is ~150 parts, a deck
// plate ~1000 tiles, all of them instances of the same few meshes.
import * as THREE from 'three';
import { UNIT_CYL, UNIT_BOX, mat, xf, merge } from './geo.js';
import {
  buildPrintGeometry, headPrintMatrix, torsoPrintMatrix, TORSO_TILE0, TORSO_SETS, TORSO_ON_WHITE, FACE_PLAIN, FACE_FEM,
} from './print.js';

// ---- kinds --------------------------------------------------------------------------------------------------
export const SP_FIGURE_KINDS = ['figure_cap', 'figure_skater', 'figure_sit', 'figure_farmer', 'figure_work', 'figure_std'];
export const SP_KIND_NAMES = [
  'sp_deck',
  // skate plaza
  'skate_bank', 'skate_quarter', 'skate_funbox', 'skate_rail', 'skateboard', 'pallet', 'planter_box', 'barrier_hoop',
  'flower_clump', 'kicker', 'mural_wall', 'skate_ledge',
  // garden
  'pergola', 'arbour', 'sandbox', 'pond', 'potted_plant', 'raised_bed', 'wheelbarrow', 'swing_set', 'parasol_table',
  'bush', 'bird_bath',
  // farm
  'crop_wheat_row', 'crop_corn_row', 'crop_veg_row', 'hay_bale', 'hay_stack', 'hay_shock', 'scarecrow', 'windmill',
  'barn', 'silo', 'pickup', 'tractor', 'chicken', 'sheep', 'rail_fence', 'produce_crate', 'water_trough',
  // posed figures
  ...SP_FIGURE_KINDS,
];
/** Kinds that must never shrink in the props distance fade (tall landmarks that would visibly pop). */
export const SP_NOFADE_KINDS = new Set(['sp_deck', 'windmill', 'barn', 'silo']);

// ---- colours (palette names or hex; ctx.materials.color() accepts both) ----------------------------------------
const PAVER = ['#8A8F8D', '#8A8F8D', '#7D8280', '#9A9F9C', '#6E7371', 'mediumStoneGrey', '#A9AEAB', '#5F6466'];
const PAVER_DARK = ['darkStoneGrey', '#4F5457', '#63686B', '#6E7371'];
const PATH = ['lightStoneGrey', '#D5D3CC', '#BDBDB6', 'mediumStoneGrey'];
const GRASS = ['brightGreen', '#56A94B', '#4B9F4A', '#4F9C48', '#62B353', '#459A46'];
const SOIL = ['reddishBrown', '#6B3A1C', '#74411F', '#5E3016'];
const DIRT = ['tan', '#C9A46A', '#CFB383', '#D2B27A'];
const ORANGE = ['#E2661B', '#D95E17'];
const TEAL = '#0E8F86';
const WHEAT = ['#FFC233', '#FFCF45', '#FDB52A', '#FFD95C'];
const HAY = ['#F2A93A', '#F6B84A', '#E99A2C'];
const LEAF = ['brightGreen', '#3E9447', 'darkGreen', '#5BB04F'];
const SHIRTS = ['brightRed', 'brightBlue', 'brightYellow', 'brightGreen', 'brightOrange', 'white', 'mediumLilac', 'mediumAzur', 'darkRed', 'sandGreen', '#2F6FB5'];
const LEGS = ['darkStoneGrey', 'darkAzur', 'sandBlue', 'reddishBrown', 'black', 'earthBlue', '#2F6FB5'];
const SKIN = ['brightYellow', 'brightYellow', 'brightYellow', '#D9A27A']; // c6: 'tan' read as a white face
const CAPS = ['brightBlue', 'brightRed', '#2F6FB5', 'black', 'brightYellow', 'brightGreen', 'white'];
const HAIR = ['reddishBrown', 'black', 'brickYellow', 'darkOrange', '#3A2A1E', 'darkStoneGrey', 'brightYellow'];
/** c6 fix 2: headgear tones that merge with a brightYellow head into one yellow block (the set-7 "blank" read). */
const MERGES_WITH_YELLOW = new Set(['brightYellow', 'brickYellow', 'white', '#E8C77A', 'tan']);
const gearFor = (skin, list) => (skin === 'brightYellow' ? list.filter((c) => !MERGES_WITH_YELLOW.has(c)) : list);
const FLOWERS = ['brightPink', 'brightRed', 'brightYellow', 'white', 'mediumLilac', '#F28CB7'];

/** Deck surface styles: base tile palette + plinth (side wall) colour + sparse-stud probability. */
const DECK_STYLE = {
  pavers: { tiles: PAVER, plinth: '#55595C', studP: 0.035 },
  grass: { tiles: GRASS, plinth: '#3B7F3F', studP: 0.10 },
};
const ZONE_TILES = {
  pavers: PAVER, dark: PAVER_DARK, path: PATH, grass: GRASS, soil: SOIL, dirt: DIRT,
  teal: [TEAL, '#13A396'], orange: ORANGE,
};
const ZONE_STUD_P = { pavers: 0.035, dark: 0.02, path: 0.03, grass: 0.10, soil: 0.0, dirt: 0.05, teal: 0.2, orange: 0.2 };

/** Deck tile thickness: the tile layer's top is the deck surface (prop y), the plinth slab sits under it. */
export const DECK_TILE_H = 0.08;

// ---- role geometry ----------------------------------------------------------------------------------------------
/** A profile (array of [z, y]) extruded across x in [-0.5, 0.5]. Non-indexed => flat facet normals, so curved
 * profiles read as stacked Blox slope plates rather than smooth CG ramps. */
function extrudeProfile(profile) {
  const shape = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false, curveSegments: 1, steps: 1 });
  // Shape (s, y) extruded along +z: rotate about Y by -90deg (x' = -z, z' = s; a rotation, so winding is kept)
  // and centre the extrusion axis on x = 0.
  g.applyMatrix4(new THREE.Matrix4().makeRotationY(-Math.PI / 2));
  g.translate(0.5, 0, 0);
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  out.computeVertexNormals();
  return out;
}

export function buildSpRoleGeometry(ctx) {
  const bb = (w, h, d, bevel) => ctx.materials.bevelBox(w, h, d, bevel);
  const G = {};
  G['sp-box'] = xf(UNIT_BOX, new THREE.Matrix4());
  G['sp-brick'] = ctx.materials.bevelBox(1, 1, 1, 0.07, 1).clone();
  // one bevel segment: the deck carries thousands of tiles; the edge highlight is what matters, not roundness
  // chamfered tile: a 4-sided frustum (16 tris; the rounded box cost 108) whose sloped sides catch the edge light
  {
    const t = new THREE.CylinderGeometry(0.367 * Math.SQRT2, 0.39 * Math.SQRT2, DECK_TILE_H, 4, 1);
    t.rotateY(Math.PI / 4);
    t.translate(0, DECK_TILE_H / 2, 0);
    const o = t.toNonIndexed();
    t.dispose();
    o.deleteAttribute('uv');
    o.computeVertexNormals();
    G['sp-tile'] = o;
  }
  // octagonal prism (flat facets, a face toward +z): windmill tower courses, parasol canopies, pots
  {
    const g = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
    g.rotateY(Math.PI / 8);
    g.translate(0, 0.5, 0);
    const o = g.toNonIndexed();
    g.dispose();
    o.deleteAttribute('uv');
    o.computeVertexNormals();
    G['sp-oct'] = o;
  }
  G['sp-stud'] = xf(UNIT_CYL, mat(0, 0, 0, 0, 0, 0, 0.24, 0.17, 0.24));
  G['sp-cyl'] = xf(UNIT_CYL, new THREE.Matrix4());
  G['sp-glass'] = xf(UNIT_BOX, new THREE.Matrix4());
  G['sp-water'] = xf(UNIT_CYL, new THREE.Matrix4());
  // Wedge: unit prism rising from the front (+z, height 0) to the back (-z, height 1).
  G['sp-wedge'] = extrudeProfile([[0.5, 0], [-0.5, 1], [-0.5, 0]]);
  // Quarter pipe: concave riding face toward +z, flat at the front-bottom (z = +0.5), vertical at the back-top
  // (z = -0.5, y = 1); 8 facets.
  {
    const pts = [];
    const N = 8;
    for (let k = 0; k <= N; k++) {
      const t = (k / N) * Math.PI / 2;
      pts.push([0.5 - Math.sin(t), 1 - Math.cos(t)]);
    }
    pts.push([-0.5, 0]);
    G['sp-qpipe'] = extrudeProfile(pts);
  }
  // Broad-leaf plant (the references' big-leaf Blox plants): a stem and five tilted leaf plates around it.
  // Plain boxes (84 tris/instance; the beveled version cost 1812).
  {
    const parts = [xf(UNIT_BOX, mat(0, 0, 0, 0, 0, 0, 0.05, 0.32, 0.05))];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const lf = xf(UNIT_BOX, mat(0, 0, 0.2, 0, 0, 0, 0.2, 0.025, 0.42));
      lf.applyMatrix4(mat(0, 0.14 + (k % 2) * 0.1, 0, -0.55, a, 0));
      parts.push(lf);
    }
    parts.push(xf(UNIT_BOX, mat(0, 0.3, 0.1, -1.0, 0, 0, 0.16, 0.025, 0.3)));
    G['sp-leaf'] = merge(parts);
  }
  // Wheat tuft: six thin stalks with grain heads, slightly splayed (one golden instance colour).
  {
    const parts = [];
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.4;
      const r = 0.07;
      const h = 0.95 + ((k * 37) % 5) * 0.07;
      const tilt = k === 0 ? 0 : 0.1;
      const m = mat(Math.cos(a) * r, 0, Math.sin(a) * r, Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
      parts.push(xf(UNIT_BOX, new THREE.Matrix4().multiplyMatrices(m, mat(0, 0, 0, 0, 0, 0, 0.035, h, 0.035))));
      parts.push(xf(UNIT_BOX, new THREE.Matrix4().multiplyMatrices(m, mat(0, h - 0.04, 0, 0, a, 0, 0.13, 0.36, 0.13))));
      parts.push(xf(UNIT_BOX, new THREE.Matrix4().multiplyMatrices(m, mat(0, h + 0.3, 0, 0, a, 0, 0.012, 0.16, 0.012))));
    }
    G['sp-wheat'] = merge(parts);
  }
  // Corn stalk: stalk + four alternating leaf blades + a tassel (plain boxes: 72 tris; was 1224 beveled).
  {
    const parts = [xf(UNIT_BOX, mat(0, 0, 0, 0, 0, 0, 0.08, 1.75, 0.08))];
    for (let k = 0; k < 4; k++) {
      const y = 0.45 + k * 0.32;
      const a = k * 1.7;
      const blade = xf(UNIT_BOX, mat(0, 0, 0.26, 0, 0, 0, 0.11, 0.025, 0.55));
      blade.applyMatrix4(mat(0, y, 0, -0.5, a, 0));
      parts.push(blade);
    }
    parts.push(xf(UNIT_BOX, mat(0, 1.75, 0, 0, 0.4, 0, 0.18, 0.2, 0.05)));
    G['sp-corn'] = merge(parts);
  }
  // Cap (LOOP c6 B1): a rounded crown over the head top (bottom edge at y 1.565, just above the printed brows, so the
  // face shows), a button and a SHORT raised brim (front edge z ~0.20, 4.5 cm past the 0.155 m face; the old brim
  // reached z 0.31 at y 1.565 and hid everything above y ~1.43 from a 41-degree hero pitch, i.e. the eyes).
  // Figure space; the head tops out at y ~1.70 with its stud. Rotate the part by PI about Y for a backward cap.
  {
    const crown = xf(bb(0.37, 0.16, 0.36, 0.07), mat(0, 1.556, -0.015));
    const dome = new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.applyMatrix4(mat(0, 1.712, -0.015, 0, 0, 0, 0.17, 0.06, 0.165));
    const button = xf(UNIT_CYL, mat(0, 1.765, -0.015, 0, 0, 0, 0.035, 0.022, 0.035));
    const brim = xf(bb(0.3, 0.03, 0.1, 0.012), mat(0, 1.558, 0.148, -0.2, 0, 0));
    G['sp-cap'] = merge([crown, dome, button, brim]);
  }
  // Straw hat (c6): crown from y 1.575 (above the printed face), a narrower raised brim (r 0.27 at y 1.62: 11.5 cm past
  // the face instead of 20 cm at 1.6, which hid the eyes from the farm hero's 32-degree pitch) + band ring.
  {
    const brim = xf(UNIT_CYL, mat(0, 1.62, 0, 0, 0, 0, 0.27, 0.03, 0.27));
    const crown = xf(UNIT_CYL, mat(0, 1.556, 0, 0, 0, 0, 0.18, 0.22, 0.18));
    const band = xf(UNIT_CYL, mat(0, 1.65, 0, 0, 0, 0, 0.186, 0.045, 0.186));
    const top = xf(UNIT_CYL, mat(0, 1.775, 0, 0, 0, 0, 0.155, 0.03, 0.155));
    G['sp-hat'] = merge([brim, crown, band, top]);
  }
  // Printed face / torso patch (c6 B2): see print.js. Owns its own geometry (uv + per-instance aTile).
  G['sp-print'] = buildPrintGeometry();
  // ---- minifig roles (fix round 1): set-piece figures get their own parts so the city's 3-box pedestrians are
  // untouched. Figure space: feet at y 0, hip top 0.72, torso to 1.30, neck, head 1.34-1.64 + stud, forward +z.
  {
    // hip block + two legs with forward feet and a centre slit
    const legs = [xf(UNIT_BOX, mat(0, 0.6, 0, 0, 0, 0, 0.42, 0.12, 0.24))];
    for (const x of [-0.106, 0.106]) {
      legs.push(xf(UNIT_BOX, mat(x, 0.08, -0.01, 0, 0, 0, 0.198, 0.53, 0.22)));
      legs.push(xf(UNIT_BOX, mat(x, 0, 0.02, 0, 0, 0, 0.198, 0.09, 0.3)));
    }
    G['sp-legs'] = merge(legs);
    // seated legs (seat surface at y 0): hip block, thighs forward, shins hanging, feet forward
    const sit = [xf(UNIT_BOX, mat(0, 0, -0.02, 0, 0, 0, 0.42, 0.12, 0.24))];
    for (const x of [-0.106, 0.106]) {
      sit.push(xf(UNIT_BOX, mat(x, 0, 0.2, 0, 0, 0, 0.198, 0.2, 0.36)));
      sit.push(xf(UNIT_BOX, mat(x, -0.37, 0.27, 0, 0, 0, 0.198, 0.37, 0.2)));
      sit.push(xf(UNIT_BOX, mat(x, -0.46, 0.31, 0, 0, 0, 0.198, 0.09, 0.3)));
    }
    G['sp-legsit'] = merge(sit);
    // trapezoid torso (0.44 x 0.24 at the hip, 0.32 x 0.21 at the shoulders) + neck post
    const t = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    const pa = t.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      const top = pa.getY(k) > 0;
      pa.setXYZ(k, pa.getX(k) * (top ? 0.32 : 0.44), 0.72 + (pa.getY(k) + 0.5) * 0.58, pa.getZ(k) * (top ? 0.21 : 0.24));
    }
    t.deleteAttribute('uv');
    t.computeVertexNormals();
    const neck = xf(UNIT_CYL, mat(0, 1.29, 0, 0, 0, 0, 0.075, 0.06, 0.075));
    neck.deleteAttribute('uv');
    G['sp-torso'] = merge([t, neck.toNonIndexed()]);
    // arm: sleeve hanging from a shoulder pivot at the origin (the hand is a separate skin-coloured cylinder)
    G['sp-arm'] = xf(bb(0.13, 0.44, 0.15, 0.045), mat(0, -0.41, 0, 0.08, 0, 0));
    // head: cylinder with a stud on top
    {
      const head = new THREE.CylinderGeometry(0.155, 0.155, 0.3, 16, 1);
      head.translate(0, 1.49, 0);
      const st = new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12, 1);
      st.translate(0, 1.67, 0);
      G['sp-head'] = merge([head, st]);
    }
    // hair piece (c6): rounded crown whose front edge sits at y 1.57 (above the printed brows; the old crown came
    // down to 1.48 at the front and covered the eyes), a back panel and two short side panels framing the face.
    G['sp-hair'] = merge([
      xf(bb(0.35, 0.145, 0.35, 0.06), mat(0, 1.556, -0.02)),
      xf(bb(0.34, 0.27, 0.12, 0.04), mat(0, 1.33, -0.12)),
      xf(bb(0.05, 0.2, 0.17, 0.02), mat(-0.158, 1.4, -0.06)),
      xf(bb(0.05, 0.2, 0.17, 0.02), mat(0.158, 1.4, -0.06)),
    ]);
  }
  return G;
}

// ---- part helpers -----------------------------------------------------------------------------------------------
const P = (role, color, px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  ({ role, color, local: mat(px, py, pz, rx, ry, rz, sx, sy, sz) });
/** Pre-multiply a part list by `m` (place a sub-assembly). */
function under(m, parts) {
  for (const p of parts) p.local = p.local ? new THREE.Matrix4().multiplyMatrices(m, p.local) : m.clone();
  return parts;
}
const box = (c, x, y, z, sx, sy, sz, ry = 0) => P('sp-box', c, x, y, z, 0, ry, 0, sx, sy, sz);
const brick = (c, x, y, z, sx, sy, sz, ry = 0) => P('sp-brick', c, x, y, z, 0, ry, 0, sx, sy, sz);
const cyl = (c, x, y, z, r, h) => P('sp-cyl', c, x, y, z, 0, 0, 0, r, h, r);
/** Horizontal cylinder along local x (wheels, coping, rails). Centre at (x, y, z). */
const cylX = (c, x, y, z, r, len) => P('sp-cyl', c, x - len / 2, y, z, 0, 0, -Math.PI / 2, r, len, r);
/** Horizontal cylinder along local z. */
const cylZ = (c, x, y, z, r, len) => P('sp-cyl', c, x, y, z - len / 2, Math.PI / 2, 0, 0, r, len, r);
const stud = (c, x, y, z) => P('sp-stud', c, x, y, z);
const leaf = (c, x, y, z, s = 1, ry = 0) => P('sp-leaf', c, x, y, z, 0, ry, 0, s, s, s);
const flower = (c, x, y, z, s = 1) => P('flowerbed-flower', c, x, y, z, 0, 0, 0, s, s, s);
const shrub = (c, x, y, z, s = 0.5, ry = 0) => P('tree-leaves', c, x, y, z, 0, ry, 0, s, s * 0.8, s);
const pick = (prng, a) => prng.pick(a);
const studRow = (out, c, x0, x1, y, z, pitch = 0.8) => {
  const n = Math.max(1, Math.floor((x1 - x0) / pitch));
  const off = (x1 - x0 - (n - 1) * pitch) / 2;
  for (let k = 0; k < n; k++) out.push(stud(c, x0 + off + k * pitch, y, z));
};

// ---- figures ----------------------------------------------------------------------------------------------------
const HEAD_PRINT_M = headPrintMatrix();
const TORSO_PRINT_M = torsoPrintMatrix();
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const BELTS = ['black', 'reddishBrown', 'darkStoneGrey', '#3A2A1E'];
const HELMETS = ['brightRed', 'brightBlue', 'white', 'black', 'brightYellow', TEAL, 'brightGreen'];

/** Minifig parts in a pose. Origin = feet (stand, work, skate) or the seat surface (sit). `hat`: 'cap' | 'capback' |
 * 'helmet' | 'straw' | 'none' (hair). LOOP c6 (B1/B2): printed face + torso graphic (sp-print), a belt, raised
 * headgear so the face shows, and - when the set-piece author passes `look` (the figure's local yaw) - a head
 * turned toward the set-piece front, the side both hero cameras look from. */
function figureParts(prng, pose, hat, opts = {}) {
  const legs = opts.legs || pick(prng, LEGS);
  const shirt = opts.shirt || pick(prng, SHIRTS);
  const skin = pick(prng, SKIN);
  const yaw = prng.range(-0.15, 0.15);
  const jitter = prng.range(-0.3, 0.3);
  const headYaw = Number.isFinite(opts.look)
    ? Math.max(-0.65, Math.min(0.65, -wrapPi(opts.look))) * 0.9 + jitter * 0.3
    : yaw + jitter;
  // 'sit' bends the knees (seat >= 0.35 m: bench, ledge, swing, tailgate, cab); 'sitflat' puts the legs straight
  // out (sitting on the ground / in the sandbox).
  let sitPose = pose === 'sit' && (opts.lift ?? 0.5) < 0.35 ? 'sitflat' : pose;
  let legRole = 'sp-legs', legM, bodyM;
  if (sitPose === 'sit') {
    legRole = 'sp-legsit';
    legM = new THREE.Matrix4();
    bodyM = mat(0, 0.12 - 0.72, 0);
  } else if (sitPose === 'sitflat') {
    legM = new THREE.Matrix4().multiplyMatrices(mat(0, 0.12, 0, -Math.PI / 2, 0, 0), mat(0, -0.72, 0));
    bodyM = mat(0, 0.24 - 0.72, 0);
  } else if (pose === 'work') {
    legM = new THREE.Matrix4();
    bodyM = new THREE.Matrix4().multiplyMatrices(mat(0, 0.72, 0, 0.5, 0, 0), mat(0, -0.72, 0));
  } else {
    legM = mat(0, 0, 0, 0, prng.range(-0.1, 0.1), 0);
    bodyM = new THREE.Matrix4();
    if (opts.lean) bodyM = new THREE.Matrix4().multiplyMatrices(mat(0, 0.72, 0, opts.lean, 0, 0), mat(0, -0.72, 0));
  }
  const torsoM = new THREE.Matrix4().multiplyMatrices(bodyM, mat(0, 0, 0, 0, yaw, 0));
  let headM = new THREE.Matrix4().multiplyMatrices(bodyM, mat(0, 0, 0, 0, headYaw, 0));
  // c6: a bent-over worker looks up from the work (head tipped back about the neck), so the face is not pointed at
  // the ground from a hero camera
  if (pose === 'work') {
    const tip = new THREE.Matrix4().multiplyMatrices(mat(0, 1.31, 0, -0.45, 0, 0), mat(0, -1.31, 0));
    headM = new THREE.Matrix4().multiplyMatrices(bodyM, new THREE.Matrix4().multiplyMatrices(tip, mat(0, 0, 0, 0, headYaw, 0)));
  }
  const parts = [
    { role: legRole, local: legM, color: legs },
    { role: 'sp-torso', local: torsoM, color: shirt },
    { role: 'sp-head', local: headM, color: skin },
  ];
  const on = (m, part) => { part.local = new THREE.Matrix4().multiplyMatrices(m, part.local); parts.push(part); };
  // posed arms: [pitch (negative = forward), splay] per side
  let arms;
  if (pose === 'skate') arms = [[-0.2, 1.05], [0.15, 1.15]];
  else if (sitPose === 'sit' || sitPose === 'sitflat') arms = [[-0.75, 0.12], [-0.7, 0.12]];
  else if (pose === 'work') arms = [[-1.05, 0.1], [-0.85, 0.15]];
  else if (pose === 'farmer') arms = [[-0.1, 0.12], [0.05, 0.62]];
  else {
    const r = prng.float();
    if (r < 0.18) arms = [[-2.75, 0.25], [-0.05, 0.1]];          // waving / cheering
    else if (r < 0.45) arms = [[0.32, 0.14], [-0.38, 0.14]];     // walking swing
    else if (r < 0.65) arms = [[-0.9, 0.12], [-0.15, 0.14]];      // holding / pointing
    else arms = [[-0.12, 0.14], [-0.12, 0.14]];
  }
  for (let s = 0; s < 2; s++) {
    const side = s === 0 ? 1 : -1;
    const [pitch, splay] = arms[s];
    const armM = new THREE.Matrix4().multiplyMatrices(torsoM, mat(side * 0.225, 1.235, 0, pitch, 0, side * splay));
    parts.push({ role: 'sp-arm', local: armM, color: shirt });
    on(armM, P('sp-cyl', skin, 0, -0.5, 0.02, 0, 0, 0, 0.055, 0.1, 0.055));
  }
  // headgear: caps (forward / backward), helmets (stepped octagonal dome + stripe band), straw hat or hair
  let longHair = false;
  if (!hat || hat === 'none') {
    const hair = opts.hair || pick(prng, gearFor(skin, HAIR));
    on(headM, P('sp-hair', hair, 0, 0, 0));
    if (prng.chance(0.35)) { longHair = true; on(headM, box(hair, 0, 1.18, -0.16, 0.32, 0.24, 0.08)); } // long hair down the back
  } else if (hat === 'cap' || hat === 'capback') {
    const capM = hat === 'capback' ? new THREE.Matrix4().multiplyMatrices(headM, mat(0, 0, 0, 0, Math.PI, 0)) : headM.clone();
    parts.push({ role: 'sp-cap', local: capM, color: opts.cap || pick(prng, gearFor(skin, CAPS)) });
  } else if (hat === 'helmet') {
    // c6 fix 3: a shell that encloses the head's back and sides down to y 1.47 (squashed octagon pushed back, so its
    // front face stays at z ~0.05, behind the printed eyes), a stepped octagonal dome on top, and a stripe band that is
    // an octagon tier of the SAME radius as the bottom tier (the square band's corners read as a plate under a hat)
    const c = pick(prng, gearFor(skin, HELMETS));
    const band = c === 'black' ? 'white' : 'black';
    on(headM, P('sp-oct', c, 0, 1.47, -0.07, 0, 0, 0, 0.19, 0.1, 0.13));
    on(headM, P('sp-oct', c, 0, 1.556, -0.02, 0, 0, 0, 0.19, 0.05, 0.19));
    on(headM, P('sp-oct', band, 0, 1.606, -0.02, 0, 0, 0, 0.19, 0.022, 0.19));
    on(headM, P('sp-oct', c, 0, 1.628, -0.02, 0, 0, 0, 0.168, 0.045, 0.168));
    on(headM, P('sp-oct', c, 0, 1.673, -0.02, 0, 0, 0, 0.12, 0.032, 0.12));
  } else if (hat === 'straw') {
    parts.push({ role: 'sp-hat', local: headM.clone(), color: pick(prng, ['brickYellow', 'tan', '#E8C77A']) });
  }
  // printed face and torso graphic (one sp-print instance each; tile picked per figure)
  const face = longHair ? pick(prng, FACE_FEM) : pick(prng, FACE_PLAIN);
  parts.push({ role: 'sp-print', local: new THREE.Matrix4().multiplyMatrices(headM, HEAD_PRINT_M), color: skin, tile: face });
  const set = TORSO_SETS[pose === 'skate' ? 'skate' : pose === 'farmer' ? 'farmer' : pose === 'work' ? 'work' : sitPose === 'stand' ? 'stand' : 'sit'] || TORSO_SETS.stand;
  const torso = opts.print ?? pick(prng, shirt === 'white' ? TORSO_ON_WHITE : set);
  parts.push({ role: 'sp-print', local: new THREE.Matrix4().multiplyMatrices(torsoM, TORSO_PRINT_M), color: shirt, tile: TORSO_TILE0 + torso });
  // belt line around the torso's bottom edge (wraps the sides, so it reads from any angle)
  on(torsoM, box(pick(prng, BELTS), 0, 0.715, 0, 0.452, 0.05, 0.252));
  return parts;
}

/** Skateboard along local x. `lean` (c6): stood on its tail and leaned back against a wall behind it (-z), wheels
 * toward +z - the boards racked against the mural wall. */
function skateboardParts(prng, color, lean = false) {
  if (lean) {
    const m = new THREE.Matrix4().multiplyMatrices(mat(0, 0.47, 0, -0.2, 0, 0),
      new THREE.Matrix4().multiplyMatrices(mat(0, 0, 0, 0, -Math.PI / 2, 0), mat(0, 0, 0, 0, 0, Math.PI / 2)));
    return under(m, skateboardParts(prng, color, false));
  }
  const c = color || pick(prng, ['brightOrange', 'brightRed', 'mediumAzur', 'black', 'brightYellow', 'brightPurple', TEAL]);
  const parts = [box(c, 0, 0.075, 0, 0.82, 0.045, 0.24)];
  parts.push(box('darkStoneGrey', 0.28, 0.06, 0, 0.08, 0.03, 0.2), box('darkStoneGrey', -0.28, 0.06, 0, 0.08, 0.03, 0.2));
  for (const x of [-0.28, 0.28]) for (const z of [-0.1, 0.1]) parts.push(cylZ('white', x, 0.045, z, 0.045, 0.05));
  // kicked tail
  parts.push(P('sp-box', c, 0.41, 0.075, 0, 0, 0, 0.35, 0.12, 0.045, 0.24));
  return parts;
}

// ---- deck -------------------------------------------------------------------------------------------------------
/** The set-piece's ground: a plinth slab (its top DECK_TILE_H below the deck surface, its bottom `drop` metres
 * below it so a sloped lot never shows a gap) covered by a tile layer. `zones` = [[u0, v0, u1, v1, zoneName]] in
 * deck-local metres, later zones win. Tiles merge into 2x1 / 2x2 where a zone allows. */
function deckParts(prng, prop) {
  const w = prop.w || 16, d = prop.d || 16;
  const style = DECK_STYLE[prop.style] || DECK_STYLE.pavers;
  const zones = Array.isArray(prop.zones) ? prop.zones : [];
  const drop = Math.max(0.3, prop.drop || 0.4);
  const parts = [];
  // plinth slab, slightly inset so the tile edge overhangs it like a baseplate
  parts.push(box(style.plinth, 0, -drop, 0, w - 0.04, drop - DECK_TILE_H + 0.001, d - 0.04));
  // tile pitch: 0.4 m (half a terrain stud) on the close-up decks so a 1.7 m figure stands ~4 tiles tall, as in the
  // references; studs and round tiles scale with it
  const PITCH = prop.pitch || 0.8, k = PITCH / 0.8;
  const nu = Math.max(1, Math.round(w / PITCH)), nv = Math.max(1, Math.round(d / PITCH));
  const pu = w / nu, pv = d / nv;
  const zoneAt = (u, v) => {
    let z = prop.style === 'grass' ? 'grass' : 'pavers';
    for (const zr of zones) if (u >= zr[0] && u <= zr[2] && v >= zr[1] && v <= zr[3]) z = zr[4];
    return z;
  };
  const grid = new Array(nu * nv);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) grid[j * nu + i] = zoneAt(-w / 2 + (i + 0.5) * pu, -d / 2 + (j + 0.5) * pv);
  }
  const used = new Uint8Array(nu * nv);
  const big = (z) => z === 'grass' || z === 'soil' || z === 'pavers' || z === 'dirt';
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (used[j * nu + i]) continue;
      const z = grid[j * nu + i];
      const same = (ii, jj) => ii < nu && jj < nv && !used[jj * nu + ii] && grid[jj * nu + ii] === z;
      let su = 1, sv = 1;
      const r = prng.float();
      if (big(z) && r < (z === 'pavers' ? 0.35 : 0.55) && same(i + 1, j) && same(i, j + 1) && same(i + 1, j + 1)) { su = 2; sv = 2; }
      else if (r < 0.75 && same(i + 1, j)) su = 2;
      else if (r < 0.9 && same(i, j + 1)) sv = 2;
      for (let jj = j; jj < j + sv; jj++) for (let ii = i; ii < i + su; ii++) used[jj * nu + ii] = 1;
      const cu = -w / 2 + (i + su / 2) * pu, cv = -d / 2 + (j + sv / 2) * pv;
      const pal = ZONE_TILES[z] || style.tiles;
      const color = pal[prng.int(0, pal.length - 1)];
      const sx = (su * pu) / 0.8, sz = (sv * pv) / 0.8;
      parts.push(P('sp-tile', color, cu, -DECK_TILE_H, cv, 0, 0, 0, sx, 1, sz));
      const sp = ZONE_STUD_P[z] ?? style.studP;
      if (sp > 0 && prng.chance(sp * su * sv)) {
        const ox = (prng.int(0, su - 1) - (su - 1) / 2) * pu, oz = (prng.int(0, sv - 1) - (sv - 1) / 2) * pv;
        parts.push(P('sp-stud', color, cu + ox, 0, cv + oz, 0, 0, 0, k, k, k));
      }
      // pavers: the odd round 1x1 tile / blue accent tile, like the reference plaza
      if (z === 'pavers' && su === 1 && sv === 1 && prng.chance(0.04)) {
        parts.push(P('sp-cyl', prng.chance(0.5) ? 'mediumStoneGrey' : 'lightStoneGrey', cu, 0, cv, 0, 0, 0, 0.3 * k, 0.02, 0.3 * k));
      } else if (z === 'pavers' && su === 1 && sv === 1 && prng.chance(0.015)) {
        parts.push(P('sp-tile', prng.chance(0.6) ? 'darkAzur' : 'mediumAzur', cu, 0.0, cv, 0, 0, 0, 0.5 * k, 0.25, 0.5 * k));
      }
    }
  }
  return parts;
}

// ---- skate ------------------------------------------------------------------------------------------------------
/** LOOP c6 (C4): slope tiles. Each band along the slope is split across the width into ~0.8 m tiles with 4.5 cm
 * gaps, coloured from a three-tone palette (two shades + the checker colour) by a fixed pattern, over a darker
 * underlay (the wedge/quarter body), so the seams read as a built-up slope of plates instead of one flat colour. */
const ORANGE_TILES = ['#E2661B', '#D2581A', '#F39A3E'];
const YELLOW_TILES = ['brightYellow', '#F2B926', '#FFE066'];
const ORANGE_UNDER = '#8E3A10';
const YELLOW_UNDER = '#A87412';
const tileTone = (pal, k, i) => pal[(k * 2 + i * 3 + ((k * i) % 2)) % pal.length];
/** Tiles over a wedge's slope (wedge-local: rises from z=+D/2, y=0 to z=-D/2, y=H, width W). */
function slopeBands(W, H, D, pal, n = 4) {
  const parts = [];
  const len = Math.hypot(D, H) / n, th = Math.atan2(H, D);
  const m = Math.max(1, Math.round(W / 0.8)), tw = W / m;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    for (let i = 0; i < m; i++) {
      parts.push(P('sp-box', tileTone(pal, k, i), -W / 2 + (i + 0.5) * tw, H * (1 - t) + 0.004, -D / 2 + D * t, th, 0, 0, tw - 0.045, 0.03, len - 0.045));
    }
  }
  return parts;
}
/** Tiles over a quarter-pipe face (same unit profile as sp-qpipe, scaled W x H x R): every facet split across the
 * width into ~0.8 m tiles. */
function qpipeBands(W, H, R, pal, N = 8) {
  const parts = [];
  const pt = (k) => { const t = (k / N) * Math.PI / 2; return [R * (0.5 - Math.sin(t)), H * (1 - Math.cos(t))]; };
  const m = Math.max(1, Math.round(W / 0.8)), tw = W / m;
  for (let k = 0; k < N; k++) {
    const [z1, y1] = pt(k + 1), [z0, y0] = pt(k);
    const dz = z0 - z1, dy = y0 - y1, len = Math.hypot(dz, dy);
    const th = Math.atan2(-dy, dz);
    for (let i = 0; i < m; i++) {
      parts.push(P('sp-box', tileTone(pal, k, i), -W / 2 + (i + 0.5) * tw, (y0 + y1) / 2 + 0.004, (z0 + z1) / 2, th, 0, 0, tw - 0.045, 0.03, len - 0.04));
    }
  }
  return parts;
}
/** Full stud grid (pitch 0.4 m, half-size studs like the 0.4 m deck) over a rectangle, skipping `skip(x, z)`. */
function studGrid(out, colorAt, x0, x1, z0, z1, y, skip = null) {
  const pitch = 0.4, k = 0.5;
  const nx = Math.max(1, Math.floor((x1 - x0) / pitch)), nz = Math.max(1, Math.floor((z1 - z0) / pitch));
  const ox = x0 + (x1 - x0 - (nx - 1) * pitch) / 2, oz = z0 + (z1 - z0 - (nz - 1) * pitch) / 2;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const x = ox + i * pitch, z = oz + j * pitch;
      if (skip && skip(x, z)) continue;
      out.push(P('sp-stud', colorAt(x, z, i, j), x, y, z, 0, 0, 0, k, k, k));
    }
  }
}

/** Quarter pipe + its deck: curve (orange) facing +z, side cheeks (blue), deck platform behind with railing and
 * coping. Fields: qw (width, x), qh (height). The kind origin is the footprint centre (curve + deck). */
function skateQuarter(prng, prop) {
  const w = prop.qw || 5, h = prop.qh || 2.2, r = h * 1.05, dp = prop.deck ?? 1.5;
  const total = r + dp;
  const z0 = -total / 2; // back edge
  const curveZ = z0 + dp + r / 2;
  const cOr = prop.color || pick(prng, ORANGE);
  const side = prop.side || pick(prng, ['#2F6FB5', 'mediumAzur', TEAL]);
  const parts = [];
  parts.push(P('sp-qpipe', ORANGE_UNDER, 0, 0, curveZ, 0, 0, 0, w, h, r));
  // side cheeks follow the curve (thin quarter-pipe slabs), with studs along the top lip
  for (const sx of [-1, 1]) {
    parts.push(P('sp-qpipe', side, sx * (w / 2 + 0.07), 0, curveZ, 0, 0, 0, 0.14, h + 0.06, r + 0.02));
    parts.push(brick(side, sx * (w / 2 + 0.07), 0, z0 + dp / 2, 0.14, h + 0.06, dp));
    for (let k = 0; k < 3; k++) parts.push(stud(side, sx * (w / 2 + 0.07), h * (0.25 + k * 0.22), z0 + dp * 0.3));
  }
  // tiled facet plates on the riding face (reads as stacked curved slope bricks; c6: per-facet ~0.8 m tiles)
  parts.push(...under(mat(0, 0, curveZ), qpipeBands(w, h, r, cOr === '#E2661B' ? ORANGE_TILES : [cOr, ...ORANGE_TILES.slice(1)])));
  // deck support (checker grey) + deck plate + coping + railing
  const nseg = Math.max(2, Math.round(w / 1.2));
  for (let k = 0; k < nseg; k++) {
    for (let t = 0; t < 2; t++) {
      const c = (k + t) % 2 ? 'mediumStoneGrey' : 'darkStoneGrey';
      parts.push(brick(c, -w / 2 + (k + 0.5) * (w / nseg), t * (h / 2), z0 + dp / 2, w / nseg - 0.02, h / 2 - 0.01, dp - 0.02));
    }
  }
  parts.push(brick('darkStoneGrey', 0, h, z0 + dp / 2, w + 0.3, 0.1, dp + 0.05));
  // c6: full stud grid on the deck (clear of the railing line and the coping)
  studGrid(parts, () => 'darkStoneGrey', -w / 2, w / 2, z0 + 0.2, z0 + dp - 0.12, h + 0.1);
  parts.push(cylX(prop.coping || TEAL, 0, h + 0.02, z0 + dp - 0.02, 0.085, w + 0.2));
  // railing on the deck's back edge and sides
  const railC = 'darkStoneGrey';
  for (let k = 0; k <= 5; k++) parts.push(box(railC, -w / 2 + (k / 5) * w, h + 0.1, z0 + 0.1, 0.07, 0.95, 0.07));
  parts.push(box(railC, 0, h + 1.02, z0 + 0.1, w, 0.07, 0.08));
  parts.push(box(railC, 0, h + 0.55, z0 + 0.1, w, 0.05, 0.05));
  for (const sx of [-1, 1]) {
    parts.push(box(railC, sx * (w / 2 - 0.05), h + 0.1, z0 + dp * 0.55, 0.07, 0.95, 0.07));
    parts.push(box(railC, sx * (w / 2 - 0.05), h + 1.02, z0 + dp * 0.3, 0.08, 0.07, dp * 0.6));
  }
  // transition plate at the bottom lip
  parts.push(box('mediumStoneGrey', 0, 0, curveZ + r / 2 + 0.12, w, 0.03, 0.26));
  return parts;
}

/** The central bank/platform: checker-grey block with an orange studded top, teal coping, a wedge bank to the
 * front, stairs down the left end and a curved bank down the right end; a mini quarter on the back of the top. */
function skateBank(prng, prop) {
  const L = prop.L || 6.4, D = prop.D || 3.6, H = prop.H || 1.2;
  const parts = [];
  const nseg = Math.max(3, Math.round(L / 1.2));
  for (let k = 0; k < nseg; k++) {
    for (let t = 0; t < 2; t++) {
      const c = (k + t) % 2 ? 'mediumStoneGrey' : '#6E7376';
      parts.push(brick(c, -L / 2 + (k + 0.5) * (L / nseg), t * (H / 2), 0, L / nseg - 0.02, H / 2 - 0.01, D - 0.02));
    }
  }
  // orange top with tan strips and (c6) a full stud grid, clear of the copings and the mini quarter at the back
  parts.push(brick('#E2661B', 0, H, 0, L, 0.12, D));
  const stripX = [];
  for (let k = 0; k < 3; k++) {
    const x = -L / 2 + 0.6 + k * (L - 1.2) / 2;
    stripX.push(x);
    parts.push(box('#F08A2E', x, H + 0.12, 0, 0.8, 0.012, D - 0.5));
  }
  const onStrip = (x) => stripX.some((sx) => Math.abs(x - sx) < 0.4);
  const mqX0 = -L * 0.18 - L * 0.25 - 0.1, mqX1 = -L * 0.18 + L * 0.25 + 0.1, mqZ1 = -D / 2 + 1.1;
  studGrid(parts, (x) => (onStrip(x) ? '#F08A2E' : '#E2661B'), -L / 2 + 0.05, L / 2 - 0.05, -D / 2 + 0.3, D / 2 - 0.3, H + 0.12,
    (x, z) => x > mqX0 && x < mqX1 && z < mqZ1);
  // teal coping along front and back
  parts.push(brick(TEAL, 0, H, D / 2 - 0.12, L + 0.04, 0.2, 0.26));
  parts.push(brick(TEAL, 0, H, -D / 2 + 0.12, L + 0.04, 0.2, 0.26));
  // front wedge bank (orange), sloping down toward +z
  const bw = L * 0.42;
  parts.push(P('sp-wedge', ORANGE_UNDER, -L * 0.12, 0, D / 2 + 1.0, 0, 0, 0, bw, H, 2.0));
  parts.push(...under(mat(-L * 0.12, 0, D / 2 + 1.0), slopeBands(bw, H, 2.0, ORANGE_TILES)));
  parts.push(P('sp-wedge', TEAL, -L * 0.12 - bw / 2 - 0.25, 0, D / 2 + 1.0, 0, 0, 0, 0.5, H + 0.12, 2.0));
  // left stairs: 4 steps down along -x
  for (let k = 0; k < 4; k++) {
    const y = H * (1 - (k + 1) / 5);
    const x = -L / 2 - 0.25 - k * 0.5;
    parts.push(brick('mediumStoneGrey', x, 0, 0.2, 0.5, y, D * 0.62));
    parts.push(brick(k % 2 ? '#E2661B' : '#F08A2E', x, y, 0.2, 0.5, 0.1, D * 0.62));
  }
  // stair handrail (teal) descending with the steps
  const sl = Math.hypot(2.0, H);
  parts.push(P('sp-box', TEAL, -L / 2 - 1.0, H * 0.5 + 0.75, 0.2 + D * 0.31 + 0.05, 0, 0, Math.atan2(H, 2.0), sl, 0.07, 0.07));
  for (let k = 0; k < 3; k++) parts.push(box(TEAL, -L / 2 - 0.2 - k * 0.8, H * (1 - (k * 0.8 + 0.2) / 2.4) - 0.1, 0.2 + D * 0.31 + 0.05, 0.06, 0.95, 0.06));
  // right end: curved bank down to the ground, concave face toward +x
  parts.push(P('sp-qpipe', ORANGE_UNDER, L / 2 + H * 0.65, 0, 0, 0, Math.PI / 2, 0, D, H, H * 1.3));
  parts.push(...under(mat(L / 2 + H * 0.65, 0, 0, 0, Math.PI / 2, 0), qpipeBands(D, H, H * 1.3, ORANGE_TILES, 6)));
  parts.push(P('sp-qpipe', TEAL, L / 2 + H * 0.65, 0, D / 2 + 0.06, 0, Math.PI / 2, 0, 0.12, H + 0.04, H * 1.3));
  parts.push(P('sp-qpipe', TEAL, L / 2 + H * 0.65, 0, -D / 2 - 0.06, 0, Math.PI / 2, 0, 0.12, H + 0.04, H * 1.3));
  // mini quarter on the back of the top (grey), with a coping bar
  parts.push(P('sp-qpipe', 'mediumStoneGrey', -L * 0.18, H + 0.12, -D / 2 + 0.55, 0, 0, 0, L * 0.5, 0.9, 1.0));
  parts.push(cylX('lightStoneGrey', -L * 0.18, H + 1.02, -D / 2 + 0.07, 0.07, L * 0.5));
  for (let k = 0; k < 4; k++) parts.push(stud('mediumStoneGrey', -L * 0.18 - L * 0.2 + k * L * 0.133, H + 1.02, -D / 2 + 0.2));
  return parts;
}

function skateFunbox(prng, prop) {
  const L = prop.L || 3.6, D = prop.D || 1.5, H = prop.H || 0.55;
  const parts = [];
  parts.push(brick('darkStoneGrey', 0, 0, 0, L, H, D));
  parts.push(brick('#E2661B', 0, H, 0, L, 0.1, D));
  parts.push(brick('darkStoneGrey', 0, H + 0.1, D / 2 - 0.1, L, 0.12, 0.2));
  // slopes at both ends (yellow-orange like the reference's fun-box)
  parts.push(P('sp-wedge', YELLOW_UNDER, -L / 2 - 0.7, 0, 0, 0, -Math.PI / 2, 0, D, H + 0.1, 1.4));
  parts.push(P('sp-wedge', YELLOW_UNDER, L / 2 + 0.7, 0, 0, 0, Math.PI / 2, 0, D, H + 0.1, 1.4));
  parts.push(...under(mat(-L / 2 - 0.7, 0, 0, 0, -Math.PI / 2, 0), slopeBands(D, H + 0.1, 1.4, YELLOW_TILES, 3)));
  parts.push(...under(mat(L / 2 + 0.7, 0, 0, 0, Math.PI / 2, 0), slopeBands(D, H + 0.1, 1.4, YELLOW_TILES, 3)));
  // c6: stud grid on the deck top (around the planter)
  studGrid(parts, () => '#E2661B', -L / 2 + 0.1, L / 2 - 0.1, -D / 2 + 0.15, D / 2 - 0.3, H + 0.1, (x, z) => x > -0.65 && x < 1.05 && z < 0.3);
  // planter on top: wood box + big-leaf plant
  parts.push(brick('#B5835A', 0.2, H + 0.1, -0.15, 1.4, 0.32, 0.7));
  parts.push(box('reddishBrown', 0.2, H + 0.42, -0.15, 1.25, 0.03, 0.55));
  parts.push(leaf('#3E9447', -0.1, H + 0.42, -0.15, 1.4, 0.4), leaf('brightGreen', 0.55, H + 0.42, -0.1, 1.1, 1.9));
  parts.push(leaf('darkGreen', 0.2, H + 0.42, -0.25, 0.8, 1.0));
  return parts;
}

function skateRail(prng, prop) {
  const L = prop.len || 3.2, H = 0.48;
  const parts = [cylX('brightYellow', 0, H, 0, 0.05, L)];
  for (const x of [-L / 2 + 0.2, 0, L / 2 - 0.2]) {
    parts.push(cyl('darkStoneGrey', x, 0, 0, 0.05, H));
    parts.push(box('darkStoneGrey', x, 0, 0, 0.3, 0.04, 0.3));
  }
  return parts;
}

function barrierHoop(prng) {
  const c = pick(prng, ['brightYellow', 'brightYellow', 'brightOrange']);
  return [
    cyl(c, -0.38, 0, 0, 0.055, 0.7), cyl(c, 0.38, 0, 0, 0.055, 0.7),
    cylX(c, 0, 0.72, 0, 0.065, 0.86), cylX(c, 0, 0.38, 0, 0.045, 0.76),
    cyl('darkStoneGrey', -0.38, 0, 0, 0.09, 0.05), cyl('darkStoneGrey', 0.38, 0, 0, 0.09, 0.05),
  ];
}

function pallet(prng, prop) {
  const n = prop.count || 2;
  const parts = [];
  const wood = ['#B5835A', '#A9764C', '#C08E62'];
  for (let k = 0; k < n; k++) {
    const y = k * 0.24, ry = prng.range(-0.08, 0.08);
    const m = mat(prng.range(-0.04, 0.04), y, prng.range(-0.04, 0.04), 0, ry, 0);
    const layer = [];
    for (const z of [-0.45, 0, 0.45]) layer.push(box('#8A5A36', 0, 0, z, 1.2, 0.12, 0.14));
    for (let s = 0; s < 5; s++) layer.push(box(pick(prng, wood), -0.5 + s * 0.25, 0.12, 0, 0.18, 0.05, 1.05));
    parts.push(...under(m, layer));
  }
  return parts;
}

function planterBox(prng, prop) {
  const L = prop.len || 2.2, D = prop.D || 1.0, H = prop.H || 0.6;
  const wall = prop.wall || pick(prng, ['lightStoneGrey', 'tan', '#B5835A']);
  const parts = [brick(wall, 0, 0, 0, L, H, D), box('reddishBrown', 0, H - 0.02, 0, L - 0.2, 0.04, D - 0.2)];
  studRow(parts, wall, -L / 2 + 0.2, L / 2 - 0.2, H, D / 2 - 0.12);
  const n = Math.max(2, Math.round(L / 0.65));
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + 0.35 + k * (L - 0.7) / Math.max(1, n - 1);
    if (prng.chance(0.45)) parts.push(shrub(pick(prng, LEAF), x, H + 0.15, prng.range(-0.15, 0.15), prng.range(0.32, 0.45), prng.range(0, 6)));
    else parts.push(leaf(pick(prng, LEAF), x, H, prng.range(-0.15, 0.15), prng.range(1.0, 1.5), prng.range(0, 6)));
    if (prop.lavender !== false && prng.chance(0.6)) {
      for (let f = 0; f < 3; f++) parts.push(P('flowerbed-flower', pick(prng, ['mediumLilac', '#8C6BC8', 'brightPurple']), x + prng.range(-0.25, 0.25), H, prng.range(-0.3, 0.3), 0, 0, 0, 1.1, 2.6, 1.1));
    }
  }
  return parts;
}

function flowerClump(prng) {
  const parts = [];
  const n = prng.int(2, 4);
  for (let k = 0; k < n; k++) {
    const a = prng.range(0, Math.PI * 2), r = prng.range(0, 0.35);
    parts.push(leaf(pick(prng, LEAF), Math.cos(a) * r, 0, Math.sin(a) * r, prng.range(0.6, 0.85), prng.range(0, 6)));
  }
  const fc = pick(prng, FLOWERS);
  for (let k = 0; k < prng.int(3, 5); k++) {
    const a = prng.range(0, Math.PI * 2), r = prng.range(0.05, 0.4);
    parts.push(flower(prng.chance(0.8) ? fc : pick(prng, FLOWERS), Math.cos(a) * r, 0.06, Math.sin(a) * r, prng.range(1.2, 1.6)));
  }
  return parts;
}

// ---- garden -----------------------------------------------------------------------------------------------------
function pergola(prng, prop) {
  const W = prop.W || 4.4, D = prop.D || 3.2, H = prop.H || 2.6;
  const post = prop.post || 'white', beam = prop.beam || 'white';
  const parts = [];
  const xs = W > 5 ? [-W / 2, 0, W / 2] : [-W / 2, W / 2];
  for (const x of xs) {
    for (const z of [-D / 2, D / 2]) {
      parts.push(brick(post, x, 0, z, 0.24, H, 0.24));
      parts.push(brick(post, x, 0, z, 0.36, 0.25, 0.36));
      // climbing vines on the front posts
      if (z > 0 && prop.vines !== false) {
        for (let k = 0; k < 4; k++) parts.push(leaf(pick(prng, LEAF), x + prng.range(-0.1, 0.1), 0.35 + k * 0.5, z + 0.12, prng.range(0.7, 0.95), prng.range(0, 6)));
      }
    }
  }
  // two long beams + cross slats
  for (const z of [-D / 2, D / 2]) parts.push(box(beam, 0, H, z, W + 0.9, 0.24, 0.16));
  const nS = Math.round((W + 0.6) / 0.42);
  for (let k = 0; k <= nS; k++) parts.push(box(beam, -W / 2 - 0.3 + k * 0.42, H + 0.24, 0, 0.1, 0.12, D + 0.7));
  // vine cover on top + hanging flowers
  if (prop.vines !== false) {
    const nv = Math.round(W * 1.1);
    for (let k = 0; k < nv; k++) {
      const x = prng.range(-W / 2, W / 2), z = prng.range(-D / 2, D / 2);
      parts.push(P('tree-leaves', pick(prng, LEAF), x, H + 0.32, z, 0, prng.range(0, 6), 0, prng.range(0.45, 0.7), 0.22, prng.range(0.45, 0.7)));
    }
    for (let k = 0; k < Math.round(W * 1.5); k++) {
      parts.push(flower(pick(prng, ['brightPink', 'mediumLilac', 'white', '#F28CB7']), prng.range(-W / 2, W / 2), H + 0.42, prng.range(-D / 2, D / 2), prng.range(1.2, 1.6)));
    }
    // hanging tendrils along the front beam
    for (let k = 0; k < Math.round(W * 1.2); k++) {
      parts.push(leaf(pick(prng, LEAF), prng.range(-W / 2, W / 2), H - 0.3, D / 2 + 0.05, prng.range(0.55, 0.8), prng.range(0, 6)));
    }
  }
  if (prop.swing) {
    // striped swing bench hanging from the back beam
    const sy = 0.5;
    for (const x of [-0.8, 0.8]) parts.push(box('lightStoneGrey', x, sy + 0.05, -D / 2 + 0.6, 0.03, H - sy - 0.05, 0.03));
    for (let k = 0; k < 6; k++) parts.push(box(k % 2 ? 'white' : 'brightRed', -0.75 + k * 0.3, sy, -D / 2 + 0.6, 0.3, 0.08, 0.6));
    for (let k = 0; k < 6; k++) parts.push(P('sp-box', k % 2 ? 'white' : 'brightRed', -0.75 + k * 0.3, sy + 0.05, -D / 2 + 0.3, -0.25, 0, 0, 0.3, 0.6, 0.06));
  }
  return parts;
}

function arbour(prng, prop) {
  // Garden gate arbour: two lattice sides, a flat slatted top with end caps, a tidy vine band along the top and a
  // few climbing leaves (an earlier arched top read as a jumble of rotated bricks from the hero's height).
  const W = prop.W || 1.8, H = 2.3;
  const parts = [];
  for (const x of [-W / 2, W / 2]) {
    for (const z of [-0.28, 0.28]) parts.push(box('white', x, 0, z, 0.11, H, 0.11));
    for (let k = 0; k < 5; k++) parts.push(box('white', x, 0.3 + k * 0.42, 0, 0.06, 0.05, 0.56));
  }
  for (const z of [-0.28, 0.28]) parts.push(box('white', 0, H, z, W + 0.6, 0.16, 0.1));
  for (let k = 0; k < 6; k++) parts.push(box('white', -W / 2 - 0.15 + k * (W + 0.3) / 5, H + 0.16, 0, 0.08, 0.08, 0.86));
  for (let k = 0; k < 6; k++) {
    const x = -W / 2 + k * (W / 5);
    parts.push(P('tree-leaves', pick(prng, LEAF), x, H + 0.22, prng.range(-0.1, 0.1), 0, prng.range(0, 6), 0, 0.32, 0.14, 0.4));
    if (k % 2 === 0) parts.push(flower(pick(prng, ['brightPink', 'brightRed', 'white']), x + 0.1, H + 0.3, prng.range(-0.2, 0.2), 1.4));
  }
  for (const x of [-W / 2, W / 2]) {
    for (let k = 0; k < 3; k++) parts.push(leaf(pick(prng, LEAF), x + prng.range(-0.06, 0.06), 0.45 + k * 0.6, prng.range(-0.15, 0.15), 0.75, prng.range(0, 6)));
  }
  return parts;
}

function sandbox(prng, prop) {
  const S = prop.S || 3.0;
  const parts = [];
  const wood = ['reddishBrown', '#6B3A1C', '#7A4524'];
  const H = 0.4;
  for (const [x, z, sx, sz] of [[0, -S / 2, S + 0.3, 0.3], [0, S / 2, S + 0.3, 0.3], [-S / 2, 0, 0.3, S - 0.3], [S / 2, 0, 0.3, S - 0.3]]) {
    const n = Math.max(1, Math.round(Math.max(sx, sz) / 0.8));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n - 0.5;
      parts.push(brick(pick(prng, wood), x + (sx > sz ? t * sx : 0), 0, z + (sz > sx ? t * sz : 0), sx > sz ? sx / n - 0.02 : sx, H, sz > sx ? sz / n - 0.02 : sz));
    }
    parts.push(box('tan', x, H, z, sx, 0.06, sz));
  }
  parts.push(box('#E9D3A0', 0, 0, 0, S - 0.3, H - 0.1, S - 0.3));
  // sand mounds
  for (let k = 0; k < 3; k++) parts.push(brick('#E2C58E', prng.range(-S / 3, S / 3), H - 0.12, prng.range(-S / 3, S / 3), prng.range(0.4, 0.7), 0.12, prng.range(0.4, 0.7)));
  // sand castle: base + towers + studs
  const cx = -S * 0.12, cz = -S * 0.1, by = H - 0.1;
  parts.push(brick('#E2C58E', cx, by, cz, 0.7, 0.28, 0.6));
  for (const [dx, dz, h] of [[-0.22, -0.18, 0.45], [0.22, -0.18, 0.36], [-0.22, 0.18, 0.32], [0.22, 0.18, 0.5]]) {
    parts.push(cyl('#E2C58E', cx + dx, by + 0.28, cz + dz, 0.12, h));
    parts.push(stud('#E2C58E', cx + dx, by + 0.28 + h, cz + dz));
  }
  parts.push(cyl('tan', cx, by + 0.28, cz, 0.16, 0.6), P('sp-cyl', 'brightRed', cx, by + 0.88, cz, 0, 0, 0, 0.03, 0.25, 0.03));
  parts.push(box('brightRed', cx + 0.1, by + 1.03, cz, 0.18, 0.1, 0.02));
  // buckets + spade
  parts.push(cyl('brightRed', S * 0.25, by, S * 0.2, 0.15, 0.22), cyl('brightRed', S * 0.25, by + 0.2, S * 0.2, 0.17, 0.03));
  parts.push(cyl('brightBlue', S * 0.05, by, S * 0.3, 0.13, 0.2), cyl('brightBlue', S * 0.05, by + 0.18, S * 0.3, 0.15, 0.03));
  parts.push(P('sp-box', 'brightYellow', S * 0.3, by + 0.02, -S * 0.15, 0, 0.7, 0.5, 0.08, 0.5, 0.12));
  return parts;
}

function pond(prng, prop) {
  const R = prop.R || 1.9;
  const parts = [];
  const lobes = [[0, 0, R], [R * 0.55, R * 0.25, R * 0.72], [-R * 0.5, R * 0.2, R * 0.65]];
  for (const [x, z, r] of lobes) {
    parts.push(P('sp-cyl', '#1C4F7A', x, 0, z, 0, 0, 0, r, 0.04, r * 0.8));
    parts.push(P('sp-water', null, x, 0.04, z, 0, 0, 0, r, 0.05, r * 0.8));
  }
  // stone rim: chunky grey bricks around the outline of the lobes
  const N = 22;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * Math.PI * 2;
    // furthest lobe edge along this direction
    let best = 0;
    for (const [x, z, r] of lobes) {
      const dx = Math.cos(a), dz = Math.sin(a);
      // ray from origin hitting ellipse (x,z,r,0.8r)
      const ex = r, ez = r * 0.8;
      const A = (dx * dx) / (ex * ex) + (dz * dz) / (ez * ez);
      const B = -2 * ((x * dx) / (ex * ex) + (z * dz) / (ez * ez));
      const C = (x * x) / (ex * ex) + (z * z) / (ez * ez) - 1;
      const disc = B * B - 4 * A * C;
      if (disc >= 0) best = Math.max(best, (-B + Math.sqrt(disc)) / (2 * A));
    }
    const s = prng.range(0.32, 0.5);
    parts.push(brick(pick(prng, ['mediumStoneGrey', 'darkStoneGrey', 'lightStoneGrey', '#8E9391']), Math.cos(a) * (best + 0.05), 0, Math.sin(a) * (best + 0.05), s, prng.range(0.12, 0.24), s * prng.range(0.7, 1.2), a + prng.range(-0.3, 0.3)));
  }
  // lily pads + a flower, reeds with cattails, a frog and a duck
  for (let k = 0; k < 5; k++) {
    const [x, z, r] = lobes[k % 3];
    const a = prng.range(0, Math.PI * 2), d = prng.range(0.2, r * 0.6);
    parts.push(P('sp-cyl', pick(prng, ['brightGreen', 'lime', '#3E9447']), x + Math.cos(a) * d, 0.095, z + Math.sin(a) * d * 0.8, 0, 0, 0, 0.2, 0.02, 0.2));
    if (k % 2 === 0) parts.push(flower('brightPink', x + Math.cos(a) * d, 0.05, z + Math.sin(a) * d * 0.8, 1.3));
  }
  for (let k = 0; k < 7; k++) {
    const x = -R * 0.9 + prng.range(-0.3, 0.3), z = -R * 0.45 + prng.range(-0.3, 0.3);
    const h = prng.range(0.7, 1.1);
    parts.push(P('sp-box', pick(prng, ['brightGreen', '#3E9447']), x, 0, z, prng.range(-0.1, 0.1), 0, prng.range(-0.1, 0.1), 0.04, h, 0.04));
    if (k % 2 === 0) parts.push(box('reddishBrown', x, h * 0.75, z, 0.08, 0.2, 0.08));
  }
  parts.push(brick('lime', R * 0.3, 0.1, -R * 0.2, 0.16, 0.1, 0.18));
  // duck
  const dx = R * 0.2, dz = R * 0.15;
  parts.push(brick('white', dx, 0.08, dz, 0.22, 0.14, 0.34), brick('white', dx, 0.18, dz + 0.14, 0.13, 0.13, 0.13), box('brightOrange', dx, 0.22, dz + 0.24, 0.06, 0.03, 0.08));
  return parts;
}

function pottedPlant(prng, prop) {
  const s = prop.s || prng.range(0.85, 1.2);
  const pot = pick(prng, ['#B4532A', '#C2643A', 'lightStoneGrey', 'darkStoneGrey']);
  const parts = [cyl(pot, 0, 0, 0, 0.22 * s, 0.34 * s), cyl(pot, 0, 0.3 * s, 0, 0.26 * s, 0.07 * s), cyl('reddishBrown', 0, 0.36 * s, 0, 0.2 * s, 0.02)];
  if (prng.chance(0.5)) parts.push(leaf(pick(prng, LEAF), 0, 0.36 * s, 0, 1.15 * s, prng.range(0, 6)));
  else {
    parts.push(shrub(pick(prng, LEAF), 0, 0.5 * s, 0, 0.32 * s, prng.range(0, 6)));
    for (let k = 0; k < 3; k++) parts.push(flower(pick(prng, FLOWERS), prng.range(-0.15, 0.15) * s, 0.62 * s, prng.range(-0.15, 0.15) * s, 1.2));
  }
  return parts;
}

function raisedBed(prng, prop) {
  const L = prop.len || 3.0, D = prop.D || 1.1, H = prop.H || 0.45;
  const wallC = prop.wall || pick(prng, ['reddishBrown', '#6B3A1C', 'darkStoneGrey']);
  const parts = [];
  const n = Math.max(2, Math.round(L / 0.8));
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + (k + 0.5) * (L / n);
    for (const z of [-D / 2 + 0.1, D / 2 - 0.1]) parts.push(brick(k % 2 ? wallC : '#5E3016', x, 0, z, L / n - 0.02, H, 0.2));
  }
  for (const x of [-L / 2 + 0.1, L / 2 - 0.1]) parts.push(brick(wallC, x, 0, 0, 0.2, H, D - 0.4));
  parts.push(box('#4A2A12', 0, 0, 0, L - 0.3, H - 0.04, D - 0.3));
  const kind = prop.plant || 'mixed';
  const m = Math.max(2, Math.round(L / 0.5));
  for (let k = 0; k < m; k++) {
    const x = -L / 2 + 0.35 + k * (L - 0.7) / Math.max(1, m - 1);
    if (kind === 'flowers' || (kind === 'mixed' && k % 2)) {
      parts.push(leaf(pick(prng, LEAF), x, H - 0.04, prng.range(-0.15, 0.15), prng.range(0.6, 0.8), prng.range(0, 6)));
      for (let f = 0; f < 2; f++) parts.push(flower(pick(prng, FLOWERS), x + prng.range(-0.15, 0.15), H + 0.02, prng.range(-0.25, 0.25), prng.range(1.3, 1.8)));
    } else {
      parts.push(leaf(pick(prng, ['brightGreen', 'lime', '#3E9447']), x, H - 0.04, prng.range(-0.18, 0.18), prng.range(0.85, 1.15), prng.range(0, 6)));
      if (prng.chance(0.4)) parts.push(P('sp-cyl', pick(prng, ['brightRed', 'brightOrange']), x + 0.12, H, 0.1, 0, 0, 0, 0.09, 0.12, 0.09));
    }
  }
  return parts;
}

function wheelbarrow(prng, prop) {
  const c = prop.color || pick(prng, ['brightGreen', 'brightRed', 'brightBlue']);
  const parts = [
    P('sp-brick', c, 0, 0.38, 0.05, 0.12, 0, 0, 0.62, 0.32, 0.85),
    box('reddishBrown', -0.22, 0.32, -0.45, 0.05, 0.05, 0.85), box('reddishBrown', 0.22, 0.32, -0.45, 0.05, 0.05, 0.85),
    box('darkStoneGrey', -0.2, 0, -0.3, 0.05, 0.38, 0.05), box('darkStoneGrey', 0.2, 0, -0.3, 0.05, 0.38, 0.05),
    cylX('black', 0, 0.2, 0.55, 0.2, 0.1), cylX('lightStoneGrey', 0, 0.2, 0.55, 0.08, 0.12),
  ];
  const load = prop.load || pick(prng, ['soil', 'hay', 'none']);
  if (load === 'soil') parts.push(brick('reddishBrown', 0, 0.62, 0.05, 0.5, 0.12, 0.7));
  if (load === 'hay') parts.push(brick(pick(prng, HAY), 0, 0.62, 0.05, 0.5, 0.18, 0.7));
  return parts;
}

// ---- farm -------------------------------------------------------------------------------------------------------
function soilRidge(L, prng) {
  return [brick(pick(prng, SOIL), 0, 0, 0, L, 0.14, 0.5)];
}

function cropWheatRow(prng, prop) {
  const L = prop.len || 6, sp = 0.32;
  const parts = [box(pick(prng, ['#D9A23A', '#CC9433']), 0, 0, 0, L, 0.05, 0.56)];
  const n = Math.max(1, Math.floor(L / sp));
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + (k + 0.5) * (L / n) + prng.range(-0.06, 0.06);
    const s = prng.range(0.92, 1.18);
    parts.push(P('sp-wheat', pick(prng, WHEAT), x, 0.04, prng.range(-0.06, 0.06), prng.range(-0.06, 0.06), prng.range(0, 6), prng.range(-0.06, 0.06), s, s * prng.range(0.95, 1.12), s));
  }
  return parts;
}

function cropCornRow(prng, prop) {
  const L = prop.len || 6, sp = 0.62;
  const parts = soilRidge(L, prng);
  const n = Math.max(1, Math.floor(L / sp));
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + (k + 0.5) * (L / n) + prng.range(-0.05, 0.05);
    const s = prng.range(0.85, 1.12);
    const ry = prng.range(0, 6);
    parts.push(P('sp-corn', pick(prng, ['brightGreen', '#3E9447', '#5BB04F']), x, 0.12, 0, prng.range(-0.05, 0.05), ry, prng.range(-0.05, 0.05), s, s, s));
    // a cob or two
    const ncob = prng.int(1, 2);
    for (let c = 0; c < ncob; c++) {
      const a = ry + c * 2.4;
      parts.push(P('sp-brick', pick(prng, ['brightYellow', '#F2C230']), x + Math.cos(a) * 0.1, 0.12 + s * (0.8 + c * 0.25), Math.sin(a) * 0.1, Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3, 0.11, 0.3, 0.11));
    }
  }
  return parts;
}

function cropVegRow(prng, prop) {
  const L = prop.len || 6, sp = 0.55;
  const parts = soilRidge(L, prng);
  const n = Math.max(1, Math.floor(L / sp));
  const veg = prop.veg || pick(prng, ['cabbage', 'carrot', 'pumpkin']);
  for (let k = 0; k < n; k++) {
    const x = -L / 2 + (k + 0.5) * (L / n);
    if (veg === 'pumpkin' && k % 2) {
      parts.push(P('sp-cyl', 'brightOrange', x, 0.12, 0, 0, 0, 0, 0.22, 0.24, 0.22), stud('#3E9447', x, 0.36, 0));
      parts.push(leaf('#3E9447', x + 0.2, 0.12, 0.05, 0.6, prng.range(0, 6)));
    } else if (veg === 'carrot') {
      parts.push(P('sp-box', '#5BB04F', x, 0.12, 0, 0, prng.range(0, 3), 0, 0.12, 0.32, 0.04), P('sp-box', '#5BB04F', x, 0.12, 0, 0, prng.range(0, 3), 0.3, 0.1, 0.28, 0.04));
      parts.push(P('sp-cyl', 'brightOrange', x, 0.1, 0, 0, 0, 0, 0.06, 0.04, 0.06));
    } else {
      parts.push(leaf(pick(prng, ['darkGreen', '#3E9447', 'sandGreen']), x, 0.12, 0, prng.range(0.65, 0.85), prng.range(0, 6)));
      parts.push(P('sp-brick', pick(prng, ['lime', '#A7D16B']), x, 0.12, 0, 0, prng.range(0, 3), 0, 0.22, 0.2, 0.22));
    }
  }
  return parts;
}

function hayBale(prng, prop) {
  const c = pick(prng, HAY);
  if ((prop.variant || 'round') === 'round') {
    return [
      cylX(c, 0, 0.55, 0, 0.55, 1.0),
      cylX('#C98F2C', 0, 0.55, 0, 0.57, 0.05), cylX('#C98F2C', 0.3, 0.55, 0, 0.57, 0.05), cylX('#C98F2C', -0.3, 0.55, 0, 0.57, 0.05),
    ];
  }
  return [brick(c, 0, 0, 0, 1.1, 0.5, 0.62), box('#A26A1E', -0.3, 0, 0, 0.04, 0.51, 0.64), box('#A26A1E', 0.3, 0, 0, 0.04, 0.51, 0.64)];
}

function hayStack(prng) {
  const parts = [];
  const layers = [[-0.58, 0.58], [0], []];
  const rowsZ = [-0.33, 0.33];
  // 2 deep x (2,1) wide pyramid + one on top
  for (const z of rowsZ) for (const x of layers[0]) parts.push(...under(mat(x, 0, z, 0, prng.range(-0.05, 0.05), 0), hayBale(prng, { variant: 'square' })));
  parts.push(...under(mat(0, 0.5, 0, 0, prng.range(-0.1, 0.1), 0), hayBale(prng, { variant: 'square' })));
  parts.push(...under(mat(0.05, 1.0, 0.05, 0, Math.PI / 2 + prng.range(-0.2, 0.2), 0), hayBale(prng, { variant: 'square' })));
  return parts;
}

function hayShock(prng) {
  const c = pick(prng, HAY);
  return [
    cyl(c, 0, 0, 0, 0.5, 0.42), cyl(pick(prng, HAY), 0, 0.42, 0, 0.42, 0.38), cyl(c, 0, 0.8, 0, 0.32, 0.32),
    cyl(pick(prng, HAY), 0, 1.12, 0, 0.18, 0.22), cyl('#A26A1E', 0, 0.74, 0, 0.44, 0.05),
    P('sp-wheat', c, 0, 1.25, 0, 0, prng.range(0, 6), 0, 0.7, 0.35, 0.7),
  ];
}

function scarecrow(prng) {
  const shirt = pick(prng, ['brightRed', 'darkRed', 'brightBlue', '#2F6FB5', 'brightOrange']);
  const lift = 0.62;
  const parts = [
    box('reddishBrown', 0, 0, -0.06, 0.1, 2.15, 0.1),
    box('reddishBrown', 0, 1.62, -0.06, 1.5, 0.08, 0.08),
    // sleeves along the cross bar + straw cuffs
    box(shirt, -0.48, 1.58, 0, 0.56, 0.16, 0.16), box(shirt, 0.48, 1.58, 0, 0.56, 0.16, 0.16),
    P('sp-wheat', pick(prng, HAY), -0.82, 1.66, 0, 0, 0, Math.PI / 2, 0.45, 0.28, 0.45),
    P('sp-wheat', pick(prng, HAY), 0.82, 1.66, 0, 0, 0, -Math.PI / 2, 0.45, 0.28, 0.45),
  ];
  parts.push(...under(mat(0, lift, 0), [
    { role: 'sp-legs', local: mat(0, 0, 0), color: pick(prng, ['sandBlue', 'darkAzur', 'reddishBrown']) },
    { role: 'sp-torso', local: mat(0, 0, 0), color: shirt },
    { role: 'sp-head', local: mat(0, 0, 0), color: pick(prng, ['brickYellow', 'tan']) },
    { role: 'sp-hat', local: mat(0, 0, 0), color: pick(prng, ['brickYellow', '#E8C77A']) },
  ]));
  parts.push({ role: 'sp-print', local: new THREE.Matrix4().multiplyMatrices(mat(0, lift, 0), HEAD_PRINT_M), color: parts[parts.length - 2].color, tile: 0 });
  return parts;
}

/** Dutch windmill (~11.5 m): octagonal stone base, tapered blue tower with white trim bands, a gallery with
 * railings, door + windows, dark gable cap and four white lattice sails facing +z. */
function windmill(prng, prop) {
  const body = prop.body || pick(prng, ['#2F6FB5', 'brightBlue']);
  const plank = body === 'brightBlue' ? '#2F7FC0' : '#3A7CC2';
  const parts = [];
  const APO = Math.cos(Math.PI / 8); // octagon apothem / circumradius
  const oct = (c, y, r, h) => parts.push(P('sp-oct', c, 0, y, 0, 0, 0, 0, r, h, r));
  // stone base + white plinth with studs
  oct('lightStoneGrey', 0, 2.35, 0.5);
  oct('white', 0.5, 2.05, 1.0);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    parts.push(stud('lightStoneGrey', Math.cos(a) * 2.12, 0.5, Math.sin(a) * 2.12));
  }
  // tapered octagonal tower: 12 plank courses stepping in (alternate tones read as clapboard)
  const N = 12, ch = 0.62, r0 = 1.78, r1 = 1.2;
  let y = 1.5;
  const rAt = (k) => r0 + (r1 - r0) * (k / (N - 1));
  for (let k = 0; k < N; k++) {
    oct(k % 2 ? plank : body, y, rAt(k), ch);
    y += ch;
    if (k === 2) {
      // gallery: white platform + railing ring
      oct('white', y - 0.05, 2.7, 0.14);
      oct('white', y - 0.25, 1.95, 0.2);
      const R = 2.7 * APO - 0.1;
      const len = 2 * R * Math.tan(Math.PI / 8) + 0.06;
      for (let p = 0; p < 8; p++) {
        const a = (p / 8) * Math.PI * 2, av = a + Math.PI / 8, rv = R / APO;
        parts.push(box('white', Math.cos(a) * R, y + 0.09, Math.sin(a) * R, 0.06, 0.7, 0.06));
        parts.push(box('white', Math.cos(av) * rv, y + 0.09, Math.sin(av) * rv, 0.08, 0.72, 0.08));
        parts.push(box('white', Math.cos(a) * R, y + 0.76, Math.sin(a) * R, 0.07, 0.07, len, -a));
        parts.push(box('white', Math.cos(a) * R, y + 0.42, Math.sin(a) * R, 0.04, 0.04, len, -a));
      }
    }
  }
  oct('white', y - 0.08, r1 + 0.1, 0.2);
  // door + windows on the +z face (each sits on the face of its course)
  parts.push(box('#1F3A64', 0, 0.5, 2.05 * APO, 0.9, 0.98, 0.06), box('white', 0, 1.46, 2.05 * APO + 0.02, 1.1, 0.12, 0.08));
  for (const k of [4, 8]) {
    const wy = 1.5 + k * ch + 0.05, wz = rAt(k + 0.5) * APO + 0.01;
    parts.push(P('sp-glass', null, 0, wy, wz, 0, 0, 0, 0.46, 0.66, 0.05));
    parts.push(box('white', 0, wy - 0.08, wz + 0.01, 0.66, 0.08, 0.06), box('white', 0, wy + 0.66, wz + 0.01, 0.66, 0.08, 0.06));
    parts.push(box('white', 0, wy, wz + 0.02, 0.05, 0.66, 0.04), box('#E2661B', 0, wy - 0.24, wz + 0.05, 0.5, 0.16, 0.12));
  }
  // cap: dark gable (ridge along z) + ridge cap
  const capY = y, capW = 2.6, capH = 1.45, capD = 2.9;
  parts.push(brick('#1F3A64', 0, capY, 0, capW, 0.3, capD));
  parts.push(P('sp-wedge', '#1F3A64', -capW / 4, capY + 0.3, 0, 0, -Math.PI / 2, 0, capD, capH, capW / 2));
  parts.push(P('sp-wedge', '#1F3A64', capW / 4, capY + 0.3, 0, 0, Math.PI / 2, 0, capD, capH, capW / 2));
  parts.push(box('white', 0, capY + 0.3 + capH - 0.05, 0, 0.14, 0.12, capD + 0.1));
  // hub + sails on the front of the cap
  const hubY = capY + 0.7, hubZ = capD / 2 + 0.35;
  parts.push(cylZ('reddishBrown', 0, hubY, hubZ - 0.3, 0.22, 0.8), cylZ('darkStoneGrey', 0, hubY, hubZ + 0.12, 0.3, 0.12));
  const a0 = prop.sailAngle ?? prng.range(0, Math.PI / 2);
  for (let k = 0; k < 4; k++) {
    const a = a0 + (k * Math.PI) / 2;
    const arm = [];
    arm.push(box('reddishBrown', 0, 0, 0, 0.16, 5.4, 0.1));
    // lattice sail on one side of the spar
    const sx = 0.62;
    arm.push(box('white', sx, 1.0, 0.02, 0.07, 4.3, 0.06), box('white', sx * 2 - 0.06, 1.0, 0.02, 0.07, 4.3, 0.06));
    for (let c = 0; c <= 8; c++) arm.push(box('white', sx, 1.0 + c * (4.3 / 8), 0.02, 1.2, 0.06, 0.06));
    arm.push(box('white', sx * 1.5 - 0.03, 1.0, 0.02, 0.05, 4.3, 0.05));
    parts.push(...under(mat(0, hubY, hubZ + 0.1, 0, 0, a), arm));
  }
  return parts;
}

/** Red barn (~7 x 6 m, ~6.4 m to the ridge): coursed red walls, white corner trim, white-braced double doors and
 * a hay-loft door on the +z gable, dark shingled roof with white fascia, ridge cupola. */
function barn(prng, prop) {
  const W = prop.W || 7.0, D = prop.D || 6.0, H = 3.6, R = 2.4;
  const reds = ['brightRed', '#B3261E'];
  const parts = [];
  const nC = 6, ch = H / nC;
  for (let c = 0; c < nC; c++) {
    const col = reds[c % 2];
    parts.push(brick(col, 0, c * ch, D / 2 - 0.15, W, ch - 0.01, 0.3));
    parts.push(brick(col, 0, c * ch, -D / 2 + 0.15, W, ch - 0.01, 0.3));
    parts.push(brick(col, -W / 2 + 0.15, c * ch, 0, 0.3, ch - 0.01, D - 0.6));
    parts.push(brick(col, W / 2 - 0.15, c * ch, 0, 0.3, ch - 0.01, D - 0.6));
  }
  for (const x of [-W / 2, W / 2]) for (const z of [-D / 2, D / 2]) parts.push(box('white', x, 0, z, 0.3, H, 0.3));
  parts.push(box('white', 0, H - 0.12, D / 2 + 0.02, W, 0.16, 0.08));
  // gable triangles (front + back): two wedges each, rotated so the profile lies in the x-y plane
  for (const z of [D / 2 - 0.15, -D / 2 + 0.15]) {
    parts.push(P('sp-wedge', reds[1], -W / 4, H, z, 0, -Math.PI / 2, 0, 0.3, R, W / 2));
    parts.push(P('sp-wedge', reds[1], W / 4, H, z, 0, Math.PI / 2, 0, 0.3, R, W / 2));
  }
  // roof planes + shingle strips + fascia
  const half = W / 2 + 0.35, slope = Math.atan2(R, W / 2), len = Math.hypot(half, R + 0.27);
  for (const s of [-1, 1]) {
    const m = mat(s * half / 2, H + R / 2 + 0.05, 0, 0, 0, -s * slope);
    parts.push(...under(m, [P('sp-brick', '#3B3F44', 0, -0.08, 0, 0, 0, 0, len, 0.16, D + 0.7)]));
    for (let k = 0; k < 5; k++) parts.push(...under(m, [P('sp-box', k % 2 ? '#4B5055' : '#2E3236', -len / 2 + 0.3 + k * (len - 0.4) / 5, 0.08, 0, 0, 0, 0, 0.07, 0.05, D + 0.68)]));
    parts.push(...under(m, [P('sp-box', 'white', 0, -0.1, D / 2 + 0.36, 0, 0, 0, len + 0.05, 0.22, 0.08)]));
    parts.push(...under(m, [P('sp-box', 'white', 0, -0.1, -D / 2 - 0.36, 0, 0, 0, len + 0.05, 0.22, 0.08)]));
  }
  parts.push(box('white', 0, H + R + 0.08, 0, 0.3, 0.16, D + 0.75));
  // cupola on the ridge
  parts.push(brick('white', 0, H + R + 0.15, 0, 0.8, 0.7, 0.8));
  parts.push(P('sp-wedge', '#3B3F44', -0.25, H + R + 0.85, 0, 0, -Math.PI / 2, 0, 1.0, 0.4, 0.5), P('sp-wedge', '#3B3F44', 0.25, H + R + 0.85, 0, 0, Math.PI / 2, 0, 1.0, 0.4, 0.5));
  // double doors with white frames + X braces
  const dz = D / 2 + 0.02, dw = 1.25, dh = 2.6;
  for (const sx of [-1, 1]) {
    const cx = sx * dw / 2;
    parts.push(box('darkRed', cx, 0, dz, dw - 0.04, dh, 0.08));
    parts.push(box('white', cx, 0, dz + 0.05, dw, 0.1, 0.06), box('white', cx, dh - 0.1, dz + 0.05, dw, 0.1, 0.06));
    parts.push(box('white', cx - sx * (dw / 2 - 0.05), 0, dz + 0.05, 0.1, dh, 0.06), box('white', cx + sx * (dw / 2 - 0.05), 0, dz + 0.05, 0.1, dh, 0.06));
    const diag = Math.hypot(dw - 0.2, dh - 0.2), ang = Math.atan2(dw - 0.2, dh - 0.2);
    parts.push(...under(mat(cx, dh / 2, dz + 0.07, 0, 0, ang), [P('sp-box', 'white', 0, -diag / 2, 0, 0, 0, 0, 0.09, diag, 0.05)]));
    parts.push(...under(mat(cx, dh / 2, dz + 0.07, 0, 0, -ang), [P('sp-box', 'white', 0, -diag / 2, 0, 0, 0, 0, 0.09, diag, 0.05)]));
  }
  // hay loft door + hay poking out
  parts.push(box('darkRed', 0, H + 0.2, dz, 1.1, 1.05, 0.08), box('white', 0, H + 0.15, dz + 0.04, 1.3, 0.1, 0.06), box('white', 0, H + 1.25, dz + 0.04, 1.3, 0.1, 0.06));
  parts.push(brick(pick(prng, HAY), 0, H + 0.25, dz + 0.1, 0.9, 0.35, 0.3));
  // side windows
  for (const sx of [-1, 1]) {
    parts.push(P('sp-glass', null, sx * (W / 2 + 0.01), 1.6, 0.9, 0, 0, 0, 0.04, 0.8, 0.8));
    parts.push(box('white', sx * (W / 2 + 0.03), 1.5, 0.9, 0.06, 0.1, 1.0), box('white', sx * (W / 2 + 0.03), 2.42, 0.9, 0.06, 0.1, 1.0));
  }
  return parts;
}

function silo(prng) {
  const parts = [cyl('lightStoneGrey', 0, 0, 0, 1.3, 6.2)];
  for (let k = 1; k <= 5; k++) parts.push(cyl(k % 2 ? 'mediumStoneGrey' : 'white', 0, k * 1.15, 0, 1.33, 0.1));
  parts.push(cyl('mediumStoneGrey', 0, 6.2, 0, 1.36, 0.18), cyl('lightStoneGrey', 0, 6.38, 0, 1.05, 0.35), cyl('lightStoneGrey', 0, 6.73, 0, 0.7, 0.3), cyl('brightRed', 0, 7.03, 0, 0.3, 0.25));
  // ladder
  for (const x of [-0.18, 0.18]) parts.push(box('darkStoneGrey', x, 0, 1.35, 0.05, 6.2, 0.05));
  for (let k = 0; k < 15; k++) parts.push(box('darkStoneGrey', 0, 0.3 + k * 0.4, 1.35, 0.36, 0.04, 0.04));
  parts.push(brick('mediumStoneGrey', 0, 0, 0, 3.0, 0.2, 3.0));
  return parts;
}

/** Pickup (forward = +z): body colour + cab + glazing + bed with cargo, chunky wheels with hubs. */
function pickup(prng, prop) {
  const c = prop.color || pick(prng, ['brightYellow', '#2E8B57', 'brightRed', 'mediumAzur', 'brightOrange']);
  const parts = [
    box('black', 0, 0.28, 0, 1.6, 0.22, 4.0),
    brick(c, 0, 0.45, 0.2, 1.9, 0.55, 4.2),
    brick(c, 0, 1.0, 0.95, 1.86, 0.18, 1.7),            // hood
    brick(c, 0, 1.0, -0.15, 1.86, 0.85, 1.25),           // cab
    brick(c, 0, 1.82, -0.15, 1.9, 0.12, 1.32),           // roof
    P('sp-glass', null, 0, 1.18, 0.5, -0.35, 0, 0, 1.7, 0.62, 0.05),
    P('sp-glass', null, -0.94, 1.22, -0.15, 0, 0, 0, 0.03, 0.5, 1.0), P('sp-glass', null, 0.94, 1.22, -0.15, 0, 0, 0, 0.03, 0.5, 1.0),
    box('lightStoneGrey', 0, 0.55, 2.31, 1.7, 0.3, 0.06),          // grille/bumper
    box('white', -0.65, 0.85, 2.31, 0.3, 0.16, 0.05), box('white', 0.65, 0.85, 2.31, 0.3, 0.16, 0.05),
    box('brightRed', -0.75, 0.75, -1.91, 0.25, 0.18, 0.05), box('brightRed', 0.75, 0.75, -1.91, 0.25, 0.18, 0.05),
  ];
  // bed walls
  parts.push(box(c, -0.9, 1.0, -1.3, 0.1, 0.4, 1.3), box(c, 0.9, 1.0, -1.3, 0.1, 0.4, 1.3), box(c, 0, 1.0, -1.88, 1.9, 0.4, 0.08));
  for (const [x, z] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.25], [0.95, -1.25]]) {
    parts.push(cylX('black', x, 0.42, z, 0.42, 0.34), cylX('lightStoneGrey', x + Math.sign(x) * 0.02, 0.42, z, 0.2, 0.36));
  }
  const cargo = prop.cargo || 'hay';
  if (cargo === 'hay') {
    parts.push(brick(pick(prng, HAY), -0.3, 1.0, -1.3, 0.62, 0.5, 1.1), brick(pick(prng, HAY), 0.32, 1.0, -1.3, 0.62, 0.5, 1.1), brick(pick(prng, HAY), 0, 1.5, -1.25, 0.62, 0.45, 1.05, 0.1));
  } else if (cargo === 'crates') {
    parts.push(brick('tan', -0.35, 1.0, -1.0, 0.6, 0.55, 0.6), brick('#B5835A', 0.35, 1.0, -1.5, 0.6, 0.55, 0.6), brick('tan', 0.3, 1.0, -0.85, 0.55, 0.5, 0.55));
  }
  return parts;
}

function tractor(prng, prop) {
  const c = prop.color || pick(prng, ['#2E8B3E', 'brightRed']);
  const parts = [
    box('darkStoneGrey', 0, 0.45, 0.2, 0.8, 0.3, 2.6),
    brick(c, 0, 0.75, 0.75, 0.9, 0.7, 1.6),                  // hood
    box('darkStoneGrey', 0, 0.8, 1.56, 0.7, 0.55, 0.05),       // grille
    brick(c, 0, 0.75, -0.55, 1.2, 0.55, 1.0),                 // body under the cab
    box('black', 0, 1.3, -0.6, 0.6, 0.12, 0.6),               // seat
    box('black', 0, 1.42, -0.88, 0.6, 0.5, 0.1),
    cyl('darkStoneGrey', 0.3, 1.45, 1.1, 0.06, 0.8), cyl('black', 0.3, 2.25, 1.1, 0.08, 0.06),
  ];
  // roll cage / cab roof
  // canopy at 2.95 m: the seated driver (seat 1.42 + body + straw hat ~2.75 m) stays clear of it
  for (const [x, z] of [[-0.55, -0.05], [0.55, -0.05], [-0.55, -1.0], [0.55, -1.0]]) parts.push(box('black', x, 1.3, z, 0.07, 1.65, 0.07));
  parts.push(brick(c, 0, 2.95, -0.52, 1.35, 0.1, 1.25));
  // big rear wheels + mudguards, small front wheels
  for (const s of [-1, 1]) {
    parts.push(cylX('black', s * 0.82, 0.75, -0.55, 0.75, 0.48), cylX('brightYellow', s * 0.84, 0.75, -0.55, 0.38, 0.5));
    parts.push(P('sp-brick', c, s * 0.82, 1.4, -0.55, 0, 0, 0, 0.55, 0.12, 1.4));
    parts.push(cylX('black', s * 0.6, 0.4, 1.1, 0.4, 0.3), cylX('brightYellow', s * 0.62, 0.4, 1.1, 0.2, 0.32));
  }
  return parts;
}

function chicken(prng) {
  const c = pick(prng, ['white', 'white', '#C8742E', 'reddishBrown']);
  return [
    brick(c, 0, 0.16, 0, 0.26, 0.22, 0.34),
    brick(c, 0, 0.34, 0.13, 0.14, 0.16, 0.14),
    box('brightRed', 0, 0.5, 0.13, 0.04, 0.06, 0.1), box('brightOrange', 0, 0.4, 0.22, 0.05, 0.04, 0.07),
    P('sp-box', c, 0, 0.28, -0.16, -0.5, 0, 0, 0.18, 0.18, 0.05),
    box('brightYellow', -0.06, 0, 0, 0.03, 0.17, 0.03), box('brightYellow', 0.06, 0, 0, 0.03, 0.17, 0.03),
  ];
}

function sheep(prng) {
  const parts = [brick('white', 0, 0.32, 0, 0.55, 0.48, 0.85)];
  for (const [x, z] of [[-0.12, -0.2], [0.12, -0.2], [-0.12, 0.15], [0.12, 0.15]]) parts.push(stud('white', x, 0.8, z));
  parts.push(brick('black', 0, 0.55, 0.48, 0.26, 0.28, 0.26), box('black', -0.17, 0.72, 0.45, 0.12, 0.05, 0.06), box('black', 0.17, 0.72, 0.45, 0.12, 0.05, 0.06));
  for (const [x, z] of [[-0.18, -0.28], [0.18, -0.28], [-0.18, 0.28], [0.18, 0.28]]) parts.push(box('black', x, 0, z, 0.09, 0.34, 0.09));
  return parts;
}

function railFence(prng, prop) {
  const L = prop.len || 4;
  const parts = [];
  const n = Math.max(1, Math.round(L / 2));
  for (let k = 0; k <= n; k++) parts.push(box('reddishBrown', -L / 2 + (k * L) / n, 0, 0, 0.14, 1.05, 0.14));
  const wood = ['#9B6A3C', '#A9764C'];
  parts.push(box(pick(prng, wood), 0, 0.42, 0.06, L + 0.1, 0.1, 0.05), box(pick(prng, wood), 0, 0.82, 0.06, L + 0.1, 0.1, 0.05));
  return parts;
}

function produceCrate(prng) {
  const c = pick(prng, ['brightRed', 'brightOrange', 'lime', 'brightYellow', 'brightGreen']);
  const parts = [{ role: 'crate-single', local: mat(0, 0, 0, 0, prng.range(-0.2, 0.2), 0), color: pick(prng, ['tan', '#B5835A']) }];
  for (const [x, z] of [[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13], [0, 0]]) {
    parts.push(P('sp-cyl', c, x, 0.5 + (x === 0 ? 0.08 : 0), z, 0, 0, 0, 0.12, 0.13, 0.12));
  }
  return parts;
}

function waterTrough() {
  return [
    brick('mediumStoneGrey', 0, 0, 0, 1.8, 0.5, 0.7),
    P('sp-water', null, 0, 0.42, 0, 0, 0, 0, 0.8, 0.06, 0.25),
    cyl('darkStoneGrey', 0.7, 0, -0.5, 0.08, 1.2), P('sp-box', 'darkStoneGrey', 0.7, 1.15, -0.5, 0.9, 0, 0, 0.06, 0.5, 0.06),
  ];
}

// ---- extra dressing (density pass) ------------------------------------------------------------------------------
/** Kicker / launch ramp (c6): toe at +z on the ground, high edge at -z (height H), coping bar ON the high edge (the
 * c5 version rotated the wedge by PI but left the bar at -z: it sat over the toe, floating 0.46 m up), tiled slope
 * and side rails. Fields: color, W, H, L. Place it with its high edge flush against a bank / ledge. */
function kicker(prng, prop) {
  const c = prop.color || pick(prng, ['#E2661B', TEAL, 'brightYellow']);
  const W = prop.W || 1.3, H = prop.H || 0.5, L = prop.L || 1.5;
  const GREY = '#9A9F9C';
  const pal = c === '#E2661B' ? ORANGE_TILES : c === TEAL ? [TEAL, '#13A396', '#0B7A72'] : c === GREY ? [GREY, '#8E9391', '#A9AEAB'] : YELLOW_TILES;
  const underC = c === '#E2661B' ? ORANGE_UNDER : c === TEAL ? '#075E58' : c === GREY ? '#5F6466' : YELLOW_UNDER;
  return [
    P('sp-wedge', underC, 0, 0, 0, 0, 0, 0, W, H, L),
    ...slopeBands(W, H, L, pal, 2),
    cylX('lightStoneGrey', 0, H - 0.02, -L / 2 + 0.03, 0.045, W),
    box('darkStoneGrey', -W / 2 + 0.03, 0, 0, 0.06, 0.06, L), box('darkStoneGrey', W / 2 - 0.03, 0, 0, 0.06, 0.06, L),
  ];
}

/** Painted brick wall (the plaza backdrop): coursed grey bricks, a mural of big plate shapes on the +z face and a
 * coping row of studs. Field: len. */
function muralWall(prng, prop) {
  const L = prop.len || 8, H = prop.H || 2.0, T = 0.4;
  const parts = [];
  const courses = Math.round(H / 0.4);
  for (let c = 0; c < courses; c++) {
    const off = c % 2 ? 0.6 : 0;
    const n = Math.ceil(L / 1.2) + 1;
    for (let k = 0; k < n; k++) {
      const x0 = Math.max(-L / 2, -L / 2 - off + k * 1.2), x1 = Math.min(L / 2, -L / 2 - off + (k + 1) * 1.2);
      if (x1 - x0 < 0.1) continue;
      parts.push(brick(pick(prng, ['mediumStoneGrey', '#8E9391', 'lightStoneGrey']), (x0 + x1) / 2, c * 0.4, 0, x1 - x0 - 0.02, 0.39, T));
    }
  }
  studRow(parts, 'mediumStoneGrey', -L / 2 + 0.3, L / 2 - 0.3, H, 0);
  // mural: a sky panel, a big sun disc, a wave band and lettering blocks
  const zf = T / 2 + 0.005;
  const bg = pick(prng, [TEAL, 'mediumAzur', '#2F6FB5']);
  parts.push(box(bg, 0, 0.25, zf, L - 0.5, H - 0.5, 0.03));
  const sx = prng.range(-L / 4, L / 4);
  parts.push(P('sp-cyl', 'brightYellow', sx, H * 0.58, zf + 0.02, Math.PI / 2, 0, 0, 0.55, 0.03, 0.55));
  parts.push(P('sp-cyl', '#E2661B', sx, H * 0.58, zf + 0.04, Math.PI / 2, 0, 0, 0.32, 0.03, 0.32));
  // c6 fix 1: the wave band is six level strokes laid INSIDE the panel (x within +-(L - 0.7) / 2); the c5 strokes
  // were rotated 0.35 rad and 1.78 m long, so the end ones overhung the wall and read as loose planks
  const waveW = (L - 0.7) / 6;
  for (let k = 0; k < 6; k++) {
    const x = -(L - 0.7) / 2 + (k + 0.5) * waveW;
    parts.push(box(k % 2 ? 'white' : 'mediumAzur', x, 0.32 + (k % 2) * 0.1, zf + 0.03, waveW - 0.06, 0.16, 0.03));
  }
  const letters = ['brightRed', 'brightYellow', 'white', 'brightPink', 'lime'];
  for (let k = 0; k < 5; k++) {
    const x = -L / 2 + 0.9 + k * 0.7 + (sx < 0 ? L / 2 - 0.4 : 0);
    if (x > L / 2 - 0.5) continue;
    parts.push(box(letters[k], x, H * 0.62, zf + 0.03, 0.42, 0.55, 0.03));
    parts.push(box(bg, x + 0.05, H * 0.62 + 0.15, zf + 0.05, 0.14, 0.18, 0.02));
  }
  return parts;
}

function swingSet(prng) {
  const W = 3.2, H = 2.3;
  const frame = pick(prng, ['brightRed', 'brightBlue', '#2E8B57']);
  const parts = [];
  for (const x of [-W / 2, W / 2]) {
    for (const s of [-1, 1]) parts.push(P('sp-cyl', frame, x, 0, s * 0.75, s * 0.31, 0, 0, 0.06, H / Math.cos(0.31), 0.06));
  }
  parts.push(cylX(frame, 0, H, 0, 0.07, W + 0.3));
  for (const [x, c] of [[-0.75, 'brightYellow'], [0.75, '#E2661B']]) {
    for (const dx of [-0.22, 0.22]) parts.push(box('lightStoneGrey', x + dx, 0.48, 0, 0.025, H - 0.48, 0.025));
    parts.push(box(c, x, 0.44, 0, 0.55, 0.06, 0.26));
  }
  // slide on one end
  parts.push(box('white', W / 2 + 0.55, 0, -0.3, 0.06, 1.5, 0.06), box('white', W / 2 + 0.55, 0, 0.3, 0.06, 1.5, 0.06));
  parts.push(brick('white', W / 2 + 0.55, 1.4, 0, 0.7, 0.1, 0.7));
  const sl = Math.atan2(1.4, 2.0);
  parts.push(...under(mat(W / 2 + 0.9, 1.45, 0, 0, 0, -sl), [
    box('brightYellow', 1.22, 0, 0, 2.45, 0.06, 0.6),
    box('brightYellow', 1.22, 0.06, -0.3, 2.45, 0.12, 0.05), box('brightYellow', 1.22, 0.06, 0.3, 2.45, 0.12, 0.05),
  ]));
  return parts;
}

function parasolTable(prng) {
  const c = pick(prng, ['brightRed', '#2F6FB5', 'brightYellow', TEAL]);
  const parts = [
    cyl('white', 0, 0, 0, 0.2, 0.05), cyl('white', 0, 0, 0, 0.05, 0.72), cyl('white', 0, 0.72, 0, 0.48, 0.05),
    cyl('lightStoneGrey', 0, 0.77, 0, 0.03, 1.5),
    P('sp-oct', c, 0, 2.1, 0, 0, 0, 0, 1.25, 0.1, 1.25), P('sp-oct', 'white', 0, 2.2, 0, 0, 0, 0, 0.85, 0.12, 0.85),
    P('sp-oct', c, 0, 2.32, 0, 0, 0, 0, 0.4, 0.1, 0.4), cyl(c, 0, 2.42, 0, 0.05, 0.1),
  ];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    parts.push(box(k % 2 ? c : 'white', Math.sin(a) * 1.18, 2.0, Math.cos(a) * 1.18, 0.3, 0.12, 0.05, a));
  }
  const chair = pick(prng, ['white', 'brightGreen', TEAL]);
  for (const a of [0.4, 2.0, 3.6, 5.2]) {
    const m = mat(Math.sin(a) * 0.8, 0, Math.cos(a) * 0.8, 0, a + Math.PI, 0);
    parts.push(...under(m, [box(chair, 0, 0.4, 0, 0.42, 0.05, 0.42), box(chair, 0, 0.45, -0.19, 0.42, 0.45, 0.05),
      box(chair, -0.18, 0, 0.17, 0.04, 0.4, 0.04), box(chair, 0.18, 0, 0.17, 0.04, 0.4, 0.04),
      box(chair, -0.18, 0, -0.17, 0.04, 0.4, 0.04), box(chair, 0.18, 0, -0.17, 0.04, 0.4, 0.04)]));
  }
  return parts;
}

function bush(prng, prop) {
  const s = prop.s || prng.range(0.8, 1.2);
  const parts = [];
  const n = prng.int(2, 3);
  for (let k = 0; k < n; k++) {
    parts.push(shrub(pick(prng, LEAF), prng.range(-0.3, 0.3) * s, (0.3 + k * 0.32) * s, prng.range(-0.3, 0.3) * s, (0.62 - k * 0.12) * s, prng.range(0, 6)));
  }
  if (prng.chance(0.55)) {
    const fc = pick(prng, FLOWERS);
    for (let k = 0; k < 5; k++) {
      const a = prng.range(0, Math.PI * 2);
      parts.push(flower(fc, Math.cos(a) * 0.45 * s, prng.range(0.35, 0.8) * s, Math.sin(a) * 0.45 * s, 1.4));
    }
  }
  return parts;
}

function birdBath() {
  return [
    P('sp-oct', 'lightStoneGrey', 0, 0, 0, 0, 0, 0, 0.3, 0.12, 0.3), cyl('lightStoneGrey', 0, 0.12, 0, 0.1, 0.6),
    P('sp-oct', 'lightStoneGrey', 0, 0.72, 0, 0, 0, 0, 0.45, 0.12, 0.45),
    P('sp-water', null, 0, 0.8, 0, 0, 0, 0, 0.37, 0.05, 0.37),
    brick('mediumAzur', 0.22, 0.86, 0, 0.12, 0.1, 0.18), brick('mediumAzur', 0.22, 0.95, 0.07, 0.08, 0.08, 0.08),
  ];
}

// ---- kind -> parts ----------------------------------------------------------------------------------------------
export function buildSpKindParts(kind, prng, prop = {}) {
  switch (kind) {
    case 'sp_deck': return deckParts(prng, prop);
    case 'skate_bank': return skateBank(prng, prop);
    case 'skate_quarter': return skateQuarter(prng, prop);
    case 'skate_funbox': return skateFunbox(prng, prop);
    case 'skate_rail': return skateRail(prng, prop);
    case 'skateboard': return skateboardParts(prng, prop.color, !!prop.lean);
    case 'pallet': return pallet(prng, prop);
    case 'planter_box': return planterBox(prng, prop);
    case 'barrier_hoop': return barrierHoop(prng);
    case 'flower_clump': return flowerClump(prng);
    case 'pergola': return pergola(prng, prop);
    case 'arbour': return arbour(prng, prop);
    case 'sandbox': return sandbox(prng, prop);
    case 'pond': return pond(prng, prop);
    case 'potted_plant': return pottedPlant(prng, prop);
    case 'raised_bed': return raisedBed(prng, prop);
    case 'wheelbarrow': return wheelbarrow(prng, prop);
    case 'crop_wheat_row': return cropWheatRow(prng, prop);
    case 'crop_corn_row': return cropCornRow(prng, prop);
    case 'crop_veg_row': return cropVegRow(prng, prop);
    case 'hay_bale': return hayBale(prng, prop);
    case 'hay_stack': return hayStack(prng);
    case 'hay_shock': return hayShock(prng);
    case 'scarecrow': return scarecrow(prng);
    case 'windmill': return windmill(prng, prop);
    case 'barn': return barn(prng, prop);
    case 'silo': return silo(prng);
    case 'pickup': return pickup(prng, prop);
    case 'tractor': return tractor(prng, prop);
    case 'chicken': return chicken(prng);
    case 'sheep': return sheep(prng);
    case 'rail_fence': return railFence(prng, prop);
    case 'produce_crate': return produceCrate(prng);
    case 'water_trough': return waterTrough();
    case 'kicker': return kicker(prng, prop);
    case 'skate_ledge': return [
      brick('#9A9F9C', 0, 0, 0, prop.len || 3.2, 0.45, 0.8), cylX('lightStoneGrey', 0, 0.45, 0.4, 0.05, prop.len || 3.2),
      box('#6E7371', 0, 0, 0.41, prop.len || 3.2, 0.2, 0.02),
    ];
    case 'mural_wall': return muralWall(prng, prop);
    case 'swing_set': return swingSet(prng);
    case 'parasol_table': return parasolTable(prng);
    case 'bush': return bush(prng, prop);
    case 'bird_bath': return birdBath();
    // posed figures (FIGURE_CAP counts these together with plain 'figure')
    // c6: 'figure_cap' is the casual-crowd kind - half caps, half hair (the set-pieces had 13/22 caps, which hid faces)
    case 'figure_cap': return figureParts(prng, 'stand', prop.hat || (prng.chance(0.5) ? 'cap' : 'none'), prop);
    case 'figure_std': return figureParts(prng, 'stand', prop.hat || 'none', prop);
    case 'figure_farmer': return figureParts(prng, 'farmer', prop.hat || 'straw', prop);
    case 'figure_work': return figureParts(prng, 'work', prop.hat || (prng.chance(0.6) ? 'straw' : 'none'), prop);
    case 'figure_sit': return figureParts(prng, 'sit', prop.hat || (prng.chance(0.5) ? 'cap' : 'none'), prop);
    case 'figure_skater': {
      const parts = skateboardParts(prng, prop.color);
      // rider faces +z, side-on to a board that rolls along x (regular stance); c6: helmets / backward caps / hair
      const r = prng.float();
      const hat = prop.hat || (r < 0.4 ? 'helmet' : r < 0.75 ? 'capback' : 'none');
      parts.push(...under(mat(0, 0.1, 0), figureParts(prng, 'skate', hat, { ...prop, lean: prng.range(-0.15, 0.15) })));
      return parts;
    }
    default: return [];
  }
}
