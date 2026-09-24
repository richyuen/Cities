// Blox-style car "models": a handful of shared geometries/materials, instanced per model.
// Local car space: +X forward (travel direction), +Z to the car's left... actually +Z is lateral (right-handed:
// forward=+X, up=+Y, so +Z = to the car's left when facing +X). Origin sits on the ground under the car centre.

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

function bodyGeometry(spec) {
  const g = new RoundedBoxGeometry(spec.length, spec.height, spec.width, 2, Math.min(spec.bevel, spec.height * 0.4));
  g.translate(0, spec.height / 2, 0); // sits on y = 0
  return g;
}

function cabinGeometry(spec) {
  const c = spec.cabin;
  const g = new RoundedBoxGeometry(c.l, c.h, c.w, 2, Math.min(0.1, c.h * 0.35));
  g.translate(c.x, spec.height + c.h / 2 - Math.min(0.14, spec.height * 0.12), 0); // slight overlap into the roof
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
  const g = mergeGeometries([a, b], false);
  a.dispose(); b.dispose();
  return g;
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

/** Thin dark strips that break the cabin glass box into windshield/side-glass/rear-glass panes: an A-pillar and
 * C-pillar pair plus a low beltline trim strip on each side. Merged with the wheel geometry below (same dark
 * plastic material) so this costs zero extra draw calls. */
function cabinPillarGeometry(spec) {
  const c = spec.cabin;
  const overlap = Math.min(0.14, spec.height * 0.12);
  const baseY = spec.height + c.h / 2 - overlap;
  const stripW = Math.max(0.05, c.l * 0.045);
  // Kept well inboard of the cabin box's own X/Z edges and a bit shorter than the full cabin height: the cabin
  // glass is a RoundedBoxGeometry, so its roof surface curves down noticeably right at the corners — a pillar
  // placed flush with an edge (in X or Z) or a full-height pillar pokes up past that curved corner and reads as
  // a stray antenna spike rather than a window pillar. Sitting inboard/shorter keeps it visually inside the glass.
  const stripH = c.h * 0.5;
  const centerY = baseY - c.h * 0.2;
  const insetX = c.l * 0.34;
  const halfW = c.w / 2 - Math.max(0.05, c.w * 0.08);
  const frontX = c.x + insetX;
  const rearX = c.x - insetX;
  const parts = [];
  for (const x of [frontX, rearX]) {
    for (const sz of [1, -1]) {
      const g = new THREE.BoxGeometry(stripW, stripH, 0.05);
      g.translate(x, centerY, sz * halfW);
      parts.push(g);
    }
  }
  const beltH = 0.05;
  const beltY = baseY - c.h / 2 + beltH / 2 + 0.02;
  for (const sz of [1, -1]) {
    const g = new THREE.BoxGeometry(c.l * 0.94, beltH, 0.045);
    g.translate(c.x, beltY, sz * halfW);
    parts.push(g);
  }
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  return g;
}

/** The full "dark trim" kit for one model: wheel-arch skirts + real tire cylinders + cabin pillar/beltline
 * strips, all merged into a single geometry so it still renders through the one shared 'wheel' InstancedMesh
 * (no extra draw calls versus round 1). */
function trimKitGeometry(spec) {
  const arch = wheelArchGeometry(spec);
  const wheels = wheelCylinderGeometry(spec);
  const pillars = cabinPillarGeometry(spec);
  const g = mergeGeometries([arch, wheels, pillars], false);
  arch.dispose(); wheels.dispose(); pillars.dispose();
  return g;
}

/** Build the geometry kit (one set per model) + the shared materials (day/night, brake variants). */
export function buildCarKits(ctx) {
  const M = ctx.materials;
  const materials = {
    body: M.plastic('white', { instanceColor: true, roughness: 0.3, clearcoat: 0.65, clearcoatRoughness: 0.12 }),
    // Bluer tint, near-mirror clearcoat and much lower roughness than the body plastic so the cabin reads as
    // glossy glass rather than tinted plastic even at close range; pillars/beltline (merged into `wheel` below)
    // do the rest of the "real glass" work by breaking the box into actual window panes.
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
