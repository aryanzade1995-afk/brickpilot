# Facade Design

Open **3D Massing → Blender design → Facade mix**. Each house automatically combines five or six of the ten design recipes. **Shuffle facade** creates another mixture in the existing viewer, without regenerating the house. The chips identify its contributors; they are not style selectors. Optional materials, intensity and a reproducible seed live under **Materials & saved seed**. **Render facade & downloads** builds matching Blender, GLB and rendered views.

Seeded assignment gives each wall bay one recipe, avoiding competing treatments on the same wall. A matching pass reserves a compatible bay for every contributor, then distributes the remaining bays across those recipes. Small houses can split long walls into separate bays. Each contributor has real geometry; a shared palette coordinates timber, stone, metal and frames. New generation/export defaults to mixed facades, and opening an older project converts its single-style settings while preserving its seed and materials. Original-model backups remain available internally for recovery.

The ten recipes attach to real exterior walls using `buildFacadeZones`; carport fascia uses the already checked `coveredOutdoor` roof. Rounded and diagonal elements are extruded polygon meshes, while screens and trellises contain individual bars. They are not texture-only silhouettes. Existing facade hero/depth ornaments are suppressed during the selected preview/export; functional walls, openings, guards, roofs and parking supports remain.

Configuration lives in the validated optional `brief.facadeDesign` record. Geometry and cost seeding exclude this record, preserving room layouts and architectural seeds. Invalid stored facade settings are discarded without discarding the house. The independent facade seed, configuration and source plan reproduce the same attachment geometry. Material options reuse the existing material catalogue and texture files; the default inherits the accepted wall material.

Live geometries share one texture cache and are batched by material (at most six batches). Mixed geometry has a 320-part cap and is only regenerated when settings or the house change. Replaced geometry and material instances are disposed. Mixed facade calculation measured 10.3 ms at p95 over 24 combinations locally; this is geometry computation, not an RTX 3050 FPS benchmark. No per-frame geometry rebuilding or additional viewer was added.

## Checks

`node --experimental-strip-types --test scripts/test-facade-designs.mjs scripts/test-blender-state.mjs scripts/test-direction-handoff.mjs scripts/test-setback-balcony.mjs scripts/test-accepted-villa-walkthrough.mjs scripts/test-furnished-match.mjs`

Tests cover ten recipes and automatic mixes on six validated houses: one, two and three floors, narrow and wide plots and different approach orientations. They check five or six actual contributors, one owner per bay, deterministic reproduction after reload, different seeded combinations, matching default exports, legacy migration, aperture keepouts, setbacks, preserved house data, saved settings, original-model recovery, batching, disposal and existing walkthrough/furnished behavior.

`node --experimental-strip-types scripts/render-facade-designs.mjs` produces a ten-design Blender/GLB/render review under `output/facade-designs`. `--inputs-only` refreshes its payloads without rerendering. `blender/test_facade_variations_runtime.py` reuses the generated house to check all ten Blender mesh bounds against the exact live-preview bounds and render a comparison.

Add `--mixed` to the render script to review an automatic composition under `output/facade-mix`. Pass `-- output/facade-mix --mixed` to the Blender runtime check to verify that the five or six contributing recipes exist as actual meshes, with matching bounds and UVs. The live browser check also covered shuffle, matching exported downloads and reload persistence.

## Limits

Usable, supported upper-floor setbacks automatically become accessible source-plan balconies on new generation and saved-house replay, across all styles. Existing balconies expand to their available supported slab. No conversion button is needed. Actual courtyards, double-height voids, service shafts and strips too narrow for balcony access remain reserved. The change adds outdoor rooms and real doors without moving enclosed rooms or the supporting floor plates.

Raised ground floors include masonry perimeter walls and compacted earth beneath the slab by default. Cached older GLBs receive any missing enclosure in the existing live scene and combined download, without a rebuild prompt. GLBs already containing the Blender enclosure are detected and left unduplicated. This visual closure is independent of facade selection and materials.

These are lightweight exterior attachments, not new occupied volumes, bridges or structural cantilevers. The existing openings are preserved: no ribbon window is invented by cutting through a bearing wall. Door approaches, glazing clearances and balcony headroom are reserved; parts crossing buildable setbacks are omitted. On constrained plans, treatments are reduced rather than forced into unsafe geometry.

Garden detailing adapts to wall-mounted timber shading when a balcony is absent. Carport treatment uses an existing supported parking roof, otherwise only the entrance treatment is used. Fixings and wind loading need professional design. Added roof gardens, additional occupied spans, changed load-bearing walls and new glazing openings would be separate structural/layout work.

Existing rendered downloads remain the previous export until Render facade & downloads finishes; the interface identifies this state. Extremely constrained facades may have fewer than five compatible bays; unsafe details are omitted. Core calculations and the walkthrough do not depend on an external AI service.
