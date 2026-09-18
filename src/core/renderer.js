import * as THREE from 'three';

export function createRenderer(container) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // needed for headless screenshots
    logarithmicDepthBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.info.autoReset = false;
  container.appendChild(renderer.domElement);
  return renderer;
}

/** Rolling frame stats. Call begin() before render and end() after. */
export class FrameStats {
  constructor(renderer) {
    this.renderer = renderer;
    this.fps = 0;
    this.frameMs = 0;
    this.drawCalls = 0;
    this.triangles = 0;
    this._times = [];
    this._last = performance.now();
  }

  _initGpuTimer() {
    if (this._gpuInit) return;
    this._gpuInit = true;
    const gl = this.renderer.getContext();
    this._ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    this._gl = gl;
    this._queries = [];
    this._gpuSamples = [];
    this.gpuMs = 0;
  }

  begin() {
    this.renderer.info.reset();
    this._t0 = performance.now();
    this._initGpuTimer();
    if (this._ext && this._queries.length < 8) {
      const q = this._gl.createQuery();
      this._gl.beginQuery(this._ext.TIME_ELAPSED_EXT, q);
      this._activeQuery = q;
    }
  }

  _pollGpu() {
    if (!this._ext) return;
    const gl = this._gl, ext = this._ext;
    if (this._activeQuery) { gl.endQuery(ext.TIME_ELAPSED_EXT); this._queries.push(this._activeQuery); this._activeQuery = null; }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
    while (this._queries.length) {
      const q = this._queries[0];
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
      this._queries.shift();
      if (!disjoint) {
        const ns = gl.getQueryParameter(q, gl.QUERY_RESULT);
        this._gpuSamples.push(ns / 1e6);
        while (this._gpuSamples.length > 60) this._gpuSamples.shift();
      }
      gl.deleteQuery(q);
    }
    if (this._gpuSamples.length) {
      const sorted = [...this._gpuSamples].sort((a, b) => a - b);
      this.gpuMs = sorted[Math.floor(sorted.length / 2)];
    }
  }

  end() {
    this._pollGpu();
    const now = performance.now();
    this.frameMs = now - this._t0;
    this._times.push(now);
    while (this._times.length > 90) this._times.shift();
    if (this._times.length > 2) {
      const span = this._times[this._times.length - 1] - this._times[0];
      this.fps = span > 0 ? ((this._times.length - 1) * 1000) / span : 0;
    }
    this.drawCalls = this.renderer.info.render.calls;
    this.triangles = this.renderer.info.render.triangles;
  }

  snapshot() {
    const info = this.renderer.info;
    return {
      fps: Math.round(this.fps * 10) / 10,
      frameMs: Math.round(this.frameMs * 100) / 100,
      gpuMs: this.gpuMs ? Math.round(this.gpuMs * 100) / 100 : null,
      gpuFps: this.gpuMs ? Math.round(1000 / this.gpuMs) : null,
      drawCalls: this.drawCalls,
      triangles: this.triangles,
      programs: info.programs?.length ?? 0,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }
}
