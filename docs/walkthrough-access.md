# Walkthrough access and live finishes

The walkthrough loads the accepted Massing GLB. It does not substitute a room
preview, proxy house or a second furniture layout.

## Doors

`acceptedVillaWalkthrough.ts` uses exported opening source IDs and Blender part
names to identify movable leaves, handles and carved inserts. Fixed frames,
tracks and windows stay in the static triangle collider. Main-entry leaves
operate together around opposite hinges. A two-track slider moves its left
sash onto the actual fixed sash on the other track, leaving half-width access.
The same runtime pose drives the visible parts and the Rapier door collider.

Look at a door and press **E**. Door motion pauses if its sweep intersects the
person; the viewer asks them to step back. **Escape** leaves full-page walking,
releases mouse capture and restores the page cursor and orbit camera.

## Source access corrections

- New compact double-loaded halls target 1500 mm; large-villa and wing galleries
  target 1800 mm. These are concept planning dimensions, not a local approval.
- Stair portals are leaf-free and span both flights, subject to actual columns
  and wall ends. Their explicit heads stop below the sized beam soffit. The
  Blender exporter does not add a low metal frame to an open portal.
- Blender steps use the same stepped waist and landing thickness rules as the
  shared walkthrough stair utility. Return flights no longer fill the space
  beneath them down to the ground floor. Storey elevations and risers stay fixed.
- Secondary exits are hosted outside stair/lift/shaft rooms and swing outward
  into checked clear site space. The existing independent site escape-path
  validation still applies. If an exit cannot fit, it is not invented.
- Editing a wing plan preserves its original valid room-to-room connections,
  rehosting each on its actual shared edge with column/opening checks.

For saved models, **Update access & Blender model** uses the normal validated
plan-edit transaction, retains the pinned seed and finish selections, and
  requests an exact-seed Blender rebuild. The previous artifact stays saved.
Courtyard halls borrow only from unlocked adjacent courtyard space. Surveyed
structures and edits that would require taking occupied rooms are reported for
a deliberate 2D edit rather than silently altered. `walk-access-v6` distinguishes
corrected exports from older saved models.

The secondary exit also carries an explicit source landing and descending tread
schedule from finished floor to the selected plinth/site grade. Candidates are
rejected if that stoop would cross rooms, pools, parking, driveways or the reserved
compound-wall strip. The 2D safety layer and Blender consume the same rectangles
and elevations. Exterior supports, guards and accessible evacuation remain subject
to professional design; this is not a fire-safety certification.

## Materials and flicker

The viewer reuses the Massing coplanar-face separation without static batching
the interactive doors. It partitions original Blender triangles by the shared
room/surface material domains, including slab triangles spanning multiple rooms.
No coplanar wall finish skins or duplicate furniture are added. Tile coverage changes
repartition the retained original surfaces; paint/product changes update material
slots in place. Collision geometry and the architecture do not change for finishes.

`interiorFinishes()`, through `prepareWalkthroughAppearance()`, remains the source
for selected room products. Surface images use world-metre UVs, catalogue tile
dimensions where known, mipmaps, anisotropy and selected roughness/colour. Missing
images fall back to the selected colour with a visible status. Product photos and
unsupported shapes are approximations, not manufacturer geometry. Existing
exterior furniture is retained. The accepted-villa path now consumes the same
`dressRoom` / `roomFurnishing` package as the room preview, including selected
fans, lighting, switches, sanitary fittings, cabinetry and furnished living/bed
spaces. Only explicitly tagged interior product roots are replaced; untagged
architectural objects are retained. Furniture shapes remain procedural visual
approximations; they are not exact manufacturer assets or extra cost quantities.

## Terrace, thresholds and entrance

Regular storey masonry stops at the slab soffit. The top deck covers the actual
exterior wall bearing width as a union of rectangles, retaining stair/shaft and
courtyard holes. Parapets and the stair headroom enclosure are preserved. Blender
honours `leaf:false` **or** `treatment:open` before considering glazing; the
viewer also reconciles explicitly open source portals in older exports.

The controller can step over actual tracks/thresholds up to 60mm; its larger
230mm stair limit remains restricted to source stair/stoop bounds. It does not
walk through a door, beam or cabinet. Front entrance stoops now use the same
shared source rectangles as secondary exit stoops. A source verandah retains
its existing grade+70mm paving, with a real landing and descending treads from
the selected plinth. No concealed collision bridge or teleport is added. If a
stoop conflicts with rooms, parking/pools or the site boundary, it is omitted
and needs a deliberate site-design correction. Surveyed buildings are not
automatically altered. Supports, guards, accessibility and costing of these
concept steps require professional review.

## Browser performance

Static opaque meshes are reversibly batched by equivalent material uniforms, vertex layout and
8m spatial cell / 3m elevation band. Original IDs and meshes are retained for
finish changes; leaves and glass remain independent. Physics is prepared before
batching and fitted-product colliders are replaced separately. One cached
2048px shadow map refreshes on geometry/finish/door updates; at most two nearby
selected ceiling fittings contribute unshadowed point lights. Walking measures
FPS once per second and adapts DPR between 0.75 and 1.5 with hysteresis. The HUD
shows measured FPS and the 40 FPS target. The renderer requests a high-performance
GPU context; the browser/OS still chooses the actual adapter. PCFShadowMap is
used consistently: Three r185 rewrites deprecated PCFSoftShadowMap, so resetting
it from React would repeatedly dirty shadows and shader configuration. Glass
uses reflected alpha glazing, avoiding a second whole-scene transmission pass.
Existing floor triangles receive small cached contact-occlusion maps derived
from their actual room and fitted-product footprints, with independent UVs so
selected tile sizes and colours remain intact. Upholstery uses a tiny procedural
woven normal map. These visual approximations need no per-frame AO pass and are
not manufacturer material scans or engineering shadow simulations.
This is not a guarantee for all GPU,
browser, power, resolution and project combinations. Orbit rendering remains
on demand; Escape stops the continuous loop.

## Verification

- `npm run test:walkthrough-access`: actual door partition/physics, source access,
  independent room material domains and changing tile coverage.
- Existing walkthrough, plan-edit, planner, emergency, quantity and cost tests.
- `python blender/test_pipeline.py <input.json>`: source openings, stair heights,
  stepped waists, slabs and voids.
- To test an actual generated GLB, set `WALKTHROUGH_VILLA_JOB` to its saved job
  directory before running `test:walkthrough-access`. The test checks the exact
  main entrance, moves through both stair flights up and down, and opens/walks
  through the source secondary exit using real mesh collision.
