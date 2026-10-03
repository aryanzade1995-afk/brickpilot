# Cost and specification data

`validated.ts` parses **every JSON dataset in this folder** with Zod and checks
the specification graph before it is used. `schemas.ts` owns the constraints.

- `rates.json`: material/labour planning allowances, units, Pune/date provenance,
  taxes, overhead, contingency, fees, approvals/connections, and Basic/Mid/Premium
  reference bands in INR per square foot. SOR is a reference basis; the amounts
  and supply/labour splits are provisional, not verified SOR line-rate analyses
  or current supplier quotations. Replace them after a local rate review.
- `specs-catalogue.json`: 85 items / 208 options across all 19 requested groups.
  Main and more options have 3–6 choices; fittings have three levels. Optional
  extras use on/off switches. Technical items use dropdowns. Auto items are
  computed only and are excluded from `specificationChoices()`.
- `presets.json`: an option for every item, including auto/technical items, for
  each of Basic, Mid and Premium. Extras default off. Foundation quantities,
  commercial terms and technical proposals require professional confirmation.
- `quantity-rules.json`: Zod-validated concept sizing, steel/formwork/material
  yields, finish dimensions, points and tank allowances. Unknown soil and a
  standard plinth are shared defaults for every finish preset. These are
  approximations; structural design by a licensed engineer is required.
  See [measurement conventions](../../../../docs/quantity-takeoff.md).
- `finishes.json`, `pune.json`, `legacy-rates.json`: compatibility data for the
  deployed five-category cost UI and reference helpers, also Zod-validated.
  The current BOQ adapter takes its rates, defaults and provenance from `rates.json`;
  old numbers in compatibility datasets remain historical, not current price sources.

Catalogue rates are **not all additive BOQ lines**. Foundations, RCC, masonry,
plaster and electrical/plumbing allowances must not be counted again alongside
their detailed items. Some specifications require measurements the source plan
does not contain. This data foundation does not fabricate those quantities or
add optional structures to the plan.

`brief.finish` defaults to `mid` and `brief.specs.overrides` to `{}`. House overrides
use `itemId`; room overrides use `itemId@<floor>:<semanticRoomId>`. Unknown old
options fall back to the selected preset. Auto items ignore saved overrides.
Finish-only edits retain the current plan, directions and pinned villa. The plan
seed excludes these fields, including their empty defaults, preserving old seeds.
Current finish controls write their choices to the Brief as well as local cost
state, so saved projects replay them on another browser. Allowance percentages
remain in the separate cost state and default from `rates.json`.

## Photo and Blender asset contract

`blender/assets/spec-materials.json` registers 14 reusable material references.
Each close-up's `file` is the same original texture loaded by
`blender/visualization/spec_materials.py`; `webFile` is its 800px derivative.
Original colour maps are 2K/4K, with dimensions, SHA-256 hashes, source, CC0
licence, credit and an explicit source-audit verifier. They are tracked in Git
so a fresh checkout can pass asset tests offline. `LICENSES.md` lists each file.

These are **surface references, not photographs of named supplier products**.
Window/glass options show a frame surface; that photo does not depict glass or
certify a glazing product. A roof, cabinet or optional equipment reference does
not prove an installed assembly. Keep those captions when displaying photos.

No installed-product photographs or generated pictures have been added. Installed
photos must have `team://` provenance and a `human:<name>...` reviewer. Machine
source audits cannot satisfy that requirement. A Blender view must be explicitly
labelled `Visualisation` and cannot fulfil the required close-up photo slot.

The specification shader is opt-in. This change restores reference textures only;
it does not restore the previously reverted graphics pipeline or change geometry.

Checks: `npm test`, `npm run build`, `npm run lint`; Blender shader smoke test:
`blender --background --factory-startup --python-exit-code 1 --python blender/test_spec_materials.py`.
