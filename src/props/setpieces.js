// LOOP cycle 5 (W1 authored hero set-pieces): deterministic, art-directed layouts for the three set-piece types.
// Pure functions: author(type, w, d, prng) returns the deck spec and a list of items in set-piece-local metres
// (u = right, v = toward the hero camera / the "front", rotation r about Y, `lift` = height above the deck
// surface for things standing on other things). index.js turns them into `sp:` props.
//
// Composition rules every layout follows (they are what the references do and our losing shots did not):
//  - one readable focal arrangement in the middle third (bank+vert / pergola+beds / windmill), framed by
//    a low boundary (hedges, fences) and taller back-layer elements (trees, barn, silo);
//  - layered heights: deck tiles -> flowers/crops/planters -> props/figures -> ramps/pergola -> windmill/trees;
//  - figures posed in context (skaters on ramps, gardener at the beds, farmers in the rows / at the tractor);
//  - the front edge stays low so the hero camera looks into the scene, not at a wall.

export const SP_TYPES = ['skate', 'garden', 'farm'];
/** Nominal and minimum footprints (metres). Anchor positions scale with the actual w/d; fills (rows, hedges,
 * fences) re-flow to the actual rectangle. */
export const SP_SIZE = {
  skate: { w: 24, d: 20, minW: 20, minD: 16 },
  garden: { w: 24, d: 20, minW: 20, minD: 16 },
  farm: { w: 40, d: 30, minW: 32, minD: 24 },
};
/** Hero camera (local frame): target offset, azimuth from the front (+v) toward +u, pitch, distance, fov. The
 * distance scales with the footprint relative to the nominal size. */
const HERO = {
  skate: { tu: 0.6, tv: -0.6, ty: 0.6, az: 0.58, pitch: 0.72, dist: 19.5, fov: 42 },
  garden: { tu: 0.0, tv: -3.6, ty: 1.8, az: 0.50, pitch: 0.40, dist: 23.5, fov: 44 },
  farm: { tu: 0.0, tv: -2.5, ty: 1.6, az: 0.48, pitch: 0.56, dist: 37.0, fov: 44 },
};

export function clampSize(type, w, d) {
  const s = SP_SIZE[type];
  return {
    w: Math.max(s.minW, Number.isFinite(w) && w > 0 ? w : s.w),
    d: Math.max(s.minD, Number.isFinite(d) && d > 0 ? d : s.d),
  };
}

/** Hero cameras for a set-piece entry (world space). `side` +1 = camera on the +u side of the front, -1 = -u. */
export function heroCamera(entry, side = 1) {
  const h = HERO[entry.type];
  const s = SP_SIZE[entry.type];
  const scale = Math.max(entry.w / s.w, entry.d / s.d);
  const dist = h.dist * Math.max(0.85, Math.min(1.6, scale));
  const tu = h.tu * (entry.w / s.w), tv = h.tv * (entry.d / s.d);
  const az = h.az * side;
  const cu = tu + Math.sin(az) * Math.cos(h.pitch) * dist;
  const cv = tv + Math.cos(az) * Math.cos(h.pitch) * dist;
  const cy = h.ty + Math.sin(h.pitch) * dist;
  const c = Math.cos(entry.rot), sn = Math.sin(entry.rot);
  const toWorld = (u, v) => [entry.x + u * c + v * sn, entry.z - u * sn + v * c];
  const [tx, tz] = toWorld(tu, tv);
  const [px, pz] = toWorld(cu, cv);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  return {
    pos: [r3(px), r3(entry.deckY + cy), r3(pz)],
    target: [r3(tx), r3(entry.deckY + h.ty), r3(tz)],
    fov: h.fov,
  };
}

// ---- layout helpers ---------------------------------------------------------------------------------------------
function makeList() {
  const items = [];
  const add = (kind, u, v, r = 0, extra = {}) => { items.push({ kind, u, v, r, lift: 0, ...extra }); return items[items.length - 1]; };
  return { items, add };
}

/** Run of `kind` segments (each `seg` m long, authored along local x) from (u0,v0) to (u1,v1). */
function run(add, kind, u0, v0, u1, v1, seg, extra = {}, skip = null) {
  const len = Math.hypot(u1 - u0, v1 - v0);
  const n = Math.max(1, Math.round(len / seg));
  const r = Math.atan2(v1 - v0, u1 - u0) * -1; // segments are authored along +x; rot about Y maps +x -> (cos r, -sin r)
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    const u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t;
    if (skip && skip(u, v)) continue;
    add(kind, u, v, r, extra);
  }
}

// ---- skate plaza ------------------------------------------------------------------------------------------------
function authorSkate(w, d, prng) {
  const { items, add } = makeList();
  const S = SP_SIZE.skate;
  const U = (u) => u * (w / S.w), V = (v) => v * (d / S.d);
  const hw = w / 2, hd = d / 2;
  const zones = [
    [-hw, -hd, hw, -hd + 0.8, 'dark'], [-hw, hd - 0.8, hw, hd, 'dark'],
    [-hw, -hd, -hw + 0.8, hd, 'dark'], [hw - 0.8, -hd, hw, hd, 'dark'],
    [-hw + 0.8, -hd + 0.8, -hw + 2.4, hd - 0.8, 'grass'],
    // darker apron tiles under the ramps (read as the skate area inside the plaza)
    [U(-8.4), V(-6.0), U(10.8), V(2.2), 'dark'],
  ];
  // focal group: the bank (centre-back) and the vert quarter (right), fun-box and rail in the mid-ground
  add('skate_bank', U(-2.0), V(-2.6), 0, { L: 6.4, D: 3.6, H: 1.2 });
  // c6 (C2): all skate furniture on the deck grid (0 / +-PI/2 / PI); the c5 off-grid yaws read as scattered pieces
  add('skate_quarter', U(8.2), V(-1.6), -Math.PI / 2, { qw: 5.0, qh: 2.4, deck: 1.6 });
  add('skate_funbox', U(1.8), V(4.4), 0, { L: 3.6 });
  add('skate_rail', U(-5.4), V(5.4), 0, { len: 3.4 });
  add('barrier_hoop', U(-2.4), V(7.6), 0);
  add('barrier_hoop', U(-0.8), V(7.6), 0);
  add('pallet', U(6.8), V(5.8), 0, { count: 2 });
  add('trash_bin', U(5.6), V(7.2), 0);
  add('trash_bin', U(-10.2), V(-8.0), 0);
  // planters + plants (low layer), tree planter + trees (tall layer)
  add('planter_box', U(-8.6), V(-7.0), 0, { len: 3.2, wall: 'lightStoneGrey' });
  add('planter_box', U(-9.6), V(1.8), Math.PI / 2, { len: 2.6, wall: '#B5835A' });
  add('planter_box', U(9.4), V(7.6), 0, { len: 2.4, wall: 'lightStoneGrey', lavender: false });
  add('planter_box', U(4.0), V(-7.6), 0, { len: 2.0, D: 2.0, H: 0.55, wall: 'mediumStoneGrey', lavender: false });
  add('tree_medium', U(4.0), V(-7.6), 0.4, { lift: 0.55 });
  add('tree_large', U(-5.4), V(-8.9), 1.1);
  add('tree_large', U(10.4), V(-8.6), 2.3);
  add('tree_small', U(-10.6), V(7.8), 0.2);
  add('streetlamp', U(-10.9), V(-3.6), Math.PI / 2);
  add('streetlamp', U(10.9), V(3.4), -Math.PI / 2);
  // boundary hedges along the back (skip where trees/planters stand)
  add('mural_wall', U(1.6), -hd + 0.75, 0, { len: 9.6, H: 2.0 });
  run(add, 'hedge', -hw + 1.2, -hd + 0.45, hw - 1.2, -hd + 0.45, 2.0, {}, (u) => Math.abs(u - U(-5.4)) < 1.2 || Math.abs(u - U(10.4)) < 1.2 || Math.abs(u - U(1.6)) < 5.2);
  // c6 (C1/C3): kickers are launch pads flush against structures, high edge touching: the orange one against the
  // bank platform's front wall (right of the wedge bank), the grey one against the ledge's left end (ledge height, ledge colour).
  // Bank front wall: v = V(-2.6) + 1.8; kicker length 1.5 -> centre 0.75 in front of it.
  add('kicker', U(-2.0) + 1.55, V(-2.6) + 1.8 + 0.75, 0, { color: '#E2661B' });
  add('kicker', U(3.6) - 1.7 - 0.75, V(8.4), -Math.PI / 2, { color: '#9A9F9C', W: 0.8, H: 0.45 }); // c6 fix 4: ledge grey
  add('figure_sit', U(-8.0), V(-6.55), 0, { lift: 0.6 });
  add('figure_cap', U(-4.2), V(-6.8), 0.3);
  add('figure_cap', U(6.6), V(-6.6), -0.4);
  add('figure_skater', U(-6.2), V(1.4), 0.3);
  // density pass: a ledge and a crowd on the open pavers, flowers along the front edge
  add('skate_ledge', U(3.6), V(8.4), 0, { len: 3.4 });
  add('figure_sit', U(3.0), V(8.62), 0, { lift: 0.45, hat: 'cap' });
  add('figure_std', U(4.6), V(7.0), 0.35);
  add('figure_cap', U(-3.4), V(4.0), 0.4);
  add('figure_std', U(-1.9), V(5.2), -0.45);
  add('figure_cap', U(4.4), V(3.0), -0.4);
  add('figure_skater', U(-1.4), V(6.2), 0.45);
  add('trash_bin', U(-4.6), V(8.9), 0);
  for (const [u, v] of [[-10.0, 9.0], [-5.0, 9.2], [0.8, 9.3], [6.6, 9.1], [10.6, 5.6], [-0.4, -5.4]]) {
    add('flower_clump', U(u) + prng.range(-0.3, 0.3), V(v) + prng.range(-0.2, 0.2), prng.range(0, 6));
  }
  // benches + flowers
  add('bench', U(-1.0), V(-8.2), 0);
  add('bench', U(-10.8), V(5.0), Math.PI / 2);
  for (const v of [-6.5, -3.0, 0.5, 4.0, 7.0]) add('flower_clump', -hw + 1.6, V(v) + prng.range(-0.4, 0.4), prng.range(0, 6));
  for (const [u, v] of [[-8.2, 7.6], [-6.8, 8.5], [-3.6, 8.8], [3.2, 8.7], [8.0, 3.8], [-4.4, -5.2], [6.0, -6.0], [2.4, -5.4]]) {
    add('flower_clump', U(u) + prng.range(-0.3, 0.3), V(v) + prng.range(-0.3, 0.3), prng.range(0, 6));
  }
  // c6 (C3): no loose boards on the paving - two are racked against the mural wall (front face v = -hd + 0.95)
  add('skateboard', U(1.0), -hd + 0.95 + 0.2, 0, { lean: true });
  add('skateboard', U(1.55), -hd + 0.95 + 0.2, 0, { lean: true });
  add('bike', U(-9.0), V(8.4), Math.PI / 2);
  // figures in context
  add('figure_skater', U(-3.8), V(-2.5), 0.25, { lift: 1.32 });              // riding the bank top
  add('figure_sit', U(0.2), V(-0.85), 0.1, { lift: 1.32 });                  // sat on the bank's front coping
  add('figure_cap', U(9.4), V(-0.4), -0.35, { lift: 2.5 });                  // on the vert deck
  add('skateboard', U(9.3), V(-2.2), Math.PI / 2, { lift: 2.5 });             // parked on the deck, along it
  add('figure_skater', U(2.2), V(1.6), -0.4);                                 // rolling across the plaza
  add('figure_skater', U(0.6), V(4.7), 0, { lift: 0.65 });                    // on the fun-box
  add('figure_cap', U(-1.0), V(2.4), 0.5);                                    // by the bank
  add('figure_cap', U(-6.2), V(2.2), 0.4);
  add('figure_std', U(-7.6), V(6.6), -0.4);
  add('figure_sit', U(6.8), V(5.8), 0, { lift: 0.41 });                       // on the pallets
  add('figure_sit', U(-1.0), V(-8.15), 0, { lift: 0.49 });                    // on the bench
  add('figure_cap', U(-9.0), V(-5.0), 0.45);
  add('figure_cap', U(4.0), V(6.4), 0.2);
  add('figure_std', U(6.6), V(3.8), -0.45);
  return { style: 'pavers', pitch: 0.4, zones, items };
}

// ---- pergola garden ---------------------------------------------------------------------------------------------
function authorGarden(w, d, prng) {
  const { items, add } = makeList();
  const S = SP_SIZE.garden;
  const U = (u) => u * (w / S.w), V = (v) => v * (d / S.d);
  const hw = w / 2, hd = d / 2;
  const zones = [
    [-0.8, -hd, 0.8, hd, 'path'],                                   // front gate -> house door
    [U(-10.4), V(-9.2), U(-3.2), V(-3.6), 'pavers'],                // patio under the pergola
    [-0.8, V(-9.6), U(3.6), V(-7.4), 'path'],                       // landing at the house
  ];
  // pergola + swing on the patio, potted plants around it
  add('pergola', U(-6.8), V(-6.4), 0, { W: 5.0, D: 3.4, H: 2.7, swing: true });
  add('figure_sit', U(-6.8), V(-7.25), 0, { lift: 0.58 });
  for (const [u, v] of [[-9.8, -4.2], [-3.8, -4.0], [-3.6, -8.8], [-1.6, -9.0], [1.6, -9.2], [2.8, -8.0]]) add('potted_plant', U(u), V(v), prng.range(0, 6));
  add('swing_set', U(-8.2), V(-1.4), 0);
  add('figure_sit', U(-8.95), V(-1.45), 0, { lift: 0.5, hat: 'none' });
  // c6: the table is turned so its two occupied chairs are on the far side, the sitters facing the front (+v)
  // within +-75 degrees (chair angles a = 2.0 / 3.6 in the table frame -> local 1.84 / 3.44 with the -0.16 turn)
  const tR = -0.16;
  for (const a of [2.0 + tR, 3.6 + tR]) add('figure_sit', U(2.6) + 0.8 * Math.sin(a), V(-4.6) + 0.8 * Math.cos(a), a + Math.PI, { lift: 0.45 });
  add('parasol_table', U(2.6), V(-4.6), tR);
  for (const [u, v, sc] of [[-10.3, -6.0, 1.0], [10.3, -5.4, 1.1], [-4.0, 6.8, 0.8], [9.9, 8.4, 0.9], [-3.4, -9.3, 0.8], [3.8, 8.0, 0.7]]) add('bush', U(u), V(v), 0, { s: sc });
  add('bird_bath', U(2.8), V(2.4), 0);
  for (const [u, v] of [[-10.2, 1.0], [-10.2, 4.6], [10.2, -1.6], [10.0, 5.6], [-2.2, -8.8], [2.2, -8.8], [-1.8, 7.4], [1.8, 7.4]]) {
    add('flower_clump', U(u), V(v), prng.range(0, 6));
  }
  add('bush', U(-1.9), V(-3.0), 0, { s: 0.7 });
  add('bush', U(1.9), V(-1.2), 0, { s: 0.75 });
  add('potted_plant', U(-1.4), V(3.6), 0);
  add('potted_plant', U(1.4), V(3.6), 0);
  // arbour over the path at the front gate, picket fence either side, hedges down both sides
  add('arbour', 0, V(8.8), 0, { W: 2.0 });
  run(add, 'fence_picket', -hw + 0.6, hd - 0.4, -1.6, hd - 0.4, 2.0);
  run(add, 'fence_picket', 1.6, hd - 0.4, hw - 0.6, hd - 0.4, 2.0);
  run(add, 'hedge', -hw + 0.4, -hd + 1.0, -hw + 0.4, hd - 2.0, 2.0, {}, (u, v) => Math.abs(v - V(-2.2)) < 1.4 || Math.abs(v - V(7.8)) < 1.6);
  run(add, 'hedge', hw - 0.4, -hd + 1.0, hw - 0.4, hd - 2.0, 2.0, {}, (u, v) => Math.abs(v - V(-8.6)) < 1.6 || Math.abs(v - V(3.0)) < 1.4);
  // beds: three raised beds + a classic garden bed, gardener + wheelbarrow + watering
  add('raised_bed', U(6.3), V(-6.0), 0, { len: 3.2, plant: 'veg' });
  add('raised_bed', U(6.3), V(-3.4), 0, { len: 3.2, plant: 'flowers' });
  add('raised_bed', U(6.3), V(-0.8), 0, { len: 3.2, plant: 'veg' });
  add('garden_bed', U(9.4), V(-4.6), Math.PI / 2);
  add('figure_work', U(7.0), V(-4.75), 0, { hat: 'straw' });                  // behind the middle bed, facing it
  add('wheelbarrow', U(8.8), V(-0.4), 2.4, { load: 'soil' });
  add('chicken', U(9.6), V(1.2), 0.6);
  add('chicken', U(10.2), V(0.6), 2.4);
  add('chicken', U(8.9), V(2.0), -1.2);
  // flower beds along the path
  for (const [u, v] of [[-1.9, 5.6], [1.9, 5.6], [-1.9, 1.0], [1.9, 1.8]]) add('flower_bed', U(u), V(v), 0);
  // sandbox (front-left) with kids
  add('sandbox', U(-6.6), V(3.0), 0.0, { S: 3.2 });
  add('figure_sit', U(-5.8), V(3.6), 0.4, { lift: 0.3, hat: 'none' });
  add('figure_std', U(-8.9), V(5.2), 0.45);
  // pond (front-right) with a watcher
  add('pond', U(5.4), V(5.0), 0.2, { R: 1.9 });
  add('figure_std', U(2.8), V(6.4), 0.5);
  add('figure_sit', U(7.9), V(7.0), -0.5, { hat: 'cap' });
  // trees (back-right, front-left framing, side) + laundry
  add('tree_large', U(9.8), V(-8.6), 0.7);
  add('tree_medium', U(-10.4), V(7.8), 2.2);
  add('tree_small', U(10.4), V(3.0), 1.4);
  add('tree_medium', U(-10.6), V(-2.2), 0.3);
  add('laundry_line', U(6.0), V(-9.0), 0);
  add('bike', U(-3.0), V(8.2), 1.3);
  add('figure_std', U(0.1), V(2.4), 0.1);
  for (const [u, v] of [[-4.0, 0.6], [-3.4, 6.6], [3.6, 2.6], [9.6, 5.8], [-9.6, -0.2], [2.6, -2.6]]) add('flower_clump', U(u), V(v), prng.range(0, 6));
  return { style: 'grass', pitch: 0.4, zones, items };
}

// ---- community farm ---------------------------------------------------------------------------------------------
function authorFarm(w, d, prng) {
  const { items, add } = makeList();
  const S = SP_SIZE.farm;
  const U = (u) => u * (w / S.w), V = (v) => v * (d / S.d);
  const hw = w / 2, hd = d / 2;
  const e = 0.8; // inner margin
  const laneV0 = V(-1.0), laneV1 = V(1.0), laneU0 = U(-2.2), laneU1 = U(-0.2);
  const wheatA = [-hw + e, -hd + e, U(-9.0), laneV0 - 0.6];
  const wheatB = [U(-9.0), -hd + e, laneU0 - 0.6, V(-8.4)];
  const corn = [laneU1 + 1.2, laneV1 + 1.4, hw - e, hd - e];
  const veg = [-hw + e, laneV1 + 1.4, U(-10.0), V(8.6)];
  const pen = [-hw + e, V(9.6), U(-11.0), hd - e];
  const zones = [
    [-hw, laneV0, hw, laneV1, 'dirt'], [laneU0, -hd, laneU1, hd, 'dirt'],
    [U(5.2), -hd, hw, laneV0, 'dirt'],                     // farmyard
    [U(-8.4), V(-7.4), laneU0, laneV0, 'dirt'],             // windmill pad
    [wheatA[0], wheatA[1], wheatA[2], wheatA[3], 'dirt'], [wheatB[0], wheatB[1], wheatB[2], wheatB[3], 'dirt'],
    [corn[0], corn[1], corn[2], corn[3], 'soil'], [veg[0], veg[1], veg[2], veg[3], 'soil'],
  ];
  // the landmark + the back layer
  add('windmill', U(-5.4), V(-4.4), 0.1, { sailAngle: 0.35 });
  add('barn', U(12.2), V(-9.2), 0, { W: 7.0, D: 6.0 });
  add('silo', U(17.4), V(-11.0), 0);
  // wheat fields: rows along u, 0.5 m apart
  for (let v = wheatA[1] + 0.3; v <= wheatA[3] - 0.2; v += 0.6) add('crop_wheat_row', (wheatA[0] + wheatA[2]) / 2, v, 0, { len: wheatA[2] - wheatA[0] - 0.2 });
  for (let v = wheatB[1] + 0.3; v <= wheatB[3] - 0.2; v += 0.6) add('crop_wheat_row', (wheatB[0] + wheatB[2]) / 2, v, 0, { len: wheatB[2] - wheatB[0] - 0.2 });
  // corn: rows along u, 1.15 m apart
  for (let v = corn[1] + 0.5; v <= corn[3] - 0.3; v += 1.15) add('crop_corn_row', (corn[0] + corn[2]) / 2, v, 0, { len: corn[2] - corn[0] - 0.4 });
  // veg patch: rows along u
  const vegKinds = ['cabbage', 'carrot', 'pumpkin', 'cabbage', 'carrot', 'cabbage', 'pumpkin'];
  let vk = 0;
  for (let v = veg[1] + 0.5; v <= veg[3] - 0.3; v += 0.95) add('crop_veg_row', (veg[0] + veg[2]) / 2, v, 0, { len: veg[2] - veg[0] - 0.4, veg: vegKinds[vk++ % vegKinds.length] });
  // fences: rail fence along the lanes in front of the fields, picket by the barn
  run(add, 'rail_fence', wheatA[0], laneV0 - 0.35, wheatA[2] - 0.3, laneV0 - 0.35, 4.0);
  run(add, 'rail_fence', corn[0] + 0.4, laneV1 + 0.5, corn[2], laneV1 + 0.5, 4.0, {}, (u) => Math.abs(u - U(8.0)) < 1.6);
  run(add, 'rail_fence', laneU1 + 0.5, corn[1], laneU1 + 0.5, corn[3], 4.0);
  // sheep pen (front-left corner)
  run(add, 'rail_fence', pen[0], pen[1], pen[2], pen[1], 4.0);
  run(add, 'rail_fence', pen[2], pen[1], pen[2], pen[3], 4.0, {}, (u, v) => Math.abs(v - (pen[1] + pen[3]) / 2) < 1.0);
  for (let k = 0; k < 5; k++) add('sheep', pen[0] + 1.6 + k * ((pen[2] - pen[0] - 3) / 4) + prng.range(-0.4, 0.4), (pen[1] + pen[3]) / 2 + prng.range(-1.2, 1.2), prng.range(0, 6));
  add('water_trough', (pen[0] + pen[2]) / 2, pen[3] - 0.9, 0);
  // hay: shocks around the windmill pad, stacks + round bales in the farmyard
  for (const [u, v] of [[-8.8, -1.9], [-7.6, -1.6], [-3.4, -1.8], [-9.6, -6.8], [-1.0, -6.0]]) add('hay_shock', U(u), V(v), prng.range(0, 6));
  for (const [u, v] of [[-15.0, -1.95], [-12.6, -1.95]]) add('hay_shock', U(u), V(v), prng.range(0, 6));
  add('hay_stack', U(17.6), V(-4.6), 0.3);
  add('hay_stack', U(7.0), V(-12.6), -0.2);
  add('hay_bale', U(8.4), V(-4.4), 0.4, { variant: 'round' });
  add('hay_bale', U(9.7), V(-3.6), -0.3, { variant: 'round' });
  add('hay_bale', U(9.1), V(-5.6), 1.2, { variant: 'round' });
  // farm stand (pergola) on the front lane with produce, seller and customers
  add('pergola', U(-6.4), V(6.2), 0, { W: 4.2, D: 2.8, H: 2.5, post: 'reddishBrown', beam: '#8A5A36', vines: false });
  add('picnic_table', U(-6.4), V(6.0), 0);
  for (const [u, v] of [[-7.6, 7.2], [-5.2, 7.2], [-8.2, 5.0], [-4.6, 5.0]]) add('produce_crate', U(u), V(v), prng.range(-0.3, 0.3));
  add('crate_stack', U(-3.6), V(4.6), 0.2);
  add('figure_farmer', U(-6.4), V(5.0), 0);
  add('figure_std', U(-4.2), V(7.6), -0.5);                                    // customers either side of the stand
  add('figure_std', U(-8.6), V(7.6), 0.5);
  // vehicles: pickup with hay on the cross lane, tractor in the farmyard
  add('pickup', U(-13.0), (laneV0 + laneV1) / 2, Math.PI / 2, { cargo: 'hay', color: 'brightYellow' });
  add('figure_sit', U(-13.0) - 2.0, (laneV0 + laneV1) / 2 + 0.3, -1.0, { lift: 1.4, hat: 'straw' });       // on the tailgate, turned to the front
  const trR = -0.45;
  add('tractor', U(5.0), V(-4.6), trR);
  // driver: the seat is 0.6 m behind the tractor origin, rotated with it
  add('figure_sit', U(5.0) - 0.6 * Math.sin(trR), V(-4.6) - 0.6 * Math.cos(trR), trR, { lift: 1.42, hat: 'straw' });
  add('figure_farmer', U(6.8), V(-3.0), -0.4);
  // scarecrows in the fields
  add('scarecrow', U(9.4), V(8.2), 0.2);
  add('scarecrow', U(-14.0), V(-8.0), -0.3);
  add('scarecrow', U(-14.0), V(5.6), 0.4);
  // farm work: figures in the rows
  for (const [u, v, r] of [[-16.0, -4.6, 0.5], [-11.4, -10.2, -0.4], [-6.0, -11.6, 0.3]]) add('figure_work', U(u), V(v), r, { hat: 'straw' });
  for (const [u, v, r] of [[4.6, 5.6, -0.4], [13.4, 11.0, 0.3], [16.2, 4.8, 0.4]]) add('figure_work', U(u), V(v), r);
  for (const [u, v, r] of [[-16.4, 4.2, 0.3], [-12.2, 7.1, -0.4]]) add('figure_work', U(u), V(v), r);
  add('wheelbarrow', U(-12.0), V(3.4), 1.0, { load: 'hay' });
  add('wheelbarrow', U(3.2), V(4.0), -0.6, { load: 'soil' });
  // chickens in the farmyard + a kid
  for (let k = 0; k < 9; k++) add('chicken', U(10.0 + (k % 5) * 1.4) + prng.range(-0.5, 0.5), V(-3.0 - Math.floor(k / 5) * 1.2) + prng.range(-0.4, 0.4), prng.range(0, 6));
  add('figure_std', U(13.2), V(-2.0), 0.4);
  add('figure_farmer', U(15.6), V(-5.2), -0.45);
  add('water_trough', U(16.6), V(-2.2), Math.PI / 2);
  // people on the lanes
  add('figure_std', U(-1.3), V(10.6), 0);
  add('figure_farmer', U(-0.9), V(-6.8), 0.1);
  add('figure_std', U(2.4), V(0.2), -0.4);
  add('figure_cap', U(-17.2), V(12.4), 0.45);
  // trees: back corners, by the farmyard and lane ends
  add('tree_large', U(-18.6), V(13.9), 0.4);
  add('tree_medium', U(1.6), V(-13.6), 2.0);
  add('tree_medium', U(3.4), V(-9.4), 0.9);
  add('tree_large', hw - 1.6, V(0.0), 1.7);
  add('tree_medium', U(-18.8), V(0.0), 2.6);
  add('tree_small', U(1.2), V(-3.0), 0.3);
  return { style: 'grass', pitch: 0.8, zones, items };
}

/** Author one set-piece. Returns { style, zones, items } in local metres. LOOP c6 (B1): every figure carries `look`
 * (its local yaw), so its head turns toward the set-piece front - the side both hero cameras look from. */
export function authorSetPiece(type, w, d, prng) {
  const plan = type === 'skate' ? authorSkate(w, d, prng) : type === 'garden' ? authorGarden(w, d, prng) : authorFarm(w, d, prng);
  for (const it of plan.items) if (it.kind.startsWith('figure_')) it.look = Math.round(Math.atan2(Math.sin(it.r), Math.cos(it.r)) * 1000) / 1000;
  return plan;
}
