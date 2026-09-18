# Core requests from `buildings`

## 1. (nice to have) Camera has no XZ collision against building volumes

**What:** `src/core/camera.js` sets `controls.minDistance = 4` but never clamps the orbit target/eye against
world geometry in the XZ plane. Orbiting or panning close to a building cluster can put the camera literally
inside a building's footprint.

**Why it matters:** Buildings are solid convex volumes rendered with `FrontSide` materials (needed to hit the
draw-call budget via per-chunk-per-colour merged meshes - see `src/buildings/batching.js`), so a camera inside
one sees every exterior wall as a culled backface: sky/terrain showing through the window-frame gaps, which
reads as a broken/hollow building. This is reachable in ordinary orbit/pan around a dense block, not just an
artificial debug camera.

**What we did instead (in `src/buildings/generator.js`):** added a cheap `interiorLiner()` per building shell -
a smaller, reverse-winding/flipped-normal duplicate of the main body box that sits just inside the real wall.
It reuses the exact same material key as the outer wall, so it merges into the same per-chunk-per-colour draw
bucket at **zero extra draw calls** (~12-24 extra triangles per building). From inside a building's footprint
the camera now sees this solid inner liner instead of a hole to the sky. It's a mitigation, not a fix: a camera
that gets *very* close to a corner/window gap at a shallow angle can still occasionally see past the liner's
margin (it's inset ~0.14m from the real wall to avoid z-fighting), and it does nothing for the vertical gap
right at the roofline.

**Minimal proposed diff (not applied - would touch `src/core/camera.js`, outside our folder):** after computing
the desired orbit target/position each frame, raycast or AABB-test the camera eye against `world.buildings`
footprints (already axis-aligned rects, cheap to test) and push the eye back along the view ray to the nearest
non-colliding point, the way `OrbitControls` users typically wire up a "dolly collision" pass. Even a coarse
per-chunk AABB reject (skip chunks whose bounds don't contain the camera) would be enough given the sizes
involved (building footprints are 1-3 cells, i.e. 8-24m).
