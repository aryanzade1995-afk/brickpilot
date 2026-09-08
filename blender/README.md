# BrickPilot — Blender procedural house generator

The 3D **house geometry** engine. It consumes a `DesignSpec` (from
`src/architecture/generateDesign.ts`) and builds a real parametric villa from
components — building masses, floor slabs, walls, doors, windows, **stairs**,
balconies, verandahs, roof, facade elements, materials — then exports **GLB**
for the existing three.js viewer.

```
brief  ->  engine floor plan (src/lib/engine, `Design`)
       ->  StyleGrammar     (src/architecture/grammar.ts)  +  StylePattern (library/stylePatterns.ts)
       ->  resolveGenome()  ->  DesignGenome  (seeded, compatibility-checked, reference-nudged)
       ->  resolveMassing → resolveStructure (grid → columns → beams → slabs)
       ->  doors + balconies → room-aware windows → stairs (NBC) → facade (anchored)
       ->  auditArchitecture()  — major errors ⇒ regenerate (4-attempt rejection loop)
       ->  DesignSpec { +grid, +genome, +fingerprint, +audit, per-floor columns/beams/slabs }
       ->  POST /api/generate   (server/villa.mjs — resolves a GLB)
       ->  blender/generator/   (headless, offline / CI)  ->  GLB / GLTF
       ->  three.js viewer      (loads the GLB; else the procedural buildMassing model)
```

**The structural frame is the skeleton.** `structure.py` builds Columns / Beams /
Slabs FIRST, from `spec.floors[].columns/beams/slabs` — every piece was resolved
with a support relationship (`structure.ts`): columns align vertically within
50 mm or get a transfer beam, every slab is carried by a block or a beam, porches
run canopy → beam → column → ground. `dims.ts` centralises every dimension
(§15 — no magic numbers). `auditArchitecture` (§14) checks entrance / reachability
/ openings / structure / stairs / facade anchoring / plumbing and returns
`{valid, score, errors, warnings}`; `house_generator.py` prints it and
`validator.py` blocks the bake on a major error.

**The DesignGenome is the single design intent.** `spec.genome` names the
massing composition, upper-floor strategy, roof form, entrance, balcony type,
facade composition, screen, glazing, courtyard, parking and landscape — all
drawn from `src/architecture/library/architecturalVocabulary.ts`. Every
generator module reads it, so the massing, roof, openings, balconies and facade
of one build all agree. `house_generator.py` prints the genome + its
architectural fingerprint on every run.

Three.js is the **viewer**, not the geometry author. Blender is run **offline /
in CI** — users never install it; the app serves pre-baked GLBs from
`public/villas/` (or, opt-in, a server with `BLENDER_BIN` set generates on
demand).

## Layout

```
blender/
├── generator/
│   ├── house_generator.py   entry point (CLI); --mode study|detailed|cutaway
│   ├── context.py           spec loading + Blender helpers (bpy optional); linked_box() for repeats
│   ├── massing.py            storey volumes (+ cantilever overhang)
│   ├── floors.py             floor slabs
│   ├── rooms.py              interior partitions (cutaway mode; tagged bp_room)
│   ├── walls.py              exterior wall shells, keyed by (level, side)
│   ├── doors.py              entry (canopy / double-height) + balcony/court doors
│   ├── windows.py            cut openings + frame + glass + mullions (room-driven)
│   ├── stairs.py             stepped dog-leg flight from StairSpec (linked treads)
│   ├── roofs.py              flat-parapet / band / eave / mono-slope / hip / gable
│   ├── balconies.py          slabs + railings (cantilever / recessed / corner / continuous / verandah)
│   ├── facade.py             plinth · base cladding · string course · chajja · fins ·
│   │                         jaali · cladding · feature pier · feature tower · verandah · pergola · canopy
│   ├── materials.py          principled-BSDF per material slot (cached)
│   ├── optimize.py           join per collection, drop doubles, tri report
│   └── validator.py          spec checks (no bpy) + built-scene checks
├── styles/tuning.json        Blender-only render knobs per style
├── export.py                 GLB export (Y-up, extras kept -> viewer layer toggles)
└── bake/bake.mjs             batch: specs -> GLBs + manifest.json
```

## Run one villa

```bash
# 1. emit spec JSON from the engine + grammar
npx tsx scripts/export-specs.mts --out blender/specs --seeds 4

# 2. build — needs Blender 4.x on PATH (or $BLENDER)
blender --background --factory-startup \
  --python blender/generator/house_generator.py -- \
  --spec blender/specs/<id>.json --out public/villas/<id>.glb --mode detailed
```

`--mode`: `study` (solid volumes, fast) · `detailed` (wall shells + real
openings + stairs, default) · `cutaway` (detailed + trimmed interior partitions
— the dollhouse).

Without Blender, `python blender/generator/house_generator.py --spec <id>.json`
runs the **spec validator only** and prints the build plan — this is what CI
uses to gate a bake.

## Bake a library

```bash
npx tsx scripts/export-specs.mts --out blender/specs --seeds 4      # ~240 specs
node blender/bake/bake.mjs --in blender/specs --out public/villas   # -> GLBs + manifest.json
```

`bake.mjs` finds Blender via `$BLENDER` then common install paths; it writes
`public/villas/manifest.json`.

## Serving the GLB

`POST /api/generate { spec }` → `{ glbUrl, cached, validation, note }`
(`server/villa.mjs`):

1. match `spec` against `public/villas/manifest.json` (offline bake) → cached URL
2. else, if `BLENDER_BIN` is set → generate that one spec on demand
3. else → `{ glbUrl: null }` and the viewer keeps the procedural `buildMassing`
   model. **No bake at all ⇒ the app is unchanged.**

The client (`src/lib/three/villaCatalog.ts`) calls the endpoint, then falls back
to matching the static manifest itself (pure-static hosting).

## Performance

`optimize.finalize()` joins every collection into one mesh (named after the
collection, so viewer layer toggles still work) except `Partitions`, kept
per-room. Repeated elements (fins, mullions, stair treads, pergola slats,
columns) are linked duplicates — one mesh, many objects — so the pre-join scene
stays small. Typical output: ~8–12 objects, a few thousand triangles.

## How a style changes the geometry (not just materials)

`spec.genome.massingComposition` is one of 13 vocabulary terms
(`offset_volumes · cantilevered_volumes · split_volumes · stepped_volumes ·
floating_upper_volume · side_wing · single_volume · stacked_volumes · …`),
resolved from the style's weighted distribution + the reference library + the
seed; it maps to the engine strategy `stacked · offset_volumes · stepped ·
cantilever · split_mass · linear` plus the seeded offset/cantilever magnitudes,
so `massing.py` builds a genuinely different **form** per style and per seed.
`scripts/diversitytest.mts` shows ~47–49 / 50 architecturally distinct designs
from one fixed brief per style. `roofs.py` reads a per-block roof form (Kerala → hip 22–28°, tropical
→ mono-slope 12–20°, modern → flat band). `facade.py` only emits the elements
the style's `FacadeRule` allows — Kerala: verandah on square columns + laterite
plinth + brick jaali; modern-Indian: brise-soleil fins + feature tower + stone
pier; luxury: porte-cochère canopy + travertine cladding + wrap verandah +
double-height entry. `windows.py` places the room-driven openings from
`windowGenerator.ts` (≤ 3 per room, never over a door, upstairs generated
independently).
