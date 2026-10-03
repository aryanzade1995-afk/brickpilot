# Finishes & Cost

Cost is downstream of the validated design. It never feeds the brief, programme,
planner, seed, massing, validators or Blender geometry.

## Independent layers

1. `Design.floors` → `cost/quantities.ts`: exact union areas from millimetre
   footprints and room rectangles, courtyard/double-height cuts, wall lengths and
   actual door/window widths and heights. Cached area/count fields are ignored.
   Both wall faces receive plaster/paint after opening deductions. Open passages
   have no door-leaf cost. Exposed lower roofs and double-height roof caps count.
2. `cost/specifications.ts`: defaults, preset IDs, per-category choices and
   optional room-flooring overrides. Invalid saved option IDs recover safely.
3. `cost/data/finishes.json`: installed finish allowances per square metre.
4. `cost/data/pune.json`: location/date, rates, percentages, assumptions, uncertainty,
   sanity bands, scope and provenance. Values are **provisional project allowances**,
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

Legacy spending fields remain stripped by the brief schema. No cost selection
belongs to the brief. Existing `rates.ts` wrappers are reference-only compatibility
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
Choices persist locally in this browser, not in Supabase project records.
Report and its PDF calculate from the same selection as the cost page. No product
photographs are added to the finish catalogue; the UI uses text specifications.
