// Custom finishing shader: AO multiply (from GTAOPass, with a contrast curve), subtle vignette, very subtle
// radial chromatic aberration, and a small filmic "lift" for night. Runs in linear HDR space BEFORE bloom and
// the OutputPass (ACES + sRGB), which is the single tone-mapping step for everything including the sky.
export const GradeShader = {
  name: 'BloxGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    tAO: { value: null },
    aoIntensity: { value: 0.0 },
    aoPower: { value: 2.0 },
    vignetteAmount: { value: 0.22 },
    caAmount: { value: 0.0025 },
    nightLift: { value: 0.0 },
    resolution: { value: null }, // Vector2, set by the module
    debugAO: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tAO;
    uniform float aoIntensity;
    uniform float aoPower;
    uniform float vignetteAmount;
    uniform float caAmount;
    uniform float nightLift;
    uniform vec2 resolution;
    uniform float debugAO;
    varying vec2 vUv;

    void main() {
      vec2 d = vUv - 0.5;
      float aspect = resolution.x / max(resolution.y, 1.0);
      vec2 dn = vec2(d.x * aspect, d.y);
      float r2 = dot(dn, dn);                 // 0 at centre, ~1.04 in the far corners at 16:9

      // Chromatic aberration: lens-like, grows with r^2, only noticeable near the frame edge.
      vec2 off = d * r2 * caAmount;
      vec4 c = texture2D(tDiffuse, vUv);
      float r = texture2D(tDiffuse, vUv + off).r;
      float b = texture2D(tDiffuse, vUv - off).b;
      vec3 col = vec3(r, c.g, b);

      // Ambient occlusion (1 = unoccluded). GTAO's raw term is soft; the power curve pushes creases, stud bases
      // and brick contacts toward black while leaving open, flat plastic untouched. Multiplied in HDR before
      // bloom so glowing windows still bloom.
      float ao = pow(clamp(texture2D(tAO, vUv).r, 0.0, 1.0), aoPower);
      ao = mix(1.0, ao, aoIntensity);
      col *= ao;

      // Vignette: gentle, starts well outside the centre.
      float vig = 1.0 - vignetteAmount * smoothstep(0.30, 1.30, r2);
      col *= vig;

      // Night lift: raise the deepest shadows a touch toward a cool blue so blacks read as "night", not "void".
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col += nightLift * vec3(0.0045, 0.0065, 0.013) * (1.0 - smoothstep(0.0, 0.25, luma));

      // debug: the AO term as sRGB grey (the module disables bloom + OutputPass in this mode, so 1.0 -> white)
      if (debugAO > 0.5) {
        float g = ao <= 0.0031308 ? ao * 12.92 : 1.055 * pow(ao, 1.0 / 2.4) - 0.055;
        gl_FragColor = vec4(vec3(g), 1.0);
        return;
      }
      gl_FragColor = vec4(col, c.a);
    }`,
};
