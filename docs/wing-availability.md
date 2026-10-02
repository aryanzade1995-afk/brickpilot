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
