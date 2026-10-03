# Specification-driven concept BOQ

`estimateBoq(design, currentBrief?, allowanceSelection?)` in
`src/lib/cost/boq.ts` reads the existing plan; it never generates rooms or
changes geometry. Pass the current Brief after finish edits, because the saved
design's original Brief can be older.

## Separate layers

1. `quantities.ts`: immutable, content-memoised take-off of source floors,
   walls, openings, structural members, source outdoor areas and points.
2. `boqMeasures.ts`: price-independent room allocations and documented service,
   kitchen and exterior allowances. Ceiling areas reconcile with slab voids;
   interior paint allocations reconcile with the measured net face area.
3. `catalogue.ts`: Basic/Mid/Premium preset, house override, then room override.
   Floor-prefixed room IDs win over legacy semantic IDs. Unknown options fall
   back to the preset; automatic items ignore overrides.
4. `boq-rules.json`: Zod-validated measurement recipes, trades, service-run
   assumptions, scope and explicit non-additive/technical items.
5. `rates.json`: installed rates with provisional material/labour splits,
   percentages, authority allowances, city/date and sanity bands.
6. `boq.ts`: line pricing, trade shares, add-ons, range, procurement comparison
   and cost drivers compared with the same finish preset without overrides.

## Scope and arithmetic

Concrete, reinforcement and contact-area formwork are separate. Cement, sand
and aggregate are already in concrete rates: the material take-off is not
charged a second time. The legacy floor-area structure/MEP and wall-face
masonry allowances are not added. Masonry includes the terrace parapet once;
compound walls have a separate whole-assembly allowance. Window frame rates
cover frames; glazing is a separate line. Roof finish is separate from
waterproofing and does not create new roof geometry.

Works = sum of BOQ amounts. Trade shares sum to 100% of works, including trades
with zero cost. Overhead/profit and professional fees use works as their base;
contingency uses works plus overhead. Optional GST uses works plus overhead
plus contingency. Approval and utility connection allowances are separate
summary lines and are outside that provisional GST base.

Turnkey works = materials + labour + overhead. Owner procurement shows the
same materials/labour split, with project add-ons separately: changing the
contract choice never deletes materials or produces an artificially cheaper
whole-project total. Splits are planning assumptions, not supplier quotes.

Expected total includes every summary line. The displayed range is ±15%; the
rate per square foot divides that full total by measured source-plan floor
area. No estimate is clamped or scaled to pass its sanity band. The Basic/Mid
upper sanity limits in `rates.json` are now 3,800/5,200 INR/sq ft, replacing
3,000/4,500 for the narrower legacy estimate. Premium remains 7,500. These
are provisional full-project diagnostic bands, not verified market prices.
Small buildings, unusual site works and enabled extras can fall outside them;
the application then asks for a scope/rate review.

Technical soil and plinth choices affect take-off sizes. Future capacity and
cement product choice require engineering specifications and are disclosed as
non-additive here. Comparing defaults keeps actual measured technical sizing
fixed. Piping runs, fixtures, cladding fraction, kitchen runs and canopy shade
are labelled configurable allowances rather than coordinated working drawings.

## Determinism and verification

No RNG or mutation. The bounded memo key includes measured content, finish,
sorted overrides and allowance settings. A changed spec reprices cached
quantities; mutated source geometry triggers a new take-off. Outputs are frozen.

`scripts/test-boq.mjs` covers reconciliation, non-double-counting, house and
room isolation, room-ID migration, explicit tax bases, determinism and a
100 ms reprice gate. Five valid briefs (the default and four open-space modes)
are checked at all three finish levels against data-file bands.

Finishes, Report, the Studio result and PDF now use the same BOQ. The Plan step
keeps its existing drawing flow; prices remain at the end of design. Legacy
browser-only finish controls are imported through `estimateProjectBoq` only
for an untouched old Brief. A current Brief's full catalogue overrides win.
`estimateSelectedBoq` is the compatibility adapter for explicit old five-field
selections; the old `estimateCost` implementation has been removed.

The screen keeps trade shares, procurement and cost drivers collapsed by
default. CSV includes exact quantities/units, spec IDs, material/labour splits,
allowances and assumptions; PDF uses the actual m²/m³/kg/m/count units. Run
`node --experimental-strip-types scripts/review-boq.mjs` after a build to
create an HTML/CSV/JSON and PDF review in `output/boq-review/`.

All output is **Concept estimate ±15% · approximate · Pune rates 2026-10-03**.
The date and city come from the rate data, not this document. Rates are
provisional allowances referencing SOR, not verified SOR line items or current
contractor quotations. Final cost depends on licensed structural design,
actual site conditions, products and contractor quotes. No budget features.
