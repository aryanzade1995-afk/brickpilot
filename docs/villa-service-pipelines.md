# Villa service pipelines

3D Massing overlays a lightweight canonical service layer on the accepted villa. Utilities remains a separate 2D-only workspace. Source rooms, shaft apertures, slabs, architectural identity and construction BOQ are never edited by this layer.

- `villaPlumbing.ts` reads actual BuildingModel floor elevations, service shafts, beams, columns, walls, roof union/holes and the realized expanded tank bank. Sizes come from the existing Finishes & Cost selections.
- Every tank shell has an outlet connection to the common manifold. Supported roof-to-shaft feeds are drawn only when their full envelope clears every crossed slab/roof and the header remains on a continuous supported roof. Roof headers stay low and avoid parapet bands, headroom and represented terrace furniture.
- Separate source shaft positions carry supply and soil/waste stacks. Kitchens/utilities use selected waste sizes; bathrooms use selected soil sizes. Vents continue only through verified source apertures.
- A shaft on one floor is not automatically a hole through every floor above. Interrupted feeds and vents are reported instead of drilling through the accepted architecture. The current lower exposed-roof generator does not cut its local shaft aperture; that route remains pending.
- Fixture branches, traps, hydraulic head, gradients, terminal clearances, final sewer/septic/treatment destination and invert levels are not established by this visualization. Open stack ends must not be interpreted as an approved ground-drain connection. Display assumptions are in `PLUMBING_CONCEPT`; these are not statutory/code values. Nominal water sizes are concept envelopes, not a verified manufacturer OD.

The layer has independent water/drain visibility and a view-only X-ray option. Collinear headers are unioned to avoid overlapping pipe faces. The renderer merges geometry into at most three material meshes and preserves the demand-rendered canvas. No pipeline control remounts the cached villa or calls architecture generation.

**Live villa + visible pipelines GLB** exports the exact visible villa, solar preview (if present) and service geometry. X-ray is exported as ordinary opaque pipe material, without changing cached materials. Saved images and original file links retain their generated content; they are not silently presented as updated pipe exports.

Future Blender generation receives the same versioned TS layout and canonical segments. `geometry/plumbing.py` replays dimensions and endpoints without making placement decisions. Tagged services are excluded from shape fingerprint measurements. Reopened combined GLBs strip tagged baked services before one current live layer is added, preventing duplicate pipes. A separate Blender integration validator opens a copy of an accepted .blend, adds services and confirms source geometry and shape fingerprints stay identical; it never overwrites the accepted source.

Checks:

```
npm run test:villa-plumbing
npm run build
```

The integration script is `scripts/validate-villa-plumbing.py`, executed through the existing configured Blender binary with an accepted .blend, source input JSON, canonical service JSON and a separate output GLB path. Its `.validation.json` reports plan ID and architecture/shape preservation.
