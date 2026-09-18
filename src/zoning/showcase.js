// Demo scenes for the zoning module: a zoned street grid ('default') and side-by-side density patches ('density').
import * as THREE from 'three';

const ZONES = ['r', 'c', 'i'];
const DENSITIES = [1, 2, 3];

function roadXZ(world, x0, z0, x1, z1, kind = 'street') {
  world.addRoad({ x: x0, z: z0 }, { x: x1, z: z1 }, kind);
}

// x of column i / z of row j (the other coordinate does not affect it - cellToWorld is separable).
function colX(world, i) { return world.cellToWorld(i, 0).x; }
function rowZ(world, j) { return world.cellToWorld(0, j).z; }
// World-space centreline through the boundary between cell-columns/rows g and g+1 (a road footprint straddles a
// cell boundary, never a cell centre, so a 1-cell gap is never quite enough - see stageDefault for the sizing).
function gapX(world, g) { return (colX(world, g) + colX(world, g + 1)) / 2; }
function gapZ(world, g) { return (rowZ(world, g) + rowZ(world, g + 1)) / 2; }

function ensureDemoGroup(S) {
  if (S.demoGroup) {
    for (const m of S.demoMeshes) { S.demoGroup.remove(m); m.geometry?.dispose?.(); }
    S.demoMeshes.length = 0;
  } else {
    S.demoGroup = new THREE.Group();
    S.demoGroup.name = 'zoning-demo';
    S.group.add(S.demoGroup);
    S.demoMeshes = [];
  }
  return S.demoGroup;
}

function addPlaceholderBuilding(ctx, S, i, j, density) {
  const world = ctx.world;
  const h = 5 + density * 4.5;
  const geo = ctx.materials.bevelBox(world.cellSize - 1.4, h, world.cellSize - 1.4, 0.12);
  const mat = ctx.materials.plastic('mediumStoneGrey', { roughness: 0.4, clearcoat: 0.4 });
  const mesh = new THREE.Mesh(geo, mat);
  const { x, z } = world.cellToWorld(i, j);
  mesh.position.set(x, S.groundFn(x, z), z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'zoning-demo-building';
  S.demoGroup.add(mesh); // ensureDemoGroup(S) must already have been called once by the caller this stage pass
  S.demoMeshes.push(mesh);
  world.addBuilding({ i, j, w: 1, d: 1, zone: world.cellAt(i, j)?.zone, level: density, height: h, kind: 'placeholder' });
}

/**
 * 'default': a 3x3 grid of city blocks bounded by a proper street grid.
 * Columns = zone type (r, c, i), rows = density (1, 2, 3). One cell per block is "built" (world.addBuilding + a
 * simple grey placeholder box) to prove the zoning overlay disappears once a cell is no longer type:'zone'.
 */
export function stageDefault(ctx, S) {
  const world = ctx.world;
  ensureDemoGroup(S);
  // block = 4x4 cells (32m). A 'street' footprint (8m carriageway + 2m sidewalks each side = 12m) is wider than
  // one 8m cell, so a 1-cell gap between blocks gets its road bleed into the block cells on both sides (roads
  // marks a whole cell 'road' the moment the footprint touches it). A 2-cell (16m) gap, with the road centred on
  // the cell BOUNDARY between those two cells, leaves 2m of clearance on each side and keeps every block a clean
  // 4x4 of zoned cells.
  const BS = 4, GAP = 2;
  const span = BS * 3 + GAP * 2; // 16 cells
  const ci0 = Math.floor(world.size.w / 2) - Math.floor(span / 2);
  const cj0 = Math.floor(world.size.h / 2) - Math.floor(span / 2);
  const leftX = gapX(world, ci0 - GAP), rightX = gapX(world, ci0 + span);
  const topZ = gapZ(world, cj0 - GAP), botZ = gapZ(world, cj0 + span);
  const giXs = [gapX(world, ci0 + BS), gapX(world, ci0 + BS * 2 + GAP)];
  const gjZs = [gapZ(world, cj0 + BS), gapZ(world, cj0 + BS * 2 + GAP)];

  roadXZ(world, leftX, topZ, rightX, topZ);
  roadXZ(world, leftX, botZ, rightX, botZ);
  roadXZ(world, leftX, topZ, leftX, botZ);
  roadXZ(world, rightX, topZ, rightX, botZ);
  for (const gx of giXs) roadXZ(world, gx, topZ, gx, botZ);
  for (const gz of gjZs) roadXZ(world, leftX, gz, rightX, gz);

  let hotI = ci0, hotJ = cj0;
  for (let ciIdx = 0; ciIdx < 3; ciIdx++) {
    const zone = ZONES[ciIdx];
    const iBase = ci0 + ciIdx * (BS + GAP);
    for (let riIdx = 0; riIdx < 3; riIdx++) {
      const density = DENSITIES[riIdx];
      const jBase = cj0 + riIdx * (BS + GAP);
      for (let jj = jBase; jj < jBase + BS; jj++) {
        for (let ii = iBase; ii < iBase + BS; ii++) world.setZone(ii, jj, zone, density);
      }
      // one built lot per block, in the far corner from the block's zoning-demo corner
      addPlaceholderBuilding(ctx, S, iBase + BS - 1, jBase + BS - 1, density);
      if (zone === 'i' && density === 3) { hotI = iBase + 1; hotJ = jBase + 1; }
    }
  }

  const c0 = world.cellToWorld(ci0, cj0), c1 = world.cellToWorld(ci0 + span, cj0 + span);
  const cx = (c0.x + c1.x) / 2, cz = (c0.z + c1.z) / 2, radius = Math.max(60, (c1.x - c0.x) / 2 + 20);
  const hot = world.cellToWorld(hotI, hotJ);
  S.focus = { x: cx, z: cz, r: radius };
  S.hot = { x: hot.x, z: hot.z };
}

/**
 * 'density': for each zone type, three adjacent bare patches at density 1/2/3, no roads - a clean side-by-side
 * comparison of the density cue (taller + brighter rim) for the closeup preset.
 */
export function stageDensity(ctx, S) {
  const world = ctx.world;
  ensureDemoGroup(S);
  const PS = 3, GAP = 2; // 3x3-cell patches, 2-cell bare gap between them
  const spanI = PS * 3 + GAP * 2;
  const spanJ = PS * 3 + GAP * 2;
  const ci0 = Math.floor(world.size.w / 2) - Math.floor(spanI / 2);
  const cj0 = Math.floor(world.size.h / 2) - Math.floor(spanJ / 2);

  let hotI = ci0, hotJ = cj0;
  for (let riIdx = 0; riIdx < 3; riIdx++) { // rows = zone type
    const zone = ZONES[riIdx];
    const jBase = cj0 + riIdx * (PS + GAP);
    for (let ciIdx = 0; ciIdx < 3; ciIdx++) { // columns = density
      const density = DENSITIES[ciIdx];
      const iBase = ci0 + ciIdx * (PS + GAP);
      for (let jj = jBase; jj < jBase + PS; jj++) {
        for (let ii = iBase; ii < iBase + PS; ii++) world.setZone(ii, jj, zone, density);
      }
      if (zone === 'i' && density === 3) { hotI = iBase + 1; hotJ = jBase + 1; }
    }
  }

  const c0 = world.cellToWorld(ci0, cj0), c1 = world.cellToWorld(ci0 + spanI, cj0 + spanJ);
  const cx = (c0.x + c1.x) / 2, cz = (c0.z + c1.z) / 2, radius = Math.max(50, (c1.x - c0.x) / 2 + 16);
  const hot = world.cellToWorld(hotI, hotJ);
  S.focus = { x: cx, z: cz, r: radius };
  S.hot = { x: hot.x, z: hot.z };
}
