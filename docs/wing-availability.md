# Wing availability audit

The production planner and every hard validator were run on 576 requests: ordinary and large villas, six plots, Ground through G+3, four requested wing families, and seeds 1, 41 and 100.

489 requests build a valid plan of the requested family. The other 87 are blocked. No different family is accepted as a valid substitute. This is a bounded fixture audit, not a guarantee for arbitrary room programmes or structural certification.

| Typology | Plot (m) | Twin wings | U wings | Courtyard wings | Pavilion |
|---|---|---:|---:|---:|---:|
| villa | 18 × 24 | 9/12 | 9/12 | 9/12 | 0/12 |
| villa | 24 × 30 | 12/12 | 12/12 | 12/12 | 12/12 |
| villa | 30 × 40 | 12/12 | 12/12 | 12/12 | 12/12 |
| villa | 40 × 60 | 12/12 | 12/12 | 12/12 | 12/12 |
| villa | 30 × 24 | 12/12 | 12/12 | 12/12 | 0/12 |
| villa | 24 × 40 | 12/12 | 12/12 | 12/12 | 12/12 |
| large-villa | 18 × 24 | 9/12 | 9/12 | 0/12 | 0/12 |
| large-villa | 24 × 30 | 12/12 | 12/12 | 12/12 | 12/12 |
| large-villa | 30 × 40 | 12/12 | 12/12 | 12/12 | 12/12 |
| large-villa | 40 × 60 | 12/12 | 12/12 | 12/12 | 12/12 |
| large-villa | 30 × 24 | 12/12 | 12/12 | 12/12 | 0/12 |
| large-villa | 24 × 40 | 9/12 | 12/12 | 9/12 | 6/12 |

## Repairs

- Wing halls reserve 1.5 m so gallery openings fit between columns and jamb clearances on ordinary villas.
- Pavilion filler galleries preserve the minimum width of requested rooms when the side block ends off the column grid.
- Overloaded wings can exchange whole movable room groups and optional extras. Entry, stair, living location and staff/utility grouping remain fixed.
- Failed seed searches retry a deterministic shared range of the same family; the passing seed is saved for exact replay.
- Unavailable explicit families carry a hard validation finding, so capacity and Directions cannot accept an unrelated rectangular fallback.
- Auto capacity on large plots checks the actual wing planner rather than rejecting through the compact bar packer.

## User choices

Style offers Auto, Twin wings, U wings, Courtyard wings and Pavilion. Each family is generated and validated against the current brief before enabling its button. Legacy rectangle/L/courtyard values still load.

## Brief-to-3D shape check

Brief → Style now presents these as **Villa layout** cards with descriptions and
visible reasons for blocked choices. Editing the layout clears the previous
direction and produces a new authoritative plan. Exterior-only regeneration
preserves the selected plan.

Production `generateAlternativeDesign()` now reports the family of the actual
source plan. Previously it cycled 15 family labels by seed even though occupied
geometry stayed fixed. Research roof recipes remain available in the separate
reusable massing library; they are not evidence of production shape diversity.

Four 24 × 30 m ordinary-villa fixtures, all plan/exterior seed 41, were generated
through the production adapter and Blender. All have different occupied
footprints and evaluated vertex sets. White-clay aerial views show their real
court/gallery geometry; U wings and pavilion still have similar street
silhouettes. Two more Blender scenes reuse the identical U-wing plan with
exterior seeds 1 and 2: their facade vertices differ, but their occupied
footprint is identical and the existing five-part mesh metric is **99.97%
similar**. This is not a fundamentally different building concept.

The 100-plan-per-family 40 × 60 m large-villa gallery was also audited using
union perimeters of occupied floor plates (not room IDs, materials or rectangle
decomposition). It contains:

| Family | Distinct room layouts | Distinct occupied building outlines |
|---|---:|---:|
| Twin wings | 100 | 8 |
| U wings | 100 | 4 |
| Courtyard wings | 100 | 3 |
| Pavilion | 100 | 3 |

Those 400 layouts must not be described as 400 different exterior silhouettes.
Broader silhouette variation requires more validated source-plan compositions;
changing only an exterior seed preserves the occupied geometry by design.

Reproduce the checks from the repository root:

```powershell
node --experimental-strip-types scripts/review-wings.mjs
node --experimental-strip-types scripts/review-wing-geometry.mjs
& '.\output\tools\blender-4.5.14-windows-x64\blender.exe' -b --threads 4 --python-exit-code 1 --python blender/review_wings.py
node --experimental-strip-types scripts/review-wing-geometry.mjs --measure
```

`output/wing-geometry-review/index.html` contains the clay comparisons;
`report.json` records union outlines, evaluated vertex comparisons and actual
mesh similarities. Outputs are local generated artifacts, ignored by Git.
The Blender review adds a complete top projection because the existing roof
metric samples only geometry above the occupied roof datum and misses court
holes. Neither measurement reads colours or materials.

Verification: 239 app tests, TypeScript/production build, lint (two existing
warnings), six Blender input suites (nine checks each), and saved Blender/GLB
runtime checks for all six scenes passed. The automated brief-state test also
checks pin invalidation and four distinct occupied 3D shapes.
