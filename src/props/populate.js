// Deterministic auto-population: streetlamps + low-density street furniture along a road, traffic lights at
// intersections, and a seeded scatter of park furniture. `addProp(kind, x, z, rot)` is the module's own
// api.addProp (it resolves ground/sidewalk height itself), so this file never touches THREE or the renderer.
import { dirToRot } from './geo.js';

const LAMP_SPACING = 24;
const LAMP_INSET = 9;

// Idempotency guard: both this module's own `road:added` listener and external callers (e.g. `tools`, after an
// interactive road placement) may call populateAlongRoad(edgeId) for the same edge more than once. Edge ids are
// never reused (World._ids.edge only increments, even across clearContent()), so a module-level Set is a safe,
// permanent record of "already furnished" edges — a second call on the same id is a no-op instead of doubling
// every lamp/bin/bench on it.
const populatedEdges = new Set();

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

/** Seeded Poisson-disc-ish scatter of park furniture over a set of {i,j} park cells. Returns created prop ids. */
export function populatePark(ctx, addProp, rngRoot, cells) {
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
  return created;
}
