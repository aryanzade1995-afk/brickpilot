# Shared solar roof model

Stage 2 supplies a pure serializable geometry and access model. It does not place
panels or add interface controls, and it does not alter the building or cost.

## Calling the model

Use `buildSolarRoofModel(design, { architecture, inputs, policy, roofOpenings })`
from `src/lib/solar/index.ts`. Pass the current studio solar inputs explicitly:
an already generated design's model brief may predate a solar-only edit.

`architecture` is the accepted `buildingModel`, `massingModel`, `facadeGrammar`
and `villaDesignDNA` (the shape returned by `generateAlternativeDesign`). Roof,
massing and facade sources must match the current source plan and seed, and
have valid statuses. Without those details the roof remains uncertain and no
installation area is returned. This avoids assuming an empty roof before the
accepted facade and roof additions are known.

The output exposes source plan ID, geometric roof and allocation signatures,
coordinate convention, policy, orientation, surfaces, usable area and an area
budget. Nothing is inserted into BuildingModel, architectural fingerprints,
seed inputs or existing render cache keys.

## Surfaces and exclusions

Only explicitly supported flat top roofs (`flat-terrace`, `raised-parapet` and
`pergola-terrace` realized forms) can return `concept-usable`. Stair headroom
and slab representation must also match. A pergola-terrace form does not make
the pergola itself a supporting slab.

Lower stepped terraces, source balconies, composition/massing canopies, roof
envelopes and decorative frames/pergolas are classified separately and excluded.
Pitched roofs are unsupported. Missing, blocked or uncertain data receives a
reason, not a silently guessed placement.

Every surface has an exact disjoint union of source rectangles, holes, elevation,
outer/inner edges, connected components, obstacles and explained exclusions.
No bounding box substitutes for the slab union. The model subtracts source
courtyards, shafts and double-height rectangles. The last are conservatively
excluded even when Blender caps the upper ceiling; those caps are not established
installation surfaces. An explicitly represented skylight/opening can be passed
in `roofOpenings` with its level and plan rectangle. The existing building schema
does not currently supply a separate skylight catalogue; windows are not inferred
as roof openings.

Obstacles include actual headroom wall thickness, parapets, the full `tankBank`
tray/stand, roof masses, accepted facade and specialized roof geometry, and
composition canopies above the slab. Sparse overhead frames and shade slats
exclude their full projected envelope; perimeter parapet assemblies retain
their individual footprints rather than incorrectly blocking the entire roof.

Blender additionally populates terraces through `geometry.terrace_objects`.
`realizedTerraceObjects` mirrors that exporter's ordered free-rectangle algorithm
so loungers, the complete parasol canopy, benches and planters are excluded too.
Planting receives a conservative foliage envelope. The exporter is unchanged.
Direct parity tests compare positions and tank extents with the existing Python
helpers, guarding against future drift.

## Access and the independent solar policy

The modeled headroom exit is the exporter's 900 mm opening on the top stair's
`startSide` (N when absent). No ladder or independent access is invented.

Connectivity is computed in walking-centre space: slab edges are eroded and
obstacles expanded by half the route width. Thus a narrow neck or corner touch
cannot establish a full-width maintenance route. Reservations are also respected
by walking paths. Continuous corridors from the exit to candidate regions and a
tank-bank maintenance approach are protected from panels. Corridors are checked
against physical obstacles and actual slab support. Disconnected candidates
are excluded. Missing or blocked access returns zero usable installation area
with an explanatory uncertainty state.

The existing `TERRACE_LIMITS.minFreeRatio = 0.8` and its architectural validation
remain untouched. The separate validated solar policy uses editable concept
assumptions, currently 600 mm edge clearance, 300 mm obstacle clearance, 800 mm
access width and 30% minimum free fraction. These numbers are not regulatory or
engineering certification. An explicit input edge clearance takes precedence
over the policy default; physical parapets and obstacles remain excluded.

`usableRegionsMm` describes geometrically available, reachable rectangles after
obstacles, buffers, reservations and protected routes. It does not assert that
a particular panel fits. `accessibleClearAreaM2` counts reachable walking space
expanded back to a full-width footprint, clipped to the physical roof; inaccessible
islands cannot increase the budget. Reservations and inaccessible/blocked space
are outside that basis. `maxSolarFootprintAreaM2` caps usable allocation at
`min(usableArea, accessibleClearArea * (1 - minimumFreeFraction))`. It is an area
budget, not a fabricated carved-out region, panel count or energy estimate.
The placement stage must enforce both geometry and this budget.

Saved reservations may target a stable surface ID, component ID, or a floor.
Unknown/stale floor or surface references fail closed and request review.

## Coordinates and signatures

Plan geometry uses millimetres, x right/local east, y down/local south and z up,
with z=0 at ground-floor FFL. These plan cardinal labels are not a surveyed
geographic orientation. `planNorthBearingDeg` stays null unless supplied; the
road side is never used to infer true north.

- `planToBlender` / `blenderToPlan`: unshifted Z-up metres `(x,y,z)/1000`.
- `planToThreeGlb` / `threeGlbToPlan`: accepted Blender GLB Y-up metres
  `(x,z,-y)/1000`, matching the exporter's axis conversion. No plot centering
  or extra plinth offset is applied.
- The legacy `buildMassing` study viewer separately centres the plot and uses
  plan-y as positive Three-z, with its own plinth datum. Do not use the GLB
  transform in that canvas without its explicit local transform.
- `trueAzimuthToPlan` subtracts the bearing of plan-up; `planAzimuthToTrue`
  adds it. Both preserve unknown north as null.
- `planToTrueNorthFrame` and its inverse rotate into a local east/north/up
  millimetre frame about the plan origin. They are not geodetic projections.

`roofSignature` describes the geometric roof/obstacles independently of solar
policy. `allocationSignature` includes that signature, source readiness, policy,
orientation and reservations. They are change tokens, not safety credentials.

## Verification and limitations

Run `npm run test:solar-roof` (Node and Python are needed for exporter parity).
The suite covers actual accepted architecture, unions/holes, stepped roofs,
expanded tanks, existing exporter furniture, disconnected/narrow connections,
missing/blocked access, reserved space, empty allocation and coordinate round trips.

This stage does not perform module packing, shading simulation, roof load,
wind, mounting, anchoring, electrical or waterproofing design. `concept-usable`
means available in the represented geometry under the selected assumptions.
Actual installation suitability remains unverified.
