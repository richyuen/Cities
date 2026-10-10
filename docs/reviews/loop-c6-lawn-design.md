# loop-c6 lawn design (E1 for lever A2): sparse-stud "tiled lawn" behind `?lawn`

Read-only Plan pass at `c14a8d0`, 2026-10-03. Condensed by the orchestrator; code blocks are the design's own, verbatim.
Nothing was run on the GPU: the GLSL is untested, reference densities are +-40% estimates from stud-blob counts, and the
stale building mask is from code reading only.

## Decisions
- **Carrier:** a 256x256 RGBA8 repeat texture read with `texelFetch`. The CPU keep rule reads the same bytes, so CPU and GPU agree by construction. No integer hash in GLSL.
- **Scope:** one global rule for every terrain-drawn stud. Tile seams and tone apply to every dry, in-map, up-facing ground fragment (not gated by the stud mask).
- **Mask:** `S.studMaskTex` keeps today's 0/255 meaning.
- **`?lawn=0`:** today's code path, split at JS level: shader strings, uniform set, cache key and stud buffers untouched.
- **Flag absent:** `lawn=1` (`sparse12`). `?lawn=2` (`scatter6`) and `?lawn=3` (`sparse12-flat`, no seams/tone) are the A/B variants.
- **Cross-module dependency:** `roads/index.js markFootprint()` re-emits terrain studs at full density on road-cell verges; without a 2-line fix every road gets a dense stud hem beside the sparse lawn.
- **Seed-independent** pattern (an art asset; fixed salt allows golden checksums).
- **No runtime toggle:** A/B through `--param lawn=N` on fresh boots.

## Reference ground (measured on the five references)
- Density 7-30 studs per 100 stud cells; lawns specifically 8, 17, 18. Never a full grid.
- Singles and adjacent pairs; no rows, no cluster larger than 2; about a third of studs have a 4-neighbour.
- Tiles 1x1, 1x2, 2x2, a few 2x4 (stud units). Seams are 1-2 px dark lines, about 7% darker than the tile at mid distance.
- Colour: three greens in close-up plus +-5% between neighbours; about +-4% at mid distance.
- Scale caveat: our pitch is 0.8 m against a 1.7 m figure (2.1 cells per figure height; references about 5), so our studs look about 2.35x larger relative to figures: argues for the low end of the density range.

Texture metric (falsifier): `hp/L` = RMS of (L minus its 9x9 box mean) / mean L; `dark` = fraction of pixels below 0.85x the local mean.

| source | box (x, y, wxh) | hp/L | dark |
|---|---|---|---|
| ref ss_b3e4 lawn | 1660, 965, 200x90 | 0.092 | 7.7% |
| ref ss_f6da lawn | 60, 990, 150x70 | 0.120 | 6.4% |
| ref ss_1522 paving | 340, 640, 230x110 | 0.112 | 8.7% |
| ref ss_0875 close-up lawn | 20, 960, 180x100 | 0.150 | 15.0% |
| ours 01 background lots | 20, 160, 140x60 | 0.246 | 25.1% |
| ours 03 near field | 640, 720, 240x60 | 0.236 | 24.7% |
| ours 04 background lots | 160, 250, 300x40 | 0.215 | 21.4% |
| ours 05 right field | 1500, 720, 380x280 | 0.227 | 24.4% |
| ours 05 far strip | 1300, 610, 300x30 | 0.315 | 38.3% |
| ours set-piece deck lawn 01 / 04 | 880, 820, 180x80 / 880, 960, 200x80 | 0.148 / 0.113 | 15.2% / 7.8% |

(ours = shots/beauty/c6h5; boxes include a few non-ground pixels, re-pick pure-ground boxes.)

## Which land
Plain unbuilt ('none', dry), zoned-empty lots, parks, hills/rock/sand plates: tiles + sparse studs (one rule, no colour state in the mask).
Road-cell verges: tiles from the terrain shader + sparse studs via `terrain.api.studKeep` in roads' infill.
Building cells (yards): tiles only, no terrain studs. Seabed (y < 0) and outside the map: nothing.
Other modules' studs (sidewalks, roofs, decks, zoning plates): unchanged.

**Stale building mask:** `world.addBuilding`/`removeBuilding` (`src/core/world.js:867, 883`) change `cell.type` without emitting `world:cell`; terrain subscribes only to `terrain:changed`, `world:cell`, `settings:changed`. So building cells keep a mask of 255 and get far relief studs while near real studs are absent. In lawn mode only, terrain subscribes to `building:spawned`/`building:removed` and refreshes mask + stud cache over the footprint (not under `lawn=0`, which must stay identical to today).

## Keep rule: new file `src/terrain/lawn.js` (pure, no THREE) - this exact text produced the goldens

```js
export const LAWN_N = 256, LAWN_BIAS = 4096;      // period in stud cells (204.8 m); bias is a multiple of N
export const LAWN_VARIANTS = {
  1: { name: 'sparse12', studP: 0.085, seamDark: 0.30, seamHalf: 0.04, tone: 0.30 },
  2: { name: 'scatter6', studP: 0.16, seamDark: 0.30, seamHalf: 0.04, tone: 0.30 },
  3: { name: 'sparse12-flat', studP: 0.085, seamDark: 0, seamHalf: 0.04, tone: 0 },
};
const SALT = 11, P22 = 0.30, PPAIR = 0.80;
const TONES = [128, 128, 128, 104, 104, 168, 168, 92];   // mean 127.5 -> mean tone factor 1.0
export function lawnHash(x, y, s) {
  let h = (Math.imul(x, 0x9E3779B1) + Math.imul(y, 0x85EBCA77) + Math.imul(s, 0xC2B2AE3D)) | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D);
  h ^= h >>> 15; h = Math.imul(h, 0x846CA68B);
  h ^= h >>> 16;
  return h >>> 0;
}
/** RGBA per cell: R keep (0/255), G tone, B seam bits (1 = -x edge, 2 = +x, 4 = -z, 8 = +z), A 255. */
export function buildLawnPattern(studP) {
  const N = LAWN_N, own = new Int32Array(N * N).fill(-1), out = new Uint8Array(N * N * 4), tiles = [];
  const at = (i, j) => j * N + i;
  const free = (i, j) => i < N && j < N && own[at(i, j)] < 0;       // tiles never cross the period edge
  const put = (i, j, su, sv) => { for (let b = 0; b < sv; b++) for (let a = 0; a < su; a++) own[at(i + a, j + b)] = tiles.length; tiles.push(i, j, su, sv); };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {          // pass 1: 2x2 tiles
    if (free(i, j) && (lawnHash(i, j, SALT) & 0xffff) < P22 * 65536 && free(i + 1, j) && free(i, j + 1) && free(i + 1, j + 1)) put(i, j, 2, 2);
  }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {          // pass 2: pairs (orientation by hash bit), then singles
    if (!free(i, j)) continue;
    const h = lawnHash(i, j, SALT + 1), wide = (h >>> 16) & 1;
    let su = 1, sv = 1;
    if ((h & 0xffff) < PPAIR * 65536) {
      if (wide ? free(i + 1, j) : !free(i, j + 1) && free(i + 1, j)) su = 2;
      else if (free(i, j + 1)) sv = 2;
    }
    put(i, j, su, sv);
  }
  for (let t = 0; t < tiles.length; t += 4) {                        // at most one stud per tile, chance grows with area
    const i = tiles[t], j = tiles[t + 1], su = tiles[t + 2], sv = tiles[t + 3];
    const h = lawnHash(i, j, SALT + 2), area = su * sv;
    const stud = ((h >>> 3) & 1023) < Math.min(1024, Math.round(studP * area * 1024)), pick = (h >>> 13) & (area - 1);
    for (let b = 0; b < sv; b++) for (let a = 0; a < su; a++) {
      const o = at(i + a, j + b) * 4;
      out[o] = stud && a + b * su === pick ? 255 : 0;
      out[o + 1] = TONES[h & 7];
      out[o + 2] = (a === 0 ? 1 : 0) | (a === su - 1 ? 2 : 0) | (b === 0 ? 4 : 0) | (b === sv - 1 ? 8 : 0);
      out[o + 3] = 255;
    }
  }
  return out;
}
export const lawnIndex = (ix, iz) => ((((iz + LAWN_BIAS) & 255) << 8) | ((ix + LAWN_BIAS) & 255)) * 4;
// keep(ix, iz) = pattern[lawnIndex(ix, iz)] !== 0;   toneAt(ix, iz) = pattern[lawnIndex(ix, iz) + 1]
```

Lattice: `ix = round(x / 0.8)`, world-anchored (`world.minX / 0.8 = -1280`, `8 / 0.8 === 10`), so `ix = -1280 + 10*i + k`; the shader's `c = floor(p + 0.5)` is the same lattice.

**Goldens** (FNV-1a over the 262,144 bytes):

| variant | FNV | studs / 65,536 cells | density | studs with a 4-neighbour | first keeps in row 0 |
|---|---|---|---|---|---|
| sparse12 (1, 3) | 45ffee02 | 5,624 | 0.0858 | 19.5% | (2,0) (20,0) (26,0) (32,0) (40,0) |
| scatter6 (2) | db8ae529 | 10,501 | 0.1602 | 34.8% | (2,0) (12,0) (18,0) (20,0) (26,0) |

Tile shares by cells: 2x2 57.3%, 1x2 20.3%, 2x1 15.0%, 1x1 7.4%. Seam flags symmetric across every edge. Texel (0,0) = 0/128/15/255.

## GLSL: v3 replacement for the `#include <normal_fragment_maps>` block in `patchGroundMaterial`
Add `uniform sampler2D uLawnTex; uniform vec4 uLawn;` to the `<common>` block (x = seam darkness, y = seam half-width, z = tone amplitude).

```glsl
#include <normal_fragment_maps>
{
  vec3 nW = transformDirectionByInverseViewMatrix(nonPerturbedNormal, viewMatrix);
  float flatW = step(0.999, nW.y);
  vec2 p = vTerrainWP.xz / uStudPitch;
  vec2 c = floor(p + 0.5);
  vec2 d = p - c;
  float r = length(d);
  vec2 fwv = fwidth(p);
  float fw = fwv.x + fwv.y;
  vec4 lw = texelFetch(uLawnTex, (ivec2(c) + 4096) & 255, 0);
  // tiles: every dry, in-map, up-facing fragment (yards and road verges included; not gated by the stud mask)
  vec2 q = (vTerrainWP.xz - uMapMin) / uMapSize;
  float tileW = flatW * step(-0.005, vTerrainWP.y) * step(0.0, min(q.x, q.y)) * step(max(q.x, q.y), 1.0);
  if (tileW > 0.5) {
    float fmax = max(fwv.x, fwv.y);
    diffuseColor.rgb *= 1.0 + (lw.g * 2.0 - 1.0) * uLawn.z * (1.0 - smoothstep(0.20, 0.60, fmax));
    int bits = int(lw.b * 255.0 + 0.5);
    vec2 on = vec2(float((bits >> (d.x < 0.0 ? 0 : 1)) & 1), float((bits >> (d.y < 0.0 ? 2 : 3)) & 1));
    vec2 e = 0.5 - abs(d);                                   // distance to the nearest cell edge, per axis
    vec2 f = max(fwv, vec2(1e-4));
    vec2 ln = clamp((uLawn.y - e) / f + 0.5, vec2(0.0), min(vec2(1.0), 2.0 * uLawn.y / f)) * on;
    diffuseColor.rgb *= 1.0 - uLawn.x * max(ln.x, ln.y) * (1.0 - smoothstep(0.12, 0.40, fmax));
  }
  vec2 cw = c * uStudPitch;
  float m = tStudMaskAt(cw + vec2(0.01, 0.01)) * tStudMaskAt(cw + vec2(-0.01, 0.01))
          * tStudMaskAt(cw + vec2(0.01, -0.01)) * tStudMaskAt(cw + vec2(-0.01, -0.01));
  float dist = distance(vTerrainWP, cameraPosition);
  float lod = smoothstep(uStudFade.x, uStudFade.y, dist);
  float fade = 1.0 - smoothstep(0.55, 1.4, fw);
  float k = flatW * step(0.5, m) * lod * fade * step(0.5, lw.r);   // the only change to the stud relief
  if (k > 0.001) { /* body unchanged from v2 */ }
}
```

Seam: albedo groove, half-width 0.04 cells, darkness 0.30, no normal tilt. Tone factor `1 + (G*2 - 1)*0.30`. `fwidth` is the only seam AA (MSAA does not cover shader interiors); the four fade thresholds (0.12/0.40 seams, 0.20/0.60 tone) are first guesses to tune on frames 03 and 05. Cost: one texelFetch + about 30 ALU per ground fragment, no extra draws, one more texture.

## Variants and prediction
| flag | name | studs | seams + tone |
|---|---|---|---|
| lawn=0 | - | full grid | none (today) |
| absent / lawn=1 | sparse12 | 0.086 per cell, at most one per tile | on |
| lawn=2 | scatter6 | 0.160 per cell | on |
| lawn=3 | sparse12-flat | same bytes as 1 | off |

Prediction: judges rank 1 > 2 > 3 > 0 on 01, 04, 05; in 03 the variants are indistinguishable. Expected to remove the "stud lots" reason class in 01 and 04 and half of 05's (grass yes, kerb no); not expected to flip a pair alone.

## Edit list
Builder, `src/terrain/`:
1. `lawn.js` (new): the file above plus `createLawn(mode)` -> `{ mode, name, tone, pattern, fnv, studs, keep(ix, iz), toneAt(ix, iz) }`.
2. `shaders.js`: `makeLawnTexture(pattern, n)` (DataTexture RGBA/UnsignedByte, NearestFilter both ways, no mipmaps, flipY false, NoColorSpace). `patchGroundMaterial(mat, uniforms, lawn)`: with `lawn` null run today's body unchanged (same strings, key `terrain-ground-v2`); otherwise v3 strings and key `terrain-ground-v3-lawn` (variants differ only by uniforms). Assign `onBeforeCompile` once at init: environment's CSM sweep wraps the existing hook and key (`src/environment/index.js:279-293`); re-assigning later drops CSM.
3. `studs.js`: constructor accepts `lawn = null`. `_build`: `ix0 = Math.round(world.minX / STUD_PITCH)`, `iz0` likewise; inside the `k` loop before the four `topAt` calls: `if (lawn && !lawn.keep(ix0 + i * per + k, iz0 + j * per + l)) continue;`; push `lawn.toneAt(...)` into `rec.tone` (Uint8Array, null without lawn). `_rebuild`: multiply the instance colour by `1 + (rec.tone[k] / 255 - 0.5) * 2 * lawn.tone`. Without lawn, loop order and buffers unchanged.
4. `index.js`: flag next to `ctx.params.get('terrain')`: `const lp = ctx.params.get('lawn'); const mode = lp === null ? LAWN_DEFAULT : lp === '0' ? 0 : (LAWN_VARIANTS[lp] ? Number(lp) : LAWN_DEFAULT);`; `S.lawn = mode ? createLawn(mode) : null`. Uniforms `uLawnTex`, `uLawn = Vector4(seamDark, seamHalf, tone, 0)` only when lawn is on. Pass `S.lawn` to `patchGroundMaterial` and `new StudManager`. Only when lawn is on, subscribe to `building:spawned`/`building:removed`: `updateStudMask(b.i, b.j, b.i + b.w - 1, b.j + b.d - 1)`, `S.studs.invalidateRegion(same)`, `S.studDebounce = 0.25`. `api.studKeep(ix, iz)` -> `S.lawn ? S.lawn.keep(ix, iz) : true`; `api.lawn()` -> `{ mode, name, fnv, studs }`. Append `lawn=<mode>:<name> fnv=<fnv>` to the init log. Dispose the texture.

Orchestrator:
5. `src/roads/index.js`, `markFootprint` (infill loop ~285-308): before the loop `const keepStud = typeof tapi?.studKeep === 'function' ? tapi.studKeep : null;`; after the `covered/emitted` test `if (keepStud && !keepStud(Math.round(x / PITCH), Math.round(z / PITCH))) continue;`. Same lattice; a no-op under `lawn=0`.
6. `ARCHITECTURE.md` section 7 line ~183: "Built Blox surfaces (roofs, road shoulders, decks) carry full studs; ground plates are a tiled lawn (seamed tiles, sparse studs; `?lawn=0` restores the full grid)."
7. `docs/REFERENCE.md` lines 7 and 32 ("sea of baseplates with visible studs", "missing studs -1"): amend.

## Risks / how the critic falsifies
1. `lawn=0` identity: shot-list and game batch with `--param lawn=0` against the pre-lawn captures; only traffic repeat noise allowed.
2. Goldens: `terrain.api.lawn()` reports 45ffee02 / 5,624 (modes 1, 3) or db8ae529 / 10,501 (mode 2), identical across boots and seeds.
3. CPU/GPU agreement: same flat lawn top-down from 100 m at fov 10 (real studs) and 200 m at fov 5 (relief only); stud centres coincide; count in a 10x10-cell area equals `api.studKeep` hits.
4. Fade band: with 6-12x fewer studs the 40,000 budget stops binding, `effRadius` goes to 170 and `uStudFade` stays (130, 170); check flicker at 130-170 m while panning. `scatter6` sits close to the budget.
5. Perf: fragment cost does not drop; instances fall to about 12k (mode 1) / 23k (mode 2). Gate: gpuMs within +-0.3 ms of `lawn=0` same session, draws identical, textures +1.
6. Shadows/AO: long stud shadows and GTAO contacts mostly disappear; far mean brightness within about 3%.
7. Moire/shimmer: in 03 and 05 nudge yaw 0.05 deg and diff ground boxes; must not exceed `lawn=0`'s.
8. Texture metric: lawn 1 brings hp/L <= 0.15 and dark <= 12% on pure-ground boxes; `lawn=0` reproduces the table.
9. Road hem: without edit 5, frame 05 shows a full-density band between kerb and field.
10. Checks: check-atmosphere captures `terrain:closeup` (gates eye height/pitch only); check-beauty gates geometry; check-dof uses on/off ratios within one boot; check-detail unaffected; check-background percentages will not move. Terrain default/closeup/water presets all change and need looked-at PNGs; the seabed must show no seams.
11. Gameplay legibility: no cell lines today either; verify with `zone:r` and a road tool active.
12. Cosmetic limits: tiles bisected along plate-colour boundaries and 4 m sub-plate edges; terrain tiles (0.8-1.6 m) twice as coarse as the set-piece decks (0.4 m); a continuous seam every 204.8 m.
