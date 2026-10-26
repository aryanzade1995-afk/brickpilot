# Realistic interior models

The shipped library contains 18 optimized models from Poly Haven and the official Sweet Home 3D / Blend Swap collections. Attribution, licence URLs, source download URLs, adaptations, SHA-256 hashes and verification dates are in `public/interior-assets/manifest.json`. Each folder includes its own licence notice. The wall-hung WC and exhaust source files explicitly permit CC BY 3.0 as an alternative to Free Art Licence; this distribution uses CC BY 3.0.

The models are generic visualization assets, not exact branded product models. No new supplier prices or product identities are invented. The existing Finishes & Cost selections supply compatible fixture type and selected colours. Existing furnishing positions decide where models go; missing/unrepresented fixtures are not inserted into architecture. Indian pans and incompatible fixture variants retain their existing matching representation.

## Data and rendering

- `src/lib/interior-assets/catalogue.ts`: available model categories and Brief selection helpers. Choices live in the existing `specs.overrides`, scoped by the existing finish room IDs.
- `placements.ts`: canonical instances derived from current furniture parts. Proportions are preserved and every model fits within the original appearance envelope. It never edits the plan.
- `delivery.ts`: includes canonical model instances and conservative collision envelopes in the appearance payload.
- `interiorModelAssets.ts`: one cached GLB template per shipped model; geometry/textures are shared, selected colours use owned material copies. Failure leaves the complete procedural model visible.
- `walkthroughAppearance.ts`: stages changed rooms; unchanged rooms and the accepted building stay in place. Model selection is excluded from architectural `finishSignature` and included in the separate walkthrough appearance key.
- `blender/walkthrough_export.py`: replays identical positions, rotations and scales. There is no Python furniture placement pass.
- `Furniture & 3D fixtures` in Specifications: same theme, room filter and project persistence. Direct link: `/workspace/finishes?tab=specifications&section=furniture-models`.

All runtime GLBs and textures are served locally. Assets are capped at approximately 18,000 triangles each and Poly Haven textures use 1K delivery. The viewer's adaptive quality and spatial batching remain active. These budgets support the existing 40 FPS target; actual performance depends on the house, browser and selected GPU.

## Rebuild

1. Run `npm run interior-assets:download` to fetch official sources and extract permitted model/image/notice files into ignored `output/furniture-sources`.
2. Run `scripts/prepare-interior-pack.py` using the project's Blender binary. It normalizes final geometry to centred X/Z and floor Y=0 in GLB, optimizes meshes, exports PBR materials, renders real-model thumbnails, and writes both manifests and credits.
3. Run `npm run test:interior-assets`, the walkthrough regression suites, and `npm run build`.

Keep source notices with adaptations. Add a model only after verifying its individual licence, author, actual dimensions/axes and collision envelope. Adding a catalogue card alone does not establish a placement rule.
# Kitchen slabs and pack

Kitchen base, drawer and wall cabinets and an extracted gas hob extend the
same CC BY 3.0 Jay-Artist library. Source cabinet tops/upstands and the source
stove oven are removed: the canonical Formstead slabs and sink cut-outs remain
independent. Cabinet modules fit the existing authored envelopes; their selected
cabinet colour, texture and roughness are shared with Blender delivery. Glass
and handleless selections retain their matching procedural fronts.

`src/lib/interior/kitchenSlabs.ts` removes duplicate corner coverage without
filling sink openings. It adds no new room runs. The existing furniture placer
now shortens rejected wall-length runs, reserves realized structural columns,
and distinguishes sliding thresholds from hinged door swings. It preserves
the 1.05 m concept working clearance and does not modify the accepted plan.

Polished slabs use a low-cost clearcoat and a 128 px illustrative mineral relief
map. Selected catalogue surface maps and colours remain authoritative. These
details are visual approximations, not manufacturer scans. Smooth 60 FPS is an
adaptive resolution target, not a hardware guarantee; other quality options
retain the 40 FPS budget. No post-processing or extra canvas is required.

Rebuild only this pack with `node scripts/download-kitchen-pack.mjs`, then run
the existing Blender conversion with `FORMSTEAD_ASSETS` set to
`kitchen-base,kitchen-drawers,kitchen-upper,kitchen-hob`.

