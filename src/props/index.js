// props — minifig-scale Blox street furniture and nature. Renders world.props (all instanced, grouped by
// role) and auto-populates streetlamps/traffic lights/street furniture along roads and at intersections, plus
// seeded park scatter, in the full game (never in showcase — showcase stages its scenes explicitly).
//
// LOOP cycle 2 (L2 diorama detail layer): the module also owns the deterministic dressing pass on top of the
// street furniture — yard dressing around house/apartment/shop lots (fence/garden/laundry/picnic/crates/bike),
// civic entrance clusters (bench/planter/bike/crates + waiting figures), crates at shop/service backs and
// pedestrian figures along every street/avenue sidewalk (plus knots at civics and parks). All of it is seeded
// off ctx.rng forks (`yard:<buildingId>`, `civic:<buildingId>`, `ped:<edgeId>`) and placed through a spatial
// placer that rejects carriageways, building footprints and anything within ~1 m of an existing prop.
import * as THREE from 'three';
import {
  KIND_NAMES, buildRoleGeometry, buildKindParts, SHARED_GEOMETRY_ROLES, FOUNTAIN_WATER_Y,
} from './kinds.js';
import { buildRoleMaterials } from './materials.js';
import { mat } from './geo.js';
import {
  populateAlongRoad, populateIntersectionNode, populatePark, forgetEdge, markEdgePopulated,
  populateYard, populateCivicEntrance, populateServiceBack, populatePedestrians, FIGURE_CAP,
} from './populate.js';
import { stageStreet, stagePark, stageYards, stageSetPieces, PRESETS } from './showcase.js';
import { SP_FIGURE_KINDS, SP_NOFADE_KINDS } from './spkinds.js';
import { SP_TYPES, clampSize, heroCamera, authorSetPiece } from './setpieces.js';

const KIND_SET = new Set(KIND_NAMES);
const LOD_NEAR = 170, LOD_FAR = 220, LOD_MOVE = 6;
const LIGHT_POOL_SIZE = 14;
const LIGHT_REFRESH = 0.4; // s
const TRAFFIC_CYCLE = { green: 5.0, yellow: 1.5, red: 5.5 };
const TRAFFIC_TOTAL = TRAFFIC_CYCLE.green + TRAFFIC_CYCLE.yellow + TRAFFIC_CYCLE.red;
const FLOWER_COLORS = ['brightRed', 'brightYellow', 'mediumLilac', 'brightPink', 'mediumAzur', 'brightOrange'];
const FADE_EXEMPT = (role) => role.startsWith('busstop') || role.startsWith('trafficlight') || role.startsWith('fountain');

// ---- C2 detail layer -----------------------------------------------------------------------------------------
const IDX = 4;                       // spatial index cell size (m) for the detail-layer placer
const YARD_KINDS = new Set(['house', 'apartment', 'shop']);
const CIVIC_KINDS = new Set(['school', 'hospital', 'fire_department', 'police_station']);
const SERVICE_KINDS = new Set(['power_plant', 'water_tower', 'plant', 'warehouse', 'office']);
// Minimum centre distance to an existing prop, per placed kind (a picnic table is 1.75 m wide, a fence segment
// only 2 m long and abutted end-to-end, so one constant cannot serve them all).
const PLACE_SEP = {
  fence_picket: 1.2, garden_bed: 1.5, laundry_line: 2.2, picnic_table: 2.0, crate_stack: 1.1,
  bike: 0.8, figure: 0.7, bench: 1.2, flower_bed: 1.2, trash_bin: 0.7,
  // LOOP cycle 5 set-piece kinds (only ever consulted when a C2 prop lands next to a set-piece edge; the rect
  // itself is rejected outright by placementFree)
  windmill: 3.2, barn: 4.8, silo: 2.0, pergola: 2.8, skate_bank: 4.2, skate_quarter: 3.2, mural_wall: 2.0,
  pickup: 2.4, tractor: 2.0, sandbox: 2.0, pond: 2.4, swing_set: 2.4, parasol_table: 1.6, hay_stack: 1.4,
};
const PLACE_SEP_DEFAULT = 1.2;
// Fix round issue 3: two fence panels must never interpenetrate (a panel spans 2.0 m) — the separation test
// uses this whenever either prop is a fence, regardless of which kind is being placed.
const FENCE_SEP = 2.02;
// The C2 dressing owns every prop it places via an explicit content-derived id (`c2p:<kind>:<x>:<z>`), so the
// sweeps below use that id prefix as the ownership test — they can never touch another module's street furniture,
// and C2 props never consume world._ids.prop (fix round issue 2: pre-existing props keep their pre-C2 ids and
// therefore their exact per-instance variation).
const C2_ID_PREFIX = 'c2p:';
function isC2Prop(p) { return typeof p.id === 'string' && p.id.startsWith(C2_ID_PREFIX); }
// LOOP cycle 5 set-pieces own their props through a second content-derived prefix (`sp:<setPieceId>:...`): they
// never consume world._ids.prop either, and they are settled/swept per set-piece (deck Y, never terrain snap).
const SP_ID_PREFIX = 'sp:';
function isSpProp(p) { return typeof p.id === 'string' && p.id.startsWith(SP_ID_PREFIX); }
const FIGURE_KINDS = new Set(['figure', ...SP_FIGURE_KINDS]);
function isFigureKind(kind) { return FIGURE_KINDS.has(kind); }
/** Variation seed key for rebuild(): C2 props use kind + rounded position (stable under id churn and across
 * restages); set-piece props use their content-derived id; everything else keeps the id it had pre-C2 (also
 * stable, because neither C2 nor set-piece props consume ids). */
function variationKey(p) {
  if (isC2Prop(p)) return `${p.kind}:${p.x.toFixed(2)}:${p.z.toFixed(2)}`;
  return String(p.id);
}
/** Deck surface height above the highest terrain sample under a set-piece: the tile layer's top. 0.26 m buries
 * the 0.17 m terrain studs inside the plinth with margin. */
const SP_DECK_RAISE = 0.26;

const S = {
  ctx: null, group: null, rng: null, unsub: [],
  roleTable: null,        // Map role -> { geometry, material, instanceColor, castShadow, receiveShadow, mesh, dynamic }
  roleInstances: null,    // Map role -> [{ pos:Vector3, base:Matrix4, color:THREE.Color|null }]
  dirty: true, lastEvent: 0,
  fountains: [],          // { points, geometry, basePos:{x,y,z} }
  lightPool: [], lightPoolTimer: 0,
  trafficPhase: 0, trafficPhaseName: null, wasNight: null,
  camLast: new THREE.Vector3(Infinity, Infinity, Infinity),
  time: 0,
  signaledNodes: new Set(),
  nodeSignalProps: new Map(), // nodeId -> traffic_light prop ids (re-placed when a road edit changes arm widths)
  parkDirty: new Set(), parkFlushAt: 0, parkClusters: new Map(),
  waterMat: null,
  // C2 detail layer state
  pIdx: new Map(),        // "ix:iz" -> [{ x, z }] every prop in the world (4 m cells)
  c2Idx: new Map(),       // "ix:iz" -> [prop] C2-owned props only (the sweeps' fast path)
  bIdx: new Map(),        // "ix:iz" -> [{ building, minX, maxX, minZ, maxZ }] (AABB inserted into every cell it covers)
  yardByBuilding: new Map(), // buildingId -> [propId] (removed again on building:removed)
  pedEdges: new Set(),    // edge ids already walked by populatePedestrians()
  figureCount: 0,
  roadsApi: null,
  c2Off: false,           // ?noc2=1: verification flag — disables the whole C2 pass (pre-C2 world)
  detailMs: 0,            // accumulated synchronous dressing cost (boot evidence)
  detailSettle: null,     // { fixed, removed } of the last settleDetail()
  detailSettledOnce: false, // set by the first settleDetail(): live road edits re-settle afterwards
  roadSnap: null, roadSnapDirty: true, // local road centreline snapshot for the carriageway test
  // LOOP cycle 5 set-pieces
  spOff: false,           // ?nosp=1: verification flag - placeSetPiece() becomes a no-op
  setPieces: new Map(),   // id -> entry { type, id, x, z, rot, w, d, deckY, fixedDeck, props:[ids], hero, heroAlt, counts }
  spEvict: [],            // non-set-piece props that landed inside a set-piece rect (removed in update())
  spSettle: null,         // { pieces, fixed } of the last set-piece settle
  spPlacing: false,       // true while placeSetPiece() adds its own props (the adopt hook stays out of the way)
  spResettle: false,      // terrain changed under the world: re-settle the set-piece decks on the next update
  // Save replay (menu's applySave): the saved props are restored 1:1, so every generator that reacts to
  // road/building/park events stays quiet until endReplay() re-adopts the restored world.
  replaying: false,
  live: false,            // set by the first update(): city generation is over, edits from here on are the player's
  signalDirty: new Set(), // node ids whose arm set changed by a road removal (signals re-placed in update())
};

/** Ownership tags written onto the world's prop records (they ride along in a save): `edgeId` = street furniture
 * and sidewalk figures of that road edge, `nodeId` = that junction's traffic lights, `yardOf` = a building's yard
 * dressing, `park` = park scatter. They are what lets a removal take its own props with it. */
function tagProps(ids, key, value) {
  const props = S.ctx.world.props;
  for (const id of ids || []) { const p = props.get(id); if (p) p[key] = value; }
  return ids;
}

function idxKey(ix, iz) { return `${ix}:${iz}`; }
function idxOf(x, z) { return `${Math.floor(x / IDX)}:${Math.floor(z / IDX)}`; }

function indexProp(p) {
  const k = idxOf(p.x, p.z);
  let list = S.pIdx.get(k);
  if (!list) S.pIdx.set(k, (list = []));
  list.push(p);
  if (isC2Prop(p)) {
    let c2 = S.c2Idx.get(k);
    if (!c2) S.c2Idx.set(k, (c2 = []));
    c2.push(p);
  }
}
function unindexProp(p) {
  const k = idxOf(p.x, p.z);
  const list = S.pIdx.get(k);
  if (list) {
    const i = list.indexOf(p);
    if (i >= 0) list.splice(i, 1);
  }
  const c2 = S.c2Idx.get(k);
  if (c2) {
    const i = c2.indexOf(p);
    if (i >= 0) c2.splice(i, 1);
  }
}
function buildingBounds(b) {
  const world = S.ctx.world, cs = world.cellSize;
  const minX = world.minX + b.i * cs, maxX = world.minX + (b.i + (b.w || 1)) * cs;
  const minZ = world.minZ + b.j * cs, maxZ = world.minZ + (b.j + (b.d || 1)) * cs;
  return { minX, maxX, minZ, maxZ };
}
function indexBuilding(b) {
  const bb = buildingBounds(b);
  for (let iz = Math.floor(bb.minZ / IDX); iz <= Math.floor(bb.maxZ / IDX); iz++) {
    for (let ix = Math.floor(bb.minX / IDX); ix <= Math.floor(bb.maxX / IDX); ix++) {
      const k = idxKey(ix, iz);
      let list = S.bIdx.get(k);
      if (!list) S.bIdx.set(k, (list = []));
      list.push({ building: b, ...bb });
    }
  }
}
function unindexBuilding(b) {
  const bb = buildingBounds(b);
  for (let iz = Math.floor(bb.minZ / IDX); iz <= Math.floor(bb.maxZ / IDX); iz++) {
    for (let ix = Math.floor(bb.minX / IDX); ix <= Math.floor(bb.maxX / IDX); ix++) {
      const list = S.bIdx.get(idxKey(ix, iz));
      if (!list) continue;
      for (let k = list.length - 1; k >= 0; k--) if (list[k].building === b) list.splice(k, 1);
    }
  }
}

/** The C2 placer's rejection test: not inside any building footprint, not within the (kind-aware) separation of
 * an existing prop, not on a carriageway. Heights are deliberately *not* resolved here (the placement-time road
 * lookup used to cost most of the boot: 3709 roads.api.snapToRoad calls, each rebuilding the lane network after
 * a terrain mark). `settleDetail()` re-resolves every C2 height once against the finished roads/terrain. */
function placementFree(kind, x, z) {
  if (S.setPieces.size && setPieceAt(x, z, 0.5)) return false; // never dress onto an authored set-piece deck
  const bList = S.bIdx.get(idxOf(x, z));
  if (bList) {
    for (const bb of bList) {
      if (x >= bb.minX - 0.3 && x <= bb.maxX + 0.3 && z >= bb.minZ - 0.3 && z <= bb.maxZ + 0.3) return false;
    }
  }
  const ix = Math.floor(x / IDX), iz = Math.floor(z / IDX);
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const list = S.pIdx.get(idxKey(ix + dx, iz + dz));
      if (!list) continue;
      for (const p of list) {
        // The *larger* of the two kinds' separations: a figure must not stand inside a bench's footprint just
        // because the figure's own separation (0.7 m) is smaller than the bench's (1.2 m). Fences get their own
        // floor (2.02 m) against any other fence, so panels can never interpenetrate.
        const need = minSepFor(kind, p);
        const ddx = p.x - x, ddz = p.z - z;
        if (ddx * ddx + ddz * ddz < need * need) return false;
      }
    }
  }
  const block = roadBlock(x, z);
  if (block) return false; // 'carriageway' | 'skirt' (buried under a raised deck's terrace) | 'water'
  return true;
}

function minSepFor(kind, other) {
  const base = Math.max(PLACE_SEP[kind] ?? PLACE_SEP_DEFAULT, PLACE_SEP[other.kind] ?? PLACE_SEP_DEFAULT);
  return kind === 'fence_picket' || other.kind === 'fence_picket' ? Math.max(base, FENCE_SEP) : base;
}

// Rendered plate tops relative to the road bed: lane surface +0.16, sidewalk plate +0.35 (roads/network.js Y).
// Footprint-aware height/cover tests only need the plate top (the sidewalk is the highest road surface a prop
// can stand on), so the skirt model uses +0.35.
const PLATE_TOP = 0.35;
const TERRACE_STEP = 0.4;   // roads/geometry.js addTerraces: one plate per 0.8 m run
const TERRACE_RUN = 0.8;
const TERRACE_MAX_STEPS = 14;

/** Local, lazily-rebuilt snapshot of every road: centreline, carriageway rejection radius, rendered footprint
 * half-width and bed heights at the nodes. Same rejection maths as roads.api.snapToRoad(dist < half + 0.4), but
 * O(1) rebuilds per road/terrain phase instead of one full lane-network rebuild per candidate (the fix round's
 * 790 ms boot hot spot). Refreshed on road/terrain events and per staging. */
function markRoadSnapshotDirty() { S.roadSnapDirty = true; }

function roadSnapshot() {
  if (S.roadSnap && !S.roadSnapDirty) return S.roadSnap;
  const world = S.ctx.world;
  const snap = [];
  for (const e of world.roads.edges.values()) {
    const a = world.roads.nodes.get(e.a), b = world.roads.nodes.get(e.b);
    if (!a || !b) continue;
    const width = S.roadsApi?.roadWidth(e.kind) ?? e.width ?? 8;
    const footprint = (S.roadsApi?.footprintWidth ? S.roadsApi.footprintWidth(e.kind) : width + 4) || width + 4;
    snap.push({
      edgeId: e.id, kind: e.kind,
      ax: a.x, az: a.z, bx: b.x, bz: b.z,
      half: width / 2 + 0.4,     // carriageway + 0.4 m curb margin
      fp: footprint / 2,         // rendered footprint half-width (sidewalks/verges included)
      ay: a.y, by: b.y,          // road-bed heights at the nodes
    });
  }
  S.roadSnap = snap;
  S.roadSnapDirty = false;
  return snap;
}

/** Projection of (x,z) onto one snapshot edge: { t, lateral }. */
function projectTo(e, x, z) {
  const dx = e.bx - e.ax, dz = e.bz - e.az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 1e-12 ? ((x - e.ax) * dx + (z - e.az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = e.ax + dx * t - x, pz = e.az + dz * t - z;
  return { t, lateral: Math.hypot(px, pz) };
}

/** Candidate rejection: null = placeable; 'water' | 'carriageway' | 'skirt'.
 *  - 'carriageway': inside a carriageway + curb margin;
 *  - 'skirt': outside every road footprint but under the stepped terrace of a raised road deck — the terrain
 *    there is 0.4-2.8 m under the visible embankment surface (fix round 2: these used to be buried props);
 *  - 'water': the cell is water (props on the sea bed render under the water plate). */
function roadBlock(x, z) {
  const cell = S.ctx.world.cellAtWorld?.(x, z);
  if (cell && cell.type === 'water') return 'water';
  const seaLevel = Number.isFinite(S.ctx.world.seaLevel) ? S.ctx.world.seaLevel : 0;
  if (groundY(x, z) < seaLevel - 0.05) return 'water'; // below sea level: the water plate renders over it
  const snap = roadSnapshot();
  let insideFootprint = false;
  for (const e of snap) {
    const { lateral } = projectTo(e, x, z);
    if (lateral < e.half) return 'carriageway';
    if (lateral <= e.fp) insideFootprint = true;
  }
  if (insideFootprint) return null; // stands on a road/verge plate (its height comes from resolveHeight)
  const ground = groundY(x, z);
  for (const e of snap) {
    const { t, lateral } = projectTo(e, x, z);
    const outside = lateral - e.fp;
    if (outside <= 0) continue;
    const steps = Math.ceil(outside / TERRACE_RUN);
    if (steps > TERRACE_MAX_STEPS) continue;
    // Best-effort deck estimate: the node bed lerp and the *current* terrain under the projection (buildProfile
    // follows the max terrain under the footprint, so the max of the two is the conservative choice). The exact
    // plate is re-checked in settleDetail(), which removes anything this heuristic misses.
    const plate = Math.max(e.ay + (e.by - e.ay) * t, groundY(e.ax + (e.bx - e.ax) * t, e.az + (e.bz - e.az) * t)) + PLATE_TOP;
    if (plate - ground <= TERRACE_STEP) continue;   // deck not meaningfully above the terrain -> no skirt
    const skirt = plate - TERRACE_STEP * steps;
    if (ground < skirt - 0.1) return 'skirt';
  }
  return null;
}

/** Nearest snapshot edge whose footprint contains (x,z) — the point may sit on a wider road's plate even when a
 * narrow path's centreline is closer (fix round 2: the old nearest-centreline rule buried those props). */
function containingEdge(x, z) {
  const snap = roadSnapshot();
  let best = null;
  for (const e of snap) {
    const { t, lateral } = projectTo(e, x, z);
    if (lateral > e.fp) continue;
    const score = lateral / Math.max(0.1, e.fp);
    if (!best || score < best.score) best = { e, t, lateral, score };
  }
  return best;
}

/** Terrain surface fallback for a spot that is not next to a road. */
function groundY(x, z) {
  const terrain = S.ctx.modules.get('terrain');
  if (terrain?.status === 'ok' && typeof terrain.api.surfaceHeight === 'function') {
    const h = terrain.api.surfaceHeight(x, z);
    if (Number.isFinite(h)) return h;
  }
  return S.ctx.world.getHeight(x, z);
}

function segmentDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  if (!(l2 > 1e-12)) return Math.hypot(px - ax, pz - az);
  let t = ((px - ax) * dx + (pz - az) * dz) / l2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}

/** A road added *after* the dressing (a later alley, park path or connector) can pave through a yard or raise a
 * terrace deck over props standing on the terrain beside it. Sweep the C2 props near the new edge (C2-only index,
 * O(road length)) and remove those the new edge now covers: on its carriageway, or buried under its stepped
 * terrace. Fix round 2 added the terrace case (props used to be left inside the embankment skirt). */
function sweepDetailNearEdge(edge) {
  const world = S.ctx.world;
  const na = world.roads.nodes.get(edge.a), nb = world.roads.nodes.get(edge.b);
  if (!na || !nb) return;
  const e = edgeSnapshot(edge, na, nb);
  const reach = e.fp + 3.0; // footprint edge + the first few terrace steps
  const seen = new Set();          // prop objects (no string-id hashing)
  const doomed = [];
  const steps = Math.max(1, Math.round(Math.hypot(nb.x - na.x, nb.z - na.z) / IDX));
  const r = Math.ceil(reach / IDX);
  for (let k = 0; k <= steps; k++) {
    const t = k / steps;
    const ix = Math.floor((na.x + (nb.x - na.x) * t) / IDX), iz = Math.floor((na.z + (nb.z - na.z) * t) / IDX);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const list = S.c2Idx.get(idxKey(ix + dx, iz + dz));
        if (!list) continue;
        for (const p of list) {
          if (seen.has(p)) continue;
          seen.add(p);
          if (segmentDist(p.x, p.z, na.x, na.z, nb.x, nb.z) > reach) continue;
          if (edgeBlocksProp(e, p.x, p.z)) doomed.push(p.id);
        }
      }
    }
  }
  for (const id of doomed) world.removeProp(id);
}

/** Snapshot entry for one live road edge (same shape as roadSnapshot() entries). */
function edgeSnapshot(edge, a, b) {
  const width = S.roadsApi?.roadWidth(edge.kind) ?? edge.width ?? 8;
  const footprint = (S.roadsApi?.footprintWidth ? S.roadsApi.footprintWidth(edge.kind) : width + 4) || width + 4;
  return {
    edgeId: edge.id, kind: edge.kind,
    ax: a.x, az: a.z, bx: b.x, bz: b.z,
    half: width / 2 + 0.4, fp: footprint / 2, ay: a.y, by: b.y,
  };
}

/** True when one edge's own surface covers the point: its carriageway (with curb margin), or its terrace skirt
 * where the deck is raised above the terrain (the terrain there is hidden). */
function edgeBlocksProp(e, x, z) {
  const { t, lateral } = projectTo(e, x, z);
  if (lateral < e.half) return true;
  const outside = lateral - e.fp;
  if (outside <= 0) return false;                 // inside the footprint: the plate is the visible surface
  const steps = Math.ceil(outside / TERRACE_RUN);
  if (steps > TERRACE_MAX_STEPS) return false;    // past the skirt: open terrain
  const plate = e.ay + (e.by - e.ay) * t + PLATE_TOP;
  const ground = groundY(x, z);
  if (plate - ground <= TERRACE_STEP) return false;
  return ground < plate - TERRACE_STEP * steps - 0.1;
}

/** A building added *after* the dressing (the row-major block fillments can claim a neighbour's band) must not
 * keep yard props inside its own footprint. Only C2-owned props are swept (via the C2-only index). */
function sweepDetailInFootprint(b) {
  const world = S.ctx.world;
  const bb = buildingBounds(b);
  const ix0 = Math.floor((bb.minX - IDX) / IDX), ix1 = Math.floor((bb.maxX + IDX) / IDX);
  const iz0 = Math.floor((bb.minZ - IDX) / IDX), iz1 = Math.floor((bb.maxZ + IDX) / IDX);
  const seen = new Set();
  const doomed = [];
  for (let iz = iz0; iz <= iz1; iz++) {
    for (let ix = ix0; ix <= ix1; ix++) {
      const list = S.c2Idx.get(idxKey(ix, iz));
      if (!list) continue;
      for (const p of list) {
        if (seen.has(p)) continue;
        seen.add(p);
        if (p.x > bb.minX - 0.3 && p.x < bb.maxX + 0.3 && p.z > bb.minZ - 0.3 && p.z < bb.maxZ + 0.3) doomed.push(p.id);
      }
    }
  }
  for (const id of doomed) world.removeProp(id);
}

const placer = {
  add(kind, x, z, rot = 0) {
    if (S.c2Off) return null;
    if (!KIND_SET.has(kind)) return null;
    if (kind === 'figure' && S.figureCount >= FIGURE_CAP) return null;
    if (!placementFree(kind, x, z)) return null;
    const y = groundY(x, z);
    if (!Number.isFinite(y)) return null;
    // Content-derived id: never consumes world._ids.prop, so pre-existing props keep their pre-C2 ids (and
    // therefore their per-instance variation), and the id is stable across sessions and restages.
    const id = `${C2_ID_PREFIX}${kind}:${x.toFixed(2)}:${z.toFixed(2)}`;
    if (S.ctx.world.props.has(id)) return null;
    S.ctx.world.addProp({ id, x, y, z, rot, kind });
    if (kind === 'figure') S.figureCount++;
    return id;
  },
};

/** Building kind as the generator sees it. `b.kind` is written by `buildings`' own building:spawned listener,
 * which (init order 40 < 45) always runs before ours; the zone/level derivation is only a fallback for worlds
 * staged without that module loaded. */
function buildingKind(b) {
  if (b.kind && b.kind !== 'generic') return b.kind;
  if (b.zone === 'r') return b.level >= 3 ? 'tower' : b.level === 2 ? 'apartment' : 'house';
  if (b.zone === 'c') return b.level >= 3 ? 'tower-office' : b.level === 2 ? 'office' : 'shop';
  if (b.zone === 'i') return 'warehouse';
  return null;
}

/** The whole C2 dressing pass for one building: yard items (house/apartment/shop), civic entrance life, crates
 * at service backs. Idempotent per building id; returns the created prop ids (tracked for removal). */
function addDetailForBuilding(b) {
  const known = S.yardByBuilding.get(b.id);
  if (known) return known;
  const t0 = performance.now();
  const kind = buildingKind(b);
  const ids = [];
  if (kind && !S.c2Off) {
    if (YARD_KINDS.has(kind)) ids.push(...populateYard(S.ctx, S.rng, b, placer));
    if (CIVIC_KINDS.has(kind)) {
      ids.push(...populateCivicEntrance(S.ctx, S.rng, b, placer));
      ids.push(...populateServiceBack(S.ctx, S.rng, b, placer));
    }
    if (SERVICE_KINDS.has(kind)) ids.push(...populateServiceBack(S.ctx, S.rng, b, placer));
  }
  S.yardByBuilding.set(b.id, tagProps(ids, 'yardOf', b.id));
  S.detailMs = (S.detailMs || 0) + (performance.now() - t0);
  return ids;
}

/** Fix rounds 1+2: re-resolve every C2-owned prop against the *finished* terrain/roads and drop props that
 * cannot stand on a valid surface. Heights come from `surfaceProbe` (road plate only inside a road footprint,
 * terrain elsewhere); a prop whose best surface is below sea level or is hidden under a raised deck's terrace
 * skirt is removed rather than left floating/buried. Synchronous and deterministic; returns the number fixed.
 * Call it once the world stops moving: `demo` calls it after its seeding/warm-up (like `buildings.settle()`),
 * and `showcase()` calls it after staging. */
function settleDetail() {
  const world = S.ctx.world;
  settleSetPieces();
  if (S.c2Off) return 0;
  const t0 = performance.now();
  const seaLevel = Number.isFinite(world.seaLevel) ? world.seaLevel : 0;
  let fixed = 0, removed = 0;
  for (const p of [...world.props.values()]) {
    if (!isC2Prop(p)) continue;
    const probe = surfaceProbe(p.x, p.z);
    if (buriedUnderRoadDeck(p.x, p.z)) { world.removeProp(p.id); removed++; continue; }
    const y = probe.onRoad ? probe.y : resolveHeight(S.ctx, p.x, p.z);
    if (!Number.isFinite(y) || y < seaLevel - 0.05) { world.removeProp(p.id); removed++; continue; }
    if (Math.abs(y - p.y) > 0.02) { p.y = y; fixed++; }
  }
  if (fixed || removed) markDirty();
  // Repair pass (fix round 2): culling a buried/underwater prop must not leave a civic entrance empty — that is
  // the shot the closeup hero uses. Counts use the acceptance test's own rule (every prop within 14 m of the +z
  // entrance point); the repair places through a wider deterministic fan (2.2-12.5 m, +/-77 deg) via the placer,
  // so it can use any valid spot in the entrance radius when the whole strip is unusable.
  let toppedUp = 0;
  if (removed) {
    const cs = world.cellSize;
    const menu = ['bench', 'flower_bed', 'bike', 'crate_stack', 'trash_bin'];
    for (const [id, ids] of S.yardByBuilding) {
      const b = world.buildings.get(id);
      if (!b || !CIVIC_KINDS.has(buildingKind(b))) continue;
      const cx0 = world.minX + (b.i + b.w / 2) * cs;
      const ez0 = world.minZ + (b.j + b.d) * cs;
      // Count exactly like the acceptance test does: every prop within 14 m of the +z entrance point.
      let figs = 0, cluster = 0;
      for (const p of world.props.values()) {
        if (Math.hypot(p.x - cx0, p.z - ez0) >= 14) continue;
        if (p.kind === 'figure') figs++; else cluster++;
      }
      let needFigs = Math.max(0, 1 - figs);
      let needItems = Math.max(0, 2 - cluster);
      if (!needFigs && !needItems) continue;
      const prng = S.rng.fork(`civic-repair:${id}`);
      const cx = cx0, ez = ez0;
      let added = 0;
      for (let a = 0; a < 48 && (needFigs || needItems); a++) {
        const dist = prng.range(2.2, 12.5);
        const ang = prng.range(-1.35, 1.35);
        const px = cx + Math.sin(ang) * dist, pz = ez + Math.cos(ang) * dist;
        const want = needFigs > 0 && (needItems === 0 || prng.chance(0.55)) ? 'figure' : prng.pick(menu);
        if (buriedUnderRoadDeck(px, pz)) continue; // exact test: never repair into an embankment skirt
        const pid = placer.add(want, px, pz, prng.range(0, Math.PI * 2));
        if (!pid) continue;
        ids.push(pid);
        tagProps([pid], 'yardOf', id);
        added++;
        if (want === 'figure') needFigs--; else needItems--;
      }
      if (added) toppedUp++;
    }
  }
  S.detailSettle = { fixed, removed, toppedUp, ms: Math.round((performance.now() - t0) * 10) / 10 };
  S.detailSettledOnce = true;
  return fixed;
}

/** Exact terrace-cover test across *every* nearby road (not just the nearest one): a prop can be hidden under
 * a wider road's skirt while a narrow path's centreline is closer (fix round 2, the last residual burial). Uses
 * roads.api.snapToRoad at each candidate edge's projection for the exact deck profile. */
function buriedUnderRoadDeck(x, z) {
  const roads = S.ctx.modules.get('roads');
  if (!(roads?.status === 'ok' && typeof roads.api.snapToRoad === 'function')) return false;
  const snap = roadSnapshot();
  const ground = groundY(x, z);
  for (const e of snap) {
    const { t, lateral } = projectTo(e, x, z);
    if (lateral <= e.fp) return false;                                   // stands on a footprint plate
    if (lateral - e.fp > TERRACE_MAX_STEPS * TERRACE_RUN) continue;      // past the skirt
    const px = e.ax + (e.bx - e.ax) * t, pz = e.az + (e.bz - e.az) * t;
    const s = roads.api.snapToRoad(px, pz, 3);
    if (!s) continue;
    if (skirtCovers(lateral, e.fp, s.y + PLATE_TOP, ground)) return true;
  }
  return false;
}

function onBuildingSpawned({ building }) {
  if (S.replaying) { indexBuilding(building); return; } // the save carries this building's yard props
  if (S.setPieces.size) sweepSetPiecesForBuilding(building); // a lot claimed over a set-piece demolishes it
  indexBuilding(building);
  sweepDetailInFootprint(building); // a later lot row can claim a former neighbour's yard band
  addDetailForBuilding(building);
}

function onBuildingRemoved({ building }) {
  unindexBuilding(building);
  const ids = S.yardByBuilding.get(building.id);
  if (ids) {
    for (const id of ids) S.ctx.world.removeProp(id);
    S.yardByBuilding.delete(building.id);
  }
}

/** Pedestrian walk of one street/avenue edge (idempotent per edge id; the figure cap lives in the placer). */
function populatePedestriansForEdge(edgeId) {
  if (S.pedEdges.has(edgeId)) return [];
  const edge = S.ctx.world.roads.edges.get(edgeId);
  if (!edge) return [];
  S.pedEdges.add(edgeId);
  return tagProps(populatePedestrians(S.ctx, S.rng, edgeId, placer), 'edgeId', edgeId);
}

/** Rebuild the C2 spatial indexes from the world (init, and again after a showcase clearContent()). */
function rebuildIndexes() {
  S.pIdx.clear();
  S.c2Idx.clear();
  S.bIdx.clear();
  S.roadSnapDirty = true;
  S.figureCount = 0;
  for (const p of S.ctx.world.props.values()) {
    indexProp(p);
    if (isFigureKind(p.kind)) S.figureCount++;
  }
  for (const b of S.ctx.world.buildings.values()) indexBuilding(b);
}

function fadeFactor(d) {
  if (d <= LOD_NEAR) return 1;
  if (d >= LOD_FAR) return 0.02;
  const t = (d - LOD_NEAR) / (LOD_FAR - LOD_NEAR);
  return 1 - t * 0.98;
}

// Sidewalk top sits ~0.19 m above the lane-height snapToRoad() returns (roads/network.js Y.sidewalk - Y.lane);
// every prop kind we place is sidewalk/verge furniture, never on the carriageway itself, so lift by that much.
const SIDEWALK_LIFT = 0.19;

/**
 * Rendered ground height at (x, z). Fix round 2: the road/sidewalk plate is used **only when the point actually
 * lies inside a road's footprint** (`roads.api.footprintWidth(kind) / 2` lateral distance from a centreline) —
 * the old rule snapped to the nearest centreline within 6 m even when the prop stood on the terrain beside a
 * raised road deck, which lifted/buried props along embankments and terraces. When the *nearest* centreline is a
 * narrow path but a wider road's plate covers the point, the containing edge is found in the local road snapshot
 * and its exact profile is read by snapping from the projected centreline point. Off every footprint the
 * terrain's rendered (plate-quantized) surface wins; the 0.19 m sidewalk lift applies only inside a footprint.
 */
function resolveHeight(ctx, x, z) {
  const probe = surfaceProbe(x, z);
  if (probe.y !== null) return probe.y;
  const terrain = ctx.modules.get('terrain');
  if (terrain?.status === 'ok' && typeof terrain.api.surfaceHeight === 'function') {
    const h = terrain.api.surfaceHeight(x, z);
    if (Number.isFinite(h)) return h;
  }
  return ctx.world.getHeight(x, z);
}

/**
 * Rendered surface probe at (x, z) — the single source of truth for heights and for `settleDetail`'s
 * burial test. Returns:
 *   { y, onRoad: true }                          the point stands on a road/sidewalk plate (exact profile);
 *   { y: null, onRoad: false, plate, lateral, fp } the point is off every footprint; `plate` is the nearest
 *                                                edge's exact plate top (for the terrace-cover test);
 *   { y: null, onRoad: false }                   no road anywhere near (plain terrain).
 * "Inside the footprint" is tested against the roads module's own `footprintWidth`, so the old nearest-centreline
 * rule can no longer hand a terrain spot the height of a road deck 3-6 m away.
 */
function surfaceProbe(x, z) {
  const roads = S.ctx.modules.get('roads');
  if (!(roads?.status === 'ok' && typeof roads.api.snapToRoad === 'function')) return { y: null, onRoad: false };
  const s = roads.api.snapToRoad(x, z, 24);
  if (!s) return { y: null, onRoad: false };
  const kind = S.ctx.world.roads.edges.get(s.edgeId)?.kind;
  const footprint = typeof roads.api.footprintWidth === 'function' ? roads.api.footprintWidth(kind) : 0;
  const fp = Number.isFinite(footprint) ? footprint / 2 : 0;
  if (s.dist <= fp) return { y: s.y + SIDEWALK_LIFT, onRoad: true, edgeId: s.edgeId };
  // The nearest centreline is a narrow path while a wider road's plate may still cover the point; if so, read
  // that edge's exact profile by snapping from the projected centreline point.
  const best = containingEdge(x, z);
  if (best) {
    const dx = best.e.bx - best.e.ax, dz = best.e.bz - best.e.az;
    const px = best.e.ax + dx * best.t, pz = best.e.az + dz * best.t;
    const s2 = roads.api.snapToRoad(px, pz, 3);
    if (s2) return { y: s2.y + SIDEWALK_LIFT, onRoad: true, edgeId: s2.edgeId };
  }
  return { y: null, onRoad: false, plate: s.y + PLATE_TOP, lateral: s.dist, fp };
}

/** Terrace-cover test (roads/geometry.js addTerraces: one 0.4 m plate per 0.8 m run outward from the footprint
 * edge, each step built only while the plate is >= 0.4 m above the terrain). The point is hidden when the terrain
 * under it is below the skirt's surface. `plate`/`lateral` come from the exact road profile, so this works on
 * raised embankment decks. Props whose whole lot sits within one plate step of the deck are left alone (a
 * one-step tolerance here removed ~35 % of the dressing for no mesh-truth gain). */
function skirtCovers(lateral, fp, plate, ground) {
  const outside = lateral - fp;
  if (outside <= 0) return false;
  const steps = Math.ceil(outside / TERRACE_RUN);
  if (steps > TERRACE_MAX_STEPS) return false;
  if (plate - ground <= TERRACE_STEP) return false;
  return ground < plate - TERRACE_STEP * steps - 0.1;
}

function markDirty() { S.dirty = true; S.lastEvent = performance.now(); }

// ---- LOOP cycle 5: authored hero set-pieces ------------------------------------------------------------------
/** World -> set-piece-local (u right, v front). */
function spLocal(e, x, z) {
  const dx = x - e.x, dz = z - e.z, c = Math.cos(e.rot), s = Math.sin(e.rot);
  return { u: dx * c - dz * s, v: dx * s + dz * c };
}
function spWorld(e, u, v) {
  const c = Math.cos(e.rot), s = Math.sin(e.rot);
  return { x: e.x + u * c + v * s, z: e.z - u * s + v * c };
}
/** The set-piece whose (margin-expanded) rect contains (x,z), or null. */
function setPieceAt(x, z, margin = 0) {
  for (const e of S.setPieces.values()) {
    const { u, v } = spLocal(e, x, z);
    if (Math.abs(u) <= e.w / 2 + margin && Math.abs(v) <= e.d / 2 + margin) return e;
  }
  return null;
}
/** Terrain range under a rect (2 m sample grid incl. the edges): { min, max }. */
function spGroundRange(e) {
  let min = Infinity, max = -Infinity;
  const nu = Math.max(2, Math.ceil(e.w / 2)), nv = Math.max(2, Math.ceil(e.d / 2));
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      const p = spWorld(e, -e.w / 2 + (i / nu) * e.w, -e.d / 2 + (j / nv) * e.d);
      const g = groundY(p.x, p.z);
      if (!Number.isFinite(g)) continue;
      if (g < min) min = g;
      if (g > max) max = g;
    }
  }
  return { min: Number.isFinite(min) ? min : 0, max: Number.isFinite(max) ? max : 0 };
}
function spCorners(e) {
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => spWorld(e, (a * e.w) / 2, (b * e.d) / 2));
}
/** Separating-axis overlap of the set-piece rect and an axis-aligned box (building footprint). */
function spOverlapsAabb(e, bb, margin = 0) {
  const A = spCorners(e);
  const B = [{ x: bb.minX - margin, z: bb.minZ - margin }, { x: bb.maxX + margin, z: bb.minZ - margin },
    { x: bb.maxX + margin, z: bb.maxZ + margin }, { x: bb.minX - margin, z: bb.maxZ + margin }];
  const c = Math.cos(e.rot), s = Math.sin(e.rot);
  for (const [ax, az] of [[1, 0], [0, 1], [c, -s], [s, c]]) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const t = p.x * ax + p.z * az; a0 = Math.min(a0, t); a1 = Math.max(a1, t); }
    for (const p of B) { const t = p.x * ax + p.z * az; b0 = Math.min(b0, t); b1 = Math.max(b1, t); }
    if (a1 <= b0 || b1 <= a0) return false;
  }
  return true;
}
/** Does a road edge's rendered footprint touch the set-piece rect? (1 m samples along the centreline.) */
function spTouchesEdge(e, edge) {
  const world = S.ctx.world;
  const na = world.roads.nodes.get(edge.a), nb = world.roads.nodes.get(edge.b);
  if (!na || !nb) return false;
  const snap = edgeSnapshot(edge, na, nb);
  const len = Math.hypot(nb.x - na.x, nb.z - na.z);
  const n = Math.max(1, Math.ceil(len));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const { u, v } = spLocal(e, na.x + (nb.x - na.x) * t, na.z + (nb.z - na.z) * t);
    const du = Math.max(0, Math.abs(u) - e.w / 2), dv = Math.max(0, Math.abs(v) - e.d / 2);
    if (Math.hypot(du, dv) < snap.fp) return true;
  }
  return false;
}
/** Why a set-piece cannot sit at this rect: building footprints, road footprints, water. [] = free. */
/** Cells whose 8 m square overlaps the (margin-expanded) set-piece rect: [{ i, j, cell }]. */
function spCells(e, margin = 0) {
  const world = S.ctx.world, cs = world.cellSize;
  const ex = { ...e, w: e.w + 2 * margin, d: e.d + 2 * margin };
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of spCorners(ex)) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const out = [];
  const i0 = Math.floor((x0 - world.minX) / cs), i1 = Math.floor((x1 - world.minX) / cs);
  const j0 = Math.floor((z0 - world.minZ) / cs), j1 = Math.floor((z1 - world.minZ) / cs);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const cell = world.cellAt(i, j);
      if (!cell) continue;
      const bb = { minX: world.minX + i * cs, maxX: world.minX + (i + 1) * cs, minZ: world.minZ + j * cs, maxZ: world.minZ + (j + 1) * cs };
      if (spOverlapsAabb(ex, bb)) out.push({ i, j, cell });
    }
  }
  return out;
}
/** Why a set-piece cannot sit at this rect. [] = free. Reported (fix round 1):
 *  - `zone:i,j`      any zoned cell (cell.zone set): its zoning-overlay plate would render through the deck, and a
 *                    building grown there would demolish the set-piece;
 *  - `cell:<type>:i,j` road (verge/sidewalk), water or building cells;
 *  - `building:<id>`, `road:<edgeId>` footprint overlaps, and `water` for below-sea-level ground.
 *  `margin` (metres) grows the rect for every test, so a caller can demand e.g. a 1-cell (8 m) clearance. */
function setPieceBlockers(e, margin = 0) {
  const world = S.ctx.world;
  const ex = margin > 0 ? { ...e, w: e.w + 2 * margin, d: e.d + 2 * margin } : e;
  const out = [];
  for (const { i, j, cell } of spCells(e, margin)) {
    if (cell.zone) out.push(`zone:${i},${j}`);
    if (cell.type === 'road' || cell.type === 'water' || cell.type === 'building') out.push(`cell:${cell.type}:${i},${j}`);
  }
  for (const b of world.buildings.values()) if (spOverlapsAabb(ex, buildingBounds(b))) out.push(`building:${b.id}`);
  for (const edge of world.roads.edges.values()) if (spTouchesEdge(ex, edge)) out.push(`road:${edge.id}`);
  const nu = Math.max(2, Math.ceil(ex.w / 4)), nv = Math.max(2, Math.ceil(ex.d / 4));
  const seaLevel = Number.isFinite(world.seaLevel) ? world.seaLevel : 0;
  let water = false;
  for (let j = 0; j <= nv && !water; j++) {
    for (let i = 0; i <= nu && !water; i++) {
      const p = spWorld(ex, -ex.w / 2 + (i / nu) * ex.w, -ex.d / 2 + (j / nv) * ex.d);
      if (groundY(p.x, p.z) < seaLevel - 0.05) water = true;
    }
  }
  if (water) out.push('water');
  return out;
}
/** A cell zoned after placement (a player painting zones over the lot) would put its overlay plate through the
 * deck and later grow a building there: treat it like a road/building claim and demolish the set-piece. */
function sweepSetPiecesForZone(i, j) {
  const world = S.ctx.world, cs = world.cellSize;
  const bb = { minX: world.minX + i * cs, maxX: world.minX + (i + 1) * cs, minZ: world.minZ + j * cs, maxZ: world.minZ + (j + 1) * cs };
  for (const e of [...S.setPieces.values()]) if (spOverlapsAabb(e, bb)) removeSetPiece(e.id, `demolished by zoning cell ${i},${j}`);
}
function spPublic(e) {
  return {
    type: e.type, id: e.id, x: e.x, z: e.z, rot: e.rot, w: e.w, d: e.d, deckY: e.deckY,
    hero: e.hero, heroAlt: e.heroAlt, counts: e.counts ? { ...e.counts, kinds: { ...e.counts.kinds } } : null,
  };
}

function placeSetPiece(spec = {}) {
  if (S.spOff || !spec) return null;
  const world = S.ctx.world;
  const type = spec.type;
  if (!SP_TYPES.includes(type)) { S.ctx.error(`[props] placeSetPiece: unknown type "${type}"`); return null; }
  const id = String(spec.id ?? `${type}-${S.setPieces.size}`);
  if (S.setPieces.has(id)) return spPublic(S.setPieces.get(id)); // idempotent per id
  const x = Number(spec.x), z = Number(spec.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) { S.ctx.error(`[props] placeSetPiece "${id}": x/z required`); return null; }
  const { w, d } = clampSize(type, Number(spec.w), Number(spec.d));
  const e = {
    type, id, x, z, rot: Number(spec.rot) || 0, w, d, deckY: 0, drop: 0.4,
    fixedDeck: Number.isFinite(spec.deckY), props: [], hero: null, heroAlt: null, counts: null,
  };
  const blockers = spec.force ? [] : setPieceBlockers(e, Math.max(0, Number(spec.margin) || 0));
  if (blockers.length) {
    S.ctx.log(`[props] placeSetPiece "${id}" refused: ${blockers.slice(0, 6).join(', ')}${blockers.length > 6 ? ' ...' : ''}`);
    return null;
  }
  const g = spGroundRange(e);
  e.deckY = e.fixedDeck ? Number(spec.deckY) : g.max + SP_DECK_RAISE;
  e.drop = Math.max(0.3, e.deckY - g.min + 0.15);
  // Clear whatever already stands on the rect (park scatter, yard dressing): it would poke through the deck.
  let cleared = 0;
  for (const p of [...world.props.values()]) {
    if (isSpProp(p)) continue;
    const { u, v } = spLocal(e, p.x, p.z);
    if (Math.abs(u) <= w / 2 + 0.3 && Math.abs(v) <= d / 2 + 0.3) { world.removeProp(p.id); cleared++; }
  }
  // Register before adding props so the prop:added evict hook and the C2 placer already see the rect.
  S.setPieces.set(id, e);
  const prng = S.rng.fork(`sp:${id}`);
  const plan = authorSetPiece(type, w, d, prng);
  const used = new Set();
  const addSp = (rec) => {
    const base = `${SP_ID_PREFIX}${id}:${rec.kind}:${rec.x.toFixed(2)}:${rec.z.toFixed(2)}`;
    let pid = base;
    for (let n = 2; used.has(pid) || world.props.has(pid); n++) pid = `${base}:${n}`;
    used.add(pid);
    world.addProp({ ...rec, id: pid });
    e.props.push(pid);
    return pid;
  };
  S.spPlacing = true;
  addSp({
    kind: 'sp_deck', x, y: e.deckY, z, rot: e.rot, sp: id, lift: 0, w, d, style: plan.style, pitch: plan.pitch,
    zones: plan.zones, drop: e.drop, spType: type, spFixed: e.fixedDeck, // spType/spFixed: registry rebuild on load
  });
  const counts = { props: 1, figures: 0, skippedFigures: 0, cleared, kinds: { sp_deck: 1 } };
  for (const it of plan.items) {
    if (!KIND_SET.has(it.kind)) continue;
    if (isFigureKind(it.kind)) {
      if (S.figureCount >= FIGURE_CAP) { counts.skippedFigures++; continue; }
      counts.figures++;
    }
    const { kind, u, v, r, lift, ...fields } = it;
    const p = spWorld(e, u, v);
    // (prop:added -> indexProp does not count figures; the cap counter is kept here and in prop:removed)
    if (isFigureKind(kind)) S.figureCount++;
    addSp({ ...fields, kind, x: p.x, y: e.deckY + (lift || 0), z: p.z, rot: e.rot + (r || 0), sp: id, lift: lift || 0 });
    counts.props++;
    counts.kinds[kind] = (counts.kinds[kind] || 0) + 1;
  }
  S.spPlacing = false;
  e.counts = counts;
  e.hero = heroCamera(e, 1);
  e.heroAlt = heroCamera(e, -1);
  markDirty();
  return spPublic(e);
}

/** A set-piece prop arriving from outside placeSetPiece() (a save file being applied): rebuild the registry entry
 * from its deck record (kind 'sp_deck' carries type/rect/fixed-deck) and adopt the props that follow it. */
function spAdopt(p) {
  let e = S.setPieces.get(p.sp);
  if (!e) {
    if (p.kind !== 'sp_deck' || !SP_TYPES.includes(p.spType) || !(p.w > 0) || !(p.d > 0)) return;
    e = {
      type: p.spType, id: p.sp, x: p.x, z: p.z, rot: p.rot || 0, w: p.w, d: p.d, deckY: p.y, drop: p.drop || 0.4,
      fixedDeck: !!p.spFixed, props: [], hero: null, heroAlt: null,
      counts: { props: 0, figures: 0, skippedFigures: 0, cleared: 0, kinds: {} },
    };
    S.setPieces.set(e.id, e);
    e.hero = heroCamera(e, 1);
    e.heroAlt = heroCamera(e, -1);
  }
  if (e.props.includes(p.id)) return;
  e.props.push(p.id);
  e.counts.props++;
  e.counts.kinds[p.kind] = (e.counts.kinds[p.kind] || 0) + 1;
  if (isFigureKind(p.kind)) { e.counts.figures++; S.figureCount++; }
}

function removeSetPiece(id, why = 'removed') {
  const e = S.setPieces.get(id);
  if (!e) return false;
  S.setPieces.delete(id);
  for (const pid of e.props) S.ctx.world.removeProp(pid);
  S.ctx.log(`[props] set-piece "${id}" ${why}`);
  markDirty();
  return true;
}

/** Deck Y for every set-piece (auto decks follow the finished terrain) and every sp: prop at deckY + lift -
 * never snapped to the terrain/road surface. Runs inside settleDetail() (also with ?noc2=1). */
function settleSetPieces() {
  if (!S.setPieces.size) { S.spSettle = { pieces: 0, fixed: 0 }; return 0; }
  const world = S.ctx.world;
  let fixed = 0;
  for (const e of S.setPieces.values()) {
    const g = spGroundRange(e);
    if (!e.fixedDeck) e.deckY = g.max + SP_DECK_RAISE;
    e.drop = Math.max(0.3, e.deckY - g.min + 0.15);
    for (const pid of e.props) {
      const p = world.props.get(pid);
      if (!p) continue;
      const y = e.deckY + (p.lift || 0);
      if (Math.abs(p.y - y) > 1e-4) { p.y = y; fixed++; }
      if (p.kind === 'sp_deck' && Math.abs((p.drop || 0) - e.drop) > 1e-4) { p.drop = e.drop; fixed++; }
    }
    e.hero = heroCamera(e, 1);
    e.heroAlt = heroCamera(e, -1);
  }
  if (fixed) markDirty();
  S.spSettle = { pieces: S.setPieces.size, fixed };
  return fixed;
}

function sweepSetPiecesForBuilding(b) {
  const bb = buildingBounds(b);
  for (const e of [...S.setPieces.values()]) if (spOverlapsAabb(e, bb)) removeSetPiece(e.id, `demolished by building ${b.id}`);
}
function sweepSetPiecesForEdge(edge) {
  for (const e of [...S.setPieces.values()]) if (spTouchesEdge(e, edge)) removeSetPiece(e.id, `demolished by road ${edge.id}`);
}

/** Sun-side hero for a set-piece: of the two mirrored 3/4 heroes, the one whose camera sits more toward the sun. */
function sunSideHero(e, clock) {
  const sun = clock?.sunDir;
  if (!sun) return e.hero;
  const score = (h) => {
    const dx = h.pos[0] - h.target[0], dz = h.pos[2] - h.target[2];
    const l = Math.hypot(dx, dz) || 1;
    return (dx * sun.x + dz * sun.z) / l;
  };
  return score(e.heroAlt) > score(e.hero) + 1e-3 ? e.heroAlt : e.hero;
}
const SP_PRESETS = {};
for (const type of SP_TYPES) {
  SP_PRESETS[`props:sp-${type}`] = (world, clock) => {
    const e = [...S.setPieces.values()].find((p) => p.type === type);
    if (!e) {
      const y = world.getHeight(0, 0);
      return { pos: [30, y + 20, 30], target: [0, y, 0], fov: 50 };
    }
    return sunSideHero(e, clock);
  };
}

// Flower heads are per-instance-scattered stem+bloom props (kinds.js 'flowerbed-flower' role), pushed straight
// into the same role buckets as every other part so they render as a real InstancedMesh, not flat stud chips.
function addFlowerHeads(base, prng, buckets, ctx) {
  const list = buckets.get('flowerbed-flower');
  if (!list) return;
  const n = prng.int(5, 9);
  for (let k = 0; k < n; k++) {
    const a = prng.range(0, Math.PI * 2), r = prng.range(0.1, 0.42);
    const ry = prng.range(0, Math.PI * 2);
    const s = prng.range(0.85, 1.2);
    const local = mat(Math.cos(a) * r, 0.26, Math.sin(a) * r, 0, ry, 0, s, s, s);
    const world4 = new THREE.Matrix4().multiplyMatrices(base, local);
    const pos = new THREE.Vector3().setFromMatrixPosition(world4);
    list.push({ pos, base: world4, color: ctx.materials.color(prng.pick(FLOWER_COLORS)) });
  }
}

function disposeFountainFx(f) { S.group.remove(f.points); f.geometry.dispose(); }

function addFountainFx(prop) {
  const N = 30;
  const positions = new Float32Array(N * 3);
  const phases = new Float32Array(N);
  for (let k = 0; k < N; k++) phases[k] = (k / N) * Math.PI * 2;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, S.waterMat);
  points.name = 'props-fountain-spray';
  points.frustumCulled = false;
  S.group.add(points);
  S.fountains.push({ points, geometry, phases, basePos: { x: prop.x, y: prop.y, z: prop.z } });
}

function updateFountains(dt) {
  S.time += dt;
  for (const f of S.fountains) {
    const arr = f.geometry.attributes.position.array;
    for (let k = 0; k < f.phases.length; k++) {
      const ph = f.phases[k];
      const cycle = (S.time * 0.55 + ph / (Math.PI * 2)) % 1;
      const h = cycle * 1.3;
      const r = 0.22 * (1 - cycle * 0.8);
      const ang = ph + S.time * 0.4;
      arr[k * 3 + 0] = f.basePos.x + Math.cos(ang) * r;
      arr[k * 3 + 1] = f.basePos.y + FOUNTAIN_WATER_Y + h;
      arr[k * 3 + 2] = f.basePos.z + Math.sin(ang) * r;
    }
    f.geometry.attributes.position.needsUpdate = true;
  }
}

function rebuild() {
  const ctx = S.ctx, world = ctx.world;
  const buckets = new Map();
  for (const role of S.roleTable.keys()) buckets.set(role, []);
  for (const f of S.fountains) disposeFountainFx(f);
  S.fountains.length = 0;

  for (const prop of world.props.values()) {
    if (!KIND_SET.has(prop.kind)) continue;
    // Per-instance variation seed: kind+position for C2 props (stable even if ids churn and across restages),
    // the prop id for everything else (which C2 props never shift — see variationKey(), fix round issue 2).
    const prng = S.rng.fork(variationKey(prop));
    const base = mat(prop.x, prop.y, prop.z, 0, prop.rot || 0, 0);
    const parts = buildKindParts(prop.kind, prng, prop);
    // Tall set-piece landmarks (windmill/barn/silo) and the deck plates are exempt from the distance fade.
    const noFade = SP_NOFADE_KINDS.has(prop.kind);
    for (const part of parts) {
      const list = buckets.get(part.role);
      if (!list) continue;
      const world4 = part.local ? new THREE.Matrix4().multiplyMatrices(base, part.local) : base.clone();
      const pos = new THREE.Vector3().setFromMatrixPosition(world4);
      const color = part.color ? ctx.materials.color(part.color) : null;
      const inst = noFade ? { pos, base: world4, color, noFade } : { pos, base: world4, color };
      if (part.tile !== undefined) inst.tile = part.tile; // LOOP c6: print-atlas tile (sp-print role)
      list.push(inst);
    }
    if (prop.kind === 'flower_bed') addFlowerHeads(base, prng, buckets, ctx);
    if (prop.kind === 'fountain') addFountainFx(prop);
  }

  for (const [role, def] of S.roleTable) {
    if (def.mesh) { S.group.remove(def.mesh); def.mesh.dispose(); def.mesh = null; }
    const list = buckets.get(role);
    const n = list.length;
    const mesh = new THREE.InstancedMesh(def.geometry, def.material, Math.max(1, n));
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.castShadow = def.castShadow;
    mesh.receiveShadow = def.receiveShadow;
    mesh.frustumCulled = false; // instances are spread across the whole map; per-mesh culling would hide valid ones
    mesh.name = `props-${role}`;
    for (let k = 0; k < n; k++) {
      mesh.setMatrixAt(k, list[k].base);
      if (def.instanceColor) mesh.setColorAt(k, list[k].color || ctx.materials.color('white'));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (def.tiled) setTileAttribute(def.geometry, list);
    S.group.add(mesh);
    def.mesh = mesh;
  }
  S.roleInstances = buckets;

  S.dirty = false;
  applyLod(true);
  updateLightPool(true);
  ctx.log(`[props] rebuilt ${world.props.size} props across ${S.roleTable.size} roles`);
}

/** LOOP c6: per-instance atlas tile for the sp-print role. The geometry is shared by every rebuild's mesh, so the
 * attribute is kept and grown by doubling (never re-created per rebuild: a replaced attribute's GPU buffer is only
 * freed with the geometry). */
function setTileAttribute(geometry, list) {
  let attr = geometry.getAttribute('aTile');
  if (!attr || attr.count < list.length) {
    let cap = attr ? attr.count : 256;
    while (cap < list.length) cap *= 2;
    attr = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aTile', attr);
  }
  for (let k = 0; k < list.length; k++) attr.array[k] = list[k].tile || 0;
  attr.needsUpdate = true;
}

const _scaleM = new THREE.Matrix4();
const _outM = new THREE.Matrix4();
function applyLod(force) {
  const ctx = S.ctx;
  const camPos = ctx.camera.position;
  if (!force && S.camLast.distanceToSquared(camPos) < LOD_MOVE * LOD_MOVE) return;
  S.camLast.copy(camPos);
  for (const [role, def] of S.roleTable) {
    if (!def.mesh || !def.mesh.count) continue;
    const list = S.roleInstances.get(role);
    const exempt = FADE_EXEMPT(role);
    let changed = false;
    for (let k = 0; k < list.length; k++) {
      const inst = list[k];
      const f = exempt || inst.noFade ? 1 : fadeFactor(inst.pos.distanceTo(camPos));
      if (f >= 0.999) { def.mesh.setMatrixAt(k, inst.base); } else {
        _outM.copy(inst.base).multiply(_scaleM.makeScale(f, f, f));
        def.mesh.setMatrixAt(k, _outM);
      }
      changed = true;
    }
    if (changed) def.mesh.instanceMatrix.needsUpdate = true;
  }
}

function updateLightPool(force) {
  const ctx = S.ctx;
  const night = ctx.clock.isNight;
  if (!night) {
    if (S.wasLit) for (const l of S.lightPool) l.intensity = 0;
    S.wasLit = false;
    return;
  }
  if (!force && S.lightPoolTimer > 0) return;
  S.lightPoolTimer = LIGHT_REFRESH;
  S.wasLit = true;
  const camPos = ctx.camera.position;
  const lamps = [];
  for (const p of ctx.world.props.values()) if (p.kind === 'streetlamp') lamps.push(p);
  lamps.sort((a, b) => {
    const da = (a.x - camPos.x) ** 2 + (a.z - camPos.z) ** 2;
    const db = (b.x - camPos.x) ** 2 + (b.z - camPos.z) ** 2;
    return da - db;
  });
  for (let k = 0; k < LIGHT_POOL_SIZE; k++) {
    const l = S.lightPool[k];
    if (k < lamps.length) {
      const p = lamps[k];
      l.position.set(p.x, p.y + 4.6, p.z + 1.2);
      l.intensity = 7.5;
    } else l.intensity = 0;
  }
}

function applyNightMaterials(isNight) {
  const bulb = S.roleTable.get('lamp-bulb');
  if (bulb) bulb.material.emissiveIntensity = isNight ? bulb.dynamic.night : bulb.dynamic.day;
  // set-piece wheat: its warm emissive floor is a daylight colour fix only (materials.js) - dark at night
  const wheat = S.roleTable.get('sp-wheat');
  if (wheat) wheat.material.emissiveIntensity = isNight ? 0.0 : 0.55;
  S.trafficPhaseName = null; // re-apply the traffic lenses for the new day/night state
  // The lens state is applied here (not only on phase change): captures pause the clock, so props.update()
  // may never run between setTime() and the capture — boot/paused shots otherwise keep the boot lens state.
  applyLensState();
}

function applyLensState() {
  const night = S.ctx.clock.isNight;
  const phase = S.trafficPhaseName || 'green';
  for (const name of ['red', 'yellow', 'green']) {
    const role = S.roleTable.get(`trafficlight-lens-${name}`);
    if (!role) continue;
    const on = name === phase;
    role.material.emissiveIntensity = on ? (night ? role.dynamic.night : role.dynamic.day) : 0;
    // An "off" lens must read as dark glass, not a lit coloured disc: zero emissive alone still lets the
    // saturated plastic read as on (critic crop: all three aspects glowing).
    if (!role._baseColor) role._baseColor = role.material.color.clone();
    role.material.color.copy(role._baseColor).multiplyScalar(on ? 1 : 0.08);
  }
}

function updateTrafficPhase(dt) {
  S.trafficPhase = (S.trafficPhase + dt) % TRAFFIC_TOTAL;
  let t = S.trafficPhase, phase;
  if (t < TRAFFIC_CYCLE.green) phase = 'green';
  else if ((t -= TRAFFIC_CYCLE.green) < TRAFFIC_CYCLE.yellow) phase = 'yellow';
  else phase = 'red';
  if (phase === S.trafficPhaseName) return;
  S.trafficPhaseName = phase;
  applyLensState();
}

// ---- auto-population (full game only; showcase stages its own scenes explicitly) ---------------------------
function maybeSignalIntersections() {
  const ctx = S.ctx;
  const roads = ctx.modules.get('roads');
  if (roads?.status !== 'ok') return;
  for (const node of roads.api.getIntersections()) {
    if (node.arms.length < 3 || S.signaledNodes.has(node.nodeId)) continue;
    S.signaledNodes.add(node.nodeId);
    const ids = populateIntersectionNode(ctx, api.addProp, S.rng, roads.api, node);
    if (ids && ids.length) S.nodeSignalProps.set(node.nodeId, tagProps(ids, 'nodeId', node.nodeId));
  }
}

/** Re-place the signal props of the given nodes (their arm cross-sections changed, so the old props sit at the
 * wrong lateral offsets). Re-adds via maybeSignalIntersections() at the new widths. */
function respawnSignals(nodeIds) {
  let changed = false;
  for (const id of nodeIds) {
    const ids = S.nodeSignalProps.get(id);
    if (ids) { for (const pid of ids) S.ctx.world.removeProp(pid); S.nodeSignalProps.delete(id); }
    if (S.signaledNodes.delete(id)) changed = true;
  }
  if (changed) maybeSignalIntersections();
}

/** Lay one edge's street furniture (idempotent per edge id) and tag it with the edge. */
function furnishEdge(edgeId) {
  return tagProps(populateAlongRoad(S.ctx, api.addProp, S.rng, edgeId), 'edgeId', edgeId);
}

// Furniture kinds populateAlongRoad() lays down; only these are cleaned up on an in-place edit (traffic lights,
// bus stops and park furniture belong to other systems and must never be swept away by a road widening).
const EDGE_FURNITURE = new Set(['streetlamp', 'trash_bin', 'bench', 'road_sign']);

/** In-place road edit (drag-over upgrade / one-way conversion): kind or width changed, so the old street
 * furniture was derived from a cross-section that no longer exists. Remove it, re-lay it at the new offsets and
 * re-place the signals at the edited edges' nodes. Direction-only changes are a no-op (geometry is identical). */
function onRoadChanged({ edgeId, edge, prev }) {
  if (!edge || !prev || (prev.width === edge.width && prev.kind === edge.kind)) return;
  const world = S.ctx.world;
  const na = world.roads.nodes.get(edge.a), nb = world.roads.nodes.get(edge.b);
  if (!na || !nb) return;
  const reach = Math.max(prev.width, edge.width) / 2 + 2.4;
  for (const p of [...world.props.values()]) {
    if (!EDGE_FURNITURE.has(p.kind)) continue;
    if (segmentDist(p.x, p.z, na.x, na.z, nb.x, nb.z) <= reach) world.removeProp(p.id);
  }
  forgetEdge(edgeId);
  furnishEdge(edgeId);
  sweepDetailNearEdge(edge); // C2: the widened cross-section may now cover yard props
  if (S.setPieces.size) sweepSetPiecesForEdge(edge);
  respawnSignals([edge.a, edge.b]);
  if (S.detailSettledOnce) settleDetail(); // an in-place upgrade can also move the surface under C2 props
}

function onRoadAdded({ edgeId, edge, reason }) {
  // A 'path' (pedestrian, lanes: 0) edge is a park crossing or a service alley, not a real street — it gets no
  // streetlamps (populateAlongRoad) and never forms a vehicle-signalled intersection (maybeSignalIntersections),
  // so skip both. This isn't just cosmetic: every lamp placement resolves its height via roads.snapToRoad(), which
  // rebuilds the *entire* road network graph if dirty (which this same road:added event just made it) and then
  // linearly scans every edge in it — so on a city with hundreds of short path segments (e.g. the demo city's
  // interior alleys, added purely so every lot is road-adjacent — see src/demo/citygen.js's paveAlleyRow), that
  // cost was being paid per lamp, on every alley, and dominated generation time.
  if (S.replaying) return; // the save carries this road's furniture, figures and signals (see endReplay)
  const e = edge ?? S.ctx.world.roads.edges.get(edgeId);
  const kind = e?.kind;
  // C2: a road added after the dressing may have paved through a yard (alleys/parks/connectors are added in
  // later citygen phases than some districts' lots). Sweep only the C2-owned props that now sit on a carriageway.
  if (e) sweepDetailNearEdge(e);
  if (e && S.setPieces.size) sweepSetPiecesForEdge(e); // a road paved through a set-piece demolishes it
  if (kind === 'path') return;
  // A split/merge event is the core stitching an existing road into a junction: props already exist along that
  // line, so repopulating the halves would duplicate lamps near the new junction. Signals still need the new
  // node, so that pass always runs.
  if (reason !== 'split' && reason !== 'merge') {
    furnishEdge(edgeId);
    populatePedestriansForEdge(edgeId); // C2: figures on this edge's sidewalks
  }
  // A junction is signalled once, when its third arm arrives. In live play an arm added to an already signalled
  // junction (the fourth arm of a drawn crossing) re-places its lights for the new arm set on the next update.
  // Generation-time junctions are left as they were built, so the generated city is unchanged.
  if (S.live && e) for (const nid of [e.a, e.b]) if (S.signaledNodes.has(nid)) S.signalDirty.add(nid);
  maybeSignalIntersections();
  // Live play only (after the boot settle): a newly drawn/edited road can change the surface under already
  // settled C2 props (the same mechanism that used to leave levitating figures), so re-resolve once.
  if (S.detailSettledOnce && reason !== 'split' && reason !== 'merge') settleDetail();
}

/** A road the player (or anything else) removed takes its own furniture and sidewalk figures with it, and the
 * junctions at its ends get their signals re-placed for the arms that are left. Splits and merges are the core
 * re-stitching a road that is still there: its props stay, and their now-stale edge tag is resolved lazily here
 * (nearest live edge) the next time a neighbouring edge is removed. */
function onRoadRemoved({ edgeId, edge, reason }) {
  if (S.replaying || reason === 'split' || reason === 'merge' || !edge) return;
  const world = S.ctx.world;
  const na = world.roads.nodes.get(edge.a), nb = world.roads.nodes.get(edge.b);
  if (!na || !nb) return; // clearContent(): the graph (and every prop) is already gone
  forgetEdge(edgeId);
  S.pedEdges.delete(edgeId);
  S.signalDirty.add(edge.a); S.signalDirty.add(edge.b);
  const width = S.roadsApi?.roadWidth(edge.kind) ?? edge.width ?? 8;
  const fp = ((S.roadsApi?.footprintWidth ? S.roadsApi.footprintWidth(edge.kind) : width + 4) || width + 4) / 2;
  const reach = Math.max(fp, width / 2 + 1.4) + 1.2; // lamp / extra / figure lateral offsets (populate.js) + slack
  const doomed = [];
  for (const p of world.props.values()) {
    if (p.edgeId == null) continue;
    if (p.edgeId === edgeId) { doomed.push(p.id); continue; }
    if (world.roads.edges.has(p.edgeId)) continue;        // belongs to another live edge
    const d = segmentDist(p.x, p.z, na.x, na.z, nb.x, nb.z);
    if (d > reach) continue;
    const near = world.nearestRoad(p.x, p.z, d);            // a live edge at least as close keeps it
    if (near) p.edgeId = near.edge.id; else doomed.push(p.id);
  }
  for (const id of doomed) world.removeProp(id);
}

/** Park cells grouped into 4-connected clusters: [{ key, cellSet }] (key = the cluster's first cell, sorted). */
function parkClustersOf(seeds, visited = new Set()) {
  const world = S.ctx.world;
  const out = [];
  for (const seedKey of seeds) {
    if (visited.has(seedKey)) continue;
    const [si, sj] = seedKey.split(',').map(Number);
    const stack = [[si, sj]], cellSet = new Set();
    while (stack.length) {
      const [i, j] = stack.pop();
      const k = `${i},${j}`;
      if (cellSet.has(k)) continue;
      const c = world.cellAt(i, j);
      if (!c || c.type !== 'park') continue;
      cellSet.add(k); visited.add(k);
      stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
    }
    if (cellSet.size) out.push({ key: [...cellSet].sort()[0], cellSet });
  }
  return out;
}

/** After a save replay: take ownership of the restored world without generating anything. Every edge counts as
 * furnished and walked, every junction as signalled, and the restored props are re-attached to their owners by
 * tag, so later live edits (a new road, a bulldoze, a park extension) behave exactly as in the saved session.
 * Edge and node ids are new in this session, so road tags are re-pointed at the nearest replayed edge / node. */
function adoptReplayedWorld() {
  const world = S.ctx.world;
  S.roadSnapDirty = true;
  S.pedEdges.clear();
  for (const id of world.roads.edges.keys()) { S.pedEdges.add(id); markEdgePopulated(id); }

  S.signaledNodes.clear(); S.nodeSignalProps.clear(); S.signalDirty.clear();
  const junctions = [];
  const roads = S.ctx.modules.get('roads');
  if (roads?.status === 'ok') {
    for (const node of roads.api.getIntersections()) {
      if (node.arms.length < 3) continue;
      S.signaledNodes.add(node.nodeId);
      junctions.push(node);
    }
  }

  S.yardByBuilding.clear();
  for (const b of world.buildings.values()) S.yardByBuilding.set(b.id, []);

  S.parkDirty.clear(); S.parkClusters.clear();
  const parkSeeds = [];
  for (const c of world.cells) if (c.type === 'park') parkSeeds.push(`${c.i},${c.j}`);
  const clusterOfCell = new Map();
  for (const { key, cellSet } of parkClustersOf(parkSeeds)) {
    const entry = { cellSet, propIds: [] };
    S.parkClusters.set(key, entry);
    for (const k of cellSet) clusterOfCell.set(k, entry);
  }

  for (const p of world.props.values()) {
    if (isSpProp(p)) continue; // set-pieces re-adopt themselves on prop:added
    if (p.kind === 'traffic_light') {
      // Untagged lights (a save from before the tags) are adopted too: the kind alone identifies them.
      let best = null, bestD = 30;
      for (const n of junctions) { const d = Math.hypot(n.x - p.x, n.z - p.z); if (d < bestD) { bestD = d; best = n; } }
      if (best) {
        p.nodeId = best.nodeId;
        const list = S.nodeSignalProps.get(best.nodeId);
        if (list) list.push(p.id); else S.nodeSignalProps.set(best.nodeId, [p.id]);
      }
      continue;
    }
    if (p.edgeId != null) {
      const near = world.nearestRoad(p.x, p.z, 16);
      p.edgeId = near ? near.edge.id : 'none';
    }
    if (p.yardOf != null) S.yardByBuilding.get(p.yardOf)?.push(p.id);
    if (p.park) {
      const { i, j } = world.worldToCell(p.x, p.z);
      clusterOfCell.get(`${i},${j}`)?.propIds.push(p.id);
    }
  }
  markDirty();
}

function onParkCell(i, j, cell) {
  if (S.replaying) return; // the save carries the park's props; endReplay() registers the clusters
  if (cell.type !== 'park') return;
  S.parkDirty.add(`${i},${j}`);
  S.parkFlushAt = performance.now() + 200;
}

function flushParkClusters() {
  const world = S.ctx.world;
  const seeds = [...S.parkDirty];
  S.parkDirty.clear();
  for (const { key: clusterKey, cellSet: clusterSet } of parkClustersOf(seeds)) {
    const existing = S.parkClusters.get(clusterKey);
    if (existing && existing.cellSet.size === clusterSet.size) continue;
    if (existing) for (const id of existing.propIds) world.removeProp(id);
    const cells = [...clusterSet].map((k) => { const [i, j] = k.split(',').map(Number); return { i, j }; });
    const propIds = tagProps(populatePark(S.ctx, api.addProp, S.rng, cells, placer), 'park', 1);
    S.parkClusters.set(clusterKey, { cellSet: clusterSet, propIds });
  }
}

// ---- public api ------------------------------------------------------------------------------------------
const api = {
  kinds: KIND_NAMES.slice(),
  /** Place a prop of `kind` at world (x, z) facing Y-rotation `rot` (radians, default 0). Returns the new
   * prop id, or null for an unrecognised kind. Height is resolved from the road/terrain surface. */
  addProp(kind, x, z, rot = 0) {
    if (!KIND_SET.has(kind)) { S.ctx?.error(`[props] unknown kind "${kind}"`); return null; }
    const y = resolveHeight(S.ctx, x, z);
    return S.ctx.world.addProp({ x, y, z, rot, kind });
  },
  removeProp(id) { return S.ctx.world.removeProp(id); },
  /** Populate streetlamps + occasional bins/benches/signs along one road edge (tools calls this after an
   * interactive road placement; the module also calls it itself on every `road:added` in the full game). */
  populateAlongRoad(edgeId) { return furnishEdge(edgeId); },
  /** Save replay bracket (menu's applySave). Between the two calls the world's road/building/park events do not
   * generate props; endReplay() then adopts the restored props (see adoptReplayedWorld). */
  beginReplay() { S.replaying = true; },
  endReplay() { if (!S.replaying) return; S.replaying = false; adoptReplayedWorld(); },
  /** Scatter park furniture (fountain/trees/benches/flower beds/hedge border) over a list of {i,j} park cells. */
  populatePark(cells) { return populatePark(S.ctx, api.addProp, S.rng, cells, placer); },
  /** C2: walk one street/avenue edge (or every un-walked edge when omitted) and place its sidewalk figures.
   * Idempotent per edge id. Showcases call this after staging roads. Returns created prop ids. */
  populatePedestrians(edgeId) {
    if (edgeId !== undefined) return populatePedestriansForEdge(edgeId);
    const out = [];
    for (const id of S.ctx.world.roads.edges.keys()) out.push(...populatePedestriansForEdge(id));
    return out;
  },
  /** C2: run the yard-dressing pass for one building id (used by tooling; the module does this itself on
   * building:spawned and for pre-existing buildings at init). Returns [] when the building was already dressed. */
  populateYard(buildingId) {
    const b = S.ctx.world.buildings.get(buildingId);
    if (!b || S.yardByBuilding.has(b.id)) return [];
    return addDetailForBuilding(b);
  },
  /** C2: would the placer accept a prop of `kind` at (x,z)? (footprint / existing-prop separation / carriageway)
   * Exposed for tools and checks; does not modify the world. */
  canPlace(kind, x, z) {
    if (!KIND_SET.has(kind) || S.c2Off) return false;
    return placementFree(kind, x, z);
  },
  /** C2: re-resolve every C2 prop's height against the finished terrain/roads (see settleDetail()). Returns the
   * number of props whose Y changed; call it after the world stops moving (demo does, showcase() does). */
  settleDetail() { return settleDetail(); },
  /** C2: the prop ids the placer created for one building (yard items + civic clusters), for tools/checks.
   * Props later swept (a road paved through the yard) are absent from the world and omitted. */
  detailProps(buildingId) {
    const out = [];
    for (const id of S.yardByBuilding.get(buildingId) || []) {
      const p = S.ctx.world.props.get(id);
      if (p) out.push({ id, kind: p.kind, x: p.x, z: p.z });
    }
    return out;
  },
  /** LOOP cycle 5: author one hero set-piece inside the rect { type: 'skate'|'garden'|'farm', id, x, z, rot, w, d,
   * deckY?, margin?, force? } (w/d are clamped to the type's minimum; margin = required clearance in metres). Deterministic (`rng.fork('sp:'+id)`), idempotent per
   * id, content-derived `sp:` prop ids (never world._ids.prop). Refuses (returns null, logs why) when the rect
   * touches a building footprint, a road footprint or water, unless `force`. Returns the registry entry. */
  placeSetPiece(spec) { return placeSetPiece(spec); },
  /** Registry of placed set-pieces: [{ type, id, x, z, rot, w, d, deckY, hero: {pos, target, fov}, heroAlt, counts }]. */
  setPieces() { return [...S.setPieces.values()].map(spPublic); },
  /** Remove a set-piece and all its props. */
  removeSetPiece(id) { return removeSetPiece(String(id)); },
  /** Why a set-piece spec cannot be placed ([] = free). Read-only. */
  setPieceBlockers(spec = {}) {
    if (!SP_TYPES.includes(spec.type)) return ['type'];
    const { w, d } = clampSize(spec.type, Number(spec.w), Number(spec.d));
    return setPieceBlockers({ x: Number(spec.x), z: Number(spec.z), rot: Number(spec.rot) || 0, w, d }, Math.max(0, Number(spec.margin) || 0));
  },
  /** Sun-side hero camera for a placed set-piece at the current time of day. */
  setPieceHero(id) {
    const e = S.setPieces.get(String(id));
    return e ? sunSideHero(e, S.ctx.clock) : null;
  },
  stats() {
    const byKind = {};
    let c2 = 0, sp = 0, spFigures = 0;
    for (const p of S.ctx.world.props.values()) {
      byKind[p.kind] = (byKind[p.kind] || 0) + 1;
      if (isC2Prop(p)) c2++;
      if (isSpProp(p)) { sp++; if (isFigureKind(p.kind)) spFigures++; }
    }
    let drawCalls = 0;
    for (const def of S.roleTable.values()) if (def.mesh?.count) drawCalls++;
    drawCalls += S.fountains.length;
    const yardKinds = ['fence_picket', 'garden_bed', 'laundry_line', 'picnic_table', 'crate_stack', 'bike'];
    let yardProps = 0;
    for (const k of yardKinds) yardProps += byKind[k] || 0;
    return {
      count: S.ctx.world.props.size, byKind, drawCalls,
      // `drawCalls` above is this module's own instanced-mesh count (the §7 props gate). C2-owned prop total
      // (id prefix) is the dressing the fix round added; figureCap/detailMs are the boot-cost knobs.
      c2Props: c2, detailOff: !!S.c2Off,
      figures: byKind.figure || 0, yardProps, detailedBuildings: S.yardByBuilding.size,
      figureCap: FIGURE_CAP, detailMs: Math.round((S.detailMs || 0) * 10) / 10,
      detailSettle: S.detailSettle || null,
      // LOOP cycle 5 set-pieces (all zero in a world without set-pieces)
      setPieces: S.setPieces.size, spProps: sp, spFigures, spOff: !!S.spOff, spSettle: S.spSettle || null,
    };
  },
};

export default {
  id: 'props',
  // 'buildings' is a real dep (order 40 < 45, already loaded before props in the full game): the module's own
  // building:spawned listener runs first and writes b.kind, and the 'yards' showcase needs real houses to dress.
  deps: ['terrain', 'roads', 'buildings'],
  order: 45,
  api,
  showcaseVariants: ['default', 'park', 'yards', 'night', 'setpieces'],
  presets: { ...PRESETS, ...SP_PRESETS },

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('props');
    S.c2Off = ctx.params?.get('noc2') === '1'; // verification flag: full game without the C2 layer
    S.spOff = ctx.params?.get('nosp') === '1'; // verification flag: placeSetPiece() disabled (A/B attribution)
    S.setPieces.clear(); S.spEvict.length = 0; S.spSettle = null; S.spPlacing = false; S.spResettle = false;
    S.detailMs = 0; S.detailSettle = null; S.detailSettledOnce = false;
    S.roadSnap = null; S.roadSnapDirty = true;
    S.roadsApi = ctx.modules.get('roads')?.status === 'ok' ? ctx.modules.get('roads').api : null;
    S.group = new THREE.Group();
    S.group.name = 'props';
    ctx.scene.add(S.group);

    const geo = buildRoleGeometry(ctx);
    const { roles } = buildRoleMaterials(ctx);
    S.roleTable = new Map();
    for (const [role, def] of roles) {
      const geometry = geo[role];
      if (!geometry) { ctx.error(`[props] missing geometry for role "${role}"`); continue; }
      S.roleTable.set(role, { ...def, geometry, mesh: null });
    }

    S.waterMat = new THREE.PointsMaterial({
      color: ctx.materials.color('mediumAzur'), size: 0.1, transparent: true, opacity: 0.8,
      depthWrite: false, sizeAttenuation: true,
    });

    for (let k = 0; k < LIGHT_POOL_SIZE; k++) {
      const l = new THREE.PointLight(0xfff2c4, 0, 12, 2);
      l.castShadow = false;
      S.group.add(l);
      S.lightPool.push(l);
    }

    S.wasNight = ctx.clock.isNight;
    applyNightMaterials(S.wasNight);
    S.trafficPhaseName = null;

    // C2: keep the detail-layer spatial index in sync with the world; dress every building as it spawns.
    S.unsub.push(ctx.events.on('prop:added', ({ prop }) => {
      indexProp(prop);
      // Anything another system drops onto a set-piece rect later (park scatter, street furniture) is evicted on
      // the next update - never inside this emit, so the emitter's own bookkeeping stays consistent.
      if (S.setPieces.size && !isSpProp(prop) && setPieceAt(prop.x, prop.z, 0)) S.spEvict.push(prop.id);
      else if (!S.spPlacing && prop.sp && isSpProp(prop)) spAdopt(prop);
      markDirty();
    }));
    S.unsub.push(ctx.events.on('prop:removed', ({ prop }) => {
      unindexProp(prop);
      if (isFigureKind(prop.kind) && S.figureCount > 0) S.figureCount--;
      // The deck is the set-piece: once it is gone (clearContent on a new city / a save being applied, or an
      // explicit removal) the whole set-piece and its registry entry go with it, so no stale rect survives.
      if (prop.kind === 'sp_deck' && prop.sp && S.setPieces.get(prop.sp)?.props[0] === prop.id) removeSetPiece(prop.sp, 'deck removed');
      markDirty();
    }));
    S.unsub.push(ctx.events.on('building:spawned', onBuildingSpawned));
    S.unsub.push(ctx.events.on('building:removed', onBuildingRemoved));
    // The local carriageway snapshot (and any C2 height already settled) is invalidated by road/terrain changes;
    // registered in both the full game and showcases so a staged world never uses a stale snapshot.
    S.unsub.push(ctx.events.on('road:added', markRoadSnapshotDirty));
    S.unsub.push(ctx.events.on('road:removed', markRoadSnapshotDirty));
    S.unsub.push(ctx.events.on('road:changed', markRoadSnapshotDirty));
    S.unsub.push(ctx.events.on('terrain:changed', markRoadSnapshotDirty));
    S.unsub.push(ctx.events.on('terrain:changed', () => { if (S.setPieces.size) S.spResettle = true; }));
    S.unsub.push(ctx.events.on('time:changed', ({ isNight }) => {
      if (isNight !== S.wasNight) { S.wasNight = isNight; applyNightMaterials(isNight); }
    }));

    if (!ctx.showcase) {
      S.unsub.push(ctx.events.on('road:added', onRoadAdded));
      S.unsub.push(ctx.events.on('road:changed', onRoadChanged));
      S.unsub.push(ctx.events.on('road:removed', onRoadRemoved));
      S.unsub.push(ctx.events.on('world:cell', ({ i, j, cell }) => onParkCell(i, j, cell)));
      S.unsub.push(ctx.events.on('zone:changed', ({ i, j, zone }) => {
        const c = ctx.world.cellAt(i, j);
        if (c) onParkCell(i, j, c);
        if (zone && S.setPieces.size) sweepSetPiecesForZone(i, j);
      }));
      // pick up any roads/parks that already exist (e.g. a demo city built before props initialised)
      for (const edgeId of ctx.world.roads.edges.keys()) onRoadAdded({ edgeId });
      for (const c of ctx.world.cells) if (c.type === 'park') onParkCell(c.i, c.j, c);
    }

    // Existing content first (index), then dress: the placer must see the props already in the world.
    rebuildIndexes();
    for (const b of ctx.world.buildings.values()) addDetailForBuilding(b);

    rebuild();
  },

  update(dt, ctx) {
    if (S.spEvict.length) {
      for (const id of S.spEvict.splice(0)) ctx.world.removeProp(id);
    }
    if (S.spResettle) { S.spResettle = false; settleSetPieces(); }
    S.live = true;
    if (S.signalDirty.size) { const ids = [...S.signalDirty]; S.signalDirty.clear(); respawnSignals(ids); }
    if (S.dirty && performance.now() - S.lastEvent > 30) rebuild();
    if (S.parkDirty.size && performance.now() > S.parkFlushAt) flushParkClusters();
    applyLod(false);
    S.lightPoolTimer -= dt;
    updateLightPool(false);
    updateTrafficPhase(dt);
    updateFountains(dt);
  },

  async showcase(ctx, variant = 'default') {
    // clearContent() (main.js) has already emptied the world; re-derive the detail index from it so a restage
    // never dresses against stale prop positions.
    S.setPieces.clear(); S.spEvict.length = 0; // clearContent() removed their props
    rebuildIndexes();
    S.yardByBuilding.clear();
    S.pedEdges.clear();
    if (variant === 'park') stagePark(ctx, api);
    else if (variant === 'yards') stageYards(ctx, api);
    else if (variant === 'setpieces') stageSetPieces(ctx, api);
    else stageStreet(ctx, api);
    // Staged terrain/roads are final now: settle the C2 heights once (same hook demo calls in the full game).
    settleDetail();
    S.signaledNodes.clear();
    S.nodeSignalProps.clear();
    rebuild();
  },

  dispose(ctx) {
    for (const u of S.unsub) { try { u(); } catch (_) { /* ignore */ } }
    S.unsub.length = 0;
    for (const [role, def] of S.roleTable) {
      if (!SHARED_GEOMETRY_ROLES.has(role)) def.geometry?.dispose();
      if (def.dynamic) { ctx.materials.cache.delete(def.material?.name); def.material?.dispose(); }
    }
    for (const f of S.fountains) disposeFountainFx(f);
    S.fountains.length = 0;
    S.waterMat?.dispose();
    for (const l of S.lightPool) S.group.remove(l);
    S.lightPool.length = 0;
    ctx.scene.remove(S.group);
    S.group = null; S.roleTable = null; S.roleInstances = null;
    S.signaledNodes.clear(); S.nodeSignalProps.clear(); S.parkClusters.clear(); S.parkDirty.clear();
    S.pIdx.clear(); S.bIdx.clear(); S.yardByBuilding.clear(); S.pedEdges.clear(); S.figureCount = 0;
    S.roadSnap = null; S.roadSnapDirty = true; S.detailSettle = null; S.detailSettledOnce = false;
    S.setPieces.clear(); S.spEvict.length = 0; S.spSettle = null; S.spPlacing = false; S.spResettle = false;
    S.replaying = false; S.live = false; S.signalDirty.clear();
  },
};
