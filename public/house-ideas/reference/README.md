# Character reference photographs

Neither photograph was attached to the implementation request. No stock image or
generated image has been substituted.

Drop the supplied photographs into this directory as:

- `coastal-bungalow.jpg`
- `tropical-beach-villa.jpg`

Use approximately 1200 pixels wide. Restart `npm run dev` after adding a file, or
rebuild for production. Availability is checked at startup/build so missing photos
never produce failed HTTP requests. Edit `src/lib/gallery/referenceImages.ts` to
record the actual credit/licence/source URL when supplied. To use WebP instead,
update its `src` in that map; the build also recognizes WebP, PNG and JPEG files.

Photographs stay outside the Blender manifest and are labelled inspiration only.
