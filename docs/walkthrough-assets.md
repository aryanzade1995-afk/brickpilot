# Whole-house walkthrough asset pipeline

The [first-person viewer](walkthrough-navigation.md) now consumes these assets
with Rapier collision, grounded stair movement and native mouse controls. The
export's `navigation.ready: false` is the server-side source-review marker;
the viewer performs its own current capsule/spawn audit before enabling walking.

This extends the continuous `BuildingModel` shell. It does not change the exterior
generator, architecture seeds, cost calculations, the 2D planner, or room panoramas.
AI Interior now has an explicit **Generate walkthrough assets** action below the
existing shell preparation section. Downloads and an optional orbit/cutaway review
use the existing Formstead theme. Movement controls are a later stage.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `src/lib/walkthrough/delivery.ts` | Source surface material domains, opening parts, collision primitives, entry candidates, existing room furnishing adapter |
| `blender/walkthrough_export.py` | Structural and appearance replay passes, optimized batched glTF/PBR meshes; no architecture generation or search |
| `server/walkthrough-assets.mjs` | Server validation, SHA-256 identities, bounded job queue, artifact integrity, cache/restart recovery and HTTP handler |
| `src/components/interior/WalkthroughAssets.tsx` | Explicit project-scoped request, polling, stale-request cancellation, qualified downloads |
| `src/components/interior/WalkthroughAssetPreview.tsx` | Lazy, demand-rendered orbital audit with floor cutaways and a WebGL error boundary |
| `src/lib/three/loadWalkthroughAsset.ts` | Real GLTFLoader import, design association, material-only replacement, disposal |
| `scripts/test-walkthrough-assets.mjs` | Source/material/collision/failure tests and opt-in actual Blender / Three.js / HTTP round trip |

## Authoritative geometry and coordinates

The server independently calls `validate(design)`, `createBuildingModel(design)`
and `buildWalkthroughScene(building, report)`. It never accepts a client shell,
validation flag, export path or architecture seed as authority. The submitted
`expectedPlanId` must equal the current BuildingModel plan ID. Invalid/unsupported
shells fail before Blender starts. The input brief is schema-validated too.

Source footprints, slabs and opening extents are millimetres in plan x-east,
y-south, z-up. Published vertices, entry positions and collider bounds are metres
in x-east, y-up, z-plan-north. Python converts only `(x, y, z)` world coordinates
to Blender `(x, -z, y)`. The existing glTF exporter reverses that rotation. No
centring, room offsets, floor explosion, plinth or replacement room shell enters
the export. Existing room-local furniture goes through `roomLocalToWalkthrough`;
its rotation is reflected consistently with its local south-facing z-axis.

Material-domain splitting changes no boundary: original exposed faces are split
at room/material boundaries with equal total area. Each split retains a stable
ID, `canonicalSurfaceId`, source element IDs, room, floor and material binding.
Ceiling faces belong to the room below their source slab. Mesh extras preserve
the per-domain surface ID lists, while metadata holds exact surface coordinates.
Faces are batched by material domain; furniture is batched by room and PBR look.
Door leaves stay separate for future operation. No per-cell or detail-heavy meshes.

Openings retain their exact source aperture and source operation. Windows reuse
the shell's existing panes. Display jambs/heads and leaves remain inside those
apertures; their slim, maximum 35mm profile is an explicit illustrative display
assumption, not a measured product profile. Doors export closed, with dynamic
collision records and original hinge/swing/treatment information in the source
opening metadata. A future controller must operate them, not walk through them.

All source-supported slabs, ceilings, walls, beams, columns, stairs and roof
parapets are exported. Missing balcony/stair guards and roof headroom wall/exit
details stay absent and flagged. No speculative railings or enclosure is added.
The export is available for model review; `navigation.ready` remains false.

## Two identities and two Blender passes

1. **Structural cache:** SHA-256 of the complete delivery geometry and versioned
   renderer source contents. This is stronger than the frontend's short plan
   hash. A structural job exports `structure.glb`, `collision.glb` and an integrity
   record into `output/walkthrough/geometry/<geometryKey>/`.
2. **Appearance package:** geometry identity plus resolved selected finishes,
   existing procedural furnishing, qualifications and the bytes of used catalogue
   images. A finish/product change loads the cached structural GLB into Blender,
   applies PBR slots and exports the new package. It does not rebuild the shell,
   call the exterior generator, invoke diversity checks or change a seed.
3. **Project association:** the public job ID also includes project ID and design
   ID. Projects can share the same immutable structure while receiving separate,
   correctly labelled packages. The UI discards outstanding results on project,
   plan, appearance or validation-state change. Unnamed projects use an explicit
   `unsaved:<planId>` association.

The client can also apply `materials.json` through
`applyWalkthroughMaterialBindings()` to change only material slots in memory.
Geometry buffers, transforms, surface IDs and structural identity stay fixed.
Changed furniture geometry requires replacement of the furniture package. Do not
append `furniture.glb` to `house.glb`: the latter already includes it.

## Artifacts

| File | Contents |
| --- | --- |
| `house.glb` | Combined, selected PBR house plus available procedural furniture; self-contained selected surface images |
| `structure.glb` | Immutable neutral structural model with semantic material bindings, opening display parts, no furniture |
| `furniture.glb` | Furniture-only replacement package; may legally contain an empty root if no furnishing is supported |
| `collision.glb` | Simplified source solid/window/display-frame boxes; independent of visible furniture and selected finish |
| `collision.json` | Exact world-space static AABBs, conservative rotated furniture AABBs and separate dynamic closed-door colliders |
| `metadata.json` | Design/project/geometry/appearance IDs, floor elevations, room bounds/support, doors/windows, source stair steps/landings/headroom, roofs, connections, qualified entries, all review notes and surface/material schedule |
| `materials.json` | Public catalogue URLs and PBR values keyed by stable material binding; no local filesystem paths |

Supported catalogue images are embedded. Invalid, missing or non-public image
references use selected PBR colour with an explicit warning, retaining the product
selection. Replacing image bytes at the same URL invalidates the appearance cache.
Procedural preview shaders reduce to browser-compatible PBR; lighting is not baked.
The shared [live finish integration](walkthrough-finishes.md) adds source-clipped
wall tiles, backsplashes, illustrative ceiling treatments and supported high fitted
products to the same appearance package. The walkthrough opts into full-height
furnishing; existing cutaway previews keep their original defaults. Supplier meshes,
PBR values and unverified fixture sizes remain explicitly approximate. Unsupported
rooms keep their source shell and finish records.

Collision treads retain the real source stair step boxes, rather than a ramp that
cuts through landings. Source landings, openings and headroom samples accompany
them. Entries are tested against supported floor regions and static source boxes
using a documented 0.25m radius / 1.7m height, then checked against the current
furniture's conservative boxes. An empty list is allowed and means no checked
starting point is available. This is not a navmesh, full swept-capsule validation,
code certification or permission to walk beside unguarded edges.

## HTTP API

- `POST /api/walkthrough-assets`: `{ projectId, expectedPlanId, design, preferences:
  { style, lighting, furnitureDensity } }`. Returns 202 for queued/generating jobs,
  or 200 for a verified cached package. Response includes job `id`, `designId`,
  `projectId`, `geometryKey`, `appearanceKey`, state/stage and cache reuse flags.
- `GET /api/walkthrough-assets/<id>`: persistent completed status; in-memory queued,
  generating or failed status. Unknown/incomplete packages return 404/missing.
- `GET|HEAD /api/walkthrough-assets/<id>/<artifact>`: only the seven whitelisted
  filenames above, only after whole-package integrity validation. Binary GLBs use
  `model/gltf-binary`; JSON and MIME-sniff protection headers are explicit.

Validation errors return 400/422, stale design 409, queue capacity 429. Generation
errors become a failed job with a friendly retry message, and detailed local logs.
There is one walkthrough Blender worker, at most eight waiting jobs and a ten
minute timeout per pass. Existing exterior/panorama queues remain independent.
Install/use Node 24+ and the existing `BLENDER_BIN` / bundled Blender detection.
No additional package or render service is needed.

The filesystem cache is local and durable across server restarts. It is designed
for one server process, matching the current app; distributed workers would need
external job/locking storage. These endpoints inherit the app's current local
server security model. They are not a new authenticated multi-tenant service.

Exports write into isolated temporary directories. A package is published only
after GLB framing, buffers, vertices, index ranges, design extras, expected material
domains, complete artifact inventory and SHA-256 checksums pass. Failed staging
directories are removed only within the configured walkthrough cache root. A bad
or truncated cache is never served as a current successful export. Old exterior
assets and room panoramas are untouched. Retrying regenerates a missing/invalid
package; currently running duplicate requests coalesce.

## Verification

```
npm run test:walkthrough
npm run test:walkthrough-assets
# PowerShell: enable actual local Blender + Three.js + HTTP export checks
$env:WALKTHROUGH_BLENDER_TEST='1'
npm run test:walkthrough-assets
npm run build
```

The integration test verifies all structural surface IDs and every exported
structural vertex against canonical global positions, checks GLTFLoader import,
counts floors/openings, confirms finish-only structural cache reuse, isolates
project IDs, retrieves files over HTTP, recovers after restart and rejects a
deliberately truncated artifact. It leaves sample packages under
`output/walkthrough-integration/` for inspection. Production packages live under
`output/walkthrough/`. Both are ignored by Git.
