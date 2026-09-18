// Save-file shape (v1) and world replay. No DOM. Terrain height is NOT serialized — Load reuses the same full
// reload mechanism as New City (same seed + demoActive -> identical deterministic terrain; demoActive must be
// replayed too since it decides whether the plateau/river/coast are pinned to the origin or seed-varied — see
// terrain/heightgen.js resolveParams), then this module replays content on top via World's existing public
// mutators, exactly the way src/demo/citygen.js builds a city from scratch.
export const SAVE_VERSION = 1;

function mod(ctx, id) {
  const m = ctx.modules.get(id);
  return m?.status === 'ok' ? m.api : null;
}

export function serializeSave(ctx, { name }) {
  const world = ctx.world;
  const roads = [];
  for (const e of world.roads.edges.values()) {
    const a = world.roads.nodes.get(e.a), b = world.roads.nodes.get(e.b);
    if (!a || !b) continue;
    roads.push({ a: { x: a.x, z: a.z }, b: { x: b.x, z: b.z }, kind: e.kind });
  }
  const zones = [];
  const parks = [];
  for (const c of world.cells) {
    if (c.zone) zones.push({ i: c.i, j: c.j, zone: c.zone, density: c.density });
    else if (c.type === 'park') parks.push({ i: c.i, j: c.j, parkKind: c.parkKind ?? null });
  }
  const buildings = [...world.buildings.values()].map((b) => ({ ...b }));
  const props = [...world.props.values()].map((p) => ({ ...p }));

  return {
    version: SAVE_VERSION,
    name: name || 'Untitled City',
    savedAt: Date.now(),
    seed: ctx.seed,
    demoActive: ctx.demoActive !== false,
    clock: { hours: ctx.clock.hours, timeScale: ctx.clock.timeScale },
    camera: { pos: ctx.camera.position.toArray(), target: ctx.controls.target.toArray() },
    weather: { ...world.weather },
    roads, zones, parks, buildings, props,
    simulation: mod(ctx, 'simulation')?.getState?.() ?? null,
  };
}

export function applySave(ctx, save) {
  if (!save) return;
  const world = ctx.world;
  world.clearContent();
  for (const r of save.roads || []) world.addRoad(r.a, r.b, r.kind);
  for (const z of save.zones || []) world.setZone(z.i, z.j, z.zone, z.density);
  for (const p of save.parks || []) world.setCell(p.i, p.j, { type: 'park', parkKind: p.parkKind ?? undefined });
  for (const b of save.buildings || []) world.addBuilding(b);
  for (const p of save.props || []) world.addProp(p);
  if (save.weather) world.setWeather(save.weather);
  mod(ctx, 'simulation')?.loadState?.(save.simulation);
  if (save.clock) {
    ctx.clock.set(save.clock.hours);
    ctx.clock.timeScale = save.clock.timeScale ?? 1;
  }
  if (save.camera) ctx.cameraApi.apply({ pos: save.camera.pos, target: save.camera.target });
}
