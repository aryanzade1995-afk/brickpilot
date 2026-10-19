# Deterministic solar placement

> Pricing update: [Solar BOQ and energy assessment v1](solar-cost-energy.md) supersedes this stage's no-cost-change statements. Applied valid PV now updates the estimate; architecture and accepted building render stay independent.

Stage 3 implements proposals, geometric validation and explicit layout acceptance.
It adds no user interface, rendered panels, electricity-generation estimates or
installation charges. Those consumers can now share one canonical layout.

## Workflow

The pure API is exported from `src/lib/solar/index.ts`:

1. Build the shared roof with current solar inputs and accepted architecture.
2. Call `proposeSolarPlacement(configuration, roof, options)`.
3. Present requested/achievable counts and capacity, assumptions, shortfalls and
   search qualification. A proposal does not mutate the project.
4. Explicitly accept using `useStudio.getState().applySolarLayout(layout)`.

Studio also provides `proposeSolarLayout(options)` using its current accepted
design. Both studio actions return `{ ok: true, ... }` or `{ ok: false, error }`.
`options.allocationPolicy` overrides the roof policy; `options.policy` overrides
placement assumptions. An existing layout's policy snapshots are reused when
requesting a revision unless explicitly replaced.

Applying checks the current roof, inputs, specification, all physical envelopes,
neighbour spacing and quota. A stored `concept-valid` flag is not accepted as
proof. Only solar calculated data changes: the villa result, pin, room edits,
building identity, accepted GLB and existing costs remain unchanged. No network
or architecture-render request is made.

## Specification and inventory

The panel specification now has `schemaVersion: 1` plus its catalogue ID,
optional manufacturer revision, provenance, physical width/height/thickness in
millimetres, and rated watts. `solarPanelSpecificationKey` produces a versioned
content key. Reusing an ID with different dimensions or wattage produces a new
key. Manufacturer or subsidy compliance is not inferred.

`solarLayoutTotals(layout)` returns actual panel count and capacity. A capacity
request selects the smallest whole count meeting the requested nameplate kWp:
3 kWp with 550 W modules requests six panels and reports 3.3 kWp. A count request
retains that exact count target. Decimal arithmetic determines the count and
capacity without rounding a shortfall away or introducing floating-point ceil
errors. This is rated DC capacity, not energy generation or inverter AC output.

No specification or count/capacity request means `needs-input`; the engine does
not invent a module or derive consumption from an unknown electricity bill.

## Canonical layout version 2

Each layout stores engine version, roof/allocation/configuration signatures,
the immutable specification snapshot/key, concept policy snapshots, resolved
settings and their assumptions, validity, and uniquely identified panels.

Each panel has stable surface and component references, specification key,
portrait/landscape orientation, physical dimensions, watts, centre x/y/z in
plan millimetres, roof elevation, minimum lower-panel clearance, local azimuth
and tilt. Azimuth is clockwise from local plan-up. A nullable
`inputs.placement.arrayRotationDeg` explicitly selects local array bearing;
`preferredPanelAzimuthDeg` remains a true-geographic preference and requires a
known plan north bearing before conversion. With neither preference supplied,
local zero degrees is a disclosed concept orientation, not an energy optimum.

The module slopes down towards its azimuth. For oriented slope length L,
thickness T, tilt t and requested minimum clearance h:

- centre z = roof elevation + h + (L sin(t) + T cos(t)) / 2;
- full projected depth = L cos(t) + T sin(t);
- support depth = max(projected depth, minimum support depth) + two overhangs.

`solarPanelGeometry(panel, layout.placementPolicy, layout.resolved)` derives all
eight physical prism corners, its projected polygon, the conservative support
frame footprint and elevation envelope, maintenance rectangle, neighbour spacing
envelopes and support area. These derived polygons are not independently saved
copies that can disagree with module dimensions. Future Three.js and Blender
consumers must use these canonical measurements and the shared coordinate
conversions. Supports are a concept frame envelope, not designed steelwork.

## Fit and spacing

Rotated polygons are clipped against the exact disjoint usable-roof union. A
corner test or bounding-box test cannot substitute: the complete envelope must
avoid every courtyard hole, shaft, skylight, tank, roof feature, reservation and
protected route. Panels may cross a harmless decomposition seam where the union
is continuous. The support envelope includes hardware overhangs even when the
face alone fits. The maintenance envelope must also fit the usable roof.

Positive-area overlap between another module's support and either panel's
maintenance/spacing envelopes is rejected. Shared empty clearances may overlap;
support footprints cannot. Explicit row and side gaps are rechecked when loading
or accepting a layout, including manually supplied positions.

Concept defaults are 15° tilt, 400 mm lower-panel clearance (1500 mm for an
unspecified raised-frame height), 800 mm row gap, 50 mm module gap, 100 mm support
overhang, 600 mm minimum support depth, and 50/200 mm side/row maintenance space.
All are labelled planning assumptions, not statutory limits, a shading study,
wind/structural approval or manufacturer instructions. A smaller requested gap
is raised to the selected maintenance minimum with an explicit explanation in
`resolved.assumptions`; the original input remains unchanged.

Both per-surface usable regions and `maxSolarFootprintAreaM2` are enforced.
The budget conservatively counts the whole support envelope rather than only
the sloping module face. The separate 80% architectural roof rule is unchanged.

## Deterministic search and limitations

Automatic packing considers portrait/landscape when auto is selected, using a
single chosen array bearing and four deterministic grid offsets. Surface and
candidate ordering and content-derived panel IDs are stable. The best checked
pattern is returned; no randomness or building regeneration is used.

This bounded conservative search does not prove a mathematical maximum. Reports
include `search.provesMaximum: false`, checks used and whether the configurable
search limit was reached (20,000 by default). Shortfalls return requested versus
achieved count/kWp and reasons such as roof geometry, access, obstacles,
reservation, quota, spacing or search limit. The result must not be advertised
as proof that a larger vendor-designed system is impossible.

Manual placement requires `placement.mode = manual` and explicit surface IDs,
plan centres and local rotations via `options.manualPanels`. All automatic fit,
quota and spacing checks still apply. Rejected manual positions are reported;
they are not moved to other coordinates. Proposals can contain a partial
arrangement, which still needs explicit acceptance.

## Roof changes, persistence and legacy data

`reviewSolarLayout(layout, configuration, roof)` returns `concept-valid`,
`needs-review` or `invalid` and reason codes. New roof/allocation/configuration
signatures request review. Altered dimensions, wattage, elevation, unsupported
surfaces, duplicate IDs, overlaps or exceeded budgets invalidate the layout.
`allocationInputsSignature` also prevents an old roof allocation from ignoring
new reservations, edge clearance or true-north data.

The studio marks a saved version-2 layout for review when source geometry changes
or a current source roof is unavailable, including initial hydration. It keeps
every saved panel position. Re-proposing returns a separate revision; it does
not replace the saved layout. Only explicit successful `applySolarLayout` commits
the revision. Restoring the exact original roof can validate the same saved
positions again without moving them.

Layouts use existing Brief/project/cloud persistence, autosave and version
history. Older version-1 layouts remain readable but require a new specification/
geometry review before use. A known migration adds the panel schema version and
nullable local bearing only when the old calculation's exact historical input
signature matches. Other stale calculations still follow existing recovery rules.

Reserve-space intent returns `reservation-only`, echoes saved reservations and
creates no panel layout, installed count, generation claim or new cost. Undecided
and not-included likewise produce no installation. Legacy solar allowances remain
separate and unchanged until the later measured-cost stage.
If no reservation rectangle has been chosen, the engine explicitly reports
`RESERVATION_AREA_REQUIRED`; saving the intention alone does not pretend that
physical roof space has already been reserved.

## Verification

Run `npm run test:solar-placement`. Tests cover deterministic inventory/capacity,
portrait/landscape, arbitrary rotation, zero-to-vertical tilt, supports,
maintenance and row gaps, holes/reservations/access, quota/search shortfalls,
stale signatures, fabricated geometry, legacy migration, reserve mode, actual
accepted architecture, explicit save/reload and unchanged building/render state.
