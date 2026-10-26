# Imported plumbing parts

Geometry extracted from **Modular Pipes**, by **Kuutti Siitonen**, Poly Haven.

- Source: https://polyhaven.com/a/modular_pipes
- License: CC0 1.0 — https://creativecommons.org/publicdomain/zero/1.0/
- Verified/downloaded: 2026-10-24, official Poly Haven API and download host.
- Source objects: pipe_5cm_pvc, pipe_turn_short_pvc, pipe_junction_t_pvc, pipe_support_pvc.
- Adaptations: mesh-only extraction, normalized component anchors, residential scaling, neutral ivory/charcoal/warm-grey materials. Original industrial textures are omitted.
- Reproduction: download the 1K glTF with its listed includes via https://api.polyhaven.com/files/modular_pipes into output/third-party/modular-pipes/, then run scripts/extract-pipe-fittings.py in Blender.

`polyhaven-fittings.json` is shared mesh data for browser and Blender replay. Fitting selection, placement and tube trim are calculated once in TypeScript and serialized in the canonical plumbing layout. Python does not route pipes or choose fitting positions.

Pipe sockets/geometry are visual concept details, not manufacturer-selected fittings or plumbing compliance approval. Existing route/outlet review states remain in effect.
