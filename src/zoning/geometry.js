// Shared geometry/constants for the zoning overlay plates.
// One low box per zoned cell, instanced (one InstancedMesh per zone colour = 3 draw calls total for the whole
// city). Density is conveyed two ways without adding geometry variants or draw calls:
//   - per-instance non-uniform Y scale (taller box => taller, more visible bright rim) via the instance matrix
//   - per-instance brightness (via InstancedMesh.instanceColor, a plain scalar multiplier)
// The "brighter edge" look itself is baked once into the shared box geometry as per-face vertex colours: the four
// side faces (the plate's rim, as seen from above/an angle) get a bright shade, the top/bottom faces a dim shade.
// Because BoxGeometry does not share vertices across faces (each face has its own 4, for correct normals), this
// needs no extra geometry or draw calls - it is one `color` vertex attribute on the one shared box.
import * as THREE from 'three';

export const MARGIN = 0.7;      // gap from the cell edge, so plates read as lots, not a solid carpet
export const PLATE_H = 0.42;    // base plate thickness (m) at density 1
export const PLATE_Y0 = 0.09;   // sits just above the ground/terrain surface (avoids z-fighting)
export const INTERIOR_SHADE = 0.8;
// r1 review (minor): at long, low-grazing distances the bright rim faded into aerial-perspective fog more
// slowly than the dimmer top face, so far-off patches briefly showed as a hazy "outline only" checkerboard
// (rim visible, fill already fogged out) before fully disappearing. Trimmed from 1.6 - still a clearly visible
// bright rim up close (where it matters for the density cue), just less of an overshoot for fog to chew through.
export const EDGE_BRIGHT = 1.45;

export const ZONE_COLOR = { r: 'brightGreen', c: 'brightBlue', i: 'brightOrange' };
export const ZONE_EDGE_GLOW = { r: 'lime', c: 'mediumAzur', i: 'brightYellow' };

// density (1..3) -> instance Y-scale (taller box = taller + more prominent bright rim) and brightness multiplier
export const DENSITY_SCALE = { 1: 1.0, 2: 1.24, 3: 1.5 };
export const DENSITY_BRIGHT = { 1: 0.82, 2: 1.02, 3: 1.26 };

export function clampDensity(d) {
  const n = Math.round(Number(d) || 1);
  return n < 1 ? 1 : n > 3 ? 3 : n;
}

/** One shared box: side faces (the rim, as seen from above) bright, top/bottom dim. Bottom sits at local y=0. */
export function buildPlateGeometry(cellSize) {
  const size = Math.max(0.5, cellSize - MARGIN * 2);
  const geo = new THREE.BoxGeometry(size, PLATE_H, size);
  geo.translate(0, PLATE_H / 2, 0); // local origin at the bottom face, so instance Y-scale grows the plate upward
  const posAttr = geo.attributes.position;
  const faceVerts = 4; // BoxGeometry: 6 faces x 4 verts, in order +x,-x,+y,-y,+z,-z
  const n = posAttr.count;
  const col = new Float32Array(n * 3);
  for (let f = 0; f < n / faceVerts; f++) {
    const isTopBottom = f === 2 || f === 3;
    const shade = isTopBottom ? INTERIOR_SHADE : EDGE_BRIGHT;
    for (let v = 0; v < faceVerts; v++) {
      const idx = f * faceVerts + v;
      col[idx * 3] = shade; col[idx * 3 + 1] = shade; col[idx * 3 + 2] = shade;
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
