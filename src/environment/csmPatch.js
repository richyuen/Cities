import { ShaderChunk } from 'three';
import { CSMShader } from 'three/addons/csm/CSMShader.js';

// three r186 ships a CSM addon whose `lights_fragment_begin` override predates the physical BRDF changes
// (material.dfg / multiScatteringCompensation, sun lights, iridescence split). Installing it verbatim breaks
// specular on every lit material. Instead we splice ONLY the cascade-selection block from the addon into the
// current core chunk, so everything else in the pipeline keeps working. Returns true when the splice succeeded
// (CSM can be used), false when the markers were not found (caller falls back to a single shadow light).

const CORE_DIR_BEGIN = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )';
const CORE_NEXT = '#if ( NUM_RECT_AREA_LIGHTS > 0 )';
const CSM_BEGIN = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && defined( USE_CSM ) && defined( CSM_CASCADES )';
const CSM_PLAIN = '#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !defined( USE_CSM ) && !defined( CSM_CASCADES )';

let installed = null;

export function installCsmShaderPatch() {
  if (installed !== null) return installed;
  try {
    const core = ShaderChunk.lights_fragment_begin;
    const addon = CSMShader.lights_fragment_begin;
    const a0 = core.indexOf(CORE_DIR_BEGIN);
    const a1 = core.indexOf(CORE_NEXT, a0);
    const c0 = addon.indexOf(CSM_BEGIN);
    const c1 = addon.indexOf(CSM_PLAIN, c0);
    if (a0 < 0 || a1 < 0 || c0 < 0 || c1 < 0) { installed = false; return false; }
    const coreDirBlock = core.slice(a0, a1);
    const csmBlock = addon.slice(c0, c1);
    // sanity: the addon block must only reference symbols that still exist in core
    for (const sym of ['getDirectionalLightInfo', 'getShadow(', 'RE_Direct(', 'vDirectionalShadowCoord']) {
      if (!csmBlock.includes(sym) || !core.includes(sym)) { installed = false; return false; }
    }
    const plainBlock = coreDirBlock.replace(CORE_DIR_BEGIN, CSM_PLAIN);
    const patched = core.slice(0, a0) + csmBlock + plainBlock + core.slice(a1);
    // CSM._injectInclude() copies these two strings into ShaderChunk at construction time.
    CSMShader.lights_fragment_begin = patched;
    // lights_pars_begin in the addon is (uniform decls + core chunk) captured at import time; rebuild it from
    // the live core chunk in case another patch touched it.
    CSMShader.lights_pars_begin = `
#if defined( USE_CSM ) && defined( CSM_CASCADES )
uniform vec2 CSM_cascades[CSM_CASCADES];
uniform float cameraNear;
uniform float shadowFar;
#endif
` + ShaderChunk.lights_pars_begin;
    installed = true;
    return true;
  } catch (e) {
    installed = false;
    return false;
  }
}
