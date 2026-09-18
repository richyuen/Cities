// Road network math: per-kind cross sections, edge frames (terrain-following profiles), node geometry
// (trims, corners, fillets, bend arcs) and lane helpers. Pure data; no THREE objects are created here.

// Y layering (relative to the road bed profile): surface 0.15, markings 0.17, curbs 0.38, sidewalk top 0.35.
export const Y = { surface: 0.15, marking: 0.17, sidewalk: 0.35, curb: 0.38, verge: 0.35, lane: 0.16 };

export const PITCH = 0.8;     // stud lattice (world x/z multiples of 0.8)
export const PLATE = 0.4;     // Lego plate height; terrain heights are multiples of it

// Cross-section per kind. w = carriageway half-width (== world width / 2). laneOffsets: lateral offset (to the right
// of travel) of each lane centre, index 0 = rightmost lane. curb/sidewalk widths are outside the carriageway
// (sidewalk includes the curb). Plate edges sit at lattice-cell boundaries (0.8k + 0.4) so studs land on the lattice.
// bulb: cul-de-sac radius (streets only; 0 = square stub). arcR: max centreline radius for bends.
export const KINDS = {
  street: {
    width: 8, lanes: 2, laneOffsets: [2.0], curb: 0.4, sidewalk: 2.0, sidewalkColor: 'lightStoneGrey',
    median: 0, bulb: 8.5, fillet: 3.0, arcR: 8, crosswalk: true,
    marks: [
      { type: 'dash', lat: 0, w: 0.22, color: 'white', dash: 2.4, gap: 2.4 },
      { type: 'solid', lat: 3.6, w: 0.2, color: 'white' },
      { type: 'solid', lat: -3.6, w: 0.2, color: 'white' },
    ],
  },
  avenue: {
    width: 16, lanes: 4, laneOffsets: [6.25, 2.75], curb: 0.4, sidewalk: 2.0, sidewalkColor: 'lightStoneGrey',
    median: 1.6, bulb: 0, fillet: 3.0, arcR: 16, crosswalk: true,
    marks: [
      { type: 'solid', lat: 1.06, w: 0.14, color: 'brightYellow' },
      { type: 'solid', lat: 1.32, w: 0.14, color: 'brightYellow' },
      { type: 'solid', lat: -1.06, w: 0.14, color: 'brightYellow' },
      { type: 'solid', lat: -1.32, w: 0.14, color: 'brightYellow' },
      { type: 'dash', lat: 4.5, w: 0.2, color: 'white', dash: 2.4, gap: 2.4 },
      { type: 'dash', lat: -4.5, w: 0.2, color: 'white', dash: 2.4, gap: 2.4 },
      { type: 'solid', lat: 7.6, w: 0.2, color: 'white' },
      { type: 'solid', lat: -7.6, w: 0.2, color: 'white' },
    ],
  },
  highway: {
    width: 16, lanes: 4, laneOffsets: [5.25, 1.75], curb: 0.4, sidewalk: 2.0, sidewalkColor: 'mediumStoneGrey',
    verge: true, median: 0, bulb: 0, fillet: 3.0, arcR: 60, crosswalk: false,
    marks: [
      { type: 'solid', lat: 0.15, w: 0.14, color: 'brightYellow' },
      { type: 'solid', lat: -0.15, w: 0.14, color: 'brightYellow' },
      { type: 'dash', lat: 3.5, w: 0.2, color: 'white', dash: 3.2, gap: 3.2 },
      { type: 'dash', lat: -3.5, w: 0.2, color: 'white', dash: 3.2, gap: 3.2 },
      { type: 'solid', lat: 7.0, w: 0.22, color: 'white' },
      { type: 'solid', lat: -7.0, w: 0.22, color: 'white' },
    ],
  },
  path: {
    width: 3, lanes: 0, laneOffsets: [0], curb: 0, sidewalk: 0, sidewalkColor: 'tan', median: 0, bulb: 0,
    fillet: 1.5, arcR: 4, crosswalk: false, marks: [],
  },
};

export function kindSpec(kind) { return KINDS[kind] || KINDS.street; }

const STATION = 4;            // metres between profile samples along an edge
const ARC_N = 8;              // points per fillet arc
const TRIM_PAD = 0.02;

function num(v, fallback = 0) { return Number.isFinite(v) ? v : fallback; }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Intersection of lines p + a*t and q + b*s. Returns {x,z,t,s} or null if parallel. */
function lineIntersect(px, pz, ax, az, qx, qz, bx, bz) {
  const den = ax * bz - az * bx;
  if (Math.abs(den) < 1e-7) return null;
  const dx = qx - px, dz = qz - pz;
  const t = (dx * bz - dz * bx) / den;
  const s = (dx * az - dz * ax) / den;
  return { x: px + ax * t, z: pz + az * t, t, s };
}

/**
 * Build frames for every edge and node.
 * groundAt(x, z): rendered terrain surface height (never NaN).
 * Returns { edges: Map<id, EdgeFrame>, nodes: Map<id, NodeFrame> }.
 */
export function buildNetwork(world, groundAt) {
  const edges = new Map();
  const nodes = new Map();
  const ground = (x, z) => num(groundAt(x, z), 0);

  // --- pass 1: edge basics --------------------------------------------------------------
  for (const e of world.roads.edges.values()) {
    const na = world.roads.nodes.get(e.a), nb = world.roads.nodes.get(e.b);
    if (!na || !nb) continue;
    const dx = nb.x - na.x, dz = nb.z - na.z;
    const L = Math.hypot(dx, dz);
    if (!(L > 0.01)) continue;
    const spec = kindSpec(e.kind);
    const d = { x: dx / L, z: dz / L };
    const right = { x: -d.z, z: d.x };
    edges.set(e.id, {
      id: e.id, kind: e.kind, spec, a: e.a, b: e.b, ax: na.x, az: na.z, bx: nb.x, bz: nb.z, d, right, L,
      w: spec.width / 2, sw: spec.sidewalk, trimA: 0, trimB: 0, stations: null, ys: null, ya: 0, yb: 0,
    });
  }

  // --- pass 2: nodes & arms --------------------------------------------------------------
  for (const n of world.roads.nodes.values()) {
    const arms = [];
    for (const eid of n.edges) {
      const f = edges.get(eid);
      if (!f) continue;
      const outward = f.a === n.id;
      const d = outward ? f.d : { x: -f.d.x, z: -f.d.z };
      const right = { x: -d.z, z: d.x };
      arms.push({
        edgeId: eid, frame: f, outward, d, right, left: { x: -right.x, z: -right.z },
        angle: Math.atan2(d.z, d.x), w: f.w, sw: f.sw, trim: 0, bulb: 0,
      });
    }
    if (!arms.length) continue;
    arms.sort((p, q) => p.angle - q.angle);
    const node = { id: n.id, x: n.x, z: n.z, y: 0, arms, kind: arms.length >= 3 ? 'intersection' : arms.length === 2 ? 'joint' : 'deadend', pairs: [], arc: null };
    computeNodeCorners(node);
    // node height: highest rendered terrain under the node's actual footprint, so plates never sink into a hill
    let y = ground(n.x, n.z);
    for (const p of nodeFootprintSamples(node)) y = Math.max(y, ground(p.x, p.z));
    node.y = y;
    if (node.arc) arcProfile(node, ground);
    nodes.set(n.id, node);
    for (const a of arms) {
      const ya = node.arc ? (a === arms[0] ? node.arc.yA : node.arc.yB) : y;
      if (a.outward) { a.frame.trimA = a.trim; a.frame.ya = ya; } else { a.frame.trimB = a.trim; a.frame.yb = ya; }
    }
  }

  // --- pass 3: edge profiles ------------------------------------------------------------
  for (const f of edges.values()) buildProfile(ground, f);

  return { edges, nodes };
}

/** ~1 m sample points covering the node footprint (arm stubs to the trim, core disc, bulb, bend arc). */
function* nodeFootprintSamples(node) {
  let core = 0;
  for (const a of node.arms) {
    const r = a.w + a.sw;
    core = Math.max(core, r);
    const t1 = Math.max(0.5, a.trim);
    for (let t = 0; t <= t1 + 1e-6; t += 1) {
      for (let l = -r; l <= r + 1e-6; l += 1) yield { x: node.x + a.d.x * t + a.right.x * l, z: node.z + a.d.z * t + a.right.z * l };
    }
    if (a.bulb > 0) {
      const R = a.bulb + a.sw;
      for (let x = -R; x <= R; x += 1) for (let z = -R; z <= R; z += 1) if (x * x + z * z <= R * R) yield { x: node.x + x, z: node.z + z };
    }
  }
  for (let x = -core; x <= core; x += 1) for (let z = -core; z <= core; z += 1) if (x * x + z * z <= core * core) yield { x: node.x + x, z: node.z + z };
  if (node.arc) {
    const r = node.arms[0].w + node.arms[0].sw;
    const n = Math.max(2, Math.ceil(arcLength(node, 0)));
    for (let i = 0; i <= n; i++) for (let l = -r; l <= r + 1e-6; l += 1) yield arcPoint(node, i / n, l);
  }
}

/** For a node: per adjacent arm pair compute the corner (mitre/fillet) and the trims; 2-arm bends become arcs. */
function computeNodeCorners(node) {
  const arms = node.arms;
  const k = arms.length;
  if (k === 1) {
    const a = arms[0];
    const Rb = a.frame.spec.bulb > 0 ? Math.max(a.w + 0.5, a.frame.spec.bulb) : 0;
    a.bulb = Rb;
    if (Rb > 0) {
      const Ro = Rb + a.sw;
      a.trim = Math.max(Math.sqrt(Math.max(0, Rb * Rb - a.w * a.w)), Math.sqrt(Math.max(0, Ro * Ro - (a.w + a.sw) ** 2))) + TRIM_PAD;
    } else {
      a.trim = TRIM_PAD; // square stub
    }
    return;
  }
  if (k === 2 && tryArc(node)) return;

  for (let i = 0; i < k; i++) {
    const A = arms[i], B = arms[(i + 1) % k];
    let delta = B.angle - A.angle;
    if (i === k - 1) delta += Math.PI * 2;
    if (delta < 0) delta += Math.PI * 2;
    const pair = { i, j: (i + 1) % k, delta, mode: 'chord', O: null, r: 0, C: null };
    const inner = delta < Math.PI - 0.03;
    const straightSame = Math.abs(delta - Math.PI) < 0.03 && Math.abs(A.w - B.w) < 0.01 && Math.abs(A.sw - B.sw) < 0.01;
    if (straightSame) { pair.mode = 'chord'; node.pairs.push(pair); continue; }
    // cap for non-fillet trims: a bit more than the widest arm crossing this one
    const capA = 1.25 * (B.w + B.sw) + 1, capB = 1.25 * (A.w + A.sw) + 1;
    // corner of carriageway lines: right side of A meets left side of B
    const C = cornerAt(node, A, B, A.w, B.w);
    const Cf = cornerAt(node, A, B, A.w + A.sw, B.w + B.sw);
    if (inner && C) {
      const filletOk = delta < 2.62 && delta > 0.35; // < 150deg and > 20deg
      const r = Math.min(A.frame.spec.fillet, B.frame.spec.fillet);
      const rMin = Math.max(A.sw, B.sw) + 0.5;
      if (filletOk && r >= rMin) {
        // fillet centre O: along bisector of the two side directions, distance r / sin(delta/2)
        const bx = A.d.x + B.d.x, bz = A.d.z + B.d.z;
        const bl = Math.hypot(bx, bz) || 1;
        const dist = r / Math.sin(delta / 2);
        pair.O = { x: C.x + (bx / bl) * dist, z: C.z + (bz / bl) * dist };
        pair.r = r; pair.mode = 'fillet'; pair.C = C;
        const tA = (pair.O.x - node.x) * A.d.x + (pair.O.z - node.z) * A.d.z;
        const tB = (pair.O.x - node.x) * B.d.x + (pair.O.z - node.z) * B.d.z;
        A.trim = Math.max(A.trim, tA); B.trim = Math.max(B.trim, tB);
      } else {
        pair.mode = 'sharp'; pair.C = C;
        for (const P of [C, Cf]) {
          if (!P) continue;
          A.trim = Math.max(A.trim, Math.min(capA, (P.x - node.x) * A.d.x + (P.z - node.z) * A.d.z));
          B.trim = Math.max(B.trim, Math.min(capB, (P.x - node.x) * B.d.x + (P.z - node.z) * B.d.z));
        }
      }
    } else if (!inner && C) {
      // reflex (outer) corner: mitre point behind the node if it is within reach, else chord
      const reach = 2 * Math.max(A.w + A.sw, B.w + B.sw);
      if (Math.hypot(C.x - node.x, C.z - node.z) <= reach && Cf && Math.hypot(Cf.x - node.x, Cf.z - node.z) <= reach * 1.5) {
        pair.mode = 'sharp'; pair.C = C;
        A.trim = Math.max(A.trim, Math.min(capA, (C.x - node.x) * A.d.x + (C.z - node.z) * A.d.z));
        B.trim = Math.max(B.trim, Math.min(capB, (C.x - node.x) * B.d.x + (C.z - node.z) * B.d.z));
      } else {
        pair.mode = 'chord';
        const taper = 3 + Math.abs(A.w - B.w) + Math.abs(A.sw - B.sw);
        A.trim = Math.max(A.trim, taper); B.trim = Math.max(B.trim, taper);
      }
    } else {
      // parallel lines with different widths: taper
      pair.mode = 'chord';
      const taper = 3 + Math.abs(A.w - B.w) + Math.abs(A.sw - B.sw);
      A.trim = Math.max(A.trim, taper); B.trim = Math.max(B.trim, taper);
    }
    node.pairs.push(pair);
  }
  for (const a of arms) a.trim = Math.max(0, a.trim) + TRIM_PAD;
}

/**
 * 2-arm joint as a circular bend: the centreline leaves arm A at distance T from the node, sweeps an arc of radius R
 * and deflection theta and joins arm B at distance T. Sets node.arc and both trims. False when not applicable
 * (different cross sections, nearly straight, edges too short for the minimum radius).
 */
function tryArc(node) {
  const [A, B] = node.arms;
  if (Math.abs(A.w - B.w) > 0.01 || Math.abs(A.sw - B.sw) > 0.01 || A.frame.spec.curb !== B.frame.spec.curb) return false;
  const dot = clamp(A.d.x * B.d.x + A.d.z * B.d.z, -1, 1);
  const theta = Math.PI - Math.acos(dot); // deflection of travel
  if (theta < 0.008) return false;        // < 0.5 deg: straight
  if (theta > 2.62) return false;         // > 150 deg: hairpin, mitre it
  const spec = A.frame.spec;
  const Rmin = A.w + A.sw + 0.6;
  const Lmin = Math.min(A.frame.L, B.frame.L);
  const tanH = Math.tan(theta / 2);
  const R = Math.min(spec.arcR, (0.42 * Lmin) / tanH);
  if (R < Rmin) return false;
  const T = R * tanH;
  let bx = A.d.x + B.d.x, bz = A.d.z + B.d.z;
  const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
  const dO = R / Math.cos(theta / 2);
  const O = { x: node.x + bx * dO, z: node.z + bz * dO };
  const PA = { x: node.x + A.d.x * T, z: node.z + A.d.z * T };
  const PB = { x: node.x + B.d.x * T, z: node.z + B.d.z * T };
  const a0 = Math.atan2(PA.z - O.z, PA.x - O.x);
  const a1 = Math.atan2(PB.z - O.z, PB.x - O.x);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  // lateral sign: right of travel (travel enters along -A.d) is outward (+1) or inward (-1) of the circle
  const rtx = A.d.z, rtz = -A.d.x; // right of (-A.d)
  const k = (rtx * (PA.x - O.x) + rtz * (PA.z - O.z)) > 0 ? 1 : -1;
  node.arc = { O, R, T, theta, a0, sweep, k };
  A.trim = T; B.trim = T; // no pad: the arc starts exactly where the edge bands end
  node.pairs = [];
  return true;
}

/**
 * Bend profile: a straight ramp from the arm-A end to the arm-B end (each the local terrain max), lifted
 * uniformly so the whole arc clears the rendered terrain. Sets arc.yA / arc.yB.
 */
function arcProfile(node, ground) {
  const c = node.arc;
  const r = node.arms[0].w + node.arms[0].sw;
  const n = Math.max(4, Math.ceil(arcLength(node, 0)));
  const raw = [];
  for (let i = 0; i <= n; i++) {
    let m = -Infinity;
    for (let l = -r; l <= r + 1e-6; l += 1) { const p = arcPoint(node, i / n, l); m = Math.max(m, ground(p.x, p.z)); }
    raw.push(m);
  }
  // end heights: max over the first / last 2 m of the arc (matches the edge profile's +-2 m window)
  const k = Math.max(1, Math.round(2 * n / Math.max(1, arcLength(node, 0))));
  let yA = -Infinity, yB = -Infinity;
  for (let i = 0; i <= k && i <= n; i++) { yA = Math.max(yA, raw[i]); yB = Math.max(yB, raw[n - i]); }
  // ... and the first 2 m of each arm beyond the arc, so the edge profile's end station never dips under a plate
  for (const [arm, which] of [[node.arms[0], 'A'], [node.arms[1], 'B']]) {
    let m = -Infinity;
    for (let t = 0; t <= 2; t += 1) for (let l = -r; l <= r + 1e-6; l += 1) {
      m = Math.max(m, ground(node.x + arm.d.x * (c.T + t) + arm.right.x * l, node.z + arm.d.z * (c.T + t) + arm.right.z * l));
    }
    if (which === 'A') yA = Math.max(yA, m); else yB = Math.max(yB, m);
  }
  let lift = 0;
  for (let i = 0; i <= n; i++) lift = Math.max(lift, raw[i] - (yA + (yB - yA) * (i / n)));
  c.yA = yA + lift; c.yB = yB + lift;
  node.y = Math.max(c.yA, c.yB);
}

/** Bed height on a bend at parameter u. */
export function arcY(node, u) { const c = node.arc; return c.yA + (c.yB - c.yA) * u; }

/** Point on a bend at parameter u in [0,1] (arm A → arm B) and lateral offset lat (right of travel). */
export function arcPoint(node, u, lat) {
  const c = node.arc;
  const ang = c.a0 + c.sweep * u;
  const r = c.R + c.k * lat;
  return { x: c.O.x + Math.cos(ang) * r, z: c.O.z + Math.sin(ang) * r };
}

/** Arc length of a bend at lateral offset lat. */
export function arcLength(node, lat) { const c = node.arc; return Math.abs(c.sweep) * Math.max(0, c.R + c.k * lat); }

/** Lateral offset in bend travel frame (right of travel A→B) for a lateral offset in edge frame f. */
export function arcLatFromEdge(node, f, latEdge) {
  const A = node.arms[0];
  // travel A→B: enters against A.d. For f == A.frame: outward (f.a == node) means travel is backward along f.
  if (f === A.frame) return A.outward ? -latEdge : latEdge;
  const B = node.arms[1];
  return B.outward ? latEdge : -latEdge; // leaving along B.d: outward → forward along f
}

function cornerAt(node, A, B, offA, offB) {
  return lineIntersect(
    node.x + A.right.x * offA, node.z + A.right.z * offA, A.d.x, A.d.z,
    node.x + B.left.x * offB, node.z + B.left.z * offB, B.d.x, B.d.z,
  );
}

/** Point on arm A's side line (side: +1 right, -1 left) at along-distance t and lateral offset off. */
export function armPoint(node, A, t, off, side) {
  const nx = side > 0 ? A.right.x : A.left.x, nz = side > 0 ? A.right.z : A.left.z;
  return { x: node.x + A.d.x * t + nx * off, z: node.z + A.d.z * t + nz * off };
}

/**
 * Interior connector points (exactly ARC_N of them) between R_A(offA) and L_B(offB) for a pair.
 * Never includes the endpoints themselves. Fillets are offset arcs of the carriageway fillet; when the two
 * offsets differ (e.g. 2.4 m sidewalk meeting a 2.0 m verge) the radius is blended along the sweep.
 */
export function connector(node, pair, offA, offB) {
  const A = node.arms[pair.i], B = node.arms[pair.j];
  const start = armPoint(node, A, A.trim, offA, +1);
  const end = armPoint(node, B, B.trim, offB, -1);
  const out = [];
  if (pair.mode === 'fillet') {
    const rhoA = pair.r - (offA - A.w), rhoB = pair.r - (offB - B.w);
    if (rhoA > 0.05 && rhoB > 0.05) {
      const TA = footOnLine(pair.O, node, A, offA, +1);
      const TB = footOnLine(pair.O, node, B, offB, -1);
      const a0 = Math.atan2(TA.z - pair.O.z, TA.x - pair.O.x);
      const a1 = Math.atan2(TB.z - pair.O.z, TB.x - pair.O.x);
      let sweep = a1 - a0;
      while (sweep > Math.PI) sweep -= Math.PI * 2;
      while (sweep < -Math.PI) sweep += Math.PI * 2;
      for (let s = 0; s < ARC_N; s++) {
        const u = s / (ARC_N - 1);
        const ang = a0 + sweep * u;
        const rho = rhoA + (rhoB - rhoA) * u;
        out.push({ x: pair.O.x + Math.cos(ang) * rho, z: pair.O.z + Math.sin(ang) * rho });
      }
      return out;
    }
    const C = cornerAt(node, A, B, offA, offB);
    for (let s = 0; s < ARC_N; s++) out.push(C ? { x: C.x, z: C.z } : lerp2(start, end, (s + 1) / (ARC_N + 1)));
    return out;
  }
  if (pair.mode === 'sharp') {
    const C = cornerAt(node, A, B, offA, offB);
    for (let s = 0; s < ARC_N; s++) out.push(C ? { x: C.x, z: C.z } : lerp2(start, end, (s + 1) / (ARC_N + 1)));
    return out;
  }
  for (let s = 0; s < ARC_N; s++) out.push(lerp2(start, end, (s + 1) / (ARC_N + 1)));
  return out;
}

function lerp2(p, q, u) { return { x: p.x + (q.x - p.x) * u, z: p.z + (q.z - p.z) * u }; }

function footOnLine(O, node, A, off, side) {
  const P = armPoint(node, A, 0, off, side);
  const t = (O.x - P.x) * A.d.x + (O.z - P.z) * A.d.z;
  return { x: P.x + A.d.x * t, z: P.z + A.d.z * t };
}

/** Edge profile: never below the rendered terrain anywhere under the footprint, smoothed, blended into node heights. */
function buildProfile(ground, f) {
  const L = f.L;
  let s0 = Math.min(f.trimA, L * 0.5), s1 = Math.max(L - f.trimB, L * 0.5);
  if (s1 - s0 < 0.5) { s0 = L * 0.5 - 0.25; s1 = L * 0.5 + 0.25; }
  const st = [s0];
  for (let s = Math.ceil(s0 / STATION) * STATION; s < s1 - 0.5; s += STATION) if (s > s0 + 0.5) st.push(s);
  st.push(s1);
  // terrain is stepped plates: max over +-2 m along and ~1 m lateral steps across the whole footprint per station
  const r = f.w + f.sw;
  const nl = Math.max(2, Math.ceil(r));
  const raw = st.map((s) => {
    let m = -Infinity;
    for (let ds = -2; ds <= 2; ds += 1) {
      const cx = f.ax + f.d.x * (s + ds), cz = f.az + f.d.z * (s + ds);
      for (let q = -nl; q <= nl; q++) {
        const l = (q / nl) * r;
        m = Math.max(m, ground(cx + f.right.x * l, cz + f.right.z * l));
      }
    }
    return m;
  });
  const sm = raw.map((_, i) => {
    let sum = 0, n = 0;
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < raw.length) { sum += raw[j]; n++; } }
    return Math.max(sum / n, raw[i]);
  });
  // blend ends into node plates (nodes are never below the terrain either)
  const y0 = sm[0], y1 = sm[sm.length - 1];
  const span = Math.max(1e-3, s1 - s0);
  const ys = sm.map((y, i) => {
    const u = (st[i] - s0) / span;
    const wa = (1 - u) ** 2, wb = u ** 2;
    return Math.max(y, y + wa * (f.ya - y0) + wb * (f.yb - y1));
  });
  ys[0] = f.ya; ys[ys.length - 1] = f.yb;
  f.stations = st; f.ys = ys; f.s0 = s0; f.s1 = s1;
}

/** Profile height (road bed, before surface offset) at along-distance s. Clamped to the trimmed range. */
export function profileAt(f, s) {
  const st = f.stations, ys = f.ys;
  if (!st || st.length === 0) return f.ya;
  if (s <= st[0]) return ys[0];
  if (s >= st[st.length - 1]) return ys[ys.length - 1];
  let lo = 0, hi = st.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (st[mid] <= s) lo = mid; else hi = mid; }
  const u = (s - st[lo]) / Math.max(1e-6, st[hi] - st[lo]);
  return ys[lo] + (ys[hi] - ys[lo]) * u;
}

/** World point on an edge at along-distance s and lateral offset lat (positive = right of A->B). */
export function edgePoint(f, s, lat, dy = 0) {
  return { x: f.ax + f.d.x * s + f.right.x * lat, y: profileAt(f, s) + dy, z: f.az + f.d.z * s + f.right.z * lat };
}

/** Station list restricted to [sa, sb] (inclusive endpoints inserted). */
export function stationsBetween(f, sa, sb) {
  const out = [sa];
  for (const s of f.stations) if (s > sa + 0.05 && s < sb - 0.05) out.push(s);
  if (sb > sa + 1e-3) out.push(sb);
  return out;
}

// ---- lanes ------------------------------------------------------------------------------------

/** Lane centreline for edge f, lane index (0 = rightmost), direction 'forward' (a->b) | 'backward'. */
export function lanePath(f, laneIndex, direction) {
  const fwd = direction !== 'backward' && direction !== -1 && direction !== 'ba';
  const offs = f.spec.laneOffsets;
  const li = Math.min(Math.max(0, laneIndex | 0), offs.length - 1);
  const lat = fwd ? offs[li] : -offs[li];
  const st = f.stations;
  const pts = st.map((s) => edgePoint(f, s, lat, Y.lane));
  return fwd ? pts : pts.reverse();
}

export function lanesPerDirection(f) { return f.spec.laneOffsets.length; }

/** Signed turn angle from incoming travel direction to outgoing arm direction; > 0 = right turn. */
export function turnAngle(inDir, outDir) {
  const cross = inDir.x * outDir.z - inDir.z * outDir.x;
  const dot = inDir.x * outDir.x + inDir.z * outDir.z;
  return Math.atan2(cross, dot);
}

export function classifyTurn(theta) {
  const a = Math.abs(theta);
  if (a < Math.PI / 6) return 'through';
  if (a > Math.PI * 5 / 6) return 'uturn';
  return theta > 0 ? 'right' : 'left';
}

/** Cubic Bezier samples between p0 (tangent t0) and p3 (tangent t3), flat y = yNode + lane offset. */
export function turnCurve(p0, t0, p3, t3, y, n = 8) {
  const dist = Math.hypot(p3.x - p0.x, p3.z - p0.z);
  const k = Math.max(0.5, dist / 3);
  const p1 = { x: p0.x + t0.x * k, z: p0.z + t0.z * k };
  const p2 = { x: p3.x - t3.x * k, z: p3.z - t3.z * k };
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, v = 1 - u;
    const x = v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x;
    const z = v * v * v * p0.z + 3 * v * v * u * p1.z + 3 * v * u * u * p2.z + u * u * u * p3.z;
    out.push({ x: num(x), y: num(y), z: num(z) });
  }
  return out;
}

/** Through path along a bend for a lane at right-of-travel offset lat (travel from arm `fromArm` into the node). */
export function arcLanePath(node, fromArm, lat, y, n = 8) {
  const reverse = fromArm !== node.arms[0];
  const out = [];
  for (let i = 0; i <= n; i++) {
    const u = reverse ? 1 - i / n : i / n;
    const p = arcPoint(node, u, reverse ? -lat : lat);
    out.push({ x: num(p.x), y: num(arcY(node, u) + Y.lane), z: num(p.z) });
  }
  return out;
}
