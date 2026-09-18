// Showcase backdrop for the UI module: a big green stud plate, a road cross, coloured brick "buildings" with
// windows (emissive at night) and a few Lego trees. Only used by `?showcase=ui`; never in the full game.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const PLATE = 200; // meters, centred on origin
const ROAD_W = 8;

const BRICKS = [
  { x: -30, z: -30, w: 16, d: 16, h: 12, c: 'brightRed' },
  { x: -54, z: -22, w: 12, d: 12, h: 8, c: 'brightYellow' },
  { x: 26, z: -38, w: 16, d: 20, h: 28, c: 'white' },
  { x: 46, z: -18, w: 12, d: 12, h: 18, c: 'mediumAzur' },
  { x: 30, z: 30, w: 20, d: 16, h: 9, c: 'brightOrange' },
  { x: -32, z: 30, w: 12, d: 12, h: 6, c: 'lime' },
  { x: -58, z: 50, w: 14, d: 12, h: 5, c: 'darkStoneGrey' },
  { x: 58, z: 54, w: 12, d: 12, h: 22, c: 'brightBlue' },
  { x: -18, z: -62, w: 10, d: 10, h: 15, c: 'brightGreen' },
  { x: 20, z: 60, w: 8, d: 8, h: 4, c: 'transClear' },
];
const TREES = [[-12, 12], [-12, 22], [-12, 32], [12, -12], [12, -22], [12, -32], [-40, -50], [-48, 12], [40, 8], [48, -48], [-68, -60], [64, 30]];

const ZONE_OF = { brightRed: 'r', brightYellow: 'r', lime: 'r', brightGreen: 'r', white: 'c', mediumAzur: 'c', brightBlue: 'c',
  brightOrange: 'i', darkStoneGrey: 'i', transClear: 'c' };

/** Mirror the backdrop into the world model (roads/zones/buildings) so the minimap has something to draw. */
function populateWorld(world) {
  const H = PLATE / 2;
  const zoneRect = (x0, z0, x1, z1, zone) => {
    const a = world.worldToCell(x0, z0), b = world.worldToCell(x1 - 0.01, z1 - 0.01);
    for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) world.setZone(i, j, zone, 1);
  };
  const parkRect = (x0, z0, x1, z1) => {
    const a = world.worldToCell(x0, z0), b = world.worldToCell(x1 - 0.01, z1 - 0.01);
    for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) { const c = world.cellAt(i, j); if (c && c.type === 'none') world.setCell(i, j, { type: 'park' }); }
  };
  zoneRect(-72, -72, -8, -8, 'r');
  zoneRect(8, -72, 72, -8, 'c');
  zoneRect(8, 8, 72, 72, 'i');
  parkRect(-72, 8, -8, 40);
  zoneRect(-72, 40, -8, 72, 'r');
  // Road cells painted directly (world.addRoad would make clearContent() crash on re-stage — see docs/core-requests/ui.md)
  const roadRect = (x0, z0, x1, z1) => {
    const a = world.worldToCell(x0 + 0.01, z0 + 0.01), b = world.worldToCell(x1 - 0.01, z1 - 0.01);
    for (let j = a.j; j <= b.j; j++) for (let i = a.i; i <= b.i; i++) world.setCell(i, j, { type: 'road', zone: null, density: 0 });
  };
  roadRect(-H, -ROAD_W / 2, H, ROAD_W / 2);
  roadRect(-ROAD_W / 2, -H, ROAD_W / 2, H);
  for (const b of BRICKS) {
    const { i, j } = world.worldToCell(b.x - b.w / 2 + 0.01, b.z - b.d / 2 + 0.01);
    world.addBuilding({ i, j, w: Math.max(1, Math.round(b.w / world.cellSize)), d: Math.max(1, Math.round(b.d / world.cellSize)),
      zone: ZONE_OF[b.c] || 'c', level: b.h > 15 ? 3 : b.h > 8 ? 2 : 1, height: b.h, kind: 'brick' });
  }
}

export function stageBackdrop(ctx, variant, rng) {
  const M = ctx.materials;
  const group = new THREE.Group();
  group.name = 'ui-showcase';
  populateWorld(ctx.world);
  // Showcase-private geometries (not the shared core bevelBox cache) so dispose() can free them on every re-stage.
  const geos = [];
  const box = (w, h, d, bevel = 0.06, segments = 2) => {
    const g = new RoundedBoxGeometry(w, h, d, segments, Math.min(bevel, Math.min(w, h, d) * 0.45));
    g.translate(0, h / 2, 0);
    geos.push(g);
    return g;
  };

  // ground plate (top at y=0)
  const plate = new THREE.Mesh(box(PLATE, 1.6, PLATE, 0.4), M.plastic('brightGreen'));
  plate.position.y = -1.6;
  plate.receiveShadow = true;
  group.add(plate);

  // road cross
  const roadMat = M.plastic('darkStoneGrey', { roughness: 0.55, clearcoat: 0.3 });
  const roadX = new THREE.Mesh(box(PLATE, 0.36, ROAD_W, 0.08), roadMat);
  const roadZ = new THREE.Mesh(box(ROAD_W, 0.36, PLATE, 0.08), roadMat);
  for (const r of [roadX, roadZ]) { r.receiveShadow = true; r.castShadow = false; group.add(r); }
  // lane dashes (one instanced mesh)
  const dashGeo = box(2.4, 0.05, 0.3, 0.02, 1);
  const dashes = new THREE.InstancedMesh(dashGeo, M.plastic('brightYellow', { roughness: 0.5, clearcoat: 0.2 }), 2 * Math.floor(PLATE / 5));
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (let x = -PLATE / 2 + 2.5; x < PLATE / 2; x += 5) {
    if (Math.abs(x) < ROAD_W / 2 + 1) continue;
    dashes.setMatrixAt(n++, m4.makeTranslation(x, 0.36, 0));
    dashes.setMatrixAt(n++, m4.makeRotationY(Math.PI / 2).setPosition(0, 0.36, x));
  }
  dashes.count = n; dashes.instanceMatrix.needsUpdate = true;
  group.add(dashes);

  // studs: plate quadrants (excluding the road cross) + brick tops
  const studs = M.studs({ maxCount: 120000 });
  const H = PLATE / 2, hw = ROAD_W / 2;
  studs.addRect(-H, -H, -hw, -hw, 0, 'brightGreen');
  studs.addRect(hw, -H, H, -hw, 0, 'brightGreen');
  studs.addRect(-H, hw, -hw, H, 0, 'brightGreen');
  studs.addRect(hw, hw, H, H, 0, 'brightGreen');

  // bricks
  const winMats = [];
  const winMatrices = [];
  const q = new THREE.Quaternion();
  for (const b of BRICKS) {
    const mesh = new THREE.Mesh(box(b.w, b.h, b.d, 0.25), M.plastic(b.c));
    mesh.position.set(b.x, 0, b.z);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    if (!M.isTrans(b.c)) studs.addRect(b.x - b.w / 2, b.z - b.d / 2, b.x + b.w / 2, b.z + b.d / 2, b.h, b.c);
    if (b.h < 8 || M.isTrans(b.c)) continue;
    // windows on all four faces: 1.6 m panes on a 3.2 m grid, seeded on/off
    const rows = Math.floor((b.h - 2) / 3.2);
    for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const len = nx ? b.d : b.w;
      const cols = Math.floor((len - 2) / 3.2);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!rng.chance(0.62)) continue;
        const along = -len / 2 + 1.6 + (c + 0.5) * ((len - 3.2) / cols);
        const px = b.x + nx * (b.w / 2 + 0.02) + nz * along;
        const pz = b.z + nz * (b.d / 2 + 0.02) + nx * along;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), nx ? Math.PI / 2 : 0);
        winMatrices.push(new THREE.Matrix4().compose(new THREE.Vector3(px, 2.2 + r * 3.2, pz), q, new THREE.Vector3(1, 1, 1)));
      }
    }
  }
  const winGeo = box(1.6, 1.8, 0.16, 0.03, 1);
  winGeo.computeBoundingSphere();
  const mkWin = (mat) => {
    const im = new THREE.InstancedMesh(winGeo, mat, Math.max(1, winMatrices.length));
    winMatrices.forEach((m, i) => im.setMatrixAt(i, m));
    im.count = winMatrices.length; im.instanceMatrix.needsUpdate = true;
    im.castShadow = false; im.receiveShadow = false;
    group.add(im);
    winMats.push(im);
    return im;
  };
  const winDay = mkWin(M.glass('transBlue', { opacity: 0.85 }));
  const winNight = mkWin(M.emissive('brightYellow', 2.2));

  // Lego trees: instanced trunk + 3 stacked leaf bricks
  const trunkGeo = new THREE.CylinderGeometry(0.55, 0.65, 3.2, 10).translate(0, 1.6, 0);
  geos.push(trunkGeo);
  const trunk = new THREE.InstancedMesh(trunkGeo, M.plastic('reddishBrown'), TREES.length);
  const leaf = [[4.8, 2.4, 'darkGreen', 3.0], [3.6, 2.4, 'brightGreen', 5.2], [2.4, 2.4, 'lime', 7.4]].map(([s, hh, col, y]) => {
    const im = new THREE.InstancedMesh(box(s, hh, s, 0.2), M.plastic(col), TREES.length);
    im._y = y; return im;
  });
  TREES.forEach(([x, z], i) => {
    trunk.setMatrixAt(i, m4.makeTranslation(x, 0, z));
    for (const l of leaf) l.setMatrixAt(i, m4.makeRotationY(rng.range(0, Math.PI)).setPosition(x, l._y, z));
  });
  for (const im of [trunk, ...leaf]) { im.instanceMatrix.needsUpdate = true; im.castShadow = true; im.receiveShadow = true; group.add(im); }

  studs.commit(group);
  ctx.scene.add(group);

  const applyNight = () => { const night = ctx.clock.isNight; winNight.visible = night; winDay.visible = !night; };
  applyNight();
  const off = ctx.events.on('time:changed', applyNight);

  return {
    group,
    dispose() {
      off();
      ctx.scene.remove(group);
      for (const g of geos) g.dispose();
      geos.length = 0;
      studs.clear();
    },
  };
}

/** Sample inspect card shown by the showcase (HTML consumed by api.setInfoPanel). */
export function sampleInfoCard() {
  return `
    <div class="lc-swatch" style="--lc-sw:#d7302a"></div>
    <h2>Maple Street Flats</h2>
    <p><span class="lc-tag r">Residential</span> &nbsp; Level 2 &nbsp;·&nbsp; 2×2 cells</p>
    <h4>Occupancy</h4>
    <div class="lc-bar"><i style="width:78%"></i></div>
    <div class="lc-kv">
      <span>Residents</span><span>46 / 58</span>
      <span>Land value</span><span>$1,240</span>
      <span>Happiness</span><span>84%</span>
      <span>Power</span><span>On</span>
      <span>Water</span><span>On</span>
    </div>
    <h4>Notes</h4>
    <p>Close to Central Park and the tram stop. Residents want a school within 6 cells.</p>`;
}
