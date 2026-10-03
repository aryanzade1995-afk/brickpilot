# Finishes & Cost

Cost is downstream of the validated design. Finish preferences live in the Brief,
but never feed the programme, planner seed, massing, validators or Blender geometry.

## Independent layers

1. `Design.floors` → `cost/quantities.ts`: exact union areas from millimetre
   footprints and room rectangles, courtyard/double-height cuts, wall lengths and
   actual door/window widths and heights. Cached area/count fields are ignored.
   Both wall faces receive plaster/paint after opening deductions. Open passages
   have no door-leaf cost. Exposed lower roofs and double-height roof caps count.
2. `cost/specifications.ts`: defaults, preset IDs, per-category choices and
   optional room-flooring overrides. Invalid saved option IDs recover safely.
3. `cost/data/rates.json`: current material/labour rates, settings and per-finish
   sanity bands in INR/sq ft. The deployed five-category adapter reads these rates.
4. `cost/data/pune.json`: compatibility scope and measurement assumptions. Values are **provisional project allowances**,
   not verified quotations. CPWD PAR is a methodology reference, not a Pune product
   price list. Changing the dataset requires independent local rate verification.
5. `cost/index.ts`: quantity × selected rate → BOQ → stated allowances → total.

Structure, electrical, plumbing and pool lines remain area allowances. Steel,
concrete, foundation design, fixture counts and service runs cannot be inferred
accurately from a concept floor plan. Unmeasured Blender-only facade elements,
compound wall/gate and decorative planting are excluded. Each export lists scope
and measurement assumptions. No claim of structural certification is made.

Overhead applies to direct works; contingency to works plus overhead; fees to
direct works. Optional GST applies to works, overhead and contingency. Taxes on
fees are excluded. GST defaults off and is an adjustable provision, not a tax
determination. Defaults and percentage limits live in the dataset.

The requested ±15% is a displayed **concept range**, not a guarantee of final
accuracy. Every estimate carries its date, city and qualification. CSV exports
include the same quantities, specifications, allowance bases and unrounded totals
as the screen; user text is escaped against spreadsheet formula interpretation.

Legacy spending fields remain stripped by the brief schema. `brief.finish` and
`brief.specs.overrides` are non-geometric preferences, excluded from the plan seed.
Existing `rates.ts` wrappers are reference-only compatibility
helpers; production pricing uses measured geometry rather than style multipliers.

## User flow and saved choices

`/workspace/finishes` is step 06, after Render; Report is step 07. Plan no longer
shows early pricing. The existing monochrome controls provide Simple, Standard
(default) and Refined starting finishes. Individual choices update the estimate
immediately. Room-flooring overrides, allowances/tax and detailed BOQ are collapsed.
Changing a finish does not regenerate a plan or a render. Invalid plans get a
quiet link back to the brief rather than an estimate.

`state/finishes.ts` stores selections separately under `formstead.finishes-v1`,
keyed by measured source geometry. Seeds alone do not clear finish choices.
Different geometry gets defaults; prior geometry keeps its own selections.
Finish choices now also save in the project Brief, including room overrides, so
Supabase project saves retain them. Numerical allowance adjustments remain local.
Older browser-only choices are respected until the next edit writes them to the Brief.
Report and its PDF calculate from the same selection as the cost page. No product
installed-product photographs are added; the existing cost UI uses text specifications.

## Full catalogue data

See [`cost/data/README.md`](../src/lib/cost/data/README.md). Every dataset is Zod-
validated and cross-referenced: 85 items, 208 options, 19 groups and complete
Basic/Mid/Premium presets. `resolveSpecification()` supports house defaults and
`itemId@roomId` overrides; auto items ignore overrides and never enter chooser lists.
Unknown retired option IDs fall back to the selected preset, preserving old saves.

The existing Simple/Standard/Refined controls map to Basic/Mid/Premium in the Brief.
They price their existing five measured categories. Other catalogue items provide
data for further controls and take-offs; they are not silently added on top of
existing structural/MEP allowances. Approvals/connections are recorded allowances
but remain explicitly excluded from the deployed BOQ until included as measured scope.
No catalogue selection adds roofs, pools, solar geometry or future floors to a plan.

Original CC0 colour textures and 800px web derivatives are tracked with file
hashes, dimensions, provenance and source-audit metadata. The exact original
close-up is loaded by the opt-in Blender specification shader. Installed photos
require a named human reviewer; no machine audit is presented as human verification.

## Report and image presentation

Report and PDF are gated by the same hard plan checks as the cost step. The PDF
includes measured quantity × rate rows, the selected specification per room,
allowance bases, concept range, scope, exclusions and measurement assumptions.
Each PDF page carries the dated estimate label; the palette remains monochrome.
The old marketing example price is removed so unqualified early pricing is not
shown. Blender images say Visualisation, and AI interiors/concepts are explicitly
AI visualisations. Real-photo references retain their source/licence metadata.
