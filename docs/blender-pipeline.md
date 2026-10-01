# Blender procedural geometry

This is a headless export stage beside the existing Three.js renderer. The
verified 2D plan remains the source of rooms, floor plates, walls, doors,
windows, stairs, balconies and columns. No independent floor plan is made.

```text
verified Design
  -> BuildingModel + seeded VillaDesignDNA
  -> validated MassingModel + validated FacadeGrammar
  -> blender-input.json
  -> Blender Python
  -> editable .blend + .glb + optional .png
```

## Run

Install Blender 4.2 or newer and make `blender` available on `PATH`, or set
`BLENDER_BIN` to the full path of `blender.exe`.
The runner also detects portable Blender folders under `output/tools/`.

```powershell
npm run blender:input -- --out output/blender-input.json --seed 41
npm run blender:export -- --input output/blender-input.json --out-dir output/villa --name villa_41
```

To use an existing verified `Design` JSON, pass
`--design C:\path\to\design.json` to `blender:input`. The input exporter
revalidates the plan, massing and facade and rejects failed candidates. The
demo accepts `--plot-width 25 --plot-depth 25 --courtyard --massing courtyard`.
The Blender script checks plan IDs, seeds, statuses, setbacks and every opening's
wall host before creating meshes. `--render` on `blender:export` also produces
a camera render. Blender export is invoked through a Node child process with
argument arrays, so paths with spaces work on Windows.

The runner uses a clean Blender startup and returns a failure when its Python
script fails. Generated files and the optional local runtime belong in ignored
`output/`, rather than in Git.

The [visualization layer](blender-visualization.md) now configures curated PBR
materials, physical finish profiles, source-aware landscaping, four cameras and
professional lighting. `--quality preview` uses EEVEE (the default), while
`--quality final` uses denoised Cycles. Add `--render-all` for four views, or pass
`--palette`, `--lighting dusk` and an optional local `--hdri`.

For a local handoff check without Blender:

```powershell
python blender/test_pipeline.py output/blender-input.json
```

To verify a real export (with Blender), run:

```powershell
blender -b --python-exit-code 1 --python blender/test_runtime.py -- --input output/blender-input.json --blend output/villa/villa_41.blend --glb output/villa/villa_41.glb
```

This opens the saved scene and checks evaluated wall openings, stair slab voids,
closed solid meshes, semantic collections, shared mesh data and the exported GLB.

Verified locally with Blender 4.5.14 LTS on rectangular, courtyard, gable-roof
and Boolean-recess fixtures. The rectangular fixture also produced a Cycles PNG.

## Geometry and editability

`blender/generator.py` orchestrates modules in `blender/geometry` and
`blender/facade`. Inputs are in integer millimetres; meshes are created in
Blender metres with plan X/Y unchanged and Z vertical.

- `create_foundation`, `create_slab`, `create_wall`, `create_column` and
  `create_beam` create separate named objects from the source structure.
- `create_wall` splits each wall into full-height piers and sill/header pieces
  around its actual doors and windows. An opening has **no wall mesh** within
  its clear span and height. Frame, pane and leaf objects are separate.
- `create_staircase` follows the source dog-leg flights in walking order with
  solid steps and a turning landing. Upper slabs and the roof deck contain real
  stair and shaft voids, preserving the destination landing. `create_balcony`
  requires a source balcony, its terrace mass and an
  access door. `create_terrace` only marks a roof deck usable when the source
  stair reaches the top floor.
- Flat roof masses remain editable boxes. Gable, hip and mono-slope choices
  create pitched mesh volumes from the same validated mass rectangles. An
  optional roof pergola needs a clear deck patch and an unobstructed route
  from the source stair; the export manifest records when it is omitted.
- Facade feature parts are built from the validated wall/roof zones. A
  `RECESSED_BOX` uses an exact Boolean cut in its source wall, with a thin back
  panel. Other frames, projected boxes, screens and fins have physical depth.
  `create_parapet`, `create_pergola`, `create_jali`, `create_fins`,
  `create_railing` and `create_planter` emit individual solids.
- Repeated boxes reuse mesh datablocks by size and material. Object names,
  source IDs, collections and controlled bevel modifiers remain editable in
  the `.blend` file; the GLB is the portable scene export.
- [Specialized grammars](specialized-grammars.md) add 40 conditional component
  recipes through `facadeGrammar.specialized`. Blender validates source
  anchors, setbacks, opening/column conflicts and roof support before building
  their separate objects. Deep/shallow facade and entry recesses carve actual
  walls. The manifest records applied recipes and omitted incompatible options.
  Older input files without this optional field retain their baseline parts.

Collections are `STRUCTURE`, `WALLS`, `OPENINGS`, `WINDOWS`, `DOORS`,
`MASSING`, `FACADE`, `BALCONIES`, `ROOF`, `LANDSCAPE` and `LIGHTING`.

This stage checks architectural and geometric consistency. It is not an
engineering or structural certification. The current Three.js viewport still
uses `src/lib/three/buildMassing.ts`; it does not yet display this Blender GLB.
