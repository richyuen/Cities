import * as THREE from 'three';

import { MILKY_WAY_NORMAL } from './sky.js';

// Procedural star field (Points, one draw call), centred on the camera every frame and rendered at infinite depth
// just in front of the sky dome. Milky Way stars cluster on the same great circle the dome paints.

export function createStars(rng, count = 3200) {
  const pos = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const bright = new Float32Array(count);
  const tint = new Float32Array(count);
  const phase = new Float32Array(count);
  const R = 3800;
  const n = MILKY_WAY_NORMAL;
  const u = new THREE.Vector3(1, 0, 0).cross(n).normalize();
  const v = new THREE.Vector3().crossVectors(n, u);
  const d = new THREE.Vector3();
  let i = 0;
  while (i < count) {
    if (rng.chance(0.45)) {
      // Milky Way band: point on the great circle plus a small gaussian offset along the normal
      const a = rng.float() * Math.PI * 2;
      const off = rng.gaussian(0, 0.11);
      d.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a)).addScaledVector(n, off).normalize();
    } else {
      const y = rng.range(-1, 1), a = rng.float() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      d.set(r * Math.cos(a), y, r * Math.sin(a));
    }
    if (d.y < -0.08) continue;
    pos[i * 3] = d.x * R; pos[i * 3 + 1] = d.y * R; pos[i * 3 + 2] = d.z * R;
    const mag = rng.float();
    size[i] = 1.1 + Math.pow(mag, 6) * 2.6;
    bright[i] = 0.28 + Math.pow(mag, 3) * 2.4;
    tint[i] = rng.float();
    phase[i] = rng.float() * Math.PI * 2;
    i++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aBright', new THREE.BufferAttribute(bright, 1));
  geo.setAttribute('aTint', new THREE.BufferAttribute(tint, 1));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  const material = new THREE.ShaderMaterial({
    name: 'Stars',
    uniforms: { uNight: { value: 0 }, uScale: { value: 1 }, uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aSize, aBright, aTint, aPhase;
      uniform float uTime, uPixelRatio;
      varying float vBright, vTint;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * viewMatrix * wp;
        gl_Position.z = gl_Position.w * 0.99999;
        float tw = 0.78 + 0.22 * sin( uTime * 2.1 + aPhase );
        vBright = aBright * tw;
        vTint = aTint;
        gl_PointSize = aSize * uPixelRatio;
      }`,
    fragmentShader: /* glsl */`
      uniform float uNight, uScale;
      varying float vBright, vTint;
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r2 = dot( c, c );
        if ( r2 > 1.0 ) discard;
        float a = pow( 1.0 - r2, 1.6 );
        vec3 col = mix( vec3( 0.72, 0.84, 1.0 ), vec3( 1.0, 0.92, 0.78 ), vTint );
        gl_FragColor = vec4( col * a * vBright * uNight * uScale, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const points = new THREE.Points(geo, material);
  points.frustumCulled = false;
  points.renderOrder = -19;
  points.name = 'stars';
  return points;
}
