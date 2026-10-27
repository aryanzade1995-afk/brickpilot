# Water Intelligence: tank connections and underground drainage

Implemented and sources checked: 2026-10-27.

## Supply connections

Tank to home uses all realized roof-tank outlets, union/isolating-valve presentation assemblies, common manifold and the recorded service shafts. `View all tank outlets` frames the accepted tanks; walls fade but tank shells retain their original materials. Every connected supply route is checked by the existing structural-envelope function. The water-specific `multipleFeedPoints` option tries each existing manifold joint; the default exterior-generation path is unchanged.

Unconnected local risers remain visible and dashed. They are never animated as a working tank feed. In the current accepted house two local risers lack upper slab apertures, so these require a reviewed service opening or another designed route. No building holes are created.

## Sanitary drainage concept

The Drainage view reuses source soil/waste stacks and vents and the existing `routeDrain` helper. `proposeDrainStorage` positions a buried RCC tank outside the house footprint and reserved site features, not under the structural foundations. Recorded ground-floor stacks descend only through represented apertures. The common collector uses the largest selected source stack diameter as an unverified visual envelope, with explicit reducing sleeves where smaller stacks join. Shared same-size segments merge instead of stacking differently sized tubes on top of each other. The underground collector checks represented ground columns, structural envelopes, pool and rainwater-storage reservations. Blocked links remain explicitly unresolved.

The rectangular two-chamber model has concrete walls and base, a front inspection section, a partition with an inter-chamber opening, access slab openings, inspection necks, gripped covers and inlet/outlet tees. Pipe ports use a tested common coordinate conversion. A capped vent connection awaits a safe terminal design. It is not presented as a complete ventilation system.

The 3,000 × 1,600 × 1,800 mm shell, burial levels, 750 mm placement buffer and collector elevation are **visual coordination assumptions**, not code values or occupancy-based sizing. No design capacity is asserted. Collector gradients, survey levels, actual foundations, groundwater, water-source separation, desludging access and ventilation need professional verification. The effluent stub is deliberately not connected to an invented sewer or soak pit. Roof rainwater and drinking-water supply remain separate.

Visual reference: [MoHUA/CPHEEO, Part A Engineering, Chapter 9: On-Site Sanitation](https://mohua.gov.in/upload/uploadfiles/files/Chapter%209.pdf), section 9.3.4.2 and Figure 9.8. The source describes masonry/concrete tanks, compartment arrangements, baffles, access covers and ventilation. This is a reference for component form, not approval of the example dimensions or a determination that this Pune property needs on-site septic treatment rather than a sewer connection.

## Downloaded material pack

- [ambientCG Plastic010](https://ambientcg.com/view?id=Plastic010): smooth white plastic, used with neutral supply and drain colours.
- [ambientCG Concrete034](https://ambientcg.com/view?id=Concrete034): smooth concrete surface for the RCC chamber.
- [CC0 1.0 licence](https://docs.ambientcg.com/license/): raw downloaded maps may be redistributed and modified.

Three original 1K JPEG maps per asset are bundled in `public/materials/water/`: colour, OpenGL normal and roughness. `sources.json` records official URLs, retrieval date and download archive checksums. Total shipped map data is approximately 2.5 MB. No runtime external requests or 8K textures are used. Texture transforms are owned/disposed by each viewer; downloaded images are cached. Native Poly Haven pipe fittings are retained, with generated cylindrical UVs for seamless materials. Their existing CC0 provenance remains in `polyhaven-fittings.json`.

Only the architecture becomes transparent in the inspection view. Tank and pipe surfaces retain material depth tests, so their own walls, partitions and connections do not draw over each other. The chamber is shown empty for inspection; no invented sewage level is displayed. No duplicate canvas, render pass, architecture search, cost quantities or seed changes are added.

## Persistence and checks

The optional `simple.drainage` flag uses the existing versioned WaterConfig, save and project-restoration flow. Older saved records remain readable. Tank placement is a deterministic downstream proposal tied to the source plan; it is not a verified underground survey or a modified accepted GLB.

Run `npm run test:water-drainage` and the focused water suites. Coverage includes clear/pending site states, connections and structural apertures, unchanged building data, alternate feed routing, both tank orientations, old/new persistence and local material provenance. Device-specific RTX 3050 FPS is not measured; textures and geometry are bounded and no routing work occurs per animation frame.

## Continuous network and entry view (2026-10-27)

Collectors now converge at an external junction before a perpendicular inlet branch enters the tank. This gives the native fitting kit a real tee/elbow node instead of simply passing alongside the tank wall. Tank nipples were shortened to seat on this connection without extending across the inlet junction. The 350 mm approach is presentation space, not a statutory clearance.

`drainageNetwork.ts` unions shared runs, splits at actual 3D junctions, checks reachability from the tank and builds one combined fitting assembly for the connected stacks, vents and collectors. Separate render passes no longer independently terminate the stack/collector pieces. A crossing at a different elevation cannot create a junction. Unconnected source stacks remain dashed and labelled, excluded from the primary solid network and its flow animation. No source slab opening or bypass is invented to hide a missing continuation.

Drainage opens in a perspective-fitted network overview, including the house, roof structures and underground tank. The fit accounts for portrait/mobile aspect ratios. Numbered room/stack markers and a matching key appear in this overview without overlapping room-name cards. `Zoom to tank` is an explicit inlet-side close-up and hides overview labels; `Network overview` restores the wide view. Orbit and wheel/pinch zoom remain available. Construction sizing, gradient and disposal qualifications are unchanged.

## Shared 2D fixtures in the 3D drainage view

`sharedDrainage.ts` resolves the existing drawing document (manual planning, drainage inputs and imports) for both viewers. Default utility stack proposals use recorded room shafts; explicit stack-base overrides are preserved. The assigned shaft aperture can receive a branch, but its enclosing walls, other shafts, columns, footings and reservations remain protected. No sleeves or slab openings are created. Existing drawing input storage keys remain unchanged. Same-tab edits/imports are shared through a read-only snapshot; reloads use the saved schema-validated drawing inputs. Different imported geometry is rejected rather than overlaid on the accepted villa.

`fixtureDrainage.ts` projects the same fixture IDs and branch polylines into the accepted building's floor levels: plan millimetres (x,y,elevation) → GLB metres (x,elevation,-y). Actual entered inverts use the entered floor datum plus half the pipe diameter. Unknown branch levels use an explicitly illustrative 75 mm underfloor display band; this is not slab permission or an engineered gradient. Unknown pipe envelopes and trap shapes are labelled. Proposed fixtures remain identified as proposed, not as source architecture.

The same shipped interior GLB assets are reused for toilets, basins, kitchen sinks, baths and washing machines, respecting the existing model selector. Showers and drain grates use lightweight geometry. These are visual approximations at the source fixture footprints, not exact manufacturer products. Geometry and textures are shared; owned material clones are disposed. Model attribution is available in the expandable credits.

Selecting a fixture highlights its represented branch and a physical graph path toward the tank, only when both connections exist. Blocked branches stay dashed and do not animate; missing branches are not replaced by guessed routes. Room filtering, a keyboard-accessible fixture list, Focus fixture and View in 2D provide inspection without dragging. The initial wide overview and tank close-up remain available. Unknown or unsupported upper-floor continuations remain reviewable.

If the drawing has an explicit discharge destination, the separate tank/collector concept is hidden. Its saved 2D collector paths and outlet/chamber positions are shown instead, with unknown levels labelled illustrative. Full multi-floor stack-to-collector junction coordination remains unsupported and is not presented as a verified tank connection. The tank concept for drawings without an outlet remains a separate coordination proposal, not a secretly approved outlet added to the 2D design. Architectural identities, accepted GLBs, costs and other utility selections are unchanged.

Focused coverage: `scripts/test-fixture-drainage.mjs` checks all-floor parity, source preservation, shaft anchoring, explicit user settings, save/reload/project isolation, invert conversion, unresolved connections, imported geometry protection, configured discharge routing and stable repeated manual fixture IDs.

## Continuous drainage coordination (2026-10-27)

`drainageContinuity.ts` now joins the existing 2D fixture branch projections to the tank graph. The prior display clamped a branch upwards into a stack that started 100 mm above floor level. It also retained an isolated upper stack when no lower aperture existed. The new projection keeps branch XY and fixture locations fixed, places unknown branch heights in a declared underfloor service band, extends upper stacks downward and, when needed, proposes a perimeter downpipe and underground collector connection. Entered invert levels are never overwritten. An uphill or too-low entered branch remains unsupported.

The underfloor band is a visualization/coordination assumption: at least 250 mm below the floor, further below represented lower-floor beams where applicable. It is not a code gradient, foundation clearance or a verified ceiling-service allocation. New fixture drops and wall sleeves are listed as **proposed openings for review**, with positions and an optional 3D display. No wall/slab mesh or accepted architectural model is cut or changed. Structural columns, beams and slabs remain hard routing obstacles. Footing elevations, wall sleeves, waterproofing, exact fitting specifications and survey falls still require professional design. An ordinary door opening is never substituted for an approved sleeve.

Graph junctions are split at exact branch elevations, so a mid-stack entry has a real adjacency node. Tracing starts at that exact port and follows contiguous, oriented segments to the tank inlet, without a synthetic jump back to a stack endpoint. The plumbing signature includes route geometry and branch ports independently from the building identity. Live flow uses the same paths. The source 2D engineering checks remain unapproved; a connected 3D coordination proposal is not a compliance result.

Validation covers three representative two-floor houses with all 15 fixture branches connected, preservation of plan XY and house identity, downward stack extensions, explicit wall-sleeve review, a blocked column, incompatible entered levels, absence of a tank, configured alternative discharge and offset user stack positions. The current saved demonstration house was also checked: all 13 fixture routes reach the tank, with one exterior bypass and 14 proposed service openings/drops listed for review.

## Indoor supply and complete connection hardware

Tank to home now consumes the existing cold-water 2D utility layout, saved manual point edits and the accepted house floor elevations. `supplyContinuity.ts` uses the existing `waterScene()` lift, converts its positive-plan-Y study coordinates explicitly to accepted-GLB coordinates, and embeds suitable wall runs on the actual wall centre planes. If embedding would overlap a represented column, the source service-side bypass is retained. Door-threshold crossings retain their explicit proposed underfloor routing; no slab hole or chase becomes approved geometry. The same roof tank outlets/manifold feed the recorded risers. Where the original roof feed was interrupted, an exterior drop connects to a local riser below the represented beam band, with sleeves/supports left for review.

The complete cold network includes floor feeders, room isolation valves, horizontal distribution, wall risers and terminal adapters into the existing sink/WC/appliance models. Fixture positions and Finishes & Cost selections are reused. Floor drains receive no water feed. Hot-water networks are not joined to cold storage without an implemented heater system. A missing route in the 2D source stays pending and is listed, rather than guessed through structure. The current saved house has all eight cold-water fixtures connected to the roof tanks.

Sockets, coupling collars, caps and isolation-valve details are derived from real pipe endpoints/legs and batched with the existing utility instancing component. Drainage hardware sees both the stack/collector segments and the fixture branches/traps, so horizontal-to-vertical junctions share the same positions. Fixture outlet/trap geometry has one shared pure producer. Native pipe bodies, demand rendering and the original accepted villa remain unchanged. These are visual coordination fittings, not a manufacturer specification or construction approval. The viewer uses neutral pipe colours; normal walls conceal embedded runs, and the existing See inside walls option reveals them.

Selecting a water fixture traces from an actual roof tank outlet to its exact terminal; View in 2D opens the water layer and corresponding room. `scripts/test-supply-continuity.mjs` covers multi-floor connectivity, vertical/horizontal runs, wall-centre embedding, unit conversion, source preservation, missing tanks, separation from hot/drain networks, missing source routes, socket placement and duplicate/shared fitting removal.
