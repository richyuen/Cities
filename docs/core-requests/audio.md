# Core requests from `audio`

Nothing blocking. Two console **warnings** originate in core and show up in every module's shot JSON `warnings`
(not `errors`, so they don't fail the gate, but they add noise to every review):

## 1. `THREE.Material: parameter 'normalScale' has value of undefined.`
**Where:** `src/core/materials.js`, `Materials.plastic()` — the `MeshPhysicalMaterial` constructor is passed
`normalScale: undefined` whenever no `normalMap` is supplied (every plain `plastic('color')` call). Three logs a warning per
material created.

**Proposed diff:**
```js
-    const m = new THREE.MeshPhysicalMaterial({
-      color: instanceColor ? 0xffffff : this.color(name),
-      roughness, clearcoat, clearcoatRoughness, metalness, side, envMapIntensity,
-      map, normalMap, normalScale: normalMap ? new THREE.Vector2(normalScale, normalScale) : undefined,
-    });
+    const params = {
+      color: instanceColor ? 0xffffff : this.color(name),
+      roughness, clearcoat, clearcoatRoughness, metalness, side, envMapIntensity,
+    };
+    if (map) params.map = map;
+    if (normalMap) { params.normalMap = normalMap; params.normalScale = new THREE.Vector2(normalScale, normalScale); }
+    const m = new THREE.MeshPhysicalMaterial(params);
```

## 2. `THREE.WebGLShadowMap: PCFSoftShadowMap has been removed. Using PCFShadowMap instead.`
**Where:** `src/core/renderer.js` sets `renderer.shadowMap.type = THREE.PCFSoftShadowMap`, which r186 has removed.
**Proposed diff:** `renderer.shadowMap.type = THREE.PCFShadowMap;` (identical result, no warning), or `VSMShadowMap` if the
integrator wants softer contact shadows (needs `shadow.radius`/`blurSamples` tuning on the sun light).

## Note for the integrator (no change needed)
`audio` creates its `AudioContext` only on the first `pointerdown`/`keydown` on `window`. If the `ui`/`tools` modules stop
propagation of pointer events on their own elements, the gesture still reaches `window` in the capture-less bubbling phase
only if they don't call `stopPropagation()`. If they do, call `ctx.modules.get('audio').api.start()` from that handler.
