import * as THREE from 'three';

// D2 tornado visuals: a Blox funnel (one instanced column of small boxes), a ground debris ring and a translucent
// dust disc. Three draw calls while a tornado is active, zero when idle (the group is hidden). Everything is
// deterministic: instance layout comes from the module rng fork; per-frame animation is time-based.
//
// The funnel is built as stacked rings (6 boxes at the ground growing to 15 at the top) so the silhouette reads as
// one twisted column: dense where it is narrow, spread where it is wide.

const FUNNEL_RINGS = 20;
const DEBRIS_N = 54;
const HEIGHT = 62;           // funnel top above the ground
const TOP_R = 14;            // top ring radius
const FUNNEL_COLORS = ['darkStoneGrey', 'mediumStoneGrey', 'earthBlue'];

function inst(geo, mat, n) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.frustumCulled = false;
  return m;
}

export function createTornadoVisuals(ctx, rng) {
  const group = new THREE.Group();
  group.name = 'disasters';
  group.visible = false;

  // ---- deterministic layout tables (no rng at runtime) ----
  const funnelTab = [];
  for (let ring = 0; ring < FUNNEL_RINGS; ring++) {
    const t = ring / (FUNNEL_RINGS - 1);
    const count = 6 + Math.round(9 * t);
    for (let k = 0; k < count; k++) {
      funnelTab.push({
        t, frac: (k + rng.range(0, 0.6)) / count,
        phase: rng.range(-0.3, 0.3), speed: rng.range(0.85, 1.15), scale: 0.7 + 1.15 * t,
      });
    }
  }
  const debrisTab = [];
  for (let i = 0; i < DEBRIS_N; i++) {
    const t = i / (DEBRIS_N - 1);
    debrisTab.push({ t, phase: rng.range(0, Math.PI * 2), speed: rng.range(0.8, 1.5), r: 7 + t * 18, y: rng.range(0.4, 6.5), scale: rng.range(0.6, 1.4) });
  }

  // ---- meshes ----
  // a faint self-lit tint keeps the column readable at night (there is no per-tornado light source)
  const mats = FUNNEL_COLORS.map((c) => ctx.materials.plastic(c, { roughness: 0.75, clearcoat: 0.05, emissive: 'earthBlue', emissiveIntensity: 0.22 }));
  const funnelGeo = new THREE.BoxGeometry(1.6, 1.6, 1.6);
  const funnel = inst(funnelGeo, mats[0], funnelTab.length);
  funnel.name = 'tornado:funnel';
  group.add(funnel);

  const debrisGeo = new THREE.BoxGeometry(0.9, 0.9, 0.9);
  const debris = inst(debrisGeo, mats[1], DEBRIS_N);
  debris.name = 'tornado:debris';
  group.add(debris);

  const dustMat = ctx.materials.plastic('mediumStoneGrey', { roughness: 0.9, clearcoat: 0.05 }).clone();
  dustMat.transparent = true;
  dustMat.opacity = 0.18;
  dustMat.depthWrite = false;
  const dust = new THREE.Mesh(new THREE.CircleGeometry(40, 26), dustMat);
  dust.rotation.x = -Math.PI / 2;
  dust.position.y = 0.45;
  dust.name = 'tornado:dust';
  dust.frustumCulled = false;
  group.add(dust);

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const _e = new THREE.Euler();

  /** Place the group at a tornado and lay out its instances. `strength` 0..1 fades/shrinks the effect. */
  function update(t, time, groundY) {
    group.position.set(t.x, groundY, t.z);
    const st = Math.max(0.001, Math.min(1, t.strength));
    group.visible = st > 0.01;
    if (!group.visible) return;
    const spin = time * 2.6;
    for (let i = 0; i < funnelTab.length; i++) {
      const f = funnelTab[i];
      const tt = f.t;
      const r = (1.8 + tt * tt * TOP_R) * (0.65 + 0.35 * st);
      const a = f.frac * Math.PI * 2 + spin * f.speed - tt * 9 + f.phase;
      _p.set(Math.cos(a) * r, 1.0 + tt * HEIGHT * st, Math.sin(a) * r);
      _e.set(0, a, tt * 0.6 + f.phase);
      _q.setFromEuler(_e);
      _s.setScalar(f.scale * (0.6 + 0.4 * st));
      funnel.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    funnel.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < DEBRIS_N; i++) {
      const d = debrisTab[i];
      const a = spin * 2.4 * d.speed + d.phase;
      _p.set(Math.cos(a) * d.r * (0.5 + 0.5 * st), d.y * st + 0.6, Math.sin(a) * d.r * (0.5 + 0.5 * st));
      _e.set(a * 2.2, a, a * 1.7);
      _q.setFromEuler(_e);
      _s.setScalar(d.scale * st);
      debris.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    debris.instanceMatrix.needsUpdate = true;
    dust.scale.setScalar(0.6 + 0.4 * st);
    dust.material.opacity = 0.14 + 0.20 * st;
  }

  function dispose() {
    group.remove(funnel, debris, dust);
    funnelGeo.dispose(); debrisGeo.dispose(); dust.geometry.dispose();
    dustMat.dispose();
  }

  return { group, update, dispose };
}
