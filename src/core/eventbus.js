// Minimal pub/sub. A throwing handler never breaks other handlers.

export class EventBus {
  constructor(log = console) {
    this.handlers = new Map();
    this.log = log;
  }

  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.off(name, fn);
  }

  once(name, fn) {
    const off = this.on(name, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off(name, fn) {
    this.handlers.get(name)?.delete(fn);
  }

  emit(name, payload) {
    const set = this.handlers.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        this.log.error?.(`[events] handler for "${name}" threw:`, e);
      }
    }
  }

  clear() {
    this.handlers.clear();
  }
}
