// Showcase scene: a Blox-brick hi-fi (two speaker cabinets + an amp with LED, display and a 5-brick VU row) on a
// sea of green baseplates with a few scale props (pine trees, a lamp post, a park bench).
// Materials are shared via ctx.materials; geometry is merged per material so the whole set stays ~20 draw calls.
// Real studs cover the central plate and shrink out over [STUD_FADE_NEAR, STUD_FADE_FAR] while a procedural stud
// relief on the ground fades in over the same band, so the horizon is bricks without 500k instances.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PLATE = 102.4; // metres of real studs (128 × 128 = 4 × 4 baseplates, so the LOD edge sits on a seam)
const GROUND = 560; // metres of baseplate sea
const PLATE_H = 0.32; // Blox plate thickness at 0.8 m stud pitch
const BRICK_H = 0.96;
const PITCH = 0.8;
const BASEPLATE = 32 * PITCH; // 32 × 32 stud baseplate seams
const STUD_FADE_NEAR = 110, STUD_FADE_FAR = 150;
const INNER = GROUND / 2; // 280 m: half-width of the square baseplate sea, where the horizon skirt picks up
const SKIRT_R = 950; // metres the rolling-terrain skirt reaches out to, so extreme-distance shots never see a void edge

function smoothstepJS(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
/** Ridged noise (peaks wherever fbm crosses zero) so the skirt stays undulating instead of settling into flat basins. */
function ridgeJS(t) { const r = 1 - Math.abs(t); return r * r; }

/** Height field for the horizon skirt: flat at the plate edge, ramping into low rolling hills within ~260 m of the
 * plate and growing gently taller with distance — enough relief that the tree line never reads as a hard flat edge
 * against the sky, without competing with the hi-fi as the focal point. */
function makeSkirtHeight(rng) {
  const n = rng.fork ? rng.fork('audio-skirt-terrain') : rng;
  return (x, z, dOut) => {
    const ramp = smoothstepJS(0, 260, dOut);
    if (ramp <= 0) return 0;
    const near = ridgeJS(n.fbm(x / 110 + 31.2, z / 110 - 17.6, 4));
    const far = ridgeJS(n.fbm(x / 340 + 4.4, z / 340 + 61.9, 3));
    const farRamp = smoothstepJS(220, 700, dOut);
    const amp = 9 + 20 * farRamp;
    return (near * 0.6 + far * 0.4) * amp * ramp;
  };
}

/** Annular skirt mesh: inner edge follows the square plate's perimeter exactly (Chebyshev radius, so there's no
 * gap or overlap at the corners), outer edge is a circle at `outerR`. Vertex colours fade from the plate's bright
 * green through a duller forest green to a hazy far green so distance fog (applied per-pixel by the renderer,
 * whatever the current sky/weather) has a plausible base colour to blend from instead of a flat plate colour. */
function buildSkirtGeometry(innerAt, outerR, rings, segments, heightFn, cNear, cMid, cFar) {
  const pos = [], col = [];
  const c = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const rt = Math.pow(t, 0.55); // more rings close to the inner edge, where the terrain rises fastest
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const rIn = innerAt(a);
      const r = rIn + (outerR - rIn) * rt;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = i === 0 ? 0 : heightFn(x, z, r - rIn);
      pos.push(x, h, z);
      if (t < 0.35) c.copy(cNear).lerp(cMid, t / 0.35); else c.copy(cMid).lerp(cFar, (t - 0.35) / 0.65);
      col.push(c.r, c.g, c.b);
    }
  }
  const idx = [];
  for (let i = 0; i < rings; i++) {
    const a0 = i * segments, b0 = (i + 1) * segments;
    for (let j = 0; j < segments; j++) {
      const j2 = (j + 1) % segments;
      idx.push(a0 + j, a0 + j2, b0 + j2);
      idx.push(a0 + j, b0 + j2, b0 + j);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildSpeakerScene(ctx, { variant = 'default', rng } = {}) {
  const M = ctx.materials;
  const wet = variant === 'rain';
  const group = new THREE.Group();
  group.name = 'audio';
  const parts = new Map(); // materialKey -> { mat, geos }
  const gloss = { roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08 };
  const wetOpts = { roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.06 };
  const matFor = (color, kind = 'plastic') => {
    if (kind === 'gloss') return M.plastic(color, wet ? wetOpts : gloss);
    return M.plastic(color, wet ? wetOpts : {});
  };
  const add = (color, geo, x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, kind = 'plastic') => {
    const g = geo.clone();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m);
    const key = `${color}:${kind}`;
    if (!parts.has(key)) parts.set(key, { mat: matFor(color, kind), geos: [] });
    parts.get(key).geos.push(g);
  };

  // ---- ground: one 560 m plate with baseplate seams + stud relief in the shader --------------------------------
  // wet ground is a touch rougher than the props so grazing sky reflection doesn't wash the far plates to white
  const groundMat = M.plastic('brightGreen', wet ? { ...wetOpts, roughness: 0.2 } : {}).clone();
  groundMat.name = 'audio:ground';
  const studFade = new THREE.Vector2(STUD_FADE_NEAR, STUD_FADE_FAR);
  patchGround(groundMat, { uStudFade: { value: studFade }, uStudPitch: { value: PITCH }, uSeam: { value: BASEPLATE }, uRelief: { value: 0.9 }, uPlateHalf: { value: PLATE / 2 - 0.2 } });
  const ground = new THREE.Mesh(new THREE.BoxGeometry(GROUND, PLATE_H, GROUND), groundMat);
  ground.position.y = PLATE_H / 2;
  ground.receiveShadow = true;
  ground.name = 'audio:ground';
  group.add(ground);

  // ---- horizon skirt: a continuous rolling-terrain ring picking up exactly at the plate's edge and reaching out
  // to SKIRT_R, so the 560 m plate never shows a hard cutoff against the sky at range (the showcase's own fallback
  // for when a far/aerial camera outruns the real-stud plate). Real per-pixel fog (from whichever environment state
  // is active) blends its outer rings toward the sky regardless of time of day or weather.
  const skirtInnerAt = (a) => INNER / Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a)), 1e-6);
  const skirtHeight = makeSkirtHeight(rng || ctx.rng.fork('audio-scene'));
  const skirtMat = M.plastic('darkGreen', { roughness: 0.9, clearcoat: 0 }).clone();
  skirtMat.name = 'audio:skirt';
  skirtMat.vertexColors = true;
  skirtMat.color.setRGB(1, 1, 1);
  skirtMat.needsUpdate = true;
  const skirtGeo = buildSkirtGeometry(skirtInnerAt, SKIRT_R, 16, 96, skirtHeight, M.color('brightGreen'), M.color('darkGreen'), new THREE.Color(0x5f7658));
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.y = PLATE_H;
  skirt.receiveShadow = true;
  skirt.castShadow = false;
  skirt.name = 'audio:skirt';
  group.add(skirt);

  // ---- occupancy: studs are skipped under bricks and puddles ------------------------------------------------------
  const blocked = []; // [x0,z0,x1,z1]
  const block = (cx, cz, w, d) => blocked.push([cx - w / 2 + 0.05, cz - d / 2 + 0.05, cx + w / 2 - 0.05, cz + d / 2 - 0.05]);
  const studsLater = []; // [x0,z0,x1,z1,y,color] brick tops studded after the plate
  const isBlocked = (x, z) => { for (const b of blocked) if (x > b[0] && x < b[2] && z > b[1] && z < b[3]) return true; return false; };

  const y0 = PLATE_H;
  // Speaker cabinets: 4 × 3 studs footprint, 6 bricks tall, front faces +Z. Centred on the stud grid (x = ±4.4).
  const cab = { w: 3.2, d: 2.4, h: BRICK_H * 6 };
  const cabGeo = M.bevelBox(cab.w, cab.h, cab.d, 0.06);
  const baffle = new THREE.BoxGeometry(cab.w - 0.5, cab.h - 0.5, 0.12);
  const woofer = coneGeo(1.05, 0.34, 0.42);
  const tweeter = coneGeo(0.46, 0.15, 0.22);
  const ring = new THREE.TorusGeometry(1.08, 0.07, 10, 40);
  const ringS = new THREE.TorusGeometry(0.49, 0.045, 8, 30);
  const cap = new THREE.SphereGeometry(0.34, 20, 12);
  const capS = new THREE.SphereGeometry(0.15, 12, 8);
  const cabX = [-4.4, 4.4];
  for (const cx of cabX) {
    add('mediumStoneGrey', cabGeo, cx, y0, 0);
    block(cx, 0, cab.w, cab.d);
    const zf = cab.d / 2;
    add('darkStoneGrey', baffle, cx, y0 + cab.h / 2, zf + 0.04);
    const zb = zf + 0.1; // baffle front
    add('black', woofer, cx, y0 + 1.75, zb + 0.42, Math.PI / 2, 0, 0, 1, 1, 1, 'gloss');
    add('lightStoneGrey', ring, cx, y0 + 1.75, zb + 0.42);
    add('black', cap, cx, y0 + 1.75, zb + 0.06, 0, 0, 0, 1, 1, 0.6, 'gloss');
    add('black', tweeter, cx, y0 + 4.35, zb + 0.22, Math.PI / 2, 0, 0, 1, 1, 1, 'gloss');
    add('lightStoneGrey', ringS, cx, y0 + 4.35, zb + 0.22);
    add('black', capS, cx, y0 + 4.35, zb + 0.05, 0, 0, 0, 1, 1, 0.6, 'gloss');
  }

  // Amp between the cabinets: 5 × 4 studs, 1 brick + plate tall. Dark grey body, black tile bezel + display.
  const amp = { w: 4.8, d: 3.2, h: BRICK_H * 2 };
  add('darkStoneGrey', M.bevelBox(amp.w, amp.h, amp.d, 0.06), 0, y0, 0);
  block(0, 0, amp.w, amp.d);
  const zA = amp.d / 2;
  const yA = y0 + amp.h / 2;
  // face plate (lightStoneGrey 1-plate-thick tile)
  add('lightStoneGrey', new THREE.BoxGeometry(amp.w - 0.3, amp.h - 0.24, 0.08), 0, yA, zA + 0.03);
  // knobs: 2×2 round tiles (r 0.78, 0.32 thick) with a centre stud, standing proud of the face
  const knobTile = new THREE.CylinderGeometry(0.74, 0.78, 0.32, 28);
  const knobStud = new THREE.CylinderGeometry(0.24, 0.24, 0.17, 14);
  for (const kx of [-1.5, 0.1]) {
    add('black', knobTile, kx, yA, zA + 0.07 + 0.16, Math.PI / 2, 0, 0, 1, 1, 1, 'gloss');
    add('black', knobStud, kx, yA, zA + 0.07 + 0.32 + 0.085, Math.PI / 2, 0, 0, 1, 1, 1, 'gloss');
  }
  // display: black 1×4 tile bezel with an emissive inset (separate mesh below)
  const dispX = 1.55, dispY = yA + 0.42;
  add('black', M.bevelBox(1.5, 0.5, 0.1, 0.03), dispX, dispY - 0.25, zA + 0.07, 0, 0, 0, 1, 1, 1, 'gloss');

  // ---- props ---------------------------------------------------------------------------------------------------------
  const r = rng || ctx.rng.fork('audio-scene');
  // pine tree: 1×1 round trunk + three stacked stepped layers (classic Blox tree element), sizes in stud units
  const trunk = new THREE.CylinderGeometry(0.36, 0.4, BRICK_H * 2, 12);
  const tier = [M.bevelBox(4.8, 1.2, 4.8, 0.12), M.bevelBox(3.6, 1.1, 3.6, 0.12), M.bevelBox(2.4, 1.0, 2.4, 0.1), M.bevelBox(1.2, 1.0, 1.2, 0.1)];
  const tree = (x, z, s = 1, colors = ['darkGreen', 'brightGreen'], gy = y0) => {
    add('reddishBrown', trunk, x, gy + BRICK_H * s, z, 0, 0, 0, s, s, s);
    let y = gy + BRICK_H * 1.6 * s;
    tier.forEach((g, i) => { add(colors[i & 1], g, x, y, z, 0, 0, 0, s, s, s); y += (i === 0 ? 1.0 : i === 1 ? 0.9 : 0.8) * s; });
    if (s < 3 && gy === y0) block(x, z, 1.6 * s, 1.6 * s);
  };
  // round bush/tree: reddishBrown trunk + two stacked "leaf" domes
  const dome = new THREE.SphereGeometry(1.0, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const bush = (x, z, s = 1, gy = y0) => {
    add('reddishBrown', trunk, x, gy, z, 0, 0, 0, s * 0.9, s * 0.6, s * 0.9);
    add('brightGreen', dome, x, gy + BRICK_H * 0.9 * s, z, 0, 0, 0, 1.9 * s, 1.5 * s, 1.9 * s);
    add('darkGreen', dome, x, gy + BRICK_H * 1.9 * s, z, 0, 0, 0, 1.3 * s, 1.1 * s, 1.3 * s);
    if (gy === y0) block(x, z, 1.6 * s, 1.6 * s);
  };
  // near props (inside the real-stud plate, on the stud grid)
  tree(-14.0, -6.0, 1.1); tree(15.2, -8.4, 1.0); bush(18.4, 3.2, 0.8); tree(-18.8, 9.2, 0.9);
  tree(24.0, 14.0, 1.2); bush(-24.4, -14.0, 1.1); tree(-6.8, -22.0, 1.3); tree(9.2, -26.8, 1.2); bush(-14.4, 16.0, 0.9);
  // far ring of trees inside the plate (bigger scale so they still read at 100–260 m) for a wooded horizon; distance
  // is biased toward 55–160 m (not uniform to 250 m) so the aerial preset — which resolves that band, not the far
  // edge — reads as dense forest rather than a sparse scatter of individual trees.
  for (let i = 0; i < 210; i++) {
    const a = (i / 210) * Math.PI * 2 + r.range(-0.02, 0.02);
    const d = 55 + 195 * Math.pow(r.float(), 1.5);
    const x = Math.round(Math.cos(a) * d / PITCH) * PITCH, z = Math.round(Math.sin(a) * d / PITCH) * PITCH;
    if (Math.abs(x) > GROUND / 2 - 10 || Math.abs(z) > GROUND / 2 - 10) continue;
    if (r.float() < 0.7) tree(x, z, r.range(1.0, 1.8)); else bush(x, z, r.range(0.9, 1.6));
  }
  // skirt tree line: bigger, sparser trees on the rolling terrain beyond the plate, following the skirt's own
  // height field, so the horizon reads as a real tree line receding into haze/fog instead of stopping dead at the
  // plate edge. Scale grows with distance so they stay legible from the aerial preset and the 300 m+ far shot.
  for (let i = 0; i < 90; i++) {
    const a = r.range(0, Math.PI * 2);
    const dOut = 15 + 400 * Math.pow(r.float(), 1.3);
    const rIn = skirtInnerAt(a);
    const rr = rIn + dOut;
    const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
    const gy = PLATE_H + skirtHeight(x, z, dOut);
    const s = r.range(2.2, 4.2) * (0.7 + 0.5 * Math.min(1, dOut / 300));
    if (r.float() < 0.75) tree(x, z, s, undefined, gy); else bush(x, z, s, gy);
  }

  // lamp post: stacked black 1×1 round bricks, an arm toward the hi-fi, and a transYellow lantern (emissive mesh below)
  const lampX = 13.6, lampZ = -4.0;
  const post = new THREE.CylinderGeometry(0.3, 0.34, BRICK_H * 7, 12);
  add('black', post, lampX, y0 + BRICK_H * 3.5, lampZ, 0, 0, 0, 1, 1, 1, 'gloss');
  add('black', M.bevelBox(1.6, 0.32, 1.6, 0.05), lampX, y0, lampZ, 0, 0, 0, 1, 1, 1, 'gloss'); // 2×2 round-ish foot
  add('black', new THREE.CylinderGeometry(0.16, 0.16, 1.6, 8), lampX - 0.7, y0 + BRICK_H * 7 + 0.1, lampZ, 0, 0, Math.PI / 2, 1, 1, 1, 'gloss');
  add('black', M.bevelBox(0.8, 0.32, 0.8, 0.04), lampX - 1.4, y0 + BRICK_H * 7 + 0.3, lampZ, 0, 0, 0, 1, 1, 1, 'gloss'); // lantern cap
  add('black', new THREE.CylinderGeometry(0.42, 0.42, 0.32, 16), lampX, y0 + 0.32 + 0.16, lampZ, 0, 0, 0, 1, 1, 1, 'gloss'); // 2×2 round base
  block(lampX, lampZ, 1.6, 1.6);
  const lampPos = new THREE.Vector3(lampX - 1.4, y0 + BRICK_H * 7 - 0.05, lampZ);

  // park bench: two black 1×1 bricks, a 1×4 tan plate seat and a 1×4 tan plate back on two 1×1 plates
  const benchX = 12.8, benchZ = 2.4;
  add('black', M.bevelBox(0.8, BRICK_H, 0.8, 0.05), benchX - 1.2, y0, benchZ);
  add('black', M.bevelBox(0.8, BRICK_H, 0.8, 0.05), benchX + 1.2, y0, benchZ);
  add('tan', M.bevelBox(3.2, PLATE_H, 0.8, 0.04), benchX, y0 + BRICK_H, benchZ);
  add('tan', M.bevelBox(3.2, PLATE_H, 0.8, 0.04), benchX, y0 + BRICK_H + PLATE_H, benchZ - 0.8);
  add('tan', M.bevelBox(3.2, BRICK_H * 0.7, 0.3, 0.04), benchX, y0 + BRICK_H + PLATE_H * 2, benchZ - 1.05);
  block(benchX, benchZ - 0.4, 3.2, 1.6);

  // accent bricks on the stud grid (kept clear of the panel's bottom-left corner in the street/closeup views)
  const b24 = M.bevelBox(1.6, BRICK_H, 3.2, 0.06), b22 = M.bevelBox(1.6, BRICK_H, 1.6, 0.06), p14 = M.bevelBox(0.8, PLATE_H, 3.2, 0.04);
  const accents = [['brightRed', b24, -9.6, -3.2, 0, 1.6, 3.2], ['brightBlue', b22, 9.6, 3.2, 0, 1.6, 1.6], ['brightYellow', p14, 3.2, 5.6, 0, 0.8, 3.2],
    ['brightBlue', b22, 9.6, 3.2, BRICK_H, 1.6, 1.6], ['brightOrange', b24, -3.2, -6.4, 0, 1.6, 3.2]];
  for (const [c, geo, ax, az, ay, w, d] of accents) {
    add(c, geo, ax, y0 + ay, az);
    block(ax, az, w, d);
    studsLater.push([ax - w / 2, az - d / 2, ax + w / 2, az + d / 2, y0 + ay + (geo === p14 ? PLATE_H : BRICK_H), c]);
  }

  // puddles (rain only): transClear 2×2 tiles lying on the plate between the studs
  const puddles = [];
  if (wet) {
    const spots = [[-12.8, 3.2, 2], [6.4, -9.6, 3], [16.0, 4.8, 2], [-4.8, 12.8, 3], [3.2, 16.0, 2], [-20.0, -3.2, 3], [12.8, -16.0, 2], [-9.6, -12.8, 2]];
    for (const [px, pz, n] of spots) {
      const w = 1.6 * n;
      block(px, pz, w, w);
      puddles.push([px, pz, w]);
    }
  }

  // ---- studs on the central plate (skipping occupied cells) + brick tops --------------------------------------------
  const studs = M.studs({ maxCount: 17000 });
  for (let x = -PLATE / 2 + PITCH / 2; x < PLATE / 2; x += PITCH) {
    for (let z = -PLATE / 2 + PITCH / 2; z < PLATE / 2; z += PITCH) {
      if (!isBlocked(x, z)) studs.add(x, PLATE_H, z, 'brightGreen');
    }
  }
  for (const cx of cabX) studs.addRect(cx - cab.w / 2, -cab.d / 2, cx + cab.w / 2, cab.d / 2, y0 + cab.h, 'mediumStoneGrey', 0.3);
  studs.addRect(-amp.w / 2, -amp.d / 2, amp.w / 2, amp.d / 2, y0 + amp.h, 'darkStoneGrey', 0.3);
  for (const [x0, z0, x1, z1, y, c] of studsLater) studs.addRect(x0, z0, x1, z1, y, c, 0.3);
  studs.addRect(benchX - 1.6, benchZ - 0.4, benchX + 1.6, benchZ + 0.4, y0 + BRICK_H + PLATE_H, 'tan', 0.3);
  studs.addRect(lampX - 1.8, lampZ - 0.4, lampX - 1.0, lampZ + 0.4, y0 + BRICK_H * 7 + 0.62, 'black', 0.3);

  // ---- merge per material ----------------------------------------------------------------------------------------------
  const meshes = [];
  for (const [key, { mat, geos }] of parts) {
    const merged = mergeGeometries(geos.map(stripToPNU), false);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = `audio:${key}`;
    group.add(mesh);
    meshes.push(mesh);
  }
  const studMesh = studs.commit(group);
  // private copy of the shared stud material so the distance fade only affects this showcase
  const studMat = studMesh.material.clone();
  studMat.name = 'audio:studs';
  if (wet) { studMat.roughness = wetOpts.roughness; studMat.clearcoat = 1; studMat.clearcoatRoughness = wetOpts.clearcoatRoughness; }
  patchStuds(studMat, { uStudFade: { value: studFade } });
  studMesh.material = studMat;

  // puddle tiles: a blue-tinted glass tile plus a fixed-intensity fresnel rim (see patchPuddle) so they read as
  // glossy reflective water even from the steep aerial preset, where physical dielectric reflectance at normal
  // incidence is naturally low and a plain clearcoat tile just looks like a flat pale rectangle.
  const puddleMeshes = [];
  let puddleMat = null;
  if (puddles.length) {
    const pm = M.glass('transBlue', { roughness: 0.015, opacity: 0.5, emissive: 'mediumAzur', emissiveIntensity: 0.3 }).clone();
    pm.name = 'audio:puddle';
    patchPuddle(pm, { uRimColor: { value: new THREE.Vector3(0.10, 0.30, 0.42) } });
    puddleMat = pm;
    for (const [px, pz, w] of puddles) {
      const t = new THREE.Mesh(M.bevelBox(w - 0.06, 0.06, w - 0.06, 0.02), pm);
      t.position.set(px, y0, pz);
      t.receiveShadow = true;
      t.name = 'audio:puddle';
      group.add(t);
      puddleMeshes.push(t);
    }
  }

  // ---- emissive parts ----------------------------------------------------------------------------------------------------
  const emis = {
    display: M.emissive('mediumAzur', 4),
    ledOff: M.emissive('brightRed', 4), ledOn: M.emissive('brightGreen', 3.5),
    lampOn: M.glass('transYellow', { emissive: 'brightYellow', emissiveIntensity: 3.5, opacity: 0.85 }),
    lampOff: M.glass('transYellow', { opacity: 0.7 }),
    powerOn: M.glass('transRed', { emissive: 'brightRed', emissiveIntensity: 4, opacity: 0.85 }),
    powerOff: M.glass('transRed', { opacity: 0.8 }),
  };
  const disp = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.26, 0.05), emis.display);
  disp.position.set(dispX, dispY, zA + 0.13);
  disp.name = 'audio:display';
  group.add(disp);

  const led = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 12).rotateX(Math.PI / 2), emis.ledOff);
  led.position.set(dispX - 0.5, yA - 0.35, zA + 0.11);
  led.name = 'audio:led';
  group.add(led);

  // power button: transRed 1×1 round tile
  const power = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.36, 0.2, 20).rotateX(Math.PI / 2), emis.powerOff);
  power.position.set(dispX + 0.25, yA - 0.35, zA + 0.16);
  power.name = 'audio:power';
  group.add(power);

  // lantern: transYellow 1×1 round brick under the cap
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.7, 16), emis.lampOff);
  lantern.position.copy(lampPos);
  lantern.name = 'audio:lantern';
  group.add(lantern);

  // VU row: five 1×1 bricks on the amp's back stud row (3 green, 1 yellow, 1 red); lit = emissive material.
  const vuColors = ['brightGreen', 'brightGreen', 'brightGreen', 'brightYellow', 'brightRed'];
  const vuGeo = M.bevelBox(0.74, 0.6, 0.74, 0.04);
  const vu = vuColors.map((c, i) => {
    const m = new THREE.Mesh(vuGeo, matFor(c));
    m.position.set(-1.6 + i * 0.8, y0 + amp.h, -0.8);
    m.castShadow = true; m.receiveShadow = true;
    m.name = `audio:vu${i}`;
    m.userData.color = c;
    m.userData.lit = M.emissive(c, c === 'brightRed' ? 4.5 : 3.2);
    m.userData.off = matFor(c);
    group.add(m);
    return m;
  });

  // ---- pooled night lights: one warm pool at the amp, one at the lantern ------------------------------------------------
  const ampLight = new THREE.PointLight(0xffb070, 0, 16, 2);
  ampLight.position.set(0.9, y0 + 3.0, zA + 1.4); // above the amp face: a soft warm wash, not a hot spot on the knobs
  ampLight.name = 'audio:ampLight';
  group.add(ampLight);
  const lampLight = new THREE.PointLight(0xffd28a, 0, 30, 1.6);
  lampLight.position.copy(lampPos).y -= 0.2;
  lampLight.name = 'audio:lampLight';
  group.add(lampLight);

  ctx.scene.add(group);

  let litCount = -1, ledOn = null, nightOn = null;
  return {
    group,
    /** level 0..1 (output RMS or the idle target mix), running: whether the AudioContext is live */
    setLevel(level, running) {
      const n = Math.round(Math.min(1, level * 1.15) * vu.length);
      if (n !== litCount) {
        litCount = n;
        vu.forEach((m, i) => { m.material = i < n ? m.userData.lit : m.userData.off; });
      }
      if (ledOn !== running) { ledOn = running; led.material = running ? emis.ledOn : emis.ledOff; }
    },
    /** night 0..1: pooled point lights + lantern/power emissives */
    setNight(night) {
      const on = night > 0.05;
      ampLight.intensity = 9 * night;
      lampLight.intensity = 34 * night;
      if (nightOn !== on) {
        nightOn = on;
        lantern.material = on ? emis.lampOn : emis.lampOff;
        power.material = on ? emis.powerOn : emis.powerOff;
      }
    },
    dispose() {
      ctx.scene.remove(group);
      for (const m of meshes) m.geometry.dispose();
      studs.clear();
      studMat.dispose(); groundMat.dispose();
      ground.geometry.dispose();
      skirt.geometry.dispose(); skirtMat.dispose();
      if (puddleMat) puddleMat.dispose();
      led.geometry.dispose(); disp.geometry.dispose(); power.geometry.dispose(); lantern.geometry.dispose();
    },
  };
}

// ---- shader patches --------------------------------------------------------------------------------------------------------
function replaceAll(src, pairs) {
  for (const [a, b] of pairs) {
    if (!src.includes(a)) throw new Error(`[audio] shader chunk not found: ${a}`);
    src = src.replace(a, b);
  }
  return src;
}

/** Ground: baseplate seams every 32 studs + procedural stud relief that fades in as the real studs shrink out. */
function patchGround(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = replaceAll(shader.vertexShader, [
      ['#include <common>', '#include <common>\nvarying vec3 vAudioWP;'],
      ['#include <worldpos_vertex>', '#include <worldpos_vertex>\nvAudioWP = (modelMatrix * vec4(transformed, 1.0)).xyz;'],
    ]);
    shader.fragmentShader = replaceAll(shader.fragmentShader, [
      ['#include <common>', `#include <common>
varying vec3 vAudioWP;
uniform vec2 uStudFade;
uniform float uStudPitch;
uniform float uSeam;
uniform float uRelief;
uniform float uPlateHalf;
float aHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }`],
      ['#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 nW = transformDirectionByInverseViewMatrix(nonPerturbedNormal, viewMatrix);
  float flatW = step(0.999, nW.y);
  vec2 p = vAudioWP.xz / uStudPitch;
  vec2 c = floor(p + 0.5);
  vec2 d = p - c;
  float r = length(d);
  float fw = fwidth(p.x) + fwidth(p.y);
  float dist = distance(vAudioWP, cameraPosition);
  float lod = smoothstep(uStudFade.x, uStudFade.y, dist);
  // outside the real-stud plate the relief is always on (there are no instanced studs to cross-fade with)
  float inPlate = step(abs(vAudioWP.x), uPlateHalf) * step(abs(vAudioWP.z), uPlateHalf);
  lod = max(lod, 1.0 - inPlate);
  float fade = 1.0 - smoothstep(0.3, 0.9, fw);
  float k = flatW * lod * fade;
  if (k > 0.001) {
    float aa = max(0.03, fw * 0.75);
    float R = 0.3;
    float top = 1.0 - smoothstep(R - aa, R + aa, r);
    float rim = smoothstep(R - 0.14 - aa, R - 0.02, r) * top;
    float ao = (1.0 - smoothstep(R + aa, R + 0.13 + aa, r)) * (1.0 - top);
    vec3 tilt = vec3(d.x, 0.0, d.y) / max(r, 1e-4);
    nW = normalize(nW + tilt * rim * uRelief * k);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
    diffuseColor.rgb *= 1.0 - 0.26 * ao * k;
  }
  // baseplate seams (thin dark gap) + a subtle per-plate tint so the sea of plates reads as separate pieces
  vec2 sp = vAudioWP.xz / uSeam + 0.5;
  vec2 sf = abs(fract(sp) - 0.5) * uSeam;
  float sw = 0.05 + (fwidth(vAudioWP.x) + fwidth(vAudioWP.z)) * 0.6;
  float seam = 1.0 - smoothstep(sw, sw * 2.0, min(sf.x, sf.y));
  float plateFade = 1.0 - smoothstep(350.0, 520.0, dist);
  diffuseColor.rgb *= 1.0 - 0.32 * seam * flatW * plateFade;
  diffuseColor.rgb *= 0.96 + 0.08 * aHash(floor(sp)) * flatW;
}`],
      ['#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
#ifdef USE_CLEARCOAT
  clearcoatNormal = normal;
#endif`],
    ]);
  };
  mat.customProgramCacheKey = () => 'audio-ground-v1';
  return mat;
}

/** Real studs: each instance shrinks to nothing over the fade band. */
function patchStuds(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = replaceAll(shader.vertexShader, [
      ['#include <common>', '#include <common>\nuniform vec2 uStudFade;'],
      ['#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = 1.0 - smoothstep(uStudFade.x, uStudFade.y, distance(origin, cameraPosition));
  transformed *= s;
}
#endif`],
    ]);
  };
  mat.customProgramCacheKey = () => 'audio-studs-v1';
  return mat;
}

/** Puddles: adds a fixed-intensity fresnel rim on top of the physical clearcoat so wet tiles read as reflective
 * water from any viewing angle, including the steep aerial preset where a dielectric's physical reflectance at
 * normal incidence is naturally low (~4%) and a plain clearcoat tile just looks like a flat pale rectangle. */
function patchPuddle(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = replaceAll(shader.fragmentShader, [
      ['#include <common>', '#include <common>\nuniform vec3 uRimColor;'],
      ['#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 vN = normalize(vViewPosition);
  float rim = pow(1.0 - clamp(abs(dot(vN, normal)), 0.0, 1.0), 2.2);
  totalEmissiveRadiance += uRimColor * (0.25 + 0.9 * rim);
}`],
    ]);
  };
  mat.customProgramCacheKey = () => 'audio-puddle-v1';
  return mat;
}

/**
 * A speaker cone seen from the front: wide rim (r1) at local y=0 narrowing to the dust-cap radius (r2) at y=-depth.
 * Faces are flipped so the *inside* of the cone renders with front-face culling. Caller rotates +Y → +Z.
 */
function coneGeo(r1, r2, depth) {
  const g = new THREE.CylinderGeometry(r1, r2, depth, 36, 1, false);
  g.translate(0, -depth / 2, 0);
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  const n = g.attributes.normal.array;
  for (let i = 0; i < n.length; i++) n[i] = -n[i];
  return g;
}

/** Keep only position/normal/uv and drop the index so geometries from different generators merge cleanly. */
function stripToPNU(g) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}
