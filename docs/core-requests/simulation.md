# Core request from `simulation`

## 1. RESOLVED — `World.removeRoad` crashed on the last edge of a node (integrator applied the fix; `USE_WORLD_ROADS` is now `true`)

**What**: `src/core/world.js` `removeRoad()` deletes nodes whose edge list became empty *before* calling
`_markRoadCells(edge, null)`, which then does `this.roads.nodes.get(edge.a).x` → `TypeError: Cannot read properties of
undefined (reading 'x')`.

**Why it matters**: `main.js` `stageShowcase()` calls `world.clearContent()` which removes every edge; the last edge of
each node always hits this, so any showcase that used `world.addRoad` throws on the second `__city.showcase()` call —
and `tools/shot.mjs` always re-stages once. Screenshots fail for every module that adds roads.

**Minimal diff** (reorder two statements):
```diff
   removeRoad(edgeId) {
     const edge = this.roads.edges.get(edgeId);
     if (!edge) return false;
+    this._markRoadCells(edge, null);           // needs both nodes to still exist
     this.roads.edges.delete(edgeId);
     for (const nid of [edge.a, edge.b]) {
       const n = this.roads.nodes.get(nid);
       if (!n) continue;
       n.edges = n.edges.filter((e) => e !== edgeId);
       if (n.edges.length === 0) this.roads.nodes.delete(nid);
     }
-    this._markRoadCells(edge, null);
     this.events.emit('road:removed', { edgeId, edge });
     return true;
   }
```

**Workaround in place**: `src/simulation/citygen.js` stages showcase streets as road *cells* (`setCell type:'road'`)
behind `USE_WORLD_ROADS = false`, and the model counts road cells / 4 as "road units" when `world.roads.edges.size === 0`.
Flip the flag to `true` once this is fixed; nothing else changes.

## 2. (nice to have) `World.setStats` should emit `stats:changed`
Not required — `sim:tick` carries the stats — but UI modules would not need to know about the simulation event name.
