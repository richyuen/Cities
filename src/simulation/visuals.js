// Showcase-only visuals: a Lego baseplate with the synthetic district (brick-stack buildings whose height and lit
// windows follow occupancy, road plates with stud sidewalks, lamp posts, park trees, cranes on growth candidates,
// "for sale" signs on unwanted lots) and a live 3D bar chart built from Lego bricks with printed label tiles.
// Everything is instanced / merged: ~30 draw calls before shadows. No lights except 4 pooled warm spots on the chart
// lamp posts at night (ARCHITECTURE §7: local night lights on props only).

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const BRICK_H = 0.96, PLATE_H = 0.32, PITCH = 0.8, CELL = 8;
const MAX_BAR_BRICKS = 24;
const BAR_PITCH = 7.2, BAR_W = 3.2;
// Stud/roof-cap LOD is bucketed by live distance-to-camera (not distance-to-a-fixed-point-in-the-scene): everything
// within CAM_HI_RADIUS of wherever the camera actually is gets the core 14-sided stud; everything beyond it gets a
// cheap 6-sided one. Re-bucketed whenever the camera has moved more than CAM_LOD_MOVE since the last pass (see
// refreshCameraLOD in createVisuals) — cheap (a few thousand instances, done a few times per camera move, never
// every frame) and correct anywhere in the district, not just near the chart.
const CAM_HI_RADIUS = 62;          // m from the camera: hi-poly ground/sidewalk studs and roof-cap studs
const CAM_LOD_MOVE = 12;           // m the camera must move before the hi/lo split is recomputed
const STUD_FADE = [200, 290];      // m from the camera: studs shrink to nothing (kills far moiré)
const MAX_CRANES = 10;
const WIN_PITCH = 2.4;
const ZONE_COLORS = {
  r: ['brightRed', 'brightYellow', 'white', 'tan', 'brightOrange', 'sandGreen', 'mediumAzur'],
  c: ['brightBlue', 'darkAzur', 'white', 'lightStoneGrey', 'mediumLilac', 'mediumAzur'],
  i: ['darkStoneGrey', 'mediumStoneGrey', 'brickYellow', 'darkOrange', 'reddishBrown', 'sandBlue'],
};
const PALE = new Set(['white', 'tan', 'lightStoneGrey', 'brickYellow', 'sandGreen', 'brightYellow', 'mediumStoneGrey']);
export const BAR_DEFS = [
  { key: 'population', label: 'POPULATION', color: 'brightGreen', fmt: (v) => Math.round(v).toLocaleString('en-US') },
  { key: 'jobs', label: 'JOBS', color: 'brightBlue', fmt: (v) => Math.round(v).toLocaleString('en-US') },
  { key: 'money', label: 'TREASURY', color: 'brightYellow', fmt: (v) => (v < 0 ? '-$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-US') },
  { key: 'happiness', label: 'HAPPINESS', color: 'brightPink', fmt: (v) => Math.round(v * 100) + '%' },
  { key: 'dr', label: 'DEMAND  R', color: 'lime', fmt: (v) => Math.round(v * 100) + '%' },
  { key: 'dc', label: 'DEMAND  C', color: 'mediumAzur', fmt: (v) => Math.round(v * 100) + '%' },
  { key: 'di', label: 'DEMAND  I', color: 'brightOrange', fmt: (v) => Math.round(v * 100) + '%' },
];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
const _yAxis = new THREE.Vector3(0, 1, 0);
const _col = new THREE.Color();
const _camPt = new THREE.Vector3();

/** "nice" ceiling for a chart scale */
function niceScale(v, min) {
  v = Math.max(v, min);
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Low-poly stud (6 sides, open bottom, ~16 tris) for anything beyond CAM_HI_RADIUS of the camera. */
function lowStudGeometry() {
  const side = new THREE.CylinderGeometry(0.24, 0.24, 0.17, 6, 1, true);
  side.translate(0, 0.085, 0);
  const cap = new THREE.CircleGeometry(0.24, 6);
  cap.rotateX(-Math.PI / 2); cap.translate(0, 0.17, 0);
  const g = mergeGeometries([side, cap], false);
  side.dispose(); cap.dispose();
  return g;
}

/** Plate with a stud grid on top, merged into one geometry (roof caps: built once per hi/lo LOD, see note above). */
function studdedPlateGeometry(materials, sx, sz, studGeo) {
  const plate = materials.bevelBox(sx, PLATE_H, sz, 0.06, 1).clone();
  const parts = [plate];
  const nx = Math.floor((sx - 0.4) / PITCH), nz = Math.floor((sz - 0.4) / PITCH);
  const x0 = -((nx - 1) * PITCH) / 2, z0 = -((nz - 1) * PITCH) / 2;
  for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) {
    const s = studGeo.toNonIndexed(); s.translate(x0 + a * PITCH, PLATE_H, z0 + b * PITCH); parts.push(s); // RoundedBox is non-indexed
  }
  const g = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return g;
}

function setInstance(mesh, k, x, y, z, sx = 1, sy = 1, sz = 1, rotY = 0) {
  _p.set(x, y, z); _s.set(sx, sy, sz);
  if (rotY) _q.setFromAxisAngle(_yAxis, rotY); else _q.identity();
  _m.compose(_p, _q, _s);
  mesh.setMatrixAt(k, _m);
}

/** Slope tile (2×3 slope brick look) with the slanted face UV-mapped to an atlas rect. Local origin: bottom centre. */
function wedgeGeometry(w, d, H, h, uv, blank) {
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const pos = [], nor = [], uvs = [];
  const tri = (a, b, c, n, ua, ub, uc) => { pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n); uvs.push(...ua, ...ub, ...uc); };
  const quad = (a, b, c, dd, n, ua, ub, uc, ud) => { tri(a, b, c, n, ua, ub, uc); tri(a, c, dd, n, ua, uc, ud); };
  const B = [blank[0], blank[1]];
  quad([x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, -1, 0], B, B, B, B);           // bottom
  quad([x1, 0, z0], [x1, H, z0], [x0, H, z0], [x0, 0, z0], [0, 0, -1], B, B, B, B);           // back (z0), height H
  quad([x0, 0, z1], [x0, h, z1], [x1, h, z1], [x1, 0, z1], [0, 0, 1], B, B, B, B);            // front lip (z1), height h
  quad([x0, 0, z1], [x0, 0, z0], [x0, H, z0], [x0, h, z1], [-1, 0, 0], B, B, B, B);           // sides
  quad([x1, 0, z0], [x1, 0, z1], [x1, h, z1], [x1, H, z0], [1, 0, 0], B, B, B, B);
  const n = new THREE.Vector3(0, d, H - h).normalize().toArray();
  const [u0, v0, u1, v1] = uv; // u0..u1 across x, v1 = top (back), v0 = bottom (front)
  quad([x0, H, z0], [x0, h, z1], [x1, h, z1], [x1, H, z0], n, [u0, v1], [u0, v0], [u1, v0], [u1, v1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

/** Single quad facing +z, centred at the origin, UV-mapped to an atlas rect (sign boards). */
function quadGeometry(w, h, uv) {
  const [u0, v0, u1, v1] = uv;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** Window frame: a rectangular ring standing `depth` proud of the wall (local z=0 is the wall face, +z out). 24 tris. */
function frameGeometry(W, H, w, h, depth) {
  const pos = [], nor = [];
  const tri = (a, b, c, n) => { pos.push(...a, ...b, ...c); nor.push(...n, ...n, ...n); };
  const quad = (a, b, c, d, n) => { tri(a, b, c, n); tri(a, c, d, n); };
  const X = W / 2, Y = H / 2, x = w / 2, y = h / 2, z = depth;
  // front ring (4 quads)
  quad([-X, -Y, z], [X, -Y, z], [x, -y, z], [-x, -y, z], [0, 0, 1]);
  quad([x, -y, z], [X, -Y, z], [X, Y, z], [x, y, z], [0, 0, 1]);
  quad([-x, y, z], [x, y, z], [X, Y, z], [-X, Y, z], [0, 0, 1]);
  quad([-X, -Y, z], [-x, -y, z], [-x, y, z], [-X, Y, z], [0, 0, 1]);
  // outer sides
  quad([-X, -Y, 0], [X, -Y, 0], [X, -Y, z], [-X, -Y, z], [0, -1, 0]);
  quad([X, -Y, 0], [X, Y, 0], [X, Y, z], [X, -Y, z], [1, 0, 0]);
  quad([X, Y, 0], [-X, Y, 0], [-X, Y, z], [X, Y, z], [0, 1, 0]);
  quad([-X, Y, 0], [-X, -Y, 0], [-X, -Y, z], [-X, Y, z], [-1, 0, 0]);
  // inner sides (facing inward)
  quad([x, -y, 0], [-x, -y, 0], [-x, -y, z], [x, -y, z], [0, 1, 0]);
  quad([x, y, 0], [x, -y, 0], [x, -y, z], [x, y, z], [-1, 0, 0]);
  quad([-x, y, 0], [x, y, 0], [x, y, z], [-x, y, z], [0, -1, 0]);
  quad([-x, -y, 0], [-x, y, 0], [-x, y, z], [-x, -y, z], [1, 0, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  return g;
}

/** Lamp post: base plate, pole, arm, head. Origin at the ground under the pole; the arm reaches toward +x. */
function lampPostGeometry(materials) {
  const base = materials.bevelBox(0.8, 0.4, 0.8, 0.06, 1).clone();
  const pole = new THREE.CylinderGeometry(0.16, 0.2, 6.2, 8); pole.translate(0, 0.4 + 3.1, 0);
  const arm = new THREE.BoxGeometry(1.8, 0.2, 0.2); arm.translate(0.8, 6.5, 0);
  const head = materials.bevelBox(0.9, 0.34, 0.9, 0.05, 1).clone(); head.translate(1.55, 6.3, 0);
  const g = mergeGeometries([base, pole.toNonIndexed(), arm.toNonIndexed(), head], false);
  base.dispose(); pole.dispose(); arm.dispose(); head.dispose();
  return g;
}

/** Tower crane built from brick sticks: mast, jib, counter-jib, cab, hook line. Origin at the base. */
function craneGeometry() {
  const parts = [];
  const box = (w, h, d, x, y, z) => { const b = new THREE.BoxGeometry(w, h, d); b.translate(x, y, z); parts.push(b); };
  box(0.8, 14, 0.8, 0, 7, 0);            // mast
  box(11, 0.5, 0.5, 4.2, 14.2, 0);       // jib
  box(3.2, 0.5, 0.5, -2.2, 14.2, 0);     // counter-jib
  box(1.2, 0.9, 1.2, -2.6, 13.4, 0);     // counterweight
  box(1.1, 1.0, 1.1, 0.9, 13.2, 0);      // cab
  box(0.08, 6, 0.08, 8, 11, 0);          // hook line
  box(0.5, 0.4, 0.5, 8, 7.9, 0);         // hook block
  const g = mergeGeometries(parts.map((p) => p.toNonIndexed()), false);
  for (const p of parts) p.dispose();
  return g;
}

/** Instanced plastic that shrinks studs to nothing far from the camera (no moiré, no far draw cost). */
function fadingStudMaterial(materials) {
  const base = materials.plastic('white', { instanceColor: true });
  const m = base.clone();
  m.name = 'sim-stud-fade';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 simStudWorld = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
      float simStudFade = 1.0 - smoothstep(${STUD_FADE[0].toFixed(1)}, ${STUD_FADE[1].toFixed(1)}, distance(simStudWorld.xyz, cameraPosition));
      transformed *= simStudFade;`);
  };
  m.customProgramCacheKey = () => 'sim-stud-fade';
  return m;
}

export function createVisuals(ctx, { model, city, rng, chartZ }) {
  const { materials, world, scene } = ctx;
  const group = new THREE.Group();
  group.name = 'simulation';
  const disposables = [];
  const studGeoHi = materials.studGeometry();
  const studGeoLow = lowStudGeometry(); disposables.push(studGeoLow);
  const instMat = materials.plastic('white', { instanceColor: true });
  const studMat = fadingStudMaterial(materials); disposables.push(studMat);
  const plateColor = 'brightGreen';

  // ---- ground baseplate ------------------------------------------------------------------------
  const gx0 = world.cellToWorld(city.i0, city.j0).x - CELL * 1.5, gx1 = world.cellToWorld(city.i0 + city.span - 1, city.j0).x + CELL * 1.5;
  const gz0 = world.cellToWorld(city.i0, city.j0).z - CELL * 1.5, gz1 = chartZ + 24;
  const groundGeo = materials.bevelBox(gx1 - gx0, 1.2, gz1 - gz0, 0.25);
  const ground = new THREE.Mesh(groundGeo, materials.plastic(plateColor, { roughness: 0.42, clearcoat: 0.45 }));
  ground.position.set((gx0 + gx1) / 2, -1.2, (gz0 + gz1) / 2);
  ground.receiveShadow = true; ground.castShadow = false;
  group.add(ground);

  // stud list: [x, y, z, colorName] — collected once; the hi/lo split (which mesh each instance actually renders
  // in) is recomputed live from camera distance in refreshCameraLOD() below, not fixed at build time.
  const groundStuds = [];
  const addStud = (x, y, z, color) => { groundStuds.push(x, y, z, color); };
  const roadSet = new Set(city.roadCells.map((c) => `${c.i},${c.j}`));
  const chartX0 = -30, chartX1 = 30, chartZ0 = chartZ - 8.5, chartZ1 = chartZ + 8.5;
  const sx0 = Math.ceil((gx0 + 0.5) / PITCH) * PITCH, sz0 = Math.ceil((gz0 + 0.5) / PITCH) * PITCH;
  for (let x = sx0; x < gx1 - 0.4; x += PITCH) for (let z = sz0; z < gz1 - 0.4; z += PITCH) {
    if (x > chartX0 && x < chartX1 && z > chartZ0 && z < chartZ1) continue;
    const { i, j } = world.worldToCell(x, z);
    const c = world.cellAt(i, j);
    if (c && (c.type === 'road' || c.buildingId || roadSet.has(`${i},${j}`))) continue;
    addStud(x, 0, z, plateColor);
  }

  // ---- road plates, lane dashes, stud sidewalks with curbs ------------------------------------------
  const roadGeo = materials.bevelBox(CELL, 0.3, CELL, 0.05, 1);
  const roads = new THREE.InstancedMesh(roadGeo, materials.plastic('darkStoneGrey', { roughness: 0.5, clearcoat: 0.3 }), Math.max(1, city.roadCells.length));
  const dashes = [], walks = [];
  const WALK_W = 1.4, WALK_H = 0.5, walkColor = 'lightStoneGrey';
  city.roadCells.forEach((rc, k) => {
    const { x, z } = world.cellToWorld(rc.i, rc.j);
    setInstance(roads, k, x, 0, z);
    const e = CELL / 2 - WALK_W / 2;
    if (rc.dir === 'x') {
      dashes.push(x - 2.2, z, Math.PI / 2, x + 2.2, z, Math.PI / 2);
      walks.push(x, z - e, CELL, WALK_W, x, z + e, CELL, WALK_W);
    } else if (rc.dir === 'z') {
      dashes.push(x, z - 2.2, 0, x, z + 2.2, 0);
      walks.push(x - e, z, WALK_W, CELL, x + e, z, WALK_W, CELL);
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) walks.push(x + sx * e, z + sz * e, WALK_W, WALK_W);
    }
  });
  roads.count = city.roadCells.length; roads.receiveShadow = true; roads.name = 'road-plates';
  group.add(roads);
  const dashGeo = new THREE.BoxGeometry(0.4, 0.34, 2.4); dashGeo.translate(0, 0.17, 0); disposables.push(dashGeo);
  const dashMesh = new THREE.InstancedMesh(dashGeo, materials.plastic('white', { roughness: 0.5, clearcoat: 0.2 }), Math.max(1, dashes.length / 3));
  for (let k = 0; k < dashes.length / 3; k++) setInstance(dashMesh, k, dashes[k * 3], 0, dashes[k * 3 + 1], 1, 1, 1, dashes[k * 3 + 2]);
  dashMesh.count = dashes.length / 3; dashMesh.receiveShadow = true; dashMesh.name = 'road-dashes';
  group.add(dashMesh);
  // sidewalk plates: unit box scaled per strip (curb = the 0.2 m step above the road plate)
  const walkGeo = materials.bevelBox(1, WALK_H, 1, 0.04, 1);
  const walkMesh = new THREE.InstancedMesh(walkGeo, materials.plastic(walkColor, { roughness: 0.5, clearcoat: 0.3 }), Math.max(1, walks.length / 4));
  for (let k = 0; k < walks.length / 4; k++) {
    const x = walks[k * 4], z = walks[k * 4 + 1], w = walks[k * 4 + 2], d = walks[k * 4 + 3];
    setInstance(walkMesh, k, x, 0, z, w, 1, d);
    // one stud row per strip (0.8 pitch along the long axis)
    const nx = Math.max(1, Math.round(w / PITCH)), nz = Math.max(1, Math.round(d / PITCH));
    for (let a = 0; a < nx; a++) for (let b = 0; b < nz; b++) addStud(x - ((nx - 1) * PITCH) / 2 + a * PITCH, WALK_H, z - ((nz - 1) * PITCH) / 2 + b * PITCH, walkColor);
  }
  walkMesh.count = walks.length / 4; walkMesh.receiveShadow = walkMesh.castShadow = true; walkMesh.name = 'sidewalks';
  group.add(walkMesh);

  // ---- lamp posts: one per intersection corner + four around the chart (those carry real spots) ------------
  const lampGeo = lampPostGeometry(materials); disposables.push(lampGeo);
  const lampGlassGeo = materials.bevelBox(0.7, 0.3, 0.7, 0.05, 1);
  const lamps = []; // [x, z, rotY]
  for (const it of city.intersections) {
    const { x, z } = world.cellToWorld(it.i, it.j);
    lamps.push(x + 3.3, z - 3.3, -Math.PI * 0.75); // NE sidewalk corner, arm toward the crossing
  }
  const chartLamps = [[-33, chartZ - 9, -0.35], [33, chartZ - 9, Math.PI + 0.35], [-33, chartZ + 10.5, 0.35], [33, chartZ + 10.5, Math.PI - 0.35]];
  for (const [x, z, r] of chartLamps) lamps.push(x, z, r);
  const nLamps = lamps.length / 3;
  const lampMesh = new THREE.InstancedMesh(lampGeo, materials.plastic('darkStoneGrey', { roughness: 0.4 }), nLamps);
  const glassDay = materials.glass('transYellow', { opacity: 0.6 });
  const glassNight = materials.emissive('brightYellow', 3.0);
  const lampGlass = new THREE.InstancedMesh(lampGlassGeo, glassDay, nLamps);
  const _arm = new THREE.Vector3();
  for (let k = 0; k < nLamps; k++) {
    const x = lamps[k * 3], z = lamps[k * 3 + 1], r = lamps[k * 3 + 2];
    setInstance(lampMesh, k, x, 0, z, 1, 1, 1, r);
    _arm.set(1.55, 0, 0).applyAxisAngle(_yAxis, r);
    setInstance(lampGlass, k, x + _arm.x, 5.85, z + _arm.z, 1, 1, 1, r);
  }
  lampMesh.castShadow = lampMesh.receiveShadow = true; lampMesh.name = 'lamp-posts';
  lampGlass.castShadow = lampGlass.receiveShadow = false; lampGlass.name = 'lamp-glass';
  group.add(lampMesh, lampGlass);
  const spots = [];
  for (const [x, z, r] of chartLamps) {
    _arm.set(1.55, 0, 0).applyAxisAngle(_yAxis, r);
    const s = new THREE.SpotLight(0xffd3a0, 0, 34, 0.78, 0.65, 1.6);
    s.position.set(x + _arm.x, 5.9, z + _arm.z);
    s.target.position.set(x * 0.55 + _arm.x * 2, 0, chartZ + (z - chartZ) * 0.35);
    s.castShadow = false;
    group.add(s, s.target); spots.push(s);
  }

  // ---- park trees + flower plates -------------------------------------------------------------------
  const trunkGeo = new THREE.CylinderGeometry(0.45, 0.6, 2.6, 8); trunkGeo.translate(0, 1.3, 0); disposables.push(trunkGeo);
  const leafA = materials.bevelBox(3.2, 1.6, 3.2, 0.12).clone(); leafA.translate(0, 2.2, 0);
  const leafB = materials.bevelBox(2.4, 1.6, 2.4, 0.12).clone(); leafB.translate(0, 3.8, 0);
  const leafC = materials.bevelBox(1.6, 1.2, 1.6, 0.12).clone(); leafC.translate(0, 5.4, 0);
  const leafGeo = mergeGeometries([leafA, leafB, leafC], false); leafA.dispose(); leafB.dispose(); leafC.dispose(); disposables.push(leafGeo);
  const treePos = [];
  for (const p of city.parks) {
    const { x, z } = world.cellToWorld(p.i, p.j);
    const n = rng.int(1, 2);
    for (let k = 0; k < n; k++) treePos.push(x + rng.range(-2.4, 2.4), z + rng.range(-2.4, 2.4), rng.range(0, Math.PI * 2), rng.chance(0.5) ? 'darkGreen' : 'brightGreen');
  }
  const nTrees = treePos.length / 4;
  const trunks = new THREE.InstancedMesh(trunkGeo, materials.plastic('reddishBrown'), Math.max(1, nTrees));
  const leaves = new THREE.InstancedMesh(leafGeo, instMat, Math.max(1, nTrees));
  for (let k = 0; k < nTrees; k++) {
    const x = treePos[k * 4], z = treePos[k * 4 + 1], r = treePos[k * 4 + 2];
    setInstance(trunks, k, x, 0, z, 1, 1, 1, r); setInstance(leaves, k, x, 0, z, 1, 1, 1, r);
    leaves.setColorAt(k, materials.color(treePos[k * 4 + 3]));
  }
  trunks.count = leaves.count = nTrees;
  trunks.castShadow = leaves.castShadow = true; trunks.receiveShadow = leaves.receiveShadow = true;
  trunks.name = 'tree-trunks'; leaves.name = 'tree-leaves';
  group.add(trunks, leaves);
  // 1×1 round "flower" plates scattered on park cells (coloured studs on the green)
  const flowerGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.32, 10); flowerGeo.translate(0, 0.16, 0); disposables.push(flowerGeo);
  const flowers = [];
  for (const p of city.parks) {
    const { x, z } = world.cellToWorld(p.i, p.j);
    for (let k = rng.int(2, 4); k > 0; k--) flowers.push(Math.round((x + rng.range(-3, 3)) / PITCH) * PITCH, Math.round((z + rng.range(-3, 3)) / PITCH) * PITCH, rng.pick(['brightRed', 'brightYellow', 'brightPink', 'white', 'brightOrange']));
  }
  const flowerMesh = new THREE.InstancedMesh(flowerGeo, instMat, Math.max(1, flowers.length / 3));
  for (let k = 0; k < flowers.length / 3; k++) { setInstance(flowerMesh, k, flowers[k * 3], 0, flowers[k * 3 + 1]); flowerMesh.setColorAt(k, materials.color(flowers[k * 3 + 2])); }
  flowerMesh.count = flowers.length / 3; flowerMesh.receiveShadow = true; flowerMesh.name = 'park-flowers';
  group.add(flowerMesh);

  // ---- buildings: brick stacks + studded roof plate, per footprint ------------------------------------
  const sizes = new Map(); // "wxd" → { bricks, caps, list, sx, sz }
  const bldEntries = [];
  const bldColorRng = rng.fork('colors');
  for (const id of city.buildingIds) {
    const b = world.buildings.get(id); if (!b) continue;
    const key = `${b.w}x${b.d}`;
    if (!sizes.has(key)) sizes.set(key, { list: [], maxBricks: 0, sx: b.w * CELL - 0.8, sz: b.d * CELL - 0.8 });
    const grp = sizes.get(key);
    const maxN = Math.max(1, Math.ceil((b.height * 1.05) / BRICK_H));
    const cname = bldColorRng.pick(ZONE_COLORS[b.zone] || ZONE_COLORS.r);
    const color = materials.color(cname).clone();
    const dark = color.clone().multiplyScalar(0.86);
    const frame = materials.color(PALE.has(cname) ? 'darkStoneGrey' : (b.zone === 'i' ? 'black' : 'white'));
    const { x, z } = world.cellToWorld(b.i, b.j);
    const e = { b, id, x: x + ((b.w - 1) * CELL) / 2, z: z + ((b.d - 1) * CELL) / 2, maxN, n: -1, lit: -1, color, dark, frame, grp };
    grp.list.push(e); grp.maxBricks += maxN; bldEntries.push(e);
  }
  // windows: 1×2 window bricks — white/black frame ring standing proud of the wall, dark backing + trans-clear pane
  // recessed inside it. Lit fraction follows occupancy (bust ≈ 10–15 %, boom ≈ 85 %); glow only at night.
  const frameGeo = frameGeometry(1.5, 0.82, 1.18, 0.56, 0.14); disposables.push(frameGeo);
  const backGeo = quadGeometry(1.18, 0.56, [0, 0, 1, 1]); backGeo.translate(0, 0, 0.02); disposables.push(backGeo);
  // Lit backing is a smaller inset "hot core" (not the full pane) so a dark margin survives between the glow and
  // the frame at point-blank range — bloom still reads as a lit window at distance, but doesn't wash the whole
  // pane/frame into a shapeless glow up close (r2 nit).
  const litBackGeo = quadGeometry(1.18 * 0.68, 0.56 * 0.6, [0, 0, 1, 1]); litBackGeo.translate(0, 0, 0.02); disposables.push(litBackGeo);
  const paneGeo = quadGeometry(1.18, 0.56, [0, 0, 1, 1]); paneGeo.translate(0, 0, 0.07); disposables.push(paneGeo);
  const winBackDark = materials.plastic('earthBlue', { roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.08 });
  const winBackLit = materials.emissive('brightYellow', 2.6);
  const paneMat = materials.glass('transClear', { opacity: 0.32, roughness: 0.05 });
  let winTotal = 0;
  for (const [key, grp] of sizes) {
    const brickGeo = materials.bevelBox(grp.sx, BRICK_H, grp.sz, 0.08, 1);
    grp.bricks = new THREE.InstancedMesh(brickGeo, instMat, Math.max(1, grp.maxBricks));
    grp.bricks.castShadow = grp.bricks.receiveShadow = true; grp.bricks.name = `bld-bricks-${key}`;
    const capGeoHi = studdedPlateGeometry(materials, grp.sx, grp.sz, studGeoHi); disposables.push(capGeoHi);
    const capGeoLo = studdedPlateGeometry(materials, grp.sx, grp.sz, studGeoLow); disposables.push(capGeoLo);
    grp.capsHi = new THREE.InstancedMesh(capGeoHi, instMat, Math.max(1, grp.list.length));
    grp.capsLo = new THREE.InstancedMesh(capGeoLo, instMat, Math.max(1, grp.list.length));
    grp.capsHi.castShadow = grp.capsHi.receiveShadow = true; grp.capsHi.name = `bld-caps-hi-${key}`;
    grp.capsLo.castShadow = grp.capsLo.receiveShadow = true; grp.capsLo.name = `bld-caps-lo-${key}`;
    group.add(grp.bricks, grp.capsHi, grp.capsLo);
    const offs = (len) => { const n = Math.floor((len - 1.2) / WIN_PITCH), o = []; for (let k = 0; k < n; k++) o.push((k - (n - 1) / 2) * WIN_PITCH); return o; };
    grp.winX = offs(grp.sx); grp.winZ = offs(grp.sz);
    winTotal += grp.maxBricks * (grp.winX.length + grp.winZ.length) * 2;
  }
  const winFrames = new THREE.InstancedMesh(frameGeo, instMat, Math.max(1, winTotal));
  const winDarkMesh = new THREE.InstancedMesh(backGeo, winBackDark, Math.max(1, winTotal));
  const winLitMesh = new THREE.InstancedMesh(litBackGeo, winBackDark, Math.max(1, winTotal));
  const winPanes = new THREE.InstancedMesh(paneGeo, paneMat, Math.max(1, winTotal));
  winFrames.name = 'bld-window-frames'; winDarkMesh.name = 'bld-windows-dark'; winLitMesh.name = 'bld-windows-lit'; winPanes.name = 'bld-window-panes';
  for (const m of [winFrames, winDarkMesh, winLitMesh, winPanes]) { m.castShadow = false; m.receiveShadow = m === winFrames; }
  group.add(winFrames, winDarkMesh, winLitMesh, winPanes);
  const winHash = (a, b, c) => { let h = (a * 374761393 + b * 668265263 + c * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const FACES = [[0, 1, 0], [0, -1, Math.PI], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]; // [dx, dz, rotY]
  const litFraction = (occ) => 0.1 + 0.8 * Math.max(0, Math.min(1, (occ - 0.3) / 0.65));
  function refreshWindows() {
    let d = 0, l = 0, f = 0;
    for (const grp of sizes.values()) {
      const hx = grp.sx / 2, hz = grp.sz / 2;
      for (let bi = 0; bi < grp.list.length; bi++) {
        const e = grp.list[bi], frac = litFraction(e.lit / 20), seed = e.b.seed | 0;
        for (let q = 0; q < e.n; q++) {
          const y = q * BRICK_H + BRICK_H / 2 + 0.02;
          for (let fi = 0; fi < 4; fi++) {
            const [dx, dz, rot] = FACES[fi];
            const offs = dz !== 0 ? grp.winX : grp.winZ;
            for (let w = 0; w < offs.length; w++) {
              const o = offs[w];
              const x = dz !== 0 ? e.x + o : e.x + dx * hx;
              const z = dz !== 0 ? e.z + dz * hz : e.z + o;
              setInstance(winFrames, f, x, y, z, 1, 1, 1, rot); winFrames.setColorAt(f, e.frame); f++;
              if (winHash(seed, q * 4 + fi, w) < frac) setInstance(winLitMesh, l++, x, y, z, 1, 1, 1, rot);
              else setInstance(winDarkMesh, d++, x, y, z, 1, 1, 1, rot);
              setInstance(winPanes, f - 1, x, y, z, 1, 1, 1, rot);
            }
          }
        }
      }
    }
    winFrames.count = winPanes.count = f; winDarkMesh.count = d; winLitMesh.count = l;
    winFrames.instanceMatrix.needsUpdate = true; if (winFrames.instanceColor) winFrames.instanceColor.needsUpdate = true;
    winPanes.instanceMatrix.needsUpdate = true; winDarkMesh.instanceMatrix.needsUpdate = true; winLitMesh.instanceMatrix.needsUpdate = true;
  }
  function occOf(e) { const s = model.byId.get(e.id); return s ? s.occ : 0.5; }
  function bricksFor(e, occ) { return Math.max(1, Math.round((e.b.height * (0.3 + 0.7 * occ)) / BRICK_H)); }
  function refreshBuildings(force) {
    let anyChanged = false, litChanged = false;
    for (const grp of sizes.values()) {
      let changed = force;
      for (const e of grp.list) {
        const occ = occOf(e), n = bricksFor(e, occ), lit = Math.round(occ * 20);
        if (n !== e.n) { e.n = n; changed = true; }
        if (lit !== e.lit) { e.lit = lit; litChanged = true; }
      }
      if (!changed) continue;
      let k = 0;
      for (const e of grp.list) {
        for (let q = 0; q < e.n; q++, k++) { setInstance(grp.bricks, k, e.x, q * BRICK_H, e.z); grp.bricks.setColorAt(k, q % 2 ? e.dark : e.color); }
      }
      grp.bricks.count = k;
      grp.bricks.instanceMatrix.needsUpdate = true; grp.bricks.instanceColor.needsUpdate = true;
      rebuildCaps(grp);
      anyChanged = true;
    }
    if (anyChanged || litChanged) refreshWindows();
    return anyChanged;
  }

  // ---- cranes on growth candidates (boom) ---------------------------------------------------------------
  const craneGeo = craneGeometry(); disposables.push(craneGeo);
  const cranes = new THREE.InstancedMesh(craneGeo, instMat, MAX_CRANES);
  cranes.castShadow = cranes.receiveShadow = true; cranes.name = 'cranes'; cranes.count = 0;
  group.add(cranes);
  const byId = new Map(bldEntries.map((e) => [e.id, e]));
  let craneKey = '';
  function refreshCranes(growthIds, force) {
    // spread the cranes over the whole district: stride through the candidate list instead of taking the first N
    const all = growthIds.filter((id) => byId.has(id));
    const stride = Math.max(1, Math.ceil(all.length / MAX_CRANES));
    const picked = [];
    for (let k = 0; k < all.length && picked.length < MAX_CRANES; k += stride) picked.push(all[k]);
    const key = picked.join(',');
    if (key === craneKey && !force) return;
    craneKey = key;
    let k = 0;
    for (const id of picked) {
      const e = byId.get(id), h = (e.b.seed | 0);
      const rot = (h % 4) * (Math.PI / 2) + 0.4;
      const ox = ((h >> 3) % 3 - 1) * 1.6, oz = ((h >> 5) % 3 - 1) * 1.6;
      setInstance(cranes, k, e.x + ox, e.n * BRICK_H + PLATE_H, e.z + oz, 1, 1, 1, rot);
      cranes.setColorAt(k, materials.color('brightYellow')); k++;
    }
    cranes.count = k; cranes.instanceMatrix.needsUpdate = true; if (cranes.instanceColor) cranes.instanceColor.needsUpdate = true;
  }

  // ---- bar chart -------------------------------------------------------------------------------
  const chart = new THREE.Group(); chart.name = 'sim-chart'; chart.position.set(0, 0, chartZ); group.add(chart);
  const plateW = 58, plateD = 18;
  const plate = new THREE.Mesh(materials.bevelBox(plateW, BRICK_H, plateD, 0.1), materials.plastic('lightStoneGrey'));
  plate.castShadow = plate.receiveShadow = true; chart.add(plate);
  const barZ = -3.2, labelZ = 2.6, titleZ = plateD / 2 - 1.6;
  const nBars = BAR_DEFS.length;
  const barX = (k) => (k - (nBars - 1) / 2) * BAR_PITCH;
  // plate studs (core 14-sided geometry, it's the hero): everywhere except under the title board and label tiles
  const pStuds = [];
  for (let x = -plateW / 2 + 0.6; x < plateW / 2 - 0.5; x += PITCH) for (let z = -plateD / 2 + 0.6; z < plateD / 2 - 0.5; z += PITCH) {
    if (z > titleZ - 1.5) continue;
    let underLabel = false;
    for (let k = 0; k < nBars && !underLabel; k++) underLabel = Math.abs(x - barX(k)) < (BAR_W + 1.2) / 2 + 0.3 && Math.abs(z - labelZ) < 1.6;
    if (!underLabel) pStuds.push(x, z);
  }
  const plateStuds = new THREE.InstancedMesh(studGeoHi, materials.plastic('lightStoneGrey'), Math.max(1, pStuds.length / 2));
  for (let k = 0; k < pStuds.length / 2; k++) setInstance(plateStuds, k, pStuds[k * 2], BRICK_H, pStuds[k * 2 + 1]);
  plateStuds.count = pStuds.length / 2; plateStuds.receiveShadow = true; plateStuds.name = 'chart-plate-studs';
  chart.add(plateStuds);

  const barGeo = materials.bevelBox(BAR_W, BRICK_H, BAR_W, 0.08);
  const barBricks = new THREE.InstancedMesh(barGeo, instMat, nBars * (MAX_BAR_BRICKS + 1));
  barBricks.castShadow = barBricks.receiveShadow = true; barBricks.name = 'bar-bricks';
  const barStuds = new THREE.InstancedMesh(studGeoHi, instMat, nBars * 16);
  barStuds.castShadow = false; barStuds.receiveShadow = true; barStuds.name = 'bar-studs';
  chart.add(barBricks, barStuds);
  const barColor = BAR_DEFS.map((d) => materials.color(d.color).clone());
  const barDark = barColor.map((c) => c.clone().multiplyScalar(0.84));
  const debtColor = materials.color('brightRed').clone(), debtDark = materials.color('darkRed').clone();
  const scale = { population: 1, jobs: 1, money: 1 };
  const target = new Float32Array(nBars), vis = new Float32Array(nBars);
  let visDirty = true, inDebt = false;

  function rebuildBars() {
    let k = 0, s = 0;
    for (let i = 0; i < nBars; i++) {
      const x = barX(i), v = Math.max(0, Math.min(MAX_BAR_BRICKS, vis[i]));
      const debt = i === 2 && inDebt;
      const cA = debt ? debtColor : barColor[i], cB = debt ? debtDark : barDark[i];
      const full = Math.floor(v), frac = v - full;
      for (let q = 0; q < full; q++, k++) { setInstance(barBricks, k, x, BRICK_H + q * BRICK_H, barZ); barBricks.setColorAt(k, q % 2 ? cB : cA); }
      let top = BRICK_H + full * BRICK_H;
      if (frac > 0.08 && full < MAX_BAR_BRICKS) { setInstance(barBricks, k, x, top, barZ, 1, frac, 1); barBricks.setColorAt(k, full % 2 ? cB : cA); k++; top += frac * BRICK_H; }
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++, s++) { setInstance(barStuds, s, x - 1.2 + a * PITCH, top, barZ - 1.2 + b * PITCH); barStuds.setColorAt(s, cA); }
    }
    barBricks.count = k; barStuds.count = s;
    barBricks.instanceMatrix.needsUpdate = true; barBricks.instanceColor.needsUpdate = true;
    barStuds.instanceMatrix.needsUpdate = true; barStuds.instanceColor.needsUpdate = true;
  }

  // ---- printed tiles: label wedges + title board + sign boards share one 2048×1024 canvas atlas ------------
  const AW = 2048, AH = 1024;
  const canvas = document.createElement('canvas'); canvas.width = AW; canvas.height = AH;
  const c2 = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(16, ctx.renderer?.capabilities?.getMaxAnisotropy?.() || 8); disposables.push(tex);
  const blank = [0.9, 0.06]; // canvas (1843, 962): white
  const rect = (x, y, w, h) => [x / AW, 1 - (y + h) / AH, (x + w) / AW, 1 - y / AH];
  const titleRect = [0, 0, 2048, 150], labelRect = (k) => [(k % 4) * 512, 170 + Math.floor(k / 4) * 256, 512, 256], saleRect = [0, 700, 512, 256];
  const bannerRect = [560, 700, 1488, 300];   // spare atlas space: distress banner, drawn every atlas redraw
  const printedMat = new THREE.MeshPhysicalMaterial({
    map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.15,
  });
  printedMat.name = 'sim-printed'; disposables.push(printedMat);
  const printedParts = [];
  for (let k = 0; k < nBars; k++) {
    const g = wedgeGeometry(BAR_W + 1.2, 2.6, 2.0, 0.5, rect(...labelRect(k)), blank);
    g.translate(barX(k), BRICK_H, labelZ); printedParts.push(g);
  }
  const board = wedgeGeometry(plateW - 3, 2.6, 1.05, 0.3, rect(...titleRect), blank);
  board.translate(0, BRICK_H, titleZ); printedParts.push(board);
  const printedGeo = mergeGeometries(printedParts, false); for (const p of printedParts) p.dispose(); disposables.push(printedGeo);
  const printed = new THREE.Mesh(printedGeo, printedMat); printed.castShadow = printed.receiveShadow = true; printed.name = 'printed-tiles';
  chart.add(printed);

  // "FOR SALE" signs on empty zoned lots whose zone nobody wants (demand < 0.25)
  const signBoardGeo = quadGeometry(2.0, 1.0, rect(...saleRect)); signBoardGeo.translate(0, 2.0, 0.09); disposables.push(signBoardGeo);
  const signPostGeo = materials.bevelBox(0.16, 2.4, 0.16, 0.02, 1);
  const nLots = city.emptyLots.length;
  const signBoards = new THREE.InstancedMesh(signBoardGeo, printedMat, Math.max(1, nLots));
  const signPosts = new THREE.InstancedMesh(signPostGeo, materials.plastic('white', { roughness: 0.4 }), Math.max(1, nLots));
  signBoards.castShadow = signPosts.castShadow = true; signBoards.receiveShadow = signPosts.receiveShadow = true;
  signBoards.name = 'sale-signs'; signPosts.name = 'sale-posts';
  group.add(signBoards, signPosts);
  let signKey = '';
  function refreshSigns(demand) {
    const key = `${demand.r < 0.25 ? 1 : 0}${demand.c < 0.25 ? 1 : 0}${demand.i < 0.25 ? 1 : 0}`;
    if (key === signKey) return;
    signKey = key;
    let k = 0;
    for (const lot of city.emptyLots) {
      if (demand[lot.zone] >= 0.25) continue;
      const { x, z } = world.cellToWorld(lot.i, lot.j);
      setInstance(signBoards, k, x - 1.2, 0, z + 2.6); setInstance(signPosts, k, x - 1.2, 0, z + 2.6); k++;
    }
    signBoards.count = signPosts.count = k;
    signBoards.instanceMatrix.needsUpdate = true; signPosts.instanceMatrix.needsUpdate = true;
  }

  // ---- distress banner: a red/yellow hazard board that mounts above the title once the city is bankrupt
  // (debt saturated at 1.0 for BANKRUPT_HOLD_TICKS running, see model.js) — the visible endpoint for a long bust. ---
  const BANNER_W = 12, BANNER_H = 2.4, bannerCenterY = 7.4;
  const bannerBoardGeo = quadGeometry(BANNER_W, BANNER_H, rect(...bannerRect)); disposables.push(bannerBoardGeo);
  const bannerPostGeo = materials.bevelBox(0.26, bannerCenterY - BANNER_H / 2 - BRICK_H, 0.26, 0.04, 1); disposables.push(bannerPostGeo);
  const bannerGroup = new THREE.Group(); bannerGroup.name = 'distress-banner'; bannerGroup.visible = false;
  const bannerPostL = new THREE.Mesh(bannerPostGeo, materials.plastic('darkStoneGrey'));
  bannerPostL.position.set(-BANNER_W / 2 + 0.6, BRICK_H, titleZ); bannerPostL.castShadow = bannerPostL.receiveShadow = true;
  const bannerPostR = bannerPostL.clone(); bannerPostR.position.x = BANNER_W / 2 - 0.6;
  const bannerBoard = new THREE.Mesh(bannerBoardGeo, printedMat);
  bannerBoard.position.set(0, bannerCenterY, titleZ + 0.06); bannerBoard.castShadow = bannerBoard.receiveShadow = true;
  bannerGroup.add(bannerPostL, bannerPostR, bannerBoard);
  chart.add(bannerGroup);
  function refreshDistress(stats) { bannerGroup.visible = !!stats.bankrupt; }

  const FONT = 'system-ui, Segoe UI, Arial, sans-serif';
  let atlasKey = '';
  function drawAtlas(stats) {
    const values = valuesOf(stats);
    const texts = values.map((v, k) => BAR_DEFS[k].fmt(v));
    const sub = `${stats.cityLevelName.toUpperCase()}  ·  DAY ${stats.day}  ·  EMPLOYMENT ${Math.round(stats.employment * 100)}%  ·  TRAFFIC ${Math.round(stats.traffic * 100)}%`;
    const key = stats.cityName + '|' + sub + '|' + texts.join('|');
    if (key === atlasKey) return;      // only re-upload the atlas when some printed text changed
    atlasKey = key;
    c2.fillStyle = '#F4F4F4'; c2.fillRect(0, 0, AW, AH);
    // title
    const [tx, ty, tw, th] = titleRect;
    c2.fillStyle = '#1B2A34'; c2.textBaseline = 'middle';
    const name = stats.cityName.toUpperCase();
    c2.font = `700 96px ${FONT}`; c2.textAlign = 'left';
    c2.fillText(name, tx + 64, ty + th / 2 + 2);
    const nameW = c2.measureText(name).width;
    const room = tw - 60 - (tx + 64 + nameW + 70);
    let px = 60;
    c2.font = `600 ${px}px ${FONT}`;
    while (px > 36 && c2.measureText(sub).width > room) { px -= 4; c2.font = `600 ${px}px ${FONT}`; }
    c2.textAlign = 'right'; c2.fillStyle = '#595D60';
    c2.fillText(sub, tx + tw - 60, ty + th / 2 + 2);
    c2.fillStyle = '#C4281C'; c2.fillRect(tx + 18, ty + 24, 22, th - 48);       // red swatch stripe
    // labels
    for (let k = 0; k < nBars; k++) {
      const [x, y, w, h] = labelRect(k), d = BAR_DEFS[k];
      const debt = k === 2 && values[2] < 0;
      c2.fillStyle = debt ? '#C4281C' : '#' + barColor[k].getHexString(); c2.fillRect(x + 28, y + 32, 36, h - 64);
      c2.fillStyle = '#595D60'; c2.textAlign = 'left'; c2.font = `700 52px ${FONT}`;
      c2.fillText(d.label, x + 88, y + 72);
      c2.fillStyle = debt ? '#C4281C' : '#1B2A34'; c2.font = `700 96px ${FONT}`;
      c2.fillText(texts[k], x + 88, y + 172);
    }
    // for-sale sign
    const [sx, sy, sw, sh] = saleRect;
    c2.fillStyle = '#C4281C'; c2.fillRect(sx, sy, sw, sh);
    c2.fillStyle = '#F4F4F4'; c2.fillRect(sx + 14, sy + 14, sw - 28, sh - 28);
    c2.fillStyle = '#C4281C'; c2.textAlign = 'center'; c2.font = `900 120px ${FONT}`;
    c2.fillText('FOR SALE', sx + sw / 2, sy + sh / 2 - 22);
    c2.fillStyle = '#595D60'; c2.font = `700 46px ${FONT}`;
    c2.fillText('ZONED LOT  ·  ENQUIRE AT CITY HALL', sx + sw / 2, sy + sh / 2 + 78);
    // distress banner (drawn every redraw; only shown once `bankrupt` — see refreshDistress)
    const [bx, by, bw, bh] = bannerRect;
    c2.fillStyle = '#F5CD2F'; c2.fillRect(bx, by, bw, bh);
    c2.fillStyle = '#C4281C'; c2.fillRect(bx + 14, by + 14, bw - 28, bh - 28);
    c2.fillStyle = '#F4F4F4'; c2.textAlign = 'center'; c2.font = `900 108px ${FONT}`;
    c2.fillText('CITY BANKRUPT', bx + bw / 2, by + bh / 2 - 30);
    c2.font = `700 46px ${FONT}`;
    c2.fillText('TREASURY IN STATE RECEIVERSHIP', bx + bw / 2, by + bh / 2 + 56);
    tex.needsUpdate = true;
  }
  function valuesOf(stats) {
    return [stats.population, stats.jobs, stats.money, stats.happiness, stats.demand.r, stats.demand.c, stats.demand.i];
  }
  function targetsOf(stats) {
    const v = valuesOf(stats);
    const norm = [v[0] / scale.population, v[1] / scale.jobs, Math.abs(v[2]) / scale.money, v[3], v[4], v[5], v[6]];
    for (let k = 0; k < nBars; k++) target[k] = Math.max(0, Math.min(1, norm[k])) * MAX_BAR_BRICKS;
    const debt = v[2] < 0;
    if (debt !== inDebt) { inDebt = debt; visDirty = true; }
  }

  // ---- night: soft label glow (≤ 1, never flat white), lamp glass, window glow, four warm pooled spots -------
  function applyNight() {
    const night = ctx.clock.isNight;
    printedMat.emissiveIntensity = night ? 0.55 : 0;
    lampGlass.material = night ? glassNight : glassDay;
    winLitMesh.material = night ? winBackLit : winBackDark;
    for (const s of spots) s.intensity = night ? 42 : 0;
    studMat.envMapIntensity = instMat.envMapIntensity;
  }
  const offTime = ctx.events.on('time:changed', applyNight);

  // ---- ground / sidewalk stud instancers (built last: sidewalks added to the lists above) ----------------
  // Two capacity-sized InstancedMeshes (hi/lo); refreshCameraLOD() below re-partitions the same stud list between
  // them by live distance-to-camera, so whichever part of the district the camera is actually near gets hi-poly
  // studs — not just a fixed radius around the chart.
  const nGroundStuds = groundStuds.length / 4;
  const groundColor = new Array(nGroundStuds);
  for (let k = 0; k < nGroundStuds; k++) groundColor[k] = materials.color(groundStuds[k * 4 + 3]);
  const groundHi = new THREE.InstancedMesh(studGeoHi, studMat, Math.max(1, nGroundStuds));
  const groundLo = new THREE.InstancedMesh(studGeoLow, studMat, Math.max(1, nGroundStuds));
  groundHi.receiveShadow = groundLo.receiveShadow = true; groundHi.castShadow = groundLo.castShadow = false;
  groundHi.name = 'ground-studs-hi'; groundLo.name = 'ground-studs-lo';
  group.add(groundHi, groundLo);
  function refreshGroundLOD() {
    let h = 0, l = 0;
    for (let k = 0; k < nGroundStuds; k++) {
      const x = groundStuds[k * 4], y = groundStuds[k * 4 + 1], z = groundStuds[k * 4 + 2];
      if (ctx.camera.position.distanceToSquared(_camPt.set(x, y, z)) < CAM_HI_RADIUS * CAM_HI_RADIUS) {
        setInstance(groundHi, h, x, y, z); groundHi.setColorAt(h, groundColor[k]); h++;
      } else {
        setInstance(groundLo, l, x, y, z); groundLo.setColorAt(l, groundColor[k]); l++;
      }
    }
    groundHi.count = h; groundLo.count = l;
    groundHi.instanceMatrix.needsUpdate = true; if (groundHi.instanceColor) groundHi.instanceColor.needsUpdate = true;
    groundLo.instanceMatrix.needsUpdate = true; if (groundLo.instanceColor) groundLo.instanceColor.needsUpdate = true;
  }

  // ---- building roof-cap LOD: two merged cap geometries (hi/lo) + two InstancedMeshes per footprint size, split
  // by the same live camera distance as the ground studs (see rebuildCaps, called from refreshBuildings and from
  // refreshCameraLOD). -----------------------------------------------------------------------------------------
  function rebuildCaps(grp) {
    let h = 0, l = 0;
    for (const e of grp.list) {
      const y = e.n * BRICK_H;
      if (ctx.camera.position.distanceToSquared(_camPt.set(e.x, y, e.z)) < CAM_HI_RADIUS * CAM_HI_RADIUS) {
        setInstance(grp.capsHi, h, e.x, y, e.z); grp.capsHi.setColorAt(h, e.color); h++;
      } else {
        setInstance(grp.capsLo, l, e.x, y, e.z); grp.capsLo.setColorAt(l, e.color); l++;
      }
    }
    grp.capsHi.count = h; grp.capsLo.count = l;
    grp.capsHi.instanceMatrix.needsUpdate = true; if (grp.capsHi.instanceColor) grp.capsHi.instanceColor.needsUpdate = true;
    grp.capsLo.instanceMatrix.needsUpdate = true; if (grp.capsLo.instanceColor) grp.capsLo.instanceColor.needsUpdate = true;
  }

  // ---- shared throttle: re-bucket studs/caps only once the camera has actually moved (cheap, correct anywhere) --
  const _camLast = new THREE.Vector3(Infinity, Infinity, Infinity);
  function refreshCameraLOD(force) {
    if (!force && _camLast.distanceTo(ctx.camera.position) < CAM_LOD_MOVE) return;
    _camLast.copy(ctx.camera.position);
    refreshGroundLOD();
    for (const grp of sizes.values()) rebuildCaps(grp);
  }

  // ---- init ----------------------------------------------------------------------------------------
  const st0 = model.stats;
  scale.population = niceScale(st0.population * 1.5, 1000);
  scale.jobs = niceScale(st0.jobs * 1.5, 500);
  scale.money = niceScale(Math.abs(st0.money) * 1.6, 20000);
  targetsOf(st0); vis.set(target); rebuildBars(); drawAtlas(st0); refreshBuildings(true);
  refreshCranes(model.growth, true); refreshSigns(model.demand); refreshDistress(st0); applyNight();
  refreshCameraLOD(true);
  // InstancedMesh frustum culling uses the raw (un-instanced) geometry's local bounding sphere, which sits near
  // this group's own origin — it does not expand to cover where per-instance matrices actually place instances
  // across the ~200 m district. Left on, a camera framed tightly on a district corner far from that origin (any
  // close-up shot that doesn't also happen to see the chart) would have every instanced mesh here culled as a
  // whole. Every mesh in this module is either small/local (chart) or already bounded by STUD_FADE / draw-count,
  // so disabling culling costs nothing measurable against budget and is the correct fix everywhere at once.
  group.traverse((o) => { if (o.isInstancedMesh) o.frustumCulled = false; });
  scene.add(group);

  return {
    group,
    onTick(stats) {
      targetsOf(stats);
      drawAtlas(stats);
      const moved = refreshBuildings(false);
      refreshCranes(model.growth, moved);
      refreshSigns(model.demand);
      refreshDistress(stats);
    },
    update(dt) {
      const a = Math.min(1, dt * 3);
      let moved = false;
      for (let k = 0; k < nBars; k++) {
        const d = target[k] - vis[k];
        if (Math.abs(d) > 0.002) { vis[k] += d * a; moved = true; }
      }
      if (moved || visDirty) { rebuildBars(); visDirty = false; }
      refreshCameraLOD(false);
    },
    dispose() {
      offTime();
      scene.remove(group);
      group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      for (const d of disposables) d.dispose?.();
    },
  };
}
