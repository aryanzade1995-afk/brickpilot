# Blender architectural visualization

The existing verified building geometry now receives a separate visualization
stage: curated PBR finishes, physical finish profiles, source-aware planting,
architectural lights and four framed cameras. The source plan, rooms, openings,
stairs and massing are retained. The application UI and live Three.js renderer
are unchanged; this stage produces Blender scenes, GLB and camera renders.

## Run from the project folder

Create an input from an existing verified Design using `blender:input --design`,
or create the demo input:

```powershell
npm run blender:input -- --out output/blender-input.json --seed 41
```

Fast EEVEE preview:

```powershell
npm run blender:export -- --input output/blender-input.json --out-dir output/visualization --name villa_preview --palette WHITE_STONE_WOOD --quality preview --render
```

Cycles final, with 128 samples, adaptive sampling, denoising and 1800×1350 output:

```powershell
npm run blender:export -- --input output/blender-input.json --out-dir output/visualization --name villa_final --palette WARM_BEIGE_TIMBER --quality final --render
```

Four dusk views:

```powershell
npm run blender:export -- --input output/blender-input.json --out-dir output/visualization --name villa_dusk --palette WHITE_FLUTED_STONE --lighting dusk --render-all
```

Optional local environment image:

```powershell
npm run blender:export -- --input output/blender-input.json --out-dir output/visualization --name villa_hdri --hdri "C:\assets\courtyard.exr" --quality final --render
```

The runner detects a local portable Blender under `output/tools/`, otherwise
uses `BLENDER_BIN`, `--blender` or `blender` on PATH. Blender 4.5 LTS was used
for local verification. No image-generation API is required.

## Seven curated palettes

| Palette | Visual direction |
| --- | --- |
| WHITE_STONE_WOOD | Off-white plaster, pale limestone and warm oak |
| WARM_BEIGE_TIMBER | Beige plaster, muted mineral surfaces and timber |
| GREY_CONCRETE_GLASS | Cool concrete, charcoal metal and clear glazing |
| WHITE_FLUTED_STONE | White plaster, light stone and physical vertical flutes |
| CHARCOAL_WOOD_WHITE | White primary surfaces, charcoal secondary surfaces and timber |
| SANDSTONE_PLASTER | Sandy plaster, sandstone and restrained warm accents |
| CONCRETE_TIMBER_GREEN | Mineral walls, timber and muted green accents |

Every palette has nine semantic finish roles: primary wall, secondary wall,
accent, stone, wood, metal, glass, door and railing. Additional shared materials
serve soil, leaves, lawn, paving and light diffusers; a complete scene uses at
most 14 materials. Existing DNA palette names map to these curated palettes;
there is no new random material selection.

The default area budget is **65% primary / 25% secondary / 10% accent**.
Whole source exterior walls receive coordinated finishes across their piers,
sills and headers. The manifest reports target and measured opaque exterior
wall area shares. This measurement excludes glazing, interiors, roof surfaces
and separate facade features, so it is not a claim about every visible pixel.
Discrete wall sizes can make actual percentages differ slightly.

## PBR and physical details

- Hex finish colors are converted from sRGB to linear shader values.
- Plaster, concrete, stone, wood, soil and paving use physically scaled
  procedural texture and bump nodes. Microrelief is submillimetre for wall
  finishes rather than exaggerated displacement.
- Wood grain has a vertical anisotropic scale, moderate roughness and a
  restrained protective coat. Doors have a separate timber finish.
- Metal and railing use high metallic values with moderate roughness.
- Glass uses transmission 1, IOR 1.45, low roughness and subtle absorption.
- Stone courses, timber door slats and fluted stone panels create actual
  separate geometry with Array modifiers. The substrate is recessed so these
  profiles are visible. The composite finish remains inside the original solid
  envelope. Source apertures and Boolean niches remain open.
- Profiles are conditional on sufficient source face width, height and depth.
  Existing validated facade parts retain their declared dimensions and receive
  PBR finishes; narrow existing fins are not covered with additional profiles.
- Bevels, materials, collections, individual object names and arrays remain
  editable in the `.blend` scene.

Procedural shader graphs and world lighting are preserved in **.blend**.
GLB carries the editable object's exported geometry and supported PBR factors,
but does **not** reproduce arbitrary Blender noise/bump graphs, Cycles lighting
or the world environment. Texture baking would be a separate later step.

## Landscaping and access

Source balconies can receive compact planters only when a clear source room
patch and door approach remain. Entry and side plants respect the property
boundary, indoor rooms, parking, planned outdoor circulation and window/door
clearance. Terrace greenery requires a supported roof patch, source stair and
clear 800 mm route; it is omitted with a manifest reason when these do not fit.
Balcony, entry and terrace greenery receive priority before side planting uses
the remaining placement budget.

Planters contain a base, separate rim walls and soil. Their foliage uses shared
closed lanceolate leaf meshes and stems, with a stable numeric-seed stream per
source placement. Existing grammar planters receive foliage in their existing
footprint. Compatible main entries receive three 133 mm approach risers to the
existing floor datum; steps are omitted when they would occupy reserved parking.
A neutral presentation ground surrounds the unchanged property terrain.

All optional placements are conditional. Landscape objects are presentation
geometry, not changes to the generated floor plan.

## Lighting and cameras

DAY and DUSK presets coordinate sun direction, sun strength and sky exposure.
The default world uses a procedural sky and a separate sun with a small angular
size for natural shadow softness. An optional local `.hdr` or `.exr` environment
replaces the sky and is packed into the saved `.blend` file. HDRI rotation is
configurable.

Small warm entry fixtures use actual metal housings, emissive diffusers and
area lights on a compatible exterior wall. Fixture placement avoids source
openings and existing facade features. Living, dining, foyer and family-lounge
spaces can receive restrained warm ceiling lights; daylight intensity is lower
than dusk intensity.

Four cameras are always created and framed against the actual architectural
mesh bounds:

| Camera | Purpose |
| --- | --- |
| FrontCamera | Orthographic front elevation |
| HeroPerspectiveCamera | Main photographic perspective, 48 mm lens |
| SideCamera | Orthographic side elevation |
| AerialCamera | Elevated perspective, 40 mm lens |

The default active camera is HeroPerspectiveCamera. `--camera FrontCamera`
selects another camera. `--render-all` writes one PNG per camera.

Both render engines use AgX color management, a consistent exposure and opaque
PNG output. EEVEE previews enable ray tracing; Cycles finals enable adaptive
sampling, denoising and adequate transmission bounces for glazing. CPU Cycles
is the portable default; it does not require GPU-specific setup. EEVEE needs a
working supported graphics context.

## Configuration

Use `blender/visualization.example.json` as an editable configuration:

```powershell
npm run blender:export -- --input output/blender-input.json --visualization blender/visualization.example.json --out-dir output/visualization --name configured --render
```

An input payload may also contain an optional `visualization` object with the
same schema. Neither requires changing the four architectural inputs. File
settings override payload settings, and explicit command flags override both.

Available flags include `--palette`, `--engine eevee|cycles`,
`--quality preview|final`, `--camera`, `--samples`, `--resolution 1600x1200`,
`--lighting day|dusk`, `--hdri`, `--visualization`, `--render` and `--render-all`.
`--quality final` selects Cycles, 128 samples and 1800×1350 unless explicitly
overridden. Relative paths resolve from the project working directory.

Limits, booleans, composition budgets, camera/engine names and HDRI existence
are checked **before** scene creation. Unknown configuration keys fail clearly.
The export manifest includes resolved settings, materials/area shares, physical
surface counts, placement records/omissions, cameras, lighting and render paths.

## Code and verification

| Module under `blender/visualization/` | Responsibility |
| --- | --- |
| `config.py`, `palettes.py` | Pure validated settings and curated PBR specifications |
| `materials.py`, `surfaces.py` | Node materials, area budgeting and physical profiles |
| `placement.py`, `landscape.py` | Access checks, supported planting and botanical instances |
| `lighting.py` | Sky/HDRI, sun, fixtures and interior emission |
| `cameras.py`, `render.py` | Four framed cameras and EEVEE/Cycles settings |

Pure tests:

```powershell
python blender/test_visualization.py output/blender-input.json
python blender/test_pipeline.py output/blender-input.json
```

The visualization test's roof fixture assumes the provided input has the demo
roof caps; use `output/specialized-input.json` generated with seed 41 for that
particular fixture check.

Actual scene checks:

```powershell
blender -b --python-exit-code 1 --python blender/test_visualization_runtime.py -- --blend output/visualization/villa_preview.blend --manifest output/visualization/villa_preview.json
blender -b --python-exit-code 1 --python blender/test_runtime.py -- --input output/blender-input.json --blend output/visualization/villa_preview.blend --glb output/visualization/villa_preview.glb
```

These inspect all seven actual palette node graphs, material count, camera
framing, physical profiles, render settings, packed HDRI when present, source
openings, recesses, stair voids, solid meshes and GLB validity. Local verification
includes EEVEE, Cycles, four dusk views, physical flutes, terrace planting and a
packed HDRI on a source Boolean-recess scene. The renders are architectural
concept visualizations; source geometry and scene dressing still determine
their realism.
