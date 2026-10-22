# Blender walkthrough and full-page walking

## Current default: exact accepted Massing villa

The AI Interior walkthrough now uses `useBlender.accepted[currentPlanId].files.glb`, the same URL as the **Blender design** tab in 3D Massing. `AcceptedVillaWalkthrough` opens that export directly through `parseAcceptedVilla()`. It preserves the exported hierarchy, vertex/index buffers, transforms, embedded materials and included objects. It does not call `prepareVillaScene`, a material resolver, room dresser or Blender generation endpoint. Missing or mismatched exports do not fall back to another house. The exact URL is also used by the download link.

Physics copies the actual visible mesh triangles into one Rapier trimesh, baking parent world transforms and mirrored winding into separate arrays. The shared validated-plan adapter provides room labels, floor levels, stair regions and candidate entrances only. It does not contribute hidden replacement walls, furniture, slabs or doors in this mode. The entrance must pass clearance and support checks against the actual imported mesh. Unsupported navigation leaves the exact model available in orbit view and reports the reason.

Closed doors stay closed and solid, as exported. There are no synthetic door leaves, hidden door removal or guessed swings. Furniture is included only when it already exists in the accepted GLB; the separate **Furnished** Massing scene and 360° room previews are not appended. Current Finishes & Cost changes do not repaint this immutable export. When its finish signature is old, the UI explicitly says the saved materials are being shown and directs the user to update the accepted villa in Massing. A new accepted export URL replaces the model; room preferences and finish-only changes do not reload it.

Run `npm run test:accepted-villa-walkthrough` for hierarchy/material identity, foreign-plan rejection, transformed triangle collision, and actual-mesh wall collision tests. An optional real-file test uses `ACCEPTED_VILLA_GLB`, `ACCEPTED_VILLA_METADATA` and `ACCEPTED_VILLA_COLLISION` paths; it checks the accepted model's actual entrance and preserves a before/after source snapshot.

## Separate prepared interior export (retained delivery API)

The existing `WalkthroughAssets`/delivery API remains available in code but is no longer the default AI Interior walkthrough. That separate path retains actual `house.glb` furniture meshes, normals, bevels, embedded product swatches and selected PBR materials. `materials.json` includes the canonical fitted parts/skins so `adoptBlenderWalkthroughAppearance()` can establish the exact exported room signatures. It preserves world transforms under imported glTF axis roots. Its appearance reconciler keeps those meshes until the user changes that room's products; paint/floor edits update only the relevant material slots. It never places a duplicate furniture set on top of that GLB.

Blender now adds small appearance-only furniture bevels, weighted normals and smoother round fittings. The immutable source shell and its collision dimensions are untouched. Changed-room live previews use equivalent bounded rounded boxes; re-exporting retains the Blender version. These remain qualified product representations, not newly verified supplier meshes.

The live viewer uses local PMREM image-based reflections, ACES tone mapping, hemisphere fill and a single bounded 2048px soft shadow map. No remote HDR request or extra canvas is required. Cutaway materials also clip their shadows; glass does not cast an opaque shadow. Lighting is real time, not a reproduction of a Blender Cycles beauty render or a validated lighting analysis. Demand rendering and the existing 1.5 DPR cap remain.

## Walking

Click **Walk inside** to expand the same canvas to a fixed full-page view. The background page is inert and its scroll is locked only for this mode. The first-person cursor is hidden; the overlay includes WASD movement buttons, E for doors, an adjustable look speed and **Exit · Esc**. The default look speed is 1.75 times the old setting. Eye height, movement speed, stair stepping and collision remain unchanged.

Native pointer lock provides unrestricted mouse look in supporting browsers. If capture is rejected (including the embedded-browser Chromium failure), the full-page view remains open with explicit drag-look guidance and the same physics. It does not pretend that native pointer lock succeeded. Escape, the Exit button, focus loss and unmount release capture, stop held movement, restore the orbit camera, restore the canvas cursor, unlock page scrolling, remove temporary inert state and return focus to Walk inside. Pending lock failures cannot reopen a mode after it was closed. Door interaction applies only to the separate prepared interior export; exact-villa mode preserves the source closed doors.

Tests cover the faster/clamped look calculation, source geometry/collision preservation, actual Blender GLB delivery, retained Blender mesh/material identities, room-specific finish updates and cancellation. Browser checks cover viewport expansion, cursor hiding, controls and Escape restoration.
