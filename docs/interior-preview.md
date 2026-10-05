# Fast 360° Interior Preview

Open AI Interior and use the Fast 360° panel above the existing AI image workflow.
Choose floor, room, style, flooring and colour, wall colour, ceiling and colour,
lighting, furniture density, and quality. Generate, then drag the panorama, scroll or pinch to zoom, and use Full screen to look
around or download its WebP image.

Requires Node 22.18+ (native TypeScript support) and Blender 4.2+; tested on the
project's portable Blender 4.5.14. The existing launcher discovers portable
Blender in `output/tools` or uses `BLENDER_BIN` / PATH. Run `npm run dev` as usual.

`POST /api/interior-preview` accepts `{design, config, quality}`. The server
validates the plan and configuration, reconstructs the selected room, and never
accepts a client-supplied scene. Source BuildingModel wall coordinates, thickness,
opening positions and vertical limits, slab thickness and intersecting columns
are retained in room-local metres. The source plan is not mutated. Furniture
uses the existing rule-based room placer; ceiling treatments are decorative
additions beneath the unchanged structural ceiling. Leafless openings stay open;
directly connected visible rooms use their source geometry. No adjacent room is invented.

Eevee renders six 90° perspective faces and stitches an equirectangular panorama:
fast 2048×1024 / 32 samples; high 4096×2048 / 96 samples. The viewer uses the
existing Three.js dependencies. Render time depends on hardware and quality.

SHA-256 cache keys include the complete scene/configuration, quality and renderer
version, using sorted object keys. Completed outputs are atomically published in
ignored `output/interior/<designId>/<roomId>/<hash>/preview-360.webp`. Identical in-flight requests
share one job. Failed jobs are retryable; the server reports configuration,
validation, Blender startup, render, and timeout failures. Each job retains its
source scene and render log for diagnosis. Cache images are served only through
strict hash URLs, with immutable caching.

GPU/driver errors automatically retry basic Eevee lighting through OpenGL. Linux
can use Mesa software rendering when installed; Windows still needs a compatible
OpenGL driver. A system with no usable graphics backend reports a useful failure.
Double-height galleries are rejected with a preparation error, preserving their
geometry rather than inserting a ceiling across a source void.

`npm run test:interior` checks living room, bedroom and kitchen configurations,
geometry invariance, source dimensions, non-mutation, cache identities and invalid
selections. Set `INTERIOR_RUNTIME=1` to additionally render these rooms and a high
quality living room. Set `INTERIOR_API=1` with the server running on port 8787 to
exercise the HTTP route and image delivery instead of calling the renderer directly.
Fixtures match the original prompt: living room with beige marble, cream walls and cove ceiling; bedroom with wood floor, warm white walls and tray ceiling; kitchen with grey tile, white walls and plain ceiling.

