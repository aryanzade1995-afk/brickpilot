# Modern villa seed library

The modern style has 1,000 deterministic exterior seeds in
`src/lib/engine/data/modern-seed-bank.json`. The catalogue is built by
`npm run modern:seeds:build`, using the production `generateAlternativeDesign`
pipeline on the default modern villa plan (plan seed 41). Each entry has a
unique seed, a SHA-256 identity of the actual architectural geometry, and its
realised facade family, hero and roofline. Colours, materials, labels and seed
metadata cannot establish geometric uniqueness. The entries alternate facade
families to avoid long runs of one composition.

These are validated architecture inputs, not 1,000 pre-rendered Blender scenes.
Every actual user plan is validated again; an incompatible candidate is skipped.
Changing the exterior never changes the chosen plan, rooms or openings.

Fresh modern generation uses unused catalogue seeds first. The browser remembers
its selections independently of project resets. The production worker keeps the
authoritative `output/modern-villa-usage.json`, under the existing production
history lock shared by queued jobs. This ledger retains all used seeds and
geometry identities and measured-mesh identities, beyond the 50-entry perceptual similarity window, and
survives server restarts. Invalid usage data stops generation rather than
silently resetting protection. Existing installations retain the available
recent production seeds; the new complete geometry ledger starts when enabled.

Only fully rendered results enter production usage. Failed candidates do not
consume the catalogue. Exact saved-design and direction previews remain replayable;
recording a replay is idempotent. A fresh modern generation cannot return a
recorded geometry, including the final fallback. Its recent evaluated-mesh
similarity threshold never relaxes all the way to 100%.

Evaluated Blender fingerprints use schema 4, measuring facade and balcony
triangles separately from the unchanged structural shell. Half the comparison
weight measures these exterior projections; colours and planting have no weight.
The original shell and roof projections remain the other half. Older sampling
versions remain readable for quotas but are not compared with schema 4 vectors.
Explicit Blender geometry rejections retry another candidate; a missing Blender
executable, timeout or arbitrary crash still stops the job.
Recent modern diversity quotas compare modern-compatible facade families.
The fixed occupied massing and required roof form can repeat; realised facade
geometry still must differ. This avoids rejecting an otherwise new exterior
merely because it preserves the user's chosen footprint and clear terrace.

After all 1,000 seeds are used, selection continues into unused 32-bit seeds; it
does not wrap to the beginning. A seed bank cannot guarantee 1,000 visibly
different solutions for every constrained floor plan. If a bounded search cannot
find a distinct valid result, the current design is retained and the user can
choose another direction or adjust the plan. Usage is shared by users of this
server; separate installations have separate ledgers.

`npm run test:modern-seeds` replays all 1,000 geometries, checks catalogue and
browser exhaustion, durable usage, replay and protection against material-only
novelty. Existing architecture and Blender validation remain mandatory.
