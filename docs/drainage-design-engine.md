# Residential drainage proposals

The Utilities workflow now has a separate versioned drainage input document and
one deterministic calculated graph. It does not change the planner, building
identity, furnishing geometry, finishes, BOQ quantities or estimated costs.

## Files and integration

- `src/lib/utilities/drainageInputs.ts`: validated user inputs, explicit nulls,
  shared-datum levels, fixture classifications, outlet/inspection chamber,
  pipe overrides, stack bases, reviewed sleeves, reservations and sublayer state.
- `drainageRules.ts`: configurable reviewed NBC subset and source register.
- `drainage.ts`: directed nodes/pipes, shortest orthogonal route candidates,
  DFU aggregation, table-based sizing, invert arithmetic and review results.
- `DrainageWorkbench.tsx`: existing Formstead tokens/components, numeric entry,
  inventory, property editing, review filtering, locate buttons and CSV report.
- `UtilityPlanViewer.tsx`: canonical graph projection and selectable components.
- `drawingSheets.ts`, `drawingExports.ts`: same graph in SVG/PDF/PNG/DXF,
  schedules and review qualifications.

`plan.ts` still projects the source room furnishing placements. Sink/basin,
WC, shower, bathtub and washer IDs are recognised when actually represented.
No bathtub, appliance or kitchen sink is invented to make the network look
complete. Missing source fixtures can be explicitly proposed at numeric plan
coordinates; those proposals are drainage inputs, not architectural edits.
Existing proposed wet-room floor drains remain identified as proposals.

`withDrainageDesign(rawModel, inputs)` is a read-only renderer/export adapter.
Do not persist that projection as source geometry. Utility JSON saves the raw
source snapshot plus inputs; results are recalculated. Old JSON receives unknown
inputs via schema defaults. Live inputs persist by project/floor scope, with
undo/redo and existing 30-second session save. Loading a saved snapshot does not
overwrite live inputs. Returning to live restores the earlier live document.

## Units and graph

Plan x/y are unchanged source millimetres. Invert elevations are millimetres on
the user-stated survey datum; zero is a real value, not a missing-data sentinel.
Architectural floor indices/storey height never establish sewer invert or ground
level. Horizontal fall = developed length / gradient denominator. If both ends
are supplied, residuals greater than the 1 mm numerical reconciliation tolerance
are reported, not silently corrected. This tolerance is computational, not a code
or construction tolerance. Vertical drops use actual entered/calculated levels.

Fixture -> stack -> aligned stack base -> explicit inspection chamber -> explicit
sewer/septic/treatment destination is a directed sanitary graph. Traps, proposed
vent continuations and cleaning/access points carry their own identifiers.
Different entry heights on a vertical stack are permitted; horizontal junction
inverts must agree. Unknown sizes/levels remain unknown. Unsupported stack offsets
are reported rather than replaced with guessed horizontal pipes.

Walls, window/door wall lines, columns, voids, known footing footprints and
keep-free areas are protected. Sized beam projections trigger section review;
plan overlap alone cannot establish a beam collision. Reviewed sleeves
only remove wall restrictions where the full pipe elevation envelope is within
their range. A reference entered by a user is evidence for review, not an
independently verified structural approval. Collector candidates that cannot
route are marked blocked and excluded from successful outlet connectivity.
They remain visible for correction. The routing search has a bounded grid; a
large unsupported search fails visibly rather than using an unchecked shortcut.
The 1 m search margin is a search window, not a property setback or permission.

## Standards register (checked 2026-10-22)

- [NBC 2016 / SP 7:2016 Part 9 Section 2, government-hosted copy](https://hsamb.org.in/sites/default/files/documents/National%20Building%20Code-2016%20%28Volume-II%29NBC2.pdf)
- [BIS NBC scope / adoption](https://www.bis.gov.in/standards/national-building-code/?lang=en)
- [PMC-hosted UDCPR 2020 updated 2022, 12.5–12.6](https://autodcr.pmc.gov.in/swc.client/Downloads/Building%20regulations%20%26%20related%20notifications/Updated-UDCPR-2022.pdf)

The numerical subset is private residential Table 18 DFU, Table 20 horizontal
branches, Table 21 building drain capacities, Table 22 ruling gradients and
4.5.3.6.1.5 minimum outlets. The larger applicable trap/outlet minimum is used
(for example, WC outlet 100 mm; bathtub 50 mm; floor trap outlet 75 mm).
Bathroom-group DFU is **not** added to individual fixture DFU. WC flush tank
versus valve is never assumed. Unidentified sinks require classification.
Floor-drain catchment sizing remains separately unverified.

Building drain lookup uses the conservative flatter tabulated Table 21 slope;
there is no extrapolation beyond the supported capacity table. Ruling gradients
are available only for the reviewed 100/150 mm Table 22 subset. Branch gradient
is left unknown unless entered. Half-full Manning screening uses NBC's stated
n=.015 and is labelled as such; it is not actual peak flow or hydraulic approval.
Fixture peak-flow conversion (Fig. 6) is not implemented.

Pune does not establish PMC/PCMC/PMRDA jurisdiction. City, authority and local
review reference remain editable, and current amendments/permission remain
Not Checked. The 2022 document is an explicit reference baseline, not a claim to
have verified every current Pune connection rule. No draft NBC rules are used.

## Review limitations

The engine always produces a **proposed design requiring review**. Each Pass is
limited to the named check. Unsupported conditions remain Not Checked/Fail:

- complete accumulated multi-floor stack/branch-interval sizing and offsets;
- ventilation/anti-siphonage, trap arms, vent length/diameter/roof terminal,
  cowl and window separation (Table 17 review required);
- swept fitting geometry, connection heights, indirect appliance waste;
- pipe cover, bedding, external site boundary/easements, foundation/beam/slab
  sections, structural permission and waterproofing;
- stormwater catchments/rainfall, roof outlets and approved stormwater destination;
- pumping, septic treatment design, authority inspection and official approval.

Sanitary and stormwater cannot be combined through the input schema. Stormwater
is a separate named sublayer with a clear Not Checked explanation until its
source/runoff/discharge data exists. No rainfall or roof drain is fabricated.
Cross-service checks reuse existing segment-distance geometry. Missing service
centre elevations produce Not Checked; known shared-datum levels support a
3D envelope screening. The configurable concept clearance is not a statutory
clearance. The retired global clash markers/report are not reintroduced.

Run `npm run test:drainage` or the complete `npm run test:utility-plan`.

## Drainage map presentation

The live map uses a separate `drainagePresentation.ts` layer. It keeps canonical
paths, source positions, diameters, gradients and validation untouched. At overview
scale, crowded component symbols become counted groups. Every group member remains
individually selectable in the map inspector; this does not create a new junction.
Room focus and zoom separate nearby components. Sparse directional arrows and
service-specific line weights keep fixture branches legible against the source plan.

Technical labels are off initially. Selection exposes details, while optional
technical labels use screen-space collision checks around room names and component
symbols. Detailed sheet exports continue to include the original components and
schedules; live-map grouping never removes a component from the saved design.

A single `UtilityHoverCard` replaces native SVG title popups. It uses Formstead
theme tokens and measured bounds so it stays inside the canvas. Full review findings
remain in the selected-connection inspector and existing drainage review. The old
drag/pan instruction footer has been removed; zoom, pan and keyboard controls remain.
