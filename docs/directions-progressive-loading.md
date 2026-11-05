# Front-facing directions and progressive plans

New Directions searches prefer at least two genuinely wide ground-floor
footprints. This changes source planning, not SVG rotation. The main entry stays
on the normalized front side; the actual compass bearing remains in the canonical
model and is labelled beneath each plan. Tested north/east/south/west approaches.

The optional `frontage: 'wide'` is stored in the source plan recipe and restored
by the pin parser. Saved recipes without that option retain their behaviour.
Selecting and reloading each new option reproduces its rooms and floor geometry.

If one named modern composition cannot fit, generation searches additional seeds
and modern bar/stepped layouts. Offered modern source shapes differ by at least
8% of occupied geometry; no duplicate cards are used to reach four. Four plans
and at least two wide houses pass on the tested 15.5×20.5, 18×24 and 25×30 m
plots and additional variation seeds. A mathematically constrained/invalid brief
can still produce fewer; rooms, setbacks and required parking are never removed
to force a count. A constraint notice explains that outcome.

The worker now sends each checked 2D plan immediately. Directions shows it while
remaining architecture checks continue. The Lottie overlay ends when the first
current-brief plan is available. Final cards put 2D above the 3D image, so Blender
rendering never conceals a ready plan. New requests terminate older workers, and
stale messages cannot populate another brief. Startup errors stop loading and
remain retryable. A pinned option is deduplicated by actual plan fingerprint,
not merely its family and seed (different compositions can share both).

Verification on 5 November 2026:
- `output/directions-progressive-final-tests.log`: 9 passing tests for frontage,
  four distinct plans, road bearings, replay, streaming, cancellation, startup
  errors and existing image-cache/queue behaviour.
- `output/directions-progressive-regression.log`: site-form, coastal styles and
  modern composition geometry regressions.
- Final production build and lint logs: `output/directions-progressive-final-*.log`.
- `output/directions-progressive-timings.json`: measured first-plan publication
  and complete architecture timing. This is calculation time; cold worker startup
  and Blender renders are separate. The recorded parallel test run published the
  first plan at 122 ms and completed all four around 7.2 s; timings vary with load.
- `output/directions-front-plans.jpg`: actual browser screenshot showing wide,
  front-facing plans above their 3D images. Browser verification used an isolated
  127.0.0.1 origin, preserving the localhost project's saved data.

Source changes: `generate.ts`, `planner/{layout,index,directionFrontage}.ts`,
`engine/types.ts`, `state/{studio,directions.worker,directionsWorkerClient}.ts`,
`App.tsx`, `routes/Directions.tsx` and their focused regression tests.
