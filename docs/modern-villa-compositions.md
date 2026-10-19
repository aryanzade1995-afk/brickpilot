# Modern villa compositions

The optional `style.composition` controls planning before the 2D coordinates
are generated. Existing briefs omit it, preserving their seed inputs.

1. **Glazed central bay** places the stair centrally in a street-facing wing,
   aligns tall source glazing on each level and prefers recessed upper rooms.
2. **Staggered wings** chooses pavilion or linked-wing plans and independently
   shortens upper wings on the supporting structural grid.
3. **Terraced villa** requires at least 6 m² of accessible upper terrace. A
   source door, real lower roof support and all room checks remain mandatory.

Tall fixed windows retain a visible sill at least 900 mm above the floor.
Balconies have a separate hinged or sliding access door. Glazed doors never
substitute for a window or lead out without a real balcony/terrace.
The head of the source glazing clears the sized
beam above it. Up to three canopy planes per floor attach to real glazed
walls, fit inside the buildable envelope and leave serialized courtyards open.
The same canopy records generate editable Blender slabs and timber soffits.
Existing double-height living voids remain optional: they are included only
when a nonrequired gallery can be removed without losing rooms or structure.
A glazed bay is not presented as proof of a double-height living interior.

The Style step and 3D page expose these three choices. Applying a composition
from 3D computes a replacement source plan and commits it only after its exact
Blender output succeeds. Failed searches preserve the previous villa.
Exterior seeds vary one selected composition without changing its room plan.

Modern exterior colours use twelve deterministic schemes in a separate random
stream. Sage, terracotta, slate blue, graphite, olive and clay/copper join the
neutral finishes. Colour selection cannot move the building or its openings.
The exterior landscape keeps the lawns and small planters without garden trees.

Balcony boundaries use glass panels on slim posts. Recessed and boxed recipes
retain their overhead frames without full side walls behind the glass. Each
source balcony owns its enclosure; unused lower roof outside it does not add
a second wall or glass row. Separate roof access retains its own outer guard.

`Use full balcony area` expands the outdoor source rectangle across the largest
clear supported slab area. It cannot cross occupied rooms, another outdoor
space, an unsupported gap or a courtyard. The deck, glass boundary, 2D drawing
and quantities follow that same enlarged room. The chosen exterior seed and
recipe namespace are retained. A `full-slab` flag in the saved pin replays the
expansion after reload; the new source commits only after its exact render succeeds.
EXIT signs and lettering are omitted from generated Blender/GLB geometry.

Pinning adopts the direction card's exact checked plan and cached render (or
its existing render job). Returning through 2D and 3D reuses that selection.
The plan seed, recipe and planner version are retained even when a caller passes
only the direction's exterior seed and massing. Room edits from another
direction are discarded when choosing a different card; continuing the current
pin retains its edits. Failed jobs need an explicit retry, never navigation.

Handoff regression: `npm run test:direction-handoff`.

Validation: `node --experimental-strip-types --test scripts/test-modern-compositions.mjs`.
