# Integrated procedural villa generation

## Source of truth and permitted variation

`generateAlternativeDesign(plan, seed)` accepts the existing `Design`. It never
invokes `generate()`, moves source room rectangles, changes floor footprints,
replaces stairs or relocates doors/windows. `BuildingModel` is identical for all
architectural seeds on that plan. The adapter returns validated BuildingModel,
VillaDesignDNA, MassingModel, FacadeGrammar and VillaShapeFingerprint.

Production variation changes supported forecourt canopies and anchored facade
features. The top roof is a flat usable terrace with actual stair headroom and
a corner tank; decorative roof shells, stacked roof boxes and pergolas are
excluded. A hard check requires at least 80% free roof area, including guards.
External piers and canopies occupy clear areas inside setbacks and avoid source
rooms, balconies, parking and outdoor circulation. Invalid additions are omitted
on deterministic retry. Production family names describe the source plan's
actual occupied outline; changing the exterior seed does not change that family.
Occupied
upper-floor coverage/location and the original courtyard remain fixed. Moving
occupied upper floors, removing rooms to make a new ground courtyard, or changing
balcony access positions requires a changed authoritative plan. Cost estimates
continue to describe the source plan and do not price every added concept element.
This pipeline provides geometric/architectural consistency, not engineering certification.

## Production flow

```text
Existing Design + numeric seed
  -> generateAlternativeDesign (no replanning)
  -> BuildingModel + VillaDesignDNA
  -> occupied source masses + seeded exterior canopies (clear terrace)
  -> ArchitectureValidator
  -> FacadeGrammar + architectural/specialized features
  -> Blender --prepare
     source slabs/walls with real openings, stairs, piers, clear terrace and services
     curated materials, landscaping, lighting and four cameras
     evaluated mesh shape measurement + editable staging .blend
  -> last-ten identity quotas + actual mesh similarity rejection
     reject: next deterministic seed, bounded retries
     accept: Blender --resume
  -> GLB + hero/front/aerial PNGs
  -> commit accepted fingerprint history and artifact manifest
  -> website interactive GLB + image previews + downloads
```

`server/villa-jobs.mjs` adds routes to the existing server. One worker runs at a
time; queued jobs return immediately. `scripts/villa-worker.mjs` builds candidates
and launches headless Blender with fixed argument arrays, never a shell string.
Artifacts from rejected candidates are private. Failed jobs retain the displayed
accepted design and source plan. Worker status and accepted manifests are saved
on disk. A history lock prevents simultaneous history changes and records its
owner for stale-lock recovery after a stopped process.

`src/state/blender.ts` persists pending preview jobs and caches direction renders
by **content plan ID + exterior seed**. Two directions sharing room geometry can
therefore keep separate renders. Pinning a direction carries its exact seed into
Massing: the page waits for that preview, then adopts the same GLB and images,
without submitting another random villa. Reloading resumes saved preview jobs.
Exact requests reject a response whose plan ID or seed differs from the selected
direction. Restart the Node backend after changing server code; Vite hot reload
updates the frontend but does not reload the backend process.

The currently displayed/generated villa is retained by plan ID, with a selection
key so **Generate another design** survives navigation until a different direction
is selected. Its normal bounded uniqueness retries remain enabled; only pinned
direction previews use exact seed requests.
`BlenderVillaPanel` appears on the existing Massing and Render pages. It offers
fast previews or high-quality finals, **Generate another design**, interactive
GLB viewing, three camera previews and downloads. Existing study/dollhouse views,
routes, backend image providers and 2D drawing remain in place.

The Render page uses accepted Blender images as its exterior AI references.
Image prompts preserve the accepted silhouette, openings and camera. Interior
references still come from existing room data. Image providers are optional;
Blender renders and exports require no Gemini, ComfyUI or API key.

## Runtime and outputs

Use Node.js 24+ and Blender 4.5 LTS. Set `BLENDER_BIN` to the executable or place
an official portable installation under `output/tools/blender-*/`. The worker
also attempts `blender` on PATH. `GET /api/villas/health` reports availability.

Accepted files are under `output/villa-jobs/<job-id>/candidates/<seed>/`:

```text
villa_<seed>.blend
villa_<seed>.glb
villa_<seed>_hero.png
villa_<seed>_front.png
villa_<seed>_aerial.png
villa_<seed>.json
input.json
```

The master contains semantic collections and individually named editable
objects. GLB export preserves evaluated geometry and curated PBR values. Blender
procedural microtexture remains in the `.blend`; unsupported shader graphs are
temporarily disconnected for compatible GLB material export and restored immediately.

Preview: EEVEE, 1200×900, 32 samples. Final: denoised Cycles, 1800×1350,
128 samples. Cycles uses an available supported GPU, with CPU fallback;
`VILLA_CYCLES_DEVICE=CPU` forces CPU. Both formats use physically scaled geometry,
AgX, sun/world illumination and a consistent palette. Every render is a concept
visualization; no claim of structural certification is made.

## Uniqueness checks

The TypeScript shape fingerprint includes requested semantic and geometric
fields and uses normalized vectors. Schema 2 expands roof height sampling and
measures stacked roof elevation and actual cantilever projection. Older browser
fingerprints are discarded when their schema is stale.

Production additionally measures the evaluated Blender triangles, including
modifiers and actual openings. Fixed frames covering the complete property rasterize front, side,
roof plan, roof-front and roof-side projections at 32×32. Comparison uses weighted
intersection/union: front 15%, side 15%, roof plan 25%, roof-front 22.5%, roof-side
22.5%. The permitted envelope carries most weight; unchanged occupied rooms do
not swamp exterior changes. Colors, materials, planting and arbitrary labels have
zero weight. Identical actual meshes score 100% even with a new palette.

Default rejection threshold: greater than 75% nearest similarity, configurable
with `VILLA_SIMILARITY_THRESHOLD`. The last ten
accepted villas permit each massing family, hero and facade family at most twice,
and each roofline at most three times. Rejected/failed candidates never enter
history. The debug list reports seed, family, nearest seed, similarity,
accept/reject and reason. Exhaustion reports failure without lowering limits.

## Same-plan seeds 1–50 gallery

From Windows CMD in the project folder:

```cmd
npm run blender:gallery
```

The default command creates one explicit test plan (planner seed 41), then uses
that same plan for all 50 architectural seeds. To use an existing Design JSON:

```cmd
npm run blender:gallery -- --plan "C:\path\to\design.json"
```

This command never changes the app's saved plan. It produces 50 editable masters,
50 GLBs, 150 clay PNGs, an interactive comparison gallery and a JSON report under
`output/gallery-50-integrated/`. Render cameras, clay material and lighting are
fixed across seeds; greenery is disabled. Completed outputs are reused only when
the complete input digest matches. Exact gallery seeds are diagnostic candidates;
production similarity rejection may select a later seed instead.

Open `/api/villas/gallery/` while the app backend is running. Toggle front, hero
and aerial views or compare two seeds. Gallery assets are local generated files,
gitignored; a fresh checkout needs to run the gallery command.

The reviewed fixture has source ID `plan-0b357a7e555db10c`. 45/49 (91.8%) consecutive
pairs passed the measured 75% silhouette screen. Conservative agent inspection
of the clay gallery counted 42/49 (85.7%) distinguishable exterior compositions;
seven ambiguous U/ring or L/asymmetric transitions were excluded. The review is
tied to the source ID and a digest of all 50 mass/facade configurations in
`docs/villa-gallery-review.json`. A new plan or changed geometry needs a new
visual review. These figures concern permitted exterior variation; they do not
claim that the fixed occupied floor stacking changed or guarantee every viewer's
judgment of a fundamentally different house concept.

## Verification

```cmd
npm test
npm run build
npm run lint
python blender\test_pipeline.py output\gallery-inputs\villa_6.json
python blender\test_visualization.py output\gallery-inputs\villa_6.json
```

`scripts/test-alternative-design.mjs` verifies full source-model identity across
50 seeds, deterministic exact seeds, real mass silhouette changes, upper bearing,
parking/clearance preservation, bounded exterior piers for tall plans, material
independence and artifact route safety. Runtime Blender tests also ray-cast actual
openings, inspect semantic/editable meshes, shared geometry and GLB structure.
`blender/test_shape_runtime.py` verifies that roof-datum clipping includes the
full vertical wall silhouette and that materials/landscaping do not affect
evaluated mesh measurements. Run it with Blender's `--python-exit-code 1` and
`--python` options.
