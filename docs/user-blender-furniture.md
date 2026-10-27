# User Blender furniture

The seven supplied `.blend` files are read without automatic script execution.
Their original bytes are never edited. Curated object recipes extract 13 models;
source architecture, floors, mirrors, cameras, lights and fluid simulations are
excluded. `sourceFile`, SHA-256 and `sourceObjects` record each extraction in the
catalogue. The original author/licence is unknown: local source notices explicitly
mark this, without inventing an open licence or asserting redistribution rights.

## Rebuild

Run the repository's Blender executable with:

```
blender -b --factory-startup --disable-autoexec --threads 4 --python-exit-code 1 --python scripts/prepare-user-furniture.py -- --source-root <folder-containing-six-blends> --downloads-root <folder-containing-roadside-cabinet>
```

Optional `--only user-sofa,user-bathroom-basin` rebuilds selected models without
removing other catalogue entries. Recipes live in `scripts/user-furniture-recipes.json`.
The converter normalizes each mesh to a one-metre longest axis, Y-up, floor Y=0,
centred X/Z, front +Z. The existing room placement supplies final real-world size.
Detail is bounded to about 17,500 triangles/model and textures to 1024 pixels.
Original PBR maps are retained where supported. Unsupported source shaders use
plain PBR approximations; the hob uses explicit steel and dark burner materials.
PNG thumbnails show the actual converted geometry.

## Integration

- `catalogue.ts`: existing Finishes & Cost selection and room override keys.
- `placements.ts`: replaces existing furniture envelopes only; separate desk and
  office-chair categories prevent replacing dining chairs with swivel chairs.
- Automatic defaults use the uploaded sofa, armchair, desk, chair, basin,
  compatible floor-standing toilet, kitchen modules, hob and pendant. Explicit
  older model choices and standard/procedural selections remain respected.
- Wall-hung toilets and Indian pans retain their own compatible representations.
  Glass/handleless cabinet choices retain the existing procedural system.
- The roadside cabinet is an optional service-storage style at existing sideboard
  positions, never an automatic replacement for bedroom wardrobes.
- Selected finishes bind to paint, upholstery and ceramic material roles. Model
  style has no product price, quantity or architectural identity effect.
- The live asset loader shares GPU buffers/maps per model. The existing Blender
  appearance exporter reads the same catalogue, hashes and canonical instances.
  Older downloaded furnished GLBs need a new export to include the new defaults.

No frame-rate guarantee is inferred from triangle counts; benchmark the full
house on the target GPU. No source room is inserted into the accepted villa.
