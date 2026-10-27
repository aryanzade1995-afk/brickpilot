# Water Intelligence — simple 3D experience

The previous Overview / Design / Simulation / Monitoring dashboard has been replaced. Open Utilities → Water Intelligence, or `/workspace/utilities?view=water`.

## What users see

- **Tank to home:** the same accepted Blender villa, its realized roof tanks and existing canonical water pipes.
- **Collect rainwater:** a proposed exterior collection system with open gutters, corner collector, downpipe, first-flush leg, filter and separate non-potable ground tank.
- **See inside walls:** fades only the current viewer’s building materials and reveals pipes inside recorded service shafts. Normal view restores the original materials and does not rebuild or regenerate the house.
- **Follow the water:** illustrative direction markers along connected runs. Unconnected local stubs are not animated as working supplies.
- **View tank & connections / Whole house:** camera controls that make the tank and downpipe easy to find.
- **Resizable roof tanks:** width 50–100% of the original stand-fitting diameter, height 500–1,500 mm, with reset. Exact accepted Blender tank parts are scaled around their fixed bases; supply outlets follow the resized shells. These preview choices persist without changing architectural geometry or cost.
- **Custom 500–5,000 litre rainwater tanks** in 100-litre steps, with 1,000 / 2,000 / 5,000 litre shortcuts, Garden / Cleaning purpose, and one optional rainfall field. The rain check shows rain falling on the projected roof **before losses**, not guaranteed stored water.
- A compact selected-part card. Technical caveats stay in a short collapsed plumber note, rather than a warning dashboard.

There are no coordinate editors, graph connection forms, daily simulation tables, sensor forms or monitoring tabs in this UI.

## Geometry and routing

Existing potable supply reuses `createVillaPlumbing`, `realizedTankPorts`, `selectedPipeSizes` and the native fitting assembly. It does not independently invent a second household supply network. Concealed pipes use recorded service shafts; arbitrary structural walls are not drilled or silently cut. Existing pipe diameters still follow Finishes & Cost.

The new rainwater proposal traces actual outer footprint unions, preserving courtyard holes and avoiding shortcuts between separate roof islands. Apertures subtract from catchment area but do not pull outside gutters into a wall. A proposed ground tank must fit inside the plot and clear represented building footprints, paths, parking, pools and other occupied site features. Every displayed rain pipe envelope is checked by the existing `pipeCrossesStructure` function. Unsupported roofs, separate roof islands and unavailable installation space return a short explanatory state with no invented installation.

Rainwater never connects automatically to potable roof tanks. The overflow ends as a review stub; no approved sewer, recharge destination, filtration performance, tank level or live reading is invented. Fixed 90 mm rain pipes and gutter dimensions are explicit **visual planning assumptions**, not hydraulic sizing or code compliance. Tank shells approximate selected nominal volume; they are not manufacturer models. Roof falls, parapet outlets, mounting, filter selection and final discharge need a plumbing design.

## Implementation

- `src/components/water/WaterIntelligence.tsx`: replacement single-screen UI and saved simple preferences.
- `src/components/water/SimpleWaterLayer.tsx`: realistic pipe/fitting replay, open gutter sections and corner fittings, diversion/filter geometry, ribbed storage tank, picking and flow markers.
- `src/components/water/WaterCamera.tsx`: outside-tank close-up and whole-house views.
- `src/lib/water/simpleSystem.ts`: deterministic geometry-derived proposal and explicit unsupported states.
- `src/lib/water/ghostScene.ts`: isolated, reversible material ghosting. Cached GLB materials and geometry remain untouched.
- `src/components/VillaSceneCanvas.tsx`: optional technical X-ray hook in the shared accepted-model renderer; existing callers retain normal rendering.
- `src/lib/water/schema.ts`: optional validated `simple` preferences. Existing saved documents remain readable through the current project persistence integration.
- `scripts/test-simple-water.mjs`: geometry, connectivity, separation, source preservation, material cleanup and UI regression checks.

The old `WaterIntelligenceLayer.tsx` has been removed. Existing pure engineering functions and serialized records remain for backward compatibility; they are not exposed as the former dashboard. Save setup uses the existing project save, autosave, reload, switch and version history paths. No water setting is included in the architectural seed or building cache key.

## Checks

Run `npm run test:simple-water`. Also run the existing water, project-persistence and villa-plumbing suites after geometry or persistence changes. No FPS or engineering-approval claim is made from this visual preview.

## Tank resizing update (2026-10-27)

The explanatory Tank to tap / Roof tanks. Hidden pipes. card and the Already in your model statistics were removed. The home side panel now contains only size controls. Tank-width limits preserve the original stand envelope; original tank capacity is not inferred from visual dimensions. Original Blender geometry buffers, source materials, stands, architecture and the normal Massing-view cache remain unchanged. The Water Intelligence viewer separates and resizes the accepted tank meshes, and recomputes outlet links for the changed diameter. Saved sizes are Water Intelligence design previews; this does not rewrite the original downloadable Blender GLB or alter BOQ pricing.

The focused water, persistence, original villa plumbing and resizing suites passed 39 tests; production compilation passed. Browser checks confirmed 70% width / 1,400 mm height updates, reset and non-preset rainwater slider values without console errors. A broader repository run reported building-shape persistence test failures; those are not presented as passing checks.

## Rain animation and inline filters (2026-10-27)

Collect rainwater now starts an illustrative roof-and-garden storm unless reduced motion is preferred. Start rain / Stop rain also work independently. The accepted villa remains in its existing canvas. Rain uses one GPU-batched streak draw and one instanced splash-ring draw, capped at 2,000 streaks and 240 splash instances. The visual weather volume and splash rings are restricted to the modelled plot so rain cannot appear below the floating site edge. No extra canvas, live weather service, sensor reading or harvested quantity is introduced.

`src/lib/water/rainPreview.ts` derives impact heights from footprint unions, open courtyard areas, indoor shaft weather shields, upper roof caps, headroom, represented canopies and current roof/ground tank dimensions. These are visual collisions, not a validated weather or hydraulic analysis. Double-height rooms remain under their roof cap. Streaks are vertical so they cannot drift beneath eaves. The GPU uniforms animate the particles; rain shader updates pause when its canvas is offscreen or the document is hidden. Rain backgrounds restore when stopped. The accepted GLB is also sampled for actual site, roof, canopy and other visible surface heights.

The rainwater proposal has a mandatory roof leaf screen, first-flush diversion leg, coarse filter and sediment cartridge before its dedicated storage tank. The visual pipe is cut at the filter heads so it does not show a continuous bypass tube through the filter media. Transparent housings reveal the two cartridges. Filter body/head extents are checked against represented structure; the current 140 mm-radius heads use a 5 mm additional visual envelope. These dimensions are planning geometry, not a rated filtration product.

The flow illustration spends its first four seconds showing diversion, then demonstrates the route through filters toward storage; that duration is purely illustrative and does not specify a real first-flush volume or control system. The water cutaway uses one consistent colour through the filters; its appearance is not a water-quality reading. The treatment metadata explicitly records unverified performance, no storage bypass and no potable-water certification. Filter maintenance, disinfection where required, safe discharge and water testing still need a qualified design. Stored rainwater remains explicitly non-potable; garden/cleaning use controls have been removed.

New modules: `RainWeather.tsx`, `RainFilters.tsx`, `rainPreview.ts`, `filterDisplay.ts` and `scripts/test-rain-preview.mjs`. Run `npm run test:rain-preview` for deterministic particle bounds/roof impacts, source preservation and mandatory filter-path checks. The complete focused rain, tank, water persistence, villa plumbing and existing utility regression run passed 59 tests. Production build and scoped lint passed. Browser verification showed changing rain frames, functioning Start/Stop, enabled filter inspection on the current house and no console errors. Existing source architecture, seed and costing were preserved. RTX-specific frame rates have not been measured.


## Continuous pipe-water cutaway (2026-10-27)
- Replaced the single yellow travelling sphere with a translucent liquid core following each recorded pipe centreline at its actual diameter. Animated ripples and elongated highlights travel towards the outlet, with a progressing fill front on playback.
- During playback the existing pipe shell becomes translucent. The water is a technical cutaway within translucent pipe shells. Normal views respect building and equipment occlusion; See inside walls reveals concealed runs. Normal opaque shells return when playback stops. No architecture, connections, costs or saved configuration change.
- One GPU-animated tube per connected run, bounded longitudinal segments and ten radial sides; no per-droplet meshes or React frame updates. This is an illustrative flow animation, not a hydraulic, flow-rate or water-quality simulation. The four-second first-flush demonstration is retained.


## Rainwater storage level cutaway (2026-10-27)
- The existing proposed storage tank has a camera-facing sectional strip; the main green shell, ribs, lid and base keep their colour. The strip is a presentation cutaway, not a manufactured transparent tank wall. The existing tank location and architecture are unchanged.
- `RainStorageTank.tsx` adds a rising liquid volume and rippling surface in the shared canvas. `View tank level` frames a close-up; `Replay filling` restarts the demonstration. `Demo water level` distinguishes this animation from sensor data or calculated storage.
- Filling begins after the same illustrative first-flush and pipe-travel timing as the water layer. It progresses once to 90%, holds instead of looping empty, and pauses when rain or flow is stopped. Switching away or changing tank capacity restarts the demonstration; this ephemeral level is never saved as measured storage.
- `tankFillPreview.ts` is deterministic and validates times/coordinates. It does not use rainfall amount, assume a runoff coefficient, predict fill time or generate fake live readings.
- Verification: `node --experimental-strip-types --test scripts/test-tank-fill-preview.mjs scripts/test-rain-preview.mjs scripts/test-simple-water.mjs` (16 passing tests), scoped lint and production build.


## Rain containment and model refinement (2026-10-27)
- `rainSceneSampler.ts` indexes accepted GLB meshes in 2 m buckets and performs downward intersection checks during field creation only. Rain is restricted to the modelled site footprint instead of falling into empty space below the cutaway site border. Weather endpoints use the greater of actual mesh height and conservative plan roof coverage, plus a 25 mm surface offset. Source transforms/materials/geometry are preserved. Replaced/resized roof tanks use their current preview dimensions rather than baked originals. Exterior courtyards remain open; indoor service shafts are weather-shielded for visualization. No per-frame raycasts or individual raindrop objects.
- Removed garden/cleaning-purpose choices from the current UI while preserving older serialized preferences for compatibility.
- `pipeCurve.ts` rounds the water core's bend geometry within the existing route envelope and preserves connection ports. Native pipe fittings are retained; warm neutral plastic shells have small deterministic micrograin and subtle clearcoat. Filter-stack elevations leave straight socket lengths for the native elbows above/below both housings, with the proposed route rechecked against source structure. The water fades inside the inlet bulkhead instead of ending as an exposed sharp cylinder.
- Storage inlet now includes a sleeve, gasket, flange and compression nut at the recorded inlet coordinates. Filters have rounded bowls, cartridge seals, inline connectors and head fasteners; their extents remain within the existing 145 mm planning clearance envelope. Tank shoulders/base are moulded profiles with interrupted reinforcing ribs, a gripped lid and original green colour; the animated viewing strip remains usable.
- No additional viewer, render pass, dynamic light or external asset dependency. Small 64�64 detail textures and bounded geometry are disposed with their owning view. Device-specific FPS is not guaranteed or measured.
- Verification: 66 focused water/rain/plumbing/persistence/utility tests passed; scoped lint and production build passed. Browser inspection covers the accepted villa, tank cutaway, removal of purpose controls, rain and filter close-ups.
