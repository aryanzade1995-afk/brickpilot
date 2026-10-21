# Whole-house walkthrough: foundations and implementation plan

Update: the continuous shell and source stair/plate generation layer is now
implemented. See [scene-generation API, validation and limitations](walkthrough-scene-generation.md).
The foundation-phase findings below remain the architecture context; the new
scene generator is available through AI Interior's Prepare house geometry action.

This phase adds a source contract, coordinate adapters, an on-demand room asset
adapter and a preparation section below the 360 panorama in AI Interior. It does
**not** add the full viewer, another canvas, movement, collision simulation,
door animation, lighting, navmesh generation or a Blender render job.

## Findings from the existing systems

| Existing system | Reuse | Important limit |
| --- | --- | --- |
| `src/lib/engine/buildingModel.ts` | Full source floors, walls, openings, columns, beams, slabs, stairs and stable plan identity | Slabs are source rectangles, not final hole-cut meshes; stair nosings are not a traversal path |
| `src/lib/rules/index.ts`, planner validation | The current Result's accepted 2D report | Planning validation does not certify camera clearance or real-time stair navigation |
| `blender/generator.py`, `geometry/structure.py`, `geometry/stairs.py` | Plan-faithful wall splitting, stair flights/landings and floor cutouts | Python currently owns the realized stair recipe; JS must not independently guess a different staircase |
| `blender/geometry/common.py`, `exporters/glb.py` | Metre units, source IDs in GLB extras, accepted model reuse | Exterior GLB availability does not establish complete interiors or navigation readiness |
| `server/villa-jobs.mjs`, `src/state/blender.ts` | Accepted GLB URLs, plan ID, finish signature and accepted seed | The walkthrough must not call architecture search or generate a different exterior |
| `src/lib/three/prepareVillaScene.ts` | GPU texture and batching patterns | Opaque batching loses per-object identity; use separate source proxies for selection/collision, or retain a semantic map before batching |
| `FastInteriorPreview.tsx`, `src/lib/interior/preview.ts` | Room selection/preferences, `roomFurnishing`, deterministic placement | Panorama is a static spherical image with a single camera position. `previewRooms` intentionally excludes circulation, which a whole house must include |
| `src/lib/interior/finishes.ts` | `interiorFinishes` and exact option/product IDs, room overrides, preset provenance | A product photograph or representative preset product is not an exact manufactured 3D asset |
| `src/lib/three/dressRoom.ts` | Renderable parametric furniture and product-dependent fixture forms | Calls `roomFurnishing` itself; do not also add a second set of its furniture |
| `buildDollhouse.ts`, `DollhouseScene.tsx` | Furniture/material construction patterns and disposal | Walls are cut to 1.16 m; floors use tray spacing and a display plinth. Do not use this shell or its elevations for walking |
| `FinishesCost.tsx`, cost catalogue/finish assignments/BOQ | Authoritative selections and quantities | Viewing must not price another house or write estimate changes |
| `useStudio`, `useInterior360`, project persistence | Current accepted design/Brief and existing decor preferences | Source remains derived. No new persistent camera/renderer state is needed in this phase |
| Existing R3F canvases and demand rendering | Browser GPU rendering, context recovery, selective invalidation | In a later viewer, request frames while moving, looking or animating, then stop; do not run a permanent idle render loop |

The existing 360 source shell uses room-local coordinates and includes selected
connected shells. Assembling every room's shell would duplicate shared walls,
ceilings and openings. The full shell must be assembled once from BuildingModel;
room assets only contribute finishes/furnishings to that source shell.

## Implemented files

```
src/lib/walkthrough/
  source.ts          # Versioned, serializable, detached source manifest
  coordinates.ts     # Existing Blender/GLB frame + room-local position conversion
  roomAssets.ts      # Explicit, on-demand reuse of interiorFinishes + dressRoom
src/components/interior/
  WalkthroughFoundation.tsx  # Status/preparation, below the panorama; no viewer
src/lib/i18n/walkthroughMessages.ts
scripts/test-walkthrough-foundations.mjs
```

`createWalkthroughSource` takes the current Design, its Result report, existing
interior preferences and optional accepted BuildingModel. It records:

- All source floors and spaces, including circulation and outdoor source rooms.
- Original full BuildingModel, without changing dimensions, IDs or seed inputs.
- Source door-to-space links only when explicit room references and a unique
  physical wall host agree. Windows are never connectivity portals. Missing or
  ambiguous references produce review records, never nearest-room bridges.
- Ground-floor topology diagnostics from confirmed exterior doors. This is not
  collision testing, a route, an accessibility assessment or proof that the
  house is navigable. Upper-floor reachability remains unevaluated.
- Footprint rectangles, courtyard, shaft and double-height exclusions. These
  are source records, not an asserted walkable surface union. Stair slab cutouts
  explicitly remain pending the shared realized-stair adapter.
- Stair source references and candidate destination floors. Traversal remains
  pending even when the source treads exist. Missing orientation/nosings are
  flagged; no fallback flight is fabricated. Roof access is not invented.
- Separate geometry and appearance keys. Geometry includes source plan identity;
  appearance includes the established finish signature and decor/lighting/density.
  Technical sizing selections can legitimately affect source geometry; they must
  reconcile with the accepted model instead of being treated as paint changes.

Invalid 2D reports and accepted/source plan ID mismatches block room preparation.
`viewerReady` is always false in this foundation version. There is no public JSON
import endpoint: this is an internal contract, not an unvalidated file loader.

`resolveWalkthroughRoomAssets` verifies the source and appearance keys before
using existing `interiorFinishes` and `dressRoom` (which calls `roomFurnishing`).
It returns existing parametric furniture, finish metadata and product references
in room-local coordinates. Double-height isolation unsupported by the existing
room system returns a furnishing-unavailable state while preserving resolved
finishes. No generic room box or replacement furniture set is substituted.

The section observes current studio/Blender/interior state but calls no setters,
generation action, network job, cost update or persistence action. Switching
projects/versions or editing a plan derives another source; nothing overwrites
the saved accepted architecture or panorama cache.

## Coordinates and asset identity

BuildingModel: x/y in source plan mm, height in mm above ground-floor finished
floor level. Its cardinal labels are local axes, not proof of surveyed north.
Blender uses unshifted `(x, y, height) / 1000`, Z-up. Exported glTF/R3F uses
`(x, height, -y) / 1000`, Y-up. The foundation reuses
`src/lib/solar/coordinates.ts`; it does not create a competing convention.

Room assets are centred on the source room rectangle and use `(x east, y up,
z south)` in metres. `roomLocalToWalkthrough` and its inverse include the source
floor elevation, with no study-model plot centring, display plinth or tray gap.
They convert **positions**. The future mesh adapter must also convert vertices,
normals, oriented furniture and triangle winding: flipping local z changes
handedness. Applying position conversion alone to rotated furniture is incorrect.

An accepted GLB with matching plan and finish keys is marked only as a candidate
for an interior audit. Unknown finish keys, changed plan IDs and changed finishes
are explicit stale/missing states. No GLB is loaded by this preparation section.
Later, preserve accepted seed/model identity and separate geometry caches from
appearance and session state. Never rerun exterior diversity search to start a
walkthrough. Combined solar exports need the existing artifact-scope handling;
do not duplicate their PV or treat PV as interior collision surfaces.

## Proposed later files and sequence (not implemented)

1. **Shared realized geometry:** `src/lib/walkthrough/stairs.ts` and
   `shell.ts`. Promote the Python stair recipe's source-derived flights, risers,
   landing and slab opening into a versioned shared geometry description consumed
   by both Blender and JS. Compare against existing Python stair tests. Assemble
   walls once, with identical opening heads/sills, room-specific face finishes,
   true slabs/ceilings and courtyard/shaft/double-height holes. Reject unsupported
   inputs. Audit a matching raw GLB as an optional static geometry source.
2. **Collision and connectivity:** `collision.ts`, `navigation.ts`. Build
   source-ID proxies separately from batched display meshes. Validate actual
   door clear width/headroom, stair rise/going/landings, floor support and
   guard/void edges using an explicit camera-body concept. Treat walls, windows,
   closed leaves and furniture consistently; select a verified start position.
   An open-plan boundary needs an explicit source representation, not a wall
   deletion or guessed door. Stairs must connect real landing surfaces.
3. **Room appearance/assets:** `appearance.ts`, `assetCache.ts`. Cache the current
   on-demand adapter by geometry+appearance+floor/room key. Reuse resolved room
   overrides and house-wide products; document parametric approximations and
   unavailable assets. Product geometry must fit real openings, never resize walls
   to match a catalogue photo. Reconcile legacy cost-only selection projections
   with the same effective Brief used by Finishes & Cost before claiming complete
   parity. `interiorFinishes` currently derives finish assignments via BOQ for
   each request; share that resolved context later to avoid repeated whole-house
   estimate computation, preserving existing APIs and estimate arithmetic.
4. **Viewer/controller:** `src/components/interior/HouseWalkthrough.tsx`,
   `src/lib/three/WalkthroughScene.tsx`, optional `src/state/walkthrough.ts` for
   ephemeral session controls. One lazy, opt-in R3F canvas; desktop mouse/keyboard,
   touch and an accessible room/floor navigation alternative. Preserve source
   architecture through all movement. No always-on pointer lock or autoplay.
5. **Real-time appearance and performance:** staged GPU lighting, texture budgets,
   room/floor streaming, shared instanced assets, adaptive quality and context-loss
   recovery. Blender beauty images are not real-time lights. Match finishes first;
   describe realism limits accurately. Keep the 360 and exterior canvases mounted
   only as needed, avoid simultaneous heavy GPU scenes, dispose owned resources,
   invalidate on movement/animation and return to demand rendering at rest.
6. **Acceptance checks:** compare plans, render geometry, openings, stair landing
   coordinates, saved product IDs and BOQ before/after; courtyard and double-height
   edges; multi-floor movement; rooms with identical IDs on different floors;
   invalid/stale sources; project/version switches; keyboard/mobile/GPU recovery.
   Do not ship a walkthrough as complete while any required floor is unreachable.

## Validation of this phase

`npm run test:walkthrough` covers source/cost/seed immutability, true coordinate
conversion and elevations, geometry/appearance identity, door-only topology,
missing source links, voids and unsupported stairs, invalid/stale inputs, exact
selected finish IDs and reuse of the existing furnishing system. Existing
interior/furnished/building-model tests and the production build remain relevant.

No new runtime dependency, persistence schema, architectural generation rule,
panorama generation pipeline, exterior render path or BOQ formula is introduced.
