// Blox-style car "models": a handful of shared geometries/materials, instanced per model.
// Local car space: +X forward (travel direction), +Z to the car's left... actually +Z is lateral (right-handed:
// forward=+X, up=+Y, so +Z = to the car's left when facing +X). Origin sits on the ground under the car centre.
//
// Every car is a *stack of Blox elements*, not one rounded shell: a lower body brick, a proud hood/trunk plate,
// a glass band (windscreen/side/rear windows) with dark pillars, and a body-coloured roof plate carrying real
// studs on the 0.8 m Blox pitch. Bumpers and running boards are dark trim, wheels are real tire cylinders.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Real-world car scale (metres) so cars fit their lanes (street lane ~4 m wide, avenue lane ~3.5 m).
export const CAR_SPECS = [
  {
    id: 'sedan', weight: 62, speedMul: 1.0,
    length: 4.3, width: 1.85, height: 1.15, bevel: 0.16,
    cabin: { l: 2.0, w: 1.5, h: 0.6, x: -0.15 },
    lightY: 0.5, lightZ: 0.6, lightR: 0.13, lightH: 0.12,
  },
  {
    id: 'van', weight: 26, speedMul: 0.92,
    length: 5.3, width: 2.0, height: 2.0, bevel: 0.14,
    cabin: { l: 1.5, w: 1.7, h: 0.5, x: 1.6 },
    lightY: 0.55, lightZ: 0.72, lightR: 0.15, lightH: 0.13,
  },
  {
    id: 'bus', weight: 12, speedMul: 0.8,
    length: 9.4, width: 2.3, height: 2.5, bevel: 0.12,
    cabin: { l: 7.4, w: 2.0, h: 1.3, x: -0.5 },
    lightY: 0.6, lightZ: 0.85, lightR: 0.16, lightH: 0.14,
  },
];

export const BODY_COLORS = [
  'brightRed', 'brightBlue', 'brightYellow', 'white', 'brightOrange', 'lime',
  'mediumAzur', 'darkGreen', 'tan', 'brightPink', 'black', 'darkStoneGrey', 'brightPurple',
];

/** Normalise every input to non-indexed so RoundedBoxGeometry and plain boxes can merge in one call. */
function mergeAll(geos) {
  const norm = geos.map((g) => (g.index !== null ? g.toNonIndexed() : g));
  const out = mergeGeometries(norm, false);
  for (let i = 0; i < geos.length; i++) {
    if (norm[i] !== geos[i]) norm[i].dispose();
    geos[i].dispose();
  }
  return out;
}

/** One open prism stud (8 sides + fan-free cap, 22 tris) sitting on y = 0. Carries a (zeroed) uv attribute so it
 * can merge with RoundedBoxGeometry/BoxGeometry pieces, which all have position/normal/uv. */
function studGeometry(radius = 0.24, height = 0.17, sides = 8) {
  const pos = [], nor = [], idx = [];
  const rot = Math.PI / sides;
  for (let s = 0; s < sides; s++) {
    const a = rot + (s / sides) * Math.PI * 2, nx = Math.cos(a), nz = Math.sin(a);
    const a0 = a - Math.PI / sides, a1 = a + Math.PI / sides;
    const x0 = Math.cos(a0) * radius, z0 = Math.sin(a0) * radius;
    const x1 = Math.cos(a1) * radius, z1 = Math.sin(a1) * radius;
    const b = pos.length / 3;
    pos.push(x0, 0, z0, x1, 0, z1, x1, height, z1, x0, height, z0);
    for (let k = 0; k < 4; k++) nor.push(nx, 0, nz);
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  }
  const cb = pos.length / 3;
  for (let s = 0; s < sides; s++) {
    const a = rot + (s / sides) * Math.PI * 2 - Math.PI / sides;
    pos.push(Math.cos(a) * radius, height, Math.sin(a) * radius);
    nor.push(0, 1, 0);
  }
  for (let s = 1; s < sides - 1; s++) idx.push(cb, cb + s + 1, cb + s);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** Stud offsets across a span on the Blox pitch (0.8 m, inset 0.4 from each edge), centred on 0. */
function studOffsets(span) {
  const usable = span - 0.8;
  const n = Math.max(1, Math.floor(usable / 0.8 + 1e-6) + 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push((i - (n - 1) / 2) * 0.8);
  return out;
}

/** Roof-plate studs for a car, merged straight into the body geometry (so they share its instance colour). */
function roofStudGeometry(spec, roofTopY) {
  const c = spec.cabin;
  const xs = studOffsets(c.l), zs = studOffsets(c.w);
  const geos = [];
  for (const x of xs) for (const z of zs) {
    const g = studGeometry();
    g.translate(c.x + x, roofTopY, z);
    geos.push(g);
  }
  return mergeAll(geos);
}

/** Body brick + proud hood/trunk plate + roof plate with studs. All one instance-coloured geometry. */
function bodyGeometry(spec) {
  const c = spec.cabin;
  const glassH = c.h * 0.55;
  const roofH = c.h - glassH;
  const roofY = spec.height + glassH; // underside of the roof plate
  const geos = [];

  const body = new RoundedBoxGeometry(spec.length, spec.height, spec.width, 2, Math.min(spec.bevel, spec.height * 0.4));
  body.translate(0, spec.height / 2, 0); // sits on y = 0
  geos.push(body);

  // Hood and trunk: a proud plate on the body top at each end of the cabin (a stacked Blox plate).
  const frontLen = spec.length / 2 - (c.x + c.l / 2);
  const rearLen = (c.x - c.l / 2) + spec.length / 2;
  for (const [len, x] of [[frontLen, (c.x + c.l / 2 + spec.length / 2) / 2], [rearLen, (c.x - c.l / 2 - spec.length / 2) / 2]]) {
    if (len < 0.5) continue;
    const g = new THREE.BoxGeometry(len, 0.1, spec.width + 0.04);
    g.translate(x, spec.height + 0.05, 0);
    geos.push(g);
  }

  // Roof plate.
  const roof = new THREE.BoxGeometry(c.l, roofH, c.w);
  roof.translate(c.x, roofY + roofH / 2, 0);
  geos.push(roof);

  // Studs on the roof.
  geos.push(roofStudGeometry(spec, roofY + roofH));
  return mergeAll(geos);
}

/** Glass band under the roof plate: windscreen/side/rear windows, inset from the roof so the plate overhangs. */
function cabinGeometry(spec) {
  const c = spec.cabin;
  const glassH = c.h * 0.55;
  const g = new RoundedBoxGeometry(c.l - 0.08, glassH, c.w - 0.08, 1, 0.05);
  g.translate(c.x, spec.height + glassH / 2 - 0.02, 0); // slight overlap into the body
  return g;
}

/** Two round elements (headlights or taillights) merged into one geometry; front=true -> nose, else tail. */
function lightPairGeometry(spec, front) {
  const x = front ? spec.length / 2 - spec.lightH * 0.5 : -spec.length / 2 + spec.lightH * 0.5;
  const y = spec.lightY, zo = spec.lightZ;
  const a = new THREE.CylinderGeometry(spec.lightR, spec.lightR, spec.lightH, 12);
  a.rotateZ(Math.PI / 2); a.translate(x, y, zo);
  const b = new THREE.CylinderGeometry(spec.lightR, spec.lightR, spec.lightH, 12);
  b.rotateZ(Math.PI / 2); b.translate(x, y, -zo);
  const g = mergeGeometries([a, b], false);
  a.dispose(); b.dispose();
  return g;
}

/** Dark side skirts near the bottom (reads as the fender/wheel-arch trim around the wheel cut-outs). */
function wheelArchGeometry(spec) {
  const h = Math.min(0.46, spec.height * 0.3), w = 0.16;
  const l = spec.length * 0.74;
  const a = new THREE.BoxGeometry(l, h, w);
  a.translate(0, h / 2, spec.width / 2 - w / 2 + 0.02);
  const b = new THREE.BoxGeometry(l, h, w);
  b.translate(0, h / 2, -(spec.width / 2 - w / 2 + 0.02));
  return mergeGeometries([a, b], false);
}

/** Front and rear bumpers: a dark brick across each end, proud of the body (a real Blox bumper element). */
function bumperGeometry(spec) {
  const h = Math.min(0.34, spec.height * 0.26), w = spec.width + 0.06, d = 0.24;
  const y = Math.min(0.34, spec.height * 0.24);
  const a = new THREE.BoxGeometry(d, h, w);
  a.translate(spec.length / 2 - d / 2 + 0.04, y + h / 2, 0);
  const b = new THREE.BoxGeometry(d, h, w);
  b.translate(-spec.length / 2 + d / 2 - 0.04, y + h / 2, 0);
  return mergeGeometries([a, b], false);
}

/** Four actual tire cylinders at the corners, sized/spaced from the body's own dimensions so they sit just
 * beneath the wheelArchGeometry() skirt with a slight lateral poke past the body's side face (real cars' tires
 * read a hair wider than the sheet metal above them). Axis runs along local Z (the car's lateral axis) so the
 * round tread face reads correctly from a 3/4 or side view. */
function wheelCylinderGeometry(spec) {
  const R = THREE.MathUtils.clamp(spec.height * 0.27, 0.28, 0.55);
  const W = R * 0.62;
  const axleX = spec.length * 0.32;
  const outerZ = spec.width / 2 - W / 2 + 0.015;
  const parts = [];
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const g = new THREE.CylinderGeometry(R, R, W, 14);
      g.rotateX(Math.PI / 2); // default Y-axis cylinder -> axis along Z
      g.translate(sx * axleX, R, sz * outerZ);
      parts.push(g);
    }
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/** Thin dark strips that break the glass band into windscreen/side-glass/rear-glass panes: an A-pillar and
 * C-pillar pair plus a low beltline trim strip on each side. Merged with the wheel geometry below (same dark
 * plastic material) so this costs zero extra draw calls. */
function cabinPillarGeometry(spec) {
  const c = spec.cabin;
  const glassH = c.h * 0.55;
  const stripW = Math.max(0.05, c.l * 0.045);
  // Kept well inboard of the glass band's own X/Z edges and a bit shorter than the band: the band is a
  // RoundedBoxGeometry, so its surface curves at the corners - a pillar placed flush with an edge pokes out past
  // that curved corner and reads as a stray antenna spike rather than a window pillar.
  const stripH = glassH * 0.72;
  const centerY = spec.height + glassH * 0.5;
  const insetX = c.l * 0.34;
  const halfW = c.w / 2 - Math.max(0.05, c.w * 0.08);
  const parts = [];
  for (const x of [c.x + insetX, c.x - insetX]) {
    for (const sz of [1, -1]) {
      const g = new THREE.BoxGeometry(stripW, stripH, 0.05);
      g.translate(x, centerY, sz * halfW);
      parts.push(g);
    }
  }
  const beltH = 0.05;
  const beltY = spec.height + beltH / 2 + 0.01;
  for (const sz of [1, -1]) {
    const g = new THREE.BoxGeometry(c.l * 0.94, beltH, 0.045);
    g.translate(c.x, beltY, sz * halfW);
    parts.push(g);
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/** The full "dark trim" kit for one model: wheel-arch skirts + bumpers + real tire cylinders + cabin
 * pillar/beltline strips, all merged into a single geometry so it still renders through the one shared 'wheel'
 * InstancedMesh (no extra draw calls versus round 1). */
function trimKitGeometry(spec) {
  const arch = wheelArchGeometry(spec);
  const bumpers = bumperGeometry(spec);
  const wheels = wheelCylinderGeometry(spec);
  const pillars = cabinPillarGeometry(spec);
  const g = mergeGeometries([arch, bumpers, wheels, pillars], false);
  arch.dispose(); bumpers.dispose(); wheels.dispose(); pillars.dispose();
  return g;
}

/** Build the geometry kit (one set per model) + the shared materials (day/night, brake variants). */
export function buildCarKits(ctx) {
  const M = ctx.materials;
  const materials = {
    body: M.plastic('white', { instanceColor: true, roughness: 0.3, clearcoat: 0.65, clearcoatRoughness: 0.12 }),
    // Bluer tint, near-mirror clearcoat and much lower roughness than the body plastic so the cabin reads as
    // glossy glass rather than tinted plastic even at close range; pillars/beltline (merged into `wheel` below)
    // do the rest of the "real glass" work by breaking the band into actual window panes.
    cabin: M.glass('transBlue', { opacity: 0.6, roughness: 0.028 }),
    wheel: M.plastic('black', { roughness: 0.55, clearcoat: 0.2 }),
    headDay: M.plastic('white', { emissive: 'white', emissiveIntensity: 0.6, roughness: 0.25, clearcoat: 0.5 }),
    headNight: M.plastic('white', { emissive: 'white', emissiveIntensity: 3.5, roughness: 0.25, clearcoat: 0.5 }),
    tailNormalDay: M.plastic('brightRed', { emissive: 'brightRed', emissiveIntensity: 1.4, roughness: 0.3, clearcoat: 0.5 }),
    // >= ARCHITECTURE §7's red-emissive bloom threshold (4) so ordinary taillights also bloom softly at night;
    // brake/stopped stays clearly brighter (5.2) so the distinction is still obvious.
    tailNormalNight: M.plastic('brightRed', { emissive: 'brightRed', emissiveIntensity: 4.2, roughness: 0.3, clearcoat: 0.5 }),
    tailBrakeDay: M.plastic('brightRed', { emissive: 'brightRed', emissiveIntensity: 2.6, roughness: 0.3, clearcoat: 0.5 }),
    tailBrakeNight: M.plastic('brightRed', { emissive: 'brightRed', emissiveIntensity: 5.2, roughness: 0.3, clearcoat: 0.5 }),
  };
  const kits = CAR_SPECS.map((spec) => ({
    spec,
    bodyGeo: bodyGeometry(spec),
    cabinGeo: cabinGeometry(spec),
    wheelGeo: trimKitGeometry(spec),
    headGeo: lightPairGeometry(spec, true),
    tailGeo: lightPairGeometry(spec, false),
  }));
  return { kits, materials };
}
