# Blender walkthrough and full-page walking

The default walkthrough retains the actual `house.glb` furniture meshes, normals, bevels, embedded product swatches and selected PBR materials. `materials.json` includes the canonical fitted parts/skins so `adoptBlenderWalkthroughAppearance()` can establish the exact exported room signatures. It preserves world transforms under imported glTF axis roots. The existing appearance reconciler keeps those meshes until the user changes that room's products; paint/floor edits update only the relevant material slots. It never places a duplicate furniture set on top of the GLB.

Blender now adds small appearance-only furniture bevels, weighted normals and smoother round fittings. The immutable source shell and its collision dimensions are untouched. Changed-room live previews use equivalent bounded rounded boxes; re-exporting retains the Blender version. These remain qualified product representations, not newly verified supplier meshes.

The live viewer uses local PMREM image-based reflections, ACES tone mapping, hemisphere fill and a single bounded 2048px soft shadow map. No remote HDR request or extra canvas is required. Cutaway materials also clip their shadows; glass does not cast an opaque shadow. Lighting is real time, not a reproduction of a Blender Cycles beauty render or a validated lighting analysis. Demand rendering and the existing 1.5 DPR cap remain.

## Walking

Click **Walk inside** to expand the same canvas to a fixed full-page view. The background page is inert and its scroll is locked only for this mode. The first-person cursor is hidden; the overlay includes WASD movement buttons, E for doors, an adjustable look speed and **Exit · Esc**. The default look speed is 1.75 times the old setting. Eye height, movement speed, stair stepping and collision remain unchanged.

Native pointer lock provides unrestricted mouse look in supporting browsers. If capture is rejected (including the embedded-browser Chromium failure), the full-page view remains open with explicit drag-look guidance and the same physics. It does not pretend that native pointer lock succeeded. Escape, the Exit button, focus loss and unmount release capture, stop held movement, restore the orbit camera, restore the canvas cursor, unlock page scrolling, remove temporary inert state and return focus to Walk inside. Pending lock failures cannot reopen a mode after it was closed.

Tests cover the faster/clamped look calculation, source geometry/collision preservation, actual Blender GLB delivery, retained Blender mesh/material identities, room-specific finish updates and cancellation. Browser checks cover viewport expansion, cursor hiding, controls and Escape restoration.
