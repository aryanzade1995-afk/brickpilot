# ResPlan conditional geometry model v1

Artifact: `data/plan-model.json` · version: `resplan-ridge-retrieval-v1`.

Source: **The ResPlan Authors**, *ResPlan: A Large-Scale Vector-Graph Dataset of
17,000 Residential Floor Plans* (2025), user-provided archive, repository
https://github.com/m-agour/ResPlan. Derived annotations: CC BY 4.0; full licence
and scope are retained in `data/LICENSE-ResPlan.txt`. The artifact records the
archive SHA-256. No source listing photographs are shipped.

## Modifications and training

Only allowlisted Shapely/NumPy/NetworkX pickle constructors are permitted. No
dataset code is executed. Footprints combine rooms, inner areas and walls;
front-door proximity normalizes entry to plan-south. Geometry is normalized to
its bounds. This archive contains image-scale coordinates, so recorded net area
is used instead of assuming polygon coordinates are metres. Invalid/missing
areas and unusable shapes are excluded. Canonical augmented plans are excluded;
normalized 12×12 occupancy + anchors + room counts remove duplicate signatures
globally before retaining canonical splits. This coarse filter does not certify
absence of every near duplicate.

Accepted: 9,127 · training: 7,296 · validation: 910 · test: 921.
The retrieval memory has 192 **training-only** examples. No validation/test
examples or raw full room polygons are shipped as retrieval memory.

Inputs: ground-floor bedrooms / 8, baths / 8, target enclosed area / 600,
log envelope aspect / log 4. Targets: footprint fill and living/kitchen centres.
Standardization and ridge weights are fitted on training records. Ridge alpha
100 was selected on validation among 0.1, 1, 10 and 100. Runtime blends the
conditional prediction with a seeded nearest training exemplar.

| Evaluation | Learned MSE | Training-mean baseline MSE |
| --- | ---: | ---: |
| Validation | 0.0323403 | 0.0330671 |
| Test | 0.0320919 | 0.0331480 |

These scores evaluate normalized geometry, not villa beauty or engineering.
The roughly 3.2% test improvement is modest. Actual plan validity is evaluated
separately using all application hard checks. Family labels are fill/holes
heuristics, not human architectural labels.

## Safeguards and limits

Guidance adapts existing recipes, never supplies unchecked coordinates. Explicit
user families and courtyard character are preserved. Failure retries the baseline.
Winning versioned recipes preserve saved designs; legacy pins use baseline.

Limits: South Asian, single-floor source, vectorization artefacts, no furniture,
no human aesthetic assessment or structural certification. Large-villa families
and multi-floor consistency come from existing rules. Future model releases must
bump the version and retain versions needed for saved replay. Honour upstream
takedown requests when updating.
