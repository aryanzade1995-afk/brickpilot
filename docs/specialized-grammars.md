# Specialized architectural grammars

These grammars extend the existing procedural facade and Blender pipeline.
They create physical architectural parts from the verified 2D plan. They do
not change room layouts, invent windows, move the main door or extend a source
balcony. The live Three.js view still uses its existing renderer; it does not
yet display these Blender exports.

## Flow and files

```text
verified Design -> BuildingModel + numeric-seed VillaDesignDNA
  -> checked MassingModel -> facade zones + hero/support features
  -> SpecializedGrammarGenerator -> checked facadeGrammar.specialized
  -> Blender input validation -> editable solids and wall cuts
  -> .blend + GLB + optional render
```

`ArchitecturalFeatureGenerator.generate()` automatically attaches the new
`specialized` model to successful results. `src/state/studio.ts` already stores
that facade result. The additions preserve the current routing, UI, backend,
plan generator and room data.

| File | Responsibility |
| --- | --- |
| `src/lib/engine/facade/specialized/types.ts` | 40 recipes, data contracts, central limits |
| `specialized/context.ts` | Real wall, balcony and roof anchors; local-to-world conversion |
| `specialized/SpecializedGrammarGenerator.ts` | Seeded selection, retries and omissions |
| `specialized/balconies.ts` | Source balcony treatments and access protection |
| `specialized/entrances.ts` | Treatments around the actual main door |
| `specialized/windows.ts` | Compositions around actual room apertures |
| `specialized/rooflines.ts` | Parapets, roof frames and stair-accessible roof features |
| `specialized/depth.ts` | Solid projections, cladding gaps, frames and wall recesses |
| `specialized/validate.ts` | Geometric gate before export |
| `blender/specialized_validation.py` | Fresh checks at the Python mesh boundary |
| `blender/facade/specialized.py` | Named editable mesh parts and Boolean wall recesses |

Paths beginning with `specialized/` in this table are relative to
`src/lib/engine/facade/`.

## Recipes and actual geometry

| Category | Recipes | Geometry |
| --- | --- | --- |
| Balcony | RECESSED, PROJECTED, FLOATING, CORNER, WRAP, BOXED, FRAME_INTEGRATED, PLANTER, PARTIAL_WIDTH, FULL_WIDTH | Distinct side walls, slab/fascia profiles, brackets, corner beams, outer frames, screens, planters and partial/full canopies; the source slab remains |
| Entrance | RECESSED_ENTRY, DOUBLE_HEIGHT_PORTAL, STONE_ENTRY, WOOD_PORTAL, SIDE_ENTRY, FLOATING_CANOPY, COURTYARD_ENTRY | Carved side niches, multi-floor jambs, thick/thin portals, timber slats, projected canopies and courtyard screens around the real door |
| Window | ALIGNED, ASYMMETRIC, HORIZONTAL_BAND, VERTICAL_STACK, CORNER_GLAZING, FLOOR_TO_CEILING, FRAME_GROUPED, SCREENED | Mullions, offset fins, connected projecting headers, full-floor vertical framing, two-face frames, tall glazing surrounds, grouped frames and stand-off screens |
| Roofline | FLAT_PARAPET, STEPPED_PARAPET, OFFSET_PARAPET, ROOFTOP_FRAME, PERGOLA, ROOF_TERRACE, SCREENED_TERRACE, PLANTER_PARAPET | Different parapet heights/setbacks/caps, rooftop posts and beams, pergola slats, deck tiles, terrace screens and planter profiles |
| Facade depth | DEEP_RECESS, SHALLOW_RECESS, MAIN_FACADE_PLANE, CLADDING_PLANE, PROJECTED_SLAB, ARCHITECTURAL_FRAME, CANTILEVERED_MASS | Actual wall cuts, surface panels, stand-off cladding and brackets, projecting slabs, three-dimensional frames and non-habitable projected facade solids |

Recessed balconies enclose the sides of the existing outdoor balcony. They
do not carve away an indoor room. Floating treatments retain the source slab
and support data; their appearance comes from different edge profiles and
brackets. Cantilevered facade masses are solids attached to an existing wall,
not invented occupied floor space.

## Source compatibility

Recipes have real prerequisites. Automatic generation retries another seeded
recipe when a choice does not fit. If no recipe fits, the model records an
`omissions` entry and retains the source component's baseline geometry.
An explicitly requested incompatible recipe produces `status: 'rejected'`
and `GRAMMAR_UNAVAILABLE`; it cannot pass the Blender export gate.

- Corner/wrap treatments need a source balcony at a real floor corner, enough
  usable depth and a clear door approach.
- Side/courtyard entries need the actual entry on that facade. A double-height
  portal needs a matching upper-floor exterior wall and clear windows.
- Corner glazing needs two orthogonal source windows belonging to the same
  indoor room. Tall glazing needs a source sill at floor level and a tall
  source head. The grammar never enlarges an aperture to obtain these types.
- Horizontal groups need source windows on one facade; vertical stacks need
  matching source windows on multiple floors.
- Pergolas and usable/screened roof terraces require a flat roof, source stair,
  supported clear pad and an unobstructed route from the stair. Pitched roofs
  retain their existing roof geometry.

Source windows and doors retain their IDs, room links, widths and positions.
Optional source `Opening.head` and `sill` values are respected when cutting
walls and creating frames. Missing heads use the existing concept defaults.

## Anchoring, validation and limits

Every assembly contains source room/opening IDs. Each part has a real
`WALL`, `BALCONY`, `ROOF` or `ROOF_MASS` anchor and a local box:

```typescript
{ u, v, z, w, d, h } // millimetres; v follows the anchor's outward direction
```

World coordinates are derived from that anchor and checked again; recipes
do not scatter arbitrary world positions. Wall anchors start at the exterior
wall surface, rather than the wall centre. `ADD` creates a solid; `RECESS`
cuts the host wall while preserving rear thickness.

Central defaults in `DEFAULT_GRAMMAR_LIMITS` include a 1000 mm door approach,
30 mm opening clearance, 1200 mm facade projection, 900 mm facade cantilever,
70 mm retained wall thickness, 900 mm usable balcony depth and an 800 mm roof
route. Shallow/deep cuts are 45/130 mm. These are configurable concept limits,
not engineering certification or universal building-code compliance.

The validator checks host bounds, setbacks, occupied volumes, source columns,
doors, windows, balcony support/access, supported roof plates, stair/shaft
clearance, the existing hero and overlaps between different assemblies.
Intended joints inside one assembly are allowed. Narrow mullions within their
own source aperture and spaced window screens have explicit exceptions.

## API

All selection randomness comes from the numeric seed and stable source IDs.
The same inputs and seed produce identical assemblies; another seed can change
physical profiles and placement choices. No unseeded random calls are used.

```typescript
const facade = ArchitecturalFeatureGenerator.generate(building, dna, massing)
const components = facade.specialized

// Optional strict choices and central limit overrides:
const selected = ArchitecturalFeatureGenerator.generate(building, dna, massing, {
  specialized: { ENTRANCE: 'FLOATING_CANOPY', DEPTH: 'DEEP_RECESS' },
  grammarLimits: { maxCantileverMm: 700 },
})
```

Category overrides apply to every applicable source component in that
category. They can fail on a plan that lacks the required hosts. Check
`status`, `issues` and `specialized.omissions` before using an overridden result.
`createBlenderInput(design, seed, featureOptions)` accepts the same options.

## Export and verification

```powershell
npm run blender:input -- --out output/specialized-input.json --seed 41
npm run blender:export -- --input output/specialized-input.json --out-dir output/specialized --name specialized_41 --render
```

Blender creates separate named parts such as
`Grammar_Balcony_FrameIntegrated_01_Beam_009`. Object metadata records the
recipe, part ID, operation and source anchor/room/opening IDs. Repeated solids
share mesh data; edge bevels remain editable. Recesses use exact Boolean cuts
in real source walls with a thin backing skin. Exports retain the existing
semantic collections. The JSON export manifest lists applied recipes and
omissions.

`npm test` covers all 40 recipes on compatible source fixtures, physical
differences, deterministic output, source immutability and invalid choices.
Fixtures deliberately supply the actual corner, tall-window or courtyard
source geometry where a recipe needs it.

```powershell
python blender/test_pipeline.py output/specialized-input.json
node --experimental-strip-types scripts/fixtures/export-specialized.mjs
```

The fixture exporter creates additional deep-recess and corner/pergola inputs
under ignored `output/`. Export those with `blender:export`, then use
`blender/test_runtime.py` as described in [Blender pipeline](blender-pipeline.md).
Runtime checks inspect editable objects, dimensions, real openings, actual
wall recess depths and the saved GLB. The local verification included three
real Blender 4.5.14 exports, including deep/shallow cuts and a corner balcony
with a stair-accessible pergola.
