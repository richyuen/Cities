import * as THREE from 'three';

// Minimal lighting used ONLY when the `environment` module is not loaded (single-module showcases).
// Tracks the clock's sun so time-of-day screenshots still make sense.
export function installFallbackLights(ctx) {
  const group = new THREE.Group();
  group.name = 'fallback-lights';
  const sun = new THREE.DirectionalLight(0xfff2e0, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 1500;
  const s = 400;
  sun.shadow.camera.left = -s; sun.shadow.camera.right = s; sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
  sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.05;
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a3a, 0.9);
  group.add(sun, sun.target, hemi);
  ctx.scene.add(group);
  ctx.scene.background = new THREE.Color(0x9fc3ea);
  ctx.scene.fog = new THREE.Fog(0xb9d3ee, 600, 3000);

  const pmrem = new THREE.PMREMGenerator(ctx.renderer);
  ctx.scene.environment = pmrem.fromScene(new RoomLikeSky(), 0.04).texture;
  pmrem.dispose();

  const apply = () => {
    const d = ctx.clock.sunDir;
    const el = Math.max(0, d.y);
    sun.position.copy(d).multiplyScalar(600).add(ctx.controls.target);
    sun.target.position.copy(ctx.controls.target);
    sun.intensity = 3.2 * Math.pow(el, 0.5);
    sun.color.setHSL(0.09, 0.6, 0.5 + 0.45 * Math.min(1, el * 2));
    hemi.intensity = 0.25 + 0.75 * el;
    ctx.scene.background.setHSL(0.58, 0.55, 0.15 + 0.55 * el);
    ctx.scene.fog.color.copy(ctx.scene.background).lerp(new THREE.Color(0xffffff), 0.25);
    ctx.renderer.toneMappingExposure = 0.75 + 0.35 * el;
  };
  apply();
  ctx.events.on('time:changed', apply);
  ctx.events.on('camera:changed', apply);
  return group;
}

class RoomLikeSky extends THREE.Scene {
  constructor() {
    super();
    const geo = new THREE.SphereGeometry(50, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 sky = mix(vec3(0.9,0.95,1.0), vec3(0.25,0.5,1.0), pow(max(h,0.0),0.6)); vec3 ground = vec3(0.35,0.3,0.22); vec3 c = h > 0.0 ? sky : mix(vec3(0.6,0.6,0.55), ground, min(1.0,-h*3.0)); gl_FragColor = vec4(c*1.2, 1.0); }`,
    });
    this.add(new THREE.Mesh(geo, mat));
  }
}
