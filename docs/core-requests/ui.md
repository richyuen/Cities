# Core requests from `ui`

## 1. `World.removeRoad` crashes when the road's nodes become orphaned (blocks `clearContent()`)

**What**: `removeRoad(edgeId)` deletes nodes whose `edges` list became empty *before* calling
`_markRoadCells(edge, null)`, which then does `this.roads.nodes.get(edge.a).x` on a deleted node →
`TypeError: Cannot read properties of undefined (reading 'x')`.

**Why it matters**: `world.clearContent()` (called by `app.stageShowcase` before every showcase) removes every road,
so any module whose showcase calls `world.addRoad(...)` throws the second time its showcase is staged — which is exactly
what `tools/shot.mjs` / `tools/critic.mjs` do (they re-run `__city.showcase(id, variant)` inside the page). The `ui`
showcase works around it by painting road cells with `setCell(i, j, { type: 'road' })` instead of `addRoad`, so the
minimap has no real edges to draw lines for.

**Proposed diff** (`src/core/world.js`, `removeRoad`): mark cells first, then prune nodes.

```diff
   removeRoad(edgeId) {
     const edge = this.roads.edges.get(edgeId);
     if (!edge) return false;
     this.roads.edges.delete(edgeId);
+    this._markRoadCells(edge, null);
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

## 2. (nice to have) `sim:tick` payload should include `demand: { r, c, i }`

ARCHITECTURE §4 lists `sim:tick` as `{ tick, stats }`. The UI reads `payload.demand` (0..1 each) for the RCI bars and
falls back to 0 when absent. Please add it to the contract so `simulation` ships it.

## 3. Add `settings:changed` to ARCHITECTURE §4 (event emitted by `ui`)

`settings:changed` — `{ quality?: "low"|"med"|"high", studs?: boolean }` — emitted by `ui` when the player changes a setting in the gear popover; only the changed key is present. Intended consumers: `environment`/`effects` (quality), `terrain`/`buildings` (studs). Snapshot any time via `ui.api.getSettings()`.
