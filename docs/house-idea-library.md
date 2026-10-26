# Static Blender house-idea library

The Brief Style card reads `public/house-ideas/manifest.json` and static PNGs only. It never invokes a planner, render job, GLB loader or project update. Changing the brief chooses an exact key from the library, not a nearest-looking image.

Keys cover house type × current character × modern composition × layout × ground through G+3 (240 entries). Non-modern characters use the `auto` composition. Personality, variation, plot dimensions, room programme and selected products are not represented as exact user geometry: the UI labels images as examples on a sample plot with balanced settings. Unsupported saved styles or combinations show an explanatory state rather than a different house.

## Rebuild offline

1. `npm run house-ideas:prepare` builds deterministic validated reference fixtures using the production planner and architecture adapter. Fixture dimensions and plan identity are retained per entry. Use `-- --retry-unavailable` to try unrenderable fixtures with the configured sample plots.
2. `npm run house-ideas:render` replays those payloads through `blender/generator.py:create_scene` and writes one 768 × 576 EEVEE PNG per supported entry. No GLB, .blend, AI image substitution or architecture search is used in the client. Source JSONs, completed-render digests, logs and failures stay under ignored `output/house-ideas/`.
3. `npm run house-ideas:render -- --publish-only` creates the public manifest from completed images. Missing/failed images are unavailable, never marked ready. `--start N --end M` supports resumable batch workers; publish after the workers finish.
4. `npm run test:house-ideas`, `python scripts/test-house-ideas-validation.py`, then `npm run build`.

Do not rename another layout's image to fill a missing entry. Modern composition grammars restrict which layouts they can produce; the preparation step rejects mismatches. A ground-only terraced villa is not advertised as a supported image. Previously generated samples resume only when their payload and render-settings digest matches.

To add a style/layout, update the catalogue dimensions in `src/lib/gallery/houseIdeas.ts`, supply it through the existing production generator, regenerate the library, and verify actual layout, storeys and source identity before publishing. All images are project-generated assets; no external imagery or manufacturer photo is required.
