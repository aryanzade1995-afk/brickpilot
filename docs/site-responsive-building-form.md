# Plot-responsive building form

New briefs, new directions and **New building shape** use `site-form-v3`.
The version is saved in the direction pin. Older pins without the version
continue to use the original planner; opening a saved design is an exact replay.
Existing Structure mode continues to respect its measured geometry.
Saved `site-form-v1` and `site-form-v2` pins retain their original floor and balcony placement.

Version 3 supports a compact courtyard plunge pool when Swimming pool is on.
The preferred pool is 2 × 3 m; a rotated 1.8 × 2.8 m alternative fits smaller
courts. Every side reserves a 1 m path. If the court cannot hold it, the existing
garden-pool allocator is used and the site notes explain the fallback. The court
stays open through all floors. Blender cuts the paving around the water and
does not put a central planter over the pool. Pool placement survives room edits.

Balcony supports now rise from the slab, frame-integrated treatments connect
back to both sides of the facade, and long glass rails are divided into bays
of at most 1.2 m with posts. The outdoor rendering version invalidates stale
models while retaining the existing composition seed namespace.

Version 2 places requested balconies on a substantial supported setback roof
before considering a front projection. These become door-connected setback
terraces in the source plan. The renderer finishes only their recorded area,
does not duplicate their slab or rail, and treats disconnected maintenance roofs
separately. The panel reports usable terrace area separately from exposed roof.

## Actual floor geometry

The bar planner explores independent ends for the rear and front room bands,
plus a recessed corner in the front band. All cuts use the ground structural
axes, remain inside the immediately supporting floor and keep the stair core
in the same position. The compact profile retains a straightforward stack on
narrow plots. Other seeded profiles favour terracing, unequal wing lengths or
recessed corners where the requested rooms fit. Lookahead reserves sufficient
space for later floors and the clear roof terrace. Impossible cuts fall back
to a less aggressive, validated arrangement.

The wing planner shortens upper room wings independently. Room groups, gallery
connections and the stair remain intact. An enclosed courtyard retains its
continuous gallery and sky void on every floor. Roofs revealed by a cut are
real lower roof surfaces, not extra facade ornaments. This does not claim that
every revealed roof is an accessible furnished terrace.

## Site response

The compiled envelope is relative to the selected entrance: E/W approaches
rotate width and depth before proportions are assessed. Candidate plates and
front/side parking strategies are ranked against this envelope. Narrow/deep
sites favour compact bars; wide/shallow sites favour transverse, spreading
forms. Only candidates that pass the existing mandatory validators are scored.
Actual window bearings, street-facing bedroom windows on the outer outline,
and bedroom distance from the main entrance influence the final choice.
These are planning preferences, not a sun, wind or neighbour simulation.
Finish-only climate settings do not change saved floor geometry.

The 3D panel shows small diagrams from the same floor footprints, including
the exposed lower roofs. These labels support English, Hindi and Marathi.
The source plan feeds the 2D editor, Blender scene, GLB and renders together.

## Validation

Run `npm run test:site-form` for contrasting plot proportions, N/E/W approaches,
three-storey nesting, room retention, stair/column continuity, courtyard wings,
architecture validity and exact saved-recipe replay. The suite also checks that
street privacy influences scoring without mutating an already validated plan.
