// demo/setpieces.js — LOOP cycle 5: deterministic siting of the three authored hero set-pieces (props module's
// skate plaza / pergola garden / community farm) inside the demo city, with town around every hero frame.
//
// Two phases, both pure functions of the seed:
//  1. reserveSetPieces() runs inside buildCity() (from buildSuburb, right after the suburb's utilities are sited and
//     BEFORE any suburb block is zoned or filled). It picks one lot per type in the suburb's park/plaza blocks —
//     the only in-city land that is never zoned or grown (citygen's PARK_BLOCKS / PLAZA_BLOCK leftovers) — pushed
//     into a block corner so the rect sits flush against the perimeter streets' verges, with the houses of the
//     neighbouring blocks across both streets. The chosen cells go into a reservation set that citygen's zoning /
//     alley / utility / park helpers honour (no-ops when nothing is reserved), so nothing paves, zones or builds
//     there. Building ids, road ids and rng streams of the rest of the city are untouched: the lots are on
//     never-zoned land, and the utilities were already placed when the search runs (recon §5).
//  2. After the 600-tick warm-up + buildings.settle() (demo/index.js seed()), in this order:
//     placeSetPieces()  adds the garden's hero house (explicit id, `landmark` record) and places each reserved piece
//                       through props.api.placeSetPiece;
//     stampParkLand()   (LOOP c6) turns the never-zoned leftover land of every block that hosts a piece into park, so
//                       props dresses it like any park instead of leaving bare baseplate around the piece;
//     dressHouseYard()  (LOOP c6) plants the hero house's two side yards (road-verge cells a park stamp cannot reach);
//     infillAround()    (LOOP c6) builds level-1 houses on the empty road-facing r lots within INFILL_RADIUS of each
//                       piece - a rule that does not look at any camera, so the town exists wherever one looks from;
//     chooseCameras()   picks hero vs heroAlt per piece on that final city (building-occlusion ray fan).
//     heroCameras() is the one source of truth for a piece's two hero cameras: the preset, demo.api.setPieces(), the
//     pick and the final occlusion report all go through it. Skate and farm use the props registry cameras; the
//     garden's is composed here around its hero house (gardenHero).
//
// `?nosp=1` disables every phase (and props' placeSetPiece), so that city is the pre-cycle city: same cells, same
// building ids/records (verified on seed 1 against the pre-cycle boot).
import * as THREE from 'three';

// The set-piece specs. `sites` = [blockKey, corner] in preference order (blockKey = suburb block 'a,b'; the corner
// is the block corner the lot is pushed into). The garden always has its house on its north (−z, "back") side: the
// generator puts a house's door on its +z facade, so the garden path leads to the front door. Every site key must be
// a never-zoned park/plaza block (others are skipped); a type with no valid site is skipped and logged (`misses`).
export const SP_SPECS = [
  // Garden width 24.8 (not the nominal 24): props' authored picket runs (setpieces.js run(), 2 m segments) then
  // split into 2.04 m panels instead of 1.96 m ones, which check-detail's fence-spacing floor (2.0 / 2.02 m) refuses.
  { type: 'garden', id: 'demo-garden', w: 24.8, d: 20, house: true,
    sites: [['2,1', 'NE'], ['4,1', 'NW'], ['2,1', 'NW'], ['4,1', 'NE']] },
  { type: 'skate', id: 'demo-skate', w: 24, d: 20,
    sites: [['2,1', 'NW'], ['2,1', 'SW'], ['2,1', 'SE'], ['2,1', 'NE'], ['4,1', 'SW'], ['4,1', 'SE'], ['1,0', 'SE'], ['1,0', 'SW']] },
  { type: 'farm', id: 'demo-farm', w: 40, d: 30,
    sites: [['4,1', 'NE'], ['4,1', 'SE'], ['4,1', 'NW'], ['4,1', 'SW'], ['1,0', 'SE'], ['1,0', 'SW'], ['2,1', 'SE'], ['2,1', 'SW']] },
];

// The garden house is a `landmark` record (LOOP c6): buildings forces two storeys and the full house vocabulary for
// it, so these seeds no longer have to be two-storey ones. They still drive what the flag does not pin (lit-window
// pattern, chimney, door / shutter / deck colours), and the setpieces fork still draws exactly one of them, so
// nothing else in that stream shifts and the house stays part of the seed's deterministic output.
const HOUSE_SEEDS = [6, 8, 18, 29, 33];
const HOUSE_ID = 'demo-sp-garden-house';
const HOUSE_COLORS = { body: 'sandGreen', roof: 'darkRed' }; // closest match to the reference house; no new merge bucket
const CIVIC_KINDS = new Set(['school', 'hospital', 'fire_department', 'police_station']);

const MAX_GROUND_RANGE = 1.6;   // metres of terrain relief under a deck (the deck skirt covers it)
const ROAD_CLEAR = 0.6;         // metres between a rect and a road's rendered footprint (sidewalk outer edge)
const CIVIC_PROP_CLEAR = 36;    // metres, rect edge -> civic centre (composition props radius 34 m)
const CIVIC_BLDG_CLEAR = 57;    // metres, house -> civic centre (composition neighbour radius 55 m)
const FLOOR_STEP_MAX = 0.3;     // metres of terrain above/below a house floor inside its cell (check-detail 2d gates 0.3)
const INFILL_RADIUS = 80;       // metres from a piece's bounds (rect + its house cell) to an infill lot's centre
const INFILL_MAX = 14;          // houses per piece (the cycle-5 cap), nearest to the piece's back edge first
const HOUSE_INSET = 0.6;        // metres from a lot's cell edge to where a house's walls may start (generator: 0.75)
const FORECOURT_DEPTH = 16;     // metres in front of a piece's front edge that stay open (no park trees)
const FORECOURT_SIDE = 8;       // metres the open forecourt extends past the rect's front corners

/** Rendered terrain surface (the plate a building is seated on); falls back to the smooth height field. */
function surfaceAt(ctx, x, z) {
  const terr = ctx.modules.get('terrain')?.api;
  if (terr && typeof terr.surfaceHeight === 'function') {
    const h = terr.surfaceHeight(x, z);
    if (Number.isFinite(h)) return h;
  }
  return ctx.world.getHeight(x, z);
}

/**
 * Terrain relief inside cell (i,j) relative to the surface at its centre, where buildings seats a house: `over` =
 * highest terrain above that floor (it buries the porch / plinth on that side), `under` = deepest terrain below it
 * (the house would overhang a lower plate). Same 9x9 sampling as tools/check-detail.mjs block 2d.
 * terrain.api.isBuildable() is not enough: it accepts a one-plate (0.4 m) spread, and a cell whose centre sub-plate
 * is the low one then has a 0.4 m step standing in the porch (seed 23, cell 156,75).
 */
function cellRelief(ctx, i, j) {
  const world = ctx.world, cs = world.cellSize;
  const x0 = world.minX + i * cs, z0 = world.minZ + j * cs;
  const g = surfaceAt(ctx, x0 + cs / 2, z0 + cs / 2);
  let over = 0, under = 0;
  for (let v = 0; v <= 8; v++) {
    for (let u = 0; u <= 8; u++) {
      const h = surfaceAt(ctx, x0 + 0.2 + ((cs - 0.4) * u) / 8, z0 + 0.2 + ((cs - 0.4) * v) / 8) - g;
      if (h > over) over = h;
      if (h < under) under = h;
    }
  }
  return { over, under: -under };
}

/** A house may stand on cell (i,j): dry, and the rendered ground inside the cell is one level (no step > 0.3 m). */
function flatLot(ctx, i, j) {
  const terr = ctx.modules.get('terrain')?.api;
  if (terr && !terr.isBuildable(i, j)) return false;
  const r = cellRelief(ctx, i, j);
  return r.over <= FLOOR_STEP_MAX && r.under <= FLOOR_STEP_MAX;
}

/** World centres of every civic building (closeup-ranking clearances). */
function civicCentres(world) {
  const out = [];
  for (const b of world.buildings.values()) {
    if (CIVIC_KINDS.has(b.kind)) out.push(world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2));
  }
  return out;
}

/** Every road edge as a segment with its rendered footprint half-width (carriageway + sidewalks). */
function roadSegments(ctx) {
  const world = ctx.world, roadsApi = ctx.modules.get('roads')?.api;
  const out = [];
  for (const e of world.roads.edges.values()) {
    const a = world.roads.nodes.get(e.a), b = world.roads.nodes.get(e.b);
    if (!a || !b) continue;
    const fp = (roadsApi?.footprintWidth ? roadsApi.footprintWidth(e.kind) : (e.width || 8) + 4) / 2;
    out.push({ id: e.id, kind: e.kind, width: e.width, ax: a.x, az: a.z, bx: b.x, bz: b.z, fp });
  }
  return out;
}

/** A house on cell (i,j) stands clear of every road's rendered footprint: its walls start 0.75 m inside the cell
 * and its porch steps reach the +z edge, so that box (HOUSE_INSET on three sides, the full +z edge) must keep
 * 0.15 m from every sidewalk. A sidewalk may clip the cell's rim, as it does under the city's own block-fill houses.
 * `segs` = roadSegments() (or any subset near the cell). */
function houseClearOfRoads(world, i, j, segs) {
  const cs = world.cellSize, p = world.cellToWorld(i, j);
  const body = { x0: p.x - cs / 2 + HOUSE_INSET, x1: p.x + cs / 2 - HOUSE_INSET, z0: p.z - cs / 2 + HOUSE_INSET, z1: p.z + cs / 2 };
  return !segs.some((e) => segRectDist(e.ax, e.az, e.bx, e.bz, body) < e.fp + 0.15);
}

/** Rect corners / bounds for an axis-aligned (rot = k·π/2) set-piece rect. */
function rectBounds(x, z, rot, w, d) {
  const swap = Math.abs(Math.sin(rot)) > 0.5;
  const hx = (swap ? d : w) / 2, hz = (swap ? w : d) / 2;
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz };
}

/** Cells whose 8 m square overlaps the open rect (touching edges do not count — same rule as props' spCells). */
function rectCells(world, b) {
  const cs = world.cellSize, eps = 1e-6;
  const i0 = Math.floor((b.x0 - world.minX) / cs + eps), i1 = Math.ceil((b.x1 - world.minX) / cs - eps) - 1;
  const j0 = Math.floor((b.z0 - world.minZ) / cs + eps), j1 = Math.ceil((b.z1 - world.minZ) / cs - eps) - 1;
  const out = [];
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push({ i, j });
  return out;
}

function pointSegDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return Math.hypot(ax + dx * t - px, az + dz * t - pz);
}
function segsCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const o = (px, pz, qx, qz, rx, rz) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  return o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0;
}
/** Exact distance from segment AB to an axis-aligned rect (0 when they touch/intersect). */
function segRectDist(ax, az, bx, bz, b) {
  const inside = (x, z) => x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1;
  if (inside(ax, az) || inside(bx, bz)) return 0;
  const C = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]];
  for (let k = 0; k < 4; k++) {
    const [cx, cz] = C[k], [dx, dz] = C[(k + 1) % 4];
    if (segsCross(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
  }
  const rp = (x, z) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1));
  let best = Math.min(rp(ax, az), rp(bx, bz));
  for (const [cx, cz] of C) best = Math.min(best, pointSegDist(cx, cz, ax, az, bx, bz));
  return best;
}

/** Cheap local test (cells + nearby road footprints + relief). The exact props test runs on the winner. */
function cheapOk(ctx, b, reserved, edgesNear) {
  const world = ctx.world;
  const roadsApi = ctx.modules.get('roads')?.api;
  for (const { i, j } of rectCells(world, b)) {
    const c = world.cellAt(i, j);
    if (!c || c.zone || c.buildingId) return false;
    if (reserved.has(j * world.size.w + i)) return false;
    // 'none' cells need not be isBuildable(): a terrace step inside a cell is fine under a deck (its skirt covers
    // the relief, capped below); park / water / zone / building cells never.
    if (c.type !== 'none' && c.type !== 'road') return false;
  }
  for (const e of edgesNear) {
    const fp = (roadsApi?.footprintWidth ? roadsApi.footprintWidth(e.kind) : (e.width || 8) + 4) / 2;
    if (segRectDist(e.ax, e.az, e.bx, e.bz, b) < fp + ROAD_CLEAR) return false;
  }
  let min = Infinity, max = -Infinity;
  for (let z = b.z0; z <= b.z1 + 1e-6; z += (b.z1 - b.z0) / Math.ceil((b.z1 - b.z0) / 2)) {
    for (let x = b.x0; x <= b.x1 + 1e-6; x += (b.x1 - b.x0) / Math.ceil((b.x1 - b.x0) / 2)) {
      const g = world.getHeight(x, z);
      if (g < min) min = g;
      if (g > max) max = g;
    }
  }
  return max - min <= MAX_GROUND_RANGE;
}

/** Only verge cells ('cell:road:i,j') may remain: road footprints, buildings, zoning and water refuse the lot. */
function hardBlockers(list) { return list.filter((s) => !s.startsWith('cell:road:')); }

/** Rotation + preferred camera side per block corner: the back (−v) faces the corner's north/south street and the
 * preferred hero camera looks diagonally toward the corner (two streets + the houses across them in frame). */
function cornerPose(corner) {
  switch (corner) {
    case 'NW': return { rot: 0, side: 'hero' };
    case 'NE': return { rot: 0, side: 'heroAlt' };
    case 'SW': return { rot: Math.PI, side: 'heroAlt' };
    default: return { rot: Math.PI, side: 'hero' }; // SE
  }
}

/**
 * Phase 1 (inside buildCity, before suburb zoning): pick and reserve the three lots.
 * `grid` is buildGrid()'s result for the suburb ({ pos[a][b] } jittered nodes); `parkKeys` the never-zoned blocks.
 * Adds every claimed cell index to `reserved` (a Set) and returns the plan.
 */
export function reserveSetPieces(ctx, rng, grid, parkKeys, reserved, predictedCivics = []) {
  const world = ctx.world, cs = world.cellSize, W = world.size.w;
  // Civic clearance: core/composition.js ranks the shipped `closeup` subjects by buildings within 55 m (x10) and props
  // within 34 m of each civic; a set-piece deck (≈100-300 props) or the garden house near one would re-rank them.
  // Rects keep >= CIVIC_PROP_CLEAR from every civic centre, the house >= CIVIC_BLDG_CLEAR (existing civics from the
  // districts built earlier + the suburb's predicted ones).
  const civics = [...predictedCivics];
  for (const b of world.buildings.values()) {
    if (CIVIC_KINDS.has(b.kind)) civics.push(world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2));
  }
  const civicClear = (b, house) => civics.every((c) => {
    const dx = Math.max(b.x0 - c.x, 0, c.x - b.x1), dz = Math.max(b.z0 - c.z, 0, c.z - b.z1);
    if (Math.hypot(dx, dz) < CIVIC_PROP_CLEAR) return false;
    return !house || Math.hypot(house.x - c.x, house.z - c.z) >= CIVIC_BLDG_CLEAR;
  });
  const propsApi = ctx.modules.get('props')?.api;
  if (!propsApi?.setPieceBlockers) return { pieces: [], misses: SP_SPECS.map((s) => `${s.type}: props api missing`) };
  const edges = roadSegments(ctx);
  const pieces = [], misses = [];
  for (const spec of SP_SPECS) {
    let chosen = null;
    for (const [key, corner] of spec.sites) {
      if (!parkKeys.has(key)) continue;
      const [a, bIdx] = key.split(',').map(Number);
      const nodes = { NW: grid.pos[a][bIdx], NE: grid.pos[a + 1][bIdx], SW: grid.pos[a][bIdx + 1], SE: grid.pos[a + 1][bIdx + 1] };
      const N = nodes[corner];
      const sx = corner.endsWith('W') ? 1 : -1, sz = corner.startsWith('N') ? 1 : -1; // inward directions
      const { rot, side } = cornerPose(corner);
      const near = edges.filter((e) => Math.min(Math.hypot(e.ax - N.x, e.az - N.z), Math.hypot(e.bx - N.x, e.bz - N.z),
        segRectDist(e.ax, e.az, e.bx, e.bz, { x0: N.x - 1, x1: N.x + 1, z0: N.z - 1, z1: N.z + 1 })) < 160);
      const cands = [];
      if (spec.house) {
        // Garden: the house occupies one cell on the block's north band, orthogonally touching a road cell on its
        // north; the garden rect (rot 0) starts 5 cm south of that cell, centred on it.
        for (let dj = 0; dj <= 9; dj++) {
          for (let di = 1; di <= 12; di++) {
            const hc = world.worldToCell(N.x + sx * (di * cs), N.z + sz * 4);
            const hi = hc.i, hj = hc.j + dj;
            const c = world.cellAt(hi, hj), north = world.cellAt(hi, hj - 1);
            if (!c || c.type !== 'none' || c.zone || c.buildingId || !north || north.type !== 'road') continue;
            if (reserved.has(hj * W + hi)) continue;
            // LOOP c6: one rendered ground level inside the cell (isBuildable alone lets a 0.4 m step into the porch)
            if (!flatLot(ctx, hi, hj)) continue;
            // LOOP c6: and the house stands off the street it backs onto. "A road cell on its north" only says the
            // carriageway band crosses that cell; on a jittered (diagonal) street the 2 m sidewalk - on seed 23 the
            // carriageway itself - ran through the back of the house (cycle 5 sites: 1.98 / 0.94 / 3.58 m of overlap).
            if (!houseClearOfRoads(world, hi, hj, near)) continue;
            const hcW = world.cellToWorld(hi, hj);
            const x = hcW.x, z = hcW.z + cs / 2 + 0.05 + spec.d / 2;
            const b = rectBounds(x, z, 0, spec.w, spec.d);
            const score = Math.hypot(hcW.x - N.x, hcW.z - N.z) + 1e-3 * (hi + hj * W); // deterministic tie-break
            cands.push({ x, z, rot: 0, b, score, house: { i: hi, j: hj } });
          }
        }
      } else {
        const bb0 = rectBounds(0, 0, rot, spec.w, spec.d);
        const hx = bb0.x1, hz = bb0.z1;
        for (let oz = 2; oz <= 70; oz += 1) {
          for (let ox = 2; ox <= 90; ox += 1) {
            const x = N.x + sx * (ox + hx), z = N.z + sz * (oz + hz);
            const b = rectBounds(x, z, rot, spec.w, spec.d);
            const score = Math.hypot(ox, oz) + 1e-4 * (ox * 97 + oz);
            cands.push({ x, z, rot, b, score });
          }
        }
      }
      cands.sort((p, q) => p.score - q.score);
      let tried = 0, lastHard = null;
      for (const c of cands) {
        if (!cheapOk(ctx, c.b, reserved, near)) continue;
        if (!civicClear(c.b, c.house ? world.cellToWorld(c.house.i, c.house.j) : null)) continue;
        const exact = hardBlockers(propsApi.setPieceBlockers({ type: spec.type, x: c.x, z: c.z, rot: c.rot, w: spec.w, d: spec.d }));
        if (++tried > 60) break;
        if (exact.length) { lastHard = exact.slice(0, 3).join(' '); continue; }
        // Preferred camera side. Skate / farm: the side that looks toward the block corner. Garden (LOOP c6): always
        // 'heroAlt' = the -u (west) side - the hero house is shot at golden hour (tod 17.7), when the sun stands low
        // in the west, so that is the side whose camera sees the lit gable and has the sun behind it; the east camera
        // looks into the low sun over the house's shadow side (chooseCameras falls back to it only when occluded).
        chosen = { ...c, key, corner, side: spec.house ? 'heroAlt' : side, quad: [nodes.NW, nodes.NE, nodes.SE, nodes.SW].map((n) => ({ x: n.x, z: n.z })) };
        break;
      }
      if (chosen) break;
      misses.push(`${spec.type}@${key}/${corner} (${cands.length} cands, ${tried} exact${lastHard ? ', last: ' + lastHard : ''})`);
    }
    if (!chosen) { misses.push(`${spec.type}: no site`); continue; }
    const cells = rectCells(world, chosen.b);
    for (const { i, j } of cells) reserved.add(j * W + i);
    let house = null;
    if (chosen.house) {
      reserved.add(chosen.house.j * W + chosen.house.i);
      house = { id: HOUSE_ID, i: chosen.house.i, j: chosen.house.j, seed: rng.pick(HOUSE_SEEDS) };
    }
    pieces.push({
      type: spec.type, id: spec.id, x: +chosen.x.toFixed(3), z: +chosen.z.toFixed(3), rot: chosen.rot, w: spec.w, d: spec.d,
      block: chosen.key, corner: chosen.corner, prefer: chosen.side, cells: cells.length, house, quad: chosen.quad,
    });
  }
  return { pieces, misses };
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 2 (after warm-up): house + placement, park land, town infill, hero cameras.

// LOOP c6: the garden's hero camera, composed around the hero house (the props registry camera for 'garden' frames
// the whole deck from 23.5 m at pitch 0.40: the house is 31.8 m away and ~375 px tall, too small for its porch,
// balusters, dormers and siding to read). House-relative metres: the eye stands `lateral` to one side of the house's
// centre line and `back` in front of its centre (inside the garden, right of the pergola as seen from the west), at
// eave height; it aims a little past the house's far side and in front of its porch, so the house sits centre-left,
// the path leads to the door and pergola / table / beds / figures fill the foreground. 18.2 m from the house centre,
// about 20 degrees off the front normal: the porch stays clear of the pergola (a wider 3/4 puts the pergola in front
// of the porch's west half, measured in the lab frames).
const GARDEN_HERO = { lateral: 6.5, back: 17, eye: 5.8, aimLateral: 1.2, aimBack: 3, fov: 44, top: 0.9 };

/** Vertical NDC extent of a house's footprint box (cell inset 0.75 m, floor..height) through a camera spec. */
function houseSpanY(world, b, gy, cam) {
  const cs = world.cellSize;
  const pc = new THREE.PerspectiveCamera(cam.fov, 16 / 9, 0.5, 4000);
  pc.position.set(...cam.pos);
  pc.lookAt(new THREE.Vector3(...cam.target));
  pc.updateMatrixWorld();
  pc.updateProjectionMatrix();
  const x0 = world.minX + b.i * cs, z0 = world.minZ + b.j * cs, h = b.height || 8;
  let min = Infinity, max = -Infinity;
  const v = new THREE.Vector3();
  for (const dx of [0.75, cs - 0.75]) for (const dz of [0.75, cs - 0.75]) for (const dy of [0, h]) {
    v.set(x0 + dx, gy + dy, z0 + dz).project(pc);
    if (v.y < min) min = v.y;
    if (v.y > max) max = v.y;
  }
  return { min, max };
}

/** The garden hero camera on one side of the house (side +1 = 'hero' / +u / east, -1 = 'heroAlt' / -u / west). The
 * aim height is solved so the top of the house's box sits at GARDEN_HERO.top of the half-frame whatever the house's
 * height (the chimney draw moves it 8.6 -> 9.4 m), i.e. the house is always whole inside the frame. Pure function of
 * the house record + the registry entry, so every caller gets the same camera. Null when the house is gone. */
function gardenHero(ctx, e, houseId, side) {
  const world = ctx.world, b = world.buildings.get(houseId);
  if (!b || !e) return null;
  const G = GARDEN_HERO;
  const c = world.cellToWorld(b.i, b.j);
  const gy = surfaceAt(ctx, c.x, c.z);
  // eye above whichever is higher, the house floor or the garden deck's ground (a deck can sit a terrace above)
  const base = Math.max(gy, Number.isFinite(e.deckY) ? e.deckY - 0.3 : gy);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const pos = [r3(c.x + side * G.lateral), r3(base + G.eye), r3(c.z + G.back)];
  const tx = r3(c.x - side * G.aimLateral), tz = r3(c.z + G.aimBack);
  // raising the aim point lowers the house in the frame: bisect the aim height for box top == G.top. The aim stays
  // below the eye (MapControls' polar clamp lifts an eye that sits under its target).
  let lo = base + 0.5, hi = pos[1] - 0.4;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (houseSpanY(world, b, gy, { pos, target: [tx, mid, tz], fov: G.fov }).max > G.top) lo = mid; else hi = mid;
  }
  return { pos, target: [tx, r3((lo + hi) / 2), tz], fov: G.fov };
}

/**
 * THE hero cameras of a placed piece: { hero, heroAlt } (hero = camera on the +u side, heroAlt = -u). `e` is the live
 * props registry entry (props.api.setPieces()), `houseId` the piece's hero house (garden) or null. Everything that
 * needs a set-piece camera - the 'demo:sp-*' presets, demo.api.setPieces(), chooseCameras() and the final occlusion
 * report - calls this, so they cannot disagree.
 */
export function heroCameras(ctx, e, houseId = null) {
  if (!e) return { hero: null, heroAlt: null };
  if (e.type === 'garden' && houseId) {
    const hero = gardenHero(ctx, e, houseId, 1), heroAlt = gardenHero(ctx, e, houseId, -1);
    if (hero && heroAlt) return { hero, heroAlt };
  }
  return { hero: e.hero, heroAlt: e.heroAlt };
}

/** Building-occlusion fan for a camera: 5×3 rays over the 16:9 frame (vertical fov). A ray counts as occluded when
 * world.raycastScene() stops on a building nearer than 85 % of the camera→target distance — i.e. a building
 * standing between the camera and the subject (foreground wall/roof), not the town behind it, which is wanted
 * context. `subjectId` (the garden's hero house) is the subject itself: it never counts as an occluder, and the
 * ray from the eye to its mid-height must meet it before any other building, else the centre counts as blocked.
 * Returns { blocked: rays occluded (of 15, +1 for a blocked subject ray), centre: the centre / subject ray is blocked }. */
export function occlusion(ctx, cam, subjectId = null) {
  const world = ctx.world;
  if (!cam) return { blocked: -1, centre: false };
  const pos = new THREE.Vector3(...cam.pos), tgt = new THREE.Vector3(...cam.target);
  const fwd = tgt.clone().sub(pos);
  const dist = fwd.length();
  fwd.normalize();
  const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
  const tv = Math.tan(((cam.fov || 50) * Math.PI) / 360), th = tv * (16 / 9);
  let blocked = 0, centre = false;
  for (const sy of [-0.9, 0, 0.9]) {
    for (const sx of [-0.9, -0.45, 0, 0.45, 0.9]) {
      const dir = fwd.clone().addScaledVector(right, sx * th).addScaledVector(up, sy * tv).normalize();
      const hit = world.raycastScene(new THREE.Ray(pos.clone(), dir), 400);
      if (!hit || !hit.buildingId || hit.buildingId === subjectId || pos.distanceTo(hit.point) >= dist * 0.85) continue;
      blocked++;
      if (sx === 0 && sy === 0) centre = true;
    }
  }
  const subject = subjectId ? world.buildings.get(subjectId) : null;
  if (subject) {
    const c = world.cellToWorld(subject.i + ((subject.w || 1) - 1) / 2, subject.j + ((subject.d || 1) - 1) / 2);
    const mid = new THREE.Vector3(c.x, surfaceAt(ctx, c.x, c.z) + (subject.height || 8) * 0.5, c.z);
    const first = world.raycastBuildings(new THREE.Ray(pos.clone(), mid.sub(pos).normalize()), 400);
    if (!first || first.id !== subjectId) { centre = true; blocked++; }
  }
  return { blocked, centre };
}

/** Phase 2: add the garden's hero house and place each reserved piece. Returns the registry rows. */
export function placeSetPieces(ctx, plan) {
  const propsApi = ctx.modules.get('props')?.api;
  const world = ctx.world;
  const out = [];
  if (!propsApi?.placeSetPiece || !plan?.pieces?.length) return out;
  for (const p of plan.pieces) {
    if (p.house && !world.buildings.has(p.house.id)) {
      const c = world.cellAt(p.house.i, p.house.j);
      if (c && c.type === 'none' && !c.buildingId) {
        // LOOP c6: `landmark: true` makes buildings generate the full house vocabulary (two storeys, 4-post porch with
        // balusters, 2 dormers, clapboard siding, shutters, flower boxes) whatever the seed drew, and never level it
        // up; `colors` pins the palette so the hero house is the same on every world seed (both names are already in
        // the house chunk's merge buckets, so they add no draw call - buildings critic, core-requests/buildings-c6).
        world.addBuilding({
          id: p.house.id, i: p.house.i, j: p.house.j, w: 1, d: 1, zone: 'r', level: 1, kind: 'house', seed: p.house.seed,
          landmark: true, colors: { ...HOUSE_COLORS },
        });
      }
    }
    const spec = { type: p.type, id: p.id, x: p.x, z: p.z, rot: p.rot, w: p.w, d: p.d };
    // Re-verify on the warmed-up city. `force` is passed ONLY when every remaining blocker is a verge
    // ('cell:road:i,j') entry — no road footprint ('road:<edge>'), no building, no zoning, no water.
    const blockers = propsApi.setPieceBlockers(spec);
    const hard = hardBlockers(blockers);
    if (hard.length) {
      ctx.log(`[demo] set-piece ${p.id} skipped: ${hard.slice(0, 6).join(', ')}`);
      out.push({ ...p, placed: false, blockers: hard.slice(0, 12) });
      continue;
    }
    const entry = propsApi.placeSetPiece({ ...spec, force: blockers.length > 0 });
    if (!entry) { out.push({ ...p, placed: false, blockers: [] }); continue; }
    out.push({ ...p, placed: true, verge: blockers.length, entry });
  }
  return out;
}

/** Choose hero vs heroAlt for each placed piece: the preferred side unless its fan is more occluded. Runs on the
 * final city (after the infill), with the cameras heroCameras() returns - the ones the presets ship. */
export function chooseCameras(ctx, rows) {
  const propsApi = ctx.modules.get('props')?.api;
  const reg = new Map((propsApi?.setPieces?.() || []).map((e) => [e.id, e]));
  for (const r of rows) {
    if (!r.placed) continue;
    const e = reg.get(r.id);
    if (!e) { r.placed = false; continue; }
    const houseId = r.house ? r.house.id : null;
    const cams = heroCameras(ctx, e, houseId);
    const occ = { hero: occlusion(ctx, cams.hero, houseId), heroAlt: occlusion(ctx, cams.heroAlt, houseId) };
    const pref = r.prefer, other = pref === 'hero' ? 'heroAlt' : 'hero';
    const bad = (o) => (o.centre ? 100 : 0) + o.blocked;
    r.camera = bad(occ[other]) < bad(occ[pref]) ? other : pref;
    r.occlusion = { hero: occ.hero, heroAlt: occ.heroAlt };
  }
  return rows;
}

/** A piece's ground bounds: its rect plus (garden) its hero house cell. */
function pieceBounds(world, r) {
  const b = rectBounds(r.x, r.z, r.rot, r.w, r.d);
  if (r.house) {
    const cs = world.cellSize, c = world.cellToWorld(r.house.i, r.house.j);
    b.x0 = Math.min(b.x0, c.x - cs / 2); b.x1 = Math.max(b.x1, c.x + cs / 2);
    b.z0 = Math.min(b.z0, c.z - cs / 2); b.z1 = Math.max(b.z1, c.z + cs / 2);
  }
  return b;
}

/**
 * LOOP c6 (A3): stamp the leftover land of every block that hosts a placed piece as park. Those are the suburb's
 * park / plaza blocks: only their central square was ever park, the rest is never-zoned 'none' land that rendered as
 * bare stud baseplate beside and behind the set-pieces. As park cells, props dresses them the way it dresses every
 * park (flushParkClusters -> populatePark: trees at 0.8 per cell, benches, flower beds, a hedge along the cluster's
 * bounding box, a figure knot).
 *
 * A cell is stamped when it is 'none' land inside the host block's (jittered) quad and
 *  - is not a set-piece cell (the rect covers the cell's centre), the hero house cell or one of that house's 8
 *    neighbours (its own yard, dressed by dressHouseYard below). Rim cells a rect only clips are stamped: they are
 *    the strips of baseplate right beside a piece, and props evicts anything that lands inside a set-piece rect;
 *  - does not touch an existing park cell (4-neighbour): props clusters park cells by 4-connectivity and re-scatters a
 *    cluster whose size changes, so the one-cell moat keeps the plaza / park square's own clusters - fountains
 *    included - exactly as they were;
 *  - lies >= CIVIC_PROP_CLEAR from every civic centre (core/composition.js ranks the shipped `closeup` subjects by
 *    props within 34 m; park props near a civic would re-rank them);
 *  - is not in a piece's forecourt: the strip FORECOURT_DEPTH deep in front of its front (+v) edge, FORECOURT_SIDE
 *    past each corner. Both hero cameras of a piece stand over that strip looking in, so a park tree there would
 *    stand between the camera and the subject; it stays open ground, as before.
 *
 * Runs after the warm-up, like the infill: the 600-tick warm-up economy (simulation's park coverage) is the
 * pre-cycle one. Returns { cells, blocks: { key: n } }.
 */
export function stampParkLand(ctx, rows) {
  const world = ctx.world, cs = world.cellSize, W = world.size.w;
  const placed = rows.filter((r) => r.placed && r.quad);
  const out = { cells: 0, blocks: {} };
  if (!placed.length) return out;
  const skip = new Set();
  for (const r of rows) {
    const rb = rectBounds(r.x, r.z, r.rot, r.w, r.d);
    for (const { i, j } of rectCells(world, rb)) {
      const p = world.cellToWorld(i, j);
      const centreIn = p.x > rb.x0 && p.x < rb.x1 && p.z > rb.z0 && p.z < rb.z1;
      if (centreIn) skip.add(j * W + i);
    }
    if (r.house) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) skip.add((r.house.j + dj) * W + r.house.i + di);
  }
  const civics = civicCentres(world);
  const civicNear = (x0, z0) => civics.some((c) => Math.hypot(Math.max(x0 - c.x, 0, c.x - x0 - cs), Math.max(z0 - c.z, 0, c.z - z0 - cs)) < CIVIC_PROP_CLEAR);
  const inForecourt = (x, z) => rows.some((r) => {
    if (!r.placed) return false;
    const dx = x - r.x, dz = z - r.z, c = Math.cos(r.rot), s = Math.sin(r.rot);
    const u = dx * c - dz * s, v = dx * s + dz * c; // set-piece local (u right, v front) - props' spLocal
    return v > r.d / 2 - cs / 2 && v <= r.d / 2 + FORECOURT_DEPTH && Math.abs(u) <= r.w / 2 + FORECOURT_SIDE;
  });
  const inQuad = (q, x, z) => {
    let sign = 0;
    for (let k = 0; k < 4; k++) {
      const a = q[k], b = q[(k + 1) % 4];
      const cr = (b.x - a.x) * (z - a.z) - (b.z - a.z) * (x - a.x);
      if (Math.abs(cr) < 1e-9) continue;
      if (sign && Math.sign(cr) !== sign) return false;
      sign = Math.sign(cr);
    }
    return true;
  };
  const blocks = new Map();
  for (const r of placed) if (!blocks.has(r.block)) blocks.set(r.block, r.quad);
  const todo = [];
  for (const [key, q] of blocks) {
    const qb = { x0: Math.min(...q.map((n) => n.x)), x1: Math.max(...q.map((n) => n.x)), z0: Math.min(...q.map((n) => n.z)), z1: Math.max(...q.map((n) => n.z)) };
    const a = world.worldToCell(qb.x0, qb.z0), b = world.worldToCell(qb.x1, qb.z1);
    let n = 0;
    for (let j = a.j; j <= b.j; j++) {
      for (let i = a.i; i <= b.i; i++) {
        const c = world.cellAt(i, j);
        if (!c || c.type !== 'none' || c.zone || c.buildingId || skip.has(j * W + i)) continue;
        const p = world.cellToWorld(i, j);
        if (!inQuad(q, p.x, p.z)) continue;
        const nb = [world.cellAt(i + 1, j), world.cellAt(i - 1, j), world.cellAt(i, j + 1), world.cellAt(i, j - 1)];
        if (nb.some((o) => o && o.type === 'park')) continue;       // moat: never join an existing park cluster
        if (civicNear(p.x - cs / 2, p.z - cs / 2)) continue;          // keep the closeup ranking
        if (inForecourt(p.x, p.z)) continue;                           // keep the approach side open
        todo.push({ i, j });
        n++;
      }
    }
    out.blocks[key] = n;
  }
  // collected first, stamped after: the moat test above must only ever see the parks that existed before
  for (const { i, j } of todo) world.setCell(i, j, { type: 'park' });
  out.cells = todo.length;
  return out;
}

/**
 * LOOP c6: plant the hero house's two side yards - the strips between the house cell and the garden rect's side
 * edges, north of the deck. They are usually road-verge cells (type 'road', outside the rendered footprint), which
 * cannot be park-stamped, and they read as bare baseplate right beside the house in the hero frame. Per side: a
 * hedge row along the back (street) side, one tree and one flower bed, as plain world props with explicit ids
 * (`demo-sp-yard-<n>`: no prop id of the rest of the city shifts) that props renders like any other.
 * Every item is placed only where it stands clear of every road's rendered footprint, of buildings, of the
 * set-piece rects and of the street furniture already there; a hedge segment steps toward the garden until it is
 * off the sidewalk. The layout keeps to the outer 4 m of each yard (>= 8.2 m from the house's centre line): props'
 * own C2 yard dressing (fences at 7 m, beds / tables inside that) owns the inner part, and C2 props are ignored by
 * the clearance test, so these props are the same with and without the C2 layer (check-detail part 2).
 * Returns the number of props added.
 */
export function dressHouseYard(ctx, rows) {
  const world = ctx.world, cs = world.cellSize;
  const segs = roadSegments(ctx);
  let n = 0;
  for (const r of rows) {
    if (!r.placed || !r.house || !world.buildings.has(r.house.id)) continue;
    const c = world.cellToWorld(r.house.i, r.house.j);
    const near = segs.filter((e) => pointSegDist(c.x, c.z, e.ax, e.az, e.bx, e.bz) < e.fp + 40);
    const rects = rows.filter((q) => q.placed).map((q) => rectBounds(q.x, q.z, q.rot, q.w, q.d));
    const free = (x, z, clear, gap) => {
      const cell = world.cellAtWorld(x, z);
      if (!cell || cell.buildingId || cell.type === 'water') return false;
      if (near.some((e) => pointSegDist(x, z, e.ax, e.az, e.bx, e.bz) < e.fp + clear)) return false;
      if (rects.some((b) => x > b.x0 - 0.3 && x < b.x1 + 0.3 && z > b.z0 - 0.3 && z < b.z1 + 0.3)) return false;
      for (const p of world.props.values()) {
        if (typeof p.id === 'string' && p.id.startsWith('c2p:')) continue;
        if (Math.abs(p.x - x) < gap && Math.abs(p.z - z) < gap && Math.hypot(p.x - x, p.z - z) < gap) return false;
      }
      return true;
    };
    const put = (kind, x, z, rot, clear, gap) => {
      if (!free(x, z, clear, gap)) return false;
      world.addProp({ id: `demo-sp-yard-${n}`, kind, x, y: surfaceAt(ctx, x, z), z, rot });
      n++;
      return true;
    };
    for (const s of [-1, 1]) {
      // hedge row (2 m segments along x) across the outer yard, up to the garden rect's side edge
      for (const off of [cs + 1.2, cs + 3.2]) {
        for (const dz of [-3, -2, -1, 0]) if (put('hedge', c.x + s * off, c.z + dz, 0, 0.7, 1.0)) break;
      }
      if (!put('tree_medium', c.x + s * (cs + 1.8), c.z + 1.4, 0, 1.2, 1.5)) put('tree_small', c.x + s * (cs + 1.8), c.z + 2.6, 0, 0.8, 1.2);
      put('flower_bed', c.x + s * (cs + 2.8), c.z + 3.0, 0, 0.8, 1.2);
    }
  }
  return n;
}

/**
 * LOOP c6 (A4): town infill around each placed piece, independent of any camera. The road-facing r-zoned lots the
 * boot city leaves empty (fillBlock's fillChance) get level-1 houses when their centre is within INFILL_RADIUS of the
 * piece's bounds - nearest to its back edge first, at most `maxPerPiece` per piece. (Cycle 5 gated lots on the chosen
 * hero camera's frustum, so houses existed only where that one camera looked and moving a camera silently re-planted
 * the town.)
 * Kept from cycle 5: explicit ids `demo-sp-infill-<piece>-<n>` (no existing building id shifts), every other lot
 * along a row (yards stay between houses), the 56 m civic clearance, the cap of 14, a deterministic order (distance
 * to the back edge, then j, i),
 * houses added after the warm-up (the warm-up economy is the pre-cycle one). New: a lot must be flat (flatLot - no
 * terrace step inside the cell, which buried porches) and clear of every road's rendered footprint (cycle 5 could
 * build on a lot the sidewalk cuts into: roads only turns those cells into 'road' on its first update).
 * No lot can stand between a hero camera and its subject: the pieces sit in never-zoned park blocks, both cameras
 * of a piece stand inside its block, and r lots only exist across the streets (chooseCameras runs after this and
 * reports the fan on the final city).
 */
export function infillAround(ctx, rows, rng, maxPerPiece = INFILL_MAX) {
  const world = ctx.world, cs = world.cellSize;
  // core/composition.js scores civic closeup subjects by buildings within 55 m (x10): an infill house there would
  // re-rank the shipped `closeup` preset's subject (measured on seed 1: fire_department b368 overtook hospital
  // b388), so lots within 56 m of a civic building are never infilled.
  const civics = civicCentres(world);
  const nearCivic = (x, z) => civics.some((c) => Math.hypot(c.x - x, c.z - z) < 56);
  const segs = roadSegments(ctx);
  let total = 0;
  for (const r of rows) {
    if (!r.placed) continue;
    const b = pieceBounds(world, r);
    const R = INFILL_RADIUS;
    // Order: nearest to the piece's BACK edge first (the -v side of its bounds: the street side, away from its
    // front). A piece is composed to be looked at from its front, so its back is where the town shows behind it,
    // whichever of its cameras - or a player - looks. Still a function of the piece's rect and rotation only.
    const cr = Math.cos(r.rot), sr = Math.sin(r.rot);
    const lc = [[b.x0, b.z0], [b.x1, b.z0], [b.x1, b.z1], [b.x0, b.z1]].map(([x, z]) => ({ u: (x - r.x) * cr - (z - r.z) * sr, v: (x - r.x) * sr + (z - r.z) * cr }));
    const u0 = Math.min(...lc.map((q) => q.u)), u1 = Math.max(...lc.map((q) => q.u)), vBack = Math.min(...lc.map((q) => q.v));
    const backDist = (x, z) => {
      const u = (x - r.x) * cr - (z - r.z) * sr, v = (x - r.x) * sr + (z - r.z) * cr;
      return Math.hypot(Math.max(u0 - u, 0, u - u1), v - vBack);
    };
    const near = segs.filter((e) => segRectDist(e.ax, e.az, e.bx, e.bz, { x0: b.x0 - R - cs, x1: b.x1 + R + cs, z0: b.z0 - R - cs, z1: b.z1 + R + cs }) <= e.fp + 1);
    const c0 = world.worldToCell(b.x0 - R, b.z0 - R), c1 = world.worldToCell(b.x1 + R, b.z1 + R);
    const cand = [];
    for (let j = c0.j; j <= c1.j; j++) {
      for (let i = c0.i; i <= c1.i; i++) {
        const c = world.cellAt(i, j);
        if (!c || c.type !== 'zone' || c.zone !== 'r' || c.buildingId) continue;
        const p = world.cellToWorld(i, j);
        const d = Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.z0 - p.z, 0, p.z - b.z1));
        if (d > R) continue;
        const n = [world.cellAt(i + 1, j), world.cellAt(i - 1, j), world.cellAt(i, j + 1), world.cellAt(i, j - 1)];
        if (!n.some((q) => q && q.type === 'road')) continue;                        // road-served lot only
        if (nearCivic(p.x, p.z)) continue;                                            // keep closeup ranking
        if (!flatLot(ctx, i, j)) continue;                                            // no step inside the cell
        if (!houseClearOfRoads(world, i, j, near)) continue;                         // walls off every sidewalk
        cand.push({ i, j, k: backDist(p.x, p.z) });
      }
    }
    cand.sort((p, q) => p.k - q.k || p.j - q.j || p.i - q.i);
    let n = 0;
    for (const { i, j } of cand) {
      if (n >= maxPerPiece) break;
      // keep a yard between houses (also re-checks earlier picks of this loop and of the previous pieces)
      const nb = [world.cellAt(i + 1, j), world.cellAt(i - 1, j), world.cellAt(i, j + 1), world.cellAt(i, j - 1)];
      if (nb.some((q) => q && q.buildingId) || world.cellAt(i, j).buildingId) continue;
      world.addBuilding({ id: `demo-sp-infill-${r.type}-${n}`, i, j, w: 1, d: 1, zone: 'r', level: 1, seed: rng.int(0, 1e9) });
      n++;
    }
    r.infill = n;
    total += n;
  }
  return total;
}
