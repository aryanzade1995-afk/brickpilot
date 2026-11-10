# Ray-traced massing

Open **3D massing → Realistic house view → Ray-traced**. The current visible house, live facade, services, solar, parked car and neighbourhood are sampled into a read-only scene snapshot. The interactive viewer and source geometry remain the same. Dragging uses the responsive raster view; the image accumulates again after the camera stops. Traffic freezes at its current position and resumes on returning to Interactive.

Balanced accumulates 64 samples per pixel; Fine accumulates 128. Progress reports actual completed samples, not a timed percentage. Six light bounces, eight transmission bounces, a finite-area sun, a sky environment and an edge-aware noise-reduction pass provide indirect light, reflections and soft shadows. Daylight and golden hour rebuild the lighting. Geometry, finish colours and source maps are preserved. Shader-only sky and technical overlays are excluded from the tracing snapshot; the sky is replaced by the illumination environment.

This is progressive WebGL2 GPU path tracing, not hardware RTX/DXR acceleration or a 60 FPS ray-tracing guarantee. The actual browser GPU is displayed. No external renderer or remote API is called. The compatible `three-gpu-pathtracer` version is pinned to 0.0.24; `three-mesh-bvh` is pinned to 0.9.8. BVH construction uses a bundled worker. The tracing code is lazy-loaded only when requested. Rendering stops at the selected sample target and while hidden/offscreen. Changes to the displayed design restart accumulation. Unsupported float targets or context failure show an explicit error, with Interactive still available.

Existing Download Villa → Live view snapshot captures the displayed image, including its current ray-tracing convergence. Existing Blender renders/downloads are unchanged.

Implementation reference: [three-gpu-pathtracer 0.0.24](https://github.com/gkjohnson/three-gpu-pathtracer/tree/v0.0.24). All npm dependencies use their existing licenses.

Checks: `node --experimental-strip-types --test scripts/test-massing-raytrace.mjs scripts/test-elevation-palettes.mjs`, `npm run lint`, `npm run build`. The scene tests verify world-space extents, visibility, selected colours/maps, resource ownership and daylight/golden-hour light direction.
