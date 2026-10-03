# Approximate quantity take-off

**approximate; structural design by a licensed engineer required**

`src/lib/cost/quantities.ts` measures the existing `Design.floors`; it never
replans rooms. `calculateQuantities` is an uncached pure function.
`measureDesign` caches up to 16 content signatures, detects in-place changes,
and returns frozen results. Seeds, colours, prices and cached area statistics
do not invalidate quantities. Room geometry/names/types, grids, shafts, stairs,
occupants, plot, compound-wall choice and relevant technical specifications do.

Each floor and the total have `items` containing IFC-style `NetVolume` (m³),
`NetSideArea` (m²), `NetArea` (m²), `Length` (m), `Count`. Concrete member lists
keep source IDs; `steelKg` and `formworkM2` are separate by member category.
`flooring` is a summary: do not add it to its per-room breakdown.

## Shared concept sizing

`engine/structuralSizing.ts` derives `Design.structuralSizing` and per-floor
metadata from existing column centres, beam spans and floor plates. Rules live
in Zod-validated `cost/data/quantity-rules.json`. Column dimensions are reserved
before openings are placed, and the existing hard check uses the actual size.

Column position is classified using occupied quadrants around its grid point.
Beam depth is span/12 rounded **up** to 50 mm, with a configured minimum. Slabs
are 125 or 150 mm according to the longest beam span, or the short plate span
on legacy plans without beams. Footing allowances vary with storeys and explicit
soil choice. A finish preset cannot choose the soil class or flood level: all
three default to unknown soil and a 450 mm plinth. Explicit technical overrides
are respected. Future floors require a new structural design; this estimate
sizes only the floors actually drawn.

## Measurement conventions

- RCC includes a ground/plinth floor plate, each intermediate plate, exposed
  lower roofs and a top roof. Rectangular unions avoid counting overlapping
  footprint rectangles twice. Courtyard/double-height/stair/shaft voids are
  clipped to the plates. Intermediate stair entrance landings remain.
- Columns extend to the slab soffit; beams use clear spans between column
  faces and depth minus slab thickness. Ground-column pedestals extend from
  footing top to ground slab soffit. Plinth beams also use clear spans.
- Excavation and PCC footprints include configured working space and PCC
  projection. Backfill excludes PCC and below-grade RCC. Filling excludes
  columns and plinth-beam volume. Excavation pits are unioned.
- Masonry uses actual 230/115 mm (or legacy) wall thickness and deducts the
  union of openings, columns, beams and lintels. Plaster/paint include RCC
  faces, less openings. Wet tiles and kitchen dado are separate finishing
  quantities; do not purchase paint for tiled faces without specification review.
- Stairs use two inclined waist slabs, triangular step concrete and a turning
  landing. The top stair serves the usable terrace. Railing factors, glazing
  fraction, grills and MEP points are configurable allowances, not designs.
- Default terrace edges are solid parapets; an extra terrace railing is not
  counted. Roof waterproofing deducts service/stair openings. Lower-roof edge
  railings and decorative Blender-only assemblies require a separate schedule.
- M20 materials use the requested 1.54 dry-volume factor and nominal 1:1.5:3
  arithmetic. M25/M30 return `null` for material conversions; approved mix
  designs are needed. PCC is scheduled separately, not treated as M20 RCC.
- Masonry piece counts use configured brick/block sizes including joint
  allowances. Tank capacities use occupants, storage days and rounded litres.

The nominal/design-mix distinction is documented in
[CPWD Specifications 2019, Volume 1](https://pwd.py.gov.in/sites/default/files/cpwd-specs2019v1.pdf).
Sizing, steel kg/m³, material yields and points in this app are **planning
assumptions**, not CPWD structural design rules or an engineering certification.
Overlapping pads, boundary foundations, soil capacity and load combinations
must be resolved by the structural engineer. No automatic piling design exists.

## Pricing

Detailed quantities are available separately from rates. The current concept
BOQ retains its existing area allowance for structure and services; it does
not also charge measured concrete, steel or points. Converting this allowance
to member-priced BOQ needs item rates and a deliberate replacement, not an
additional charge. Geometry, quantities, specifications and rates stay separate.
