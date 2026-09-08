# BrickPilot — Blender procedural house generator

The actual 3D **house geometry** engine. It consumes a `DesignSpec` (produced by
`src/architecture/generateDesign.ts`) and builds a real parametric villa —
massing volumes, wall shells with cut openings, roofs, balconies, the style
facade vocabulary, materials — then exports **GLB** for the existing three.js
viewer.

```
AI / brief  ->  engine floor plan (src/lib/engine, `Design`)
            ->  StyleGrammar        (src/architecture/grammar.ts)
            ->  generateDesign()    ->  DesignSpec  (JSON, geometry-free)
            ->  blender/generator/  ->  GLB / GLTF   (this folder)
            ->  three.js viewer     (loads the GLB; falls back to buildMassing)
```

Three.js is now the **viewer**, not the geometry author. Blender is the geometry
author, run **offline / in CI** — users never install Blender; the app serves
pre-baked GLBs from `public/villas/` (or a CDN).

## Layout

```
blender/
├── generator/
│   ├── house_generator.py   entry point (CLI)
│   ├── context.py           spec loading + Blender helpers (bpy optional)
│   ├── massing.py           storey volumes (+ cantilever overhang)
│   ├── floors.py            floor slabs
│   ├── walls.py             exterior wall shells, keyed by (level, side)
│   ├── windows.py           cut openings + frame + glass + mullions
│   ├── doors.py             entry (canopy / double-height) + balcony doors
│   ├── roofs.py             flat-parapet / band / eave / mono-slope / hip
│   ├── balconies.py         slabs + railings
│   ├── facade.py            plinth, string course, chajja, fins, jaali,
│   │                        cladding, feature pier, tower, verandah, pergola
│   ├── materials.py         principled-BSDF per material slot
│   ├── rooms.py             interior partitions (cutaway mode)
│   └── validator.py         spec checks (no bpy) + built-scene checks
├── styles/tuning.json       Blender-only render knobs per style
├── export/gltf.py           GLB export (Y-up, extras kept for layer toggles)
└── bake/bake.mjs            batch: specs -> GLBs + manifest.json
```

## Run one villa

```bash
# 1. emit spec JSON from the engine + grammar
npx tsx scripts/export-specs.mts --out blender/specs --seeds 4

# 2. bake — needs Blender 4.x on PATH (or $BLENDER)
blender --background --factory-startup \
  --python blender/generator/house_generator.py -- \
  --spec blender/specs/<id>.json --out public/villas/<id>.glb --mode detailed
```

`--mode`: `study` (solid volumes, fast) · `detailed` (wall shells + real
openings, default) · `cutaway` (detailed + trimmed interior partitions — the
dollhouse).

Without Blender, `python blender/generator/house_generator.py --spec <id>.json`
runs the **spec validator only** and prints the build plan — this is what CI
uses to gate a bake.

## Bake a library

```bash
npx tsx scripts/export-specs.mts --out blender/specs --seeds 4      # ~240 specs
node blender/bake/bake.mjs --in blender/specs --out public/villas   # -> GLBs + manifest.json
```

`bake.mjs` finds Blender via `$BLENDER` then common install paths. It writes
`public/villas/manifest.json`; the viewer (`src/lib/three/villaCatalog.ts`)
reads that and picks the closest baked GLB for the current design (matching
style · floors · plot size · bedrooms · shape). No manifest ⇒ the viewer uses
the procedural `buildMassing()` path exactly as before.

## CI

A GitHub Action (`blender-official/setup-blender`) can run steps 1–2 on every
push that touches `src/architecture/` or `blender/`, upload the GLBs to R2 /
Supabase Storage, and commit the updated `manifest.json`. The site deploy is
unchanged — it just gains a `villas/` folder.

## How a style changes the geometry

`DesignSpec.massing.strategy` (from `StyleGrammar.massing`) is one of
`stacked · offset_volumes · stepped · cantilever · split_mass · linear`; the
seed picks it and the offsets/cantilevers, so `massing.py` builds a genuinely
different **form** per style and per seed — not a resized base villa. `roofs.py`
reads a per-block roof form (Kerala → hip, tropical → mono-slope, modern →
flat band). `facade.py` only emits the elements the style's `FacadeRule`
allows (Kerala verandah + laterite plinth + brick jaali; modern-Indian fins +
feature tower + stone pier; luxury porte-cochère + travertine + wrap verandah).
`windows.py` places the room-driven openings from `windowGenerator.ts`.
