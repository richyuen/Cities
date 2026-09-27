// Blox geometry for the transit module: the bus-stop marker (instanced roles) and the route ribbon that paints a
// line's colour along the road it serves. No per-stop Object3D — stops are instanced; one ribbon mesh per line.
import * as THREE from 'three';

/** Stop marker roles. Origin at ground contact; local +Z is the stop's facing (toward the road). */
export function buildStopKits(ctx) {
  // Everything is cloned: bevelBox() returns a shared cached geometry (and merge() disposes its inputs).
  const bb = (w, h, d, bevel) => ctx.materials.bevelBox(w, h, d, bevel).clone();
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 12);
  cyl.translate(0, 0.5, 0); // unit cylinder sitting on y=0

  const put = (geo, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => {
    const g = geo.clone();
    g.scale(sx, sy, sz);
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    return g;
  };
  const merge = (parts) => {
    const norm = parts.map((g) => (g.index !== null ? g.toNonIndexed() : g));
    const out = mergeGeometries(norm);
    for (const g of parts) g.dispose();
    return out;
  };

  // Pole: a footing plate (with a stud), a slim shaft and a cap stud — a stack of Blox elements, not a bare stick.
  // The cap sits ON TOP of the sign (not on the shaft) so it reads as a stud on the sign's head instead of a grey
  // brick poking through the plate (transit r2 critic: dark notch in the glowing lightbox at night).
  const foot = bb(0.46, 0.1, 0.46, 0.03);
  const footStud = put(cyl, 0, 0.1, 0, 0.24, 0.17, 0.24);
  const shaft = put(cyl, 0, 0.1, 0, 0.055, 2.5, 0.055);
  const cap = put(cyl, 0, 2.76, 0.02, 0.09, 0.12, 0.09);
  const poleGeo = merge([foot, footStud, shaft, cap]);

  // Sign: a coloured plate with a proud white face plate, mounted near the top and angled to face the road (+Z).
  // The face is centred on the plate (both y and x) — it read off-centre when pinned to the plate's lower edge.
  const signPlate = bb(0.78, 0.56, 0.07, 0.02);
  signPlate.translate(0, 2.2, 0.02);
  const signGeo = signPlate;
  const facePlate = bb(0.5, 0.28, 0.03, 0.015);
  facePlate.translate(0, 2.34, 0.075);
  const faceGeo = facePlate;

  // Ground ring: a flat annulus in the line's colour, so a stop is findable from above and glows at night. Radii
  // are kept inside a street sidewalk (~2 m wide, centred on the anchor) so the arc never hangs over the lower
  // carriageway; lifted to 0.20 m (above the 0.17 m pavement studs) so studs no longer bite notches out of it.
  const ring = new THREE.RingGeometry(0.55, 0.95, 24);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, 0.2, 0);
  const ringGeo = ring;

  // Queued riders (C5): a stacked minifig block — legs + torso + head — ~0.47 m tall, instanced per stop. Static
  // positions (no agent sim); per-instance colour is picked deterministically from the stop id, no rng.
  const legs = bb(0.16, 0.15, 0.1, 0.01);
  legs.translate(0, 0.075, 0);
  const torso = bb(0.2, 0.2, 0.12, 0.01);
  torso.translate(0, 0.25, 0);
  const head = new THREE.SphereGeometry(0.075, 8, 6);
  head.translate(0, 0.43, 0);
  const riderGeo = merge([legs, torso, head]);

  const m = ctx.materials;
  return {
    poleGeo,
    signGeo,
    faceGeo,
    ringGeo,
    riderGeo,
    poleMat: m.plastic('darkStoneGrey', { roughness: 0.42, clearcoat: 0.4 }),
    signMat: tintEmissiveByInstanceColor(m.plastic('white', { instanceColor: true, roughness: 0.38, clearcoat: 0.55, emissive: 'white', emissiveIntensity: 0 })),
    // The white face is the lit element at night (the coloured sign plate glows in its own line colour instead —
    // see tintEmissiveByInstanceColor); emissiveIntensity is driven from updateNightLook(). C5: the face also
    // carries the route-letter atlas (tile per line, see makeLetterAtlas + tileFaceMaterial).
    faceMat: tileFaceMaterial(m.plastic('white', { roughness: 0.32, clearcoat: 0.6, emissive: 'white', emissiveIntensity: 0, map: makeLetterAtlas(ctx) })),
    riderMat: m.plastic('white', { instanceColor: true, roughness: 0.5, clearcoat: 0.25 }),
    ringMat: tintEmissiveByInstanceColor(m.plastic('white', { instanceColor: true, roughness: 0.45, clearcoat: 0.3, emissive: 'white', emissiveIntensity: 0, side: THREE.DoubleSide })),
  };
}

/** Route-letter atlas (C5): 9 horizontal tiles, 32 px — A–H in the module's line colours on white, plus a grey
 *  dash for an unassigned stop. 288×32, built once; `refreshStops()` writes each stop's tile index into the
 *  `aUvOffset` instance attribute and `tileFaceMaterial` shifts `vMapUv.x` by it, so all stops still share one
 *  material and one draw call. Returns null when a canvas is unavailable (the white plate is the fallback). */
const LETTERS = 'ABCDEFGH';
export const LETTER_TILE_COUNT = 9;
export function makeLetterAtlas(ctx) {
  const colors = ['brightRed', 'brightBlue', 'brightYellow', 'brightGreen', 'brightOrange', 'brightPurple', 'mediumAzur', 'lime'];
  try {
    const tile = 32, n = LETTER_TILE_COUNT;
    const canvas = document.createElement('canvas');
    canvas.width = tile * n; canvas.height = tile;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '900 21px "Arial Rounded MT Bold","Segoe UI Black","Arial Black",sans-serif';
    for (let i = 0; i < LETTERS.length; i++) {
      g.fillStyle = ctx.materials.palette[colors[i % colors.length]] || '#2b3036';
      g.fillText(LETTERS[i], i * tile + tile / 2, tile / 2 + 1);
    }
    g.fillStyle = '#9aa3ad'; g.fillRect((n - 1) * tile + 9, tile / 2 - 1.5, 14, 3); // neutral dash
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  } catch (_) { return null; }
}

/** Patch a material to sample the letter atlas at the tile given by the per-instance `aUvOffset` (0..1 = tile / 9).
 *  Also shifts the emissive sample, so at night the letters glow in their line colour instead of a flat white plate. */
function tileFaceMaterial(mat) {
  const atlas = mat.map;
  if (!atlas) return mat;
  const U = 1 / LETTER_TILE_COUNT;
  mat.emissiveMap = atlas; // same atlas, shifted by the same instance offset below; keyed per-material by plastic()'s cache
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aUvOffset;\nvarying float vTileOff;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTileOff = aUvOffset;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTileOff;')
      .replace('#include <map_fragment>', `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vec2( vMapUv.x * ${U.toFixed(6)} + vTileOff, vMapUv.y ) );
	diffuseColor *= sampledDiffuseColor;
#endif`)
      .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP
	vec4 emissiveColor = texture2D( emissiveMap, vec2( vEmissiveMapUv.x * ${U.toFixed(6)} + vTileOff, vEmissiveMapUv.y ) );
	totalEmissiveRadiance *= emissiveColor.rgb;
#endif`);
  };
  return mat;
}

/** three multiplies the *diffuse* term by the instance colour but not the emissive term, so an instanced white
 *  material with emissive:'white' washes out to white at night instead of glowing in the per-instance line
 *  colour. Same fragment splice zoning's plate materials use. */
function tintEmissiveByInstanceColor(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
#if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
	totalEmissiveRadiance *= vColor.rgb;
#endif`
    );
  };
  return mat;
}

/** A flat ribbon along `pts` ([{x,y,z}] centreline), lifted `lift` metres and `width` wide. Normals point up;
 * the material carries the line's colour. */
export function buildRibbonGeometry(pts, width, lift) {
  if (!pts || pts.length < 2) return null;
  const half = width / 2;
  const pos = [], nor = [], uv = [], idx = [];
  let vi = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const rx = tz, rz = -tx; // right of travel
    pos.push(p.x - rx * half, p.y + lift, p.z - rz * half, p.x + rx * half, p.y + lift, p.z + rz * half);
    nor.push(0, 1, 0, 0, 1, 0);
    uv.push(0, i, 1, i);
    if (i > 0) {
      const o = vi - 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    vi += 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function mergeGeometries(list) {
  // local import-free merge (three's addon merge needs matching attributes; our parts are position/normal/uv)
  const total = list.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const idx = [];
  let vo = 0;
  for (const g of list) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, vo * 3);
    nor.set(g.attributes.normal.array, vo * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index ? g.index.array : null;
    if (gi) for (let i = 0; i < gi.length; i++) idx.push(gi[i] + vo);
    else for (let i = 0; i < n; i++) idx.push(vo + i);
    vo += n;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeBoundingSphere();
  return out;
}
