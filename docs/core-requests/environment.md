# Core requests from `environment`

## 1. [CRITICAL, now mitigated] `effects`' EffectComposer leaves buildings pale/"toothpicked" after a camera
teleport away from and back to a distant, steep-pitch view (`overview`/`aerial`) - root cause is in
`src/effects/`, not here

**Where reported:** whole-game critic round 1, issue #1 (`docs/reviews/game-r1.md`) - `overview`/`aerial` render
the whole city as illegible pale slivers after any prior camera/time change in the same session.

**Original theory (mine, going in):** `camera.matrixWorld` is stale when `csm.updateFrustums()`/`csm.update()`
read it, because nothing in the normal per-frame loop calls `camera.updateMatrixWorld()` before `environment`'s
`update()` runs, so a `setCamera()` teleport would leave CSM's cascade frustums built from a mismatched view
matrix.

**This theory is disproven.** I instrumented the exact repro sequence (`tools/critic.mjs`'s call pattern: stage
a preset, capture, repeat) via scripts built on `tools/shot.mjs`'s `openApp`/`stage`/`capture`, dumping
`camera.matrixWorld` and every piece of CSM state at each step:

- `camera.matrixWorld` is **never** stale at the moment `csm.update()`/`updateFrustums()` read it, in either
  the clean or the broken state (recomputed and diffed against a fresh `camera.updateMatrixWorld()` call each
  time - zero divergence, in the broken state included).
- `csm.maxFar`, `csm.breaks`, and every material's live shader uniforms (`shadowFar`, `cameraNear`,
  `CSM_cascades`) are bit-identical between a clean render and a broken render of the *same* camera pose (only
  session history differs). Confirmed by reading `csm.shaders`' cached uniform objects directly, not just the
  JS-side breaks array.
- The compiled WebGL program (`renderer.properties.get(material).programs`, its `cacheKey`) is identical between
  the clean and broken states for the same material - no shader recompilation, no light-count define change.
- Disabling `castShadow` on all three CSM lights does **not** fix the broken look (buildings stay pale) - though
  note this test also zeroes their `RE_Direct` contribution entirely in this three.js CSM addon's `CSM_FADE`
  shader path, so it isn't a clean isolation of "shadow content" on its own.
- **Decisive test:** bypassing `effects`' composer entirely (`ctx.setRenderFn(null)`, i.e. plain
  `renderer.render(scene, camera)`) is **always clean**, at every camera pose and after any amount of session
  history. Routing the exact same scene/camera/light state through `EffectComposer` (even with GTAO, the Grade
  pass's AO term, Bloom, and SMAA all individually disabled - down to just `RenderPass` doing the beauty pass into
  its offscreen HDR target) reproduces the broken look. Toggling any *one* of GTAO/Grade/Bloom/SMAA off and back
  on does not clear an already-broken frame; toggling all four together does, and so does merely re-issuing
  `composer.setSize()` at the *same* width/height (no pass toggling at all) - i.e. forcing `effects` to
  reallocate its `sceneRT`/`pingRT`/depth-texture render targets reliably clears the bad state, and the fix
  persists through further camera/time changes in the same session.
- Only `MeshPhysicalMaterial` surfaces with a real envMap/clearcoat term (buildings' `plastic:*` materials) show
  the effect; `terrain:*`/road materials, which go through the identical CSM/shadow/uniform path in the same
  frame, do not - consistent with the corruption living in a render-target/color pipeline stage that especially
  flattens glossy, IBL-heavy surfaces, not in anything `environment` computes per-material.

**Conclusion:** the bug is in `src/effects/`'s `EffectComposer`/render-target plumbing (`buildComposer()`/
`render()` in `src/effects/index.js`), most likely a stale or under-invalidated GPU resource in the
`sceneRT`/`pingRT`/`depthTexture` chain (or one of GTAO/Bloom/SMAA's own internal render targets) that a
`composer.setSize()` call flushes. I was not able to pin the exact line before running out of productive avenues
that stay inside `environment`'s remit - the mechanism doesn't depend on which of GTAO/Grade/Bloom/SMAA is
enabled, only on having gone through the composer's render-target detour at all, which rules out any single
pass's own shader/material as the sole cause and points at the composer's target/buffer bookkeeping itself
(`EffectComposer.renderTarget2` being swapped for `sceneRT` at construction, the manual `readBuffer`/`writeBuffer`
pin every frame in `render(dt)`, and each pass's own internal targets are all candidates worth a closer look by
whoever owns `effects`).

**Mitigation applied (in `src/environment/index.js`, self-contained, no `effects` edit):** `updateCascades()`
already detects a real camera-distance/pitch step (its own `cascadeKey` changing, i.e. exactly a
`setCamera()`/preset-style teleport, not continuous drag/zoom noise). On that transition it now also calls a new
`kickEffectsRenderTargets()`, which looks up the already-loaded `effects` module via `ctx.modules.get('effects')`
and calls `getComposer().setSize(w, h)` at the current canvas size (tracked from the shared `resize` event,
which `environment` already subscribed to). This forces `effects` to redo the same render-target reallocation
that manually fixed every repro case, throttled to at most once per 250ms so it can't fire on every frame of an
interactive zoom/pan. Verified via the full `overview/skyline/street/aerial/closeup x 6.5/12/18/21.5` matrix
(`node tools/critic.mjs --game --round 2`) - 20/20 shots clean, zero console errors, minFps 60.4 / maxGpuMs 15.82
/ maxDrawCalls 774, all within the ARCHITECTURE.md §0 budget with margin.

**Minimal proposed diff for `effects` (not applied - outside this module's folder):** whoever owns `src/effects/`
should instrument `buildComposer()`/`render()` the same way (dump `sceneRT`/`pingRT`/`depthTexture` GL object
identities and GTAO's `pdRenderTarget` across the same repro sequence) to find what's actually going stale, then
either fix the underlying reallocation/invalidation bug or make the workaround above unnecessary by having
`effects` itself detect and self-heal the condition (e.g. re-touch its render targets on `camera:changed` for a
large-enough pose delta, which is effectively what this module's `kickEffectsRenderTargets()` does from the
outside). Once that lands, `kickEffectsRenderTargets()` and its call site in `updateCascades()` here can be
deleted.

## 2. [CRITICAL, FIXED] Weather (rain/fog) + steep-pitch long-range cameras (`overview`/`aerial`) washed the whole
city to flat pale grey - root cause confirmed in `environment`'s fog density formula, not `effects`

**Where reported:** whole-game critic rounds 1-3 (`docs/reviews/game-r1.md` through `game-r3.md`), round 3's
issue #1 - decisively isolated to "(weather=rain or fog) AND (steep camera pitch)", reproducing on a completely
fresh page load with zero camera/session history, and NOT fixed by either round 2's `effects` `sceneRT`
restructuring or round 3's persistent-PMREM fix (neither touches weather-dependent state).

**Investigation:** built a controlled A/B harness on `tools/shot.mjs`'s `openApp`, pausing `ctx.clock` immediately
after load (`ctx.clock.paused = true`) - an earlier, unpaused round of the same experiment gave contradictory
results because the running clock kept re-firing `applyTod()` and clobbering every manual override mid-test.
With the clock genuinely frozen, forced every weather-driven scalar `environment` computes (fog density, fog
colour, CSM `shadow.radius`, hemisphere light, `renderer.toneMappingExposure`, `scene.environmentIntensity`, sun
colour/intensity) back to its clear-weather value one at a time on the exact `overview` + `rain:0.7` repro. Only
**fog density** mattered: reverting every other variable and leaving density alone still washed the frame; leaving
every other variable at its rain value and reverting density alone (`0.0015675` -> `0.00025`) fully restored a
crisp, legible city. A follow-up sweep (`0.0015675, 0.0012, 0.0010, 0.0008, 0.0006, ... 0.00025`) found a sharp
cliff between `0.0010` (still washed) and `0.0008` (clean) at `overview`'s ~1246m camera-to-target distance.
Also confirmed via `ctx.setRenderFn(null)` (bypassing `effects`' composer entirely) that the wash reproduces with
plain `renderer.render(scene, camera)` too - this was never an `effects` bug for this trigger.

**Root cause:** `S.fog.density = 0.00025 + 0.0005*wf.cloud + 0.0012*wf.rain + (wf.fog>0 ? 0.003+0.013*wf.fog : 0)`
was tuned and validated only at street-scale distances (tens of metres), where even its heaviest "fog" value
(~0.0127) looks appropriately misty (round 1 confirmed "street + fog:0.7 looks good"). `FogExp2`'s factor is
`1 - exp(-(density*dist)^2)` - quadratic in distance, so the same density that is barely perceptible at 50m is
essentially fully saturated (fogFactor -> 1, i.e. every pixel = flat fog colour) by ~800-1000m. `overview`/`aerial`
sit at ~1200-1300m camera-to-target distance with a steep, top-down pitch that fills the ENTIRE frame with that
saturated-range geometry (no close, richly-coloured foreground to anchor the eye, unlike `skyline`'s shallow pitch
or `street`'s short range), so the whole image reads as a uniform wash with only anti-aliased silhouette edges
(the "toothpick" slivers) surviving. This is a real formula bug, not "aggressive but correct" atmosphere tuning -
confirmed by the sharp cliff at a single scalar's value with every other variable held constant.

**Fix (in `src/environment/index.js`):** `applyTod()` now computes the weather-desired density into `S.fogRho0`
(a pure function of weather, unaware of the camera) instead of writing `ctx.scene.fog.density` directly.
`update()` then clamps the *live* density every frame: `S.fog.density = min(S.fogRho0, FOG_CAP_K / max(D, 1))`,
where `D` is the same camera-to-target distance `updateCascades()` already derives and `FOG_CAP_K = 0.9` keeps the
fog factor at the camera's own current reach under ~0.55 (surfaces never lose more than ~55% of their colour to
fog, regardless of weather intensity or distance). At street/closeup range (`D` of tens of metres) the cap
evaluates far above the weather formula's natural maximum, so the validated close-range "misty rain"/"fog rolls
in" look is completely untouched; at `overview`/`aerial` range it pulls the density back into the pre-cliff,
legible zone. Verified: `node tools/critic.mjs --game --round 4 --dir shots/game/r4` (20/20 shots, zero errors,
minFps 54.9/maxGpuMs 17/maxDrawCalls 774) plus a dedicated `overview`/`aerial` x {6.5,12,18,21.5} x {rain:0.7,
fog:0.7} sweep (16/16 shots, zero errors, minFps 83.6) - all clean, legible, and appropriately atmospheric at
every tod, both weather kinds, both presets.

**Perf regression (round 3's issue #2) - investigated, NOT in `environment`:** round 3 found `street`/`closeup`
dropping below the 50fps floor at dawn/night and speculated it might be `environment`'s PMREM regen cadence.
Profiled every module's `update(dt, ctx)` cost directly (wrapped each `rec.module.update` from outside via
`ctx.modules`, no source changes) over several seconds at `street`+tod 6.5: `environment`'s own `update()` cost is
negligible (~30 microseconds/frame average, no spikes at all). The actual spike - reproduced consistently,
500-600ms stalls roughly every 2.5s - is entirely inside `buildings`' `update()` (`autoGrowthPass()` /
`S.batcher.flush()`, the periodic auto-growth mesh rebuild), unrelated to this round's fog fix or to any prior
`environment`/`effects` change. Left unfixed here (outside `environment`'s folder) but the root cause is now
identified precisely for whoever owns `buildings/`.
