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

## 3. (applied, round 4) Junction model: `addRoad` stitches instead of overlapping

**What was wrong.** `World.addRoad` only merged endpoint nodes within 0.5 m. An endpoint dropped on a road (the
tool's snap-to-road T gesture) became a brand-new degree-1 node in the middle of that road: the target edge was
never split, `getLaneConnections` returned a U-turn only, and the dead-end node rendered a cul-de-sac bulb and its
sidewalks on top of the through carriageway. A perpendicular drag across a road produced two nodes and no shared
junction at all, while both road bands, curbs and markings overlapped mid-block. `src/roads/showcase.js` documented
the workaround ("world.addRoad does not split edges at crossings, so every grid line is added as segments between
crossings") and the demo generator did the same.

**What core now does** (`src/core/world.js`, verified by `tools/road-audit.mjs`):
- Endpoint resolution: join an existing node within `JUNCTION_SNAP` (4 m, interactive) / `NODE_SNAP` (0.5 m, exact
  callers), else split the nearest vehicle edge within `ENDPOINT_SNAP` (2 m) and share its node, else create one.
- Interior crossings of at-grade vehicle edges split both roads at one shared node (crossings within `JUNCTION_SNAP`
  of an existing node reuse that node; bridges and `path` edges are exempt). `snapNodes: true` (interactive drags)
  also routes the segment through existing nodes within `ROUTE_SNAP` (4 m).
- Removal: `_retireEdge` re-owns every cell that pointed at the retired edge (sidewalk cells included) by the
  remaining edges, or frees them; `_healNode` merges two same-cross-section collinear edges back through a
  degree-2 node, so removing the branch that created a T restores the original through edge exactly.
- Event reasons: split/merge emit `road:added`/`road:removed` with `reason:'split'|'merge'`; `props` skips
  re-lamping those pieces (signals still update) and `audio` skips the build sound.
- `clearContent` clears the graph in one pass instead of per-edge removal (healing made the old loop O(edges^2)
  and able to miss merged edges).
- `menu/serialize.js` now saves/loads the `bridge` flag.

**Deliberate consequences.** Three demo-city T-junctions that were previously unconnected now split and connect
(industrial↔downtown at z=±160, industrial↔suburb at z=-220): seed 1 goes 424→427 edges with node count unchanged.
One borderline corner cell at the (-200,160) junction is no longer marked road (the old rasterisation overshoot).

**Harness.** `node tools/road-audit.mjs --seed N` opens the game, runs a scripted gesture suite (T, X, diagonal,
near-node snap, route-through node, parallel duplicate guard, bridge, path, bulldoze-at-crossing, save/load edge
replay) and asserts `roads.api.audit()` stays clean plus exact geometry round-trips; 57/57 green, deterministic
across two fresh loads.

**Still open (tools, round 4):** roads are blocked over building cells (`roadBuildingBlocked`), so the player must
bulldoze first instead of slicing a road through a building mesh.

**Round 6 (player report: short streets drawn toward the same spot stacked overlapping cul-de-sac rings).** Two
fixes, both in the roads/tools layer:
- `roads.api.snapToNode` now treats a node as a target over its whole *paved plate* — the largest arm's
  carriageway + sidewalk radius, or a street dead end's bulb — plus one grid cell of pad. Previously only
  degree-1 nodes had a wide radius (and it collapsed to 4 m once a second street joined), so a third street
  drawn onto the same junction pavement grew its own dead-end bulb.
- `buildNetwork` demotes a cul-de-sac bulb to a plain square stub (`a.noBulb`) when `bulbCollides` finds that
  its pavement would overlap another road's or node's pavement. `roads.api.audit()` gains `bulbOverlaps` (the
  pixel-level invariant: rendered bulbs must never overlap other pavement; must stay empty).
Harness: a `cluster` check draws five short streets toward one point through the tool's snap chain and asserts
they share junctions rather than stacking dead ends — 64/64 on seeds 1–3, deterministic. Cul-de-sacs in open
land still render as bulbs (verified in both showcase variants).

**Round 7 (player report: a street drawn as a continuation, two grid cells from an existing end, left two
square-cut ends facing each other).** That spot is the 2-cell diagonal lattice point (16, 8) — 17.9 m from the
end, just outside the old snap radius (bulb 10.5 + 5.7 pad = 16.2) while close enough for the bulb-collision
demotion to fire, so both ends were cut square and read as a connection that was not made. Fixes:
- `NODE_SNAP_PAD` is one full 8 m cell: the pad has to cover the grid snap's worst-case rounding of a click
  aimed at the junction, and half a cell (the previous value) left the diagonal lattice point outside.
- `snapToNode` measures a street end from its *spec* bulb radius even when the bulb is demoted for rendering —
  a demoted end is still a street end the player can aim at.
- `bulbCollides` (and `audit.bulbOverlaps`) now count the other node's own bulb as pavement, so bulb-vs-bulb
  overlap out to ~21 m demotes both ends; overlapping rings cannot be drawn at any distance.
Harness: the tool-snap check now covers the 2-cell diagonal point — 65/65 on seeds 1–3, deterministic.
