// Role -> material table. Opaque/instance-coloured roles use the shared cached `ctx.materials.plastic()`
// (safe to share globally). Emissive roles that this module animates over time (lamp bulbs, traffic lenses)
// are cloned once so mutating their emissiveIntensity never touches another module's cached material.

const STATIC_ROLE_COLOR = {
  'lamp-pole': 'darkStoneGrey', 'lamp-head': 'lightStoneGrey',
  'bench-frame': 'darkStoneGrey', 'parkbench-frame': 'darkGreen', 'bench-planks': 'reddishBrown',
  'hydrant-body': 'brightRed', 'hydrant-trim': 'darkStoneGrey',
  'bin-body': 'mediumStoneGrey', 'bin-lid': 'darkStoneGrey',
  'busstop-frame': 'lightStoneGrey', 'busstop-roof': 'brightBlue',
  'busstop-seat': 'reddishBrown',
  'trafficlight-body': 'black',
  'sign-post': 'darkStoneGrey',
  'fountain-base': 'mediumStoneGrey',
  'tree-trunk': 'reddishBrown',
  // C2 detail layer: the fixed-colour hardware halves of the new dressing kinds.
  'laundry-frame': 'lightStoneGrey',
  'bike-wheels': 'black',
};

// One shared instance-coloured material per family (see buildRoleMaterials); never one per object.
const INSTANCE_COLOR_ROLES = new Set([
  'hedge-block', 'sign-face', 'tree-leaves', 'tree-top', 'flowerbed-base', 'flowerbed-flower',
  // C2 detail layer.
  'fence-picket', 'garden-soil', 'garden-crop', 'laundry-cloth', 'picnic-table',
  'crate-stack', 'crate-single', 'bike-frame', 'figure-legs', 'figure-torso', 'figure-head',
  // LOOP cycle 5 set-pieces: generic per-instance-coloured shapes (they share the C2 plastic material).
  'sp-box', 'sp-brick', 'sp-tile', 'sp-stud', 'sp-cyl', 'sp-oct', 'sp-wedge', 'sp-qpipe', 'sp-cap', 'sp-hat',
  'sp-leaf', 'sp-wheat', 'sp-corn',
  // fix round 1: minifig parts for set-piece figures
  'sp-legs', 'sp-legsit', 'sp-torso', 'sp-arm', 'sp-head', 'sp-hair',
]);
// Foliage roles get a matte, low-clearcoat material tuned specifically so leaf/hedge clusters read as Blox
// foliage rather than the shared glossy-plastic look used by hardware roles (sign-face etc.). Only the hedge
// keeps flat shading - its lumps are low-poly bevel boxes whose facets read as a clipped bush; the tree canopy
// is a stack of smooth molded plates, so it shades smooth like the ABS it is meant to be.
// (The set-piece plants sp-leaf/sp-wheat/sp-corn deliberately use the glossy plastic: the references' crops and
// big-leaf plants are shiny ABS with specular highlights; the matte foliage read them as brown felt.)
const FOLIAGE_INSTANCE_ROLES = new Set(['tree-leaves', 'hedge-block', 'tree-top', 'garden-crop']);
// Set-piece roles that only receive shadows: the deck tile layer and the loose studs are flush, millimetre-scale
// relief; skipping their shadow-pass draws saves 2 x cascades of scene draws for no visible change.
// Fix round 1: crops and small plants receive shadows but do not cast them - the dense wheat/corn rows shadowed
// themselves into dark rust fuzz, and their shadow-pass triangles were most of the set-pieces' scene cost.
const NO_CAST_ROLES = new Set(['sp-tile', 'sp-stud', 'sp-wheat', 'sp-corn', 'sp-leaf']);

// role -> { name, dayIntensity, nightIntensity } for the dynamic emissive roles we animate ourselves.
const EMISSIVE_ROLES = {
  'lamp-bulb': { color: 'brickYellow', day: 0.05, night: 3.4 },
  'trafficlight-lens-red': { color: 'brightRed', day: 1.0, night: 4.5 },
  'trafficlight-lens-yellow': { color: 'brightYellow', day: 0.7, night: 3.0 },
  'trafficlight-lens-green': { color: 'brightGreen', day: 0.8, night: 3.5 },
};

export function buildRoleMaterials(ctx) {
  const M = ctx.materials;
  const roles = new Map();

  for (const [role, color] of Object.entries(STATIC_ROLE_COLOR)) {
    roles.set(role, { material: M.plastic(color), instanceColor: false, castShadow: true, receiveShadow: true });
  }
  for (const role of INSTANCE_COLOR_ROLES) {
    const foliage = FOLIAGE_INSTANCE_ROLES.has(role);
    // Distinct opt sets per family: `plastic()` caches by opts, so the hedge's flat-shaded material can never
    // leak its flatShading onto the smooth tree-canopy material (or vice versa).
    const material = role === 'hedge-block'
      ? M.plastic('white', { instanceColor: true, roughness: 0.92, clearcoat: 0.03, clearcoatRoughness: 0.75 })
      : foliage
        ? M.plastic('white', { instanceColor: true, roughness: 0.88, clearcoat: 0.04, clearcoatRoughness: 0.7 })
        : M.plastic('white', { instanceColor: true, roughness: 0.4, clearcoat: 0.5 });
    if (role === 'hedge-block' && !material.flatShading) { material.flatShading = true; material.needsUpdate = true; }
    roles.set(role, { material, instanceColor: true, castShadow: !NO_CAST_ROLES.has(role), receiveShadow: true });
  }
  for (const [role, spec] of Object.entries(EMISSIVE_ROLES)) {
    const mat = M.plastic(spec.color, { emissive: spec.color, emissiveIntensity: spec.day, roughness: 0.3, clearcoat: 0.4 }).clone();
    mat.name = `props:${role}`;
    M.cache.set(`props:${role}`, mat);
    roles.set(role, {
      material: mat, instanceColor: false, castShadow: false, receiveShadow: false, dynamic: spec,
    });
  }
  roles.set('fountain-bowl', { material: M.glass('mediumAzur', { roughness: 0.1, opacity: 0.75 }), instanceColor: false, castShadow: false, receiveShadow: true });
  // Bus-stop back/side wall is real transmissive plastic (a glazed shelter panel), not opaque plastic.
  // Fix round 1: wheat gets its own warm, low-clearcoat plastic. The shared clearcoat reflected the sky over the
  // dense grain heads and AO darkened the gaps, so golden input colours read as khaki/rust at hero distance; a
  // small warm emissive floor keeps the field golden at both noon and 17.5.
  roles.set('sp-wheat', {
    material: M.plastic('white', { instanceColor: true, roughness: 0.55, clearcoat: 0.08, clearcoatRoughness: 0.5, emissive: '#8A5200', emissiveIntensity: 0.55 }),
    instanceColor: true, castShadow: false, receiveShadow: true,
  });
  // LOOP cycle 5 set-pieces: pond/trough water (the fountain's shared glass) and dark window glazing.
  roles.set('sp-water', { material: M.glass('mediumAzur', { roughness: 0.1, opacity: 0.75 }), instanceColor: false, castShadow: false, receiveShadow: true });
  roles.set('sp-glass', { material: M.glass('#35556E', { roughness: 0.08, opacity: 0.78 }), instanceColor: false, castShadow: false, receiveShadow: true });
  roles.set('busstop-panel', { material: M.glass('mediumAzur', { roughness: 0.12, opacity: 0.42, transmission: 0.5 }), instanceColor: false, castShadow: false, receiveShadow: true });

  return { roles, EMISSIVE_ROLES };
}
