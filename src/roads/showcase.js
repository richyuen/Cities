import * as THREE from 'three';

// Demo network for the roads showcase. Deterministic; uses only ctx.world mutators (+ a fallback ground
// plane when the terrain module is not present so the screenshots are not floating in the void).

/** Gentle showcase terrain: flat plateau under the grid, rolling slope under the highway. */
export function stageTerrain(ctx) {
  const world = ctx.world;
  const rng = ctx.rng.fork('roads-showcase');
  const w = world.size.w, h = world.size.h, w1 = w + 1;
  const arr = new Float32Array(w1 * (h + 1));
  for (let j = 0; j <= h; j++) {
    for (let i = 0; i <= w; i++) {
      const x = world.minX + i * world.cellSize, z = world.minZ + j * world.cellSize;
      // rolling base
      let y = 1.6 * rng.fbm(x / 140 + 3.1, z / 140 - 7.7, 3);
      // slope + hill under the highway (z > 150)
      const s = smooth((z - 130) / 90);
      const hill = 6 * s * (0.55 + 0.45 * Math.cos((x + 60) / 90)) + 4 * s * smooth((x + 40) / 240);
      y += hill;
      // flatten the grid area; lift everything above the terrain module's sea level (0) and quantize to its 0.4 m plates
      const flat = 1 - smooth((Math.max(Math.abs(x) - 150, Math.abs(z) - 120)) / 40);
      y = y * (1 - flat) + 0.0 * flat + 2.0;
      arr[j * w1 + i] = Math.round(y / 0.4) * 0.4;
    }
  }
  world.setHeightField(arr);
}

function smooth(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

export function stageNetwork(ctx, variant) {
  const add = (a, b, kind = 'street', oneway = 0) => ctx.world.addRoad({ x: a[0], z: a[1] }, { x: b[0], z: b[1] }, kind, { oneway });
  // Explicit grid stage: each line is added as segments between crossings. Since the junction rework, addRoad
  // splits edges at crossings on its own, so this manual segmentation is just the legacy spelling of the same
  // network — the `junction` variant below exercises the auto-stitching path instead.
  const grid = (xs, zs, kindOf) => {
    for (const x of xs) for (let k = 0; k < zs.length - 1; k++) add([x, zs[k]], [x, zs[k + 1]], kindOf('v', x));
    for (const z of zs) for (let k = 0; k < xs.length - 1; k++) add([xs[k], z], [xs[k + 1], z], kindOf('h', z));
  };
  if (variant === 'intersection') {
    grid([-96, -48, 0, 48, 96], [-64, 0, 64], (o, v) => (o === 'h' && v === 0 ? 'avenue' : 'street'));
    add([-96, -64], [-96, -110], 'street');
    add([96, 64], [96, 110], 'street');
    return;
  }
  if (variant === 'junction') {
    // Player-style sketch: one drag per line, endpoints dropped onto existing roads. Before the junction rework
    // these were dead-end stubs (cul-de-sac bulbs on the carriageway) and unconnected crossings; the contract is
    // now that both sides are split at a shared node, with real corner geometry and lane connections.
    add([0, -200], [0, 200], 'avenue');          // long north-south avenue
    add([-200, -80], [200, -80], 'street');      // crosses the avenue off-centre (X)
    add([-200, 96], [200, 96], 'street');        // another X
    add([-112, 32], [112, 32], 'street');        // mid-block street, T into both cross streets
    add([-112, 32], [-112, -80], 'street');      // T onto the first cross street
    add([112, 32], [112, 96], 'street');         // T onto the second
    add([-200, 160], [0, 160], 'street');        // T onto the avenue near the north end
    add([0, 160], [56, 128], 'street');          // 45 deg bend continuing from the new T node
    return;
  }
  if (variant === 'oneway') {
    // One-way couplet: two parallel one-way streets flowing opposite ways, linked by two-way cross streets, plus
    // a one-way avenue feeding the block. Lane arrows are painted on every usable lane; traffic (when the full
    // game's traffic module is loaded) only ever travels the permitted direction.
    add([-32, -96], [-32, 96], 'street', 1);
    add([32, 96], [32, -96], 'street', 1);
    add([-96, -96], [96, -96], 'street');
    add([-96, 0], [96, 0], 'street');
    add([-96, 96], [96, 96], 'street');
    add([0, 96], [0, -96], 'avenue', 1);
    return;
  }
  if (variant === 'highway') {
    stageHighway(add);
    add([-80, 100], [0, 100], 'street');
    add([0, 100], [80, 100], 'street');
    add([0, 100], [0, 176], 'street');
    return;
  }
  // default: 5 x 4 street grid at 64 m spacing (x = -128..128, z = -96..96), avenue down the middle (x = 0)
  const xs = [-128, -64, 0, 64, 128], zs = [-96, -32, 32, 96];
  grid(xs, zs, (o, v) => (o === 'v' && v === 0 ? 'avenue' : 'street'));
  add([0, -96], [0, -128], 'avenue');                 // avenue continues north to a T
  add([-40, -128], [0, -128], 'street');
  add([0, -128], [40, -128], 'street');
  add([-40, -128], [-40, -176], 'street');            // dead end (cul-de-sac)
  add([64, 96], [64, 148], 'street');                 // dead end south of the grid
  add([-128, -32], [-176, -32], 'street');            // T on the west side, then a 50 deg bend
  add([-176, -32], [-206, -70], 'street');
  add([128, 32], [176, 32], 'street');                // T east, then a 90 deg bend, then a dead end
  add([176, 32], [176, -30], 'street');
  stageHighway(add);
  add([0, 96], [0, 176], 'street');                   // street connecting the grid to the highway ramp
  add([96, -20], [96, 20], 'path');                   // paths inside blocks (do not touch the roads)
  add([-96, 44], [-96, 84], 'path');
}

function stageHighway(add) {
  // gentle polyline curve on the slope; runs west->east. (0,216) is a vertex so the ramp forms a proper T.
  const pts = [[-300, 200], [-180, 194], [-60, 206], [0, 216], [60, 226], [180, 238], [300, 240]];
  for (let i = 0; i < pts.length - 1; i++) add(pts[i], pts[i + 1], 'highway');
  add([0, 176], [0, 216], 'street');
}

/** Lego "lots": bevelled light-grey plates with studs between roads; only for composition. Returns { studs, mesh }. */
export function stageLots(ctx, group, variant) {
  const studs = [];
  if (variant !== 'default') return { studs, mesh: null };
  const mat = ctx.materials.plastic('lightStoneGrey');
  // [x, z, w, d] — inside blocks (block interior spans 52 m between sidewalks)
  const spots = [[-96, -64, 40, 24], [-96, -44, 40, 10], [-32, 64, 40, 40], [-32, -64, 40, 40], [32, 64, 40, 40], [96, 64, 24, 24], [96, -64, 40, 24]];
  const geos = [];
  for (const [x, z, w, d] of spots) {
    const g = ctx.materials.bevelBox(w, 0.32, d, 0.08).clone();
    const y = ctx.world.getHeight(x, z) + 0.05;
    g.translate(x, y, z);
    geos.push(g);
    const p = 0.8;
    for (let sx = Math.ceil((x - w / 2 + 0.4) / p) * p; sx < x + w / 2 - 0.39; sx += p)
      for (let sz = Math.ceil((z - d / 2 + 0.4) / p) * p; sz < z + d / 2 - 0.39; sz += p) studs.push(sx, y + 0.32, sz, 'lightStoneGrey');
  }
  const merged = mergeGeos(geos);
  const mesh = new THREE.Mesh(merged, mat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'roads-lots';
  group.add(mesh);
  return { studs, mesh };
}

function mergeGeos(geos) {
  // tiny local merge (positions/normals/uvs) to keep the lots to one draw call
  let count = 0, icount = 0;
  for (const g of geos) { count += g.attributes.position.count; icount += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(count * 3), nrm = new Float32Array(count * 3), uv = new Float32Array(count * 2);
  const idx = new Uint32Array(icount);
  let vo = 0, io = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    pos.set(p.array, vo * 3); nrm.set(n.array, vo * 3); if (u) uv.set(u.array, vo * 2);
    const ind = g.index ? g.index.array : [...Array(p.count).keys()];
    for (let i = 0; i < ind.length; i++) idx[io + i] = ind[i] + vo;
    vo += p.count; io += ind.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** Green baseplate ground following the height field, used only when `terrain` is not loaded. */
export function buildFallbackGround(ctx) {
  const world = ctx.world;
  const ext = 420, step = 4;
  const n = Math.round((ext * 2) / step);
  const geo = new THREE.PlaneGeometry(ext * 2, ext * 2, n, n);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, world.getHeight(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, ctx.materials.plastic('brightGreen', { roughness: 0.4 }));
  mesh.receiveShadow = true;
  mesh.name = 'roads-fallback-ground';
  return mesh;
}
