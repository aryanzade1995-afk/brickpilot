# Live rooftop PV and layout editing

> Pricing update: [Solar BOQ and energy assessment v1](solar-cost-energy.md) supersedes this stage's no-cost-change statements. Applied valid PV now updates the estimate; architecture and accepted building render stay independent.

The existing accepted-GLB canvas in `BlenderVillaPanel` draws `SolarLayer` as a
sibling of the memoized, cached `Villa` building. It uses the canonical v2 layout,
checked against the current accepted roof. Stale, invalid, legacy and mismatched
roof layouts are hidden with a review message; they are never re-packed on load.
The layer uses unshifted plan millimetres mapped to GLB metres `(x, z, -y)`. Matrix
tests compare all eight rendered corners to the physical placement prism.

PV faces, slim module backings/frames and four mounting posts use three instanced
meshes. A shared mipmapped DataTexture adds cell divisions without cell meshes.
Posts start at the canonical surface elevation and meet the tilted underside.
One batched line geometry draws amber keep-free boundaries at the actual roof
elevation. Decorative `SOLAR_SHADE_ROOF` architectural geometry remains in the
building; it is explicitly described as shade structure, excluded from roof
allocation, and never contributes to panel inventory or rated capacity.

Exterior, terrace/selection and top camera presets reuse the existing controls.
The canvas retains `frameloop="demand"`; matrix, selection, reservation and camera
changes explicitly invalidate a frame. There are no animation loops or extra
WebGL contexts. Building URL, prepared geometry and finish-only render inputs do
not change on solar edits. Hidden furnished and AI-source plan preparation also
ignore solar changes.

Arrays are stable groups of panels on a shared roof surface/component. Users can
select an array, individual panel, or all modules. The top-down SVG editor offers
pointer dragging, per-panel keyboard arrows (100 mm or Shift+1,000 mm), numeric
move/rotation controls, and numeric/drawn rectangular keep-free areas. Group
rotation uses the selection centroid, preserving relative spacing and IDs.

Edits are local drafts. Before Preview, only the SVG shows raw edits; the 3D villa
keeps its saved layout. Preview uses the shared roof allocation and manual panel
validator. A partial proposal is rejected in full, so an invalid move cannot
silently drop modules or reduce capacity. A checked draft can be shown in 3D with
an explicit unsaved badge. Apply rechecks the project/roof/configuration signatures
and every envelope atomically through `commitSolarLayoutEdit`, preserving the exact
building result, pinned direction, room layout, cost and accepted render. Cancel
restores the saved layer. An undecided project can save keep-free areas as a
reservation-only intention without creating installed panels.

## Viewer and capture audit

| Surface | Solar support / label |
| --- | --- |
| Massing accepted GLB canvas | Same canonical layout and reserved-area references; checked drafts labelled |
| Furnished cutaway | Building only; directs users to Blender design for PV |
| Blender hero/front/aerial stills | Building only, labelled immediately above images |
| `.blend`, `.glb` and still downloads | Building-only download scope stated beside links |
| AI villa source viewport and outputs | Building only; source labelled and prompt forbids inventing PV |
| Report study-model capture | Building only; demand-rendered and scope labelled |
| Report images and PDF | Building-only scope stated in report and PDF visualisation sections |
| Interior 360 / room previews | Interior-only scope label; directs users to Massing for rooftop PV |
| Direction previews | Building-only scope label; accepted villa is the live solar viewer |
| Reference gallery | Independent reference designs, not a current-project solar viewer |

Validation: `npm run test:solar-viewer`, solar editor/placement/roof/state tests,
production build/lint, and real-browser checks of camera presets, invalid moves,
rotation, keep-free areas, keyboard controls, persistence and translated labels.
