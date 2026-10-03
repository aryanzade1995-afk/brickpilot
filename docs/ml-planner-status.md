# 2D ML roadmap: implemented baseline

The existing planner remains the coordinate generator. Every candidate must pass
the production validator before it enters Directions or the Blender pipeline.

## Implemented

- All geometry-changing wizard edits and suggestions use the same production
  capacity gate. Invalid choices preserve a previously valid brief. Legacy invalid
  briefs remain editable so their requirements can be repaired.
- Directions collect up to eight valid, distinct candidates for four slots and
  select the first followed by the most geometrically different remaining plans.
- Distance uses sampled occupied floor footprints, living/master/stair locations
  and actual plan family. Materials, render styles and exterior decorations do not
  influence it. Explicit user shape selections remain authoritative.
- `node --experimental-strip-types scripts/export-plan-training.mjs` exports
  32 seeded, validated synthetic plans with requirements, geometry, fingerprints,
  normalized occupancy features and validation labels to
  `output/ml-baseline/plans.jsonl`. The export does not overwrite user designs.

## Not implemented yet

This is a procedural diversity baseline and training-data interface, not a trained
ML model. No neural-network weights are deployed. These 32 synthetic examples are
not enough to train or evaluate a general floor-plan generator.

Next: safely import and deduplicate licensed structured real plans; split by
source project before training; establish retrieval/adaptation metrics; train a
ranker against held-out human preference and architectural validity labels; then
compare it with this deterministic baseline. A model proposal must be adapted to
the user's exact room programme and pass all existing hard checks. No image-only
dataset may supply unverified room coordinates.

Small plots and dense programmes may admit only compact rectangular solutions.
The system must not manufacture invalid wings merely to increase diversity.

## Validation

Capacity tests cover rejecting impossible selections without mutating the brief
and accepting choices that pass all hard checks. Diversity tests cover identical
geometry distance, different-footprint distance, deterministic selection and
feature dimensions. Existing planner, 2D, 3D and replay tests remain enabled.
