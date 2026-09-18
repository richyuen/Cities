# Core requests from `terrain`

## 1. Linear fog washes terrain colour to pale blue-white beyond ~600 m

**What:** `src/core/fallbackLights.js` sets `ctx.scene.fog = new THREE.Fog(0xb9d3ee, 600, 3000)` — a flat linear fog
that starts blending in scene colour at 600 m and reaches full fog colour at 3000 m, with the fog colour itself set
to a sky-tinted near-white (`ctx.scene.fog.color.copy(ctx.scene.background).lerp(new THREE.Color(0xffffff), 0.25)`).

**Why it matters:** `terrain`'s own material work this round (lower clearcoat, `GROUND_ENV_MUL` scaling env
intensity, brick-tier riser darkening) keeps saturated colour out to ~200 m, but everything beyond ~500-800 m —
the plateau rim from altitude, the far hill ridgeline, both `terrain:default`/core `overview` presets — still
washes toward pale blue-white because this fog sits on top of every material regardless of what the module does
to its own albedo/lighting. Confirmed by the terrain-r2 critic review (`docs/reviews/terrain-r2.md`, "round-1
issues verified this round" #1 and ranked issue #4): the residual wash starting ~500-800 m out is this fog band,
"confirmed unaffected by the module's own material change."

**Minimal proposed diff** (illustrative — the right curve is core's call, not terrain's):
```diff
- ctx.scene.fog = new THREE.Fog(0xb9d3ee, 600, 3000);
+ ctx.scene.fog = new THREE.Fog(0xb9d3ee, 1100, 3400);
```
Pushing `near` out (and/or switching to `FogExp2` with a small density so the falloff is gentler near the camera
and steeper only at real distance) would let terrain's saturated greens/greys carry further before the atmospheric
wash takes over, matching the reference's punchy far ridgelines. `terrain` cannot fix this itself — `scene.fog` is
set by `environment`/`fallbackLights` (a core-adjacent module), out of `src/terrain/`'s ownership.

**Workaround in `src/terrain/` meanwhile:** none applied — the module's own colour/material fixes (round 2) already
recover as much saturation as possible before the fog boundary; there is no per-material fog override available
without touching `scene.fog` itself.
