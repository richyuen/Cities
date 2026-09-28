// Deterministic auto-population: streetlamps + low-density street furniture along a road, traffic lights at
// intersections, a seeded scatter of park furniture, and (LOOP cycle 2 / L2) the diorama detail layer — yard
// dressing around lots, pedestrians along sidewalks and clusters at civic entrances/parks. `addProp(kind, x, z,
// rot)` is the module's own api.addProp (it resolves ground/sidewalk height itself), so this file never touches
// THREE or the renderer. The C2 functions additionally take a `place` helper (built by index.js from the module's
// prop/building spatial index) that rejects points on the carriageway / inside a footprint / too close to an
// existing prop — the layout math here only computes candidates.
import { dirToRot } from './geo.js';

const LAMP_SPACING = 24;
const LAMP_INSET = 9;

// ---- C2 detail-layer constants -------------------------------------------------------------------------------
export const PED_SPACING = 18;   // m between pedestrian stations along an edge
export const PED_CHANCE = 0.28;  // fraction of stations that get a figure
export const FIGURE_CAP = 900;   // hard city-wide cap (enforced in index.js's placer)
const FENCE_INSET = 3.0;         // fence line distance outside the footprint edge (inside the band)
// One fence_picket geometry spans 2.0 m (rails to +/-0.995). Runs are laid at FENCE_SPAN so the panels do not
// touch, and index.js's placer keeps any two fence props at least 2.02 m apart (fix round: 8 pairs used to sit
// 1.22-1.88 m apart and interpenetrate).
export const FENCE_SPAN = 2.04;

/** World-space centre of a building footprint (same convention as core/composition.js buildingCenter). */
function buildingCentre(world, b) {
  return world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2);
}

/** Try `kind` at (x,z) with up to `tries` small jitters; returns the created id or null. The jitter is inside
 * the 1-6 m band by construction (callers pass band-centre candidates), and the placer still rejects anything
 * that lands in a footprint or on asphalt. */
function tryPlace(place, prng, kind, x, z, rot, tries = 4) {
  for (let a = 0; a < tries; a++) {
    const jx = a === 0 ? x : x + prng.range(-0.8, 0.8);
    const jz = a === 0 ? z : z + prng.range(-0.8, 0.8);
    const id = place.add(kind, jx, jz, a === 0 ? rot : rot + prng.range(-0.35, 0.35));
    if (id) return id;
  }
  return null;
}

/** One run of `n` abutted fence_picket segments centred on (cx,cz) along the unit direction (ux,uz). */
function fenceRun(place, prng, created, cx, cz, ux, uz, n) {
  const rot = dirToRot(ux, uz);
  let placed = 0;
  for (let k = 0; k < n; k++) {
    const t = (k - (n - 1) / 2) * FENCE_SPAN;
    const id = tryPlace(place, prng, 'fence_picket', cx + ux * t, cz + uz * t, rot, 3);
    if (id) { created.push(id); placed++; }
  }
  return placed;
}

// Yard menu per building kind. Each entry is [itemName, weight] in priority order; `n` items (2-6, capped for
// small 1x1 footprints) are attempted from the top, and each item that places nothing falls through to the next.
const YARD_SPECS = {
  house: ['fenceBack', 'fenceSides', 'gardenBed', 'laundryLine', 'picnicTable', 'bikeFront', 'cratesBack', 'figureYard'],
  apartment: ['bikeFront', 'laundryLine', 'gardenBed', 'cratesBack', 'fenceBack', 'figureYard'],
  shop: ['cratesBack', 'bikeFront', 'gardenBed', 'laundryLine', 'figureYard'],
  service: ['cratesBack', 'crateHeap', 'gardenBed'],
};

/**
 * LOOP cycle 2 yard dressing. Places 2-6 items in the 1-6 m band around a house/apartment/shop footprint
 * (and crates at a service/shop back): a picket fence along the lot edges, garden beds, a laundry line in the
 * back yard, a picnic table, crate stacks behind commercial/service walls, a bike by the front door and 0-2
 * figures. Deterministic per building (`rng.fork('yard:'+id)`), rejection-sampled against carriageways,
 * every building footprint and existing props (through `place`). Returns the created prop ids.
 */
export function populateYard(ctx, rngRoot, b, place) {
  const created = [];
  const world = ctx.world;
  const cs = world.cellSize;
  const prng = rngRoot.fork(`yard:${b.id}`);
  const c = buildingCentre(world, b);
  const halfW = (b.w || 1) * cs / 2;
  const halfD = (b.d || 1) * cs / 2;
  const small = (b.w || 1) * (b.d || 1) <= 2;
  const maxItems = small ? 4 : 6;
  const minItems = small ? 2 : 3;
  let want = prng.int(minItems, maxItems);
  const spec = YARD_SPECS[b.kind] || YARD_SPECS.service;
  // Shuffle the menu deterministically so two neighbouring lots get different subsets (some yards a fence +
  // laundry, others a garden + picnic table) instead of every house repeating the same priority order.
  const order = prng.shuffle([...spec]);
  const backZ = c.z - halfD - FENCE_INSET;
  const sideX = halfW + FENCE_INSET;
  const sideLen = Math.max(1, Math.min(3, Math.floor(halfD / 1.0)));

  const items = {
    fenceBack: () => fenceRun(place, prng, created, c.x, backZ, 1, 0, Math.max(1, Math.min(4, Math.floor((halfW * 2) / FENCE_SPAN)))),
    fenceSides: () => fenceRun(place, prng, created, c.x - sideX, c.z, 0, 1, sideLen)
      + fenceRun(place, prng, created, c.x + sideX, c.z, 0, 1, sideLen),
    gardenBed: () => {
      const side = prng.chance(0.5) ? -1 : 1;
      const spots = [
        [c.x + side * (halfW + 1.7), c.z + prng.range(-halfD * 0.4, halfD * 0.4), prng.chance(0.5) ? 0 : Math.PI / 2],
        [c.x + prng.range(-halfW * 0.5, halfW * 0.5), c.z + halfD + 1.7, 0],
        [c.x + (prng.chance(0.5) ? -1 : 1) * (halfW + 1.7), c.z - halfD * 0.4, prng.chance(0.5) ? 0 : Math.PI / 2],
      ];
      let n = 0;
      for (const [x, z, rot] of spots) {
        const id = tryPlace(place, prng, 'garden_bed', x, z, rot, 3);
        if (id) { created.push(id); n++; }
        if (n >= 1 && !prng.chance(0.5)) break; // 1-2 beds, seeded
        if (n >= 2) break;
      }
      return n;
    },
    laundryLine: () => {
      const id = tryPlace(place, prng, 'laundry_line', c.x + prng.range(-1.2, 1.2), c.z - halfD - 2.1, 0);
      if (id) { created.push(id); return 1; }
      return 0;
    },
    picnicTable: () => {
      // A picnic table needs a clear ~2 m square: try the back yard, then a side yard.
      const spots = [
        [c.x + prng.range(-1.5, 1.5), c.z - halfD - 2.6],
        [c.x + (prng.chance(0.5) ? -1 : 1) * (halfW + 2.0), c.z + prng.range(-halfD * 0.5, halfD * 0.5)],
      ];
      for (const [x, z] of spots) {
        const id = tryPlace(place, prng, 'picnic_table', x, z, prng.range(0, Math.PI * 2), 4);
        if (id) { created.push(id); return 1; }
      }
      return 0;
    },
    bikeFront: () => {
      const side = prng.chance(0.5) ? -1 : 1;
      const id = tryPlace(place, prng, 'bike', c.x + side * prng.range(2.2, 3.4), c.z + halfD + 1.7, dirToRot(1, 0));
      if (id) { created.push(id); return 1; }
      return 0;
    },
    cratesBack: () => {
      let n = 0;
      const count = prng.int(1, 2);
      for (let k = 0; k < count; k++) {
        const id = tryPlace(place, prng, 'crate_stack', c.x + prng.range(-1.6, 1.6), c.z - halfD - 1.5, prng.range(0, Math.PI * 2));
        if (id) { created.push(id); n++; }
      }
      return n;
    },
    crateHeap: () => {
      const id = tryPlace(place, prng, 'crate_stack', c.x + (prng.chance(0.5) ? -1 : 1) * (halfW + 2.2), c.z - halfD - 1.2, prng.range(0, Math.PI * 2));
      if (id) { created.push(id); return 1; }
      return 0;
    },
    figureYard: () => {
      const front = prng.chance(0.65);
      const x = c.x + prng.range(-halfW * 0.7, halfW * 0.7);
      const z = front ? c.z + halfD + 2.0 : c.z - halfD - 1.8;
      const id = tryPlace(place, prng, 'figure', x, z, dirToRot(prng.range(-1, 1), prng.range(-1, 1)), 3);
      if (id) { created.push(id); return 1; }
      return 0;
    },
  };

  let placedItems = 0;
  for (const name of order) {
    if (placedItems >= want) break;
    const fn = items[name];
    if (!fn) continue;
    if (fn() > 0) placedItems++; // an item may place several props (a fence run); count items, not props
  }
  return created;
}

/**
 * Civic entrance life (LOOP cycle 2 item 4): 2-4 props (bench / flower-bed planter / bike / crate stack / bin)
 * placed within ~14 m of every school/hospital/fire/police +z entrance so a closeup of the hero building has
 * street life in frame, plus a 2-3 figure pedestrian cluster at the door. Returns created prop ids.
 *
 * Placement stays inside the lot (a 1.1-1.9 m strip in front of the entrance face and the side yards): the block
 * fillers pave alleys ~4 m out *after* the civics are placed, and anything further into the forecourt would be
 * swept later as a genuine carriageway violation. The strip is also where the closeup hero looks.
 *
 * `opts` (fix round 2): `key` overrides the rng fork name and `figures`/`items` override the seeded counts, so
 * settleDetail() can top a cluster back up after culling a buried/underwater prop.
 */
export function populateCivicEntrance(ctx, rngRoot, b, place, opts = {}) {
  const created = [];
  const world = ctx.world;
  const cs = world.cellSize;
  const prng = rngRoot.fork(opts.key || `civic:${b.id}`);
  const c = buildingCentre(world, b);
  const halfW = (b.w || 1) * cs / 2;
  const halfD = (b.d || 1) * cs / 2;
  const ex = c.x, ez = c.z + halfD; // +z entrance face (the facade the closeup preset frames)

  // Candidate pool: four spots in the entrance strip + three per side yard (10 spots), drawn in a seeded order.
  // The strip stays within 1.1-1.9 m of the face: block fillers pave a 3 m-wide alley ~4 m out (a 1.9 m
  // half-corridor + curb), so anything deeper would be rejected now or swept when that alley is added later.
  const front = [];
  for (let k = 0; k < 4; k++) front.push([ex + prng.range(-halfW * 0.8, halfW * 0.8), ez + prng.range(1.1, 1.9)]);
  const sideSign = prng.chance(0.5) ? -1 : 1;
  const sides = [];
  // Side spots sit in the front half of the flank (0.35-0.72 of the depth), so they are still within the ~14 m
  // entrance radius the closeup hero and the acceptance test use — a bench by the front corner, not the backyard.
  for (const zf of [0.35, 0.55, 0.72]) {
    sides.push([ex + sideSign * (halfW + prng.range(1.6, 3.0)), c.z + zf * halfD]);
    sides.push([ex - sideSign * (halfW + prng.range(1.6, 3.0)), c.z + zf * halfD]);
  }
  const pool = prng.shuffle([...front, ...sides]);
  const ordered = [...front, ...sides]; // entrance strip first (survives every later citygen phase)

  // People at the door first: they claim the best walking spots, which is what the closeup hero needs.
  let figs = 0;
  const wantFig = opts.figures !== undefined ? opts.figures : prng.int(2, 3);
  for (let k = 0; k < wantFig; k++) {
    for (let a = 0; a < 10; a++) {
      const s = a < 6 ? ordered[(k + a) % ordered.length] : pool[(k + a) % pool.length];
      const id = place.add('figure', s[0] + prng.range(-0.5, 0.5), s[1] + prng.range(-0.2, 0.2), dirToRot(prng.range(-1, 1), prng.range(-1, 1)));
      if (id) { created.push(id); figs++; break; }
    }
  }
  // Deterministic backstop: one walk of the facade at two walk distances, first free spot wins, so every civic
  // entrance has at least one figure even when its whole forecourt is carriageway.
  if (!figs) {
    for (const dz of [1.2, 1.8]) {
      for (let dx = -halfW - 2; dx <= halfW + 2 && !figs; dx += 1) {
        const id = place.add('figure', ex + dx, ez + dz, 0);
        if (id) { created.push(id); figs++; }
      }
    }
  }

  // Then 2-4 pieces of street furniture. The first two pieces are placed strictly in the entrance strip: the
  // strip belongs to the civic's own alley verge and survives every later citygen phase, while a side-yard spot
  // would be swept when a block-fill house claims that flank. Extras may use the flanks.
  const menu = ['bench', 'flower_bed', 'bike', 'crate_stack', 'trash_bin', 'bench', 'flower_bed'];
  const n = opts.items !== undefined ? opts.items : prng.int(2, 4);
  for (let k = 0; k < n; k++) {
    const kind = prng.pick(menu);
    const rot = kind === 'bench' ? Math.PI : prng.range(0, Math.PI * 2);
    const spots = k < 2 ? front : ordered;
    let id = null;
    for (let a = 0; a < spots.length && !id; a++) {
      const s = spots[(k + a) % spots.length];
      id = place.add(kind, s[0] + prng.range(-0.4, 0.4), s[1] + prng.range(-0.2, 0.2), rot);
    }
    if (!id) {
      for (const dz of [1.4, 1.0, 1.8]) {
        for (let dx = -(halfW + 1.5); dx <= halfW + 1.5 && !id; dx += 1.2) {
          id = place.add(kind, ex + dx, ez + dz, rot);
        }
        if (id) break;
      }
    }
    if (id) created.push(id);
  }
  return created;
}

/** Crates/bins at the back of a service or industrial footprint (plant/warehouse/office/power/water). */
export function populateServiceBack(ctx, rngRoot, b, place) {
  const created = [];
  const world = ctx.world;
  const cs = world.cellSize;
  const prng = rngRoot.fork(`service:${b.id}`);
  const c = buildingCentre(world, b);
  const halfW = (b.w || 1) * cs / 2;
  const halfD = (b.d || 1) * cs / 2;
  const n = prng.int(1, 3);
  for (let k = 0; k < n; k++) {
    const id = tryPlace(place, prng, 'crate_stack', c.x + prng.range(-halfW * 0.8, halfW * 0.8), c.z - halfD - 1.6, prng.range(0, Math.PI * 2), 6);
    if (id) created.push(id);
  }
  return created;
}

/** A 2-3 figure knot in a disc of radius `r` around (x,z) — used for civic entrances and park corners. */
export function populatePedestrianCluster(ctx, rngRoot, key, x, z, r, place) {
  const created = [];
  const prng = rngRoot.fork(`peds:${key}`);
  const n = prng.int(2, 3);
  for (let k = 0; k < n; k++) {
    for (let a = 0; a < 7; a++) {
      const ang = prng.range(0, Math.PI * 2);
      const dist = prng.range(0.8, r);
      const px = x + Math.sin(ang) * dist, pz = z + Math.cos(ang) * dist;
      const id = place.add('figure', px, pz, dirToRot(prng.range(-1, 1), prng.range(-1, 1)));
      if (id) { created.push(id); break; }
    }
  }
  return created;
}

/**
 * Pedestrians (LOOP cycle 2 item 3): walk one street/avenue edge and drop a figure on the sidewalk every
 * ~18 m with PED_CHANCE, alternating sides, facing along the walk. Deterministic per edge
 * (`rng.fork('ped:'+edgeId)`); the module de-dupes edges and enforces the 900-figure cap through `place`.
 * Civic/parks get their clusters from populateCivicEntrance()/populatePark() instead. Returns created ids.
 */
export function populatePedestrians(ctx, rngRoot, edgeId, place) {
  const created = [];
  const world = ctx.world;
  const edge = world.roads.edges.get(edgeId);
  if (!edge) return created;
  if (edge.kind !== 'street' && edge.kind !== 'avenue') return created;
  const na = world.roads.nodes.get(edge.a), nb = world.roads.nodes.get(edge.b);
  if (!na || !nb) return created;
  const dx = nb.x - na.x, dz = nb.z - na.z;
  const L = Math.hypot(dx, dz);
  if (L < 14) return created;
  const d = { x: dx / L, z: dz / L };
  const right = { x: -d.z, z: d.x };
  const roadsApi = ctx.modules.get('roads')?.status === 'ok' ? ctx.modules.get('roads').api : null;
  const width = roadsApi ? roadsApi.roadWidth(edge.kind) : (edge.width || 8);
  const footprint = roadsApi ? roadsApi.footprintWidth(edge.kind) : width + 4;
  const sidewalkW = Math.max(0, (footprint - width) / 2);
  const offset = width / 2 + Math.max(1.2, sidewalkW * 0.55);
  const prng = rngRoot.fork(`ped:${edgeId}`);
  const n = Math.max(1, Math.round(L / PED_SPACING));
  const step = L / n;
  let side = prng.chance(0.5) ? 1 : -1;
  for (let k = 0; k < n; k++) {
    const s = step * (k + 0.5);
    const walk = prng.chance(PED_CHANCE);
    if (walk) {
      const px = na.x + d.x * s + right.x * offset * side;
      const pz = na.z + d.z * s + right.z * offset * side;
      const rot = dirToRot(d.x * side, d.z * side);
      const id = place.add('figure', px, pz, rot);
      if (id) created.push(id);
    }
    side = -side;
  }
  return created;
}

// Idempotency guard: both this module's own `road:added` listener and external callers (e.g. `tools`, after an
// interactive road placement) may call populateAlongRoad(edgeId) for the same edge more than once. Edge ids are
// never reused (World._ids.edge only increments, even across clearContent()), so a module-level Set is a safe,
// permanent record of "already furnished" edges — a second call on the same id is a no-op instead of doubling
// every lamp/bin/bench on it.
const populatedEdges = new Set();

/** Forget that an edge was furnished, so the next populateAlongRoad(edgeId) call re-runs it. Used when an in-place
 * road edit changes the cross-section and the furniture has to be re-laid at the new offsets. */
export function forgetEdge(edgeId) { populatedEdges.delete(edgeId); }

/** Streetlamps every ~24 m alternating sides + occasional bin/bench/sign, along one road edge. Safe to call more
 * than once with the same `edgeId`: every call after the first is a no-op (see `populatedEdges` above). */
export function populateAlongRoad(ctx, addProp, rngRoot, edgeId) {
  const created = [];
  if (populatedEdges.has(edgeId)) return created;
  const world = ctx.world;
  const edge = world.roads.edges.get(edgeId);
  if (!edge) return created;
  populatedEdges.add(edgeId);
  const na = world.roads.nodes.get(edge.a), nb = world.roads.nodes.get(edge.b);
  if (!na || !nb) return created;
  const dx = nb.x - na.x, dz = nb.z - na.z;
  const L = Math.hypot(dx, dz);
  if (L < 8) return created;
  const d = { x: dx / L, z: dz / L };
  const right = { x: -d.z, z: d.x };
  const roadsApi = ctx.modules.get('roads')?.status === 'ok' ? ctx.modules.get('roads').api : null;
  const width = roadsApi ? roadsApi.roadWidth(edge.kind) : (edge.width || 8);
  const footprint = roadsApi ? roadsApi.footprintWidth(edge.kind) : width + 4;
  const sidewalkW = Math.max(0, (footprint - width) / 2);
  const offset = width / 2 + Math.max(1.4, sidewalkW * 0.6);
  const prng = rngRoot.fork(`road:${edgeId}`);

  const usable = L - LAMP_INSET * 2;
  if (usable < LAMP_SPACING * 0.5) return created;
  const nStations = Math.max(1, Math.round(usable / LAMP_SPACING));
  const step = usable / nStations;
  let side = prng.chance(0.5) ? 1 : -1;
  let lastExtra = -Infinity;

  for (let k = 0; k <= nStations; k++) {
    const s = LAMP_INSET + step * k;
    const cx = na.x + d.x * s, cz = na.z + d.z * s;
    const px = cx + right.x * offset * side, pz = cz + right.z * offset * side;
    const rot = dirToRot(-right.x * side, -right.z * side);
    const id = addProp('streetlamp', px, pz, rot);
    if (id) created.push(id);
    if (s - lastExtra > LAMP_SPACING * 2 && prng.chance(0.55)) {
      lastExtra = s;
      const eside = -side;
      const ex = cx + right.x * (offset + 0.3) * eside, ez = cz + right.z * (offset + 0.3) * eside;
      const erot = dirToRot(-right.x * eside, -right.z * eside);
      const kind = prng.pick(['trash_bin', 'bench', 'road_sign']);
      const eid = addProp(kind, ex, ez, erot);
      if (eid) created.push(eid);
    }
    side = -side;
  }
  return created;
}

/** One traffic light per approach arm, standing on the near corner facing oncoming traffic. Called for every
 * node with >=3 arms (the caller de-dupes already-signalled nodes). */
export function populateIntersectionNode(ctx, addProp, rngRoot, roadsApi, node) {
  const created = [];
  for (const arm of node.arms) {
    const width = roadsApi.roadWidth(arm.kind);
    const footprint = roadsApi.footprintWidth(arm.kind);
    const sidewalkW = Math.max(0, (footprint - width) / 2);
    const ax = Math.cos(arm.angle), az = Math.sin(arm.angle);
    const right = { x: -az, z: ax };
    const along = Math.max(arm.trim || 3, 3) + 0.7;
    const lateral = width / 2 + sidewalkW * 0.55;
    const px = node.x + ax * along + right.x * lateral;
    const pz = node.z + az * along + right.z * lateral;
    const rot = dirToRot(-ax, -az); // face oncoming traffic on this arm
    const id = addProp('traffic_light', px, pz, rot);
    if (id) created.push(id);
  }
  return created;
}

/** Seeded Poisson-disc-ish scatter of park furniture over a set of {i,j} park cells. Returns created prop ids.
 * When a `place` helper is supplied (C2), also drops a 2-3 figure knot on a park cell so parks read inhabited. */
export function populatePark(ctx, addProp, rngRoot, cells, place) {
  const created = [];
  if (!cells || !cells.length) return created;
  const world = ctx.world;
  const key = (i, j) => `${i},${j}`;
  const set = new Set(cells.map((c) => key(c.i, c.j)));
  let i0 = Infinity, i1 = -Infinity, j0 = Infinity, j1 = -Infinity;
  for (const c of cells) { i0 = Math.min(i0, c.i); i1 = Math.max(i1, c.i); j0 = Math.min(j0, c.j); j1 = Math.max(j1, c.j); }
  const cs = world.cellSize;
  const minX = world.minX + i0 * cs, maxX = world.minX + (i1 + 1) * cs;
  const minZ = world.minZ + j0 * cs, maxZ = world.minZ + (j1 + 1) * cs;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const inPark = (x, z) => { const { i, j } = world.worldToCell(x, z); return set.has(key(i, j)); };
  const prng = rngRoot.fork(`park:${i0}:${j0}:${i1}:${j1}:${cells.length}`);
  const areaCells = cells.length;

  // fountain centrepiece for parks with enough room
  let fountainAt = null;
  if (areaCells >= 6 && inPark(cx, cz)) {
    const id = addProp('fountain', cx, cz, prng.range(0, Math.PI * 2));
    if (id) { created.push(id); fountainAt = { x: cx, z: cz, r: 2.5 }; }
  }

  // low hedge border with gaps for path openings
  if (areaCells >= 4) {
    const HL = 2.0;
    const edges = [
      [{ x: minX, z: minZ }, { x: maxX, z: minZ }], [{ x: maxX, z: minZ }, { x: maxX, z: maxZ }],
      [{ x: maxX, z: maxZ }, { x: minX, z: maxZ }], [{ x: minX, z: maxZ }, { x: minX, z: minZ }],
    ];
    for (const [from, to] of edges) {
      const edx = to.x - from.x, edz = to.z - from.z, len = Math.hypot(edx, edz);
      if (len < HL) continue;
      const ux = edx / len, uz = edz / len, nx = -uz, nz = ux;
      const n = Math.floor(len / HL);
      for (let k = 0; k < n; k++) {
        if (!prng.chance(0.72)) continue;
        const s = (k + 0.5) * HL;
        const bx = from.x + ux * s, bz = from.z + uz * s;
        let ix = bx + nx * 0.45, iz = bz + nz * 0.45;
        if (!inPark(ix, iz)) { ix = bx - nx * 0.45; iz = bz - nz * 0.45; }
        if (!inPark(ix, iz)) continue;
        const id = addProp('hedge', ix, iz, dirToRot(ux, uz));
        if (id) created.push(id);
      }
    }
  }

  // rejection-sampled scatter of trees / park benches / flower beds
  const placed = [];
  const farEnough = (x, z, r) => {
    if (fountainAt && Math.hypot(x - fountainAt.x, z - fountainAt.z) < fountainAt.r + r) return false;
    for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < p.r + r) return false;
    return true;
  };
  const targetTrees = Math.max(2, Math.round(areaCells * 0.8));
  const attempts = Math.max(24, areaCells * 14);
  let trees = 0, benches = 0, beds = 0;
  for (let a = 0; a < attempts && (trees < targetTrees || benches < 3 || beds < 2); a++) {
    const x = prng.range(minX + 1.5, maxX - 1.5), z = prng.range(minZ + 1.5, maxZ - 1.5);
    if (!inPark(x, z)) continue;
    const roll = prng.float();
    let kind, r;
    if (trees < targetTrees && roll < 0.62) {
      kind = prng.pick(['tree_small', 'tree_small', 'tree_medium', 'tree_large']);
      r = kind === 'tree_large' ? 2.1 : kind === 'tree_medium' ? 1.5 : 1.0;
    } else if (benches < 3 && roll < 0.82) { kind = 'park_bench'; r = 1.2; }
    else if (beds < 2 && roll < 0.96) { kind = 'flower_bed'; r = 1.0; }
    else continue;
    if (!farEnough(x, z, r)) continue;
    const id = addProp(kind, x, z, prng.range(0, Math.PI * 2));
    if (!id) continue;
    created.push(id); placed.push({ x, z, r });
    if (kind.startsWith('tree')) trees++; else if (kind === 'park_bench') benches++; else beds++;
  }

  // C2: a small knot of people on a park cell (deterministic: same park key -> same spot).
  if (place) {
    const key = `${i0}:${j0}:${i1}:${j1}:${cells.length}`;
    for (let a = 0; a < 6; a++) {
      const x = cx + prng.range(-(maxX - minX) * 0.25, (maxX - minX) * 0.25);
      const z = cz + prng.range(-(maxZ - minZ) * 0.25, (maxZ - minZ) * 0.25);
      if (!inPark(x, z)) continue;
      created.push(...populatePedestrianCluster(ctx, rngRoot, `park:${key}`, x, z, 3.5, place));
      break;
    }
  }
  return created;
}
