// props — minifig-scale Lego street furniture and nature. Renders world.props (all instanced, grouped by
// role) and auto-populates streetlamps/traffic lights/street furniture along roads and at intersections, plus
// seeded park scatter, in the full game (never in showcase — showcase stages its scenes explicitly).
import * as THREE from 'three';
import { KIND_NAMES, buildRoleGeometry, buildKindParts, SHARED_GEOMETRY_ROLES, FOUNTAIN_WATER_Y } from './kinds.js';
import { buildRoleMaterials } from './materials.js';
import { mat } from './geo.js';
import { populateAlongRoad, populateIntersectionNode, populatePark } from './populate.js';
import { stageStreet, stagePark, PRESETS } from './showcase.js';

const KIND_SET = new Set(KIND_NAMES);
const LOD_NEAR = 170, LOD_FAR = 220, LOD_MOVE = 6;
const LIGHT_POOL_SIZE = 14;
const LIGHT_REFRESH = 0.4; // s
const TRAFFIC_CYCLE = { green: 5.0, yellow: 1.5, red: 5.5 };
const TRAFFIC_TOTAL = TRAFFIC_CYCLE.green + TRAFFIC_CYCLE.yellow + TRAFFIC_CYCLE.red;
const FLOWER_COLORS = ['brightRed', 'brightYellow', 'mediumLilac', 'brightPink', 'mediumAzur', 'brightOrange'];
const FADE_EXEMPT = (role) => role.startsWith('busstop') || role.startsWith('trafficlight') || role.startsWith('fountain');

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
  parkDirty: new Set(), parkFlushAt: 0, parkClusters: new Map(),
  waterMat: null,
};

function fadeFactor(d) {
  if (d <= LOD_NEAR) return 1;
  if (d >= LOD_FAR) return 0.02;
  const t = (d - LOD_NEAR) / (LOD_FAR - LOD_NEAR);
  return 1 - t * 0.98;
}

// Sidewalk top sits ~0.19 m above the lane-height snapToRoad() returns (roads/network.js Y.sidewalk - Y.lane);
// every prop kind we place is sidewalk/verge furniture, never on the carriageway itself, so lift by that much.
const SIDEWALK_LIFT = 0.19;

function resolveHeight(ctx, x, z) {
  const roads = ctx.modules.get('roads');
  if (roads?.status === 'ok' && typeof roads.api.snapToRoad === 'function') {
    const s = roads.api.snapToRoad(x, z, 6);
    if (s) return s.y + SIDEWALK_LIFT;
  }
  const terrain = ctx.modules.get('terrain');
  if (terrain?.status === 'ok' && typeof terrain.api.surfaceHeight === 'function') {
    const h = terrain.api.surfaceHeight(x, z);
    if (Number.isFinite(h)) return h;
  }
  return ctx.world.getHeight(x, z);
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
    const prng = S.rng.fork(prop.id);
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
  S.trafficPhaseName = null; // force the traffic lenses to re-apply their intensity for the new day/night state
}

function updateTrafficPhase(dt) {
  S.trafficPhase = (S.trafficPhase + dt) % TRAFFIC_TOTAL;
  let t = S.trafficPhase, phase;
  if (t < TRAFFIC_CYCLE.green) phase = 'green';
  else if ((t -= TRAFFIC_CYCLE.green) < TRAFFIC_CYCLE.yellow) phase = 'yellow';
  else phase = 'red';
  if (phase === S.trafficPhaseName) return;
  S.trafficPhaseName = phase;
  const night = S.ctx.clock.isNight;
  for (const name of ['red', 'yellow', 'green']) {
    const role = S.roleTable.get(`trafficlight-lens-${name}`);
    if (!role) continue;
    const on = name === phase;
    role.material.emissiveIntensity = on ? (night ? role.dynamic.night : role.dynamic.day) : 0.12;
  }
}

// ---- auto-population (full game only; showcase stages its own scenes explicitly) ---------------------------
function maybeSignalIntersections() {
  const ctx = S.ctx;
  const roads = ctx.modules.get('roads');
  if (roads?.status !== 'ok') return;
  for (const node of roads.api.getIntersections()) {
    if (node.arms.length < 3 || S.signaledNodes.has(node.nodeId)) continue;
    S.signaledNodes.add(node.nodeId);
    populateIntersectionNode(ctx, api.addProp, S.rng, roads.api, node);
  }
}

function onRoadAdded({ edgeId }) {
  populateAlongRoad(S.ctx, api.addProp, S.rng, edgeId);
  maybeSignalIntersections();
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
    const propIds = populatePark(S.ctx, api.addProp, S.rng, cells);
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
  populatePark(cells) { return populatePark(S.ctx, api.addProp, S.rng, cells); },
  stats() {
    const byKind = {};
    for (const p of S.ctx.world.props.values()) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
    let drawCalls = 0;
    for (const def of S.roleTable.values()) if (def.mesh?.count) drawCalls++;
    drawCalls += S.fountains.length;
    return { count: S.ctx.world.props.size, byKind, drawCalls };
  },
};

export default {
  id: 'props',
  deps: ['terrain', 'roads'],
  order: 45,
  api,
  showcaseVariants: ['default', 'park', 'night'],
  presets: PRESETS,

  async init(ctx) {
    S.ctx = ctx;
    S.rng = ctx.rng.fork('props');
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

    S.unsub.push(ctx.events.on('prop:added', markDirty));
    S.unsub.push(ctx.events.on('prop:removed', markDirty));
    S.unsub.push(ctx.events.on('time:changed', ({ isNight }) => {
      if (isNight !== S.wasNight) { S.wasNight = isNight; applyNightMaterials(isNight); }
    }));

    if (!ctx.showcase) {
      S.unsub.push(ctx.events.on('road:added', onRoadAdded));
      S.unsub.push(ctx.events.on('world:cell', ({ i, j, cell }) => onParkCell(i, j, cell)));
      S.unsub.push(ctx.events.on('zone:changed', ({ i, j }) => {
        const c = ctx.world.cellAt(i, j);
        if (c) onParkCell(i, j, c);
      }));
      // pick up any roads/parks that already exist (e.g. a demo city built before props initialised)
      for (const edgeId of ctx.world.roads.edges.keys()) onRoadAdded({ edgeId });
      for (const c of ctx.world.cells) if (c.type === 'park') onParkCell(c.i, c.j, c);
    }

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
    if (variant === 'park') stagePark(ctx, api); else stageStreet(ctx, api);
    S.signaledNodes.clear();
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
    S.signaledNodes.clear(); S.parkClusters.clear(); S.parkDirty.clear();
  },
};
