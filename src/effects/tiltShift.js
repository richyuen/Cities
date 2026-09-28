// Capture-mode tilt-shift / depth-of-field for the composer (LOOP cycle 4).
//
// A screen-space focus band: distance from a horizontal line (focusY, with a mild horizontal broadening so the
// side edges are not perfectly sharp) drives a golden-angle disc blur. No depth buffer, no history, no
// per-frame randomness: the kernel is rotated per pixel by interleaved gradient noise, which is a deterministic
// function of gl_FragCoord, so a still frame is stable and two captures of the same stage are byte-identical.
//
// Sits AFTER OutputPass (i.e. on the tone-mapped sRGB image) and BEFORE SMAAPass:
//   Render -> GTAO -> Grade -> Bloom -> Output(ACES+sRGB) -> TiltShift -> SMAA -> screen
// Why: bloom and ACES must see exactly the image they see today (the sun column's bloom fuel is a linear-HDR
// property, not a focus property), and SMAA must stay last so the sharp focus band keeps its edge AA. Blurring
// the LDR image is the classic cinematic DOF placement and is the cheapest stable one (no depth, no bokeh
// passes). At t == 0 (inside the band, or strength 0) the shader returns the input texel untouched, and the
// whole pass is not even constructed unless a strength > 0 is requested.
export const TiltShiftShader = {
  name: 'BloxTiltShiftShader',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: null },     // Vector2, drawing-buffer pixels
    strength: { value: 0.55 },       // 0..1; scales the max blur (0.55 is the capture-mode default)
    focusY: { value: 0.5 },          // vUv of the focus line (0.5 = frame centre)
    focusRadius: { value: 0.14 },    // distance from the focus line that stays fully sharp
    falloff: { value: 0.42 },        // distance where the blur is at full strength
    maxRadius: { value: 18.0 },      // px at 1080p of real blur at strength 1.0, scaled by height
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float strength;
    uniform float focusY;
    uniform float focusRadius;
    uniform float falloff;
    uniform float maxRadius;
    varying vec2 vUv;

    const int TAPS = 16;

    // Interleaved gradient noise (Jimenez): deterministic per pixel, no texture, no time.
    float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

    void main() {
      vec2 texel = 1.0 / resolution;
      vec3 sharp = texture2D(tDiffuse, vUv).rgb;

      // Focus band: a horizontal line (focusY) with a soft edge. The horizontal term (weighted 0.5) bows the
      // band out at the left/right edges, so a wide shot blurs its far corners before its centre.
      vec2 d = vec2((vUv.x - 0.5) * 0.5, vUv.y - focusY);
      float t = smoothstep(focusRadius, falloff, length(d)) * strength;
      if (t < 0.003) { gl_FragColor = vec4(sharp, 1.0); return; }

      float radius = t * maxRadius * (resolution.y / 1080.0);
      float ang = ign(gl_FragCoord.xy) * 6.2831853;
      vec3 acc = vec3(0.0);
      float wsum = 0.0;
      for (int i = 0; i < TAPS; i++) {
        float fi = float(i) + 0.5;
        float rr = sqrt(fi / float(TAPS));              // uniform disc coverage
        float a = ang + fi * 2.39996323;                // golden angle
        float w = 1.0 - 0.55 * rr * rr;                 // centre-weighted: a soft gaussian-ish falloff
        acc += texture2D(tDiffuse, vUv + vec2(cos(a), sin(a)) * (radius * rr) * texel).rgb * w;
        wsum += w;
      }
      gl_FragColor = vec4(mix(sharp, acc / wsum, t), 1.0);
    }`,
};
