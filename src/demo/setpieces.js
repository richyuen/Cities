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
//  2. placeSetPieces() runs after the 600-tick warm-up + buildings.settle() (demo/index.js seed()): it adds the
//     garden's house (explicit id, so no building id shifts), re-checks every rect with props.api.setPieceBlockers,
//     places each piece through props.api.placeSetPiece, and picks the hero camera (hero vs heroAlt) with a
//     building-occlusion ray fan. infillFrames() then builds level-1 houses on the empty road-facing r lots that lie
//     inside each chosen hero frame and behind its subject (explicit ids; never between camera and subject).
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

// Two-storey, contrasting-roof house looks (buildings seeds its look from `${seed}:${id}`); the setpieces fork picks
// one, so the garden house is part of the seed's deterministic output.
const HOUSE_SEEDS = [6, 8, 18, 29, 33]; // all two-storey for this id (8 m tall vs 5 m one-storey)
const HOUSE_ID = 'demo-sp-garden-house';
const CIVIC_KINDS = new Set(['school', 'hospital', 'fire_department', 'police_station']);

const MAX_GROUND_RANGE = 1.6;   // metres of terrain relief under a deck (the deck skirt covers it)
const ROAD_CLEAR = 0.6;         // metres between a rect and a road's rendered footprint (sidewalk outer edge)
const CIVIC_PROP_CLEAR = 36;    // metres, rect edge -> civic centre (composition props radius 34 m)
const CIVIC_BLDG_CLEAR = 57;    // metres, house -> civic centre (composition neighbour radius 55 m)

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
  const edges = [];
  for (const e of world.roads.edges.values()) {
    const a = world.roads.nodes.get(e.a), b = world.roads.nodes.get(e.b);
    if (a && b) edges.push({ id: e.id, kind: e.kind, width: e.width, ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
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
            if (ctx.modules.get('terrain')?.api && !ctx.modules.get('terrain').api.isBuildable(hi, hj)) continue;
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
        chosen = { ...c, key, corner, side: spec.house ? (corner.endsWith('E') ? 'heroAlt' : 'hero') : side };
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
      block: chosen.key, corner: chosen.corner, prefer: chosen.side, cells: cells.length, house,
    });
  }
  return { pieces, misses };
}

// ---------------------------------------------------------------------------------------------------------------
// Phase 2 (after warm-up): house + placement + hero camera choice.

/** Building-occlusion fan for a camera: 5×3 rays over the 16:9 frame (vertical fov). A ray counts as occluded when
 * world.raycastScene() stops on a building nearer than 85 % of the camera→target distance — i.e. a building
 * standing between the camera and the subject (foreground wall/roof), not the town behind it, which is wanted
 * context. Returns { blocked: rays occluded (of 15), centre: the centre ray is one of them }. */
export function occlusion(ctx, cam) {
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
      if (!hit || !hit.buildingId || pos.distanceTo(hit.point) >= dist * 0.85) continue;
      blocked++;
      if (sx === 0 && sy === 0) centre = true;
    }
  }
  return { blocked, centre };
}

/** Phase 2: add the garden house, place each reserved piece, choose its hero camera. Returns the registry rows. */
export function placeSetPieces(ctx, plan) {
  const propsApi = ctx.modules.get('props')?.api;
  const world = ctx.world;
  const out = [];
  if (!propsApi?.placeSetPiece || !plan?.pieces?.length) return out;
  for (const p of plan.pieces) {
    if (p.house && !world.buildings.has(p.house.id)) {
      const c = world.cellAt(p.house.i, p.house.j);
      if (c && c.type === 'none' && !c.buildingId) {
        world.addBuilding({ id: p.house.id, i: p.house.i, j: p.house.j, w: 1, d: 1, zone: 'r', level: 1, kind: 'house', seed: p.house.seed });
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

/** Choose hero vs heroAlt for each placed piece: the corner-facing preference unless its fan is more occluded. */
export function chooseCameras(ctx, rows) {
  const propsApi = ctx.modules.get('props')?.api;
  const reg = new Map((propsApi?.setPieces?.() || []).map((e) => [e.id, e]));
  for (const r of rows) {
    if (!r.placed) continue;
    const e = reg.get(r.id);
    if (!e) { r.placed = false; continue; }
    const occ = { hero: occlusion(ctx, e.hero), heroAlt: occlusion(ctx, e.heroAlt) };
    const pref = r.prefer, other = pref === 'hero' ? 'heroAlt' : 'hero';
    const bad = (o) => (o.centre ? 100 : 0) + o.blocked;
    r.camera = bad(occ[other]) < bad(occ[pref]) ? other : pref;
    r.occlusion = { hero: occ.hero, heroAlt: occ.heroAlt };
  }
  return rows;
}

/**
 * Town infill behind each hero frame: the road-facing r-zoned lots the boot city leaves empty (fillBlock's
 * fillChance) get level-1 houses when they are inside the chosen hero camera's frustum and BEHIND the subject
 * (farther from the camera than its target + 10 m, so an infill house can never occlude the set-piece). Every
 * other free lot along a row is used (yards stay between houses). Explicit ids `demo-sp-infill-<piece>-<n>`, so
 * no existing building id shifts; added after the warm-up, so the warm-up economy is the pre-cycle one.
 */
export function infillFrames(ctx, rows, rng, maxPerPiece = 14) {
  const world = ctx.world, cs = world.cellSize;
  const propsApi = ctx.modules.get('props')?.api;
  const reg = new Map((propsApi?.setPieces?.() || []).map((e) => [e.id, e]));
  // core/composition.js scores civic closeup subjects by buildings within 55 m (x10): an infill house there would
  // re-rank the shipped `closeup` preset's subject (measured on seed 1: fire_department b368 overtook hospital
  // b388), so lots within 56 m of a civic building are never infilled.
  const civics = [];
  for (const b of world.buildings.values()) {
    if (CIVIC_KINDS.has(b.kind)) civics.push(world.cellToWorld(b.i + ((b.w || 1) - 1) / 2, b.j + ((b.d || 1) - 1) / 2));
  }
  const nearCivic = (x, z) => civics.some((c) => Math.hypot(c.x - x, c.z - z) < 56);
  let total = 0;
  for (const r of rows) {
    if (!r.placed || !r.camera) continue;
    const cam = reg.get(r.id)?.[r.camera];
    if (!cam) continue;
    const pc = new THREE.PerspectiveCamera(cam.fov || 50, 16 / 9, 0.5, 4000);
    pc.position.set(...cam.pos);
    pc.lookAt(new THREE.Vector3(...cam.target));
    pc.updateMatrixWorld();
    pc.updateProjectionMatrix();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(pc.projectionMatrix, pc.matrixWorldInverse));
    const camXZ = { x: cam.pos[0], z: cam.pos[2] };
    const tDist = Math.hypot(cam.target[0] - camXZ.x, cam.target[2] - camXZ.z);
    const c0 = world.worldToCell(cam.target[0], cam.target[2]);
    const R = 16; // cells (128 m) around the target
    const cand = [];
    for (let j = c0.j - R; j <= c0.j + R; j++) {
      for (let i = c0.i - R; i <= c0.i + R; i++) {
        const c = world.cellAt(i, j);
        if (!c || c.type !== 'zone' || c.zone !== 'r' || c.buildingId) continue;
        const n = [world.cellAt(i + 1, j), world.cellAt(i - 1, j), world.cellAt(i, j + 1), world.cellAt(i, j - 1)];
        if (!n.some((q) => q && q.type === 'road')) continue;                        // road-served lot only
        if (n.some((q) => q && q.buildingId)) continue;                               // keep a yard between houses
        const p = world.cellToWorld(i, j);
        const d = Math.hypot(p.x - camXZ.x, p.z - camXZ.z);
        if (d < tDist + 10 || d > 140) continue;                                     // behind the subject only
        if (nearCivic(p.x, p.z)) continue;                                            // keep closeup ranking
        const y = world.getHeight(p.x, p.z);
        if (!frustum.containsPoint(new THREE.Vector3(p.x, y + 2, p.z))) continue;
        cand.push({ i, j, d });
      }
    }
    cand.sort((a, b) => a.d - b.d || a.j - b.j || a.i - b.i);
    let n = 0;
    for (const { i, j } of cand) {
      if (n >= maxPerPiece) break;
      const nb = [world.cellAt(i + 1, j), world.cellAt(i - 1, j), world.cellAt(i, j + 1), world.cellAt(i, j - 1)];
      if (nb.some((q) => q && q.buildingId) || world.cellAt(i, j).buildingId) continue; // re-check after earlier picks
      world.addBuilding({ id: `demo-sp-infill-${r.type}-${n}`, i, j, w: 1, d: 1, zone: 'r', level: 1, seed: rng.int(0, 1e9) });
      n++;
    }
    r.infill = n;
    total += n;
  }
  return total;
}
