# Curated CC0 architectural library

Powered by [Poly Haven](https://polyhaven.com). See [LICENSES.md](LICENSES.md) for
every original file, source URL, and derivative. The locked `manifest.json`
contains publisher checksums and `inventory.json` contains installed SHA-256.

Install on another machine from the project root:

```cmd
python -m pip install pillow numpy
python blender/assets/fetch_assets.py
python blender/test_assets.py
```

The 3.9 GB originals live in `textures/`, `hdri/` and `models/` locally. Binary
downloads are excluded from Git because the maximum-quality models exceed
GitHub's per-file limit; commit the manifest, installer and license inventory.
Rendering never contacts an asset service. Surface sets include native 4K and
1K maps; maximum-quality model textures also have generated 1K derivatives.
Normals use OpenGL orientation and derivatives preserve alpha and normalize
the resized tangent vectors. Re-running the installer repairs missing originals.
Blender is needed for the model EXR derivatives; the installer finds the existing
project runtime, or accepts the executable path in `BLENDER_BIN`.

Tropical Island Tree and Pachira replace the requested palms with the user's
approval. Botanical models have realistic scanned texture components and
artist-built geometry, not a claim of whole-tree photogrammetry. The lime finish
uses scanned rough plaster; chemical composition is not certified by the source.
The library includes sandstone rather than a mislabeled laterite texture.

`prepare_manifest.py` is a maintainer tool for deliberately selecting newer
publisher assets. It is not called by the app or by the normal installer.
