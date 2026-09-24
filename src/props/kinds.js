// Procedural Blox-style geometry for every prop kind. Each kind is 1-4 "roles" (role = one InstancedMesh:
// fixed geometry + fixed/instance-coloured material). Every role's geometry is authored in prop-local space
// with the origin at the ground-contact point and "forward" = local +Z (the `rot` field on a placed prop is
// a plain Y rotation that turns +Z into the world facing direction — see geo.dirToRot).
import * as THREE from 'three';
import { UNIT_CYL, UNIT_ICO, UNIT_SPHERE, mat, xf, merge } from './geo.js';

export const KIND_NAMES = [
  'streetlamp', 'bench', 'tree_small', 'tree_medium', 'tree_large', 'hedge', 'hydrant', 'trash_bin',
  'bus_stop', 'traffic_light', 'road_sign', 'fountain', 'park_bench', 'flower_bed',
];

export const FLOWER_COLORS = ['brightRed', 'brightYellow', 'mediumLilac', 'brightPink', 'mediumAzur', 'brightOrange'];
export const SIGN_COLORS = ['brightBlue', 'brightRed', 'brightYellow', 'white', 'brightOrange'];
export const LEAF_COLORS = ['darkGreen', 'darkGreen', 'brightGreen'];
export const AUTUMN_COLORS = ['brightOrange', 'darkOrange'];
export const HEDGE_COLORS = ['darkGreen', 'brightGreen'];

// Height (prop-local, from the ground) of the fountain's water surface — kept as a constant so index.js's
// spray particle FX can start its animation flush with the bowl rather than recomputing the geometry math.
export const FOUNTAIN_WATER_Y = 0.22 + 0.5 + 0.16 + 0.1;

// ---- role geometry (built once per app run; ctx only supplies bevelBox for the beveled-plate parts) --------
export function buildRoleGeometry(ctx) {
  const bb = (w, h, d, bevel) => ctx.materials.bevelBox(w, h, d, bevel);
  const G = {};

  // -- streetlamp: gooseneck pole (base + shaft + tilted neck + horizontal arm), housing, bulb -------------
  {
    const base = xf(UNIT_CYL, mat(0, 0, 0, 0, 0, 0, 0.22, 0.14, 0.22));
    const shaft = xf(UNIT_CYL, mat(0, 0.14, 0, 0, 0, 0, 0.075, 4.1, 0.075));
    const shaftTopY = 0.14 + 4.1;
    const neck = xf(UNIT_CYL, mat(0, shaftTopY, 0, Math.PI / 4, 0, 0, 0.06, 0.5, 0.06));
    const neckTopY = shaftTopY + 0.5 * Math.cos(Math.PI / 4);
    const neckTopZ = 0.5 * Math.sin(Math.PI / 4);
    const arm = xf(UNIT_CYL, mat(0, neckTopY, neckTopZ, Math.PI / 2, 0, 0, 0.055, 0.85, 0.055));
    G['lamp-pole'] = merge([base, shaft, neck, arm]);
    const armEndY = neckTopY, armEndZ = neckTopZ + 0.85;
    G['lamp-head'] = xf(bb(0.3, 0.16, 0.44, 0.03), mat(0, armEndY - 0.14, armEndZ - 0.16, 0, 0, 0));
    G['lamp-bulb'] = xf(UNIT_SPHERE, mat(0, armEndY - 0.17, armEndZ - 0.1, 0, 0, 0, 0.1, 0.1, 0.1));
  }

  // -- bench / park_bench: shared plank geometry (seat + backrest), frame colour differs by kind ------------
  {
    const legA = xf(bb(0.06, 0.42, 0.46, 0.02), mat(-0.62, 0, 0, 0, 0, 0));
    const legB = xf(bb(0.06, 0.42, 0.46, 0.02), mat(0.62, 0, 0, 0, 0, 0));
    G['bench-frame'] = merge([legA, legB]);
    G['parkbench-frame'] = xf(G['bench-frame'], mat(0, 0, 0));
    const seat = xf(bb(1.5, 0.07, 0.42, 0.02), mat(0, 0.42, 0, 0, 0, 0));
    const back = xf(bb(1.5, 0.32, 0.06, 0.02), mat(0, 0.5, -0.18, 0, 0, 0));
    G['bench-planks'] = merge([seat, back]);
  }

  // -- trees: unit trunk / unit leaf-plate cluster, sized + placed per instance by kinds.buildTree() below ----
  // The canopy cluster is a *stack of Blox plates* (bevel boxes of decreasing size, jittered and rotated) rather
  // than a smooth blob, so a tree reads as stacked elements. buildTree() then stacks 2-4 of these clusters per
  // tree for a genuinely stepped, layered silhouette, and caps the top with a real stud ('tree-top' role).
  G['tree-trunk'] = UNIT_CYL;
  {
    const plate = (w, h, d, x, y, z, ry) => xf(bb(w, h, d, 0.14), mat(x, y, z, 0, ry, 0));
    G['tree-leaves'] = merge([
      plate(1.75, 0.52, 1.65, 0, -0.34, 0, 0),
      plate(1.5, 0.5, 1.4, 0.18, -0.06, 0.1, 0.5),
      plate(1.2, 0.48, 1.12, -0.16, 0.2, 0.08, -0.6),
      plate(0.85, 0.44, 0.8, 0.03, 0.44, -0.06, 1.0),
    ]);
  }
  // One stud for the top of the canopy (LEGO tree canopies are stud-topped). Owned geometry (not a shared
  // UNIT_* const), so props/index.js may dispose it on teardown.
  G['tree-top'] = xf(UNIT_CYL, mat(0, 0, 0, 0, 0, 0, 0.24, 0.17, 0.24));

  // -- hedge: one 2 m run, built as a low base plate plus two offset, slightly rotated plates on top so the
  // silhouette reads as stacked Blox plates with a bulging top rather than one smooth crate; abutted end-to-end
  // by the placement code --------------------------------------------------------------------------------------
  {
    const base = xf(bb(2.0, 0.32, 0.62, 0.05), mat(0, 0, 0, 0, 0, 0));
    const mid = xf(bb(1.86, 0.34, 0.58, 0.1), mat(0.05, 0.28, 0, 0, 0.03, 0));
    const top = xf(bb(1.62, 0.32, 0.52, 0.12), mat(-0.08, 0.58, 0, 0, -0.03, 0));
    G['hedge-block'] = merge([base, mid, top]);
  }

  // -- flower head: short stem + small rounded bloom, scattered per-instance inside a flower_bed's soil box --
  {
    const stem = xf(UNIT_CYL, mat(0, 0, 0, 0, 0, 0, 0.035, 0.16, 0.035));
    const bloom = xf(UNIT_ICO, mat(0, 0.17, 0, 0, 0, 0, 0.11, 0.1, 0.11));
    G['flowerbed-flower'] = merge([stem, bloom]);
  }

  // -- hydrant --------------------------------------------------------------------------------------------
  {
    const base = xf(UNIT_CYL, mat(0, 0, 0, 0, 0, 0, 0.17, 0.1, 0.17));
    const body = xf(UNIT_CYL, mat(0, 0.1, 0, 0, 0, 0, 0.13, 0.42, 0.13));
    const collar = xf(UNIT_CYL, mat(0, 0.42, 0, 0, 0, 0, 0.17, 0.07, 0.17));
    const dome = xf(UNIT_ICO, mat(0, 0.62, 0, 0, 0, 0, 0.14, 0.16, 0.14));
    G['hydrant-body'] = merge([base, body, collar, dome]);
    const nozzleA = xf(UNIT_CYL, mat(-0.13, 0.32, 0, 0, 0, Math.PI / 2, 0.045, 0.13, 0.045));
    const nozzleB = xf(UNIT_CYL, mat(0.13, 0.32, 0, 0, 0, -Math.PI / 2, 0.045, 0.13, 0.045));
    const bolt = xf(UNIT_ICO, mat(0, 0.7, 0, 0, 0, 0, 0.05, 0.05, 0.05));
    G['hydrant-trim'] = merge([nozzleA, nozzleB, bolt]);
  }

  // -- trash bin --------------------------------------------------------------------------------------------
  {
    G['bin-body'] = xf(UNIT_CYL, mat(0, 0, 0, 0, 0, 0, 0.28, 0.82, 0.28));
    const lid = xf(UNIT_CYL, mat(0, 0.82, 0, 0, 0, 0, 0.3, 0.06, 0.3));
    const dome = xf(UNIT_ICO, mat(0, 0.88, 0, 0, 0, 0, 0.13, 0.1, 0.13));
    G['bin-lid'] = merge([lid, dome]);
  }

  // -- bus stop: two posts + edge beam, roof + small sign, back + side glass-look panel, inner seat ----------
  {
    const postA = xf(UNIT_CYL, mat(-1.3, 0, -0.45, 0, 0, 0, 0.06, 2.35, 0.06));
    const postB = xf(UNIT_CYL, mat(1.3, 0, -0.45, 0, 0, 0, 0.06, 2.35, 0.06));
    const beam = xf(bb(2.8, 0.08, 0.08, 0.02), mat(0, 2.35, -0.45, 0, 0, 0));
    G['busstop-frame'] = merge([postA, postB, beam]);
    const roof = xf(bb(3.1, 0.07, 1.3, 0.02), mat(0, 2.42, 0.05, 0, 0, 0));
    const sign = xf(bb(0.46, 0.32, 0.05, 0.02), mat(1.0, 2.75, -0.45, 0, 0, 0));
    // studs on the shelter roof plate (a real Blox canopy top)
    const roofStuds = [-0.8, 0, 0.8].map((sx) => xf(UNIT_CYL, mat(sx, 2.455, 0.05, 0, 0, 0, 0.24, 0.17, 0.24)));
    G['busstop-roof'] = merge([roof, sign, ...roofStuds]);
    const back = xf(bb(2.9, 1.5, 0.06, 0.02), mat(0, 0, -0.48, 0, 0, 0));
    const side = xf(bb(0.06, 1.5, 0.9, 0.02), mat(-1.3, 0, -0.05, 0, 0, 0));
    G['busstop-panel'] = merge([back, side]);
    G['busstop-seat'] = xf(bb(1.3, 0.06, 0.32, 0.02), mat(0, 0.42, -0.18, 0, 0, 0));
  }

  // -- traffic light: post + head box, 3 lenses (front face, +Z) ---------------------------------------------
  {
    const post = xf(UNIT_CYL, mat(0, 0, 0, 0, 0, 0, 0.08, 3.4, 0.08));
    const head = xf(bb(0.36, 0.95, 0.3, 0.03), mat(0, 3.4, 0, 0, 0, 0));
    G['trafficlight-body'] = merge([post, head]);
    const lensY = [3.4 + 0.72, 3.4 + 0.475, 3.4 + 0.23];
    G['trafficlight-lens-red'] = xf(UNIT_SPHERE, mat(0, lensY[0], 0.16, 0, 0, 0, 0.09, 0.09, 0.07));
    G['trafficlight-lens-yellow'] = xf(UNIT_SPHERE, mat(0, lensY[1], 0.16, 0, 0, 0, 0.09, 0.09, 0.07));
    G['trafficlight-lens-green'] = xf(UNIT_SPHERE, mat(0, lensY[2], 0.16, 0, 0, 0, 0.09, 0.09, 0.07));
  }

  // -- road sign --------------------------------------------------------------------------------------------
  G['sign-post'] = xf(UNIT_CYL, mat(0, 0, 0, 0, 0, 0, 0.045, 2.15, 0.045));
  G['sign-face'] = xf(bb(0.55, 0.55, 0.045, 0.02), mat(0, 1.85, 0, 0, 0, 0));

  // -- fountain: wide base -> thin pedestal -> upper bowl wall -> rim, water disc sits inside the rim ---------
  {
    const baseH = 0.22, stemH = 0.5, bowlH = 0.16, rimH = 0.08;
    const stemY = baseH, bowlY = stemY + stemH, rimY = bowlY + bowlH;
    const bottom = xf(UNIT_CYL, mat(0, 0, 0, 0, 0, 0, 1.6, baseH, 1.6));
    const stem = xf(UNIT_CYL, mat(0, stemY, 0, 0, 0, 0, 0.3, stemH, 0.3));
    const bowl = xf(UNIT_CYL, mat(0, bowlY, 0, 0, 0, 0, 1.0, bowlH, 1.0));
    const rim = xf(UNIT_CYL, mat(0, rimY, 0, 0, 0, 0, 1.15, rimH, 1.15));
    G['fountain-base'] = merge([bottom, stem, bowl, rim]);
    G['fountain-bowl'] = xf(UNIT_CYL, mat(0, bowlY + 0.02, 0, 0, 0, 0, 0.9, 0.08, 0.9));
  }

  // -- flower bed: shallow planter box (flower studs are added by the caller via ctx.materials.studs()) -----
  G['flowerbed-base'] = bb(1.15, 0.26, 1.15, 0.04).clone();

  return G;
}

/** Roles whose geometry is a shared primitive (geo.js UNIT_* consts) or otherwise not owned by this module's
 * buildRoleGeometry() call — index.js must not dispose these on module teardown. tree-leaves is now its own
 * merged multi-lobe geometry (owned, disposable), so only tree-trunk (the raw shared UNIT_CYL) stays here. */
export const SHARED_GEOMETRY_ROLES = new Set(['tree-trunk']);

// ---- per-kind part lists: role names an instance places its transform on (local = identity unless noted) --
const IDENT = new THREE.Matrix4();

export function buildKindParts(kind, prng) {
  switch (kind) {
    case 'streetlamp': return [{ role: 'lamp-pole' }, { role: 'lamp-head' }, { role: 'lamp-bulb' }];
    case 'bench': return [{ role: 'bench-frame' }, { role: 'bench-planks' }];
    case 'park_bench': return [{ role: 'parkbench-frame' }, { role: 'bench-planks' }];
    case 'hedge': return [{ role: 'hedge-block', color: prng.pick(HEDGE_COLORS) }];
    case 'hydrant': return [{ role: 'hydrant-body' }, { role: 'hydrant-trim' }];
    case 'trash_bin': return [{ role: 'bin-body' }, { role: 'bin-lid' }];
    case 'bus_stop': return [
      { role: 'busstop-frame' }, { role: 'busstop-roof' }, { role: 'busstop-panel' }, { role: 'busstop-seat' },
    ];
    case 'traffic_light': return [
      { role: 'trafficlight-body' }, { role: 'trafficlight-lens-red' },
      { role: 'trafficlight-lens-yellow' }, { role: 'trafficlight-lens-green' },
    ];
    case 'road_sign': return [{ role: 'sign-post' }, { role: 'sign-face', color: prng.pick(SIGN_COLORS) }];
    case 'fountain': return [{ role: 'fountain-base' }, { role: 'fountain-bowl' }];
    case 'flower_bed': return [{ role: 'flowerbed-base', color: prng.chance(0.5) ? 'tan' : 'darkGreen' }];
    case 'tree_small': return buildTree(prng, 0.09, 2.0, 2, 3, 0.85);
    case 'tree_medium': return buildTree(prng, 0.14, 3.4, 3, 3, 1.25);
    case 'tree_large': return buildTree(prng, 0.2, 5.6, 3, 4, 1.7);
    default: return [];
  }
}

/** trunk + 2-4 stacked, offset, independently-rotated plate clusters (each already a stepped 4-plate canopy —
 * see tree-leaves in buildRoleGeometry), seeded jitter + rare autumn colour variant, plus a real stud capping
 * the top cluster. Forcing a minimum of 2 clusters even on tree_small keeps every tree size reading as stacked
 * foliage, never a single ball. */
function buildTree(prng, trunkR, trunkH, minClusters, maxClusters, leafR) {
  const parts = [{ role: 'tree-trunk', local: mat(0, 0, 0, 0, 0, 0, trunkR, trunkH, trunkR) }];
  const autumn = prng.chance(0.12);
  const palette = autumn ? AUTUMN_COLORS : LEAF_COLORS;
  const n = prng.int(minClusters, maxClusters);
  let top = null;
  for (let k = 0; k < n; k++) {
    const t = n === 1 ? 0.72 : k / (n - 1);
    const y = trunkH * (0.5 + 0.48 * t);
    const r = leafR * (1 - 0.2 * t) * prng.range(0.82, 1.15);
    const jx = prng.range(-leafR * 0.5, leafR * 0.5), jz = prng.range(-leafR * 0.5, leafR * 0.5);
    const jy = prng.range(-leafR * 0.12, leafR * 0.12);
    const ry = prng.range(0, Math.PI * 2);
    const color = prng.pick(palette);
    parts.push({ role: 'tree-leaves', local: mat(jx, y + jy, jz, 0, ry, 0, r, r * 0.82, r), color });
    top = { x: jx, y: y + jy + 0.88 * r * 0.82, z: jz, color };
  }
  if (top) parts.push({ role: 'tree-top', local: mat(top.x, top.y, top.z), color: top.color });
  return parts;
}

export function identity() { return IDENT; }
