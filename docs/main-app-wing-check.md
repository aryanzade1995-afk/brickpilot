# Main app wing check — 2026-10-03

Verified the running application at `http://127.0.0.1:3003`, through the actual
Brief → Directions → pinned 2D Plan → 3D Massing flow. This check used a copy of
the saved large-villa, Courtyard-character, G+2 family brief on a 24 × 30 m plot.

| Brief layout | Pinned ground plate | Main Blender family | Displayed seed |
| --- | --- | --- | --- |
| Twin wings | twin-wing | TWIN_WING | 35368 |
| U wings | u-wing | U_SHAPED | 35368 |
| Courtyard wings | courtyard-ring | COURTYARD | 35368 |
| Pavilion | pavilion | PAVILION | 35368 |

All four selected plans pass the existing hard checks. Their editable scenes,
GLBs and three render downloads load from the main page. Existing Blender input
tests and saved-scene runtime checks pass for all four. Pavilion retains the
same model and job after a browser reload. Pending Twin-wing previews are reused
by Massing rather than launching a second job.

Fixed two integration failures found during this check: the old running backend
was dropping exact-seed requests, and frontend caches identified a direction by
plan alone. The backend was restarted; cache identity now includes the exterior
seed, and preview jobs persist and resume across reloads. An interrupted request
without a job ID is recovered rather than leaving the page waiting forever.

Screenshots are local generated artifacts in `output/wing-geometry-review/`:
`main-twin-wing.jpg`, `main-u-wing.jpg`, `main-courtyard-ring.jpg`,
`main-pavilion.jpg`.

Restored the saved brief to Auto layout and its original 16 × 18 m plot. This
original brief remains blocked by the required covered verandah check; testing
on a larger plot does not establish that it fits the original site.

The seed-only silhouette limitation remains: occupied rooms and floor plates
stay fixed. Correct selection and different exterior details do not establish
substantial architectural uniqueness. See the actual mesh audit in
[wing availability](wing-availability.md).
