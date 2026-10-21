# Continuous walkthrough scene generation

Implemented as a downstream BuildingModel consumer. The 2D planner, exterior
generator, accepted seed, BOQ, finish resolver and panorama pipeline are unchanged.
AI Interior now has an explicit **Prepare house geometry** action below the
panorama. It builds the source shell and reports its state; no walking viewer,
movement controller or extra canvas is introduced in this phase.

## API and files

```ts
const shell = buildWalkthroughScene(currentBuildingModel, currentResult.report)
if (shell.status !== 'unsupported') {
  const { group, dispose } = createWalkthroughSceneGroup(shell)
  // A future R3F viewer can attach group directly. Call dispose when released.
}
```

| File | Responsibility |
| --- | --- |
| `src/lib/walkthrough/sceneTypes.ts` | Versioned source solids, global surfaces, floor/room/opening/stair/connection records and stable IDs |
| `src/lib/walkthrough/scene.ts` | Complete source shell, source validation, wall deduplication, apertures, plate unions/cuts, structure, topology and diagnostics |
| `src/lib/walkthrough/stairs.ts` | Strict source dog-leg nosing interpretation, rise/going, two flights, landings and slab opening |
| `src/lib/walkthrough/surfaces.ts` | Exact exposed boundary of the source solid union; removes internal/duplicate coplanar faces |
| `src/lib/walkthrough/coordinates.ts` | Reused plan/Blender/glTF conversion and existing room-local conversion |
| `src/lib/three/buildWalkthroughScene.ts` | One GPU-ready Three group, identity floor groups, batched material roles, semantic surface ranges and explicit disposal |
| `src/components/interior/WalkthroughScenePreparation.tsx` | Lazy, explicit scene preparation and source review results |
| `scripts/test-walkthrough-scene.mjs` | Geometry, source parity, error handling, stair/Python parity and Three adapter validation |

The public scene is serializable. Rendering uses global **metres**:
`world = (planX, elevation, -planY) / 1000`, the existing Blender GLB convention.
Source records retain explicitly named `*Mm` fields for traceability. There is no
plot-centre translation, plinth lift, exploded-floor offset or per-room transform.
All render vertices are already in the common frame. Geographic north is not
inferred from local plan axes.

Geometry identity is `version + planId`; finish/furniture appearance remains a
separate downstream identity. The scene builder receives no Design or global
store and calls no generation, diversity, finish, cost or render action.

## Source geometry rules

- Floors use their actual elevations. Source slabs must match their floor's
  elevation/thickness and cover its declared footprint. Explicit non-void outdoor
  room rectangles supply balcony/verandah/terrace pads using that floor's recorded
  slab thickness. The original BuildingModel remains detached and unchanged.
- All slabs at a storey are unioned before meshing. Courtyards, shafts,
  double-height voids and the **incoming** stair opening are subtracted exactly
  using the existing `subtractRegions` / `intersectRegions` utilities. Rooms are
  labels/support references, not separately extruded closed boxes.
- The floor above supplies the ceiling below. Only uncovered lower-roof regions
  and explicitly described flat top-roof plates need additional caps. A top
  pitched/unknown roof is unsupported when BuildingModel does not describe its
  geometry. No replacement flat roof is inferred.
- Walls are processed from the building wall array once. Exact geometric duplicate
  records become one physical group with multiple source-ID aliases. Incompatible
  collinear overlaps are errors. Doors/windows need one source wall host and valid
  source vertical dimensions. Explicit heights are never silently shortened.
  Unspecified heights may use the opening policy serialized in the source floor;
  the result records that provenance. Full-height piers, sills and headers are
  exact wall rectangles minus those aperture rectangles.
- Window glazing is a zero-thickness source-sized plane in the aperture. Window
  frames, manufactured door leaves, hinges and hardware are not invented. Door
  nodes retain open/sliding/leaf metadata for a later interactive asset layer.
  Glazing render faces already hidden by an opaque face touching that plane are
  omitted to prevent glass/stair z-fighting; the complete source aperture remains
  unchanged in its opening record.
- Columns retain their source positions/sizes and full clear storey heights.
  Sized beams use their recorded width/depth and trim to source column faces,
  following the existing Blender `clear_beam` recipe. No legacy beam size is
  guessed when that information is absent.
- Flat roof parapets use the dimensions in `BuildingModel.quantityRules.roof` and
  actual source roof perimeter/courtyard edges. Balcony guards, double-height
  guards and rooftop headroom enclosures absent from source wall geometry are
  explicitly reported as incomplete; decorative recipes are not used to invent
  their locations or dimensions.

## Stair geometry and headroom

The adapter interprets the planner's **interleaved** two-flight nosing lines,
including N/S/E/W start orientation. It uses the same layout/opening interpretation
as `blender/geometry/stairs.py`, verified by executing that pure Python module in
the tests. It rejects missing orientation, irregular spacing, nonmatching flights,
unsupported nosings and insufficient turning landing extents.

Riser height is source floor height divided by the two source flight counts.
Going is derived from the recorded nosing spacing. The far turning landing is
preserved; the final return step is the retained destination floor slab landing.
The slab opening retains the entrance-edge source strip rather than deleting
the entire stair rectangle. Destination floors must have the matching elevation.

The new shell uses the **waist and landing thicknesses serialized in quantityRules**.
Its steps have connected stepped undersides. This is deliberately different from
the existing exterior Blender renderer's floor-filled stair blocks: those display
blocks can seal the space below the next flight. Blender currently also hardcodes
a 180 mm turning landing; this shell uses the source landing thickness (currently
150 mm in the baseline). The existing exterior pipeline is not changed in this
phase. Nosing positions, tread tops, landing footprint and slab opening are parity
checked; underside solids are not claimed to be identical to that legacy display.

Headroom records sample every tread/landing centre against actual overhead source
solids, including beams and upper flights. No overhead solid is recorded as null,
not a fabricated ceiling height. An obstruction through a sample is an error.
Samples are **not** a swept body, full-width clearance or statutory compliance
test. Guards, lateral body clearance, leaf/frame clearance and safe navigation
remain explicit later-stage work. A stair meeting the reveal or seen behind a
window is distinguished from a solid physically crossing the opening plane.

## One physical shell and stable semantics

The builder keeps source-aligned solids for structure and future collision work,
then computes only the exposed faces of their union. Wall intersections, columns,
beams, slabs and adjoining steps do not produce coincident visible meshes. It
does not use polygon offsets or shift architectural faces to hide z-fighting.

Surface IDs use floor/source identity, face plane and exact geometric extent,
not array index. Reordering input arrays preserves IDs and geometry. Rooms use
floor-scoped source identity, so `stair`/`hall` on different storeys never alias.
The Three adapter batches by floor/material role while retaining per-surface
index ranges and source-ID mappings. Group transforms remain identity. Glass
stays separate, and owned geometry/materials have an idempotent disposer.

Door links require explicit source room references on the actual boundary.
Windows never become passages. Stair links connect source landing spaces and
the actual destination floor/flat roof. An exterior upper doorway can connect to
a setback terrace only when that existing roof is at its finished floor elevation
and supports the doorway's full outside edge; partial support never creates a
bridge. Unconfirmed reachability is reported;
no closest-room bridge or connecting corridor is generated. This is architectural
topology, not pathfinding or a navigation mesh.

## Failure behaviour and remaining limits

`ready` means no recorded source issue; `needs-review` retains geometry with
explicit qualifications; `unsupported` returns **no renderable surfaces or solids**.
Source records and actionable diagnostics remain available. Invalid 2D reports,
unknown units, missing source dimensions, ambiguous hosts, malformed stairs,
incorrect joins, obstructed apertures and unsupported indoor floor gaps never
trigger source repair or architectural regeneration.

This layer does not include a walking controller, collision solver, animated door
leaves, product-specific frame/leaf assets, furniture attachment or room-specific
finish application to the complete shell. Existing room asset adapters remain
available for the next appearance stage. GPU materials here are a neutral study
palette. Pitched roofs require additional explicit BuildingModel roof geometry;
top-roof mumty walls/exit require source heights and openings. No tanks, pergolas,
PV or decorative facade masses are invented from missing source geometry.

## Validation

`npm run test:walkthrough` covers a validated generated 2D house plus focused source
fixtures: shared walls, exact apertures, courtyard/shaft/double-height holes,
one–four storeys, all stair orientations and Python parity, retained landings,
headroom obstructions, columns/beams, balconies, roofs, union face area/winding,
duplicate/internal face removal, stable IDs, invalid source rejection, immutable
inputs and the Three adapter's geometry/semantics/disposal. Existing interior,
furnished, BuildingModel and i18n regression tests and `npm run build` also apply.
