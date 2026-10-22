# Walkthrough finishes

The walkthrough reads `Design.model.brief`, the same persisted Brief used by Finishes & Cost. `interiorFinishes()` resolves `createFinishAssignments()`, room overrides, catalogue options and representative allowance products. No parallel selection state is stored. `optionId` always retains the actual cost selection; `displayedOptionId` identifies an illustrative allowance exemplar. Product references now include both finish-catalogue and flooring-catalogue IDs.

Untouched pre-catalogue projects use the same `projectFinishBrief()` read-only legacy projection in Finishes & Cost and AI Interior, including saved per-room flooring. No migration is persisted until the user edits through the existing product panel. Current Brief selections always take precedence over legacy controls.

## Shared appearance package

`prepareWalkthroughAppearance()` resolves each room independently. Source architecture and material domains remain in `prepareWalkthroughGeometry()`. `fittedFinishes.ts` adds appearance-only wall-tile/backsplash skins clipped to existing source wall faces, and ceiling skins clipped to real ceiling faces. Source apertures, stair holes, shafts and double-height voids are never filled. Existing `dressRoom()` and `roomFurnishing()` supply counters, cupboards, basins, sinks, taps and WC representations. A walkthrough-only full-height argument removes the cutaway furniture height limit; existing furnished/360 callers retain their defaults.

Selected fans, lights, switches, exhausts, heaters and shower heads have lightweight concept representations placed on available source surfaces. They are not an electrical/plumbing installation design. Exact supplier meshes, installation positions, ceiling profiles and fixture counts are not available in the current catalogue. Optional products without a supported placement, including tubs, remain in the room schedule without fabricated installation geometry. Concealed systems remain specification records. These representations do not add or change BOQ quantities.

`InteriorFinishes.visualBasis` distinguishes catalogue swatches, generic closeups, product-photo references and procedural approximations. Product-photo references are not projected as textures on fixtures. The catalogue currently provides no supplier PBR map sets or structured fixture dimensions: roughness/reflectivity and fixture dimensions are qualified concept values. A single explicit catalogue tile size is converted from mm to a two-axis metre repeat; ambiguous sizes retain an identified concept assumption. Existing official paint swatches and product preview colours are reused.

## Live updates

`WalkthroughAssets` is keyed by project and architectural identity, excluding appearance. Its optional product editor lazy-loads the **existing `SpecificationPanel`**, uses the existing project estimator and writes through `useStudio.edit`. No alternative picker, prices or persistence are introduced. Applying a selection updates that same Brief and therefore the main estimate.

`applyWalkthroughMaterialBindings()` swaps only changed architectural material slots. It leaves vertex/index/UV buffers, transforms, surface IDs and unrelated materials intact. `walkthroughAppearance.ts` batches fitted parts by room/look and stages only changed rooms. Unchanged room groups and GPU buffers transfer intact at commit; cancellation cannot dispose or detach them. A paint/floor-only edit therefore preserves all fitted meshes. The combined GLB's original furniture root is removed before the live package is attached, preventing duplicates. Superseded asynchronous updates cannot commit. Demand rendering invalidates after a committed appearance change.

Fitted collision geometry is replaced only if its positions/dimensions change; a colour-only edit preserves physics. Door state, body position, stairs and architectural colliders remain intact. If a changed product blocks the occupant, walking stops and explains the conflict; there is no automatic teleport. Live appearance failures are marked as potentially out of date.

Only export-job references are retained in memory/session storage, scoped to project and structural identity. Returning from Finishes & Cost reuses the exported shell. A changed appearance marks downloaded packages stale and hides their links until regenerated. The live view uses current selections while exports remain explicit snapshots. A saved/reloaded project resolves selections from its existing Brief; asset references are disposable, validated delivery handles.

Export metadata records a separate appearance-contract version. Older packages remain reviewable, but are labelled stale and cannot be downloaded as the current finish package until regenerated.

## Blender and verification

Blender receives the same canonical skins, fitted parts, materials and provenance. It replays the cached shell, exports the combined/furniture packages with rectangular metre UV scales, and records room visual qualifications in metadata. Python performs no independent product selection or fixture placement.

Run `npm run test:walkthrough-finishes` for room isolation, cost product IDs, quantity/architecture preservation, persistence, aperture clipping, fixture presence, rectangular texture scale, reference-photo handling, material buffer retention, stale-update cancellation and appearance batching. Existing walkthrough navigation and asset integration suites remain applicable.
