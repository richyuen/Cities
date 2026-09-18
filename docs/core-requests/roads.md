# Core requests from `roads`

## 1. `World.removeRoad` crashes when a node becomes orphaned (blocks every showcase re-stage)

**What:** `src/core/world.js` `removeRoad()` deletes nodes whose edge list became empty *before* calling
`this._markRoadCells(edge, null)`, which then does `this.roads.nodes.get(edge.a)` → `undefined` →
`TypeError: Cannot read properties of undefined (reading 'x')`.

**Why it matters:** `World.clearContent()` calls `removeRoad` for every edge, and `main.js` `stageShowcase()` calls
`clearContent()` first. So the *second* `window.__city.showcase(id)` call (the one `tools/shot.mjs` and
`tools/critic.mjs` make after boot) throws for any showcase that added roads, and every dead-end/road removal at
runtime (bulldoze tool) will throw as well.

**Minimal diff:**
```diff
   removeRoad(edgeId) {
     const edge = this.roads.edges.get(edgeId);
     if (!edge) return false;
+    this._markRoadCells(edge, null);   // needs both nodes to still exist
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

**Workaround in `src/roads/index.js` (remove once fixed):** `init()` wraps `ctx.world.removeRoad` on the world
*instance* (no core file touched): it snapshots the two node positions, calls the original, and if that throws it
finishes the cell un-marking itself and emits `road:removed`. `guardRemoveRoad()` self-disables when the original
stops throwing, so the patch is inert after the fix.

## 2. (nice to have) `StudInstancer` distance culling

`ctx.materials.studs()` uploads every stud into one InstancedMesh with no LOD. A full city has > 100 k sidewalk
studs (56 tris each), so `roads` keeps its own chunked stud field (`src/roads/studs.js`) that uploads only chunks
within 260 m of the camera. If core grows a chunked/culled instancer, roads will switch to it.
