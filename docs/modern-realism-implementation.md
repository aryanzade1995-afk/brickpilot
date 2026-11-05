# Modern compositions and real-time appearance

The four-stage work extends existing planner, composition canopies, material
bindings and scene canvases. No parallel viewer or replacement project format.

1. Audit and baseline: existing three composition ids retained. Existing renderer
   already uses ACES, local environment reflections, material microdetail and
   contact shading. Baseline tests: modern-realism-baseline.log in output;
   pre-existing lighting test expects DPR 1 although current code starts at .85.
2. Four new opt-in ids: offset-box, framed-balcony, stepped-terrace,
   interlocking-boxes. Each gets its own source brief before room planning.
   Projections use explicit concept support zones; they are not structural
   certification. Old ids and old pinned recipes keep their planning behaviour.
3. Refine source-bound façade planes and scene lighting/material response;
   preserve selected albedo, geometry, door animation and finish bindings.
4. Test geometry, replay, constrained inputs, and visual output. Report measured
   results; do not infer RTX performance from GPU ownership.

Research:
- https://threejs.org/docs/pages/MeshStandardMaterial.html
- https://github.com/pmndrs/react-three-fiber/blob/master/docs/advanced/scaling-performance.mdx
- https://collaborativearchitecture.com/work/house-of-cantilevers/

The architectural reference supports the design direction (projecting volumes),
not an engineering span limit. All renderer changes remain real-time WebGL.

## Verification, 5 November 2026

New implementation checks: 13 passed (`output/modern-final-tests.log`). Includes
four real source plans on 25 × 30 m, exact selection/persistence/replay,
pairwise footprint difference >= 8%, missing-support rejection, actual terrace
access, framed canopy, constrained plots, material stability and lighting.
An additional Python boundary regression passed. All four also fit the tested
three-floor brief; the 18 × 24 m brief offers three, without padding duplicates.

Regression batch: 57 passed / 3 failed (`output/modern-regression.log`). The same
three courtyard-ring failures reproduce using the pre-change generator/layout
modules in an isolated copy (`output/modern-styles-baseline.log`, 8 passed /
3 failed). Coastal styles, site-form replay, fixture clearance, source finishes,
existing utilities and rainwater replay pass. A separate older composition test
also fails for `terraced-villa` before and after this work; its saved geometry
has deliberately not been regenerated. The stale DPR expectation in the lighting
test was corrected to the existing .85 default.

Production build passes. Lint finishes with existing warnings (see
`output/modern-lint.log`); no errors. Final build/lint logs are in output.

### Visual and timing evidence

- `output/modern-realism/four-compositions.jpg`: actual review page screenshot.
- `output/modern-realism/walkthrough.jpg`: actual furnished living-room screenshot.
- Each composition directory contains the generated GLB, Blender file and three
  rendered PNGs. These are generated geometry, not reference photographs.
- Full Blender export plus three renders: Offset 17.9 s, Framed 19.0 s,
  Stepped 27.0 s, Interlocking 23.2 s (`render-timings.json`). This is not a
  Directions image-only benchmark and not a controlled before/after comparison.
- Full four-card plan/facade selection: about 4.35 s in the recorded test run.
- Actual browser renderer: Intel UHD via ANGLE/D3D11, not the installed RTX.
  High Quality sample: 58 average FPS, 27.6 ms p95, DPR 1, 441 × 619 render
  size, 152 visible draws / 161,057 triangles in the sampled living-room view.
  Earlier views varied substantially. The small viewport is not evidence of
  full-screen performance. Raw measurements: `walkthrough-metrics.json`.
- No comparable pre-change walking benchmark was captured; no speedup or RTX
  frame-rate claim is made. A focused full-screen RTX benchmark remains.

### Limits

The new composition ids are opt-in architectural recipes. The four-card layout
is unchanged; old pins are not silently upgraded. Selecting a new card persists
its source composition before subsequent plan replay. New defaults use restrained
stone/plaster/charcoal palettes; selected specification bindings still win.

Occupied projections are geometric concepts with explicit review notes, not
engineered reinforcement/deflection checks. Existing service-route warnings
(unconfirmed slab penetrations, shaft continuation) remain visible rather than
inventing connected pipes. Renderings remain procedural architecture; they do
not reproduce the supplied reference photos exactly. No new downloaded assets,
licences, external AI dependency, or live ray tracing were introduced.

## Files changed for this implementation

- Planning and persistence: src/lib/model/{brief,modernCompositions}.ts,
  src/lib/engine/{generate,siteForm,villaDesignDna,modernCanopies}.ts,
  src/lib/engine/planner/{layout,index,wings,validate,types,projections}.ts,
  src/state/studio.ts, src/routes/brief/steps.tsx.
- Export: blender/generator.py, blender/geometry/compositions.py,
  blender/specialized_validation.py and its new boundary regression test.
- Runtime appearance: src/components/VillaSceneCanvas.tsx,
  src/components/interior/{WalkthroughLighting,WalkthroughAssetPreview}.tsx,
  src/lib/three/{materialResponse,prepareVillaScene}.ts.
- Verification: scripts/test-modern-directions-v2.mjs, test-modern-studio.mjs,
  test-material-response.mjs, audit-modern-directions.mjs,
  render-modern-directions.mjs. Legacy composition tests retain their original
  three ids; the lighting test now reflects the existing adaptive DPR default.

Several of these files already had local changes before this task. Those were
retained. No GitHub push, branch merge or saved-house regeneration was performed.
`git diff --check` reports an existing trailing blank in
scripts/test-plan-remediation.mjs, outside this implementation.
