// Module loader with dependency ordering and failure isolation.
// A module that throws in load/init is marked 'failed' and skipped; update() errors are counted and the module is
// disabled after 3 consecutive errors. The app never goes down because of one module.

/** Yield until after the next paint, so DOM updates queued by an onProgress report (the boot screen's status
 *  label) are visible before the next init blocks the main thread with heavy synchronous work (city generation,
 *  terrain meshing). rAF runs before paint, so the task queued from it lands after it. */
function yieldToPaint() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 0));
    else setTimeout(resolve, 0);
  });
}

export class Registry {
  constructor(ctx, loaders) {
    this.ctx = ctx;
    this.loaders = loaders; // { id: () => Promise<{default: module}> }
    this.records = ctx.modules; // Map<id, record>
    this.ordered = [];
  }

  /** `onProgress({ phase: 'load', id, done, total })` is called before each module starts and once when the
   *  phase finishes (id null), for the boot screen. Optional: omit it and behavior is unchanged. */
  async loadAll(ids, onProgress) {
    const recs = new Map();
    const total = ids.length;
    let done = 0;
    onProgress?.({ phase: 'load', id: null, done, total });
    for (const id of ids) {
      const rec = { id, status: 'pending', module: null, api: {}, error: null, errors: 0, initMs: 0 };
      recs.set(id, rec);
      const loader = this.loaders[id];
      if (!loader) {
        rec.status = 'failed'; rec.error = `no loader for module "${id}"`;
        this.ctx.error(`[registry] ${rec.error}`);
        done++;
        continue;
      }
      onProgress?.({ phase: 'load', id, done, total });
      try {
        const mod = await loader();
        const m = mod.default;
        if (!m || m.id !== id) throw new Error(`module "${id}" must default-export { id: '${id}', ... }`);
        rec.module = m;
        rec.api = m.api || {};
        rec.status = 'loaded';
      } catch (e) {
        rec.status = 'failed'; rec.error = String(e?.stack || e);
        this.ctx.error(`[registry] failed to load module "${id}":`, e);
        this.ctx.events.emit('module:failed', { id, error: rec.error });
      }
      done++;
    }
    onProgress?.({ phase: 'load', id: null, done, total });
    return recs;
  }

  /** Transitive dependency closure of the given ids, using each loaded module's deps. */
  static closure(recs, roots) {
    const out = new Set();
    const visit = (id) => {
      if (out.has(id)) return;
      out.add(id);
      const m = recs.get(id)?.module;
      for (const d of m?.deps || []) visit(d);
    };
    for (const r of roots) visit(r);
    return out;
  }

  /** Topologically sort by deps, tie-break by order then id. */
  static sort(recs, ids) {
    const list = [...ids].filter((id) => recs.has(id));
    const done = new Set();
    const out = [];
    const visiting = new Set();
    const visit = (id) => {
      if (done.has(id)) return;
      if (visiting.has(id)) return; // cycle: ignore
      visiting.add(id);
      const m = recs.get(id)?.module;
      const deps = [...(m?.deps || [])].sort();
      for (const d of deps) if (recs.has(d)) visit(d);
      visiting.delete(id);
      done.add(id);
      out.push(id);
    };
    list.sort((a, b) => ((recs.get(a).module?.order ?? 50) - (recs.get(b).module?.order ?? 50)) || a.localeCompare(b));
    for (const id of list) visit(id);
    return out;
  }

  /** `onProgress({ phase: 'init', id, done, total })` mirrors loadAll. Before each init we also yield a paint
   *  (see yieldToPaint) so the status label for the module about to run is on screen before it can freeze. */
  async initAll(recs, ids, onProgress) {
    const order = Registry.sort(recs, ids);
    const total = order.length;
    let done = 0;
    onProgress?.({ phase: 'init', id: null, done, total });
    for (const id of order) {
      const rec = recs.get(id);
      this.records.set(id, rec);
      if (rec.status !== 'loaded') {
        done++;
        continue;
      }
      const missing = (rec.module.deps || []).filter((d) => this.records.get(d)?.status !== 'ok');
      if (missing.length) {
        rec.status = 'skipped'; rec.error = `deps not ok: ${missing.join(', ')}`;
        this.ctx.log(`[registry] skipping "${id}": ${rec.error}`);
        done++;
        continue;
      }
      onProgress?.({ phase: 'init', id, done, total });
      if (onProgress) await yieldToPaint();
      const t0 = performance.now();
      try {
        this.ctx.log(`[registry] init ${id}`);
        await rec.module.init?.(this.ctx);
        rec.status = 'ok';
        for (const [name, p] of Object.entries(rec.module.presets || {})) this.ctx.cameraPresets.register(name, p);
      } catch (e) {
        rec.status = 'failed'; rec.error = String(e?.stack || e);
        this.ctx.error(`[registry] module "${id}" failed in init:`, e);
        this.ctx.events.emit('module:failed', { id, error: rec.error });
        try { rec.module.dispose?.(this.ctx); } catch (_) { /* ignore */ }
      }
      rec.initMs = performance.now() - t0;
      done++;
    }
    onProgress?.({ phase: 'init', id: null, done, total });
    this.ordered = order.map((id) => this.records.get(id)).filter((r) => r.status === 'ok');
    return order;
  }

  update(dt) {
    for (const rec of this.ordered) {
      if (rec.status !== 'ok' || !rec.module.update) continue;
      try {
        rec.module.update(dt, this.ctx);
        rec.errors = 0;
      } catch (e) {
        rec.errors++;
        this.ctx.error(`[registry] module "${rec.id}" threw in update (${rec.errors}/3):`, e);
        if (rec.errors >= 3) {
          rec.status = 'failed'; rec.error = String(e?.stack || e);
          this.ctx.events.emit('module:failed', { id: rec.id, error: rec.error });
          this.ordered = this.ordered.filter((r) => r !== rec);
        }
      }
    }
  }

  async showcase(id, variant = 'default') {
    const rec = this.records.get(id);
    if (!rec || rec.status !== 'ok') throw new Error(`module "${id}" is not ok (${rec?.status}): ${rec?.error || ''}`);
    if (!rec.module.showcase) throw new Error(`module "${id}" has no showcase()`);
    await rec.module.showcase(this.ctx, variant);
    this.ctx.events.emit('showcase:staged', { id, variant });
  }

  disposeAll() {
    for (const rec of [...this.ordered].reverse()) {
      try { rec.module.dispose?.(this.ctx); } catch (e) { this.ctx.error(`[registry] dispose ${rec.id}:`, e); }
    }
    this.ordered = [];
    this.records.clear();
  }

  statusMap() {
    const o = {};
    for (const [id, r] of this.records) o[id] = r.status;
    return o;
  }
}
