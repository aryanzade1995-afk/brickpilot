# Learned 2D planner: production integration

## Pipeline

Brief → canonical requirements → conditional prediction + seeded retrieval →
existing candidate plate/wing planner → hard validation → preference scoring →
geometry diversity selection → accepted Design.floors → Three.js / Blender.

New concepts use the model automatically; no key, external inference server or
GPU is required. Existing accepted plans are not silently regenerated. Generate
new concepts or reroll the 2D plan to use new guidance.

## Implemented

- Restricted archive import, recorded-area normalization, entry orientation,
  duplicate filtering and exclusion of canonical augmented plans.
- Conditional ridge regression fitted on 7,296 real ResPlan training plans.
  Validation chooses regularization; 921 held-out test records measure error.
- 192 training-only exemplars form a balanced retrieval memory. Same seed and
  brief reproduce the selected exemplar and proposal exactly.
- Guidance influences feasible plate proportions, orientation, band depths and
  automatic family order. On large plots, derived archetypes map to the existing
  twin-wing, U-wing, courtyard-ring and pavilion planners. This mapping is an
  adaptation rule, not a learned villa-type classifier.
- Explicit families, courtyard character, room programmes, setbacks, dimensions,
  circulation, stairs and all geometric checks remain authoritative. If guidance
  yields no passing plan, the unchanged planner retries. Existing wing recipes
  keep their living/master/kitchen/verandah/double-height choices.
- Accepted plans record exact family/trial seed/model version for saved replay;
  legacy pins continue to use the previous baseline planner.
- Directions compare occupied footprints and semantic anchors, excluding colours.

## Reproduce

Offline training tools only (no new web dependencies):

```cmd
python -m pip install -r scripts/ml-training-requirements.txt --target output/ml-python
python scripts/train-plan-model.py "C:\Users\aryan\Downloads\archive (4).zip"
node --experimental-strip-types scripts/review-ml-plans.mjs
```

Comparison: `output/ml-review/index.html`, with measured results, training metrics
and production Blender inputs beside it. It compares 20 briefs × 3 seeds with
the baseline, then tests one brief over 20 seeds.

## Scope and limits

This is an implemented hybrid ML-guided generator, not a diffusion model or a
neural model that directly predicts every wall. The small regression has a modest
held-out advantage (about 3.2% lower normalized MSE than predicting the training
mean). Variation comes from its combination with seeded retrieval, broader
validated candidates and existing massing recipes. No human preference labels
or architectural-quality benchmark are claimed.

The source is single-floor, mainly South Asian housing. Multi-storey stairs,
support and terraces are handled by the application's rules. Dense small plots
may permit only one valid silhouette. Full graph/diffusion generation and human
preference ranking remain future research, not enabled features.
