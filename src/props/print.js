// LOOP cycle 6 (B2): printed minifig faces and torso graphics for the set-piece figures.
//
// One extra instanced role, `sp-print`: a thin patch (curved like the minifig head, flattened per instance for the
// torso front) whose UVs index a small path-drawn CanvasTexture atlas. Every instance carries a tile index in the
// per-instance `aTile` attribute; the material's onBeforeCompile hook shifts the UV into that tile (the same
// pattern as the transit route-letter atlas, re-implemented here so props never imports another module).
//
// Compositing: the instance colour is the surface under the print (skin for a face, the shirt for a torso). The
// atlas is premultiplied-alpha RGBA: where the print is transparent the patch shows the instance colour, where it is
// opaque it shows the ink. The patch uses the same plastic parameters as the head/torso roles and normals that
// follow the head cylinder, so the unprinted parts are indistinguishable from the part underneath.
//
// Everything is drawn with canvas paths (no fillText: font rasterisation differs between machines, which would break
// same-seed captures), with feature sizes chosen to survive mipmapping when a head is 15-25 px tall on screen
// (eyes ~0.045 x 0.065 m, mouth ~0.13 m wide).
import * as THREE from 'three';

/** Half-angle of the head patch around the head cylinder (radians). UV.x is linear in projected x, not in angle, so
 * a face seen from the front is the tile undistorted. */
export const PRINT_THETA = 1.2;
const SIN_T = Math.sin(PRINT_THETA);
/** Head patch: radius just outside the 0.155 m head cylinder, covering y 1.36-1.555 (figure space; the hair/cap
 * crowns start at 1.556, so the patch's top edge is tucked under them). */
export const HEAD_PRINT = { r: 0.1585, y0: 1.36, y1: 1.555 };
/** Torso print: x +-0.15, y 0.765-1.285 (the belt covers 0.715-0.765), on the trapezoid torso's front face. */
export const TORSO_PRINT = { hw: 0.15, y0: 0.765, y1: 1.285 };
export const PRINT_COLS = 8, PRINT_ROWS = 4, PRINT_TILE = 128;
/** c6 fix: transparent gutter (px) around every tile's content, so mip levels never bleed a neighbour's ink. */
const GUTTER = 3;
export const FACE_TILES = 16;      // tiles 0..15
export const TORSO_TILE0 = 16;     // tiles 16..31
/** Torso designs by role (indices relative to TORSO_TILE0). */
export const TORSO_SETS = {
  skate: [0, 2, 6, 7, 9, 12, 13, 1, 10],
  stand: [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 15],
  sit: [0, 1, 2, 4, 5, 8, 9, 12, 13, 15],
  farmer: [3, 8, 14],
  work: [3, 8, 11, 14, 4],
};
/** Designs whose ink is mostly dark/saturated (readable on a white shirt; the white-ink ones vanish on it). */
export const TORSO_ON_WHITE = [3, 5, 7, 8, 10, 12, 14];
/** Face designs (indices); FACE_FEM have lashes/lipstick and pair with long hair. */
export const FACE_PLAIN = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15];
export const FACE_FEM = [6, 12, 3, 11];

/** Patch geometry: x = s * sin(theta) in [-sinT, sinT], z = sqrt(1 - x^2) (a unit-radius cylinder section facing
 * +z), y in [0, 1]; uv = ((s + 1) / 2, y). Scale (r, h, r) for a head, (hw / sinT, h, ~0) for a flat torso panel. */
export function buildPrintGeometry() {
  const NX = 12;
  const pos = [], nrm = [], uv = [], idx = [];
  for (let i = 0; i <= NX; i++) {
    const s = -1 + (2 * i) / NX;
    const x = s * SIN_T, z = Math.sqrt(Math.max(0, 1 - x * x));
    for (let j = 0; j <= 1; j++) {
      pos.push(x, j, z);
      nrm.push(x, 0, z);
      uv.push((s + 1) / 2, j);
    }
  }
  for (let i = 0; i < NX; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Instance transforms in figure space (pre-multiplied by the head / torso matrices in spkinds.js). */
export function headPrintMatrix() {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(0, HEAD_PRINT.y0, 0), new THREE.Quaternion(),
    new THREE.Vector3(HEAD_PRINT.r, HEAD_PRINT.y1 - HEAD_PRINT.y0, HEAD_PRINT.r));
  return m;
}
export function torsoPrintMatrix() {
  // torso front face: z = 0.12 at y 0.72 -> 0.105 at y 1.30 (tilt atan(0.015 / 0.58)); 3 mm proud of it
  const tilt = Math.atan2(0.015, 0.58);
  const z0 = 0.12 - 0.015 * ((TORSO_PRINT.y0 - 0.72) / 0.58) + 0.003;
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(0, TORSO_PRINT.y0, z0), new THREE.Quaternion().setFromEuler(new THREE.Euler(-tilt, 0, 0)),
    new THREE.Vector3(TORSO_PRINT.hw / SIN_T, TORSO_PRINT.y1 - TORSO_PRINT.y0, 0.002));
  return m;
}

// ---- atlas ------------------------------------------------------------------------------------------------------
const INK = '#1C1916';
const WHITE = '#FFFFFF';

function tileOrigin(t) {
  const col = t % PRINT_COLS, row = Math.floor(t / PRINT_COLS);
  return [col * PRINT_TILE, row * PRINT_TILE];
}
/** Map figure-space metres onto the tile: x in [-hw, hw] -> [0, 128], y in [y0, y1] -> [128, 0]. */
function frame(g, t, hw, y0, y1) {
  const [ox, oy] = tileOrigin(t);
  const inner = PRINT_TILE - 2 * GUTTER;
  const sx = inner / (2 * hw), sy = inner / (y1 - y0);
  g.setTransform(sx, 0, 0, -sy, ox + PRINT_TILE / 2, oy + GUTTER + y1 * sy);
  g.beginPath();
  g.rect(-hw, y0, 2 * hw, y1 - y0);
  g.clip();
}
const ell = (g, x, y, rx, ry, c, a = 1) => { g.globalAlpha = a; g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1; };
const poly = (g, pts, c, a = 1) => {
  g.globalAlpha = a; g.fillStyle = c; g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
  g.closePath(); g.fill(); g.globalAlpha = 1;
};
const rect = (g, x0, y0, x1, y1, c, a = 1) => { g.globalAlpha = a; g.fillStyle = c; g.fillRect(x0, y0, x1 - x0, y1 - y0); g.globalAlpha = 1; };
/** Crescent between two quadratic curves from (-w, y) to (w, y): bottom control yb, top control yt. */
function crescent(g, x, y, w, yb, yt, c, a = 1) {
  g.globalAlpha = a; g.fillStyle = c; g.beginPath();
  g.moveTo(x - w, y); g.quadraticCurveTo(x, yb, x + w, y); g.quadraticCurveTo(x, yt, x - w, y);
  g.closePath(); g.fill(); g.globalAlpha = 1;
}
/** Thick polyline (stroked in metres; the transform is anisotropic, so widths are approximate). */
function line(g, pts, w, c, a = 1) {
  g.globalAlpha = a; g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
  g.stroke(); g.globalAlpha = 1;
}

// ---- faces (figure-space metres; eyes at y 1.478, mouth at 1.414) -------------------------------------------------
const EY = 1.478, EX = 0.05, MY = 1.414;
function eyes(g, opt = {}) {
  const rx = opt.rx ?? 0.023, ry = opt.ry ?? 0.035;
  for (const s of [-1, 1]) {
    if (opt.wink && s > 0) { line(g, [[s * EX - 0.024, EY - 0.004], [s * EX, EY + 0.012], [s * EX + 0.024, EY - 0.004]], 0.014, INK); continue; }
    ell(g, s * EX, EY, rx, ry, INK);
    if (opt.shine !== false) ell(g, s * EX + 0.007, EY + 0.012, 0.0075, 0.009, WHITE);
  }
}
function brows(g, tilt = 0, y = EY + 0.058, w = 0.026) {
  for (const s of [-1, 1]) line(g, [[s * EX - w, y + s * tilt * 0.5], [s * EX + w, y - s * tilt * 0.5]], 0.013, INK);
}
function lashes(g) {
  for (const s of [-1, 1]) {
    line(g, [[s * EX + s * 0.016, EY + 0.024], [s * EX + s * 0.036, EY + 0.04]], 0.009, INK);
    line(g, [[s * EX + s * 0.006, EY + 0.03], [s * EX + s * 0.018, EY + 0.05]], 0.009, INK);
  }
}
const smile = (g, w = 0.066, c = INK) => crescent(g, 0, MY + 0.008, w, MY - 0.052, MY - 0.012, c);
function grin(g, tongue = false) {
  // open half-moon mouth: dark, white teeth band across the top
  g.save();
  g.beginPath(); g.moveTo(-0.068, MY + 0.012); g.quadraticCurveTo(0, MY - 0.085, 0.068, MY + 0.012); g.closePath();
  g.fillStyle = INK; g.fill(); g.clip();
  rect(g, -0.08, MY - 0.004, 0.08, MY + 0.02, WHITE);
  if (tongue) ell(g, 0.012, MY - 0.05, 0.03, 0.02, '#D9443C');
  g.restore();
}
const smirk = (g) => crescent(g, 0.012, MY, 0.05, MY - 0.03, MY - 0.004, INK);
const FACES = [
  (g) => { eyes(g); smile(g); },
  (g) => { eyes(g); brows(g); smile(g); },
  (g) => { eyes(g); brows(g, -0.01); grin(g); },
  (g) => { eyes(g, { rx: 0.026, ry: 0.038 }); brows(g); smile(g, 0.06); },
  (g) => { // sunglasses + smirk
    poly(g, [[-0.095, EY + 0.03], [0.095, EY + 0.03], [0.09, EY - 0.008], [0.012, EY - 0.008], [0, EY + 0.006], [-0.012, EY - 0.008], [-0.09, EY - 0.008]], INK);
    ell(g, -0.05, EY - 0.008, 0.042, 0.03, INK); ell(g, 0.05, EY - 0.008, 0.042, 0.03, INK);
    ell(g, -0.036, EY + 0.006, 0.012, 0.007, '#8FA9C4'); ell(g, 0.064, EY + 0.006, 0.012, 0.007, '#8FA9C4');
    smirk(g);
  },
  (g) => { // glasses
    eyes(g, { rx: 0.016, ry: 0.024 });
    for (const s of [-1, 1]) { g.lineWidth = 0.011; g.strokeStyle = INK; g.beginPath(); g.ellipse(s * EX, EY, 0.036, 0.034, 0, 0, Math.PI * 2); g.stroke(); }
    line(g, [[-0.014, EY + 0.008], [0.014, EY + 0.008]], 0.01, INK);
    smile(g, 0.058);
  },
  (g) => { eyes(g); lashes(g); crescent(g, 0, MY + 0.006, 0.056, MY - 0.05, MY - 0.014, '#B8242E'); },
  (g) => { // freckles + grin
    eyes(g); brows(g);
    for (const s of [-1, 1]) for (const [dx, dy] of [[0.07, -0.03], [0.088, -0.022], [0.078, -0.045]]) ell(g, s * dx, EY + dy, 0.0065, 0.0065, '#B5642E');
    grin(g);
  },
  (g) => { // full beard + moustache
    eyes(g); brows(g, 0, EY + 0.055, 0.03);
    g.save(); g.globalAlpha = 1; g.fillStyle = '#5A3A20'; g.beginPath();
    g.moveTo(-0.13, MY + 0.04); g.quadraticCurveTo(-0.12, 1.33, 0, 1.335); g.quadraticCurveTo(0.12, 1.33, 0.13, MY + 0.04);
    g.lineTo(0.07, MY + 0.03); g.quadraticCurveTo(0, MY + 0.06, -0.07, MY + 0.03); g.closePath(); g.fill(); g.restore();
    crescent(g, 0, MY + 0.002, 0.04, MY - 0.03, MY - 0.008, '#E8E2D8');
  },
  (g) => { // moustache
    eyes(g); brows(g);
    poly(g, [[-0.075, MY + 0.008], [-0.03, MY + 0.04], [0, MY + 0.028], [0.03, MY + 0.04], [0.075, MY + 0.008], [0.03, MY + 0.016], [0, MY + 0.008], [-0.03, MY + 0.016]], '#4A2E18');
    smile(g, 0.045);
  },
  (g) => { eyes(g, { rx: 0.019, ry: 0.034 }); brows(g, 0, EY + 0.066); ell(g, 0, MY - 0.016, 0.026, 0.032, INK); ell(g, 0, MY - 0.02, 0.012, 0.016, '#D9443C'); },
  (g) => { eyes(g, { wink: true }); brows(g); smile(g); },
  (g) => { eyes(g); lashes(g); for (const s of [-1, 1]) ell(g, s * 0.085, MY + 0.02, 0.022, 0.014, '#F07C6E', 0.55); smile(g, 0.05, '#B8242E'); },
  (g) => { // stubble + angled brows + smirk
    g.save(); g.globalAlpha = 0.22; g.fillStyle = '#2B2622'; g.beginPath();
    g.moveTo(-0.12, MY + 0.03); g.quadraticCurveTo(-0.1, 1.35, 0, 1.352); g.quadraticCurveTo(0.1, 1.35, 0.12, MY + 0.03); g.closePath(); g.fill(); g.restore();
    eyes(g); brows(g, 0.016); smirk(g);
  },
  (g) => { eyes(g, { rx: 0.025, ry: 0.037 }); brows(g, -0.012); grin(g, true); },
  (g) => { eyes(g); brows(g, 0.02, EY + 0.052); rect(g, -0.05, MY - 0.022, 0.05, MY - 0.006, INK); },
];

// ---- torsos (figure-space metres: x +-0.15, y 0.765-1.285) -------------------------------------------------------
const TY0 = TORSO_PRINT.y0, TY1 = TORSO_PRINT.y1;
function star(g, x, y, r, c) {
  const pts = [];
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? r * 0.45 : r;
    pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
  }
  poly(g, pts, c);
}
function heart(g, x, y, s, c) {
  g.fillStyle = c; g.beginPath();
  g.moveTo(x, y - s);
  g.bezierCurveTo(x - s * 1.6, y - s * 0.1, x - s * 0.9, y + s * 1.1, x, y + s * 0.45);
  g.bezierCurveTo(x + s * 0.9, y + s * 1.1, x + s * 1.6, y - s * 0.1, x, y - s);
  g.closePath(); g.fill();
}
const neck = (g, c = INK, a = 0.35) => crescent(g, 0, TY1 + 0.002, 0.07, TY1 - 0.06, TY1 - 0.02, c, a);
function bib(g, c, dark) {
  rect(g, -0.092, TY0, 0.092, 1.11, c);
  for (const s of [-1, 1]) poly(g, [[s * 0.06, 1.1], [s * 0.092, 1.1], [s * 0.13, TY1], [s * 0.098, TY1]], c);
  rect(g, -0.048, 0.95, 0.048, 1.05, dark);
  for (const s of [-1, 1]) ell(g, s * 0.07, 1.085, 0.014, 0.014, '#F2C230');
}
const TORSOS = [
  (g) => { neck(g); ell(g, 0, 1.04, 0.085, 0.085, WHITE); star(g, 0, 1.04, 0.062, '#D8312B'); },          // 0 logo tee
  (g) => {                                                                                           // 1 open jacket
    poly(g, [[-0.075, TY1], [0.075, TY1], [0.058, TY0], [-0.058, TY0]], WHITE);
    ell(g, 0, 1.06, 0.03, 0.03, '#D8312B');
    for (const s of [-1, 1]) line(g, [[s * 0.072, TY1], [s * 0.056, TY0]], 0.012, INK, 0.45);
    for (const s of [-1, 1]) poly(g, [[s * 0.075, TY1], [s * 0.13, TY1], [s * 0.075, 1.16]], INK, 0.25);
  },
  (g) => {                                                                                           // 2 hoodie
    neck(g, INK, 0.3);
    poly(g, [[-0.105, 0.96], [0.105, 0.96], [0.135, TY0 + 0.01], [-0.135, TY0 + 0.01]], INK, 0.28);
    for (const s of [-1, 1]) line(g, [[s * 0.035, TY1 - 0.02], [s * 0.04, 1.12]], 0.014, WHITE);
    rect(g, -0.06, 1.03, 0.06, 1.085, WHITE, 0.9);
  },
  (g) => { bib(g, '#2F5D9A', '#244A7D'); },                                                          // 3 overalls
  (g) => { neck(g); for (const y of [0.83, 0.95, 1.07, 1.19]) rect(g, -0.16, y, 0.16, y + 0.05, WHITE, 0.92); }, // 4 stripes
  (g) => {                                                                                           // 5 suit + tie
    poly(g, [[-0.08, TY1], [0.08, TY1], [0, 0.98]], WHITE);
    poly(g, [[-0.016, TY1 - 0.012], [0.016, TY1 - 0.012], [0.026, 1.04], [0, 1.0], [-0.026, 1.04]], '#C0262D');
    for (const y of [0.93, 0.85]) ell(g, 0, y, 0.011, 0.011, INK);
    for (const s of [-1, 1]) poly(g, [[s * 0.08, TY1], [s * 0.125, TY1], [s * 0.02, 1.0]], INK, 0.22);
  },
  (g) => {                                                                                           // 6 number seven
    neck(g, WHITE, 0.9);
    poly(g, [[-0.075, 1.19], [0.075, 1.19], [0.075, 1.145], [-0.005, 0.86], [-0.06, 0.86], [0.018, 1.145], [-0.075, 1.145]], WHITE);
  },
  (g) => {                                                                                           // 7 lightning bolt
    neck(g);
    const b = [[0.035, 1.21], [-0.06, 1.02], [-0.004, 1.02], [-0.04, 0.84], [0.07, 1.06], [0.014, 1.06], [0.06, 1.21]];
    poly(g, b, INK); poly(g, b.map(([x, y]) => [x * 0.78, 1.025 + (y - 1.025) * 0.86]), '#FFD21F');
  },
  (g) => {                                                                                           // 8 flannel check
    for (const x of [-0.11, -0.035, 0.04, 0.115]) rect(g, x - 0.016, TY0, x + 0.016, TY1, INK, 0.28);
    for (const y of [0.83, 0.95, 1.07, 1.19]) rect(g, -0.16, y - 0.014, 0.16, y + 0.014, INK, 0.28);
    for (const s of [-1, 1]) rect(g, s * 0.07 - 0.035, 1.12, s * 0.07 + 0.035, 1.15, INK, 0.45);
    for (const s of [-1, 1]) poly(g, [[s * 0.004, TY1], [s * 0.08, TY1], [s * 0.004, 1.2]], WHITE, 0.9);
  },
  (g) => { neck(g); ell(g, 0, 1.04, 0.082, 0.082, WHITE); heart(g, 0, 1.03, 0.042, '#D8312B'); },       // 9 heart
  (g) => {                                                                                           // 10 varsity
    rect(g, -0.06, TY0, 0.06, TY1, '#25282D');
    for (const s of [-1, 1]) rect(g, s * 0.06 - (s > 0 ? 0 : 0.016), TY0, s * 0.06 + (s > 0 ? 0.016 : 0), TY1, WHITE);
    ell(g, -0.105, 1.13, 0.028, 0.028, '#F2C230'); ell(g, -0.105, 1.13, 0.013, 0.013, '#D8312B');
  },
  (g) => {                                                                                           // 11 apron
    rect(g, -0.115, TY0, 0.115, 1.14, WHITE);
    for (const s of [-1, 1]) line(g, [[s * 0.1, 1.135], [s * 0.06, TY1 + 0.01]], 0.014, WHITE);
    rect(g, -0.07, 0.86, 0.07, 0.95, INK, 0.25);
    ell(g, 0.0, 1.06, 0.03, 0.03, '#3E9447');
  },
  (g) => {                                                                                           // 12 sun + waves
    neck(g);
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      poly(g, [[Math.cos(a - 0.2) * 0.05, 1.1 + Math.sin(a - 0.2) * 0.05], [Math.cos(a) * 0.088, 1.1 + Math.sin(a) * 0.088], [Math.cos(a + 0.2) * 0.05, 1.1 + Math.sin(a + 0.2) * 0.05]], '#FFD21F');
    }
    ell(g, 0, 1.1, 0.052, 0.052, '#F28A1E');
    rect(g, -0.16, 0.86, 0.16, 0.93, '#1E8FD6');
    crescent(g, -0.05, 0.93, 0.05, 0.89, 0.9, WHITE); crescent(g, 0.06, 0.93, 0.05, 0.89, 0.9, WHITE);
  },
  (g) => {                                                                                           // 13 track jacket
    rect(g, -0.007, TY0, 0.007, TY1, INK, 0.7);
    for (const s of [-1, 1]) rect(g, s * 0.118 - 0.013, TY0, s * 0.118 + 0.013, TY1, WHITE);
    crescent(g, 0, TY1 + 0.004, 0.07, TY1 - 0.05, TY1 - 0.018, WHITE, 0.95);
  },
  (g) => {                                                                                           // 14 brown dungarees + neckerchief
    bib(g, '#6B4A2B', '#553A20');
    poly(g, [[-0.06, TY1], [0.06, TY1], [0, 1.2]], '#C0262D');
  },
  (g) => {                                                                                           // 15 polo
    for (const s of [-1, 1]) poly(g, [[s * 0.004, TY1], [s * 0.085, TY1], [s * 0.06, 1.225], [s * 0.004, 1.235]], WHITE);
    rect(g, -0.013, 1.15, 0.013, 1.24, INK, 0.3);
    for (const y of [1.215, 1.17]) ell(g, 0, y, 0.008, 0.008, WHITE);
    rect(g, 0.06, 1.13, 0.11, 1.16, '#3E9447');
  },
];

/** Build the atlas texture (null when no canvas is available: the patch then renders as plain instance colour). */
export function makePrintAtlas(renderer) {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = PRINT_COLS * PRINT_TILE; canvas.height = PRINT_ROWS * PRINT_TILE;
    const g = canvas.getContext('2d');
    if (!g) return null;
    g.clearRect(0, 0, canvas.width, canvas.height);
    const R = HEAD_PRINT.r * SIN_T;
    for (let t = 0; t < FACE_TILES; t++) {
      g.save(); frame(g, t, R, HEAD_PRINT.y0, HEAD_PRINT.y1); FACES[t](g); g.restore();
    }
    for (let t = 0; t < TORSOS.length; t++) {
      g.save(); frame(g, TORSO_TILE0 + t, TORSO_PRINT.hw, TORSO_PRINT.y0, TORSO_PRINT.y1); TORSOS[t](g); g.restore();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.premultiplyAlpha = true;           // correct mip averaging of ink over transparent background
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
    tex.needsUpdate = true;
    return tex;
  } catch (_) { return null; }
}

/** Patch a (private, map-carrying) plastic material: sample the atlas at the instance's tile and composite the
 * premultiplied ink over the instance-coloured base. */
export function printMaterial(mat) {
  if (!mat.map) return mat;
  const C = PRINT_COLS.toFixed(1), R = PRINT_ROWS.toFixed(1);
  const G0 = (GUTTER / PRINT_TILE).toFixed(6), GS = (1 - (2 * GUTTER) / PRINT_TILE).toFixed(6);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTile;\nvarying vec2 vTileOff;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
	vTileOff = vec2( mod( aTile, ${C} ), ${R} - 1.0 - floor( aTile / ${C} + 0.001 ) );`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vTileOff;')
      .replace('#include <map_fragment>', `vec4 printInk = vec4( 0.0 );
#ifdef USE_MAP
	printInk = texture2D( map, ( vTileOff + ${G0} + clamp( vMapUv, 0.0, 1.0 ) * ${GS} ) / vec2( ${C}, ${R} ) );
#endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
	diffuseColor.rgb = diffuseColor.rgb * ( 1.0 - printInk.a ) + printInk.rgb;`);
  };
  mat.customProgramCacheKey = () => 'props:sp-print:v2';
  return mat;
}
