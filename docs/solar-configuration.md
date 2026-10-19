# Optional rooftop solar: persisted configuration

> Pricing update: [Solar BOQ and energy assessment v1](solar-cost-energy.md) supersedes this stage's no-cost-change statements. Applied valid PV now updates the estimate; architecture and accepted building render stay independent.

This stage adds data contracts and persistence only. It does not place panels,
change prices, add solar controls or geometry, or determine roof suitability.

## Configuration and unknown inputs

`Brief.solar` is a strict Zod-validated configuration with `schemaVersion: 1`.
The four intentions are `undecided`, `not-included`, `reserve-space` and
`install-now`. Missing solar data acquires `undecided`. Intentions record planning
preferences, never installed or commissioned equipment.

`inputs` contains only user preferences and supplied information:

- `panel`: nullable specification ID, name, provenance (`unknown`, `illustrative`,
  `manufacturer`), revision, `dimensionsMm` (width, height, thickness), and
  `ratedPowerW`. There is no default module or claim of scheme eligibility.
- `request`: a discriminated choice of `unknown`, `panel-count` (`panelCount`) or
  `capacity` (`capacityKwp`). A request cannot contain count and capacity together.
- `monthlyConsumptionKwh`: nullable; zero is a supplied value, not unknown.
- `location`: nullable locality/state and paired latitude/longitude in degrees.
- `orientation`: nullable clockwise bearing of plan-up from true north, plus
  nullable preferred array azimuth. Road direction does not establish true north.
- `mounting`: `unknown`, `low-tilt` or `raised-frame`.
- `reservedAreas`: unique IDs, optional roof surface reference, floor level and
  positive rectangles in plan millimetres. Coordinates are not roof validation.
- `placement`: automatic/manual, auto/portrait/landscape module orientation, and
  nullable tilt, mounting height, edge clearance and row gap with explicit units.

Unknown physical/site information stays null or explicitly unknown. Automatic
placement is a preference; it does not imply that a valid arrangement exists.
Numbers must be finite; strings are not coerced into measurements. Unknown keys,
unsupported versions, duplicate IDs and inconsistent coordinates are rejected.

## Inputs, calculations and signatures

`calculated` defaults to null. Version-1 layouts have
a roof signature, plan-x-east-y-south-z-up coordinates in mm,
and uniquely identified panels with a roof surface ID, module centre position,
azimuth and tilt. Physical dimensions and rated power belong to the selected
input panel specification. No energy output, cost, approval or engineering
verification is fabricated. Stage 3 adds version-2 canonical layouts with a
versioned specification, physical dimensions, policy snapshots, validity and
explicit acceptance; see `solar-placement.md`.

The calculation records its source `configurationSignature`. Validation rejects
results for other inputs and placed panels without a specification or outside
the `install-now` intention. Parsing does not prove that panels fit or that the
roof signature matches today's roof; downstream placement must perform those
checks before treating results as current.

`solarConfigurationSignature` covers version, intention and inputs;
`solarLayoutSignature` covers the layout and roof signature; `solarSignature`
combines both. Keys and ID-based collections are canonicalized for deterministic
signatures. These are cache/change tokens, not security or approval credentials.

## Editing and saving

`useStudio.getState().updateSolar({ intention, inputs })` validates a replacement
input snapshot and returns `{ ok: true }` or `{ ok: false, error }`. Invalid
updates do not mutate state. Equivalent inputs are a no-op; changed inputs clear
`calculated`. Callers cannot inject calculated results through this action.

The action changes only `brief.solar`: result/design, cost, source plan, layout
edits, pin, accepted Blender renders and generation state remain untouched. It
also works before any design exists. Views must read current inputs from the
studio brief rather than an older generated design's model brief.

Solar is stored through the existing brief in studio persistence, local project
cores and versions, duplicates, and cloud saved-design rows. Autosave includes
solar changes. No parallel global solar store or database migration is needed.

At storage boundaries `parseStoredBrief` recovers stale/malformed calculations
by keeping valid inputs and clearing the result. If the configuration is invalid
or uses an unsupported future version, only solar resets to undecided; the
building and specification allowances survive. Unrelated invalid architecture
still fails parsing. Live update validation remains strict. Future versions
should add explicit migrations before accepting new contracts.

## Identity and legacy pricing compatibility

Solar is excluded from `geometryBrief`, hence the canonical seed. It is never
added to the BuildingModel base, plan/composition identity or building-shape
fingerprint. The existing finish signature reads finish/specification overrides,
not the new solar configuration. Historical `specs.overrides.solar` tokens remain
unchanged to preserve render cache compatibility.

The existing `solar` catalogue toggle is a separate legacy lump-sum allowance.
Its `on`/`off` override remains saved and costed exactly as before; neither value
creates panels or becomes an installation intention. New solar intentions,
counts and layouts do not add or remove costs in this stage. In particular,
`not-included` refers to the new planning configuration; it does not erase a
previously chosen legacy allowance. A future UI should explain the distinction
and migrate to measured costs explicitly without charging both.

`pricingSignature` excludes the new solar field, preserving historical cost
replay keys and prices. When measured solar costing is implemented, introduce a
separate priced solar signature/version and explicit replay migration.

## Verification

Run `npm run test:solar-state`. Tests exercise strict validation, all intentions,
unknown measurements, legacy allowances and pricing, separate signatures,
calculation invalidation, unchanged architecture/render identity, atomic edits,
studio rehydration, saved projects, switching, duplication, version restoration
and autosave. Network calls are forbidden while verifying accepted render reuse.
