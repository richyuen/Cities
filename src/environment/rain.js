import * as THREE from 'three';

// Rain: one draw call of camera-anchored streak quads. Streak positions live on a fixed world lattice and are
// wrapped into a box around the camera in the vertex shader, so the camera can move freely without popping.

export function createRain(rng, maxCount = 7000) {
  const N = maxCount;
  const offset = new Float32Array(N * 4 * 3);
  const corner = new Float32Array(N * 4 * 2);
  const seed = new Float32Array(N * 4);
  const index = new Uint32Array(N * 6);
  const CORNERS = [[-1, 0], [1, 0], [-1, 1], [1, 1]];
  for (let i = 0; i < N; i++) {
    const ox = rng.float(), oy = rng.float(), oz = rng.float(), s = rng.float();
    for (let k = 0; k < 4; k++) {
      const vi = i * 4 + k;
      offset[vi * 3] = ox; offset[vi * 3 + 1] = oy; offset[vi * 3 + 2] = oz;
      corner[vi * 2] = CORNERS[k][0]; corner[vi * 2 + 1] = CORNERS[k][1];
      seed[vi] = s;
    }
    const b = i * 4;
    index.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(offset, 3)); // used as aOffset; keeps three happy
  geo.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const material = new THREE.ShaderMaterial({
    name: 'Rain',
    uniforms: {
      uCam: { value: new THREE.Vector3() },
      uBox: { value: new THREE.Vector3(56, 40, 56) },
      uFall: { value: new THREE.Vector3(0, -1, 0) },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uTime: { value: 0 },
      uSpeed: { value: 14 },
      uLen: { value: 1.0 },
      uWidth: { value: 0.045 },
      uColor: { value: new THREE.Color(0.6, 0.65, 0.72) },
      uOpacity: { value: 0.35 },
    },
    vertexShader: /* glsl */`
      attribute vec2 aCorner;
      attribute float aSeed;
      uniform vec3 uCam, uBox, uFall, uRight;
      uniform float uTime, uSpeed, uLen, uWidth;
      varying float vFade;
      varying float vDist;
      void main() {
        vec3 travel = uFall * ( uSpeed * uTime * ( 0.8 + 0.4 * aSeed ) );
        vec3 local = position * uBox + travel - uCam + uBox * 0.5;
        vec3 wrapped = local - uBox * floor( local / uBox );
        vec3 world = uCam - uBox * 0.5 + wrapped;
        vDist = length( world - uCam );
        // streaks stay a few pixels wide: width grows with distance, length with fall speed
        float w = uWidth * ( 0.35 + vDist * 0.05 );
        world += uRight * ( aCorner.x * w * 0.5 ) - uFall * ( aCorner.y * uLen * ( 0.6 + 0.8 * aSeed ) );
        vFade = aCorner.y;
        gl_Position = projectionMatrix * viewMatrix * vec4( world, 1.0 );
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform vec3 uBox;
      varying float vFade, vDist;
      void main() {
        float edge = 1.0 - smoothstep( uBox.x * 0.32, uBox.x * 0.5, vDist );
        float near = smoothstep( 0.6, 3.0, vDist );
        float a = ( 1.0 - vFade ) * uOpacity * edge * near;
        gl_FragColor = vec4( uColor, a );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 50;
  mesh.name = 'rain';
  mesh.visible = false;

  const _right = new THREE.Vector3();
  return {
    mesh,
    /** intensity 0..1 → streak count / opacity; wind [x,z] m/s */
    set(intensity, wind, color) {
      const count = Math.round(N * Math.min(1, 0.25 + intensity * 0.75));
      geo.setDrawRange(0, count * 6);
      mesh.visible = intensity > 0.001;
      const u = material.uniforms;
      u.uOpacity.value = 0.22 + 0.25 * intensity;
      // wind lean: ~7 m/s wind against a 9 m/s terminal velocity gives a 25-35 degree slant
      u.uFall.value.set(wind[0] * 0.75, -9, wind[1] * 0.75).normalize();
      u.uSpeed.value = Math.hypot(wind[0] * 0.75, 9, wind[1] * 0.75) * 1.2;
      u.uLen.value = 0.9 + 0.5 * intensity;
      if (color) u.uColor.value.copy(color);
    },
    update(camera, time) {
      const u = material.uniforms;
      u.uTime.value = time;
      u.uCam.value.copy(camera.position);
      _right.setFromMatrixColumn(camera.matrixWorld, 0);
      // streak plane: perpendicular to fall dir and the view, so streaks stay thin lines
      _right.sub(u.uFall.value.clone().multiplyScalar(_right.dot(u.uFall.value))).normalize();
      u.uRight.value.copy(_right);
    },
    dispose() { geo.dispose(); material.dispose(); },
  };
}
