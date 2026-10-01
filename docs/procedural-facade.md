# Procedural facade grammar

The procedural facade stage consumes the verified `BuildingModel`, seeded
`VillaDesignDNA` and a valid `MassingModel`. It produces a JSON-serializable
`ProceduralFacadeModel` for the later Blender geometry stage. The current
Three.js renderer continues to use the existing `facade/grammar.ts` and
`buildMassing.ts` path; this new model does not alter that view yet.

```ts
import { ArchitecturalFeatureGenerator } from './src/lib/engine/index.ts'

const facade = ArchitecturalFeatureGenerator.generate(building, dna, massing)
if (facade.status === 'valid') {
  // facade.zones: real exterior wall and exposed roof anchors
  // facade.features: one hero plus zero to two supporting features
}

const requested = ArchitecturalFeatureGenerator.generate(building, dna, massing, {
  architecturalFamily: 'FRAMED_MODERN',
  heroFeature: 'C_FRAME',
  supportingFeatures: ['VERTICAL_FIN_SCREEN'],
})
```

An explicit feature request that cannot fit returns `status: 'rejected'` with
`HERO_UNAVAILABLE`. An incompatible courtyard family returns `FAMILY_INCOMPATIBLE`.
Generated features are checked before they are returned.

## Architectural composition families

`VillaDesignDNA v3` selects an internal `architecturalFamily` from the numeric
seed and the source plan. The three user-facing styles remain Modern Box,
Contemporary and Courtyard. Their character choices guide the family pool;
saved legacy characters still use the whole compatible catalogue. The 11
families below choose a distinct hero geometry recipe, supporting feature
types, proportional span and projection depth:

| Family | Defining hero geometry |
| --- | --- |
| `FRAMED_MODERN` | Proportional C or rectangular frame |
| `FLOATING_BOX` | Projected upper-style box or floating frame |
| `INTERLOCKING_MODERN` | Offset interlocking volumes or corner wrap |
| `MINIMAL_LUXURY` | Recessed box or restrained frame |
| `WARM_CONTEMPORARY` | Slender vertical wood spine or L frame |
| `TROPICAL_MODERN` | Deep shade slab or pergola |
| `SCREEN_HOUSE` | Jali or vertical fin screen |
| `INDIAN_CONTEMPORARY` | Entrance portal or double-height portal |
| `VERTICAL_MONOLITH` | Tall tower or stone spine |
| `HORIZONTAL_LAYERED` | Horizontal louvers or deep overhang |
| `COURTYARD_MODERN` | Screen facing an actual source courtyard |

The family is recorded in `ProceduralFacadeModel v2`. Automatic generation
tries other compatible families if the selected family's safe hero cannot fit,
and records the family actually used. A requested family has no fallback. A
named family never creates a new room, courtyard, floor plate or balcony.

## Zone grammar

`buildFacadeZones` classifies every real exterior wall using its source room,
boundary side, entry, balcony and courtyard relationships. It also creates
`ROOFLINE` zones from exposed edges of validated roof masses. Zone kinds are:

| Kind | Source |
| --- | --- |
| `PRIMARY` | Ground facade facing the plan road side |
| `SECONDARY` | Other ground exterior walls |
| `ENTRANCE` | Wall containing the actual main door |
| `BALCONY` | Exterior wall adjoining a source balcony |
| `STAIR_TOWER` | Exterior stair room wall |
| `UPPER` | Upper-floor exterior room wall |
| `ROOFLINE` | Exposed edge of an actual roof mass |
| `SERVICE` | Exterior service room wall |
| `VOID` | Wall facing a source courtyard void |

Each zone carries the host wall ID or roof mass ID, floor, outward side,
horizontal interval and vertical interval. Zones are source geometry references,
not arbitrary facade coordinates.

## Feature grammar

All 23 requested types are implemented:

- Frames: `C_FRAME`, `L_FRAME`, `RECTANGLE_FRAME`, `DOUBLE_HEIGHT_FRAME`,
  `FLOATING_FRAME`, `CORNER_WRAP_FRAME`.
- Boxes: `PROJECTED_BOX`, `FLOATING_BOX`, `RECESSED_BOX`, `INTERLOCKING_BOX`.
- Vertical elements: `STONE_SPINE`, `WOOD_SPINE`, `VERTICAL_TOWER`.
- Entries: `DOUBLE_HEIGHT_PORTAL`, `ENTRY_PORTAL`.
- Screens: `JALI_SCREEN`, `VERTICAL_FIN_SCREEN`, `HORIZONTAL_LOUVER`.
- Roof/overhang: `DEEP_OVERHANG`, `PERGOLA_FRAME`, `ROOF_FRAME`.
- Connected elements: `BRIDGE_VOLUME`, `COURTYARD_SCREEN`.

An element is assembled from parameterized prismatic parts (`beam`, `post`,
`panel`, `screen`, `slab`, `box`). The `C_FRAME` has a top beam, one vertical
beam and a bottom beam. Its width ratio, height ratio, thickness, projection,
offset and open side come from the numeric seed and the available host span.
There is no prebuilt C-frame mesh. Double-height elements use aligned wall
zones on adjacent floors; the bridge connects two exposed roof edges.

Each part stores a local `u` span along a zone, absolute vertical span and
outward depth. `worldPart` derives its x/y/z box from those values and the
zone's outward normal. The validator rejects independently edited world
coordinates. Major heroes project at least 300 mm beyond their host surface
and thus change the exterior silhouette. Source floor plates and rooms remain
unchanged.

Selection is seeded by the plan identity and numeric DNA seed. The family
recipe tries its defining hero types on real zones and selects at most two
compatible supports. It never places the full catalogue on one villa.

`validateProceduralFeatures` rejects missing hosts, invalid local geometry,
setback breaches, door/window/column/building collisions and collisions
between selected features. Opening spans and vertical clearances come from the
existing plan. A failed feature candidate is discarded and the generator tries
another type or host zone. The source massing passes `ArchitectureValidator`
before this stage runs.

Run `node --experimental-strip-types --test scripts/test-procedural-facade.mjs`
to check all 23 recipes, all 11 composition families, all nine zones, C-frame components, seed determinism,
multiple real plan families, opening protection and invalid-coordinate
rejection. `npm test` includes this suite.
