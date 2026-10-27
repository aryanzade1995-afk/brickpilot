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

Collect rainwater now starts an illustrative roof-and-garden storm unless reduced motion is preferred. Start rain / Stop rain also work independently. The accepted villa remains in its existing canvas. Rain uses one GPU-batched streak draw and one instanced splash-ring draw, capped at 2,000 streaks and 240 splash instances. The visual weather volume surrounds the property; splash rings are restricted to the plot. No extra canvas, live weather service, sensor reading or harvested quantity is introduced.

`src/lib/water/rainPreview.ts` derives impact heights from footprint unions, courtyard and shaft openings, upper roof caps, headroom, represented canopies and current roof/ground tank dimensions. These are visual collisions, not a validated weather or hydraulic analysis. Double-height rooms remain under their roof cap. Wind is suppressed at height discontinuities. The GPU uniforms animate the particles; rain shader updates pause when its canvas is offscreen or the document is hidden. Rain backgrounds restore when stopped. Small unrepresented decorative geometry is not separately collision-tested.

The rainwater proposal has a mandatory roof leaf screen, first-flush diversion leg, coarse filter and sediment cartridge before its dedicated storage tank. The visual pipe is cut at the filter heads so it does not show a continuous bypass tube through the filter media. Transparent housings reveal the two cartridges. Filter body/head extents are checked against represented structure; the current 140 mm-radius heads use a 5 mm additional visual envelope. These dimensions are planning geometry, not a rated filtration product.

The flow illustration spends its first four seconds showing diversion, then demonstrates the route through filters toward storage; that duration is purely illustrative and does not specify a real first-flush volume or control system. Particle colour after the final filter is a visual cue, not a water-quality reading. The treatment metadata explicitly records unverified performance, no storage bypass and no potable-water certification. Filter maintenance, disinfection where required, safe discharge and water testing still need a qualified design. Stored rainwater is labelled for garden and cleaning use.

New modules: `RainWeather.tsx`, `RainFilters.tsx`, `rainPreview.ts`, `filterDisplay.ts` and `scripts/test-rain-preview.mjs`. Run `npm run test:rain-preview` for deterministic particle bounds/roof impacts, source preservation and mandatory filter-path checks. The complete focused rain, tank, water persistence, villa plumbing and existing utility regression run passed 59 tests. Production build and scoped lint passed. Browser verification showed changing rain frames, functioning Start/Stop, enabled filter inspection on the current house and no console errors. Existing source architecture, seed and costing were preserved. RTX-specific frame rates have not been measured.
