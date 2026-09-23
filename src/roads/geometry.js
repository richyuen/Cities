import * as THREE from 'three';
import { Y, KINDS, PITCH, PLATE, armPoint, connector, edgePoint, stationsBetween, profileAt, arcPoint, arcLength, arcY, laneOffsetsFor } from './network.js';

// Geometry accumulation. One GeoAcc per material bucket; everything of the network ends up in ~8 merged meshes.

const UV_SCALE = 1 / 8; // 8 m per texture tile (world-space UVs)
const STUD_INSET = 0.3; // min distance from a stud centre to a plate edge

export class GeoAcc {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; }
  get count() { return this.pos.length / 3; }
  vertex(x, y, z, nx, ny, nz) {
    this.pos.push(x, y, z); this.nrm.push(nx, ny, nz); this.uv.push(x * UV_SCALE, z * UV_SCALE);
    return this.count - 1;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  build() {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

function dedupe(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.z - q.z) > 1e-4) out.push(p);
  }
  if (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].z - out[out.length - 1].z) < 1e-4) out.pop();
  return out;
}

/** Flat polygon at height y (+Y normal). pts: [{x,z}] in any winding. */
export function addPolygon(acc, pts, y) {
  const P = dedupe(pts);
  if (P.length < 3) return;
  let area = 0;
  for (let i = 0; i < P.length; i++) { const a = P[i], b = P[(i + 1) % P.length]; area += a.x * b.z - b.x * a.z; }
  if (Math.abs(area) < 0.02) return;
  const v2 = P.map((p) => new THREE.Vector2(p.x, p.z));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(v2, []); } catch (_) { return; }
  const base = acc.count;
  for (const p of P) acc.vertex(p.x, y, p.z, 0, 1, 0);
  for (const t of tris) {
    const a = P[t[0]], b = P[t[1]], c = P[t[2]];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (cross > 0) acc.tri(base + t[0], base + t[2], base + t[1]); else acc.tri(base + t[0], base + t[1], base + t[2]);
  }
}

/**
 * Band between two polylines of equal length (points {x,y,z}). Top face + optional walls.
 * wallIn / wallOut: either a number (depth below top) or a function(point) → bottom y.
 * Normal orientation is fixed so the top faces +Y regardless of the polyline order.
 */
export function addBand(acc, inner, outer, { wallIn = 0, wallOut = 0, topNormal = true } = {}) {
  const n = Math.min(inner.length, outer.length);
  if (n < 2) return;
  let flip = false;
  for (let i = 0; i < n - 1; i++) {
    const a = inner[i], b = inner[i + 1], c = outer[i];
    const cross = (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
    if (Math.abs(cross) > 1e-6) { flip = cross > 0; break; }
  }
  const base = acc.count;
  for (let i = 0; i < n; i++) {
    const a = inner[i], b = outer[i];
    const p = inner[Math.max(0, i - 1)], q = inner[Math.min(n - 1, i + 1)];
    const tx = q.x - p.x, ty = q.y - p.y, tz = q.z - p.z;
    const lx = b.x - a.x, ly = b.y - a.y, lz = b.z - a.z;
    let nx = ty * lz - tz * ly, ny = tz * lx - tx * lz, nz = tx * ly - ty * lx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9 || !topNormal) { nx = 0; ny = 1; nz = 0; } else { nx /= len; ny /= len; nz /= len; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } }
    acc.vertex(a.x, a.y, a.z, nx, ny, nz);
    acc.vertex(b.x, b.y, b.z, nx, ny, nz);
  }
  for (let i = 0; i < n - 1; i++) {
    const i0 = base + i * 2, o0 = i0 + 1, i1 = i0 + 2, o1 = i0 + 3;
    if (flip) { acc.tri(i0, o0, i1); acc.tri(o0, o1, i1); } else { acc.tri(i0, i1, o0); acc.tri(o0, i1, o1); }
  }
  if (wallIn) addWall(acc, inner, outer, wallIn);
  if (wallOut) addWall(acc, outer, inner, wallOut);
}

/** Vertical wall along `line`, facing away from `other`. depth: number or fn(point) → bottom y. */
function addWall(acc, line, other, depth) {
  const n = Math.min(line.length, other.length);
  for (let i = 0; i < n - 1; i++) {
    const a = line[i], b = line[i + 1];
    const segx = b.x - a.x, segz = b.z - a.z;
    const sl = Math.hypot(segx, segz);
    if (sl < 1e-5) continue;
    let nx = -segz / sl, nz = segx / sl;
    const ox = other[i].x - a.x, oz = other[i].z - a.z;
    if (nx * ox + nz * oz > 0) { nx = -nx; nz = -nz; }
    const ya = typeof depth === 'function' ? depth(a) : a.y - depth;
    const yb = typeof depth === 'function' ? depth(b) : b.y - depth;
    if (ya >= a.y - 1e-4 && yb >= b.y - 1e-4) continue;
    const base = acc.count;
    acc.vertex(a.x, a.y, a.z, nx, 0, nz); acc.vertex(b.x, b.y, b.z, nx, 0, nz);
    acc.vertex(a.x, ya, a.z, nx, 0, nz); acc.vertex(b.x, yb, b.z, nx, 0, nz);
    const cx = (b.x - a.x), cz = (b.z - a.z);
    if (cz * nx - cx * nz > 0) { acc.tri(base, base + 1, base + 2); acc.tri(base + 1, base + 3, base + 2); }
    else { acc.tri(base, base + 2, base + 1); acc.tri(base + 1, base + 2, base + 3); }
  }
}

// ---- small 2D helpers ---------------------------------------------------------------------------

export function pointInPolygon(pts, x, z) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / ((b.z - a.z) || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

export function distToPolygonEdges(pts, x, z) {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1e-12;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / l2));
    const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
    if (d < best) best = d;
  }
  return best;
}

function lift(pts, yy) { return pts.map((p) => ({ x: p.x, y: yy, z: p.z })); }

/** Register a footprint polygon (used to mark world cells and hide/replace terrain studs). */
function footprint(B, pts, edgeId) {
  const P = dedupe(pts.map((p) => ({ x: p.x, z: p.z })));
  if (P.length >= 3) B.footprint.push({ pts: P, edgeId });
}

/** Studs on the 0.8 m world lattice inside a flat plate polygon, inset from its edges. */
function latticeStuds(B, poly, y, color) {
  let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
  for (const p of poly) { minx = Math.min(minx, p.x); maxx = Math.max(maxx, p.x); minz = Math.min(minz, p.z); maxz = Math.max(maxz, p.z); }
  const kx0 = Math.ceil((minx + STUD_INSET) / PITCH), kx1 = Math.floor((maxx - STUD_INSET) / PITCH);
  const kz0 = Math.ceil((minz + STUD_INSET) / PITCH), kz1 = Math.floor((maxz - STUD_INSET) / PITCH);
  for (let kx = kx0; kx <= kx1; kx++) {
    const x = kx * PITCH;
    for (let kz = kz0; kz <= kz1; kz++) {
      const z = kz * PITCH;
      if (!pointInPolygon(poly, x, z)) continue;
      if (distToPolygonEdges(poly, x, z) < STUD_INSET) continue;
      B.studs.push(x, y, z, color);
    }
  }
}

/** Studs every 0.8 m along a polyline ({x,y,z}), starting `carry` metres in. */
function studsAlong(B, row, y, color, carry = 0.4, accept = null) {
  for (let i = 0; i < row.length - 1; i++) {
    const a = row[i], b = row[i + 1];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-4) continue;
    let s = carry;
    while (s <= len) {
      const u = s / len;
      const x = a.x + (b.x - a.x) * u, z = a.z + (b.z - a.z) * u, yy = y ?? (a.y + (b.y - a.y) * u);
      if (!accept || accept(x, yy, z)) B.studs.push(x, yy, z, color);
      s += PITCH;
    }
    carry = s - len;
  }
}

/** Unit horizontal normals of a polyline pointing away from ref. */
function outwardNormals(pts, ref) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    let nx = -tz, nz = tx;
    if (nx * (p.x - ref.x) + nz * (p.z - ref.z) < 0) { nx = -nx; nz = -nz; }
    return { x: nx, z: nz };
  });
}

/**
 * Embankment as stepped Lego plate terraces: from the plate's outer edge (`top`, {x,y,z}) outward along `normals`,
 * one 0.4 m step down per 0.8 m run until the terrain is reached. Each step carries a stud row.
 */
function addTerraces(B, top, normals, edgeId) {
  const g = B.groundAt;
  const n = top.length;
  if (n < 2) return;
  const steps = new Array(n).fill(0);
  // terrain max at the outer edge of step k around the vertex (+-0.6 m along the local tangent, +-0.3 m across), a
  // function of the vertex alone so that two plates sharing an end vertex always agree on the step count
  const groundAtStep = (i, k) => {
    const tx = -normals[i].z, tz = normals[i].x; // tangent from the normal only: identical at shared vertices
    const cx = top[i].x + normals[i].x * PITCH * (k + 1), cz = top[i].z + normals[i].z * PITCH * (k + 1);
    let m = -Infinity;
    for (const dt of [-0.6, 0, 0.6]) for (const dn of [-0.3, 0.3]) m = Math.max(m, g(cx + tx * dt + normals[i].x * dn, cz + tz * dt + normals[i].z * dn));
    return m;
  };
  // A step is only worth building for a genuine height mismatch; a vertex whose sidewalk top sits within one
  // plate step of the raw terrain right under it never gets a terrace, no matter what groundAtStep() finds a
  // bit further out — avoids a stray one-vertex fin poking past the curb on an otherwise flat/near-flat run.
  const MIN_DELTA = PLATE;
  for (let i = 0; i < n; i++) {
    let k = 0;
    if (top[i].y - g(top[i].x, top[i].z) >= MIN_DELTA) {
      while (k < 14) {
        const yk = top[i].y - PLATE * (k + 1);
        if (yk <= groundAtStep(i, k) + 0.15) break;
        k++;
      }
    }
    steps[i] = k;
  }
  // A vertex that needs a step but has no neighbour that also needs one (including array boundaries, which have
  // only one side) would render as a lone stub rather than a real embankment run — e.g. right next to a node
  // whose plate was forced up by a *different* arm's footprint while this arm's own ground is still close by.
  // Demote those: a real embankment is always at least two vertices wide.
  for (let i = 0; i < n; i++) {
    if (steps[i] > 0 && (i === 0 || steps[i - 1] === 0) && (i === n - 1 || steps[i + 1] === 0)) steps[i] = 0;
  }
  let maxSteps = 0;
  for (let i = 0; i < n; i++) maxSteps = Math.max(maxSteps, steps[i]);
  if (maxSteps === 0) return;
  const bottom = (p) => Math.min(p.y - PLATE, g(p.x, p.z) - 0.05);
  const at = (i, k, yk) => ({ x: top[i].x + normals[i].x * PITCH * k, y: yk ?? top[i].y - PLATE * (k + 1), z: top[i].z + normals[i].z * PITCH * k });
  for (let k = 0; k < maxSteps; k++) {
    // runs of consecutive vertices that need this step (a vertex participates if it or a neighbour needs it)
    let i = 0;
    while (i < n) {
      while (i < n && !(steps[i] > k || (i > 0 && steps[i - 1] > k) || (i < n - 1 && steps[i + 1] > k))) i++;
      const start = i;
      while (i < n && (steps[i] > k || (i > 0 && steps[i - 1] > k) || (i < n - 1 && steps[i + 1] > k))) i++;
      if (i - start < 2) continue;
      const inner = [], outer = [];
      for (let j = start; j < i; j++) {
        const yk = top[j].y - PLATE * (k + 1);
        inner.push(at(j, k, yk));
        outer.push(at(j, k + 1, yk));
      }
      addBand(B.terrace, inner, outer, { wallOut: bottom });
      // one stud row per step, centred on the step
      const row = [];
      for (let j = start; j < i; j++) row.push(at(j, k + 0.5, top[j].y - PLATE * (k + 1)));
      studsAlong(B, row, null, 'darkStoneGrey', 0.4, (x, yy, z) => yy > g(x, z) + 0.12); // not where the step is buried
    }
  }
  const foot = [];
  for (let i = n - 1; i >= 0; i--) foot.push(at(i, steps[i] + 0.1));
  footprint(B, [...top, ...foot], edgeId);
}

// ------------------------------------------------------------------------------------------------
// Builders. `B` is the bucket map: { surface, path, curb, sidewalk, verge, terrace, white, yellow } → GeoAcc, plus
// `studs` (StudList), `footprint` (array) and `groundAt(x,z)`.

export function buildEdge(B, f, nodes) {
  const spec = f.spec;
  const st = stationsBetween(f, f.s0, f.s1);
  if (st.length < 2) return;
  const w = f.w;
  const surfBucket = f.kind === 'path' ? B.path : B.surface;
  const L = st.map((s) => edgePoint(f, s, -w, Y.surface));
  const R = st.map((s) => edgePoint(f, s, +w, Y.surface));
  addBand(surfBucket, L, R, {});

  const nodeA = nodes.get(f.a), nodeB = nodes.get(f.b);
  const crossA = spec.crosswalk && nodeA?.kind === 'intersection';
  const crossB = spec.crosswalk && nodeB?.kind === 'intersection';
  const fp = w + spec.sidewalk;
  footprint(B, [edgePoint(f, f.s0, -fp), edgePoint(f, f.s1, -fp), edgePoint(f, f.s1, fp), edgePoint(f, f.s0, fp)], f.id);

  if (spec.sidewalk > 0) {
    const top = spec.verge ? Y.verge : Y.sidewalk;
    const bucket = spec.verge ? B.verge : B.sidewalk;
    for (const side of [-1, 1]) {
      if (spec.curb > 0) {
        const cIn = st.map((s) => edgePoint(f, s, side * w, Y.curb));
        const cOut = st.map((s) => edgePoint(f, s, side * (w + spec.curb), Y.curb));
        addBand(B.curb, cIn, cOut, { wallIn: Y.curb - Y.surface + 0.02, wallOut: Y.curb - top });
      }
      const pIn = st.map((s) => edgePoint(f, s, side * (w + spec.curb), top));
      const pOut = st.map((s) => edgePoint(f, s, side * (w + spec.sidewalk), top));
      addBand(bucket, pIn, pOut, {
        wallIn: spec.curb > 0 ? 0 : top - Y.surface + 0.02,
        wallOut: (p) => Math.min(p.y - 0.3, B.groundAt(p.x, p.z) - 0.4),
      });
      const tst = [f.s0]; for (let s = Math.ceil(f.s0 / 2) * 2; s < f.s1 - 0.5; s += 2) if (s > f.s0 + 0.5) tst.push(s); tst.push(f.s1);
      const tOut = tst.map((s) => edgePoint(f, s, side * (w + spec.sidewalk), top));
      addTerraces(B, tOut, tOut.map(() => ({ x: f.right.x * side, z: f.right.z * side })), f.id);
      // studs: rows on the lattice (plate edges sit at 0.8k + 0.4), 0.8 m pitch along the edge
      const inner = w + spec.curb + 0.4, outer = w + spec.sidewalk - 0.4;
      const rows = [];
      for (let lat = inner; lat <= outer + 1e-3; lat += PITCH) rows.push(lat);
      const sStart = Math.ceil((f.s0 + 0.4) / PITCH) * PITCH;
      const rx = f.right.x * side, rz = f.right.z * side, col = spec.sidewalkColor, studs = B.studs;
      for (let s = sStart; s <= f.s1 - 0.4; s += PITCH) {
        const y = profileAt(f, s) + top;
        const bx = f.ax + f.d.x * s, bz = f.az + f.d.z * s;
        for (let k = 0; k < rows.length; k++) studs.push(bx + rx * rows[k], y, bz + rz * rows[k], col);
      }
    }
  } else if (f.kind === 'path') {
    // paths are thin plates: give them a small side wall so they read as a raised plate
    for (const side of [-1, 1]) {
      const e = st.map((s) => edgePoint(f, s, side * w, Y.surface));
      const o = st.map((s) => edgePoint(f, s, side * (w - 0.1), Y.surface));
      addWall(B.path, e, o, (p) => Math.min(p.y - 0.15, B.groundAt(p.x, p.z) - 0.2));
    }
  }

  // raised median (avenues): stops before the stop bar at intersections, runs through bends
  if (spec.median > 0) {
    const gapFor = (n) => (n?.kind === 'intersection' ? 4.2 : n?.arc ? 0 : 1.5);
    const ga = gapFor(nodeA), gb = gapFor(nodeB);
    const ma = f.s0 + ga, mb = f.s1 - gb;
    if (mb - ma > 1) {
      const hw = spec.median / 2;
      // Taper the ends that stop short of a junction into a nose (a blunt square cut reads unfinished and the
      // yellow lines beside it look clipped). Ends that meet a bend keep full width so the arc median matches.
      const noseA = ga > 0 ? Math.min(1.5, (mb - ma) * 0.4) : 0;
      const noseB = gb > 0 ? Math.min(1.5, (mb - ma) * 0.4) : 0;
      const halfAt = (s) => {
        let t = 1;
        if (noseA > 0) t = Math.min(t, (s - ma) / noseA);
        if (noseB > 0) t = Math.min(t, (mb - s) / noseB);
        t = Math.max(0, Math.min(1, t));
        return hw * (0.18 + 0.82 * t);
      };
      const mst2 = [ma];
      for (let s = Math.ceil(ma / PITCH) * PITCH; s < mb - 1e-3; s += PITCH) if (s > ma + 1e-3) mst2.push(s);
      mst2.push(mb);
      const mL = mst2.map((s) => edgePoint(f, s, -halfAt(s), Y.sidewalk));
      const mR = mst2.map((s) => edgePoint(f, s, +halfAt(s), Y.sidewalk));
      addBand(B.curb, mL, mR, { wallIn: Y.sidewalk - Y.surface + 0.02, wallOut: Y.sidewalk - Y.surface + 0.02 });
      const capDepth = Y.sidewalk - Y.surface + 0.02;
      if (noseA > 0) addCap(B.curb, edgePoint(f, ma, -halfAt(ma), Y.sidewalk), edgePoint(f, ma, halfAt(ma), Y.sidewalk), capDepth, -1, f);
      if (noseB > 0) addCap(B.curb, edgePoint(f, mb, -halfAt(mb), Y.sidewalk), edgePoint(f, mb, halfAt(mb), Y.sidewalk), capDepth, +1, f);
      for (let s = Math.ceil((ma + 0.4) / PITCH) * PITCH; s <= mb - 0.4; s += PITCH) {
        if (halfAt(s) < 0.55) continue; // would hang off the tapered nose
        for (const lat of [-0.4, 0.4]) { const p = edgePoint(f, s, lat, Y.sidewalk); B.studs.push(p.x, p.y, p.z, 'mediumStoneGrey'); }
      }
    }
  }

  // markings
  const markStart = f.s0 + (crossA ? 4.2 : 0.3);
  const markEnd = f.s1 - (crossB ? 4.2 : 0.3);
  for (const m of spec.marks) {
    const bucket = m.color === 'white' ? B.white : B.yellow;
    if (m.type === 'solid') {
      addStrip(bucket, f, markStart, markEnd, m.lat - m.w / 2, m.lat + m.w / 2);
    } else {
      const period = m.dash + m.gap;
      for (let s = markStart + m.gap / 2; s < markEnd - 0.3; s += period) {
        addStrip(bucket, f, s, Math.min(s + m.dash, markEnd), m.lat - m.w / 2, m.lat + m.w / 2);
      }
    }
  }
  if (crossA) addCrosswalk(B, f, f.s0, +1, w, spec);
  if (crossB) addCrosswalk(B, f, f.s1, -1, w, spec);
  if (f.oneway) addOneWayArrows(B, f, spec, markStart, markEnd);
}

/** Lane arrows for a one-way street: white stem + head on every usable lane, every ~12 m, pointing along the
 * flow. Two-way roads are untouched (no arrows), so their rendered output is unchanged. */
function addOneWayArrows(B, f, spec, markStart, markEnd) {
  const dir = f.oneway > 0 ? 1 : -1;                       // +1 points towards increasing s
  const dirName = dir > 0 ? 'forward' : 'backward';
  const nLanes = spec.laneOffsets.length * 2;
  const offs = laneOffsetsFor(f, dirName);
  const SPACING = 12;
  for (let k = 0; k < nLanes; k++) {
    const lat = offs[k];
    for (let s = markStart + 5; s <= markEnd - 4; s += SPACING) addLaneArrow(B.white, f, s, lat, dir);
  }
}

/** One arrow: a strip stem plus a triangular head at the marking height, following the road profile. */
function addLaneArrow(acc, f, s, lat, dir) {
  const half = 1.5, head = 1.3, stemHalf = 0.16, headHalf = 0.65;
  const sBack = s - dir * half, sNeck = s + dir * (half - head);
  addStrip(acc, f, Math.min(sBack, sNeck), Math.max(sBack, sNeck), lat - stemHalf, lat + stemHalf);
  const p1 = edgePoint(f, sNeck, lat - headHalf, Y.marking);
  const p2 = edgePoint(f, sNeck, lat + headHalf, Y.marking);
  const tip = edgePoint(f, s + dir * half, lat, Y.marking);
  const base = acc.count;
  acc.vertex(p1.x, p1.y, p1.z, 0, 1, 0);
  acc.vertex(p2.x, p2.y, p2.z, 0, 1, 0);
  acc.vertex(tip.x, tip.y, tip.z, 0, 1, 0);
  // upward-facing winding: normal.y = uz*vx - ux*vz must be positive
  if ((p2.z - p1.z) * (tip.x - p1.x) - (p2.x - p1.x) * (tip.z - p1.z) > 0) acc.tri(base, base + 1, base + 2);
  else acc.tri(base, base + 2, base + 1);
}

/** Vertical end cap of the median. */
function addCap(acc, a, b, depth, dir, f) {
  const nx = f.d.x * dir, nz = f.d.z * dir;
  const base = acc.count;
  acc.vertex(a.x, a.y, a.z, nx, 0, nz); acc.vertex(b.x, b.y, b.z, nx, 0, nz);
  acc.vertex(a.x, a.y - depth, a.z, nx, 0, nz); acc.vertex(b.x, b.y - depth, b.z, nx, 0, nz);
  const cx = b.x - a.x, cz = b.z - a.z;
  if (cz * nx - cx * nz > 0) { acc.tri(base, base + 1, base + 2); acc.tri(base + 1, base + 3, base + 2); }
  else { acc.tri(base, base + 2, base + 1); acc.tri(base + 1, base + 2, base + 3); }
}

/** Marking strip following the profile. Sub-25 cm slivers (a dash clipped by a junction trim) are dropped rather
 * than rendered as a hairline that shimmers on the deck at grazing angles. */
function addStrip(acc, f, s0, s1, l0, l1) {
  if (!(s1 - s0 > 0.25)) return;
  const st = stationsBetween(f, s0, s1);
  const A = st.map((s) => edgePoint(f, s, l0, Y.marking));
  const Bp = st.map((s) => edgePoint(f, s, l1, Y.marking));
  addBand(acc, A, Bp, {});
}

/** Zebra crossing + stop bar (across the approaching lanes only) at an edge end. dir = +1 (towards B) or -1. */
function addCrosswalk(B, f, sEnd, dir, w, spec) {
  const s0 = sEnd + dir * 0.5, s1 = sEnd + dir * 2.7;
  const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
  const stripe = 0.6, gap = 0.5;
  for (let lat = -w + 0.5; lat + stripe <= w - 0.4; lat += stripe + gap) addStrip(B.white, f, lo, hi, lat, lat + stripe);
  const sl0 = sEnd + dir * 3.1, sl1 = sEnd + dir * 3.7;
  // incoming traffic at A travels backward (its right = -right); at B forward (its right = +right)
  const inner = spec.median > 0 ? spec.median / 2 + 0.25 : 0.15;
  const a = dir > 0 ? -w + 0.3 : inner, b = dir > 0 ? -inner : w - 0.3;
  addStrip(B.white, f, Math.min(sl0, sl1), Math.max(sl0, sl1), a, b);
}

// ------------------------------------------------------------------------------------------------

export function buildNode(B, node) {
  if (node.kind === 'deadend') return buildDeadEnd(B, node);
  if (node.arc) return buildArcNode(B, node);
  const arms = node.arms;
  const y = node.y;
  const surfPts = [];
  const outerPts = [];
  for (let i = 0; i < arms.length; i++) {
    const A = arms[i];
    surfPts.push(armPoint(node, A, A.trim, A.w, -1));
    surfPts.push(armPoint(node, A, A.trim, A.w, +1));
    outerPts.push(armPoint(node, A, A.trim, A.w + A.sw, -1));
    outerPts.push(armPoint(node, A, A.trim, A.w + A.sw, +1));
    const pair = node.pairs[i];
    if (pair) {
      for (const p of connector(node, pair, A.w, arms[pair.j].w)) surfPts.push(p);
      for (const p of connector(node, pair, A.w + A.sw, arms[pair.j].w + arms[pair.j].sw)) outerPts.push(p);
    }
  }
  const anyPath = arms.every((a) => a.frame.kind === 'path');
  addPolygon(anyPath ? B.path : B.surface, surfPts, y + Y.surface);
  footprint(B, outerPts, arms[0].edgeId);

  // corner bands: curb + sidewalk plate between consecutive arms
  for (const pair of node.pairs) {
    const A = arms[pair.i], Bm = arms[pair.j];
    const specA = A.frame.spec, specB = Bm.frame.spec;
    if (specA.sidewalk <= 0 && specB.sidewalk <= 0) continue;
    const curbA = specA.curb, curbB = specB.curb;
    const swA = specA.sidewalk, swB = specB.sidewalk;
    const verge = specA.verge && specB.verge;
    const top = verge ? Y.verge : Y.sidewalk;
    const line = (offA, offB) => [armPoint(node, A, A.trim, offA, +1), ...connector(node, pair, offA, offB), armPoint(node, Bm, Bm.trim, offB, -1)];
    if (curbA > 0 || curbB > 0) {
      const cin = lift(line(A.w, Bm.w), y + Y.curb);
      const cout = lift(line(A.w + curbA, Bm.w + curbB), y + Y.curb);
      addBand(B.curb, cin, cout, { wallIn: Y.curb - Y.surface + 0.02, wallOut: Y.curb - top });
    }
    const pinPts = line(A.w + curbA, Bm.w + curbB);
    const poutPts = line(A.w + swA, Bm.w + swB);
    const pin = lift(pinPts, y + top);
    const pout = lift(poutPts, y + top);
    const bucket = verge ? B.verge : B.sidewalk;
    addBand(bucket, pin, pout, {
      wallIn: (curbA > 0 || curbB > 0) ? 0 : top - Y.surface + 0.02,
      wallOut: (p) => Math.min(p.y - 0.3, B.groundAt(p.x, p.z) - 0.4),
    });
    const cn = outwardNormals(poutPts, node);
    cn[0] = { x: A.right.x, z: A.right.z }; cn[cn.length - 1] = { x: Bm.left.x, z: Bm.left.z }; // match the edge plates exactly
    addTerraces(B, pout, cn, A.edgeId);
    // studs on the corner plate: world lattice, inset from the plate edges (never on the fillet arc itself)
    const plate = [...pinPts, ...poutPts.slice().reverse()];
    latticeStuds(B, plate, y + top, specA.sidewalkColor);
  }
}

/** 2-arm bend: curved carriageway, curbs, sidewalks, continued markings and studs along the arc. */
function buildArcNode(B, node) {
  const A = node.arms[0];
  const spec = A.frame.spec;
  const w = A.w, curb = spec.curb, sw = spec.sidewalk;
  const n = Math.max(6, Math.ceil(arcLength(node, 0) / 1.2));
  // yy is the layer offset above the (sloped) bed
  const poly = (lat, yy) => { const out = []; for (let i = 0; i <= n; i++) { const p = arcPoint(node, i / n, lat); out.push({ x: p.x, y: arcY(node, i / n) + yy, z: p.z }); } return out; };
  const surfBucket = spec.lanes === 0 ? B.path : B.surface;
  addBand(surfBucket, poly(-w, Y.surface), poly(w, Y.surface), {});
  footprint(B, [...poly(-(w + sw), 0), ...poly(w + sw, 0).reverse()], A.edgeId);

  if (sw > 0) {
    const top = spec.verge ? Y.verge : Y.sidewalk;
    const bucket = spec.verge ? B.verge : B.sidewalk;
    for (const side of [-1, 1]) {
      if (curb > 0) addBand(B.curb, poly(side * w, Y.curb), poly(side * (w + curb), Y.curb), { wallIn: Y.curb - Y.surface + 0.02, wallOut: Y.curb - top });
      const pout = poly(side * (w + sw), top);
      addBand(bucket, poly(side * (w + curb), top), pout, {
        wallIn: curb > 0 ? 0 : top - Y.surface + 0.02,
        wallOut: (p) => Math.min(p.y - 0.3, B.groundAt(p.x, p.z) - 0.4),
      });
      // outward = away from the carriageway: radially away from O on the outer side, towards O on the inner side
      const outwardSign = node.arc.k * side; // +1 when this side is the outside of the circle
      const normals = pout.map((p) => { let nx = p.x - node.arc.O.x, nz = p.z - node.arc.O.z; const l = Math.hypot(nx, nz) || 1; return { x: (nx / l) * outwardSign, z: (nz / l) * outwardSign }; });
      addTerraces(B, pout, normals, A.edgeId);
      for (let lat = w + curb + 0.4; lat <= w + sw - 0.4 + 1e-3; lat += PITCH) studsAlong(B, poly(side * lat, top), null, spec.sidewalkColor, 0.4);
    }
  } else if (spec.lanes === 0) {
    for (const side of [-1, 1]) addWall(B.path, poly(side * w, Y.surface), poly(side * (w - 0.1), Y.surface), (p) => Math.min(p.y - 0.15, B.groundAt(p.x, p.z) - 0.2));
  }
  if (spec.median > 0) {
    const hw = spec.median / 2;
    addBand(B.curb, poly(-hw, Y.sidewalk), poly(hw, Y.sidewalk), { wallIn: Y.sidewalk - Y.surface + 0.02, wallOut: Y.sidewalk - Y.surface + 0.02 });
    for (const lat of [-0.4, 0.4]) studsAlong(B, poly(lat, Y.sidewalk), null, 'mediumStoneGrey', 0.4);
  }
  // markings continue around the bend (cross sections are symmetric, so the travel frame sign does not matter)
  for (const m of spec.marks) {
    const bucket = m.color === 'white' ? B.white : B.yellow;
    if (m.type === 'solid') {
      addBand(bucket, poly(m.lat - m.w / 2, Y.marking), poly(m.lat + m.w / 2, Y.marking), {});
    } else {
      const len = arcLength(node, m.lat);
      const period = m.dash + m.gap;
      const seg = (u0, u1, lat) => { const out = []; const k = Math.max(2, Math.ceil((u1 - u0) * n) + 1); for (let i = 0; i < k; i++) { const p = arcPoint(node, u0 + (u1 - u0) * (i / (k - 1)), lat); out.push({ x: p.x, y: arcY(node, u0 + (u1 - u0) * (i / (k - 1))) + Y.marking, z: p.z }); } return out; };
      for (let s = m.gap / 2; s < len - 0.3; s += period) {
        const u0 = s / len, u1 = Math.min(1, (s + m.dash) / len);
        if (!((u1 - u0) * len > 0.25)) continue; // clipped dash sliver
        addBand(bucket, seg(u0, u1, m.lat - m.w / 2), seg(u0, u1, m.lat + m.w / 2), {});
      }
    }
  }
}

function buildDeadEnd(B, node) {
  const A = node.arms[0];
  const spec = A.frame.spec;
  const y = node.y;
  const Rb = A.bulb;
  const w = A.w;
  const sw = spec.sidewalk, curb = spec.curb;
  const surfBucket = spec.lanes === 0 ? B.path : B.surface;
  if (Rb <= 0) {
    // square stub: the carriageway and sidewalks end flush at the node; close the end with a wall
    const bottom = (p) => Math.min(p.y - 0.3, B.groundAt(p.x, p.z) - 0.4);
    const t = A.trim;
    const back = (p) => ({ x: p.x + A.d.x * 0.5, y: p.y, z: p.z + A.d.z * 0.5 });
    const endLine = (off, yy) => lift([armPoint(node, A, t, off, -1), armPoint(node, A, t, off, +1)], yy);
    const surf = endLine(w, y + Y.surface);
    addWall(surfBucket, surf, surf.map(back), bottom);
    if (sw > 0) {
      const top = spec.verge ? Y.verge : Y.sidewalk;
      for (const side of [-1, 1]) {
        const seg = lift([armPoint(node, A, t, side * w, +1), armPoint(node, A, t, side * (w + sw), +1)], y + top);
        addWall(spec.verge ? B.verge : B.sidewalk, seg, seg.map(back), bottom);
        if (curb > 0) {
          const c = lift([armPoint(node, A, t, side * w, +1), armPoint(node, A, t, side * (w + curb), +1)], y + Y.curb);
          addWall(B.curb, c, c.map(back), Y.curb - top);
        }
      }
    }
    return;
  }
  const L = armPoint(node, A, A.trim, w, -1), R = armPoint(node, A, A.trim, w, +1);
  const arc = (radius, from, to, n) => {
    const pts = [];
    for (let i = 0; i <= n; i++) { const ang = from + (to - from) * (i / n); pts.push({ x: node.x + Math.cos(ang) * radius, z: node.z + Math.sin(ang) * radius }); }
    return pts;
  };
  const angArm = Math.atan2(A.d.z, A.d.x);
  const half = Math.asin(Math.min(1, w / Rb));
  const aR = angArm + half, aL = angArm - half + Math.PI * 2;
  const N = 28;
  const surf = [L, R, ...arc(Rb, aR, aL, N)];
  addPolygon(surfBucket, surf, y + Y.surface);
  const ring = (rad, lateral) => {
    const h = Math.asin(Math.min(1, lateral / rad));
    const P = armPoint(node, A, A.trim, lateral, +1), Q = armPoint(node, A, A.trim, lateral, -1);
    return [P, ...arc(rad, angArm + h, angArm - h + Math.PI * 2, N), Q];
  };
  footprint(B, ring(Rb + sw, w + sw), A.edgeId);
  if (sw > 0) {
    const top = spec.verge ? Y.verge : Y.sidewalk;
    if (curb > 0) {
      addBand(B.curb, lift(ring(Rb, w), y + Y.curb), lift(ring(Rb + curb, w + curb), y + Y.curb), { wallIn: Y.curb - Y.surface + 0.02, wallOut: Y.curb - top });
    }
    const outerPts = ring(Rb + sw, w + sw);
    const pout = lift(outerPts, y + top);
    addBand(spec.verge ? B.verge : B.sidewalk, lift(ring(Rb + curb, w + curb), y + top), pout, {
      wallIn: curb > 0 ? 0 : top - Y.surface + 0.02,
      wallOut: (p) => Math.min(p.y - 0.3, B.groundAt(p.x, p.z) - 0.4),
    });
    addTerraces(B, pout, outwardNormals(outerPts, node), A.edgeId);
    for (let r = Rb + curb + 0.4; r <= Rb + sw - 0.3; r += PITCH) {
      const h = Math.asin(Math.min(1, (w + curb + 0.4) / r));
      const from = angArm + h, to = angArm - h + Math.PI * 2;
      const n = Math.max(4, Math.round((to - from) * r / PITCH));
      for (let i = 0; i <= n; i++) {
        const ang = from + (to - from) * (i / n);
        B.studs.push(node.x + Math.cos(ang) * r, y + top, node.z + Math.sin(ang) * r, spec.sidewalkColor);
      }
    }
  }
}

export { KINDS, Y, profileAt };
