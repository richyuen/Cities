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
  const foot = bb(0.46, 0.1, 0.46, 0.03);
  const footStud = put(cyl, 0, 0.1, 0, 0.24, 0.17, 0.24);
  const shaft = put(cyl, 0, 0.1, 0, 0.055, 2.5, 0.055);
  const cap = put(cyl, 0, 2.6, 0, 0.09, 0.12, 0.09);
  const poleGeo = merge([foot, footStud, shaft, cap]);

  // Sign: a coloured plate with a proud white face plate, mounted near the top and angled to face the road (+Z).
  const signPlate = bb(0.78, 0.56, 0.07, 0.02);
  signPlate.translate(0, 2.2, 0.02);
  const signGeo = signPlate;
  const facePlate = bb(0.5, 0.28, 0.03, 0.015);
  facePlate.translate(0, 2.2, 0.075);
  const faceGeo = facePlate;

  // Ground ring: a flat annulus in the line's colour, so a stop is findable from above and glows at night.
  const ring = new THREE.RingGeometry(1.05, 1.5, 28);
  ring.rotateX(-Math.PI / 2);
  ring.translate(0, 0.05, 0);
  const ringGeo = ring;

  const m = ctx.materials;
  return {
    poleGeo,
    signGeo,
    faceGeo,
    ringGeo,
    poleMat: m.plastic('darkStoneGrey', { roughness: 0.42, clearcoat: 0.4 }),
    signMat: m.plastic('white', { instanceColor: true, roughness: 0.38, clearcoat: 0.55, emissive: 'white', emissiveIntensity: 0 }),
    faceMat: m.plastic('white', { roughness: 0.32, clearcoat: 0.6 }),
    ringMat: m.plastic('white', { instanceColor: true, roughness: 0.45, clearcoat: 0.3, emissive: 'white', emissiveIntensity: 0, side: THREE.DoubleSide }),
  };
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
