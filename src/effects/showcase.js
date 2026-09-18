import * as THREE from 'three';

// Showcase scene for the effects module: a stud baseplate, a tight cluster of beveled bricks (AO test),
// a tower with a grid of emissive windows (bloom test), lamp bricks and glass bricks.
// Everything goes into `group`; instanced meshes created here are returned for disposal.

const BRICK_H = 0.96;   // 1 brick = 1.2 stud pitches
const PLATE_H = 0.32;
const P = 0.8;          // stud pitch

export function buildShowcase(ctx, group, rng, variant = 'default') {
  const M = ctx.materials;
  const night = variant === 'night';   // staged content differs: more lamps, a second lit tower, more lit windows
  const disposables = [];
  // emissive meshes are gated on clock.isNight (see setNight): [mesh, litMaterial, darkMaterial]
  const gated = [];
  const studs = M.studs({ maxCount: 20000 });
  const groundY = ctx.world.getHeight(0, 0);

  // ---- Baseplate (64 x 64 m = 80 x 80 studs) ----
  const plate = new THREE.Mesh(M.bevelBox(64, PLATE_H, 64, 0.05), M.plastic('brightGreen'));
  plate.position.set(0, groundY, 0);
  plate.receiveShadow = true;
  plate.castShadow = false;
  group.add(plate);
  const topY = groundY + PLATE_H;
  studs.addRect(-32, -32, 32, 32, topY, 'brightGreen');

  // ---- Brick instancer helper: one InstancedMesh per geometry, per-instance colour ----
  const instMat = M.plastic('white', { instanceColor: true });
  const dims = {
    b2x4: [1.6, BRICK_H, 3.2], b2x2: [1.6, BRICK_H, 1.6], b1x2: [0.8, BRICK_H, 1.6],
    b2x3: [1.6, BRICK_H, 2.4], p2x4: [1.6, PLATE_H, 3.2], b1x1: [0.8, BRICK_H, 0.8],
  };
  const kinds = {};
  for (const [k, [w, h, d]] of Object.entries(dims)) kinds[k] = { geo: M.bevelBox(w, h, d, h > 0.5 ? 0.05 : 0.04), list: [] };
  // rot in quarter turns; studsOnTop=false where another brick sits on it.
  const brick = (kind, cx, y, cz, color, rot = 0, studsOnTop = true) => {
    kinds[kind].list.push({ cx, y, cz, color, rot });
    if (studsOnTop) {
      const [w, h, d] = dims[kind];
      const ww = rot % 2 ? d : w, dd = rot % 2 ? w : d;
      studs.addRect(cx - ww / 2, cz - dd / 2, cx + ww / 2, cz + dd / 2, y + h, color, 0.38);
    }
  };

  // ---- AO test cluster around (6, 0, 5): tight seams, inside corners, overhangs ----
  const ox = 6.0, oz = 5.2;
  const y0 = topY, y1 = y0 + BRICK_H, y2 = y1 + BRICK_H, y3 = y2 + BRICK_H;
  brick('b2x4', ox - 0.8, y0, oz, 'brightRed', 0, false);
  brick('b2x4', ox + 0.8, y0, oz, 'brightBlue', 0, false);
  brick('b2x4', ox + 2.4, y0, oz - 2.4, 'brightYellow', 1, false);
  brick('b2x4', ox - 0.8, y0, oz + 3.2, 'darkAzur', 0, true);
  brick('b2x2', ox + 3.2, y0, oz + 0.8, 'lime', 0, false);
  // layer 1: a bridge across red+blue (rot 90) and a stack on the yellow one
  brick('b2x4', ox, y1, oz - 0.4, 'white', 1, false);
  brick('b2x2', ox + 2.4, y1, oz - 2.4, 'brightGreen', 0, true);
  brick('b2x2', ox + 3.2, y1, oz + 0.8, 'brightOrange', 0, false);
  brick('b1x2', ox - 1.2, y1, oz + 1.2, 'mediumLilac', 0, true);
  // layer 2: cantilever overhang (underside occlusion), small bricks on top
  brick('b2x4', ox + 1.6, y2, oz - 0.4, 'brightOrange', 1, false);
  brick('b1x2', ox + 3.2, y2, oz + 0.8, 'darkStoneGrey', 0, true);
  brick('b2x2', ox - 0.8, y2, oz - 0.4, 'mediumStoneGrey', 0, false); // x [ox-1.6, ox]: butts against the orange 2x4 (x >= ox), no overlap
  brick('b1x2', ox + 2.8, y3, oz - 0.4, 'brightRed', 1, true);
  brick('b1x1', ox - 1.2, y3, oz - 0.8, 'brightYellow', 0, true);
  brick('b1x1', ox, y3, oz, 'brightBlue', 0, true);
  // a wall behind the cluster: staggered courses (brick bond) with an inside corner
  const wallX = ox - 4.0, wallZ = oz - 2.0;
  for (let r = 0; r < 5; r++) {
    const y = y0 + r * BRICK_H;
    const shift = (r % 2) * 1.6;
    for (let k = 0; k < 4; k++) {
      brick('b2x4', wallX, y, wallZ + shift + k * 3.2 - 1.6, k % 2 === r % 2 ? 'darkRed' : 'brightRed', 0, r === 4);
    }
    // return wall (inside corner)
    for (let k = 0; k < 2; k++) {
      brick('b2x4', wallX + 1.6 + (r % 2 ? 1.6 : 0) + k * 3.2, y, wallZ - 2.4, k % 2 ? 'darkRed' : 'brightRed', 1, r === 4);
    }
  }
  // scattered loose bricks + plates (like a build table)
  const loose = [
    ['b2x4', -14, 12, 'brightBlue', 1], ['b2x2', -9, 14, 'brightYellow', 0], ['b2x3', 18, -4, 'mediumAzur', 1],
    ['p2x4', 15, 14, 'tan', 0], ['b2x4', 20, 8, 'brightGreen', 0], ['b1x2', 12, -8, 'brightRed', 1],
    ['b2x2', -18, -12, 'brightOrange', 0], ['b2x4', -20, 2, 'lime', 1], ['b2x3', 4, 16, 'sandGreen', 0],
    ['p2x4', -4, -16, 'brightYellow', 1], ['b2x2', 24, -14, 'mediumLilac', 0], ['b1x2', -12, -6, 'white', 0],
  ];
  for (const [k, x, z, c, r] of loose) {
    const sx = Math.round(x / P) * P, sz = Math.round(z / P) * P;
    brick(k, sx, y0, sz, c, r, true);
  }
  // a small stack of plates (thin seams)
  const plateCols = ['brightRed', 'white', 'brightBlue', 'brightYellow'];
  for (let i = 0; i < 4; i++) brick('p2x4', -6.4, y0 + i * PLATE_H, 15.2, plateCols[i], 1, i === 3);

  // commit brick instancers
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (const [name, k] of Object.entries(kinds)) {
    if (!k.list.length) continue;
    const mesh = new THREE.InstancedMesh(k.geo, instMat, k.list.length);
    k.list.forEach((b, i) => {
      dummy.position.set(b.cx, b.y, b.cz);
      dummy.rotation.set(0, (b.rot * Math.PI) / 2, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, col.copy(M.color(b.color)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `bricks:${name}`;
    group.add(mesh);
    disposables.push(mesh);
  }

  const mkInst = (geo, mat, list, name, shadow = true) => {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    list.forEach((w, i) => {
      dummy.position.set(w.x, w.y, w.z);
      dummy.rotation.set(0, w.rot, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.name = name;
    group.add(mesh);
    disposables.push(mesh);
    return mesh;
  };

  // ---- Tower(s) with a grid of emissive windows (bloom test) ----
  // Window rows are 3.04 m apart (pane 1.28 m tall, centred 2.4 m + r*3.04 above the plate), so a row spans
  // [1.76, 3.04] + r*3.04 and the gap between rows is [3.04, 4.8] + r*3.04. Plate bands go in the middle of every
  // second gap (never through a window row).
  const winW = 1.6, winH = 1.28, cols = 3;
  const frameGeo = M.bevelBox(winW + 0.32, winH + 0.32, 0.20, 0.03);
  const paneGeo = M.bevelBox(winW, winH, 0.14, 0.03);
  // lit panes are opaque (a blind with light behind it): transYellow glass at 0.55 opacity never clears the 1.0 bloom
  // threshold without washing out to cream. brightYellow x 1.7 sits at ~1.3 luminance: blooms softly, stays yellow.
  const litMat = M.plastic('brightYellow', { emissive: 'brightYellow', emissiveIntensity: 1.7, roughness: 0.4, clearcoat: 0.3 });
  const paneDark = M.glass('transBlue');
  const frames = [], lit = [], unlit = [];
  const sides = [
    { n: [0, 0, 1], rot: 0 }, { n: [0, 0, -1], rot: Math.PI }, { n: [1, 0, 0], rot: Math.PI / 2 }, { n: [-1, 0, 0], rot: -Math.PI / 2 },
  ];
  const bandGeo = M.bevelBox(8.24, 0.32, 8.24, 0.04);
  const tower = (tx, tz, rows, wallColor, bandColor, litChance) => {
    const tw = 8.0, th = rows * 3.04 + 2.72;
    const body = new THREE.Mesh(M.bevelBox(tw, th, tw, 0.08), M.plastic(wallColor));
    body.position.set(tx, topY, tz);
    body.castShadow = body.receiveShadow = true;
    group.add(body);
    // horizontal bands (plate courses) break up the tall wall and give AO some ledges: base + every 2nd row gap
    const bands = [{ x: tx, y: topY, z: tz, rot: 0 }];
    for (let r = 1; r < rows; r += 2) bands.push({ x: tx, y: topY + 3.76 + r * 3.04, z: tz, rot: 0 });
    mkInst(bandGeo, M.plastic(bandColor), bands, `tower-bands:${wallColor}`);
    // roof: studs + a small penthouse
    studs.addRect(tx - tw / 2, tz - tw / 2, tx + tw / 2, tz + tw / 2, topY + th, wallColor, 0.5);
    const pent = new THREE.Mesh(M.bevelBox(3.2, 1.92, 3.2, 0.06), M.plastic('darkStoneGrey'));
    pent.position.set(tx + 1.6, topY + th, tz - 1.6);
    pent.castShadow = pent.receiveShadow = true;
    group.add(pent);
    // windows: frames (dark) + lit (emissive transYellow at night) + unlit (transBlue glass)
    for (const s of sides) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const u = (c - (cols - 1) / 2) * 2.4;                 // along the face
          const y = topY + 2.4 + r * 3.04;                     // window centre height
          const px = tx + s.n[0] * (tw / 2) + (s.n[2] !== 0 ? u : 0);
          const pz = tz + s.n[2] * (tw / 2) + (s.n[0] !== 0 ? u : 0);
          const on = rng.chance(litChance);
          frames.push({ x: px + s.n[0] * 0.02, y: y - (winH + 0.32) / 2, z: pz + s.n[2] * 0.02, rot: s.rot });
          (on ? lit : unlit).push({ x: px + s.n[0] * 0.06, y: y - winH / 2, z: pz + s.n[2] * 0.06, rot: s.rot });
        }
      }
    }
  };
  tower(-9.6, -8.0, 7, 'brickYellow', 'darkOrange', night ? 0.78 : 0.62);
  if (night) tower(9.6, -22.4, 5, 'white', 'darkAzur', 0.7);
  mkInst(frameGeo, M.plastic('darkStoneGrey'), frames, 'window-frames');
  gated.push([mkInst(paneGeo, paneDark, lit, 'windows-lit', false), litMat, paneDark]);
  mkInst(paneGeo, paneDark, unlit, 'windows-dark', false);

  // ---- Lamp posts: grey post + emissive brightRed / transYellow lamp bricks (emissive only when isNight) ----
  // (saturated red has low luminance: intensity 5 puts it at ~1.4 so it clears the night bloom threshold)
  const posts = [{ x: 12.0, z: 0.8 }, { x: -1.6, z: 12.0 }, { x: -18.4, z: -4.0 }, { x: 15.2, z: -12.0 }];
  if (night) posts.push({ x: -4.0, z: 3.2 }, { x: -20.0, z: 10.4 }, { x: 4.0, z: -16.0 }, { x: 22.4, z: 4.0 }, { x: -8.0, z: 20.0 });
  const red = posts.filter((_, i) => i % 2 === 0), yellow = posts.filter((_, i) => i % 2 === 1);
  mkInst(M.bevelBox(0.5, 4.8, 0.5, 0.04), M.plastic('darkStoneGrey'), posts.map((p) => ({ x: p.x, y: topY, z: p.z, rot: 0 })), 'lamp-posts');
  const lampGeo = M.bevelBox(0.8, 0.8, 0.8, 0.08);
  const lampAt = (p) => ({ x: p.x, y: topY + 4.8, z: p.z, rot: 0 });
  gated.push([mkInst(lampGeo, M.glass('transRed'), red.map(lampAt), 'lamps-red', false), M.emissive('brightRed', 5), M.glass('transRed')]);
  gated.push([mkInst(lampGeo, M.glass('transYellow'), yellow.map(lampAt), 'lamps-yellow', false), M.emissive('transYellow', 3), M.glass('transYellow')]);
  mkInst(M.bevelBox(1.0, 0.32, 1.0, 0.04), M.plastic('darkStoneGrey'), posts.map((p) => ({ x: p.x, y: topY + 5.6, z: p.z, rot: 0 })), 'lamp-caps');

  // ---- Glass bricks ----
  const glassSpecs = [
    [M.bevelBox(3.2, 1.92, 1.6, 0.05), 'transClear', 4.0, 11.2],
    [M.bevelBox(1.6, BRICK_H, 1.6, 0.05), 'transBlue', 1.6, 10.4],
    [M.bevelBox(1.6, BRICK_H, 3.2, 0.05), 'transRed', 16.0, 4.0],
  ];
  for (const [geo, c, x, z] of glassSpecs) {
    const g = new THREE.Mesh(geo, M.glass(c));
    g.position.set(x, topY, z);
    g.castShadow = false;
    g.receiveShadow = true;
    group.add(g);
  }

  studs.commit(group);
  let isNight = null;
  const setNight = (v) => {
    if (v === isNight) return;
    isNight = v;
    for (const [mesh, litM, darkM] of gated) mesh.material = v ? litM : darkM;
  };
  return { studs, disposables, setNight };
}
