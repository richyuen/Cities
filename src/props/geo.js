// Shared unit geometries + small matrix/merge helpers used to build one fixed-size procedural Lego
// assembly per prop kind. Everything here is pure (no ctx) so it can be created once at module load.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Cylinder standing on y=0, extending to y=1, radius 1 (scale xyz to size it: sx/sz = radius, sy = height).
export const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 14, 1);
UNIT_CYL.translate(0, 0.5, 0);

// Cone standing on y=0 (dome/nozzle caps), tip at y=1.
export const UNIT_CONE = new THREE.ConeGeometry(1, 1, 14, 1);
UNIT_CONE.translate(0, 0.5, 0);

// Icosahedron centred at the origin (leaf blobs, dome caps).
export const UNIT_ICO = new THREE.IcosahedronGeometry(1, 1);

// Sphere centred at the origin (bulbs, lenses).
export const UNIT_SPHERE = new THREE.SphereGeometry(1, 10, 8);

// Box standing on y=0, unit size 1x1x1.
export const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1);
UNIT_BOX.translate(0, 0.5, 0);

/** Compose a local transform: position + Euler rotation (radians, XYZ order) + scale. */
export function mat(px, py, pz, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(sx, sy, sz));
  return m;
}

/** Clone `geo`, transform it by matrix `m`. */
export function xf(geo, m) {
  const g = geo.clone();
  g.applyMatrix4(m);
  return g;
}

/** Merge a list of (already-transformed) geometries into one BufferGeometry for a single InstancedMesh.
 * mergeGeometries() requires every input to share the same indexed/non-indexed-ness (RoundedBoxGeometry is
 * non-indexed while Cylinder/Icosahedron/Sphere are indexed), so normalise everyone to non-indexed first. */
export function merge(geos) {
  const norm = geos.map((g) => (g.index !== null ? g.toNonIndexed() : g));
  const result = mergeGeometries(norm, false);
  for (let i = 0; i < geos.length; i++) {
    if (norm[i] !== geos[i]) norm[i].dispose();
    geos[i].dispose();
  }
  return result;
}

/** Rotation (radians about Y) that turns local "+Z forward" into world direction (dx, dz). */
export function dirToRot(dx, dz) {
  return Math.atan2(dx, dz);
}
