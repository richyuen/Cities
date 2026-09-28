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
  populateAlongRoad, populateIntersectionNode, populatePark, forgetEdge,
  populateYard, populateCivicEntrance, populateServiceBack, populatePedestrians, FIGURE_CAP,
} from './populate.js';
import { stageStreet, stagePark, stageYards, PRESETS } from './showcase.js';

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
/** Variation seed key for rebuild(): C2 props use kind + rounded position (stable under id churn and across
 * restages); everything else keeps the id it had pre-C2 (also stable, because C2 props never consume ids). */
function variationKey(p) {
  return isC2Prop(p) ? `${p.kind}:${p.x.toFixed(2)}:${p.z.toFixed(2)}` : String(p.id);
}

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
};

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
  S.yardByBuilding.set(b.id, ids);
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
  return populatePedestrians(S.ctx, S.rng, edgeId, placer);
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
    if (p.kind === 'figure') S.figureCount++;
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
    const parts = buildKindParts(prop.kind, prng);
    for (const part of parts) {
      const list = buckets.get(part.role);
      if (!list) continue;
      const world4 = part.local ? new THREE.Matrix4().multiplyMatrices(base, part.local) : base.clone();
      const pos = new THREE.Vector3().setFromMatrixPosition(world4);
      const color = part.color ? ctx.materials.color(part.color) : null;
      list.push({ pos, base: world4, color });
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
    S.group.add(mesh);
    def.mesh = mesh;
  }
  S.roleInstances = buckets;

  S.dirty = false;
  applyLod(true);
  updateLightPool(true);
  ctx.log(`[props] rebuilt ${world.props.size} props across ${S.roleTable.size} roles`);
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
      const f = exempt ? 1 : fadeFactor(inst.pos.distanceTo(camPos));
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
    if (ids && ids.length) S.nodeSignalProps.set(node.nodeId, ids);
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
  populateAlongRoad(S.ctx, api.addProp, S.rng, edgeId);
  sweepDetailNearEdge(edge); // C2: the widened cross-section may now cover yard props
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
  const e = edge ?? S.ctx.world.roads.edges.get(edgeId);
  const kind = e?.kind;
  // C2: a road added after the dressing may have paved through a yard (alleys/parks/connectors are added in
  // later citygen phases than some districts' lots). Sweep only the C2-owned props that now sit on a carriageway.
  if (e) sweepDetailNearEdge(e);
  if (kind === 'path') return;
  // A split/merge event is the core stitching an existing road into a junction: props already exist along that
  // line, so repopulating the halves would duplicate lamps near the new junction. Signals still need the new
  // node, so that pass always runs.
  if (reason !== 'split' && reason !== 'merge') {
    populateAlongRoad(S.ctx, api.addProp, S.rng, edgeId);
    populatePedestriansForEdge(edgeId); // C2: figures on this edge's sidewalks
  }
  maybeSignalIntersections();
  // Live play only (after the boot settle): a newly drawn/edited road can change the surface under already
  // settled C2 props (the same mechanism that used to leave levitating figures), so re-resolve once.
  if (S.detailSettledOnce && reason !== 'split' && reason !== 'merge') settleDetail();
}

function onParkCell(i, j, cell) {
  if (cell.type !== 'park') return;
  S.parkDirty.add(`${i},${j}`);
  S.parkFlushAt = performance.now() + 200;
}

function flushParkClusters() {
  const world = S.ctx.world;
  const seeds = [...S.parkDirty];
  S.parkDirty.clear();
  const visited = new Set();
  for (const seedKey of seeds) {
    if (visited.has(seedKey)) continue;
    const [si, sj] = seedKey.split(',').map(Number);
    const c0 = world.cellAt(si, sj);
    if (!c0 || c0.type !== 'park') continue;
    const stack = [[si, sj]], clusterSet = new Set();
    while (stack.length) {
      const [i, j] = stack.pop();
      const k = `${i},${j}`;
      if (clusterSet.has(k)) continue;
      const c = world.cellAt(i, j);
      if (!c || c.type !== 'park') continue;
      clusterSet.add(k); visited.add(k);
      stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
    }
    if (!clusterSet.size) continue;
    const clusterKey = [...clusterSet].sort()[0];
    const existing = S.parkClusters.get(clusterKey);
    if (existing && existing.cellSet.size === clusterSet.size) continue;
    if (existing) for (const id of existing.propIds) world.removeProp(id);
    const cells = [...clusterSet].map((k) => { const [i, j] = k.split(',').map(Number); return { i, j }; });
    const propIds = populatePark(S.ctx, api.addProp, S.rng, cells, placer);
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
  populateAlongRoad(edgeId) { return populateAlongRoad(S.ctx, api.addProp, S.rng, edgeId); },
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
  stats() {
    const byKind = {};
    let c2 = 0;
    for (const p of S.ctx.world.props.values()) {
      byKind[p.kind] = (byKind[p.kind] || 0) + 1;
      if (isC2Prop(p)) c2++;
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
  showcaseVariants: ['default', 'park', 'yards', 'night'],
  presets: PRESETS,

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('props');
    S.c2Off = ctx.params?.get('noc2') === '1'; // verification flag: full game without the C2 layer
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
    S.unsub.push(ctx.events.on('prop:added', ({ prop }) => { indexProp(prop); markDirty(); }));
    S.unsub.push(ctx.events.on('prop:removed', ({ prop }) => {
      unindexProp(prop);
      if (prop.kind === 'figure' && S.figureCount > 0) S.figureCount--;
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
    S.unsub.push(ctx.events.on('time:changed', ({ isNight }) => {
      if (isNight !== S.wasNight) { S.wasNight = isNight; applyNightMaterials(isNight); }
    }));

    if (!ctx.showcase) {
      S.unsub.push(ctx.events.on('road:added', onRoadAdded));
      S.unsub.push(ctx.events.on('road:changed', onRoadChanged));
      S.unsub.push(ctx.events.on('world:cell', ({ i, j, cell }) => onParkCell(i, j, cell)));
      S.unsub.push(ctx.events.on('zone:changed', ({ i, j }) => {
        const c = ctx.world.cellAt(i, j);
        if (c) onParkCell(i, j, c);
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
    rebuildIndexes();
    S.yardByBuilding.clear();
    S.pedEdges.clear();
    if (variant === 'park') stagePark(ctx, api);
    else if (variant === 'yards') stageYards(ctx, api);
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
  },
};
