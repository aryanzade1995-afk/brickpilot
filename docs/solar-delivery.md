# Canonical solar delivery and Blender replay

Solar geometry is derived once from the applied canonical layout. `renderContract.ts`
calls the same frame, photovoltaic face and four-support matrix functions as the
live viewer. It changes axes from Three `(x,z,-y)` to Blender `(x,y,z)`, in metres,
and serializes column-major matrices. Python consumes those matrices for shared
unit-box / unit-plane meshes; it never searches, packs or relocates modules.

## Immutable building replay

`POST /api/villas/solar` accepts `{baseJobId, solar, quality}`. The backend resolves
the original server-owned accepted `.blend`, input and manifest. It revalidates
the supplied layout against that building's actual roof, dimensions, full module
envelopes, obstacles and reservations. Invalid or stale layouts fail; no fallback
placement or architecture search occurs.

The building cache key is SHA-256 of original input bytes and accepted blend bytes.
The solar cache key is SHA-256 of renderer version, building identity, canonical
render contract and quality. Solar jobs use `solar-villa-worker.mjs` and
`blender/solar_replay.py`; neither invokes the architecture worker, history lock,
seed search or diversity gate. The source scene is opened unchanged. Its plan ID,
seed and input digest are checked; its measured architectural fingerprint must
match before/after adding PV. Solar objects carry `formstead_solar` extras and
live in their own collection. Fingerprint measurement excludes this tag.

Completed artifacts and their cache index survive restart. Interrupted requests
are explicit failures/retries, never architecture regeneration. The client stores
solar jobs and artifacts independently of accepted buildings, keyed by base job,
full solar input/layout identity and quality. Old completions cannot become a
different project's current design.

## Viewer, images and downloads

Building-only GLB/Blend/image links remain explicit. A separate action renders
the applied solar layout and exposes combined GLB, Blend, three images and the
canonical layout JSON. Drafts must be applied first. Reservation exports contain
only tagged keep-free boundaries and zero modules; removal exports contain no PV.

Combined GLBs preserve PV tags and shared cell texture. `prepareVillaScene` strips
embedded PV and keep-free objects before caching architecture, so the current
canonical sibling layer is displayed exactly once on reopening.

Only images matching the current building and solar signature are labelled current.
On input, panel, pose, reservation or validity changes, older combined artifacts
disappear from current downloads/images. The building-only reference is visibly
labelled out of date for the solar design. AI reference capture remains explicitly
building-only; it must not be presented as a validated solar depiction. The main
report chooses a matching final/preview solar artifact; PDF creation also rejects
an explicitly stale combined image. Interior and schematic capture paths remain
labelled building/interior-only. Financial/government questionnaire edits do not
invalidate unchanged geometry.

## Cost delivery

An optional version-1 `solar.delivery` extension adds layout/roof signatures,
status, reservation count, concept assumptions and canonical per-array inventory
to the existing cost schema. Groups retain all panel IDs, versioned specification
ID/revision/key/source, physical dimensions, wattage, count, exact capacity and
local azimuth/tilt/elevation/mounting height. Public cost sheets omit absolute
household/site coordinates and the private Brief.

Only an applied, currently validated layout produces installed schedule rows.
BOQ component rows replace the hidden legacy catalogue solar line; there is no
fake product photo. Legacy allowances and pre-extension saved cost snapshots
remain readable. Current schema checks ensure unique panel IDs, count × W / 1000,
schedule/summary agreement, itemized solar subtotal, and no double allowance.
Public schedules additionally check numeric quantities × rates against gross cost.
Installed solar replay still requires the live roof to be revalidated after reload.

Both PDFs, Excel, CSV and public read-only specifications include count, capacity,
layout status, gross direct cost, assumptions, backup limitations and separately
labelled unverified potential assistance (INR 0 deducted). Excel/CSV retain the
full panel ID trace; PDFs summarize arrays. Gross solar costs exclude unconfirmed
solar taxes and shared project add-ons. No generation, cost or assistance is
invented for undecided, excluded or reservation-only designs.

Run `npm run test:solar-pipeline` for geometry, stale-layout, GLB de-duplication,
delivery arithmetic, legacy compatibility, PDF/Excel/CSV and render-state tests.
Actual Blender verification can run `solar_replay.py --replay replay.json
--out-dir <output> --name <name> --export-only` against a server-generated replay
contract; normal solar jobs also render all three existing accepted camera views.
