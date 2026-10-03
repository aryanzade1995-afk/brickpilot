# Expanded villa specification catalogue

The existing **06.1 → Change → select → Use this** workflow now includes a reusable,
Zod-validated catalogue at `src/lib/finishes/products.json`. `catalogue.ts` exposes
search/facets and adapts records into the existing specification and installed-rate
registries. No new dependency, API, route, planner or geometry generator is added.

## Coverage

| Category | New catalogue choices | Existing specification destinations |
|---|---:|---|
| Wall tiles & cladding | 18 | Bathroom tiles, kitchen dado, facade cladding |
| Kitchen | 21 | Layout preference, cabinet finish, counter, hardware upgrade |
| Doors | 18 | Main entry, internal doors, hardware |
| Windows, glass & grills | 18 | Frames/opening system, glazing, mesh/grill package |
| Railings & gates | 18 | Railing assembly and compound gate assembly |
| Waterproofing | 18 | Terrace/balcony, bathrooms, foundation, specialist scope |
| Painting | 18 | Interior and exterior paint systems |

129 records include three neutral/default choices (follow generated kitchen,
standard cabinet hardware already included, no additional specialist treatment).
Legacy choices, preset defaults, flooring's separate 25-family catalogue, saved IDs
and current per-room/house scope stay readable. Nothing replaces a saved selection.

Every record separates **material**, **look/type**, **finish**, **application** and
room recommendations. It includes a size/specification, measurement unit,
material/labour allowance, Pune/date, existing Blender material, supplier reference,
source kind, facts and image provenance. Source kinds distinguish actual product
pages, collections, specification guidance and generic natural-material textures.
A collection/guidance link is not proof of a particular branded SKU.

The drawer builds contextual filters from these records. Search, material/system,
look/type, finish, brand/reference, application and room suitability do not change
room assignment. Facets with a single possible value are omitted. Legacy choices
remain visible when filters are clear. Compare, current/selected state, cancel,
undo, presets and the original Apply-to room controls remain available.

## Measurement and pricing

- Existing BOQ recipes retain their source measurements. Tiles price the existing
  wet wall/dado area; cladding uses the configured facade allowance. Door/frame/
  glass/grill areas, railing lengths and compound-gate areas are unchanged.
- Cabinet fronts and worktops use the existing kitchen run allowances. Window
  frame rates exclude separate glass; a combined mesh/grill is a single replacement
  package. Railing/glass safety and opening-system details need working drawings.
- New `kitchen-hardware` prices an **incremental** upgrade per measured kitchen.
  Standard hinges/runners remain included in the cabinet rate; its default costs
  zero. No duplicate standard hardware charge is introduced.
- `kitchen-layout` is a cabinet-drawing preference, **not a new room layout**.
  Island/peninsula scope is excluded until drawn and measured. It adds no invented
  quantity or price. It does not change the planner, generated doors or circulation.
- `waterproofing-specialist` records tank coating, injection repair or wall-seepage
  requirements. Tank internal faces and defects are not measured by the existing
  plan. These choices explicitly require a survey/quote and are excluded from
  the estimate. They are not zero-cost promises of construction work.
- A bathroom membrane plus joint-grout package still includes a membrane: tile
  joints alone are never offered as a substitute for wet-area waterproofing.
- Geometry, quantities, specification, rates and BOQ remain separate. Only the
  selected specification's measured lines change price; trade totals, add-ons,
  material/labour split, report, exports, assumptions and saved replay use the
  existing engine. Unmeasured selections appear in exclusions and assumptions.
- Rates are **provisional installed Pune concept allowances dated 2026-10-03**,
  not verified manufacturer MRPs, contractor quotes or exact SOR line items.
  Existing generic Blender materials remain preview proxies for the new systems;
  a finish choice does not introduce new meshes or a supplier-exact shader.

## Real-image policy and audit

No image was generated. No stock/Pinterest/search-result image is used. Uncertain
product swatches, packshots and marketing rooms are not presumed photographs.

Seven choices have an audited preview, comprising **six distinct image assets**:

| Choices | Image source | Status |
|---|---|---|
| Sandstone cladding | Existing audited sandstone texture registry record | CC0 natural-material close-up |
| Grey stone cladding | Existing audited grey-stone texture registry record | CC0 natural-material close-up |
| Solid teak main door; timber handrail | Existing audited teak texture registry record | One shared CC0 natural-material close-up |
| Solid hardwood main door | Existing audited dark-wood texture registry record | CC0 natural-material close-up |
| Granite countertop | Existing audited granite texture registry record | CC0 natural-material close-up |
| Motorised swing gate | [Gandhi Automations product page](https://www.geapl.com/motorised-swing-gates), [actual photograph](https://www.geapl.com/cdn/product/133519309112675995.jpg) | Official page + visual audit; permission required |

The exact CC0 texture, original source, credit and audit are already recorded in
`blender/assets/spec-materials.json`. The six natural-material choice previews
reference that same material's existing ~800 px web copy. They are explicitly
labelled generic surface close-ups, not photographs of the assembled door/counter/
railing or a named supplier product. Their source texture is also used by Blender.

The manufacturer gate photograph was inspected as a real installation, not a
render. It is referenced by its official URL; no manufacturer image file is
bundled into the repository. `productionReady: false` and
`licensingStatus: permission-required` prevent treating public access as permission.
It is omitted from PDFs/spec exports pending rights clearance. A failed remote
image automatically shows **Image unavailable**.

The other **122 choices** deliberately show **Image unavailable**. Their official
product/collection/guidance links remain available. Matching genuine photographs
have not been verified; do not fill gaps with a render or unrelated material.
This is a source-backed specification catalogue, not a complete cleared image library.

Primary references include:

- [Orientbell wall catalogue](https://server.orientbell.com/media/downloadcatalog_downloadcatalog/w/z/wz_wall_master_catalogue.pdf)
  and [Europa Subway](https://www.orientbell.com/tiles/subway-tiles).
- [Sleek Crest kitchen catalogue](https://beta.sleekworld.com/content/dam/sleek-final/catalogues4/Crest%20Kitchens%20Catalogue_Final.pdf),
  [Hettich drawer systems](https://www.hettich.com/en-de/products/drawer-systems),
  [Blum TANDEMBOX](https://www.blum.com/in/en/products/boxsystems/tandembox/assembly/).
- [Greenply door guidance](https://www.greenply.com/blogs/flush-vs-panel-vs-veneer-doors-which-door-type-is-best-for-indian-homes),
  [PVC/WPC guidance](https://www.greenply.com/blogs/pvc-vs-wpc-bathroom-doors-which-one-should-you-pick),
  [Dorset digital mortise locks](https://www.dorsetindia.com/products/digital-solutions/digital-door-lock/mortise-digital-door-lock).
- [Fenesta systems](https://www.fenesta.com/design), [accessories](https://www.fenesta.com/accessories),
  [Saint-Gobain residential glazing](https://www.saint-gobain.co.in/sectors).
- [Q-railing systems](https://q-railing.com/en/balustrades/systemfinder/),
  [Gandhi gate systems](https://www.geapl.com/motorised-gates).
- [Dr. Fixit wet-room systems](https://www.drfixit.co.in/home-owners/new-construction/bathroom-waterproofing/products),
  [Fosroc Brushbond](https://www.fosroc.com/product/show/brushbond),
  [Brushbond Crystal](https://www.fosroc.com/product/show/brushbond-crystal),
  [Nitofill injection system](https://www.fosroc.com/product/show/nitofill-ws60),
  [Sika PU roof-system reference](https://gbr.sika.com/en/construction/roofing/flat-roof-productsandsystems/liquid-roofing/sika-pro-tecta-wp/sikalastic-625-n.html).
  Regional availability and complete compatible systems require supplier confirmation.
- [Asian Paints plain finishes](https://www.asianpaints.com/content/ap/en/home/products/paints-and-textures/interior-walls/plain-finishes.html),
  [texture systems](https://www.asianpaints.com/royale-play-textures.html) and
  [paint-system guide](https://www.asianpaints.com/content/ap/en/home/guides/paint-product-guide.html).

## Verification

`scripts/test-finish-catalogue.mjs` checks all 129 records, source/asset restrictions,
rate/material/quantity references, contextual filters, every priced option,
geometry immutability, per-room isolation, saved replay, incremental hardware,
advisory exclusions and report-safe imagery. It is included in `npm test`.
Existing specification, flooring, BOQ, cost-delivery and report tests remain in use.
