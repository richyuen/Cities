# Visual reference rubric — "Lego Skylines"

No copyrighted reference screenshots are stored in this repo. If images are placed in `docs/reference/`, critics and judges
must use them. Otherwise score against this rubric, which describes the target look concretely.

## The look
1. **Everything is bricks.** Ground is a sea of baseplates with visible studs (pitch 0.8 m in-world). Buildings are stacked bricks,
   plates, slopes, windows and doors in official Lego colours; roofs have studs or are tiled smooth. Roads are dark-grey road plates
   with printed white/yellow markings and stud shoulders. Trees are Lego trees (stacked leaf elements, brown trunk cylinders).
   Cars are 4–6-stud-wide Lego cars with transparent windscreens and round headlight elements.
2. **ABS plastic PBR.** Glossy clearcoat, roughness ≈ 0.3–0.4, saturated albedo, slight edge bevels catching highlights. Reflections
   of the sky in flat plastic surfaces. No pure-colour flat shading. Transparent elements are real transmissive plastic.
3. **Physically plausible light.** One sun with sharp, correctly-oriented shadows, sky-blue fill from above, warm bounce from ground,
   ACES tone mapping, exposure that tracks sun elevation. Golden hour is orange with long shadows; noon is bright with short shadows;
   night is deep blue with warm window and streetlight pools, bloom on emissives, headlights on cars.
4. **Atmosphere.** Aerial perspective: distant objects desaturate toward sky colour; light haze; god rays at low sun are a plus;
   weather (rain streaks, wet roads with reflections, fog) when enabled.
5. **A living city.** Traffic flows on lanes, stops at intersections, cars turn with plausible steering. Minifig-scale props on
   sidewalks: lamps, benches, signs, hydrants, bins. Windows light up as evening comes. Nothing pops in visibly.
6. **Composition of a real city.** Dense downtown with tall towers, mid-rise commercial strips, low-rise suburbs with gardens,
   an industrial zone with chimneys and tanks, parks with paths, a waterfront. Roads form a plausible grid + arterials + a highway.

## Scoring
| score | meaning |
|---|---|
| 10 | Indistinguishable from a shipped AAA Lego city game |
| 8.5 | AAA quality with nits (pass) |
| 7 | Good indie: right idea, clearly lower fidelity |
| 5 | Programmer art: flat colours, no shadows, boxes |
| < 3 | Broken or empty |

Deductions (guidance): missing studs on Lego surfaces −1; visible z-fighting/gaps −1; flat/unlit materials −2; wrong sun/shadow
direction −1; night with no emissive life −1.5; console errors → automatic fail; over perf budget → automatic fail.
