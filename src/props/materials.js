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
};

const INSTANCE_COLOR_ROLES = new Set(['hedge-block', 'sign-face', 'tree-leaves', 'flowerbed-base', 'flowerbed-flower']);
// Foliage roles get a matte, low-clearcoat, flat-shaded material tuned specifically so leaf/hedge clusters
// read as Blox foliage rather than the shared glossy-plastic look used by hardware roles (sign-face etc.).
const FOLIAGE_INSTANCE_ROLES = new Set(['tree-leaves', 'hedge-block']);

// role -> { name, dayIntensity, nightIntensity } for the dynamic emissive roles we animate ourselves.
const EMISSIVE_ROLES = {
  'lamp-bulb': { color: 'brickYellow', day: 0.05, night: 3.4 },
  'trafficlight-lens-red': { color: 'brightRed', day: 1.0, night: 4.5 },
  'trafficlight-lens-yellow': { color: 'brightYellow', day: 0.7, night: 3.0 },
  'trafficlight-lens-green': { color: 'brightGreen', day: 0.8, night: 3.5 },
};
const LENS_OFF_INTENSITY = 0.12;

export function buildRoleMaterials(ctx) {
  const M = ctx.materials;
  const roles = new Map();

  for (const [role, color] of Object.entries(STATIC_ROLE_COLOR)) {
    roles.set(role, { material: M.plastic(color), instanceColor: false, castShadow: true, receiveShadow: true });
  }
  for (const role of INSTANCE_COLOR_ROLES) {
    const foliage = FOLIAGE_INSTANCE_ROLES.has(role);
    const material = foliage
      ? M.plastic('white', { instanceColor: true, roughness: 0.88, clearcoat: 0.04, clearcoatRoughness: 0.7 })
      : M.plastic('white', { instanceColor: true, roughness: 0.4, clearcoat: 0.5 });
    if (foliage && !material.flatShading) { material.flatShading = true; material.needsUpdate = true; }
    roles.set(role, { material, instanceColor: true, castShadow: true, receiveShadow: true });
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
  roles.set('busstop-panel', { material: M.glass('mediumAzur', { roughness: 0.12, opacity: 0.42, transmission: 0.5 }), instanceColor: false, castShadow: false, receiveShadow: true });

  return { roles, EMISSIVE_ROLES, LENS_OFF_INTENSITY };
}
