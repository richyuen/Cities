import * as THREE from 'three';

// Sky dome: one BackSide sphere, one draw call, rendered at the far plane. Analytic gradient (zenith / horizon
// with a solar-azimuth warm side), Henyey-Greenstein sun halo, sun disc, projected-plane cumulus/stratus clouds
// lit toward the sun, moon disc, and a night layer (deep-blue gradient + Milky Way). Colour parameters are
// produced on the CPU by skyMath.skyParams() so fog and IBL can mirror the exact same model.
// The shader emits linear HDR radiance; the composer's OutputPass (ACES) tone-maps it — no local tone mapping.

const NOISE_GLSL = /* glsl */`
vec2 gradient2( vec2 i ) {
  vec3 p = fract( i.xyx * vec3( 0.1031, 0.1030, 0.0973 ) );
  p += dot( p, p.yzx + 33.33 );
  return fract( ( p.xx + p.yz ) * p.zy ) * 2.0 - 1.0;
}
float gnoise( vec2 p ) {
  vec2 i = floor( p ), f = fract( p );
  vec2 u = f * f * f * ( f * ( f * 6.0 - 15.0 ) + 10.0 );
  float a = dot( gradient2( i ), f );
  float b = dot( gradient2( i + vec2( 1.0, 0.0 ) ), f - vec2( 1.0, 0.0 ) );
  float c = dot( gradient2( i + vec2( 0.0, 1.0 ) ), f - vec2( 0.0, 1.0 ) );
  float d = dot( gradient2( i + vec2( 1.0, 1.0 ) ), f - vec2( 1.0, 1.0 ) );
  return mix( mix( a, b, u.x ), mix( c, d, u.x ), u.y ) * 1.6;
}
float fbm2( vec2 p, float drift ) {
  float r = 0.0, a = 0.5;
  for ( int i = 0; i < 5; i ++ ) { r += a * gnoise( p ); a *= 0.5; p = p * 2.02 + drift; }
  return r;
}
float hash13( vec3 p ) { p = fract( p * 0.1031 ); p += dot( p, p.zyx + 31.32 ); return fract( ( p.x + p.y ) * p.z ); }
float vnoise3( vec3 p ) {
  vec3 i = floor( p ), f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( mix( hash13( i ), hash13( i + vec3( 1, 0, 0 ) ), f.x ), mix( hash13( i + vec3( 0, 1, 0 ) ), hash13( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
    mix( mix( hash13( i + vec3( 0, 0, 1 ) ), hash13( i + vec3( 1, 0, 1 ) ), f.x ), mix( hash13( i + vec3( 0, 1, 1 ) ), hash13( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}
float fbm3( vec3 p ) { float s = 0.0, a = 0.5; for ( int i = 0; i < 4; i ++ ) { s += a * vnoise3( p ); p = p * 2.03 + vec3( 1.7, 9.2, 3.1 ); a *= 0.5; } return s; }
`;

export const MILKY_WAY_NORMAL = new THREE.Vector3(0.55, 0.42, 0.72).normalize();

export function createSky() {
  const uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uMoonDir: { value: new THREE.Vector3(0, 1, 0) },
    uZenith: { value: new THREE.Vector3(0.1, 0.3, 0.85) },
    uHorizonAway: { value: new THREE.Vector3(0.5, 0.65, 0.85) },
    uHorizonSun: { value: new THREE.Vector3(0.7, 0.75, 0.9) },
    uGlow: { value: new THREE.Vector3(0.7, 0.7, 0.7) },
    uGlowG: { value: 0.8 },
    uGlowK: { value: 1.0 },
    uHorK: { value: 3.2 },
    uSunDisc: { value: new THREE.Vector3(30, 28, 24) },
    uShowSun: { value: 1 },
    uCloudAmb: { value: new THREE.Vector3(0.6, 0.65, 0.8) },
    uCloudLit: { value: new THREE.Vector3(0.55, 0.55, 0.5) },
    uCoverage: { value: 0.4 },
    uDensity: { value: 1.0 },
    uCloudSharp: { value: 0.25 },
    uCloudOffset: { value: new THREE.Vector2(0, 0) },
    uHaze: { value: 0.4 },
    uHazeK: { value: 14.0 },
    uFog: { value: new THREE.Vector3(0.5, 0.6, 0.8) },
    uNight: { value: 0 },
    uMoon: { value: 0 },
    uMoonCol: { value: new THREE.Vector3(1.4, 1.5, 1.8) },
    uMW: { value: MILKY_WAY_NORMAL.clone() },
    uTime: { value: 0 },
  };
  const material = new THREE.ShaderMaterial({
    name: 'SkyDome',
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4( position, 1.0 );
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        gl_Position.z = gl_Position.w; // far plane
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uMoonDir, uZenith, uHorizonAway, uHorizonSun, uGlow, uSunDisc, uCloudAmb, uCloudLit, uFog, uMoonCol, uMW;
      uniform float uGlowG, uGlowK, uHorK, uHazeK, uShowSun, uCoverage, uDensity, uCloudSharp, uHaze, uNight, uMoon, uTime;
      uniform vec2 uCloudOffset;
      varying vec3 vDir;
      ${NOISE_GLSL}
      float hg( float c, float g ) { float g2 = g * g; return ( 1.0 - g2 ) / pow( 1.0 + g2 - 2.0 * g * c, 1.5 ) * ( 1.0 - g ) * ( 1.0 - g ) / ( 1.0 + g ); }
      void main() {
        vec3 d = normalize( vDir );
        float h = d.y;
        vec2 sh = normalize( uSunDir.xz + vec2( 1e-5, 0.0 ) );
        vec2 dh = normalize( d.xz + vec2( 1e-5, 0.0 ) );
        float az = clamp( dot( sh, dh ) * 0.5 + 0.5, 0.0, 1.0 );
        vec3 hor = mix( uHorizonAway, uHorizonSun, pow( az, 2.2 ) );
        float band = exp( - max( h, 0.0 ) * uHorK );
        vec3 sky = mix( uZenith, hor, band );

        // sun halo + disc
        float cosT = dot( d, uSunDir );
        float halo = ( 0.55 * hg( cosT, uGlowG ) + 0.22 * hg( cosT, uGlowG * 0.82 ) + 0.06 * pow( max( cosT, 0.0 ), 4.0 ) ) * uGlowK;
        float horizonBoost = 1.0 - 0.6 * smoothstep( 0.05, 0.6, h );
        sky += uGlow * halo * horizonBoost;
        float disc = smoothstep( 0.99988, 0.99995, cosT ) * uShowSun * smoothstep( -0.004, 0.006, h );
        sky += uSunDisc * disc;

        // horizon haze: thin band that thickens the horizon toward the fog colour, soft above and below
        float hazeBand = exp( - max( h, 0.0 ) * uHazeK ) * uHaze;
        sky = mix( sky, uFog, clamp( hazeBand, 0.0, 1.0 ) );

        // moon disc (behind clouds). mglow is the disc's own natural (tight) halo; veil is a separate, much wider
        // glow kept only for re-application after the cloud composite below, so a moon under cloud dims and veils
        // softly instead of the alpha mix erasing it outright — without also ballooning the clear-sky halo.
        float cosM = dot( d, uMoonDir );
        float mglow = 0.0, veil = 0.0;
        if ( uMoon > 0.001 ) {
          float mdisc = smoothstep( 0.99988, 0.99994, cosM );
          vec2 mc = vec2( dot( d, normalize( cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) ) ), dot( d, normalize( cross( uMoonDir, cross( uMoonDir, vec3( 0.0, 1.0, 0.0 ) ) ) ) ) ) * 400.0;
          float maria = 0.72 + 0.28 * smoothstep( 0.35, 0.7, fbm2( mc * 1.7 + 3.0, 0.0 ) * 0.7 + 0.5 );
          mglow = pow( max( cosM, 0.0 ), 900.0 ) * 0.12 + pow( max( cosM, 0.0 ), 60.0 ) * 0.02 + hg( cosM, 0.85 ) * 0.06;
          veil = hg( cosM, 0.75 ) * 0.8;
          sky += uMoonCol * ( mdisc * maria + mglow ) * uMoon * smoothstep( -0.01, 0.02, h );
        }

        // night: Milky Way band and dust lanes
        if ( uNight > 0.001 ) {
          float band = dot( d, uMW );
          float core = exp( - band * band * 60.0 );
          float haloMW = exp( - band * band * 11.0 );
          float n = fbm3( d * 7.0 );
          float n2 = fbm3( d * 19.0 + 4.0 );
          float dust = smoothstep( 0.35, 0.6, fbm3( d * 9.0 + 11.0 ) );
          float mw = core * ( 0.35 + 1.2 * n ) * ( 1.0 - 0.6 * dust ) + haloMW * 0.22 * n2;
          mw *= smoothstep( -0.02, 0.18, h );
          sky += ( vec3( 0.30, 0.31, 0.42 ) * mw + vec3( 0.40, 0.28, 0.24 ) * core * n2 * 0.30 ) * 0.9 * uNight;
        }

        // clouds: projected plane, cumulus carved from fbm, lit on the side facing the sun
        if ( uCoverage > 0.001 && h > -0.03 ) {
          float hh = max( h, 0.0 ) + 0.18;
          vec2 uv = d.xz / hh * 0.55 + uCloudOffset;
          float drift = uTime * 0.004;
          float billow = abs( gnoise( uv * 9.0 + 3.0 ) ) * 0.06;
          float n = clamp( fbm2( uv * 1.6, drift ) * 0.7 + 0.5 + billow - 0.04, 0.0, 1.0 );
          float region = gnoise( uv * 0.35 + 7.0 ) * 0.35 + 0.5;
          float cov = clamp( uCoverage + ( region - 0.5 ) * 0.8 * ( 1.0 - uCoverage ), 0.0, 1.0 );
          float thr = 1.0 - cov;
          float mask = smoothstep( thr, thr + uCloudSharp, n );
          float dens = clamp( ( n - thr ) / max( 1.0 - thr, 0.05 ), 0.0, 1.0 );
          // density gradient toward the sun => lit faces
          vec2 toSun = sh * ( 0.08 + 0.12 * ( 1.0 - clamp( uSunDir.y, 0.0, 1.0 ) ) );
          float n2 = clamp( fbm2( ( uv + toSun ) * 1.6, drift ) * 0.7 + 0.5, 0.0, 1.0 );
          float lit = clamp( 0.45 + ( n - n2 ) * 6.0, 0.0, 1.0 );
          float shade = 1.0 - 0.5 * smoothstep( 0.05, 0.7, dens );
          float edge = mask * ( 1.0 - mask ) * 4.0;
          float silver = hg( cosT, 0.6 ) * edge * 0.8;
          vec3 cc = uCloudAmb * shade + uCloudLit * ( lit * shade * 0.9 + silver );
          float aerial = smoothstep( 0.35, 0.0, max( h, 0.0 ) );
          cc = mix( cc, hor, 0.75 * aerial );
          float alpha = mask * ( 1.0 - exp( - dens * uDensity * 5.0 ) ) * smoothstep( -0.02, 0.10, h );
          sky = mix( sky, cc, alpha );
          // let a soft, wide moon veil bleed back through the cloud deck it was just mixed away by, so the moon
          // dims and glows under cloud instead of the alpha mix above erasing it outright.
          sky += uMoonCol * veil * uMoon * alpha * smoothstep( -0.01, 0.05, h );
        }

        // below the horizon: settle into the fog colour so a finite ground fades out seamlessly
        sky = mix( sky, uFog * 0.92, smoothstep( 0.0, -0.12, h ) );

        gl_FragColor = vec4( sky, 1.0 );
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), material);
  mesh.scale.setScalar(4000);
  mesh.frustumCulled = false;
  mesh.renderOrder = -20;
  mesh.name = 'sky';
  return { mesh, uniforms, material };
}
