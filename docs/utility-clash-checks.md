# Utility coordination checks

The native Utilities viewer uses `detectClashes()` in `src/lib/utilities/clashes.ts`.
It is a read-only concept checker. There is no new routing, A* optimiser,
automatic repair or batch route adjustment. Architecture, accepted design,
electrical/plumbing proposals and priced BOQ quantities are not changed.

## Inputs and measurements

- Source plan coordinates and all clearance settings are millimetres.
- Electrical and water route heights/drops come from the existing 3D scene
  projections, including underfloor water crossings at doors.
- Drainage and fire heights remain unknown unless explicitly supplied.
- `CLASH_LAYER_ELEVATIONS_MM` is empty by default. A caller can supply layer
  or item heights without pretending that an unmeasured height is verified.
- Known routes use finite 3D segment distance, with represented pipe radii.
  Unknown routes use plan distance and **Needs checking**. A projected crossing
  with unknown height is never reported as a confirmed HARD intersection.
- Heights and pipe sizes are concept model information, not site measurements.
  Cable containment dimensions, insulation and unrepresented equipment are not
  inferred. Distances describe the represented geometry only.

## Rules

`CLASH_RULES` in `clashRules.ts` owns proximity, supply/drain ordering, wet
fixture proximity, wall penetration, exit-route and detector coverage reviews.
The 15/20/30/600 mm settings are explicit concept review thresholds, **not
statutory minimum clearances or a compliance assessment**. Extending pair rules
requires a config entry; specialised geometry predicates are shared engine code.

The sprinkler rule intentionally compares fire equipment with electrical items.
An intended run-to-device connection, a shared drain-stack junction and shared
network trunks are distinguished from unrelated crossings. Room polygons and
actual wall sections (including door gaps, sills and heads) inform the checks.
Bathrooms/toilets are the current wet-area classification; a complete electrical
zone design, fire engineering and hydraulic analysis remain outside this checker.

## Performance and review lifecycle

Detection runs on model changes after a 200 ms debounce. Visibility, zoom and
report filters do not influence detection. A 1 m spatial grid finds candidate
pairs; unchanged pair signatures reuse previous exact geometry results. Removed
pairs are evicted. No stale markers are shown while a new model is being checked.

Reviews use a versioned browser-local record per project ID and floor. Stable
clash IDs identify item/rule pairs. A separate fingerprint includes affected
geometry, heights, rule values and relevant room context. Changed fingerprints
return to Open with a re-review notice. Deleted issues are not counted, and
unchanged issues can retain reviews through reloads or restoring a plan.
Different project IDs do not share decisions. Unsaved drafts use the source
design ID. Reviews are ancillary device-local data, not embedded in architecture
seeds or BOQ replay, and are not promised to sync or follow project duplication.

Open / Acknowledged / Resolved / Ignored are user review statuses. Ignored
requires a note. Resolved does not mean geometry was repaired. Review undo/redo
is separate from plan editing history and resets on navigation/reload.

## Display and delivery

- One marker source for all four layers; red/high, orange/medium, yellow/low.
- Selected issues focus the plan and highlight both represented items.
- Report filters and per-column sorting; CSV and paginated PDF use the filtered
  report. Plan PNG/PDF and printing keep their existing shared SVG pipeline.
- 3D markers are optional, off by default, and appear only for modelled heights.
  No guessed-height spheres are drawn.
- English, Hindi and Marathi copy uses the existing Formstead translation system.

Run `npm run test:utility-plan` and `npm run build` for regression checks.
