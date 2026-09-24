// onBeforeCompile patches: procedural stud relief on far ground, distance-shrinking real studs, translucent water.
import * as THREE from 'three';

const WP_VERTEX = (name) => [
  ['#include <common>', `#include <common>\nvarying vec3 ${name};`],
  ['#include <worldpos_vertex>', `#include <worldpos_vertex>\n${name} = (modelMatrix * vec4(transformed, 1.0)).xyz;`],
];

function replaceAll(src, pairs) {
  for (const [a, b] of pairs) {
    if (!src.includes(a)) throw new Error(`[terrain] shader chunk not found: ${a}`);
    src = src.replace(a, b);
  }
  return src;
}

/**
 * Ground: fake stud relief (rim bevel + soft contact ring) on flat, studdable cells. It fades IN over the same
 * camera-distance band [uStudFade.x, uStudFade.y] in which the real instanced studs shrink OUT, so there is no
 * LOD seam. Beyond a few hundred metres (stud < ~1 px) the pattern dissolves to the plain plate colour.
 */
export function patchGroundMaterial(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = replaceAll(shader.vertexShader, WP_VERTEX('vTerrainWP'));
    shader.fragmentShader = replaceAll(shader.fragmentShader, [
      ['#include <common>', `#include <common>
varying vec3 vTerrainWP;
uniform sampler2D uStudMask;
uniform vec2 uMapMin;
uniform vec2 uMapSize;
uniform float uStudPitch;
uniform float uReliefStrength;
uniform vec2 uStudFade;
float tStudMaskAt(vec2 p) { return texture2D(uStudMask, (p - uMapMin) / uMapSize).r; }`],
      ['#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec3 nW = transformDirectionByInverseViewMatrix(nonPerturbedNormal, viewMatrix);
  float flatW = step(0.999, nW.y);
  vec2 p = vTerrainWP.xz / uStudPitch;
  vec2 c = floor(p + 0.5);
  vec2 d = p - c;
  float r = length(d);
  float fw = fwidth(p.x) + fwidth(p.y);
  vec2 cw = c * uStudPitch;
  float m = tStudMaskAt(cw + vec2(0.01, 0.01)) * tStudMaskAt(cw + vec2(-0.01, 0.01))
          * tStudMaskAt(cw + vec2(0.01, -0.01)) * tStudMaskAt(cw + vec2(-0.01, -0.01));
  float dist = distance(vTerrainWP, cameraPosition);
  float lod = smoothstep(uStudFade.x, uStudFade.y, dist);          // real studs -> relief cross-fade
  float fade = 1.0 - smoothstep(0.55, 1.4, fw);                     // pattern -> plain plate when sub-pixel
  float k = flatW * step(0.5, m) * lod * fade;
  if (k > 0.001) {
    float aa = max(0.03, fw * 0.75);
    float R = 0.3;
    float top = 1.0 - smoothstep(R - aa, R + aa, r);
    float rim = smoothstep(R - 0.14 - aa, R - 0.02, r) * top;
    float ao = (1.0 - smoothstep(R + aa, R + 0.13 + aa, r)) * (1.0 - top);
    vec3 tilt = vec3(d.x, 0.0, d.y) / max(r, 1e-4);
    nW = normalize(nW + tilt * rim * uReliefStrength * k);
    normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
    // contact ring only: the plate keeps its full saturated colour, the ring is a soft darker tint
    diffuseColor.rgb *= 1.0 - 0.26 * ao * k;
  }
}`],
      ['#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
#ifdef USE_CLEARCOAT
  clearcoatNormal = normal;
#endif`],
    ]);
  };
  mat.customProgramCacheKey = () => 'terrain-ground-v2';
  return mat;
}

/** Real studs: each instance shrinks to nothing over the fade band, matching the ground relief fade-in. */
export function patchStudMaterial(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = replaceAll(shader.vertexShader, [
      ['#include <common>', '#include <common>\nuniform vec2 uStudFade;'],
      ['#include <begin_vertex>', `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 origin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float s = 1.0 - smoothstep(uStudFade.x, uStudFade.y, distance(origin, cameraPosition));
  transformed *= s;
}
#endif`],
    ]);
  };
  mat.customProgramCacheKey = () => 'terrain-studs-v2';
  return mat;
}

/**
 * Water: translucent Blox trans-blue. Depth under the surface is read from the height field, Beer-Lambert
 * attenuation gives the body colour and the alpha (shallows show the seabed plates, deep water is saturated
 * blue), Fresnel makes grazing views reflect the sky; wave normals fade out by ~150 m so nothing aliases.
 * Blending is One / OneMinusSrcAlpha with the body pre-weighted by (1 - transmittance) and the specular added
 * unweighted (a real reflection does not get dimmer because the water is clear).
 */
export function patchWaterMaterial(mat, uniforms) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = replaceAll(shader.vertexShader, WP_VERTEX('vWaterWP'));
    shader.fragmentShader = replaceAll(shader.fragmentShader, [
      ['#include <common>', `#include <common>
varying vec3 vWaterWP;
uniform float uTime;
uniform float uWaveStrength;
uniform sampler2D uHeightTex;
uniform vec2 uHeightTexSize;
uniform vec2 uMapMin;
uniform float uCellSize;
uniform float uAttenuation;  // 1/m, grey extinction; the blue comes from the lit water body
uniform float uWaterY;
vec2 tWave(vec2 p, vec2 dir, float k, float amp, float speed, float t) {
  return amp * k * dir * cos(dot(p, dir) * k + t * speed);
}
float tSeabed(vec2 xz) {
  vec2 g = (xz - uMapMin) / uCellSize;
  vec2 g0 = floor(g);
  vec2 f = g - g0;
  vec2 ts = 1.0 / uHeightTexSize;
  float h00 = texture2D(uHeightTex, (g0 + vec2(0.5, 0.5)) * ts).r;
  float h10 = texture2D(uHeightTex, (g0 + vec2(1.5, 0.5)) * ts).r;
  float h01 = texture2D(uHeightTex, (g0 + vec2(0.5, 1.5)) * ts).r;
  float h11 = texture2D(uHeightTex, (g0 + vec2(1.5, 1.5)) * ts).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}`],
      ['#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 p = vWaterWP.xz;
  float wdist = distance(vWaterWP, cameraPosition);
  float wfade = (1.0 - smoothstep(40.0, 150.0, wdist));
  vec2 g = vec2(0.0);
  g += tWave(p, normalize(vec2(0.9, 0.4)), 1.9, 0.020, 1.4, uTime);
  g += tWave(p, normalize(vec2(-0.5, 0.8)), 3.1, 0.011, 2.0, uTime);
  g += tWave(p, normalize(vec2(0.2, -1.0)), 1.2, 0.026, 1.0, uTime);
  g += tWave(p, normalize(vec2(0.7, 0.7)), 4.6, 0.006, 2.7, uTime);
  g += tWave(p, normalize(vec2(-0.9, -0.3)), 0.8, 0.016, 0.7, uTime);
  g *= uWaveStrength * wfade;
  vec3 nW = normalize(vec3(-g.x, 1.0, -g.y));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}`],
      ['#include <clearcoat_normal_fragment_begin>', `#include <clearcoat_normal_fragment_begin>
#ifdef USE_CLEARCOAT
  clearcoatNormal = normal;
#endif`],
      ['#include <opaque_fragment>', `
{
  float depth = max(0.0, uWaterY - tSeabed(vWaterWP.xz));
  float T = exp(-depth * uAttenuation);                // what still reaches the eye from the seabed
  vec3 body = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  // a low sun grazes the wave field at near-glancing incidence over a large area, which used to drive the
  // specular lobe and the Fresnel term to their ceiling together and wash the whole surface to flat pale lilac;
  // soft-clip the specular energy and cap the Fresnel ceiling so grazing light stays a bright glint, not a blowout
  vec3 spec = min(reflectedLight.directSpecular + reflectedLight.indirectSpecular, vec3(1.8));
  float NdotV = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
  float F = 0.02 + 0.78 * pow(1.0 - NdotV, 5.0);
  float a = 1.0 - T;
  float alpha = 1.0 - (1.0 - a) * (1.0 - F);
  gl_FragColor = vec4(body * a + spec + totalEmissiveRadiance, alpha);
}`],
      ['#include <fog_fragment>', `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * gl_FragColor.a, fogFactor );
#endif`],
    ]);
  };
  mat.customProgramCacheKey = () => 'terrain-water-v2';
  return mat;
}

/** R8 nearest-filtered mask texture helper. */
export function makeMaskTexture(w, h) {
  const data = new Uint8Array(w * h);
  const t = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

/** R32F nearest-filtered texture wrapping the world height field (vertex heights). */
export function makeHeightTexture(heightField, w1, h1) {
  const t = new THREE.DataTexture(heightField, w1, h1, THREE.RedFormat, THREE.FloatType);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}
