# Walkthrough rendering upgrade

## Integration audit

Formstead uses React 19, Three.js 0.185 and React Three Fiber 9. The accepted
Blender villa GLB is the visible and collidable architectural authority in
`AcceptedVillaWalkthrough` / `WalkthroughAssetPreview`. The validated
`BuildingModel` provides source room, surface, opening and level records.
`FirstPersonController` and the Rapier-backed `HouseWalkingSimulation` retain
WASD, drag/pointer-lock look, interactive doors and actual stair treads.

`interiorFinishes()`, existing Brief specification overrides and finish
assignments remain the selection authority. `prepareWalkthroughAppearance`
describes the same room-specific products, 22 licensed optimized asset models,
fallback furniture and fitted products used by the existing delivery pipeline.
The lighting upgrade does not introduce another catalogue, price or plan.

Existing optimizations retained: demand rendering outside walking, spatial
static batching, shared asset templates/textures, frustum culling, separate
moving door meshes, one cached sun shadow map and two nearby unshadowed room
lights. Original accepted downloads, exterior rendering and panorama jobs
retain their existing endpoints.

## Cycles pipeline

1. `POST /api/walkthrough-lighting` revalidates the submitted design, resolves
   the accepted GLB from its published job record and verifies plan identity.
2. A SHA-256 cache identity includes accepted GLB bytes, lighting-layout
   signature, bake settings and bake-engine source version. No seed search or
   architectural generation occurs.
3. `blender/walkthrough_bake.py` imports that exact GLB. Existing canonical
   furniture, fittings and ceiling skins become static occluders/emitters.
   Tagged moving door leaves are excluded; windows transmit daylight.
4. Receiver faces retain stable source mesh names through a face attribute.
   Meshes are joined only in the offline bake scene, grouped by floor. The
   runtime receives the original objects, never this joined receiver model.
5. Cycles creates non-overlapping padded atlas UVs and bakes INDIRECT diffuse.
   A second DIRECT diffuse pass, with every lamp and emitter disabled, adds
   visible sky light through the real apertures. Without that pass, sky light
   reaching room surfaces directly would be missing when unoccluded browser
   ambient is suppressed. The sky's solar disc is disabled; directional sun
   and local direct fixture lighting remain in the live renderer. The manifest
   records `skyDirectBaked: true`; `directLightBaked: false` refers to the dynamic
   lamps/sun. AO is a separate pass. Balanced uses 2048 px atlases, 32 samples and 8 px
   padding. Performance: 1024/16; offline high: 4096/64. OptiX/CUDA is preferred,
   with CPU fallback. The viewer currently requests Balanced baking.
6. An explicit OpenImageDenoise HDR compositor pass filters each indirect atlas
   before publication. Cycles' render denoising switch does not denoise texture
   bakes. The first raw bake showed firefly noise; this dedicated pass removed
   it in the browser. The indirect-only three-atlas bake took 86.18 seconds on
   the warm RTX 3050 OptiX device; the final sky-corrected duration is recorded
   in its manifest and the results report.
   Output: HDR indirect maps, non-colour PNG AO, `layout.bin` containing world
   triangle positions plus raw Blender UVs, and `manifest.json` with hashes,
   source identity, mappings, settings, device, duration and qualifications.
   Artifacts are published atomically after completeness checks. Logs/input
   files are not public endpoints. UV delivery supports HTTP gzip.
7. The browser validates identity and matches world-space triangles, converts
   the image/UV V convention and adds `uv2`. Positions, bounds, normals,
   source IDs and collision geometry are unchanged. Unmatched surfaces retain
   real-time lighting with an explicit status.
8. `acceptedVillaFinishes` interpolates and preserves `uv2` when splitting
   triangles into room finish domains. AO contact shading continues to use
   `uv1`, so it cannot overwrite the lightmap channel.
9. HDR irradiance uses `lightMap.channel = 2`; AO also uses channel 2. The
   bright residential viewing style retains neutral live ambient/IBL fill
   alongside the baked bounce. Replacing that fill entirely with the dim
   atlases made light paint and flooring appear charcoal. Three's normal
   light-map chunk adds the bake once. Diffuse AO is blended at 25% strength
   to keep soft contact definition; specular AO remains active. This viewing
   fill is an artistic presentation choice, not physically isolated GI or a
   measured daylight simulation.

The transport bake uses a documented neutral reference reflectance so paint
and albedo changes reuse lighting. Strong material colour bleeding is therefore
an approximation. Moving furnishings, ceiling geometry, glazing/metal class or
emitters invalidates the lighting signature and requires an explicit new bake.
The accepted building is never regenerated. Doorway indirect light is baked
with moving leaves absent; closed-door indirect occlusion is approximate.

Only a daylight lighting package is offered. The room-panorama lighting selector
belongs to that separate preview workflow; it does not pretend to switch a
daylight bake into an evening bake.

## PBR and visual refinements

`pbrSurfaces.ts` supplies reusable paint, gypsum, timber, floor and stone
microdetail profiles. Neutral roughness/normal maps modulate the selected
material without recolouring it. These are illustrative surface details,
not claimed manufacturer scans. Source metre UVs and catalogue dimensions
continue to control texture scale. Existing tile/grout relief, polished-surface
clearcoat, stone slab cut-outs, furniture bevels, cloth sheen and imported PBR
maps remain active.

Skirting uses the same 100 mm height already configured and quantified in the
BOQ. It follows actual solid wall fragments, leaves doorways clear and is
omitted behind full-height wet-room wall tiling. No extra cost is invented.
Existing source doors, handles, hinges, glass, stairs and guards stay in place.

The renderer keeps ACES tone mapping. Runtime sun direction matches the bake.
Matte painted walls attenuate the studio reflection environment and use gentler
plaster microdetail. The bright residential fill replaces the earlier weak
paint-only shadow lift: whole rooms, pale floors and concrete returns now
retain their light selected appearance in baked mode too. Paint colours,
textures, roughness and emissive values are unchanged. It adds no lights,
render passes or geometry.
Nearby ceiling fittings use a bounded, illustrative direct-light budget scaled
to the actual room area, capped at 24 intensity units across two nearby fittings,
selected within the actual source room and absolute source floor/ceiling levels.
This avoids lighting adjacent rooms through walls. It is visual illumination,
not manufacturer photometry or a validated lux calculation.
Selected transparent glazing uses one alpha pass rather than a full-house
transmission prepass. Reflections use the existing local PMREM environment;
they are not ray-traced, room-accurate mirror reflections.

## Performance controls and measurements

The three UI presets are Performance, Balanced (default), and High Quality.
All target 60 FPS with a 50 FPS minimum goal. Balanced starts at DPR 1 and caps
at DPR 1, avoiding accidental 4K rendering on a 1080p viewport. Adaptive
resolution remains explicit in the telemetry; it is not evidence that native
1080p sustained the target.

Shaders are precompiled before enabling walking. The two nearby point lights
remain in the shader layout even when unused (zero intensity), preventing
light-count recompilation at room boundaries. Architecture and collision
geometry never change while moving. Static source buffers and material/texture
caches remain reused. GPU timer queries are asynchronous, bounded to three
pending queries and discarded on disjoint measurements.

The performance report records actual GPU renderer string, drawing-buffer and
display sizes, DPR, quality, sample duration, average FPS, lowest one-second
window, P95/P99 frame time, CPU submission time, GPU time where available,
draw calls, triangles and texture/geometry counts. It can be downloaded from
View settings after walking. CPU submission time is not presented as GPU time.

The host has an RTX 3050 6 GB Laptop GPU and Intel UHD. Cycles actually selected
the RTX via OptiX. The in-app browser actually selected Intel UHD / ANGLE D3D11.
Browser measurements therefore cannot certify RTX 3050 walkthrough FPS. The
initial pre-upgrade 1920×1080 viewport capture included startup and adaptive
resolution; it is a visual baseline, not a controlled FPS comparison.
Final measured records and comparison captures are stored under `outputs/`.

## Verification and remaining limits

Verified against the current accepted two-storey villa: 415 receiver meshes
matched the original GLB, all atlas HDR values are finite/nonblank and the
building bounds are identical. The complete existing movement, door, stair,
room-material, asset and cost-preservation regression suites are retained.
UV interpolation, stale manifests, invalid paths/ranges, paint reuse, lighting
invalidation and no-double-lighting behaviour have dedicated tests.

This is an interactive rasterized renderer with baked diffuse transport, not
browser Cycles. It cannot guarantee offline Cycles image quality. No evening
bake, ray-traced mirrors, measured manufacturer PBR maps, KTX2/Basis encoder,
Meshopt conversion or geometry LOD generation is claimed. Those compression
and LOD stages remain future work; the accepted geometry has not been degraded
or replaced to claim a frame-rate target. A representative sustained 50 FPS
RTX 3050 result must be measured in a browser using that GPU.

## Files and rerun commands

New modules: `blender/walkthrough_bake.py`, `blender/walkthrough_denoise.py`,
`server/walkthrough-lighting.mjs`,
`src/lib/walkthrough/lighting.ts`, `src/lib/three/walkthroughLightmaps.ts`,
`src/lib/walkthrough/roomLighting.ts`,
`src/lib/three/pbrSurfaces.ts`,
`src/components/interior/WalkthroughBakeControls.tsx`.

Main integration edits: accepted villa viewer/controller components,
`acceptedVillaFinishes.ts`, `loadWalkthroughAsset.ts`, `walkthroughBatches.ts`,
`WalkthroughLighting.tsx`, `WalkthroughPerformance.tsx`, `quality.ts`,
`fittedFinishes.ts`, server routing and English/Hindi/Marathi messages.

```text
node --experimental-strip-types scripts/bake-accepted-walkthrough.mjs <accepted-job-directory> balanced
node --experimental-strip-types scripts/check-walkthrough-lightmaps.mjs
node --experimental-strip-types --test scripts/test-walkthrough-lighting.mjs
npm run build
```

Runtime guidance: Three.js `MeshStandardMaterial.lightMap` and texture channel
documentation: https://threejs.org/docs/pages/MeshStandardMaterial.html
