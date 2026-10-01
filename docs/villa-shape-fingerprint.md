# Villa shape fingerprints and diversity gate

The integrated Blender workflow is described in [Blender integration](blender-integration.md).
It adds evaluated-mesh similarity after scene construction and displays accepted
GLBs in the app. The TypeScript gate below continues to serve deterministic
candidate assembly and the existing study-direction workflow. Fingerprint
sampling is now schema 2; older persisted vectors are discarded.

The verified 2D plan remains the source of truth. A retry changes only the exterior
seed; it never regenerates rooms, moves doors or invents an upper floor.

## Files and flow

`src/lib/engine/fingerprint/createVillaArchitecture.ts` assembles one exact seed:

```
Design.floors → BuildingModel → VillaDesignDNA → validated MassingModel
             → validated FacadeGrammar → VillaShapeFingerprint
```

`VillaShapeFingerprint.ts` measures those actual solids. `VillaDiversityGate.ts`
compares candidates with recent accepted records. `src/state/studio.ts` applies
the gate to new directions, initial generation, exterior reseeding and plan
rerolling, before the existing Three.js study preview is built. That renderer
remains available alongside the integrated accepted Blender GLB viewer.

The Blender input command applies the same policy before writing a new handoff.
The pure `createBlenderInput()`/`createVillaArchitecture()` adapters remain
deterministic exact-seed assemblers; callers wanting **new** architecture must use
`selectDistinctVilla()` or `createDistinctBlenderInput()`.

## What is measured

The fingerprint includes massing family, realized block count/ratios/positions,
per-floor footprints, actual upper coverage/offsets, front and side silhouettes,
real courtyard presence/ratio, unsupported upper projection, terrace/balcony
geometry by floor and source-door/stair access points, realized hero feature,
facade composition family, realized roofline, vertical geometry, occupied-volume
void ratio and overall height.

The facade family is the **realized architectural family** (e.g.
`FRAMED_MODERN`, `SCREEN_HOUSE`), and hero/roofline types come from the generated
facade assemblies. An omitted hero/roofline is recorded as `NONE`. Unused DNA
block offsets/ratios and requested-but-omitted recipes do not create novelty.

Schema 1 uses 16×16 fractional area grids, eight floor slots and 64 block/access
slots. Its vector is always the same length and every value lies in `[0,1]`.
Coordinates are relative to the ground plate, so translating the whole building
does not make a new shape. Absolute span/height descriptors retain scale. Roof
geometry has a separate area-integrated height map to capture steps and recesses
without a large unchanged ground floor hiding their differences.

Similarity is in `[0,1]`: 1 means identical, 0 means maximally different.
Occupancy groups use fractional intersection over union; common empty cells do
not increase similarity. Descriptor groups use normalized absolute distance.
Real geometry contributes 94%; family/hero/roofline labels contribute at most
6%. A physically identical surface fingerprint scores 1 even after label changes
or internal solid splits. **Materials, colors, landscape, lighting and cameras
are excluded.** Fine window trim and planting are excluded from silhouette data.

These are geometric descriptors, not a learned visual-perception score or
structural certification. Changing the grid/layout requires a schema increment;
stale history versions are discarded.

## Acceptance policy

Defaults are centralized in `DEFAULT_DIVERSITY_LIMITS`:

| Setting | Default |
| --- | --- |
| Similarity rejection threshold | `> 0.75` |
| Retained/comparison history | 50 accepted villas |
| Rolling diversity window | 10 villas, including the candidate |
| Same massing family | at most 2 |
| Same hero | at most 2 |
| Same facade family | at most 2 |
| Same roofline | at most 3 |
| Maximum candidate attempts | 32 |

The outgoing oldest record drops from the ten-villa quota window before testing
the candidate. Similarity still compares with all retained records. Rejected
attempts never enter history. The nearest record is chosen deterministically,
including ties. Retry seeds come from one seeded PRNG stream, not `Math.random()`.
The same plan, initial seed, limits and history produce the same retry sequence.

The browser persists compact fingerprint records (vector plus seed, plan ID and
quota keys) in `brickpilot.studio`. History survives brief edits/reset/reloads;
it is separate from the old exterior seed cache. Invalid/stale persisted records
are discarded. The accepted seed is persisted for exact reloads. Pinning or
loading an existing villa is replay, so it does not count as another generation.
The displayed saved villa can still be compared as a reference when reseeding.

If no candidate passes, the system **does not lower the threshold or accept a
repetitive fallback**. Exterior reseeding retains the currently displayed villa.
Directions may contain fewer than four accepted options. The 2D plan remains
available if no exterior passes. Some source plans support only one massing
family; the requested two-per-family quota can therefore exhaust new options
until other compatible plans/families enter the rolling window.

## Configuration and debugging

The store exposes `setDiversityLimits(partialLimits)` for configuration; it
validates and persists the settings. Debug decisions are available in
`useStudio.getState().shapeDebug` and browser console output. Each attempt reports:

```
[VillaShapeFingerprint] seed=42 family=STACKED_VOLUMES nearestPreviousSeed=41 similarity=78.01% REJECTED reason=Shape similarity ...
```

Blender CLI examples:

```cmd
npm run blender:input -- --seed 41 --out output\villa-input.json
npm run blender:input -- --seed 42 --history output\villa-fingerprint-history.json --similarity-threshold 0.72 --max-attempts 64
```

The first seed is a starting candidate: the accepted seed can differ after
retries and is recorded in `villaDesignDNA.seed` and `shapeFingerprint.seed`.
The default CLI history is `output/villa-fingerprint-history.json`. A history
file lock prevents simultaneous exports from overwriting one another's history.
Exhausted searches leave existing output/history intact and exit with an error.
History is local to the browser or CLI file; these stores are not shared across
devices or with each other.

To intentionally replay a known seed without counting another new villa:

```cmd
npm run blender:input -- --seed 41 --exact-seed --out output\replay-input.json
```

Tests cover normalized deterministic output, palette independence, geometric
differences, label/split invariance, quotas and window expiry, threshold edges,
retry reproducibility, history repair, exhausted rejection, saved-seed replay,
browser persistence and authoritative-plan preservation.
