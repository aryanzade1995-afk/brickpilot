# Plan-preserving procedural massing

## Data flow

```text
existing validated Design
  -> createBuildingModel(design)                 BuildingModel v1
  -> createVillaDesignDNA(building, numericSeed) VillaDesignDNA v3
  -> MassingGenerator.generate(building, dna)    MassingModel v1
  -> ArchitectureValidator candidate gate          valid / rejected
```

The studio computes these models in `Result` and each `DirectionOption`.
They are plain JSON-serializable data. The existing Three.js view still uses
`buildMassing(Design)`; it does not consume `MassingModel` yet. This stage creates
no Blender scene, facade objects, materials, or exported GLB.

## Source of truth

`BuildingModel` copies the verified rooms, walls, doors, windows, stairs, columns,
beams, slabs, floor plates, plot, orientation and setbacks. It also keeps shafts
and support zones. Nothing in the new generator reruns the floor planner.

The chosen policy preserves every occupied floor plate and its floor height.
An L-shaped or courtyard proposal therefore needs that geometry in the source
plan. A rectangular plan cannot become a U-shaped occupied building through a
new seed alone. An incompatible requested family returns `status: 'rejected'`,
an empty `masses` array and an explanatory issue. There is no silent fallback.

Occupied masses start from room rectangles and merge adjacent volumes by their
program role. Upper floors, existing setbacks, wings, balconies and overhangs
come from the plan. Above the highest occupied floor, seeded roof envelopes
vary their grouping, heights (300–2000 mm), and side recesses across program
volumes. They remain inside their supporting plate and leave stair/shaft areas
clear. This produces different roof-volume compositions and elevation profiles
without relocating rooms. It does not promise every massing family for one plan.

## API

```ts
import {
  createBuildingModel, createVillaDesignDNA, MassingGenerator,
  assessMassingFamilies, validateMassing,
} from './src/lib/engine/index.ts'

// First pass the existing Design through the existing plan validation gate.
const building = createBuildingModel(design)
const dna = createVillaDesignDNA(building, 12345)
const options = assessMassingFamilies(building)
const massing = MassingGenerator.generate(building, dna)

// Explicit family request: rejected if the source plan cannot support it.
const courtyard = MassingGenerator.generate(building, dna, { family: 'COURTYARD' })

// Optional seeded selection among compatible families.
const automatic = MassingGenerator.generate(building, dna, { family: 'auto' })
```

The seed must be a safe integer. All choices use the existing `makeRng` PRNG,
salted by the source plan identity and pipeline stage. No time, global random
state, or `Math.random()` is used in these modules. Repeating the same building,
DNA and options produces byte-identical serialized output. As with any finite
seeded generator, uniqueness across every possible pair of seeds is not a
guarantee.

`VillaDesignDNA.massingFamily` is a seeded compatible family.
`sourcePlateFamily` retains the old planner's four-family identity. Upper-floor
coverage and offset remain measurements of the source plan. Massing currently
uses family, seed, block count and recess depth. The facade stage already uses
`architecturalFamily` and projection depth; other DNA fields record intent for
later roof-detail and Blender stages.

## Family eligibility

| Family | Required source geometry |
| --- | --- |
| `L_SHAPED` | Connected L perimeter |
| `U_SHAPED` | Two wings joined around an open recess |
| `COURTYARD` | Existing courtyard void |
| `OFFSET_BLOCKS` | At least 300 mm offset between floor-plate centers |
| `INTERLOCKING_BLOCKS` | Connected intersecting orthogonal wings |
| `STACKED_VOLUMES` | Multiple occupied floors |
| `STEPPED` | An upper setback exposing at least 1 m² below |
| `TWIN_WING` | Existing paired wings and a connection |
| `CANTILEVERED` | Existing upper overhang covered by a declared cantilever support zone |
| `TERRACED` | Upper setback exposing at least 6 m² and 15% of the lower plate |
| `LINEAR` | Ground plate aspect ratio of at least 2.4 |
| `CLUSTERED` | At least three separate volumes on a floor |
| `SPLIT_VOLUME` | Two separate volumes on a floor |
| `PAVILION` | Connected single-storey plan |
| `ASYMMETRIC` | Asymmetric perimeter or existing upper-floor offset |

These rules classify actual unions of rectangles, including components, holes
and perimeter turns. The current floor planner still has its original four
plate families. Synthetic geometry fixtures exercise the other compatible
topologies without adding a second residential planner.

## Mass contract and transformations

Each mass has the requested `id`, `floor`, `x`, `y`, `width`, `depth`, `height`,
`rotation`, `role` and `parentId`, plus `elevation`, `usage`, `sourceFloorId` and
`sourceRoomIds`. Usage distinguishes occupied envelopes (`enclosed`), unoccupied
roof envelopes (`roof`) and existing balcony slabs (`terrace`). Room IDs are
the plan's semantic IDs. All distances are millimetres. Elevation zero is the
ground-floor finished level; plan x increases east and y increases south.

The x/y coordinates locate the unrotated rectangle. Rotation acts around its
center and is restricted to 0/90/180/270 degrees, matching the orthogonal plan
engine. `massRect` returns the resulting world rectangle. Transforms that split
or resize bake the rotation into that world rectangle.

`transforms.ts` exports all requested pure operations:

- `splitMass(mass, axis, ratio)`
- `shiftMass(mass, dx, dy, dz)`
- `scaleMass(mass, sx, sy, sz)`
- `rotateMass(mass, degrees)`
- `stackMass(mass, height, gap)`
- `stepBackMass(mass, side, amount)` / `recessMass(mass, side, amount)`
- `extendMass(mass, side, amount)` / `cantileverMass(mass, side, amount)`
- `bridgeMasses(first, second, width)`
- `createWing(mass, side, length, depth)`
- `subtractCourtyard(masses, rect)`
- `createEntranceVoid(mass, cut)`
- `createDoubleHeightVoid(masses, rect, elevation, height)`
- `createTerraceCut(mass, rect, depth)`

Sides use N/S/E/W. Cuts return disjoint cuboids representing a real volume
difference. Inputs are never mutated. A transform is a geometric operation,
not permission to change the plan: callers must validate the resulting complete
mass list. For example, stacking requires binding the new mass to an existing
upper floor and its rooms; a cut through occupied space is rejected. Derived
IDs are stable, and callers composing repeated branches must assign unique IDs.

## Validation and tests

`validateMassing` checks positive finite dimensions, orthogonal rotation,
floor/room provenance, setbacks, parent links, roof support, core keepouts and
balcony placement. It compares the occupied union to the source floor at every
vertical transition; this detects partial-height cuts as well as whole-room
moves. The source 2D design must also pass the existing plan validation gate.

`massingSilhouetteSignature` compares actual union boundaries in front, side
and top projections. It excludes IDs, roles, seeds and materials, so splitting
or renaming an unchanged box does not count as a new silhouette.

### ArchitectureValidator gate

`ArchitectureValidator.validate(building, masses, limits?)` runs after the
existing 2D `validate(design).hardChecksPass` gate and before a candidate is
accepted for a future Blender export. It returns `{ valid, issues }`. Issues
have a category (`plot`, `rooms`, `floors`, `structure`, `openings`, `masses`, or
`balconies`), a stable code, a message, and source/mass IDs where available.

In addition to `validateMassing`, it checks exact coverage of each named room
through its full floor height, retained outdoor parking and circulation, room
reachability through the source doors, stair alignment, upper support, aligned
columns, beam spans, slab footprints, opening location and collisions, roof
support, thin fragments, positive volume intersections, balcony access, slab
coverage and configured cantilever depth. The default cantilever limit is the
existing planner's 1500 mm concept limit. Stair, wall, opening and room records
remain owned by the source plan.

`MassingGenerator.generate` uses `ArchitectureValidator.tryVariations` with up
to eight deterministic attempts. It accepts the first passing candidate. If
each attempt fails, it returns `status: 'rejected'` and no masses. The result
includes `architectureReport` and `attemptsTried` so downstream exporters can
gate on the report and call `ArchitectureValidator.assertReadyForGeometry`
immediately before mesh creation. This guard revalidates cached or edited
masses and throws if they are no longer valid. An
incompatible family or DNA/plan conflict is rejected without attempting to
modify the plan.

The gate evaluates architectural and geometric consistency. It is **not a
structural engineering certification** and does not replace professional
design review or local code approval.

Run `npm test` for the complete suite. `scripts/test-massing.mjs` covers every
family, explicit incompatible-family rejection, real planner integration,
seed repeatability, 24 distinct measured silhouettes, coarse profile variation,
volume conservation/subtraction, pure transforms and destructive-edit rejection.
`scripts/test-architecture-validator.mjs` tests the validation categories and a
failed first operation followed by a passing retry.

## Files

- `src/lib/engine/buildingModel.ts`: adapter and plan data contract.
- `src/lib/engine/villaDesignDna.ts`: seeded design intent.
- `src/lib/engine/massing/model.ts`: mass and result types.
- `src/lib/engine/massing/families.ts`: footprint topology and eligibility.
- `src/lib/engine/massing/transforms.ts`: reusable geometric operations.
- `src/lib/engine/massing/MassingGenerator.ts`: plan-preserving composition.
- `src/lib/engine/massing/validate.ts`: validation and silhouette signatures.
- `src/lib/engine/massing/ArchitectureValidator.ts`: candidate gate and retries.
- `src/state/studio.ts`: additive integration with studio results/directions.
