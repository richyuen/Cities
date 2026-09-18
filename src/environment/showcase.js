import * as THREE from 'three';

// Lego lighting test scene: 200 m studded baseplate, ~30 stacks of beveled bricks, one glass brick, a tall tower.
// Exists only so the environment module's lighting can be judged; deterministic via the module's rng fork.

const PITCH = 0.8, BRICK_H = 0.96, PLATE_T = 0.5;
const FOOTPRINTS = [[2, 2], [2, 4], [4, 2], [4, 4], [2, 6], [6, 2]];
const COLOURS = ['brightRed', 'brightBlue', 'brightYellow', 'brightGreen', 'white', 'brightOrange', 'mediumAzur', 'lime',
  'darkAzur', 'mediumLilac', 'brightPink', 'darkRed', 'tan', 'reddishBrown', 'sandGreen', 'darkStoneGrey', 'lightStoneGrey', 'brightPurple'];

function smoothstepJS(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Ridged noise: peaky/undulating almost everywhere instead of settling into wide flat basins (which is what a
 * plain fbm bump field tends to do — most of its range sits near the mean, so it still reads as a flat plain with
 * occasional bumps). 1 - |fbm| puts a ridge wherever the underlying noise crosses zero, so relief keeps showing up
 * across the whole surface rather than leaving big flat stretches for the fog to flatten into a uniform "sea". */
function ridge(t) { const r = 1 - Math.abs(t); return r * r; }

/** Low-frequency, angle-only wobble (no radius, no world position — just the point's azimuth around the origin),
 * used to perturb the radius used by the near (plate-safe) falloff only. Sampling 2D noise on a small circle in
 * noise-space (cos/sin of the angle) gives a value that's continuous and periodic in angle with no seam at the
 * 0/2π wrap. Kept small/tightly bounded because this boundary must stay outside the baseplate footprint. */
function angularJitter(n, x, z, amplitude, freq) {
  const a = Math.atan2(z, x);
  return n.fbm(Math.cos(a) * freq + 300.7, Math.sin(a) * freq - 150.2, 3) * amplitude;
}

/** Island-falloff height field: height(x,z) = fbm(x,z) * falloff(distance). The relief noise itself is sampled in
 * plain Cartesian world (x, z) — never as a function of radius/distance-from-centre. Radius is used only as a
 * falloff WEIGHT, split into two independent falloffs so each can be perturbed as much as it safely can be:
 *  - the near "ramp" (flat under the plate -> full relief) must stay outside the baseplate footprint in every
 *    direction, so it only gets a small angular jitter (~tens of metres) on top of the true radius.
 *  - the far "amplitude" falloff (how tall the rolling hills get) has no baseplate to avoid, so instead of jittering
 *    the radius a little, the (x, z) used to MEASURE that distance is domain-warped by a broad low-frequency
 *    Cartesian noise field first — a large warp (hundreds of metres, a good fraction of the falloff's own width)
 *    is what actually turns "smooth circle with a wobble" into "irregular blob", which a small radius jitter alone
 *    does not (verified: a ±30m jitter on an ~800m-wide falloff still reads as a near-perfect circle from directly
 *    above — see r4-custom/aerial-topdown-1000m.png before this warp was added).
 */
function makeTerrainHeight(rng) {
  const n = rng.fork ? rng.fork('terrain') : rng;
  return (x, z) => {
    const r = Math.hypot(x, z);

    // micro-texture: a few centimetres to ~0.3m of short-wavelength noise, active even inside the flat safety
    // skirt around the plate (where `ramp` below is 0). A mathematically dead-flat surface is what actually reads
    // as "solid sea" at a grazing angle under fog — even before the real relief starts, the ground needs *some*
    // normal variation to catch light and read as textured ground rather than water. Amplitude is small enough
    // (well under the 0.4m the ground mesh is offset below the plate) to never visibly poke through the baseplate.
    const micro = ridge(n.fbm(x / 22 + 9.4, z / 22 - 14.1, 2)) * 0.28;

    // near falloff: starts just past the plate's own corner radius (~141m) and reaches full within 100m — steep
    // enough that a grazing ray doesn't sit in a long, near-flat near zone (r3's "sea" symptom) before hitting real
    // relief. This ring is the closest, tightest falloff to the camera in almost every framing, so it needs the
    // strongest jitter of the three falloffs to not read as a circle — up to ~45m is still safe: the worst case
    // (jitter fully negative at the plate's diagonal corner, r=141m) gives an effective radius of ~96m, well under
    // the 160m ramp start, so the plate footprint never gets touched even in the worst case.
    const nearJitter = angularJitter(n, x, z, 30, 1.7) + angularJitter(n, x, z, 15, 4.6);
    const ramp = smoothstepJS(160, 260, r + nearJitter);
    if (ramp <= 0) return micro;

    // far falloff: domain-warp the distance measurement itself with broad Cartesian noise (not the relief noise,
    // a separate low-frequency field) so the "how tall do hills get with distance" gradient is a lumpy blob, not
    // a dial centred on the origin.
    const warpFreq = 1 / 850;
    const wx = n.fbm(x * warpFreq + 512.3, z * warpFreq - 271.1, 3) * 260;
    const wz = n.fbm(x * warpFreq - 188.4, z * warpFreq + 664.9, 3) * 260;
    const farR = Math.hypot(x + wx, z + wz);
    const farRamp = smoothstepJS(280, 1050, farR); // 0..1 gate: "is relief allowed to reach full height here"

    // regional mask: a second, independent ridged Cartesian field (~480m wavelength — short enough that several
    // ups/downs fall inside a single 1000m-pullback view) that actually drives how tall the far hills get. A
    // falloff whose amplitude only grows with distance still reads as "walled in on all sides" no matter how much
    // its boundary is warped, because *every* direction eventually reaches the same max height — real variation
    // needs some directions to stay low far past the near zone (gaps, low saddles, a horizon that isn't a uniform
    // rim) while others rise into real peaks. ridge() is used here (not raw fbm) because its distribution is mostly
    // low/moderate with occasional sharp peaks, which is what produces peaks-with-gaps instead of a smooth bulge.
    const regional = ridge(n.fbm(x / 480 + 77.4, z / 480 - 133.8, 4));
    const amp = 25 + 145 * farRamp * regional; // ~25m near the transition; up to ~170m only where the mask peaks

    const near = ridge(n.fbm(x / 110 + 41.7, z / 110 - 19.3, 4));   // close-in rolling, ~110m wavelength
    const far = ridge(n.fbm(x / 420 + 8.2, z / 420 + 71.4, 3));      // broader swells further out
    return micro * (1 - ramp) + (near * 0.65 + far * 0.35) * amp * ramp;
  };
}

/** Graded Cartesian terrain grid: vertices sit on a regular (x, z) lattice — never on concentric rings — so the
 * mesh topology itself carries no radial symmetry (r3/early-r4's visible ring-banding came partly from the height
 * envelope and partly from the polar ring+segment mesh construction itself, which is circular no matter what height
 * values are written into it). Each axis is graded independently (dense near 0, coarse toward ±extent) via the same
 * power curve, which concentrates geometry in the near-to-mid relief zone without implying any rotational symmetry
 * (a graded Cartesian grid is only mirror/90°-symmetric, not circular). Winding: for corner order
 * a=(ix,iz) b=(ix+1,iz) c=(ix,iz+1) d=(ix+1,iz+1), triangles (a,c,b) and (b,c,d) face +Y (verified by hand via the
 * edge cross product — required since this isn't three.js's own PlaneGeometry winding). */
function buildTerrainGeometry(extent, n, power, heightFn) {
  const half = (n - 1) / 2;
  const axis = new Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i - half) / half; // -1..1
    axis[i] = Math.sign(t) * Math.pow(Math.abs(t), power) * extent;
  }
  const pos = new Float32Array(n * n * 3);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = axis[ix], z = axis[iz];
      const k = (iz * n + ix) * 3;
      pos[k] = x; pos[k + 1] = heightFn(x, z); pos[k + 2] = z;
    }
  }
  const idx = [];
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const a = iz * n + ix, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function buildShowcase(ctx, rng) {
  const M = ctx.materials;
  const group = new THREE.Group();
  group.name = 'environment-showcase';

  // horizon: one continuous 3 km rolling-terrain grid (stud-less, darker green) so fog / aerial perspective and
  // the sky-ground join can be judged. A graded Cartesian (x, z) lattice, not concentric rings — see
  // buildTerrainGeometry — so the mesh itself has no radial symmetry to show through as ring-banding. Flat under/
  // near the baseplate, then rises into rolling terrain within ~100m past the plate edge (not just at the rim) as
  // one unbroken surface (no separate flat-plate/hill-ring seam), with an island-style falloff (see
  // makeTerrainHeight) so it reads as irregular natural terrain rather than a circular crater from above.
  const terrainHeight = makeTerrainHeight(rng);
  const groundGeo = buildTerrainGeometry(1500, 161, 1.5, (x, z) => -0.4 + terrainHeight(x, z));
  const ground = new THREE.Mesh(groundGeo, M.plastic('darkGreen', { roughness: 0.85, clearcoat: 0.0 }));
  ground.receiveShadow = true;
  ground.castShadow = false;
  ground.name = 'ground';
  group.add(ground);

  // baseplate
  const plate = new THREE.Mesh(M.bevelBox(200, PLATE_T, 200, 0.05), M.plastic('brightGreen'));
  plate.receiveShadow = true;
  plate.castShadow = false;
  plate.name = 'baseplate';
  group.add(plate);

  const studs = M.studs({ maxCount: 80000 });
  studs.addRect(-100, -100, 100, 100, PLATE_T, 'brightGreen');

  // brick stacks: integer stud coords (i, j) of the min corner; bricks align to the plate stud grid.
  const stacks = [];
  const occupied = new Set();
  const key = (i, j) => `${i},${j}`;
  const claim = (i, j, w, d) => {
    for (let a = i - 1; a <= i + w; a++) for (let b = j - 1; b <= j + d; b++) if (occupied.has(key(a, b))) return false;
    for (let a = i; a < i + w; a++) for (let b = j; b < j + d; b++) occupied.add(key(a, b));
    return true;
  };
  const addStack = (i, j, w, d, levels) => { if (claim(i, j, w, d)) stacks.push({ i, j, w, d, levels }); };

  // tower (6x6 studs, 30 bricks = 28.8 m) west of centre so its shadow sweeps the plate at golden hour
  const towerCols = ['white', 'brightRed', 'brightBlue', 'white', 'brightYellow'];
  addStack(-24, -18, 6, 6, Array.from({ length: 30 }, (_, k) => towerCols[k % towerCols.length]));
  // a second, shorter tower
  addStack(14, -30, 4, 4, Array.from({ length: 16 }, (_, k) => (k % 4 === 3 ? 'darkStoneGrey' : 'lightStoneGrey')));

  let attempts = 0;
  while (stacks.length < 32 && attempts++ < 400) {
    const [w, d] = rng.pick(FOOTPRINTS);
    const i = rng.int(-42, 42), j = rng.int(-42, 42);
    if (Math.abs(i) < 3 && Math.abs(j) < 3) continue;
    const n = rng.chance(0.25) ? rng.int(4, 8) : rng.int(1, 3);
    const base = rng.pick(COLOURS);
    const levels = [];
    for (let k = 0; k < n; k++) levels.push(rng.chance(0.3) ? rng.pick(COLOURS) : base);
    addStack(i, j, w, d, levels);
  }

  // instanced bricks per footprint
  const perFoot = new Map();
  for (const s of stacks) {
    const k = `${s.w}x${s.d}`;
    if (!perFoot.has(k)) perFoot.set(k, { w: s.w, d: s.d, items: [] });
    const list = perFoot.get(k).items;
    for (let l = 0; l < s.levels.length; l++) list.push({ x: (s.i + s.w / 2) * PITCH, z: (s.j + s.d / 2) * PITCH, y: PLATE_T + l * BRICK_H, c: s.levels[l] });
  }
  const mat = M.plastic('white', { instanceColor: true });
  const m4 = new THREE.Matrix4();
  for (const { w, d, items } of perFoot.values()) {
    const geo = M.bevelBox(w * PITCH, BRICK_H, d * PITCH, 0.06);
    const inst = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((it, idx) => {
      m4.makeTranslation(it.x, it.y, it.z);
      inst.setMatrixAt(idx, m4);
      inst.setColorAt(idx, M.color(it.c));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = true;
    inst.receiveShadow = true;
    inst.name = `bricks-${w}x${d}`;
    group.add(inst);
  }
  // studs on top of every stack
  for (const s of stacks) {
    const top = PLATE_T + s.levels.length * BRICK_H;
    const c = s.levels[s.levels.length - 1];
    for (let a = 0; a < s.w; a++) for (let b = 0; b < s.d; b++) studs.add((s.i + a + 0.5) * PITCH, top, (s.j + b + 0.5) * PITCH, c);
  }

  // glass brick (2x4) near the closeup camera
  const gi = 6, gj = 8;
  claim(gi, gj, 4, 2);
  const glass = new THREE.Mesh(M.bevelBox(4 * PITCH, BRICK_H, 2 * PITCH, 0.06), M.glass('transClear'));
  glass.position.set((gi + 2) * PITCH, PLATE_T, (gj + 1) * PITCH);
  glass.castShadow = false;
  glass.receiveShadow = false;
  glass.name = 'glassBrick';
  group.add(glass);

  studs.commit(group);
  group.userData.studs = studs;
  return group;
}

export function disposeShowcase(group) {
  if (!group) return;
  group.userData.studs?.clear();
  group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); else if (o.isMesh && o.name === 'ground') o.geometry.dispose(); });
  group.parent?.remove(group);
}
